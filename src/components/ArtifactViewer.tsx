import React, { useState, useEffect, useRef, useCallback } from 'react';
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
import { buildHtmlPreview, buildSvgPreview, buildReactPreview, isPreviewErrorReport } from '../utils/previewBuilder';

interface ArtifactViewerProps {
  artifact: Artifact | null;
  allArtifacts?: Artifact[];
  onClose: () => void;
  onSelectArtifact?: (artifact: Artifact) => void;
  onReportBug?: (bugMessage: string) => void;
}

type ViewportMode = 'responsive' | 'desktop' | 'tablet' | 'mobile';

export const ArtifactViewer: React.FC<ArtifactViewerProps> = ({
  artifact,
  allArtifacts = [],
  onClose,
  onSelectArtifact,
  onReportBug,
}) => {
  const [activeTab, setActiveTab] = useState<'preview' | 'code'>('preview');
  const [viewportMode, setViewportMode] = useState<ViewportMode>('responsive');
  const [copied, setCopied] = useState(false);
  const [key, setKey] = useState(0); // for reload iframe
  const iframeRef = useRef<HTMLIFrameElement | null>(null);
  const [webError, setWebError] = useState<string | null>(null);

  const isFlutterOrDart =
    artifact?.language.toLowerCase() === 'dart' ||
    artifact?.language.toLowerCase() === 'flutter' ||
    artifact?.code.includes('package:flutter') ||
    artifact?.code.includes('StatelessWidget') ||
    artifact?.code.includes('StatefulWidget') ||
    artifact?.code.includes('MaterialApp') ||
    artifact?.title.endsWith('.dart');

  const isSwift =
    artifact?.language.toLowerCase() === 'swift' ||
    artifact?.code.includes('import SwiftUI') ||
    artifact?.code.includes('UIKit') ||
    artifact?.title.endsWith('.swift');

  const isKotlin =
    artifact?.language.toLowerCase() === 'kotlin' ||
    artifact?.language.toLowerCase() === 'kt' ||
    artifact?.code.includes('androidx.compose') ||
    artifact?.code.includes('Jetpack') ||
    artifact?.title.endsWith('.kt');

  const isNativeMobile = isSwift || isKotlin;

  const isPreviewableWeb =
    ['html', 'htm', 'svg', 'tsx', 'jsx', 'javascript', 'js', 'typescript', 'ts'].includes(artifact?.language.toLowerCase() || '') ||
    artifact?.title.endsWith('.html') ||
    artifact?.title.endsWith('.htm') ||
    artifact?.title.endsWith('.svg') ||
    artifact?.title.endsWith('.tsx') ||
    artifact?.title.endsWith('.jsx') ||
    artifact?.title.endsWith('.ts') ||
    artifact?.title.endsWith('.js');

  const hasPreview = isFlutterOrDart || isNativeMobile || isPreviewableWeb;

  // Auto-switch to preview for HTML/SVG/TSX/Flutter/native-mobile, or code for others (Python, JSON, SQL, etc.)
  useEffect(() => {
    if (artifact) {
      if (hasPreview) {
        setActiveTab('preview');
      } else {
        setActiveTab('code');
      }
      setWebError(null);
    }
  }, [artifact?.id, hasPreview]);

  // Listen for runtime errors posted from the sandboxed web preview iframe so
  // the debug button can light up and report the bug to the AI (Feature 3).
  useEffect(() => {
    const handler = (e: MessageEvent) => {
      if (e.source !== iframeRef.current?.contentWindow) return;
      if (isPreviewErrorReport(e.data)) {
        setWebError(e.data.message || 'Unknown preview error');
      }
    };
    window.addEventListener('message', handler);
    return () => window.removeEventListener('message', handler);
  }, []);

  // Reset captured errors when the artifact or reload key changes.
  useEffect(() => {
    setWebError(null);
  }, [artifact?.id, key]);

  const handleReportWebBug = useCallback(() => {
    if (!webError || !onReportBug) return;
    onReportBug(
      `🐛 Preview bug in ${artifact?.title || 'web artifact'}:\n${webError}\n\nPlease fix the code so it previews correctly without errors.`
    );
  }, [webError, onReportBug, artifact?.title]);

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

  // Build sandboxed HTML for the iframe preview via the shared preview builder.
  const generatePreviewHtml = (): string => {
    const lang = artifact.language.toLowerCase();
    const code = artifact.code;
    const filename = artifact.title || `artifact.${lang}`;

    if (lang === 'html' || artifact.title.endsWith('.html') || artifact.title.endsWith('.htm')) {
      return buildHtmlPreview(code, filename);
    }
    if (lang === 'svg' || artifact.title.endsWith('.svg')) {
      return buildSvgPreview(code, filename);
    }
    // TSX / JSX / TS / JS / React
    return buildReactPreview(code, filename);
  };

  const currentIndex = allArtifacts.findIndex((a) => a.id === artifact.id);
  const lines = artifact.code.split('\n');

  return (
    <div className="flex flex-col h-full bg-white font-sans text-[#2C2825] overflow-hidden">
      {/* Top Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-[#E6DFD3] bg-[#FAF8F5]">
        <div className="flex items-center gap-2.5">
          <div className="w-8 h-8 rounded-xl bg-white border border-[#E6DFD3] flex items-center justify-center text-[#C58B51] shadow-2xs">
            {isFlutterOrDart || isNativeMobile ? <Flame size={16} className="text-[#C58B51]" /> : <Sparkles size={16} />}
          </div>
          <div>
            <h3 className="text-xs font-bold text-[#2C2825] truncate max-w-[180px]" title={artifact.title}>
              {artifact.title}
            </h3>
            <span className="text-[10px] font-mono text-[#7C756E] uppercase">
              {isFlutterOrDart ? 'FLUTTER / DART' : isSwift ? 'SWIFTUI / IOS' : isKotlin ? 'KOTLIN / ANDROID' : artifact.language} • {lines.length} lines
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
              {isFlutterOrDart || isNativeMobile ? <Smartphone size={13} /> : <Eye size={13} />}
              <span>{isFlutterOrDart || isNativeMobile ? 'Phone Simulator' : 'Live Web Preview'}</span>
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
        {activeTab === 'preview' && !isFlutterOrDart && !isNativeMobile && (
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
          {activeTab === 'preview' && !isFlutterOrDart && !isNativeMobile && (
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
              {/* Web Debug button: red when a preview bug is detected, gray when clean.
                  Clicking when red sends the bug to the AI to fix. Gray is a no-op. */}
              <button
                type="button"
                onClick={handleReportWebBug}
                disabled={!webError}
                className={`flex items-center gap-1 px-2 py-1 rounded-lg text-[10px] font-bold border transition-all ${
                  webError
                    ? 'bg-red-50 text-red-700 border-red-200 hover:bg-red-100 cursor-pointer'
                    : 'bg-gray-50 text-gray-400 border-gray-200 cursor-default'
                }`}
                title={webError ? `Bug detected — click to send to AI: ${webError}` : 'No preview bugs detected'}
              >
                DEBUG
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
          isFlutterOrDart || isNativeMobile ? (
            /* Flutter / Dart / Swift (iOS) / Kotlin (Android) Phone Simulator Preview */
            <FlutterPhoneSimulator
              code={artifact.code}
              title={artifact.title}
              platform={isSwift ? 'swift' : isKotlin ? 'kotlin' : 'flutter'}
              onReportBug={onReportBug}
            />
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
