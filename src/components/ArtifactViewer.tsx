import React, { useState, useEffect, useRef } from 'react';
import {
  X,
  Copy,
  Check,
  Download,
  RotateCw,
  Sparkles,
  Code2,
  Eye,
  Maximize2,
  ExternalLink,
  ChevronLeft,
  ChevronRight,
  Smartphone,
  Monitor,
  Tablet,
  Globe,
  Flame,
} from 'lucide-react';
import { Artifact } from '../types';
import { FlutterPhoneSimulator } from './FlutterPhoneSimulator';

interface ArtifactViewerProps {
  artifact: Artifact | null;
  allArtifacts?: Artifact[];
  onClose: () => void;
  onSelectArtifact?: (artifact: Artifact) => void;
}

type ViewportMode = 'responsive' | 'desktop' | 'tablet' | 'mobile';

export const ArtifactViewer: React.FC<ArtifactViewerProps> = ({
  artifact,
  allArtifacts = [],
  onClose,
  onSelectArtifact,
}) => {
  const [activeTab, setActiveTab] = useState<'preview' | 'code'>('preview');
  const [viewportMode, setViewportMode] = useState<ViewportMode>('responsive');
  const [copied, setCopied] = useState(false);
  const [key, setKey] = useState(0); // for reload iframe
  const iframeRef = useRef<HTMLIFrameElement | null>(null);

  const isFlutterOrDart =
    artifact?.language.toLowerCase() === 'dart' ||
    artifact?.language.toLowerCase() === 'flutter' ||
    artifact?.code.includes('package:flutter') ||
    artifact?.code.includes('StatelessWidget') ||
    artifact?.code.includes('StatefulWidget') ||
    artifact?.code.includes('MaterialApp') ||
    artifact?.title.endsWith('.dart');

  const isPreviewableWeb =
    ['html', 'htm', 'svg', 'tsx', 'jsx'].includes(artifact?.language.toLowerCase() || '') ||
    artifact?.title.endsWith('.html') ||
    artifact?.title.endsWith('.htm') ||
    artifact?.title.endsWith('.svg') ||
    artifact?.title.endsWith('.tsx') ||
    artifact?.title.endsWith('.jsx');

  const hasPreview = isFlutterOrDart || isPreviewableWeb;

  // Auto-switch to preview for HTML/SVG/TSX/Flutter, or code for others (Python, JSON, SQL, etc.)
  useEffect(() => {
    if (artifact) {
      if (hasPreview) {
        setActiveTab('preview');
      } else {
        setActiveTab('code');
      }
    }
  }, [artifact?.id, hasPreview]);

  if (!artifact) {
    return (
      <div className="flex flex-col items-center justify-center h-full p-8 text-center bg-white font-sans text-[#7C756E]">
        <div className="w-12 h-12 rounded-2xl bg-[#FAF8F5] border border-[#E6DFD3] flex items-center justify-center text-[#C58B51] mb-3">
          <Sparkles size={22} />
        </div>
        <h4 className="text-sm font-bold text-[#2C2825] mb-1">No Active Artifact</h4>
        <p className="text-xs text-[#7C756E] max-w-xs leading-relaxed">
          When the AI generates code (HTML pages, Flutter apps, React components, SVGs), click &quot;View Artifact&quot; to preview it live.
        </p>
      </div>
    );
  }

  const handleCopy = () => {
    navigator.clipboard.writeText(artifact.code);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleDownload = () => {
    const blob = new Blob([artifact.code], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = artifact.title || `artifact.${artifact.language}`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleOpenNewTab = () => {
    const blob = new Blob([generatePreviewHtml()], { type: 'text/html;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    window.open(url, '_blank');
  };

  // Build sandboxed HTML for the iframe preview
  const generatePreviewHtml = (): string => {
    const lang = artifact.language.toLowerCase();
    const code = artifact.code;

    if (lang === 'html' || artifact.title.endsWith('.html')) {
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
</body>
</html>`;
      }
      return code;
    }

    if (lang === 'svg' || artifact.title.endsWith('.svg')) {
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
</body>
</html>`;
    }

    // For TSX / JSX / React or JS
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
  <script src="https://unpkg.com/lucide@latest"></script>
  <style>
    body { font-family: 'Plus Jakarta Sans', system-ui, sans-serif; background-color: #FAF8F5; color: #2C2825; margin: 0; padding: 20px; min-height: 100vh; }
  </style>
</head>
<body>
  <div id="root"></div>
  <script type="text/babel">
    try {
      const MockLucide = new Proxy({}, {
        get: (target, prop) => {
          return (props) => (
            <span style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: props.size || 16, height: props.size || 16, ...props.style }}>
              ✦
            </span>
          );
        }
      });
      window.lucideReact = MockLucide;

      ${code.replace(/import\s+.*?;/g, '')}

      const componentToRender = typeof App !== 'undefined' ? App : 
                                typeof FintechNavbar !== 'undefined' ? FintechNavbar :
                                typeof Component !== 'undefined' ? Component :
                                null;

      if (componentToRender) {
        ReactDOM.createRoot(document.getElementById('root')).render(React.createElement(componentToRender));
      } else {
        document.getElementById('root').innerHTML = '<div style="padding: 20px; background: white; border-radius: 12px; border: 1px solid #E6DFD3;"><h3 style="margin: 0 0 8px 0; color: #C58B51; font-weight: bold;">Interactive Sandbox Ready</h3><p style="margin: 0; font-size: 13px; color: #7C756E;">React code evaluated. Switch to Code tab for full inspection.</p></div>';
      }
    } catch (e) {
      document.getElementById('root').innerHTML = '<div style="padding: 16px; background: #FFF5F5; border-radius: 12px; border: 1px solid #FED7D7; color: #C53030; font-size: 12px; font-family: monospace;"><strong>Preview Sandbox Notice:</strong> ' + e.message + '</div>';
    }
  </script>
</body>
</html>`;
  };

  const currentIndex = allArtifacts.findIndex((a) => a.id === artifact.id);
  const lines = artifact.code.split('\n');

  return (
    <div className="flex flex-col h-full bg-white font-sans text-[#2C2825] overflow-hidden">
      {/* Top Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-[#E6DFD3] bg-[#FAF8F5]">
        <div className="flex items-center gap-2.5">
          <div className="w-8 h-8 rounded-xl bg-white border border-[#E6DFD3] flex items-center justify-center text-[#C58B51] shadow-2xs">
            {isFlutterOrDart ? <Flame size={16} className="text-[#C58B51]" /> : <Sparkles size={16} />}
          </div>
          <div>
            <h3 className="text-xs font-bold text-[#2C2825] truncate max-w-[150px]">
              {artifact.title}
            </h3>
            <span className="text-[10px] font-mono text-[#7C756E] uppercase">
              {isFlutterOrDart ? 'FLUTTER / DART' : artifact.language} • {lines.length} lines
            </span>
          </div>
        </div>

        {/* Artifact Version Navigation */}
        <div className="flex items-center gap-1">
          {allArtifacts.length > 1 && onSelectArtifact && (
            <div className="flex items-center gap-1 mr-2 px-1.5 py-0.5 rounded-lg bg-white border border-[#E6DFD3] text-[10px] font-bold text-[#7C756E]">
              <button
                disabled={currentIndex <= 0}
                onClick={() => onSelectArtifact(allArtifacts[currentIndex - 1])}
                className="p-0.5 hover:text-[#2C2825] disabled:opacity-30 cursor-pointer"
              >
                <ChevronLeft size={12} />
              </button>
              <span>
                {currentIndex + 1} / {allArtifacts.length}
              </span>
              <button
                disabled={currentIndex >= allArtifacts.length - 1}
                onClick={() => onSelectArtifact(allArtifacts[currentIndex + 1])}
                className="p-0.5 hover:text-[#2C2825] disabled:opacity-30 cursor-pointer"
              >
                <ChevronRight size={12} />
              </button>
            </div>
          )}

          <button
            onClick={onClose}
            className="w-7 h-7 rounded-lg flex items-center justify-center hover:bg-[#F5F1EA] text-[#7C756E] hover:text-[#2C2825] transition-colors cursor-pointer"
            title="Close Panel"
          >
            <X size={16} />
          </button>
        </div>
      </div>

      {/* Segmented Tab & Viewport Control */}
      <div className="flex items-center justify-between px-4 py-2 border-b border-[#E6DFD3] bg-white gap-2 flex-wrap">
        {hasPreview ? (
          <div className="flex items-center gap-1 bg-[#F5F1EA] p-0.5 rounded-xl border border-[#E6DFD3]">
            <button
              onClick={() => setActiveTab('preview')}
              className={`flex items-center gap-1.5 px-3 py-1 text-xs font-semibold rounded-lg transition-all cursor-pointer ${
                activeTab === 'preview'
                  ? 'bg-white text-[#C58B51] shadow-2xs font-bold'
                  : 'text-[#7C756E] hover:text-[#2C2825]'
              }`}
            >
              {isFlutterOrDart ? <Smartphone size={13} /> : <Eye size={13} />}
              <span>{isFlutterOrDart ? 'Phone Simulator' : 'Live Web Preview'}</span>
            </button>
            <button
              onClick={() => setActiveTab('code')}
              className={`flex items-center gap-1.5 px-3 py-1 text-xs font-semibold rounded-lg transition-all cursor-pointer ${
                activeTab === 'code'
                  ? 'bg-white text-[#C58B51] shadow-2xs font-bold'
                  : 'text-[#7C756E] hover:text-[#2C2825]'
              }`}
            >
              <Code2 size={13} />
              <span>Code Inspector</span>
            </button>
          </div>
        ) : (
          <div className="flex items-center gap-1 bg-[#F5F1EA] p-0.5 rounded-xl border border-[#E6DFD3]">
            <div className="flex items-center gap-1.5 px-3 py-1 text-xs font-bold rounded-lg bg-white text-[#C58B51] shadow-2xs">
              <Code2 size={13} />
              <span>Code Inspector</span>
            </div>
          </div>
        )}

        {/* Viewport Toggles for HTML / Web Preview */}
        {activeTab === 'preview' && !isFlutterOrDart && (
          <div className="hidden sm:flex items-center gap-1 bg-[#FAF8F5] p-0.5 rounded-lg border border-[#E6DFD3]">
            <button
              type="button"
              onClick={() => setViewportMode('responsive')}
              className={`p-1 rounded text-xs transition-colors cursor-pointer ${
                viewportMode === 'responsive'
                  ? 'bg-white text-[#C58B51] shadow-2xs font-bold'
                  : 'text-[#7C756E] hover:text-[#2C2825]'
              }`}
              title="Responsive Fluid View"
            >
              <Globe size={13} />
            </button>
            <button
              type="button"
              onClick={() => setViewportMode('desktop')}
              className={`p-1 rounded text-xs transition-colors cursor-pointer ${
                viewportMode === 'desktop'
                  ? 'bg-white text-[#C58B51] shadow-2xs font-bold'
                  : 'text-[#7C756E] hover:text-[#2C2825]'
              }`}
              title="Desktop Browser View (1024px)"
            >
              <Monitor size={13} />
            </button>
            <button
              type="button"
              onClick={() => setViewportMode('tablet')}
              className={`p-1 rounded text-xs transition-colors cursor-pointer ${
                viewportMode === 'tablet'
                  ? 'bg-white text-[#C58B51] shadow-2xs font-bold'
                  : 'text-[#7C756E] hover:text-[#2C2825]'
              }`}
              title="Tablet View (768px)"
            >
              <Tablet size={13} />
            </button>
            <button
              type="button"
              onClick={() => setViewportMode('mobile')}
              className={`p-1 rounded text-xs transition-colors cursor-pointer ${
                viewportMode === 'mobile'
                  ? 'bg-white text-[#C58B51] shadow-2xs font-bold'
                  : 'text-[#7C756E] hover:text-[#2C2825]'
              }`}
              title="Mobile Phone View (375px)"
            >
              <Smartphone size={13} />
            </button>
          </div>
        )}

        {/* Action Controls */}
        <div className="flex items-center gap-1.5">
          {activeTab === 'preview' && !isFlutterOrDart && (
            <>
              <button
                onClick={() => setKey((k) => k + 1)}
                className="p-1.5 rounded-lg text-[#7C756E] hover:text-[#2C2825] hover:bg-[#FAF8F5] transition-colors cursor-pointer"
                title="Refresh Preview"
              >
                <RotateCw size={13} />
              </button>
              <button
                onClick={handleOpenNewTab}
                className="p-1.5 rounded-lg text-[#7C756E] hover:text-[#2C2825] hover:bg-[#FAF8F5] transition-colors cursor-pointer"
                title="Open Live Webpage in New Tab"
              >
                <ExternalLink size={13} />
              </button>
            </>
          )}
          <button
            onClick={handleCopy}
            className="flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-semibold text-[#7C756E] hover:text-[#2C2825] bg-[#FAF8F5] border border-[#E6DFD3] hover:border-[#C58B51] transition-all cursor-pointer"
            title="Copy Code"
          >
            {copied ? (
              <>
                <Check size={12} className="text-emerald-600" />
                <span className="text-emerald-600 text-[11px]">Copied</span>
              </>
            ) : (
              <>
                <Copy size={12} />
                <span className="text-[11px]">Copy</span>
              </>
            )}
          </button>
          <button
            onClick={handleDownload}
            className="p-1.5 rounded-lg text-[#7C756E] hover:text-[#2C2825] hover:bg-[#FAF8F5] border border-[#E6DFD3] transition-colors cursor-pointer"
            title="Download Code File"
          >
            <Download size={13} />
          </button>
        </div>
      </div>

      {/* Main Content Area */}
      <div className="flex-1 overflow-hidden relative bg-[#FAF8F5]">
        {activeTab === 'preview' ? (
          isFlutterOrDart ? (
            /* Flutter & Android Phone Simulator Preview */
            <FlutterPhoneSimulator code={artifact.code} title={artifact.title} />
          ) : (
            /* Live Webpage Preview (with optional Browser Chrome & Viewport Sizing) */
            <div className="w-full h-full flex flex-col items-center overflow-auto p-2 sm:p-4">
              <div
                className={`flex flex-col bg-white border border-[#E6DFD3] rounded-2xl shadow-sm overflow-hidden transition-all duration-300 ${
                  viewportMode === 'mobile'
                    ? 'w-[375px] h-[667px] my-auto'
                    : viewportMode === 'tablet'
                    ? 'w-[768px] h-[800px] my-auto'
                    : viewportMode === 'desktop'
                    ? 'w-[1024px] h-[700px] max-w-full my-auto'
                    : 'w-full h-full'
                }`}
              >
                {/* Browser Address Bar Header */}
                <div className="flex items-center justify-between px-3 py-2 border-b border-[#E6DFD3] bg-[#FAF8F5] select-none text-[11px]">
                  <div className="flex items-center gap-1.5">
                    <span className="w-2.5 h-2.5 rounded-full bg-red-400/80" />
                    <span className="w-2.5 h-2.5 rounded-full bg-amber-400/80" />
                    <span className="w-2.5 h-2.5 rounded-full bg-emerald-400/80" />
                  </div>
                  <div className="flex items-center gap-1.5 px-3 py-0.5 rounded-md bg-white border border-[#E6DFD3] text-[#7C756E] font-mono text-[10px] w-56 truncate">
                    <Globe size={11} className="text-[#C58B51] shrink-0" />
                    <span className="truncate">https://saw.workspace.preview/{artifact.title || 'index.html'}</span>
                  </div>
                  <div className="flex items-center gap-1 text-[10px] text-[#A09890]">
                    <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
                    <span>Live Web</span>
                  </div>
                </div>

                {/* Sandboxed IFrame */}
                <div className="flex-1 w-full h-full relative bg-[#FAF8F5]">
                  <iframe
                    key={key}
                    ref={iframeRef}
                    title="Artifact Live Sandbox"
                    sandbox="allow-scripts allow-modals allow-forms"
                    className="w-full h-full border-none bg-white"
                    srcDoc={generatePreviewHtml()}
                  />
                </div>
              </div>
            </div>
          )
        ) : (
          <div className="w-full h-full overflow-auto p-4 bg-white font-mono text-xs text-[#2C2825] leading-relaxed">
            <div className="table w-full">
              {lines.map((lineStr, idx) => (
                <div key={idx} className="table-row hover:bg-[#FAF8F5]">
                  <span className="table-cell pr-4 text-right select-none text-[#A09890] w-10 text-[11px]">
                    {idx + 1}
                  </span>
                  <span className="table-cell pl-2 whitespace-pre font-mono">{lineStr || ' '}</span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
