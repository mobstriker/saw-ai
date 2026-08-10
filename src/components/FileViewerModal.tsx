import React, { useState, useEffect, useRef } from 'react';
import {
  X,
  Copy,
  Check,
  FileCode,
  CheckCircle2,
  Circle,
  Edit3,
  Save,
  RotateCcw,
  Download,
  Eye,
  Code2,
  ExternalLink,
  Globe,
  Monitor,
  Tablet,
  Smartphone,
  Flame,
} from 'lucide-react';
import { ProjectFile } from '../types';
import { ContextInjector } from '../utils/contextInjector';
import { FlutterPhoneSimulator } from './FlutterPhoneSimulator';

interface FileViewerModalProps {
  file: ProjectFile | null;
  onClose: () => void;
  onToggleContext?: (fileId: string) => void;
  onSaveContent?: (fileId: string, newContent: string) => void;
}

type ViewportMode = 'responsive' | 'desktop' | 'tablet' | 'mobile';

export const FileViewerModal: React.FC<FileViewerModalProps> = ({
  file,
  onClose,
  onToggleContext,
  onSaveContent,
}) => {
  const [activeTab, setActiveTab] = useState<'code' | 'preview'>('code');
  const [viewportMode, setViewportMode] = useState<ViewportMode>('responsive');
  const [copied, setCopied] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  const [editedContent, setEditedContent] = useState(() => file?.content || '');
  const [isSaved, setIsSaved] = useState(false);
  const iframeRef = useRef<HTMLIFrameElement | null>(null);

  const isFlutterOrDart =
    file?.language.toLowerCase() === 'dart' ||
    file?.name.endsWith('.dart') ||
    file?.content.includes('package:flutter') ||
    file?.content.includes('StatelessWidget') ||
    file?.content.includes('MaterialApp');

  const isPreviewableWeb =
    file?.language.toLowerCase() === 'html' ||
    file?.name.endsWith('.html') ||
    file?.name.endsWith('.htm') ||
    file?.name.endsWith('.svg') ||
    file?.name.endsWith('.tsx') ||
    file?.name.endsWith('.jsx');

  const hasPreview = isFlutterOrDart || isPreviewableWeb;

  // Keep content in sync if file changes
  useEffect(() => {
    if (file) {
      setEditedContent(file.content);
      setIsEditing(false);
      setIsSaved(false);
      // Auto-preview HTML/SVG/Flutter files if preferred
      if (file.name.endsWith('.html') || file.name.endsWith('.svg')) {
        setActiveTab('preview');
      } else {
        setActiveTab('code');
      }
    }
  }, [file?.id, file?.content]);

  if (!file) return null;

  const currentContent = isEditing ? editedContent : file.content;
  const lines = currentContent.split('\n');
  const tokens = ContextInjector.estimateTokens(currentContent);

  const handleCopy = () => {
    navigator.clipboard.writeText(currentContent);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleSave = () => {
    if (onSaveContent) {
      onSaveContent(file.id, editedContent);
      setIsSaved(true);
      setTimeout(() => setIsSaved(false), 2500);
    }
  };

  const handleReset = () => {
    setEditedContent(file.content);
    setIsSaved(false);
  };

  const handleDownload = () => {
    const blob = new Blob([currentContent], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = file.name;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  const generatePreviewHtml = (): string => {
    const code = currentContent;
    const lang = file.language.toLowerCase();

    if (lang === 'html' || file.name.endsWith('.html')) {
      if (!code.includes('<html') && !code.includes('<!DOCTYPE')) {
        return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8"/>
  <meta name="viewport" content="width=device-width, initial-scale=1.0"/>
  <script src="https://cdn.jsdelivr.net/npm/@tailwindcss/browser@4"></script>
  <link href="https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;500;600;700;800&display=swap" rel="stylesheet">
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

    if (lang === 'svg' || file.name.endsWith('.svg')) {
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

    // Default Web sandbox (TSX/JSX/JS)
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
        get: (target, prop) => (props) => (
          <span style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: props.size || 16, height: props.size || 16, ...props.style }}>✦</span>
        )
      });
      window.lucideReact = MockLucide;

      ${code.replace(/import\s+.*?;/g, '')}

      const componentToRender = typeof App !== 'undefined' ? App : 
                                typeof Component !== 'undefined' ? Component :
                                null;

      if (componentToRender) {
        ReactDOM.createRoot(document.getElementById('root')).render(React.createElement(componentToRender));
      } else {
        document.getElementById('root').innerHTML = '<div style="padding: 20px; background: white; border-radius: 12px; border: 1px solid #E6DFD3;"><h3 style="margin: 0 0 8px 0; color: #C58B51; font-weight: bold;">Interactive Preview</h3><p style="margin: 0; font-size: 13px; color: #7C756E;">Component rendered successfully.</p></div>';
      }
    } catch (e) {
      document.getElementById('root').innerHTML = '<div style="padding: 16px; background: #FFF5F5; border-radius: 12px; border: 1px solid #FED7D7; color: #C53030; font-size: 12px; font-family: monospace;">' + e.message + '</div>';
    }
  </script>
</body>
</html>`;
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-xs p-4 animate-in fade-in duration-150">
      <div className="flex flex-col w-full max-w-5xl h-[88vh] bg-white rounded-2xl border border-[#E6DFD3] shadow-2xl overflow-hidden font-sans">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-3 border-b border-[#E6DFD3] bg-[#FAF8F5]">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg bg-white border border-[#E6DFD3] flex items-center justify-center text-[#C58B51] shadow-2xs">
              {isFlutterOrDart ? <Flame size={18} /> : <FileCode size={18} />}
            </div>
            <div>
              <div className="flex items-center gap-2">
                <span className="text-sm font-bold text-[#2C2825]">{file.name}</span>
                <span className="text-[10px] px-2 py-0.5 rounded-full bg-white border border-[#E6DFD3] font-mono text-[#7C756E]">
                  {isFlutterOrDart ? 'FLUTTER / DART' : file.language.toUpperCase()}
                </span>
                {isEditing && (
                  <span className="text-[10px] px-2 py-0.5 rounded-full bg-[#FAF8F5] border border-[#C58B51] text-[#C58B51] font-bold">
                    Editing Mode
                  </span>
                )}
                {isSaved && (
                  <span className="text-[10px] px-2 py-0.5 rounded-full bg-emerald-50 border border-emerald-300 text-emerald-700 font-bold flex items-center gap-1">
                    <Check size={10} /> Saved
                  </span>
                )}
              </div>
              <p className="text-[11px] font-mono text-[#7C756E]">{file.path}</p>
            </div>
          </div>

          <div className="flex items-center gap-2 flex-wrap">
            {/* View Mode Tabs if previewable */}
            {hasPreview && (
              <div className="flex items-center gap-1 bg-[#F5F1EA] p-0.5 rounded-xl border border-[#E6DFD3] mr-2">
                <button
                  type="button"
                  onClick={() => setActiveTab('code')}
                  className={`flex items-center gap-1.5 px-3 py-1 text-xs font-semibold rounded-lg transition-all cursor-pointer ${
                    activeTab === 'code'
                      ? 'bg-white text-[#C58B51] shadow-2xs font-bold'
                      : 'text-[#7C756E] hover:text-[#2C2825]'
                  }`}
                >
                  <Code2 size={13} />
                  <span>Code</span>
                </button>
                <button
                  type="button"
                  onClick={() => setActiveTab('preview')}
                  className={`flex items-center gap-1.5 px-3 py-1 text-xs font-semibold rounded-lg transition-all cursor-pointer ${
                    activeTab === 'preview'
                      ? 'bg-white text-[#C58B51] shadow-2xs font-bold'
                      : 'text-[#7C756E] hover:text-[#2C2825]'
                  }`}
                >
                  {isFlutterOrDart ? <Smartphone size={13} /> : <Eye size={13} />}
                  <span>{isFlutterOrDart ? 'Phone Preview' : 'Live Web Preview'}</span>
                </button>
              </div>
            )}

            {/* Toggle Edit Mode */}
            {activeTab === 'code' && onSaveContent && (
              <button
                type="button"
                onClick={() => setIsEditing(!isEditing)}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold border transition-all cursor-pointer ${
                  isEditing
                    ? 'bg-[#C58B51] text-white border-[#C58B51] shadow-2xs'
                    : 'bg-white text-[#2C2825] border-[#E6DFD3] hover:border-[#C58B51]'
                }`}
                title="Toggle Web IDE Editor mode"
              >
                <Edit3 size={13} />
                <span>{isEditing ? 'Editing' : 'Edit File'}</span>
              </button>
            )}

            {/* Save Button when in Edit Mode */}
            {isEditing && onSaveContent && (
              <button
                type="button"
                onClick={handleSave}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold shadow-2xs transition-all cursor-pointer"
                title="Save changes to workspace file"
              >
                <Save size={13} />
                <span>Save</span>
              </button>
            )}

            {isEditing && (
              <button
                type="button"
                onClick={handleReset}
                className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-xl bg-white border border-[#E6DFD3] hover:border-[#C58B51] text-xs font-medium text-[#7C756E] transition-all cursor-pointer"
                title="Reset edits to original file content"
              >
                <RotateCcw size={13} />
              </button>
            )}

            {/* Toggle context injection */}
            {onToggleContext && (
              <button
                type="button"
                onClick={() => onToggleContext(file.id)}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold border transition-all cursor-pointer ${
                  file.includedInContext !== false
                    ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
                    : 'bg-[#F5F1EA] text-[#7C756E] border-[#E6DFD3]'
                }`}
                title="Toggle whether this file is injected into raw LLM context memory"
              >
                {file.includedInContext !== false ? (
                  <>
                    <CheckCircle2 size={13} className="text-emerald-600" />
                    <span>In Context</span>
                  </>
                ) : (
                  <>
                    <Circle size={13} />
                    <span>Excluded</span>
                  </>
                )}
              </button>
            )}

            {/* Download */}
            <button
              type="button"
              onClick={handleDownload}
              className="flex items-center gap-1 px-2.5 py-1.5 rounded-xl bg-white border border-[#E6DFD3] hover:border-[#C58B51] text-xs font-medium text-[#7C756E] hover:text-[#2C2825] transition-all cursor-pointer"
              title="Download file"
            >
              <Download size={13} />
            </button>

            {/* Copy code */}
            <button
              type="button"
              onClick={handleCopy}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-white border border-[#E6DFD3] hover:border-[#C58B51] text-xs font-semibold text-[#2C2825] transition-all cursor-pointer"
            >
              {copied ? (
                <>
                  <Check size={13} className="text-emerald-600" />
                  <span className="text-emerald-600 font-bold">Copied</span>
                </>
              ) : (
                <>
                  <Copy size={13} />
                  <span>Copy</span>
                </>
              )}
            </button>

            {/* Close button */}
            <button
              type="button"
              onClick={onClose}
              className="w-8 h-8 rounded-xl flex items-center justify-center hover:bg-[#F5F1EA] text-[#7C756E] hover:text-[#2C2825] transition-colors cursor-pointer"
            >
              <X size={18} />
            </button>
          </div>
        </div>

        {/* Stats & Viewport Bar */}
        <div className="flex items-center justify-between px-5 py-2 bg-white border-b border-[#E6DFD3] text-[11px] text-[#7C756E]">
          <div className="flex items-center gap-4">
            <span>
              Lines: <strong className="text-[#2C2825]">{lines.length}</strong>
            </span>
            <span>
              Size: <strong className="text-[#2C2825]">{(currentContent.length / 1024).toFixed(1)} KB</strong>
            </span>
            <span>
              Tokens: <strong className="text-[#C58B51]">~{tokens.toLocaleString()}</strong>
            </span>
          </div>

          {activeTab === 'preview' && !isFlutterOrDart && (
            <div className="flex items-center gap-1 bg-[#FAF8F5] p-0.5 rounded-lg border border-[#E6DFD3]">
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
                title="Desktop View"
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
                title="Tablet View"
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
                title="Mobile Phone View"
              >
                <Smartphone size={13} />
              </button>
            </div>
          )}

          <div className="flex items-center gap-1.5 text-[10px] text-[#A09890]">
            <span className="w-2 h-2 rounded-full bg-[#C58B51]" />
            <span>Pure Memory Zero-Loss IDE</span>
          </div>
        </div>

        {/* Main Body: Code or Live Preview */}
        <div className="flex-1 overflow-hidden bg-[#FAF8F5] relative">
          {activeTab === 'preview' ? (
            isFlutterOrDart ? (
              <FlutterPhoneSimulator code={currentContent} title={file.name} />
            ) : (
              <div className="w-full h-full flex flex-col items-center overflow-auto p-4">
                <div
                  className={`flex flex-col bg-white border border-[#E6DFD3] rounded-2xl shadow-sm overflow-hidden transition-all duration-300 ${
                    viewportMode === 'mobile'
                      ? 'w-[375px] h-[667px] my-auto'
                      : viewportMode === 'tablet'
                      ? 'w-[768px] h-[800px] my-auto'
                      : viewportMode === 'desktop'
                      ? 'w-[1024px] h-[640px] max-w-full my-auto'
                      : 'w-full h-full'
                  }`}
                >
                  <div className="flex items-center justify-between px-3 py-2 border-b border-[#E6DFD3] bg-[#FAF8F5] text-[11px] select-none">
                    <div className="flex items-center gap-1.5">
                      <span className="w-2.5 h-2.5 rounded-full bg-red-400/80" />
                      <span className="w-2.5 h-2.5 rounded-full bg-amber-400/80" />
                      <span className="w-2.5 h-2.5 rounded-full bg-emerald-400/80" />
                    </div>
                    <div className="flex items-center gap-1.5 px-3 py-0.5 rounded-md bg-white border border-[#E6DFD3] text-[#7C756E] font-mono text-[10px]">
                      <Globe size={11} className="text-[#C58B51]" />
                      <span>https://saw.workspace.preview/{file.name}</span>
                    </div>
                    <div className="flex items-center gap-1 text-[10px] text-[#A09890]">
                      <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
                      <span>Live Preview</span>
                    </div>
                  </div>
                  <iframe
                    ref={iframeRef}
                    title="Live Web Preview"
                    sandbox="allow-scripts allow-modals allow-forms"
                    className="w-full h-full border-none bg-white"
                    srcDoc={generatePreviewHtml()}
                  />
                </div>
              </div>
            )
          ) : (
            <div className="w-full h-full overflow-auto bg-white p-4 font-mono text-xs text-[#2C2825] leading-relaxed">
              {isEditing ? (
                <textarea
                  value={editedContent}
                  onChange={(e) => setEditedContent(e.target.value)}
                  className="w-full h-full min-h-[360px] p-3 font-mono text-xs leading-relaxed text-[#2C2825] bg-[#FAF8F5] border border-[#E6DFD3] rounded-xl focus:border-[#C58B51] focus:outline-none resize-none"
                  spellCheck={false}
                  placeholder="Edit file contents here..."
                />
              ) : (
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
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
