# Technical Spec — Focus Session Tracker

## Stack
- Backend: Node.js with a lightweight server (server.js) — no framework, plain HTTP handling
- Frontend: Single HTML page (index.html), vanilla JavaScript, no build tools
- Data storage: sessions.json, a flat JSON file on disk, read/written by the server
- Running timer: active.json, holds the session currently being timed (if any) so it
  survives closing the app; deleted when the session is stopped
- Desktop shell: Tauri 2 (src-tauri/), a native macOS window that shows http://localhost:3000
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
Requires Rust (installed via rustup) and the Xcode Command Line Tools.
The server must already be running (`node server.js`) — the window loads the page from it.
- Dev window (reloads on config changes): npx tauri dev
- Build the app: npx tauri build --bundles app
  Output: src-tauri/target/release/bundle/macos/Productivity Tracker.app
- Rebuilding is only needed after changes in src-tauri/ (window settings, icon).
  Changes to index.html or server.js take effect on reload (Cmd+R) / server restart.
- App icon: edit src-tauri/app-icon.svg, then run `npx tauri icon src-tauri/app-icon.svg`

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
- The desktop app does not start the server itself: run `node server.js` first.
  If the server isn't running when the app opens, the window is blank white
  (there is no page to show). Possible next stage: bundle the server as a Tauri "sidecar".
- The app is unsigned; on another Mac, macOS would warn on first open (right-click → Open)
- The browser's alert()/confirm() don't work in the Tauri window — use the page's own
  showMessage() / askToConfirm() pop-ups instead
