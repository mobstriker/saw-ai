/**
 * DartWidgetParser — a lightweight Dart/Flutter source parser that produces a
 * serializable widget tree the simulator can render to real Material/Cupertino
 * DOM. This is NOT a full Dart compiler — it targets the common Flutter widget
 * vocabulary (Scaffold, AppBar, Column, Row, Text, Container, Card, ListView,
 * ListTile, ElevatedButton, Icon, etc.) so the phone preview mirrors what the
 * code actually describes instead of a hardcoded mock.
 *
 * The parser is deliberately tolerant: anything it cannot understand becomes a
 * generic node carrying the raw text, and structural errors (unbalanced
 * braces/parens) are reported as bugs for the debug button (Feature 3).
 */

export interface DartNode {
  type: string; // 'Scaffold' | 'AppBar' | 'Text' | 'Column' | ... | 'Raw'
  children: DartNode[];
  args: Record<string, DartValue>;
  raw?: string;
}

export type DartValue =
  | { kind: 'string'; value: string }
  | { kind: 'number'; value: number }
  | { kind: 'bool'; value: boolean }
  | { kind: 'color'; value: string }
  | { kind: 'icon'; value: string }
  | { kind: 'node'; value: DartNode }
  | { kind: 'list'; value: DartValue[] }
  | { kind: 'enum'; value: string }
  | { kind: 'raw'; value: string };

export interface ParseResult {
  root: DartNode | null;
  errors: string[];
  extractedTexts: string[];
  appBarTitle: string;
  appTitle: string;
  hasFab: boolean;
  fabIcon: string;
  hasBottomNav: boolean;
  bottomNavItems: { icon: string; label: string }[];
}

class Tokenizer {
  private i = 0;
  constructor(readonly src: string) {}

  peek(): string {
    return this.src[this.i] ?? '';
  }
  peek2(): string {
    return this.src.slice(this.i, this.i + 2);
  }
  next(): string {
    return this.src[this.i++] ?? '';
  }

  /** Skips whitespace, comments, and string contents until a meaningful char. */
  skipNoise() {
    while (this.i < this.src.length) {
      const c = this.peek();
      const c2 = this.peek2();
      if (/\s/.test(c)) { this.i++; continue; }
      if (c2 === '//') { this.skipLineComment(); continue; }
      if (c2 === '/*') { this.skipBlockComment(); continue; }
      if (c === '"' || c === "'") { this.skipString(); continue; }
      break;
    }
  }

  private skipLineComment() {
    this.i += 2;
    while (this.i < this.src.length && this.peek() !== '\n') this.i++;
  }
  private skipBlockComment() {
    this.i += 2;
    while (this.i < this.src.length && this.peek2() !== '*/') this.i++;
    this.i = Math.min(this.i + 2, this.src.length);
  }
  /** Consumes a string literal (returns its decoded value). */
  readString(): string | null {
    const quote = this.peek();
    if (quote !== '"' && quote !== "'") return null;
    this.i++;
    let out = '';
    while (this.i < this.src.length) {
      const c = this.next();
      if (c === quote) return out;
      if (c === '\\') {
        const esc = this.next();
        const map: Record<string, string> = { n: '\n', t: '\t', r: '\r', '\\': '\\', "'": "'", '"': '"', '$': '$' };
        out += map[esc] ?? esc;
      } else if (c === '$' && this.peek() === '{') {
        // string interpolation ${expr} — capture a placeholder
        this.i++;
        let depth = 1;
        let expr = '';
        while (this.i < this.src.length && depth > 0) {
          const ec = this.next();
          if (ec === '{') depth++;
          else if (ec === '}') { depth--; if (depth === 0) break; }
          expr += ec;
        }
        out += `\${${expr.trim()}}`;
      } else {
        out += c;
      }
    }
    return out;
  }

  private skipString() {
    this.readString();
  }

  /** Reads an identifier (letters, digits, _). */
  readIdent(): string {
    let out = '';
    while (this.i < this.src.length && /[A-Za-z0-9_]/.test(this.peek())) out += this.next();
    return out;
  }

  /** Reads a number literal. */
  readNumber(): number | null {
    let out = '';
    while (this.i < this.src.length && /[0-9.eE+\-xXa-fA-F]/.test(this.peek())) {
      // stop if it's clearly not part of number (e.g. after a complete number followed by letter)
      out += this.next();
    }
    const n = Number(out);
    return isNaN(n) ? null : n;
  }

  /** Returns the raw source from current position (for diagnostics). */
  rest(): string {
    return this.src.slice(this.i, this.i + 40);
  }

  pos(): number {
    return this.i;
  }
  setPos(p: number) {
    this.i = p;
  }
  length(): number {
    return this.src.length;
  }
  /** Reads raw until the matching closing bracket starting at current pos. */
  rawUntilClose(open: string, close: string): string {
    let depth = 0;
    let out = '';
    let inStr: string | null = null;
    while (this.i < this.src.length) {
      const c = this.peek();
      if (inStr) {
        out += this.next();
        if (c === '\\') { out += this.next(); continue; }
        if (c === inStr) inStr = null;
        continue;
      }
      if (c === '"' || c === "'") { inStr = c; out += this.next(); continue; }
      if (c === '/' && this.peek2() === '/') {
        while (this.i < this.src.length && this.peek() !== '\n') out += this.next();
        continue;
      }
      if (c === open) { depth++; out += this.next(); continue; }
      if (c === close) {
        if (depth === 0) return out;
        depth--;
        out += this.next();
        continue;
      }
      out += this.next();
    }
    return out;
  }
}

const KNOWN_WIDGETS = new Set([
  'Scaffold', 'AppBar', 'MaterialAppBar', 'CupertinoNavigationBar', 'SliverAppBar',
  'Text', 'RichText', 'SelectableText', 'TextField', 'TextFormField', ' TextFormField',
  'Container', 'Center', 'Padding', 'SizedBox', 'Align', 'FractionallySizedBox',
  'Column', 'Row', 'Stack', 'Wrap', 'Flex', 'ListView', 'GridView', 'SingleChildScrollView',
  'Card', 'ListTile', 'ExpansionTile', 'Drawer', 'DrawerHeader', 'UserAccountsDrawerHeader',
  'ElevatedButton', 'FilledButton', 'TextButton', 'OutlinedButton', 'FloatingActionButton',
  'IconButton', 'InkWell', 'GestureDetector', 'DropdownButton',
  'Icon', 'Image', 'CircleAvatar', 'Divider', 'VerticalDivider', 'SizedBox',
  'Switch', 'Checkbox', 'Radio', 'Slider', 'ProgressBar', 'LinearProgressIndicator',
  'CircularProgressIndicator', 'Chip', 'ActionChip', 'InputChip', 'Badge', 'Tooltip',
  'BottomNavigationBar', 'NavigationBar', 'TabBar', 'BottomAppBar', 'SnackBar',
  'Material', 'ColoredBox', 'DecoratedBox', 'ClipRRect', 'ClipOval', 'Opacity',
  'AspectRatio', 'ConstrainedBox', 'IntrinsicHeight', 'IntrinsicWidth',
  'DefaultTabController', 'TabBarView', 'ScaffoldMessenger',
]);

function parseColor(token: string): string | null {
  const t = token.trim();
  // Color(0xFFRRGGBB)
  const hex = t.match(/0x(?:FF)?([0-9A-Fa-f]{6,8})/);
  if (hex) {
    return '#' + hex[1].slice(0, 6);
  }
  // Colors.name or Colors.name.shade
  const named = t.match(/^Colors?\.(red|pink|purple|deepPurple|indigo|blue|lightBlue|cyan|teal|green|lightGreen|lime|yellow|amber|orange|deepOrange|brown|grey|blueGrey|black|white)(?:\.([a-zA-Z0-9]+))?/);
  if (named) {
    const base = named[1];
    const shade = named[2];
    const palette: Record<string, string> = {
      red: '#F44336', pink: '#E91E63', purple: '#9C27B0', deepPurple: '#673AB7',
      indigo: '#3F51B5', blue: '#2196F3', lightBlue: '#03A9F4', cyan: '#00BCD4',
      teal: '#009688', green: '#4CAF50', lightGreen: '#8BC34A', lime: '#CDDC39',
      yellow: '#FFEB3B', amber: '#FFC107', orange: '#FF9800', deepOrange: '#FF5722',
      brown: '#795548', grey: '#9E9E9E', blueGrey: '#607D8B', black: '#000000', white: '#FFFFFF',
    };
    let hexColor = palette[base] || '#9E9E9E';
    // Apply shade darkening/lightening for numeric shades
    if (shade && /^\d+$/.test(shade)) {
      const shadeNum = parseInt(shade, 10);
      hexColor = adjustShade(hexColor, shadeNum);
    }
    return hexColor;
  }
  // CupertinoColors
  const cup = t.match(/^CupertinoColors?\.(activeBlue|black|white|systemRed|systemGreen|systemBlue|systemGrey|systemOrange)/);
  if (cup) {
    const map: Record<string, string> = {
      activeBlue: '#007AFF', black: '#000000', white: '#FFFFFF',
      systemRed: '#FF3B30', systemGreen: '#34C759', systemBlue: '#007AFF',
      systemGrey: '#8E8E93', systemOrange: '#FF9500',
    };
    return map[cup[1]] || '#007AFF';
  }
  return null;
}

function adjustShade(hex: string, shade: number): string {
  // Material shades: 50 (lightest) .. 900 (darkest), 500 is base
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  const factor = shade < 500 ? (500 - shade) / 500 * 0.85 : (shade - 500) / 400 * 0.6;
  const mix = (c: number) => shade < 500
    ? Math.round(c + (255 - c) * factor)
    : Math.round(c * (1 - factor));
  const toHex = (n: number) => Math.max(0, Math.min(255, n)).toString(16).padStart(2, '0');
  return `#${toHex(mix(r))}${toHex(mix(g))}${toHex(mix(b))}`;
}

function iconFromCode(token: string): string | null {
  const m = token.match(/Icons?(?:_rounded|_outlined|_sharp)?\.([a-zA-Z0-9_]+)/);
  if (m) return m[1];
  const cup = token.match(/CupertinoIcons?\.([a-zA-Z0-9_]+)/);
  if (cup) return cup[1];
  return null;
}

/**
 * Recursively parses a widget constructor call starting at the current
 * tokenizer position (just after the widget identifier). Returns the DartNode
 * and leaves the tokenizer positioned after the matching closing paren.
 */
function parseWidget(t: Tokenizer, widgetName: string): DartNode {
  const node: DartNode = { type: widgetName, children: [], args: {} };
  t.skipNoise();
  // Expect '('
  if (t.peek() !== '(') {
    // Not a constructor call — treat as raw
    node.raw = widgetName;
    return node;
  }
  t.next(); // consume '('
  let depth = 1;
  while (t.pos() < t.length() && depth > 0) {
    t.skipNoise();
    const c = t.peek();
    if (c === '') break;
    if (c === ')') { depth--; t.next(); if (depth === 0) break; continue; }
    if (c === '(') { t.next(); depth++; continue; }

    // Could be a named param `key: value` or a positional child widget.
    const saved = t.pos();
    const ident = t.readIdent();
    t.skipNoise();
    if (ident && t.peek() === ':') {
      t.next(); // consume ':'
      const value = parseValue(t, widgetName, ident);
      if (value) {
        if (value.kind === 'node') {
          // children: <Widget>[...] -> list; child: Widget(...) -> single node
          node.children.push(value.value);
          node.args[ident] = value;
        } else if (value.kind === 'list') {
          for (const item of value.value) {
            if (item.kind === 'node') node.children.push(item.value);
          }
          node.args[ident] = value;
        } else {
          node.args[ident] = value;
        }
      }
      t.skipNoise();
      // consume optional trailing comma
      if (t.peek() === ',') t.next();
      continue;
    }
    // Not a named param; rewind and try a positional child widget.
    t.setPos(saved);
    const childName = t.readIdent();
    t.skipNoise();
    if (childName && (KNOWN_WIDGETS.has(childName) || isCapitalized(childName)) && t.peek() === '(') {
      const childNode = parseWidget(t, childName);
      node.children.push(childNode);
      t.skipNoise();
      if (t.peek() === ',') t.next();
      continue;
    }
    // Unknown token — skip one char to avoid infinite loop
    t.next();
  }
  return node;
}

function isCapitalized(s: string): boolean {
  return !!s && /[A-Z]/.test(s[0]);
}

function parseValue(t: Tokenizer, _parentWidget: string, _paramName: string): DartValue | null {
  t.skipNoise();
  const c = t.peek();
  // const Widget(...)
  if (c && /[a-zA-Z_]/.test(c)) {
    let prefix = '';
    if (t.peek2() === 'co' && t.src.slice(t.pos(), t.pos() + 5) === 'const') {
      prefix = 'const';
      for (let i = 0; i < 5; i++) t.next();
      t.skipNoise();
    }
    const ident = t.readIdent();
    t.skipNoise();
    if (t.peek() === '(') {
      // Widget constructor or Color()/Icons/EdgeInsets/etc.
      const fullToken = (prefix ? prefix + ' ' : '') + ident;
      // Color literal
      const color = parseColor(fullToken + peekRawParen(t));
      if (color) {
        consumeParen(t);
        return { kind: 'color', value: color };
      }
      // Icon
      const icon = iconFromCode(fullToken);
      if (icon) {
        consumeParen(t);
        return { kind: 'icon', value: icon };
      }
      // Widget node
      const node = parseWidget(t, ident);
      return { kind: 'node', value: node };
    }
    // enum like MainAxisAlignment.center
    if (t.peek() === '.') {
      t.next();
      const enumVal = t.readIdent();
      return { kind: 'enum', value: `${ident}.${enumVal}` };
    }
    // bare identifier (true/false/null)
    if (ident === 'true') return { kind: 'bool', value: true };
    if (ident === 'false') return { kind: 'bool', value: false };
    return { kind: 'raw', value: ident };
  }
  // String
  if (c === '"' || c === "'") {
    const s = t.readString();
    if (s !== null) return { kind: 'string', value: s };
  }
  // Number
  if (c && /[0-9.\-]/.test(c)) {
    const n = t.readNumber();
    if (n !== null) return { kind: 'number', value: n };
  }
  // List <Widget>[...] or [...]
  if (c === '<' || c === '[') {
    return parseList(t);
  }
  return null;
}

/** Peeks at the raw parenthesized content without consuming. */
function peekRawParen(t: Tokenizer): string {
  const saved = t.pos();
  if (t.peek() !== '(') return '';
  t.next();
  const raw = t.rawUntilClose('(', ')');
  t.setPos(saved);
  return '(' + raw + ')';
}

function consumeParen(t: Tokenizer) {
  t.skipNoise();
  if (t.peek() === '(') {
    t.next();
    t.rawUntilClose('(', ')');
    if (t.peek() === ')') t.next();
  }
}

function parseList(t: Tokenizer): DartValue {
  t.skipNoise();
  // skip optional <Widget> or <BottomNavigationBarItem> generic
  if (t.peek() === '<') {
    t.next();
    while (t.pos() < t.length() && t.peek() !== '>') t.next();
    if (t.peek() === '>') t.next();
    t.skipNoise();
  }
  if (t.peek() !== '[') return { kind: 'list', value: [] };
  t.next();
  const items: DartValue[] = [];
  let depth = 1;
  while (t.pos() < t.length() && depth > 0) {
    t.skipNoise();
    const c = t.peek();
    if (c === '') break;
    if (c === ']') { depth--; t.next(); if (depth === 0) break; continue; }
    if (c === '[') { t.next(); depth++; continue; }
    // Parse a list element (could be a widget or BottomNavigationBarItem)
    const saved = t.pos();
    // optional const
    if (t.peek2() === 'co' && t.src.slice(t.pos(), t.pos() + 5) === 'const') {
      for (let i = 0; i < 5; i++) t.next();
      t.skipNoise();
    }
    const ident = t.readIdent();
    t.skipNoise();
    if (ident && t.peek() === '(') {
      // BottomNavigationBarItem or a widget
      if (KNOWN_WIDGETS.has(ident) || isCapitalized(ident)) {
        const node = parseWidget(t, ident);
        items.push({ kind: 'node', value: node });
        t.skipNoise();
        if (t.peek() === ',') t.next();
        continue;
      }
      // Some other constructor (e.g. BottomNavigationBarItem) — parse as node
      const node = parseWidget(t, ident);
      items.push({ kind: 'node', value: node });
      t.skipNoise();
      if (t.peek() === ',') t.next();
      continue;
    }
    // Fallback: skip one char
    t.setPos(saved);
    t.next();
  }
  return { kind: 'list', value: items };
}

/** Validates brace/paren balance and reports structural errors. */
function checkBalance(src: string): string[] {
  const errors: string[] = [];
  let parens = 0, braces = 0, brackets = 0;
  let inStr: string | null = null;
  let line = 1;
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (c === '\n') line++;
    if (inStr) {
      if (c === '\\') { i++; continue; }
      if (c === inStr) inStr = null;
      continue;
    }
    if (c === '"' || c === "'") { inStr = c; continue; }
    if (c === '/' && src[i + 1] === '/') { while (i < src.length && src[i] !== '\n') i++; line++; continue; }
    if (c === '/' && src[i + 1] === '*') { i += 2; while (i < src.length && !(src[i] === '*' && src[i + 1] === '/')) { if (src[i] === '\n') line++; i++; } i++; continue; }
    if (c === '(') parens++;
    if (c === ')') { parens--; if (parens < 0) errors.push(`Unmatched ')' at line ${line}`); }
    if (c === '{') braces++;
    if (c === '}') { braces--; if (braces < 0) errors.push(`Unmatched '}' at line ${line}`); }
    if (c === '[') brackets++;
    if (c === ']') { brackets--; if (brackets < 0) errors.push(`Unmatched ']' at line ${line}`); }
  }
  if (parens > 0) errors.push(`${parens} unclosed '(' in Dart source`);
  if (braces > 0) errors.push(`${braces} unclosed '{' in Dart source`);
  if (brackets > 0) errors.push(`${brackets} unclosed '[' in Dart source`);
  return errors;
}

export function parseDart(code: string): ParseResult {
  const errors: string[] = checkBalance(code);
  const extractedTexts: string[] = [];
  const t = new Tokenizer(code);
  let root: DartNode | null = null;

  // App-level title
  const appTitleMatch = code.match(/(?:MaterialApp|CupertinoApp|WidgetsApp)\s*\([^)]*?title:\s*['"]([^'"]+)['"]/is);
  const appTitle = appTitleMatch ? appTitleMatch[1] : 'Flutter App';

  // Find the first build() return widget, or first top-level known widget.
  // Strategy: scan for `return <Widget>(` and parse it.
  let found = false;
  while (t.pos() < t.length() && !found) {
    t.skipNoise();
    const saved = t.pos();
    const ident = t.readIdent();
    t.skipNoise();
    if ((ident === 'return' || ident === 'const') && t.peek() !== '(') {
      // could be "return const Widget(" or "return Widget("
      const nextIdent = t.readIdent();
      t.skipNoise();
      if (nextIdent && t.peek() === '(' && (KNOWN_WIDGETS.has(nextIdent) || isCapitalized(nextIdent))) {
        root = parseWidget(t, nextIdent);
        found = true;
        break;
      }
      t.setPos(saved);
      t.next();
      continue;
    }
    if (ident && t.peek() === '(' && (KNOWN_WIDGETS.has(ident) || ident === 'Scaffold' || ident === 'MaterialApp' || ident === 'CupertinoApp')) {
      // Only treat MaterialApp/Scaffold/WidgetsApp as root candidates
      if (ident === 'Scaffold' || ident === 'MaterialApp' || ident === 'CupertinoApp' || ident === 'WidgetsApp') {
        root = parseWidget(t, ident);
        found = true;
        break;
      }
    }
    if (!ident) { t.next(); continue; }
    // rewind to saved and advance one to keep scanning
    t.setPos(saved);
    t.next();
  }

  // Collect all Text('...') strings for diagnostics
  const textMatches = code.matchAll(/Text\s*\(\s*['"]([^'"]{1,80})['"]/g);
  for (const m of textMatches) {
    if (m[1] && !extractedTexts.includes(m[1])) extractedTexts.push(m[1]);
  }

  // Derive appBarTitle, fab, bottomNav from the tree
  let appBarTitle = appTitle;
  let hasFab = false;
  let fabIcon = 'add';
  let hasBottomNav = false;
  let bottomNavItems: { icon: string; label: string }[] = [];

  const scaffold = root?.type === 'Scaffold' ? root : root?.children.find((c) => c.type === 'Scaffold') || findDeep(root, 'Scaffold');
  if (scaffold) {
    const appBarVal = scaffold.args.appBar;
    if (appBarVal?.kind === 'node') {
      const titleVal = appBarVal.value.args.title;
      if (titleVal?.kind === 'node' && titleVal.value.type === 'Text') {
        const dataVal = titleVal.value.args.data;
        if (dataVal?.kind === 'string') appBarTitle = dataVal.value;
        else if (titleVal.value.raw) appBarTitle = titleVal.value.raw;
      }
    }
    const fabVal = scaffold.args.floatingActionButton;
    if (fabVal?.kind === 'node') {
      hasFab = true;
      const child = fabVal.value.args.child;
      if (child?.kind === 'node' && child.value.type === 'Icon') {
        const iconVal = child.value.args.icon;
        if (iconVal?.kind === 'icon') fabIcon = iconVal.value;
      }
    }
    const bnVal = scaffold.args.bottomNavigationBar;
    if (bnVal?.kind === 'node') {
      hasBottomNav = true;
      const itemsVal = bnVal.value.args.items;
      if (itemsVal?.kind === 'list') {
        for (const item of itemsVal.value) {
          if (item.kind === 'node') {
            const iconNode = item.value.args.icon;
            const labelNode = item.value.args.label;
            let icon = 'home';
            let label = 'Tab';
            if (iconNode?.kind === 'node' && iconNode.value.type === 'Icon') {
              const iv = iconNode.value.args.icon;
              if (iv?.kind === 'icon') icon = iv.value;
            }
            if (labelNode?.kind === 'node' && labelNode.value.type === 'Text') {
              const dv = labelNode.value.args.data;
              if (dv?.kind === 'string') label = dv.value;
            }
            bottomNavItems.push({ icon, label });
          }
        }
      }
    }
  }

  if (!root) {
    errors.push('Could not locate a Scaffold/MaterialApp widget to render — the Dart source may be incomplete.');
  }

  return {
    root,
    errors,
    extractedTexts,
    appBarTitle,
    appTitle,
    hasFab,
    fabIcon,
    hasBottomNav,
    bottomNavItems,
  };
}

function findDeep(node: DartNode | null, type: string): DartNode | null {
  if (!node) return null;
  if (node.type === type) return node;
  for (const c of node.children) {
    const found = findDeep(c, type);
    if (found) return found;
  }
  return null;
}
