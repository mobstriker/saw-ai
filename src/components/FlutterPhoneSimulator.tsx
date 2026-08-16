import React, { useState, useMemo, useCallback, useEffect } from 'react';
import {
  Smartphone,
  RotateCw,
  Moon,
  Sun,
  Flame,
  Sparkles,
  Bug,
  Loader2,
} from 'lucide-react';
import { parseDart } from '../utils/dartWidgetParser';
import { renderDartNode, parseSwift, renderSwift, parseKotlin, renderKotlin } from '../utils/mobilePreview';
import {
  analyzeDart,
  ensureFlutterApp,
  type DartAnalysisResult,
} from '../utils/flutterEngine';

interface FlutterPhoneSimulatorProps {
  code: string;
  title?: string;
  platform?: 'flutter' | 'swift' | 'kotlin';
  onReportBug?: (bugMessage: string) => void;
}

type DeviceType = 'pixel8' | 'iphone15' | 'galaxy';

type FlutterStatus = 'idle' | 'analyzing' | 'error';

export const FlutterPhoneSimulator: React.FC<FlutterPhoneSimulatorProps> = ({
  code,
  title,
  platform = 'flutter',
  onReportBug,
}) => {
  const [deviceType, setDeviceType] = useState<DeviceType>('pixel8');
  const [isDarkMode, setIsDarkMode] = useState(false);
  const [showDebugBanner, setShowDebugBanner] = useState(true);
  const [isHotReloading, setIsHotReloading] = useState(false);

  // ---- Native (Swift/Kotlin) parser-based preview + structural errors ----
  const nativePreview = useMemo(() => {
    if (platform === 'swift') {
      const parsed = parseSwift(code);
      return {
        rendered: renderSwift(parsed, isDarkMode),
        errors: parsed.errors,
        appTitle: parsed.navigationTitle,
      };
    }
    if (platform === 'kotlin') {
      const parsed = parseKotlin(code);
      return {
        rendered: renderKotlin(parsed, isDarkMode),
        errors: parsed.errors,
        appTitle: parsed.appTitle,
      };
    }
    return null;
  }, [code, platform, isDarkMode]);

  // ---- Dart fallback preview (used if DartPad can't load) ----
  const dartFallback = useMemo(() => {
    if (platform !== 'flutter') return null;
    const parsed = parseDart(code);
    return {
      rendered: parsed.root ? renderDartNode(parsed.root, isDarkMode) : null,
      errors: parsed.errors,
      appTitle: parsed.appTitle,
      appBarTitle: parsed.appBarTitle,
    };
  }, [code, platform, isDarkMode]);

  // ---- Real Dart analyzer state (drives the DEBUG button) ----
  const [flutterStatus, setFlutterStatus] = useState<FlutterStatus>('idle');
  const [analysis, setAnalysis] = useState<DartAnalysisResult | null>(null);

  // Debounced analysis of the Dart source via the dart-services backend. This
  // is the authoritative compile-error check that turns the DEBUG button red.
  // The preview itself is rendered structurally (dartWidgetParser) directly in
  // the phone screen — no external iframe, so there is no "engine
  // unavailable" fallback or transient editor-in-phone flash.
  useEffect(() => {
    if (platform !== 'flutter') return;
    const wrapped = ensureFlutterApp(code);
    setFlutterStatus('analyzing');
    let cancelled = false;
    const handle = setTimeout(async () => {
      const result = await analyzeDart(wrapped);
      if (cancelled) return;
      setAnalysis(result);
      setFlutterStatus(result.ok ? 'idle' : 'error');
    }, 500);
    return () => {
      cancelled = true;
      clearTimeout(handle);
    };
  }, [code, platform]);

  const platformLabel =
    platform === 'swift' ? 'SwiftUI' : platform === 'kotlin' ? 'Jetpack Compose' : 'Flutter';
  const platformVersion =
    platform === 'swift' ? 'iOS 17' : platform === 'kotlin' ? 'Compose 1.6' : 'Dart 3.13 · Live Analysis';

  // ---- Unified bug state across platforms ----
  const bugErrors: string[] = useMemo(() => {
    if (platform === 'swift' || platform === 'kotlin') return nativePreview?.errors ?? [];
    if (platform === 'flutter') {
      // Prefer the real analyzer; fall back to the structural parser only if
      // the analyzer couldn't run.
      if (analysis && analysis.errors.length > 0) {
        return analysis.errors.map(
          (e) => `${e.message}${e.line ? ` (line ${e.line}${e.column ? `:${e.column}` : ''})` : ''}`
        );
      }
      if (analysis && analysis.ok) return [];
      return dartFallback?.errors ?? [];
    }
    return [];
  }, [platform, nativePreview, analysis, dartFallback]);

  const hasBug = bugErrors.length > 0;
  const bugText = bugErrors.join('; ');

  const handleHotReload = useCallback(() => {
    setIsHotReloading(true);
    // Re-run the analyzer to refresh the DEBUG state.
    if (platform === 'flutter') {
      const wrapped = ensureFlutterApp(code);
      setFlutterStatus('analyzing');
      analyzeDart(wrapped).then((result) => {
        setAnalysis(result);
        setFlutterStatus(result.ok ? 'idle' : 'error');
      });
    }
    setTimeout(() => setIsHotReloading(false), 600);
  }, [platform, code]);

  /**
   * DEBUG button (Feature 3): gray = no-op (no bugs); red = send bug to AI.
   */
  const handleDebugClick = useCallback(() => {
    if (!hasBug || !onReportBug) return;
    onReportBug(
      `🐛 ${platformLabel} preview bug in ${title || 'app'}:\n${bugText}\n\nPlease fix the code so the app previews correctly without errors.`
    );
  }, [hasBug, bugText, onReportBug, platformLabel, title]);

  const currentTime = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

  const isFlutter = platform === 'flutter';
  const flutterAnalyzing = isFlutter && flutterStatus === 'analyzing';

  return (
    <div className="flex flex-col h-full bg-[#FAF8F5] text-[#2C2825] select-none overflow-hidden">
      {/* Top Toolbar */}
      <div className="flex items-center justify-between px-4 py-2.5 bg-white border-b border-[#E6DFD3] shrink-0">
        <div className="flex items-center gap-2">
          <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-[#FAF8F5] border border-[#E6DFD3] text-xs font-bold text-[#C58B51]">
            <Flame size={14} className="text-[#C58B51]" />
            <span>{platformLabel} {platformVersion}</span>
          </div>

          <div className="flex items-center gap-1 bg-[#FAF8F5] p-0.5 rounded-lg border border-[#E6DFD3]">
            <button
              type="button"
              onClick={() => setDeviceType('pixel8')}
              className={`px-2 py-1 rounded text-xs font-semibold flex items-center gap-1 cursor-pointer transition-all ${
                deviceType === 'pixel8'
                  ? 'bg-white text-[#C58B51] shadow-2xs font-bold'
                  : 'text-[#7C756E] hover:text-[#2C2825]'
              }`}
              title="Google Pixel 8 (Android)"
            >
              <Smartphone size={13} />
              <span>Pixel 8</span>
            </button>
            <button
              type="button"
              onClick={() => setDeviceType('galaxy')}
              className={`px-2 py-1 rounded text-xs font-semibold flex items-center gap-1 cursor-pointer transition-all ${
                deviceType === 'galaxy'
                  ? 'bg-white text-[#C58B51] shadow-2xs font-bold'
                  : 'text-[#7C756E] hover:text-[#2C2825]'
              }`}
              title="Galaxy S24 (Android)"
            >
              <Smartphone size={13} />
              <span>Galaxy S24</span>
            </button>
            <button
              type="button"
              onClick={() => setDeviceType('iphone15')}
              className={`px-2 py-1 rounded text-xs font-semibold flex items-center gap-1 cursor-pointer transition-all ${
                deviceType === 'iphone15'
                  ? 'bg-white text-[#C58B51] shadow-2xs font-bold'
                  : 'text-[#7C756E] hover:text-[#2C2825]'
              }`}
              title="iPhone 15 Pro"
            >
              <Smartphone size={13} />
              <span>iPhone 15</span>
            </button>
          </div>
        </div>

        <div className="flex items-center gap-1.5">
          {isFlutter && flutterAnalyzing && (
            <span className="flex items-center gap-1 text-[10px] font-semibold text-[#7C756E]">
              <Loader2 size={11} className="animate-spin text-[#C58B51]" />
              Compiling…
            </span>
          )}

          {/* Hot Reload Button */}
          <button
            type="button"
            onClick={handleHotReload}
            className="flex items-center gap-1 px-2.5 py-1 rounded-lg bg-[#FAF8F5] border border-[#E6DFD3] hover:border-[#C58B51] text-xs font-semibold text-[#7C756E] hover:text-[#2C2825] cursor-pointer transition-all"
            title="Hot Reload"
          >
            <RotateCw size={12} className={isHotReloading ? 'animate-spin text-[#C58B51]' : ''} />
            <span>Hot Reload</span>
          </button>

          {/* Dark Mode Toggle */}
          <button
            type="button"
            onClick={() => setIsDarkMode(!isDarkMode)}
            className="p-1.5 rounded-lg bg-[#FAF8F5] border border-[#E6DFD3] hover:border-[#C58B51] text-[#7C756E] hover:text-[#2C2825] cursor-pointer transition-all"
            title={isDarkMode ? 'Switch to Light' : 'Switch to Dark'}
          >
            {isDarkMode ? <Sun size={13} className="text-amber-500" /> : <Moon size={13} />}
          </button>

          {/* Debug banner visibility toggle (separate from the bug-report button) */}
          <button
            type="button"
            onClick={() => setShowDebugBanner(!showDebugBanner)}
            className={`px-2 py-1 rounded-lg text-[10px] font-bold border transition-all cursor-pointer ${
              showDebugBanner
                ? 'bg-gray-100 text-gray-500 border-gray-200'
                : 'bg-gray-50 text-gray-300 border-gray-200'
            }`}
            title="Toggle the corner DEBUG banner visibility"
          >
            BANNER
          </button>

          {/* DEBUG button — gray=no-op, red=send bug to AI */}
          <button
            type="button"
            onClick={handleDebugClick}
            disabled={!hasBug}
            className={`flex items-center gap-1 px-2 py-1 rounded-lg text-[10px] font-bold border transition-all ${
              hasBug
                ? 'bg-red-50 text-red-700 border-red-200 hover:bg-red-100 cursor-pointer animate-pulse'
                : 'bg-gray-50 text-gray-400 border-gray-200 cursor-default'
            }`}
            title={hasBug ? `Bug detected — click to send to AI: ${bugText}` : 'No bugs detected'}
          >
            <Bug size={11} />
            <span>DEBUG</span>
          </button>
        </div>
      </div>

      {/* Simulator Device Frame Area */}
      <div className="flex-1 overflow-auto flex items-center justify-center p-4 md:p-6 bg-[#FAF8F5]">
        <div
          className={`relative transition-all duration-300 shadow-2xl flex flex-col overflow-hidden ${
            deviceType === 'iphone15'
              ? 'w-[320px] h-[640px] rounded-[48px] border-[10px] border-[#1C1C1E] bg-[#1C1C1E]'
              : deviceType === 'galaxy'
              ? 'w-[320px] h-[650px] rounded-[36px] border-[8px] border-[#2B2D30] bg-[#2B2D30]'
              : 'w-[320px] h-[640px] rounded-[42px] border-[9px] border-[#1E1E1E] bg-[#1E1E1E]'
          }`}
        >
          {/* Screen Bezel / Inner Display */}
          <div
            className={`w-full h-full flex flex-col overflow-hidden relative font-sans ${
              isDarkMode ? 'bg-[#121212] text-[#E0E0E0]' : 'bg-[#FAFAFA] text-[#1E1E1E]'
            }`}
          >
            {/* Top Device Hardware Punchhole & Status Bar */}
            <div
              className={`h-9 px-5 flex items-center justify-between text-[11px] font-bold shrink-0 z-20 ${
                isDarkMode ? 'bg-[#1E1E1E] text-gray-300' : 'bg-[#F2EFE9] text-gray-700'
              }`}
            >
              <span>{currentTime}</span>
              {deviceType === 'iphone15' ? (
                <div className="w-20 h-4 bg-black rounded-full mx-auto" />
              ) : (
                <div className="w-3.5 h-3.5 bg-black rounded-full mx-auto ring-1 ring-white/20" />
              )}
              <div className="flex items-center gap-1 text-[10px]">
                <span>5G</span>
                <span>📶</span>
                <span>98%</span>
              </div>
            </div>

            {/* DEBUG corner banner (visibility toggle only) */}
            {showDebugBanner && (
              <div className="absolute top-9 right-0 z-30 pointer-events-none">
                <div className="bg-red-600 text-white font-mono text-[8px] font-bold px-4 py-0.5 transform rotate-45 translate-x-3 translate-y-1 shadow-xs">
                  DEBUG
                </div>
              </div>
            )}

            {/* Rendered App Body */}
            <div className="flex-1 overflow-hidden flex flex-col relative bg-white">
              {/* Flutter: structural widget-tree preview rendered directly in the
                  phone screen (no external iframe). The dart-services analyzer
                  still validates the code and powers the DEBUG button. */}
              {isFlutter ? (
                <div className="flex-1 flex flex-col relative overflow-y-auto">
                  {dartFallback?.rendered ? (
                    <div className="flex-1 overflow-y-auto">{dartFallback.rendered}</div>
                  ) : (
                    <div className="flex-1 flex flex-col items-center justify-center text-center p-6">
                      <div className="w-16 h-16 rounded-3xl bg-[#C58B51]/15 flex items-center justify-center text-[#C58B51] mb-4 shadow-sm">
                        <Sparkles size={28} />
                      </div>
                      <p className="text-xs font-bold text-[#2C2825] mb-1">{dartFallback?.appTitle || 'App'}</p>
                      <p className="text-[11px] text-gray-400">
                        {hasBug
                          ? 'Compile error — tap the red DEBUG button to send it to the AI.'
                          : 'No renderable widget found in this file.'}
                      </p>
                    </div>
                  )}
                  {hasBug && (
                    <div className="absolute inset-0 bg-white/95 flex flex-col items-center justify-center text-center p-6 z-10">
                      <div className="w-12 h-12 rounded-2xl bg-red-50 flex items-center justify-center text-red-500 mb-3">
                        <Bug size={22} />
                      </div>
                      <p className="text-xs font-bold text-red-700 mb-1">Compile error in Flutter code</p>
                      <p className="text-[11px] text-red-600 font-mono max-h-32 overflow-auto mb-3">{bugText}</p>
                      <p className="text-[10px] text-gray-400">Tap the red DEBUG button to send this to the AI for fixing.</p>
                    </div>
                  )}
                  <div className="shrink-0 px-3 py-1.5 bg-[#FAF8F5] border-t border-[#E6DFD3] flex items-center gap-1.5 text-[10px] text-[#7C756E]">
                    <Flame size={11} className="text-[#C58B51]" />
                    <span>
                      {flutterAnalyzing
                        ? 'Analyzing with the Dart compiler…'
                        : hasBug
                        ? 'Compile error detected — DEBUG to fix.'
                        : 'Live Dart analysis passed · structural Flutter preview.'}
                    </span>
                  </div>
                </div>
              ) : (
                /* Swift / Kotlin faithful translator preview */
                <div className="flex-1 overflow-y-auto flex flex-col relative">
                  {nativePreview?.rendered ?? (
                    <div className="flex-1 flex flex-col items-center justify-center text-center p-6">
                      <div className="w-16 h-16 rounded-3xl bg-[#C58B51]/15 flex items-center justify-center text-[#C58B51] mb-4 shadow-sm">
                        <Smartphone size={28} />
                      </div>
                      <p className="text-xs font-bold text-[#2C2825] mb-1">{nativePreview?.appTitle || 'App'}</p>
                      <p className="text-[11px] text-gray-400">
                        {hasBug
                          ? 'The app could not be rendered. Tap the red DEBUG button to send the error to the AI.'
                          : 'No renderable view found in this file.'}
                      </p>
                      <p className="text-[10px] text-gray-300 mt-2 italic">
                        {platform === 'swift' ? 'SwiftUI' : 'Jetpack Compose'} native approximation preview
                      </p>
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* Android Navigation Gesture Bar */}
            <div
              className={`h-5 flex items-center justify-center shrink-0 ${
                isDarkMode ? 'bg-[#1E1E1E]' : 'bg-white'
              }`}
            >
              <div className="w-28 h-1 rounded-full bg-gray-400/40" />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
