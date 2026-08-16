import { useState, useRef, useEffect, useCallback } from 'react';
import { Terminal, Play, Loader2, X, FolderDown, ShieldCheck, AlertTriangle, ChevronDown } from 'lucide-react';
import {
  runSandboxCommand,
  listSandboxArtifacts,
  writeSandboxFiles,
  parseSandboxCommand,
  isSandboxAvailable,
  ALLOWED_SANDBOX_COMMANDS,
  type SandboxStreamLine,
  type SandboxArtifact,
} from '../utils/sandboxRunner';
import type { Project } from '../types';

interface SandboxPanelProps {
  /** Project whose files are seeded into the sandbox workdir before a build. */
  project: Project | null;
  onClose: () => void;
}

interface LogLine {
  id: number;
  stream: SandboxStreamLine['stream'];
  text: string;
}

const QUICK_COMMANDS: { label: string; cmd: string; desc: string }[] = [
  { label: 'npm install', cmd: 'npm install', desc: 'Install Node deps' },
  { label: 'Build (Vite)', cmd: 'npm run build', desc: 'Vite production build → dist/' },
  { label: 'Tauri build (.exe/.msi)', cmd: 'npm run tauri build', desc: 'Desktop installer build' },
  { label: 'Flutter APK', cmd: 'flutter build apk', desc: 'Android APK → build/app/outputs/' },
  { label: 'cargo build', cmd: 'cargo build --release', desc: 'Rust release build → target/release' },
];

export function SandboxPanel({ project, onClose }: SandboxPanelProps) {
  const [command, setCommand] = useState('npm run build');
  const [running, setRunning] = useState(false);
  const [logs, setLogs] = useState<LogLine[]>([]);
  const [exitCode, setExitCode] = useState<number | null>(null);
  const [artifacts, setArtifacts] = useState<SandboxArtifact[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [autoSeed, setAutoSeed] = useState(true);
  const [showQuick, setShowQuick] = useState(false);
  const logIdRef = useRef(0);
  const logEndRef = useRef<HTMLDivElement | null>(null);
  const quickRef = useRef<HTMLDivElement | null>(null);

  const available = isSandboxAvailable();

  const pushLog = useCallback((stream: LogLine['stream'], text: string) => {
    setLogs((prev) => [...prev, { id: ++logIdRef.current, stream, text }]);
  }, []);

  useEffect(() => {
    logEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [logs]);

  // Close the quick-commands dropdown on outside click.
  useEffect(() => {
    if (!showQuick) return;
    const handler = (e: MouseEvent) => {
      if (quickRef.current && !quickRef.current.contains(e.target as Node)) setShowQuick(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [showQuick]);

  const handleRun = useCallback(async () => {
    setError(null);
    if (running) return;
    setLogs([]);
    setExitCode(null);
    setArtifacts([]);

    let opts;
    try {
      opts = parseSandboxCommand(command);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      return;
    }

    const workdir = project ? `proj-${project.id}` : '';

    setRunning(true);
    try {
      if (autoSeed && project && project.files.length > 0) {
        pushLog('status', `Seeding ${project.files.length} project file(s) into the sandbox…`);
        const files = project.files.map((f) => ({
          path: f.path.startsWith('/') ? f.path.slice(1) : f.path,
          content: f.content,
        }));
        const written = await writeSandboxFiles(workdir, files);
        pushLog('status', `Seeded ${written} file(s).`);
      }

      pushLog('status', `$ ${opts.command} ${(opts.args ?? []).join(' ')}`);
      const code = await runSandboxCommand(
        { ...opts, workdir },
        (line: SandboxStreamLine) => {
          setLogs((prev) => [
            ...prev,
            { id: ++logIdRef.current, stream: line.stream, text: line.line },
          ]);
        },
      );
      setExitCode(code);
      pushLog('status', code === 0 ? '✓ Completed successfully.' : `✗ Exited with code ${code}.`);

      const found = await listSandboxArtifacts(workdir);
      setArtifacts(found);
      if (found.length > 0) {
        pushLog('status', `Found ${found.length} build artifact(s) ready for download.`);
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setError(msg);
      pushLog('error', msg);
    } finally {
      setRunning(false);
    }
  }, [command, running, project, autoSeed, pushLog]);

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
      setError(`Could not start download: ${e}`);
    });
  }, []);

  const lineColor = (s: LogLine['stream']) =>
    s === 'stderr' || s === 'error'
      ? 'text-red-400'
      : s === 'status'
        ? 'text-[#C58B51] font-semibold'
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
        </div>
        <button
          onClick={onClose}
          className="flex h-7 w-7 items-center justify-center rounded-lg hover:bg-[#333] text-[#9a9a9a] hover:text-white transition-all cursor-pointer"
          title="Close sandbox"
        >
          <X size={16} />
        </button>
      </div>

      {/* Unavailable notice */}
      {!available && (
        <div className="px-4 py-3 bg-amber-900/30 border-b border-amber-700/40 text-amber-200 text-xs flex items-start gap-2">
          <AlertTriangle size={14} className="mt-0.5 shrink-0" />
          <span>
            The sandbox only runs inside the installed <strong>SAW AI desktop app</strong> (Tauri). Run
            <code className="mx-1 px-1 bg-black/30 rounded">npm run tauri dev</code> or use the built app to
            execute commands here. Everything stays scoped to the app's sandbox folder — it cannot touch your PC.
          </span>
        </div>
      )}

      {/* Command bar */}
      <div className="px-4 py-3 border-b border-[#333] space-y-2.5">
        <div className="flex items-center gap-2">
          <div className="relative flex-1" ref={quickRef}>
            <input
              value={command}
              onChange={(e) => setCommand(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter' && !running && available) handleRun(); }}
              disabled={!available}
              placeholder="e.g. npm run tauri build"
              className="w-full bg-[#111] border border-[#3a3a3a] rounded-lg px-3 py-2 text-sm font-mono text-emerald-300 placeholder-[#555] focus:outline-none focus:border-[#C58B51] disabled:opacity-50"
              spellCheck={false}
            />
            <button
              type="button"
              onClick={() => setShowQuick((v) => !v)}
              disabled={!available}
              className="absolute right-1 top-1/2 -translate-y-1/2 flex items-center gap-1 px-2 py-1 rounded-md text-[10px] text-[#9a9a9a] hover:bg-[#333] hover:text-white transition-all cursor-pointer disabled:opacity-40"
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
            disabled={running || !available}
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
              disabled={!project}
            />
            Seed project files into sandbox before run
            {!project && <span className="text-[#666]">(no project bound)</span>}
          </label>
          {project && (
            <span className="text-[10px] text-[#666] font-mono truncate max-w-[50%]" title={project.name}>
              📦 {project.name} · {project.files.length} files
            </span>
          )}
        </div>
        <p className="text-[10px] text-[#666] leading-relaxed">
          Allowed: {ALLOWED_SANDBOX_COMMANDS.join(', ')}. Runs in an app-scoped folder — no shell, no access
          outside the sandbox. Caches (npm/cargo/pub) are redirected inside it.
        </p>
      </div>

      {/* Log output */}
      <div className="flex-1 overflow-y-auto px-4 py-3 font-mono text-xs space-y-0.5 bg-[#111]">
        {logs.length === 0 && !error && (
          <div className="text-[#555] italic">Output will stream here. Run a command to begin.</div>
        )}
        {logs.map((l) => (
          <div key={l.id} className={`whitespace-pre-wrap break-all ${lineColor(l.stream)}`}>
            {l.text}
          </div>
        ))}
        {error && <div className="text-red-400 whitespace-pre-wrap break-all">⚠ {error}</div>}
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
