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
- Add a past session afterwards (e.g. reading a book away from the computer)
- A running timer survives closing the app: reopening resumes it from the original start time
- Runs as a standalone native macOS desktop app (Tauri) — just double-click; it starts
  and stops its own server — as well as in a browser tab

## Out of scope for now
- No cloud sync, no multi-device support
- No database yet (JSON file is fine for now)

## Week 4: automatic tracking (done)
Alongside manual sessions, the app notices which application you're using — without
you pressing anything.

- Every 5 seconds, check which application is in front (e.g. "Code", "Safari")
  — the app's name only, not window titles, websites or anything on screen
- Show the current app in the tracker (e.g. "Now: Code")
- Save every reading (time + app name) to an activity log on this Mac
- "Today by app": how long each app was in front today, largest first
  - The tracker itself ("Productivity Tracker") is left out of these totals
    (its readings are still logged, just not counted)
- Idle detection: after 5 minutes with no keyboard or mouse input, time is not counted
  and the tracker shows "Now: idle". (The first 5 minutes away still count, because idle
  is only known once 5 minutes have passed.)
- If a reading fails, it's skipped quietly and tracking carries on
- Privacy: the log stays on this Mac, in the app's data folder; nothing is sent anywhere
- Tracking only happens while the tracker is running (the desktop app, or `node server.js`);
  nothing is recorded while it's closed or the Mac is asleep

Out of scope for Week 4:
- Window titles / website names (would need extra macOS permissions)
- Linking app time to categories or sessions
- Deleting or trimming old activity data

## Week 5: focus nudges (done)
Gentle Mac notifications ("nudges") while a session timer is running.

- **Break nudge (Pomodoro style)**: after each block of work, "Time for a break —
  25 minutes on 'Write report'." Work length is a setting: **25 minutes** (default),
  **50 minutes**, or **off**.
  - Only *active* time counts toward the work length: time marked idle (no keyboard or mouse
    input for 5+ minutes, see Week 4) does not. Walk away for 20 minutes and the work block
    simply pauses.
- **Idle nudge**: a session timer is running but there has been no keyboard or mouse input
  for 10 minutes — "Still working on 'Write report'? Stop the timer if you're done."
  The minutes and on/off are settings.
- **Same cooldown rules for every nudge**: each nudge is sent once per trigger, then waits
  until its condition resets —
  - break nudge: once per completed work block; the next one only after another full work
    length of active time,
  - idle nudge: once per idle stretch; again only after there has been input in between.
  Stopping or starting a session resets both.
- A small **Nudges** section in the app to change these settings
- Nudges appear even when the tracker window is hidden or behind other windows
- The first time, macOS may ask whether "Productivity Tracker" may show notifications
- Nudges only appear in the desktop app (not when using the tracker in a browser tab)

Out of scope for Week 5:
- Nudges based on automatic tracking alone (no session running)
- Clicking a notification to stop the timer or open a specific part of the app
- Sounds / custom notification styles
- Menu bar timer (listed under "Later" in steps-week5.md)

## Week 6: focus view and ask your data (planned)

### Focus view (descriptive only — no notifications)
A "Focus" card with a Today / This week switch, built from the automatic activity log:
- **Active time** — time the computer was in use; idle time (5+ minutes without input)
  doesn't count
- **Longest unbroken stretch in one app** — e.g. "Code, 1h 12m, 09:40–10:52". A stretch
  continues until a different app comes to the front or an idle reading appears.
- **Time per app** — Productivity Tracker itself is left out. (This replaces the separate
  "Today by App" card, which was removed once the Focus card existed.)
- **Active time by hour of day** — one small bar per hour (00–23), to see when you work most
- "This week" starts on Monday.

### Ask your data — "Your week" card (option d: fully local, no AI)
Five ready-made questions, answered from your own data on this Mac (nothing is sent anywhere):
1. **How much did I work this week?** — session time by category, plus active computer time
2. **Which day was my best?** — the day with the most active time
3. **When am I most productive?** — the 2-hour window of the day with the most active time
4. **What was my longest focus?** — the longest unbroken stretch in one app
5. **How does it compare to last week?** — active time so far vs. the same point last week
You can't type your own questions with this option; asking Claude (option a: MCP server, or
b: an "Ask" box using the Claude API) could be added later and would reuse these answers.

### Weekly summary (local)
Two or three short observations about the week, chosen by simple rules and written from
fixed sentence templates (no AI). Built after the "Your week" card.

Out of scope for Week 6 (see "Later" in steps-week6.md):
- Scattered-switching metric (a number, never a notification)
- Browser tab titles (e.g. spotting Instagram / Facebook; needs a macOS Automation permission)
- SQLite migration
- Menu bar timer
