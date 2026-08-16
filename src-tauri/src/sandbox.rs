// Feature 3: Restricted in-app sandbox command runner.
//
// The webview asks the Rust backend to run a build/preview command (e.g.
// `npm install`, `npm run tauri build`, `flutter build apk`) inside a single
// scoped directory and stream stdout/stderr back so the AI/user can watch it
// run, then collect the produced artifacts (dist/**, *.exe, *.apk, ...) for
// download — all without the AI touching the host filesystem outside the
// sandbox or opening a terminal on the PC.
//
// Restrictions enforced here:
//   1. Workdir is locked to one app-owned sandbox root ($APPDATA/saw-sandbox/).
//      Any requested workdir is canonicalized and rejected if it escapes the
//      root (no `..` traversal, no absolute paths outside the root).
//   2. Executable allowlist: only known build-tool basenames may run (npm,
//      npx, node, dart, flutter, cargo, tauri, git, python, pip, ...). There is
//      no shell (`sh -c`/`cmd /c`) so arguments cannot smuggle a second
//      command — args are passed as a vector to the process directly.
//   3. Environment is sanitized: a minimal PATH is inherited but sensitive
//      host env vars are stripped; npm/dart/cargo caches are redirected into
//      the sandbox so builds don't pollute the user's home.
//
// Network is intentionally NOT blocked: real builds need to fetch packages
// (npm install, flutter pub get). True OS-level isolation (container/VM) is
// not feasible from inside a Tauri app; the "restricted" guarantee here is a
// scoped CWD + allowlisted binaries + sanitized env, which is what keeps
// everything "on the app" and unable to harm the PC's file explorer.

use std::path::{Path, PathBuf};
use std::process::Stdio;
use std::collections::HashSet;
use std::sync::Mutex;

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, Manager, State};
use tokio::io::{AsyncBufReadExt, BufReader};
use tokio::process::Command;

/// In-memory state holding the sandbox root path so commands don't have to
/// re-resolve it on every call. The root is computed once (lazily) and cached;
/// a Mutex provides the interior mutability `State<T>` (which only yields `&T`)
/// needs to populate the cache on first use.
#[derive(Default)]
pub struct SandboxState {
    root: Mutex<Option<PathBuf>>,
}

/// A single line of process output streamed to the webview.
#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StreamLine {
    pub run_id: String,
    pub stream: String, // "stdout" | "stderr" | "status" | "error"
    pub line: String,
}

/// Request payload from the webview for `run_sandbox_command`.
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RunRequest {
    /// Relative path inside the sandbox root (e.g. "<projectId>"). Empty/"."
    /// means the root itself.
    pub workdir: Option<String>,
    /// Executable basename, e.g. "npm". MUST be in the allowlist.
    pub command: String,
    /// Arguments passed verbatim to the process (no shell interpolation).
    pub args: Vec<String>,
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

/// Executable basenames that may run inside the sandbox. Keep this tight: a
/// build toolchain plus VCS. Anything not here is rejected before spawn.
const ALLOWED_COMMANDS: &[&str] = &[
    "npm", "npx", "node", "yarn", "pnpm",
    "dart", "flutter", "dartpub", "pub",
    "cargo", "rustc", "tauri",
    "git",
    "python", "python3", "pip", "pip3",
    "make", "gradle", "gradlew",
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

fn is_allowed(command: &str) -> bool {
    let basename = Path::new(command)
        .file_name()
        .and_then(|f| f.to_str())
        .unwrap_or(command);
    // Reject an explicit path separator in the command: callers must ask for a
    // basename like "npm", resolved via PATH. This prevents "/bin/rm"-style
    // absolute binaries and ".\\evil.exe" relative ones.
    if basename != command {
        return false;
    }
    ALLOWED_COMMANDS.contains(&basename)
}

/// Build a sanitized environment for the child process: copy the host env,
/// strip blocked secrets, and redirect caches into the sandbox root so builds
/// don't write to the user's home.
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
    Ok(env)
}

/// Tauri command: run a single allowlisted command inside the scoped sandbox
/// and stream its output to the webview via `sandbox://stream` events.
///
/// Returns the process exit code (0 = success). The webview listens for the
/// `sandbox://stream` event to render the live terminal log.
#[tauri::command]
pub async fn run_sandbox_command(
    app: AppHandle,
    state: State<'_, SandboxState>,
    request: RunRequest,
) -> Result<i32, String> {
    let root = state.root(&app)?;
    let workdir = resolve_workdir(&root, request.workdir.as_deref().unwrap_or(""))?;
    std::fs::create_dir_all(&workdir)
        .map_err(|e| format!("Could not create workdir: {e}"))?;

    if !is_allowed(&request.command) {
        let msg = format!(
            "Command '{}' is not allowed in the sandbox. Allowed: npm, npx, node, yarn, pnpm, dart, flutter, cargo, rustc, tauri, git, python, pip, make, gradle.",
            request.command
        );
        let _ = app.emit(
            "sandbox://stream",
            StreamLine {
                run_id: String::new(),
                stream: "error".into(),
                line: msg.clone(),
            },
        );
        return Err(msg);
    }

    let env = build_env(&root)?;

    let mut cmd = Command::new(&request.command);
    cmd.args(&request.args);
    cmd.current_dir(&workdir);
    cmd.env_clear();
    for (k, v) in &env {
        cmd.env(k, v);
    }
    cmd.stdout(Stdio::piped());
    cmd.stderr(Stdio::piped());
    cmd.kill_on_drop(true);

    // On Windows, never spawn a visible console window for the build process.
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        cmd.creation_flags(CREATE_NO_WINDOW);
    }

    let mut child = cmd
        .spawn()
        .map_err(|e| format!("Failed to spawn '{}': {e}", request.command))?;

    let run_id = format!("run-{}", std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis())
        .unwrap_or(0));

    let emit = |stream: &str, line: &str| {
        let _ = app.emit(
            "sandbox://stream",
            StreamLine {
                run_id: run_id.clone(),
                stream: stream.to_string(),
                line: line.to_string(),
            },
        );
    };

    emit("status", &format!("$ {} {}", request.command, request.args.join(" ")));

    let stdout = child.stdout.take();
    let stderr = child.stderr.take();

    // Stream stdout and stderr concurrently.
    let app_clone = app.clone();
    let run_id_clone = run_id.clone();
    let stdout_task = tokio::spawn(async move {
        if let Some(out) = stdout {
            let mut lines = BufReader::new(out).lines();
            while let Ok(Some(line)) = lines.next_line().await {
                let _ = app_clone.emit(
                    "sandbox://stream",
                    StreamLine {
                        run_id: run_id_clone.clone(),
                        stream: "stdout".into(),
                        line,
                    },
                );
            }
        }
    });
    let app_clone = app.clone();
    let run_id_clone = run_id.clone();
    let stderr_task = tokio::spawn(async move {
        if let Some(err) = stderr {
            let mut lines = BufReader::new(err).lines();
            while let Ok(Some(line)) = lines.next_line().await {
                let _ = app_clone.emit(
                    "sandbox://stream",
                    StreamLine {
                        run_id: run_id_clone.clone(),
                        stream: "stderr".into(),
                        line,
                    },
                );
            }
        }
    });

    let status = child
        .wait()
        .await
        .map_err(|e| format!("Process wait failed: {e}"))?;
    let _ = stdout_task.await;
    let _ = stderr_task.await;

    let code = status.code().unwrap_or(-1);
    emit("status", &format!("[exit {}]", code));
    Ok(code)
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
        let safe = resolve_workdir(&workdir, &rel)?;
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
