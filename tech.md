# Technical Spec — Focus Session Tracker

## Stack
- Backend: Node.js with a lightweight server (server.js) — no framework, plain HTTP handling
- Frontend: Single HTML page (index.html), vanilla JavaScript, no build tools
- Data storage: sessions.json, a flat JSON file on disk, read/written by the server
- Running timer: active.json, holds the session currently being timed (if any) so it
  survives closing the app; deleted when the session is stopped
- Desktop shell: Tauri 2 (src-tauri/), a native macOS window. The app bundles the server as a
  "sidecar" program, starts it on launch and stops it on quit.
- Tests: Node's built-in test runner (`node --test`), files in tests/

## Data model
Each session record includes:
- task (string)
- category (Work | Study | Break | Other)
- startTime (ISO timestamp)
- endTime (ISO timestamp)
- durationMs (number, milliseconds)

## Running the app
- Start: node server.js
- Open in a browser: http://localhost:3000
- Run tests: npm test

## Desktop app (Tauri)
Requires Rust (installed via rustup), the Xcode Command Line Tools, and the official
Node from nodejs.org at /usr/local/bin/node (Homebrew's Node can't package programs).

How it starts (src-tauri/src/lib.rs):
1. The window shows a built-in "Starting…" page (src-tauri/loading/index.html).
2. If nothing answers on port 3000, the app starts its bundled server with
   DATA_DIR = ~/Library/Application Support/com.productivitytracker.desktop/
   If a server is already running (e.g. `node server.js`), it uses that one instead.
3. Once the server answers, the window switches to http://localhost:3000.
   After 15 seconds without an answer, the page shows an error message.
4. On quit, the app stops the server it started.

Commands:
- Build the app: npx tauri build --bundles app
  (automatically runs `npm run build:server` first)
  Output: src-tauri/target/release/bundle/macos/Productivity Tracker.app
  → then replace the copy in /Applications with it
- Package just the server: npm run build:server  (see scripts/build-server.sh)
  Output: src-tauri/binaries/server-aarch64-apple-darwin (not committed, ~116 MB)
- Dev window: npx tauri dev  (needs the server packaged once, or `node server.js` running)
- App icon: edit src-tauri/app-icon.svg, then run `npx tauri icon src-tauri/app-icon.svg`

Server settings (environment variables, both optional):
- DATA_DIR: folder for sessions.json / active.json (default: this project folder)
- PORT: default 3000

## API
- GET    /api/sessions          list all sessions
- POST   /api/sessions          save a finished session (server calculates durationMs)
- PUT    /api/sessions/<id>     edit task / category / times
- DELETE /api/sessions/<id>     delete a session
- GET    /api/totals            time per category; ?range=today|week|month|all or ?from=&to= (YYYY-MM-DD, inclusive); weeks start Monday
- GET / PUT / DELETE /api/active   the running timer (read / start / clear)

## Known limitations (acceptable for now)
- Single-user, single-machine only — no auth, no sync
- No database yet — JSON file works fine at this data volume
- Two separate sets of data: the desktop app uses the Mac app-data folder, while
  `node server.js` uses this project's sessions.json. (Intentional: browser testing
  doesn't touch real data.) If `node server.js` is running when the app opens, the
  app uses it — and therefore the project's data.
- index.html and server.js are built into the app: changes only reach the app after
  `npx tauri build` (and replacing the copy in /Applications)
- Built for Apple-chip Macs only (arm64)
- The server listens on all network interfaces with no login, so devices on the same
  Wi-Fi could reach it on port 3000 — fine at home, worth restricting to localhost later
- The app is unsigned; on another Mac, macOS would warn on first open (right-click → Open)
- The browser's alert()/confirm() don't work in the Tauri window — use the page's own
  showMessage() / askToConfirm() pop-ups instead
