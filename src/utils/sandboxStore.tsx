import { useCallback, useRef, useState } from 'react';
import {
  runSandboxCommand,
  writeSandboxFiles,
  listSandboxArtifacts,
  parseSandboxCommand,
  isSandboxAvailable,
  type SandboxStreamLine,
  type SandboxArtifact,
  type RunCommandOptions,
} from './sandboxRunner';
import type { Project } from '../types';

export interface SandboxLogLine {
  id: number;
  stream: SandboxStreamLine['stream'];
  text: string;
  // 'agent' marks lines emitted by the AI-driven agent loop so the panel can
  // style them distinctly from manual runs.
  source?: 'manual' | 'agent';
}

export interface SandboxStoreValue {
  available: boolean;
  running: boolean;
  logs: SandboxLogLine[];
  exitCode: number | null;
  artifacts: SandboxArtifact[];
  accessGranted: boolean;
  pendingApproval: { command: string; resolve: (ok: boolean) => void } | null;

  toggleAccess: () => void;
  setAccessGranted: (v: boolean) => void;
  clear: () => void;
  pushLog: (stream: SandboxLogLine['stream'], text: string, source?: 'manual' | 'agent') => void;

  /** Seed a project's files into the sandbox workdir. */
  seedProject: (project: Project | null) => Promise<void>;
  /** Run a parsed command, streaming into the shared log. */
  runCommand: (opts: RunCommandOptions, source?: 'manual' | 'agent') => Promise<number>;
  refreshArtifacts: (workdir?: string) => Promise<void>;
  /** Ask the user to approve a command (automatic mode). Resolves on decision. */
  requestApproval: (command: string) => Promise<boolean>;
  resolveApproval: (ok: boolean) => void;
}

/**
 * Shared sandbox store as a hook (used at the App level so background runs
 * survive closing the SandboxPanel — App stays mounted). The returned value
 * is passed down to the panel and the AI-driven agent loop.
 */
export function useSandboxStore(): SandboxStoreValue {
  const available = isSandboxAvailable();
  const [running, setRunning] = useState(false);
  const [logs, setLogs] = useState<SandboxLogLine[]>([]);
  const [exitCode, setExitCode] = useState<number | null>(null);
  const [artifacts, setArtifacts] = useState<SandboxArtifact[]>([]);
  const [accessGranted, setAccessGranted] = useState(false);
  const [pendingApproval, setPendingApproval] = useState<SandboxStoreValue['pendingApproval']>(null);

  const logIdRef = useRef(0);

  const pushLog = useCallback(
    (stream: SandboxLogLine['stream'], text: string, source: 'manual' | 'agent' = 'manual') => {
      setLogs((prev) => [...prev, { id: ++logIdRef.current, stream, text, source }]);
    },
    []
  );

  const clear = useCallback(() => {
    setLogs([]);
    setExitCode(null);
    setArtifacts([]);
  }, []);

  const seedProject = useCallback(
    async (project: Project | null) => {
      if (!available || !project || project.files.length === 0) return;
      const workdir = `proj-${project.id}`;
      pushLog('status', `Seeding ${project.files.length} project file(s) into the sandbox…`, 'agent');
      const files = project.files.map((f) => ({
        path: f.path.startsWith('/') ? f.path.slice(1) : f.path,
        content: f.content,
      }));
      const written = await writeSandboxFiles(workdir, files);
      pushLog('status', `Seeded ${written} file(s).`, 'agent');
    },
    [available, pushLog]
  );

  const runCommand = useCallback(
    async (opts: RunCommandOptions, source: 'manual' | 'agent' = 'manual'): Promise<number> => {
      setRunning(true);
      setExitCode(null);
      try {
        pushLog('status', `$ ${opts.command} ${(opts.args ?? []).join(' ')}`, source);
        const code = await runSandboxCommand(opts, (line: SandboxStreamLine) => {
          setLogs((prev) => [...prev, { id: ++logIdRef.current, stream: line.stream, text: line.line, source }]);
        });
        setExitCode(code);
        pushLog('status', code === 0 ? '✓ Completed successfully.' : `✗ Exited with code ${code}.`, source);
        return code;
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        pushLog('error', msg, source);
        setExitCode(-1);
        return -1;
      } finally {
        setRunning(false);
      }
    },
    [pushLog]
  );

  const refreshArtifacts = useCallback(
    async (workdir?: string) => {
      if (!available) return;
      const found = await listSandboxArtifacts(workdir);
      setArtifacts(found);
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
    running,
    logs,
    exitCode,
    artifacts,
    accessGranted,
    pendingApproval,
    toggleAccess: () => setAccessGranted((v) => !v),
    setAccessGranted,
    clear,
    pushLog,
    seedProject,
    runCommand,
    refreshArtifacts,
    requestApproval,
    resolveApproval,
  };
}

export { parseSandboxCommand };

