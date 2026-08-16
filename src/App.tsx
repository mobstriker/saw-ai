import { performChatRequest, performSearchRequest } from "./utils/chatProxy";
import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  BYOKSettings,
  ChatSession,
  Project,
  ProjectFile,
  Artifact,
  Message,
  SidebarTab,
  RightPanelTab,
  SearchResult,
  ReasoningMode,
  AutomationMode,
} from './types';
import { StorageService } from './utils/storage';
import { ContextInjector } from './utils/contextInjector';
import { FileSecurity } from './utils/fileSecurity';

function parseClarificationRequest(content: string): { requests: Array<{ question: string; options?: string[] }>; cleanContent: string } | null {
  if (!content) return null;

  const tryParse = (parsed: any, originalRegex: RegExp) => {
    if (parsed.clarification_requests && Array.isArray(parsed.clarification_requests) && parsed.clarification_requests.length > 0) {
      return {
        requests: parsed.clarification_requests.map((r: any) => ({
          question: r.question || 'Clarification question',
          options: Array.isArray(r.options) ? r.options : [],
        })),
        cleanContent: content.replace(originalRegex, '').trim(),
      };
    }
    if (parsed.clarification_request && (parsed.clarification_request.question || parsed.clarification_request.options)) {
      return {
        requests: [{
          question: parsed.clarification_request.question || 'Clarification question',
          options: Array.isArray(parsed.clarification_request.options) ? parsed.clarification_request.options : [],
        }],
        cleanContent: content.replace(originalRegex, '').trim(),
      };
    }
    return null;
  };

  // 1. JSON code block containing explicit clarification_requests
  const jsonBlockRegex = /```(?:json)?\s*(\{[\s\S]*?"(?:clarification_requests?)"[\s\S]*?\})\s*```/i;
  const jsonMatch = content.match(jsonBlockRegex);
  if (jsonMatch) {
    try {
      const parsed = JSON.parse(jsonMatch[1]);
      const result = tryParse(parsed, jsonBlockRegex);
      if (result) return result;
    } catch (e) {
      // ignore
    }
  }

  // 2. Raw JSON string in text with explicit clarification_requests
  const rawJsonRegex = /(\{[\s\S]*?"(?:clarification_requests?)"[\s\S]*?\})/i;
  const rawMatch = content.match(rawJsonRegex);
  if (rawMatch) {
    try {
      const parsed = JSON.parse(rawMatch[1]);
      const result = tryParse(parsed, rawJsonRegex);
      if (result) return result;
    } catch (e) {
      // ignore
    }
  }

  return null;
}

import { ArtifactParser } from './utils/artifactParser';
import { PatchApplier, PatchChunk } from './utils/patchApplier';
import { WorkspaceAutopilot } from './utils/workspaceAutopilot';
import { IntentDetector } from './utils/intentDetector';
import { ModelRouter } from './utils/modelRouter';
import { ChatTitler } from './utils/chatTitler';
import { parseThinkingFromStream } from './utils/reasoning';
import { Sidebar } from './components/Sidebar';
import { ChatWindow } from './components/ChatWindow';
import { RightPanel } from './components/RightPanel';
import { ProjectWorkspaceView } from './components/ProjectWorkspaceView';
import { CreateProjectModal } from './components/CreateProjectModal';
import { FileViewerModal } from './components/FileViewerModal';
import { SettingsModal } from './components/SettingsModal';
import { CreateFileModal } from './components/CreateFileModal';
import { CreateFolderModal } from './components/CreateFolderModal';
import { MoveFileModal } from './components/MoveFileModal';
import { SingleFileUploadModal } from './components/SingleFileUploadModal';
import { ImplementModal } from './components/ImplementModal';

export default function App() {
  // 1. Persistent State
  const [settings, setSettings] = useState<BYOKSettings>(() => StorageService.getSettings());
  const [projects, setProjects] = useState<Project[]>(() => StorageService.getProjects());
  const [chats, setChats] = useState<ChatSession[]>(() => StorageService.getChats());
  const [isDataLoaded, setIsDataLoaded] = useState(false);
  const [activeChatId, setActiveChatId] = useState<string | null>(null);

  useEffect(() => {
    const loadData = async () => {
      try {
        const [loadedSettings, loadedProjects, loadedChats] = await Promise.all([
          StorageService.getSettingsAsync(),
          StorageService.getProjectsAsync(),
          StorageService.getChatsAsync()
        ]);
        
        setSettings(loadedSettings);
        setProjects(loadedProjects);
        
        if (loadedChats && loadedChats.length > 0) {
          setChats(loadedChats);
          setActiveChatId(loadedChats[0].id);
        } else {
          const defaultChat: ChatSession = {
            id: `chat-${Date.now()}`,
            title: 'New Conversation',
            createdAt: Date.now(),
            updatedAt: Date.now(),
            messages: [],
            model: loadedSettings.defaultModel || 'gpt-4o',
            reasoningMode: loadedSettings.reasoningMode || 'medium',
          };
          setChats([defaultChat]);
          setActiveChatId(defaultChat.id);
        }
      } catch (err) {
        console.error('Error loading data from IndexedDB:', err);
      } finally {
        setIsDataLoaded(true);
      }
    };
    loadData();
  }, []);

  // Sync state to local storage. Uses debounced writers so a burst of
  // changes (e.g. every token during a streamed response) coalesces into a
  // single write rather than rewriting the whole table hundreds of times.
  //
  // CRITICAL: gate every writer on `isDataLoaded`. Before the async DB load
  // completes, the in-memory state holds the synchronous fallback defaults
  // (empty chats/projects, DEFAULT_SETTINGS). Writing those to disk would
  // WIPE persisted data (the diff-based saver deletes any record not in the
  // new list). The gate ensures we only persist real, post-load state.
  useEffect(() => {
    if (!isDataLoaded) return;
    // Always save — even when the array is empty — so deleted chats are
    // actually persisted. The guard `chats.length > 0` caused deletions to
    // be skipped when the last chat was removed, so deleted chats reappeared
    // on restart.
    StorageService.saveChatsDebounced(chats);
  }, [chats, isDataLoaded]);

  useEffect(() => {
    if (!isDataLoaded) return;
    StorageService.saveProjectsDebounced(projects);
  }, [projects, isDataLoaded]);

  useEffect(() => {
    if (!isDataLoaded) return;
    StorageService.saveSettings(settings);
  }, [settings, isDataLoaded]);

  // Flush any pending debounced writes when the page is closed or hidden.
  // Without this, the last change within a 600ms debounce window is lost on
  // reload/tab-close — which is exactly why chats "weren't saved" and
  // deletions "stayed around" on the next visit.
  useEffect(() => {
    const flush = () => StorageService.flushPending();
    // pagehide/beforeunload fire on tab close, reload, and mobile app
    // backgrounding. visibilitychange(hidden) catches mobile backgrounding
    // and tab-switches where the page may be evicted before unload fires.
    window.addEventListener('pagehide', flush);
    window.addEventListener('beforeunload', flush);
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden') flush();
    });
    return () => {
      window.removeEventListener('pagehide', flush);
      window.removeEventListener('beforeunload', flush);
    };
  }, []);

  // 2. Selection & Panel Layout State
  const [isLeftSidebarOpen, setIsLeftSidebarOpen] = useState(true);
  const [sidebarWidth, setSidebarWidth] = useState<number>(270);
  const [sidebarTab, setSidebarTab] = useState<SidebarTab>('projects');
  const [activeProjectId, setActiveProjectId] = useState<string | null>(() => {
    const projs = StorageService.getProjects();
    return projs[0]?.id || null;
  });

  // 3. Right Panel & Artifact State
  const [isRightPanelOpen, setIsRightPanelOpen] = useState(true);
  const [rightPanelWidth, setRightPanelWidth] = useState<number>(380);
  const [rightPanelTab, setRightPanelTab] = useState<RightPanelTab>('files');
  const [currentArtifact, setCurrentArtifact] = useState<Artifact | null>(null);
  const [allArtifacts, setAllArtifacts] = useState<Artifact[]>([]);

  // 4. Modals
  const [selectedFileForModal, setSelectedFileForModal] = useState<ProjectFile | null>(null);
  const [isSettingsModalOpen, setIsSettingsModalOpen] = useState(false);
  const [isCreateProjectModalOpen, setIsCreateProjectModalOpen] = useState(false);

  // File / Folder Management Modals
  const [isCreateFileOpen, setIsCreateFileOpen] = useState(false);
  const [createFileFolder, setCreateFileFolder] = useState('');

  const [isCreateFolderOpen, setIsCreateFolderOpen] = useState(false);
  const [createFolderParent, setCreateFolderParent] = useState('');

  const [isMoveFileOpen, setIsMoveFileOpen] = useState(false);
  const [fileToMove, setFileToMove] = useState<ProjectFile | null>(null);

  const [isUploadFilesModalOpen, setIsUploadFilesModalOpen] = useState(false);
  const [pendingUploadFiles, setPendingUploadFiles] = useState<File[]>([]);

  // Implement Artifact / Code Modal
  const [isImplementModalOpen, setIsImplementModalOpen] = useState(false);
  const [implementCode, setImplementCode] = useState('');
  const [implementLang, setImplementLang] = useState('');
  const [implementPath, setImplementPath] = useState('');

  // Hidden File input for custom upload
  const fileUploadInputRef = useRef<HTMLInputElement | null>(null);

  // 5. Streaming & Controller & Reasoning
  const [isGenerating, setIsGenerating] = useState(false);
  const [currentGeneratingModelName, setCurrentGeneratingModelName] = useState<string | null>(null);
  const [reasoningMode, setReasoningMode] = useState<ReasoningMode>(() => settings.reasoningMode || 'medium');
  const [automationMode, setAutomationMode] = useState<AutomationMode>(() => settings.automationMode || 'automatic');
  const [aiStatus, setAiStatus] = useState<'idle' | 'searching_web' | 'thinking' | 'generating'>('idle');
  const abortControllerRef = useRef<AbortController | null>(null);

  // --- Live-stream overlay (decouples streaming from the global chats state) ---
  // During a streamed response the assistant message accumulates token-by-token.
  // Writing each token into `chats` rebuilt the entire chat/message tree on
  // every token (the main cause of UI freezes on low-spec hardware). Instead,
  // tokens accumulate in a mutable ref and a single rAF-throttled state copy
  // drives re-render of ONLY the streaming message. The message is committed
  // to `chats` once, on completion/stop/error.
  const [liveStream, setLiveStream] = useState<{
    chatId: string;
    assistantMsgId: string;
    content: string;
    thinkingContent: string;
    isThinking: boolean;
    searchResults: SearchResult[];
    modelUsed: string;
  } | null>(null);
  const liveStreamRef = useRef<typeof liveStream>(null);
  const rafPendingRef = useRef(false);
  const rafIdRef = useRef<number | null>(null);

  // Coalesce live-stream updates to animation-frame cadence (≤60fps) instead
  // of one React render per token (which can be hundreds/sec).
  const scheduleLiveStreamFlush = () => {
    if (rafPendingRef.current) return;
    rafPendingRef.current = true;
    rafIdRef.current = requestAnimationFrame(() => {
      rafPendingRef.current = false;
      rafIdRef.current = null;
      setLiveStream(liveStreamRef.current ? { ...liveStreamRef.current } : null);
    });
  };

  const clearLiveStream = () => {
    if (rafIdRef.current !== null) {
      cancelAnimationFrame(rafIdRef.current);
      rafIdRef.current = null;
    }
    rafPendingRef.current = false;
    liveStreamRef.current = null;
    setLiveStream(null);
  };

  // Active Project & Chat Helpers
  const activeProject = projects.find((p) => p.id === activeProjectId) || null;
  const activeChat =
    chats.find((c) => c.id === activeChatId) ||
    chats[0] || {
      id: 'default',
      title: 'New Conversation',
      createdAt: Date.now(),
      updatedAt: Date.now(),
      messages: [],
      model: settings.defaultModel,
      reasoningMode: reasoningMode,
      automationMode: automationMode,
    };

  // The project strictly bound to the active chat session (null for universal chats)
  const currentChatProject = activeChat?.projectId
    ? projects.find((p) => p.id === activeChat.projectId) || null
    : null;

  const handleSelectReasoningMode = (mode: ReasoningMode) => {
    setReasoningMode(mode);
    const updatedSettings: BYOKSettings = { ...settings, reasoningMode: mode };
    setSettings(updatedSettings);
    StorageService.saveSettings(updatedSettings);
    if (activeChatId) {
      setChats((prev) =>
        prev.map((c) => (c.id === activeChatId ? { ...c, reasoningMode: mode, updatedAt: Date.now() } : c))
      );
    }
  };

  const handleSelectAutomationMode = (mode: AutomationMode) => {
    setAutomationMode(mode);
    const updatedSettings: BYOKSettings = { ...settings, automationMode: mode };
    setSettings(updatedSettings);
    StorageService.saveSettings(updatedSettings);
    if (activeChatId) {
      setChats((prev) =>
        prev.map((c) => (c.id === activeChatId ? { ...c, automationMode: mode, updatedAt: Date.now() } : c))
      );
    }
  };

  const handleAcceptArtifacts = (messageId: string, artifacts: Artifact[]) => {
    if (!activeProject) return;
    setProjects(prev => prev.map(p => {
      if (p.id !== activeProject.id) return p;
      let updatedFiles = [...p.files];
      artifacts.forEach(art => {
        const fileIndex = updatedFiles.findIndex(f => f.name === art.title || f.path === art.title);
        if (fileIndex >= 0) {
          updatedFiles[fileIndex] = { ...updatedFiles[fileIndex], content: art.code, lastModified: Date.now() };
        } else {
          updatedFiles.push({
            id: `file-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`,
            name: art.title,
            path: art.title,
            content: art.code,
            size: art.code.length,
            lastModified: Date.now(),
            includedInContext: true,
            language: art.language
          });
        }
      });
      return { ...p, files: updatedFiles, updatedAt: Date.now() };
    }));
    
    setChats(prevChats => prevChats.map(c => {
      if (c.id !== activeChatId) return c;
      return {
        ...c,
        messages: c.messages.map(m => m.id === messageId ? { ...m, artifactsState: 'accepted' } : m)
      };
    }));
  };

  const handleRejectArtifacts = (messageId: string) => {
    setChats(prevChats => prevChats.map(c => {
      if (c.id !== activeChatId) return c;
      return {
        ...c,
        messages: c.messages.map(m => m.id === messageId ? { ...m, artifactsState: 'rejected' } : m)
      };
    }));
  };

  // Handler: Add files directly to active project or create one
  const handleAddFilesToProject = (newFiles: ProjectFile[]) => {
    if (activeProject) {
      const updated = {
        ...activeProject,
        files: [...activeProject.files, ...newFiles],
        updatedAt: Date.now(),
      };
      handleUpdateProject(updated);
      if (activeChat && !activeChat.projectId) {
        setChats(chats.map((c) => (c.id === activeChat.id ? { ...c, projectId: activeProject.id, updatedAt: Date.now() } : c)));
      }
    } else {
      const newProj: Project = {
        id: `proj-${Date.now()}`,
        name: 'Workspace Files',
        description: 'Uploaded context files with 100% full-file retention.',
        createdAt: Date.now(),
        updatedAt: Date.now(),
        files: newFiles,
      };
      setProjects([newProj, ...projects]);
      setActiveProjectId(newProj.id);
      if (activeChat) {
        setChats(chats.map((c) => (c.id === activeChat.id ? { ...c, projectId: newProj.id, updatedAt: Date.now() } : c)));
      }
    }
  };

  // Handler: Ingest folder or file list dropped onto sidebar or chat
  const handleImportFolder = async (fileList: FileList | File[]) => {
    const newFiles: ProjectFile[] = [];
    const filesArray = Array.from(fileList);
    for (const f of filesArray) {
      try {
        const filePath = (f as any).webkitRelativePath || f.name;
        const readResult = await FileSecurity.readFileSafely(f, filePath);
        if (readResult.allowed) {
          newFiles.push({
            id: `file-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
            name: readResult.name || f.name,
            path: readResult.path || filePath,
            size: readResult.size,
            includedInContext: true,
            language: readResult.language || 'text',
            content: readResult.content,
          });
        }
      } catch (err) {
        console.warn('Could not read file:', err);
      }
    }
    if (newFiles.length > 0) {
      handleAddFilesToProject(newFiles);
    }
  };

  // Extract all artifacts from the active chat messages
  useEffect(() => {
    if (!activeChat) return;
    const extracted: Artifact[] = [];
    for (const msg of activeChat.messages) {
      if (msg.role === 'assistant') {
        const found = ArtifactParser.extractArtifacts(msg.content);
        extracted.push(...found);
      }
    }
    setAllArtifacts(extracted);
    if (extracted.length > 0 && !currentArtifact) {
      setCurrentArtifact(extracted[extracted.length - 1]);
    }
  }, [activeChatId, activeChat?.messages.length]);

  // Handler: Open Create New Project Modal
  const handleNewProject = () => {
    setIsCreateProjectModalOpen(true);
  };

  // Handler: Save New Project from Modal
  const handleSaveNewProject = (data: {
    name: string;
    description: string;
    instructions: string;
    files: ProjectFile[];
  }) => {
    const newProj: Project = {
      id: `proj-${Date.now()}`,
      name: data.name,
      description: data.description,
      instructions: data.instructions,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      files: data.files,
    };

    const newChat: ChatSession = {
      id: `chat-${Date.now()}`,
      title: `General Discussion`,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      projectId: newProj.id,
      model: settings.defaultModel,
      messages: [],
    };

    setProjects([newProj, ...projects]);
    setChats([newChat, ...chats]);
    setActiveProjectId(newProj.id);
    setActiveChatId(newChat.id);
    setSidebarTab('projects');
    setRightPanelTab('files');
    setIsRightPanelOpen(true);
  };

  /**
   * Feature 4 — "Save as a Project" from universal chat artifacts.
   *
   * When a standalone (no-project) chat has accumulated 2+ code artifacts, the
   * user can promote them into a real Project. We ask the AI (one non-streaming
   * call) to name the project and write a description + build instructions from
   * the artifact filenames/languages, then create the Project with the artifact
   * contents as files and rebind the active chat to it. Falls back to sensible
   * defaults if the AI call fails or returns malformed JSON.
   */
  const [isSavingAsProject, setIsSavingAsProject] = useState(false);

  const handleSaveArtifactsAsProject = useCallback(async () => {
    if (allArtifacts.length < 2 || isSavingAsProject) return;
    setIsSavingAsProject(true);
    try {
      const activeProfile =
        (settings.aiProfiles || []).find((p) => p.id === settings.activeProfileId) ||
        (settings.aiProfiles && settings.aiProfiles[0]);
      const finalBaseUrl = activeProfile?.baseUrl || settings.baseUrl;
      const finalApiKey = activeProfile?.apiKey || settings.apiKey;
      const chosenModel = activeProfile?.model || settings.defaultModel || 'gpt-4o';
      const finalCustomHeaders =
        activeProfile?.customHeaders !== undefined
          ? activeProfile.customHeaders
          : settings.customHeaders;
      let parsedHeaders: Record<string, string> | undefined;
      if (finalCustomHeaders) {
        try {
          parsedHeaders = typeof finalCustomHeaders === 'string'
            ? JSON.parse(finalCustomHeaders)
            : finalCustomHeaders;
        } catch {
          parsedHeaders = undefined;
        }
      }

      const fileListSummary = allArtifacts
        .map((a, i) => `${i + 1}. ${a.title} (${a.language})`)
        .join('\n');

      const metaSystem =
        'You generate project metadata as strict JSON. Respond with ONLY a JSON object, no markdown fences, no prose. Schema: {"name": string (short project name, 2-5 words, Title Case), "description": string (one sentence), "instructions": string (2-4 bullet build/run instructions for an AI coding assistant, newline-separated)}';
      const metaUser = `Based on these code files generated in a chat, suggest a project name, description, and build instructions.\n\nFiles:\n${fileListSummary}`;

      let meta = { name: '', description: '', instructions: '' };
      try {
        const res = await performChatRequest({
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            baseUrl: finalBaseUrl,
            apiKey: finalApiKey,
            model: chosenModel,
            messages: [{ role: 'user', content: metaUser }],
            stream: false,
            system_prompt: metaSystem,
            custom_headers: parsedHeaders,
            max_tokens: 400,
          }),
        });
        if (res.ok) {
          const data = await res.json();
          const content: string = data?.choices?.[0]?.message?.content || '';
          const jsonMatch = content.match(/\{[\s\S]*\}/);
          if (jsonMatch) {
            const parsed = JSON.parse(jsonMatch[0]);
            meta = {
              name: String(parsed.name || '').trim(),
              description: String(parsed.description || '').trim(),
              instructions: String(parsed.instructions || '').trim(),
            };
          }
        }
      } catch {
        // Non-fatal — fall back to derived defaults below.
      }

      const now = Date.now();
      const files: ProjectFile[] = allArtifacts.map((a, i) => ({
        id: `file-${now}-${i}`,
        name: a.title || `artifact-${i + 1}`,
        path: a.title || `artifact-${i + 1}`,
        content: a.code,
        size: a.code.length,
        lastModified: now,
        includedInContext: true,
        language: a.language,
      }));

      const newProj: Project = {
        id: `proj-${now}`,
        name: meta.name || `Untitled Project ${new Date(now).toLocaleDateString()}`,
        description: meta.description || 'Project created from chat artifacts.',
        instructions: meta.instructions || 'Continue developing the files in this project.',
        createdAt: now,
        updatedAt: now,
        files,
      };

      setProjects((prev) => [newProj, ...prev]);
      // Rebind the active chat to the new project so it keeps its history.
      if (activeChatId) {
        setChats((prev) =>
          prev.map((c) => (c.id === activeChatId ? { ...c, projectId: newProj.id, updatedAt: now } : c))
        );
      }
      setActiveProjectId(newProj.id);
      setSidebarTab('projects');
      setRightPanelTab('files');
      setIsRightPanelOpen(true);
    } finally {
      setIsSavingAsProject(false);
    }
  }, [allArtifacts, isSavingAsProject, settings, activeChatId]);

  // Handler: Create New Chat inside a Specific Project
  const handleNewChatInProject = (projectId: string) => {
    const newChat: ChatSession = {
      id: `chat-${Date.now()}`,
      title: 'New Conversation',
      createdAt: Date.now(),
      updatedAt: Date.now(),
      projectId: projectId,
      model: settings.defaultModel,
      messages: [],
    };

    setChats([newChat, ...chats]);
    setActiveChatId(newChat.id);
    setActiveProjectId(projectId);
    setSidebarTab('chats');
  };

  // Handler: Create New Standalone Chat (Normal Chat without a project)
  const handleNewChat = () => {
    const newChat: ChatSession = {
      id: `chat-${Date.now()}`,
      title: 'New Conversation',
      createdAt: Date.now(),
      updatedAt: Date.now(),
      projectId: undefined, // Standalone normal chat
      model: settings.defaultModel,
      messages: [],
    };

    setChats([newChat, ...chats]);
    setActiveChatId(newChat.id);
    setActiveProjectId(null); // Standalone chat is not bound to a project
    setSidebarTab('chats');
  };

  // Handler: Delete Project
  const handleDeleteProject = (projectId: string) => {
    const filtered = projects.filter((p) => p.id !== projectId);
    setProjects(filtered);
    StorageService.saveProjects(filtered);
    StorageService.flushPending();
    if (activeProjectId === projectId) {
      setActiveProjectId(filtered[0]?.id || null);
    }
  };

  // Handler: Delete Chat
  const handleDeleteChat = (chatId: string) => {
    const filtered = chats.filter((c) => c.id !== chatId);
    setChats(filtered);
    // Persist immediately so the deletion survives a reload within the
    // debounce window (the diff-based saver deletes the removed record).
    StorageService.saveChats(filtered);
    StorageService.flushPending();
    if (activeChatId === chatId) {
      setActiveChatId(filtered[0]?.id || null);
    }
  };

  // Handler: Rename Project
  const handleRenameProject = (projectId: string, newName: string) => {
    setProjects(
      projects.map((p) => (p.id === projectId ? { ...p, name: newName, updatedAt: Date.now() } : p))
    );
  };

  // Handler: Rename Chat
  const handleRenameChat = (chatId: string, newTitle: string) => {
    setChats(
      chats.map((c) => (c.id === chatId ? { ...c, title: newTitle, updatedAt: Date.now() } : c))
    );
  };

  // Handler: Update Project (e.g. adding files, toggling context)
  const handleUpdateProject = (updatedProject: Project) => {
    setProjects(projects.map((p) => (p.id === updatedProject.id ? updatedProject : p)));
  };

  // Handler: Clear Chat
  const handleClearChat = () => {
    if (!activeChat) return;
    const updatedChats = chats.map((c) => (c.id === activeChat.id ? { ...c, messages: [], updatedAt: Date.now() } : c));
    setChats(updatedChats);
    StorageService.saveChats(updatedChats);
    StorageService.flushPending();
    setCurrentArtifact(null);
    setAllArtifacts([]);
  };

  // Handler: Move or rename file
  const handleMoveFile = (fileId: string, newPath: string) => {
    if (!activeProject) return;
    const cleanPath = newPath.replace(/^\/+|\/+$/g, '');
    const cleanName = cleanPath.split('/').pop() || cleanPath;

    const updatedFiles = activeProject.files.map((f) =>
      f.id === fileId
        ? {
            ...f,
            path: cleanPath,
            name: cleanName,
            language: ContextInjector.detectLanguage(cleanName),
            lastModified: Date.now(),
          }
        : f
    );

    handleUpdateProject({
      ...activeProject,
      files: updatedFiles,
      updatedAt: Date.now(),
    });
  };

  // Handler: Toggle Skill for active chat session
  const handleToggleChatSkill = (skillId: string) => {
    if (!activeChat) return;
    const defaultEnabled = settings.skills?.filter((s) => s.enabledByDefault).map((s) => s.id) || [];
    const currentEnabled = activeChat.enabledSkillIds || defaultEnabled;
    const isCurrentlyEnabled = currentEnabled.includes(skillId);
    const newEnabled = isCurrentlyEnabled
      ? currentEnabled.filter((id) => id !== skillId)
      : [...currentEnabled, skillId];

    const updatedChats = chats.map((c) =>
      c.id === activeChat.id
        ? { ...c, enabledSkillIds: newEnabled, updatedAt: Date.now() }
        : c
    );
    setChats(updatedChats);
    StorageService.saveChats(updatedChats);
  };

  // Handler: Apply surgical search/replace patch chunk
  const handleApplyPatch = (patch: PatchChunk) => {
    const targetProject = activeProject || currentChatProject || (projects.length > 0 ? projects[0] : null);

    if (targetProject) {
      const { updatedFiles, appliedCount, results } = PatchApplier.applyPatchesToWorkspace(
        [patch],
        targetProject.files,
        selectedFileForModal?.id
      );

      if (appliedCount > 0) {
        handleUpdateProject({
          ...targetProject,
          files: updatedFiles,
          updatedAt: Date.now(),
        });

        // If the edited file is currently viewed in modal, update modal file
        const matchedResult = results[0]?.file;
        if (matchedResult && selectedFileForModal?.id === matchedResult.id) {
          const fresh = updatedFiles.find((f) => f.id === matchedResult.id);
          if (fresh) setSelectedFileForModal(fresh);
        }
      }
    } else if (currentArtifact) {
      const { updatedArtifact, result } = PatchApplier.applyPatchToArtifact(patch, currentArtifact);
      if (result.success) {
        setCurrentArtifact(updatedArtifact);
        setRightPanelTab('artifacts');
        setIsRightPanelOpen(true);
      }
    }
  };

  // Handler: Revert surgical patch chunk
  const handleRevertPatch = (patch: PatchChunk) => {
    const reversePatch: PatchChunk = {
      ...patch,
      searchChunk: patch.replaceChunk,
      replaceChunk: patch.searchChunk,
    };
    handleApplyPatch(reversePatch);
  };

  // Handler: Stop streaming generation
  const handleStopGeneration = () => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      abortControllerRef.current = null;
    }
    setIsGenerating(false);
  };

  // Handler: Continue generation from where it stopped mid-prompt
  const handleContinueGeneration = async (messageId?: string) => {
    if (isGenerating || !activeChat) return;

    const targetChat = activeChat;
    const messages = targetChat.messages;
    const targetIdx = messageId
      ? messages.findIndex((m) => m.id === messageId)
      : messages.length - 1;

    if (targetIdx < 0) return;
    const targetMsg = messages[targetIdx];
    if (targetMsg.role !== 'assistant') return;

    const previousAssistantContent = targetMsg.content || '';
    const assistantMsgId = targetMsg.id;

    // Find the original user prompt corresponding to this assistant turn
    let originalUserPrompt = '';
    for (let i = targetIdx - 1; i >= 0; i--) {
      if (messages[i].role === 'user') {
        originalUserPrompt = messages[i].content;
        break;
      }
    }

    // Filter clean conversation messages up to this assistant message
    const cleanPriorHistory = messages
      .slice(0, targetIdx)
      .filter(
        (m) =>
          !m.isError &&
          m.content &&
          m.content.trim() &&
          !m.content.startsWith('*(Response') &&
          !m.content.startsWith('*(The model')
      )
      .map((m) => ({
        role: m.role,
        content: m.content,
      }));

    // Find currently active AI Profile & model
    const activeProfile =
      (settings.aiProfiles || []).find((p) => p.id === settings.activeProfileId) ||
      (settings.aiProfiles && settings.aiProfiles[0]);
    const taskTier = ModelRouter.classifyTask(
      originalUserPrompt || previousAssistantContent,
      reasoningMode
    );
    const resolvedTarget = ModelRouter.resolveModel(activeProfile, taskTier);

    const finalBaseUrl = resolvedTarget.baseUrl || settings.baseUrl;
    const finalApiKey = resolvedTarget.apiKey || settings.apiKey;
    const chosenModel = resolvedTarget.model || settings.defaultModel || 'gpt-4o';
    const chosenModelDisplayName = resolvedTarget.name || chosenModel;
    const finalCustomHeaders =
      resolvedTarget.customHeaders !== undefined
        ? resolvedTarget.customHeaders
        : settings.customHeaders;

    // Construct continuation messages payload
    const continuationInstruction =
      'You were interrupted mid-response. Seamlessly continue generating your response starting immediately from the exact next word or character where you left off. Do NOT repeat any previously generated text or code, do NOT output conversational fillers or intro phrases (like "Sure" or "Continuing"), and simply continue the response directly:';

    const continuationMessages =
      previousAssistantContent.trim().length > 0
        ? [
            ...cleanPriorHistory,
            { role: 'assistant' as const, content: previousAssistantContent },
            { role: 'user' as const, content: continuationInstruction },
          ]
        : [
            ...cleanPriorHistory,
            {
              role: 'user' as const,
              content: originalUserPrompt || 'Please generate the complete response.',
            },
          ];

    // Mark as generating, clear isStopped and isError
    setChats((prevChats) =>
      prevChats.map((c) =>
        c.id === targetChat.id
          ? {
              ...c,
              messages: c.messages.map((m) =>
                m.id === assistantMsgId
                  ? { ...m, isStopped: false, isError: false, isThinking: reasoningMode !== 'off' }
                  : m
              ),
              updatedAt: Date.now(),
            }
          : c
      )
    );

    setIsGenerating(true);
    setCurrentGeneratingModelName(chosenModelDisplayName);
    setAiStatus(reasoningMode !== 'off' ? 'thinking' : 'generating');
    const controller = new AbortController();
    abortControllerRef.current = controller;

    const startTime = Date.now();
    let rawAccumulatedStream = '';
    let rawAccumulatedThinking = (targetMsg.thinkingContent || '').trim();
    let accumulatedNewText = '';

    try {
      let fullSystemPrompt = settings.systemPrompt || '';
      // Project context is injected ONLY for chats bound to a project.
      // Universal chats (no projectId) must not see any project files.
      const chatProject = targetChat.projectId
        ? projects.find((p) => p.id === targetChat.projectId) || null
        : null;

      if (chatProject && chatProject.files && chatProject.files.length > 0) {
        const { promptText } = ContextInjector.buildProjectPromptContext(chatProject);
        if (promptText) {
          fullSystemPrompt = `${promptText}\n\n${fullSystemPrompt}`;
        }
      }

      let parsedHeaders = {};
      try {
        if (finalCustomHeaders) {
          parsedHeaders = JSON.parse(finalCustomHeaders);
        }
      } catch (e) {
        console.warn('Failed to parse custom headers JSON', e);
      }

      const activeMcps = (settings.mcpServers || []).filter((s) => s.status === 'connected');

      const response = await performChatRequest({
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          baseUrl: finalBaseUrl,
          apiKey: finalApiKey,
          model: chosenModel,
          messages: continuationMessages,
          stream: true,
          system_prompt: fullSystemPrompt,
          custom_headers: parsedHeaders,
          mcp_tools: activeMcps.flatMap((s) => (s.tools || []).filter((t) => t.enabled)),
          reasoning_effort: reasoningMode,
          max_tokens: activeProfile?.maxTokens || settings.maxTokens || 0,
        }),
        signal: controller.signal,
      });

      if (!response.ok) {
        const errJson = await response.json().catch(() => ({}));
        throw new Error(errJson.message || errJson.error || `HTTP ${response.status}`);
      }

      const reader = response.body?.getReader();
      const decoder = new TextDecoder();
      if (!reader) throw new Error('No readable stream received from server');

      let buffer = '';
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed || trimmed.startsWith(':')) continue;
          if (trimmed === 'data: [DONE]') break;

          let delta = '';
          let reasoningDelta = '';

          if (trimmed.startsWith('data: ')) {
            try {
              const data = JSON.parse(trimmed.slice(6));
              delta =
                data.choices?.[0]?.delta?.content ||
                data.choices?.[0]?.delta?.text ||
                data.choices?.[0]?.text ||
                data.choices?.[0]?.message?.content ||
                data.content ||
                '';
              reasoningDelta =
                data.choices?.[0]?.delta?.reasoning_content ||
                data.choices?.[0]?.delta?.reasoning ||
                data.choices?.[0]?.delta?.thinking ||
                '';
            } catch {}
          } else if (trimmed.startsWith('{') && trimmed.endsWith('}')) {
            try {
              const data = JSON.parse(trimmed);
              delta =
                data.choices?.[0]?.delta?.content ||
                data.choices?.[0]?.delta?.text ||
                data.choices?.[0]?.message?.content ||
                data.choices?.[0]?.text ||
                data.content ||
                '';
              reasoningDelta =
                data.choices?.[0]?.delta?.reasoning_content ||
                data.choices?.[0]?.delta?.reasoning ||
                data.choices?.[0]?.delta?.thinking ||
                '';
            } catch {}
          }

          if (delta || reasoningDelta) {
            if (delta) {
              accumulatedNewText += delta;
              rawAccumulatedStream += delta;
            }
            if (reasoningDelta) {
              rawAccumulatedThinking += reasoningDelta;
            }

            const parsedStream = parseThinkingFromStream(rawAccumulatedStream);
            const combinedThinking = (
              rawAccumulatedThinking +
              (parsedStream.thinking
                ? (rawAccumulatedThinking ? '\n' : '') + parsedStream.thinking
                : '')
            ).trim();
            const rawContent =
              parsedStream.content ||
              (parsedStream.isStillThinking ? '' : accumulatedNewText);

            // Strip accidental leading meta-commentary like "Sure, continuing:"
            const cleanedContinuation = rawContent.replace(
              /^(?:\s*(?:(?:Certainly|Sure|Okay|Alright|Of course|Understood)[!,.]?\s*)?(?:(?:Here is the continuation(?: of the (?:code|response|text))?|Continuing from where (?:I|we) left off|Continuing the response|Continuing from where we stopped|Continuing|Resuming from where we stopped|Resuming)[:.]?\s*)+)/i,
              ''
            );

            const fullCombined = previousAssistantContent + cleanedContinuation;

            const isCurrentlyThinking =
              parsedStream.isStillThinking ||
              (!cleanedContinuation && Boolean(rawAccumulatedThinking));

            if (isCurrentlyThinking) {
              setAiStatus('thinking');
            } else if (cleanedContinuation) {
              setAiStatus('generating');
            }

            // Update the live-stream overlay (rAF-throttled) instead of
            // rebuilding the entire chats state on every token.
            liveStreamRef.current = {
              chatId: targetChat.id,
              assistantMsgId,
              content: fullCombined,
              thinkingContent: combinedThinking,
              isThinking: isCurrentlyThinking,
              searchResults: [],
              modelUsed: chosenModelDisplayName,
            };
            scheduleLiveStreamFlush();
          }
        }
      }

      // Process any leftover chunk in buffer
      if (buffer.trim()) {
        const trimmed = buffer.trim();
        if (trimmed.startsWith('data: ') && trimmed !== 'data: [DONE]') {
          try {
            const data = JSON.parse(trimmed.slice(6));
            const delta =
              data.choices?.[0]?.delta?.content ||
              data.choices?.[0]?.delta?.text ||
              data.choices?.[0]?.text ||
              data.choices?.[0]?.message?.content ||
              data.content ||
              '';
            const reasoningDelta =
              data.choices?.[0]?.delta?.reasoning_content ||
              data.choices?.[0]?.delta?.reasoning ||
              data.choices?.[0]?.delta?.thinking ||
              '';
            if (delta) {
              accumulatedNewText += delta;
              rawAccumulatedStream += delta;
            }
            if (reasoningDelta) {
              rawAccumulatedThinking += reasoningDelta;
            }
          } catch {}
        }
      }

      // Commit complete: clear the live-stream overlay so the message now
      // renders from the committed chats state (single source of truth).
      clearLiveStream();

      // Final save on completion
      const parsedStream = parseThinkingFromStream(rawAccumulatedStream);
      const combinedThinking = (
        rawAccumulatedThinking +
        (parsedStream.thinking
          ? (rawAccumulatedThinking ? '\n' : '') + parsedStream.thinking
          : '')
      ).trim();
      const rawContent =
        parsedStream.content ||
        (parsedStream.isStillThinking ? '' : accumulatedNewText);
      const cleanedContinuation = rawContent.replace(
        /^(?:\s*(?:(?:Certainly|Sure|Okay|Alright|Of course|Understood)[!,.]?\s*)?(?:(?:Here is the continuation(?: of the (?:code|response|text))?|Continuing from where (?:I|we) left off|Continuing the response|Continuing from where we stopped|Continuing|Resuming from where we stopped|Resuming)[:.]?\s*)+)/i,
        ''
      );
      const fullCombinedFinal = (
        previousAssistantContent + cleanedContinuation
      ).trim();

      const newArtifacts = ArtifactParser.extractArtifacts(fullCombinedFinal);
      // Autopilot only targets the chat's bound project. Universal chats
      // (no projectId) do not auto-apply changes to any project workspace.
      let targetProject = targetChat.projectId
        ? projects.find((p) => p.id === targetChat.projectId) || null
        : null;
      const effectiveAutoMode = (targetChat.automationMode ||
        automationMode ||
        settings.automationMode ||
        'automatic') as AutomationMode;

      if (targetProject && fullCombinedFinal) {
        const autoResult = WorkspaceAutopilot.execute(
          targetProject,
          fullCombinedFinal,
          effectiveAutoMode
        );
        if (autoResult.hasChanges) {
          setProjects((prev) =>
            prev.map((p) => (p.id === targetProject!.id ? autoResult.updatedProject : p))
          );
        }
      }

      let updatedTargetChat: ChatSession | null = null;
      setChats((prevChats) => {
        const updated = prevChats.map((c) => {
          if (c.id !== targetChat.id) return c;
          const updatedChatObj = {
            ...c,
            messages: c.messages.map((m) =>
              m.id === assistantMsgId
                ? {
                    ...m,
                    content: fullCombinedFinal || previousAssistantContent,
                    thinkingContent: combinedThinking || m.thinkingContent,
                    isThinking: false,
                    isStopped: false,
                    isError: false,
                    artifacts: newArtifacts.length > 0 ? newArtifacts : m.artifacts,
                    artifactsState:
                      effectiveAutoMode === 'automatic_plus' || effectiveAutoMode === 'automatic'
                        ? 'auto_applied'
                        : m.artifactsState,
                    generationDurationMs:
                      (m.generationDurationMs || 0) + (Date.now() - startTime),
                  }
                : m
            ),
            updatedAt: Date.now(),
          };
          updatedTargetChat = updatedChatObj;
          return updatedChatObj;
        });
        StorageService.saveChats(updated);
        return updated;
      });
    } catch (err: any) {
      // Stop feeding the in-flight message from the overlay; the committed
      // chats state below takes over.
      clearLiveStream();
      const isAbort = err.name === 'AbortError';
      const parsedStream = parseThinkingFromStream(rawAccumulatedStream);
      const combinedThinking = (
        rawAccumulatedThinking +
        (parsedStream.thinking
          ? (rawAccumulatedThinking ? '\n' : '') + parsedStream.thinking
          : '')
      ).trim();
      const rawContent = parsedStream.content || accumulatedNewText;
      const cleanedContinuation = rawContent.replace(
        /^(?:\s*(?:(?:Certainly|Sure|Okay|Alright|Of course|Understood)[!,.]?\s*)?(?:(?:Here is the continuation(?: of the (?:code|response|text))?|Continuing from where (?:I|we) left off|Continuing the response|Continuing from where we stopped|Continuing|Resuming from where we stopped|Resuming)[:.]?\s*)+)/i,
        ''
      );
      const fullCombinedSoFar = (
        previousAssistantContent + cleanedContinuation
      ).trim();

      const hasContent = Boolean(fullCombinedSoFar || previousAssistantContent);

      let updatedTargetChat: ChatSession | null = null;
      setChats((prevChats) => {
        const updated = prevChats.map((c) => {
          if (c.id !== targetChat.id) return c;
          const updatedChatObj = {
            ...c,
            messages: c.messages.map((m) =>
              m.id === assistantMsgId
                ? {
                    ...m,
                    content:
                      fullCombinedSoFar ||
                      previousAssistantContent ||
                      (isAbort
                        ? 'Generation paused by user.'
                        : `Generation error: ${err.message || 'Stream interrupted'}`),
                    thinkingContent: combinedThinking || m.thinkingContent,
                    isThinking: false,
                    isStopped: hasContent,
                    isError: !hasContent,
                  }
                : m
            ),
            updatedAt: Date.now(),
          };
          updatedTargetChat = updatedChatObj;
          return updatedChatObj;
        });
        StorageService.saveChats(updated);
        return updated;
      });
    } finally {
      // Belt-and-suspenders: ensure no live-stream overlay lingers.
      clearLiveStream();
      setIsGenerating(false);
      setCurrentGeneratingModelName(null);
      setAiStatus('idle');
      abortControllerRef.current = null;
    }
  };

  // Handler: Retry / Regenerate response
  const handleRetryGeneration = async (messageId?: string) => {
    if (isGenerating || !activeChat) return;

    const targetChat = activeChat;
    const messages = targetChat.messages;
    const targetIdx = messageId
      ? messages.findIndex((m) => m.id === messageId)
      : messages.length - 1;

    if (targetIdx < 0) return;
    const targetMsg = messages[targetIdx];

    // Find the prompt, web search setting, and clean prior conversation messages
    let userPrompt = '';
    let useWebSearch = false;
    let priorMessages: Message[] = [];

    if (targetMsg.role === 'assistant') {
      let userIdx = -1;
      for (let i = targetIdx - 1; i >= 0; i--) {
        if (messages[i].role === 'user') {
          userIdx = i;
          userPrompt = messages[i].content;
          useWebSearch = Boolean(messages[i].webSearchUsed);
          break;
        }
      }
      if (userIdx >= 0) {
        priorMessages = messages.slice(0, userIdx);
      } else {
        priorMessages = messages.slice(0, targetIdx);
      }
    } else if (targetMsg.role === 'user') {
      userPrompt = targetMsg.content;
      useWebSearch = Boolean(targetMsg.webSearchUsed);
      priorMessages = messages.slice(0, targetIdx);
    }

    if (!userPrompt) {
      userPrompt = 'Please regenerate the previous response.';
    }

    // Call handleSendMessage with the original user prompt and cleanly pruned history
    await handleSendMessage(userPrompt, useWebSearch, priorMessages, targetChat.id);
  };

  // Handler: Send Message with Pure Context Injection + Web Search
  const handleSendMessage = async (
    userPrompt: string,
    useWebSearch: boolean,
    priorMessagesOverride?: Message[],
    forcedChatId?: string
  ) => {
    if (!userPrompt.trim() || isGenerating) return;

    let targetChat = forcedChatId ? chats.find(c => c.id === forcedChatId) || activeChat : activeChat;
    let currentChats = [...chats];

    // Create a new universal chat if there is no real active chat. The
    // activeChat fallback (id: 'default') is a transient placeholder used
    // when no persisted chat exists yet — typing into it must spawn a new
    // universal chat (projectId: undefined) rather than mutate the phantom.
    const targetChatIsPersisted = targetChat && chats.some(c => c.id === targetChat.id);
    if (!targetChat || !targetChatIsPersisted) {
      const fastTitle = ChatTitler.generateFastHeuristicTitle(userPrompt);
      const newChat: ChatSession = {
        id: `chat-${Date.now()}`,
        title: fastTitle,
        messages: [],
        createdAt: Date.now(),
        updatedAt: Date.now(),
        model: settings.defaultModel,
        // Universal chat — not bound to any project. Project context is
        // only injected for chats created via "New Chat" inside a project.
        projectId: undefined,
      };
      targetChat = newChat;
      currentChats = [newChat, ...chats];
      setChats(currentChats);
      setActiveChatId(newChat.id);
    }

    const baseHistory = priorMessagesOverride !== undefined
      ? priorMessagesOverride
      : (targetChat ? targetChat.messages : []);

    // Check if web search is genuinely needed for this query (incorporating chat history for follow-ups)
    const willSearchWeb = IntentDetector.shouldSearchWeb(userPrompt, useWebSearch, baseHistory);

    // Contextually resolve the exact search query (e.g. resolving pronouns, locations from prior turns)
    const resolvedSearchQuery = willSearchWeb
      ? IntentDetector.resolveSearchQuery(userPrompt, baseHistory, activeProject?.files || [])
      : userPrompt;

    // Find currently active AI Profile
    const activeProfile = (settings.aiProfiles || []).find(p => p.id === settings.activeProfileId) || (settings.aiProfiles && settings.aiProfiles[0]);

    // Smart Multi-Model Task Routing (Classifies prompt complexity & resolves appropriate model target)
    const taskTier = ModelRouter.classifyTask(userPrompt, reasoningMode);
    const resolvedTarget = ModelRouter.resolveModel(activeProfile, taskTier);

    let finalBaseUrl = resolvedTarget.baseUrl || settings.baseUrl;
    let finalApiKey = resolvedTarget.apiKey || settings.apiKey;
    let chosenModel = resolvedTarget.model || settings.defaultModel || 'gpt-4o';
    let chosenModelDisplayName = resolvedTarget.name || chosenModel;
    let finalCustomHeaders = resolvedTarget.customHeaders !== undefined ? resolvedTarget.customHeaders : settings.customHeaders;

    // 1. Add User message AND placeholder Assistant message immediately
    const userMessage: Message = {
      id: `msg-${Date.now()}-u`,
      role: 'user',
      content: userPrompt,
      timestamp: Date.now(),
      webSearchUsed: willSearchWeb,
    };

    const assistantMsgId = `msg-${Date.now()}-a`;
    const initialAssistantMsg: Message = {
      id: assistantMsgId,
      role: 'assistant',
      content: '',
      isThinking: reasoningMode !== 'off',
      reasoningMode: reasoningMode,
      timestamp: Date.now(),
      modelUsed: chosenModelDisplayName,
      searchResults: [],
    };

    // Filter clean conversation messages for the LLM API payload
    const cleanApiMessages = [
      ...baseHistory
        .filter((m) => !m.isError && m.content && m.content.trim() && !m.content.startsWith('*(Response') && !m.content.startsWith('*(The model'))
        .map((m) => ({
          role: m.role,
          content: m.content,
        })),
      { role: 'user', content: userPrompt },
    ];

    const isFirstMessage =
      baseHistory.length === 0 ||
      targetChat.title === 'New Conversation' ||
      targetChat.title === 'General Discussion' ||
      targetChat.title.startsWith('Topic ') ||
      targetChat.title.startsWith('Chat ');

    const initialHeuristicTitle = isFirstMessage
      ? ChatTitler.generateFastHeuristicTitle(userPrompt)
      : targetChat.title;

    const chatTargetId = targetChat.id;

    // Optimistically update chat with clean base history + user message + immediate assistant placeholder
    setChats(
      currentChats.map((c) =>
        c.id === chatTargetId
          ? {
              ...c,
              messages: [...baseHistory, userMessage, initialAssistantMsg],
              updatedAt: Date.now(),
              title: isFirstMessage ? initialHeuristicTitle : c.title,
            }
          : c
      )
    );

    // Asynchronously generate concise AI summary title using user-configured flash/fast model
    if (isFirstMessage) {
      ChatTitler.generateAIChatTitle({
        prompt: userPrompt,
        profile: activeProfile,
        settings: settings,
      })
        .then((aiTitle) => {
          if (aiTitle && aiTitle.trim()) {
            setChats((prev) =>
              prev.map((c) =>
                c.id === chatTargetId ? { ...c, title: aiTitle.trim(), updatedAt: Date.now() } : c
              )
            );
          }
        })
        .catch(() => {
          // Gracefully retain heuristic title
        });
    }

    setIsGenerating(true);
    setCurrentGeneratingModelName(chosenModelDisplayName);
    const controller = new AbortController();
    abortControllerRef.current = controller;

    const requestStartTime = Date.now();
    let assistantMessageContent = '';
    let rawAccumulatedStream = '';
    let rawAccumulatedThinking = '';
    let webSearchResults: SearchResult[] = [];

    try {
      // 2. Perform Web Search ONLY if IntentDetector verified it is genuinely required
      if (willSearchWeb) {
        setAiStatus('searching_web');
        try {
          const searchRes = await performSearchRequest({
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              query: resolvedSearchQuery || userPrompt,
              maxResults: settings.webSearchMaxResults || 5,
            }),
            signal: controller.signal,
          });
          if (searchRes.ok) {
            const sData = await searchRes.json();
            if (sData.results && Array.isArray(sData.results)) {
              webSearchResults = sData.results;
            }
          }
        } catch (sErr) {
          console.warn('Web search fetch error:', sErr);
        }
      }

      // If reasoning mode is active, set status to thinking
      if (reasoningMode !== 'off') {
        setAiStatus('thinking');
      } else {
        setAiStatus('generating');
      }

      // 3. Prepare Pure Context Injection from Project Files, Skills, and Active MCP Servers
      let fullSystemPrompt = settings.systemPrompt || '';

      // Add active Agent Skills context
      const skillsContext = ContextInjector.buildSkillsPromptContext(
        settings.skills || [],
        targetChat.enabledSkillIds,
        userPrompt
      );
      if (skillsContext.promptText) {
        fullSystemPrompt = `${skillsContext.promptText}\n\n${fullSystemPrompt}`;
      }

      // Inject project context: ONLY for chats bound to a project.
      // Universal chats (no projectId) must NOT have access to any
      // project workspace — they are standalone conversations. Project
      // context is injected exclusively when the chat was created via
      // "New Chat" inside a project (handleNewChatInProject sets projectId).
      const chatProject = targetChat.projectId
        ? projects.find((p) => p.id === targetChat.projectId) || null
        : null;

      if (chatProject && chatProject.files && chatProject.files.length > 0) {
        const { promptText } = ContextInjector.buildProjectPromptContext(chatProject);
        if (promptText) {
          fullSystemPrompt = `${promptText}\n\n${fullSystemPrompt}`;
        }
      }

      // If multiple projects exist in workspace, inject workspace directory overview
      // ONLY for project-bound chats. Universal chats do not see projects.
      if (targetChat.projectId && projects.length > 1) {
        const projectsCatalog = projects
          .map((p) => `- Project "${p.name}" (ID: ${p.id}): ${p.files.length} file(s) [${p.files.map((f) => f.path).join(', ')}]`)
          .join('\n');
        fullSystemPrompt += `\n\n# Workspace Projects Catalog:\n${projectsCatalog}\n`;
      }

      // Add active MCP capabilities to system context
      const activeMcps = (settings.mcpServers || []).filter((s) => s.enabled);
      if (activeMcps.length > 0) {
        const mcpDescriptions = activeMcps.map((s) => {
          const enabledTools = (s.tools || []).filter((t) => t.enabled);
          const toolList = enabledTools.map((t) => `  - ${t.name}: ${t.description}`).join('\n');
          return `[MCP Server: ${s.name} (${s.type})]\n${toolList}`;
        }).join('\n\n');

        fullSystemPrompt += `\n\n# Active Model Context Protocol (MCP) Tools:\nThe following MCP tools are active for this workspace and can be invoked or referenced to inspect data, execute analytical queries, or read files:\n${mcpDescriptions}\n\nWhen tool execution is requested, format tool usage clearly so the client and MCP execution layer can run it seamlessly.`;
      }

      // In Autonomous Multi-Step Planning mode, instruct AI on interactive checklists for complex tasks
      if (automationMode === 'automatic_plus') {
        fullSystemPrompt += `\n\n# Autonomous Multi-Step Planning Guidelines:
When handling complex multi-step tasks:
1. Begin with a concise execution checklist using markdown checkboxes:
   - [ ] Step 1: Summary of action
   - [ ] Step 2: Summary of action
2. Execute each step quickly, cleanly, and decisively without slow delay or unnecessary padding.
3. As steps are completed, mark them with - [x].
4. For simple or single-step questions, answer directly without creating an unnecessary checklist.`;
      }

      let parsedHeaders = {};
      try {
        if (finalCustomHeaders) {
          parsedHeaders = JSON.parse(finalCustomHeaders);
        }
      } catch (e) {
        console.warn('Failed to parse custom headers JSON', e);
      }

      // 4. Send chat request via universalFetch with SSE streaming
      const response = await performChatRequest({
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          baseUrl: finalBaseUrl,
          apiKey: finalApiKey,
          model: chosenModel,
          messages: cleanApiMessages,
          stream: true,
          system_prompt: fullSystemPrompt,
          web_search_context: webSearchResults,
          custom_headers: parsedHeaders,
          mcp_tools: activeMcps.flatMap(s => (s.tools || []).filter(t => t.enabled)),
          reasoning_effort: reasoningMode,
          max_tokens: activeProfile?.maxTokens || settings.maxTokens || 0,
        }),
        signal: controller.signal,
      });

      if (!response.ok) {
        const errJson = await response.json().catch(() => ({}));
        throw new Error(errJson.message || errJson.error || `HTTP ${response.status}`);
      }

      // 5. Read SSE stream
      const reader = response.body?.getReader();
      const decoder = new TextDecoder();

      if (!reader) {
        throw new Error('No readable stream received from proxy');
      }

      let buffer = '';
      rawAccumulatedStream = '';
      rawAccumulatedThinking = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed || trimmed.startsWith(':')) continue;

          if (trimmed === 'data: [DONE]') {
            break;
          }

          let delta = '';
          let reasoningDelta = '';

          if (trimmed.startsWith('data: ')) {
            try {
              const data = JSON.parse(trimmed.slice(6));
              delta = data.choices?.[0]?.delta?.content || data.choices?.[0]?.delta?.text || data.choices?.[0]?.text || data.choices?.[0]?.message?.content || data.content || '';
              reasoningDelta = data.choices?.[0]?.delta?.reasoning_content || data.choices?.[0]?.delta?.reasoning || data.choices?.[0]?.delta?.thinking || '';
            } catch (pErr) {
              // Non-fatal SSE chunk parse
            }
          } else if (trimmed.startsWith('{') && trimmed.endsWith('}')) {
            try {
              const data = JSON.parse(trimmed);
              delta = data.choices?.[0]?.delta?.content || data.choices?.[0]?.delta?.text || data.choices?.[0]?.message?.content || data.choices?.[0]?.text || data.content || '';
              reasoningDelta = data.choices?.[0]?.delta?.reasoning_content || data.choices?.[0]?.delta?.reasoning || data.choices?.[0]?.delta?.thinking || '';
            } catch (pErr) {
              // Non-fatal JSON chunk parse
            }
          }

          if (delta || reasoningDelta) {
            if (delta) {
              assistantMessageContent += delta;
              rawAccumulatedStream += delta;
            }
            if (reasoningDelta) {
              rawAccumulatedThinking += reasoningDelta;
            }

            const parsedStream = parseThinkingFromStream(rawAccumulatedStream);
            const combinedThinking = (rawAccumulatedThinking + (parsedStream.thinking ? (rawAccumulatedThinking ? '\n' : '') + parsedStream.thinking : '')).trim();
            const effectiveContent = parsedStream.content || (parsedStream.isStillThinking ? '' : assistantMessageContent);
            const isCurrentlyThinking = parsedStream.isStillThinking || (!effectiveContent && Boolean(rawAccumulatedThinking));

            if (isCurrentlyThinking) {
              setAiStatus('thinking');
            } else if (effectiveContent) {
              setAiStatus('generating');
            }

            // Update the live-stream overlay (rAF-throttled) instead of
            // rebuilding the entire chats state on every token. The overlay
            // feeds only the in-flight assistant message; the rest of the
            // message list stays referentially stable and does not re-render.
            liveStreamRef.current = {
              chatId: targetChat.id,
              assistantMsgId,
              content: effectiveContent,
              thinkingContent: combinedThinking,
              isThinking: isCurrentlyThinking,
              searchResults: webSearchResults,
              modelUsed: chosenModelDisplayName,
            };
            scheduleLiveStreamFlush();
          }
        }
      }

      // Process any leftover chunk in buffer
      if (buffer.trim()) {
        const trimmed = buffer.trim();
        if (trimmed.startsWith('data: ') && trimmed !== 'data: [DONE]') {
          try {
            const data = JSON.parse(trimmed.slice(6));
            const delta = data.choices?.[0]?.delta?.content || data.choices?.[0]?.delta?.text || data.choices?.[0]?.text || data.choices?.[0]?.message?.content || data.content || '';
            const reasoningDelta = data.choices?.[0]?.delta?.reasoning_content || data.choices?.[0]?.delta?.reasoning || data.choices?.[0]?.delta?.thinking || '';
            if (delta) {
              assistantMessageContent += delta;
              rawAccumulatedStream += delta;
            }
            if (reasoningDelta) {
              rawAccumulatedThinking += reasoningDelta;
            }
          } catch (e) {
            // ignore
          }
        }
      }

      // Finalize thinking state on message. Persist immediately (not just
      // via the debounced effect) so the completed assistant message survives
      // a reload even if it happens within the debounce window.
      setChats((prevChats) => {
        const updated = prevChats.map((c) => {
          if (c.id !== targetChat.id) return c;
          const parsedStream = parseThinkingFromStream(rawAccumulatedStream);
          const combinedThinking = (rawAccumulatedThinking + (parsedStream.thinking ? (rawAccumulatedThinking ? '\n' : '') + parsedStream.thinking : '')).trim();
          const finalContent = (parsedStream.content || assistantMessageContent || '').trim();
          const clarification = parseClarificationRequest(finalContent);
          
          let displayFinalContent = finalContent;
          if (!displayFinalContent) {
            if (combinedThinking) {
              displayFinalContent = `*(The model completed its reasoning phase but did not produce a response body before the stream ended. Click **Retry** below to regenerate the response.)*`;
            } else {
              displayFinalContent = `I have analyzed your workspace context and files. Let me know if you would like me to perform any specific code edits, deep reviews, or file modifications.`;
            }
          }

          return {
            ...c,
            messages: c.messages.map((m) =>
              m.id === assistantMsgId
                ? {
                    ...m,
                    content: clarification
                      ? (clarification.cleanContent || (clarification.requests && clarification.requests.length > 0 ? clarification.requests[0].question : '') || displayFinalContent)
                      : displayFinalContent,
                    thinkingContent: combinedThinking,
                    isThinking: false,
                    clarificationRequests: clarification ? clarification.requests : undefined,
                    clarificationAnswers: [],
                    modelUsed: chosenModelDisplayName,
                    generationDurationMs: Date.now() - requestStartTime,
                  }
                : m
            ),
            updatedAt: Date.now(),
          };
        });
        StorageService.saveChats(updated);
        return updated;
      });

      // Commit complete: clear the live-stream overlay so the message now
      // renders from the committed chats state (single source of truth).
      clearLiveStream();

      // 6. After completion, parse artifacts, patches, and execute workspace autopilot
      const finalParsed = parseThinkingFromStream(rawAccumulatedStream);
      const fullAssistantOutput = finalParsed.content || assistantMessageContent;
      const newArtifacts = ArtifactParser.extractArtifacts(fullAssistantOutput);

      let targetProject = targetChat.projectId
        ? projects.find((p) => p.id === targetChat.projectId) || null
        : null;
      const effectiveAutoMode = (targetChat.automationMode || automationMode || settings.automationMode || 'automatic') as AutomationMode;

      if (targetProject) {
        const autoResult = WorkspaceAutopilot.execute(targetProject, fullAssistantOutput, effectiveAutoMode);
        if (autoResult.hasChanges) {
          setProjects((prev) =>
            prev.map((p) => (p.id === targetProject!.id ? autoResult.updatedProject : p))
          );
        }

        if (effectiveAutoMode === 'automatic_plus' || effectiveAutoMode === 'automatic') {
          setChats((prevChats) =>
            prevChats.map((c) => {
              if (c.id !== targetChat.id) return c;
              return {
                ...c,
                messages: c.messages.map((m) =>
                  m.id === assistantMsgId
                    ? { ...m, artifactsState: 'auto_applied', artifacts: newArtifacts }
                    : m
                ),
              };
            })
          );
        } else {
          // Review mode
          if (newArtifacts.length > 0) {
            setChats((prevChats) =>
              prevChats.map((c) => {
                if (c.id !== targetChat.id) return c;
                return {
                  ...c,
                  messages: c.messages.map((m) =>
                    m.id === assistantMsgId
                      ? { ...m, artifactsState: 'pending', artifacts: newArtifacts }
                      : m
                  ),
                };
              })
            );
          }
        }
      } else {
        // If no project exists yet in workspace, create an initial Project with generated files
        const ops = WorkspaceAutopilot.parseOperations(fullAssistantOutput);
        if (ops.codeFiles.length > 0 || newArtifacts.length > 0) {
          const initialFiles: ProjectFile[] = ops.codeFiles.map((cf) => ({
            id: `file-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
            name: cf.path.split('/').pop() || cf.path,
            path: cf.path,
            content: cf.content,
            size: cf.content.length,
            includedInContext: true,
            language: cf.language || 'typescript',
            lastModified: Date.now(),
          }));

          const newProj: Project = {
            id: `proj-${Date.now()}`,
            name: 'Workspace Project',
            description: 'Active Project Workspace',
            createdAt: Date.now(),
            updatedAt: Date.now(),
            files: initialFiles,
          };

          setProjects([newProj]);
          setActiveProjectId(newProj.id);
          targetProject = newProj;
        }
      }

      if (newArtifacts.length > 0) {
        const latest = newArtifacts[newArtifacts.length - 1];
        setCurrentArtifact(latest);
        setAllArtifacts((prev) => {
          const ids = new Set(prev.map((a) => a.id));
          const toAdd = newArtifacts.filter((a) => !ids.has(a.id));
          return [...prev, ...toAdd];
        });

        const isFlutter =
          latest.language.toLowerCase() === 'dart' ||
          latest.language.toLowerCase() === 'flutter' ||
          latest.code.includes('package:flutter') ||
          latest.code.includes('StatelessWidget') ||
          latest.code.includes('StatefulWidget') ||
          latest.code.includes('MaterialApp') ||
          latest.title.endsWith('.dart');

        const isWeb =
          ['html', 'htm', 'svg', 'tsx', 'jsx'].includes(latest.language.toLowerCase()) ||
          latest.title.endsWith('.html') ||
          latest.title.endsWith('.htm') ||
          latest.title.endsWith('.svg') ||
          latest.title.endsWith('.tsx') ||
          latest.title.endsWith('.jsx');

        const isPreviewable = isFlutter || isWeb;

        setRightPanelTab('artifacts');
        // Only auto-open the panel preview for visual artifacts (Flutter simulator / Web preview)
        if (isPreviewable) {
          setIsRightPanelOpen(true);
        }
      }
    } catch (err: any) {
      // Stop feeding the in-flight message from the overlay regardless of
      // how the stream ended; the committed chats state below takes over.
      clearLiveStream();
      if (err.name === 'AbortError') {
        console.log('Stream aborted by user');
        setChats((prevChats) => {
          const updated = prevChats.map((c) => {
            if (c.id !== targetChat.id) return c;
            return {
              ...c,
              messages: c.messages.map((m) =>
                m.id === assistantMsgId
                  ? {
                      ...m,
                      isThinking: false,
                      isStopped: true,
                    }
                  : m
              ),
              updatedAt: Date.now(),
            };
          });
          StorageService.saveChats(updated);
          return updated;
        });
      } else {
        const isApiKeyError =
          err.message?.includes('No API') ||
          err.message?.includes('API key') ||
          err.message?.includes('API Key') ||
          err.message?.includes('configure an API') ||
          err.message?.includes('401') ||
          err.message?.includes('Unauthorized') ||
          err.message?.includes('Invalid Authentication');

        const isQuotaError =
          err.message?.includes('resource_exhausted') ||
          err.message?.includes('RESOURCE_EXHAUSTED') ||
          err.message?.includes('quota') ||
          err.message?.includes('Quota') ||
          err.message?.includes('429') ||
          err.message?.includes('rate limit') ||
          err.message?.includes('Rate limit') ||
          err.message?.includes('exceeded your current quota');

        let errorContent = '';
        if (isApiKeyError) {
          errorContent = `⚠️ **API Key Configuration Required**\n\nTo connect to your configured model, please enter your API key in **Settings** (⚙️).\n\n*Click the "Open Settings" button in the top header or sidebar to configure your key.*`;
        } else if (isQuotaError) {
          errorContent = `⚠️ **API Rate Limit / Quota Exceeded**\n\nYour model provider reported a quota limit (\`RESOURCE_EXHAUSTED\` / \`429\`):\n\n> *${err.message}*\n\n**Recommended Solutions:**\n- ⏳ **Wait 30–60 seconds** for the model provider's rate limit window to reset.\n- ⚙️ **Switch Model/Profile:** Open **Settings (⚙️)** to switch to a different model (e.g., Claude 3.5 Sonnet, GPT-4o, DeepSeek R1, or another Gemini tier).\n- 🔑 **Custom Key:** If using your own API key, check your quota and billing tier in your provider's developer console.`;
        } else {
          errorContent = `⚠️ **Connection Error**\n\n${err.message || 'Unable to connect to the model endpoint. Please check your settings or network connection.'}`;
        }

        setChats((prevChats) => {
          const updated = prevChats.map((c) => {
            if (c.id !== targetChat.id) return c;
            const hasExisting = c.messages.some((m) => m.id === assistantMsgId);
            const parsedStream = parseThinkingFromStream(rawAccumulatedStream);
            const combinedThinking = (rawAccumulatedThinking + (parsedStream.thinking ? (rawAccumulatedThinking ? '\n' : '') + parsedStream.thinking : '')).trim();
            const existingPartialContent = (parsedStream.content || assistantMessageContent || '').trim();

            const updatedMsgs = hasExisting
              ? c.messages.map((m) =>
                  m.id === assistantMsgId
                    ? {
                        ...m,
                        content: existingPartialContent || errorContent,
                        thinkingContent: combinedThinking || m.thinkingContent,
                        isThinking: false,
                        isError: !existingPartialContent,
                        isStopped: Boolean(existingPartialContent),
                      }
                    : m
                )
              : [
                  ...c.messages,
                  {
                    id: assistantMsgId,
                    role: 'assistant' as const,
                    content: existingPartialContent || errorContent,
                    thinkingContent: combinedThinking,
                    timestamp: Date.now(),
                    isError: !existingPartialContent,
                    isStopped: Boolean(existingPartialContent),
                  },
                ];
            return { ...c, messages: updatedMsgs, updatedAt: Date.now() };
          });
          StorageService.saveChats(updated);
          return updated;
        });
      }
    } finally {
      // Belt-and-suspenders: ensure no live-stream overlay lingers after the
      // generation ends, regardless of which path (success/abort/error) ran.
      clearLiveStream();
      setIsGenerating(false);
      setCurrentGeneratingModelName(null);
      setAiStatus('idle');
      abortControllerRef.current = null;
    }
  };

  return (
    <div className="flex h-full w-full overflow-hidden bg-[#FAF8F5] font-sans text-[#2C2825]">
      {/* 1. Left Sidebar */}
      <Sidebar
        isOpen={isLeftSidebarOpen}
        onToggleCollapse={() => setIsLeftSidebarOpen(!isLeftSidebarOpen)}
        width={sidebarWidth}
        onResize={setSidebarWidth}
        activeTab={sidebarTab}
        onSelectTab={setSidebarTab}
        projects={projects}
        chats={chats}
        activeProjectId={activeProjectId}
        activeChatId={activeChatId}
        onSelectProject={(pId) => {
          setActiveProjectId(pId);
          setSidebarTab('projects');
          // Also select project's chat if exists or first chat
          const projChat = chats.find((c) => c.projectId === pId);
          if (projChat) setActiveChatId(projChat.id);
          setRightPanelTab('files');
          setIsRightPanelOpen(true);
        }}
        onSelectChat={(cId) => {
          setActiveChatId(cId);
          const ch = chats.find((c) => c.id === cId);
          if (ch?.projectId) {
            setActiveProjectId(ch.projectId);
          } else {
            setActiveProjectId(null);
          }
          setSidebarTab('chats');
        }}
        onNewProject={handleNewProject}
        onNewChat={handleNewChat}
        onDeleteProject={handleDeleteProject}
        onDeleteChat={handleDeleteChat}
        onRenameProject={handleRenameProject}
        onRenameChat={handleRenameChat}
        onOpenSettings={() => setIsSettingsModalOpen(true)}
        onImportFolder={handleImportFolder}
      />

      {/* 2. Center Content Area (Project Workspace Hub or Chat Window) */}
      {sidebarTab === 'projects' && activeProject ? (
        <ProjectWorkspaceView
          project={activeProject}
          chats={chats}
          onSelectChat={(chatId) => {
            setActiveChatId(chatId);
            const ch = chats.find((c) => c.id === chatId);
            if (ch?.projectId) {
              setActiveProjectId(ch.projectId);
            }
            setSidebarTab('chats');
          }}
          onNewChatInProject={handleNewChatInProject}
          onDeleteChat={handleDeleteChat}
          onRenameChat={handleRenameChat}
          onUpdateProject={handleUpdateProject}
          onViewFile={(file) => setSelectedFileForModal(file)}
        />
      ) : (
        <ChatWindow
          key={activeChat.id}
          chat={activeChat}
          project={currentChatProject}
          settings={settings}
          onSendMessage={handleSendMessage}
          isGenerating={isGenerating}
          currentGeneratingModelName={currentGeneratingModelName}
          onStopGeneration={handleStopGeneration}
          onContinueGeneration={handleContinueGeneration}
          onRetryGeneration={handleRetryGeneration}
          onClearChat={handleClearChat}
          onOpenArtifact={(artifact) => {
            setCurrentArtifact(artifact);
            setRightPanelTab('artifacts');
            setIsRightPanelOpen(true);
          }}
          onImplementCode={(code, lang, suggestedPath) => {
            setImplementCode(code);
            setImplementLang(lang);
            setImplementPath(suggestedPath);
            setIsImplementModalOpen(true);
          }}
          onOpenSettings={() => setIsSettingsModalOpen(true)}
          onToggleLeftSidebar={() => setIsLeftSidebarOpen(!isLeftSidebarOpen)}
          isLeftSidebarOpen={isLeftSidebarOpen}
          onAddFilesToProject={handleAddFilesToProject}
          onUpdateMcpServers={(servers) => {
            setSettings((prev) => ({ ...prev, mcpServers: servers }));
          }}
          onToggleChatSkill={handleToggleChatSkill}
          selectedReasoningMode={reasoningMode}
          onSelectReasoningMode={handleSelectReasoningMode}
          selectedAutomationMode={automationMode}
          onSelectAutomationMode={handleSelectAutomationMode}
          aiStatus={aiStatus}
          onNewChatInProject={handleNewChatInProject}
          onAcceptArtifacts={handleAcceptArtifacts}
          onRejectArtifacts={handleRejectArtifacts}
          onApplyPatch={handleApplyPatch}
          onRevertPatch={handleRevertPatch}
          targetFile={selectedFileForModal || (currentChatProject?.files[0] || null)}
          targetArtifact={currentArtifact}
          onGoToProject={(projectId) => {
            setActiveProjectId(projectId);
            setSidebarTab('projects');
          }}
          liveStream={liveStream}
        />
      )}

      {/* 3. Collapsible Right Secondary Panel (Files & Artifacts) */}
      <RightPanel
        isOpen={isRightPanelOpen}
        onToggle={() => setIsRightPanelOpen(!isRightPanelOpen)}
        width={rightPanelWidth}
        onResize={setRightPanelWidth}
        activeTab={rightPanelTab}
        onSelectTab={setRightPanelTab}
        currentProject={currentChatProject || activeProject}
        onSelectFile={(file) => setSelectedFileForModal(file)}
        onUpdateProject={handleUpdateProject}
        currentArtifact={currentArtifact}
        allArtifacts={allArtifacts}
        onSelectArtifact={(art) => setCurrentArtifact(art)}
        onCloseArtifact={() => setCurrentArtifact(null)}
        onReportBug={(bugMessage) => handleSendMessage(bugMessage, false)}
        isUniversalChat={!activeChat?.projectId}
        onSaveAsProject={handleSaveArtifactsAsProject}
        isSavingAsProject={isSavingAsProject}
        onCreateFile={(initialFolder) => {
          if (!activeProject) handleNewProject();
          setCreateFileFolder(initialFolder || '');
          setIsCreateFileOpen(true);
        }}
        onCreateFolder={(parentFolder) => {
          if (!activeProject) handleNewProject();
          setCreateFolderParent(parentFolder || '');
          setIsCreateFolderOpen(true);
        }}
        onUploadFilesClick={() => {
          if (fileUploadInputRef.current) {
            fileUploadInputRef.current.value = '';
            fileUploadInputRef.current.click();
          }
        }}
        onMoveFile={(file) => {
          setFileToMove(file);
          setIsMoveFileOpen(true);
        }}
      />

      {/* Hidden file input for uploading file(s) with folder selection */}
      <input
        ref={fileUploadInputRef}
        type="file"
        multiple
        className="hidden"
        onChange={(e) => {
          const files = e.target.files;
          if (files && files.length > 0) {
            setPendingUploadFiles(Array.from(files));
            setIsUploadFilesModalOpen(true);
          }
        }}
      />

      {/* 4. Read-Only File Viewer & Web IDE Modal */}
      {selectedFileForModal && (
        <FileViewerModal
          file={selectedFileForModal}
          onClose={() => setSelectedFileForModal(null)}
          onReportBug={(bugMessage) => handleSendMessage(bugMessage, false)}
          onToggleContext={(fileId) => {
            if (!activeProject) return;
            const updated = activeProject.files.map((f) =>
              f.id === fileId ? { ...f, includedInContext: f.includedInContext === false } : f
            );
            handleUpdateProject({ ...activeProject, files: updated });
            setSelectedFileForModal((prev) =>
              prev && prev.id === fileId
                ? { ...prev, includedInContext: prev.includedInContext === false }
                : prev
            );
          }}
          onSaveContent={(fileId, newContent) => {
            if (!activeProject) return;
            const updated = activeProject.files.map((f) =>
              f.id === fileId
                ? {
                    ...f,
                    content: newContent,
                    size: newContent.length,
                    lastModified: Date.now(),
                  }
                : f
            );
            handleUpdateProject({ ...activeProject, files: updated });
            setSelectedFileForModal((prev) =>
              prev && prev.id === fileId
                ? {
                    ...prev,
                    content: newContent,
                    size: newContent.length,
                    lastModified: Date.now(),
                  }
                : prev
            );
          }}
        />
      )}

      {/* 5. BYOK Workspace Settings Modal */}
      <SettingsModal
        isOpen={isSettingsModalOpen}
        onClose={() => setIsSettingsModalOpen(false)}
        settings={settings}
        onSaveSettings={(newSettings) => setSettings(newSettings)}
      />

      {/* 5b. Create New Project Workspace Modal */}
      <CreateProjectModal
        isOpen={isCreateProjectModalOpen}
        onClose={() => setIsCreateProjectModalOpen(false)}
        onSaveProject={handleSaveNewProject}
      />

      {/* 6. Create File Modal (.py, .tsx, .env, .json, .sql) */}
      {activeProject && (
        <CreateFileModal
          isOpen={isCreateFileOpen}
          onClose={() => setIsCreateFileOpen(false)}
          project={activeProject}
          initialFolder={createFileFolder}
          onCreateFile={(file) => {
            handleAddFilesToProject([file]);
            setRightPanelTab('files');
            setIsRightPanelOpen(true);
          }}
        />
      )}

      {/* 7. Create Folder Modal */}
      {activeProject && (
        <CreateFolderModal
          isOpen={isCreateFolderOpen}
          onClose={() => setIsCreateFolderOpen(false)}
          project={activeProject}
          parentFolder={createFolderParent}
          onCreateFolder={(folderPath) => {
            // Create a .gitkeep or placeholder file to materialize folder in tree
            const placeholder: ProjectFile = {
              id: `f-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
              name: '.gitkeep',
              path: `${folderPath}/.gitkeep`,
              content: `# Folder initialized in SAW AI\n`,
              size: 38,
              includedInContext: false,
              language: 'text',
              lastModified: Date.now(),
            };
            handleAddFilesToProject([placeholder]);
            setRightPanelTab('files');
            setIsRightPanelOpen(true);
          }}
        />
      )}

      {/* 8. Move / Organize File Modal */}
      {activeProject && (
        <MoveFileModal
          isOpen={isMoveFileOpen}
          onClose={() => {
            setIsMoveFileOpen(false);
            setFileToMove(null);
          }}
          file={fileToMove}
          project={activeProject}
          onMoveFile={handleMoveFile}
        />
      )}

      {/* 9. Single / Multi File Upload with Folder Selector Modal */}
      {activeProject && (
        <SingleFileUploadModal
          isOpen={isUploadFilesModalOpen}
          onClose={() => {
            setIsUploadFilesModalOpen(false);
            setPendingUploadFiles([]);
          }}
          files={pendingUploadFiles}
          project={activeProject}
          onConfirmUpload={(newFiles) => {
            handleAddFilesToProject(newFiles);
            setRightPanelTab('files');
            setIsRightPanelOpen(true);
          }}
        />
      )}

      {/* 10. Implement Assistant Code Directly into Project Workspace Modal */}
      <ImplementModal
        isOpen={isImplementModalOpen}
        onClose={() => setIsImplementModalOpen(false)}
        code={implementCode}
        language={implementLang}
        suggestedPath={implementPath}
        project={activeProject}
        onImplement={(file) => {
          handleAddFilesToProject([file]);
          setRightPanelTab('files');
          setIsRightPanelOpen(true);
        }}
      />
    </div>
  );
}
