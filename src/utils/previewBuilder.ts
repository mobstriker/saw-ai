/**
 * Shared sandboxed-preview HTML builders for the ArtifactViewer and
 * FileViewerModal. Keeping this in one place guarantees the web (HTML/SVG)
 * and React (TSX/JSX/JS) preview pipelines behave identically in both the
 * right-panel artifact sandbox and the full-screen file viewer modal.
 *
 * The React path uses Babel standalone with the `react,typescript` presets so
 * TSX/TS type annotations are stripped before evaluation. Runtime errors are
 * posted back to the parent window via `postMessage` so the host UI can light
 * up the debug button (Feature 3).
 */

export interface PreviewErrorReport {
  source: 'web-preview';
  message: string;
  filename: string;
}

export function isPreviewErrorReport(data: unknown): data is PreviewErrorReport {
  return (
    typeof data === 'object' &&
    data !== null &&
    (data as any).source === 'web-preview' &&
    typeof (data as any).message === 'string'
  );
}

const REACT_BOOTSTRAP = `
  window.addEventListener('error', function (ev) {
    try {
      window.parent.postMessage({ source: 'web-preview', message: String(ev.message || ev.error || 'Unknown runtime error'), filename: __FILE_NAME__ }, '*');
    } catch (e) {}
  });
  window.addEventListener('unhandledrejection', function (ev) {
    try {
      var reason = ev.reason && ev.reason.message ? ev.reason.message : String(ev.reason || 'Unhandled promise rejection');
      window.parent.postMessage({ source: 'web-preview', message: reason, filename: __FILE_NAME__ }, '*');
    } catch (e) {}
  });
`;

export function buildHtmlPreview(code: string, filename: string): string {
  const bootstrap = REACT_BOOTSTRAP.replace(/__FILE_NAME__/g, JSON.stringify(filename));
  if (!code.includes('<html') && !code.includes('<!DOCTYPE')) {
    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8"/>
  <meta name="viewport" content="width=device-width, initial-scale=1.0"/>
  <script src="https://cdn.jsdelivr.net/npm/@tailwindcss/browser@4"></script>
  <link href="https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;500;600;700;800&family=Playfair+Display:wght@600;700&display=swap" rel="stylesheet">
  <style>
    body { font-family: 'Plus Jakarta Sans', system-ui, sans-serif; background-color: #FAF8F5; color: #2C2825; padding: 20px; margin: 0; min-height: 100vh; }
  </style>
</head>
<body>
  ${code}
  <script>${bootstrap}</script>
</body>
</html>`;
  }
  // The page already declares its own document — inject the error bootstrap
  // just before </body> (or at the end if no body tag).
  if (/<\/body>/i.test(code)) {
    return code.replace(/<\/body>/i, `<script>${bootstrap}</script></body>`);
  }
  return `${code}<script>${bootstrap}</script>`;
}

export function buildSvgPreview(code: string, filename: string): string {
  const bootstrap = REACT_BOOTSTRAP.replace(/__FILE_NAME__/g, JSON.stringify(filename));
  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8"/>
  <style>
    body { margin: 0; display: flex; align-items: center; justify-content: center; min-height: 100vh; background: #FAF8F5; }
    svg { max-width: 90%; max-height: 90vh; }
  </style>
</head>
<body>
  ${code}
  <script>${bootstrap}</script>
</body>
</html>`;
}

/**
 * Builds a sandboxed HTML document that evaluates React/TSX/JSX/JS via Babel
 * standalone with TypeScript support. Resolves the component to render from
 * `export default`, a named `App`, or the first capitalized identifier declared.
 */
export function buildReactPreview(code: string, filename: string): string {
  const bootstrap = REACT_BOOTSTRAP.replace(/__FILE_NAME__/g, JSON.stringify(filename));
  // Strip ES module import/export keywords so Babel can evaluate the code as a
  // plain script. We keep the declared identifiers in scope.
  const stripped = code
    .replace(/import\s+[^;]+;/g, '')
    .replace(/export\s+default\s+/g, 'var __default_export = ')
    .replace(/export\s+/g, '');

  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8"/>
  <meta name="viewport" content="width=device-width, initial-scale=1.0"/>
  <script src="https://cdn.jsdelivr.net/npm/@tailwindcss/browser@4"></script>
  <link href="https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;500;600;700;800&display=swap" rel="stylesheet">
  <script src="https://unpkg.com/react@18/umd/react.development.js"></script>
  <script src="https://unpkg.com/react-dom@18/umd/react-dom.development.js"></script>
  <script src="https://unpkg.com/@babel/standalone/babel.min.js"></script>
  <style>
    body { font-family: 'Plus Jakarta Sans', system-ui, sans-serif; background-color: #FAF8F5; color: #2C2825; margin: 0; padding: 20px; min-height: 100vh; }
  </style>
</head>
<body>
  <div id="root"></div>
  <script type="text/babel" data-presets="react,typescript">
    try {
      var MockLucide = new Proxy({}, {
        get: function (_t, prop) {
          return function (props) {
            props = props || {};
            return React.createElement('span', {
              style: { display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: props.size || 16, height: props.size || 16 },
              ...props
            }, '\\u2726');
          };
        }
      });
      window.lucideReact = MockLucide;
      try { window['lucide-react'] = MockLucide; } catch (e) {}

      ${stripped}

      var componentToRender =
        (typeof __default_export !== 'undefined') ? __default_export :
        (typeof App !== 'undefined') ? App :
        (typeof Component !== 'undefined') ? Component :
        null;

      if (!componentToRender) {
        // Fall back to the first declared capitalized identifier we can find.
        var declMatch = /(?:const|let|var|function)\\s+([A-Z][A-Za-z0-9_]*)/.exec(${JSON.stringify(stripped)});
        if (declMatch && typeof window[declMatch[1]] !== 'undefined') {
          componentToRender = window[declMatch[1]];
        }
      }

      if (componentToRender) {
        ReactDOM.createRoot(document.getElementById('root')).render(React.createElement(componentToRender));
      } else {
        document.getElementById('root').innerHTML = '<div style="padding: 20px; background: white; border-radius: 12px; border: 1px solid #E6DFD3;"><h3 style="margin: 0 0 8px 0; color: #C58B51; font-weight: bold;">Interactive Sandbox Ready</h3><p style="margin: 0; font-size: 13px; color: #7C756E;">React code evaluated. No renderable component found — switch to Code tab for full inspection.</p></div>';
      }
    } catch (e) {
      document.getElementById('root').innerHTML = '<div style="padding: 16px; background: #FFF5F5; border-radius: 12px; border: 1px solid #FED7D7; color: #C53030; font-size: 12px; font-family: monospace;"><strong>Preview Sandbox Notice:</strong> ' + (e && e.message ? e.message : String(e)) + '</div>';
      try { window.parent.postMessage({ source: 'web-preview', message: (e && e.message ? e.message : String(e)), filename: ${JSON.stringify(filename)} }, '*'); } catch (pe) {}
    }
    ${bootstrap}
  </script>
</body>
</html>`;
}
