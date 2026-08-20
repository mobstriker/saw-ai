import { Artifact } from '../types';

/**
 * Maps a code-block language to its canonical file extension.
 * Used as the final fallback so artifacts always carry a real filename
 * (e.g. "main.dart") instead of the old "Snippet N (DART)" placeholder.
 */
export const LANG_EXTENSION: Record<string, string> = {
  html: 'html',
  htm: 'html',
  svg: 'svg',
  tsx: 'tsx',
  jsx: 'jsx',
  typescript: 'ts',
  ts: 'ts',
  javascript: 'js',
  js: 'js',
  dart: 'dart',
  flutter: 'dart',
  swift: 'swift',
  kotlin: 'kt',
  kt: 'kt',
  python: 'py',
  py: 'py',
  json: 'json',
  css: 'css',
  scss: 'scss',
  sql: 'sql',
  yaml: 'yaml',
  yml: 'yaml',
  xml: 'xml',
  markdown: 'md',
  md: 'md',
  shell: 'sh',
  bash: 'sh',
  sh: 'sh',
  go: 'go',
  rust: 'rs',
  rs: 'rs',
  java: 'java',
  c: 'c',
  cpp: 'cpp',
  csharp: 'cs',
  cs: 'cs',
  php: 'php',
  ruby: 'rb',
  rb: 'rb',
};

const PREVIEWABLE_LANGS = ['html', 'htm', 'svg', 'tsx', 'jsx', 'javascript', 'js', 'dart', 'flutter', 'swift', 'kotlin', 'kt'];

/**
 * Shell / CLI command languages. These are never treated as file artifacts:
 * they render inline in the chat with a copy button (like other apps) and
 * never appear in the Artifacts panel. Bash/PowerShell/cmd output is meant to
 * be read and copied, not opened on a separate artifact page.
 */
export const SHELL_LANGS = [
  'bash',
  'sh',
  'shell',
  'zsh',
  'fish',
  'powershell',
  'pwsh',
  'cmd',
  'doskey',
  'bat',
  'batch',
  'console',
  'terminal',
];

export function isShellLanguage(lang: string): boolean {
  return SHELL_LANGS.includes(lang.toLowerCase().trim());
}

/**
 * Derives a Dart/Flutter filename from the source code when no explicit
 * filename comment was found. Prefers the main public widget class, falls
 * back to the MaterialApp/CupertinoApp title, then "main.dart".
 */
export function deriveDartFilename(code: string): string {
  // First public top-level class declaration, e.g. "class MyHomePage extends ..."
  const classMatch = code.match(/\bclass\s+([A-Z][A-Za-z0-9_]*)\s+extends\s+/);
  if (classMatch) {
    const className = classMatch[1];
    // "MyHomePage" -> "my_home_page.dart"
    const snake = className
      .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
      .replace(/([A-Z]+)([A-Z][a-z])/g, '$1_$2')
      .toLowerCase();
    return `${snake}.dart`;
  }
  // MaterialApp/CupertinoApp title -> slugified filename
  const appTitleMatch = code.match(/\b(?:MaterialApp|CupertinoApp|WidgetsApp)\s*\([^)]*?title:\s*['"]([^'"]+)['"]/is);
  if (appTitleMatch) {
    const slug = appTitleMatch[1]
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '_')
      .replace(/^_+|_+$/g, '')
      .slice(0, 40);
    if (slug) return `${slug}.dart`;
  }
  return 'main.dart';
}

/**
 * Derives a Swift filename from SwiftUI source.
 */
export function deriveSwiftFilename(code: string): string {
  const structMatch = code.match(/\bstruct\s+([A-Z][A-Za-z0-9_]*)\s*:\s*View\b/);
  if (structMatch) {
    const name = structMatch[1];
    const snake = name
      .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
      .replace(/([A-Z]+)([A-Z][a-z])/g, '$1_$2')
      .toLowerCase();
    return `${snake}.swift`;
  }
  return 'ContentView.swift';
}

/**
 * Derives a Kotlin filename from Jetpack Compose source.
 */
export function deriveKotlinFilename(code: string): string {
  const fnMatch = code.match(/\bfun\s+([A-Z][A-Za-z0-9_]*)\s*\(/);
  if (fnMatch) {
    const name = fnMatch[1];
    const snake = name
      .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
      .replace(/([A-Z]+)([A-Z][a-z])/g, '$1_$2')
      .toLowerCase();
    return `${snake}.kt`;
  }
  return 'MainActivity.kt';
}

/**
 * Derives a TSX/JSX/React filename from the source. Prefers the default
 * export name, then the first component function/class, then "App".
 */
function deriveReactFilename(code: string, ext: 'tsx' | 'jsx'): string {
  const defaultExport = code.match(/export\s+default\s+(?:function\s+)?([A-Z][A-Za-z0-9_]*)/);
  if (defaultExport) {
    return `${toKebab(defaultExport[1])}.${ext}`;
  }
  const namedFn = code.match(/(?:function|const)\s+([A-Z][A-Za-z0-9_]*)\s*(?:\(|=)/);
  if (namedFn) {
    return `${toKebab(namedFn[1])}.${ext}`;
  }
  return `App.${ext}`;
}

function toKebab(name: string): string {
  return name
    .replace(/([a-z0-9])([A-Z])/g, '$1-$2')
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1-$2')
    .toLowerCase();
}

/**
 * Unified title derivation for a code block with no explicit filename.
 * Returns a real, language-appropriate filename (e.g. "my_home_page.dart",
 * "login-form.tsx") so the inspector/simulator header shows the file the AI
 * actually wrote, instead of a generic "Component" placeholder.
 */
export function deriveArtifactTitle(code: string, lang: string, index = 1): string {
  const l = lang.toLowerCase().trim();
  if (l === 'dart' || l === 'flutter' || code.includes('package:flutter')) return deriveDartFilename(code);
  if (l === 'swift' || code.includes('import SwiftUI')) return deriveSwiftFilename(code);
  if (l === 'kotlin' || l === 'kt' || code.includes('androidx.compose')) return deriveKotlinFilename(code);
  if (l === 'tsx') return deriveReactFilename(code, 'tsx');
  if (l === 'jsx') return deriveReactFilename(code, 'jsx');
  if (l === 'html' || l === 'htm') {
    const titleMatch = code.match(/<title>\s*([^<]+?)\s*<\/title>/i);
    if (titleMatch) {
      const slug = titleMatch[1].toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40);
      if (slug) return `${slug}.html`;
    }
    return 'index.html';
  }
  if (l === 'svg') return `illustration${index}.svg`;
  const ext = LANG_EXTENSION[l] || l || 'txt';
  return l ? `${toKebab(l)}_${index}.${ext}` : `file_${index}.${ext}`;
}

/**
 * Tries to extract an explicit filename from any comment line in the code.
 * Recognized patterns (case-insensitive), across the whole file:
 *   // File: lib/main.dart        // lib/main.dart
 *   // filename: ...              // path: ...
 *   <!-- index.html -->           star-slash config.json star-slash
 *   # utils.py                    ; styles.css
 * Also strips an optional "filename:" / "file:" / "path:" label.
 * Returns the matched filename (with extension) and the 0-based line index
 * where it was found, or null.
 */
function findFilenameComment(code: string): { name: string; lineIndex: number } | null {
  const lines = code.split('\n');
  const patterns: RegExp[] = [
    /^\s*\/\/\s*(?:file(?:name|path)?\s*[:=]\s*)?([a-zA-Z0-9_][a-zA-Z0-9_.\-/]*\.[a-zA-Z0-9]+)\s*$/i,
    /^\s*\/\*\s*(?:file(?:name|path)?\s*[:=]\s*)?([a-zA-Z0-9_][a-zA-Z0-9_.\-/]*\.[a-zA-Z0-9]+)\s*\*\/\s*$/i,
    /^\s*<!--\s*(?:file(?:name|path)?\s*[:=]\s*)?([a-zA-Z0-9_][a-zA-Z0-9_.\-/]*\.[a-zA-Z0-9]+)\s*-->\s*$/i,
    /^\s*#\s*(?:file(?:name|path)?\s*[:=]\s*)?([a-zA-Z0-9_][a-zA-Z0-9_.\-/]*\.[a-zA-Z0-9]+)\s*$/i,
    /^\s*;\s*(?:file(?:name|path)?\s*[:=]\s*)?([a-zA-Z0-9_][a-zA-Z0-9_.\-/]*\.[a-zA-Z0-9]+)\s*$/i,
  ];
  for (let i = 0; i < Math.min(lines.length, 6); i++) {
    const line = lines[i];
    for (const re of patterns) {
      const m = line.match(re);
      if (m && m[1]) {
        return { name: m[1].trim(), lineIndex: i };
      }
    }
  }
  return null;
}

/**
 * Small FNV-1a hash so artifact ids are unique per (title + code). The old id
 * scheme (`art-${index}-${Date.now()}`) restarted `index` at 1 for EVERY
 * message, so two different responses that both produced "App.tsx" ended up
 * with colliding ids — clicking the NEW artifact selected the OLD one by id,
 * which looked exactly like "the app overwrote my old file with the new code".
 */
function artifactHash(title: string, code: string): string {
  const s = `${title}${code}`;
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(36);
}

/**
 * Extracts Claude-style artifacts from markdown code blocks
 */
export const ArtifactParser = {
  extractArtifacts(messageText: string): Artifact[] {
    if (!messageText) return [];

    const artifacts: Artifact[] = [];
    // Regex matches triple backtick code blocks with optional language and content
    const codeBlockRegex = /```([a-zA-Z0-9_\-+]*)\s*\n([\s\S]*?)```/g;

    let match: RegExpExecArray | null;
    let index = 1;

    while ((match = codeBlockRegex.exec(messageText)) !== null) {
      const lang = (match[1] || 'text').toLowerCase().trim();
      let code = match[2].trim();

      // Skip clarification request blocks
      if (lang === 'json' && (code.includes('"clarification_request"') || code.includes('"clarification_requests"'))) {
        continue;
      }

      // Shell / CLI command blocks are never artifacts — they render inline in
      // the chat with a copy button (handled by the markdown renderer) and must
      // not appear in the Artifacts panel.
      if (isShellLanguage(lang)) {
        continue;
      }

      // Resolve the real filename the AI (or user) intended.
      let title = '';
      let commentLineIndex: number | null = null;

      const found = findFilenameComment(code);
      if (found) {
        title = found.name;
        commentLineIndex = found.lineIndex;
      } else {
        title = deriveArtifactTitle(code, lang, index);
      }

      // Strip the leading filename-comment line from the stored code so the
      // preview/code tab shows the actual file content, not the comment.
      if (commentLineIndex !== null) {
        const lines = code.split('\n');
        lines.splice(commentLineIndex, 1);
        code = lines.join('\n').replace(/^\s*\n/, '').trim();
      }

      // Determine preview capability
      let type: 'preview' | 'code' | 'svg' | 'markdown' = 'code';
      if (PREVIEWABLE_LANGS.includes(lang)) {
        type = lang === 'svg' ? 'svg' : 'preview';
      } else if (lang === 'markdown' || lang === 'md') {
        type = 'markdown';
      }

      artifacts.push({
        id: `art-${index}-${artifactHash(title, code)}`,
        title,
        language: lang,
        code,
        type,
        version: index,
      });

      index++;
    }

    return artifacts;
  },
};
