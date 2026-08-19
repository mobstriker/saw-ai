/**
 * Real Dart analysis + a robust Flutter preview.
 *
 * What this module provides:
 *   1. analyzeDart() — POST /api/v3/analyze → real compile errors from the
 *      dart-services backend (stable.api.dartpad.dev). CORS is wide open. This
 *      is the authoritative "does this code run?" check that drives the DEBUG
 *      button red/gray and reports bugs to the AI.
 *   2. ensureFlutterApp() — wraps a bare Widget in a MaterialApp+main() so the
 *      analyzer can evaluate it (and so any future real-engine path can run it).
 *
 * What this module NO LONGER does, and why:
 *   It previously embedded the DartPad SPA (`preview.dartpad.dev?embed=true`)
 *   in an iframe, injected source via `postMessage({type:'sourceCode',...})`,
 *   and CSS-cropped the iframe to show only the Flutter canvas. That approach
 *   broke: DartPad migrated its embed to a new Jaspr SPA that (a) renders the
 *   full IDE (file tree + code editor with the default sample) instead of a
 *   canvas-only embed, and (b) no longer honors the `sourceCode` postMessage
 *   — injected source is ignored and the editor keeps the default CounterApp.
 *   The CSS-crop then showed the *code editor* inside the phone bezel ("code
 *   inside the phone preview for a few seconds") and, because no real render
 *   happened, the 18s fallback fired with a misleading "Flutter engine
 *   unavailable" message. (Verified empirically: all embed-*.html hosts now
 *   serve the identical 1107-byte Jaspr SPA, and a live postMessage test left
 *   the editor on the default sample.)
 *
 *   Replicating the DDC runtime ourselves (compileDDC + dart_sdk.js + flutter_web
 *   + require.js loader) was evaluated and rejected: the SDK/runtime modules
 *   are loaded from DartPad's own deferred SPA chunks with no stable public URL,
 *   making a self-hosted runner fragile and version-coupled.
 *
 *   The Flutter preview therefore renders a faithful structural approximation of
 *   the Dart widget tree (dartWidgetParser) directly in the phone screen — no
 *   iframe, no editor chrome, no crop, no false "engine unavailable" banner.
 *   The real dart-services analyzer still powers the DEBUG button with genuine
 *   compile errors, so the user gets accurate bug detection and a clean preview.
 */

const DARTPAD_API = 'https://stable.api.dartpad.dev/api/v3';

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
 *
 * Every MaterialApp also gets `debugShowCheckedModeBanner: false` injected
 * (unless the source already sets it) so the REAL Flutter canvas never shows
 * Flutter's own red diagonal "DEBUG" ribbon — the app has its own DEBUG bug
 * button, and the ribbon only covers the top-right of the phone screen.
 */
export function ensureFlutterApp(source: string): string {
  const withBannerOff = hideDebugBanner(source);
  const hasMain = /\bvoid\s+main\s*\(/.test(withBannerOff) || /\bmain\s*\(\s*\)\s*(?:async\s*)?=>/.test(withBannerOff);
  if (hasMain) return withBannerOff;

  const hasFlutterImport = /import\s+['"]package:flutter\/material\.dart['"]/.test(withBannerOff);
  const importLine = hasFlutterImport ? '' : "import 'package:flutter/material.dart';\n\n";

  // Find the first Widget class name.
  const classMatch = withBannerOff.match(/class\s+([A-Z][A-Za-z0-9_]*)\s+extends\s+(?:StatelessWidget|StatefulWidget)/);
  if (classMatch) {
    const widgetName = classMatch[1];
    return `${importLine}${withBannerOff}\n\nvoid main() => runApp(const ${widgetName}());\n`;
  }

  // No widget class found — still wrap with a generic placeholder runner so
  // DartPad at least compiles and the analyzer reports the real errors.
  return `${importLine}${withBannerOff}\n\nvoid main() => runApp(const MaterialApp(debugShowCheckedModeBanner: false, home: Scaffold(body: Center(child: Text('Awaiting a Widget to render')))));\n`;
}

/**
 * Inject `debugShowCheckedModeBanner: false` into the first MaterialApp /
 * MaterialApp.router constructor when the source doesn't set the flag itself.
 * This kills Flutter's red DEBUG ribbon on the live DartPad canvas (and in
 * any real `flutter run` of the pasted code).
 */
function hideDebugBanner(source: string): string {
  if (/debugShowCheckedModeBanner\s*:/.test(source)) return source;
  return source.replace(
    /MaterialApp(\.router)?(\s*)\(/,
    'MaterialApp$1$2(debugShowCheckedModeBanner: false, '
  );
}
