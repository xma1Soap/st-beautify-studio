use std::collections::HashSet;
use std::path::PathBuf;
use std::sync::Mutex;

use tauri::ipc::Response;
use tauri::{State, Window};
use tauri_plugin_dialog::{DialogExt, FileDialogBuilder, FilePath};

/// Paths the user picked in an open/save dialog during this run.
/// Reads and writes are limited to these, so scripts inside a preview card
/// cannot touch arbitrary files on the user's computer.
#[derive(Default)]
struct Allowed(Mutex<HashSet<PathBuf>>);

impl Allowed {
    fn add(&self, p: &PathBuf) {
        self.0.lock().unwrap().insert(p.clone());
    }
    fn check(&self, path: &str) -> Result<PathBuf, String> {
        let p = PathBuf::from(path);
        if self.0.lock().unwrap().contains(&p) {
            Ok(p)
        } else {
            Err("NOT_ALLOWED".into())
        }
    }
}

#[derive(serde::Deserialize)]
struct Filter {
    name: String,
    extensions: Vec<String>,
}

fn with_filters<R: tauri::Runtime>(mut b: FileDialogBuilder<R>, filters: &[Filter]) -> FileDialogBuilder<R> {
    for f in filters {
        let ext: Vec<&str> = f.extensions.iter().map(String::as_str).collect();
        b = b.add_filter(&f.name, &ext);
    }
    b
}

fn to_path(p: FilePath) -> Result<PathBuf, String> {
    p.into_path().map_err(|e| e.to_string())
}

/// Show the open dialog. Returns the chosen paths and remembers them as readable.
#[tauri::command]
async fn pick_files(window: Window, allowed: State<'_, Allowed>, multiple: bool, filters: Vec<Filter>) -> Result<Vec<String>, String> {
    let b = with_filters(window.dialog().file().set_parent(&window), &filters);
    let picked = if multiple { b.blocking_pick_files() } else { b.blocking_pick_file().map(|p| vec![p]) };
    let mut out = Vec::new();
    for p in picked.unwrap_or_default() {
        let p = to_path(p)?;
        allowed.add(&p);
        out.push(p.to_string_lossy().into_owned());
    }
    Ok(out)
}

/// Show the save dialog. Returns the chosen path (or None if cancelled) and remembers it as writable.
#[tauri::command]
async fn pick_save_path(window: Window, allowed: State<'_, Allowed>, default_path: String, filters: Vec<Filter>) -> Result<Option<String>, String> {
    let mut b = with_filters(window.dialog().file().set_parent(&window), &filters);
    let d = PathBuf::from(&default_path);
    if let Some(name) = d.file_name() {
        b = b.set_file_name(name.to_string_lossy());
    }
    if let Some(dir) = d.parent().filter(|x| x.is_dir()) {
        b = b.set_directory(dir);
    }
    match b.blocking_save_file() {
        None => Ok(None),
        Some(p) => {
            let p = to_path(p)?;
            allowed.add(&p);
            Ok(Some(p.to_string_lossy().into_owned()))
        }
    }
}

/// Read a file the user picked (JSON, PNG card) and hand the raw bytes to the page.
#[tauri::command]
fn read_file(allowed: State<'_, Allowed>, path: String) -> Result<Response, String> {
    let p = allowed.check(&path)?;
    std::fs::read(p).map(Response::new).map_err(|e| e.to_string())
}

/// Write a project or exported regex file to a path the user chose.
#[tauri::command]
fn write_text_file(allowed: State<'_, Allowed>, path: String, content: String) -> Result<(), String> {
    let p = allowed.check(&path)?;
    std::fs::write(p, content).map_err(|e| e.to_string())
}

/// Write an exported card (PNG) to a path the user chose.
#[tauri::command]
fn write_file(allowed: State<'_, Allowed>, path: String, bytes: Vec<u8>) -> Result<(), String> {
    let p = allowed.check(&path)?;
    std::fs::write(p, bytes).map_err(|e| e.to_string())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .manage(Allowed::default())
        .invoke_handler(tauri::generate_handler![pick_files, pick_save_path, read_file, write_text_file, write_file])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
