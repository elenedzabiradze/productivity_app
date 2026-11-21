# Functional Spec: Focus Session Tracker

## Core features
- Start a session with a task name and category (Work, Study, Break, Other)
- Stop the active session, recording start time, end time, and duration
- Persist all sessions to a local JSON file so they survive restarting the app
- View a list of all past sessions (task, category, start, end, duration)
- Query: total time spent per category, filterable by date range (e.g. "this week")
  - Presets: Today, This Week (Monday start), This Month, All Time, plus a Custom from/to range
  - Shown as a bar per category with its share of the total
- Edit a past session (task, category, start and end time; duration recalculated)
- Delete a past session (with confirmation)
- A running timer survives closing the app: reopening resumes it from the original start time
- Runs as a native macOS desktop app (Tauri) as well as in a browser tab

## Out of scope for now
- No cloud sync, no multi-device support
- No database yet (JSON file is fine for now)
- The desktop app doesn't start its own server yet (run `node server.js` first)
