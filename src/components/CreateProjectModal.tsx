import React, { useState, useRef } from 'react';
import {
  X,
  FolderPlus,
  FileCode,
  Upload,
  Trash2,
  Sparkles,
  Info,
  Check,
  FileText,
  Layers,
} from 'lucide-react';
import { ProjectFile } from '../types';
import { ContextInjector } from '../utils/contextInjector';
import { FileSecurity } from '../utils/fileSecurity';

interface CreateProjectModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSaveProject: (data: {
    name: string;
    description: string;
    instructions: string;
    files: ProjectFile[];
  }) => void;
}

export const CreateProjectModal: React.FC<CreateProjectModalProps> = ({
  isOpen,
  onClose,
  onSaveProject,
}) => {
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [instructions, setInstructions] = useState('');
  const [files, setFiles] = useState<ProjectFile[]>([]);
  const [isDragOver, setIsDragOver] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fileInputRef = useRef<HTMLInputElement | null>(null);

  if (!isOpen) return null;

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    if (!e.target.files) return;
    const uploadedFiles: ProjectFile[] = [];
    const fileList: File[] = Array.from(e.target.files);

    for (const f of fileList) {
      const readResult = await FileSecurity.readFileSafely(f, f.name);
      if (!readResult.allowed) {
        setError(readResult.reason || `Blocked unsafe file: ${f.name}`);
        continue;
      }
      uploadedFiles.push({
        id: `file-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
        name: f.name,
        path: f.name,
        content: readResult.content,
        size: f.size,
        language: readResult.language,
        includedInContext: true,
        lastModified: f.lastModified || Date.now(),
      });
    }

    setFiles((prev) => [...prev, ...uploadedFiles]);
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(true);
  };

  const handleDragLeave = () => {
    setIsDragOver(false);
  };

  const handleDrop = async (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(false);

    if (!e.dataTransfer.files || e.dataTransfer.files.length === 0) return;

    const uploadedFiles: ProjectFile[] = [];
    const fileList: File[] = Array.from(e.dataTransfer.files);

    for (const f of fileList) {
      const readResult = await FileSecurity.readFileSafely(f, f.name);
      if (!readResult.allowed) {
        setError(readResult.reason || `Blocked unsafe file: ${f.name}`);
        continue;
      }
      uploadedFiles.push({
        id: `file-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
        name: f.name,
        path: f.name,
        content: readResult.content,
        size: f.size,
        language: readResult.language,
        includedInContext: true,
        lastModified: f.lastModified || Date.now(),
      });
    }

    setFiles((prev) => [...prev, ...uploadedFiles]);
  };

  const handleRemoveFile = (fileId: string) => {
    setFiles((prev) => prev.filter((f) => f.id !== fileId));
  };

  const handleSave = (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) {
      setError('Please enter a project name.');
      return;
    }

    onSaveProject({
      name: name.trim(),
      description: description.trim(),
      instructions: instructions.trim(),
      files,
    });

    // Reset form state
    setName('');
    setDescription('');
    setInstructions('');
    setFiles([]);
    setError(null);
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-xs p-4 animate-in fade-in duration-200">
      <div
        className="w-full max-w-2xl rounded-2xl bg-white border border-[#E6DFD3] shadow-2xl p-6 text-[#2C2825] font-sans max-h-[90vh] flex flex-col overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between pb-4 mb-4 border-b border-[#E6DFD3] shrink-0">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-[#FAF8F5] border border-[#E6DFD3] flex items-center justify-center text-[#C58B51] shadow-2xs">
              <FolderPlus size={20} />
            </div>
            <div>
              <h2 className="text-base font-extrabold tracking-tight text-[#2C2825]">
                Create New Project Workspace
              </h2>
              <p className="text-xs text-[#7C756E]">
                Configure full project context, instructions, and workspace files
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="w-8 h-8 rounded-lg flex items-center justify-center text-[#7C756E] hover:text-[#2C2825] hover:bg-[#FAF8F5] transition-colors cursor-pointer"
            title="Close modal"
          >
            <X size={18} />
          </button>
        </div>

        {/* Scrollable Form Body */}
        <form onSubmit={handleSave} className="flex-1 overflow-y-auto space-y-4 pr-1">
          {error && (
            <div className="p-3 rounded-xl bg-red-50 border border-red-200 text-xs text-red-700 flex items-center gap-2">
              <Info size={14} className="shrink-0" />
              <span>{error}</span>
            </div>
          )}

          {/* 1. Project Name */}
          <div className="space-y-1.5">
            <label className="block text-xs font-bold text-[#2C2825]">
              Project Name <span className="text-red-500">*</span>
            </label>
            <input
              type="text"
              value={name}
              onChange={(e) => {
                setName(e.target.value);
                if (error) setError(null);
              }}
              placeholder="e.g. My React App, Customer Portal, SaaS Dashboard..."
              className="w-full px-3 py-2 rounded-xl text-xs bg-[#FAF8F5] border border-[#E6DFD3] focus:border-[#C58B51] focus:bg-white outline-none transition-all placeholder:text-[#A09890]"
              autoFocus
            />
          </div>

          {/* 2. Description (Optional) */}
          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <label className="block text-xs font-bold text-[#2C2825]">
                Description <span className="text-[10px] font-normal text-[#7C756E]">(Optional)</span>
              </label>
            </div>
            <input
              type="text"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="e.g. Full-stack TypeScript application with Tailwind and REST API"
              className="w-full px-3 py-2 rounded-xl text-xs bg-[#FAF8F5] border border-[#E6DFD3] focus:border-[#C58B51] focus:bg-white outline-none transition-all placeholder:text-[#A09890]"
            />
          </div>

          {/* 3. Project Instructions / System Prompt (Optional but Important) */}
          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <label className="block text-xs font-bold text-[#2C2825]">
                Project Instructions / System Context{' '}
                <span className="text-[10px] font-normal text-[#7C756E]">(Optional)</span>
              </label>
              <span className="text-[10px] text-[#C58B51] font-mono font-medium flex items-center gap-1">
                <Sparkles size={11} />
                Injected in all chats
              </span>
            </div>
            <p className="text-[11px] text-[#7C756E] leading-relaxed">
              Custom instructions the AI will always follow for every chat inside this project (coding standards, architectural rules, tech stack guidelines, tone, etc.).
            </p>
            <textarea
              rows={3}
              value={instructions}
              onChange={(e) => setInstructions(e.target.value)}
              placeholder="e.g. Always write clean TypeScript with strict types. Use Tailwind CSS for styling. Never use mock data stubs. When answering, provide complete code files..."
              className="w-full px-3 py-2 rounded-xl text-xs bg-[#FAF8F5] border border-[#E6DFD3] focus:border-[#C58B51] focus:bg-white outline-none transition-all placeholder:text-[#A09890] font-mono leading-relaxed"
            />
          </div>

          {/* 4. Upload Files */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <label className="block text-xs font-bold text-[#2C2825]">
                Project Files & Ground-Truth Context{' '}
                <span className="text-[10px] font-normal text-[#7C756E]">
                  ({files.length} uploaded)
                </span>
              </label>
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                className="text-[11px] font-bold text-[#C58B51] hover:underline flex items-center gap-1 cursor-pointer"
              >
                <Upload size={12} />
                <span>Browse Files</span>
              </button>
            </div>

            <input
              type="file"
              ref={fileInputRef}
              onChange={handleFileChange}
              multiple
              className="hidden"
            />

            {/* Drag & Drop Box */}
            <div
              onDragOver={handleDragOver}
              onDragLeave={handleDragLeave}
              onDrop={handleDrop}
              onClick={() => fileInputRef.current?.click()}
              className={`p-4 rounded-xl border-2 border-dashed transition-all cursor-pointer text-center flex flex-col items-center justify-center gap-1.5 ${
                isDragOver
                  ? 'border-[#C58B51] bg-[#FAF8F5]'
                  : 'border-[#E6DFD3] hover:border-[#C58B51] bg-[#FCFBF7]'
              }`}
            >
              <div className="w-8 h-8 rounded-lg bg-white border border-[#E6DFD3] flex items-center justify-center text-[#C58B51] shadow-2xs">
                <Upload size={15} />
              </div>
              <p className="text-xs font-bold text-[#2C2825]">
                Drag and drop files here, or click to browse
              </p>
              <p className="text-[10px] text-[#7C756E]">
                Supports .ts, .tsx, .js, .json, .py, .md, .css, .html, .env, .sql, configs, docs...
              </p>
            </div>

            {/* List of Uploaded Files */}
            {files.length > 0 && (
              <div className="space-y-1 max-h-40 overflow-y-auto pr-1">
                {files.map((file) => (
                  <div
                    key={file.id}
                    className="flex items-center justify-between p-2 rounded-xl bg-[#FAF8F5] border border-[#E6DFD3] text-xs"
                  >
                    <div className="flex items-center gap-2 min-w-0 flex-1">
                      <FileCode size={13} className="text-[#C58B51] shrink-0" />
                      <span className="font-mono text-[11px] font-bold text-[#2C2825] truncate">
                        {file.name}
                      </span>
                      <span className="text-[9px] font-mono px-1.5 py-0.2 rounded bg-white text-[#7C756E] border border-[#E6DFD3] shrink-0">
                        {file.language}
                      </span>
                      <span className="text-[10px] text-[#A09890] shrink-0">
                        {(file.size / 1024).toFixed(1)} KB
                      </span>
                    </div>

                    <button
                      type="button"
                      onClick={() => handleRemoveFile(file.id)}
                      className="text-[#7C756E] hover:text-red-600 p-1 cursor-pointer transition-colors"
                      title="Remove file"
                    >
                      <Trash2 size={12} />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        </form>

        {/* Footer Actions */}
        <div className="pt-4 mt-4 border-t border-[#E6DFD3] flex items-center justify-end gap-2.5 shrink-0">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 rounded-xl text-xs font-semibold text-[#7C756E] hover:text-[#2C2825] hover:bg-[#FAF8F5] transition-colors cursor-pointer"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleSave}
            className="flex items-center gap-1.5 px-4 py-2 rounded-xl text-xs font-bold bg-[#C58B51] hover:bg-[#B0783F] text-white shadow-sm transition-colors cursor-pointer"
          >
            <Check size={14} />
            <span>Save Project</span>
          </button>
        </div>
      </div>
    </div>
  );
};
