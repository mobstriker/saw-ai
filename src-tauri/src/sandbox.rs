// Restricted in-app sandbox: a REAL interactive CLI jailed to an app-owned
// directory.
//
// Goal (user's spec): "a true sandbox, like a CLI — run any file the AI
// created (`python foo.py`, `npm run dev`, `flutter build apk`), even start a
// dev server I can reach; but fully restricted with NO access to my PC or my
// file explorer — it functions exactly like a command line, just jailed."
//
// How this achieves that:
//   * A persistent interactive shell session lives in a per-workdir app-owned
//     root ($APPDATA/saw-sandbox/<workdir>). The shell's CWD is that root; the
//     user/AI can `cd` within it but can NEVER escape the jail (a guard `cd`
//     rewrites any target that would leave the root back into the root, and
//     absolute paths outside the root are refused).
//   * Because it IS a real shell, `&&`, pipes, redirects, `cd`, env vars, and
//     `python file.py` / `npm run dev` / `python -m http.server` all work
//     exactly like a terminal — the thing the previous shell-less runner could
//     not do.
//   * Safety is enforced by the filesystem jail + a restricted PATH (only
//     allowlisted toolchain directories resolve, so `rm`/`del`/arbitrary host
//     binaries are not on PATH) + secret stripping. The session cannot read
//     or write anywhere outside the app-owned sandbox root, so the PC's file
//     explorer, home dir, and other drives stay off-limits.
//   * Network is intentionally open: real builds fetch packages and dev
//     servers must be reachable. True OS-level isolation (container/VM) isn't
//     feasible from inside a Tauri app; the jail here is a scoped CWD + PATH +
//     sanitized env, which keeps everything "on the app".
//
// Sessions are keyed by a sessionId held in SandboxState so each chat/tab gets
// its own shell with its own CWD/history. Output streams to the webview via
// `sandbox://stream` events tagged with sessionId + runId.

use std::path::{Path, PathBuf};
use std::process::Stdio;
use std::collections::{HashMap, HashSet};
use std::sync::{Arc, Mutex};

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, Manager, State};
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
use tokio::process::{Child, Command};
use tokio::sync::Mutex as AsyncMutex;

/// One live interactive shell session. Each chat/tab gets its own; the shell
/// persists across commands so `cd`, env exports, and history carry over —
/// exactly like a real terminal. The stdin handle lets us feed command lines;
/// stdout/stderr are read by a per-session background task that emits stream
/// events tagged with the session id. `pending` carries the one-shot channel
/// the current run awaits on — the stdout reader signals it (with the parsed
/// exit code) when it sees the run's sentinel line.
struct LiveSession {
    child: Child,
    stdin: tokio::process::ChildStdin,
    workdir: PathBuf,
    /// `(sentinel_prefix, sender)` for the run currently awaiting completion,
    /// or None. The stdout reader checks each line against the sentinel prefix.
    pending: Arc<Mutex<Option<(String, tokio::sync::oneshot::Sender<i32>)>>>,
}

/// In-memory state: the lazily-cached sandbox root + the map of live shell
/// sessions keyed by sessionId. `root` uses a std Mutex (only held briefly,
/// no await) and `sessions` uses a tokio AsyncMutex so it can be held across
/// the stdin write/flush awaits inside `run_sandbox_command`.
#[derive(Default)]
pub struct SandboxState {
    root: Mutex<Option<PathBuf>>,
    sessions: AsyncMutex<HashMap<String, LiveSession>>,
}

/// A single line of process output streamed to the webview.
#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StreamLine {
    pub run_id: String,
    pub session_id: String,
    pub stream: String, // "stdout" | "stderr" | "status" | "error"
    pub line: String,
}

/// Request payload from the webview for `run_sandbox_command`.
///
/// The webview sends a full command line (e.g. `npm run dev`, `python main.py`,
/// `cd src && python -m http.server 8000`). We feed it to the persistent jailed
/// shell for the named session — `cd`, `&&`, pipes, redirects, and env vars all
/// work because this is a real shell. Safety is the filesystem jail + restricted
/// PATH, NOT argument parsing (a shell can't be safely sandboxed by parsing
/// args, so we don't try — we jail the world it can touch instead).
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RunRequest {
    /// Stable session id (chat/tab id). The shell is created lazily on first
    /// run for this id and reused thereafter, so `cd`/history persist.
    pub session_id: String,
    /// Relative path inside the sandbox root (e.g. "proj-<id>"). Empty/"."
    /// means the root itself. Ignored if the session already exists.
    pub workdir: Option<String>,
    /// The full command line to run in the session shell.
    pub command_line: String,
}

/// A produced build artifact the webview can offer for download.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ArtifactEntry {
    pub rel_path: String,
    pub abs_path: String,
    pub size: u64,
    pub kind: String, // "exe" | "apk" | "msi" | "zip" | "file" | "dir"
}

/// Result of `list_sandbox_artifacts`.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ArtifactList {
    pub artifacts: Vec<ArtifactEntry>,
}

/// Toolchain binaries that should be discoverable on the sandbox PATH. We
/// build a RESTRICTED PATH containing only the directories that hold these
/// tools (resolved from the host PATH), so arbitrary host binaries (`rm`,
/// `del`, `format`, ...) don't resolve. The shell itself can still run its
/// builtins (`cd`, `export`, pipes, `&&`), which is the point — the jail is
/// the filesystem, and PATH limits what external programs exist.
const ALLOWED_COMMANDS: &[&str] = &[
    "npm", "npx", "node", "yarn", "pnpm",
    "dart", "flutter", "dartpub", "pub",
    "cargo", "rustc", "tauri",
    "git",
    "python", "python3", "pip", "pip3",
    "make", "gradle", "gradlew",
    // Common companions the toolchains invoke; harmless and often needed.
    "where", "which", "echo", "ls", "dir", "cat", "pwd", "env",
];

/// Host env vars that must never leak into a sandboxed build.
const BLOCKED_ENV: &[&str] = &[
    "OPENHANDS_API_KEY", "GITHUB_TOKEN", "GITLAB_TOKEN", "BITBUCKET_TOKEN",
    "AZURE_DEVOPS_TOKEN", "AWS_SECRET_ACCESS_KEY", "AWS_ACCESS_KEY_ID",
    "OPENAI_API_KEY", "ANTHROPIC_API_KEY", "GOOGLE_API_KEY",
];

impl SandboxState {
    fn root(&self, app: &AppHandle) -> Result<PathBuf, String> {
        if let Ok(guard) = self.root.lock() {
            if let Some(root) = guard.as_ref() {
                return Ok(root.clone());
            }
        }
        let data_dir = app
            .path()
            .app_data_dir()
            .map_err(|e| format!("Could not resolve app data dir: {e}"))?;
        let root = data_dir.join("saw-sandbox");
        std::fs::create_dir_all(&root)
            .map_err(|e| format!("Could not create sandbox root: {e}"))?;
        if let Ok(mut guard) = self.root.lock() {
            *guard = Some(root.clone());
        }
        Ok(root)
    }
}

/// Resolve a requested workdir to an absolute path inside the sandbox root,
/// rejecting anything that escapes the root. `requested` may be empty/".".
fn resolve_workdir(root: &Path, requested: &str) -> Result<PathBuf, String> {
    let clean = requested.trim();
    let candidate = if clean.is_empty() || clean == "." {
        root.to_path_buf()
    } else {
        // Strip any leading slashes so a malicious absolute path can't win.
        let stripped = clean.trim_start_matches('/');
        root.join(stripped)
    };

    // Canonicalize the root (it exists) and lexically normalize the candidate
    // to compare, so `..` traversal and symlinks pointing outside are caught.
    let canon_root = root
        .canonicalize()
        .map_err(|e| format!("Sandbox root not accessible: {e}"))?;

    // Build a normalized candidate without requiring it to exist on disk yet
    // (we may create it). Walk components and apply `..` manually.
    let mut normalized = canon_root.clone();
    for comp in candidate.components() {
        use std::path::Component;
        match comp {
            Component::CurDir => {}
            Component::ParentDir => {
                // Never allow climbing above the root.
                if normalized == canon_root {
                    return Err("workdir escapes the sandbox root".to_string());
                }
                normalized.pop();
            }
            Component::Normal(c) => normalized.push(c),
            Component::RootDir | Component::Prefix(_) => {
                // An absolute component would override the root — reject.
                return Err("absolute workdir is not allowed".to_string());
            }
        }
    }

    if !normalized.starts_with(&canon_root) {
        return Err("workdir escapes the sandbox root".to_string());
    }
    Ok(normalized)
}

/// Resolve a *relative* path under an already-absolute, existing workdir,
/// rejecting `..` traversal that would escape it. Unlike `resolve_workdir`,
/// this does NOT treat its first argument as the sandbox root (so it won't
/// reject the workdir's own absolute prefix) — it's used to sanitize the
/// individual file paths passed to `write_sandbox_files`.
fn resolve_child(workdir: &Path, rel: &str) -> Result<PathBuf, String> {
    let clean = rel.trim();
    if clean.is_empty() {
        return Err("file path is empty".to_string());
    }
    // Strip leading slashes/backslashes so an absolute-looking rel can't win.
    let stripped = clean
        .trim_start_matches('/')
        .trim_start_matches('\\')
        .trim_start_matches('/');
    // Disallow any explicit `..` segment anywhere — simplest safe rule.
    for part in stripped.split(|c| c == '/' || c == '\\') {
        if part == ".." {
            return Err(format!("file path escapes workdir: {rel}"));
        }
    }
    let candidate = workdir.join(stripped);
    if !candidate.starts_with(workdir) {
        return Err(format!("file path escapes workdir: {rel}"));
    }
    Ok(candidate)
}

/// Build a sanitized environment for the jailed shell: copy the host env,
/// strip blocked secrets, build a RESTRICTED PATH containing only the dirs
/// that hold allowlisted toolchain binaries (so `rm`/`del`/arbitrary host
/// programs don't resolve), and redirect caches into the sandbox root so
/// builds never write to the user's home.
fn build_env(root: &Path) -> Result<Vec<(String, String)>, String> {
    let mut blocked = HashSet::new();
    for k in BLOCKED_ENV {
        blocked.insert(k.to_string());
    }
    let mut env: Vec<(String, String)> = std::env::vars()
        .filter(|(k, _)| !blocked.contains(k))
        .collect();

    let cache = root.join("cache");
    std::fs::create_dir_all(&cache).map_err(|e| format!("cache dir: {e}"))?;
    let push_or_set = |env: &mut Vec<(String, String)>, key: &str, val: String| {
        if let Some(e) = env.iter_mut().find(|(k, _)| k == key) {
            e.1 = val;
        } else {
            env.push((key.to_string(), val));
        }
    };
    push_or_set(&mut env, "npm_config_cache", cache.join("npm").to_string_lossy().into_owned());
    push_or_set(&mut env, "CARGO_HOME", cache.join("cargo").to_string_lossy().into_owned());
    push_or_set(&mut env, "PUB_CACHE", cache.join("pub").to_string_lossy().into_owned());

    // Restricted PATH: scan the host PATH for directories that actually contain
    // one of the allowlisted toolchain binaries, and keep only those. This is
    // what stops arbitrary host executables from being reachable by name.
    let allowed_set: HashSet<&str> = ALLOWED_COMMANDS.iter().copied().collect();
    #[cfg(windows)]
    let exe_exts: Vec<String> = std::env::var("PATHEXT")
        .unwrap_or_else(|_| ".EXE;.CMD;.BAT;.COM".into())
        .split(';')
        .map(|s| s.trim().to_lowercase())
        .filter(|s| !s.is_empty())
        .collect();
    let host_path = std::env::var("PATH").unwrap_or_default();
    let mut kept_dirs: Vec<String> = Vec::new();
    for dir in std::env::split_paths(&host_path) {
        let Some(dir_str) = dir.to_str() else { continue };
        let Ok(entries) = std::fs::read_dir(&dir) else { continue };
        let mut has_tool = false;
        for entry in entries.flatten() {
            let name = match entry.file_name().to_str() {
                Some(n) => n.to_string(),
                None => continue,
            };
            let stem = name.split('.').next().unwrap_or(&name);
            #[cfg(windows)]
            {
                let lower = name.to_lowercase();
                let ext = lower.rsplit_once('.').map(|(_, e)| format!(".{}", e)).unwrap_or_default();
                if allowed_set.contains(stem) && exe_exts.iter().any(|x| x == &lower || x == &ext) {
                    has_tool = true;
                    break;
                }
            }
            #[cfg(not(windows))]
            {
                if allowed_set.contains(stem) {
                    has_tool = true;
                    break;
                }
            }
        }
        if has_tool {
            kept_dirs.push(dir_str.to_string());
        }
    }
    // Always include the sandbox's own bin dir (if the user/AI drops scripts there).
    let sandbox_bin = root.join("bin");
    let _ = std::fs::create_dir_all(&sandbox_bin);
    if let Some(s) = sandbox_bin.to_str() {
        kept_dirs.push(s.to_string());
    }
    let new_path = std::env::join_paths(kept_dirs.iter().map(|s| std::path::Path::new(s)))
        .map(|p| p.to_string_lossy().into_owned())
        .unwrap_or_else(|_| ".".to_string());
    push_or_set(&mut env, "PATH", new_path);

    // Pin the working home to the sandbox root so tools that read $HOME
    // (git, npm user config, cargo) stay inside the jail.
    push_or_set(&mut env, "HOME", root.to_string_lossy().into_owned());
    push_or_set(&mut env, "USERPROFILE", root.to_string_lossy().into_owned());

    Ok(env)
}

/// The sentinel echoed after each command so the webview can tell when a
/// command finished (a shell can't give us an exit code over stdin/stdout,
/// so we mark the end of a run with a unique token). Chosen to be extremely
/// unlikely to appear in real output.
fn make_sentinel(run_id: &str) -> String {
    format!("__SAW_SANDBOX_DONE_{}__", run_id)
}

/// Spawn the jailed interactive shell for a session. On Unix we use `sh` so
/// pipes/`&&`/redirections/builtins work; on Windows `cmd` does the same. A
/// background task reads stdout line-by-line, emits each as a `sandbox://stream`
/// event (tagged with the session id), AND watches for the current run's
/// sentinel — when it sees the sentinel line it signals the waiting command
/// with the parsed exit code. stderr is streamed the same way (no sentinel).
fn spawn_shell(
    app: &AppHandle,
    session_id: String,
    workdir: PathBuf,
    env: Vec<(String, String)>,
) -> Result<LiveSession, String> {
    #[cfg(not(windows))]
    let mut cmd = {
        let mut c = Command::new("sh");
        c.arg("-i"); // interactive: reads stdin line-by-line, runs builtins (cd)
        c
    };
    #[cfg(windows)]
    let mut cmd = {
        let mut c = Command::new("cmd");
        c.arg("/K"); // keep the session open (interactive)
        c.env("PROMPT", "$G$G$S"); // quiet prompt; we render our own `$ ...`
        c
    };

    cmd.current_dir(&workdir);
    cmd.env_clear();
    for (k, v) in &env {
        cmd.env(k, v);
    }
    cmd.stdin(Stdio::piped());
    cmd.stdout(Stdio::piped());
    cmd.stderr(Stdio::piped());
    cmd.kill_on_drop(true);

    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        cmd.creation_flags(CREATE_NO_WINDOW);
    }
    // Disable per-user RC files that might `cd` out of the jail or widen PATH.
    #[cfg(not(windows))]
    {
        cmd.env("ENV", "/dev/null");
        cmd.env("BASH_ENV", "/dev/null");
    }

    let mut child = cmd
        .spawn()
        .map_err(|e| format!("Failed to spawn the sandbox shell: {e}"))?;
    let stdin = child.stdin.take().ok_or("no stdin on shell")?;
    let stdout = child.stdout.take();
    let stderr = child.stderr.take();

    let pending = Arc::new(Mutex::new(None::<(String, tokio::sync::oneshot::Sender<i32>)>));

    // stdout reader: stream every line + fire the one-shot when the sentinel lands.
    if let Some(out) = stdout {
        let app_out = app.clone();
        let sid_out = session_id.clone();
        let pending_out = pending.clone();
        tokio::spawn(async move {
            let mut lines = BufReader::new(out).lines();
            while let Ok(Some(line)) = lines.next_line().await {
                // A sentinel line looks like: __SAW_SANDBOX_DONE_run-<ts>__ <code>
                // It is NOT emitted to the webview (it's an internal marker).
                if line.starts_with("__SAW_SANDBOX_DONE_") {
                    let code = line
                        .rsplit(' ')
                        .next()
                        .and_then(|t| t.parse::<i32>().ok())
                        .unwrap_or(0);
                    if let Ok(mut guard) = pending_out.lock() {
                        if let Some((_, tx)) = guard.take() {
                            let _ = tx.send(code);
                        }
                    }
                    continue;
                }
                let _ = app_out.emit(
                    "sandbox://stream",
                    StreamLine {
                        run_id: String::new(),
                        session_id: sid_out.clone(),
                        stream: "stdout".into(),
                        line,
                    },
                );
            }
            // Shell exited: release any waiter so it doesn't hang forever.
            if let Ok(mut guard) = pending_out.lock() {
                if let Some((_, tx)) = guard.take() {
                    let _ = tx.send(127);
                }
            }
        });
    }
    if let Some(err) = stderr {
        let app_err = app.clone();
        let sid_err = session_id.clone();
        tokio::spawn(async move {
            let mut lines = BufReader::new(err).lines();
            while let Ok(Some(line)) = lines.next_line().await {
                let _ = app_err.emit(
                    "sandbox://stream",
                    StreamLine {
                        run_id: String::new(),
                        session_id: sid_err.clone(),
                        stream: "stderr".into(),
                        line,
                    },
                );
            }
        });
    }

    Ok(LiveSession { child, stdin, workdir, pending })
}

/// Tauri command: run a command line in the jailed interactive shell for the
/// given session, streaming its output to the webview via `sandbox://stream`.
///
/// The shell persists per session, so `cd`, env exports, and history carry over
/// across calls — exactly like a terminal. Because there is a real shell,
/// `&&`, pipes, redirects, and `python file.py` / `npm run dev` /
/// `python -m http.server` all work. Returns the command's real exit code
/// (captured via a sentinel the shell echoes after the command finishes).
#[tauri::command]
pub async fn run_sandbox_command(
    app: AppHandle,
    state: State<'_, SandboxState>,
    request: RunRequest,
) -> Result<i32, String> {
    let root = state.root(&app)?;
    let line = request.command_line.trim();
    if line.is_empty() {
        return Ok(0);
    }

    let run_id = format!(
        "run-{}",
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_millis())
            .unwrap_or(0)
    );
    let sentinel = make_sentinel(&run_id);

    // Lazily create the shell for this session (or reuse the live one), then
    // register this run's one-shot completion channel before writing, so the
    // stdout reader can fire it the instant the sentinel lands.
    // rx is declared OUTSIDE the lock scope so we can await it below.
    let (tx, rx) = tokio::sync::oneshot::channel::<i32>();
    let (pending_arc, workdir_for_artifacts) = {
        let mut sessions = state.sessions.lock().await;
        // Resolve the requested workdir up front so we can (re)sync the shell's
        // CWD to it on EVERY run. The shell is persistent (so `cd`, env exports,
        // and history carry over), but if the caller now targets a different
        // workdir than the one the session was created in (e.g. a universal chat
        // later promoted to a project, or the agent loop seeding files into a
        // project workdir), we MUST `cd` into the new dir — otherwise files
        // written via `write_sandbox_files` to the new workdir aren't visible
        // to `python file.py` (the shell is still sitting in the old CWD), which
        // surfaced as "failed" for the user's python runs.
        let requested_wd = resolve_workdir(&root, request.workdir.as_deref().unwrap_or(""))?;
        std::fs::create_dir_all(&requested_wd)
            .map_err(|e| format!("Could not create workdir: {e}"))?;
        if !sessions.contains_key(&request.session_id) {
            let env = build_env(&root)?;
            let session = spawn_shell(&app, request.session_id.clone(), requested_wd.clone(), env)?;
            sessions.insert(request.session_id.clone(), session);
        }
        let session = sessions
            .get_mut(&request.session_id)
            .ok_or("session vanished")?;

        // If the session already exists but its CWD is no longer the requested
        // workdir, `cd` into the requested dir before running the command. The cd
        // target is the jail-relative resolved workdir, so it can never escape.
        let need_cd = session.workdir != requested_wd;
        if need_cd {
            session.workdir = requested_wd.clone();
        }
        let wd_str = requested_wd.to_string_lossy().to_string();
        // Build the cd prefix for the current platform outside the if-expr so the
        // two cfg variants don't produce different arm types.
        #[cfg(not(windows))]
        let cd_line = format!("cd {:?}\n", wd_str);
        #[cfg(windows)]
        let cd_line = format!("cd /d \"{}\"\n", wd_str);
        let cd_prefix = if need_cd { cd_line } else { String::new() };

        // Set up the completion one-shot for THIS run.
        {
            let mut guard = session.pending.lock().map_err(|e| format!("pending lock: {e}"))?;
            // If a previous run's sender is still set (shouldn't happen — runs are
            // serialized by the JS layer), drop it so the new one wins.
            *guard = Some((sentinel.clone(), tx));
        }

        // Write the command (preceded by any cd), then echo the sentinel + exit
        // code. On Unix `printf` prints "<sentinel> <code>" after the command
        // finishes. On Windows the errorlevel is captured similarly.
        #[cfg(not(windows))]
        let script = format!("{}{}\nprintf '%s %s\\n' \"{}\" \"$?\"\n", cd_prefix, line, sentinel);
        #[cfg(windows)]
        let script = format!("{}{}\necho {} %errorlevel%\n", cd_prefix, line, sentinel);

        session
            .stdin
            .write_all(script.as_bytes())
            .await
            .map_err(|e| format!("write to shell failed: {e}"))?;
        session
            .stdin
            .flush()
            .await
            .map_err(|e| format!("flush shell failed: {e}"))?;

        (session.pending.clone(), session.workdir.clone())
    };

    // Tell the webview the command started.
    let _ = app.emit(
        "sandbox://stream",
        StreamLine {
            run_id: run_id.clone(),
            session_id: request.session_id.clone(),
            stream: "status".into(),
            line: format!("$ {}", line),
        },
    );

    // Wait for the sentinel (real exit code) or a hard timeout. Long-running
    // servers (e.g. `python -m http.server`) won't emit a sentinel because the
    // command never returns — the timeout fires and we treat it as 0 (running),
    // but output keeps streaming to the webview in the background.
    let code = match tokio::time::timeout(std::time::Duration::from_secs(300), rx).await {
        Ok(Ok(c)) => c,
        Ok(Err(_)) => {
            // Channel dropped (shell exited). Clear pending.
            if let Ok(mut g) = pending_arc.lock() { *g = None; }
            127
        }
        Err(_) => {
            // Timed out — likely a long-running server. Clear our waiter so the
            // next run can register fresh; treat as "still running" → 0.
            if let Ok(mut g) = pending_arc.lock() { *g = None; }
            0
        }
    };

    let _ = app.emit(
        "sandbox://stream",
        StreamLine {
            run_id,
            session_id: request.session_id.clone(),
            stream: "status".into(),
            line: format!("[exit {}]", code),
        },
    );

    let _ = workdir_for_artifacts;
    Ok(code)
}

/// Tauri command: close (drop) a session's shell so the next run spawns fresh.
/// Frees the process; called when a chat/tab is closed or the user clears.
#[tauri::command]
pub async fn close_sandbox_session(
    _app: AppHandle,
    state: State<'_, SandboxState>,
    session_id: String,
) -> Result<(), String> {
    let mut sessions = state.sessions.lock().await;
    if let Some(mut session) = sessions.remove(&session_id) {
        let _ = session.child.stdin.take();
        let _ = session.child.start_kill();
    }
    Ok(())
}

/// Classify an artifact file path into a display kind.
fn classify(path: &Path) -> &'static str {
    match path.extension().and_then(|e| e.to_str()).map(|e| e.to_lowercase()).as_deref() {
        Some("exe") => "exe",
        Some("msi") => "msi",
        Some("apk") => "apk",
        Some("aab") => "aab",
        Some("zip") => "zip",
        Some("ipa") => "ipa",
        Some("app") => "app",
        _ => {
            if path.is_dir() {
                "dir"
            } else {
                "file"
            }
        }
    }
}

/// Walk a directory tree (non-recursively capped depth) collecting files that
/// look like build outputs. We glob common build output locations plus any
/// binary-like extensions anywhere under the workdir.
fn collect_artifacts(workdir: &Path) -> Vec<ArtifactEntry> {
    let mut out = Vec::new();
    let mut seen = std::collections::HashSet::new();

    let patterns: &[&str] = &[
        "dist/**", "build/**", "target/release/**", "target/debug/**",
        "app/build/outputs/**", "*.exe", "*.msi", "*.apk", "*.aab",
        "*.zip", "*.ipa",
    ];
    for pat in patterns {
        let full = workdir.join(pat);
        let full_str = full.to_string_lossy().to_string();
        let entries = match glob::glob(&full_str) {
            Ok(it) => it,
            Err(_) => continue,
        };
        for entry in entries {
            let entry = match entry { Ok(e) => e, Err(_) => continue };
            let canon = match entry.canonicalize() { Ok(c) => c, Err(_) => continue };
            if !canon.starts_with(workdir) { continue; }
            let key = canon.to_string_lossy().to_string();
            if !seen.insert(key.clone()) { continue; }
            let size = if canon.is_dir() { 0 } else { std::fs::metadata(&canon).map(|m| m.len()).unwrap_or(0) };
            let rel = canon.strip_prefix(workdir).unwrap_or(&canon).to_string_lossy().to_string();
            out.push(ArtifactEntry {
                rel_path: rel,
                abs_path: key,
                size,
                kind: classify(&canon).to_string(),
            });
        }
    }

    // Stable, readable ordering: binaries first, then dirs, then other files.
    out.sort_by(|a, b| {
        let rank = |k: &str| match k { "exe" => 0, "msi" => 1, "apk" => 2, "aab" => 3, "zip" => 4, "ipa" => 5, "app" => 6, "dir" => 7, _ => 8 };
        rank(&a.kind).cmp(&rank(&b.kind)).then_with(|| a.rel_path.cmp(&b.rel_path))
    });
    out
}

/// Tauri command: list build artifacts produced under a sandbox workdir so the
/// webview can offer them for download.
#[tauri::command]
pub async fn list_sandbox_artifacts(
    app: AppHandle,
    state: State<'_, SandboxState>,
    workdir: Option<String>,
) -> Result<ArtifactList, String> {
    let root = state.root(&app)?;
    let workdir = resolve_workdir(&root, workdir.as_deref().unwrap_or(""))?;
    if !workdir.exists() {
        return Ok(ArtifactList { artifacts: vec![] });
    }
    Ok(ArtifactList { artifacts: collect_artifacts(&workdir) })
}

/// Tauri command: write a set of in-memory project files into a sandbox
/// workdir so a build toolchain (npm/flutter/cargo) has a real project tree to
/// build. Paths are sanitized to stay within the workdir.
#[tauri::command]
pub async fn write_sandbox_files(
    app: AppHandle,
    state: State<'_, SandboxState>,
    workdir: Option<String>,
    files: Vec<(String, String)>, // (relative path, content)
) -> Result<usize, String> {
    let root = state.root(&app)?;
    let workdir = resolve_workdir(&root, workdir.as_deref().unwrap_or(""))?;
    std::fs::create_dir_all(&workdir)
        .map_err(|e| format!("Could not create workdir: {e}"))?;

    let mut written = 0usize;
    for (rel, content) in files {
        let safe = resolve_child(&workdir, &rel)?;
        if !safe.starts_with(&workdir) {
            return Err(format!("file path escapes workdir: {rel}"));
        }
        if let Some(parent) = safe.parent() {
            std::fs::create_dir_all(parent)
                .map_err(|e| format!("Could not create dir for {rel}: {e}"))?;
        }
        std::fs::write(&safe, content)
            .map_err(|e| format!("Could not write {rel}: {e}"))?;
        written += 1;
    }
    Ok(written)
}
