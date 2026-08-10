import React, { useState, useEffect } from 'react';
import { X, Check, Folder, FileCode, CheckCircle2, Sparkles } from 'lucide-react';
import { Project, ProjectFile } from '../types';
import { ContextInjector } from '../utils/contextInjector';

interface ImplementModalProps {
  isOpen: boolean;
  onClose: () => void;
  code: string;
  language: string;
  suggestedPath: string;
  project: Project | null;
  onImplement: (file: ProjectFile) => void;
}

export const ImplementModal: React.FC<ImplementModalProps> = ({
  isOpen,
  onClose,
  code,
  language,
  suggestedPath,
  project,
  onImplement,
}) => {
  const [filePath, setFilePath] = useState(suggestedPath);
  const [selectedFolder, setSelectedFolder] = useState('');
  const [isCustomFolder, setIsCustomFolder] = useState(false);
  const [customFolder, setCustomFolder] = useState('');
  const [fileName, setFileName] = useState('');
  const [includeInContext, setIncludeInContext] = useState(true);

  // Extract all existing unique folder paths from project files
  const existingFolders = React.useMemo(() => {
    const folderSet = new Set<string>();
    folderSet.add(''); // Root

    if (project) {
      project.files.forEach((f) => {
        const parts = f.path.split('/');
        if (parts.length > 1) {
          for (let i = 1; i < parts.length; i++) {
            folderSet.add(parts.slice(0, i).join('/'));
          }
        }
      });
    }

    return Array.from(folderSet).sort();
  }, [project?.files]);

  useEffect(() => {
    if (suggestedPath) {
      const parts = suggestedPath.replace(/^\/+/, '').split('/');
      if (parts.length > 1) {
        const folder = parts.slice(0, -1).join('/');
        const name = parts[parts.length - 1];
        setSelectedFolder(folder);
        setFileName(name);
      } else {
        setSelectedFolder('src/components');
        setFileName(suggestedPath.replace(/^\/+/, ''));
      }
    }
  }, [suggestedPath, isOpen]);

  if (!isOpen) return null;

  const targetFolder = isCustomFolder
    ? customFolder.trim().replace(/^\/+|\/+$/g, '')
    : selectedFolder.trim().replace(/^\/+|\/+$/g, '');

  const cleanName = fileName.trim().replace(/^\/+/, '') || 'Component.tsx';
  const finalPath = targetFolder ? `${targetFolder}/${cleanName}` : cleanName;
  const detectedLang = ContextInjector.detectLanguage(cleanName) || language;
  const lines = code.split('\n');

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const newFile: ProjectFile = {
      id: `f-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      name: cleanName.split('/').pop() || cleanName,
      path: finalPath,
      content: code,
      size: new Blob([code]).size,
      includedInContext: includeInContext,
      language: detectedLang,
      lastModified: Date.now(),
    };

    onImplement(newFile);
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/35 backdrop-blur-xs p-4 animate-in fade-in duration-150">
      <div className="flex flex-col w-full max-w-2xl max-h-[90vh] bg-white rounded-2xl border border-[#E6DFD3] shadow-2xl overflow-hidden font-sans text-[#2C2825]">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-[#E6DFD3] bg-[#FAF8F5]">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-xl bg-[#C58B51] text-white flex items-center justify-center font-bold shadow-xs">
              <Sparkles size={16} />
            </div>
            <div>
              <h3 className="text-sm font-bold text-[#2C2825]">Implement to Project Workspace</h3>
              <p className="text-[11px] text-[#7C756E]">
                Write code artifact into project tree with 100% full-file context retention
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
        <form onSubmit={handleSubmit} className="flex-1 overflow-y-auto p-5 space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {/* Target Folder */}
            <div>
              <label className="block text-xs font-bold text-[#2C2825] mb-1">Target Folder</label>
              {!isCustomFolder ? (
                <select
                  value={selectedFolder}
                  onChange={(e) => {
                    if (e.target.value === '__custom__') {
                      setIsCustomFolder(true);
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
                  <option value="__custom__">+ Custom Folder Path...</option>
                </select>
              ) : (
                <div className="flex items-center gap-1.5">
                  <input
                    type="text"
                    value={customFolder}
                    onChange={(e) => setCustomFolder(e.target.value)}
                    placeholder="e.g. src/components or lib/utils"
                    className="flex-1 px-3 py-2 rounded-xl text-xs bg-[#FAF8F5] border border-[#E6DFD3] focus:border-[#C58B51] outline-none font-mono"
                    autoFocus
                  />
                  <button
                    type="button"
                    onClick={() => setIsCustomFolder(false)}
                    className="px-2.5 py-2 text-xs font-semibold rounded-xl bg-white border border-[#E6DFD3] text-[#7C756E] hover:text-[#2C2825] cursor-pointer"
                  >
                    Cancel
                  </button>
                </div>
              )}
            </div>

            {/* Target File Name */}
            <div>
              <label className="block text-xs font-bold text-[#2C2825] mb-1">File Name</label>
              <input
                type="text"
                value={fileName}
                onChange={(e) => setFileName(e.target.value)}
                className="w-full px-3 py-2 rounded-xl text-xs bg-[#FAF8F5] border border-[#E6DFD3] focus:border-[#C58B51] outline-none font-mono font-medium"
                required
              />
            </div>
          </div>

          {/* Full Path & Stats Banner */}
          <div className="p-3 rounded-xl bg-[#FAF8F5] border border-[#E6DFD3] flex items-center justify-between text-xs">
            <div className="flex items-center gap-2">
              <span className="text-[#7C756E] font-medium">Destination:</span>
              <span className="font-mono font-bold text-[#C58B51]">{finalPath}</span>
            </div>
            <div className="flex items-center gap-3">
              <span className="text-[11px] text-[#7C756E] font-mono">{lines.length} lines</span>
              <span className="text-[10px] px-2 py-0.5 rounded-full bg-white border border-[#E6DFD3] font-mono text-[#7C756E] uppercase">
                {detectedLang}
              </span>
            </div>
          </div>

          {/* Code Preview */}
          <div>
            <label className="block text-xs font-bold text-[#2C2825] mb-1">Code Preview</label>
            <div className="p-3 rounded-xl bg-white border border-[#E6DFD3] max-h-48 overflow-y-auto font-mono text-xs text-[#2C2825] leading-relaxed">
              <pre className="m-0">
                <code>{code}</code>
              </pre>
            </div>
          </div>

          {/* In-Prompt Context Checkbox */}
          <div className="flex items-center justify-between p-3 rounded-xl border border-[#E6DFD3] bg-white">
            <div>
              <div className="text-xs font-bold text-[#2C2825]">Include in LLM Prompt Context</div>
              <div className="text-[11px] text-[#7C756E]">
                100% in-memory raw retention with zero token chunking loss
              </div>
            </div>
            <input
              type="checkbox"
              checked={includeInContext}
              onChange={(e) => setIncludeInContext(e.target.checked)}
              className="w-4 h-4 accent-[#C58B51] cursor-pointer"
            />
          </div>

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
              <span>Implement to Workspace</span>
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
