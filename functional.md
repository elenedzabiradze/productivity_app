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
- Runs as a standalone native macOS desktop app (Tauri) — just double-click; it starts
  and stops its own server — as well as in a browser tab

## Out of scope for now
- No cloud sync, no multi-device support
- No database yet (JSON file is fine for now)

## Week 4: automatic tracking (planned)
Alongside manual sessions, the app notices which application you're using — without
you pressing anything.

- Every 5 seconds, check which application is in front (e.g. "Code", "Safari")
  — the app's name only, not window titles, websites or anything on screen
- Show the current app in the tracker (e.g. "Now: Code")
- Save every reading (time + app name) to an activity log on this Mac
- "Today by app": how long each app was in front today, largest first
- Privacy: the log stays on this Mac, in the app's data folder; nothing is sent anywhere
- Tracking only happens while the tracker is running (the desktop app, or `node server.js`);
  nothing is recorded while it's closed or the Mac is asleep

Out of scope for Week 4:
- Window titles / website names (would need extra macOS permissions)
- Idle detection: if you walk away with an app in front, that time still counts
- Linking app time to categories or sessions
- Deleting or trimming old activity data
