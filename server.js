// A tiny local server for the Focus Session Tracker.
//
// It does two jobs:
//   1. Serves index.html so you can open the app in your browser.
//   2. Provides a small API (/api/sessions) that reads and writes
//      sessions.json, so your session history survives closing the app.
//   3. Provides /api/totals, which adds up time per category for a date range.
//   4. Lets you edit a session with PUT /api/sessions/<id>
//      and delete one with DELETE /api/sessions/<id>.
//
// No external packages needed — just Node's built-in tools.
//
// Run it with:  node server.js
// Then open:    http://localhost:3000

const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = 3000;
const DATA_FILE = path.join(__dirname, 'sessions.json');
const INDEX_FILE = path.join(__dirname, 'index.html');

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

  // --- API: list all saved sessions ---
  if (req.method === 'GET' && req.url === '/api/sessions') {
    return sendJson(res, 200, readSessions());
  }

  // --- API: save a newly completed session ---
  if (req.method === 'POST' && req.url === '/api/sessions') {
    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', () => {
      let newSession;
      try {
        newSession = JSON.parse(body);
      } catch (err) {
        return sendJson(res, 400, { error: 'Invalid JSON in request body' });
      }

      // Work out the duration here from the start/end times, rather than
      // trusting whatever number the page sent.
      try {
        newSession.durationMs = calculateDurationMs(newSession.startTime, newSession.endTime);
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

// Only start the server when this file is run directly (`node server.js`).
// When a test file loads it with require(), we just hand over the functions.
if (require.main === module) {
  server.listen(PORT, () => {
    console.log(`Focus Session Tracker running at http://localhost:${PORT}`);
  });
}

module.exports = { calculateDurationMs, totalsByCategory, resolveRange, removeSessionById, updateSession };
