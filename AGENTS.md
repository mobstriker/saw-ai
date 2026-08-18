# SAW AI — Agent Memory

## Project Overview
SAW AI is a React + TypeScript + Vite single-page app (AI chat workspace with
artifact/code preview, file inspector, and phone simulators). Built to the
owner's personal preferences — do not genericize the UX.

## Key Commands
- `npm run dev` — Vite dev server (default port 5173, HMR on unless `DISABLE_HMR=true`)
- `npm run build` — production build (typecheck runs via `tsc` implicitly; run `npx tsc --noEmit` to typecheck alone)
- `npx tsc --noEmit` — TypeScript typecheck (clean = exit 0)

## Architecture Notes
- Entry: `src/main.tsx` → `src/App.tsx`
- Markdown/code rendering: `src/utils/markdownRenderer.tsx` parses fenced code
  blocks, derives a **smart filename** from the AI's `// path/file.ext` comment
  or info-string title, falls back to `${lang} Component`. Artifact cards and
  the FileViewerModal header show this real filename (not "snippet1.dart").
- File preview: `src/components/FileViewerModal.tsx` (code + live web preview
  iframe) and `src/components/ArtifactViewer.tsx`.
- Mobile preview: `src/components/FlutterPhoneSimulator.tsx` handles Dart/
  Flutter, Swift/SwiftUI, Kotlin/Compose.
- Flutter engine helpers: `src/utils/flutterEngine.ts`.

## Flutter / Dart Preview (structural)
- Uses Google's public **dart-services** API at `https://stable.api.dartpad.dev`
  (CORS `*`, free, no subscription, no API key). Flutter 3.47 / Dart 3.13.
- `analyzeDart(source)` → POST `/api/v3/analyze` → `{issues:[...]}`. Used to
  drive the DEBUG button (red when issues.length > 0). This is the ONLY
  dart-services call still used.
- The DartPad **embed SPA no longer responds to `sourceCode` postMessage**
  (the embed handler was removed/changed upstream), so live-canvas rendering
  via an iframe is dead. We therefore do NOT embed DartPad at all anymore;
  `compileDDC`/`injectSourceIntoDartPad` were removed from `flutterEngine.ts`.
- **Preview approach**: `FlutterPhoneSimulator` renders a **structural
  widget-tree preview** directly in the phone screen (no iframe, no
  postMessage, no fallback timer, no "engine unavailable" banner). The
  `dartWidgetParser` produces a faithful approximation of the UI. If there's
  nothing renderable, a friendly placeholder shows; if `analyzeDart` reports
  issues, an error overlay shows the bug text (not the source code) and the
  DEBUG button lets the user send it to the AI.
- **Why no more "Flutter engine unavailable / showing structural
  approximation"**: that message came from the old fallback timer waiting for
  a `{type:'ready'}` message from the DartPad iframe that never arrives. With
  the embed removed, the structural preview is the intended, always-on path —
  no false alarm. (The user reported this as a bug; root cause = dead embed.)
- `ensureFlutterApp(source)` wraps a bare Widget in a `MaterialApp` so the
  analyzer gets compilable input.
- **Sandbox limitation**: in this runtime's headless browser the structural
  preview renders fine; the analyze API works (returns real compile errors).

## Restore Button (per-response undo)
- `Message.projectSnapshotBefore?: {projectId: string|null; files: ProjectFile[]}`
  captures the bound project's files **after** this assistant turn's changes
  were applied by `WorkspaceAutopilot` (a **post-change** snapshot, captured in
  `handleSendMessage`, attached to the assistant message only when
  `didModifyProject` is true). Restoring to message N replaces the bound
  project's file array with that snapshot, so everything that existed at turn N
  is kept and any files/artifacts created in *later* turns are dropped — the
  user's intent: "only what was there at the step I clicked restore is kept."
- `MessageItem` renders a **Restore** button (next to Retry/Copy, after Continue
  — Continue is intentionally never touched) only when `projectSnapshotBefore`
  exists and not currently generating. `handleRestore(messageId)` rolls the
  project files back to the snapshot (full array replacement → later files
  removed automatically), re-derives the Artifacts panel from messages up to and
  including the restored one (drops later artifacts), and refreshes the open
  file viewer. When `projectId===null` it removes the created project.
- `restoredAt` timestamp flips the button to a green "Restored" badge and allows
  re-restoring. The memo comparator in `MessageItem` checks
  `Boolean(projectSnapshotBefore)` and `restoredAt` so the button
  appears/updates correctly (the snapshot is attached in a separate update
  after the message is finalized).
- Works in both universal chats and project-bound chats (single `ChatWindow`
  render path in `App.tsx`).

## Shell/CLI blocks are never artifacts
- `ArtifactParser.extractArtifacts` and the markdown renderer both call
  `isShellLanguage(lang)` (`SHELL_LANGS`: bash/sh/shell/zsh/fish/powershell/
  pwsh/cmd/doskey/bat/batch/console/terminal). Shell blocks are **skipped** as
  artifacts and rendered inline in chat with only a **Copy** button (no
  View-Artifact / Implement / "open in separate page") — exactly how other
  apps show bash. This fixes the user's "bash commands should not be in the
  artifacts folder" complaint. Real code files (html/tsx/dart/…) still become
  artifacts.
- The same `isShellLanguage` gate is what the sandbox agent uses to find
  runnable commands in AI responses (see In-App Sandbox Runner).

## Universal chat right panel
- In a universal (no-project) chat the **Files tab is hidden** in `RightPanel`
  (the Files button only renders when `currentProject` exists), and App
  auto-switches the active tab from `files` → `artifacts` so the user never
  sees an empty file tree. The panel still accepts file uploads (dropped into
  the chat), but the Files-as-project view only appears once a project exists.
- **Save as Project** (Feature 4): in a universal chat with **2+ artifacts**, a
  "Save as Project" button appears in the `RightPanel` header. It asks the AI
  for project metadata (name/description/instructions) then promotes the chat's
  artifacts into a new `Project` (files from the artifacts), rebinds the active
  chat to it, and switches the panel to the Files tab. `handleSaveArtifactsAsProject`.

## In-App Sandbox Runner (restricted command execution)
- **Backend**: `src-tauri/src/sandbox.rs` exposes Tauri commands
  `run_sandbox_command`, `list_sandbox_artifacts`, `write_sandbox_files`,
  registered in `lib.rs` with `SandboxState` (caches the sandbox root path).
- **Restrictions**: workdir locked to `$APPDATA/saw-sandbox/<workdir>` (no `..`
  traversal, no absolute paths outside root); executable **allowlist**
  (npm/npx/node/yarn/pnpm/dart/flutter/cargo/rustc/tauri/git/python/pip/make/
  gradle); **no shell** so args can't smuggle a second command; sensitive env
  vars stripped; npm/cargo/pub caches redirected into the sandbox. Network is
  intentionally NOT blocked (real builds fetch packages).
- **Streaming**: stdout/stderr emitted live as `sandbox://stream` events
  (`{runId, stream, line}`); `runSandboxCommand` (TS) subscribes before
  invoking so no lines are missed.
- **Shared store**: `useSandboxStore()` (in `src/utils/sandboxStore.tsx`) is a
  plain hook created **at the App level** and passed down via props
  (`sandboxStore` prop to ChatWindow → SandboxPanel). It is NOT React context
  — App stays mounted, so AI-driven runs keep streaming into the log even when
  the SandboxPanel is closed. State: `logs`, `running`, `exitCode`,
  `artifacts`, `accessGranted`, `pendingApproval`. Methods: `runCommand`,
  `seedProject`, `refreshArtifacts`, `requestApproval`/`resolveApproval`,
  `toggleAccess`, `pushLog`. Log lines carry `source: 'manual'|'agent'` so the
  panel can style AI-driven runs distinctly.
- **"Give Access" (AI-driven loop)**: a `Give Access`/`Revoke Access` toggle in
  the SandboxPanel header flips `accessGranted`. When granted and the chat's
  automation mode ≠ `review`, App's `handleSendMessage` adds a
  `# Sandbox Command Execution` block to the system prompt telling the AI to
  emit runnable commands in ```bash/```sh (or `<sandbox_run>`) blocks and lists
  the allowlist. After the assistant turn finishes, App scans the response with
  `extractRunnableCommands` (`src/utils/sandboxAgent.ts`), runs them via
  `runSandboxAgentStep` (per-command approval in `automatic`, auto-run in
  `automatic_plus`), seeds the project's files first, then feeds the combined
  stdout/stderr/exit-code back to the AI as a follow-up user turn
  (`[Sandbox execution results — round N]`) by recursively calling
  `handleSendMessage(..., isSandboxFollowup=true)`. The follow-up itself is
  skipped from re-triggering (`!isSandboxFollowup`) and capped at
  `SANDBOX_MAX_FOLLOWUPS` (6) rounds per manual prompt
  (`sandboxFollowupRef`, reset on each real user send). The chat-header Sandbox
  button shows an `AI` badge + pulsing dot when access is on / a command runs.
- **Frontend**: `src/utils/sandboxRunner.ts` wraps the commands;
  `src/components/SandboxPanel.tsx` is the UI (command input, quick commands,
  live log, artifact list with Download via `convertFileSrc`). Toggled from a
  **Sandbox** button in the `ChatWindow` header; docks as a bottom panel.
  `isSandboxAvailable()` checks `__TAURI_INTERNALS__` and degrades gracefully
  (shows a notice) when running as a plain web dev server.
- **Workdir re-sync (Phase 4 fix)**: the persistent shell's CWD is set at session
  creation, but `run_sandbox_command` now re-`cd`s into the requested workdir on
  EVERY run when it differs from the session's current CWD. Without this, a chat
  whose workdir changed after the first command (universal→project, or the agent
  loop seeding into a project subdir) had its shell stuck in the old CWD, so files
  written via `write_sandbox_files` to the new workdir were invisible to
  `python file.py` → "failed". The cd target is the jail-resolved workdir, so it
  can never escape the root.
- **Universal-chat seeding (Phase 4 fix)**: `runSandboxAgentStep` previously
  skipped seeding seedFiles when `workdir` was empty (universal chat, no
  project) because of an `if (workdir && ...)` guard. An empty workdir resolves to
  the sandbox ROOT in Rust, so seeding there is correct — the guard was dropped so
  Python files are now seeded (and `python foo.py` resolves) in universal chats too.
- **Filename derivation (Phase 4 fix)**: when the AI's artifact had no real
  filename, the sandbox seeded it as a generic "python snippet" (no extension),
  so `python main.py` / `python <name>.py` could never find it. Artifacts now
  derive `snippet.<ext>` from the language (py/js/ts/rs/...) and Python artifacts
  always get a `.py` extension, so runs resolve by name.
- **Verifying Rust**: `cargo check` (from `src-tauri/`) needs system deps on
  Linux: `pkg-config libglib2.0-dev libgtk-3-dev libwebkit2gtk-4.1-dev
  libayatana-appindicator3-dev librsvg2-dev libssl-dev`. `src-tauri/gen/` and
  `src-tauri/target/` are gitignored (build output).

## DEBUG Button Behavior (unified)
- **Gray** when no bugs detected (no-op, disabled).
- **Red + pulsing** when a bug is detected; clicking sends the bug text to the
  AI via `onReportBug` so it can auto-fix.
- Bug sources: `analyzeDart` issues (Flutter/Dart), structural checks
  (Swift/Kotlin), runtime `window.onerror`/console capture posted from the
  sandboxed web preview iframe (HTML/TSX/JSX).

## Web Preview (HTML/TSX/JSX/SVG)
- `FileViewerModal` builds a sandboxed iframe (`sandbox="allow-scripts ..."`).
- TSX/JSX are transpiled in-browser (existing logic) before injection.
- TSX/JSX live preview uses `SandpackTsxPreview` (CodeSandbox Sandpack, real
  bundler + npm). It hands Sandpack the `react-ts` template with `/App.tsx`
  overridden by the AI's code. `detectMainComponentName` finds the LAST
  PascalCase component declaration (function/const-arrow/class) and appends a
  correct `export default <Name>` when the AI didn't include one — the old
  `export default App` referenced an undefined `App` whenever the component
  wasn't named App, crashing the Sandpack bundler → blank preview. Container
  has `min-h-[200px]` so Sandpack never collapses to 0 height. CONSOLE button
  toggles the Sandpack console for runtime errors.

## Token accounting (accurate, input + output)
- `Message.inputTokens` / `Message.outputTokens` (new) hold the TRUE token
  spend per turn. The SSE stream parser (`captureUsage` in App.tsx) captures
  the provider's `usage` from the final chunk in all common shapes:
  OpenAI (`prompt_tokens`/`completion_tokens`), Anthropic
  (`input_tokens`/`output_tokens`), Gemini (`usageMetadata.promptTokenCount`/
  `candidatesTokenCount`). When the provider reports usage, those are EXACT.
  When it doesn't, output is counted via `countTokens` (real BPE, o200k_base)
  and input is counted by tokenizing the full system prompt + the conversation
  sent (`fullSystemPrompt` + `cleanApiMessages`). `tokensEstimate` is kept as
  the legacy output-only field for the per-response footer.
- `deriveChatStats` (`src/utils/chatStats.ts`) sums input+output per model and
  exposes `totalInputTokens`/`totalOutputTokens` + per-model
  `inputTokens`/`outputTokens`. Falls back to `tokensEstimate` for old chats.
- The three-dots chat-info drawer (`Sidebar.tsx`) renders total + an input/output
  split card + per-model bars (with a usage-proportion bar). It's a fixed
  right-side drawer (w-420, h-full) over the chat/code area — NOT a tiny sidebar
  dropdown — so it has room to show everything.
- Files-created detection: `deriveChatStats` now also scans message content for
  fenced code blocks with a `// path/file.ext` comment (mirrors the markdown
  renderer's smart-filename logic) as a last resort, so universal chats with no
  projectSnapshotBefore still report the files the AI produced.

## Three-dots chat info (revised)
- The info button is `MoreVertical` (three dots stacked VERTICALLY), not
  `MoreHorizontal`. Clicking opens a fixed right-side drawer (`fixed right-0
  top-0 h-full w-[min(420px,92vw)] z-[61]`) with a backdrop catcher. Shows:
  scope (Universal/Project + name), token spend (total + input/output split +
  per-model breakdown with proportion bars), and files created/edited/added.

## Flutter / DartPad (gist-token embed)
- `src/utils/dartpadEmbed.ts` `buildDartpadEmbedUrl(source, token)` POSTs the
  Dart to `api.github.com/gists` (Bearer token, public gist, `main.dart`) and
  returns `https://dartpad.dev/embed-flutter.html?id=<gistId>&run=true`.
  Cached by an FNV-1a hash of the source (no re-create per keystroke).
- `gistToken` lives in `BYOKSettings` (Settings → Flutter tab), plumbed
  App → FileViewerModal/ArtifactViewer → FlutterPhoneSimulator. NEVER hardcode
  it; the user pastes it once and it persists in Dexie.
- Without a token, the phone bezel shows the structural widget-tree preview
  (`dartWidgetParser`) with a "Add a GitHub gist token in Settings for a live
  DartPad canvas" hint. The Settings UI has a step-by-step "How to get a token"
  guide (GitHub → Settings → Developer settings → PAT classic → gist scope).
- `ensureFlutterApp` wraps a bare Widget in `MaterialApp` before gist/analyze.

## Git / Commits
- Existing git identity is configured; reuse it. Add
  `Co-authored-by: openhands <openhands@all-hands.dev>` to commit messages.
- Previous 5 features (smart filenames, TSX/JSX preview, Swift/Kotlin mobile
  preview, debug button, Save-as-Project) were already committed before this
  Flutter-engine work.

## Multi-feature overhaul (tokens, chat info, MCP bridge, quota fix)
- **Chat input**: the "Upload whole folder" (`FolderUp`) button was removed —
  the paperclip (`Paperclip`) now accepts **any** file type and the existing
  chat-wide drag-drop already handles folders + .zip via `collectDroppedFiles`
  (`src/utils/dropHandler.ts`, entry-API traversal + zip expansion). The "0
  tokens" prompt pill was removed from the input footer; the BPE count in the
  Pure-Context drawer was kept (legitimate info display).
- **Per-response tokens**: `Message.tokensEstimate` is now actually populated
  in `App.tsx` on completion — the success finalize path and the clean-stop
  (transport-close-after-content) path both compute `countTokens(content)`
  once. `MessageItem.tsx` renders `~{tokens} tokens` at the end of each
  assistant response via `useMessageTokenCount` hook (`src/utils/useMessageTokenCount.ts`),
  which prefers `tokensEstimate` and falls back to async BPE counting (seeded
  with an instant heuristic so it never flickers to 0). The memo comparator
  checks `tokensEstimate` so the footer updates when the count is attached in
  the separate post-finalize update.
- **Three-dots chat info** (`Sidebar.tsx`): a `MoreHorizontal` button is a
  SEPARATE hover button on each chat row (Rename + Delete stay as direct
  buttons). Its popover shows: chat scope (Universal Chat vs Project Chat +
  project name), files created/edited/added (from artifacts + project snapshots
  + bound project file list), and token spend (total + per-model breakdown from
  `message.tokensEstimate`). Derived by `src/utils/chatStats.ts` →
  `deriveChatStats(chat, projects)` from existing data (no extra API calls).
- **Quota-error fix (CRITICAL)**: a genuine quota/rate-limit error is now
  recognized ONLY from a REAL HTTP 429 status, carried on `HttpProviderError`
  (`src/App.tsx`). The old loose substring matcher (`err.message.includes('429'
  /'quota'/'rate limit')`) turned benign desktop-webview SSE socket-close
  errors into false "Your model provider reported a quota limit" banners on
  the 2nd/3rd prompt. Both `!response.ok` blocks (send + continue paths) now
  throw `HttpProviderError(message, status)`. The catch classifier:
  - HTTP 401 / clear auth message → API-key config banner.
  - HTTP 429 / explicit `RESOURCE_EXHAUSTED` in a real HTTP response → quota
    banner.
  - Transport error WITH partial content → `isStopped` (continue/retry), NOT a
    hard error and NOT a fake banner.
  - Transport error with NO content → generic "Connection Interrupted" +
    Retry.
  - Stream close after a clean `finish_reason === 'stop'` + content → finalize
    as a successful completion (`cleanStop && existingPartialContent` path).
- **MCP real tool-execution bridge** (`src/utils/mcpExecutor.ts`): MCP is no
  longer prompt-only. `probeMcpServer(server)` does JSON-RPC `ping` + (on
  success) `tools/list` to discover the server's real tools; `callMcpTool(server,
  toolName, args)` does `tools/call` and returns the concatenated result text.
  All requests go through `universalFetch` (works on web + Tauri desktop).
  - **Auto status check**: an `useEffect` in `App.tsx` probes every enabled
    MCP server on load (and when the enabled set changes by id) so their real
    status + discovered tools are known before the first chat. The runtime
    filter `s.enabled && s.status === 'online'` requires `online`, so without
    this probe MCP would silently do nothing even when servers are configured.
  - **Namespacing + native tools**: each tool is sent as `<serverName>/<toolName>`
    (`_namespaced`) in the request body's `tools` array so providers that
    support function-calling invoke them directly; `tool_choice: 'auto'`. The
    system prompt also describes them in text + the `mcp_tool_call` fenced-block
    fallback for providers without function calling.
  - **Tool-call capture + loop**: `accumulateToolCalls` (App.tsx) accumulates
    streamed OpenAI-style `delta.tool_calls` (index-keyed, arguments
    concatenated across deltas). After the assistant turn, the app builds the
    call list from native tool_calls (split on first `/`) PLUS text-parsed
    `parseToolCallsFromText` (`mcp_tool_call`/`<tool_call>` blocks), executes
    each against the named server, and feeds the results back as a follow-up
    user turn `[MCP tool execution results — round N]` via recursive
    `handleSendMessage(..., isMcpToolFollowup=true)`. `mcpFollowupRef` caps at
    `MCP_MAX_TOOL_ROUNDS` (6) per manual prompt; reset on fresh send. The MCP
    follow-up IS allowed to continue the loop (multi-round tool calling);
    sandbox follow-ups are blocked from spawning MCP rounds (`!isSandboxFollowup`).
- **Skills**: `ContextInjector.buildSkillsPromptContext` already injects
  `SKILL.md` + ALL companion files (py/ts/templates) for enabled or
  prompt-triggered skills into the system prompt. Toggle via
  `handleToggleChatSkill` (per-chat `enabledSkillIds`; default =
  `enabledByDefault` skills). No fix needed — verified wiring is intact.
- **AddSkillModal drag-drop**: the drop tile now uses `collectDroppedFiles`
  (was only reading flat `dataTransfer.files`, which misses folder contents —
  browsers expose folder entries via `DataTransferItem.getAsEntry`, not
  `.files`). Each dropped file is tagged with its `webkitRelativePath` so the
  existing read loop picks it up. The files input `accept` was widened to any
  type (was a hardcoded extension allowlist).

## Tauri version alignment (CRITICAL for the "Build Windows App" CI)
- `.github/workflows/main.yml` builds for `x86_64-pc-windows-msvc` on every push
  to `main` via `tauri-apps/tauri-action@v0`. `tauri build` runs a
  version-consistency check and **aborts** if the Rust crate and npm package
  for a Tauri module aren't on the same major.minor.
- The coherent set (must stay matched):
  | Rust crate (Cargo.lock) | npm package (package.json) |
  |---|---|
  | `tauri` 2.11.1 | `@tauri-apps/api` `^2.11.1` |
  | `tauri-plugin-fs` 2.5.1 | `@tauri-apps/plugin-fs` `^2.5.1` |
  | `tauri-plugin-http` 2.5.9 | `@tauri-apps/plugin-http` `^2.5.9` |
- `tauri-plugin-http ^2.5` requires `tauri ^2.10`, so the whole set lives on
  2.10+/2.5.x — do NOT downgrade npm `@tauri-apps/api`/`plugin-fs` back to 2.0.0
  (it's unsatisfiable alongside plugin-http 2.5.x and breaks the build).
- `Cargo.toml` uses caret reqs (`"2"`/`"2.5"`); `Cargo.lock` pins the exact
  versions. **Cargo.lock IS committed** (binary app) so cargo uses the matched
  versions. CI's "Fix Windows Optional Dependencies" step deletes
  `package-lock.json` and reinstalls from ranges — the ranges above each
  resolve to exactly the locked Rust version (each is the current latest in its
  minor line), so the match survives a lockfile-less reinstall.
- If CI ever fails with "Found version mismatched Tauri packages", re-align by
  pinning Cargo.lock to the npm-resolved version (or vice-versa) and confirm
  `cargo check` + `npx tsc --noEmit` + `npm run build` before pushing.

## Vite Config
- `vite.config.ts`: manual vendor chunks (react, markdown/katex, tauri,
  data/dexie+jszip+motion+lucide). HMR disabled when `DISABLE_HMR=true`.
- `chunkSizeWarningLimit: 1100` (app chunk is large by design).
