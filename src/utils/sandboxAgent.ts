// AI-driven sandbox execution loop (Feature: "Give Access" + automation modes).
//
// When the user grants the AI sandbox access and the chat's automation mode is
// not "review", the assistant's response is scanned for runnable shell/CLI
// commands. In `automatic_plus` they run immediately; in `automatic` each
// command is presented for user approval before running. The combined
// stdout/stderr/exit-code is returned as a single tool-result text block that
// is fed back into the conversation so the AI can read its own output and
// continue. Runs happen against the same restricted, allowlisted Tauri runner
// as manual commands, so the AI can do no more than the user could by hand.

import { isShellLanguage, SHELL_LANGS } from './artifactParser';
import {
  parseSandboxCommand,
  type RunCommandOptions,
  ALLOWED_SANDBOX_COMMANDS,
} from './sandboxRunner';
import type { Project } from '../types';
import type { SandboxStoreValue } from './sandboxStore';

export interface RunnableCommand {
  raw: string; // the exact command string the AI emitted
  command: string;
  args: string[];
}

/**
 * Extract runnable sandbox commands from an assistant message. We look at:
 *   1. fenced shell/CLI code blocks (```bash / ```sh / ```powershell / ...)
 *   2. explicit <sandbox_run>cmd</sandbox_run> tags
 * Only the leading allowlisted command in each block is kept; blocks whose
 * first token isn't allowlisted are skipped (the AI is told which commands are
 * allowed via the system prompt, so this is a safety backstop, not the only
 * gate — the Rust runner enforces the same allowlist).
 */
export function extractRunnableCommands(text: string): RunnableCommand[] {
  const out: RunnableCommand[] = [];
  const seen = new Set<string>();

  const add = (cmdStr: string) => {
    const trimmed = cmdStr.trim();
    if (!trimmed || seen.has(trimmed)) return;
    // Skip lines that are clearly comments/echo-only explanations.
    const firstToken = trimmed.split(/\s+/)[0];
    if (!ALLOWED_SANDBOX_COMMANDS.includes(firstToken as (typeof ALLOWED_SANDBOX_COMMANDS)[number])) {
      return;
    }
    try {
      const parsed = parseSandboxCommand(trimmed);
      seen.add(trimmed);
      out.push({ raw: trimmed, command: parsed.command, args: parsed.args ?? [] });
    } catch {
      // not allowlisted — skip
    }
  };

  // 1. fenced shell blocks
  const fenceRe = /```([a-zA-Z0-9_+-]*)\s*\n([\s\S]*?)```/g;
  let m: RegExpExecArray | null;
  while ((m = fenceRe.exec(text)) !== null) {
    const lang = (m[1] || '').toLowerCase();
    const body = m[2];
    if (!lang || isShellLanguage(lang)) {
      // A shell block may contain several commands (one per line). Take each
      // line that starts with an allowlisted command.
      for (const line of body.split('\n')) {
        if (!line.trim() || line.trim().startsWith('#')) continue;
        add(line);
      }
    }
  }

  // 2. explicit <sandbox_run>…</sandbox_run> tags (any language)
  const tagRe = /<sandbox_run>([\s\S]*?)<\/sandbox_run>/g;
  while ((m = tagRe.exec(text)) !== null) {
    for (const line of m[1].split('\n')) {
      if (!line.trim() || line.trim().startsWith('#')) continue;
      add(line);
    }
  }

  return out;
}

export interface AgentStepOptions {
  mode: 'review' | 'automatic' | 'automatic_plus';
  store: SandboxStoreValue;
  project: Project | null;
  /** The chat whose sandbox the agent runs in (per-chat isolation). */
  chatId: string;
  /** Latest AI code artifact to seed for Python runs. */
  seedFiles?: { path: string; content: string }[];
  onCommandRunning?: (cmd: RunnableCommand) => void;
}

export interface AgentStepResult {
  ranAny: boolean;
  outputText: string; // combined tool-results block to feed back to the AI
}

/**
 * Run one agent step: execute every extracted command (with approval in
 * `automatic` mode, immediately in `automatic_plus`), streaming into the
 * chat's active sandbox tab, and return a tool-results text block. The caller
 * feeds `outputText` back into the conversation and re-prompts the AI.
 */
export async function runSandboxAgentStep(
  commands: RunnableCommand[],
  opts: AgentStepOptions
): Promise<AgentStepResult> {
  const { mode, store, project, chatId, seedFiles } = opts;
  const workdir = project ? `proj-${project.id}` : '';
  const sections: string[] = [];

  if (commands.length === 0) return { ranAny: false, outputText: '' };

  // Seed the project files once at the start of the step so the AI's builds
  // operate on the latest sources.
  await store.seedProject(project);
  store.ensureChat(chatId);
  // Snapshot the active tab's log length so we can collect only this step's
  // lines for the tool-result block.
  const cs0 = store.states[chatId];
  const activeTab0 = cs0?.tabs.find((t) => t.id === cs0.activeTabId) || cs0?.tabs[0];
  const logStartLen = activeTab0 ? activeTab0.logs.length : 0;

  let ranAny = false;
  for (const cmd of commands) {
    // Approval gate for "automatic" (propose, user approves each).
    if (mode === 'automatic') {
      const approved = await store.requestApproval(cmd.raw);
      if (!approved) {
        sections.push(`$ ${cmd.raw}\n[User declined to run this command.]`);
        continue;
      }
    }

    opts.onCommandRunning?.(cmd);
    ranAny = true;
    const code = await store.runCommand(
      { command: cmd.command, args: cmd.args, workdir },
      'agent',
      chatId,
      seedFiles,
    );
    sections.push(`$ ${cmd.raw}\n[exit code: ${code}]`);
  }

  await store.refreshArtifacts(workdir);

  // Collect only the lines emitted during this step (after logStartLen) from
  // the active tab so the tool-result block reflects just this round's output.
  const cs = store.states[chatId];
  const activeTab = cs?.tabs.find((t) => t.id === cs.activeTabId) || cs?.tabs[0];
  const stepLogs = activeTab ? activeTab.logs.slice(logStartLen) : [];
  const recent = stepLogs
    .filter((l) => l.source === 'agent')
    .map((l) =>
      l.stream === 'stderr' || l.stream === 'error'
        ? `[stderr] ${l.text}`
        : l.stream === 'status'
          ? `# ${l.text}`
          : l.text,
    )
    .join('\n');

  const outputText = [
    'The following sandbox commands were executed and produced the output below. Read it carefully and continue the task. If you need to run more commands, emit them in bash/sh blocks. If the task is complete, summarize the result.',
    sections.join('\n\n'),
    '--- sandbox output ---',
    recent || '(no output)',
    '--- end output ---',
  ].join('\n\n');

  return { ranAny, outputText };
}

export { SHELL_LANGS };
export type { RunCommandOptions };
