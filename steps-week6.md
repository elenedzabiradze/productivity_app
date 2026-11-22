# Build Steps: Week 6 — Focus view and ask your data

## Goal
See how your focus actually looked — today and this week — from the activity log, and later
ask plain-language questions about your own data. Details: functional.md and tech.md,
"Week 6" sections.

## Steps

1. **Focus view** (descriptive only — no notifications)
   - A new "Focus" card with a Today / This week switch, showing:
     - **Active time**: time with the computer in use, idle readings excluded
     - **Longest unbroken stretch in one app** (which app, how long, from–to)
     - **Time per app** (the tracker's own app excluded, as before)
     - **Active time by hour of day** (a small bar per hour, 00–23)
   - A stretch counts as unbroken until the frontmost app changes or an idle reading appears.
   - "This week" starts Monday 00:00 (same rule as the category totals).
   - Server: one new endpoint, GET /api/focus?range=today|week; the calculations are pure
     functions over the activity log.

2. **Unit tests for the focus calculations**
   - Longest stretch; active time per hour; an idle reading splitting a stretch; an empty log;
     readings from other days ignored; broken log lines skipped.

3. **Ask your data — options first, no code yet**
   - Present the options for answering plain-language questions about my sessions and activity
     log (e.g. "how much did I work this week?", "when am I most productive?"), including at least:
     - (a) an MCP server that exposes my data as tools, so Claude can query it
     - (b) calling the Claude API from the app
   - For each option, in plain language: where my data goes, where an API key would be stored,
     and what it costs.
   - **Wait for my choice before writing any code.**

4. **Weekly summary** — only after step 3 works
   - A short summary of the week with two or three observations drawn from my data,
     written by Claude, using whichever option was chosen in step 3.

5. **Commit after each step** (steps 1–4 each get their own commit; step 3's options are
   presented first, its code committed once built).

## Later (not this week)
- **Scattered-switching metric**: app switches per 10 minutes, as a number to look at —
  never a notification.
- **Browser tab titles**: read the current tab's title to spot sites like Instagram or Facebook.
  Needs a macOS Automation permission (for the browser); stays local only.
- **SQLite migration**: back up the data folder first; carry over all existing data; keep the old
  files until I confirm; all tests still passing.
- **Menu bar timer**: running time and current app in the Mac menu bar, with Start/Stop.
