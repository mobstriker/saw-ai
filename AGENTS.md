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
- Live render: embeds `https://preview.dartpad.dev/?embed=true` in an iframe,
  injects source via `postMessage({type:'sourceCode', sourceCode})`. The new
  DartPad SPA initializes its listener late, so `injectSourceIntoDartPad`
  **retries** the post every 2s over a 20s window (not just once on `ready`).
- `ensureFlutterApp(source)` wraps a bare Widget in a `MaterialApp` so DartPad
  can compile & render it.
- **Sandbox limitation**: in this runtime's headless browser, DartPad's
  frontend workspace gets stuck at "Loading Workspace…" (its frontend can't
  fully init), so the live canvas can't be visually verified here. The analyze
  API **does** work from the browser (verified: returns real compile errors).
  In a real user browser DartPad loads normally.

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
