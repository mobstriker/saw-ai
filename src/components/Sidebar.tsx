import React, { useState } from 'react';
import {
  FolderTree,
  MessageSquare,
  Plus,
  Settings,
  Search,
  Trash2,
  Edit2,
  Check,
  X,
  Layers,
  Sparkles,
  ChevronLeft,
  ChevronRight,
  Database,
  Upload,
  LogOut,
  MoreVertical,
  FileCode,
  Hash,
  ArrowDownRight,
  ArrowUpRight,
} from 'lucide-react';
import { Project, ChatSession, SidebarTab } from '../types';
import { deriveChatStats } from '../utils/chatStats';

interface SidebarProps {
  isOpen: boolean;
  onToggleCollapse: () => void;
  width?: number;
  onResize?: (width: number) => void;
  activeTab: SidebarTab;
  onSelectTab: (tab: SidebarTab) => void;
  projects: Project[];
  chats: ChatSession[];
  activeProjectId: string | null;
  activeChatId: string | null;
  onSelectProject: (projectId: string) => void;
  onSelectChat: (chatId: string) => void;
  onNewProject: () => void;
  onNewChat: () => void;
  onDeleteProject: (projectId: string) => void;
  onDeleteChat: (chatId: string) => void;
  onRenameProject: (projectId: string, newName: string) => void;
  onRenameChat: (chatId: string, newTitle: string) => void;
  onOpenSettings: () => void;
  onImportFolder?: (files: FileList | File[]) => void;
}

export const Sidebar: React.FC<SidebarProps> = ({
  isOpen,
  onToggleCollapse,
  width = 260,
  onResize,
  activeTab,
  onSelectTab,
  projects,
  chats,
  activeProjectId,
  activeChatId,
  onSelectProject,
  onSelectChat,
  onNewProject,
  onNewChat,
  onDeleteProject,
  onDeleteChat,
  onRenameProject,
  onRenameChat,
  onOpenSettings,
  onImportFolder,
}) => {
  const [searchQuery, setSearchQuery] = useState('');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState('');
  const [isDragOver, setIsDragOver] = useState(false);
  const [infoChatId, setInfoChatId] = useState<string | null>(null);

  if (!isOpen) return null;

  const handleMouseDownResize = (e: React.MouseEvent) => {
    e.preventDefault();
    const startX = e.clientX;
    const startWidth = width;

    const handleMouseMove = (moveEvent: MouseEvent) => {
      const delta = moveEvent.clientX - startX;
      const newWidth = Math.max(200, Math.min(520, startWidth + delta));
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

  const startRename = (id: string, currentName: string, e: React.MouseEvent) => {
    e.stopPropagation();
    setEditingId(id);
    setEditName(currentName);
  };

  const saveRename = (id: string, isProject: boolean, e: React.MouseEvent) => {
    e.stopPropagation();
    if (editName.trim()) {
      if (isProject) {
        onRenameProject(id, editName.trim());
      } else {
        onRenameChat(id, editName.trim());
      }
    }
    setEditingId(null);
  };

  const cancelRename = (e: React.MouseEvent) => {
    e.stopPropagation();
    setEditingId(null);
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(true);
  };

  const handleDragLeave = () => {
    setIsDragOver(false);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(false);
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0 && onImportFolder) {
      onImportFolder(e.dataTransfer.files);
    }
  };

  const filteredProjects = projects.filter((p) =>
    p.name.toLowerCase().includes(searchQuery.toLowerCase())
  );

  const filteredChats = chats.filter((c) =>
    c.title.toLowerCase().includes(searchQuery.toLowerCase())
  );

  return (
    <aside
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
      style={{ width: `${width}px` }}
      className={`relative flex flex-col border-r border-[#E6DFD3] bg-white font-sans text-[#2C2825] select-none h-full shadow-2xs shrink-0 transition-[background-color] ${
        isDragOver ? 'ring-2 ring-[#C58B51] bg-[#FAF8F5]' : ''
      }`}
    >
      {/* Draggable Width Resize Handle */}
      <div
        onMouseDown={handleMouseDownResize}
        className="absolute top-0 right-0 w-1.5 h-full cursor-col-resize hover:bg-[#C58B51]/40 active:bg-[#C58B51] transition-colors group z-30"
        title="Click & drag to resize left sidebar"
      >
        <div className="w-0.5 h-full mx-auto bg-transparent group-hover:bg-[#C58B51]" />
      </div>
      {/* Top Header & Segmented Switcher */}
      <div className="p-4 border-b border-[#E6DFD3] bg-white">
        {/* App Title / Logo & Close Toggle */}
        <div className="flex items-center justify-between mb-3 px-1">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-xl bg-[#C58B51] flex items-center justify-center text-white font-bold text-sm shadow-xs">
              ✦
            </div>
            <div>
              <h1 className="text-xs font-extrabold tracking-tight text-[#2C2825]">SAW AI</h1>
              <p className="text-[10px] text-[#7C756E]">Pure Context AI Engine</p>
            </div>
          </div>

          {/* Close Sidebar Toggle Button */}
          <button
            type="button"
            onClick={onToggleCollapse}
            className="w-7 h-7 rounded-lg flex items-center justify-center text-[#7C756E] hover:text-[#2C2825] hover:bg-[#FAF8F5] transition-colors cursor-pointer"
            title="Close Left Sidebar (Focus Mode)"
          >
            <ChevronLeft size={16} />
          </button>
        </div>

        {/* Segmented Control: Projects vs Chats */}
        <div className="flex h-9 w-full items-center justify-between gap-1 rounded-xl bg-[#F5F1EA] p-1 border border-[#E6DFD3]">
          <button
            onClick={() => onSelectTab('projects')}
            className={`flex-1 rounded-lg py-1 text-xs font-semibold transition-all cursor-pointer flex items-center justify-center gap-1.5 ${
              activeTab === 'projects'
                ? 'bg-white text-[#C58B51] shadow-2xs font-bold'
                : 'text-[#7C756E] hover:text-[#2C2825]'
            }`}
          >
            <Layers size={13} />
            <span>Projects</span>
            <span className="text-[10px] px-1 py-0.2 rounded bg-[#FAF8F5] text-[#7C756E]">
              {projects.length}
            </span>
          </button>

          <button
            onClick={() => onSelectTab('chats')}
            className={`flex-1 rounded-lg py-1 text-xs font-semibold transition-all cursor-pointer flex items-center justify-center gap-1.5 ${
              activeTab === 'chats'
                ? 'bg-white text-[#C58B51] shadow-2xs font-bold'
                : 'text-[#7C756E] hover:text-[#2C2825]'
            }`}
          >
            <MessageSquare size={13} />
            <span>Chats</span>
            <span className="text-[10px] px-1 py-0.2 rounded bg-[#FAF8F5] text-[#7C756E]">
              {chats.length}
            </span>
          </button>
        </div>

        {/* Action Button: New Project / New Chat */}
        {activeTab === 'projects' ? (
          <button
            onClick={onNewProject}
            className="mt-3 flex w-full items-center justify-center gap-2 rounded-xl border border-[#C58B51] bg-[#C58B51] hover:bg-[#B0783F] py-2 text-xs font-bold text-white shadow-xs transition-colors cursor-pointer"
            title="Create a new workspace project"
          >
            <Plus size={15} />
            <span>New Project Workspace</span>
          </button>
        ) : (
          <button
            onClick={onNewChat}
            className="mt-3 flex w-full items-center justify-center gap-2 rounded-xl border border-[#C58B51] bg-[#C58B51] hover:bg-[#B0783F] py-2 text-xs font-bold text-white shadow-xs transition-colors cursor-pointer"
            title="Create a universal standalone chat without project context"
          >
            <Plus size={15} />
            <span>New Chat</span>
          </button>
        )}
      </div>

      {/* Search Input Bar */}
      <div className="px-3 pt-3 pb-1">
        <div className="relative">
          <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-[#A09890]" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder={activeTab === 'projects' ? 'Search workspaces...' : 'Search chat sessions...'}
            className="w-full pl-8 pr-3 py-1.5 rounded-xl text-xs bg-[#FAF8F5] border border-[#E6DFD3] focus:border-[#C58B51] outline-none placeholder:text-[#A09890]"
          />
        </div>
      </div>

      {/* Main List Navigation */}
      <nav className="flex-1 overflow-y-auto px-3 py-2 space-y-1">
        <div className="mb-1.5 px-2 text-[10px] font-bold uppercase tracking-wider text-[#7C756E]">
          {activeTab === 'projects' ? 'Active Workspaces' : 'Saved Conversations'}
        </div>

        {activeTab === 'projects' ? (
          filteredProjects.length === 0 ? (
            <div className="p-4 text-center text-xs text-[#7C756E]">No projects found</div>
          ) : (
            filteredProjects.map((project) => {
              const isActive = activeProjectId === project.id;
              const isEditing = editingId === project.id;
              const projectChatsCount = chats.filter((c) => c.projectId === project.id).length;

              return (
                <div
                  key={project.id}
                  onClick={() => onSelectProject(project.id)}
                  className={`group relative flex items-center justify-between gap-2 rounded-xl px-3 py-2.5 text-xs font-medium transition-all cursor-pointer ${
                    isActive
                      ? 'bg-[#F5F1EA] text-[#2C2825] font-bold border border-[#E6DFD3] shadow-2xs'
                      : 'text-[#7C756E] hover:bg-[#FAF8F5] hover:text-[#2C2825]'
                  }`}
                >
                  <div className="flex items-center gap-2.5 min-w-0 flex-1">
                    <FolderTree
                      size={15}
                      className={isActive ? 'text-[#C58B51] shrink-0' : 'text-[#7C756E] shrink-0'}
                    />

                    {isEditing ? (
                      <div className="flex items-center gap-1 flex-1" onClick={(e) => e.stopPropagation()}>
                        <input
                          type="text"
                          value={editName}
                          onChange={(e) => setEditName(e.target.value)}
                          className="w-full px-1.5 py-0.5 rounded bg-white text-xs text-[#2C2825] border border-[#C58B51] outline-none"
                          autoFocus
                        />
                        <button
                          onClick={(e) => saveRename(project.id, true, e)}
                          className="p-1 hover:text-emerald-600"
                        >
                          <Check size={12} />
                        </button>
                        <button onClick={cancelRename} className="p-1 hover:text-amber-800">
                          <X size={12} />
                        </button>
                      </div>
                    ) : (
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-xs font-bold text-[#2C2825]">{project.name}</div>
                        <div className="text-[10px] text-[#7C756E] flex items-center gap-1.5 mt-0.5">
                          <span>{project.files.length} files</span>
                          <span>•</span>
                          <span className="text-[#C58B51] font-semibold">{projectChatsCount} chats</span>
                        </div>
                      </div>
                    )}
                  </div>

                  {!isEditing && (
                    <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                      <button
                        onClick={(e) => startRename(project.id, project.name, e)}
                        className="p-1 hover:text-[#C58B51]"
                        title="Rename Project"
                      >
                        <Edit2 size={12} />
                      </button>
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          onDeleteProject(project.id);
                        }}
                        className="p-1 hover:text-red-600"
                        title="Delete Project"
                      >
                        <Trash2 size={12} />
                      </button>
                    </div>
                  )}
                </div>
              );
            })
          )
        ) : filteredChats.length === 0 ? (
          <div className="p-4 text-center text-xs text-[#7C756E]">No chats found</div>
        ) : (
          filteredChats.map((chat) => {
            const isActive = activeChatId === chat.id;
            const isEditing = editingId === chat.id;
            const parentProject = projects.find((p) => p.id === chat.projectId);

            // Display clean chat title (project is displayed in subtitle)
            const displayTitle = chat.title;

            return (
              <div
                key={chat.id}
                onClick={() => onSelectChat(chat.id)}
                className={`group relative flex items-center justify-between gap-2 rounded-xl px-3 py-2 text-xs font-medium transition-all cursor-pointer ${
                  isActive
                    ? 'bg-[#F5F1EA] text-[#2C2825] font-bold border border-[#E6DFD3] shadow-2xs'
                    : 'text-[#7C756E] hover:bg-[#FAF8F5] hover:text-[#2C2825]'
                }`}
              >
                <div className="flex items-center gap-2.5 min-w-0 flex-1">
                  <MessageSquare
                    size={15}
                    className={isActive ? 'text-[#C58B51] shrink-0' : 'text-[#7C756E] shrink-0'}
                  />

                  {isEditing ? (
                    <div className="flex items-center gap-1 flex-1" onClick={(e) => e.stopPropagation()}>
                      <input
                        type="text"
                        value={editName}
                        onChange={(e) => setEditName(e.target.value)}
                        className="w-full px-1.5 py-0.5 rounded bg-white text-xs text-[#2C2825] border border-[#C58B51] outline-none"
                        autoFocus
                      />
                      <button
                        onClick={(e) => saveRename(chat.id, false, e)}
                        className="p-1 hover:text-emerald-600"
                      >
                        <Check size={12} />
                      </button>
                      <button onClick={cancelRename} className="p-1 hover:text-amber-800">
                        <X size={12} />
                      </button>
                    </div>
                  ) : (
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-xs font-semibold text-[#2C2825]">
                        {displayTitle}
                      </div>
                      <div className="text-[10px] text-[#A09890] flex items-center gap-1.5 mt-0.5 whitespace-nowrap overflow-hidden">
                        <span className="shrink-0 tabular-nums">{chat.messages.length} msg</span>
                        <span className="shrink-0 text-[#E6DFD3]">•</span>
                        {parentProject ? (
                          <span className="text-[#C58B51] font-medium truncate">
                            {parentProject.name}
                          </span>
                        ) : (
                          <span className="text-[#7C756E] font-medium shrink-0">Universal Chat</span>
                        )}
                      </div>
                    </div>
                  )}
                </div>

                {!isEditing && (
                  <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        setInfoChatId(infoChatId === chat.id ? null : chat.id);
                      }}
                      className={`p-1 rounded hover:bg-[#F5E6D3] ${infoChatId === chat.id ? 'text-[#C58B51]' : 'hover:text-[#C58B51]'}`}
                      title="Chat info (files & tokens)"
                    >
                      <MoreVertical size={13} />
                    </button>
                    <button
                      onClick={(e) => startRename(chat.id, chat.title, e)}
                      className="p-1 hover:text-[#C58B51]"
                      title="Rename Chat"
                    >
                      <Edit2 size={12} />
                    </button>
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        onDeleteChat(chat.id);
                      }}
                      className="p-1 hover:text-red-600"
                      title="Delete Chat"
                    >
                      <Trash2 size={12} />
                    </button>
                  </div>
                )}

                {/* Three-dots info drawer: chat scope, files touched, token
                    spend (total input+output + per model with breakdown).
                    Renders as a RIGHT-SIDE drawer over the chat/code area (not
                    a tiny sidebar dropdown) so it has room to show everything. */}
                {infoChatId === chat.id && (() => {
                  const stats = deriveChatStats(chat, projects);
                  return (
                    <>
                      {/* click-away catcher */}
                      <div
                        className="fixed inset-0 z-[60] bg-black/20"
                        onClick={(e) => {
                          e.stopPropagation();
                          setInfoChatId(null);
                        }}
                      />
                      <div
                        onClick={(e) => e.stopPropagation()}
                        className="fixed right-0 top-0 z-[61] h-full w-[min(420px,92vw)] bg-white border-l border-[#E6DFD3] shadow-2xl flex flex-col text-[#2C2825] font-sans animate-in fade-in slide-in-from-right"
                      >
                        {/* Header */}
                        <div className="flex items-center justify-between px-4 py-3 border-b border-[#E6DFD3] bg-[#FAF8F5]">
                          <div className="flex items-center gap-2 min-w-0">
                            <Layers size={16} className="text-[#C58B51] shrink-0" />
                            <div className="min-w-0">
                              <div className="text-sm font-bold truncate">{chat.title}</div>
                              <div className="text-[10px] text-[#7C756E]">Chat info &amp; usage</div>
                            </div>
                          </div>
                          <button
                            onClick={(e) => { e.stopPropagation(); setInfoChatId(null); }}
                            className="p-1 rounded-lg text-[#A09890] hover:text-[#2C2825] hover:bg-white"
                            title="Close"
                          >
                            <X size={16} />
                          </button>
                        </div>

                        <div className="flex-1 overflow-y-auto p-4 space-y-4">
                          {/* Scope */}
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className={`text-[10px] font-bold px-2 py-1 rounded-lg ${stats.isUniversal ? 'bg-[#FAF8F5] text-[#7C756E] border border-[#E6DFD3]' : 'bg-[#F5E6D3] text-[#C58B51] border border-[#C58B51]/30'}`}>
                              {stats.isUniversal ? 'Universal Chat' : 'Project Chat'}
                            </span>
                            {!stats.isUniversal && stats.projectName && (
                              <span className="text-[11px] text-[#7C756E] truncate">{stats.projectName}</span>
                            )}
                            <span className="text-[10px] text-[#A09890] ml-auto">
                              {stats.assistantResponses} assistant response{stats.assistantResponses === 1 ? '' : 's'}
                            </span>
                          </div>

                          {/* Token spend — total + breakdown */}
                          <div>
                            <div className="flex items-center gap-1.5 mb-2">
                              <Hash size={13} className="text-[#C58B51]" />
                              <span className="text-xs font-bold text-[#2C2825]">Token spend</span>
                            </div>
                            <div className="rounded-2xl bg-[#FAF8F5] border border-[#E6DFD3] p-3">
                              {/* Total */}
                              <div className="flex items-baseline justify-between pb-2 mb-2 border-b border-[#E6DFD3]">
                                <span className="text-[10px] font-bold text-[#7C756E] uppercase tracking-wide">Total</span>
                                <span className="text-xl font-mono font-bold text-[#C58B51]">
                                  {stats.totalTokens.toLocaleString()}
                                </span>
                              </div>
                              {/* Input / output split */}
                              <div className="grid grid-cols-2 gap-2 mb-2">
                                <div className="rounded-xl bg-white border border-[#E6DFD3] px-2.5 py-2">
                                  <div className="flex items-center gap-1 text-[9px] font-bold text-[#A09890] uppercase tracking-wide mb-0.5">
                                    <ArrowDownRight size={10} /> Input
                                  </div>
                                  <div className="text-sm font-mono font-bold text-[#2C2825]">
                                    {stats.totalInputTokens.toLocaleString()}
                                  </div>
                                </div>
                                <div className="rounded-xl bg-white border border-[#E6DFD3] px-2.5 py-2">
                                  <div className="flex items-center gap-1 text-[9px] font-bold text-[#A09890] uppercase tracking-wide mb-0.5">
                                    <ArrowUpRight size={10} /> Output
                                  </div>
                                  <div className="text-sm font-mono font-bold text-[#2C2825]">
                                    {stats.totalOutputTokens.toLocaleString()}
                                  </div>
                                </div>
                              </div>
                              {/* Per-model breakdown — Input / Output / Total for each model */}
                              {stats.perModel.length > 0 ? (
                                <div className="space-y-1.5">
                                  <div className="flex items-center justify-between">
                                    <div className="text-[9px] font-bold text-[#A09890] uppercase tracking-wide">Per model</div>
                                    {/* inline column legend */}
                                    <div className="flex items-center gap-2 text-[8px] font-bold text-[#A09890] uppercase tracking-wide">
                                      <span className="flex items-center gap-0.5"><ArrowDownRight size={9} />In</span>
                                      <span className="flex items-center gap-0.5"><ArrowUpRight size={9} />Out</span>
                                      <span>Total</span>
                                    </div>
                                  </div>
                                  {stats.perModel.map((s) => {
                                    const pct = stats.totalTokens > 0 ? (s.tokens / stats.totalTokens) * 100 : 0;
                                    return (
                                      <div key={s.model} className="rounded-lg bg-white border border-[#E6DFD3] px-2.5 py-1.5">
                                        {/* model name + response count + share bar */}
                                        <div className="flex items-center justify-between mb-1.5">
                                          <span className="text-[11px] font-mono text-[#2C2825] truncate max-w-[180px]">{s.model}</span>
                                          <span className="text-[9px] text-[#A09890] font-mono shrink-0">{s.responses}× · {pct.toFixed(0)}%</span>
                                        </div>
                                        {/* Input / Output / Total row per model */}
                                        <div className="grid grid-cols-3 gap-1.5 mb-1">
                                          <div className="rounded-md bg-[#FAF8F5] border border-[#E6DFD3] px-1.5 py-1 text-center">
                                            <div className="text-[8px] font-bold text-[#A09890] uppercase tracking-wide mb-0.5">Input</div>
                                            <div className="text-[11px] font-mono font-bold text-[#2C2825]">{s.inputTokens.toLocaleString()}</div>
                                          </div>
                                          <div className="rounded-md bg-[#FAF8F5] border border-[#E6DFD3] px-1.5 py-1 text-center">
                                            <div className="text-[8px] font-bold text-[#A09890] uppercase tracking-wide mb-0.5">Output</div>
                                            <div className="text-[11px] font-mono font-bold text-[#2C2825]">{s.outputTokens.toLocaleString()}</div>
                                          </div>
                                          <div className="rounded-md bg-[#F5E6D3] border border-[#C58B51]/30 px-1.5 py-1 text-center">
                                            <div className="text-[8px] font-bold text-[#C58B51] uppercase tracking-wide mb-0.5">Total</div>
                                            <div className="text-[11px] font-mono font-bold text-[#C58B51]">{s.tokens.toLocaleString()}</div>
                                          </div>
                                        </div>
                                        <div className="h-1 rounded-full bg-[#F5E6D3] overflow-hidden">
                                          <div className="h-full bg-[#C58B51]" style={{ width: `${pct}%` }} />
                                        </div>
                                      </div>
                                    );
                                  })}
                                  {/* All-models total row */}
                                  <div className="rounded-lg bg-[#F5E6D3] border border-[#C58B51]/30 px-2.5 py-1.5">
                                    <div className="flex items-center justify-between mb-1">
                                      <span className="text-[10px] font-bold text-[#C58B51] uppercase tracking-wide">All models</span>
                                      <span className="text-[11px] font-mono font-bold text-[#C58B51]">{stats.totalTokens.toLocaleString()}</span>
                                    </div>
                                    <div className="grid grid-cols-2 gap-1.5">
                                      <div className="flex items-center gap-1 text-[9px] text-[#7C756E] font-mono">
                                        <ArrowDownRight size={9} /> {stats.totalInputTokens.toLocaleString()}
                                      </div>
                                      <div className="flex items-center gap-1 text-[9px] text-[#7C756E] font-mono justify-end">
                                        <ArrowUpRight size={9} /> {stats.totalOutputTokens.toLocaleString()}
                                      </div>
                                    </div>
                                  </div>
                                </div>
                              ) : (
                                <div className="text-[10px] text-[#A09890] text-center py-1">No responses yet</div>
                              )}
                              <div className="text-[9px] text-[#A09890] mt-2 leading-snug">
                                Input = prompt tokens (system prompt + conversation). Output = completion tokens.
                                Figures are provider-reported when available; otherwise estimated with a real BPE tokenizer.
                              </div>
                            </div>
                          </div>

                          {/* Files touched */}
                          <div>
                            <div className="flex items-center gap-1.5 mb-2">
                              <FileCode size={13} className="text-[#C58B51]" />
                              <span className="text-xs font-bold text-[#2C2825]">
                                Files created / edited / added
                              </span>
                              <span className="text-[10px] text-[#A09890]">({stats.touchedFiles.length})</span>
                            </div>
                            {stats.touchedFiles.length > 0 ? (
                              <div className="space-y-0.5 max-h-64 overflow-y-auto rounded-xl bg-[#FAF8F5] border border-[#E6DFD3] p-2">
                                {stats.touchedFiles.map((p) => (
                                  <div key={p} className="text-[11px] font-mono text-[#7C756E] truncate flex items-center gap-1.5 px-1 py-0.5">
                                    <span className="text-[#C58B51]">•</span>
                                    <span className="truncate">{p}</span>
                                  </div>
                                ))}
                              </div>
                            ) : (
                              <div className="text-[11px] text-[#A09890] rounded-xl bg-[#FAF8F5] border border-[#E6DFD3] p-3 text-center">
                                No files created or edited in this chat yet.
                              </div>
                            )}
                          </div>
                        </div>
                      </div>
                    </>
                  );
                })()}
              </div>
            );
          })
        )}
      </nav>

      {/* Bottom Footer Controls */}
      <div className="border-t border-[#E6DFD3] p-3 space-y-2 bg-[#FAF8F5]">
        <button
          onClick={onOpenSettings}
          className="flex w-full items-center justify-between gap-3 rounded-xl px-3 py-2 text-xs font-semibold text-[#7C756E] hover:bg-white hover:text-[#2C2825] border border-transparent hover:border-[#E6DFD3] transition-all cursor-pointer shadow-2xs"
        >
          <div className="flex items-center gap-2.5">
            <Settings size={15} className="text-[#C58B51]" />
            <span>Workspace Settings</span>
          </div>
          <span className="text-[10px] px-1.5 py-0.5 rounded bg-white text-[#C58B51] font-bold border border-[#E6DFD3]">
            SAW AI
          </span>
        </button>

        <button
          className="flex w-full items-center justify-start gap-2.5 rounded-xl px-3 py-2 text-xs font-semibold text-red-600 hover:bg-white border border-transparent hover:border-red-100 transition-all cursor-pointer shadow-2xs"
        >
          <LogOut size={15} />
          <span>Logout</span>
        </button>

        {/* API Ready Status Pill */}
        <div className="flex items-center justify-between px-3 py-1.5 rounded-xl bg-white border border-[#E6DFD3] text-[10px]">
          <div className="flex items-center gap-1.5">
            <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse"></span>
            <span className="font-bold text-[#2C2825]">API READY</span>
          </div>
          <span className="font-mono text-[#7C756E]">v2.4 Proxy</span>
        </div>
      </div>
    </aside>
  );
};
