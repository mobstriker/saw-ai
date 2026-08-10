import React, { useState, useEffect } from 'react';
import { X, MoveRight, Folder, Check, FileCode } from 'lucide-react';
import { Project, ProjectFile } from '../types';

interface MoveFileModalProps {
  isOpen: boolean;
  onClose: () => void;
  file: ProjectFile | null;
  project: Project;
  onMoveFile: (fileId: string, newPath: string) => void;
}

export const MoveFileModal: React.FC<MoveFileModalProps> = ({
  isOpen,
  onClose,
  file,
  project,
  onMoveFile,
}) => {
  const [targetFolder, setTargetFolder] = useState('');
  const [isCustom, setIsCustom] = useState(false);
  const [customFolder, setCustomFolder] = useState('');
  const [newFileName, setNewFileName] = useState('');

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

  useEffect(() => {
    if (file) {
      const parts = file.path.split('/');
      const currFolder = parts.length > 1 ? parts.slice(0, -1).join('/') : '';
      setTargetFolder(currFolder);
      setNewFileName(file.name);
      setIsCustom(false);
      setCustomFolder('');
    }
  }, [file, isOpen]);

  if (!isOpen || !file) return null;

  const resolvedFolder = isCustom
    ? customFolder.trim().replace(/^\/+|\/+$/g, '')
    : targetFolder.trim().replace(/^\/+|\/+$/g, '');

  const resolvedName = newFileName.trim().replace(/^\/+/, '') || file.name;
  const newFullPath = resolvedFolder ? `${resolvedFolder}/${resolvedName}` : resolvedName;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newFullPath) return;

    onMoveFile(file.id, newFullPath);
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/35 backdrop-blur-xs p-4 animate-in fade-in duration-150">
      <div className="flex flex-col w-full max-w-md bg-white rounded-2xl border border-[#E6DFD3] shadow-2xl overflow-hidden font-sans text-[#2C2825]">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-[#E6DFD3] bg-[#FAF8F5]">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-xl bg-[#C58B51] text-white flex items-center justify-center font-bold shadow-xs">
              <MoveRight size={16} />
            </div>
            <div>
              <h3 className="text-sm font-bold text-[#2C2825]">Move & Organize File</h3>
              <p className="text-[11px] text-[#7C756E]">Switch folder destination or rename file</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="w-8 h-8 rounded-xl flex items-center justify-center hover:bg-[#F5F1EA] text-[#7C756E] hover:text-[#2C2825] transition-colors cursor-pointer"
          >
            <X size={18} />
          </button>
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit} className="p-5 space-y-4">
          <div className="p-3 rounded-xl bg-[#FAF8F5] border border-[#E6DFD3] text-xs space-y-1">
            <span className="text-[#7C756E] font-medium">Current Location:</span>
            <div className="font-mono font-bold text-[#2C2825] truncate">{file.path}</div>
          </div>

          <div>
            <label className="block text-xs font-bold text-[#2C2825] mb-1">Destination Folder</label>
            {!isCustom ? (
              <select
                value={targetFolder}
                onChange={(e) => {
                  if (e.target.value === '__custom__') {
                    setIsCustom(true);
                  } else {
                    setTargetFolder(e.target.value);
                  }
                }}
                className="w-full px-3 py-2 rounded-xl text-xs bg-[#FAF8F5] border border-[#E6DFD3] focus:border-[#C58B51] outline-none font-medium cursor-pointer"
              >
                {existingFolders.map((f) => (
                  <option key={f} value={f}>
                    {f === '' ? '/ (Project Root)' : `📁 ${f}`}
                  </option>
                ))}
                <option value="__custom__">+ Custom Folder Path...</option>
              </select>
            ) : (
              <div className="flex items-center gap-1.5">
                <input
                  type="text"
                  value={customFolder}
                  onChange={(e) => setCustomFolder(e.target.value)}
                  placeholder="e.g. src/lib or backend/api"
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

          <div>
            <label className="block text-xs font-bold text-[#2C2825] mb-1">File Name</label>
            <input
              type="text"
              value={newFileName}
              onChange={(e) => setNewFileName(e.target.value)}
              className="w-full px-3.5 py-2.5 rounded-xl text-xs bg-[#FAF8F5] border border-[#E6DFD3] focus:border-[#C58B51] outline-none font-mono font-medium"
              required
            />
          </div>

          {newFullPath && (
            <div className="p-2.5 rounded-xl bg-[#FAF8F5] border border-[#E6DFD3] text-xs">
              <span className="text-[#7C756E]">New Target Path: </span>
              <span className="font-mono font-bold text-[#C58B51]">{newFullPath}</span>
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
              type="submit"
              className="px-5 py-2 rounded-xl bg-[#C58B51] hover:bg-[#B0783F] text-xs font-bold text-white shadow-xs transition-colors cursor-pointer flex items-center gap-1.5"
            >
              <Check size={14} />
              <span>Apply Move</span>
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
