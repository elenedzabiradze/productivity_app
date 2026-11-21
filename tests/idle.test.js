// Unit tests for idle detection: after 5 minutes without keyboard/mouse
// input, readings are marked idle and add no time. A failed idle check
// counts as active, so time is never lost.
// Run with:  npm test

const test = require('node:test');
const assert = require('node:assert');
const {
  parseIdleSeconds, isIdle, formatActivityLine, parseActivityLog, timePerApp
} = require('../server.js');

const SEC = 1000;
const MIDNIGHT = new Date(2026, 10, 21);
const NINE_AM = new Date(2026, 10, 21, 9, 0, 0);

// Builds readings from [secondsAfter9am, appName, idle?] triples.
function readings(triples) {
  return triples.map(([s, app, idle]) => {
    const r = { t: new Date(NINE_AM.getTime() + s * SEC), app };
    if (idle) r.idle = true;
    return r;
  });
}

function secondsByApp(result) {
  const out = {};
  for (const { app, ms } of result.apps) out[app] = ms / SEC;
  return out;
}

// ---------- parseIdleSeconds: output of `ioreg -c IOHIDSystem` ----------

test('idle output: reads HIDIdleTime (nanoseconds) as seconds', () => {
  const output = '    | |   "HIDIdleKeyboard" = 1\n    | |     "HIDIdleTime" = 6651369916\n';
  assert.strictEqual(parseIdleSeconds(output), 6.651369916);
});

test('idle output: zero idle time is 0 seconds (not "failed")', () => {
  assert.strictEqual(parseIdleSeconds('"HIDIdleTime" = 0'), 0);
});

test('idle output: takes the first HIDIdleTime if there are several', () => {
  assert.strictEqual(parseIdleSeconds('"HIDIdleTime" = 2000000000\n"HIDIdleTime" = 9'), 2);
});

test('idle output: empty, failed or unrelated output means "unknown" (null)', () => {
  assert.strictEqual(parseIdleSeconds(''), null);
  assert.strictEqual(parseIdleSeconds(null), null);
  assert.strictEqual(parseIdleSeconds('ioreg: something went wrong'), null);
  assert.strictEqual(parseIdleSeconds('"HIDIdleTime" = not-a-number'), null);
});

// ---------- isIdle: the 5-minute rule ----------

test('idle: under 5 minutes is active', () => {
  assert.strictEqual(isIdle(0), false);
  assert.strictEqual(isIdle(299.9), false);
});

test('idle: 5 minutes or more is idle', () => {
  assert.strictEqual(isIdle(300), true);
  assert.strictEqual(isIdle(3600), true);
});

test('idle: a failed idle check counts as ACTIVE (time is not lost)', () => {
  assert.strictEqual(isIdle(null), false);
  assert.strictEqual(isIdle(undefined), false);
  assert.strictEqual(isIdle(parseIdleSeconds('garbage')), false);
});

// ---------- saving and loading idle readings ----------

test('log line: idle readings are saved with "idle":true', () => {
  const line = formatActivityLine({ t: '2026-11-21T09:00:00.000Z', app: 'Code', idle: true });
  assert.strictEqual(line, '{"t":"2026-11-21T09:00:00.000Z","app":"Code","idle":true}\n');
});

test('log line: active readings have no idle field', () => {
  const line = formatActivityLine({ t: '2026-11-21T09:00:00.000Z', app: 'Code', idle: false });
  assert.strictEqual(line, '{"t":"2026-11-21T09:00:00.000Z","app":"Code"}\n');
});

test('log: the idle flag survives saving and loading', () => {
  const text = formatActivityLine({ t: '2026-11-21T09:00:00.000Z', app: 'Code', idle: true }) +
               formatActivityLine({ t: '2026-11-21T09:00:05.000Z', app: 'Code' });
  const loaded = parseActivityLog(text);
  assert.strictEqual(loaded[0].idle, true);
  assert.strictEqual(loaded[1].idle, undefined);
});

// ---------- timePerApp: idle readings add no time ----------

test('idle readings add no time', () => {
  const r = readings([[0, 'Code', true], [5, 'Code', true], [10, 'Code', true]]);
  assert.deepStrictEqual(timePerApp(r, MIDNIGHT, null), { apps: [], totalMs: 0 });
});

test('an idle stretch between two active readings does not inflate either app', () => {
  // Code active at 0, then idle readings every 5 s for 10 minutes, then Safari active.
  const triples = [[0, 'Code']];
  for (let s = 5; s < 600; s += 5) triples.push([s, 'Code', true]);
  triples.push([600, 'Safari']);
  const result = secondsByApp(timePerApp(readings(triples), MIDNIGHT, null));
  // Code: only its one active reading (5 s until the next, idle, reading).
  // Safari: last reading, 5 s.
  assert.deepStrictEqual(result, { Code: 5, Safari: 5 });
});

test('active time before and after an idle stretch is still counted', () => {
  const r = readings([
    [0, 'Code'], [5, 'Code'],               // Code: 10 s
    [10, 'Code', true], [15, 'Code', true], // idle: 0
    [20, 'Code'], [25, 'Code']              // Code: 5 + last 5 = 10 s
  ]);
  assert.deepStrictEqual(secondsByApp(timePerApp(r, MIDNIGHT, null)), { Code: 20 });
});

test('an app seen only while idle does not appear in the list', () => {
  const r = readings([[0, 'Code'], [5, 'Music', true], [10, 'Music', true]]);
  assert.deepStrictEqual(timePerApp(r, MIDNIGHT, null).apps.map(a => a.app), ['Code']);
});

test('a reading whose idle check failed is counted as active', () => {
  // When the idle check fails, the server doesn't set idle at all — same as active.
  const failedIdleCheck = isIdle(parseIdleSeconds(''));
  const r = readings([[0, 'Code', failedIdleCheck], [5, 'Code', failedIdleCheck]]);
  assert.deepStrictEqual(secondsByApp(timePerApp(r, MIDNIGHT, null)), { Code: 10 });
});

test('only a real true counts as idle (e.g. "idle":"yes" in a hand-edited log does not)', () => {
  const r = [{ t: NINE_AM, app: 'Code', idle: 'yes' }];
  assert.deepStrictEqual(secondsByApp(timePerApp(r, MIDNIGHT, null)), { Code: 5 });
});
