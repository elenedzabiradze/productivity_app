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
3. Once the server answers, the window switches to http://127.0.0.1:3000.
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
- The app is unsigned; on another Mac, macOS would warn on first open (right-click → Open)
- The browser's alert()/confirm() don't work in the Tauri window — use the page's own
  showMessage() / askToConfirm() pop-ups instead

## Week 4: automatic tracking (done)

### Reading the frontmost app
- Done by the server (server.js), not the Rust code, so it works the same in the desktop
  app and with `node server.js`, and the logic is testable with `node --test`.
- Every 5 seconds the server runs macOS's built-in `lsappinfo` tool:
  `lsappinfo front` (which app is in front) then `lsappinfo info -only name <id>` (its name).
  Takes about 10 ms. Run with child_process.execFile (no shell).
- macOS permissions: none needed. Which app is in front, and its name, is public on macOS —
  no Accessibility, Screen Recording or Automation prompt. (Checked on this Mac: no prompt.)
  Window titles, a possible later stage, WOULD need Accessibility or Screen Recording permission.
- Caveat: `lsappinfo` ships with macOS but isn't officially documented by Apple. If a future
  macOS changes it, the fallback is Apple's official NSWorkspace API, called from the Rust side.
- Failed or empty readings are skipped: if `lsappinfo` errors, times out, or its output has
  no app name, nothing is logged for that check and the server carries on; the next check
  is 5 s later. Parsing the output is a separate, unit-tested function.

### Idle detection
- Alongside each reading, the server reads "time since the last keyboard or mouse input"
  with macOS's `ioreg -c IOHIDSystem` (value HIDIdleTime, in nanoseconds). About 4 ms;
  no permission needed (checked on this Mac).
- 5 minutes or more without input → the reading is saved with "idle": true and is not
  counted in the per-app totals.
- If the idle check fails, the user is treated as active (the time counts) — never a crash
  or a dropped reading.
- Known gap: the first 5 minutes away still count, since idle is only detected at 5 minutes.
- Lock screen: while the Mac is locked, macOS reports "loginwindow" as the front app. Those
  readings count as idle — marked idle when taken, and older log lines are treated as idle
  when the log is read.
- Known gap the other way: reading or watching for 5+ minutes with no input at all (not even
  scrolling) is marked idle. Any input — mouse move, scroll, click, key — resets the clock.
  Threshold kept at 5 minutes by choice; idle readings stay in the log (with "idle": true),
  so a longer threshold or per-app rules could be added later.

### Storage
- activity.jsonl in DATA_DIR, one line per reading:
  {"t":"2026-11-21T21:30:05.000Z","app":"Code"}
  or, while idle: {"t":"2026-11-21T21:45:05.000Z","app":"Code","idle":true}
- "JSON Lines" (one JSON object per line) instead of one big JSON array, so each reading is
  a quick append rather than rewriting the whole file every 5 seconds.
- Size: about 50 bytes per reading → ~36 KB per hour of use, ~0.3 MB per 8-hour day.
- Ignored by Git in the project folder, like sessions.json.

### Turning readings into time per app (pure function, unit-tested)
- Each reading counts as the time until the next reading, capped at 10 seconds
  (2 × the interval). The cap means gaps — app closed, Mac asleep — don't count as time.
- The last reading counts as 5 seconds.
- Idle readings count as no time.
- Readings of "Productivity Tracker" (this app; bundle ID com.productivitytracker.desktop)
  count as no time and are left out of the result — they stay in the log.
- Broken lines in the log, or lines without an app name, are skipped.
- "Today" = since local midnight, the same rule as the category totals.

### API
- GET /api/activity/current   latest reading: { t, app, idle } (or null)
- GET /api/activity/today     time per app today: [{ app, ms }], largest first

## Week 5: focus nudges (done)

### Who does what
- **Server (server.js) decides WHEN** a nudge is due. It already knows the running session
  (active.json) and, every 5 s, the frontmost app and idle state. The decisions are pure
  functions, unit-tested with `node --test`.
- **The Rust side (src-tauri/src/lib.rs) SHOWS** the notification. A background thread asks the
  server every 15 s (GET /api/nudges/due) and shows whatever comes back, using Tauri's
  official notification plugin (tauri-plugin-notification, version 2).
- Why not the page? Its JavaScript can be slowed down or paused by macOS while the window is
  hidden — exactly when nudges matter. The Rust thread and the server keep running regardless.
- Why not the server alone (e.g. `osascript`)? Notifications would then appear as coming from
  "Script Editor", not from Productivity Tracker.
- HTTP from Rust: the small `ureq` crate (a simple HTTP client).

### Break nudge: counting active work time
- Work time = active time since the running session started, worked out from the Week 4
  activity readings the same way as "Today by App": each reading counts until the next one,
  capped at 10 s; **idle readings count 0**. Unlike "Today by App", readings of Productivity
  Tracker itself DO count here (looking at the tracker is still working).
- Gaps (Mac asleep, app closed) don't count, because of the 10 s cap.
- Kept as a running total in memory, rebuilt from activity.jsonl when the server starts
  (so a resumed session keeps its progress).
- Nudge at k × workMinutes of active time (k = 1, 2, 3 …), once per k.
- Known gap (from Week 4): the first 5 minutes away still count as active, because idle is
  only detected after 5 minutes without input.
- If automatic tracking can't take readings (e.g. `lsappinfo` fails), no active time is
  counted and the break nudge doesn't fire.

### Idle nudge
- Session running AND idle ≥ idleMinutes (from the 5-second idle check) → one nudge.
- A failed idle check counts as active, so it never triggers the nudge.

### Cooldown rules (the same for every nudge)
- A nudge is sent once per trigger, then waits until its condition resets:
  - break: once per completed work block (per k); next only after another full workMinutes
    of active time,
  - idle: once per idle stretch; can fire again only after input in between.
- Stopping or starting a session resets both.
- "Already sent" is remembered in memory; if the server restarts mid-session, at most one
  nudge may be repeated — acceptable.

### Settings
- settings.json in DATA_DIR, e.g.
  {"workMinutes":25,"idleEnabled":true,"idleMinutes":10}
- workMinutes: 25, 50, or "off" (default 25). idleMinutes: whole minutes 1–240 (default 10).
- Missing or broken file → defaults; invalid values are rejected by PUT /api/settings.
- Ignored by Git in the project folder, like the other data files.

### macOS permissions
- Notifications: confirmed in step 1 — macOS did NOT ask for permission; the test
  notification simply appeared, also with the window minimised. Notifications can still be
  turned off or changed in System Settings → Notifications → Productivity Tracker.
- No other permissions (idle time and app names already need none).

### API
- GET  /api/nudges/due     nudges to show now: [{ title, body }] (each returned once)
- POST /api/nudges/test    queue a test notification (to check notifications work)
- GET  /api/settings       nudge settings
- PUT  /api/settings       change nudge settings (validated)

### Later (not this week — see steps-week5.md)
- Menu bar timer — built after Week 6 (see "Menu bar timer" below).
- Distraction nudge: an editable app-type list (work / communication / distraction), compared
  with the running session's category. Builds on the frontmost-app readings and the nudge queue.
- Scattered-switching nudge and focus metrics (switches per 10 minutes, longest stretch in one
  app): both computable from activity.jsonl as pure, testable functions.
- SQLite migration: back up the data folder first, carry over all existing data, keep the old
  JSON files until confirmed, all tests passing afterwards.

## Week 6: focus view and ask your data (planned)

### Focus calculations (step 1)
- Pure functions over the activity readings (parseActivityLog) for a range [from, to);
  served by GET /api/focus?range=today|week. "Today" = since local midnight; "week" = since
  Monday 00:00 (startOfWeek), both up to now.
- Each reading lasts until the next one, capped at 10 s (same rule as Week 4); the latest
  reading counts until now, capped at 10 s.
- **Active time**: sum of non-idle readings. Productivity Tracker's own readings count here
  (being in the tracker is still using the computer — same choice as the Week 5 work time).
- **Time per app**: the existing timePerApp (idle and Productivity Tracker excluded).
- **Longest unbroken stretch**: consecutive non-idle readings of the same app. A stretch
  ends when the frontmost app changes or an idle reading appears. Two choices to confirm
  before building:
  - a gap longer than 10 s (app closed, Mac asleep) also ends the stretch — proposed, since
    otherwise "unbroken" could span a night's sleep;
  - Productivity Tracker can't be the longest stretch (consistent with leaving it out of
    per-app totals) — its readings end a stretch like any other app change.
- **Active time by hour of day**: 24 buckets (00–23, local time); each reading's time goes to
  the hour it started in. For "week", the same hour on different days is added together.
- The whole log is read per request — fine at current size (see Week 4 limitations).
- Response shape (planned):
  { from, to, activeMs, longestStretch: { app, ms, start, end } | null,
    apps: [{ app, ms }], byHour: [24 numbers, ms] }

### Ask your data (step 3) — decision: option (d), fully local
- Options presented: (a) MCP server exposing the data as tools for Claude (no API key, no extra
  cost, only tool results leave the Mac); (b) Claude API from the app (separate pay-per-use
  Console account, key in the macOS Keychain, the question + an aggregated summary sent per
  question); (c) Claude Code reading the files directly; (d) fully local ready-made answers.
- **Chosen: (d).** Nothing leaves the Mac; no key; no cost. (a)/(b) remain possible later and
  would reuse the same calculations (as MCP tools, or as the summary sent to the API).
- Server: GET /api/week-answers → one pure function, weekAnswers, computes structured data;
  the page turns it into sentences.
  - week = Monday 00:00 → now; sessions via totalsByCategory; active time / longest stretch
    via focusSummary
  - best day: active time per local calendar day this week (same reading-duration rules)
  - most productive: the 2-hour window (hours h and h+1, 00–23, no wrap past midnight) with
    the most active time this week; none if under 30 min of activity in total
  - comparison: this week so far vs. last week over the same span (last Monday 00:00 → the
    same weekday and time last week), so a half-finished week isn't compared to a full one

### Weekly summary (step 4) — local
- Rule-picked observations from weekAnswers, written from fixed templates; no AI.

### Later (not this week — see steps-week6.md)
- Scattered-switching metric (number only); browser tab titles (macOS Automation permission
  for the browser, local only); SQLite migration (backup first, keep old files until
  confirmed). (The menu bar timer was built after Week 6.)

## Menu bar timer (built after Week 6)

### Who does what
- **Rust (src-tauri/src/tray.rs)** creates the menu bar item with Tauri's tray support
  (tauri features "tray-icon" and "image-png"). It keeps no timer state of its own.
- A background thread asks the server **every 5 s** (GET /api/menu-state) and counts the seconds
  in between itself, updating the title once a second. It rebuilds the menu only when what it
  shows changes (running task, or last task).
- Menu actions call the server in the background (so the menu never freezes), then refresh at once:
  - Stop → POST /api/active/stop (saves the session with the same checks as any new session,
    then clears active.json; 409 if nothing is running)
  - Start again → POST /api/active/restart-last (starts the most recently *started* session's
    task and category; 409 if a timer is already running or there's no previous session)
  - Open → shows, un-minimises and focuses the window; Quit → exits the app (and its server)
- **The page** checks GET /api/active every 5 s and catches up with changes made from the menu bar
  (shows a running timer, or clears it and reloads the history). It skips the check while its own
  Start/Stop is still talking to the server, so a half-finished change isn't mistaken for an
  outside one.

### Window behaviour
- Closing the window is intercepted (WindowEvent::CloseRequested → prevent_close + hide), so the
  app, its server, automatic tracking and nudges keep running.
- Clicking the Dock icon while the window is hidden brings it back (RunEvent::Reopen, macOS).
- Quit from the menu bar or Cmd+Q exits normally; the server the app started is stopped on exit.

### API
- GET  /api/menu-state           { active | null, elapsedMs, last: { task, category } | null }
                                 (elapsedMs saves the Rust side from parsing dates)
- POST /api/active/stop          stop the running timer and save it as a session
- POST /api/active/restart-last  start the last task again

### Icon
- src-tauri/icons/tray-icon.svg (source) → tray-icon.png (44×44, black on transparent), used as a
  macOS "template" image, so macOS recolours it (white in dark mode).
- To regenerate the PNG after editing the SVG: render it at 512×512 with a transparent background
  (e.g. headless Chrome with --default-background-color=00000000), then
  `sips -z 44 44 <rendered.png> --out src-tauri/icons/tray-icon.png`.

### Known limitations
- New tasks can't be typed in the menu bar — only Stop and Start again (last task).
- The menu bar title can lag up to 5 s behind a change made in the window (the window catches up
  with the menu bar within 5 s the same way).
- On Macs with a notch, a crowded menu bar can hide the icon behind the notch (macOS behaviour).
