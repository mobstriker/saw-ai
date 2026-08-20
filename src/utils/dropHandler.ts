import { extractZipFiles, isZipFileExport } from './zipImporter';

export interface DroppedFile {
  file: File;
  /** Full path within the dropped tree (e.g. "src/index.ts"). For a loose
   *  file this is just the file name; for a folder entry it is the relative
   *  path inside the folder; for a zip entry it is the in-archive path. */
  path: string;
}

/**
 * Recursively read a FileSystemDirectoryEntry, collecting every leaf File with
 * its path relative to the entry root. This is what makes dragging a whole
 * folder from the OS file explorer into the browser actually work (a plain
 * `dataTransfer.files` read returns an empty list for directories).
 */
function readDirEntries(
  dirEntry: any,
  prefix: string,
  out: DroppedFile[],
): Promise<void> {
  return new Promise((resolve) => {
    const reader = dirEntry.createReader();
    const readBatch = () => {
      reader.readEntries(
        async (entries: any[]) => {
          if (!entries || entries.length === 0) {
            resolve();
            return;
          }
          await Promise.all(
            entries.map((entry) => traverseEntry(entry, prefix, out)),
          );
          readBatch(); // keep reading until empty (readEntries paginates)
        },
        () => resolve(),
      );
    };
    readBatch();
  });
}

function traverseEntry(
  entry: any,
  prefix: string,
  out: DroppedFile[],
): Promise<void> {
  return new Promise((resolve) => {
    if (entry.isFile) {
      entry.file(
        (file: File) => {
          const rel = prefix ? `${prefix}/${file.name}` : file.name;
          out.push({ file, path: rel });
          resolve();
        },
        () => resolve(),
      );
    } else if (entry.isDirectory) {
      const nextPrefix = prefix
        ? `${prefix}/${entry.name}`
        : entry.name;
      readDirEntries(entry, nextPrefix, out).then(resolve);
    } else {
      resolve();
    }
  });
}

/**
 * Convert a drag DataTransfer into a flat list of DroppedFile entries.
 *
 * - Uses `webkitGetAsEntry` so dropped *folders* are recursively expanded
 *   (plain `dataTransfer.files` is empty for folders).
 * - Expands `.zip` archives into their constituent files (in-memory File
 *   objects with the archive-internal path) so the caller sees every file.
 * - Falls back to `dataTransfer.files` when the entry API is unavailable.
 *
 * The shared top-level folder name is stripped from paths so a dropped folder
 * named "my-skill" yields paths like "SKILL.md" rather than "my-skill/SKILL.md".
 */
export async function collectDroppedFiles(
  dataTransfer: DataTransfer,
): Promise<DroppedFile[]> {
  const raw: DroppedFile[] = [];
  const items = dataTransfer.items;

  if (items && items.length > 0 && typeof items[0].webkitGetAsEntry === 'function') {
    const entries: any[] = [];
    for (let i = 0; i < items.length; i++) {
      const entry = items[i].webkitGetAsEntry();
      if (entry) entries.push(entry);
    }
    if (entries.length > 0) {
      await Promise.all(entries.map((e) => traverseEntry(e, '', raw)));
    }
  }

  // Fallback / supplement: loose files (covers browsers without entry API,
  // and files selected via input).
  if (raw.length === 0 && dataTransfer.files && dataTransfer.files.length > 0) {
    for (let i = 0; i < dataTransfer.files.length; i++) {
      const f = dataTransfer.files[i];
      const rel = (f as any).webkitRelativePath
        ? (f as any).webkitRelativePath.split('/').slice(1).join('/') || f.name
        : f.name;
      raw.push({ file: f, path: rel || f.name });
    }
  }

  // Detect a single shared top-level folder across all entries and strip it,
  // so dropping "my-skill/" yields clean relative paths.
  const topFolders = new Set<string>();
  for (const r of raw) {
    if (r.path.includes('/')) topFolders.add(r.path.split('/')[0]);
  }
  const sharedRoot = topFolders.size === 1 ? [...topFolders][0] : null;

  const result: DroppedFile[] = [];
  for (const r of raw) {
    // Expand zips inline.
    if (isZipFileExport(r.file)) {
      const extracted = await extractZipFiles(r.file);
      for (const ef of extracted.files) {
        const fake = new File([ef.content], ef.name, { type: 'text/plain' });
        result.push({ file: fake, path: ef.path });
      }
      continue;
    }
    let cleanPath = r.path;
    if (sharedRoot && cleanPath.startsWith(sharedRoot + '/')) {
      cleanPath = cleanPath.slice(sharedRoot.length + 1);
    }
    if (!cleanPath) cleanPath = r.file.name;
    result.push({ file: r.file, path: cleanPath });
  }
  return result;
}
