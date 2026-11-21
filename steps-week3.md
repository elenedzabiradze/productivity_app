# Build Steps: Week 3 — Native desktop window (Tauri)

## Goal
Open the Focus Session Tracker in its own native macOS window instead of a
browser tab. For now the window shows http://localhost:3000, so the Node
server (`node server.js`) still has to be running — bundling it into the app
is a later stage.

## Steps

1. **Install Rust** (Tauri is built with it) using the official installer, `rustup`.
   Confirm `rustc --version` and `cargo --version` work.
   Already present: Xcode Command Line Tools, Node 26, npm 11.

2. **Add Tauri to the project**
   - Install the Tauri command-line tool as a dev dependency (`@tauri-apps/cli`).
   - Run `tauri init` to create the `src-tauri/` folder (Rust code + `tauri.conf.json`).
   - Point the window at http://localhost:3000 (both for development and for the built app).
   - Add `node_modules/` (already ignored) and `src-tauri/target/` (build output, large) to `.gitignore`.

3. **Open the app in a native window (dev mode)**
   - Start the server: `node server.js`
   - In a second terminal: `npx tauri dev`
   - Check every feature inside the window: start/stop, totals + custom range,
     chart, edit form, delete. Pay attention to the `confirm()` / `alert()`
     pop-ups — some desktop web views block them; if so, fix it here.

4. **Window polish**
   - Window title "Productivity Tracker", a sensible default and minimum size.
   - An app icon.

5. **Build a real `.app`**
   - `npx tauri build` produces `Productivity Tracker.app`.
   - Open it (with the server running) and confirm it works like dev mode.
   - ~~Confirm the "Could not connect to the server" message shows if the server is NOT running.~~
     Turned out: the window loads the whole page from the server, so with no server it's
     just blank white. Documented as a known limitation in tech.md.

   Added along the way: a running timer now survives closing the app (active.json),
   and alert()/confirm() were replaced with in-page pop-ups (they don't work in Tauri).

6. **Update docs and save**
   - Update `tech.md` ("Running the app", "Known limitations").
   - Run `npm test` (all 51 tests still pass), commit, push to GitHub.

## Known limitations after this week
- The server must be started separately with `node server.js` before opening the app.
- The app is unsigned, so macOS will warn the first time it's opened (right-click → Open).

## Possible next stage
Bundle `server.js` into the app as a "sidecar" so the app starts and stops the
server by itself — a fully standalone app, no terminal needed.
