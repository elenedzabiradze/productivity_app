# Functional Spec: Focus Session Tracker

## Core features
- Start a session with a task name and category (Work, Study, Break, Other)
- Stop the active session, recording start time, end time, and duration
- Persist all sessions to a local JSON file so they survive restarting the app
- View a list of all past sessions (task, category, start, end, duration)
- Query: total time spent per category, filterable by date range (e.g. "this week")

## Out of scope for now
- No cloud sync, no multi-device support
- No native desktop shell yet (that's Week 3)
- No database yet (JSON file is fine for now)
