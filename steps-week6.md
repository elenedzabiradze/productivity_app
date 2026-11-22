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

3. **Ask your data — decided: option (d), fully local, no AI**
   - Options presented: (a) MCP server for Claude, (b) Claude API from the app, (c) asking
     Claude Code to read the files, (d) fully local ready-made answers. **Chosen: (d)** —
     free, nothing leaves the Mac. (a) and (b) stay possible later and would reuse these
     calculations.
   - A "Your week" card answering five ready-made questions, computed on the Mac:
     1. How much did I work this week? (session time by category + active computer time)
     2. Which day was my best? (most active time)
     3. When am I most productive? (the best 2-hour window of the day)
     4. What was my longest focus? (longest unbroken stretch in one app)
     5. How does it compare to last week? (active time vs. the same point last week)
   - Tests for the answer calculations.

4. **Weekly summary — local, no AI** (only after step 3 works)
   - Two or three short observations picked by simple rules from the step 3 answers
     (e.g. best day, most productive hours, change vs. last week), written from fixed
     sentence templates — not by Claude, since option (d) uses no AI.

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
