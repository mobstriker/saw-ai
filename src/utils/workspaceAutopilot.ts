import { Project, ProjectFile, AutomationMode, Artifact } from '../types';
import { PatchApplier, PatchChunk } from './patchApplier';

export interface WorkspaceOperationResult {
  updatedProject: Project;
  filesCreated: string[];
  filesUpdated: string[];
  filesDeleted: string[];
  foldersCreated: string[];
  foldersDeleted: string[];
  patchesAppliedCount: number;
  hasChanges: boolean;
  summaryText: string;
}

export const WorkspaceAutopilot = {
  /**
   * Extracts file and folder commands, surgical patches, and code artifacts from assistant response text
   */
  parseOperations(text: string) {
    if (!text) {
      return {
        patches: [],
        deleteFileMatches: [],
        deleteFolderMatches: [],
        createFolderMatches: [],
        codeFiles: [],
      };
    }

    // 1. Surgical Patches (Search/Replace blocks)
    const { patches } = PatchApplier.extractPatches(text);

    // 2. Explicit File Deletions: [DELETE_FILE path="src/old.ts"], <delete_file path="src/old.ts" />, [DELETE_FILE: src/old.ts], Delete file: src/old.ts
    const deleteFileMatches: string[] = [];
    const delFileRegex = /(?:\[DELETE_FILE(?::|\s+path=)["']?([^"'\]\n]+)["']?\]|<delete_file\s+path=["']([^"']+)["']\s*\/>|(?:Delete|Remove)\s+file:\s*`?([a-zA-Z0-9_.\-/]+\.[a-zA-Z0-9]+)`?|delete_file\s*\(\s*["']([^"']+)["']\s*\))/gi;
    let match;
    while ((match = delFileRegex.exec(text)) !== null) {
      const path = (match[1] || match[2] || match[3] || match[4] || '').trim().replace(/^\/+/, '');
      if (path && !deleteFileMatches.includes(path)) {
        deleteFileMatches.push(path);
      }
    }

    // 3. Explicit Folder Deletions: [DELETE_FOLDER path="src/legacy"], <delete_folder path="src/legacy" />, Delete folder: src/legacy
    const deleteFolderMatches: string[] = [];
    const delFolderRegex = /(?:\[DELETE_FOLDER(?::|\s+path=)["']?([^"'\]\n]+)["']?\]|<delete_folder\s+path=["']([^"']+)["']\s*\/>|(?:Delete|Remove)\s+folder:\s*`?([a-zA-Z0-9_.\-/]+)`?|delete_folder\s*\(\s*["']([^"']+)["']\s*\))/gi;
    while ((match = delFolderRegex.exec(text)) !== null) {
      const path = (match[1] || match[2] || match[3] || match[4] || '').trim().replace(/^\/+|\/+$/g, '');
      if (path && !deleteFolderMatches.includes(path)) {
        deleteFolderMatches.push(path);
      }
    }

    // 4. Explicit Folder Creations: [CREATE_FOLDER path="src/components/auth"], <create_folder path="src/components/auth" />, Create folder: src/components/auth
    const createFolderMatches: string[] = [];
    const createFolderRegex = /(?:\[CREATE_FOLDER(?::|\s+path=)["']?([^"'\]\n]+)["']?\]|<create_folder\s+path=["']([^"']+)["']\s*\/>|(?:Create|New)\s+folder:\s*`?([a-zA-Z0-9_.\-/]+)`?|create_folder\s*\(\s*["']([^"']+)["']\s*\))/gi;
    while ((match = createFolderRegex.exec(text)) !== null) {
      const path = (match[1] || match[2] || match[3] || match[4] || '').trim().replace(/^\/+|\/+$/g, '');
      if (path && !createFolderMatches.includes(path)) {
        createFolderMatches.push(path);
      }
    }

    // 5. Code Artifacts (Full file blocks)
    const codeFiles: { path: string; content: string; language: string }[] = [];
    const lines = text.split('\n');
    let inCode = false;
    let currentLang = '';
    let currentBlockLines: string[] = [];
    let currentBlockFenceHeader = '';

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (line.trim().startsWith('```')) {
        if (!inCode) {
          inCode = true;
          currentBlockFenceHeader = line.trim();
          currentLang = line.trim().slice(3).trim() || 'text';
          currentBlockLines = [];
        } else {
          inCode = false;
          const blockContent = currentBlockLines.join('\n');
          
          // Check if this block is a SEARCH/REPLACE patch block - if so, skip full-file parsing
          if (!blockContent.includes('<<<<<<< SEARCH') && !blockContent.includes('<<<< SEARCH') && !blockContent.includes('[SEARCH]')) {
            let detectedPath = '';

            // Check A: Filename or filepath attribute in the code fence header (e.g. ```tsx filepath="src/App.tsx" or ```ts src/types.ts)
            const fenceMatch =
              currentBlockFenceHeader.match(/(?:filepath|file|title)=["']([^"']+)["']/i) ||
              currentBlockFenceHeader.match(/^```[a-zA-Z0-9_-]*\s+([a-zA-Z0-9_.\-/]+\.[a-zA-Z0-9]+)/i);
            if (fenceMatch && fenceMatch[1]) {
              detectedPath = fenceMatch[1].trim();
            }

            // Check B: Look for path in first 3 lines of comments inside code block
            if (!detectedPath && currentBlockLines.length > 0) {
              for (let k = 0; k < Math.min(3, currentBlockLines.length); k++) {
                const checkLine = currentBlockLines[k].trim();
                const pathMatch =
                  checkLine.match(/^(?:\/\/|#|<!--|\/\*)\s*(?:File|file|path|filepath|Path|FilePath)?:\s*([a-zA-Z0-9_.\-/]+\.[a-zA-Z0-9]+)/i) ||
                  checkLine.match(/^(?:\/\/|#)\s*([a-zA-Z0-9_.\-/]+\.[a-zA-Z0-9]+)$/i) ||
                  checkLine.match(/^<!--\s*([a-zA-Z0-9_.\-/]+\.[a-zA-Z0-9]+)\s*-->/i) ||
                  checkLine.match(/^\/\*\s*([a-zA-Z0-9_.\-/]+\.[a-zA-Z0-9]+)\s*\*\/$/i);
                if (pathMatch && pathMatch[1]) {
                  detectedPath = pathMatch[1].trim();
                  break;
                }
              }
            }

            // Check C: Look for markdown header immediately before code fence (e.g. `### src/components/Header.tsx` or `**File: src/App.tsx**`)
            if (!detectedPath) {
              const fenceStartIdx = i - currentBlockLines.length - 1;
              for (let k = fenceStartIdx - 1; k >= Math.max(0, fenceStartIdx - 3); k--) {
                const prevLine = lines[k].trim();
                const headingMatch =
                  prevLine.match(/^(?:###|##|#|\*\*|\*|`)\s*(?:File|file|Path)?:\s*`?([a-zA-Z0-9_.\-/]+\.[a-zA-Z0-9]+)`?/i) ||
                  prevLine.match(/^`([a-zA-Z0-9_.\-/]+\.[a-zA-Z0-9]+)`$/i) ||
                  prevLine.match(/^(?:###|##)\s+`?([a-zA-Z0-9_.\-/]+\.[a-zA-Z0-9]+)`?/i);
                if (headingMatch && headingMatch[1]) {
                  detectedPath = headingMatch[1].trim();
                  break;
                }
              }
            }

            if (detectedPath) {
              const cleanPath = detectedPath.replace(/^\/+/, '');
              if (!codeFiles.some((f) => f.path === cleanPath)) {
                codeFiles.push({
                  path: cleanPath,
                  content: blockContent,
                  language: currentLang.split(/\s+/)[0] || 'typescript',
                });
              }
            }
          }
        }
      } else if (inCode) {
        currentBlockLines.push(line);
      }
    }

    return {
      patches,
      deleteFileMatches,
      deleteFolderMatches,
      createFolderMatches,
      codeFiles,
    };
  },

  /**
   * Autonomously executes changes onto the project based on the selected Automation Mode
   */
  execute(
    project: Project,
    assistantText: string,
    mode: AutomationMode = 'automatic'
  ): WorkspaceOperationResult {
    const ops = this.parseOperations(assistantText);
    let workingFiles = [...project.files];

    const filesCreated: string[] = [];
    const filesUpdated: string[] = [];
    const filesDeleted: string[] = [];
    const foldersCreated: string[] = [...ops.createFolderMatches];
    const foldersDeleted: string[] = [...ops.deleteFolderMatches];
    let patchesAppliedCount = 0;

    if (mode === 'review') {
      // Manual review mode: stage changes without automatically applying to project
      return {
        updatedProject: project,
        filesCreated: [],
        filesUpdated: [],
        filesDeleted: [],
        foldersCreated: [],
        foldersDeleted: [],
        patchesAppliedCount: 0,
        hasChanges: false,
        summaryText: 'Manual Review mode active. Changes staged for inspection.',
      };
    }

    // 1. Process Folder Deletions (Applies in both 'automatic' and 'automatic_plus')
    if (ops.deleteFolderMatches.length > 0) {
      for (const folderPath of ops.deleteFolderMatches) {
        const cleanFolder = folderPath.replace(/^\/+|\/+$/g, '');
        const normalized = `${cleanFolder}/`;
        const initialCount = workingFiles.length;
        workingFiles = workingFiles.filter(
          (f) => !f.path.startsWith(normalized) && f.path !== cleanFolder && !f.path.startsWith(`${cleanFolder}/`)
        );
        if (workingFiles.length < initialCount) {
          if (!foldersDeleted.includes(cleanFolder)) foldersDeleted.push(cleanFolder);
        }
      }
    }

    // 2. Process File Deletions (Applies in both 'automatic' and 'automatic_plus')
    if (ops.deleteFileMatches.length > 0) {
      for (const filePath of ops.deleteFileMatches) {
        const cleanPath = filePath.replace(/^\/+/, '');
        const targetIdx = workingFiles.findIndex(
          (f) =>
            f.path.toLowerCase() === cleanPath.toLowerCase() ||
            f.name.toLowerCase() === cleanPath.toLowerCase() ||
            f.path.toLowerCase().endsWith(cleanPath.toLowerCase())
        );
        if (targetIdx !== -1) {
          const removed = workingFiles.splice(targetIdx, 1)[0];
          if (!filesDeleted.includes(removed.path)) {
            filesDeleted.push(removed.path);
          }
        }
      }
    }

    // 3. Apply Search/Replace Patches to existing files (Both 'automatic' and 'automatic_plus')
    if (ops.patches.length > 0) {
      for (const patch of ops.patches) {
        const targetPath = patch.filePath?.replace(/^\/+/, '').toLowerCase();
        let targetFileIdx = -1;

        if (targetPath) {
          targetFileIdx = workingFiles.findIndex(
            (f) =>
              f.path.toLowerCase() === targetPath ||
              f.name.toLowerCase() === targetPath ||
              f.path.toLowerCase().endsWith(targetPath)
          );
        }

        // If no filename attached to patch but there's only 1 file in workspace
        if (targetFileIdx === -1 && workingFiles.length === 1) {
          targetFileIdx = 0;
        }

        if (targetFileIdx !== -1) {
          const original = workingFiles[targetFileIdx];
          const result = PatchApplier.applyPatch(original.content, patch.searchChunk, patch.replaceChunk);
          if (result.success) {
            workingFiles[targetFileIdx] = {
              ...original,
              content: result.updatedContent,
              size: result.updatedContent.length,
              lastModified: Date.now(),
            };
            patchesAppliedCount++;
            if (!filesUpdated.includes(original.path)) {
              filesUpdated.push(original.path);
            }
          }
        }
      }
    }

    // 4. Process Full Code Files / Creations (Applies in both 'automatic' and 'automatic_plus')
    if (ops.codeFiles.length > 0) {
      for (const cf of ops.codeFiles) {
        const cleanPath = cf.path.replace(/^\/+/, '');
        const existingIdx = workingFiles.findIndex(
          (f) => f.path.toLowerCase() === cleanPath.toLowerCase() || f.name.toLowerCase() === cleanPath.toLowerCase()
        );
        const fileName = cleanPath.split('/').pop() || cleanPath;

        if (existingIdx !== -1) {
          // Update existing file with new content
          workingFiles[existingIdx] = {
            ...workingFiles[existingIdx],
            content: cf.content,
            size: cf.content.length,
            lastModified: Date.now(),
          };
          if (!filesUpdated.includes(cleanPath)) {
            filesUpdated.push(cleanPath);
          }
        } else {
          // Create new file autonomously in the workspace
          const newFile: ProjectFile = {
            id: `file-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
            name: fileName,
            path: cleanPath,
            content: cf.content,
            size: cf.content.length,
            includedInContext: true,
            language: cf.language || 'typescript',
            lastModified: Date.now(),
          };
          workingFiles.push(newFile);
          filesCreated.push(cleanPath);

          // Track folder creations if nested
          if (cleanPath.includes('/')) {
            const folderPart = cleanPath.substring(0, cleanPath.lastIndexOf('/'));
            if (!foldersCreated.includes(folderPart)) {
              foldersCreated.push(folderPart);
            }
          }
        }
      }
    }

    const hasChanges =
      filesCreated.length > 0 ||
      filesUpdated.length > 0 ||
      filesDeleted.length > 0 ||
      foldersDeleted.length > 0 ||
      patchesAppliedCount > 0;

    const summaryParts: string[] = [];
    if (filesCreated.length > 0) summaryParts.push(`Created ${filesCreated.length} file(s)`);
    if (filesUpdated.length > 0) summaryParts.push(`Updated ${filesUpdated.length} file(s)`);
    if (filesDeleted.length > 0) summaryParts.push(`Deleted ${filesDeleted.length} file(s)`);
    if (foldersDeleted.length > 0) summaryParts.push(`Removed ${foldersDeleted.length} folder(s)`);
    if (patchesAppliedCount > 0) summaryParts.push(`Applied ${patchesAppliedCount} patch(es)`);

    const summaryText = summaryParts.length > 0 ? summaryParts.join(' • ') : 'No file changes required.';

    const updatedProject: Project = {
      ...project,
      files: workingFiles,
      updatedAt: Date.now(),
    };

    return {
      updatedProject,
      filesCreated,
      filesUpdated,
      filesDeleted,
      foldersCreated,
      foldersDeleted,
      patchesAppliedCount,
      hasChanges,
      summaryText,
    };
  },
};

