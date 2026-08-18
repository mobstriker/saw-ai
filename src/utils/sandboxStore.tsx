import { useCallback, useRef, useState } from 'react';
import {
  runSandboxSession,
  writeSandboxFiles,
  listSandboxArtifacts,
  parseSandboxCommand,
  buildCommandLine,
  isSandboxAvailable,
  type SandboxStreamLine,
  type SandboxArtifact,
  type RunCommandOptions,
} from './sandboxRunner';
import {
  runPython,
  isPythonRunnerAvailable,
  type PyodideRunFile,
  type PyodideStreamLine,
} from './pyodideRunner';
import type { Project, ProjectFile } from '../types';

export interface SandboxLogLine {
  id: number;
  stream: SandboxStreamLine['stream'];
  text: string;
  // 'agent' marks lines emitted by the AI-driven agent loop so the panel can
  // style them distinctly from manual runs.
  source?: 'manual' | 'agent';
}

/** A single CLI "page" (tab) in a chat's sandbox — its own log + run state. */
export interface SandboxTab {
  id: string;
  name: string;
  logs: SandboxLogLine[];
  running: boolean;
  exitCode: number | null;
}

/** Per-chat sandbox state: independent tabs + a shared artifact list. */
export interface ChatSandboxState {
  tabs: SandboxTab[];
  activeTabId: string;
  artifacts: SandboxArtifact[];
}

export interface SandboxStoreValue {
  available: boolean;
  /** True when in-browser Python (Pyodide) can run — independent of Tauri. */
  pythonAvailable: boolean;
  /** The per-chat sandbox states keyed by chatId. */
  states: Record<string, ChatSandboxState>;
  accessGranted: boolean;
  pendingApproval: { command: string; resolve: (ok: boolean) => void } | null;

  toggleAccess: () => void;
  setAccessGranted: (v: boolean) => void;
  pushLog: (stream: SandboxLogLine['stream'], text: string, source?: 'manual' | 'agent') => void;

  /** Get (or lazily create) the sandbox state for a chat. */
  getChatState: (chatId: string) => ChatSandboxState;
  /** Ensure a fresh default tab exists for a chat. */
  ensureChat: (chatId: string) => void;
  /** Add a new CLI page (tab) to a chat; returns the new tab id. */
  addTab: (chatId: string) => string;
  /** Delete a tab by id; keeps at least one. */
  closeTab: (chatId: string, tabId: string) => void;
  /** Switch the active tab. */
  setActiveTab: (chatId: string, tabId: string) => void;
  /** Clear a chat's sandbox logs/artifacts. */
  clearChat: (chatId: string) => void;

  /** Seed a project's files into the sandbox workdir (desktop) / Pyodide FS. */
  seedProject: (project: Project | null) => Promise<void>;
  /** Seed an arbitrary file set into a sandbox workdir (desktop). Used by the
   *  SandboxPanel to write ALL chat artifacts so any file is runnable by name. */
  seedFiles: (workdir: string, files: { path: string; content: string }[]) => Promise<void>;
  /** Run a parsed command in a chat's active tab. Routes Python to Pyodide. */
  runCommand: (opts: RunCommandOptions, source?: 'manual' | 'agent', chatId?: string, seedFiles?: { path: string; content: string }[]) => Promise<number>;
  refreshArtifacts: (workdir?: string) => Promise<void>;
  /** Ask the user to approve a command (automatic mode). Resolves on decision. */
  requestApproval: (command: string) => Promise<boolean>;
  resolveApproval: (ok: boolean) => void;
}

let tabIdCounter = 0;
function newTab(name?: string): SandboxTab {
  tabIdCounter += 1;
  return {
    id: `tab-${Date.now()}-${tabIdCounter}`,
    name: name || `Page ${tabIdCounter}`,
    logs: [],
    running: false,
    exitCode: null,
  };
}

/**
 * Per-chat, multi-tab sandbox store. Each chat gets an isolated sandbox
 * (independent CLI pages you can create/delete). Python executes for real via
 * Pyodide in the browser (free/keyless); other allowlisted commands run via
 * the Tauri Rust runner in the desktop build.
 */
export function useSandboxStore(): SandboxStoreValue {
  const available = isSandboxAvailable();
  const pythonAvailable = isPythonRunnerAvailable();
  const [states, setStates] = useState<Record<string, ChatSandboxState>>({});
  const [accessGranted, setAccessGranted] = useState(false);
  const [pendingApproval, setPendingApproval] = useState<SandboxStoreValue['pendingApproval']>(null);

  const logIdRef = useRef(0);

  const pushLog = useCallback(
    (stream: SandboxLogLine['stream'], text: string, source: 'manual' | 'agent' = 'manual') => {
      // Legacy global push — append to the most-recently-active chat's active tab.
      setStates((prev) => {
        const entries = Object.entries(prev) as [string, ChatSandboxState][];
        if (entries.length === 0) return prev;
        const [chatId, st] = entries[entries.length - 1];
        const tab = st.tabs.find((t) => t.id === st.activeTabId) || st.tabs[0];
        if (!tab) return prev;
        const updatedTab = { ...tab, logs: [...tab.logs, { id: ++logIdRef.current, stream, text, source }] };
        return {
          ...prev,
          [chatId]: { ...st, tabs: st.tabs.map((t) => (t.id === tab.id ? updatedTab : t)) },
        };
      });
    },
    []
  );

  const getChatState = useCallback((chatId: string): ChatSandboxState => {
    let created = false;
    setStates((prev) => {
      if (prev[chatId]) return prev;
      created = true;
      const tab = newTab();
      return { ...prev, [chatId]: { tabs: [tab], activeTabId: tab.id, artifacts: [] } };
    });
    // After creation the state is set asynchronously; return a best-effort
    // snapshot. Callers that need the live value read it from the hook's
    // `states` (which re-renders). This helper is mainly used to ensure a chat
    // has a sandbox entry.
    return states[chatId] || (() => {
      const tab = newTab();
      return { tabs: [tab], activeTabId: tab.id, artifacts: [] };
    })();
  }, [states]);

  const ensureChat = useCallback((chatId: string) => {
    setStates((prev) => {
      if (prev[chatId]) return prev;
      const tab = newTab();
      return { ...prev, [chatId]: { tabs: [tab], activeTabId: tab.id, artifacts: [] } };
    });
  }, []);

  const addTab = useCallback((chatId: string): string => {
    const tab = newTab();
    setStates((prev) => {
      const st = prev[chatId] || { tabs: [newTab()], activeTabId: '', artifacts: [] };
      return { ...prev, [chatId]: { ...st, tabs: [...st.tabs, tab], activeTabId: tab.id } };
    });
    return tab.id;
  }, []);

  const closeTab = useCallback((chatId: string, tabId: string) => {
    setStates((prev) => {
      const st = prev[chatId];
      if (!st) return prev;
      if (st.tabs.length <= 1) {
        // Keep one tab but clear it instead of removing the last page.
        const cleared = { ...st.tabs[0], logs: [], running: false, exitCode: null };
        return { ...prev, [chatId]: { ...st, tabs: [cleared], activeTabId: cleared.id } };
      }
      const tabs = st.tabs.filter((t) => t.id !== tabId);
      const activeTabId = st.activeTabId === tabId ? tabs[tabs.length - 1].id : st.activeTabId;
      return { ...prev, [chatId]: { ...st, tabs, activeTabId } };
    });
  }, []);

  const setActiveTab = useCallback((chatId: string, tabId: string) => {
    setStates((prev) => {
      const st = prev[chatId];
      if (!st) return prev;
      return { ...prev, [chatId]: { ...st, activeTabId: tabId } };
    });
  }, []);

  const clearChat = useCallback((chatId: string) => {
    setStates((prev) => {
      const st = prev[chatId];
      if (!st) return prev;
      const tab = newTab();
      return { ...prev, [chatId]: { tabs: [tab], activeTabId: tab.id, artifacts: [] } };
    });
  }, []);

  // Helper to push a line into a specific chat's active tab.
  const pushChatLog = useCallback(
    (chatId: string, stream: SandboxLogLine['stream'], text: string, source: 'manual' | 'agent' = 'manual') => {
      setStates((prev) => {
        const st = prev[chatId];
        if (!st) return prev;
        const tab = st.tabs.find((t) => t.id === st.activeTabId) || st.tabs[0];
        if (!tab) return prev;
        const updatedTab = { ...tab, logs: [...tab.logs, { id: ++logIdRef.current, stream, text, source }] };
        return { ...prev, [chatId]: { ...st, tabs: st.tabs.map((t) => (t.id === tab.id ? updatedTab : t)) } };
      });
    },
    []
  );

  const setTabRunning = useCallback((chatId: string, running: boolean, exitCode: number | null) => {
    setStates((prev) => {
      const st = prev[chatId];
      if (!st) return prev;
      const tab = st.tabs.find((t) => t.id === st.activeTabId) || st.tabs[0];
      if (!tab) return prev;
      const updatedTab = { ...tab, running, ...(exitCode === null ? {} : { exitCode }) };
      return { ...prev, [chatId]: { ...st, tabs: st.tabs.map((t) => (t.id === tab.id ? updatedTab : t)) } };
    });
  }, []);

  const seedFiles = useCallback(
    async (workdir: string, files: { path: string; content: string }[]) => {
      if (!available || files.length === 0) return;
      await writeSandboxFiles(workdir, files);
    },
    [available]
  );

  const seedProject = useCallback(
    async (project: Project | null) => {
      if (!available || !project || project.files.length === 0) return;
      const workdir = `proj-${project.id}`;
      const files = project.files.map((f) => ({
        path: f.path.startsWith('/') ? f.path.slice(1) : f.path,
        content: f.content,
      }));
      await writeSandboxFiles(workdir, files);
    },
    [available]
  );

  const runCommand = useCallback(
    async (
      opts: RunCommandOptions,
      source: 'manual' | 'agent' = 'manual',
      chatId?: string,
      seedFiles?: { path: string; content: string }[],
    ): Promise<number> => {
      // Resolve the target chat: explicit > any existing chat state.
      const cid = chatId || Object.keys(states)[0] || '';
      if (!cid) {
        // No chat context — fall back to the legacy global pushLog path.
        pushLog('error', 'No active chat for sandbox command.');
        return -1;
      }
      ensureChat(cid);

      const isPython = opts.command === 'python' || opts.command === 'python3';

      // --- Real in-browser Python via Pyodide (works in web + desktop) ---
      // Only used when the desktop (Tauri) runner is NOT available — i.e. the
      // web build. In the desktop build, Python runs through the same jailed
      // shell as everything else so imports of sibling files the AI created
      // resolve against the real workdir (written via write_sandbox_files).
      if (isPython && pythonAvailable && !available) {
        setTabRunning(cid, true, null);
        pushChatLog(cid, 'status', `$ ${opts.command} ${(opts.args ?? []).join(' ')}`, source);

        // Determine the entry file: the first .py arg, or run inline.
        const args = opts.args ?? [];
        const pyArg = args.find((a) => a.endsWith('.py'));
        const files: PyodideRunFile[] = (seedFiles || []).map((f) => ({ path: f.path, content: f.content }));

        try {
          const result = await runPython(files, pyArg || null, (line: PyodideStreamLine) => {
            pushChatLog(cid, line.stream === 'status' ? 'status' : line.stream, line.line, source);
          });
          pushChatLog(cid, 'status', result.exitCode === 0 ? '✓ Completed successfully.' : `✗ Exited with code ${result.exitCode}.`, source);
          setTabRunning(cid, false, result.exitCode);
          return result.exitCode;
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e);
          pushChatLog(cid, 'error', msg, source);
          setTabRunning(cid, false, -1);
          return -1;
        }
      }

      // --- Desktop (Tauri) jailed persistent shell: real CLI for everything ---
      if (!available) {
        const msg = isPython
          ? 'Python runner (Pyodide) failed to load. Reload the app and try again.'
          : `The command "${opts.command}" runs inside the SAW AI desktop app (Tauri). In the web build, only Python (Pyodide) runs — run "npm run tauri dev" or the built app for the full CLI.`;
        pushChatLog(cid, 'error', msg, source);
        setTabRunning(cid, false, -1);
        return -1;
      }

      setTabRunning(cid, true, null);
      try {
        const workdir = opts.workdir ?? '';
        // Build the full command line. If the caller set rawCommandLine, `command`
        // is already a complete line (cd, &&, pipes, quoted args) — pass it as-is.
        const commandLine = opts.rawCommandLine
          ? opts.command
          : buildCommandLine(opts.command, opts.args);
        pushChatLog(cid, 'status', `$ ${commandLine}`, source);
        const code = await runSandboxSession(
          { sessionId: cid, workdir, commandLine },
          (line: SandboxStreamLine) => {
            pushChatLog(cid, line.stream, line.line, source);
          },
        );
        setTabRunning(cid, false, code);
        pushChatLog(cid, 'status', code === 0 ? '✓ Completed successfully.' : `✗ Exited with code ${code}.`, source);
        return code;
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        pushChatLog(cid, 'error', msg, source);
        setTabRunning(cid, false, -1);
        return -1;
      }
    },
    [available, pythonAvailable, states, ensureChat, pushChatLog, setTabRunning, pushLog]
  );

  const refreshArtifacts = useCallback(
    async (workdir?: string) => {
      if (!available) return;
      const found = await listSandboxArtifacts(workdir);
      // Attach to the most-recent chat (artifacts are a desktop-build concept).
      setStates((prev) => {
        const entries = Object.entries(prev) as [string, ChatSandboxState][];
        if (entries.length === 0) return prev;
        const [chatId, st] = entries[entries.length - 1];
        return { ...prev, [chatId]: { ...st, artifacts: found } };
      });
      if (found.length > 0) pushLog('status', `Found ${found.length} build artifact(s) ready for download.`, 'agent');
    },
    [available, pushLog]
  );

  const requestApproval = useCallback(
    (command: string): Promise<boolean> =>
      new Promise<boolean>((resolve) => {
        setPendingApproval({ command, resolve });
      }),
    []
  );

  const resolveApproval = useCallback(
    (ok: boolean) => {
      setPendingApproval((prev) => {
        prev?.resolve(ok);
        return null;
      });
    },
    []
  );

  return {
    available,
    pythonAvailable,
    states,
    accessGranted,
    pendingApproval,
    toggleAccess: () => setAccessGranted((v) => !v),
    setAccessGranted,
    clearChat,
    pushLog,
    getChatState,
    ensureChat,
    addTab,
    closeTab,
    setActiveTab,
    seedProject,
    seedFiles,
    runCommand,
    refreshArtifacts,
    requestApproval,
    resolveApproval,
  };
}

export { parseSandboxCommand };
