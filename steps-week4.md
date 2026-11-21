# Build Steps: Week 4 — Automatic tracking

## Goal
While the tracker is running, notice which application is in front every 5 seconds,
log it, and show today's time per app. App names only — no window titles yet.
Details: functional.md and tech.md, "Week 4" sections.

## Steps

1. **Detect the frontmost app every 5 seconds and show it in the app**
   - Server: every 5 s, read the frontmost app's name with macOS's `lsappinfo` tool;
     keep the latest reading in memory. New endpoint GET /api/activity/current.
   - Page: show "Now: <app name>", refreshed every 5 s.
   - macOS permissions: none needed for app names (checked on this Mac).
     Window titles would need Accessibility or Screen Recording permission — not part of this week.

2. **Save each reading to an activity log**
   - Append each reading (timestamp, app name) as one line to activity.jsonl in the
     app's data folder (DATA_DIR).
   - Add activity.jsonl to .gitignore.

3. **Show today's time per app in the UI**
   - Server: a pure function turns readings into time per app (each reading lasts until the
     next one, capped at 10 s; last one counts 5 s). New endpoint GET /api/activity/today.
   - Page: a "Today by App" card listing each app and its time, largest first.

4. **Unit tests for the readings → time-per-app logic**
   - Normal sequence, app switches, gaps longer than 10 s (capped), the last reading,
     readings from before today ignored, an empty log, a sorted result.

5. **Commit after each step** (steps 1–4 each get their own commit).

## Known limitations after this week
- No idle detection: an app left in front while you're away still counts.
- Only tracked while the tracker is running.
- The activity log grows by ~0.3 MB per 8-hour day; no clean-up yet.
- Changes reach the desktop app only after `npx tauri build` + replacing the copy in /Applications.
