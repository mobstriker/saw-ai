import React, { useState } from 'react';
import { X, Upload, Folder, Check, FileText, AlertTriangle } from 'lucide-react';
import { Project, ProjectFile } from '../types';
import { ContextInjector } from '../utils/contextInjector';
import { FileSecurity } from '../utils/fileSecurity';

interface SingleFileUploadModalProps {
  isOpen: boolean;
  onClose: () => void;
  files: File[];
  project: Project;
  onConfirmUpload: (newFiles: ProjectFile[]) => void;
}

export const SingleFileUploadModal: React.FC<SingleFileUploadModalProps> = ({
  isOpen,
  onClose,
  files,
  project,
  onConfirmUpload,
}) => {
  const [selectedFolder, setSelectedFolder] = useState('');
  const [isCustom, setIsCustom] = useState(false);
  const [customFolder, setCustomFolder] = useState('');

  const [blockedWarnings, setBlockedWarnings] = useState<string[]>([]);

  // Extract all existing unique folder paths
  const existingFolders = React.useMemo(() => {
    const folderSet = new Set<string>();
    folderSet.add(''); // Root

    project.files.forEach((f) => {
      const parts = f.path.split('/');
      if (parts.length > 1) {
        for (let i = 1; i < parts.length; i++) {
          folderSet.add(parts.slice(0, i).join('/'));
        }
      }
    });

    return Array.from(folderSet).sort();
  }, [project.files]);

  if (!isOpen || files.length === 0) return null;

  const targetFolder = isCustom
    ? customFolder.trim().replace(/^\/+|\/+$/g, '')
    : selectedFolder.trim().replace(/^\/+|\/+$/g, '');

  const handleUpload = async () => {
    const projectFiles: ProjectFile[] = [];
    const blocked: string[] = [];

    for (let i = 0; i < files.length; i++) {
      const f = files[i];
      const path = targetFolder ? `${targetFolder}/${f.name}` : f.name;
      const readResult = await FileSecurity.readFileSafely(f, path);

      if (!readResult.allowed) {
        blocked.push(readResult.reason || `Blocked: ${f.name}`);
        continue;
      }

      projectFiles.push({
        id: `f-${Date.now()}-${i}-${Math.random().toString(36).slice(2, 6)}`,
        name: f.name,
        path,
        content: readResult.content,
        size: f.size,
        includedInContext: true,
        language: readResult.language,
        lastModified: f.lastModified || Date.now(),
      });
    }

    if (blocked.length > 0) {
      setBlockedWarnings(blocked);
    }

    if (projectFiles.length > 0) {
      onConfirmUpload(projectFiles);
      if (blocked.length === 0) {
        onClose();
      }
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/35 backdrop-blur-xs p-4 animate-in fade-in duration-150">
      <div className="flex flex-col w-full max-w-md bg-white rounded-2xl border border-[#E6DFD3] shadow-2xl overflow-hidden font-sans text-[#2C2825]">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-[#E6DFD3] bg-[#FAF8F5]">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-xl bg-[#C58B51] text-white flex items-center justify-center font-bold shadow-xs">
              <Upload size={16} />
            </div>
            <div>
              <h3 className="text-sm font-bold text-[#2C2825]">Upload to Workspace Folder</h3>
              <p className="text-[11px] text-[#7C756E]">
                Select target folder for {files.length} uploaded file{files.length > 1 ? 's' : ''}
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="w-8 h-8 rounded-xl flex items-center justify-center hover:bg-[#F5F1EA] text-[#7C756E] hover:text-[#2C2825] transition-colors cursor-pointer"
          >
            <X size={18} />
          </button>
        </div>

        {/* Form Body */}
        <div className="p-5 space-y-4">
          {/* File list preview */}
          <div className="p-3 rounded-xl bg-[#FAF8F5] border border-[#E6DFD3] text-xs space-y-1.5 max-h-36 overflow-y-auto">
            <span className="text-[11px] font-bold text-[#7C756E] uppercase">Files to upload:</span>
            {files.map((f, idx) => (
              <div key={idx} className="flex items-center justify-between font-mono text-xs text-[#2C2825]">
                <div className="flex items-center gap-1.5 truncate">
                  <FileText size={12} className="text-[#C58B51] shrink-0" />
                  <span className="truncate">{f.name}</span>
                </div>
                <span className="text-[10px] text-[#7C756E]">{(f.size / 1024).toFixed(1)} KB</span>
              </div>
            ))}
          </div>

          <div>
            <label className="block text-xs font-bold text-[#2C2825] mb-1">Destination Folder</label>
            {!isCustom ? (
              <select
                value={selectedFolder}
                onChange={(e) => {
                  if (e.target.value === '__custom__') {
                    setIsCustom(true);
                  } else {
                    setSelectedFolder(e.target.value);
                  }
                }}
                className="w-full px-3 py-2 rounded-xl text-xs bg-[#FAF8F5] border border-[#E6DFD3] focus:border-[#C58B51] outline-none font-medium cursor-pointer"
              >
                {existingFolders.map((f) => (
                  <option key={f} value={f}>
                    {f === '' ? '/ (Project Root)' : `📁 ${f}`}
                  </option>
                ))}
                <option value="__custom__">+ Place in New Custom Folder...</option>
              </select>
            ) : (
              <div className="flex items-center gap-1.5">
                <input
                  type="text"
                  value={customFolder}
                  onChange={(e) => setCustomFolder(e.target.value)}
                  placeholder="e.g. src/lib or assets/data"
                  className="flex-1 px-3 py-2 rounded-xl text-xs bg-[#FAF8F5] border border-[#E6DFD3] focus:border-[#C58B51] outline-none font-mono"
                  autoFocus
                />
                <button
                  type="button"
                  onClick={() => setIsCustom(false)}
                  className="px-2.5 py-2 text-xs font-semibold rounded-xl bg-white border border-[#E6DFD3] text-[#7C756E] hover:text-[#2C2825] cursor-pointer"
                >
                  Cancel
                </button>
              </div>
            )}
          </div>

          {targetFolder && (
            <div className="p-2.5 rounded-xl bg-[#FAF8F5] border border-[#E6DFD3] text-xs">
              <span className="text-[#7C756E]">Target Path: </span>
              <span className="font-mono font-bold text-[#C58B51]">/{targetFolder}/</span>
            </div>
          )}

          {/* Blocked Files Warning */}
          {blockedWarnings.length > 0 && (
            <div className="p-3 rounded-xl bg-amber-50 border border-amber-200 text-xs text-amber-900 space-y-1">
              <div className="flex items-center gap-1.5 font-bold text-amber-800">
                <AlertTriangle size={14} className="shrink-0" />
                <span>Security Notice: Some files were skipped</span>
              </div>
              <ul className="list-disc pl-4 space-y-0.5 text-[11px]">
                {blockedWarnings.map((w, idx) => (
                  <li key={idx}>{w}</li>
                ))}
              </ul>
            </div>
          )}

          {/* Footer */}
          <div className="flex items-center justify-end gap-2 pt-2 border-t border-[#E6DFD3]">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 rounded-xl border border-[#E6DFD3] bg-white text-xs font-bold text-[#7C756E] hover:text-[#2C2825] transition-colors cursor-pointer"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={handleUpload}
              className="px-5 py-2 rounded-xl bg-[#C58B51] hover:bg-[#B0783F] text-xs font-bold text-white shadow-xs transition-colors cursor-pointer flex items-center gap-1.5"
            >
              <Check size={14} />
              <span>Upload to Workspace</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
