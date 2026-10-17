use std::{
    fs::{self, OpenOptions},
    io::Write,
    path::PathBuf,
};

use tauri::{Manager, State};
use std::sync::Mutex;

struct VaultPath(Mutex<Option<PathBuf>>);

fn vault_file_path(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    let dir = app.path().app_data_dir().map_err(|e| format!("Could not resolve app data directory: {e}"))?;
    fs::create_dir_all(&dir).map_err(|e| format!("Could not create app data directory: {e}"))?;
    Ok(dir.join("vault.json"))
}

#[tauri::command]
fn read_vault(app: tauri::AppHandle, state: State<'_, VaultPath>) -> Result<Option<String>, String> {
    let path = vault_file_path(&app)?;
    *state.0.lock().map_err(|_| "Vault path lock poisoned".to_string())? = Some(path.clone());

    match fs::read_to_string(&path) {
        Ok(contents) => Ok(Some(contents)),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(None),
        Err(error) => Err(format!("Could not read encrypted vault: {error}")),
    }
}

#[tauri::command]
fn write_vault(app: tauri::AppHandle, state: State<'_, VaultPath>, contents: String) -> Result<(), String> {
    // Only accept the encrypted JSON envelope produced by the frontend.
    let parsed: serde_json::Value = serde_json::from_str(&contents)
        .map_err(|_| "Vault payload is not valid JSON".to_string())?;
    if parsed.get("version").and_then(|v| v.as_u64()) != Some(1)
        || parsed.get("ciphertext").and_then(|v| v.as_str()).is_none()
        || parsed.get("salt").and_then(|v| v.as_str()).is_none()
        || parsed.get("iv").and_then(|v| v.as_str()).is_none()
    {
        return Err("Refusing to write an invalid or unencrypted vault payload".to_string());
    }

    let path = vault_file_path(&app)?;
    *state.0.lock().map_err(|_| "Vault path lock poisoned".to_string())? = Some(path.clone());
    let temp_path = path.with_extension("json.tmp");

    let mut options = OpenOptions::new();
    options.write(true).create(true).truncate(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        options.mode(0o600);
    }

    let mut file = options.open(&temp_path).map_err(|e| format!("Could not open temporary vault file: {e}"))?;
    file.write_all(contents.as_bytes()).map_err(|e| format!("Could not write encrypted vault: {e}"))?;
    file.sync_all().map_err(|e| format!("Could not flush encrypted vault: {e}"))?;
    drop(file);

    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        fs::set_permissions(&temp_path, fs::Permissions::from_mode(0o600))
            .map_err(|e| format!("Could not secure vault file permissions: {e}"))?;
    }

    fs::rename(&temp_path, &path).map_err(|e| format!("Could not replace vault file: {e}"))?;
    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .manage(VaultPath(Mutex::new(None)))
        .invoke_handler(tauri::generate_handler![read_vault, write_vault])
        .run(tauri::generate_context!())
        .expect("error while running MoriVault");
}
