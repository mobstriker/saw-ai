/**
 * Universal File Security & Parsing Engine
 * Allows all standard and developer files (.env, configs, source code, data, markup, text)
 * while blocking genuinely malicious binary executables (.exe, .dll, .so, etc.).
 */

// Extensions of compiled binaries and dangerous Windows/Unix executable containers
const BLOCKED_MALICIOUS_EXTENSIONS = new Set([
  '.exe',
  '.dll',
  '.so',
  '.dylib',
  '.com',
  '.scr',
  '.pif',
  '.vbs',
  '.vbe',
  '.wsf',
  '.wsh',
  '.hta',
  '.cpl',
  '.msc',
  '.msi',
  '.msp',
  '.deb',
  '.rpm',
  '.dmg',
  '.pkg',
  '.sys',
  '.drv',
  '.iso',
  '.img',
  '.cab',
]);

export interface FileValidationResult {
  allowed: boolean;
  reason?: string;
}

export interface SafeFileReadResult {
  allowed: boolean;
  reason?: string;
  name: string;
  path: string;
  content: string;
  size: number;
  language: string;
}

export const FileSecurity = {
  /**
   * Checks whether a filename is safe to be ingested into the project workspace.
   * All common files (source code, .env, dotfiles, scripts, data, configs) are allowed.
   * Only malicious binaries and executables are blocked.
   */
  isAllowedFile(fileName: string, fileSize?: number): FileValidationResult {
    if (!fileName || typeof fileName !== 'string') {
      return { allowed: false, reason: 'Invalid file name.' };
    }

    const lowerName = fileName.toLowerCase().trim();

    // Check against dangerous binary executable extensions
    for (const ext of BLOCKED_MALICIOUS_EXTENSIONS) {
      if (lowerName.endsWith(ext)) {
        return {
          allowed: false,
          reason: `Security Block: Executable / binary file "${fileName}" (${ext}) cannot be uploaded to prevent malicious execution.`,
        };
      }
    }

    // Protect against massive memory crash files (e.g. > 25MB text)
    if (fileSize && fileSize > 25 * 1024 * 1024) {
      return {
        allowed: false,
        reason: `File "${fileName}" exceeds the 25MB single file limit for browser memory.`,
      };
    }

    return { allowed: true };
  },

  /**
   * Detects the programming / markup / config language for any file path or filename,
   * with explicit recognition of .env, dotfiles, configs, and major languages.
   */
  detectLanguage(filePath: string): string {
    if (!filePath) return 'text';

    const normalized = filePath.replace(/\\/g, '/');
    const fileName = normalized.split('/').pop()?.toLowerCase() || '';

    // 1. Explicit dotfiles & environment configs
    if (fileName === '.env' || fileName.startsWith('.env.')) {
      return 'env';
    }
    if (
      fileName === '.gitignore' ||
      fileName === '.dockerignore' ||
      fileName === '.npmignore' ||
      fileName === '.gitattributes' ||
      fileName === '.slugignore'
    ) {
      return 'ignore';
    }
    if (fileName === '.editorconfig' || fileName === '.tool-versions' || fileName === '.nvmrc') {
      return 'ini';
    }
    if (fileName.includes('dockerfile')) {
      return 'dockerfile';
    }
    if (fileName.includes('makefile') || fileName === 'gnumakefile') {
      return 'makefile';
    }
    if (fileName === 'gemfile' || fileName === 'rakefile') {
      return 'ruby';
    }
    if (fileName === 'procfile') {
      return 'yaml';
    }

    // 2. Extension-based matching
    const ext = fileName.split('.').pop() || '';

    switch (ext) {
      // TypeScript & JavaScript
      case 'ts':
        return 'typescript';
      case 'tsx':
        return 'tsx';
      case 'js':
      case 'mjs':
      case 'cjs':
        return 'javascript';
      case 'jsx':
        return 'jsx';
      case 'json':
      case 'jsonc':
      case 'json5':
        return 'json';

      // Python
      case 'py':
      case 'pyw':
      case 'ipynb':
      case 'pyx':
        return 'python';

      // Dart & Flutter
      case 'dart':
        return 'dart';

      // HTML & Web Templates
      case 'html':
      case 'htm':
      case 'xhtml':
      case 'vue':
      case 'svelte':
      case 'astro':
        return 'html';

      // Styles
      case 'css':
      case 'scss':
      case 'sass':
      case 'less':
      case 'styl':
      case 'pcss':
      case 'postcss':
        return 'css';

      // Configs & Markup
      case 'env':
        return 'env';
      case 'yaml':
      case 'yml':
        return 'yaml';
      case 'toml':
        return 'toml';
      case 'ini':
      case 'cfg':
      case 'conf':
      case 'properties':
        return 'ini';
      case 'xml':
      case 'plist':
      case 'xaml':
        return 'xml';
      case 'svg':
        return 'svg';

      // Documentation
      case 'md':
      case 'mdx':
      case 'markdown':
        return 'markdown';
      case 'txt':
      case 'rst':
      case 'adoc':
      case 'asciidoc':
      case 'tex':
      case 'latex':
      case 'log':
        return 'text';

      // Data formats
      case 'csv':
      case 'tsv':
      case 'tab':
        return 'csv';
      case 'sql':
      case 'psql':
      case 'mysql':
      case 'sqlite':
        return 'sql';
      case 'graphql':
      case 'gql':
        return 'graphql';
      case 'proto':
        return 'protobuf';

      // Systems & Backend Languages
      case 'rs':
        return 'rust';
      case 'go':
      case 'mod':
      case 'sum':
        return 'go';
      case 'kt':
      case 'kts':
        return 'kotlin';
      case 'java':
      case 'gradle':
        return 'java';
      case 'swift':
        return 'swift';
      case 'c':
      case 'h':
        return 'c';
      case 'cpp':
      case 'cc':
      case 'cxx':
      case 'hpp':
      case 'hxx':
        return 'cpp';
      case 'cs':
      case 'csx':
        return 'csharp';
      case 'php':
        return 'php';
      case 'rb':
      case 'erb':
        return 'ruby';
      case 'sh':
      case 'bash':
      case 'zsh':
      case 'fish':
        return 'bash';
      case 'bat':
      case 'cmd':
      case 'ps1':
        return 'powershell';
      case 'lua':
        return 'lua';
      case 'r':
        return 'r';
      case 'scala':
      case 'sbt':
        return 'scala';
      case 'ex':
      case 'exs':
        return 'elixir';

      default:
        return 'text';
    }
  },

  /**
   * Safely reads a File object, ensuring malicious binaries are rejected and
   * all text/code/env files are decoded cleanly with UTF-8 support.
   */
  async readFileSafely(file: File, customPath?: string): Promise<SafeFileReadResult> {
    const validation = this.isAllowedFile(file.name, file.size);
    if (!validation.allowed) {
      return {
        allowed: false,
        reason: validation.reason,
        name: file.name,
        path: customPath || file.name,
        content: '',
        size: file.size,
        language: 'text',
      };
    }

    try {
      const text = await file.text();
      const language = this.detectLanguage(customPath || file.name);

      return {
        allowed: true,
        name: file.name,
        path: customPath || file.name,
        content: text,
        size: file.size,
        language,
      };
    } catch (err: any) {
      return {
        allowed: false,
        reason: `Failed to read file "${file.name}": ${err?.message || 'Unsupported format'}`,
        name: file.name,
        path: customPath || file.name,
        content: '',
        size: file.size,
        language: 'text',
      };
    }
  },
};
