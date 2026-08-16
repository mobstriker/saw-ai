/**
 * Real Flutter/Dart preview engine via Google's public, free dart-services
 * backend (the same backend that powers dartpad.dev).
 *
 * Why this exists:
 *   A tolerant Dart-source parser can only approximate a Flutter UI. To show
 *   the *actual* app the AI wrote, we compile & run the real Flutter Web engine.
 *   dartpad.dev exposes a public, CORS-enabled API (`stable.api.dartpad.dev`)
 *   and an embeddable iframe (`dartpad.dev/?embed=true`) that compiles injected
 *   Dart to JS and renders the real Flutter canvas — for free, with no
 *   subscription and no bundled runtime weight added to this app.
 *
 * Two pieces:
 *   1. analyzeDart()   — POST /api/v3/analyze → real compile errors, used to
 *                        drive the DEBUG button red/gray and to report bugs.
 *   2. DARTPAD_EMBED   — the canonical DartPad SPA embed iframe. It posts a
 *                        `ready` message once its workspace listener is up, at
 *                        which point we postMessage the source for it to
 *                        compile & render the real Flutter canvas.
 */

const DARTPAD_API = 'https://stable.api.dartpad.dev/api/v3';

/**
 * Embed iframe URL.
 *
 * IMPORTANT: this must point at `preview.dartpad.dev`, NOT `dartpad.dev`.
 *
 * `preview.dartpad.dev` is the host that serves the DartPad SPA *with the embed
 * message handler registered* (see dart-lang/dart-pad
 * `pkgs/dartpad_ui/lib/app/embed/web.dart`). On load it posts `{type:'ready'}`
 * to the parent and listens for `{type:'sourceCode', sourceCode}` postMessages,
 * then compiles & renders the real Flutter canvas when `run=true`.
 *
 * `dartpad.dev` is the marketing/landing host — its bundle does NOT register
 * the embed handler, so injected source is silently ignored and the iframe
 * stays on its default sample → the cropped view shows a permanent black
 * screen. That mismatch is the root cause of the "Flutter preview never pops
 * up" bug. The official embed demo (dart-pad `web/embed_demo.html`) and the
 * embed handler source both confirm `preview.dartpad.dev` is the correct host.
 */
export const DARTPAD_EMBED_URL =
  'https://preview.dartpad.dev?embed=true&theme=dark&run=true';

export interface DartAnalysisIssue {
  kind: string; // 'error' | 'warning' | 'info'
  message: string;
  line?: number;
  column?: number;
  code?: string;
}

export interface DartAnalysisResult {
  issues: DartAnalysisIssue[];
  errors: DartAnalysisIssue[]; // subset where kind === 'error'
  ok: boolean; // true when no errors (warnings/info allowed)
}

/**
 * Ask the dart-services analyzer to check the Dart source for compile errors.
 * This is the authoritative "does this code run?" check that drives the DEBUG
 * button. CORS is wide open (`access-control-allow-origin: *`), so this works
 * directly from the browser.
 */
export async function analyzeDart(source: string): Promise<DartAnalysisResult> {
  try {
    const res = await fetch(`${DARTPAD_API}/analyze`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ source }),
    });
    if (!res.ok) {
      return { issues: [], errors: [], ok: true }; // fail-open; let embed try
    }
    const data = await res.json();
    const issues: DartAnalysisIssue[] = (data?.issues || []).map(
      (i: { kind?: string; message?: string; location?: { line?: number; column?: number }; code?: string }) => ({
        kind: i.kind || 'error',
        message: i.message || 'Unknown issue',
        line: i.location?.line,
        column: i.location?.column,
        code: i.code,
      })
    );
    const errors = issues.filter((i) => i.kind === 'error');
    return { issues, errors, ok: errors.length === 0 };
  } catch {
    // Network/CORS failure — fail open so the embed iframe still attempts a run.
    return { issues: [], errors: [], ok: true };
  }
}

/**
 * Many AI-generated Dart snippets contain only a Widget class without a
 * `void main()` entrypoint. DartPad requires a main() to run, so we wrap bare
 * widget code: detect the first `class X extends StatelessWidget|StatefulWidget`
 * and synthesize a `runApp(X())` main. If main already exists, return as-is.
 */
export function ensureFlutterApp(source: string): string {
  const hasMain = /\bvoid\s+main\s*\(/.test(source) || /\bmain\s*\(\s*\)\s*(?:async\s*)?=>/.test(source);
  if (hasMain) return source;

  const hasFlutterImport = /import\s+['"]package:flutter\/material\.dart['"]/.test(source);
  const importLine = hasFlutterImport ? '' : "import 'package:flutter/material.dart';\n\n";

  // Find the first Widget class name.
  const classMatch = source.match(/class\s+([A-Z][A-Za-z0-9_]*)\s+extends\s+(?:StatelessWidget|StatefulWidget)/);
  if (classMatch) {
    const widgetName = classMatch[1];
    return `${importLine}${source}\n\nvoid main() => runApp(const ${widgetName}());\n`;
  }

  // No widget class found — still wrap with a generic placeholder runner so
  // DartPad at least compiles and the analyzer reports the real errors.
  return `${importLine}${source}\n\nvoid main() => runApp(const MaterialApp(home: Scaffold(body: Center(child: Text('Awaiting a Widget to render')))));\n`;
}

/**
 * Wait for the DartPad embed iframe to signal `ready` (or request source),
 * then inject the source code so it compiles & runs. Resolves true once the
 * source has been delivered; resolves false on timeout if the iframe never
 * became available.
 *
 * Robustness: the DartPad SPA initializes its workspace asynchronously and
 * may register the `sourceCode` message listener late, or (when sandboxed)
 * may never post `ready` to a cross-origin parent. To compensate we:
 *   - listen for BOTH `ready` and `requestSource` (the SPA requests source
 *     on demand after its workspace boots) and push on either signal;
 *   - retry the `sourceCode` post every ~2s over the timeout window so a
 *     late-attaching listener still receives it.
 * DartPad handles `sourceCode` any time after its listener is attached, so a
 * later retry lands even if the very first post arrived too early.
 */
export function injectSourceIntoDartPad(
  iframe: HTMLIFrameElement | null,
  source: string,
  timeoutMs = 25000
): Promise<boolean> {
  return new Promise((resolve) => {
    if (!iframe || !iframe.contentWindow) {
      resolve(false);
      return;
    }
    const target = iframe.contentWindow;
    let settled = false;
    let delivered = false;
    const finish = (ok: boolean) => {
      if (settled) return;
      settled = true;
      window.removeEventListener('message', onMessage);
      clearInterval(retryInterval);
      clearTimeout(timer);
      resolve(ok);
    };
    const deliver = () => {
      if (delivered) return;
      try {
        target.postMessage({ type: 'sourceCode', sourceCode: source }, '*');
        delivered = true;
      } catch {
        /* iframe may have navigated; retry loop will try again */
      }
    };
    const onMessage = (e: MessageEvent) => {
      // DartPad posts {type:'ready'} or {type:'requestSource'} from the iframe.
      if (e.source !== target) return;
      const t = e.data && e.data.type;
      if (t === 'ready' || t === 'requestSource') {
        deliver();
        // After ready, give it a beat then resolve optimistically.
        if (t === 'ready') setTimeout(() => finish(true), 300);
      }
    };
    window.addEventListener('message', onMessage);

    // Retry the sourceCode post every ~2s so a late-attaching listener still
    // receives it (resets `delivered` so we keep trying until it sticks).
    const retryInterval = setInterval(() => {
      if (settled) return;
      delivered = false; // allow re-delivery on each retry
      deliver();
    }, 2000);
    // First immediate attempt.
    deliver();

    const timer = setTimeout(() => {
      // If we never saw ready/requestSource but the iframe is still present,
      // optimistically treat the injected retries as successful — DartPad will
      // compile whenever its listener attaches. Only fail if the iframe is
      // genuinely unavailable.
      finish(!!iframe.contentWindow);
    }, timeoutMs);
  });
}
