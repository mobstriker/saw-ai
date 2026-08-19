import { useState, useRef, useEffect, useCallback } from 'react';
import { Terminal, Play, Loader2, X, FolderDown, ShieldCheck, AlertTriangle, ChevronDown, ShieldAlert, Check, Plus } from 'lucide-react';
import {
  parseSandboxCommand,
  type SandboxArtifact,
} from '../utils/sandboxRunner';
import { type SandboxLogLine, type SandboxStoreValue } from '../utils/sandboxStore';
import type { Project } from '../types';

interface SandboxPanelProps {
  /** Project whose files are seeded into the sandbox workdir before a build. */
  project: Project | null;
  onClose: () => void;
  /** Shared sandbox store (created at App level so runs survive panel close). */
  store: SandboxStoreValue;
  /** The chat this sandbox panel belongs to (per-chat isolation). */
  chatId: string;
  /** Latest code artifact (e.g. a Python file the AI just produced) to seed
   *  before running `python <file>.py` so the file actually exists. */
  latestArtifactCode?: { filename: string; language: string; code: string } | null;
  /** ALL code artifacts from this chat's history, so any file the AI created
   *  can be run by name (e.g. `python foo.py`, `node bar.js`, multi-file
   *  projects where foo.py imports bar.py). Deduped by path. */
  allArtifactFiles?: { path: string; content: string; language: string }[];
}

type LogLine = SandboxLogLine;

const QUICK_COMMANDS: { label: string; cmd: string; desc: string }[] = [
  { label: 'Run Python', cmd: 'python main.py', desc: 'Run the AI-generated Python file' },
  { label: 'npm install', cmd: 'npm install', desc: 'Install Node deps (desktop)' },
  { label: 'Build (Vite)', cmd: 'npm run build', desc: 'Vite production build → dist/' },
  { label: 'Flutter APK', cmd: 'flutter build apk', desc: 'Android APK (desktop)' },
  { label: 'cargo build', cmd: 'cargo build --release', desc: 'Rust release build (desktop)' },
];

export function SandboxPanel({ project, onClose, store, chatId, latestArtifactCode, allArtifactFiles }: SandboxPanelProps) {
  const [command, setCommand] = useState('python main.py');
  const [autoSeed, setAutoSeed] = useState(true);
  const [showQuick, setShowQuick] = useState(false);
  const quickRef = useRef<HTMLDivElement | null>(null);
  const logEndRef = useRef<HTMLDivElement | null>(null);

  // Ensure this chat has a sandbox session.
  useEffect(() => {
    store.ensureChat(chatId);
  }, [chatId, store]);

  const chatState = store.states[chatId];
  const tabs = chatState?.tabs ?? [];
  const activeTabId = chatState?.activeTabId ?? '';
  const activeTab = tabs.find((t) => t.id === activeTabId) || tabs[0];
  const logs = activeTab?.logs ?? [];
  const running = activeTab?.running ?? false;
  const exitCode = activeTab?.exitCode ?? null;
  const artifacts = chatState?.artifacts ?? [];
  const { available, pythonAvailable, accessGranted, pendingApproval } = store;

  // Per-chat sandbox workdir. A project-bound chat uses the project's dir;
  // a universal chat gets its OWN dir keyed by chat id (`chat-<id>`) — the old
  // code used the sandbox ROOT for every universal chat, so files from
  // different chats leaked into each other and commands ran in a shared,
  // stale directory instead of a per-chat workdir.
  const workdir = project ? `proj-${project.id}` : `chat-${chatId}`;

  useEffect(() => {
    logEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [logs.length]);

  // Close the quick-commands dropdown on outside click.
  useEffect(() => {
    if (!showQuick) return;
    const handler = (e: MouseEvent) => {
      if (quickRef.current && !quickRef.current.contains(e.target as Node)) setShowQuick(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [showQuick]);

  // Build the seed files for a run: the bound project's files + EVERY artifact
  // the AI created in this chat (so `python foo.py`, `node bar.js`, and
  // multi-file imports all resolve). Deduped by path (project files win).
  const buildSeedFiles = useCallback((): { path: string; content: string }[] => {
    const byPath = new Map<string, { path: string; content: string }>();
    if (project && project.files.length > 0) {
      for (const f of project.files) {
        const p = f.path.startsWith('/') ? f.path.slice(1) : f.path;
        byPath.set(p, { path: p, content: f.content });
      }
    }
    if (allArtifactFiles && allArtifactFiles.length > 0) {
      for (const a of allArtifactFiles) {
        const p = a.path.startsWith('/') ? a.path.slice(1) : a.path;
        if (!byPath.has(p)) byPath.set(p, { path: p, content: a.content });
      }
    }
    // Fall back to the latest single artifact if the full list wasn't passed.
    if (byPath.size === 0 && latestArtifactCode && latestArtifactCode.code) {
      byPath.set(latestArtifactCode.filename || 'main.py', {
        path: latestArtifactCode.filename || 'main.py',
        content: latestArtifactCode.code,
      });
    }
    return Array.from(byPath.values());
  }, [project, allArtifactFiles, latestArtifactCode]);

  const handleRun = useCallback(async () => {
    if (running) return;
    const trimmed = command.trim();
    if (!trimmed) {
      store.pushLog('error', 'Command is empty.');
      return;
    }

    // Seed project + ALL chat artifacts into the Tauri workdir (desktop) so any
    // file the AI created is runnable by name. For web (Pyodide) we pass them
    // inline below.
    const seedFiles = buildSeedFiles();
    if (available && autoSeed && seedFiles.length > 0) {
      try {
        await store.seedFiles(workdir, seedFiles);
      } catch (e) {
        store.pushLog('error', `Seeding files failed: ${e instanceof Error ? e.message : String(e)}`);
      }
    }

    // Parse into {command, args} for routing + the leading-token allowlist
    // check. The store builds a quote-aware command line from these.
    let opts;
    try {
      opts = parseSandboxCommand(trimmed);
    } catch (e) {
      // The leading token isn't on the toolchain list. In the desktop build the
      // backend is a real shell, so shell builtins (cd, ls, pipes, &&) are fine
      // — surface a clear note and still try to run it as a raw command line so
      // `cd src && ls` works instead of being rejected.
      if (available) {
        await store.runCommand(
          { command: trimmed, args: [], workdir, rawCommandLine: true } as any,
          'manual',
          chatId,
          undefined,
        );
        if (available) await store.refreshArtifacts(workdir);
        return;
      }
      store.pushLog('error', e instanceof Error ? e.message : String(e));
      return;
    }

    const pySeed = (opts.command === 'python' || opts.command === 'python3') ? seedFiles : undefined;
    await store.runCommand({ ...opts, workdir }, 'manual', chatId, pySeed);
    if (available) await store.refreshArtifacts(workdir);
  }, [command, running, project, autoSeed, store, chatId, available, buildSeedFiles, workdir]);

  const downloadArtifact = useCallback((a: SandboxArtifact) => {
    // Use the Tauri FS plugin's readTextFile/binary read is overkill; instead
    // we open the absolute path via an <a download> using a tauri:// or file
    // URL. In Tauri v2 the simplest reliable path is the convertFileSrc helper.
    import('@tauri-apps/api/core').then(({ convertFileSrc }) => {
      const url = convertFileSrc(a.absPath);
      const link = document.createElement('a');
      link.href = url;
      link.download = a.relPath.split('/').pop() || a.relPath;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
    }).catch((e) => {
      store.pushLog('error', `Could not start download: ${e}`);
    });
  }, [store]);

  const lineColor = (l: LogLine) =>
    l.stream === 'stderr' || l.stream === 'error'
      ? l.source === 'agent'
        ? 'text-red-300'
        : 'text-red-400'
      : l.stream === 'status'
        ? 'text-[#C58B51] font-semibold'
        : l.source === 'agent'
          ? 'text-sky-300/90'
          : 'text-emerald-300/90';

  return (
    <div className="flex flex-col h-full bg-[#1a1a1a] text-[#e8e8e8]">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-2.5 border-b border-[#333] bg-[#222]">
        <div className="flex items-center gap-2">
          <Terminal size={16} className="text-[#C58B51]" />
          <span className="text-sm font-bold">Sandbox Runner</span>
          <span className="flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded bg-[#2a2a2a] border border-[#3a3a3a] text-[#9a9a9a]">
            <ShieldCheck size={10} className="text-emerald-400" />
            Restricted
          </span>
          {accessGranted && (
            <span className="flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded bg-sky-500/15 border border-sky-500/40 text-sky-300 font-semibold">
              <ShieldAlert size={10} />
              AI Access
            </span>
          )}
        </div>
        <div className="flex items-center gap-1.5">
          {/* Give Access / Revoke — lets the AI run sandbox commands from chat */}
          <button
            onClick={() => store.toggleAccess()}
            disabled={!available}
            className={`flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-[11px] font-bold border transition-all cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed ${
              accessGranted
                ? 'bg-sky-500/20 text-sky-300 border-sky-500/50 hover:bg-sky-500/30'
                : 'bg-[#2a2a2a] text-[#C58B51] border-[#C58B51]/50 hover:bg-[#333]'
            }`}
            title={
              accessGranted
                ? 'The AI can run sandbox commands from chat. Click to revoke access.'
                : 'Grant the AI access to run sandbox commands driven from chat (linked to the automation mode).'
            }
          >
            {accessGranted ? <Check size={12} /> : <ShieldAlert size={12} />}
            {accessGranted ? 'Revoke Access' : 'Give Access'}
          </button>
          <button
            onClick={onClose}
            className="flex h-7 w-7 items-center justify-center rounded-lg hover:bg-[#333] text-[#9a9a9a] hover:text-white transition-all cursor-pointer"
            title="Close sandbox"
          >
            <X size={16} />
          </button>
        </div>
      </div>

      {/* Access info banner */}
      {accessGranted && available && (
        <div className="px-4 py-2 bg-sky-900/25 border-b border-sky-700/40 text-sky-200 text-[11px] flex items-start gap-2">
          <ShieldAlert size={13} className="mt-0.5 shrink-0" />
          <span>
            The AI can run sandbox commands from your chat prompts. Runs continue in the background even when this panel
            is closed, and stream into this log. Behavior follows the automation mode: <strong>Automatic</strong> asks
            you to approve each command; <strong>Auto Planner</strong> runs them on its own. Revoke access anytime.
          </span>
        </div>
      )}

      {/* Pending approval (automatic mode) */}
      {pendingApproval && (
        <div className="px-4 py-2.5 bg-amber-900/30 border-b border-amber-700/50 text-amber-100 text-xs flex items-center justify-between gap-2">
          <div className="flex items-center gap-2 min-w-0">
            <ShieldAlert size={14} className="shrink-0 text-amber-300" />
            <span className="truncate">
              AI wants to run: <code className="px-1 bg-black/40 rounded text-amber-200">{pendingApproval.command}</code>
            </span>
          </div>
          <div className="flex items-center gap-1.5 shrink-0">
            <button
              onClick={() => store.resolveApproval(true)}
              className="px-2.5 py-1 rounded-md bg-emerald-600 hover:bg-emerald-500 text-white text-[11px] font-bold cursor-pointer"
            >
              Approve
            </button>
            <button
              onClick={() => store.resolveApproval(false)}
              className="px-2.5 py-1 rounded-md bg-[#444] hover:bg-[#555] text-[#eee] text-[11px] font-bold cursor-pointer"
            >
              Reject
            </button>
          </div>
        </div>
      )}

      {/* Unavailable notice — only for non-Python commands in web builds.
          Python (Pyodide) works everywhere, so the panel stays enabled. */}
      {!available && (
        <div className="px-4 py-3 bg-amber-900/30 border-b border-amber-700/40 text-amber-200 text-xs flex items-start gap-2">
          <AlertTriangle size={14} className="mt-0.5 shrink-0" />
          <span>
            <strong>Web build: only Python runs here</strong> (via in-browser Pyodide, free, no install). For the
            full CLI — <strong>npm, node, dart, flutter, cargo, git, pipes, &&, dev servers</strong> — run
            <code className="mx-1 px-1 bg-black/30 rounded">npm run tauri dev</code> or the built desktop app. The
            desktop sandbox is a real jailed shell: it cannot touch your PC or file explorer.
          </span>
        </div>
      )}
      {available && !pythonAvailable && (
        <div className="px-4 py-2 bg-sky-900/20 border-b border-sky-700/30 text-sky-200 text-[11px] flex items-center gap-2">
          <ShieldCheck size={12} className="shrink-0 text-emerald-400" />
          <span>Desktop sandbox active — a real jailed shell. Python, npm, flutter, cargo, git, pipes, &&, and dev servers all run here, scoped to the app's folder (no access to your PC).</span>
        </div>
      )}

      {/* CLI Pages (tabs) — create/delete multiple terminals per chat */}
      <div className="flex items-center gap-1 px-2 py-1.5 border-b border-[#333] bg-[#1d1d1d] overflow-x-auto">
        {tabs.map((t) => {
          const isActive = t.id === activeTabId;
          return (
            <div
              key={t.id}
              className={`group flex items-center gap-1 pl-2.5 pr-1 py-1 rounded-md text-[11px] font-mono cursor-pointer transition-colors ${
                isActive ? 'bg-[#2a2a2a] text-[#e8e8e8] border border-[#3a3a3a]' : 'text-[#9a9a9a] hover:bg-[#262626]'
              }`}
              onClick={() => store.setActiveTab(chatId, t.id)}
            >
              <span className="flex items-center gap-1">
                {t.running && <Loader2 size={10} className="animate-spin text-emerald-400" />}
                {t.name}
              </span>
              {tabs.length > 1 && (
                <button
                  onClick={(e) => { e.stopPropagation(); store.closeTab(chatId, t.id); }}
                  className="ml-1 p-0.5 rounded hover:bg-[#444] text-[#9a9a9a] hover:text-white cursor-pointer"
                  title="Close page"
                >
                  <X size={11} />
                </button>
              )}
            </div>
          );
        })}
        <button
          onClick={() => store.addTab(chatId)}
          className="flex items-center gap-1 px-2 py-1 rounded-md text-[11px] text-[#9a9a9a] hover:text-white hover:bg-[#262626] transition-colors cursor-pointer shrink-0"
          title="New CLI page (terminal)"
        >
          <Plus size={12} />
          <span>New Page</span>
        </button>
      </div>

      {/* Command bar */}
      <div className="px-4 py-3 border-b border-[#333] space-y-2.5">
        <div className="flex items-center gap-2">
          <div className="relative flex-1" ref={quickRef}>
            <input
              value={command}
              onChange={(e) => setCommand(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter' && !running) handleRun(); }}
              disabled={running}
              placeholder="e.g. python main.py"
              className="w-full bg-[#111] border border-[#3a3a3a] rounded-lg px-3 py-2 text-sm font-mono text-emerald-300 placeholder-[#555] focus:outline-none focus:border-[#C58B51] disabled:opacity-50"
              spellCheck={false}
            />
            <button
              type="button"
              onClick={() => setShowQuick((v) => !v)}
              className="absolute right-1 top-1/2 -translate-y-1/2 flex items-center gap-1 px-2 py-1 rounded-md text-[10px] text-[#9a9a9a] hover:bg-[#333] hover:text-white transition-all cursor-pointer"
              title="Quick commands"
            >
              Quick
              <ChevronDown size={12} />
            </button>
            {showQuick && (
              <div className="absolute right-0 top-full mt-1 w-72 rounded-xl bg-[#2a2a2a] border border-[#3a3a3a] shadow-2xl p-1.5 z-20">
                {QUICK_COMMANDS.map((q) => (
                  <button
                    key={q.cmd}
                    onClick={() => { setCommand(q.cmd); setShowQuick(false); }}
                    className="w-full text-left px-2.5 py-2 rounded-lg hover:bg-[#3a3a3a] transition-colors cursor-pointer"
                  >
                    <div className="text-xs font-mono text-emerald-300">{q.label}</div>
                    <div className="text-[10px] text-[#888]">{q.desc}</div>
                  </button>
                ))}
              </div>
            )}
          </div>
          <button
            onClick={handleRun}
            disabled={running}
            className="flex items-center gap-1.5 px-3.5 py-2 rounded-lg bg-[#C58B51] hover:bg-[#B0783F] text-white text-sm font-bold transition-all cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {running ? <Loader2 size={14} className="animate-spin" /> : <Play size={14} className="fill-white" />}
            {running ? 'Running' : 'Run'}
          </button>
        </div>

        <div className="flex items-center justify-between">
          <label className="flex items-center gap-1.5 text-[11px] text-[#9a9a9a] cursor-pointer select-none">
            <input
              type="checkbox"
              checked={autoSeed}
              onChange={(e) => setAutoSeed(e.target.checked)}
              className="w-3.5 h-3.5 accent-[#C58B51] cursor-pointer"
              disabled={!project && !latestArtifactCode}
            />
            Seed project + latest AI code before run
            {!project && !latestArtifactCode && <span className="text-[#666]">(nothing to seed)</span>}
          </label>
          {project && (
            <span className="text-[10px] text-[#666] font-mono truncate max-w-[50%]" title={project.name}>
              📦 {project.name} · {project.files.length} files
            </span>
          )}
          {latestArtifactCode && !project && (
            <span className="text-[10px] text-[#666] font-mono truncate max-w-[50%]" title={latestArtifactCode.filename}>
              🐍 {latestArtifactCode.filename}
            </span>
          )}
        </div>
        <p className="text-[10px] text-[#666] leading-relaxed">
          {available
            ? 'Real jailed shell — run python, npm, flutter, cargo, git, pipes, &&, cd, and dev servers. Everything is scoped to this app folder; your PC stays off-limits.'
            : 'Web build: Python runs in-browser (Pyodide). The full CLI (npm/node/dart/flutter/cargo/git, pipes, &&, dev servers) runs in the desktop app — run "npm run tauri dev" or the built app.'}
        </p>
      </div>

      {/* Log output */}
      <div className="flex-1 overflow-y-auto px-4 py-3 font-mono text-xs space-y-0.5 bg-[#111]">
        {logs.length === 0 && (
          <div className="text-[#555] italic">Output will stream here — both your manual runs and the AI's runs when access is granted.</div>
        )}
        {logs.map((l) => (
          <div key={l.id} className={`whitespace-pre-wrap break-all ${lineColor(l)}`}>
            {l.source === 'agent' && <span className="text-sky-500 mr-1">◆</span>}
            {l.text}
          </div>
        ))}
        {exitCode !== null && (
          <div className={`mt-2 pt-2 border-t border-[#333] ${exitCode === 0 ? 'text-emerald-400' : 'text-red-400'} font-bold`}>
            {exitCode === 0 ? '● Success (exit 0)' : `● Failed (exit ${exitCode})`}
          </div>
        )}
        <div ref={logEndRef} />
      </div>

      {/* Artifacts */}
      {artifacts.length > 0 && (
        <div className="border-t border-[#333] bg-[#1a1a1a] px-4 py-3 max-h-44 overflow-y-auto">
          <div className="flex items-center gap-1.5 mb-2 text-xs font-bold text-[#e8e8e8]">
            <FolderDown size={13} className="text-[#C58B51]" />
            Build Artifacts ({artifacts.length})
          </div>
          <div className="space-y-1">
            {artifacts.map((a) => (
              <div
                key={a.absPath}
                className="flex items-center justify-between gap-2 px-2.5 py-1.5 rounded-lg bg-[#222] border border-[#333] hover:border-[#C58B51] transition-colors"
              >
                <div className="min-w-0 flex-1">
                  <div className="text-xs font-mono text-emerald-300 truncate">{a.relPath}</div>
                  <div className="text-[10px] text-[#666]">
                    {a.kind.toUpperCase()} · {(a.size / 1024).toFixed(1)} KB
                  </div>
                </div>
                <button
                  onClick={() => downloadArtifact(a)}
                  className="shrink-0 px-2.5 py-1 rounded-md bg-[#C58B51]/20 hover:bg-[#C58B51]/40 text-[#C58B51] text-[11px] font-bold transition-colors cursor-pointer"
                  title={`Download ${a.relPath}`}
                >
                  Download
                </button>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

export default SandboxPanel;
