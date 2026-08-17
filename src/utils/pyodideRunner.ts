// Real in-browser Python execution via Pyodide (CPython compiled to WASM).
//
// This is the sandbox's execution backend for Python in the WEB build (and
// also works in the Tauri desktop webview). It is free, keyless, and runs
// entirely client-side — no backend, no API. Python code/files the AI gave in
// chat are written into Pyodide's virtual filesystem and executed, so
// `python foo.py` truthfully runs the file.
//
// Pyodide is loaded lazily from the official CDN on first use and runs in a
// Web Worker so it never blocks the UI. stdout/stderr stream live to the
// caller for the terminal log.

export interface PyodideRunFile {
  path: string; // e.g. "main.py" or "lib/helper.py"
  content: string;
}

export interface PyodideRunResult {
  exitCode: number;
  stdout: string;
  stderr: string;
}

export interface PyodideStreamLine {
  stream: 'stdout' | 'stderr' | 'status' | 'error';
  line: string;
}

type Pending = {
  onLine: (line: PyodideStreamLine) => void;
  resolve: (r: PyodideRunResult) => void;
  stdout: string[];
  stderr: string[];
};

let worker: Worker | null = null;
let pending: Pending | null = null;
let msgId = 0;

const PYODIDE_WORKER_SOURCE = `
// Worker that loads Pyodide once and runs Python programs on demand.
importScripts("https://cdn.jsdelivr.net/pyodide/v0.26.2/full/pyodide.js");

let pyodideReady = null;
async function ensurePyodide() {
  if (pyodideReady) return pyodideReady;
  postMessage({ type: "status", text: "Loading Python runtime (Pyodide, ~10MB)…" });
  pyodideReady = (async () => {
    const py = await loadPyodide();
    // Redirect stdout/stderr to the host.
    py.setStdout({ batched: (s) => postMessage({ type: "stdout", text: s }) });
    py.setStderr({ batched: (s) => postMessage({ type: "stderr", text: s }) });
    postMessage({ type: "ready" });
    return py;
  })();
  return pyodideReady;
}

onmessage = async (e) => {
  const { id, files, entry } = e.data;
  try {
    const py = await ensurePyodide();
    // Write every provided file into the virtual FS.
    for (const f of files) {
      const parts = f.path.split("/");
      let dir = "/";
      for (let i = 0; i < parts.length - 1; i++) {
        dir = (dir === "/" ? "" : dir) + "/" + parts[i];
        try { py.FS.mkdir(dir); } catch (_) {}
      }
      py.FS.writeFile(f.path, f.content);
    }
    postMessage({ type: "status", text: "Running " + entry + " ..." });
    let exitCode = 0;
    // Execute the entry file as __main__ in a fresh namespace. We read it back
    // from the FS (so imports of sibling files we wrote resolve), set __name__
    // to "__main__", and exec. SystemExit/exceptions are translated to codes.
    // The runner is built with a JS template literal so real newlines are used
    // (avoiding \\n escape pitfalls inside the Blob worker source).
    const runner = [
      "import sys, traceback as _tb",
      "src = open(" + JSON.stringify(entry) + ", encoding='utf-8').read()",
      "g = {'__name__': '__main__', '__file__': " + JSON.stringify(entry) + "}",
      "try:",
      "    exec(compile(src, " + JSON.stringify(entry) + ", 'exec'), g)",
      "except SystemExit as e:",
      "    sys.exit(e.code if isinstance(e.code, int) else 0)",
      "except BaseException:",
      "    _tb.print_exc()",
      "    sys.exit(1)",
    ].join("\n");
    try {
      py.runPython(runner);
    } catch (err) {
      // runPython re-raises SystemExit as a JS error (Pyodide behavior); parse
      // the exit code out. Traceback already went to stderr above.
      const m = String((err && err.message) || err);
      if (/SystemExit/.test(m)) {
        const cm = m.match(/SystemExit[^0-9]*(\d+)/);
        exitCode = cm ? parseInt(cm[1], 10) : 0;
      } else {
        exitCode = 1;
      }
    }
    postMessage({ type: "done", id, exitCode });
  } catch (err) {
    postMessage({ type: "error", text: String((err && err.message) || err) });
    postMessage({ type: "done", id, exitCode: 1 });
  }
};
`;

function getWorker(): Worker {
  if (worker) return worker;
  const blob = new Blob([PYODIDE_WORKER_SOURCE], { type: 'application/javascript' });
  const url = URL.createObjectURL(blob);
  worker = new Worker(url);
  worker.onmessage = (e: MessageEvent) => {
    const data = e.data;
    if (!pending) return;
    if (data.type === 'ready') {
      pending.onLine({ stream: 'status', line: 'Python runtime ready.' });
    } else if (data.type === 'stdout') {
      pending.stdout.push(data.text);
      pending.onLine({ stream: 'stdout', line: data.text });
    } else if (data.type === 'stderr') {
      pending.stderr.push(data.text);
      pending.onLine({ stream: 'stderr', line: data.text });
    } else if (data.type === 'status') {
      pending.onLine({ stream: 'status', line: data.text });
    } else if (data.type === 'error') {
      pending.onLine({ stream: 'error', line: data.text });
      pending.stderr.push(data.text);
    } else if (data.type === 'done') {
      const result: PyodideRunResult = {
        exitCode: typeof data.exitCode === 'number' ? data.exitCode : 0,
        stdout: pending.stdout.join(''),
        stderr: pending.stderr.join(''),
      };
      const p = pending;
      pending = null;
      p.resolve(result);
    }
  };
  worker.onerror = (e) => {
    if (pending) {
      pending.onLine({ stream: 'error', line: e.message || 'Worker error' });
      const p = pending;
      pending = null;
      p.resolve({ exitCode: 1, stdout: p.stdout.join(''), stderr: p.stderr.join('') });
    }
  };
  return worker;
}

/**
 * Run a Python program in Pyodide. Files are written to the virtual FS first,
 * then `entry` is executed as __main__. stdout/stderr stream live via onLine.
 *
 * If `entry` is null/empty, runs inline `code` from the first file instead.
 */
export function runPython(
  files: PyodideRunFile[],
  entry: string | null,
  onLine: (line: PyodideStreamLine) => void,
): Promise<PyodideRunResult> {
  return new Promise((resolve) => {
    const id = ++msgId;
    pending = {
      onLine,
      resolve,
      stdout: [],
      stderr: [],
    };
    const w = getWorker();
    // If no response within 90s (e.g. Pyodide CDN blocked or offline), fail
    // gracefully instead of hanging the terminal in a "running" state forever.
    const timeout = setTimeout(() => {
      if (!pending) return;
      onLine({ stream: 'error', line: 'Python runtime did not respond in time (Pyodide may be blocked or offline). Check your connection and retry.' });
      const p = pending;
      pending = null;
      p.resolve({ exitCode: 1, stdout: p.stdout.join(''), stderr: p.stderr.join('') });
    }, 90000);
    const origResolve = pending.resolve;
    pending.resolve = (r) => { clearTimeout(timeout); origResolve(r); };

    const entryPath = entry || (files.length === 1 ? files[0].path : files.find((f) => f.path.endsWith('.py'))?.path || 'main.py');
    w.postMessage({ id, files, entry: entryPath });
  });
}

/** True when Pyodide (browser-side Python) can be used — always true in a
 *  browser/webview. This is what makes the sandbox "real" even outside Tauri. */
export function isPythonRunnerAvailable(): boolean {
  return typeof Worker !== 'undefined' && typeof Blob !== 'undefined';
}
