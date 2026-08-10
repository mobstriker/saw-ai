import React, { useState, useRef } from 'react';
import {
  Folder,
  FolderOpen,
  FolderPlus,
  FilePlus2,
  FileCode,
  FileText,
  FileJson,
  FileSpreadsheet,
  Upload,
  Download,
  Plus,
  ChevronRight,
  ChevronDown,
  CheckCircle2,
  Circle,
  Eye,
  Trash2,
  Layers,
  MoveRight,
  FolderInput,
} from 'lucide-react';
import { FolderNode, Project, ProjectFile } from '../types';
import { ContextInjector } from '../utils/contextInjector';
import { ZipExporter } from '../utils/zipExporter';
import { FileSecurity } from '../utils/fileSecurity';

interface FileTreeProps {
  project: Project;
  onSelectFile: (file: ProjectFile) => void;
  onUpdateProject: (project: Project) => void;
  onCreateFile: (initialFolder?: string) => void;
  onCreateFolder: (parentFolder?: string) => void;
  onUploadFilesClick?: () => void;
  onMoveFile: (file: ProjectFile) => void;
}

export const FileTree: React.FC<FileTreeProps> = ({
  project,
  onSelectFile,
  onUpdateProject,
  onCreateFile,
  onCreateFolder,
  onUploadFilesClick,
  onMoveFile,
}) => {
  const [expandedFolders, setExpandedFolders] = useState<Record<string, boolean>>({
    src: true,
    'src/components': true,
    'src/types': true,
    lib: true,
    app: true,
  });
  const [searchFilter, setSearchFilter] = useState('');
  const [dragOverFolder, setDragOverFolder] = useState<string | null>(null);
  const folderUploadInputRef = useRef<HTMLInputElement | null>(null);
  const singleFilesInputRef = useRef<HTMLInputElement | null>(null);

  const toggleFolder = (path: string) => {
    setExpandedFolders((prev) => ({
      ...prev,
      [path]: !prev[path],
    }));
  };

  const toggleFileContext = (fileId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    const updatedFiles = project.files.map((f) =>
      f.id === fileId ? { ...f, includedInContext: f.includedInContext === false } : f
    );
    onUpdateProject({
      ...project,
      files: updatedFiles,
      updatedAt: Date.now(),
    });
  };

  const deleteFile = (fileId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    const updatedFiles = project.files.filter((f) => f.id !== fileId);
    onUpdateProject({
      ...project,
      files: updatedFiles,
      updatedAt: Date.now(),
    });
  };

  const deleteFolder = (folderPath: string, e: React.MouseEvent) => {
    e.stopPropagation();
    const normalized = folderPath.replace(/^\/+|\/+$/g, '');
    const updatedFiles = project.files.filter(
      (f) => !f.path.startsWith(`${normalized}/`) && f.path !== normalized
    );
    onUpdateProject({
      ...project,
      files: updatedFiles,
      updatedAt: Date.now(),
    });
  };

  // Folder Upload via webkitdirectory
  const handleFolderUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const fileList = e.target.files;
    if (!fileList || fileList.length === 0) return;

    const newFiles: ProjectFile[] = [...project.files];

    for (let i = 0; i < fileList.length; i++) {
      const file = fileList[i];
      const rawPath = (file as any).webkitRelativePath || file.name;
      
      // Skip internal VCS directories (.git/)
      if (rawPath.includes('.git/') || rawPath.startsWith('.git/')) continue;

      const path = rawPath.replace(/^[^/]+\//, ''); // remove root folder wrapper if present
      const readResult = await FileSecurity.readFileSafely(file, path);

      if (!readResult.allowed) {
        console.warn(`File upload skipped (${file.name}):`, readResult.reason);
        continue;
      }

      const existingIdx = newFiles.findIndex((f) => f.path === path);
      const projectFile: ProjectFile = {
        id: `f-${Date.now()}-${i}`,
        name: file.name,
        path,
        content: readResult.content,
        size: file.size,
        includedInContext: true,
        language: readResult.language,
        lastModified: file.lastModified || Date.now(),
      };

      if (existingIdx >= 0) {
        newFiles[existingIdx] = projectFile;
      } else {
        newFiles.push(projectFile);
      }
    }

    onUpdateProject({
      ...project,
      files: newFiles,
      updatedAt: Date.now(),
    });
  };

  // Drag & drop files onto folder or tree
  const handleDropOnFolder = async (e: React.DragEvent, targetFolder: string) => {
    e.preventDefault();
    e.stopPropagation();
    setDragOverFolder(null);

    const items = e.dataTransfer.files;
    if (!items || items.length === 0) return;

    const newFiles: ProjectFile[] = [...project.files];
    for (let i = 0; i < items.length; i++) {
      const f = items[i];
      const finalPath = targetFolder ? `${targetFolder}/${f.name}` : f.name;
      const readResult = await FileSecurity.readFileSafely(f, finalPath);

      if (!readResult.allowed) {
        console.warn(`Dropped file rejected (${f.name}):`, readResult.reason);
        continue;
      }

      const existingIdx = newFiles.findIndex((existing) => existing.path === finalPath);
      const projectFile: ProjectFile = {
        id: `f-${Date.now()}-${i}-${Math.random().toString(36).slice(2, 6)}`,
        name: f.name,
        path: finalPath,
        content: readResult.content,
        size: f.size,
        includedInContext: true,
        language: readResult.language,
        lastModified: f.lastModified || Date.now(),
      };

      if (existingIdx >= 0) {
        newFiles[existingIdx] = projectFile;
      } else {
        newFiles.push(projectFile);
      }
    }

    onUpdateProject({
      ...project,
      files: newFiles,
      updatedAt: Date.now(),
    });
  };

  // Build tree
  const filteredFiles = searchFilter
    ? project.files.filter((f) => f.path.toLowerCase().includes(searchFilter.toLowerCase()))
    : project.files;

  const folderTree = ContextInjector.buildFolderTree(filteredFiles);
  const contextStats = ContextInjector.buildProjectPromptContext(project);

  return (
    <div className="flex flex-col h-full bg-white font-sans text-[#2C2825] select-none">
      {/* Workspace Header with Action Buttons */}
      <div className="p-3 border-b border-[#E6DFD3] bg-[#FAF8F5] space-y-2.5">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2 truncate">
            <div className="w-6 h-6 rounded-lg bg-[#C58B51] flex items-center justify-center text-white text-[11px] font-bold shadow-2xs shrink-0">
              <Layers size={13} />
            </div>
            <span className="text-xs font-bold text-[#2C2825] truncate">{project.name}</span>
          </div>

          {/* Quick Add Actions */}
          <div className="flex items-center gap-1 shrink-0">
            <button
              onClick={() => onCreateFile('')}
              className="flex items-center gap-1 px-2 py-1 rounded-lg bg-white border border-[#E6DFD3] hover:border-[#C58B51] text-[10px] font-bold text-[#2C2825] shadow-2xs transition-all cursor-pointer hover:text-[#C58B51]"
              title="Create new file (.py, .tsx, .env, .json)"
            >
              <FilePlus2 size={11} className="text-[#C58B51]" />
              <span>+ File</span>
            </button>
            <button
              onClick={() => onCreateFolder('')}
              className="flex items-center gap-1 px-2 py-1 rounded-lg bg-white border border-[#E6DFD3] hover:border-[#C58B51] text-[10px] font-bold text-[#2C2825] shadow-2xs transition-all cursor-pointer hover:text-[#C58B51]"
              title="Create new folder in workspace"
            >
              <FolderPlus size={11} className="text-[#C58B51]" />
              <span>+ Folder</span>
            </button>
          </div>
        </div>

        {/* Upload Folder / Upload Files / Download ZIP buttons */}
        <div className="flex items-center gap-1.5">
          <button
            onClick={() => folderUploadInputRef.current?.click()}
            className="flex-1 flex items-center justify-center gap-1.5 py-1.5 px-2 rounded-xl bg-white border border-[#E6DFD3] hover:border-[#C58B51] text-[11px] font-bold text-[#2C2825] shadow-2xs transition-all cursor-pointer hover:bg-[#FAF8F5]"
            title="Upload entire folder structure (webkitdirectory)"
          >
            <Upload size={12} className="text-[#C58B51]" />
            <span>Folder</span>
          </button>

          {onUploadFilesClick && (
            <button
              onClick={onUploadFilesClick}
              className="flex-1 flex items-center justify-center gap-1.5 py-1.5 px-2 rounded-xl bg-white border border-[#E6DFD3] hover:border-[#C58B51] text-[11px] font-bold text-[#2C2825] shadow-2xs transition-all cursor-pointer hover:bg-[#FAF8F5]"
              title="Upload single or multiple files to specific folder"
            >
              <FolderInput size={12} className="text-[#C58B51]" />
              <span>Files...</span>
            </button>
          )}

          <button
            onClick={() => ZipExporter.exportProjectAsZip(project)}
            className="flex items-center justify-center gap-1 py-1.5 px-2.5 rounded-xl bg-[#FAF8F5] border border-[#E6DFD3] hover:border-[#C58B51] text-[11px] font-bold text-[#C58B51] hover:text-[#B0783F] shadow-2xs transition-all cursor-pointer hover:bg-[#F5F1EA]"
            title="Download entire project workspace as a .zip archive"
          >
            <Download size={12} />
            <span>.ZIP</span>
          </button>

          <input
            ref={folderUploadInputRef}
            type="file"
            multiple
            // @ts-ignore
            webkitdirectory="true"
            directory="true"
            className="hidden"
            onChange={handleFolderUpload}
          />
        </div>

        {/* Search / Filter in tree */}
        <input
          type="text"
          value={searchFilter}
          onChange={(e) => setSearchFilter(e.target.value)}
          placeholder="Search / filter files..."
          className="w-full px-2.5 py-1.5 rounded-xl text-xs bg-white border border-[#E6DFD3] focus:border-[#C58B51] outline-none placeholder:text-[#A09890]"
        />
      </div>

      {/* Pure Context Stats Bar */}
      <div className="px-3.5 py-2 bg-white border-b border-[#E6DFD3] flex items-center justify-between text-[10px] text-[#7C756E]">
        <div className="flex items-center gap-1.5">
          <span className="w-2 h-2 rounded-full bg-emerald-500"></span>
          <span>
            Context: <strong className="text-[#2C2825]">{contextStats.includedFilesCount}</strong> /{' '}
            {contextStats.totalFiles} files
          </span>
        </div>
        <span className="font-mono text-[#C58B51] font-bold">
          ~{contextStats.estimatedTokens.toLocaleString()} tokens
        </span>
      </div>

      {/* Directory Tree View */}
      <div
        onDragOver={(e) => {
          e.preventDefault();
          e.stopPropagation();
        }}
        onDrop={(e) => handleDropOnFolder(e, '')}
        className="flex-1 overflow-y-auto p-2 space-y-0.5"
      >
        {folderTree.length === 0 ? (
          <div className="p-6 text-center text-xs text-[#7C756E] space-y-3">
            <p>No files in this project workspace.</p>
            <div className="flex flex-col gap-2 max-w-xs mx-auto">
              <button
                onClick={() => onCreateFile('')}
                className="px-3 py-2 rounded-xl bg-[#C58B51] text-white text-xs font-bold shadow-xs cursor-pointer hover:bg-[#B0783F]"
              >
                + Create File (.py, .tsx, .env)
              </button>
              <button
                onClick={() => folderUploadInputRef.current?.click()}
                className="px-3 py-1.5 rounded-xl bg-white border border-[#E6DFD3] text-[#2C2825] text-xs font-bold cursor-pointer hover:border-[#C58B51]"
              >
                Upload Folder
              </button>
            </div>
          </div>
        ) : (
          folderTree.map((node) => (
            <TreeNode
              key={node.path}
              node={node}
              level={0}
              expandedFolders={expandedFolders}
              dragOverFolder={dragOverFolder}
              onToggleFolder={toggleFolder}
              onSelectFile={onSelectFile}
              onToggleContext={toggleFileContext}
              onDeleteFile={deleteFile}
              onCreateFileInFolder={(folder) => onCreateFile(folder)}
              onCreateFolderInFolder={(folder) => onCreateFolder(folder)}
              onDeleteFolder={deleteFolder}
              onMoveFile={onMoveFile}
              onDropOnFolder={handleDropOnFolder}
              setDragOverFolder={setDragOverFolder}
            />
          ))
        )}
      </div>

      {/* Footer Info */}
      <div className="p-2.5 border-t border-[#E6DFD3] bg-[#FAF8F5] text-[10px] text-[#7C756E] flex items-center justify-between">
        <span>Pure Context (100% In-Memory)</span>
        <span className="text-[#C58B51] font-bold">No RAG Loss</span>
      </div>
    </div>
  );
};

interface TreeNodeProps {
  node: FolderNode;
  level: number;
  expandedFolders: Record<string, boolean>;
  dragOverFolder: string | null;
  onToggleFolder: (path: string) => void;
  onSelectFile: (file: ProjectFile) => void;
  onToggleContext: (fileId: string, e: React.MouseEvent) => void;
  onDeleteFile: (fileId: string, e: React.MouseEvent) => void;
  onCreateFileInFolder: (folder: string) => void;
  onCreateFolderInFolder: (folder: string) => void;
  onDeleteFolder: (folder: string, e: React.MouseEvent) => void;
  onMoveFile: (file: ProjectFile) => void;
  onDropOnFolder: (e: React.DragEvent, folder: string) => void;
  setDragOverFolder: (folder: string | null) => void;
}

const TreeNode: React.FC<TreeNodeProps> = ({
  node,
  level,
  expandedFolders,
  dragOverFolder,
  onToggleFolder,
  onSelectFile,
  onToggleContext,
  onDeleteFile,
  onCreateFileInFolder,
  onCreateFolderInFolder,
  onDeleteFolder,
  onMoveFile,
  onDropOnFolder,
  setDragOverFolder,
}) => {
  const isExpanded = expandedFolders[node.path] ?? true;
  const isOver = dragOverFolder === node.path;

  if (node.isFolder) {
    return (
      <div
        onDragOver={(e) => {
          e.preventDefault();
          e.stopPropagation();
          setDragOverFolder(node.path);
        }}
        onDragLeave={(e) => {
          e.preventDefault();
          e.stopPropagation();
          if (dragOverFolder === node.path) setDragOverFolder(null);
        }}
        onDrop={(e) => onDropOnFolder(e, node.path)}
        className={`rounded-lg transition-colors ${isOver ? 'bg-[#FAF8F5] ring-2 ring-[#C58B51]' : ''}`}
      >
        <div
          onClick={() => onToggleFolder(node.path)}
          style={{ paddingLeft: `${level * 14 + 6}px` }}
          className="flex items-center justify-between py-1 px-2 rounded-lg hover:bg-[#FAF8F5] text-xs font-bold text-[#2C2825] cursor-pointer transition-colors group"
        >
          <div className="flex items-center gap-1.5 min-w-0 flex-1">
            <span className="text-[#7C756E]">
              {isExpanded ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
            </span>
            <span className="text-[#C58B51]">
              {isExpanded ? <FolderOpen size={14} /> : <Folder size={14} />}
            </span>
            <span className="truncate text-xs">{node.name}</span>
          </div>

          {/* Folder Action Buttons on Hover */}
          <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
            <button
              onClick={(e) => {
                e.stopPropagation();
                onCreateFileInFolder(node.path);
              }}
              className="p-1 text-[#7C756E] hover:text-[#C58B51] cursor-pointer rounded hover:bg-white"
              title={`Create file in ${node.path}/`}
            >
              <FilePlus2 size={12} />
            </button>
            <button
              onClick={(e) => {
                e.stopPropagation();
                onCreateFolderInFolder(node.path);
              }}
              className="p-1 text-[#7C756E] hover:text-[#C58B51] cursor-pointer rounded hover:bg-white"
              title={`Create subfolder in ${node.path}/`}
            >
              <FolderPlus size={12} />
            </button>
            <button
              onClick={(e) => onDeleteFolder(node.path, e)}
              className="p-1 text-[#7C756E] hover:text-red-600 cursor-pointer rounded hover:bg-white"
              title={`Delete folder ${node.path} and contents`}
            >
              <Trash2 size={12} />
            </button>
          </div>
        </div>

        {isExpanded && node.children && (
          <div>
            {node.children.map((child) => (
              <TreeNode
                key={child.path}
                node={child}
                level={level + 1}
                expandedFolders={expandedFolders}
                dragOverFolder={dragOverFolder}
                onToggleFolder={onToggleFolder}
                onSelectFile={onSelectFile}
                onToggleContext={onToggleContext}
                onDeleteFile={onDeleteFile}
                onCreateFileInFolder={onCreateFileInFolder}
                onCreateFolderInFolder={onCreateFolderInFolder}
                onDeleteFolder={onDeleteFolder}
                onMoveFile={onMoveFile}
                onDropOnFolder={onDropOnFolder}
                setDragOverFolder={setDragOverFolder}
              />
            ))}
          </div>
        )}
      </div>
    );
  }

  // File Node
  const file = node.file!;
  const isIncluded = file.includedInContext !== false;

  return (
    <div
      onClick={() => onSelectFile(file)}
      style={{ paddingLeft: `${level * 14 + 18}px` }}
      className={`flex items-center justify-between py-1 px-2 rounded-lg text-xs transition-colors cursor-pointer group ${
        isIncluded ? 'hover:bg-[#FAF8F5] text-[#2C2825]' : 'opacity-60 hover:bg-[#FAF8F5] text-[#7C756E]'
      }`}
    >
      <div className="flex items-center gap-1.5 min-w-0 flex-1">
        {getFileIcon(file.name)}
        <span className="truncate text-xs font-medium">{file.name}</span>
      </div>

      <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
        {/* Move / Switch folder or rename */}
        <button
          onClick={(e) => {
            e.stopPropagation();
            onMoveFile(file);
          }}
          className="p-1 text-[#7C756E] hover:text-[#C58B51] cursor-pointer rounded hover:bg-white"
          title="Move / Switch folder destination or rename file"
        >
          <MoveRight size={12} />
        </button>

        {/* Toggle Context Inclusion */}
        <button
          onClick={(e) => onToggleContext(file.id, e)}
          className="p-1 text-[#7C756E] hover:text-[#C58B51] cursor-pointer rounded hover:bg-white"
          title={isIncluded ? 'Included in LLM Prompt Context' : 'Excluded from Context'}
        >
          {isIncluded ? <CheckCircle2 size={13} className="text-emerald-600" /> : <Circle size={13} />}
        </button>

        {/* Delete file */}
        <button
          onClick={(e) => onDeleteFile(file.id, e)}
          className="p-1 text-[#7C756E] hover:text-red-600 cursor-pointer rounded hover:bg-white"
          title="Remove file from workspace"
        >
          <Trash2 size={12} />
        </button>
      </div>
    </div>
  );
};

function getFileIcon(fileName: string) {
  const ext = fileName.split('.').pop()?.toLowerCase();
  switch (ext) {
    case 'tsx':
    case 'jsx':
      return <FileCode size={13} className="text-[#C58B51] shrink-0" />;
    case 'ts':
    case 'js':
      return <FileCode size={13} className="text-[#D4A373] shrink-0" />;
    case 'py':
      return <FileCode size={13} className="text-amber-600 shrink-0" />;
    case 'json':
      return <FileJson size={13} className="text-[#A09890] shrink-0" />;
    case 'env':
      return <FileCode size={13} className="text-emerald-600 shrink-0" />;
    case 'sql':
      return <FileSpreadsheet size={13} className="text-blue-600 shrink-0" />;
    case 'css':
    case 'scss':
      return <FileSpreadsheet size={13} className="text-[#C58B51] shrink-0" />;
    case 'html':
    case 'svg':
      return <FileText size={13} className="text-amber-700 shrink-0" />;
    case 'md':
      return <FileText size={13} className="text-[#7C756E] shrink-0" />;
    default:
      return <FileText size={13} className="text-[#7C756E] shrink-0" />;
  }
}
