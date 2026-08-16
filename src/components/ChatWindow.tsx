import React, { useState, useRef, useEffect, useCallback } from 'react';
import {
  Send,
  Square,
  Globe,
  Paperclip,
  Sparkles,
  Layers,
  Trash2,
  Download,
  Info,
  Maximize2,
  ChevronRight,
  ChevronLeft,
  Terminal,
  FolderTree,
  Upload,
  CheckCircle2,
  Server,
  Wrench,
  Cpu,
  ChevronUp,
  ChevronDown,
  Sliders,
  Check,
  Brain,
  Zap,
  RotateCw,
  Play,
} from 'lucide-react';
import {
  ChatSession,
  Message,
  Project,
  BYOKSettings,
  Artifact,
  SearchResult,
  ProjectFile,
  MCPServer,
  ReasoningMode,
  AutomationMode,
} from '../types';
import { PatchChunk } from '../utils/patchApplier';
import { MessageItem } from './MessageItem';
import { SandboxPanel } from './SandboxPanel';
import { ContextInjector } from '../utils/contextInjector';
import { FileSecurity } from '../utils/fileSecurity';
import {
  REASONING_MODES,
  detectModelReasoningCapability,
  ReasoningModeOption,
} from '../utils/reasoning';

export interface AutomationModeOption {
  id: AutomationMode;
  label: string;
  shortLabel: string;
  badge: string;
  description: string;
  details: string;
}

export const AUTOMATION_MODES: AutomationModeOption[] = [
  {
    id: 'review',
    label: 'Review & Accept',
    shortLabel: 'Accept Edits',
    badge: 'Manual Confirm',
    description: 'Manual review for all code changes. Click Accept or Implement to apply.',
    details: 'Full human control over every file and patch.',
  },
  {
    id: 'automatic',
    label: 'Automatic',
    shortLabel: 'Auto Edits',
    badge: 'Edits Auto-Applied',
    description: 'Automatically applies file edits. Shows Implement button for new files.',
    details: 'Fast coding with confirmation on new files.',
  },
  {
    id: 'automatic_plus',
    label: 'Autonomous Multi-Step Planner',
    shortLabel: 'Auto Planner',
    badge: 'Step Plan & Auto-Exec',
    description: 'For complex multi-step tasks. Plans interactive step checkboxes, executes fast, and auto-manages files.',
    details: 'Fast, structured multi-step execution with interactive checklist progress.',
  },
];

interface ChatWindowProps {
  chat: ChatSession | null;
  project: Project | null;
  settings: BYOKSettings;
  onSendMessage: (
    content: string,
    useWebSearch: boolean,
    attachedFiles?: any[]
  ) => Promise<void>;
  isGenerating: boolean;
  currentGeneratingModelName?: string | null;
  onStopGeneration: () => void;
  onContinueGeneration?: (messageId?: string) => void;
  onRetryGeneration?: (messageId?: string) => void;
  onClearChat: () => void;
  onOpenArtifact: (artifact: Artifact) => void;
  onOpenSettings: () => void;
  onToggleLeftSidebar: () => void;
  isLeftSidebarOpen: boolean;
  onAddFilesToProject?: (newFiles: ProjectFile[]) => void;
  onImplementCode?: (code: string, language: string, suggestedPath: string) => void;
  onUpdateMcpServers?: (servers: MCPServer[]) => void;
  onToggleChatSkill?: (skillId: string) => void;
  selectedReasoningMode?: ReasoningMode;
  onSelectReasoningMode?: (mode: ReasoningMode) => void;
  selectedAutomationMode?: AutomationMode;
  onSelectAutomationMode?: (mode: AutomationMode) => void;
  aiStatus?: 'idle' | 'searching_web' | 'thinking' | 'generating';
  onNewChatInProject?: (projectId: string) => void;
  onAcceptArtifacts?: (messageId: string, artifacts: Artifact[]) => void;
  onRejectArtifacts?: (messageId: string) => void;
  onApplyPatch?: (patch: PatchChunk) => void;
  onRevertPatch?: (patch: PatchChunk) => void;
  onRestore?: (messageId: string) => void;
  targetFile?: ProjectFile | null;
  targetArtifact?: Artifact | null;
  onGoToProject?: (projectId: string) => void;
  liveStream?: {
    chatId: string;
    assistantMsgId: string;
    content: string;
    thinkingContent: string;
    isThinking: boolean;
    searchResults: SearchResult[];
    modelUsed: string;
  } | null;
}

const SAMPLE_PROMPT_SUGGESTIONS = [
  'Build a responsive navigation component for a fintech dashboard using Tailwind.',
  'Derive the mathematical formulation and LaTeX for context retention loss.',
  'Compare pure context injection without chunking vs vector RAG chunking.',
  'Create a procedural vector SVG illustration with warm organic gradients.',
];

export const ChatWindow: React.FC<ChatWindowProps> = ({
  chat,
  project,
  settings,
  onSendMessage,
  isGenerating,
  currentGeneratingModelName,
  onStopGeneration,
  onContinueGeneration,
  onRetryGeneration,
  onClearChat,
  onOpenArtifact,
  onOpenSettings,
  onToggleLeftSidebar,
  isLeftSidebarOpen,
  onAddFilesToProject,
  onImplementCode,
  onUpdateMcpServers,
  onToggleChatSkill,
  selectedReasoningMode = 'medium',
  onSelectReasoningMode,
  selectedAutomationMode = 'automatic',
  onSelectAutomationMode,
  aiStatus = 'idle',
  onNewChatInProject,
  onAcceptArtifacts,
  onRejectArtifacts,
  onApplyPatch,
  onRevertPatch,
  onRestore,
  targetFile,
  targetArtifact,
  onGoToProject,
  liveStream,
}) => {
  const [inputText, setInputText] = useState('');
  const [webSearchActive, setWebSearchActive] = useState(settings.webSearchEnabled);
  const [showTokenInfo, setShowTokenInfo] = useState(false);
  const [isDragOverChat, setIsDragOverChat] = useState(false);
  const [uploadNotice, setUploadNotice] = useState<string | null>(null);
  const messagesEndRef = useRef<HTMLDivElement | null>(null);
  const scrollContainerRef = useRef<HTMLDivElement | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [isUserScrolledUp, setIsUserScrolledUp] = useState(false);

  const [showMcpPopover, setShowMcpPopover] = useState(false);
  const [showReasoningPopover, setShowReasoningPopover] = useState(false);
  const [showSkillsPopover, setShowSkillsPopover] = useState(false);
  const [showSandbox, setShowSandbox] = useState(false);
  const [showAutomationPopover, setShowAutomationPopover] = useState(false);
  const mcpPopoverRef = useRef<HTMLDivElement | null>(null);
  const reasoningPopoverRef = useRef<HTMLDivElement | null>(null);
  const skillsPopoverRef = useRef<HTMLDivElement | null>(null);
  const automationPopoverRef = useRef<HTMLDivElement | null>(null);

  // Stable callback for clarification answers so memoized MessageItems don't
  // re-render just because this inline closure was recreated.
  const handleClarificationAnswer = useCallback(
    (text: string) => onSendMessage(text, webSearchActive),
    [onSendMessage, webSearchActive]
  );

  // Model reasoning capability detection
  const activeModelName = settings.defaultModel || 'gpt-4o';
  const modelCapability = detectModelReasoningCapability(activeModelName);
  const activeReasoningConfig =
    REASONING_MODES.find((m) => m.id === selectedReasoningMode) || REASONING_MODES[2];

  const activeAutomationConfig =
    AUTOMATION_MODES.find((m) => m.id === selectedAutomationMode) || AUTOMATION_MODES[1];

  // Close popovers on click outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (
        mcpPopoverRef.current &&
        !mcpPopoverRef.current.contains(event.target as Node)
      ) {
        setShowMcpPopover(false);
      }
      if (
        reasoningPopoverRef.current &&
        !reasoningPopoverRef.current.contains(event.target as Node)
      ) {
        setShowReasoningPopover(false);
      }
      if (
        skillsPopoverRef.current &&
        !skillsPopoverRef.current.contains(event.target as Node)
      ) {
        setShowSkillsPopover(false);
      }
      if (
        automationPopoverRef.current &&
        !automationPopoverRef.current.contains(event.target as Node)
      ) {
        setShowAutomationPopover(false);
      }
    };
    if (showMcpPopover || showReasoningPopover || showSkillsPopover || showAutomationPopover) {
      document.addEventListener('mousedown', handleClickOutside);
    }
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [showMcpPopover, showReasoningPopover, showSkillsPopover, showAutomationPopover]);

  const activeMcpServers = (settings.mcpServers || []).filter((s) => s.enabled);
  const totalMcpToolsCount = (settings.mcpServers || []).reduce(
    (acc, s) => acc + (s.enabled ? (s.tools || []).filter((t) => t.enabled).length : 0),
    0
  );

  const toggleServer = (serverId: string) => {
    if (!onUpdateMcpServers) return;
    const updated = (settings.mcpServers || []).map((s) =>
      s.id === serverId ? { ...s, enabled: !s.enabled } : s
    );
    onUpdateMcpServers(updated);
  };

  const toggleTool = (serverId: string, toolId: string) => {
    if (!onUpdateMcpServers) return;
    const updated = (settings.mcpServers || []).map((s) => {
      if (s.id !== serverId) return s;
      return {
        ...s,
        tools: (s.tools || []).map((t) =>
          t.id === toolId ? { ...t, enabled: !t.enabled } : t
        ),
      };
    });
    onUpdateMcpServers(updated);
  };

  const enableAllMcps = () => {
    if (!onUpdateMcpServers) return;
    const updated = (settings.mcpServers || []).map((s) => ({
      ...s,
      enabled: true,
      tools: (s.tools || []).map((t) => ({ ...t, enabled: true })),
    }));
    onUpdateMcpServers(updated);
  };

  const disableAllMcps = () => {
    if (!onUpdateMcpServers) return;
    const updated = (settings.mcpServers || []).map((s) => ({
      ...s,
      enabled: false,
    }));
    onUpdateMcpServers(updated);
  };

  // Auto-scroll logic consolidated below

  // Adjust textarea height
  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
      textareaRef.current.style.height = `${Math.min(textareaRef.current.scrollHeight, 180)}px`;
    }
  }, [inputText]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!inputText.trim() || isGenerating) return;
    const text = inputText;
    setInputText('');
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
    }
    onSendMessage(text, webSearchActive);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSubmit(e);
    }
  };

  // Drag & drop files onto chat
  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOverChat(true);
  };

  const handleDragLeave = () => {
    setIsDragOverChat(false);
  };

  const handleDrop = async (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOverChat(false);
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      processIncomingFiles(Array.from(e.dataTransfer.files));
    }
  };

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      processIncomingFiles(Array.from(e.target.files));
    }
  };

  const processIncomingFiles = async (fileList: File[]) => {
    const newProjectFiles: ProjectFile[] = [];
    let blockedCount = 0;

    for (const f of fileList) {
      const readResult = await FileSecurity.readFileSafely(f, f.name);
      if (!readResult.allowed) {
        blockedCount++;
        console.warn(`File rejected by security scanner: ${f.name} (${readResult.reason})`);
        continue;
      }

      newProjectFiles.push({
        id: `file-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        name: f.name,
        path: f.name,
        size: f.size,
        includedInContext: true,
        language: readResult.language,
        content: readResult.content,
      });
    }

    if (newProjectFiles.length > 0 && onAddFilesToProject) {
      onAddFilesToProject(newProjectFiles);
      if (blockedCount > 0) {
        setUploadNotice(`Added ${newProjectFiles.length} file(s) (${blockedCount} unsafe executable file(s) blocked).`);
      } else {
        setUploadNotice(`Added ${newProjectFiles.length} file(s) to prompt context with 100% retention!`);
      }
      setTimeout(() => setUploadNotice(null), 4000);
    } else if (blockedCount > 0) {
      setUploadNotice(`Blocked ${blockedCount} potentially unsafe binary/executable file(s).`);
      setTimeout(() => setUploadNotice(null), 4000);
    }
  };

  // Compute context tokens
  const contextStats = project ? ContextInjector.buildProjectPromptContext(project) : null;
  
  const activeProfile = (settings.aiProfiles || []).find(p => p.id === settings.activeProfileId) || (settings.aiProfiles && settings.aiProfiles[0]);

  let currentModelDisplay = 'SAW AI Model';
  if (isGenerating) {
    currentModelDisplay = currentGeneratingModelName 
      ? `Using: ${currentGeneratingModelName}`
      : 'Generating...';
  } else if (chat && chat.messages && chat.messages.length > 0) {
    const assistantMsgs = chat.messages.filter((m) => m.role === 'assistant');
    if (assistantMsgs.length > 0) {
      const lastAssMsg = assistantMsgs[assistantMsgs.length - 1];
      if (lastAssMsg.modelUsed) {
        currentModelDisplay = `Model: ${lastAssMsg.modelUsed}`;
      } else if (activeProfile) {
        currentModelDisplay = activeProfile.name || activeProfile.model;
      } else {
        currentModelDisplay = settings.defaultModel || 'SAW AI Model';
      }
    } else {
      currentModelDisplay = activeProfile ? activeProfile.name : (settings.defaultModel || 'SAW AI Model');
    }
  } else {
    currentModelDisplay = activeProfile ? activeProfile.name : (settings.defaultModel || 'SAW AI Model');
  }

  // Auto-scroll to bottom smoothly whenever messages update or stream in
  useEffect(() => {
    if (!isUserScrolledUp) {
      messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }
  }, [chat?.messages, chat?.messages?.length, isGenerating, aiStatus, isUserScrolledUp]);

  const handleScroll = () => {
    if (scrollContainerRef.current) {
      const { scrollTop, scrollHeight, clientHeight } = scrollContainerRef.current;
      // Define a threshold (e.g., 50px) to determine if user has scrolled up from the bottom
      setIsUserScrolledUp(scrollHeight - scrollTop - clientHeight > 50);
    }
  };

  const handleExportMarkdown = () => {
    const md = chat.messages
      .map((m) => `### ${m.role === 'user' ? 'User' : 'Assistant'}\n\n${m.content}\n`)
      .join('\n---\n\n');
    const blob = new Blob([md], { type: 'text/markdown' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${chat.title.replace(/\s+/g, '-').toLowerCase()}-thread.md`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <main
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
      className={`relative flex flex-1 flex-col h-full bg-[#FAF8F5] font-sans text-[#2C2825] overflow-hidden transition-all ${
        isDragOverChat ? 'ring-4 ring-[#C58B51] ring-inset bg-[#F5E6D3]/30' : ''
      }`}
    >
      {/* Drag Over Overlay */}
      {isDragOverChat && (
        <div className="absolute inset-0 z-40 flex flex-col items-center justify-center bg-[#FAF8F5]/90 backdrop-blur-xs border-2 border-dashed border-[#C58B51] m-4 rounded-3xl animate-in fade-in">
          <Upload size={36} className="text-[#C58B51] mb-2 animate-bounce" />
          <h3 className="text-sm font-bold text-[#2C2825]">Drop Files or Folder Here</h3>
          <p className="text-xs text-[#7C756E]">Instant unchunked memory ingestion with 100% full-file retention</p>
        </div>
      )}

      {/* Main Top Header */}
      <header className="flex h-14 items-center justify-between border-b border-[#E6DFD3] bg-white px-4 sm:px-6 shadow-2xs shrink-0">
        <div className="flex items-center gap-3 min-w-0">
          {/* Toggle Left Sidebar Button (when collapsed) */}
          {!isLeftSidebarOpen && (
            <button
              onClick={onToggleLeftSidebar}
              className="flex h-8 w-8 items-center justify-center rounded-xl bg-[#FAF8F5] hover:bg-[#F5F1EA] text-[#7C756E] hover:text-[#2C2825] border border-[#E6DFD3] transition-all cursor-pointer shadow-2xs shrink-0"
              title="Open Left Sidebar (Projects & Chats)"
            >
              <ChevronRight size={15} />
            </button>
          )}

          <div className="flex items-center gap-2 min-w-0">
            {project ? (
              <div className="flex items-center gap-1.5 min-w-0 text-xs sm:text-sm">
                <button
                  type="button"
                  onClick={() => onGoToProject && onGoToProject(project.id)}
                  className="font-semibold text-[#7C756E] hover:text-[#C58B51] hover:underline flex items-center gap-1 cursor-pointer transition-colors shrink-0"
                  title={`Back to ${project.name} workspace`}
                >
                  <FolderTree size={14} className="text-[#C58B51]" />
                  <span className="truncate max-w-[90px] sm:max-w-[150px]">{project.name}</span>
                </button>
                <span className="text-[#A09890] font-normal">/</span>
                <h1 className="font-bold tracking-tight text-[#2C2825] truncate max-w-xs sm:max-w-md">
                  {chat.title}
                </h1>
              </div>
            ) : (
              <h1 className="text-xs sm:text-sm font-bold tracking-tight text-[#2C2825] truncate max-w-xs sm:max-w-md">
                {chat.title}
              </h1>
            )}

            {/* Automation Mode Dropdown Button */}
            <div className="relative" ref={automationPopoverRef}>
              <button
                type="button"
                onClick={() => setShowAutomationPopover(!showAutomationPopover)}
                className={`flex items-center gap-1.5 px-2.5 py-1 rounded-xl border text-xs font-bold transition-all cursor-pointer shadow-2xs shrink-0 ${
                  selectedAutomationMode === 'automatic_plus'
                    ? 'bg-[#FAF8F5] text-[#C58B51] border-[#C58B51]'
                    : selectedAutomationMode === 'automatic'
                    ? 'bg-[#FAF8F5] text-[#2C2825] border-[#E6DFD3] hover:border-[#C58B51]'
                    : 'bg-white text-[#7C756E] hover:text-[#2C2825] border-[#E6DFD3]'
                }`}
                title={`Automation Mode: ${activeAutomationConfig.label} (${activeAutomationConfig.badge})`}
              >
                {selectedAutomationMode === 'automatic_plus' ? (
                  <Zap size={13} className="text-[#C58B51]" />
                ) : selectedAutomationMode === 'automatic' ? (
                  <Cpu size={13} className="text-[#C58B51]" />
                ) : (
                  <Sliders size={13} className="text-[#7C756E]" />
                )}
                <span className="truncate">{activeAutomationConfig.label}</span>
                <ChevronDown size={11} className="text-[#7C756E]" />
              </button>

              {/* Automation Dropdown Popover */}
              {showAutomationPopover && (
                <div className="absolute left-0 top-full mt-2 w-80 sm:w-96 rounded-2xl bg-white border border-[#E6DFD3] shadow-2xl p-3.5 z-50 animate-in fade-in zoom-in-95 text-xs text-[#2C2825]">
                  <div className="flex items-center justify-between border-b border-[#E6DFD3] pb-2.5 mb-2.5">
                    <div className="flex items-center gap-2">
                      <Zap size={15} className="text-[#C58B51]" />
                      <span className="font-bold">Workspace Automation Mode</span>
                    </div>
                    <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-[#FAF8F5] text-[#C58B51] border border-[#E6DFD3]">
                      {activeAutomationConfig.badge}
                    </span>
                  </div>

                  <div className="space-y-2">
                    {AUTOMATION_MODES.map((mode) => {
                      const isSelected = selectedAutomationMode === mode.id;
                      return (
                        <div
                          key={mode.id}
                          onClick={() => {
                            if (onSelectAutomationMode) onSelectAutomationMode(mode.id);
                            setShowAutomationPopover(false);
                          }}
                          className={`p-2.5 rounded-xl border transition-all cursor-pointer flex items-start gap-2.5 ${
                            isSelected
                              ? 'bg-[#FAF8F5] border-[#C58B51] ring-1 ring-[#C58B51]/30 shadow-2xs'
                              : 'bg-white border-[#E6DFD3] hover:border-[#C58B51] hover:bg-[#FAF8F5]'
                          }`}
                        >
                          <div
                            className={`w-7 h-7 rounded-lg flex items-center justify-center shrink-0 mt-0.5 ${
                              isSelected
                                ? 'bg-[#C58B51] text-white'
                                : 'bg-[#FAF8F5] text-[#7C756E] border border-[#E6DFD3]'
                            }`}
                          >
                            {mode.id === 'automatic_plus' ? (
                              <Zap size={14} />
                            ) : mode.id === 'automatic' ? (
                              <Cpu size={14} />
                            ) : (
                              <Sliders size={14} />
                            )}
                          </div>

                          <div className="flex-1 min-w-0">
                            <div className="flex items-center justify-between">
                              <span className="font-bold text-[#2C2825]">{mode.label}</span>
                              <span
                                className={`text-[9px] font-bold px-1.5 py-0.2 rounded border ${
                                  isSelected
                                    ? 'bg-[#C58B51] text-white border-[#C58B51]'
                                    : 'bg-[#FAF8F5] text-[#7C756E] border-[#E6DFD3]'
                                }`}
                              >
                                {mode.badge}
                              </span>
                            </div>
                            <p className="text-[11px] text-[#7C756E] leading-relaxed mt-0.5">
                              {mode.description}
                            </p>
                            <div className="text-[10px] text-[#A09890] mt-0.5">
                              {mode.details}
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* Clean SAW AI Model Badge */}
          <button
            type="button"
            onClick={onOpenSettings}
            className={`rounded-full px-2.5 py-0.5 text-[10px] font-bold border transition-all cursor-pointer shrink-0 flex items-center gap-1.5 shadow-2xs ${
              isGenerating
                ? 'bg-[#FAF8F5] text-[#C58B51] border-[#C58B51] ring-2 ring-[#C58B51]/20'
                : 'bg-[#FAF8F5] text-[#7C756E] hover:text-[#2C2825] border-[#E6DFD3] hover:border-[#C58B51]'
            }`}
            title="Click to configure AI Profiles & Models in Settings"
          >
            <span
              className={`w-1.5 h-1.5 rounded-full shrink-0 ${
                isGenerating ? 'bg-emerald-500 animate-ping' : 'bg-[#C58B51]'
              }`}
            />
            <span className="truncate max-w-[160px] sm:max-w-xs">{currentModelDisplay}</span>
          </button>
        </div>

        {/* Right Header Action Controls */}
        <div className="flex items-center gap-2 sm:gap-3 shrink-0">
          {/* Skills Dropdown Button & Popover */}
          <div className="relative" ref={skillsPopoverRef}>
            <button
              type="button"
              onClick={() => setShowSkillsPopover(!showSkillsPopover)}
              className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-xl border text-xs font-bold transition-all cursor-pointer shadow-2xs ${
                showSkillsPopover || (chat.enabledSkillIds && chat.enabledSkillIds.length > 0)
                  ? 'bg-[#FAF8F5] text-[#C58B51] border-[#C58B51]'
                  : 'bg-white text-[#7C756E] hover:text-[#2C2825] border-[#E6DFD3]'
              }`}
              title="Toggle Skills and modular instruction bundles for this chat"
            >
              <Sparkles size={13} className="text-[#C58B51]" />
              <span className="hidden sm:inline">Skills</span>
              <span className="text-[10px] px-1.5 py-0.2 rounded-full bg-white border border-[#E6DFD3] text-[#C58B51]">
                {chat.enabledSkillIds
                  ? chat.enabledSkillIds.length
                  : settings.skills?.filter((s) => s.enabledByDefault).length || 0}
              </span>
            </button>

            {/* Floating Skills Dropdown Popover */}
            {showSkillsPopover && (
              <div className="absolute right-0 top-full mt-2 w-80 sm:w-96 rounded-2xl bg-white border border-[#E6DFD3] shadow-2xl p-3.5 z-50 animate-in fade-in zoom-in-95 text-xs text-[#2C2825]">
                <div className="flex items-center justify-between border-b border-[#E6DFD3] pb-2.5 mb-2.5">
                  <div className="flex items-center gap-2">
                    <Sparkles size={15} className="text-[#C58B51]" />
                    <span className="font-bold">Active Chat Skills</span>
                  </div>
                  <span className="text-[10px] text-[#7C756E] font-medium">
                    Auto-applied on detection
                  </span>
                </div>

                <div className="space-y-2 max-h-64 overflow-y-auto pr-1">
                  {!settings.skills || settings.skills.length === 0 ? (
                    <div className="p-4 text-center text-[#7C756E] text-xs">
                      No skills installed. Click below to add a skill bundle.
                    </div>
                  ) : (
                    settings.skills.map((skill) => {
                      const isEnabled = chat.enabledSkillIds
                        ? chat.enabledSkillIds.includes(skill.id)
                        : skill.enabledByDefault ?? true;

                      return (
                        <div
                          key={skill.id}
                          onClick={() => onToggleChatSkill && onToggleChatSkill(skill.id)}
                          className={`p-2.5 rounded-xl border transition-all cursor-pointer flex items-start gap-2.5 ${
                            isEnabled
                              ? 'bg-[#FAF8F5] border-[#C58B51]'
                              : 'bg-white border-[#E6DFD3] hover:border-[#D9CFBF]'
                          }`}
                        >
                          <input
                            type="checkbox"
                            checked={isEnabled}
                            onChange={() => onToggleChatSkill && onToggleChatSkill(skill.id)}
                            className="w-4 h-4 accent-[#C58B51] mt-0.5 shrink-0 cursor-pointer"
                          />
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center justify-between">
                              <span className="font-bold text-[#2C2825] truncate">
                                {skill.name}
                              </span>
                              {skill.isBuiltIn && (
                                <span className="text-[9px] font-bold px-1.5 rounded bg-amber-50 text-amber-800 border border-amber-200">
                                  Built-in
                                </span>
                              )}
                            </div>
                            <p className="text-[11px] text-[#7C756E] line-clamp-1 mt-0.5">
                              {skill.description}
                            </p>
                          </div>
                        </div>
                      );
                    })
                  )}
                </div>

                {/* Bottom Footer Action */}
                <div className="flex items-center justify-between border-t border-[#E6DFD3] pt-2.5 mt-2.5">
                  <span className="text-[10px] text-[#7C756E]">
                    {settings.skills?.length || 0} total skill bundles
                  </span>
                  <button
                    type="button"
                    onClick={() => {
                      setShowSkillsPopover(false);
                      onOpenSettings();
                    }}
                    className="text-[11px] font-bold text-[#C58B51] hover:underline cursor-pointer flex items-center gap-1"
                  >
                    <span>+ Add & Manage Skills</span>
                  </button>
                </div>
              </div>
            )}
          </div>

          {/* Web Search Toggle Switch */}
          <div
            onClick={() => setWebSearchActive(!webSearchActive)}
            className="flex items-center gap-2 cursor-pointer select-none"
            title="Toggle Built-in Real-time Web Search Grounding"
          >
            <span className="hidden sm:inline text-xs font-semibold text-[#7C756E]">Web Search</span>
            <div
              className={`h-5 w-9 rounded-full p-0.5 transition-colors ${
                webSearchActive ? 'bg-[#C58B51]' : 'bg-[#E6DFD3]'
              }`}
            >
              <div
                className={`h-4 w-4 rounded-full bg-white shadow-2xs transition-transform ${
                  webSearchActive ? 'translate-x-4' : 'translate-x-0'
                }`}
              />
            </div>
          </div>

          {/* Export Markdown */}
          <button
            onClick={handleExportMarkdown}
            className="flex h-8 w-8 items-center justify-center rounded-lg hover:bg-[#FAF8F5] text-[#7C756E] hover:text-[#2C2825] border border-transparent hover:border-[#E6DFD3] transition-all cursor-pointer"
            title="Export Thread to Markdown"
          >
            <Download size={15} />
          </button>

          {/* Sandbox Runner — restricted in-app command execution (Feature 3) */}
          <button
            onClick={() => setShowSandbox((v) => !v)}
            className={`flex h-8 items-center gap-1.5 px-2.5 rounded-lg transition-all cursor-pointer border ${
              showSandbox
                ? 'bg-[#FAF8F5] text-[#C58B51] border-[#C58B51]'
                : 'text-[#7C756E] hover:text-[#2C2825] border-transparent hover:bg-[#FAF8F5] hover:border-[#E6DFD3]'
            }`}
            title="Open the restricted in-app sandbox to run build commands (npm/flutter/cargo) and download artifacts"
          >
            <Terminal size={15} />
            <span className="hidden sm:inline text-xs font-bold">Sandbox</span>
          </button>

          {/* Clear Chat */}
          <button
            onClick={onClearChat}
            className="flex h-8 w-8 items-center justify-center rounded-lg hover:bg-red-50 text-[#7C756E] hover:text-red-600 border border-transparent hover:border-red-200 transition-all cursor-pointer"
            title="Clear Chat Messages"
          >
            <Trash2 size={15} />
          </button>

        </div>
      </header>

      {/* Upload Notification Banner */}
      {uploadNotice && (
        <div className="px-6 py-2 bg-emerald-50 border-b border-emerald-200 text-emerald-800 text-xs font-semibold flex items-center justify-between animate-in slide-in-from-top-2">
          <div className="flex items-center gap-2">
            <CheckCircle2 size={14} className="text-emerald-600" />
            <span>{uploadNotice}</span>
          </div>
          <button onClick={() => setUploadNotice(null)} className="text-[10px] text-emerald-700 hover:underline">
            Dismiss
          </button>
        </div>
      )}

      {/* Pure Context Retention Modal / Info Drawer */}
      {showTokenInfo && project && contextStats && (
        <div className="px-6 py-2.5 bg-white border-b border-[#E6DFD3] flex items-center justify-between text-xs text-[#2C2825] animate-in slide-in-from-top-2">
          <div className="flex items-center gap-3">
            <div className="w-2 h-2 rounded-full bg-emerald-500"></div>
            <span className="font-bold text-xs">Pure Context Retention Active</span>
            <span className="text-[11px] text-[#7C756E]">
              Holding <strong>{contextStats.includedFilesCount}</strong> raw files (
              <strong>{contextStats.totalCharacters.toLocaleString()}</strong> characters / ~
              <strong>{contextStats.estimatedTokens.toLocaleString()}</strong> tokens) in memory without chunking.
            </span>
          </div>
          <button
            onClick={() => setShowTokenInfo(false)}
            className="text-[11px] font-bold text-[#C58B51] hover:underline cursor-pointer"
          >
            Dismiss
          </button>
        </div>
      )}

      {/* Chat Messages Conversation Stream */}
      <div 
        ref={scrollContainerRef}
        onScroll={handleScroll}
        className="flex-1 overflow-y-auto p-4 sm:p-6 space-y-6"
      >
        <div className="mx-auto max-w-2xl space-y-6">
          {chat.messages.length === 0 ? (
            <div className="flex flex-col items-center justify-center text-center py-10 px-4 space-y-6 animate-in fade-in duration-300">
              <div className="w-14 h-14 rounded-2xl bg-white border border-[#E6DFD3] flex items-center justify-center text-[#C58B51] shadow-2xs">
                <Sparkles size={28} />
              </div>
              <div className="space-y-1.5">
                <h2 className="text-base font-bold text-[#2C2825]">
                  {project ? `${chat.title} · ${project.name}` : chat.title || 'Universal Chat'}
                </h2>
                <p className="text-xs text-[#7C756E] max-w-md mx-auto leading-relaxed">
                  {project
                    ? `Workspace active for ${project.name} with ${project.files.length} project files loaded into memory context. Ask questions or generate components.`
                    : 'Universal chat session without project binding. Ask general questions, explore ideas, or generate standalone HTML/code artifacts.'}
                </p>
              </div>

              {/* Sample Prompt Suggestion Chips */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 w-full max-w-xl text-left">
                {SAMPLE_PROMPT_SUGGESTIONS.map((suggestion, idx) => (
                  <button
                    key={idx}
                    onClick={() => onSendMessage(suggestion, webSearchActive)}
                    className="p-3 rounded-xl border border-[#E6DFD3] bg-white hover:border-[#C58B51] hover:bg-[#FAF8F5] transition-all text-xs text-[#4A443F] font-medium shadow-2xs cursor-pointer text-left flex items-start gap-2"
                  >
                    <span className="text-[#C58B51] font-bold mt-0.5">✦</span>
                    <span className="line-clamp-2 leading-relaxed">{suggestion}</span>
                  </button>
                ))}
              </div>
            </div>
          ) : (
            chat.messages.map((message, idx) => {
              const previousUserPrompt = idx > 0
                ? chat.messages.slice(0, idx).reverse().find((m) => m.role === 'user')?.content
                : undefined;

              // During streaming the in-flight assistant message is fed from
              // the live-stream overlay (updated at animation-frame cadence)
              // instead of from the global chats state, so the rest of the
              // message list does not re-render on every token.
              const isLiveStreaming =
                liveStream != null &&
                liveStream.chatId === chat.id &&
                liveStream.assistantMsgId === message.id;

              const effectiveMessage = isLiveStreaming
                ? {
                    ...message,
                    content: liveStream!.content,
                    thinkingContent: liveStream!.thinkingContent,
                    isThinking: liveStream!.isThinking,
                    searchResults: liveStream!.searchResults,
                    modelUsed: liveStream!.modelUsed,
                  }
                : message;

              return (
                <MessageItem
                  key={message.id}
                  message={effectiveMessage}
                  userPrompt={previousUserPrompt}
                  isLastMessage={idx === chat.messages.length - 1}
                  isGenerating={isGenerating && idx === chat.messages.length - 1}
                  onContinue={onContinueGeneration}
                  onRetry={onRetryGeneration}
                  onOpenArtifact={onOpenArtifact}
                  onImplementCode={onImplementCode}
                  onClarificationAnswer={handleClarificationAnswer}
                  onAcceptArtifacts={onAcceptArtifacts}
                  onRejectArtifacts={onRejectArtifacts}
                  onOpenSettings={onOpenSettings}
                  onApplyPatch={onApplyPatch}
                  onRevertPatch={onRevertPatch}
                  onRestore={onRestore}
                  targetFile={targetFile}
                  targetArtifact={targetArtifact}
                />
              );
            })
          )}

          <div ref={messagesEndRef} />
        </div>
      </div>

      {/* Sandbox Runner Dock — restricted in-app command execution (Feature 3).
          Slides up from the bottom of the chat when toggled. */}
      {showSandbox && (
        <div className="h-[42vh] min-h-[280px] shrink-0 border-t-2 border-[#C58B51]/40 shadow-2xl animate-in slide-in-from-bottom-4 duration-300">
          <SandboxPanel project={project || null} onClose={() => setShowSandbox(false)} />
        </div>
      )}

      {/* Message Input Bottom Area */}
      <div className="p-4 sm:p-6 bg-transparent shrink-0">
        <div className="mx-auto max-w-2xl">
          {/* Floating Scroll-to-Bottom Jump Button */}
          {isUserScrolledUp && (
            <div className="flex justify-center mb-2 animate-in fade-in slide-in-from-bottom-2 duration-200">
              <button
                type="button"
                onClick={() => {
                  setIsUserScrolledUp(false);
                  messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
                }}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-white/95 backdrop-blur-xs border border-[#E6DFD3] text-xs font-semibold text-[#7C756E] hover:text-[#2C2825] hover:border-[#C58B51] shadow-md transition-all cursor-pointer active:scale-95"
              >
                <ChevronDown size={14} className="text-[#C58B51]" />
                <span>Jump to latest message</span>
              </button>
            </div>
          )}

          {/* Quick Floating Continue / Retry Action Banner above input */}
          {!isGenerating && chat.messages.length > 0 && (() => {
            const lastMsg = chat.messages[chat.messages.length - 1];
            if (lastMsg?.role === 'assistant' && (lastMsg.isStopped || lastMsg.isError)) {
              return (
                <div className="mb-2.5 px-3.5 py-2 rounded-xl bg-white border border-[#E6DFD3] shadow-xs flex items-center justify-between gap-3 animate-in fade-in slide-in-from-bottom-1 duration-200">
                  <div className="flex items-center gap-2 text-xs text-[#7C756E]">
                    <span className="w-2 h-2 rounded-full bg-amber-500 shrink-0"></span>
                    <span className="font-medium text-[#2C2825]">
                      {lastMsg.isStopped ? 'Response paused mid-prompt' : 'Generation stopped or failed'}
                    </span>
                  </div>
                  <div className="flex items-center gap-2">
                    {onContinueGeneration && (
                      <button
                        type="button"
                        onClick={() => onContinueGeneration(lastMsg.id)}
                        className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[#C58B51] hover:bg-[#B0783F] text-white text-xs font-bold transition-all shadow-2xs cursor-pointer active:scale-95"
                        title="Resume generation seamlessly from where it left off"
                      >
                        <Play size={11} className="fill-white" />
                        <span>Continue</span>
                      </button>
                    )}
                    {onRetryGeneration && (
                      <button
                        type="button"
                        onClick={() => onRetryGeneration(lastMsg.id)}
                        className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[#FAF8F5] hover:bg-[#F2ECE3] text-[#2C2825] border border-[#E6DFD3] text-xs font-bold transition-all shadow-2xs cursor-pointer active:scale-95"
                        title="Regenerate this response from scratch"
                      >
                        <RotateCw size={11} />
                        <span>Retry</span>
                      </button>
                    )}
                  </div>
                </div>
              );
            }
            return null;
          })()}

          <form
            onSubmit={handleSubmit}
            className="relative flex flex-col rounded-2xl border-2 border-[#E6DFD3] bg-white p-3 sm:p-4 focus-within:border-[#C58B51] transition-all shadow-sm"
          >
            <textarea
              ref={textareaRef}
              rows={2}
              value={inputText}
              onChange={(e) => setInputText(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder={
                project
                  ? `Ask about ${project.name} (injecting ${contextStats?.includedFilesCount} files)...`
                  : 'Type your message or prompt (Shift+Enter for new line)...'
              }
              className="w-full resize-none text-xs outline-none placeholder:text-[#A09890] text-[#2C2825] leading-relaxed bg-transparent"
            />

            {/* Hidden File Input for Paperclip */}
            <input
              type="file"
              ref={fileInputRef}
              onChange={handleFileSelect}
              multiple
              className="hidden"
            />

            {/* Input Controls Footer */}
            <div className="mt-2 flex items-center justify-between pt-1 relative">
              <div className="flex items-center gap-1.5 flex-wrap">
                {/* Paperclip File Upload */}
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  className="flex items-center justify-center h-7 w-7 rounded-lg text-[#7C756E] hover:text-[#2C2825] hover:bg-[#FAF8F5] transition-colors cursor-pointer"
                  title="Upload files to prompt context"
                >
                  <Paperclip size={14} />
                </button>

                {/* MCP Protocol Active Selector Popover Trigger */}
                <div className="relative" ref={mcpPopoverRef}>
                  <button
                    type="button"
                    onClick={() => setShowMcpPopover(!showMcpPopover)}
                    className={`flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-[11px] font-bold border transition-all cursor-pointer shadow-2xs ${
                      activeMcpServers.length > 0
                        ? 'bg-[#FAF8F5] text-[#C58B51] border-[#C58B51]'
                        : 'bg-white text-[#7C756E] border-[#E6DFD3] hover:text-[#2C2825]'
                    }`}
                    title="Toggle MCP servers & tool execution capabilities"
                  >
                    <Server size={12} className={activeMcpServers.length > 0 ? 'text-[#C58B51]' : 'text-[#7C756E]'} />
                    <span>MCPs ({activeMcpServers.length} active)</span>
                    {showMcpPopover ? <ChevronDown size={11} /> : <ChevronUp size={11} />}
                  </button>

                  {/* MCP Popover Panel */}
                  {showMcpPopover && (
                    <div className="absolute bottom-full left-0 mb-2 w-80 sm:w-96 rounded-2xl bg-white border border-[#E6DFD3] shadow-2xl p-4 z-50 animate-in fade-in zoom-in-95 text-[#2C2825] font-sans">
                      <div className="flex items-center justify-between pb-2 mb-3 border-b border-[#E6DFD3]">
                        <div className="flex items-center gap-2">
                          <div className="w-6 h-6 rounded-lg bg-[#FAF8F5] border border-[#E6DFD3] flex items-center justify-center text-[#C58B51]">
                            <Cpu size={13} />
                          </div>
                          <div>
                            <h4 className="text-xs font-bold text-[#2C2825]">Project MCP Capabilities</h4>
                            <p className="text-[10px] text-[#7C756E]">{totalMcpToolsCount} tools available</p>
                          </div>
                        </div>

                        <div className="flex items-center gap-1.5">
                          <button
                            type="button"
                            onClick={enableAllMcps}
                            className="text-[10px] font-bold text-[#C58B51] hover:underline cursor-pointer"
                          >
                            All ON
                          </button>
                          <span className="text-[10px] text-[#E6DFD3]">|</span>
                          <button
                            type="button"
                            onClick={disableAllMcps}
                            className="text-[10px] font-bold text-[#7C756E] hover:text-[#2C2825] cursor-pointer"
                          >
                            All OFF
                          </button>
                        </div>
                      </div>

                      <div className="space-y-2.5 max-h-60 overflow-y-auto pr-1">
                        {(settings.mcpServers || []).length === 0 ? (
                          <div className="text-center py-4 text-xs text-[#7C756E]">
                            No MCP servers configured yet.
                            <button
                              type="button"
                              onClick={() => {
                                setShowMcpPopover(false);
                                onOpenSettings();
                              }}
                              className="block mx-auto mt-2 text-[#C58B51] font-bold underline"
                            >
                              Open Settings to Add MCP
                            </button>
                          </div>
                        ) : (
                          (settings.mcpServers || []).map((server) => (
                            <div
                              key={server.id}
                              className={`p-2.5 rounded-xl border transition-all ${
                                server.enabled
                                  ? 'bg-[#FAF8F5] border-[#E6DFD3]'
                                  : 'bg-white border-[#F5F1EA] opacity-60'
                              }`}
                            >
                              <div className="flex items-center justify-between mb-1.5">
                                <div className="flex items-center gap-2 min-w-0">
                                  <span className="text-xs font-bold text-[#2C2825] truncate">{server.name}</span>
                                  <span className="text-[9px] font-mono px-1.5 py-0.2 rounded bg-white border border-[#E6DFD3] text-[#7C756E] uppercase">
                                    {server.type}
                                  </span>
                                </div>

                                <button
                                  type="button"
                                  onClick={() => toggleServer(server.id)}
                                  className={`px-2 py-0.5 rounded-lg text-[10px] font-bold border transition-all cursor-pointer ${
                                    server.enabled
                                      ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
                                      : 'bg-[#FAF8F5] text-[#7C756E] border-[#E6DFD3]'
                                  }`}
                                >
                                  {server.enabled ? 'ON' : 'OFF'}
                                </button>
                              </div>

                              {/* Tool items */}
                              <div className="space-y-1 mt-1 pl-1">
                                {(server.tools || []).map((tool) => (
                                  <div
                                    key={tool.id}
                                    onClick={() => server.enabled && toggleTool(server.id, tool.id)}
                                    className={`flex items-center justify-between text-[11px] p-1 rounded-lg transition-all ${
                                      server.enabled ? 'cursor-pointer hover:bg-white' : 'cursor-not-allowed'
                                    }`}
                                  >
                                    <div className="flex items-center gap-1.5 min-w-0">
                                      <Wrench size={10} className={tool.enabled && server.enabled ? 'text-[#C58B51]' : 'text-[#7C756E]'} />
                                      <span className="font-mono text-[10px] text-[#2C2825] truncate">{tool.name}</span>
                                    </div>
                                    <input
                                      type="checkbox"
                                      disabled={!server.enabled}
                                      checked={tool.enabled && server.enabled}
                                      onChange={() => {}}
                                      className="accent-[#C58B51] w-3 h-3 cursor-pointer"
                                    />
                                  </div>
                                ))}
                              </div>
                            </div>
                          ))
                        )}
                      </div>

                      {/* Footer Tip */}
                      <div className="mt-3 pt-2 border-t border-[#E6DFD3] flex items-center justify-between text-[10px] text-[#7C756E]">
                        <span>AI smartly executes active tools</span>
                        <button
                          type="button"
                          onClick={() => {
                            setShowMcpPopover(false);
                            onOpenSettings();
                          }}
                          className="font-bold text-[#C58B51] hover:underline flex items-center gap-1 cursor-pointer"
                        >
                          <Sliders size={10} />
                          <span>MCP Settings</span>
                        </button>
                      </div>
                    </div>
                  )}
                </div>

                {/* Web Search Grounding Status Pill */}
                <button
                  type="button"
                  onClick={() => setWebSearchActive(!webSearchActive)}
                  className={`flex items-center gap-1 px-2.5 py-1 rounded-lg text-[11px] font-semibold border transition-all cursor-pointer ${
                    webSearchActive
                      ? 'bg-[#FAF8F5] text-[#C58B51] border-[#C58B51]'
                      : 'bg-white text-[#7C756E] border-[#E6DFD3] hover:text-[#2C2825]'
                  }`}
                  title={
                    webSearchActive
                      ? 'Web Search is ON (Smart Auto-Intent: searches when needed, skips simple greetings & standard code)'
                      : 'Web Search is OFF'
                  }
                >
                  <Globe size={13} />
                  <span>Web Search {webSearchActive ? 'Auto' : 'OFF'}</span>
                </button>
              </div>

              {/* Right Side: Reasoning Mode Dropdown (on LEFT side of Send Message button) & Send Button */}
              <div className="flex items-center gap-2">
                {/* Reasoning Mode Dropdown Button */}
                <div className="relative" ref={reasoningPopoverRef}>
                  <button
                    type="button"
                    onClick={() => setShowReasoningPopover(!showReasoningPopover)}
                    className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-xl text-xs font-bold border transition-all cursor-pointer shadow-2xs ${
                      selectedReasoningMode !== 'off'
                        ? 'bg-[#FAF8F5] text-[#C58B51] border-[#C58B51]'
                        : 'bg-white text-[#7C756E] border-[#E6DFD3] hover:text-[#2C2825]'
                    }`}
                    title={`Reasoning Mode: ${activeReasoningConfig.label} (${activeReasoningConfig.badge})`}
                  >
                    <Brain
                      size={13}
                      className={selectedReasoningMode !== 'off' ? 'text-[#C58B51]' : 'text-[#7C756E]'}
                    />
                    <span className="hidden sm:inline">{activeReasoningConfig.label}</span>
                    <span className="sm:hidden">{activeReasoningConfig.shortLabel}</span>
                    {showReasoningPopover ? <ChevronDown size={12} /> : <ChevronUp size={12} />}
                  </button>

                  {/* Reasoning Dropdown Popover */}
                  {showReasoningPopover && (
                    <div className="absolute bottom-full right-0 mb-2 w-80 sm:w-96 rounded-2xl bg-white border border-[#E6DFD3] shadow-2xl p-4 z-50 animate-in fade-in zoom-in-95 text-[#2C2825] font-sans">
                      {/* Model Capabilities Header */}
                      <div className="pb-3 mb-3 border-b border-[#E6DFD3]">
                        <div className="flex items-center gap-2 mb-1.5">
                          <div className="w-6 h-6 rounded-lg bg-[#FAF8F5] border border-[#E6DFD3] flex items-center justify-center text-[#C58B51]">
                            <Brain size={13} />
                          </div>
                          <div>
                            <h4 className="text-xs font-bold text-[#2C2825]">Reasoning Mode (API Effort Level)</h4>
                            <p className="text-[10px] text-[#7C756E]">
                              Model: <span className="font-mono text-[#2C2825] font-bold">{activeModelName}</span>
                            </p>
                          </div>
                        </div>

                        {/* Model Capability Badge Card */}
                        <div className="p-2.5 rounded-xl bg-[#FAF8F5] border border-[#E6DFD3] text-[11px] space-y-1">
                          <div className="flex items-center justify-between">
                            <span className="font-bold text-[#C58B51]">{modelCapability.typeName}</span>
                            <span className="text-[9px] font-mono px-1.5 py-0.5 rounded bg-white text-[#7C756E] border border-[#E6DFD3]">
                              {modelCapability.supportsReasoning ? 'Dynamic Reasoning' : 'Universal CoT'}
                            </span>
                          </div>
                          <p className="text-[10px] text-[#7C756E] leading-relaxed">
                            {modelCapability.description}
                          </p>
                          <div className="text-[9px] font-mono text-[#A09890] truncate pt-0.5">
                            Parameter: {modelCapability.nativeParameter}
                          </div>
                        </div>
                      </div>

                      {/* Reasoning Modes List */}
                      <div className="space-y-1.5 max-h-64 overflow-y-auto pr-1">
                        {REASONING_MODES.map((modeOption: ReasoningModeOption) => {
                          const isSelected = selectedReasoningMode === modeOption.id;
                          return (
                            <button
                              key={modeOption.id}
                              type="button"
                              onClick={() => {
                                if (onSelectReasoningMode) {
                                  onSelectReasoningMode(modeOption.id);
                                }
                                setShowReasoningPopover(false);
                              }}
                              className={`w-full text-left p-2.5 rounded-xl border transition-all cursor-pointer flex items-start justify-between gap-2 ${
                                isSelected
                                  ? 'bg-[#FAF8F5] border-[#C58B51] shadow-2xs ring-1 ring-[#C58B51]/30'
                                  : 'bg-white border-[#E6DFD3] hover:bg-[#FAF8F5]/50'
                              }`}
                            >
                              <div className="space-y-1">
                                <div className="flex items-center gap-1.5">
                                  <span
                                    className={`text-xs font-bold ${
                                      isSelected ? 'text-[#C58B51]' : 'text-[#2C2825]'
                                    }`}
                                  >
                                    {modeOption.label}
                                  </span>
                                  <span className="text-[9px] font-mono px-1.5 py-0.2 rounded bg-white text-[#7C756E] border border-[#E6DFD3]">
                                    {modeOption.badge}
                                  </span>
                                  {modeOption.id === modelCapability.recommendedMode && (
                                    <span className="text-[9px] font-bold px-1.5 py-0.2 rounded bg-[#C58B51] text-white">
                                      Recommended
                                    </span>
                                  )}
                                </div>
                                <p className="text-[10px] text-[#7C756E] leading-relaxed">
                                  {modeOption.description}
                                </p>
                              </div>

                              <div className="pt-0.5 shrink-0">
                                {isSelected ? (
                                  <div className="w-4 h-4 rounded-full bg-[#C58B51] text-white flex items-center justify-center">
                                    <Check size={11} />
                                  </div>
                                ) : (
                                  <div className="w-4 h-4 rounded-full border border-[#E6DFD3]" />
                                )}
                              </div>
                            </button>
                          );
                        })}
                      </div>

                      {/* Popover Footer Info */}
                      <div className="mt-3 pt-2 border-t border-[#E6DFD3] flex items-center justify-between text-[10px] text-[#7C756E]">
                        <span>Model dynamically allocates thinking depth</span>
                        <span className="font-mono text-[9px] text-[#C58B51] font-bold">API Parameter Mode</span>
                      </div>
                    </div>
                  )}
                </div>

                {/* Submit or Stop Button */}
                {isGenerating ? (
                  <button
                    type="button"
                    onClick={onStopGeneration}
                    className="flex h-9 w-9 items-center justify-center rounded-xl bg-[#2C2825] hover:bg-black text-white shadow-md transition-all cursor-pointer shrink-0"
                    title="Stop Generating"
                  >
                    <Square size={14} className="fill-white" />
                  </button>
                ) : (
                  <button
                    type="submit"
                    disabled={!inputText.trim()}
                    className="flex h-9 items-center justify-center gap-1.5 px-3.5 rounded-xl bg-[#C58B51] hover:bg-[#B0783F] text-white font-bold text-xs shadow-md transition-all cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed shrink-0"
                    title="Send Message"
                  >
                    <span>Send</span>
                    <Send size={13} />
                  </button>
                )}
              </div>
            </div>
          </form>
        </div>
      </div>
    </main>
  );
};
