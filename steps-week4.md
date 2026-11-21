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
   - **Failed or empty readings are skipped, never a crash:** if `lsappinfo` errors, times
     out, or returns output with no app name, that reading is ignored (nothing logged, the
     server keeps running) and the next check happens 5 s later as normal. The parsing is a
     separate small function so it can be tested.
   - Test: the parser returns the name for normal output, and "no reading" for empty output,
     an error message, or text without a name.
   - macOS permissions: none needed for app names (checked on this Mac).
     Window titles would need Accessibility or Screen Recording permission — not part of this week.

2. **Save each reading to an activity log**
   - Append each reading (timestamp, app name) as one line to activity.jsonl in the
     app's data folder (DATA_DIR).
   - Add activity.jsonl to .gitignore.

3. **Show today's time per app in the UI**
   - Server: a pure function turns readings into time per app (each reading lasts until the
     next one, capped at 10 s; last one counts 5 s). New endpoint GET /api/activity/today.
   - **"Productivity Tracker" (this app) is left out of the per-app totals.** Its readings are
     still saved in the log, just not counted. (Name confirmed on this Mac: macOS reports it as
     "Productivity Tracker", bundle ID com.productivitytracker.desktop.)
   - Page: a "Today by App" card listing each app and its time, largest first.

4. **Unit tests for the readings → time-per-app logic**
   - Normal sequence, app switches, gaps longer than 10 s (capped), the last reading,
     readings from before today ignored, an empty log, a sorted result.
   - "Productivity Tracker" readings don't appear in the totals and don't add time to
     the app before or after them.
   - Lines in the log that are broken or missing an app name are skipped, not a crash.

5. **Idle detection: don't count time when nobody is at the computer**
   - Every 5 s, alongside the app name, read "seconds since the last keyboard or mouse input"
     from macOS (`ioreg -c IOHIDSystem`, value HIDIdleTime). No permission needed — checked on
     this Mac (about 4 ms per check).
   - If there has been no input for **5 minutes** or more, the reading is saved with
     `"idle": true` and is **not counted** in the per-app totals.
   - The page shows "Now: idle" instead of an app name while idle.
   - If the idle reading itself fails, treat the user as active (count the time) rather than
     crash or drop the reading.
   - Known gap: the first 5 minutes of being away still count, because "idle" is only
     detected once the 5 minutes have passed.
   - Tests: idle readings add no time; an idle gap between two active readings doesn't
     inflate either app; a failed idle check counts as active.

6. **Commit after each step** (steps 1–5 each get their own commit).

## Known limitations after this week
- Up to 5 minutes of time away from the computer can still be counted (see step 5).
- The opposite case: reading or watching something for 5+ minutes without touching the
  keyboard, mouse or trackpad (not even scrolling) is marked idle and not counted.
  Kept at 5 minutes on purpose; the idle readings stay in the log, so this could be revisited.
- Only tracked while the tracker is running.
- In the browser (`node server.js`), the browser itself (e.g. "Google Chrome") counts as an app;
  only the desktop app's own name is excluded.
- The activity log grows by ~0.3 MB per 8-hour day; no clean-up yet.
- Changes reach the desktop app only after `npx tauri build` + replacing the copy in /Applications.
