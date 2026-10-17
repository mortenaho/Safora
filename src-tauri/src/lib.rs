use std::{
    fs::{self, OpenOptions},
    io::Write,
    path::{Path, PathBuf},
};

use serde::Serialize;
use tauri::{Manager, State};
use std::sync::Mutex;

#[derive(Serialize)]
struct WriteReport {
    synced: bool,
    message: String,
}

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

fn home_dir() -> Result<PathBuf, String> {
    std::env::var_os("HOME")
        .map(PathBuf::from)
        .filter(|path| path.is_dir())
        .ok_or_else(|| "Could not resolve the home directory.".to_string())
}

fn folder_inside_home(folder: &str) -> Result<PathBuf, String> {
    let trimmed = folder.trim();
    if trimmed.is_empty() {
        return Err("Choose a OneDrive or Google Drive folder.".to_string());
    }
    let home = home_dir()?.canonicalize().map_err(|error| format!("Could not resolve the home directory: {error}"))?;
    let path = PathBuf::from(trimmed);
    if !path.is_dir() {
        return Err("That folder does not exist.".to_string());
    }
    let canonical = path.canonicalize().map_err(|error| format!("Could not open that folder: {error}"))?;
    if !canonical.starts_with(&home) {
        return Err("Choose a folder inside your home directory.".to_string());
    }
    Ok(canonical)
}

fn write_private_file(path: &Path, contents: &str) -> Result<(), String> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|error| format!("Could not create the sync folder: {error}"))?;
    }
    let temp_path = path.with_extension("enc.tmp");
    let mut options = OpenOptions::new();
    options.write(true).create(true).truncate(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        options.mode(0o600);
    }
    let mut file = options.open(&temp_path).map_err(|error| format!("Could not open the sync file: {error}"))?;
    file.write_all(contents.as_bytes()).map_err(|error| format!("Could not write the sync file: {error}"))?;
    file.sync_all().map_err(|error| format!("Could not flush the sync file: {error}"))?;
    drop(file);
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        fs::set_permissions(&temp_path, fs::Permissions::from_mode(0o600))
            .map_err(|error| format!("Could not secure the sync file: {error}"))?;
    }
    fs::rename(&temp_path, path).map_err(|error| format!("Could not replace the sync file: {error}"))?;
    Ok(())
}

fn copy_encrypted_vault(contents: &str, folder: &Path) -> Result<(), String> {
    let dest_dir = folder.join("Safora");
    write_private_file(&dest_dir.join("vault.enc"), contents)
}

#[tauri::command]
fn check_sync_folder(folder: String) -> Result<String, String> {
    Ok(folder_inside_home(&folder)?.to_string_lossy().into_owned())
}

#[tauri::command]
fn suggest_sync_folder(provider: String) -> Option<String> {
    let home = home_dir().ok()?;
    let names: &[&str] = match provider.as_str() {
        "onedrive" => &["OneDrive", "OneDrive - Personal"],
        "google-drive" => &["Google Drive", "GoogleDrive", "My Drive"],
        _ => return None,
    };
    names
        .iter()
        .map(|name| home.join(name))
        .find(|path| path.is_dir())
        .map(|path| path.to_string_lossy().into_owned())
}

#[tauri::command]
fn write_vault(app: tauri::AppHandle, state: State<'_, VaultPath>, contents: String, sync_folder: Option<String>) -> Result<WriteReport, String> {
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

    let Some(folder) = sync_folder.filter(|value| !value.trim().is_empty()) else {
        return Ok(WriteReport { synced: false, message: String::new() });
    };
    match folder_inside_home(&folder).and_then(|path| copy_encrypted_vault(&contents, &path)) {
        Ok(()) => Ok(WriteReport { synced: true, message: String::new() }),
        Err(error) => Ok(WriteReport {
            synced: false,
            message: format!("Saved on this device. The cloud copy failed: {error}"),
        }),
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .manage(VaultPath(Mutex::new(None)))
        .invoke_handler(tauri::generate_handler![read_vault, write_vault, check_sync_folder, suggest_sync_folder])
        .run(tauri::generate_context!())
        .expect("error while running Safora");
}
