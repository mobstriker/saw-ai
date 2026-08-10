import { ProjectFile, Artifact } from '../types';

export interface PatchChunk {
  id: string;
  filePath: string;
  searchChunk: string;
  replaceChunk: string;
  description?: string;
}

export interface PatchApplicationResult {
  success: boolean;
  updatedContent: string;
  matchType: 'exact' | 'normalized_whitespace' | 'trimmed_indentation' | 'anchor_match' | 'none';
  additions: number;
  deletions: number;
  linesChanged: number;
  percentagePreserved: number;
  error?: string;
}

export interface DiffLine {
  type: 'add' | 'delete' | 'equal';
  text: string;
  oldLineNumber?: number;
  newLineNumber?: number;
}

export const PatchApplier = {
  /**
   * Parses Claude-style search/replace chunks or unified diffs from assistant message text
   */
  extractPatches(messageText: string): { patches: PatchChunk[]; cleanedText: string } {
    if (!messageText) return { patches: [], cleanedText: '' };

    const patches: PatchChunk[] = [];
    const cleanedText = messageText;
    let patchCount = 1;

    // Line-by-line parsing to avoid regex catastrophic backtracking and handle multiple patches cleanly
    const lines = messageText.split('\n');
    let inSearch = false;
    let inReplace = false;
    let currentFilePath = '';
    let searchLines: string[] = [];
    let replaceLines: string[] = [];

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const trimmed = line.trim();

      // Check for SEARCH opening marker
      const searchMatch = trimmed.match(/^<{4,7}\s*SEARCH(?::|\s+|\s*\(\s*)([a-zA-Z0-9_.\-/]+(?:\.[a-zA-Z0-9]+)?)?\s*\)?$/i);
      if (searchMatch) {
        // Look backwards up to 3 lines for a filename comment if not in marker
        let detectedFile = searchMatch[1]?.trim() || '';
        if (!detectedFile) {
          for (let k = i - 1; k >= Math.max(0, i - 3); k--) {
            const prevLine = lines[k].trim();
            const fMatch =
              prevLine.match(/^(?:\/\/|#|<!--|\/\*|###)?\s*(?:File|Target|Edit)?:\s*([a-zA-Z0-9_.\-/]+\.[a-zA-Z0-9]+)/i) ||
              prevLine.match(/^(?:\/\/|#|<!--)\s*([a-zA-Z0-9_.\-/]+\.[a-zA-Z0-9]+)/i) ||
              prevLine.match(/^`([a-zA-Z0-9_.\-/]+\.[a-zA-Z0-9]+)`/i);
            if (fMatch && fMatch[1]) {
              detectedFile = fMatch[1].trim();
              break;
            }
          }
        }

        currentFilePath = detectedFile;
        searchLines = [];
        replaceLines = [];
        inSearch = true;
        inReplace = false;
        continue;
      }

      // Check for SEPARATOR marker: =======
      if (inSearch && /^={4,7}\s*$/.test(trimmed)) {
        inSearch = false;
        inReplace = true;
        continue;
      }

      // Check for REPLACE closing marker: >>>>>>> REPLACE
      if (inReplace && /^>{4,7}\s*REPLACE/i.test(trimmed)) {
        inReplace = false;
        const searchChunk = searchLines.join('\n');
        const replaceChunk = replaceLines.join('\n');

        patches.push({
          id: `patch-${Date.now()}-${patchCount++}`,
          filePath: currentFilePath,
          searchChunk,
          replaceChunk,
        });

        currentFilePath = '';
        searchLines = [];
        replaceLines = [];
        continue;
      }

      if (inSearch) {
        searchLines.push(line);
      } else if (inReplace) {
        replaceLines.push(line);
      }
    }

    // Secondary fallback: [SEARCH] ... [REPLACE] block
    if (patches.length === 0) {
      const bracketSearchRegex =
        /(?:(?:\/\/|#)?\s*(?:File|Target)?:\s*([a-zA-Z0-9_.\-/]+\.[a-zA-Z0-9]+))?[\s\S]*?\[SEARCH\]\s*\n([\s\S]*?)\n\[REPLACE\]\s*\n([\s\S]*?)\n\[\/REPLACE\]/gi;
      let match: RegExpExecArray | null;
      while ((match = bracketSearchRegex.exec(messageText)) !== null) {
        const filePath = match[1]?.trim() || '';
        const searchChunk = match[2];
        const replaceChunk = match[3];

        if (searchChunk && replaceChunk && !patches.some((p) => p.searchChunk === searchChunk)) {
          patches.push({
            id: `patch-br-${Date.now()}-${patchCount++}`,
            filePath,
            searchChunk,
            replaceChunk,
          });
        }
      }
    }

    return { patches, cleanedText };
  },

  /**
   * Applies a search/replace chunk onto target text with multi-tier fuzzy matching
   */
  applyPatch(originalContent: string, searchChunk: string, replaceChunk: string): PatchApplicationResult {
    if (!originalContent) {
      return {
        success: false,
        updatedContent: originalContent,
        matchType: 'none',
        additions: 0,
        deletions: 0,
        linesChanged: 0,
        percentagePreserved: 100,
        error: 'Target content is empty',
      };
    }

    const origLines = originalContent.split('\n');
    const searchLines = searchChunk.split('\n');
    const replaceLines = replaceChunk.split('\n');

    // Tier 1: Exact substring match
    if (originalContent.includes(searchChunk)) {
      const updatedContent = originalContent.replace(searchChunk, replaceChunk);
      const stats = this.computeStats(origLines, searchLines, replaceLines);
      return {
        success: true,
        updatedContent,
        matchType: 'exact',
        ...stats,
      };
    }

    // Tier 2: Normalized line endings and trailing whitespace match
    const normOriginal = originalContent.replace(/\r\n/g, '\n');
    const normSearch = searchChunk.replace(/\r\n/g, '\n').trimEnd();
    const normReplace = replaceChunk.replace(/\r\n/g, '\n');

    if (normOriginal.includes(normSearch)) {
      const updatedContent = normOriginal.replace(normSearch, normReplace);
      const stats = this.computeStats(origLines, searchLines, replaceLines);
      return {
        success: true,
        updatedContent,
        matchType: 'normalized_whitespace',
        ...stats,
      };
    }

    // Tier 3: Line-by-line trimmed comparison with indentation preservation
    const trimmedSearchResult = this.applyTrimmedLinePatch(origLines, searchLines, replaceLines);
    if (trimmedSearchResult.success) {
      const stats = this.computeStats(origLines, searchLines, replaceLines);
      return {
        success: true,
        updatedContent: trimmedSearchResult.updatedContent,
        matchType: 'trimmed_indentation',
        ...stats,
      };
    }

    // Tier 4: Anchor matching (first and last lines match as bounds)
    if (searchLines.length >= 3) {
      const anchorResult = this.applyAnchorPatch(origLines, searchLines, replaceLines);
      if (anchorResult.success) {
        const stats = this.computeStats(origLines, searchLines, replaceLines);
        return {
          success: true,
          updatedContent: anchorResult.updatedContent,
          matchType: 'anchor_match',
          ...stats,
        };
      }
    }

    return {
      success: false,
      updatedContent: originalContent,
      matchType: 'none',
      additions: 0,
      deletions: 0,
      linesChanged: 0,
      percentagePreserved: 100,
      error: 'Could not locate matching search block in the target file.',
    };
  },

  /**
   * Internal helper: Trimmed line matching
   */
  applyTrimmedLinePatch(
    origLines: string[],
    searchLines: string[],
    replaceLines: string[]
  ): { success: boolean; updatedContent: string } {
    const sCount = searchLines.length;
    if (sCount === 0) return { success: false, updatedContent: '' };

    for (let i = 0; i <= origLines.length - sCount; i++) {
      let isMatch = true;
      for (let j = 0; j < sCount; j++) {
        if (origLines[i + j].trim() !== searchLines[j].trim()) {
          isMatch = false;
          break;
        }
      }

      if (isMatch) {
        // Match found! Detect baseline indentation from first matched line
        const matchedIndent = (origLines[i].match(/^\s*/) || [''])[0];
        const searchBaseIndent = (searchLines[0].match(/^\s*/) || [''])[0];

        // Format replacement lines with relative indentation adjusted to match original
        const formattedReplace = replaceLines.map((rLine) => {
          if (!rLine.trim()) return '';
          const rIndent = (rLine.match(/^\s*/) || [''])[0];
          if (rIndent.startsWith(searchBaseIndent)) {
            const extraIndent = rIndent.slice(searchBaseIndent.length);
            return matchedIndent + extraIndent + rLine.trimStart();
          }
          return matchedIndent + rLine.trimStart();
        });

        const newLines = [...origLines.slice(0, i), ...formattedReplace, ...origLines.slice(i + sCount)];
        return { success: true, updatedContent: newLines.join('\n') };
      }
    }

    return { success: false, updatedContent: '' };
  },

  /**
   * Internal helper: Anchor matching
   */
  applyAnchorPatch(
    origLines: string[],
    searchLines: string[],
    replaceLines: string[]
  ): { success: boolean; updatedContent: string } {
    const firstSearch = searchLines[0].trim();
    const lastSearch = searchLines[searchLines.length - 1].trim();

    for (let i = 0; i < origLines.length; i++) {
      if (origLines[i].trim() === firstSearch) {
        for (let j = i + 1; j < origLines.length; j++) {
          if (origLines[j].trim() === lastSearch) {
            // Found start and end anchors
            const matchedIndent = (origLines[i].match(/^\s*/) || [''])[0];
            const formattedReplace = replaceLines.map((rLine) =>
              rLine.trim() ? matchedIndent + rLine.trimStart() : ''
            );

            const newLines = [...origLines.slice(0, i), ...formattedReplace, ...origLines.slice(j + 1)];
            return { success: true, updatedContent: newLines.join('\n') };
          }
        }
      }
    }

    return { success: false, updatedContent: '' };
  },

  /**
   * Helper to compute line diff statistics and percentage preserved
   */
  computeStats(
    origLines: string[],
    searchLines: string[],
    replaceLines: string[]
  ): { additions: number; deletions: number; linesChanged: number; percentagePreserved: number } {
    const deletions = searchLines.length;
    const additions = replaceLines.length;
    const linesChanged = additions + deletions;
    const totalLines = Math.max(origLines.length, 1);
    const untouchedLines = Math.max(0, totalLines - deletions);
    const percentagePreserved = Math.min(100, Math.round((untouchedLines / totalLines) * 100));

    return { additions, deletions, linesChanged, percentagePreserved };
  },

  /**
   * Generates a unified diff array for rendering side-by-side or line-by-line colored diffs
   */
  generateDiffLines(oldText: string, newText: string): DiffLine[] {
    const oldLines = (oldText || '').split('\n');
    const newLines = (newText || '').split('\n');
    const diff: DiffLine[] = [];

    let oldIdx = 0;
    let newIdx = 0;

    // Simple LCS or single chunk difference comparison
    while (oldIdx < oldLines.length || newIdx < newLines.length) {
      if (oldIdx < oldLines.length && newIdx < newLines.length) {
        if (oldLines[oldIdx] === newLines[newIdx]) {
          diff.push({
            type: 'equal',
            text: oldLines[oldIdx],
            oldLineNumber: oldIdx + 1,
            newLineNumber: newIdx + 1,
          });
          oldIdx++;
          newIdx++;
        } else {
          // Look ahead to find reconnection point
          let foundOldInNew = -1;
          let foundNewInOld = -1;

          for (let k = 1; k <= 5; k++) {
            if (newIdx + k < newLines.length && oldLines[oldIdx] === newLines[newIdx + k]) {
              foundOldInNew = k;
              break;
            }
            if (oldIdx + k < oldLines.length && oldLines[oldIdx + k] === newLines[newIdx]) {
              foundNewInOld = k;
              break;
            }
          }

          if (foundOldInNew !== -1) {
            for (let k = 0; k < foundOldInNew; k++) {
              diff.push({
                type: 'add',
                text: newLines[newIdx + k],
                newLineNumber: newIdx + k + 1,
              });
            }
            newIdx += foundOldInNew;
          } else if (foundNewInOld !== -1) {
            for (let k = 0; k < foundNewInOld; k++) {
              diff.push({
                type: 'delete',
                text: oldLines[oldIdx + k],
                oldLineNumber: oldIdx + k + 1,
              });
            }
            oldIdx += foundNewInOld;
          } else {
            diff.push({
              type: 'delete',
              text: oldLines[oldIdx],
              oldLineNumber: oldIdx + 1,
            });
            diff.push({
              type: 'add',
              text: newLines[newIdx],
              newLineNumber: newIdx + 1,
            });
            oldIdx++;
            newIdx++;
          }
        }
      } else if (oldIdx < oldLines.length) {
        diff.push({
          type: 'delete',
          text: oldLines[oldIdx],
          oldLineNumber: oldIdx + 1,
        });
        oldIdx++;
      } else if (newIdx < newLines.length) {
        diff.push({
          type: 'add',
          text: newLines[newIdx],
          newLineNumber: newIdx + 1,
        });
        newIdx++;
      }
    }

    return diff;
  },

  /**
   * Applies all extracted patches to a Project or Artifact
   */
  applyPatchesToWorkspace(
    patches: PatchChunk[],
    files: ProjectFile[],
    activeFileId?: string
  ): {
    updatedFiles: ProjectFile[];
    appliedCount: number;
    results: { patch: PatchChunk; result: PatchApplicationResult; file: ProjectFile }[];
  } {
    let updatedFiles = [...files];
    let appliedCount = 0;
    const results: { patch: PatchChunk; result: PatchApplicationResult; file: ProjectFile }[] = [];

    for (const patch of patches) {
      // Find matching file by path, name, or active file
      let targetFileIndex = -1;

      if (patch.filePath) {
        const cleanP = patch.filePath.replace(/^\/+/, '');
        targetFileIndex = updatedFiles.findIndex(
          (f) => f.path === cleanP || f.name === cleanP || f.path.endsWith(cleanP)
        );
      }

      if (targetFileIndex === -1 && activeFileId) {
        targetFileIndex = updatedFiles.findIndex((f) => f.id === activeFileId);
      }

      if (targetFileIndex === -1 && updatedFiles.length === 1) {
        targetFileIndex = 0;
      }

      if (targetFileIndex >= 0) {
        const targetFile = updatedFiles[targetFileIndex];
        const res = this.applyPatch(targetFile.content, patch.searchChunk, patch.replaceChunk);

        if (res.success) {
          updatedFiles[targetFileIndex] = {
            ...targetFile,
            content: res.updatedContent,
            size: new Blob([res.updatedContent]).size,
            lastModified: Date.now(),
          };
          appliedCount++;
        }

        results.push({
          patch,
          result: res,
          file: targetFile,
        });
      }
    }

    return { updatedFiles, appliedCount, results };
  },

  /**
   * Applies patches to a standalone Artifact
   */
  applyPatchToArtifact(
    patch: PatchChunk,
    artifact: Artifact
  ): { updatedArtifact: Artifact; result: PatchApplicationResult } {
    const res = this.applyPatch(artifact.code, patch.searchChunk, patch.replaceChunk);

    if (res.success) {
      const updatedArtifact: Artifact = {
        ...artifact,
        code: res.updatedContent,
        version: (artifact.version || 1) + 1,
      };
      return { updatedArtifact, result: res };
    }

    return { updatedArtifact: artifact, result: res };
  },
};
