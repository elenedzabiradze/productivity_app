# Build Steps: Week 5 — Focus nudges

## Goal
Mac notifications ("nudges") while a session timer is running: a Pomodoro-style break nudge
after each block of active work, and an idle nudge when the timer runs but nobody is at the
computer. Details: functional.md and tech.md, "Week 5" sections.

## Steps

1. **Notification plumbing (no nudge rules yet)**
   - Add Tauri's notification plugin (version 2) and a small HTTP client (`ureq`) to the Rust side.
   - Server: a queue of nudges to show; GET /api/nudges/due hands each out once;
     POST /api/nudges/test adds a test nudge.
   - Rust: a background thread asks /api/nudges/due every 15 s and shows each as a
     Mac notification.
   - Page: a "Send test notification" button (in the new Nudges section).
   - Check: does macOS ask for permission? Does the notification appear while the window is
     hidden? (This is the step most likely to need adjusting.)

2. **Nudge settings**
   - settings.json with defaults: work length 25 min; idle nudge on, 10 min.
   - GET/PUT /api/settings with validation: work length 25, 50 or "off";
     idle minutes whole numbers 1–240.
   - Page: a "Nudges" card — work length choice (25 / 50 / Off), idle nudge on/off + minutes.

3. **Nudges** — both follow the same cooldown rules: sent once per trigger, then wait until
   the condition resets; stopping or starting a session resets both.
   - **Idle nudge**: session running and no keyboard/mouse input for idleMinutes → "Still
     working on '<task>'? Stop the timer if you're done." Once per idle stretch; again only
     after input in between.
   - **Break nudge (Pomodoro style)**: after each workMinutes (25 or 50) of ACTIVE time in the
     running session → "Time for a break — <25|50> minutes on '<task>'." Once per completed work
     block; the next one only after another full work length. Off → never.
     - Idle time does not count toward the work length: active time is worked out from the
       activity readings since the session started, with idle readings counting 0 (the
       tracker's own app does count here).
   - Every 5 s, with the activity reading, the server checks both rules and queues any nudge.

4. **Unit tests for the nudge rules**
   - Active work time: idle readings add nothing; gaps capped at 10 s; only readings since the
     session started; the tracker's own app counts.
   - Break nudge: nothing before 25 min of active time; exactly one at 25, 50, 75…; idle
     stretches push it later; 50-minute setting; "off" → never; a new session restarts counting.
   - Idle nudge: nothing without a running session; one per idle stretch; again only after
     input; a failed idle check never triggers it; switched off → none.
   - Settings: defaults for a missing/broken file; invalid values rejected (e.g. 30, -5, "abc").

5. **Commit after each step** (steps 1–4 each get their own commit).

## Known limitations after this week
- Nudges only in the desktop app, not in a browser tab.
- Nudges only while a manual session is running.
- The first 5 minutes away still count as active work (idle is detected after 5 minutes).
- If automatic tracking can't take readings, the break nudge doesn't fire.
- A server restart mid-session may repeat one nudge.

## Later (not this week)
- **Menu bar timer**: a stopwatch icon in the Mac menu bar showing the running time and
  current app, with Start/Stop from there — no need to keep the window open.
- **Distraction nudge**: an editable list that sorts apps into types — work, communication,
  distraction — plus a check that compares the running session's category with the type of
  the frontmost app (e.g. a Work session while a distraction app is in front → nudge).
- **Scattered-switching nudge**: a nudge when there are too many app switches within
  10 minutes.
- **Focus metrics**: app switches per 10 minutes, and the longest stretch spent in one app.
- **SQLite migration**: move from JSON files to an SQLite database —
  - back up the data folder first,
  - carry over all existing data (sessions, running timer, activity log, settings),
  - keep the old files until confirmed by you,
  - all tests still passing afterwards.
