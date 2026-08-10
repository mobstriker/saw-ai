import React, { useState, useMemo } from 'react';
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
} from 'lucide-react';

interface FlutterPhoneSimulatorProps {
  code: string;
  title?: string;
}

type DeviceType = 'pixel8' | 'iphone15' | 'galaxy';

interface ParsedFlutterApp {
  appTitle: string;
  appBarTitle: string;
  appBarColor?: string;
  backgroundColor?: string;
  isDarkTheme?: boolean;
  hasFab?: boolean;
  fabIcon?: string;
  fabTooltip?: string;
  hasBottomNav?: boolean;
  bottomNavItems?: { icon: string; label: string }[];
  scaffoldBodyType: 'counter' | 'list' | 'form' | 'card' | 'generic';
  extractedTextNodes: string[];
  buttons: { text: string; action?: string; type: 'elevated' | 'text' | 'outlined' }[];
  listItems: { title: string; subtitle?: string; leadingIcon?: string }[];
  hasSearchField?: boolean;
}

export const FlutterPhoneSimulator: React.FC<FlutterPhoneSimulatorProps> = ({ code, title }) => {
  const [deviceType, setDeviceType] = useState<DeviceType>('pixel8');
  const [isDarkMode, setIsDarkMode] = useState(false);
  const [showDebugBanner, setShowDebugBanner] = useState(true);
  const [counter, setCounter] = useState(0);
  const [activeBottomNav, setActiveBottomNav] = useState(0);
  const [isHotReloading, setIsHotReloading] = useState(false);
  const [inputText, setInputText] = useState('');
  const [selectedCards, setSelectedCards] = useState<number[]>([]);

  // Parse the Dart / Flutter code to extract Flutter widget tree semantics
  const parsedApp = useMemo<ParsedFlutterApp>(() => {
    const lines = code.split('\n');
    let appTitle = title || 'Flutter App';
    let appBarTitle = 'Flutter Demo';
    let hasFab = false;
    let fabIcon = 'add';
    let hasBottomNav = false;
    let bottomNavItems: { icon: string; label: string }[] = [];
    const extractedTextNodes: string[] = [];
    const buttons: { text: string; action?: string; type: 'elevated' | 'text' | 'outlined' }[] = [];
    const listItems: { title: string; subtitle?: string; leadingIcon?: string }[] = [];
    let hasSearchField = false;

    // Detect Material / Cupertino app titles
    const titleMatch = code.match(/title:\s*['"]([^'"]+)['"]/i);
    if (titleMatch) {
      appTitle = titleMatch[1];
    }

    // Detect AppBar title: AppBar(title: Text('...'))
    const appBarMatch = code.match(/AppBar\s*\(\s*(?:[^)]*?)title:\s*(?:const\s+)?Text\s*\(\s*['"]([^'"]+)['"]/is);
    if (appBarMatch) {
      appBarTitle = appBarMatch[1];
    } else {
      appBarTitle = appTitle;
    }

    // Detect FloatingActionButton
    if (code.includes('FloatingActionButton') || code.includes('floatingActionButton:')) {
      hasFab = true;
      if (code.includes('Icons.add')) fabIcon = 'add';
      else if (code.includes('Icons.favorite')) fabIcon = 'favorite';
      else if (code.includes('Icons.send')) fabIcon = 'send';
      else if (code.includes('Icons.message')) fabIcon = 'message';
      else if (code.includes('Icons.edit')) fabIcon = 'edit';
    }

    // Detect BottomNavigationBar
    if (code.includes('BottomNavigationBar') || code.includes('NavigationBar')) {
      hasBottomNav = true;
      // Extract items
      const itemMatches = code.matchAll(/BottomNavigationBarItem\s*\(\s*icon:\s*Icon\s*\(\s*Icons\.([a-zA-Z_]+)\s*\)(?:,\s*label:\s*['"]([^'"]+)['"])?/g);
      for (const m of itemMatches) {
        bottomNavItems.push({
          icon: m[1] || 'home',
          label: m[2] || m[1] || 'Tab',
        });
      }
      if (bottomNavItems.length === 0) {
        bottomNavItems = [
          { icon: 'home', label: 'Home' },
          { icon: 'search', label: 'Explore' },
          { icon: 'notifications', label: 'Alerts' },
          { icon: 'person', label: 'Profile' },
        ];
      }
    }

    // Detect ElevatedButtons / TextButtons
    const btnMatches = code.matchAll(/(?:ElevatedButton|FilledButton|TextButton|OutlinedButton)\s*\(\s*(?:onPressed:[^,]+,)?\s*child:\s*(?:const\s+)?Text\s*\(\s*['"]([^'"]+)['"]/g);
    for (const b of btnMatches) {
      buttons.push({
        text: b[1],
        type: 'elevated',
      });
    }

    // Detect ListTiles / ListView items
    const listTileMatches = code.matchAll(/ListTile\s*\(\s*(?:[^)]*?)title:\s*(?:const\s+)?Text\s*\(\s*['"]([^'"]+)['"](?:,\s*subtitle:\s*(?:const\s+)?Text\s*\(\s*['"]([^'"]+)['"])?/g);
    for (const lt of listTileMatches) {
      listItems.push({
        title: lt[1],
        subtitle: lt[2],
        leadingIcon: 'sparkles',
      });
    }

    // Detect TextField
    if (code.includes('TextField') || code.includes('TextFormField')) {
      hasSearchField = true;
    }

    // Detect generic Text('...') strings
    const allTextMatches = code.matchAll(/Text\s*\(\s*['"]([^'"]{3,60})['"]/g);
    for (const t of allTextMatches) {
      if (t[1] && !extractedTextNodes.includes(t[1]) && t[1] !== appBarTitle) {
        extractedTextNodes.push(t[1]);
      }
    }

    // Determine scaffold body type
    let scaffoldBodyType: 'counter' | 'list' | 'form' | 'card' | 'generic' = 'generic';
    if (code.includes('_counter') || code.includes('counter') || code.includes('You have pushed the button this many times')) {
      scaffoldBodyType = 'counter';
    } else if (listItems.length > 0 || code.includes('ListView') || code.includes('ListTile')) {
      scaffoldBodyType = 'list';
    } else if (hasSearchField || code.includes('Form') || buttons.length > 2) {
      scaffoldBodyType = 'form';
    } else if (extractedTextNodes.length > 0) {
      scaffoldBodyType = 'card';
    }

    return {
      appTitle,
      appBarTitle,
      hasFab,
      fabIcon,
      hasBottomNav,
      bottomNavItems,
      scaffoldBodyType,
      extractedTextNodes,
      buttons,
      listItems,
      hasSearchField,
    };
  }, [code, title]);

  const handleHotReload = () => {
    setIsHotReloading(true);
    setTimeout(() => setIsHotReloading(false), 500);
  };

  const currentTime = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

  const renderIconByName = (name: string, size = 18) => {
    switch (name.toLowerCase()) {
      case 'home':
        return <Home size={size} />;
      case 'search':
      case 'explore':
        return <Search size={size} />;
      case 'notifications':
      case 'bell':
        return <Bell size={size} />;
      case 'person':
      case 'profile':
      case 'user':
        return <User size={size} />;
      case 'settings':
        return <Settings size={size} />;
      case 'favorite':
      case 'heart':
        return <Heart size={size} />;
      case 'message':
      case 'chat':
        return <MessageSquare size={size} />;
      case 'share':
        return <Share2 size={size} />;
      default:
        return <Sparkles size={size} />;
    }
  };

  return (
    <div className="flex flex-col h-full bg-[#FAF8F5] text-[#2C2825] select-none overflow-hidden">
      {/* Top Toolbar */}
      <div className="flex items-center justify-between px-4 py-2.5 bg-white border-b border-[#E6DFD3] shrink-0">
        <div className="flex items-center gap-2">
          <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-[#FAF8F5] border border-[#E6DFD3] text-xs font-bold text-[#C58B51]">
            <Flame size={14} className="text-[#C58B51]" />
            <span>Flutter Engine v3.22</span>
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
              <span>Pixel 8 (Android)</span>
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
            title="Flutter Hot Reload"
          >
            <RotateCw size={12} className={isHotReloading ? 'animate-spin text-[#C58B51]' : ''} />
            <span>Hot Reload</span>
          </button>

          {/* Dark Mode Toggle */}
          <button
            type="button"
            onClick={() => setIsDarkMode(!isDarkMode)}
            className="p-1.5 rounded-lg bg-[#FAF8F5] border border-[#E6DFD3] hover:border-[#C58B51] text-[#7C756E] hover:text-[#2C2825] cursor-pointer transition-all"
            title={isDarkMode ? 'Switch to Material Light' : 'Switch to Material Dark'}
          >
            {isDarkMode ? <Sun size={13} className="text-amber-500" /> : <Moon size={13} />}
          </button>

          {/* Debug Banner Toggle */}
          <button
            type="button"
            onClick={() => setShowDebugBanner(!showDebugBanner)}
            className={`px-2 py-1 rounded-lg text-[10px] font-bold border transition-all cursor-pointer ${
              showDebugBanner
                ? 'bg-red-50 text-red-700 border-red-200'
                : 'bg-gray-50 text-gray-400 border-gray-200'
            }`}
            title="Toggle Flutter Debug Banner"
          >
            DEBUG
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

            {/* Flutter DEBUG Banner */}
            {showDebugBanner && (
              <div className="absolute top-9 right-0 z-30 pointer-events-none">
                <div className="bg-red-600 text-white font-mono text-[8px] font-bold px-4 py-0.5 transform rotate-45 translate-x-3 translate-y-1 shadow-xs">
                  DEBUG
                </div>
              </div>
            )}

            {/* Flutter Material AppBar */}
            <div
              className={`h-14 px-4 flex items-center justify-between shadow-xs shrink-0 z-10 ${
                isDarkMode
                  ? 'bg-[#1F1B24] border-b border-white/10 text-white'
                  : 'bg-[#C58B51] text-white'
              }`}
            >
              <div className="flex items-center gap-3">
                <h1 className="text-base font-bold truncate max-w-[200px] tracking-tight">
                  {parsedApp.appBarTitle}
                </h1>
              </div>
              <div className="flex items-center gap-2">
                <button type="button" className="p-1.5 hover:bg-white/10 rounded-full transition-colors">
                  <Search size={16} />
                </button>
                <button type="button" className="p-1.5 hover:bg-white/10 rounded-full transition-colors">
                  <Settings size={16} />
                </button>
              </div>
            </div>

            {/* Flutter Scaffold Body Area */}
            <div className="flex-1 overflow-y-auto p-4 flex flex-col gap-3 relative">
              {/* Optional Search / Input Field */}
              {parsedApp.hasSearchField && (
                <div className="relative mb-1">
                  <Search size={15} className="absolute left-3 top-3 text-gray-400" />
                  <input
                    type="text"
                    value={inputText}
                    onChange={(e) => setInputText(e.target.value)}
                    placeholder="Search in Flutter app..."
                    className={`w-full pl-9 pr-3 py-2 text-xs rounded-xl border outline-none transition-all ${
                      isDarkMode
                        ? 'bg-[#1E1E1E] border-gray-700 text-white placeholder-gray-500 focus:border-[#C58B51]'
                        : 'bg-white border-[#E6DFD3] text-[#2C2825] placeholder-gray-400 focus:border-[#C58B51]'
                    }`}
                  />
                </div>
              )}

              {/* Body Content by Scaffold Type */}
              {parsedApp.scaffoldBodyType === 'counter' ? (
                <div className="flex-1 flex flex-col items-center justify-center text-center p-4">
                  <div className="w-16 h-16 rounded-3xl bg-[#C58B51]/15 flex items-center justify-center text-[#C58B51] mb-4 shadow-sm animate-bounce">
                    <Flame size={28} />
                  </div>
                  <p className="text-xs font-medium text-gray-500 mb-2">
                    You have pushed the button this many times:
                  </p>
                  <div className="text-4xl font-extrabold text-[#C58B51] font-mono tracking-tight my-2">
                    {counter}
                  </div>
                  <p className="text-[11px] text-gray-400 mt-2">
                    Tap the floating action button below to increment state.
                  </p>
                </div>
              ) : parsedApp.scaffoldBodyType === 'list' && parsedApp.listItems.length > 0 ? (
                <div className="space-y-2">
                  {parsedApp.listItems.map((item, idx) => {
                    const isSelected = selectedCards.includes(idx);
                    return (
                      <div
                        key={idx}
                        onClick={() => {
                          setSelectedCards((prev) =>
                            prev.includes(idx) ? prev.filter((i) => i !== idx) : [...prev, idx]
                          );
                        }}
                        className={`p-3 rounded-2xl border transition-all cursor-pointer flex items-center justify-between ${
                          isDarkMode
                            ? isSelected
                              ? 'bg-[#2A241E] border-[#C58B51]'
                              : 'bg-[#1E1E1E] border-gray-800 hover:border-gray-700'
                            : isSelected
                            ? 'bg-[#FAF5EF] border-[#C58B51]'
                            : 'bg-white border-[#E6DFD3] hover:border-[#C58B51]/60'
                        }`}
                      >
                        <div className="flex items-center gap-3">
                          <div className="w-9 h-9 rounded-xl bg-[#C58B51]/10 text-[#C58B51] flex items-center justify-center font-bold text-xs">
                            {idx + 1}
                          </div>
                          <div>
                            <h4 className="text-xs font-bold">{item.title}</h4>
                            {item.subtitle && (
                              <p className="text-[10px] text-gray-400 mt-0.5">{item.subtitle}</p>
                            )}
                          </div>
                        </div>
                        <ChevronRight size={14} className="text-gray-400" />
                      </div>
                    );
                  })}
                </div>
              ) : (
                <div className="space-y-3">
                  {/* Extracted Cards & Components */}
                  <div
                    className={`p-4 rounded-2xl border shadow-xs ${
                      isDarkMode ? 'bg-[#1E1E1E] border-gray-800' : 'bg-white border-[#E6DFD3]'
                    }`}
                  >
                    <div className="flex items-center gap-2 mb-2">
                      <Sparkles size={16} className="text-[#C58B51]" />
                      <h3 className="text-xs font-bold">{parsedApp.appTitle}</h3>
                    </div>
                    <p className="text-[11px] text-gray-400 leading-relaxed mb-3">
                      Interactive Flutter Widget Tree live in sandboxed simulator.
                    </p>

                    {parsedApp.extractedTextNodes.slice(0, 4).map((textNode, idx) => (
                      <div
                        key={idx}
                        className={`p-2.5 rounded-xl text-xs mb-1.5 border ${
                          isDarkMode
                            ? 'bg-[#181818] border-gray-800 text-gray-300'
                            : 'bg-[#FAF8F5] border-[#E6DFD3] text-[#4A443F]'
                        }`}
                      >
                        {textNode}
                      </div>
                    ))}
                  </div>

                  {/* Buttons */}
                  {parsedApp.buttons.length > 0 && (
                    <div className="space-y-2">
                      {parsedApp.buttons.map((btn, idx) => (
                        <button
                          key={idx}
                          type="button"
                          onClick={() => setCounter((c) => c + 1)}
                          className="w-full py-2.5 px-4 rounded-xl bg-[#C58B51] hover:bg-[#b0783f] text-white text-xs font-bold shadow-xs transition-transform active:scale-98 cursor-pointer flex items-center justify-center gap-2"
                        >
                          <Play size={12} />
                          <span>{btn.text}</span>
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* Flutter Floating Action Button (FAB) */}
            {parsedApp.hasFab && (
              <div className="absolute right-4 bottom-16 z-20">
                <button
                  type="button"
                  onClick={() => setCounter((c) => c + 1)}
                  className="w-13 h-13 rounded-2xl bg-[#C58B51] hover:bg-[#b0783f] text-white shadow-lg flex items-center justify-center transition-transform active:scale-90 cursor-pointer"
                  title="Floating Action Button"
                >
                  <Plus size={24} />
                </button>
              </div>
            )}

            {/* Flutter Bottom Navigation Bar */}
            {parsedApp.hasBottomNav && (
              <div
                className={`h-14 px-3 flex items-center justify-around border-t shrink-0 z-10 ${
                  isDarkMode
                    ? 'bg-[#1E1E1E] border-gray-800 text-gray-400'
                    : 'bg-white border-[#E6DFD3] text-gray-500'
                }`}
              >
                {parsedApp.bottomNavItems.map((item, idx) => {
                  const isActive = activeBottomNav === idx;
                  return (
                    <button
                      key={idx}
                      type="button"
                      onClick={() => setActiveBottomNav(idx)}
                      className={`flex flex-col items-center gap-0.5 text-[10px] font-semibold transition-all cursor-pointer ${
                        isActive
                          ? 'text-[#C58B51] font-bold scale-105'
                          : 'hover:text-[#2C2825]'
                      }`}
                    >
                      {renderIconByName(item.icon, 18)}
                      <span>{item.label}</span>
                    </button>
                  );
                })}
              </div>
            )}

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
