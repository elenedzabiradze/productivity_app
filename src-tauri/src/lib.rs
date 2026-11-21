// The desktop app's startup code.
//
// When the app opens it:
//   1. shows the built-in "Starting…" page (src-tauri/loading/index.html),
//   2. starts the bundled server program ("sidecar", built by
//      `npm run build:server`) unless a server is already running on port 3000,
//      telling it to keep data in the standard Mac app-data folder,
//   3. waits for the server to answer, then switches the window to it,
//   4. every 15 s, collects any "nudges" from the server and shows each as a
//      Mac notification (works even while the window is hidden).
// When the app quits, it stops the server it started.

use std::net::{SocketAddr, TcpStream};
use std::sync::Mutex;
use std::thread;
use std::time::{Duration, Instant};

use serde::Deserialize;
use tauri::{AppHandle, Manager, RunEvent};
use tauri_plugin_notification::NotificationExt;
use tauri_plugin_shell::process::CommandChild;
use tauri_plugin_shell::ShellExt;

// Where to collect nudges, and how often.
const NUDGES_URL: &str = "http://127.0.0.1:3000/api/nudges/due";
const NUDGE_CHECK_INTERVAL: Duration = Duration::from_secs(15);

// One nudge as the server sends it: { "title": "...", "body": "..." }
#[derive(Deserialize)]
struct Nudge {
  title: String,
  body: String,
}

// Asks the server for nudges that are due. Any problem (server not up yet,
// bad reply) is returned as an error, and the caller simply tries again later.
fn fetch_due_nudges() -> Result<Vec<Nudge>, Box<dyn std::error::Error>> {
  let text = ureq::get(NUDGES_URL).call()?.body_mut().read_to_string()?;
  Ok(serde_json::from_str(&text)?)
}

// Runs forever in the background: every 15 s, show any due nudges.
fn watch_for_nudges(app: AppHandle) {
  loop {
    thread::sleep(NUDGE_CHECK_INTERVAL);
    match fetch_due_nudges() {
      Ok(nudges) => {
        for nudge in nudges {
          if let Err(err) = app.notification().builder().title(&nudge.title).body(&nudge.body).show() {
            log::warn!("Could not show a notification: {err}");
          }
        }
      }
      Err(err) => log::debug!("No nudges collected this time: {err}"),
    }
  }
}

// The exact loopback address the server listens on (see HOST in server.js).
// "localhost" could also mean the newer-style address ::1, which the server
// doesn't listen on, so we use the precise one.
const SERVER_URL: &str = "http://127.0.0.1:3000/";

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
    .plugin(tauri_plugin_notification::init())
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

      // Start collecting nudges in the background (runs until the app quits).
      let handle = app.handle().clone();
      thread::spawn(move || watch_for_nudges(handle));

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
