// The menu bar timer ("tray icon" in Tauri's words).
//
// Shows a small stopwatch at the top right of the screen. While a session
// timer runs, the elapsed time is shown next to it (e.g. "25:14"). Clicking it
// opens a menu: Stop / Start again, Open Productivity Tracker, Quit.
//
// It doesn't keep any timer state of its own: it asks the server
// (GET /api/menu-state) every 5 s and counts the seconds in between, and the
// Stop / Start again items call the server too — the same place the window uses,
// so the two always agree.

use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::thread;
use std::time::{Duration, Instant};

use serde::Deserialize;
use tauri::image::Image;
use tauri::menu::{Menu, MenuItem, PredefinedMenuItem};
use tauri::tray::TrayIconBuilder;
use tauri::{AppHandle, Manager, Wry};

const TRAY_ID: &str = "timer";
const MENU_STATE_URL: &str = "http://127.0.0.1:3000/api/menu-state";
const STOP_URL: &str = "http://127.0.0.1:3000/api/active/stop";
const RESTART_URL: &str = "http://127.0.0.1:3000/api/active/restart-last";
// How often to ask the server; the seconds in between are counted locally.
const REFRESH_EVERY: Duration = Duration::from_secs(5);

// What GET /api/menu-state sends back.
#[derive(Deserialize, Clone, PartialEq)]
struct Task {
  task: String,
  category: String,
}

#[derive(Deserialize)]
struct MenuState {
  active: Option<Task>,
  #[serde(rename = "elapsedMs")]
  elapsed_ms: u64,
  last: Option<Task>,
}

// Set by the menu's Stop / Start again, so the title updates right away
// instead of waiting for the next 5-second check.
#[derive(Clone)]
pub struct RefreshNow(Arc<AtomicBool>);

// "25:14", or "1:05:09" after an hour.
fn format_elapsed(total_seconds: u64) -> String {
  let h = total_seconds / 3600;
  let m = (total_seconds % 3600) / 60;
  let s = total_seconds % 60;
  if h > 0 {
    format!("{h}:{m:02}:{s:02}")
  } else {
    format!("{m:02}:{s:02}")
  }
}

fn fetch_menu_state() -> Result<MenuState, Box<dyn std::error::Error>> {
  let text = ureq::get(MENU_STATE_URL).call()?.body_mut().read_to_string()?;
  Ok(serde_json::from_str(&text)?)
}

// Builds the menu for the current situation.
fn build_menu(app: &AppHandle, state: Option<&MenuState>) -> tauri::Result<Menu<Wry>> {
  let menu = Menu::new(app)?;
  match state {
    Some(MenuState { active: Some(t), .. }) => {
      // A timer is running: say what, and offer Stop.
      let label = format!("Working on: {} ({})", t.task, t.category);
      menu.append(&MenuItem::with_id(app, "info", label, false, None::<&str>)?)?;
      menu.append(&MenuItem::with_id(app, "stop", "Stop", true, None::<&str>)?)?;
      menu.append(&PredefinedMenuItem::separator(app)?)?;
    }
    Some(MenuState { active: None, last: Some(t), .. }) => {
      // No timer: offer to restart the last task.
      let label = format!("Start again: {} ({})", t.task, t.category);
      menu.append(&MenuItem::with_id(app, "restart", label, true, None::<&str>)?)?;
      menu.append(&PredefinedMenuItem::separator(app)?)?;
    }
    _ => {} // no timer and no previous task (or the server isn't up yet)
  }
  menu.append(&MenuItem::with_id(app, "open", "Open Productivity Tracker", true, None::<&str>)?)?;
  menu.append(&PredefinedMenuItem::separator(app)?)?;
  menu.append(&MenuItem::with_id(app, "quit", "Quit", true, None::<&str>)?)?;
  Ok(menu)
}

// Shows the main window again (after it was closed/hidden or minimised).
pub fn show_main_window(app: &AppHandle) {
  if let Some(window) = app.get_webview_window("main") {
    let _ = window.show();
    let _ = window.unminimize();
    let _ = window.set_focus();
  }
}

// Sends Stop / Start again to the server in the background (so the menu never
// freezes), then asks for an immediate refresh.
fn post_in_background(url: &'static str, refresh: RefreshNow) {
  thread::spawn(move || {
    if let Err(err) = ureq::post(url).send_empty() {
      log::warn!("Menu bar action failed ({url}): {err}");
    }
    refresh.0.store(true, Ordering::SeqCst);
  });
}

// Creates the menu bar item and starts the background loop that keeps it current.
pub fn setup(app: &tauri::App) -> tauri::Result<()> {
  let handle = app.handle().clone();
  let refresh = RefreshNow(Arc::new(AtomicBool::new(true)));

  // Black stopwatch on transparent; "template" lets macOS recolour it.
  let icon = Image::from_bytes(include_bytes!("../icons/tray-icon.png"))?;
  let menu_refresh = refresh.clone();
  TrayIconBuilder::with_id(TRAY_ID)
    .icon(icon)
    .icon_as_template(true)
    .menu(&build_menu(&handle, None)?)
    .tooltip("Productivity Tracker")
    .on_menu_event(move |app, event| match event.id().as_ref() {
      "stop" => post_in_background(STOP_URL, menu_refresh.clone()),
      "restart" => post_in_background(RESTART_URL, menu_refresh.clone()),
      "open" => show_main_window(app),
      "quit" => app.exit(0),
      _ => {}
    })
    .build(app)?;

  // Background loop: once a second update the time; every 5 s (or right after
  // Stop / Start again) ask the server and rebuild the menu if anything changed.
  thread::spawn(move || {
    let mut last_fetch = Instant::now() - REFRESH_EVERY; // fetch straight away
    let mut fetched_at = Instant::now();
    let mut state: Option<MenuState> = None;
    let mut shown_menu_key = String::new();

    loop {
      let due = last_fetch.elapsed() >= REFRESH_EVERY || refresh.0.swap(false, Ordering::SeqCst);
      if due {
        last_fetch = Instant::now();
        match fetch_menu_state() {
          Ok(s) => {
            state = Some(s);
            fetched_at = Instant::now();
          }
          Err(err) => log::debug!("Menu state not available yet: {err}"),
        }

        // Rebuild the menu only when what it shows has changed.
        let key = match &state {
          Some(MenuState { active: Some(t), .. }) => format!("run:{}:{}", t.task, t.category),
          Some(MenuState { last: Some(t), .. }) => format!("last:{}:{}", t.task, t.category),
          _ => "none".to_string(),
        };
        if key != shown_menu_key {
          if let (Some(tray), Ok(menu)) = (handle.tray_by_id(TRAY_ID), build_menu(&handle, state.as_ref())) {
            let _ = tray.set_menu(Some(menu));
            shown_menu_key = key;
          }
        }
      }

      // The time next to the icon: counted on from the server's elapsedMs.
      let title = match &state {
        Some(s) if s.active.is_some() => {
          let seconds = (s.elapsed_ms / 1000) + fetched_at.elapsed().as_secs();
          Some(format_elapsed(seconds))
        }
        _ => None, // no timer: icon only
      };
      if let Some(tray) = handle.tray_by_id(TRAY_ID) {
        let _ = tray.set_title(title.as_deref());
      }

      thread::sleep(Duration::from_secs(1));
    }
  });

  Ok(())
}
