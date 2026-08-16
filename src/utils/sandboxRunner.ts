// Feature 3: in-app sandbox command runner (frontend bindings).
//
// These wrap the Tauri Rust commands in src-tauri/src/sandbox.rs. When the app
// runs as a desktop (Tauri) build, `@tauri-apps/api` is available and the calls
// go to the restricted Rust runner. When running as a plain web dev server
// (no Tauri), we detect that and reject gracefully so the UI can explain that
// the sandbox only works inside the desktop app.

import { invoke } from '@tauri-apps/api/core';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';

export interface SandboxStreamLine {
  runId: string;
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

export interface RunCommandOptions {
  workdir?: string;
  command: string;
  args?: string[];
}

/** True when we're inside the Tauri desktop shell (commands available). */
export function isSandboxAvailable(): boolean {
  return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
}

/**
 * Run one allowlisted command in the scoped sandbox and stream its output.
 *
 * @param options command + args + optional relative workdir
 * @param onLine  called for every stdout/stderr/status/error line, live
 * @returns the process exit code (0 = success)
 */
export async function runSandboxCommand(
  options: RunCommandOptions,
  onLine: (line: SandboxStreamLine) => void,
): Promise<number> {
  if (!isSandboxAvailable()) {
    const msg =
      'The sandbox command runner is only available inside the SAW AI desktop app. Run `npm run tauri dev` (or the installed build) to use it.';
    onLine({ runId: '', stream: 'error', line: msg });
    throw new Error(msg);
  }
  // Subscribe to the stream before invoking so we never miss the first lines.
  let unlisten: UnlistenFn | undefined;
  let currentRunId = '';
  try {
    unlisten = await listen<SandboxStreamLine>('sandbox://stream', (e) => {
      if (currentRunId && e.payload.runId && e.payload.runId !== currentRunId) return;
      if (e.payload.runId && !currentRunId) currentRunId = e.payload.runId;
      onLine(e.payload);
    });
    const code = await invoke<number>('run_sandbox_command', {
      request: {
        workdir: options.workdir ?? '',
        command: options.command,
        args: options.args ?? [],
      },
    });
    return code;
  } finally {
    unlisten?.();
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
 * real build toolchain can build them. Returns the number of files written.
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

/** Allowed command basenames (kept in sync with ALLOWED_COMMANDS in Rust). */
export const ALLOWED_SANDBOX_COMMANDS = [
  'npm', 'npx', 'node', 'yarn', 'pnpm',
  'dart', 'flutter', 'pub',
  'cargo', 'rustc', 'tauri',
  'git',
  'python', 'python3', 'pip', 'pip3',
  'make', 'gradle', 'gradlew',
] as const;

/**
 * Parse a free-form command string like `npm run tauri build` into the
 * { command, args } shape the Rust runner expects. Throws if the leading
 * token isn't allowlisted (the Rust side also enforces this, but failing
 * early gives a friendlier error and avoids a needless IPC round-trip).
 */
export function parseSandboxCommand(input: string): RunCommandOptions {
  const trimmed = input.trim();
  if (!trimmed) throw new Error('Command is empty.');
  const parts = trimmed.split(/\s+/);
  const command = parts[0];
  if (!ALLOWED_SANDBOX_COMMANDS.includes(command as (typeof ALLOWED_SANDBOX_COMMANDS)[number])) {
    throw new Error(
      `"${command}" is not allowed in the sandbox. Allowed: ${ALLOWED_SANDBOX_COMMANDS.join(', ')}.`,
    );
  }
  return { command, args: parts.slice(1) };
}
