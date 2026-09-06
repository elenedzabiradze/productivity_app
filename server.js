// A tiny local server for the Focus Session Tracker.
//
// It does two jobs:
//   1. Serves index.html so you can open the app in your browser.
//   2. Provides a small API (/api/sessions) that reads and writes
//      sessions.json, so your session history survives closing the app.
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

function sendJson(res, statusCode, data) {
  const body = JSON.stringify(data);
  res.writeHead(statusCode, {
    'Content-Type': 'application/json',
    'Content-Length': Buffer.byteLength(body)
  });
  res.end(body);
}

const server = http.createServer((req, res) => {
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

      const sessions = readSessions();
      newSession.id = Date.now().toString();
      sessions.push(newSession);
      writeSessions(sessions);

      sendJson(res, 201, newSession);
    });
    return;
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

server.listen(PORT, () => {
  console.log(`Focus Session Tracker running at http://localhost:${PORT}`);
});
