import JSZip from 'jszip';
import { FileSecurity } from './fileSecurity';

export interface ExtractedFile {
  path: string;
  name: string;
  content: string;
  size: number;
  language: string;
}

export interface ZipExtractResult {
  files: ExtractedFile[];
  rootFolder?: string;
  skipped: string[];
  error?: string;
}

function isZipFile(file: File): boolean {
  const name = file.name.toLowerCase();
  if (name.endsWith('.zip')) return true;
  // Some downloads (e.g. GitHub) come as <name>-main.zip with no extension on
  // some filesystems; trust the MIME type as a fallback.
  return (
    file.type === 'application/zip' ||
    file.type === 'application/x-zip-compressed' ||
    file.type === 'application/x-zip'
  );
}

/**
 * Extract a .zip File into a list of text/code files. Binary entries that look
 * like executables/compiled assets are skipped (via FileSecurity); everything
 * else is decoded as UTF-8. Empty directory entries are ignored.
 *
 * This is the single entry point used by the Skills uploader AND the chat
 * dropzone so zip handling stays consistent everywhere.
 */
export async function extractZipFiles(file: File): Promise<ZipExtractResult> {
  if (!isZipFile(file)) {
    return { files: [], skipped: [], error: 'Not a zip file.' };
  }

  try {
    const zip = await JSZip.loadAsync(file);
    const files: ExtractedFile[] = [];
    const skipped: string[] = [];
    let rootFolder: string | undefined;

    const entries = Object.values(zip.files);

    // Detect a single shared top-level folder (common: "skill-name-main/")
    // so we can strip it when building clean relative paths.
    const topDirs = new Set<string>();
    for (const entry of entries) {
      if (entry.dir) continue;
      const parts = entry.name.split('/');
      if (parts.length > 1) topDirs.add(parts[0]);
    }
    if (topDirs.size === 1) rootFolder = [...topDirs][0];

    for (const entry of entries) {
      if (entry.dir) continue;
      // Skip junk
      const baseName = entry.name.split('/').pop() || entry.name;
      if (!baseName || baseName.startsWith('.')) continue;
      if (baseName === '__MACOSX' || entry.name.includes('__MACOSX/')) continue;

      // Clean relative path (strip shared root folder + leading slashes).
      let relPath = entry.name.replace(/^\/+/, '');
      if (rootFolder && relPath.startsWith(rootFolder + '/')) {
        relPath = relPath.slice(rootFolder.length + 1);
      }
      if (!relPath) continue;

      const fileName = relPath.split('/').pop() || relPath;

      // Validate via the shared security gate.
      const validation = FileSecurity.isAllowedFile(fileName);
      if (!validation.allowed) {
        skipped.push(`${relPath} (${validation.reason})`);
        continue;
      }

      // Read content as text. Some entries (images, large binaries) will fail
      // or produce junk — guard with try/catch and skip on failure.
      let content: string;
      try {
        content = await entry.async('text');
      } catch {
        skipped.push(`${relPath} (binary, skipped)`);
        continue;
      }

      files.push({
        path: relPath,
        name: fileName,
        content,
        size: content.length,
        language: FileSecurity.detectLanguage(relPath),
      });
    }

    return { files, rootFolder, skipped };
  } catch (err) {
    return {
      files: [],
      skipped: [],
      error: `Could not read zip "${file.name}": ${err instanceof Error ? err.message : String(err)}`,
    };
  }
}

export function isZipFileExport(file: File): boolean {
  return isZipFile(file);
}
