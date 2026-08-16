import { Artifact } from '../types';

/**
 * Maps a code-block language to its canonical file extension.
 * Used as the final fallback so artifacts always carry a real filename
 * (e.g. "main.dart") instead of the old "Snippet N (DART)" placeholder.
 */
const LANG_EXTENSION: Record<string, string> = {
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
 * Derives a Dart/Flutter filename from the source code when no explicit
 * filename comment was found. Prefers the main public widget class, falls
 * back to the MaterialApp/CupertinoApp title, then "main.dart".
 */
function deriveDartFilename(code: string): string {
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
function deriveSwiftFilename(code: string): string {
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
function deriveKotlinFilename(code: string): string {
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

      // Resolve the real filename the AI (or user) intended.
      let title = '';
      let commentLineIndex: number | null = null;

      const found = findFilenameComment(code);
      if (found) {
        title = found.name;
        commentLineIndex = found.lineIndex;
      } else if (lang === 'dart' || lang === 'flutter' || code.includes('package:flutter')) {
        title = deriveDartFilename(code);
      } else if (lang === 'swift' || code.includes('import SwiftUI')) {
        title = deriveSwiftFilename(code);
      } else if (lang === 'kotlin' || lang === 'kt' || code.includes('androidx.compose')) {
        title = deriveKotlinFilename(code);
      } else if (lang === 'html') {
        title = 'index.html';
      } else if (lang === 'svg') {
        title = `illustration${index}.svg`;
      } else {
        const ext = LANG_EXTENSION[lang] || lang || 'txt';
        title = lang ? `${lang}_${index}.${ext}` : `file_${index}.${ext}`;
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
        id: `art-${index}-${Date.now().toString(36)}`,
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
