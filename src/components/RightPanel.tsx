import React from 'react';
import { FolderTree, Sparkles, ChevronRight, ChevronLeft } from 'lucide-react';
import { Project, ProjectFile, Artifact, RightPanelTab } from '../types';
import { FileTree } from './FileTree';
import { ArtifactViewer } from './ArtifactViewer';

interface RightPanelProps {
  isOpen: boolean;
  onToggle: () => void;
  width?: number;
  onResize?: (width: number) => void;
  activeTab: RightPanelTab;
  onSelectTab: (tab: RightPanelTab) => void;
  currentProject: Project | null;
  onSelectFile: (file: ProjectFile) => void;
  onUpdateProject: (project: Project) => void;
  currentArtifact: Artifact | null;
  allArtifacts: Artifact[];
  onSelectArtifact: (artifact: Artifact) => void;
  onCloseArtifact: () => void;
  onCreateFile: (initialFolder?: string) => void;
  onCreateFolder: (parentFolder?: string) => void;
  onUploadFilesClick?: () => void;
  onMoveFile: (file: ProjectFile) => void;
  onReportBug?: (bugMessage: string) => void;
  isUniversalChat?: boolean;
  onSaveAsProject?: () => void;
  isSavingAsProject?: boolean;
}

export const RightPanel: React.FC<RightPanelProps> = ({
  isOpen,
  onToggle,
  width = 380,
  onResize,
  activeTab,
  onSelectTab,
  currentProject,
  onSelectFile,
  onUpdateProject,
  currentArtifact,
  allArtifacts,
  onSelectArtifact,
  onCloseArtifact,
  onCreateFile,
  onCreateFolder,
  onUploadFilesClick,
  onMoveFile,
  onReportBug,
  isUniversalChat,
  onSaveAsProject,
  isSavingAsProject,
}) => {
  const handleMouseDownResize = (e: React.MouseEvent) => {
    e.preventDefault();
    const startX = e.clientX;
    const startWidth = width;

    const handleMouseMove = (moveEvent: MouseEvent) => {
      // Dragging left makes the right panel wider (delta is inverted)
      const delta = startX - moveEvent.clientX;
      const newWidth = Math.max(280, Math.min(800, startWidth + delta));
      if (onResize) {
        onResize(newWidth);
      }
    };

    const handleMouseUp = () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };

    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
  };

  if (!isOpen) {
    return (
      <aside className="w-12 border-l border-[#E6DFD3] bg-white flex flex-col items-center py-3 gap-3 shrink-0">
        <button
          onClick={onToggle}
          className="w-8 h-8 rounded-xl bg-[#FAF8F5] border border-[#E6DFD3] flex items-center justify-center text-[#7C756E] hover:text-[#2C2825] hover:border-[#C58B51] transition-all cursor-pointer"
          title="Open Secondary Panel"
        >
          <ChevronLeft size={16} />
        </button>

        {currentProject && (
          <button
            onClick={() => {
              onSelectTab('files');
              onToggle();
            }}
            className={`w-8 h-8 rounded-xl flex items-center justify-center transition-all cursor-pointer ${
              activeTab === 'files'
                ? 'bg-[#C58B51] text-white'
                : 'bg-[#FAF8F5] text-[#7C756E] hover:text-[#2C2825]'
            }`}
            title="Project File Explorer"
          >
            <FolderTree size={16} />
          </button>
        )}

        <button
          onClick={() => {
            onSelectTab('artifacts');
            onToggle();
          }}
          className={`w-8 h-8 rounded-xl flex items-center justify-center transition-all cursor-pointer ${
            activeTab === 'artifacts'
              ? 'bg-[#C58B51] text-white'
              : 'bg-[#FAF8F5] text-[#7C756E] hover:text-[#2C2825]'
          }`}
          title="Artifacts Sandbox"
        >
          <Sparkles size={16} />
        </button>
      </aside>
    );
  }

  return (
    <aside
      style={{ width: `${width}px` }}
      className="relative border-l border-[#E6DFD3] bg-white flex flex-col h-full font-sans overflow-hidden shadow-xs shrink-0"
    >
      {/* Draggable Width Resize Handle on Left Edge */}
      <div
        onMouseDown={handleMouseDownResize}
        className="absolute top-0 left-0 w-1.5 h-full cursor-col-resize hover:bg-[#C58B51]/40 active:bg-[#C58B51] transition-colors group z-30"
        title="Click & drag to resize right panel"
      >
        <div className="w-0.5 h-full mx-auto bg-transparent group-hover:bg-[#C58B51]" />
      </div>
      {/* Top Tab Bar Header */}
      <div className="flex h-13 items-center justify-between border-b border-[#E6DFD3] px-3 bg-white">
        <div className="flex items-center gap-1">
          {currentProject && (
            <button
              onClick={() => onSelectTab('files')}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold transition-all cursor-pointer ${
                activeTab === 'files'
                  ? 'bg-[#FAF8F5] text-[#C58B51] border border-[#E6DFD3]'
                  : 'text-[#7C756E] hover:text-[#2C2825]'
              }`}
            >
              <FolderTree size={14} />
              <span>Files</span>
              <span className="text-[10px] px-1 py-0.2 rounded bg-white text-[#7C756E] font-mono border border-[#E6DFD3]">
                {currentProject.files.length}
              </span>
            </button>
          )}

          <button
            onClick={() => onSelectTab('artifacts')}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold transition-all cursor-pointer ${
              activeTab === 'artifacts'
                ? 'bg-[#FAF8F5] text-[#C58B51] border border-[#E6DFD3]'
                : 'text-[#7C756E] hover:text-[#2C2825]'
            }`}
          >
            <Sparkles size={14} />
            <span>Artifacts</span>
            {allArtifacts.length > 0 && (
              <span className="text-[10px] px-1 py-0.2 rounded bg-[#C58B51] text-white font-mono">
                {allArtifacts.length}
              </span>
            )}
          </button>

          {/* "Save as a Project" — only in a universal (no-project) chat with 2+ artifacts (Feature 4) */}
          {isUniversalChat && allArtifacts.length >= 2 && onSaveAsProject && (
            <button
              onClick={onSaveAsProject}
              disabled={isSavingAsProject}
              className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-[11px] font-bold bg-[#C58B51] text-white hover:bg-[#b0783f] disabled:opacity-60 disabled:cursor-wait transition-all cursor-pointer"
              title="Promote these chat artifacts into a new Project (AI will name it and write build instructions)"
            >
              <FolderTree size={13} />
              <span>{isSavingAsProject ? 'Saving…' : 'Save as Project'}</span>
            </button>
          )}
        </div>

        {/* Collapse Button */}
        <button
          onClick={onToggle}
          className="w-7 h-7 rounded-lg flex items-center justify-center hover:bg-[#FAF8F5] text-[#7C756E] hover:text-[#2C2825] transition-colors cursor-pointer"
          title="Collapse Panel"
        >
          <ChevronRight size={16} />
        </button>
      </div>

      {/* Content Body */}
      <div className="flex-1 overflow-hidden">
        {activeTab === 'files' && currentProject ? (
          <FileTree
            project={currentProject}
            onSelectFile={onSelectFile}
            onUpdateProject={onUpdateProject}
            onCreateFile={onCreateFile}
            onCreateFolder={onCreateFolder}
            onUploadFilesClick={onUploadFilesClick}
            onMoveFile={onMoveFile}
          />
        ) : (
          <ArtifactViewer
            artifact={currentArtifact}
            allArtifacts={allArtifacts}
            onClose={onCloseArtifact}
            onSelectArtifact={onSelectArtifact}
            onReportBug={onReportBug}
          />
        )}
      </div>
    </aside>
  );
};
