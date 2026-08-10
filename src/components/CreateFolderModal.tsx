import React, { useState } from 'react';
import { X, FolderPlus, Folder, Check } from 'lucide-react';
import { Project } from '../types';

interface CreateFolderModalProps {
  isOpen: boolean;
  onClose: () => void;
  project: Project;
  parentFolder?: string;
  onCreateFolder: (folderPath: string) => void;
}

export const CreateFolderModal: React.FC<CreateFolderModalProps> = ({
  isOpen,
  onClose,
  project,
  parentFolder = '',
  onCreateFolder,
}) => {
  const [folderName, setFolderName] = useState('');
  const [selectedParent, setSelectedParent] = useState(parentFolder);

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

  if (!isOpen) return null;

  const cleanFolderName = folderName.trim().replace(/^\/+|\/+$/g, '');
  const finalFolderPath = selectedParent
    ? `${selectedParent}/${cleanFolderName}`
    : cleanFolderName;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!cleanFolderName) return;

    onCreateFolder(finalFolderPath);
    onClose();
    setFolderName('');
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/35 backdrop-blur-xs p-4 animate-in fade-in duration-150">
      <div className="flex flex-col w-full max-w-md bg-white rounded-2xl border border-[#E6DFD3] shadow-2xl overflow-hidden font-sans text-[#2C2825]">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-[#E6DFD3] bg-[#FAF8F5]">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-xl bg-[#C58B51] text-white flex items-center justify-center font-bold shadow-xs">
              <FolderPlus size={16} />
            </div>
            <div>
              <h3 className="text-sm font-bold text-[#2C2825]">Create New Folder</h3>
              <p className="text-[11px] text-[#7C756E]">Organize workspace files and nested modules</p>
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
          <div>
            <label className="block text-xs font-bold text-[#2C2825] mb-1">Parent Location</label>
            <select
              value={selectedParent}
              onChange={(e) => setSelectedParent(e.target.value)}
              className="w-full px-3 py-2 rounded-xl text-xs bg-[#FAF8F5] border border-[#E6DFD3] focus:border-[#C58B51] outline-none font-medium cursor-pointer"
            >
              {existingFolders.map((f) => (
                <option key={f} value={f}>
                  {f === '' ? '/ (Project Root)' : `📁 ${f}`}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-xs font-bold text-[#2C2825] mb-1">Folder Name or Path</label>
            <input
              type="text"
              value={folderName}
              onChange={(e) => setFolderName(e.target.value)}
              placeholder="e.g. lib, components/ui, backend, tests"
              className="w-full px-3.5 py-2.5 rounded-xl text-xs bg-[#FAF8F5] border border-[#E6DFD3] focus:border-[#C58B51] outline-none font-mono font-medium"
              autoFocus
              required
            />
          </div>

          {cleanFolderName && (
            <div className="p-2.5 rounded-xl bg-[#FAF8F5] border border-[#E6DFD3] text-xs">
              <span className="text-[#7C756E]">Resulting Folder: </span>
              <span className="font-mono font-bold text-[#C58B51]">{finalFolderPath}/</span>
            </div>
          )}

          {/* Footer buttons */}
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
              disabled={!cleanFolderName}
              className="px-5 py-2 rounded-xl bg-[#C58B51] hover:bg-[#B0783F] text-xs font-bold text-white shadow-xs transition-colors cursor-pointer disabled:opacity-50 flex items-center gap-1.5"
            >
              <Check size={14} />
              <span>Create Folder</span>
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
