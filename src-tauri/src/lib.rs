mod sandbox;

use sandbox::SandboxState;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_http::init())
        .manage(SandboxState::default())
        .invoke_handler(tauri::generate_handler![
            sandbox::run_sandbox_command,
            sandbox::list_sandbox_artifacts,
            sandbox::write_sandbox_files,
            sandbox::close_sandbox_session,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
