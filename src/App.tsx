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

/**
 * A thrown error that carries the provider's HTTP status code. We only treat a
 * response as a genuine quota/rate-limit error when there is a REAL 429 — never
 * from a loose substring match on an arbitrary transport error message (which
 * produced false "Your model provider reported a quota limit" banners on the
 * desktop webview when the SSE socket closed abruptly after a normal response).
 */
class HttpProviderError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.name = 'HttpProviderError';
    this.status = status;
  }
}
function isHttpProviderError(e: any): e is HttpProviderError {
  return e && typeof e.status === 'number';
}

/** Extract the human-readable error message from a provider error JSON body.
 *  Providers nest the message in many shapes:
 *    OpenAI:   { error: { message: "...", type, code } }
 *    Anthropic:{ error: { type, message: "..." } }
 *    Gemini:   { error: { code, message: "...", status } }
 *    DeepSeek/Together/custom: { message: "..." } or { error: "..." }
 *  Fall back to the raw body string, then to the HTTP status. This guarantees
 *  the REAL cause (e.g. "model_not_found", "unknown parameter") is surfaced
 *  in the error card instead of a generic "HTTP 400" that reads like a quota
 *  issue. */
function extractProviderErrorMessage(json: any, status: number, rawText?: string): string {
  if (!json) return rawText?.trim() || `HTTP ${status}`;
  if (typeof json === 'string') return json;
  if (typeof json.message === 'string') return json.message;
  if (typeof json.error === 'string') return json.error;
  if (json.error && typeof json.error === 'object') {
    if (typeof json.error.message === 'string') return json.error.message;
    if (typeof json.error.type === 'string') return `${json.error.type}: ${json.error.message || ''}`.trim();
  }
  if (json.detail && typeof json.detail === 'string') return json.detail;
  if (rawText && rawText.length < 500) return rawText.trim();
  return `HTTP ${status}`;
}

/**
 * Accumulate streamed OpenAI-style tool_call deltas into a map keyed by the
 * tool_call index. The first delta for a given index carries `id` + `name`;
 * later deltas carry `arguments` fragments that must be concatenated (the
 * arguments JSON is streamed token-by-token across many deltas).
 */
function accumulateToolCalls(
  buffers: Map<number, { id: string; name: string; arguments: string }>,
  toolCalls: any[] | undefined,
) {
  if (!Array.isArray(toolCalls)) return;
  for (const tc of toolCalls) {
    const idx: number = typeof tc.index === 'number' ? tc.index : 0;
    const existing = buffers.get(idx) || { id: '', name: '', arguments: '' };
    if (tc.id) existing.id = tc.id;
    if (tc.function?.name) existing.name = tc.function.name;
    if (typeof tc.function?.arguments === 'string') {
      existing.arguments += tc.function.arguments;
    }
    buffers.set(idx, existing);
  }
}

/**
 * Capture provider-reported token usage from a streamed SSE chunk. Providers
 * emit usage on the final chunk in a few shapes; we recognize the common ones:
 *  - OpenAI-compatible: `usage: { prompt_tokens, completion_tokens, total_tokens }`
 *  - Anthropic (message_delta): `usage: { input_tokens, output_tokens }` (the
 *    initial message_start also carries input_tokens)
 *  - Google/Gemini: `usageMetadata: { promptTokenCount, candidatesTokenCount }`
 * The caller passes the hoisted `usageInput`/`usageOutput` accumulators via the
 * returned values, so the latest non-zero usage wins (providers send it once).
 */
function captureUsage(data: any): { input: number; output: number } | null {
  // Mutates the module-level refs is not possible here; this is a pure reader
  // used by the inline closure below. (Kept as a standalone fn for clarity.)
  const u = data?.usage;
  if (u && typeof u === 'object') {
    const i = u.prompt_tokens ?? u.input_tokens ?? u.promptTokenCount ?? 0;
    const o = u.completion_tokens ?? u.output_tokens ?? u.candidatesTokenCount ?? 0;
    if (i || o) return { input: Number(i) || 0, output: Number(o) || 0 };
  }
  const um = data?.usageMetadata;
  if (um && typeof um === 'object') {
    const i = um.promptTokenCount ?? 0;
    const o = um.candidatesTokenCount ?? um.outputTokenCount ?? 0;
    if (i || o) return { input: Number(i) || 0, output: Number(o) || 0 };
  }
  return null;
}

import { ArtifactParser } from './utils/artifactParser';
import { PatchApplier, PatchChunk } from './utils/patchApplier';
import { WorkspaceAutopilot } from './utils/workspaceAutopilot';
import { useSandboxStore } from './utils/sandboxStore';
import { extractRunnableCommands, runSandboxAgentStep } from './utils/sandboxAgent';
import { ALLOWED_SANDBOX_COMMANDS } from './utils/sandboxRunner';
import { IntentDetector } from './utils/intentDetector';
import { ModelRouter } from './utils/modelRouter';
import { ChatTitler } from './utils/chatTitler';
import { countTokens } from './utils/tokenCounter';
import { parseThinkingFromStream } from './utils/reasoning';
import { probeMcpServer, callMcpTool, parseToolCallsFromText } from './utils/mcpExecutor';
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

  // Desktop (Tauri): pagehide/beforeunload do NOT reliably fire when the
  // window is closed — the webview process is destroyed immediately, taking
  // any pending debounced write (and even a just-issued settings put) with
  // it. That is why saved API keys / new chats vanished and deletions
  // reverted after closing the desktop app. Intercept the close request,
  // await the pending writes, then destroy the window.
  useEffect(() => {
  if (typeof window === 'undefined' || !(window as any).__TAURI_INTERNALS__) return;
  let unlisten: (() => void) | undefined;
  let disposed = false;
  
  (async () => {
    try {
      // Resolve the Tauri window handle lazily so the web build (no Tauri
      // internals) never touches the API. `win` was previously used without
      // being defined — the actual fix for the typecheck/runtime failure.
      const { getCurrentWindow } = await import('@tauri-apps/api/window');
      const win = getCurrentWindow();
      const un = await win.onCloseRequested(async (event) => {
        event.preventDefault();
        try {
          StorageService.flushPending();
        } finally {
          await win.destroy();
        }
      });
      if (disposed) un();
      else unlisten = un;
    } catch {
      // Window API unavailable — nothing to do.
    }
  })();
  
  return () => {
    disposed = true;
    unlisten?.();
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
  // Tracks the chat id whose artifacts we last derived, so switching chats
  // resets the artifact panel instead of letting the previous chat's artifact
  // bleed into the new one. Without this, setCurrentArtifact's "only set when
  // null" guard kept the old artifact visible after a chat switch.
  const lastArtifactChatIdRef = useRef<string | null>(null);

  // 3b. Shared sandbox store (App-level so AI-driven runs survive closing the
  // SandboxPanel). Passed to the panel and used by the sandbox agent loop.
  const sandboxStore = useSandboxStore();
  // Bounds AI→sandbox→AI follow-up rounds per manual user prompt to avoid
  // runaway loops. Reset whenever the user sends a fresh message.
  const sandboxFollowupRef = useRef(0);
  const SANDBOX_MAX_FOLLOWUPS = 6;
  const MCP_MAX_TOOL_ROUNDS = 6;
  // Bounds AI→MCP tool→AI follow-up rounds per manual user prompt (tool-calling
  // loop). Reset whenever the user sends a fresh message.
  const mcpFollowupRef = useRef(0);

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

  // Extract all artifacts from the active chat messages.
  //
  // CRITICAL: when the active chat changes we must RESET currentArtifact and
  // allArtifacts BEFORE re-deriving. The old guard `!currentArtifact` skipped
  // the update when an artifact from the *previous* chat was still selected,
  // so switching to a chat with no (or different) artifacts left the stale
  // artifact pinned in the right panel. Now we detect the chat switch via a
  // ref and clear first — for a universal chat with no artifacts this leaves
  // the panel in the "No Active Artifact" state; for project chats the
  // re-derived artifacts still show (projects keep their own codebase).
  useEffect(() => {
    if (!activeChat) {
      setAllArtifacts([]);
      setCurrentArtifact(null);
      lastArtifactChatIdRef.current = null;
      return;
    }

    const switchedChats = lastArtifactChatIdRef.current !== activeChat.id;
    if (switchedChats) {
      // Reset the panel for the newly-selected chat before deriving.
      setAllArtifacts([]);
      setCurrentArtifact(null);
      lastArtifactChatIdRef.current = activeChat.id;
    }

    const extracted: Artifact[] = [];
    for (const msg of activeChat.messages) {
      if (msg.role === 'assistant') {
        const found = ArtifactParser.extractArtifacts(msg.content);
        extracted.push(...found);
      }
    }
    setAllArtifacts(extracted);

    if (switchedChats) {
      // On a fresh chat selection, auto-select the latest artifact if any
      // (otherwise leave null → "No Active Artifact" placeholder shows).
      setCurrentArtifact(extracted.length > 0 ? extracted[extracted.length - 1] : null);
    } else if (extracted.length > 0) {
      // Same chat, new artifacts arrived: select the latest only if nothing is
      // currently selected (preserves the user's manual selection otherwise).
      setCurrentArtifact((prev) => prev ?? extracted[extracted.length - 1]);
    }
  }, [activeChatId, activeChat?.messages.length]);

  // On load, automatically probe every enabled MCP server so their real status
  // (online/offline) + discovered tools are known before the first chat. Without
  // this, servers show as "unknown"/"untested" and their tools are never sent to
  // the model (the runtime filter requires status === 'online'), so MCP would
  // silently do nothing even when servers are configured.
  useEffect(() => {
    if (!isDataLoaded) return;
    const enabled = (settings.mcpServers || []).filter((s) => s.enabled);
    if (enabled.length === 0) return;
    let cancelled = false;
    (async () => {
      const probed = await Promise.all(enabled.map((s) => probeMcpServer(s)));
      if (cancelled) return;
      setSettings((prev) => {
        const map = new Map(probed.map((s) => [s.id, s]));
        const next = (prev.mcpServers || []).map((s) => map.get(s.id) || s);
        return { ...prev, mcpServers: next };
      });
    })();
    return () => {
      cancelled = true;
    };
    // Only re-probe when the set of enabled servers changes (by id), not on
    // every settings mutation (which would re-probe after each probe writes
    // status back and loop). isDataLoaded gates the first run.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isDataLoaded, (settings.mcpServers || []).filter((s) => s.enabled).map((s) => s.id).join(',')]);

  // In a universal (no-project) chat the Files tab has no project to show, so
  // it is hidden in the RightPanel header. Make sure the active tab lands on
  // Artifacts in that case so the panel never renders an empty/no-op state.
  useEffect(() => {
    if (!activeChat?.projectId && rightPanelTab === 'files') {
      setRightPanelTab('artifacts');
    }
  }, [activeChat?.projectId, rightPanelTab]);

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

  // Handler: Restore the project files to the snapshot captured for a given
  // assistant message (per-response undo).
  //
  // The snapshot lives on the assistant message (`projectSnapshotBefore`) and
  // records the project's files *after* that turn's changes were applied
  // (post-change). Restoring message N replaces the bound project's files with
  // that snapshot, so everything that existed at turn N is kept and any files
  // created in *later* turns are removed — exactly the user's intent: "only
  // what was there at the step I clicked restore is kept." Because the project
  // is retained (even the auto-created one), the workspace stays usable.
  const handleRestore = useCallback((messageId: string) => {
    if (!activeChat) return;
    const targetMsg = activeChat.messages.find((m) => m.id === messageId);
    if (!targetMsg || targetMsg.role !== 'assistant') return;
    const snapshot = targetMsg.projectSnapshotBefore;
    if (!snapshot) return;

    const snapshotFiles = snapshot.files.map((f) => ({ ...f }));

    if (snapshot.projectId === null) {
      // Defensive: a post-change snapshot should always carry a project id
      // (the turn created one). If somehow null, keep the workspace projectless.
      setProjects((prev) => prev.filter((p) => p.id !== activeChat.projectId && p.name !== 'Workspace Project'));
    } else {
      // Roll the project's files back to the post-turn snapshot. This is a
      // full file-array replacement, so files created in later turns are
      // dropped automatically.
      setProjects((prev) =>
        prev.map((p) =>
          p.id === snapshot.projectId
            ? { ...p, files: snapshotFiles, updatedAt: Date.now() }
            : p
        )
      );
      // If the file viewer is showing a file, refresh it to the restored
      // content (or close it if the file no longer exists in the snapshot).
      setSelectedFileForModal((prev) => {
        if (!prev) return prev;
        const stillExists = snapshotFiles.some((f) => f.id === prev.id);
        if (!stillExists) return null;
        const restored = snapshotFiles.find((f) => f.id === prev.id);
        return restored ? { ...restored } : null;
      });
    }

    // Re-derive the Artifacts panel from messages up to and including the
    // restored one, so artifacts produced in later turns are dropped too.
    const restoreIndex = activeChat.messages.findIndex((m) => m.id === messageId);
    const keptArtifacts: Artifact[] = [];
    for (let i = 0; i <= restoreIndex; i++) {
      const m = activeChat.messages[i];
      if (m.role === 'assistant') {
        keptArtifacts.push(...ArtifactParser.extractArtifacts(m.content));
      }
    }
    setAllArtifacts(keptArtifacts);
    setCurrentArtifact((prev) => {
      if (!prev) return keptArtifacts[keptArtifacts.length - 1] ?? null;
      const stillThere = keptArtifacts.some((a) => a.id === prev.id);
      return stillThere ? prev : (keptArtifacts[keptArtifacts.length - 1] ?? null);
    });

    // Mark the message as restored so the UI shows a "Restored" badge, AND
    // truncate the conversation to the restored message. Restore is a true
    // "go back to this point": files, artifacts, AND the conversation itself
    // all reflect the state at the restored turn — later turns (and the
    // edits/files they produced) are removed. The project files + artifacts
    // were already rolled back above; this drops the now-orphaned messages.
    setChats((prevChats) =>
      prevChats.map((c) => {
        if (c.id !== activeChat.id) return c;
        return {
          ...c,
          messages: c.messages
            .slice(0, restoreIndex + 1)
            .map((m) =>
              m.id === messageId ? { ...m, restoredAt: Date.now() } : m
            ),
          updatedAt: Date.now(),
        };
      })
    );
  }, [activeChat]);

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
    // finish_reason captured from the continuation stream (same rationale as
    // handleSendMessage): only a "length" truncation is a real cutoff.
    let streamFinishReason: string | null = null;

    try {
      let fullSystemPrompt = settings.systemPrompt || '';
      // Same output-discipline guardrail as the main send path (see handleSendMessage).
      fullSystemPrompt += `\n\n# Output Discipline (IMPORTANT)
Only produce code, code files, or artifacts when the user's current message explicitly asks you to write, create, build, generate, refactor, or fix code (or a component/app/script/site). For general questions — including factual questions, weather, news, explanations, advice, or anything that does not require code to answer — respond in plain prose with NO code blocks and NO artifacts. Never create code just because code exists elsewhere in the conversation or project. If a previous turn involved code but the current question is unrelated, ignore the code and answer the question directly.`;
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

      // A server contributes tools only when the user has enabled it in the
      // chat AND it is actually reachable (status 'online'). The previous
      // filter used `status === 'connected'` — a value that never exists in
      // the MCPServer type (status is 'online'|'offline'|'checking'|'unknown'),
      // so this always returned zero tools ("no tools available" bug).
      const activeMcps = (settings.mcpServers || []).filter(
        (s) => s.enabled && s.status === 'online',
      );

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
        const errRawText = await response.text().catch(() => '');
        let errJson: any = {};
        try { errJson = JSON.parse(errRawText); } catch { errJson = {}; }
        throw new HttpProviderError(
          extractProviderErrorMessage(errJson, response.status, errRawText),
          response.status,
        );
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
              const fr = data.choices?.[0]?.finish_reason;
              if (fr) streamFinishReason = fr;
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
              const fr = data.choices?.[0]?.finish_reason;
              if (fr) streamFinishReason = fr;
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
            const fr = data.choices?.[0]?.finish_reason;
            if (fr) streamFinishReason = fr;
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

      // A continuation is only genuinely cut off if THIS continuation also hit
      // the token limit (finish_reason "length"). A clean stop means the
      // continued response is complete — do not flag it isStopped.
      const continuationTruncated = streamFinishReason === 'length';

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
                    isStopped: continuationTruncated,
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
    forcedChatId?: string,
    isSandboxFollowup = false,
    isMcpToolFollowup = false
  ) => {
    if (!userPrompt.trim() || isGenerating) return;

    // A fresh manual user message starts a new agent turn — reset the
    // sandbox follow-up round counter. Follow-up re-prompts keep it counting.
    if (!isSandboxFollowup && !isMcpToolFollowup) {
      sandboxFollowupRef.current = 0;
      mcpFollowupRef.current = 0;
    }

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

    // Check if web search is genuinely needed for this query (incorporating chat history for follow-ups).
    //
    // IMPORTANT (fixes "connected but not truly connected"): when the user has
    // EXPLICITLY enabled web search (the chat-bar toggle or the default-on
    // setting → useWebSearch === true), we ALWAYS run a search. The intent
    // detector is only used to REFINE the query (resolve pronouns/context) — it
    // must never suppress a search the user explicitly turned on. Previously,
    // the detector returned false for queries that didn't match its keyword/
    // pattern rules, so an enabled search silently did nothing and the AI never
    // received web context. Now: enabled ⇒ search (the detector's role is only
    // to shape the query, gated below). The detector can still ADD a search for
    // real-time/factual queries when the toggle is off.
    const willSearchWeb = useWebSearch || IntentDetector.shouldSearchWeb(userPrompt, useWebSearch, baseHistory);

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
    // Tracks the provider's finish_reason from the final SSE chunk so we can
    // distinguish a genuine truncation ("length" = hit max_tokens) from a clean
    // completion ("stop"). Only "length" (or an AbortError) should mark the
    // message isStopped — a clean "stop" must NOT show the false "cut off"
    // continue/retry banner.
    let streamFinishReason: string | null = null;
    // Provider-reported token usage, captured from the final SSE chunk when the
    // endpoint emits one (OpenAI-compatible `usage` or Anthropic's
    // `message_delta.usage`). When present this is the EXACT token spend; we fall
    // back to a BPE estimate otherwise.
    let usageInput = 0;
    let usageOutput = 0;

    // Hoisted for the post-completion sandbox agent follow-up (which runs after
    // the try/catch/finally). Filled in inside the try once known.
    let completedAssistantText = '';
    let completedChatId = chatTargetId;
    let completedAutoMode: AutomationMode = 'automatic';
    // Hoisted for the post-completion MCP tool-execution follow-up: native
    // tool_calls captured from the stream + text-parsed mcp_tool_call blocks.
    let completedNativeToolCalls: Array<{ id: string; name: string; arguments: string }> = [];

    try {
      // 2. Perform Web Search when enabled or when the intent detector flagged
      // a real-time/factual query. (See willSearchWeb above: an explicitly enabled
      // toggle always searches, so the AI genuinely receives web context.)
      if (willSearchWeb) {
        setAiStatus('searching_web');
        // The search runs BEFORE the chat and shares the chat's AbortController,
        // so cap it with its own short timeout — a slow/hung search-provider
        // request must never block the AI response. If it times out the chat
        // simply proceeds without web context (graceful degradation).
        const searchTimeout = new AbortController();
        const searchTimer = setTimeout(() => searchTimeout.abort(), 7000);
        try {
          const searchRes = await performSearchRequest({
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              query: resolvedSearchQuery || userPrompt,
              maxResults: settings.webSearchMaxResults || 5,
              provider: settings.webSearchProvider || 'tavily',
              // Exactly ONE provider is active at a time; resolve its key.
              apiKey:
                settings.webSearchProvider === 'serper'
                  ? settings.serperApiKey || ''
                  : settings.webSearchProvider === 'langsearch'
                  ? settings.langsearchApiKey || ''
                  : settings.webSearchApiKey || '',
            }),
            signal: searchTimeout.signal,
          });
          if (searchRes.ok) {
            const sData = await searchRes.json();
            if (sData.results && Array.isArray(sData.results)) {
              webSearchResults = sData.results;
            }
          }
        } catch (sErr) {
          // Includes the timeout abort + a user-initiated stop — never fatal.
          console.warn('Web search fetch error:', sErr);
        } finally {
          clearTimeout(searchTimer);
        }
      }

      // Attach the grounded search results to the USER message so the
      // "Web Search Grounding (N sources)" pill renders and the user can see
      // the search actually communicated (fixes "connected but not truly
      // connected" — now there's a visible indicator + the AI receives the
      // injected context).
      if (webSearchResults.length > 0) {
        const umId = userMessage.id;
        setChats((prev) =>
          prev.map((c) =>
            c.id === chatTargetId
              ? {
                  ...c,
                  messages: c.messages.map((m) =>
                    m.id === umId ? { ...m, searchResults: webSearchResults } : m
                  ),
                }
              : c
          )
        );
      }

      // If reasoning mode is active, set status to thinking
      if (reasoningMode !== 'off') {
        setAiStatus('thinking');
      } else {
        setAiStatus('generating');
      }

      // Resolve this chat's effective automation mode early — it's needed both
      // for the system prompt (sandbox access instructions) and for the
      // post-completion agent loop. Re-derived after completion but stable.
      const effectiveAutoMode = (targetChat.automationMode || automationMode || settings.automationMode || 'automatic') as AutomationMode;
      completedAutoMode = effectiveAutoMode;

      // 3. Prepare Pure Context Injection from Project Files, Skills, and Active MCP Servers
      let fullSystemPrompt = settings.systemPrompt || '';

      // Core behavioral guardrail: the AI must NOT produce code files / artifacts
      // unless the user's prompt explicitly asks for them. This stops the model
      // from spawning a Python/TSX file in response to an unrelated question
      // (e.g. "what's the weather?" creating an unwanted script). Answer the
      // question directly; only write code when the user requests code, a build,
      // a component, an app, a script, a refactor, a fix, etc.
      fullSystemPrompt += `\n\n# Output Discipline (IMPORTANT)
Only produce code, code files, or artifacts when the user's current message explicitly asks you to write, create, build, generate, refactor, or fix code (or a component/app/script/site). For general questions — including factual questions, weather, news, explanations, advice, or anything that does not require code to answer — respond in plain prose with NO code blocks and NO artifacts. Never create code just because code exists elsewhere in the conversation or project. If a previous turn involved code but the current question is unrelated, ignore the code and answer the question directly. When web search results are provided, use them to answer concisely and cite sources; do not generate files from them.`;

      // Artifact naming rules: the app saves every code block as a file named
      // from its first-line filename comment. Without these rules the model
      // (a) reuses the same filename for a "new" file (silently overwriting
      // the previous artifact in the workspace), and (b) references a made-up
      // name in its prose/run instructions ("run python calculator.py") that
      // doesn't match the real saved artifact ("python_run.py").
      const existingArtifactNames: string[] = [];
      for (const m of targetChat.messages) {
        if (m.role !== 'assistant' || !m.content) continue;
        for (const a of ArtifactParser.extractArtifacts(m.content)) {
          if (a.title && !existingArtifactNames.includes(a.title)) {
            existingArtifactNames.push(a.title);
          }
        }
      }
      fullSystemPrompt += `\n\n# Code Artifact Naming (IMPORTANT)
When you produce a code file/artifact:
1. Begin EVERY code block with a filename comment on the FIRST line naming the exact file you intend to create (e.g. \`// calculator.py\`, \`// login-form.tsx\`, \`// lib/main.dart\`). The app saves the artifact under EXACTLY that name.
2. When the user asks for a NEW file, choose a fresh, unique, descriptive filename — NEVER reuse the name of an existing artifact unless the user explicitly asked you to modify that same file. Files already created in this chat: ${existingArtifactNames.length > 0 ? existingArtifactNames.join(', ') : '(none yet)'}.
3. In your prose, always refer to the file by its EXACT filename — including in run instructions (only write \`python calculator.py\` if the file is actually named calculator.py).
4. After delivering a file, add a short one-line description of what it does and how to run or use it.`;

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

      // Add active MCP capabilities to system context. Mirror the runtime
      // filter: enabled AND online, otherwise the prompt advertises tools the
      // request body won't actually send.
      const activeMcps = (settings.mcpServers || []).filter(
        (s) => s.enabled && s.status === 'online',
      );
      // Namespaced tool list for the request body + a server-lookup map. Each
      // tool is sent as "<serverName>/<toolName>" so a returned tool_call can be
      // routed back to the originating MCP server.
      const mcpNamespacedTools = activeMcps.flatMap((s) =>
        (s.tools || [])
          .filter((t) => t.enabled)
          .map((t) => ({ ...t, _namespaced: `${s.name}/${t.name}`, _serverName: s.name, _serverUrl: s.url })),
      );
      // serverName -> server (for executing tool calls after the model returns).
      const mcpServerByName = new Map(activeMcps.map((s) => [s.name, s]));

      if (activeMcps.length > 0) {
        const mcpDescriptions = activeMcps.map((s) => {
          const enabledTools = (s.tools || []).filter((t) => t.enabled);
          const toolList = enabledTools.length > 0
            ? enabledTools.map((t) => `  - ${s.name}/${t.name}: ${t.description}`).join('\n')
            : '  (server reachable but no tools discovered)';
          return `[MCP Server: ${s.name} (${s.type}) — ${s.url}]\n${toolList}`;
        }).join('\n\n');

        fullSystemPrompt += `\n\n# Active Model Context Protocol (MCP) Tools:\nThe following MCP servers are connected and their tools are available for this chat. You may invoke or reference them to inspect data, run analytical queries, or read external resources:\n${mcpDescriptions}\n\n## How to call MCP tools\nIf your runtime supports native tool/function calling, call a tool by its full namespaced id (e.g. \`${activeMcps[0]?.name}/${(activeMcps[0]?.tools?.find((t) => t.enabled)?.name) || 'toolName'}\`). If it does NOT support native function calling, emit a fenced block:\n\n\`\`\`mcp_tool_call\n{ "tool": "<serverName>/<toolName>", "arguments": { ... } }\n\`\`\`\n\nYou may make multiple tool calls. The MCP execution layer runs each call against the named server and returns the result text to you automatically so you can read it and continue. Only call tools that are relevant to the user's request.`;
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

      // Sandbox access: when the user has granted the AI sandbox command
      // execution and the automation mode permits it, tell the AI how to run
      // commands. Commands emitted in a bash/sh (or <sandbox_run>) block run in
      // the restricted jailed shell and the output is fed back automatically so
      // it can read results and iterate.
      if (sandboxStore.available && sandboxStore.accessGranted && effectiveAutoMode !== 'review') {
        const allowList = ALLOWED_SANDBOX_COMMANDS.join(', ');
        const approvalNote =
          effectiveAutoMode === 'automatic'
            ? 'Each command you emit will be shown to the user for approval before it runs.'
            : 'Each command you emit runs automatically (the user chose Auto Planner).';
        fullSystemPrompt += `\n\n# Sandbox Command Execution (granted by user)
You have been granted access to run commands in the user's restricted in-app sandbox — a real jailed shell (NOT just an allowlist). When the task calls for building, installing, or running code, emit the command(s) in a fenced bash/sh code block (or <sandbox_run>...</sandbox_run>). ${approvalNote} The sandbox runs a real shell, so you may use cd, &&, pipes, redirects, and quoted arguments; the available toolchain includes: ${allowList}. Each command runs in the project's sandbox workdir, whose files (including the code you produced this turn) are seeded first — so \`python <file>.py\`, \`npm run dev\`, \`flutter build apk\`, etc. work by name. The stdout/stderr and exit code are returned to you automatically — read them and continue. The sandbox is jailed: it cannot read or write outside the app's sandbox folder, so do not try to access the host filesystem. Do NOT emit commands you don't intend to run (e.g. as illustrative examples); if you only want to show a command without running it, use a plain (non-shell) code block or say so explicitly.

## CRITICAL — Naming files you create (filename consistency)
Every code artifact you produce in this chat becomes a REAL file in the sandbox workdir, named from the FIRST line of the code block. You MUST begin EVERY code block with an explicit filename comment naming the file you intend to create, in the form:
  // path/to/file.ext   (or for non-C-like langs: # file.ext, <!-- file.html -->)
Examples:
  \`\`\`python
  // calculator.py
  def main(): ...
  \`\`\`
  \`\`\`tsx
  // src/components/Counter.tsx
  export default function Counter() { ... }
  \`\`\`
Then reference that EXACT name when you emit a run command (\`python calculator.py\`, not a guessed name). The sandbox seeds files under these names, so the name in the comment and the name in your run command MUST match — otherwise the run fails with "file not found". Never let the app auto-derive a placeholder name; always state the filename yourself. When editing an existing file, reuse its existing path/name as the comment.`;
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
          mcp_tools: mcpNamespacedTools,
          reasoning_effort: reasoningMode,
          max_tokens: activeProfile?.maxTokens || settings.maxTokens || 0,
        }),
        signal: controller.signal,
      });

      if (!response.ok) {
        const errRawText = await response.text().catch(() => '');
        let errJson: any = {};
        try { errJson = JSON.parse(errRawText); } catch { errJson = {}; }
        throw new HttpProviderError(
          extractProviderErrorMessage(errJson, response.status, errRawText),
          response.status,
        );
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
      // Accumulates native OpenAI-style tool_calls streamed across deltas.
      // Index -> { id, name(nameSpaced), arguments(string, built up across deltas) }.
      const toolCallBuffers = new Map<number, { id: string; name: string; arguments: string }>();

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
              const fr = data.choices?.[0]?.finish_reason;
              if (fr) streamFinishReason = fr;
              accumulateToolCalls(toolCallBuffers, data.choices?.[0]?.delta?.tool_calls);
              const _u = captureUsage(data);
              if (_u) { usageInput = _u.input; usageOutput = _u.output; }
            } catch (pErr) {
              // Non-fatal SSE chunk parse
            }
          } else if (trimmed.startsWith('{') && trimmed.endsWith('}')) {
            try {
              const data = JSON.parse(trimmed);
              delta = data.choices?.[0]?.delta?.content || data.choices?.[0]?.delta?.text || data.choices?.[0]?.message?.content || data.choices?.[0]?.text || data.content || '';
              reasoningDelta = data.choices?.[0]?.delta?.reasoning_content || data.choices?.[0]?.delta?.reasoning || data.choices?.[0]?.delta?.thinking || '';
              const fr = data.choices?.[0]?.finish_reason;
              if (fr) streamFinishReason = fr;
              accumulateToolCalls(toolCallBuffers, data.choices?.[0]?.delta?.tool_calls || data.choices?.[0]?.message?.tool_calls);
              const _u = captureUsage(data);
              if (_u) { usageInput = _u.input; usageOutput = _u.output; }
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
            const fr = data.choices?.[0]?.finish_reason;
            if (fr) streamFinishReason = fr;
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

      // Determine whether the generation was genuinely truncated (hit the
      // token limit) vs. a clean completion. Only a "length" finish_reason
      // (or a missing finish_reason with no content) is a real cutoff.
      const wasTruncatedByLimit = streamFinishReason === 'length';

      // Accurate token count for this completed assistant response.
      //  - If the provider reported `usage` (prompt_tokens + completion_tokens),
      //    use those EXACT figures — this is the gold standard.
      //  - Otherwise estimate output tokens with the real BPE tokenizer, and
      //    estimate input tokens by counting the system prompt + conversation
      //    we actually sent. This gives a true total-spend number (input +
      //    output) instead of only counting output.
      const finalParsed0 = parseThinkingFromStream(rawAccumulatedStream);
      const outputTokens = usageOutput || await countTokens(
        (finalParsed0.content || assistantMessageContent || '').trim(),
      );
      // Input token estimate: count the full system prompt + every message we
      // sent in the request. (We can't count the model's internal reasoning
      // tokens, but this captures the bulk of input cost.)
      let inputTokens = usageInput;
      if (!inputTokens) {
        try {
          const promptText = (fullSystemPrompt || '') + '\n' +
            cleanApiMessages.map((mm: any) => `${mm.role}: ${mm.content || ''}`).join('\n');
          inputTokens = await countTokens(promptText);
        } catch {
          inputTokens = 0;
        }
      }
      const responseTokenCount = outputTokens; // kept for the per-response footer

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

          // Only treat an empty response body as a real problem when the stream
          // did NOT finish cleanly (finish_reason !== 'stop'). A clean "stop"
          // with reasoning but no body is a normal "model chose not to respond"
          // case, not a cutoff — so no Retry banner.
          const cleanStop = streamFinishReason === 'stop' || streamFinishReason === 'stop_sequence' || streamFinishReason === 'tool_calls';

          let displayFinalContent = finalContent;
          if (!displayFinalContent) {
            if (combinedThinking && !cleanStop) {
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
                    // isStopped = TRUE only on a genuine token-limit truncation
                    // (finish_reason "length"). A clean completion must NOT flag
                    // the message as cut off (that caused the false "continue/
                    // retry" banner on every normal response).
                    isStopped: wasTruncatedByLimit,
                    isError: false,
                    clarificationRequests: clarification ? clarification.requests : undefined,
                    clarificationAnswers: [],
                    modelUsed: chosenModelDisplayName,
                    generationDurationMs: Date.now() - requestStartTime,
                    tokensEstimate: responseTokenCount,
                    inputTokens,
                    outputTokens,
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

      // Capture for the post-completion sandbox agent follow-up.
      completedAssistantText = fullAssistantOutput;
      // Capture native tool_calls streamed this turn for the MCP follow-up.
      completedNativeToolCalls = Array.from(toolCallBuffers.values()).filter(
        (tc) => tc.name,
      );

      let targetProject = targetChat.projectId
        ? projects.find((p) => p.id === targetChat.projectId) || null
        : null;
      // effectiveAutoMode was resolved at the top of the try (also used for the
      // system prompt); reuse it here.
      completedAutoMode = effectiveAutoMode;

      // Capture the project's file state so the Restore button can roll back.
      // The snapshot records the files AFTER this turn's changes are applied
      // (post-change), so restoring to message N keeps everything that existed
      // at turn N and discards files created in *later* turns — the user's
      // intent: "only what was there at the step I clicked restore is kept."
      let didModifyProject = false;
      // postChangeFiles is filled in below after autopilot runs / the project
      // is created, then attached to the assistant message as the snapshot.
      let postChangeFiles: ProjectFile[] = [];
      let postChangeProjectId: string | null = targetProject?.id ?? null;

      if (targetProject) {
        const autoResult = WorkspaceAutopilot.execute(targetProject, fullAssistantOutput, effectiveAutoMode);
        if (autoResult.hasChanges) {
          didModifyProject = true;
          setProjects((prev) =>
            prev.map((p) => (p.id === targetProject!.id ? autoResult.updatedProject : p))
          );
        }
        // Snapshot = the project's files *after* this turn's changes (whether
        // applied by autopilot or left unchanged). Deep-copy so later turns
        // can't mutate the captured state.
        postChangeFiles = (didModifyProject ? autoResult.updatedProject.files : targetProject.files).map((f) => ({ ...f }));
        postChangeProjectId = targetProject.id;

        if (effectiveAutoMode === 'automatic_plus' || effectiveAutoMode === 'automatic') {
          setChats((prevChats) =>
            prevChats.map((c) => {
              if (c.id !== targetChat.id) return c;
              return {
                ...c,
                messages: c.messages.map((m) =>
                  m.id === assistantMsgId
                    ? {
                        ...m,
                        artifactsState: 'auto_applied',
                        artifacts: newArtifacts,
                        // Attach the post-change snapshot only when this turn
                        // actually changed the project, so the Restore button
                        // is meaningful (and hidden when nothing changed).
                        projectSnapshotBefore: didModifyProject
                          ? { projectId: postChangeProjectId, files: postChangeFiles }
                          : m.projectSnapshotBefore,
                      }
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
          didModifyProject = true;
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
          postChangeFiles = initialFiles.map((f) => ({ ...f }));
          postChangeProjectId = newProj.id;

          // Attach a post-change snapshot of the newly created project so
          // Restore keeps this turn's files and only drops later additions.
          setChats((prevChats) =>
            prevChats.map((c) => {
              if (c.id !== targetChat.id) return c;
              return {
                ...c,
                messages: c.messages.map((m) =>
                  m.id === assistantMsgId
                    ? {
                        ...m,
                        projectSnapshotBefore: { projectId: postChangeProjectId, files: postChangeFiles },
                      }
                    : m
                ),
              };
            })
          );
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
                      // Genuine user-initiated stop → show continue/retry so the
                      // user can resume. (Not a false positive.)
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
        // If the stream already produced a clean finish_reason (stop/length) and
        // real content, a trailing connection error (e.g. the socket closing
        // right after [DONE]) is NOT a generation failure — finalize the message
        // as completed instead of marking it errored/cut-off. This is the path
        // that produced the false "continue/retry" banner on normal responses
        // for providers whose connection tears down abruptly post-stream.
        const cleanStop = streamFinishReason === 'stop' || streamFinishReason === 'stop_sequence' || streamFinishReason === 'tool_calls';
        const parsedStream = parseThinkingFromStream(rawAccumulatedStream);
        const combinedThinking = (rawAccumulatedThinking + (parsedStream.thinking ? (rawAccumulatedThinking ? '\n' : '') + parsedStream.thinking : '')).trim();
        const existingPartialContent = (parsedStream.content || assistantMessageContent || '').trim();

        if (cleanStop && existingPartialContent) {
          // Treat as a successful completion (the model finished cleanly; the
          // error was just the transport closing).
          const completedOutputTokens = usageOutput || await countTokens(existingPartialContent);
          // usageInput was hoisted before the try, so it's accessible here. If
          // the provider didn't report usage we can't re-derive the prompt
          // tokens in this catch path (the try-scoped vars aren't visible), so
          // we leave input at 0 — the main try path computes it when present.
          const completedInputTokens = usageInput;
          setChats((prevChats) => {
            const updated = prevChats.map((c) => {
              if (c.id !== targetChat.id) return c;
              const updatedMsgs = c.messages.map((m) =>
                m.id === assistantMsgId
                  ? {
                      ...m,
                      content: existingPartialContent,
                      thinkingContent: combinedThinking || m.thinkingContent,
                      isThinking: false,
                      isStopped: false,
                      isError: false,
                      modelUsed: chosenModelDisplayName,
                      generationDurationMs: Date.now() - requestStartTime,
                      tokensEstimate: completedOutputTokens,
                      inputTokens: completedInputTokens,
                      outputTokens: completedOutputTokens,
                    }
                  : m
              );
              return { ...c, messages: updatedMsgs, updatedAt: Date.now() };
            });
            StorageService.saveChats(updated);
            return updated;
          });
        } else {
          // Classify the error. CRITICAL: a genuine quota/rate-limit error is
          // recognized ONLY from a real HTTP 429 status (carried on
          // HttpProviderError) — never from a loose substring match on an
          // arbitrary thrown transport error message. The old substring matcher
          // turned benign desktop-webview socket-close errors into false
          // "Your model provider reported a quota limit" banners on the 2nd/3rd
          // prompt. Transport errors with partial content are treated as a
          // stop (continue/retry), not a hard error.
          const httpStatus = isHttpProviderError(err) ? err.status : 0;

          const isApiKeyError =
            httpStatus === 401 ||
            err.message?.includes('No API') ||
            err.message?.includes('API key') ||
            err.message?.includes('API Key') ||
            err.message?.includes('configure an API') ||
            err.message?.includes('Unauthorized') ||
            err.message?.includes('Invalid Authentication');

          // Real 429, or an explicit provider quota payload (only from a real
          // HTTP response, not a transport error).
          const isQuotaError =
            httpStatus === 429 ||
            (isHttpProviderError(err) && (
              err.message?.includes('resource_exhausted') ||
              err.message?.includes('RESOURCE_EXHAUSTED') ||
              err.message?.includes('exceeded your current quota')
            ));

          // Provider-side 4xx (not 401/429): a REAL HTTP response with a real
          // error body — e.g. 400 "unknown parameter reasoning_effort", 404
          // "model not found", 403 forbidden. These are NOT quota errors and
          // NOT transport interruptions; they must surface the true cause so a
          // fresh API key + a wrong model name isn't misread as "quota". Show
          // the real HTTP status + provider message.
          const isProvider4xx =
            httpStatus >= 400 && httpStatus < 500 && httpStatus !== 401 && httpStatus !== 429;

          // The REAL provider error detail is always included verbatim in the
          // card — never swallowed — so the user sees the true cause (invalid
          // key, wrong model, exhausted quota) instead of a one-size-fits-all
          // banner they can't act on.
          const providerDetail = (err.message || '').trim();
          let errorContent = '';
          if (isApiKeyError) {
            errorContent = `⚠️ **API Key Problem** (HTTP ${httpStatus || 'auth'})\n\n${providerDetail ? `> *${providerDetail}*\n\n` : ''}The provider rejected the request as an authentication/key problem. Open **Settings (⚙️)** and check that the API key is correct, active, and has access to the configured model.`;
          } else if (isQuotaError) {
            errorContent = `⚠️ **API Rate Limit / Quota Exceeded** (HTTP ${httpStatus || 429})\n\nYour model provider reported a real quota/rate-limit error:\n\n> *${providerDetail || 'RESOURCE_EXHAUSTED'}*\n\n**Recommended Solutions:**\n- ⏳ **Wait 30–60 seconds** for the provider's rate-limit window to reset.\n- ⚙️ **Switch Model/Profile:** Open **Settings (⚙️)** to switch to a different model or provider.\n- 🔑 **Custom Key:** Check your usage quota and billing tier in your provider's developer console.`;
          } else if (isProvider4xx) {
            // Surface the REAL provider error with its HTTP status so the user
            // sees the actual cause (e.g. "400 model_not_found", "400 unknown
            // parameter reasoning_effort") instead of a misleading generic
            // banner. This is the common cause of "fresh key but it errors"
            // complaints — the key is fine; the model/param is wrong.
            errorContent = `⚠️ **Provider Error (HTTP ${httpStatus})**\n\n${err.message || 'The model provider rejected the request.'}\n\n**What to check:**\n- Verify the **Base URL** and **Model name** in Settings (⚙️) match your provider exactly (e.g. a typo'd model name returns 404).\n- If the message mentions an unknown parameter, it usually means your provider doesn't support that option (e.g. reasoning_effort) — try switching Reasoning Mode to **Off**.\n- A fresh API key does NOT cause this; it's a request-shape problem. Open Settings (⚙️) to adjust.`;
          } else if (existingPartialContent) {
            // Transport interruption with partial content: NOT a hard error.
            // Keep what the model produced and offer Continue/Retry. Do not
            // show a scary quota/connection banner — the response itself is
            // useful and the user can just continue.
            errorContent = '';
          } else {
            errorContent = `⚠️ **Connection Interrupted**\n\nThe response stream was interrupted before any content arrived. Click **Retry** to try again.\n\n\`${err.message || 'Network/stream error'}\``;
          }

          setChats((prevChats) => {
            const updated = prevChats.map((c) => {
              if (c.id !== targetChat.id) return c;
              const hasExisting = c.messages.some((m) => m.id === assistantMsgId);

              const updatedMsgs = hasExisting
                ? c.messages.map((m) =>
                    m.id === assistantMsgId
                      ? {
                          ...m,
                          content: existingPartialContent || errorContent,
                          thinkingContent: combinedThinking || m.thinkingContent,
                          isThinking: false,
                          // A transport error with partial content is an
                          // interruption (continue/retry) — NOT a hard error
                          // and NOT a fake quota banner. Only show isError when
                          // there is no content at all.
                          isError: !existingPartialContent && Boolean(errorContent),
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
                      isError: !existingPartialContent && Boolean(errorContent),
                      isStopped: Boolean(existingPartialContent),
                    },
                  ];
              return { ...c, messages: updatedMsgs, updatedAt: Date.now() };
            });
            StorageService.saveChats(updated);
            return updated;
          });
        }
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

    // 6.5. MCP tool-execution follow-up (AI → MCP server → AI). When the model
    // requested MCP tools this turn — either via native tool_calls (OpenAI
    // function calling) or via ```mcp_tool_call text blocks — the app actually
    // executes each call against the named MCP server (JSON-RPC tools/call) and
    // feeds the result text back as a follow-up user turn so the model can read
    // the data and continue. This is the real tool-execution bridge: the model's
    // tool calls are no longer just described in the prompt — they're run, and
    // the output is returned. Capped to avoid runaway loops.
    if (
      completedAssistantText &&
      mcpFollowupRef.current < MCP_MAX_TOOL_ROUNDS &&
      !isSandboxFollowup // sandbox follow-ups must not spawn MCP rounds (avoid cross-loops)
      // isMcpToolFollowup IS allowed to continue the MCP tool-calling loop so
      // the model can make multiple sequential tool calls across rounds.
    ) {
      // Build the list of tool calls requested this turn.
      // Native tool_calls: name is namespaced "serverName/toolName".
      const nativeCalls = completedNativeToolCalls
        .map((tc) => {
          const slash = tc.name.indexOf('/');
          if (slash < 0) return null;
          const serverName = tc.name.slice(0, slash);
          const toolName = tc.name.slice(slash + 1);
          let args: Record<string, unknown> = {};
          try {
            args = tc.arguments ? JSON.parse(tc.arguments) : {};
          } catch {
            args = { _raw: tc.arguments };
          }
          return { serverName, toolName, args, raw: tc.name };
        })
        .filter(Boolean) as Array<{ serverName: string; toolName: string; args: Record<string, unknown>; raw: string }>;

      // Text-based fallback: ```mcp_tool_call blocks.
      const textCalls = parseToolCallsFromText(completedAssistantText).map((p) => ({
        serverName: p.serverName,
        toolName: p.toolName,
        args: p.args,
        raw: p.raw,
      }));

      const allCalls = [...nativeCalls, ...textCalls];
      if (allCalls.length > 0) {
        mcpFollowupRef.current += 1;
        const round = mcpFollowupRef.current;
        const servers = (settings.mcpServers || []).filter((s) => s.enabled);
        const serverByName = new Map(servers.map((s) => [s.name, s]));
        const results: string[] = [];
        for (const call of allCalls) {
          const server = call.serverName ? serverByName.get(call.serverName) : servers[0];
          if (!server) {
            results.push(
              `🔧 MCP tool call "${call.raw}" → no enabled server named "${call.serverName}". Available: ${servers.map((s) => s.name).join(', ') || '(none)'}.`,
            );
            continue;
          }
          if (server.status !== 'online') {
            // Try to (re)probe before failing — it may just be stale status.
            const probed = await probeMcpServer(server);
            if (probed.status !== 'online') {
              results.push(`🔧 MCP tool call "${call.raw}" → server "${server.name}" is offline (${server.url}).`);
              continue;
            }
          }
          const res = await callMcpTool(server, call.toolName, call.args);
          const tag = res.isError ? '⚠️' : '✅';
          results.push(
            `${tag} MCP tool call "${call.raw}" → ${res.isError ? 'errored' : 'succeeded'}:\n${res.content}`,
          );
        }

        if (results.length > 0) {
          const combined = results.join('\n\n---\n\n');
          await handleSendMessage(
            `[MCP tool execution results — round ${round}]\n\n${combined}\n\nRead these results and continue the task. If you need more data, make additional MCP tool calls; otherwise, summarize the outcome for the user.`,
            false,
            undefined,
            completedChatId,
            false,
            true,
          );
        }
      }
    }

    // 7. Sandbox agent follow-up (AI → sandbox → AI). Only when the user has
    // granted sandbox access and the chat's automation mode is not "review".
    // The AI's completed response is scanned for runnable shell/CLI commands;
    // they run (auto-approve in Auto Planner, per-command approval in
    // Automatic) and the output is fed back as a tool message so the AI can
    // read it and continue. Runs stream into the shared sandbox log and keep
    // going even if the SandboxPanel is closed.
    if (
      completedAssistantText &&
      sandboxStore.available &&
      sandboxStore.accessGranted &&
      completedAutoMode !== 'review' &&
      sandboxFollowupRef.current < SANDBOX_MAX_FOLLOWUPS &&
      !isSandboxFollowup // only kick the loop from a real assistant turn
    ) {
      const commands = extractRunnableCommands(completedAssistantText);
      if (commands.length > 0) {
        sandboxFollowupRef.current += 1;
        const round = sandboxFollowupRef.current;
        sandboxStore.pushLog('status', `[agent] Sandbox follow-up round ${round}: ${commands.length} command(s) proposed by AI.`, 'agent');
        const followChat = chats.find((c) => c.id === completedChatId);
        const proj = followChat?.projectId ? projects.find((p) => p.id === followChat.projectId) || null : null;
        // Seed ALL code artifacts from the AI's latest response into the run
        // workdir by their REAL title (the same filename the artifact parser
        // / file viewer / files-list uses), so `python <file>.py`, `node
        // <file>.js`, and multi-file imports all resolve by name. This fixes
        // the inconsistency where the app named a file "python_1.py" but the
        // AI referenced "calculator.py" — now every artifact the AI produced
        // this turn is written under its real title, and the AI is told (via
        // the system prompt) to name files explicitly so they match.
        const seedFiles = (() => {
          if (!followChat) return undefined;
          const byPath = new Map<string, { path: string; content: string }>();
          // Walk from the most recent assistant turn backwards; collect every
          // code artifact (dedup by path). This catches the file the AI just
          // wrote plus any companions from earlier turns in the same chat.
          for (let i = followChat.messages.length - 1; i >= 0; i--) {
            const m = followChat.messages[i];
            if (m.role !== 'assistant' || !m.content) continue;
            const arts = ArtifactParser.extractArtifacts(m.content);
            for (const a of arts) {
              // a.title is the real filename the parser derived (e.g.
              // "calculator.py"); it's what the file viewer & sandbox should
              // both reference. Skip markdown/empty.
              if (!a.title || !a.code) continue;
              const p = a.title.startsWith('/') ? a.title.slice(1) : a.title;
              if (!byPath.has(p)) byPath.set(p, { path: p, content: a.code });
            }
          }
          return byPath.size > 0 ? Array.from(byPath.values()) : undefined;
        })();
        try {
          const result = await runSandboxAgentStep(commands, {
            mode: completedAutoMode,
            store: sandboxStore,
            project: proj,
            chatId: completedChatId,
            seedFiles,
          });
          if (result.ranAny && result.outputText) {
            // Feed the tool output back to the AI as a follow-up turn. This
            // reuses the entire streaming path (no duplication) and surfaces a
            // transparent "[Sandbox results]" user bubble showing what the AI
            // received.
            await handleSendMessage(
              `[Sandbox execution results — round ${round}]\n\n${result.outputText}\n\nContinue the task using these results. If more commands are needed, emit them in bash/sh blocks. If the task is complete, summarize the outcome.`,
              false,
              undefined,
              completedChatId,
              true
            );
          }
        } catch (e) {
          sandboxStore.pushLog('error', `[agent] Sandbox follow-up failed: ${e instanceof Error ? e.message : String(e)}`, 'agent');
        }
      }
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
          onRestore={handleRestore}
          sandboxStore={sandboxStore}
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
        currentProject={currentChatProject}
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
        gistToken={settings.gistToken}
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
          gistToken={settings.gistToken}
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
  onSaveSettings={(newSettings) => {
    setSettings(newSettings);
    try {
      StorageService.saveSettings(newSettings);
    } catch (e) {
      console.error('Failed to persist settings from App', e);
    }
  }}
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
