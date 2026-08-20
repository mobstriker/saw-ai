// Feature 3: in-app sandbox command runner (frontend bindings).
//
// These wrap the Tauri Rust commands in src-tauri/src/sandbox.rs. When the app
// runs as a desktop (Tauri) build, `@tauri-apps/api` is available and the calls
// go to the jailed persistent-shell runner (a real interactive CLI per chat/tab,
// scoped to an app-owned folder with NO access to the PC's file explorer). When
// running as a plain web dev server (no Tauri), we detect that and route Python
// to the in-browser Pyodide runner (which works everywhere); other toolchains
// (npm/node/dart/flutter/...) are unavailable in the web build and the UI says
// so plainly.

import { invoke } from '@tauri-apps/api/core';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';

export interface SandboxStreamLine {
  runId: string;
  sessionId: string;
  stream: 'stdout' | 'stderr' | 'status' | 'error';
  line: string;
}

export interface SandboxArtifact {
  relPath: string;
  absPath: string;
  size: number;
  kind: 'exe' | 'msi' | 'apk' | 'aab' | 'zip' | 'ipa' | 'app' | 'dir' | 'file';
}

export interface SandboxArtifactList {
  artifacts: SandboxArtifact[];
}

export interface RunSessionOptions {
  /** Stable session id (chat/tab id) so the shell persists across commands. */
  sessionId: string;
  /** Relative path inside the sandbox root (e.g. "proj-<id>"). Empty = root. */
  workdir?: string;
  /** The FULL command line — `python main.py`, `npm run dev`, `cd src && ls`,
   *  pipes/redirects and quoted args all work because the backend is a real
   *  shell. We do NOT split on whitespace here. */
  commandLine: string;
}

/** Legacy single-command shape (kept for callers that still build one). */
export interface RunCommandOptions {
  workdir?: string;
  command: string;
  args?: string[];
  /** When true, `command` is treated as a full raw command line (incl. pipes,
   *  `&&`, `cd`, quoted args) and passed straight to the jailed shell without
   *  re-joining or allowlist-checking the leading token. Used by the manual
   *  panel for shell builtins like `cd src && ls`. */
  rawCommandLine?: boolean;
}

/** True when we're inside the Tauri desktop shell (commands available). */
export function isSandboxAvailable(): boolean {
  return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
}

/**
 * Run a command line in the jailed persistent shell for a session, streaming
 * its output. The shell is created lazily for the sessionId and reused, so
 * `cd`, env exports, and history carry over — exactly like a terminal.
 *
 * @returns the command's exit code (0 = success; 127/timeout for server-like
 *          commands that don't return — output keeps streaming in the meantime)
 */
export async function runSandboxSession(
  options: RunSessionOptions,
  onLine: (line: SandboxStreamLine) => void,
): Promise<number> {
  if (!isSandboxAvailable()) {
    const msg =
      'The sandbox command runner is only available inside the SAW AI desktop app. Run `npm run tauri dev` (or the installed build) to use it. In the web build, only Python (Pyodide) runs.';
    onLine({ runId: '', sessionId: options.sessionId, stream: 'error', line: msg });
    throw new Error(msg);
  }
  // Subscribe to the stream before invoking so we never miss the first lines.
  // We filter to THIS session (and drop the internal sentinel markers the Rust
  // side never emits anyway).
  let unlisten: UnlistenFn | undefined;
  try {
    unlisten = await listen<SandboxStreamLine>('sandbox://stream', (e) => {
      if (e.payload.sessionId && e.payload.sessionId !== options.sessionId) return;
      onLine(e.payload);
    });
    const code = await invoke<number>('run_sandbox_command', {
      request: {
        sessionId: options.sessionId,
        workdir: options.workdir ?? '',
        commandLine: options.commandLine,
      },
    });
    return code;
  } finally {
    unlisten?.();
  }
}

/** Close (drop) a session's shell so the next run spawns fresh. */
export async function closeSandboxSession(sessionId: string): Promise<void> {
  if (!isSandboxAvailable()) return;
  try {
    await invoke('close_sandbox_session', { sessionId });
  } catch {
    // best-effort
  }
}

/** List build artifacts (exe/apk/zip/dist/...) produced under a workdir. */
export async function listSandboxArtifacts(workdir?: string): Promise<SandboxArtifact[]> {
  if (!isSandboxAvailable()) return [];
  const result = await invoke<SandboxArtifactList>('list_sandbox_artifacts', {
    workdir: workdir ?? '',
  });
  return result.artifacts;
}

/**
 * Write a set of in-memory files (path -> content) into a sandbox workdir so a
 * real build toolchain can build them, AND so `python <file>.py` finds the file
 * the AI created. Returns the number of files written.
 */
export async function writeSandboxFiles(
  workdir: string,
  files: { path: string; content: string }[],
): Promise<number> {
  if (!isSandboxAvailable()) {
    throw new Error(
      'Writing sandbox files is only available inside the SAW AI desktop app.',
    );
  }
  return invoke<number>('write_sandbox_files', {
    workdir,
    files: files.map((f) => [f.path, f.content]),
  });
}

/** Toolchain binaries discoverable on the sandbox's restricted PATH. This is
 *  informational only — the backend enforces the real allowlist via PATH; the
 *  shell itself can run builtins (cd, pipes, &&, redirects) freely. */
export const ALLOWED_SANDBOX_COMMANDS = [
  'npm', 'npx', 'node', 'yarn', 'pnpm',
  'dart', 'flutter', 'pub',
  'cargo', 'rustc', 'tauri',
  'git',
  'python', 'python3', 'pip', 'pip3',
  'make', 'gradle', 'gradlew',
] as const;

/**
 * Build a full command line from a {command, args} shape (used by the legacy
 * agent path that extracts individual commands). Joins args with spaces —
 * callers that need quoting should pass commandLine directly instead.
 */
export function buildCommandLine(command: string, args?: string[]): string {
  const parts = [command, ...(args ?? [])];
  return parts
    .map((p) => {
      // Quote args that contain spaces or shell metacharacters so they survive
      // the real shell. Single quotes disable interpretation in sh/cmd safely
      // enough for file paths and args with spaces.
      if (/[\s'"&|<>$`]/.test(p)) {
        return `'${p.replace(/'/g, "'\\''")}'`;
      }
      return p;
    })
    .join(' ');
}

/**
 * Parse a free-form command string like `python main.py` into the legacy
 * { command, args } shape. NOTE: the backend now takes a full command line and
 * runs it through a real shell, so quoting/pipes/`&&` survive — this helper is
 * only kept for the agent-extraction path that classifies the leading token.
 */
export function parseSandboxCommand(input: string): RunCommandOptions {
  const trimmed = input.trim();
  if (!trimmed) throw new Error('Command is empty.');
  const parts = trimmed.split(/\s+/);
  const command = parts[0];
  if (!ALLOWED_SANDBOX_COMMANDS.includes(command as (typeof ALLOWED_SANDBOX_COMMANDS)[number])) {
    throw new Error(
      `"${command}" is not on the sandbox toolchain. Available: ${ALLOWED_SANDBOX_COMMANDS.join(', ')}. (The shell itself can still run cd, pipes, &&, and redirects.)`,
    );
  }
  return { command, args: parts.slice(1) };
}
