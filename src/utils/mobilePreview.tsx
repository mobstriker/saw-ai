/**
 * mobilePreview — renders parsed Dart/Swift/Kotlin widget trees to React
 * elements for the FlutterPhoneSimulator. Each native platform has its own
 * renderer so the on-device preview faithfully mirrors the source code.
 */
import React from 'react';
import {
  Home, Search, Bell, User, Settings, Heart, MessageSquare, Share2,
  Star, Plus, Send, Edit, Trash2, Check, ChevronRight, ChevronLeft,
  Play, Pause, RefreshCw, Camera, Image, Mail, Phone, MapPin, Calendar,
  Lock, Eye, EyeOff, Download, Upload, Cloud, Sun, Moon, Wind, Droplet,
  Wifi, Battery, Volume2, Github, Twitter, Facebook, Instagram, Linkedin,
  ShoppingBag, ShoppingCart, CreditCard, Wallet, TrendingUp, TrendingDown,
  Activity, BarChart, PieChart, Filter, SortAsc, Menu, MoreVertical,
  MoreHorizontal, X, CheckCircle, AlertCircle, Info, HelpCircle,
  ArrowLeft, ArrowRight, ArrowUp, ArrowDown, ChevronDown, ChevronUp,
  Sparkles, Flame,
} from 'lucide-react';
import { DartNode, DartValue } from './dartWidgetParser';

const ICON_MAP: Record<string, React.ComponentType<{ size?: number; className?: string; color?: string; strokeWidth?: number }>> = {
  home: Home, search: Search, explore: Search, notifications: Bell, bell: Bell,
  person: User, user: User, profile: User, settings: Settings, favorite: Heart,
  heart: Heart, message: MessageSquare, chat: MessageSquare, mail: Mail, email: Mail,
  share: Share2, star: Star, add: Plus, send: Send, edit: Edit, delete: Trash2,
  remove: Trash2, check: Check, play_arrow: Play, play: Play, pause: Pause,
  refresh: RefreshCw, camera: Camera, photo: Image, image: Image, phone: Phone,
  map: MapPin, location_on: MapPin, calendar_today: Calendar, lock: Lock,
  visibility: Eye, visibility_off: EyeOff, download: Download, upload: Upload,
  cloud: Cloud, wb_sunny: Sun, sunny: Sun, moon: Moon, air: Wind, water_drop: Droplet,
  wifi: Wifi, battery_full: Battery, volume_up: Volume2, github: Github,
  twitter: Twitter, facebook: Facebook, instagram: Instagram, linkedin: Linkedin,
  shopping_bag: ShoppingBag, shopping_cart: ShoppingCart, shopping_basket: ShoppingCart,
  credit_card: CreditCard, account_balance_wallet: Wallet, wallet: Wallet,
  trending_up: TrendingUp, trending_down: TrendingDown, show_chart: Activity,
  bar_chart: BarChart, pie_chart: PieChart, filter_list: Filter, filter_alt: Filter,
  sort: SortAsc, menu: Menu, more_vert: MoreVertical, more_horiz: MoreHorizontal,
  close: X, check_circle: CheckCircle, error: AlertCircle, warning: AlertCircle,
  info: Info, help: HelpCircle, arrow_back: ArrowLeft, arrow_forward: ArrowRight,
  arrow_upward: ArrowUp, arrow_downward: ArrowDown, expand_more: ChevronDown,
  expand_less: ChevronUp, chevron_right: ChevronRight, chevron_left: ChevronLeft,
  navigate_next: ChevronRight, navigate_before: ChevronLeft, flame: Flame,
  fire: Flame, rocket: Sparkles, auto_awesome: Sparkles,
};

function renderIcon(name: string, size = 20, color?: string) {
  const IconComp = ICON_MAP[name.toLowerCase()] || Sparkles;
  return React.createElement(IconComp, { size, color, strokeWidth: 2 });
}

function valString(v?: DartValue): string {
  if (!v) return '';
  if (v.kind === 'string') return v.value;
  if (v.kind === 'number') return String(v.value);
  if (v.kind === 'bool') return String(v.value);
  if (v.kind === 'enum') return v.value.split('.').pop() || '';
  if (v.kind === 'raw') return v.value;
  return '';
}

/** Translates MainAxisAlignment/CrossAxisAlignment to CSS flex props. */
function flexAlign(axis: 'main' | 'cross', v?: DartValue): string {
  if (!v || v.kind !== 'enum') {
    return axis === 'main' ? 'flex-start' : 'stretch';
  }
  const val = v.value.split('.').pop() || '';
  if (axis === 'main') {
    const map: Record<string, string> = {
      start: 'flex-start', center: 'center', end: 'flex-end',
      spaceBetween: 'space-between', spaceAround: 'space-around', spaceEvenly: 'space-evenly',
    };
    return map[val] || 'flex-start';
  }
  const map: Record<string, string> = {
    start: 'flex-start', center: 'center', end: 'flex-end', stretch: 'stretch', baseline: 'baseline',
  };
  return map[val] || 'stretch';
}

function getEdgeInsets(v?: DartValue): { padding?: string } {
  if (!v) return {};
  if (v.kind === 'raw') {
    // EdgeInsets.all(16) or EdgeInsets.symmetric(...)
    const allMatch = v.value.match(/all\s*\(\s*(\d+(?:\.\d+)?)\s*\)/);
    if (allMatch) return { padding: `${allMatch[1]}px` };
    const symMatch = v.value.match(/symmetric\s*\(\s*(?:vertical:\s*(\d+(?:\.\d+)?)\s*,?\s*)?(?:horizontal:\s*(\d+(?:\.\d+)?)\s*)?\)/);
    if (symMatch) {
      const v2 = symMatch[1] || '0';
      const h = symMatch[2] || '0';
      return { padding: `${v2}px ${h}px` };
    }
    const onlyMatch = v.value.match(/only\s*\(\s*(?:left:\s*(\d+(?:\.\d+)?)\s*,?\s*)?(?:top:\s*(\d+(?:\.\d+)?)\s*,?\s*)?(?:right:\s*(\d+(?:\.\d+)?)\s*,?\s*)?(?:bottom:\s*(\d+(?:\.\d+)?)\s*)?\)/);
    if (onlyMatch) {
      const l = onlyMatch[1] || '0', tp = onlyMatch[2] || '0', r = onlyMatch[3] || '0', b = onlyMatch[4] || '0';
      return { padding: `${tp}px ${r}px ${b}px ${l}px` };
    }
  }
  return {};
}

function getColor(v?: DartValue): string | undefined {
  if (!v) return undefined;
  if (v.kind === 'color') return v.value;
  if (v.kind === 'raw') return parseColorRaw(v.value);
  return undefined;
}

function parseColorRaw(token: string): string | undefined {
  const hex = token.match(/0x(?:FF)?([0-9A-Fa-f]{6,8})/);
  if (hex) return '#' + hex[1].slice(0, 6);
  const named = token.match(/^Colors?\.(red|pink|purple|deepPurple|indigo|blue|lightBlue|cyan|teal|green|lightGreen|lime|yellow|amber|orange|deepOrange|brown|grey|blueGrey|black|white)/);
  if (named) {
    const palette: Record<string, string> = {
      red: '#F44336', pink: '#E91E63', purple: '#9C27B0', deepPurple: '#673AB7',
      indigo: '#3F51B5', blue: '#2196F3', lightBlue: '#03A9F4', cyan: '#00BCD4',
      teal: '#009688', green: '#4CAF50', lightGreen: '#8BC34A', lime: '#CDDC39',
      yellow: '#FFEB3B', amber: '#FFC107', orange: '#FF9800', deepOrange: '#FF5722',
      brown: '#795548', grey: '#9E9E9E', blueGrey: '#607D8B', black: '#000000', white: '#FFFFFF',
    };
    return palette[named[1]];
  }
  return undefined;
}

const FONT_SIZES: Record<string, number> = {
  displayLarge: 32, displayMedium: 28, displaySmall: 24,
  headlineLarge: 22, headlineMedium: 20, headlineSmall: 18,
  titleLarge: 18, titleMedium: 16, titleSmall: 14,
  bodyLarge: 16, bodyMedium: 14, bodySmall: 12,
  labelLarge: 14, labelMedium: 12, labelSmall: 11,
};

function getDouble(v?: DartValue, fallback = 0): number {
  if (!v) return fallback;
  if (v.kind === 'number') return v.value;
  return fallback;
}

/**
 * Renders a DartNode tree to React elements. Returns null for unknown nodes
 * so they're silently skipped (the parser is tolerant by design).
 */
export function renderDartNode(node: DartNode, isDark: boolean, depth = 0): React.ReactNode {
  if (depth > 40) return null; // safety against deep recursion
  const { type, args, children, raw } = node;
  const childEls = children.map((c, i) => renderDartNode(c, isDark, depth + 1));

  switch (type) {
    case 'Scaffold': {
      const bg = getColor(args.backgroundColor);
      const body = args.body;
      const appBar = args.appBar;
      const fab = args.floatingActionButton;
      const bottomNav = args.bottomNavigationBar;
      return React.createElement('div', {
        key: `scaffold-${depth}`,
        style: {
          display: 'flex', flexDirection: 'column' as const, flex: 1, minHeight: 0,
          background: bg || (isDark ? '#121212' : '#FAFAFA'),
          color: isDark ? '#E0E0E0' : '#1E1E1E', position: 'relative' as const,
        },
      },
        appBar?.kind === 'node' ? renderDartNode(appBar.value, isDark, depth + 1) : null,
        React.createElement('div', {
          key: 'body', style: { flex: 1, overflowY: 'auto' as const, minHeight: 0, position: 'relative' as const },
        }, body?.kind === 'node' ? renderDartNode(body.value, isDark, depth + 1) : null),
        fab?.kind === 'node'
          ? React.createElement('div', {
              key: 'fab', style: { position: 'absolute' as const, right: 16, bottom: bottomNav?.kind === 'node' ? 72 : 16, zIndex: 20 },
            }, renderDartNode(fab.value, isDark, depth + 1))
          : null,
        bottomNav?.kind === 'node' ? renderDartNode(bottomNav.value, isDark, depth + 1) : null,
      );
    }
    case 'AppBar':
    case 'MaterialAppBar':
    case 'SliverAppBar': {
      const bg = getColor(args.backgroundColor) || (isDark ? '#1F1B24' : '#C58B51');
      const titleVal = args.title;
      let titleText = '';
      if (titleVal?.kind === 'node' && titleVal.value.type === 'Text') {
        titleText = valString(titleVal.value.args.data) || titleVal.value.raw || '';
      }
      return React.createElement('div', {
        key: `appbar-${depth}`,
        style: {
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          padding: '0 12px', height: 48, background: bg, color: '#fff',
          boxShadow: '0 1px 3px rgba(0,0,0,0.2)', flexShrink: 0,
        },
      },
        React.createElement('div', { style: { display: 'flex', alignItems: 'center', gap: 8, overflow: 'hidden' } },
          args.leading?.kind === 'node' ? renderDartNode(args.leading.value, isDark, depth + 1)
            : React.createElement(ArrowLeft, { size: 20, color: '#fff' }),
          React.createElement('span', { style: { fontWeight: 700, fontSize: 16, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' } }, titleText),
        ),
        React.createElement('div', { style: { display: 'flex', gap: 4 } },
          args.actions?.kind === 'list'
            ? args.actions.value.map((a, i) => a.kind === 'node' ? renderDartNode(a.value, isDark, depth + 1) : null)
            : null,
        ),
      );
    }
    case 'CupertinoNavigationBar': {
      const titleVal = args.title;
      let titleText = '';
      if (titleVal?.kind === 'node' && titleVal.value.type === 'Text') {
        titleText = valString(titleVal.value.args.data);
      }
      return React.createElement('div', {
        key: `cupnav-${depth}`,
        style: {
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          height: 44, background: isDark ? '#1C1C1E' : '#F8F8F8',
          borderBottom: `1px solid ${isDark ? '#38383A' : '#D1D1D6'}`, color: isDark ? '#fff' : '#000', fontWeight: 600, fontSize: 17, flexShrink: 0,
        },
      }, titleText);
    }
    case 'Text':
    case 'SelectableText': {
      const text = valString(args.data) || raw || '';
      const styleVal = args.style;
      let fontSize = 14, fontWeight: React.CSSProperties['fontWeight'] = 400, color: string | undefined;
      if (styleVal?.kind === 'node') {
        const s = styleVal.value.args;
        if (s.fontSize?.kind === 'number') fontSize = s.fontSize.value;
        if (s.fontWeight?.kind === 'raw') {
          const w = s.fontWeight.value.split('.').pop();
          const wm: Record<string, number> = { w100: 100, w200: 200, w300: 300, w400: 400, normal: 400, w500: 500, medium: 500, w600: 600, semibold: 600, w700: 700, bold: 700, w800: 800, w900: 900 };
          if (w) fontWeight = wm[w] || 400;
        }
        color = getColor(s.color);
      }
      if (args.fontSize?.kind === 'number') fontSize = args.fontSize.value;
      return React.createElement('span', {
        key: `text-${depth}`,
        style: { fontSize, fontWeight, color, textAlign: valString(args.textAlign) as any || 'left', display: 'block' },
      }, text);
    }
    case 'RichText': {
      // Best-effort: concatenate text spans
      const textSpan = args.text;
      let text = '';
      if (textSpan?.kind === 'node') {
        text = collectTextSpan(textSpan.value);
      }
      return React.createElement('span', { key: `rich-${depth}`, style: { fontSize: 14 } }, text);
    }
    case 'Column': {
      const ma = flexAlign('main', args.mainAxisAlignment);
      const ca = flexAlign('cross', args.crossAxisAlignment);
      return React.createElement('div', {
        key: `col-${depth}`, style: { display: 'flex', flexDirection: 'column' as const, gap: 8, justifyContent: ma, alignItems: ca, flex: 1 },
      }, ...childEls);
    }
    case 'Row': {
      const ma = flexAlign('main', args.mainAxisAlignment);
      const ca = flexAlign('cross', args.crossAxisAlignment);
      return React.createElement('div', {
        key: `row-${depth}`, style: { display: 'flex', flexDirection: 'row' as const, gap: 8, justifyContent: ma, alignItems: ca },
      }, ...childEls);
    }
    case 'Stack': {
      return React.createElement('div', {
        key: `stack-${depth}`, style: { position: 'relative' as const, flex: 1 },
      }, ...childEls);
    }
    case 'Wrap': {
      return React.createElement('div', {
        key: `wrap-${depth}`, style: { display: 'flex', flexWrap: 'wrap' as const, gap: 8 },
      }, ...childEls);
    }
    case 'Container': {
      const style: React.CSSProperties = { display: 'flex', flexDirection: 'column' as const };
      const pad = getEdgeInsets(args.padding);
      if (pad.padding) style.padding = pad.padding;
      const margin = getEdgeInsets(args.margin);
      if (margin.padding) style.margin = margin.padding;
      const bg = getColor(args.color);
      if (bg) style.background = bg;
      const width = getDouble(args.width);
      const height = getDouble(args.height);
      if (args.width?.kind === 'number') style.width = width;
      if (args.height?.kind === 'number') style.height = height;
      // decoration: BoxDecoration(...)
      if (args.decoration?.kind === 'node') {
        const dec = args.decoration.value.args;
        const decColor = getColor(dec.color);
        if (decColor) style.background = decColor;
        const radius = dec.borderRadius;
        if (radius?.kind === 'raw') {
          const rm = radius.value.match(/all\s*\(\s*(\d+(?:\.\d+)?)\s*\)/);
          if (rm) style.borderRadius = `${rm[1]}px`;
          const rc = radius.value.match(/circular\s*\(\s*(\d+(?:\.\d+)?)\s*\)/);
          if (rc) style.borderRadius = `${rc[1]}px`;
        }
        if (dec.boxShadow?.kind === 'list' && dec.boxShadow.value.length > 0) {
          style.boxShadow = '0 2px 8px rgba(0,0,0,0.12)';
        }
      }
      if (args.alignment?.kind === 'enum') {
        const a = args.alignment.value.split('.').pop();
        if (a === 'center') { style.justifyContent = 'center'; style.alignItems = 'center'; }
        else if (a === 'centerLeft') { style.alignItems = 'center'; }
        else if (a === 'centerRight') { style.alignItems = 'center'; style.justifyContent = 'flex-end'; }
      }
      return React.createElement('div', { key: `container-${depth}`, style }, ...childEls);
    }
    case 'Center':
      return React.createElement('div', {
        key: `center-${depth}`, style: { display: 'flex', justifyContent: 'center', alignItems: 'center', flex: 1 },
      }, ...childEls);
    case 'Padding': {
      const pad = getEdgeInsets(args.padding);
      return React.createElement('div', {
        key: `pad-${depth}`, style: { padding: pad.padding || '8px', display: 'flex', flexDirection: 'column' as const },
      }, ...childEls);
    }
    case 'SizedBox': {
      const w = args.width?.kind === 'number' ? args.width.value : undefined;
      const h = args.height?.kind === 'number' ? args.height.value : undefined;
      const style: React.CSSProperties = { display: 'flex', flexDirection: 'column' as const };
      if (w !== undefined) style.width = w;
      if (h !== undefined) style.height = h;
      if (args.child?.kind === 'node' && w === undefined && h === undefined) {
        style.flex = 1;
      }
      return React.createElement('div', { key: `sb-${depth}`, style },
        args.child?.kind === 'node' ? renderDartNode(args.child.value, isDark, depth + 1) : null);
    }
    case 'Align': {
      let justify: React.CSSProperties['justifyContent'] = 'flex-start', align: React.CSSProperties['alignItems'] = 'flex-start';
      if (args.alignment?.kind === 'enum') {
        const a = args.alignment.value.split('.').pop();
        if (a === 'center') { justify = 'center'; align = 'center'; }
        else if (a === 'centerLeft') { align = 'center'; }
        else if (a === 'centerRight') { align = 'center'; justify = 'flex-end'; }
        else if (a === 'topCenter') { justify = 'center'; }
        else if (a === 'bottomCenter') { justify = 'center'; align = 'flex-end'; }
      }
      return React.createElement('div', {
        key: `align-${depth}`, style: { display: 'flex', justifyContent: justify, alignItems: align, flex: 1 },
      }, ...childEls);
    }
    case 'Card': {
      const style: React.CSSProperties = {
        background: isDark ? '#1E1E1E' : '#fff', borderRadius: 12,
        boxShadow: '0 1px 3px rgba(0,0,0,0.12)', margin: 4, padding: 12,
        display: 'flex', flexDirection: 'column' as const, gap: 6,
      };
      const elev = args.elevation?.kind === 'number' ? args.elevation.value : 1;
      if (elev > 1) style.boxShadow = `0 ${elev}px ${elev * 2}px rgba(0,0,0,0.15)`;
      return React.createElement('div', { key: `card-${depth}`, style }, ...childEls);
    }
    case 'ListTile': {
      const titleVal = args.title;
      let titleText = '';
      if (titleVal?.kind === 'node' && titleVal.value.type === 'Text') titleText = valString(titleVal.value.args.data);
      const subVal = args.subtitle;
      let subText = '';
      if (subVal?.kind === 'node' && subVal.value.type === 'Text') subText = valString(subVal.value.args.data);
      const leading = args.leading;
      const trailing = args.trailing;
      return React.createElement('div', {
        key: `lt-${depth}`, style: {
          display: 'flex', alignItems: 'center', gap: 12, padding: '12px 16px',
          borderBottom: `1px solid ${isDark ? '#2C2C2C' : '#F0F0F0'}`, cursor: 'pointer',
        },
      },
        leading?.kind === 'node' ? renderDartNode(leading.value, isDark, depth + 1) : null,
        React.createElement('div', { style: { flex: 1, display: 'flex', flexDirection: 'column' as const, gap: 2, minWidth: 0 } },
          React.createElement('span', { style: { fontWeight: 600, fontSize: 15, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' } }, titleText),
          subText ? React.createElement('span', { style: { fontSize: 13, color: isDark ? '#9E9E9E' : '#757575' } }, subText) : null,
        ),
        trailing?.kind === 'node' ? renderDartNode(trailing.value, isDark, depth + 1)
          : React.createElement(ChevronRight, { size: 18, color: isDark ? '#9E9E9E' : '#BDBDBD' }),
      );
    }
    case 'ListView':
    case 'GridView':
    case 'SingleChildScrollView': {
      return React.createElement('div', {
        key: `lv-${depth}`, style: { display: 'flex', flexDirection: 'column' as const, gap: 0, flex: 1, overflowY: 'auto' as const },
      }, ...childEls);
    }
    case 'ElevatedButton':
    case 'FilledButton': {
      const label = args.child?.kind === 'node' && args.child.value.type === 'Text' ? valString(args.child.value.args.data) : 'Button';
      const bg = getColor(args.style?.kind === 'node' ? args.style.value.args.backgroundColor : undefined) || '#C58B51';
      const fg = getColor(args.style?.kind === 'node' ? args.style.value.args.foregroundColor : undefined) || '#fff';
      return React.createElement('button', {
        key: `eb-${depth}`, type: 'button',
        style: { padding: '10px 16px', borderRadius: 20, background: bg, color: fg, border: 'none', fontWeight: 600, fontSize: 14, cursor: 'pointer', width: '100%' },
      }, label);
    }
    case 'OutlinedButton': {
      const label = args.child?.kind === 'node' && args.child.value.type === 'Text' ? valString(args.child.value.args.data) : 'Button';
      return React.createElement('button', {
        key: `ob-${depth}`, type: 'button',
        style: { padding: '10px 16px', borderRadius: 20, background: 'transparent', color: '#C58B51', border: '1px solid #C58B51', fontWeight: 600, fontSize: 14, cursor: 'pointer', width: '100%' },
      }, label);
    }
    case 'TextButton': {
      const label = args.child?.kind === 'node' && args.child.value.type === 'Text' ? valString(args.child.value.args.data) : 'Button';
      return React.createElement('button', {
        key: `tb-${depth}`, type: 'button',
        style: { padding: '8px 12px', borderRadius: 20, background: 'transparent', color: '#C58B51', border: 'none', fontWeight: 600, fontSize: 14, cursor: 'pointer' },
      }, label);
    }
    case 'FloatingActionButton': {
      const iconNode = args.child?.kind === 'node' && args.child.value.type === 'Icon' ? args.child.value : null;
      const iconVal = iconNode?.args.icon;
      const bg = getColor(args.backgroundColor) || '#C58B51';
      return React.createElement('button', {
        key: `fab-${depth}`, type: 'button',
        style: { width: 56, height: 56, borderRadius: 16, background: bg, color: '#fff', border: 'none', display: 'flex', justifyContent: 'center', alignItems: 'center', cursor: 'pointer', boxShadow: '0 4px 8px rgba(0,0,0,0.3)' },
      }, iconVal?.kind === 'icon' ? renderIcon(iconVal.value, 24, '#fff') : React.createElement(Plus, { size: 24, color: '#fff' }));
    }
    case 'IconButton': {
      const iconNode = args.icon?.kind === 'node' && args.icon.value.type === 'Icon' ? args.icon.value : null;
      const iconVal = iconNode?.args.icon;
      const color = getColor(args.color) || (isDark ? '#fff' : '#1E1E1E');
      return React.createElement('button', {
        key: `ib-${depth}`, type: 'button',
        style: { padding: 8, borderRadius: 20, background: 'transparent', border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center' },
      }, iconVal?.kind === 'icon' ? renderIcon(iconVal.value, 22, color) : null);
    }
    case 'Icon': {
      const iconVal = args.icon;
      const size = args.size?.kind === 'number' ? args.size.value : 24;
      const color = getColor(args.color) || (isDark ? '#fff' : '#1E1E1E');
      return React.createElement('span', { key: `icon-${depth}`, style: { display: 'inline-flex' } },
        iconVal?.kind === 'icon' ? renderIcon(iconVal.value, size, color) : null);
    }
    case 'CircleAvatar': {
      const bg = getColor(args.backgroundColor) || '#C58B51';
      const radius = args.radius?.kind === 'number' ? args.radius.value : 20;
      const child = args.child;
      const initials = child?.kind === 'node' && child.value.type === 'Text' ? valString(child.value.args.data) : '';
      return React.createElement('div', {
        key: `ca-${depth}`, style: {
          width: radius * 2, height: radius * 2, borderRadius: '50%', background: bg,
          color: '#fff', display: 'flex', justifyContent: 'center', alignItems: 'center',
          fontWeight: 700, fontSize: radius * 0.8, flexShrink: 0,
        },
      }, initials || (child?.kind === 'node' ? renderDartNode(child.value, isDark, depth + 1) : null));
    }
    case 'Image':
    case 'Image.network': {
      const src = valString(args.src) || valString(args.imageUrl);
      const fallback = args.child?.kind === 'node' ? renderDartNode(args.child.value, isDark, depth + 1) : null;
      if (!src) return fallback;
      return React.createElement('img', {
        key: `img-${depth}`, src, alt: '', style: { maxWidth: '100%', maxHeight: 200, borderRadius: 8, objectFit: 'cover' as const },
        onError: (e: any) => { if (fallback && e.target) { e.target.style.display = 'none'; } },
      });
    }
    case 'TextField':
    case 'TextFormField': {
      const label = args.decoration?.kind === 'node' ? valString(args.decoration.value.args.labelText) || valString(args.decoration.value.args.hintText) : '';
      const hint = args.decoration?.kind === 'node' ? valString(args.decoration.value.args.hintText) : '';
      return React.createElement('input', {
        key: `tf-${depth}`, type: 'text', placeholder: hint || label,
        style: { padding: '12px 14px', borderRadius: 8, border: `1px solid ${isDark ? '#444' : '#E0E0E0'}`, background: isDark ? '#1E1E1E' : '#fff', color: isDark ? '#fff' : '#000', fontSize: 14, width: '100%', outline: 'none' },
      });
    }
    case 'Switch': {
      const val = args.value?.kind === 'bool' ? args.value.value : false;
      const activeColor = getColor(args.activeColor) || '#C58B51';
      return React.createElement('div', {
        key: `sw-${depth}`, style: { width: 44, height: 24, borderRadius: 12, background: val ? activeColor : (isDark ? '#444' : '#BDBDBD'), position: 'relative' as const, transition: 'background 0.2s' },
      }, React.createElement('div', { style: { position: 'absolute' as const, top: 2, left: val ? 22 : 2, width: 20, height: 20, borderRadius: '50%', background: '#fff', transition: 'left 0.2s' } }));
    }
    case 'Checkbox': {
      const val = args.value?.kind === 'bool' ? args.value.value : false;
      return React.createElement('div', {
        key: `cb-${depth}`, style: { width: 22, height: 22, borderRadius: 4, border: `2px solid ${val ? '#C58B51' : (isDark ? '#888' : '#666')}`, background: val ? '#C58B51' : 'transparent', display: 'flex', justifyContent: 'center', alignItems: 'center' },
      }, val ? React.createElement(Check, { size: 16, color: '#fff' }) : null);
    }
    case 'Divider': {
      return React.createElement('div', {
        key: `div-${depth}`, style: { height: 1, background: isDark ? '#2C2C2C' : '#E0E0E0', margin: '8px 0', width: '100%' },
      });
    }
    case 'VerticalDivider': {
      return React.createElement('div', {
        key: `vdiv-${depth}`, style: { width: 1, background: isDark ? '#2C2C2C' : '#E0E0E0', margin: '0 8px', alignSelf: 'stretch' as const },
      });
    }
    case 'Chip':
    case 'ActionChip':
    case 'InputChip': {
      const label = args.label?.kind === 'node' && args.label.value.type === 'Text' ? valString(args.label.value.args.data) : 'Chip';
      const bg = getColor(args.backgroundColor) || (isDark ? '#2C2C2C' : '#F0F0F0');
      return React.createElement('span', {
        key: `chip-${depth}`, style: { display: 'inline-flex', alignItems: 'center', padding: '4px 12px', borderRadius: 16, background: bg, fontSize: 12, fontWeight: 500 },
      }, label);
    }
    case 'CircularProgressIndicator': {
      const color = getColor(args.color) || '#C58B51';
      return React.createElement('div', {
        key: `cpi-${depth}`, style: { width: 32, height: 32, borderRadius: '50%', border: `3px solid ${isDark ? '#333' : '#E0E0E0'}`, borderTopColor: color, animation: 'spin 1s linear infinite' },
      });
    }
    case 'LinearProgressIndicator': {
      const color = getColor(args.color) || '#C58B51';
      return React.createElement('div', {
        key: `lpi-${depth}`, style: { height: 4, borderRadius: 2, background: isDark ? '#333' : '#E0E0E0', overflow: 'hidden' },
      }, React.createElement('div', { style: { width: '40%', height: '100%', background: color } }));
    }
    case 'BottomNavigationBar':
    case 'NavigationBar': {
      const items = args.items;
      const itemsArr: DartValue[] = items?.kind === 'list' ? items.value : [];
      return React.createElement('div', {
        key: `bn-${depth}`, style: { display: 'flex', justifyContent: 'space-around', height: 56, background: isDark ? '#1E1E1E' : '#fff', borderTop: `1px solid ${isDark ? '#2C2C2C' : '#E0E0E0'}`, flexShrink: 0 },
      }, itemsArr.map((item, i) => {
        if (item.kind !== 'node') return null;
        const iconNode = item.value.args.icon?.kind === 'node' ? item.value.args.icon.value : null;
        const iconVal = iconNode?.args.icon;
        const labelNode = item.value.args.label?.kind === 'node' ? item.value.args.label.value : null;
        const label = labelNode?.args.data?.kind === 'string' ? labelNode.args.data.value : '';
        return React.createElement('div', {
          key: `bn-${i}`, style: { display: 'flex', flexDirection: 'column' as const, alignItems: 'center', gap: 2, padding: '8px 0', flex: 1 },
        },
          iconVal?.kind === 'icon' ? renderIcon(iconVal.value, 20, i === 0 ? '#C58B51' : (isDark ? '#9E9E9E' : '#757575')) : null,
          React.createElement('span', { style: { fontSize: 11, fontWeight: 500, color: i === 0 ? '#C58B51' : (isDark ? '#9E9E9E' : '#757575') } }, label),
        );
      }));
    }
    case 'Opacity': {
      const op = args.opacity?.kind === 'node' ? getDouble(args.opacity.value.args.value) : 1;
      return React.createElement('div', { key: `op-${depth}`, style: { opacity: op } }, ...childEls);
    }
    case 'ClipRRect':
    case 'ClipOval':
    case 'Material':
    case 'ColoredBox':
    case 'DecoratedBox':
    case 'ConstrainedBox':
    case 'IntrinsicHeight':
    case 'IntrinsicWidth':
    case 'GestureDetector':
    case 'InkWell':
    case 'AspectRatio':
    case 'DefaultTabController':
    case 'ScaffoldMessenger':
    case 'SliverFillRemaining':
      return React.createElement(React.Fragment, { key: `frag-${depth}` }, ...childEls);
    case 'Raw':
      return null;
    default:
      // Unknown widget: render its children if any, else a subtle placeholder
      if (childEls.length > 0) return React.createElement('div', { key: `unk-${depth}`, style: { display: 'flex', flexDirection: 'column' as const } }, ...childEls);
      return null;
  }
}

function collectTextSpan(node: DartNode): string {
  if (node.type === 'TextSpan') {
    const text = valString(node.args.text);
    const childText = node.args.children?.kind === 'node' ? collectTextSpan(node.args.children.value) : '';
    return text + childText;
  }
  for (const c of node.children) {
    const t = collectTextSpan(c);
    if (t) return t;
  }
  return '';
}

// ============================================================
// Swift / SwiftUI renderer
// ============================================================

export interface SwiftParseResult {
  bodyView: string; // cleaned Swift source body to render
  errors: string[];
  navigationTitle: string;
  backgroundColor: string;
  texts: string[];
  buttons: { label: string; role?: string }[];
  hstacks: number;
  vstacks: number;
  lists: { items: string[] };
  hasTabView: boolean;
  tabItems: { label: string; systemImage: string }[];
  hasForm: boolean;
  hasImage: boolean;
}

export function parseSwift(code: string): SwiftParseResult {
  const errors: string[] = [];
  // Balance check
  let parens = 0, braces = 0;
  let inStr: string | null = null;
  for (let i = 0; i < code.length; i++) {
    const c = code[i];
    if (inStr) { if (c === '\\') { i++; continue; } if (c === inStr) inStr = null; continue; }
    if (c === '"' ) { inStr = '"'; continue; }
    if (c === '(') parens++;
    if (c === ')') parens--;
    if (c === '{') braces++;
    if (c === '}') braces--;
  }
  if (parens !== 0) errors.push(`${parens} unbalanced '(' in Swift source`);
  if (braces !== 0) errors.push(`${braces} unbalanced '{' in Swift source`);

  const navMatch = code.match(/\.navigationTitle\s*\(\s*"([^"]*)"\s*\)/);
  const navigationTitle = navMatch ? navMatch[1] : 'SwiftUI View';

  const bgMatch = code.match(/\.background\s*\(\s*Color(?:\.\w+)?\s*\)/);
  const backgroundColor = '#FAFAFA';

  // Extract Text("...")
  const texts: string[] = [];
  const textMatches = code.matchAll(/Text\s*\(\s*"([^"]*)"\s*\)/g);
  for (const m of textMatches) if (m[1] && !texts.includes(m[1])) texts.push(m[1]);

  // Buttons
  const buttons: { label: string; role?: string }[] = [];
  const btnMatches = code.matchAll(/Button\s*\(\s*(?:action:\s*\{[^}]*\}\s*,?\s*)?"([^"]*)"\s*\)/g);
  for (const m of btnMatches) buttons.push({ label: m[1] });
  const btnActionMatches = code.matchAll(/Button\s*\(\s*"([^"]*)"\s*,/g);
  for (const m of btnActionMatches) if (!buttons.find((b) => b.label === m[1])) buttons.push({ label: m[1] });

  const hstacks = (code.match(/\bHStack\b/g) || []).length;
  const vstacks = (code.match(/\bVStack\b/g) || []).length;

  // List items: List { ... } or ForEach
  const lists: { items: string[] } = { items: [] };
  const listTextMatches = code.matchAll(/Text\s*\(\s*"([^"]*)"\s*\)/g);
  for (const m of listTextMatches) {
    if (!lists.items.includes(m[1])) lists.items.push(m[1]);
  }

  const hasTabView = /\bTabView\b/.test(code);
  const tabItems: { label: string; systemImage: string }[] = [];
  const tabMatches = code.matchAll(/Tab\s*\(\s*"([^"]*)"[^)]*?systemImage:\s*"([^"]*)"/g);
  for (const m of tabMatches) tabItems.push({ label: m[1], systemImage: m[2] });

  const hasForm = /\bForm\b/.test(code);
  const hasImage = /\bImage\b|\bAsyncImage\b/.test(code);

  return {
    bodyView: code, errors, navigationTitle, backgroundColor, texts, buttons,
    hstacks, vstacks, lists, hasTabView, tabItems, hasForm, hasImage,
  };
}

export function renderSwift(parsed: SwiftParseResult, isDark: boolean): React.ReactNode {
  const textColor = isDark ? '#fff' : '#000';
  const bg = isDark ? '#000' : '#F2F2F7';
  const cardBg = isDark ? '#1C1C1E' : '#fff';
  const separator = isDark ? '#38383A' : '#D1D1D6';

  const children: React.ReactNode[] = [];

  // Form / list rows
  if (parsed.hasForm || parsed.lists.items.length > 0) {
    const items = parsed.lists.items.length > 0 ? parsed.lists.items : parsed.texts;
    items.forEach((text, i) => {
      children.push(
        React.createElement('div', {
          key: `row-${i}`, style: { background: cardBg, padding: '12px 16px', borderBottom: `1px solid ${separator}`, display: 'flex', justifyContent: 'space-between', alignItems: 'center' },
        },
          React.createElement('span', { style: { fontSize: 16, color: textColor } }, text),
          React.createElement(ChevronRight, { size: 16, color: separator }),
        ),
      );
    });
  } else {
    // VStack of Texts
    parsed.texts.forEach((text, i) => {
      children.push(React.createElement('div', {
        key: `text-${i}`, style: { fontSize: 17, color: textColor, padding: '4px 0' },
      }, text));
    });
  }

  // Buttons
  parsed.buttons.forEach((btn, i) => {
    children.push(React.createElement('button', {
      key: `btn-${i}`, type: 'button',
      style: { background: '#007AFF', color: '#fff', border: 'none', borderRadius: 12, padding: '12px', fontSize: 17, fontWeight: 600, width: '100%', cursor: 'pointer', marginTop: 8 },
    }, btn.label));
  });

  return React.createElement('div', {
    style: { display: 'flex', flexDirection: 'column' as const, padding: 16, gap: 8, background: bg, minHeight: '100%', color: textColor },
  }, ...children);
}

// ============================================================
// Kotlin / Jetpack Compose renderer
// ============================================================

export interface KotlinParseResult {
  errors: string[];
  appTitle: string;
  texts: string[];
  buttons: { label: string }[];
  listItems: string[];
  hasTopBar: boolean;
  hasBottomBar: boolean;
  bottomItems: { label: string; icon: string }[];
  hasTextField: boolean;
  hasImage: boolean;
  hasCard: boolean;
  hasRow: boolean;
  hasColumn: boolean;
}

export function parseKotlin(code: string): KotlinParseResult {
  const errors: string[] = [];
  let parens = 0, braces = 0;
  let inStr: string | null = null;
  for (let i = 0; i < code.length; i++) {
    const c = code[i];
    if (inStr) { if (c === '\\') { i++; continue; } if (c === inStr) inStr = null; continue; }
    if (c === '"') { inStr = '"'; continue; }
    if (c === '(') parens++;
    if (c === ')') parens--;
    if (c === '{') braces++;
    if (c === '}') braces--;
  }
  if (parens !== 0) errors.push(`${parens} unbalanced '(' in Kotlin source`);
  if (braces !== 0) errors.push(`${braces} unbalanced '{' in Kotlin source`);

  const titleMatch = code.match(/TopAppBar\s*\([^)]*?title\s*=\s*\{\s*Text\s*\(\s*"([^"]*)"\s*\)/);
  const appTitle = titleMatch ? titleMatch[1] : 'Compose App';

  const texts: string[] = [];
  const textMatches = code.matchAll(/Text\s*\(\s*"([^"]*)"\s*(?:,[^)]*)?\)/g);
  for (const m of textMatches) if (m[1] && !texts.includes(m[1])) texts.push(m[1]);

  const buttons: { label: string }[] = [];
  const btnMatches = code.matchAll(/Button\s*\(\s*(?:onClick[^,]*,\s*)?\{\s*\}\s*\)\s*\{\s*Text\s*\(\s*"([^"]*)"\s*\)/g);
  for (const m of btnMatches) buttons.push({ label: m[1] });

  const hasTopBar = /\bTopAppBar\b/.test(code);
  const hasBottomBar = /\bNavigationBar\b|\bBottomNavigation\b/.test(code);
  const bottomItems: { label: string; icon: string }[] = [];
  const navMatches = code.matchAll(/NavigationBarItem\s*\([^)]*?label\s*=\s*\{\s*Text\s*\(\s*"([^"]*)"\s*\)\s*\}[^)]*?icon\s*=\s*\{\s*Icon\s*\(\s*Icons\.\w+\.(\w+)/g);
  for (const m of navMatches) bottomItems.push({ label: m[1], icon: m[2] });

  return {
    errors, appTitle, texts, buttons, listItems: texts,
    hasTopBar, hasBottomBar, bottomItems, hasTextField: /\bTextField\b|\bOutlinedTextField\b/.test(code),
    hasImage: /\bImage\b/.test(code), hasCard: /\bCard\b/.test(code),
    hasRow: /\bRow\b/.test(code), hasColumn: /\bColumn\b/.test(code),
  };
}

export function renderKotlin(parsed: KotlinParseResult, isDark: boolean): React.ReactNode {
  const textColor = isDark ? '#fff' : '#1E1E1E';
  const bg = isDark ? '#121212' : '#FAFAFA';
  const cardBg = isDark ? '#1E1E1E' : '#fff';
  const separator = isDark ? '#2C2C2C' : '#F0F0F0';

  const children: React.ReactNode[] = [];
  parsed.texts.forEach((text, i) => {
    children.push(React.createElement('div', {
      key: `t-${i}`, style: { fontSize: 16, color: textColor, padding: '8px 0' },
    }, text));
  });
  if (parsed.hasTextField) {
    children.push(React.createElement('input', {
      key: 'kt-tf', type: 'text', placeholder: 'Enter text',
      style: { padding: '12px 14px', borderRadius: 8, border: `1px solid ${separator}`, background: cardBg, color: textColor, fontSize: 14, width: '100%', outline: 'none' },
    }));
  }
  parsed.buttons.forEach((btn, i) => {
    children.push(React.createElement('button', {
      key: `kt-btn-${i}`, type: 'button',
      style: { background: '#6750A4', color: '#fff', border: 'none', borderRadius: 20, padding: '10px 16px', fontSize: 14, fontWeight: 600, width: '100%', cursor: 'pointer', marginTop: 8 },
    }, btn.label));
  });

  return React.createElement('div', {
    style: { display: 'flex', flexDirection: 'column' as const, padding: 16, gap: 8, background: bg, minHeight: '100%', color: textColor },
  }, ...children);
}
