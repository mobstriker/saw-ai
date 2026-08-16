import React, { useState, useMemo, useCallback } from 'react';
import {
  Smartphone,
  Tablet,
  RotateCw,
  Moon,
  Sun,
  Flame,
  Layers,
  ChevronRight,
  Plus,
  Search,
  Settings,
  User,
  Bell,
  Heart,
  Share2,
  Home,
  MessageSquare,
  Sparkles,
  Check,
  CheckCircle2,
  Play,
  Bug,
} from 'lucide-react';
import { parseDart } from '../utils/dartWidgetParser';
import { renderDartNode, parseSwift, renderSwift, parseKotlin, renderKotlin } from '../utils/mobilePreview';

interface FlutterPhoneSimulatorProps {
  code: string;
  title?: string;
  platform?: 'flutter' | 'swift' | 'kotlin';
  onReportBug?: (bugMessage: string) => void;
}

type DeviceType = 'pixel8' | 'iphone15' | 'galaxy';

export const FlutterPhoneSimulator: React.FC<FlutterPhoneSimulatorProps> = ({
  code,
  title,
  platform = 'flutter',
  onReportBug,
}) => {
  const [deviceType, setDeviceType] = useState<DeviceType>('pixel8');
  const [isDarkMode, setIsDarkMode] = useState(false);
  const [showDebugBanner, setShowDebugBanner] = useState(true);
  const [counter, setCounter] = useState(0);
  const [isHotReloading, setIsHotReloading] = useState(false);

  const platformLabel = platform === 'swift' ? 'SwiftUI' : platform === 'kotlin' ? 'Jetpack Compose' : 'Flutter Engine';
  const platformVersion = platform === 'swift' ? 'iOS 17' : platform === 'kotlin' ? 'Compose 1.6' : 'v3.22';

  // Parse the source according to platform and capture any errors for the
  // debug button (Feature 3). Red when an error exists, gray when clean.
  const { renderedApp, errors, appTitle, appBarTitle } = useMemo(() => {
    if (platform === 'swift') {
      const parsed = parseSwift(code);
      return {
        renderedApp: renderSwift(parsed, isDarkMode),
        errors: parsed.errors,
        appTitle: parsed.navigationTitle,
        appBarTitle: parsed.navigationTitle,
      };
    }
    if (platform === 'kotlin') {
      const parsed = parseKotlin(code);
      return {
        renderedApp: renderKotlin(parsed, isDarkMode),
        errors: parsed.errors,
        appTitle: parsed.appTitle,
        appBarTitle: parsed.appTitle,
      };
    }
    // Flutter / Dart
    const parsed = parseDart(code);
    const root = parsed.root;
    const rendered = root ? renderDartNode(root, isDarkMode) : null;
    return {
      renderedApp: rendered,
      errors: parsed.errors,
      appTitle: parsed.appTitle,
      appBarTitle: parsed.appBarTitle,
    };
  }, [code, title, platform, isDarkMode]);

  const hasBug = errors.length > 0;
  const bugText = hasBug ? errors.join('; ') : '';

  const handleHotReload = () => {
    setIsHotReloading(true);
    setTimeout(() => setIsHotReloading(false), 500);
  };

  /**
   * Debug button behavior (Feature 3):
   * - Gray (no bugs): clicking does nothing (no-op), per the user's request.
   * - Red (bug detected): clicking sends the bug message to the AI via
   *   onReportBug so it can auto-fix the code.
   */
  const handleDebugClick = useCallback(() => {
    if (!hasBug || !onReportBug) return; // gray = no-op
    onReportBug(
      `🐛 ${platformLabel} preview bug in ${title || 'app'}:\n${bugText}\n\nPlease fix the code so the app previews correctly without errors.`
    );
  }, [hasBug, bugText, onReportBug, platformLabel, title]);

  const currentTime = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

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

          {/* Debug Banner Visibility Toggle (separate from the bug-report button) */}
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

          {/* DEBUG button — the live bug indicator + AI report action.
              Gray when there are no bugs (clicking is a no-op).
              Red when a bug is detected (clicking sends the bug to the AI). */}
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
        {/* Smartphone Hardware Frame */}
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

              {/* Dynamic Notch / Android Punchhole */}
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

            {/* Rendered App Body — the real widget tree from the source code.
                For Flutter/Dart this is the parsed Scaffold tree; for Swift and
                Kotlin it is the platform-native render. The app's own AppBar /
                navigation title is rendered inside this tree, so we do not
                inject a separate mock AppBar. */}
            <div className="flex-1 overflow-y-auto flex flex-col relative">
              {renderedApp ?? (
                <div className="flex-1 flex flex-col items-center justify-center text-center p-6">
                  <div className="w-16 h-16 rounded-3xl bg-[#C58B51]/15 flex items-center justify-center text-[#C58B51] mb-4 shadow-sm">
                    <Sparkles size={28} />
                  </div>
                  <p className="text-xs font-bold text-[#2C2825] mb-1">{appTitle || 'App'}</p>
                  <p className="text-[11px] text-gray-400">
                    {hasBug
                      ? 'The app could not be rendered. Tap the red DEBUG button to send the error to the AI for fixing.'
                      : 'No renderable widget tree found in this file.'}
                  </p>
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

      {/* Hidden counter state kept for compatibility — FAB increments handled
          inside the rendered tree now. */}
      <span className="hidden">{counter}</span>
    </div>
  );
};
