import React, { useState, useRef } from 'react';
import {
  FolderTree,
  MessageSquare,
  Plus,
  FileCode,
  Upload,
  Download,
  Trash2,
  Edit2,
  Check,
  X,
  Sparkles,
  Layers,
  FileText,
  Clock,
  ArrowRight,
  ShieldCheck,
  ChevronRight,
  Archive,
} from 'lucide-react';
import { Project, ChatSession, ProjectFile } from '../types';
import { ContextInjector } from '../utils/contextInjector';
import { ZipExporter } from '../utils/zipExporter';
import { FileSecurity } from '../utils/fileSecurity';

interface ProjectWorkspaceViewProps {
  project: Project;
  chats: ChatSession[];
  onSelectChat: (chatId: string) => void;
  onNewChatInProject: (projectId: string) => void;
  onDeleteChat: (chatId: string) => void;
  onRenameChat: (chatId: string, newTitle: string) => void;
  onUpdateProject: (updatedProject: Project) => void;
  onViewFile: (file: ProjectFile) => void;
}

export const ProjectWorkspaceView: React.FC<ProjectWorkspaceViewProps> = ({
  project,
  chats,
  onSelectChat,
  onNewChatInProject,
  onDeleteChat,
  onRenameChat,
  onUpdateProject,
  onViewFile,
}) => {
  const [isEditingInstructions, setIsEditingInstructions] = useState(false);
  const [instructionsText, setInstructionsText] = useState(project.instructions || '');
  const [isEditingDescription, setIsEditingDescription] = useState(false);
  const [descriptionText, setDescriptionText] = useState(project.description || '');
  const [isEditingChatId, setIsEditingChatId] = useState<string | null>(null);
  const [editChatTitle, setEditChatTitle] = useState('');
  const [isDragOver, setIsDragOver] = useState(false);

  const fileInputRef = useRef<HTMLInputElement | null>(null);

  // Filter chats that belong to this specific project
  const projectChats = chats.filter((c) => c.projectId === project.id);

  const handleSaveInstructions = () => {
    onUpdateProject({
      ...project,
      instructions: instructionsText.trim(),
      updatedAt: Date.now(),
    });
    setIsEditingInstructions(false);
  };

  const handleSaveDescription = () => {
    onUpdateProject({
      ...project,
      description: descriptionText.trim(),
      updatedAt: Date.now(),
    });
    setIsEditingDescription(false);
  };

  const handleAddFiles = async (e: React.ChangeEvent<HTMLInputElement>) => {
    if (!e.target.files) return;
    const newFiles: ProjectFile[] = [];
    const fileList: File[] = Array.from(e.target.files);

    for (const f of fileList) {
      const readResult = await FileSecurity.readFileSafely(f, f.name);
      if (!readResult.allowed) {
        console.warn(`Blocked unsafe file: ${f.name} (${readResult.reason})`);
        continue;
      }
      newFiles.push({
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

    if (newFiles.length > 0) {
      onUpdateProject({
        ...project,
        files: [...project.files, ...newFiles],
        updatedAt: Date.now(),
      });
    }

    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const handleDropFiles = async (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(false);

    if (!e.dataTransfer.files || e.dataTransfer.files.length === 0) return;

    const newFiles: ProjectFile[] = [];
    const fileList: File[] = Array.from(e.dataTransfer.files);

    for (const f of fileList) {
      const readResult = await FileSecurity.readFileSafely(f, f.name);
      if (!readResult.allowed) {
        console.warn(`Blocked unsafe file: ${f.name} (${readResult.reason})`);
        continue;
      }
      newFiles.push({
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

    if (newFiles.length > 0) {
      onUpdateProject({
        ...project,
        files: [...project.files, ...newFiles],
        updatedAt: Date.now(),
      });
    }
  };

  const handleRemoveFile = (fileId: string) => {
    onUpdateProject({
      ...project,
      files: project.files.filter((f) => f.id !== fileId),
      updatedAt: Date.now(),
    });
  };

  const handleToggleFileContext = (fileId: string) => {
    onUpdateProject({
      ...project,
      files: project.files.map((f) =>
        f.id === fileId ? { ...f, includedInContext: !f.includedInContext } : f
      ),
      updatedAt: Date.now(),
    });
  };

  const startRenameChat = (chat: ChatSession, e: React.MouseEvent) => {
    e.stopPropagation();
    setIsEditingChatId(chat.id);
    setEditChatTitle(chat.title);
  };

  const saveRenameChat = (chatId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    if (editChatTitle.trim()) {
      onRenameChat(chatId, editChatTitle.trim());
    }
    setIsEditingChatId(null);
  };

  return (
    <div
      className="flex-1 flex flex-col h-full bg-[#FAF8F5] overflow-y-auto font-sans text-[#2C2825] p-6 lg:p-8"
      onDragOver={(e) => {
        e.preventDefault();
        setIsDragOver(true);
      }}
      onDragLeave={() => setIsDragOver(false)}
      onDrop={handleDropFiles}
    >
      <div className="max-w-4xl mx-auto w-full space-y-6">
        {/* Top Project Header Banner */}
        <div className="p-6 rounded-2xl bg-white border border-[#E6DFD3] shadow-xs">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-4 mb-4 border-b border-[#E6DFD3]">
            <div className="flex items-center gap-3.5">
              <div className="w-12 h-12 rounded-2xl bg-[#C58B51] flex items-center justify-center text-white font-extrabold text-xl shadow-xs shrink-0">
                ✦
              </div>
              <div>
                <div className="flex items-center gap-2">
                  <h1 className="text-lg font-black tracking-tight text-[#2C2825]">{project.name}</h1>
                  <span className="text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full bg-[#FAF8F5] text-[#C58B51] border border-[#E6DFD3]">
                    Workspace Hub
                  </span>
                </div>

                {isEditingDescription ? (
                  <div className="flex items-center gap-2 mt-1">
                    <input
                      type="text"
                      value={descriptionText}
                      onChange={(e) => setDescriptionText(e.target.value)}
                      className="px-2 py-1 text-xs rounded bg-[#FAF8F5] border border-[#C58B51] outline-none"
                      autoFocus
                    />
                    <button
                      onClick={handleSaveDescription}
                      className="p-1 text-emerald-600 hover:bg-emerald-50 rounded"
                    >
                      <Check size={14} />
                    </button>
                    <button
                      onClick={() => setIsEditingDescription(false)}
                      className="p-1 text-gray-500 hover:bg-gray-100 rounded"
                    >
                      <X size={14} />
                    </button>
                  </div>
                ) : (
                  <p
                    className="text-xs text-[#7C756E] mt-0.5 cursor-pointer hover:text-[#2C2825] flex items-center gap-1 group"
                    onClick={() => {
                      setDescriptionText(project.description || '');
                      setIsEditingDescription(true);
                    }}
                    title="Click to edit description"
                  >
                    <span>{project.description || 'Add a project description...'}</span>
                    <Edit2 size={11} className="opacity-0 group-hover:opacity-100 text-[#C58B51]" />
                  </p>
                )}
              </div>
            </div>

            {/* Action Buttons: Download ZIP and New Chat */}
            <div className="flex items-center gap-2.5 shrink-0">
              <button
                type="button"
                onClick={() => ZipExporter.exportProjectAsZip(project)}
                className="flex items-center justify-center gap-1.5 px-4 py-2.5 rounded-xl bg-[#FAF8F5] hover:bg-[#F5F1EA] text-[#C58B51] hover:text-[#B0783F] border border-[#E6DFD3] hover:border-[#C58B51] text-xs font-bold transition-all cursor-pointer shadow-2xs"
                title={`Download entire "${project.name}" workspace as a .zip archive`}
              >
                <Download size={14} />
                <span>Export as .ZIP</span>
              </button>

              <button
                type="button"
                onClick={() => onNewChatInProject(project.id)}
                className="flex items-center justify-center gap-2 px-5 py-2.5 rounded-xl bg-[#C58B51] hover:bg-[#B0783F] text-white text-xs font-extrabold shadow-sm transition-all cursor-pointer"
              >
                <Plus size={16} />
                <span>New Chat in {project.name}</span>
              </button>
            </div>
          </div>

          {/* Quick Metrics & Context Status Badges */}
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
            <div className="p-3 rounded-xl bg-[#FAF8F5] border border-[#E6DFD3] flex items-center gap-2.5">
              <MessageSquare size={16} className="text-[#C58B51] shrink-0" />
              <div>
                <div className="text-xs font-bold text-[#2C2825]">{projectChats.length} Conversations</div>
                <div className="text-[10px] text-[#7C756E]">Chats in this project</div>
              </div>
            </div>

            <div className="p-3 rounded-xl bg-[#FAF8F5] border border-[#E6DFD3] flex items-center gap-2.5">
              <FileCode size={16} className="text-[#C58B51] shrink-0" />
              <div>
                <div className="text-xs font-bold text-[#2C2825]">{project.files.length} Ground-Truth Files</div>
                <div className="text-[10px] text-[#7C756E]">Pure context retained</div>
              </div>
            </div>

            <div className="p-3 rounded-xl bg-[#FAF8F5] border border-[#E6DFD3] flex items-center gap-2.5 col-span-2 sm:col-span-1">
              <Sparkles size={16} className="text-[#C58B51] shrink-0" />
              <div>
                <div className="text-xs font-bold text-[#2C2825]">
                  {project.instructions ? 'Instructions Active' : 'Default Prompt'}
                </div>
                <div className="text-[10px] text-[#7C756E]">Injected in all chats</div>
              </div>
            </div>
          </div>
        </div>

        {/* Section 1: Previous Chats in this Project */}
        <div className="p-6 rounded-2xl bg-white border border-[#E6DFD3] shadow-xs space-y-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <MessageSquare size={16} className="text-[#C58B51]" />
              <h2 className="text-sm font-extrabold text-[#2C2825]">
                Chats in this Project ({projectChats.length})
              </h2>
            </div>

            <button
              type="button"
              onClick={() => onNewChatInProject(project.id)}
              className="text-xs font-bold text-[#C58B51] hover:underline flex items-center gap-1 cursor-pointer"
            >
              <Plus size={13} />
              <span>New Topic Chat</span>
            </button>
          </div>

          <p className="text-xs text-[#7C756E] leading-relaxed">
            Each chat maintains full context of your project files and instructions. Start separate chats to focus on different topics (e.g. bug fixing, UI redesign, backend API).
          </p>

          {projectChats.length === 0 ? (
            <div className="p-8 rounded-2xl bg-[#FAF8F5] border border-dashed border-[#E6DFD3] text-center flex flex-col items-center justify-center gap-2">
              <div className="w-10 h-10 rounded-xl bg-white border border-[#E6DFD3] flex items-center justify-center text-[#C58B51] shadow-2xs">
                <MessageSquare size={18} />
              </div>
              <h3 className="text-xs font-bold text-[#2C2825]">No chats in this workspace yet</h3>
              <p className="text-[11px] text-[#7C756E] max-w-sm">
                Start your first discussion with full ground-truth context and instructions.
              </p>
              <button
                type="button"
                onClick={() => onNewChatInProject(project.id)}
                className="mt-2 flex items-center gap-1.5 px-4 py-2 rounded-xl bg-[#C58B51] hover:bg-[#B0783F] text-white text-xs font-bold shadow-2xs transition-colors cursor-pointer"
              >
                <Plus size={14} />
                <span>Start First Chat</span>
              </button>
            </div>
          ) : (
            <div className="grid grid-cols-1 gap-2.5">
              {projectChats.map((chat) => {
                const isEditing = isEditingChatId === chat.id;
                // Display clean chat title
                const displayTitle = chat.title;

                return (
                  <div
                    key={chat.id}
                    onClick={() => onSelectChat(chat.id)}
                    className="group p-3.5 rounded-xl bg-[#FAF8F5] hover:bg-white border border-[#E6DFD3] hover:border-[#C58B51] transition-all cursor-pointer flex items-center justify-between gap-3 shadow-2xs"
                  >
                    <div className="flex items-center gap-3 min-w-0 flex-1">
                      <div className="w-8 h-8 rounded-lg bg-white border border-[#E6DFD3] flex items-center justify-center text-[#C58B51] shrink-0">
                        <MessageSquare size={15} />
                      </div>

                      {isEditing ? (
                        <div
                          className="flex items-center gap-1 flex-1"
                          onClick={(e) => e.stopPropagation()}
                        >
                          <input
                            type="text"
                            value={editChatTitle}
                            onChange={(e) => setEditChatTitle(e.target.value)}
                            className="w-full px-2 py-1 text-xs rounded bg-white border border-[#C58B51] outline-none"
                            autoFocus
                          />
                          <button
                            onClick={(e) => saveRenameChat(chat.id, e)}
                            className="p-1 text-emerald-600 hover:bg-emerald-50 rounded"
                          >
                            <Check size={14} />
                          </button>
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              setIsEditingChatId(null);
                            }}
                            className="p-1 text-gray-500 hover:bg-gray-100 rounded"
                          >
                            <X size={14} />
                          </button>
                        </div>
                      ) : (
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-1.5">
                            <span className="text-xs font-bold text-[#2C2825] truncate">
                              {chat.title}
                            </span>
                            <span className="text-[10px] text-[#A09890] shrink-0 font-medium">
                              / {project.name}
                            </span>
                          </div>

                          <div className="text-[10px] text-[#7C756E] flex items-center gap-2 mt-0.5">
                            <span>{chat.messages.length} messages</span>
                            <span>•</span>
                            <span className="flex items-center gap-1">
                              <Clock size={10} />
                              {new Date(chat.updatedAt).toLocaleDateString([], {
                                month: 'short',
                                day: 'numeric',
                                hour: '2-digit',
                                minute: '2-digit',
                              })}
                            </span>
                          </div>
                        </div>
                      )}
                    </div>

                    <div className="flex items-center gap-1 shrink-0">
                      {!isEditing && (
                        <>
                          <button
                            type="button"
                            onClick={(e) => startRenameChat(chat, e)}
                            className="p-1.5 text-[#7C756E] hover:text-[#C58B51] rounded-lg hover:bg-white opacity-0 group-hover:opacity-100 transition-opacity"
                            title="Rename Chat"
                          >
                            <Edit2 size={13} />
                          </button>
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              onDeleteChat(chat.id);
                            }}
                            className="p-1.5 text-[#7C756E] hover:text-red-600 rounded-lg hover:bg-white opacity-0 group-hover:opacity-100 transition-opacity"
                            title="Delete Chat"
                          >
                            <Trash2 size={13} />
                          </button>
                        </>
                      )}
                      <ChevronRight size={16} className="text-[#A09890] group-hover:text-[#C58B51]" />
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Section 2: Project Instructions / AI System Context */}
        <div className="p-6 rounded-2xl bg-white border border-[#E6DFD3] shadow-xs space-y-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Sparkles size={16} className="text-[#C58B51]" />
              <h2 className="text-sm font-extrabold text-[#2C2825]">
                Project Instructions & Context Directives
              </h2>
            </div>

            {!isEditingInstructions && (
              <button
                type="button"
                onClick={() => {
                  setInstructionsText(project.instructions || '');
                  setIsEditingInstructions(true);
                }}
                className="text-xs font-bold text-[#C58B51] hover:underline flex items-center gap-1 cursor-pointer"
              >
                <Edit2 size={12} />
                <span>Edit Instructions</span>
              </button>
            )}
          </div>

          <p className="text-xs text-[#7C756E]">
            These instructions are automatically sent with every chat inside this project so the AI stays aligned with your coding standards and rules.
          </p>

          {isEditingInstructions ? (
            <div className="space-y-2">
              <textarea
                rows={4}
                value={instructionsText}
                onChange={(e) => setInstructionsText(e.target.value)}
                placeholder="e.g. Always write strict TypeScript. Use Tailwind CSS. When modifying code, keep the component modular..."
                className="w-full p-3 rounded-xl text-xs bg-[#FAF8F5] border border-[#C58B51] focus:bg-white outline-none font-mono leading-relaxed"
                autoFocus
              />
              <div className="flex items-center justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setIsEditingInstructions(false)}
                  className="px-3 py-1.5 rounded-lg text-xs font-semibold text-[#7C756E] hover:text-[#2C2825]"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={handleSaveInstructions}
                  className="flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs font-bold bg-[#C58B51] hover:bg-[#B0783F] text-white shadow-2xs"
                >
                  <Check size={13} />
                  <span>Save Instructions</span>
                </button>
              </div>
            </div>
          ) : (
            <div className="p-3.5 rounded-xl bg-[#FAF8F5] border border-[#E6DFD3] font-mono text-xs text-[#2C2825] leading-relaxed whitespace-pre-wrap">
              {project.instructions || (
                <span className="text-[#A09890] italic font-sans">
                  No specific instructions configured yet. Click "Edit Instructions" to define project-wide AI guidelines.
                </span>
              )}
            </div>
          )}
        </div>

        {/* Section 3: Project Files & Ground-Truth Context */}
        <div className="p-6 rounded-2xl bg-white border border-[#E6DFD3] shadow-xs space-y-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <FileCode size={16} className="text-[#C58B51]" />
              <h2 className="text-sm font-extrabold text-[#2C2825]">
                Project Files ({project.files.length})
              </h2>
            </div>

            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => ZipExporter.exportProjectAsZip(project)}
                className="text-xs font-bold text-[#7C756E] hover:text-[#C58B51] hover:underline flex items-center gap-1 cursor-pointer"
                title="Download all workspace files as .zip archive"
              >
                <Download size={12} />
                <span>Download .ZIP</span>
              </button>

              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                className="text-xs font-bold text-[#C58B51] hover:underline flex items-center gap-1 cursor-pointer ml-1"
              >
                <Upload size={12} />
                <span>Add Files</span>
              </button>
            </div>
          </div>

          <input
            type="file"
            ref={fileInputRef}
            onChange={handleAddFiles}
            multiple
            className="hidden"
          />

          {/* Drag & Drop Upload Zone */}
          <div
            onClick={() => fileInputRef.current?.click()}
            className={`p-4 rounded-xl border-2 border-dashed transition-all cursor-pointer text-center flex items-center justify-center gap-2 ${
              isDragOver
                ? 'border-[#C58B51] bg-[#FAF8F5]'
                : 'border-[#E6DFD3] hover:border-[#C58B51] bg-[#FCFBF7]'
            }`}
          >
            <Upload size={15} className="text-[#C58B51]" />
            <span className="text-xs font-bold text-[#2C2825]">
              Drag & drop more files here, or click to browse
            </span>
          </div>

          {/* Files List */}
          {project.files.length === 0 ? (
            <div className="p-4 text-center text-xs text-[#7C756E]">
              No files uploaded to this project yet.
            </div>
          ) : (
            <div className="space-y-1.5 max-h-60 overflow-y-auto pr-1">
              {project.files.map((file) => (
                <div
                  key={file.id}
                  className="flex items-center justify-between p-2.5 rounded-xl bg-[#FAF8F5] border border-[#E6DFD3] text-xs hover:bg-white transition-colors"
                >
                  <div
                    className="flex items-center gap-2.5 min-w-0 flex-1 cursor-pointer"
                    onClick={() => onViewFile(file)}
                  >
                    <FileCode size={14} className="text-[#C58B51] shrink-0" />
                    <span className="font-mono text-xs font-bold text-[#2C2825] truncate">
                      {file.name}
                    </span>
                    <span className="text-[9px] font-mono px-1.5 py-0.2 rounded bg-white text-[#7C756E] border border-[#E6DFD3] shrink-0">
                      {file.language}
                    </span>
                    <span className="text-[10px] text-[#A09890] shrink-0">
                      {(file.size / 1024).toFixed(1)} KB
                    </span>
                  </div>

                  <div className="flex items-center gap-2 shrink-0">
                    <button
                      type="button"
                      onClick={() => handleToggleFileContext(file.id)}
                      className={`text-[10px] px-2 py-0.5 rounded-md font-bold cursor-pointer transition-colors ${
                        file.includedInContext !== false
                          ? 'bg-emerald-50 text-emerald-700 border border-emerald-200'
                          : 'bg-gray-100 text-gray-500 border border-gray-200'
                      }`}
                      title="Toggle inclusion in prompt context"
                    >
                      {file.includedInContext !== false ? 'In Context' : 'Excluded'}
                    </button>

                    <button
                      type="button"
                      onClick={() => handleRemoveFile(file.id)}
                      className="p-1 text-[#7C756E] hover:text-red-600 cursor-pointer"
                      title="Remove file from project"
                    >
                      <Trash2 size={13} />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
