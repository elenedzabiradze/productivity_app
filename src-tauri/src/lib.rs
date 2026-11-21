// The desktop app's startup code.
//
// When the app opens it:
//   1. shows the built-in "Starting…" page (src-tauri/loading/index.html),
//   2. starts the bundled server program ("sidecar", built by
//      `npm run build:server`) unless a server is already running on port 3000,
//      telling it to keep data in the standard Mac app-data folder,
//   3. waits for the server to answer, then switches the window to it.
// When the app quits, it stops the server it started.

use std::net::{SocketAddr, TcpStream};
use std::sync::Mutex;
use std::thread;
use std::time::{Duration, Instant};

use tauri::{Manager, RunEvent};
use tauri_plugin_shell::process::CommandChild;
use tauri_plugin_shell::ShellExt;

const SERVER_URL: &str = "http://localhost:3000/";

// How long to wait for the server before showing an error.
const STARTUP_TIMEOUT: Duration = Duration::from_secs(15);

// Remembers the server process we started (if any), so we can stop it on quit.
struct ServerProcess(Mutex<Option<CommandChild>>);

// True if something is answering on port 3000.
fn server_is_up() -> bool {
  let addr: SocketAddr = "127.0.0.1:3000".parse().unwrap();
  TcpStream::connect_timeout(&addr, Duration::from_millis(200)).is_ok()
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
  tauri::Builder::default()
    .plugin(tauri_plugin_shell::init())
    .setup(|app| {
      if cfg!(debug_assertions) {
        app.handle().plugin(
          tauri_plugin_log::Builder::default()
            .level(log::LevelFilter::Info)
            .build(),
        )?;
      }

      // ~/Library/Application Support/com.productivitytracker.desktop/
      let data_dir = app.path().app_data_dir()?;
      std::fs::create_dir_all(&data_dir)?;

      // Start our own server only if none is running (e.g. `node server.js`
      // during development) — two servers can't share port 3000.
      let child = if server_is_up() {
        log::info!("A server is already running on port 3000 — using it.");
        None
      } else {
        let (_output, child) = app
          .shell()
          .sidecar("server")?
          .env("DATA_DIR", data_dir.to_string_lossy().to_string())
          .spawn()?;
        Some(child)
      };
      app.manage(ServerProcess(Mutex::new(child)));

      // Wait for the server in the background (so the window stays
      // responsive), then show the tracker — or an error if it never answers.
      let window = app
        .get_webview_window("main")
        .expect("the main window should exist");
      thread::spawn(move || {
        let started = Instant::now();
        while started.elapsed() < STARTUP_TIMEOUT {
          if server_is_up() {
            let _ = window.navigate(tauri::Url::parse(SERVER_URL).unwrap());
            return;
          }
          thread::sleep(Duration::from_millis(200));
        }
        let _ = window.eval("showStartupError()");
      });

      Ok(())
    })
    .build(tauri::generate_context!())
    .expect("error while building tauri application")
    .run(|app, event| {
      // On quit, stop the server we started (not one started by hand).
      if let RunEvent::Exit = event {
        if let Some(child) = app.state::<ServerProcess>().0.lock().unwrap().take() {
          let _ = child.kill();
        }
      }
    });
}
