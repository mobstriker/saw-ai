/**
 * Live TSX/JSX preview via CodeSandbox Sandpack.
 *
 * WHY THIS EXISTS
 * ---------------
 * The previous TSX preview path (`previewBuilder.buildReactPreview`) strips
 * `import`/`export` keywords and evaluates the code with in-browser Babel
 * against UMD React. That breaks the moment the AI emits a real import
 * (`import { useState } from 'react'`, `import { motion } from 'framer-motion'`,
 * `import { Button } from './Button'`, etc.) — which is exactly the "TSX does
 * not work" complaint. Sandpack actually compiles the TSX with a real bundler
 * (esbuild/wasm inside the sandboxed iframe), resolves npm imports from the
 * CodeSandbox registry, and supports live HMR — so multi-file React works.
 *
 * HOW IT WORKS
 * ------------
 * We hand Sandpack a `react-ts` template and override `/App.tsx` with the
 * AI's code. We also scan the code for third-party `import … from 'pkg'`
 * statements and add each as a dependency (latest version) via
 * `customSetup.dependencies`. Local relative imports (`./Foo`) are kept as-is
 * and, if the referenced file isn't present, Sandpack will show a friendly
 * "module not found" error in its console rather than silently failing.
 *
 * Only the preview is rendered (`SandpackPreview`); the code editor is hidden
 * because the user already has the source in the Artifact/Code tab.
 */
import React, { useMemo, useState } from 'react';
import {
  SandpackProvider,
  SandpackLayout,
  SandpackPreview,
  SandpackConsole,
} from '@codesandbox/sandpack-react';
// Note: Sandpack v2 uses Stitches (CSS-in-JS) and injects its own styles at
// runtime, so there is no external CSS to import (the old
// `dist/index.css` import from v1 is gone).

interface SandpackTsxPreviewProps {
  code: string;
  filename?: string;
}

// React-friendly dep names that should always be present (template provides
// react/react-dom). We only add *extra* third-party deps detected in code.
const ALWAYS_SKIP = new Set([
  'react',
  'react-dom',
  'react/jsx-runtime',
  'react-dom/client',
]);

/** Pull `import … from 'pkg'` / `import 'pkg'` specifiers from TSX/JSX source.
 *  Returns the set of bare module names (strips subpath after first '/'). */
function detectDeps(code: string): string[] {
  const deps = new Set<string>();
  const importRe =
    /(?:^|[\s;])import\s+(?:[^'";]+?\s+from\s+)?['"]([^'"]+)['"]/g;
  let m: RegExpExecArray | null;
  while ((m = importRe.exec(code)) !== null) {
    const spec = m[1];
    if (!spec || spec.startsWith('.') || spec.startsWith('/')) continue; // local
    const bare = spec.startsWith('@')
      ? spec.split('/').slice(0, 2).join('/')
      : spec.split('/')[0];
    if (!ALWAYS_SKIP.has(bare)) deps.add(bare);
  }
  return Array.from(deps);
}

const SANDBOX_STYLE: React.CSSProperties = {
  height: '100%',
  width: '100%',
  border: '0',
  borderRadius: 0,
};

export const SandpackTsxPreview: React.FC<SandpackTsxPreviewProps> = ({
  code,
  filename,
}) => {
  const [showConsole, setShowConsole] = useState(false);

  const files = useMemo(() => {
    // Use the AI's filename if it ends in .tsx/.jsx, else default to App.tsx.
    const lower = (filename || '').toLowerCase();
    const isAppTsx = lower.endsWith('app.tsx') || lower.endsWith('app.jsx');
    const appPath = isAppTsx && filename && filename.startsWith('/')
      ? filename
      : '/App.tsx';
    // Ensure a default export exists so the template's index.tsx can render it.
    const hasDefaultExport = /export\s+default\s+/.test(code);
    const source = hasDefaultExport
      ? code
      : `${code}\nexport default App;\n`;
    return {
      [appPath]: { code: source, active: true, hidden: false },
    } as Record<string, { code: string; active?: boolean; hidden?: boolean }>;
  }, [code, filename]);

  const dependencies = useMemo(() => {
    const deps = detectDeps(code);
    // Pin to "latest" so Sandpack fetches the newest matching version from the
    // CodeSandbox registry; the bundler resolves a concrete version at runtime.
    const obj: Record<string, string> = {};
    deps.forEach((d) => {
      obj[d] = 'latest';
    });
    return obj;
  }, [code]);

  return (
    <div className="w-full h-full flex flex-col bg-white">
      <div className="flex items-center justify-end gap-1 px-2 py-1 border-b border-[#E6DFD3] bg-[#FAF8F5]">
        <button
          type="button"
          onClick={() => setShowConsole((v) => !v)}
          className={`px-2 py-0.5 rounded-md text-[10px] font-bold border transition-all cursor-pointer ${
            showConsole
              ? 'bg-[#C58B51] text-white border-[#C58B51]'
              : 'bg-white text-[#7C756E] border-[#E6DFD3] hover:border-[#C58B51]'
          }`}
          title="Toggle the Sandpack console (shows runtime logs/errors)"
        >
          CONSOLE
        </button>
      </div>
      <div className="flex-1 overflow-hidden">
        <SandpackProvider
          template="react-ts"
          files={files}
          customSetup={{ dependencies }}
          options={{
            recompileMode: 'delayed',
            recompileDelay: 300,
            classes: { 'sp-wrapper': 'saw-sandpack' },
          }}
          style={SANDBOX_STYLE}
        >
          <SandpackLayout style={{ height: '100%', minHeight: 0, border: 0, borderRadius: 0 }}>
            <SandpackPreview
              showOpenInCodeSandbox={true}
              showRefreshButton={true}
              style={{ height: '100%', flex: 1 }}
            />
            {showConsole && (
              <SandpackConsole
                style={{ height: '100%', flex: 1, maxWidth: '50%' }}
              />
            )}
          </SandpackLayout>
        </SandpackProvider>
      </div>
    </div>
  );
};
