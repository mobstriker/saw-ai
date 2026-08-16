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

## Flutter / Dart Preview (real engine)
- Uses Google's public **dart-services** API at `https://stable.api.dartpad.dev`
  (CORS `*`, free, no subscription, no API key). Flutter 3.47 / Dart 3.13.
- `analyzeDart(source)` → POST `/api/v3/analyze` → `{issues:[...]}`. Used to
  drive the DEBUG button (red when issues.length > 0).
- `compileDDC(source)` → POST `/api/v3/compileDDC` → `{result: JS module}`.
- Live render: embeds `https://preview.dartpad.dev?embed=true&theme=dark&run=true`
  in an iframe, injects source via
  `postMessage({type:'sourceCode', sourceCode})`. The DartPad SPA initializes its
  listener late, so `injectSourceIntoDartPad` **retries** the post every 2s over
  a 20s window (not just once on `ready`).
- **CRITICAL — embed host must be `preview.dartpad.dev`, NOT `dartpad.dev`.**
  `preview.dartpad.dev` serves the DartPad SPA *with the embed message handler
  registered* (dart-lang/dart-pad `pkgs/dartpad_ui/lib/app/embed/web.dart`): on
  load it posts `{type:'ready'}` and listens for `{type:'sourceCode',...}`, then
  compiles & renders the real Flutter canvas when `run=true`. `dartpad.dev` is
  the marketing host whose bundle does NOT register the embed handler, so
  injected source is silently ignored and the cropped iframe stays permanently
  BLACK — this was the root cause of the "Flutter preview never pops up" bug.
  The official embed demo (`dart-pad/web/embed_demo.html`) + handler source
  confirm `preview.dartpad.dev` is the correct host.
- `FlutterPhoneSimulator` also listens for `{type:'ready'|'requestSource'|
  'stdout'|'stderr'}` messages from the iframe to confirm the engine is alive
  (`renderConfirmed`). If no such message arrives within 18s of `running`, it
  falls back to the structural Dart approximation so the user always sees
  *something* render instead of a permanent black screen.
- `ensureFlutterApp(source)` wraps a bare Widget in a `MaterialApp` so DartPad
  can compile & render it.
- **Sandbox limitation**: in this runtime's headless browser, DartPad's editor
  loads but the live canvas can't be visually verified; the analyze API **does**
  work (verified: returns real compile errors). In a real user browser DartPad
  loads normally and the Flutter app renders in the cropped frame portion.

## Restore Button (per-response undo)
- `Message.projectSnapshotBefore?: {projectId: string|null; files: ProjectFile[]}`
  captures the bound project's files *before* this assistant turn's changes were
  applied by `WorkspaceAutopilot` (captured in `handleSendMessage`, attached to
  the assistant message only when `didModifyProject` is true).
- `MessageItem` renders a **Restore** button (next to Retry/Copy, after Continue
  — Continue is intentionally never touched) only when `projectSnapshotBefore`
  exists and not currently generating. `handleRestore(messageId)` rolls the
  project files back to the snapshot; when `projectId===null` (a universal chat
  that auto-created its first project) it removes the created project.
- `restoredAt` timestamp flips the button to a green "Restored" badge and allows
  re-restoring. The memo comparator in `MessageItem` checks
  `Boolean(projectSnapshotBefore)` and `restoredAt` so the button
  appears/updates correctly (the snapshot is attached in a separate update
  after the message is finalized).
- Works in both universal chats and project-bound chats (single `ChatWindow`
  render path in `App.tsx`).

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
- **Frontend**: `src/utils/sandboxRunner.ts` wraps the commands;
  `src/components/SandboxPanel.tsx` is the UI (command input, quick commands,
  live log, artifact list with Download via `convertFileSrc`). Toggled from a
  **Sandbox** button in the `ChatWindow` header; docks as a bottom panel.
  `isSandboxAvailable()` checks `__TAURI_INTERNALS__` and degrades gracefully
  (shows a notice) when running as a plain web dev server.
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

## Git / Commits
- Existing git identity is configured; reuse it. Add
  `Co-authored-by: openhands <openhands@all-hands.dev>` to commit messages.
- Previous 5 features (smart filenames, TSX/JSX preview, Swift/Kotlin mobile
  preview, debug button, Save-as-Project) were already committed before this
  Flutter-engine work.

## Vite Config
- `vite.config.ts`: manual vendor chunks (react, markdown/katex, tauri,
  data/dexie+jszip+motion+lucide). HMR disabled when `DISABLE_HMR=true`.
- `chunkSizeWarningLimit: 1100` (app chunk is large by design).
