use std::{
  fs,
  path::{Path, PathBuf},
  sync::atomic::{AtomicBool, Ordering},
  thread,
  time::Duration,
};
use serde::Serialize;
use tauri::{Manager, webview::PageLoadEvent};

static NATIVE_SMOKE_READY: AtomicBool = AtomicBool::new(false);

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct NativeFile {
  filename: String,
  bytes: Vec<u8>,
}

fn safe_filename(filename: &str) -> Result<&str, String> {
  let path = Path::new(filename);
  if path.components().count() != 1 || filename.contains('/') || filename.contains('\\') {
    return Err("안전하지 않은 파일 이름입니다.".to_string());
  }
  Ok(filename)
}

#[tauri::command]
fn choose_project_folder() -> Option<String> {
  rfd::FileDialog::new()
    .set_title("AI Scene Director 프로젝트 폴더")
    .pick_folder()
    .map(|path| path.to_string_lossy().into_owned())
}

#[tauri::command]
fn write_project_file(path: String, filename: String, bytes: Vec<u8>) -> Result<String, String> {
  let filename = safe_filename(&filename)?;
  let directory = PathBuf::from(path);
  fs::create_dir_all(&directory).map_err(|error| error.to_string())?;
  let output = directory.join(filename);
  fs::write(&output, bytes).map_err(|error| error.to_string())?;
  Ok(output.to_string_lossy().into_owned())
}

#[tauri::command]
fn read_project_file() -> Result<Option<NativeFile>, String> {
  let Some(path) = rfd::FileDialog::new()
    .set_title("AI Scene Director 프로젝트 번들 열기")
    .add_filter("AI Scene Project", &["zip", "aiscene"])
    .pick_file() else { return Ok(None); };
  let bytes = fs::read(&path).map_err(|error| error.to_string())?;
  Ok(Some(NativeFile {
    filename: path.file_name().and_then(|name| name.to_str()).unwrap_or("project.aiscene.zip").to_string(),
    bytes,
  }))
}

fn native_smoke_report(status: &str, webview_loaded: bool, react_ready: bool, detail: &str) -> String {
  format!(
    "{{\n  \"status\": \"{}\",\n  \"runtime\": \"tauri\",\n  \"platform\": \"{}\",\n  \"version\": \"{}\",\n  \"webviewLoaded\": {},\n  \"reactReady\": {},\n  \"detail\": \"{}\"\n}}\n",
    status,
    std::env::consts::OS,
    env!("CARGO_PKG_VERSION"),
    webview_loaded,
    react_ready,
    detail,
  )
}

#[tauri::command]
fn native_smoke_ready(app: tauri::AppHandle) -> Result<bool, String> {
  let Some(path) = std::env::var_os("AISD_NATIVE_SMOKE_REPORT").map(PathBuf::from) else {
    return Ok(false);
  };
  if NATIVE_SMOKE_READY.swap(true, Ordering::SeqCst) {
    return Ok(true);
  }
  fs::write(&path, native_smoke_report("pass", true, true, "react app reported ready"))
    .map_err(|error| error.to_string())?;
  let app_handle = app.clone();
  thread::spawn(move || {
    thread::sleep(Duration::from_millis(800));
    app_handle.exit(0);
  });
  Ok(true)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
  let smoke_report_path = std::env::var_os("AISD_NATIVE_SMOKE_REPORT").map(PathBuf::from);
  let load_report_path = smoke_report_path.clone();
  let timeout_report_path = smoke_report_path.clone();

  let mut builder = tauri::Builder::default();
  if smoke_report_path.is_some() {
    NATIVE_SMOKE_READY.store(false, Ordering::SeqCst);
    builder = builder
      .on_page_load(move |_webview, payload| {
        if payload.event() != PageLoadEvent::Finished || NATIVE_SMOKE_READY.load(Ordering::SeqCst) {
          return;
        }
        if let Some(path) = &load_report_path {
          let _ = fs::write(path, native_smoke_report("loading", true, false, "webview loaded; waiting for react"));
        }
      })
      .setup(move |app| {
        let app_handle = app.handle().clone();
        thread::spawn(move || {
          thread::sleep(Duration::from_secs(25));
          if !NATIVE_SMOKE_READY.swap(true, Ordering::SeqCst) {
            if let Some(path) = timeout_report_path {
              let _ = fs::write(path, native_smoke_report("fail", true, false, "react readiness timeout"));
            }
            app_handle.exit(2);
          }
        });
        Ok(())
      });
  }

  builder
    .invoke_handler(tauri::generate_handler![
      choose_project_folder,
      write_project_file,
      read_project_file,
      native_smoke_ready,
    ])
    .run(tauri::generate_context!())
    .expect("error while running AI Scene Director");
}
