use serde::Serialize;
use sha2::{Digest, Sha256};
use std::{fs, path::PathBuf};
use sysinfo::Disks;
use tauri::{AppHandle, Manager};
use tauri_plugin_opener::OpenerExt;
use uuid::Uuid;

#[derive(Serialize)]
struct DriveInfo {
    drive_key: String,
    volume_name: String,
    mount_point: String,
    filesystem: String,
    total_bytes: u64,
    available_bytes: u64,
    is_removable: bool,
}

#[derive(Serialize)]
struct StorageContext {
    device_key: String,
    device_name: String,
    platform: String,
    app_version: String,
    drives: Vec<DriveInfo>,
}

fn platform_name() -> &'static str {
    #[cfg(target_os = "macos")]
    { "macos" }
    #[cfg(target_os = "windows")]
    { "windows" }
    #[cfg(target_os = "linux")]
    { "linux" }
}

fn persistent_device_key(app: &AppHandle) -> Result<String, String> {
    let data_dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
    fs::create_dir_all(&data_dir).map_err(|e| e.to_string())?;
    let key_file = data_dir.join("device-key.txt");
    if let Ok(existing) = fs::read_to_string(&key_file) {
        let value = existing.trim();
        if !value.is_empty() {
            return Ok(value.to_string());
        }
    }
    let value = Uuid::new_v4().to_string();
    fs::write(&key_file, &value).map_err(|e| e.to_string())?;
    Ok(value)
}

#[tauri::command]
fn get_storage_context(app: AppHandle) -> Result<StorageContext, String> {
    let device_key = persistent_device_key(&app)?;
    let device_name = hostname::get()
        .map(|name| name.to_string_lossy().into_owned())
        .unwrap_or_else(|_| "This computer".to_string());

    let disks = Disks::new_with_refreshed_list();
    let drives = disks.list().iter().map(|disk| {
        let volume_name = disk.name().to_string_lossy().into_owned();
        let mount_point = disk.mount_point().to_string_lossy().into_owned();
        let filesystem = disk.file_system().to_string_lossy().into_owned();
        let stable_parts = format!(
            "{}|{}|{}|{}",
            volume_name,
            filesystem,
            disk.total_space(),
            mount_point
        );
        let digest = Sha256::digest(stable_parts.as_bytes());
        let drive_key = format!("{:x}", digest);
        DriveInfo {
            drive_key,
            volume_name: if volume_name.is_empty() { "Local volume".to_string() } else { volume_name },
            mount_point,
            filesystem,
            total_bytes: disk.total_space(),
            available_bytes: disk.available_space(),
            is_removable: disk.is_removable(),
        }
    }).collect();

    Ok(StorageContext {
        device_key,
        device_name,
        platform: platform_name().to_string(),
        app_version: env!("CARGO_PKG_VERSION").to_string(),
        drives,
    })
}

#[tauri::command]
fn open_storage_folder(
    app: AppHandle,
    root_path: String,
    relative_path: String
) -> Result<(), String> {
    let requested_root = PathBuf::from(root_path.trim());
    let relative = PathBuf::from(relative_path.trim());
    if !requested_root.is_absolute() || relative.is_absolute() {
        return Err("The saved storage location is not a valid local relative path.".to_string());
    }
    if relative.components().any(|part| matches!(part, std::path::Component::ParentDir | std::path::Component::Prefix(_))) {
        return Err("The saved folder path contains an invalid parent or drive segment.".to_string());
    }

    let canonical_root = fs::canonicalize(&requested_root)
        .map_err(|_| "Drive is unavailable. Connect the registered drive and try again.".to_string())?;
    let canonical = fs::canonicalize(canonical_root.join(relative))
        .map_err(|_| "Folder is unavailable. Connect the registered drive and try again.".to_string())?;
    if !canonical.starts_with(&canonical_root) {
        return Err("The selected folder is outside its registered drive root.".to_string());
    }
    if !canonical.is_dir() {
        return Err("The registered location is not a folder.".to_string());
    }

    // Only open folders on currently mounted volumes; never execute shell commands.
    let disks = Disks::new_with_refreshed_list();
    let mounted = disks.list().iter().any(|disk| canonical_root.starts_with(disk.mount_point()));
    if !mounted {
        return Err("The folder is not on a currently mounted drive.".to_string());
    }

    app.opener()
        .open_path(canonical.to_string_lossy().to_string(), None::<&str>)
        .map_err(|e| format!("Could not open the folder: {e}"))
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![
            get_storage_context,
            open_storage_folder
        ])
        .run(tauri::generate_context!())
        .expect("error while running Sakkhi Desktop");
}

fn main() {
    run();
}
