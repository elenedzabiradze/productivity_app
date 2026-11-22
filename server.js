// A tiny local server for the Focus Session Tracker.
//
// It does two jobs:
//   1. Serves index.html so you can open the app in your browser.
//   2. Provides a small API (/api/sessions) that reads and writes
//      sessions.json, so your session history survives closing the app.
//   3. Provides /api/totals, which adds up time per category for a date range.
//   4. Lets you edit a session with PUT /api/sessions/<id>
//      and delete one with DELETE /api/sessions/<id>.
//   5. Remembers a running timer in active.json (/api/active), so it can
//      resume after the app is closed and reopened.
//   6. Every 5 seconds, notes which app is in front (/api/activity/current)
//      and adds it to the activity log, activity.jsonl. /api/activity/today
//      turns the log into today's time per app. After 5 minutes without
//      keyboard/mouse input, readings are marked idle and not counted.
//   7. Keeps a queue of "nudges" (notifications) that the desktop app collects
//      from /api/nudges/due and shows. Nudge settings: /api/settings.
//      Every 5 s it checks whether a break or idle nudge is due.
//   8. /api/focus: active time, longest stretch, time per app and per hour.
//   9. /api/week-answers: five ready-made "Your week" answers, all local.
//
// No external packages needed — just Node's built-in tools.
//
// Run it with:  node server.js
// Then open:    http://localhost:3000

const http = require('http');
const fs = require('fs');
const path = require('path');
const { execFile } = require('child_process');
// Tells us whether we're running as the packaged single-file program that the
// desktop app starts (see sea-config.json), or as plain `node server.js`.
const sea = require('node:sea');
const IS_PACKAGED = sea.isSea();

// 3000 normally; can be changed with the PORT setting (handy for testing).
const PORT = Number(process.env.PORT) || 3000;
// Only accept connections from this computer ("loopback"). Without this, any
// device on the same Wi-Fi could read or change your sessions — there's no login.
const HOST = '127.0.0.1';

// Where sessions.json / active.json live. The desktop app passes its own
// folder (~/Library/Application Support/...) in DATA_DIR; otherwise we use
// this project folder, as before.
const DATA_DIR = process.env.DATA_DIR || __dirname;
fs.mkdirSync(DATA_DIR, { recursive: true });

const DATA_FILE = path.join(DATA_DIR, 'sessions.json');
const INDEX_FILE = path.join(__dirname, 'index.html');
// Holds the session whose timer is running right now (if any), so it
// survives closing the app. Deleted again when the session is stopped.
const ACTIVE_FILE = path.join(DATA_DIR, 'active.json');
// Automatic tracking log: one line per reading of which app was in front.
const ACTIVITY_FILE = path.join(DATA_DIR, 'activity.jsonl');
// Nudge settings (work length, idle nudge).
const SETTINGS_FILE = path.join(DATA_DIR, 'settings.json');

// Make sure sessions.json exists before we start, so reads never fail.
if (!fs.existsSync(DATA_FILE)) {
  fs.writeFileSync(DATA_FILE, '[]');
}

function readSessions() {
  const raw = fs.readFileSync(DATA_FILE, 'utf8');
  try {
    return JSON.parse(raw);
  } catch (err) {
    // If the file is somehow empty or corrupted, don't crash — start fresh.
    return [];
  }
}

function writeSessions(sessions) {
  fs.writeFileSync(DATA_FILE, JSON.stringify(sessions, null, 2));
}

// --- Session duration (used by POST /api/sessions) ---

// Returns how many milliseconds passed between startTime and endTime.
// Accepts Date objects or ISO strings like "2026-11-21T10:00:00.000Z".
// Throws an error for invalid times or an end time before the start time,
// so a bad session never gets saved with a nonsense duration.
function calculateDurationMs(startTime, endTime) {
  const start = new Date(startTime);
  const end = new Date(endTime);
  // An unparseable date becomes "Invalid Date", whose getTime() is NaN.
  if (startTime == null || Number.isNaN(start.getTime())) {
    throw new Error('startTime is missing or not a valid date');
  }
  if (endTime == null || Number.isNaN(end.getTime())) {
    throw new Error('endTime is missing or not a valid date');
  }
  if (end < start) {
    throw new Error('endTime cannot be before startTime');
  }
  return end.getTime() - start.getTime();
}

// --- Deleting a session (used by DELETE /api/sessions/<id>) ---

// Returns a NEW list without the session whose id matches, plus whether one
// was actually found. Doesn't touch the file — the caller decides to save.
function removeSessionById(sessions, id) {
  const remaining = sessions.filter(s => String(s.id) !== String(id));
  return { sessions: remaining, removed: remaining.length < sessions.length };
}

const CATEGORIES = ['Work', 'Study', 'Break', 'Other'];

// --- Editing a session (used by PUT /api/sessions/<id>) ---

// Returns an updated COPY of `existing` with the new task, category and
// times from `changes`. The id is kept, and durationMs is recalculated from
// the new times. Throws an error with a readable message if anything is
// invalid, so a bad edit never gets saved.
function updateSession(existing, changes) {
  const task = typeof changes.task === 'string' ? changes.task.trim() : '';
  if (!task) {
    throw new Error('Task cannot be empty');
  }
  if (!CATEGORIES.includes(changes.category)) {
    throw new Error('Category must be one of: ' + CATEGORIES.join(', '));
  }
  // Also checks that both times are valid and end is not before start.
  const durationMs = calculateDurationMs(changes.startTime, changes.endTime);

  return {
    ...existing,
    task,
    category: changes.category,
    // Store times in the same ISO format as everywhere else.
    startTime: new Date(changes.startTime).toISOString(),
    endTime: new Date(changes.endTime).toISOString(),
    durationMs
  };
}

// --- Category totals (used by GET /api/totals) ---

// Midnight at the start of the given day, in this computer's local time.
function startOfDay(date) {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  return d;
}

// Monday 00:00 of the week containing `date`. Weeks start on Monday.
function startOfWeek(date) {
  const d = startOfDay(date);
  const day = d.getDay(); // 0 = Sunday, 1 = Monday, ..., 6 = Saturday
  const diffToMonday = (day === 0) ? 6 : day - 1;
  d.setDate(d.getDate() - diffToMonday);
  return d;
}

function startOfMonth(date) {
  const d = startOfDay(date);
  d.setDate(1);
  return d;
}

// Turns "2026-11-16" into a local-time Date at midnight, or null if invalid.
function parseDay(text) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text);
  if (!match) return null;
  const d = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  // Reject impossible dates like 2026-02-31 (JS would silently roll them over).
  if (d.getMonth() !== Number(match[2]) - 1) return null;
  return d;
}

// Works out the { from, to } Dates for a request's query parameters.
// `from` is inclusive, `to` is exclusive; null means "no limit".
// Returns { error } instead if the input doesn't make sense.
function resolveRange(params, now = new Date()) {
  const fromText = params.get('from');
  const toText = params.get('to');

  // Custom dates take priority over a preset range.
  if (fromText || toText) {
    let from = null;
    let to = null;
    if (fromText) {
      from = parseDay(fromText);
      if (!from) return { error: 'from must be a date like 2026-11-16' };
    }
    if (toText) {
      const toDay = parseDay(toText);
      if (!toDay) return { error: 'to must be a date like 2026-11-22' };
      // Include the whole "to" day by stopping at midnight of the next day.
      to = new Date(toDay);
      to.setDate(to.getDate() + 1);
    }
    if (from && to && from >= to) return { error: 'from must be on or before to' };
    return { from, to };
  }

  const range = params.get('range') || 'all';
  if (range === 'today') return { from: startOfDay(now), to: null };
  if (range === 'week') return { from: startOfWeek(now), to: null };
  if (range === 'month') return { from: startOfMonth(now), to: null };
  if (range === 'all') return { from: null, to: null };
  return { error: 'range must be one of: today, week, month, all' };
}

// Adds up durationMs per category for sessions that STARTED inside [from, to).
// Pure function (no file or network access) so it's easy to unit test later.
function totalsByCategory(sessions, from, to) {
  const totals = {};
  for (const c of CATEGORIES) totals[c] = 0;
  let totalMs = 0;

  for (const s of sessions) {
    const start = new Date(s.startTime);
    if (from && start < from) continue;
    if (to && start >= to) continue;
    const ms = Number(s.durationMs) || 0;
    // Unknown categories are still counted, just in case old data has one.
    totals[s.category] = (totals[s.category] || 0) + ms;
    totalMs += ms;
  }

  return { totals, totalMs };
}

// --- Running timer (used by /api/active) ---

// Returns the running session saved in active.json, or null if none.
function readActive() {
  if (!fs.existsSync(ACTIVE_FILE)) return null;
  try {
    return JSON.parse(fs.readFileSync(ACTIVE_FILE, 'utf8'));
  } catch (err) {
    return null; // corrupted file — treat as "nothing running"
  }
}

function writeActive(active) {
  fs.writeFileSync(ACTIVE_FILE, JSON.stringify(active, null, 2));
}

function clearActive() {
  if (fs.existsSync(ACTIVE_FILE)) fs.unlinkSync(ACTIVE_FILE);
}

// Checks a just-started session ({ task, category, startTime }) and returns a
// clean copy to save. Throws an error with a readable message if invalid.
function validateActiveSession(input) {
  const data = input || {};
  const task = typeof data.task === 'string' ? data.task.trim() : '';
  if (!task) {
    throw new Error('Task cannot be empty');
  }
  if (!CATEGORIES.includes(data.category)) {
    throw new Error('Category must be one of: ' + CATEGORIES.join(', '));
  }
  const start = new Date(data.startTime);
  if (data.startTime == null || Number.isNaN(start.getTime())) {
    throw new Error('startTime is missing or not a valid date');
  }
  return { task, category: data.category, startTime: start.toISOString() };
}

// --- Automatic tracking: which app is in front (used by /api/activity/*) ---

const ACTIVITY_INTERVAL_MS = 5000; // check every 5 seconds
// Full path: apps opened from the Dock get a very short PATH, so don't rely on it.
const LSAPPINFO = '/usr/bin/lsappinfo';

// `lsappinfo front` prints an ID for the frontmost app, like "ASN:0x0-0x212212:".
// Returns that ID, or null if the output doesn't look like one (empty, error text…).
function parseFrontAsn(output) {
  if (typeof output !== 'string') return null;
  const asn = output.trim();
  return /^ASN:\S+$/.test(asn) ? asn : null;
}

// `lsappinfo info -only name <ASN>` prints:  "LSDisplayName"="Code"
// Returns the app name ("Code"), or null if there isn't one.
function parseAppName(output) {
  if (typeof output !== 'string') return null;
  const match = /"LSDisplayName"="([^"]*)"/.exec(output);
  if (!match) return null;
  const name = match[1].trim();
  return name || null;
}

// --- Idle detection ---

// No keyboard/mouse input for this long → readings are marked idle and not counted.
const IDLE_THRESHOLD_SECONDS = 5 * 60;
const IOREG = '/usr/sbin/ioreg';

// `ioreg -c IOHIDSystem` output contains a line like:
//     "HIDIdleTime" = 938416
// which is the time since the last keyboard/mouse input, in nanoseconds.
// Returns that time in seconds, or null if it can't be found.
function parseIdleSeconds(output) {
  if (typeof output !== 'string') return null;
  const match = /"HIDIdleTime"\s*=\s*(\d+)/.exec(output);
  if (!match) return null;
  return Number(match[1]) / 1e9; // nanoseconds → seconds
}

// True only if we KNOW there's been no input for 5+ minutes. If the idle
// check failed (null), we treat the user as active, so time is never lost.
function isIdle(idleSeconds) {
  return typeof idleSeconds === 'number' && idleSeconds >= IDLE_THRESHOLD_SECONDS;
}

// Runs a command and resolves to its output, or null if it fails or takes
// longer than 2 seconds. Never throws — a failed reading is just skipped.
function runQuietly(file, args) {
  return new Promise(resolve => {
    execFile(file, args, { timeout: 2000 }, (err, stdout) => {
      resolve(err ? null : stdout);
    });
  });
}

// Asks macOS which app is in front. Resolves to its name, or null if any
// part of the reading failed.
async function readFrontmostApp() {
  const asn = parseFrontAsn(await runQuietly(LSAPPINFO, ['front']));
  if (!asn) return null;
  return parseAppName(await runQuietly(LSAPPINFO, ['info', '-only', 'name', asn]));
}

// Asks macOS how long since the last keyboard/mouse input. Resolves to
// seconds, or null if the check failed.
async function readIdleSeconds() {
  return parseIdleSeconds(await runQuietly(IOREG, ['-c', 'IOHIDSystem', '-d', '4']));
}

// Turns a reading into one line of the activity log ("JSON Lines" format:
// one JSON object per line), e.g. {"t":"2026-11-21T21:46:44.108Z","app":"Code"}
// Idle readings get an extra "idle":true.
function formatActivityLine(reading) {
  const line = { t: reading.t, app: reading.app };
  if (reading.idle === true) line.idle = true;
  return JSON.stringify(line) + '\n';
}

// Adds one reading to the end of the log file. Returns true if it was saved.
// Never throws: if writing fails (e.g. disk full), it logs the problem and
// tracking carries on.
function appendActivity(filePath, reading) {
  try {
    fs.appendFileSync(filePath, formatActivityLine(reading));
    return true;
  } catch (err) {
    console.error('Could not save activity reading:', err.message);
    return false;
  }
}

// --- Turning the activity log into time per app (used by /api/activity/today) ---

// This app's own name as macOS reports it. Its readings stay in the log but
// are left out of the per-app totals.
const OWN_APP_NAME = 'Productivity Tracker';
// While the Mac is locked, macOS reports the lock screen ("loginwindow") as the
// frontmost app. Nobody is using the computer then, so it counts as idle.
const LOCK_SCREEN_APP = 'loginwindow';
// A reading counts as the time until the next one, but at most this long —
// so gaps (app closed, Mac asleep) don't count as time.
const MAX_READING_MS = 2 * ACTIVITY_INTERVAL_MS; // 10 seconds
// The very last reading has no "next", so it counts as one interval.
const LAST_READING_MS = ACTIVITY_INTERVAL_MS;    // 5 seconds

// Turns the text of activity.jsonl into a list of { t: Date, app } readings.
// Broken lines, lines without an app name, and bad timestamps are skipped.
function parseActivityLog(text) {
  const readings = [];
  for (const line of String(text || '').split('\n')) {
    if (!line.trim()) continue;
    let data;
    try {
      data = JSON.parse(line);
    } catch (err) {
      continue; // e.g. a half-written line
    }
    if (!data || typeof data.app !== 'string' || !data.app.trim()) continue;
    const t = new Date(data.t);
    if (Number.isNaN(t.getTime())) continue;
    const reading = { ...data, t, app: data.app };
    // Older log lines from the lock screen weren't marked idle yet — treat them as idle.
    if (reading.app === LOCK_SCREEN_APP) reading.idle = true;
    readings.push(reading);
  }
  return readings;
}

// Works out how long each app was in front, for readings in [from, to).
// `from` / `to` are Dates, or null for no limit.
// Returns { apps: [{ app, ms }] sorted largest first, totalMs }.
function timePerApp(readings, from, to) {
  // Only readings inside the range, oldest first.
  const inRange = readings
    .filter(r => (!from || r.t >= from) && (!to || r.t < to))
    .sort((a, b) => a.t - b.t);

  const msByApp = {};
  inRange.forEach((reading, i) => {
    const next = inRange[i + 1];
    // Time until the next reading, capped; the last reading gets one interval.
    // (Math.max guards against clock changes making the gap negative.)
    const ms = next
      ? Math.min(Math.max(next.t - reading.t, 0), MAX_READING_MS)
      : LAST_READING_MS;
    if (reading.app === OWN_APP_NAME) return; // don't count this app itself
    if (reading.idle === true) return;        // nobody at the computer — no time
    msByApp[reading.app] = (msByApp[reading.app] || 0) + ms;
  });

  const apps = Object.entries(msByApp)
    .map(([app, ms]) => ({ app, ms }))
    // Largest first; equal times in alphabetical order so the result is stable.
    .sort((a, b) => b.ms - a.ms || a.app.localeCompare(b.app));
  const totalMs = apps.reduce((sum, a) => sum + a.ms, 0);
  return { apps, totalMs };
}

// --- Focus view (Week 6): active time, longest stretch, time per hour ---

// Summarises the readings between `from` and `now` (both Dates):
//   activeMs        — all non-idle time, INCLUDING this app (you're using the computer)
//   longestStretch  — the longest unbroken run in one app: { app, ms, start, end } or null.
//                     A run ends when the app changes, an idle reading appears, there's a
//                     gap over 10 s (app closed / Mac asleep), or this app comes to the front.
//   apps            — time per app, as in "Today by App" (idle and this app left out)
//   byHour          — 24 numbers (ms): active time per local hour of day, 00–23
// Each reading lasts until the next one, capped at 10 s; the latest counts until `now`.
function focusSummary(readings, from, now) {
  const inRange = readings
    .filter(r => r.t >= from && r.t < now)
    .sort((a, b) => a.t - b.t);

  let activeMs = 0;
  const byHour = new Array(24).fill(0);
  let longest = null;  // best stretch so far
  let current = null;  // stretch being built: { app, ms, start, end }

  // Closes the current stretch, keeping it if it's the longest so far.
  const endStretch = () => {
    if (current && (!longest || current.ms > longest.ms)) longest = current;
    current = null;
  };

  inRange.forEach((reading, i) => {
    const next = inRange[i + 1];
    const until = next ? next.t : now;
    const ms = Math.min(Math.max(until - reading.t, 0), MAX_READING_MS);
    const prev = inRange[i - 1];

    // A gap since the previous reading (app closed, Mac asleep) breaks a stretch.
    if (prev && reading.t - prev.t > MAX_READING_MS) endStretch();

    if (reading.idle === true) {
      endStretch(); // nobody at the computer: no time, and the stretch is over
      return;
    }

    activeMs += ms;
    byHour[reading.t.getHours()] += ms;

    if (reading.app === OWN_APP_NAME) {
      endStretch(); // the tracker itself can't be a "focus stretch"
      return;
    }
    if (current && current.app !== reading.app) endStretch();
    if (!current) current = { app: reading.app, ms: 0, start: reading.t, end: reading.t };
    current.ms += ms;
    current.end = new Date(reading.t.getTime() + ms);
  });
  endStretch();

  return {
    activeMs,
    longestStretch: longest
      ? { app: longest.app, ms: longest.ms, start: longest.start.toISOString(), end: longest.end.toISOString() }
      : null,
    apps: timePerApp(readings, from, now).apps,
    byHour
  };
}

// --- "Your week" answers (Week 6, step 3): five ready-made questions ---

// Active (non-idle) time per local calendar day, for readings in [from, now).
// Same duration rule as everywhere: until the next reading, capped at 10 s.
// Returns { "2026-11-18": ms, ... } keyed by the local date the reading started on.
function activeMsByDay(readings, from, now) {
  const inRange = readings.filter(r => r.t >= from && r.t < now).sort((a, b) => a.t - b.t);
  const byDay = {};
  inRange.forEach((reading, i) => {
    if (reading.idle === true) return;
    const until = i + 1 < inRange.length ? inRange[i + 1].t : now;
    const ms = Math.min(Math.max(until - reading.t, 0), MAX_READING_MS);
    const d = reading.t;
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    byDay[key] = (byDay[key] || 0) + ms;
  });
  return byDay;
}

// The 2-hour window (hours h and h+1) with the most active time, from 24
// per-hour totals. Doesn't wrap past midnight. null if under 30 min in total.
const MIN_ACTIVE_FOR_PATTERN_MS = 30 * 60 * 1000;
function bestTwoHourWindow(byHour) {
  const total = byHour.reduce((a, b) => a + b, 0);
  if (total < MIN_ACTIVE_FOR_PATTERN_MS) return null;
  let best = null;
  for (let h = 0; h < 23; h++) {
    const ms = byHour[h] + byHour[h + 1];
    if (!best || ms > best.ms) best = { startHour: h, endHour: h + 2, ms };
  }
  return best;
}

// Works out the five answers for the week containing `now`:
//   1. sessions: time in manual sessions by category  (+ activeMs: computer time)
//   2. bestDay: the day with the most active time
//   3. bestWindow: the most productive 2-hour window
//   4. longestStretch: the longest unbroken stretch in one app
//   5. comparison: active time so far vs. last week up to the same point
// Pure: everything it needs is passed in.
function weekAnswers({ readings, sessions, now }) {
  const weekStart = startOfWeek(now);                         // Monday 00:00
  const lastWeekStart = new Date(weekStart);
  lastWeekStart.setDate(lastWeekStart.getDate() - 7);         // last Monday 00:00
  const sameTimeLastWeek = new Date(now);
  sameTimeLastWeek.setDate(sameTimeLastWeek.getDate() - 7);   // same weekday & time

  const focus = focusSummary(readings, weekStart, now);
  const sessionTotals = totalsByCategory(sessions, weekStart, now);

  // Best day: the day with the most active time (earliest wins a tie).
  let bestDay = null;
  for (const [date, ms] of Object.entries(activeMsByDay(readings, weekStart, now)).sort()) {
    if (!bestDay || ms > bestDay.ms) bestDay = { date, ms };
  }

  // Comparison over the same span. Without any activity last week there's
  // nothing fair to compare with, so lastMs is null.
  const lastMs = focusSummary(readings, lastWeekStart, sameTimeLastWeek).activeMs;
  const comparison = {
    thisMs: focus.activeMs,
    lastMs: lastMs > 0 ? lastMs : null,
    diffMs: lastMs > 0 ? focus.activeMs - lastMs : null,
    percent: lastMs > 0 ? Math.round(((focus.activeMs - lastMs) / lastMs) * 100) : null
  };

  return {
    weekStart: weekStart.toISOString(),
    now: now.toISOString(),
    sessions: sessionTotals,          // { totals: { Work: ms, … }, totalMs }
    activeMs: focus.activeMs,
    bestDay,                          // { date: "YYYY-MM-DD", ms } or null
    bestWindow: bestTwoHourWindow(focus.byHour), // { startHour, endHour, ms } or null
    longestStretch: focus.longestStretch,
    comparison
  };
}

// --- Nudge rules: when is a break or idle nudge due? ---

// Active work time between `start` and `now`, from activity readings: each
// reading counts until the next one (or until `now` for the latest), capped at
// 10 s; idle readings count 0. Unlike "Today by App", this app's own readings
// DO count — looking at the tracker is still working.
function activeWorkMs(readings, start, now) {
  const inSession = readings
    .filter(r => r.t >= start && r.t <= now)
    .sort((a, b) => a.t - b.t);
  let total = 0;
  inSession.forEach((reading, i) => {
    if (reading.idle === true) return;
    const until = i + 1 < inSession.length ? inSession[i + 1].t : now;
    total += Math.min(Math.max(until - reading.t, 0), MAX_READING_MS);
  });
  return total;
}

// What the nudge checker remembers between checks (the "cooldown" memory).
function initialNudgeState() {
  return {
    sessionKey: null,    // start time of the session these memories belong to
    breakBlocksSent: 0,  // how many work blocks have already had a break nudge
    idleNudged: false    // already nudged during the current idle stretch?
  };
}

// Decides which nudges to send now. Pure: no files, no clock, no side effects.
//   state:  what was remembered from the last check (see initialNudgeState)
//   input:  { active, settings, activeMs, idleSeconds }
//     active      — the running session { task, startTime }, or null
//     settings    — { workMinutes, idleEnabled, idleMinutes }
//     activeMs    — active work time in this session so far
//     idleSeconds — seconds since the last keyboard/mouse input, or null if unknown
// Returns { state, nudges } — the new memory, and a list of { title, body }.
function evaluateNudges(state, input) {
  const { active, settings, activeMs, idleSeconds } = input;
  const nudges = [];

  // No session running → no nudges, and forget everything.
  if (!active) return { state: initialNudgeState(), nudges };

  // A different session than last time → start its memory fresh.
  let next = { ...state };
  if (next.sessionKey !== active.startTime) {
    next = { ...initialNudgeState(), sessionKey: active.startTime };
  }

  // Break nudge: once per completed block of active work.
  if (settings.workMinutes !== 'off') {
    const blockMs = settings.workMinutes * 60 * 1000;
    const blocksDone = Math.floor(activeMs / blockMs);
    if (blocksDone > next.breakBlocksSent) {
      // Even if several blocks were missed (e.g. after a restart), send one.
      const minutes = blocksDone * settings.workMinutes;
      nudges.push({
        title: 'Time for a break',
        body: `You've worked ${minutes} minutes on "${active.task}". Stand up, stretch, rest your eyes.`
      });
      next.breakBlocksSent = blocksDone;
    }
  }

  // Idle nudge: once per idle stretch; an unknown idle time counts as active.
  const idleLongEnough = typeof idleSeconds === 'number' &&
    idleSeconds >= settings.idleMinutes * 60;
  if (!idleLongEnough) {
    next.idleNudged = false; // there was input (or we can't tell) → reset
  } else if (settings.idleEnabled && !next.idleNudged) {
    nudges.push({
      title: 'Still working?',
      body: `No activity for ${settings.idleMinutes} minutes — still on "${active.task}"? Stop the timer if you're done.`
    });
    next.idleNudged = true;
  }

  return { state: next, nudges };
}

// Reads the whole activity log from disk (empty list if there isn't one yet).
function readActivityLog() {
  try {
    return parseActivityLog(fs.readFileSync(ACTIVITY_FILE, 'utf8'));
  } catch (err) {
    return []; // no log yet, or unreadable
  }
}

// The most recent successful reading: { t: ISO time, app: name }, or null.
let latestActivity = null;
let readingInProgress = false;

// Readings since the running session started, kept in memory so the nudge
// check doesn't re-read the whole log every 5 seconds. Each: { t: Date, app, idle? }
let sessionReadings = [];
let nudgeState = initialNudgeState();

// When the server starts with a session already running (e.g. after the app
// was reopened), load that session's readings from the log once.
function loadSessionReadings() {
  const active = readActive();
  if (!active) return;
  const start = new Date(active.startTime);
  sessionReadings = readActivityLog().filter(r => r.t >= start);
}

// Runs every 5 s after the activity reading: works out the inputs, asks
// evaluateNudges what to send, and puts any nudges in the queue.
function checkNudges(idleSeconds) {
  const active = readActive();
  if (active) {
    // Forget readings from before this session started.
    const start = new Date(active.startTime);
    sessionReadings = sessionReadings.filter(r => r.t >= start);
  } else {
    sessionReadings = [];
  }
  const activeMs = active
    ? activeWorkMs(sessionReadings, new Date(active.startTime), new Date())
    : 0;
  const result = evaluateNudges(nudgeState, {
    active, settings: readSettings(), activeMs, idleSeconds
  });
  nudgeState = result.state;
  result.nudges.forEach(n => nudgeQueue.add(n));
}

async function takeActivityReading() {
  if (readingInProgress) return; // previous check still running — skip this one
  readingInProgress = true;
  try {
    // Both checks at once: which app is in front, and how long since input.
    const [app, idleSeconds] = await Promise.all([readFrontmostApp(), readIdleSeconds()]);
    // A failed/empty app reading is skipped: keep the last good one, log nothing.
    if (app) {
      latestActivity = { t: new Date().toISOString(), app };
      // Idle: no input for 5+ minutes, or the Mac is locked.
      if (isIdle(idleSeconds) || app === LOCK_SCREEN_APP) latestActivity.idle = true;
      appendActivity(ACTIVITY_FILE, latestActivity);
      sessionReadings.push({ ...latestActivity, t: new Date(latestActivity.t) });
    }
    // Then: is a break or idle nudge due? (Also runs if the app reading failed.)
    checkNudges(idleSeconds);
  } catch (err) {
    console.error('Activity reading failed:', err.message);
  } finally {
    readingInProgress = false;
  }
}

// --- Nudges: notifications waiting to be shown (used by /api/nudges/*) ---
// The server decides WHAT to show and puts it in this queue; the desktop app's
// Rust code collects the queue every 15 s and shows each item as a Mac notification.

// At most this many waiting nudges. In a browser tab nothing collects them, so
// without a limit the list would grow forever; the oldest are dropped instead.
const MAX_QUEUED_NUDGES = 20;

// A small first-in, first-out list. takeAll() hands everything out and empties
// it, so each nudge is shown exactly once.
function createNudgeQueue(maxSize) {
  let items = [];
  return {
    add(nudge) {
      items.push({ title: String(nudge.title), body: String(nudge.body) });
      if (items.length > maxSize) items.shift(); // drop the oldest
    },
    takeAll() {
      const out = items;
      items = [];
      return out;
    },
    size() {
      return items.length;
    }
  };
}

const nudgeQueue = createNudgeQueue(MAX_QUEUED_NUDGES);

// --- Nudge settings (used by /api/settings) ---

const DEFAULT_SETTINGS = Object.freeze({
  workMinutes: 25,   // break nudge after this much active work: 25, 50, or "off"
  idleEnabled: true, // idle nudge on/off
  idleMinutes: 10    // idle nudge after this many minutes without input (1–240)
});
const WORK_MINUTES_CHOICES = [25, 50, 'off'];

// Each setting's rule: returns an error message if the value is not allowed.
const SETTING_RULES = {
  workMinutes: v => WORK_MINUTES_CHOICES.includes(v)
    ? null : 'Work length must be 25, 50 or "off"',
  idleEnabled: v => typeof v === 'boolean'
    ? null : 'Idle nudge on/off must be true or false',
  idleMinutes: v => Number.isInteger(v) && v >= 1 && v <= 240
    ? null : 'Idle minutes must be a whole number from 1 to 240'
};

// Reading from disk: start from the defaults and take each saved value that is
// still valid. A missing, broken or hand-edited file can never break the app.
function normalizeSettings(saved) {
  const settings = { ...DEFAULT_SETTINGS };
  if (saved && typeof saved === 'object') {
    for (const key of Object.keys(SETTING_RULES)) {
      if (key in saved && SETTING_RULES[key](saved[key]) === null) {
        settings[key] = saved[key];
      }
    }
  }
  return settings;
}

// Changing settings: returns the new settings, or throws with a readable
// message if any changed value isn't allowed (then nothing is changed).
// Only the settings being changed need to be sent; unknown names are ignored.
function applySettingsChange(current, changes) {
  if (!changes || typeof changes !== 'object' || Array.isArray(changes)) {
    throw new Error('Settings must be sent as an object');
  }
  const updated = { ...current };
  for (const key of Object.keys(SETTING_RULES)) {
    if (!(key in changes)) continue;
    const problem = SETTING_RULES[key](changes[key]);
    if (problem) throw new Error(problem);
    updated[key] = changes[key];
  }
  return updated;
}

function readSettings() {
  try {
    return normalizeSettings(JSON.parse(fs.readFileSync(SETTINGS_FILE, 'utf8')));
  } catch (err) {
    return { ...DEFAULT_SETTINGS }; // no file yet, or unreadable
  }
}

function writeSettings(settings) {
  fs.writeFileSync(SETTINGS_FILE, JSON.stringify(settings, null, 2));
}

// Collects a request's body and parses it as JSON. Calls onBody(data) on
// success, or replies with a 400 error if the body isn't valid JSON.
function readJsonBody(req, res, onBody) {
  let body = '';
  req.on('data', chunk => { body += chunk; });
  req.on('end', () => {
    let data;
    try {
      data = JSON.parse(body);
    } catch (err) {
      return sendJson(res, 400, { error: 'Invalid JSON in request body' });
    }
    onBody(data);
  });
}

function sendJson(res, statusCode, data) {
  const body = JSON.stringify(data);
  res.writeHead(statusCode, {
    'Content-Type': 'application/json',
    'Content-Length': Buffer.byteLength(body)
  });
  res.end(body);
}

const server = http.createServer((req, res) => {
  // Split "/api/totals?range=week" into the path and the query parameters.
  const url = new URL(req.url, `http://localhost:${PORT}`);

  // --- API: total time per category, optionally within a date range ---
  if (req.method === 'GET' && url.pathname === '/api/totals') {
    const range = resolveRange(url.searchParams);
    if (range.error) return sendJson(res, 400, { error: range.error });

    const { totals, totalMs } = totalsByCategory(readSessions(), range.from, range.to);
    return sendJson(res, 200, {
      from: range.from ? range.from.toISOString() : null,
      to: range.to ? range.to.toISOString() : null,
      totals,
      totalMs
    });
  }

  // --- API: which app is in front right now (latest reading, or null) ---
  if (req.method === 'GET' && url.pathname === '/api/activity/current') {
    return sendJson(res, 200, latestActivity);
  }

  // --- API: nudges waiting to be shown (collected by the desktop app) ---
  // Each nudge is handed out once: the queue is emptied by this request.
  if (req.method === 'GET' && url.pathname === '/api/nudges/due') {
    return sendJson(res, 200, nudgeQueue.takeAll());
  }

  // --- API: nudge settings ---
  if (url.pathname === '/api/settings') {
    if (req.method === 'GET') {
      return sendJson(res, 200, readSettings());
    }
    if (req.method === 'PUT') {
      readJsonBody(req, res, changes => {
        let updated;
        try {
          updated = applySettingsChange(readSettings(), changes);
        } catch (err) {
          return sendJson(res, 400, { error: err.message });
        }
        writeSettings(updated);
        sendJson(res, 200, updated);
      });
      return;
    }
  }

  // --- API: queue a test notification ("Send test notification" button) ---
  if (req.method === 'POST' && url.pathname === '/api/nudges/test') {
    nudgeQueue.add({
      title: 'Test notification',
      body: 'Nudges from Productivity Tracker are working.'
    });
    return sendJson(res, 200, { queued: true });
  }

  // --- API: focus view for today or this week (?range=today|week) ---
  if (req.method === 'GET' && url.pathname === '/api/focus') {
    const range = url.searchParams.get('range') || 'today';
    const now = new Date();
    let from;
    if (range === 'today') from = startOfDay(now);
    else if (range === 'week') from = startOfWeek(now); // Monday 00:00
    else return sendJson(res, 400, { error: 'range must be today or week' });
    const summary = focusSummary(readActivityLog(), from, now);
    return sendJson(res, 200, { range, from: from.toISOString(), to: now.toISOString(), ...summary });
  }

  // --- API: the five "Your week" answers (computed locally, nothing sent anywhere) ---
  if (req.method === 'GET' && url.pathname === '/api/week-answers') {
    const answers = weekAnswers({ readings: readActivityLog(), sessions: readSessions(), now: new Date() });
    return sendJson(res, 200, answers);
  }

  // --- API: today's time per app, from the activity log ---
  if (req.method === 'GET' && url.pathname === '/api/activity/today') {
    const from = startOfDay(new Date()); // since local midnight
    const { apps, totalMs } = timePerApp(readActivityLog(), from, null);
    return sendJson(res, 200, { from: from.toISOString(), apps, totalMs });
  }

  // --- API: the running timer (so it survives closing the app) ---
  if (url.pathname === '/api/active') {
    // Is a session running? Replies with it, or null.
    if (req.method === 'GET') {
      return sendJson(res, 200, readActive());
    }
    // A session was just started — remember it.
    if (req.method === 'PUT') {
      readJsonBody(req, res, data => {
        let active;
        try {
          active = validateActiveSession(data);
        } catch (err) {
          return sendJson(res, 400, { error: err.message });
        }
        writeActive(active);
        sendJson(res, 200, active);
      });
      return;
    }
    // The session was stopped — forget it.
    if (req.method === 'DELETE') {
      clearActive();
      return sendJson(res, 200, { cleared: true });
    }
  }

  // --- API: list all saved sessions ---
  if (req.method === 'GET' && req.url === '/api/sessions') {
    return sendJson(res, 200, readSessions());
  }

  // --- API: save a new session (from the Stop button, or "Add past session") ---
  if (req.method === 'POST' && req.url === '/api/sessions') {
    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', () => {
      let input;
      try {
        input = JSON.parse(body);
      } catch (err) {
        return sendJson(res, 400, { error: 'Invalid JSON in request body' });
      }

      // Same checks as editing: task not empty, a known category, valid times
      // with the end not before the start. Also works out durationMs from the
      // times rather than trusting a number sent by the page, and keeps only
      // the known fields.
      let newSession;
      try {
        newSession = updateSession({}, input);
      } catch (err) {
        return sendJson(res, 400, { error: err.message });
      }

      const sessions = readSessions();
      newSession.id = Date.now().toString();
      sessions.push(newSession);
      writeSessions(sessions);

      sendJson(res, 201, newSession);
    });
    return;
  }

  // --- API: edit one session, e.g. PUT /api/sessions/1788695632957 ---
  if (req.method === 'PUT' && url.pathname.startsWith('/api/sessions/')) {
    const id = decodeURIComponent(url.pathname.slice('/api/sessions/'.length));
    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', () => {
      let changes;
      try {
        changes = JSON.parse(body);
      } catch (err) {
        return sendJson(res, 400, { error: 'Invalid JSON in request body' });
      }

      const sessions = readSessions();
      const index = sessions.findIndex(s => String(s.id) === id);
      if (index === -1) {
        return sendJson(res, 404, { error: 'No session with id ' + id });
      }

      try {
        sessions[index] = updateSession(sessions[index], changes);
      } catch (err) {
        return sendJson(res, 400, { error: err.message });
      }

      writeSessions(sessions);
      sendJson(res, 200, sessions[index]);
    });
    return;
  }

  // --- API: delete one session, e.g. DELETE /api/sessions/1788695632957 ---
  if (req.method === 'DELETE' && url.pathname.startsWith('/api/sessions/')) {
    const id = decodeURIComponent(url.pathname.slice('/api/sessions/'.length));
    const result = removeSessionById(readSessions(), id);
    if (!result.removed) {
      return sendJson(res, 404, { error: 'No session with id ' + id });
    }
    writeSessions(result.sessions);
    return sendJson(res, 200, { deleted: id });
  }

  // --- Everything else: serve the app's HTML page ---
  if (req.method === 'GET' && (req.url === '/' || req.url === '/index.html')) {
    // In the packaged program, index.html is built in (an "asset") rather
    // than being a separate file on disk.
    if (IS_PACKAGED) {
      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end(sea.getAsset('index.html', 'utf8'));
      return;
    }
    fs.readFile(INDEX_FILE, (err, content) => {
      if (err) {
        res.writeHead(500, { 'Content-Type': 'text/plain' });
        res.end('Could not load index.html');
        return;
      }
      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end(content);
    });
    return;
  }

  res.writeHead(404, { 'Content-Type': 'text/plain' });
  res.end('Not found');
});

// Only start the server when this file is run directly (`node server.js`) or
// as the packaged program. When a test file loads it with require(), we just
// hand over the functions.
if (require.main === module || IS_PACKAGED) {
  // If port 3000 is taken (e.g. `node server.js` is already running while the
  // desktop app starts its own copy), say so clearly and quit — the app will
  // simply use the server that's already running.
  server.on('error', err => {
    if (err.code === 'EADDRINUSE') {
      console.error(`Port ${PORT} is already in use — another server is probably running. Exiting.`);
      process.exit(1);
    }
    throw err;
  });
  server.listen(PORT, HOST, () => {
    console.log(`Focus Session Tracker running at http://localhost:${PORT}`);
    console.log(`Data folder: ${DATA_DIR}`);

    // Start automatic tracking: one reading now, then every 5 seconds.
    // (First, pick up the readings of a session that was already running.)
    loadSessionReadings();
    takeActivityReading();
    setInterval(takeActivityReading, ACTIVITY_INTERVAL_MS);
  });
}

module.exports = {
  calculateDurationMs, totalsByCategory, resolveRange, removeSessionById, updateSession,
  validateActiveSession, parseFrontAsn, parseAppName, formatActivityLine, appendActivity,
  parseActivityLog, timePerApp, parseIdleSeconds, isIdle, createNudgeQueue,
  DEFAULT_SETTINGS, normalizeSettings, applySettingsChange,
  activeWorkMs, initialNudgeState, evaluateNudges, focusSummary,
  activeMsByDay, bestTwoHourWindow, weekAnswers
};
