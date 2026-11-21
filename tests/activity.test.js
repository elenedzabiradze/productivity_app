// Unit tests for reading the frontmost app's name from macOS's `lsappinfo`
// output. A failed or empty reading must come back as null (= skip it),
// never crash.
// Run with:  npm test

const test = require('node:test');
const assert = require('node:assert');
const { parseFrontAsn, parseAppName } = require('../server.js');

// ---------- parseFrontAsn: output of `lsappinfo front` ----------

test('front: returns the app ID from normal output', () => {
  assert.strictEqual(parseFrontAsn('ASN:0x0-0x212212:\n'), 'ASN:0x0-0x212212:');
});

test('front: empty output means no reading', () => {
  assert.strictEqual(parseFrontAsn(''), null);
  assert.strictEqual(parseFrontAsn('   \n'), null);
});

test('front: a failed command (null) means no reading', () => {
  assert.strictEqual(parseFrontAsn(null), null);
  assert.strictEqual(parseFrontAsn(undefined), null);
});

test('front: error text means no reading', () => {
  assert.strictEqual(parseFrontAsn('lsappinfo: unable to connect to server'), null);
});

test('front: an ID with extra words after it is rejected', () => {
  assert.strictEqual(parseFrontAsn('ASN:0x0-0x1: something else'), null);
});

// ---------- parseAppName: output of `lsappinfo info -only name <ID>` ----------

test('name: returns the app name from normal output', () => {
  assert.strictEqual(parseAppName('"LSDisplayName"="Code"\n'), 'Code');
});

test('name: keeps spaces inside app names', () => {
  assert.strictEqual(parseAppName('"LSDisplayName"="Google Chrome"'), 'Google Chrome');
  assert.strictEqual(parseAppName('"LSDisplayName"="Productivity Tracker"'), 'Productivity Tracker');
});

test('name: handles non-English app names', () => {
  assert.strictEqual(parseAppName('"LSDisplayName"="Café Écrire"'), 'Café Écrire');
});

test('name: empty output means no reading', () => {
  assert.strictEqual(parseAppName(''), null);
});

test('name: a failed command (null) means no reading', () => {
  assert.strictEqual(parseAppName(null), null);
});

test('name: output without a name field means no reading', () => {
  // e.g. the app quit between the two commands
  assert.strictEqual(parseAppName('"bundleID"="com.example.app"'), null);
  assert.strictEqual(parseAppName('lsappinfo: no such application'), null);
});

test('name: an empty or blank name means no reading', () => {
  assert.strictEqual(parseAppName('"LSDisplayName"=""'), null);
  assert.strictEqual(parseAppName('"LSDisplayName"="   "'), null);
});

// ---------- saving readings to the activity log ----------

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { formatActivityLine, appendActivity } = require('../server.js');

// Each test gets its own empty temporary folder, so real data is never touched.
function tempLogFile() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'activity-test-'));
  return path.join(dir, 'activity.jsonl');
}

test('log line: one JSON object followed by a newline', () => {
  const line = formatActivityLine({ t: '2026-11-21T21:46:44.108Z', app: 'Code' });
  assert.strictEqual(line, '{"t":"2026-11-21T21:46:44.108Z","app":"Code"}\n');
});

test('log line: app names with quotes or backslashes stay valid JSON', () => {
  const line = formatActivityLine({ t: '2026-11-21T21:46:44.108Z', app: 'My "Odd" App\\' });
  assert.strictEqual(line.split('\n').length, 2); // exactly one line + trailing newline
  assert.strictEqual(JSON.parse(line).app, 'My "Odd" App\\');
});

test('log line: only time and app name are saved', () => {
  const line = formatActivityLine({ t: '2026-11-21T21:46:44.108Z', app: 'Code', extra: 'x' });
  assert.deepStrictEqual(Object.keys(JSON.parse(line)), ['t', 'app']);
});

test('append: creates the file and adds readings in order, one per line', () => {
  const file = tempLogFile();
  assert.strictEqual(appendActivity(file, { t: '2026-11-21T10:00:00.000Z', app: 'Code' }), true);
  assert.strictEqual(appendActivity(file, { t: '2026-11-21T10:00:05.000Z', app: 'Safari' }), true);
  const lines = fs.readFileSync(file, 'utf8').trim().split('\n').map(l => JSON.parse(l));
  assert.deepStrictEqual(lines.map(r => r.app), ['Code', 'Safari']);
  fs.rmSync(path.dirname(file), { recursive: true });
});

test('append: keeps what is already in the file', () => {
  const file = tempLogFile();
  fs.writeFileSync(file, '{"t":"2026-11-20T09:00:00.000Z","app":"Mail"}\n');
  appendActivity(file, { t: '2026-11-21T10:00:00.000Z', app: 'Code' });
  assert.strictEqual(fs.readFileSync(file, 'utf8').trim().split('\n').length, 2);
  fs.rmSync(path.dirname(file), { recursive: true });
});

test('append: a failed write returns false instead of crashing', () => {
  // A folder that doesn't exist can't be written to.
  const missing = path.join(os.tmpdir(), 'no-such-folder-' + Date.now(), 'activity.jsonl');
  const originalError = console.error;
  console.error = () => {}; // keep the expected error message out of the test output
  try {
    assert.strictEqual(appendActivity(missing, { t: '2026-11-21T10:00:00.000Z', app: 'Code' }), false);
  } finally {
    console.error = originalError;
  }
});
