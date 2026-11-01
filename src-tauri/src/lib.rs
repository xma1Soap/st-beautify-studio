use std::collections::{HashMap, HashSet};
use std::path::PathBuf;
use std::sync::{Arc, Mutex};
use std::time::Duration;

use tauri::ipc::{Channel, Response};
use tauri::{State, Window};
use tokio::sync::Notify;
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

/* ---------- AI assistant ---------- */

/// Requests to the AI endpoint that are still running, so the page can stop one.
#[derive(Default)]
struct AiJobs(Mutex<HashMap<u32, Arc<Notify>>>);

/// What the page hears about a request: the HTTP status first, then the reply as it arrives, then the end
/// (the page waits for `End`, since channel messages may arrive after the command itself returns).
#[derive(serde::Serialize, Clone)]
#[serde(tag = "t", rename_all = "lowercase")]
enum AiEvent {
    Status { code: u16 },
    Data { text: String },
    End,
}

/// Only an OpenAI-style chat endpoint (POST …/chat/completions) or its model list (GET …/models),
/// so a page shown in the preview can't use this to reach other addresses.
fn ai_url(url: &str) -> Result<(reqwest::Url, bool), String> {
    let u = reqwest::Url::parse(url.trim()).map_err(|_| "BAD_URL".to_string())?;
    if !matches!(u.scheme(), "http" | "https") {
        return Err("BAD_URL".into());
    }
    let path = u.path().trim_end_matches('/').to_string();
    if path.ends_with("/chat/completions") {
        Ok((u, true))
    } else if path.ends_with("/models") {
        Ok((u, false))
    } else {
        Err("BAD_URL".into())
    }
}

/// The error and what caused it ("error sending request" alone says little).
fn err_text(e: &reqwest::Error) -> String {
    let mut s = e.to_string();
    let mut src = std::error::Error::source(e);
    while let Some(x) = src {
        s.push_str(": ");
        s.push_str(&x.to_string());
        src = x.source();
    }
    s
}

/// Send a request to the AI endpoint the user set up and pass the reply on piece by piece (it streams).
/// Done in Rust so endpoints that don't allow browser pages (CORS) still work. The key is not kept here.
#[tauri::command]
async fn ai_fetch(jobs: State<'_, AiJobs>, id: u32, url: String, key: String, body: Option<String>, on_event: Channel<AiEvent>) -> Result<(), String> {
    let (u, post) = ai_url(&url)?;
    let stop = Arc::new(Notify::new());
    jobs.0.lock().unwrap().insert(id, stop.clone());
    let work = async {
        let client = reqwest::Client::builder()
            .connect_timeout(Duration::from_secs(30))
            .read_timeout(Duration::from_secs(300))
            .build()
            .map_err(|e| err_text(&e))?;
        let mut req = if post {
            client.post(u).header("content-type", "application/json").body(body.unwrap_or_default())
        } else {
            client.get(u)
        };
        if !key.trim().is_empty() {
            req = req.bearer_auth(key.trim());
        }
        let mut res = req.send().await.map_err(|e| err_text(&e))?;
        let send = |ev: AiEvent| on_event.send(ev).map_err(|e| e.to_string());
        send(AiEvent::Status { code: res.status().as_u16() })?;
        // a chunk can end in the middle of a character; keep those bytes for the next one
        let mut rest: Vec<u8> = Vec::new();
        while let Some(chunk) = res.chunk().await.map_err(|e| err_text(&e))? {
            rest.extend_from_slice(&chunk);
            let n = match std::str::from_utf8(&rest) {
                Ok(_) => rest.len(),
                Err(e) if e.error_len().is_none() => e.valid_up_to(),
                Err(_) => rest.len(),
            };
            if n > 0 {
                let text = String::from_utf8_lossy(&rest[..n]).into_owned();
                rest.drain(..n);
                send(AiEvent::Data { text })?;
            }
        }
        if !rest.is_empty() {
            send(AiEvent::Data { text: String::from_utf8_lossy(&rest).into_owned() })?;
        }
        send(AiEvent::End)
    };
    let out = tokio::select! {
        r = work => r,
        _ = stop.notified() => Err("CANCELLED".to_string()),
    };
    jobs.0.lock().unwrap().remove(&id);
    out
}

/// Stop a request started with ai_fetch.
#[tauri::command]
fn ai_cancel(jobs: State<'_, AiJobs>, id: u32) {
    if let Some(n) = jobs.0.lock().unwrap().get(&id) {
        n.notify_one();
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .manage(Allowed::default())
        .manage(AiJobs::default())
        .invoke_handler(tauri::generate_handler![pick_files, pick_save_path, read_file, write_text_file, write_file, ai_fetch, ai_cancel])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
