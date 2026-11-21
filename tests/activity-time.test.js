// Unit tests for turning activity-log readings into time per app:
//   - parseActivityLog: the text of activity.jsonl -> list of readings
//   - timePerApp: readings -> { apps: [{ app, ms }] largest first, totalMs }
// Rules being tested (see tech.md, "Week 4"):
//   - each reading counts until the next one, at most 10 seconds
//   - the last reading counts 5 seconds
//   - "Productivity Tracker" (this app) is never counted or listed
// Run with:  npm test

const test = require('node:test');
const assert = require('node:assert');
const { parseActivityLog, timePerApp } = require('../server.js');

const SEC = 1000;
const MIDNIGHT = new Date(2026, 10, 21); // 21 Nov 2026, 00:00 local time
const NINE_AM = new Date(2026, 10, 21, 9, 0, 0);

// Builds readings from [secondsAfterStart, appName] pairs, starting at `start`.
function readings(pairs, start = NINE_AM) {
  return pairs.map(([s, app]) => ({ t: new Date(start.getTime() + s * SEC), app }));
}

// Shortcut: the result as { app: seconds } for easy comparison.
function secondsByApp(result) {
  const out = {};
  for (const { app, ms } of result.apps) out[app] = ms / SEC;
  return out;
}

// ---------- timePerApp: the basic rules ----------

test('a steady run of readings: 5 s each, last one counts 5 s', () => {
  const r = readings([[0, 'Code'], [5, 'Code'], [10, 'Code'], [15, 'Code']]);
  const result = timePerApp(r, MIDNIGHT, null);
  assert.deepStrictEqual(secondsByApp(result), { Code: 20 });
  assert.strictEqual(result.totalMs, 20 * SEC);
});

test('switching apps: each reading belongs to the app that was in front', () => {
  const r = readings([[0, 'Code'], [5, 'Code'], [10, 'Safari'], [15, 'Safari'], [20, 'Code']]);
  // Code: 0–5, 5–10, 20+5 = 15 s.  Safari: 10–15, 15–20 = 10 s.
  assert.deepStrictEqual(secondsByApp(timePerApp(r, MIDNIGHT, null)), { Code: 15, Safari: 10 });
});

test('a single reading counts as 5 seconds', () => {
  assert.deepStrictEqual(secondsByApp(timePerApp(readings([[0, 'Mail']]), MIDNIGHT, null)), { Mail: 5 });
});

test('a gap longer than 10 s is capped at 10 s (app closed / Mac asleep)', () => {
  // Code at 9:00:00, next reading an hour later.
  const r = readings([[0, 'Code'], [3600, 'Safari']]);
  assert.deepStrictEqual(secondsByApp(timePerApp(r, MIDNIGHT, null)), { Code: 10, Safari: 5 });
});

test('a gap of exactly 10 s counts fully; 11 s is capped to 10 s', () => {
  assert.strictEqual(timePerApp(readings([[0, 'A'], [10, 'B']]), MIDNIGHT, null).apps
    .find(a => a.app === 'A').ms, 10 * SEC);
  assert.strictEqual(timePerApp(readings([[0, 'A'], [11, 'B']]), MIDNIGHT, null).apps
    .find(a => a.app === 'A').ms, 10 * SEC);
});

test('a slightly late reading (7 s gap) counts its real time', () => {
  const r = readings([[0, 'Code'], [7, 'Code']]);
  assert.deepStrictEqual(secondsByApp(timePerApp(r, MIDNIGHT, null)), { Code: 12 }); // 7 + last 5
});

test('an empty log gives no apps and zero total', () => {
  assert.deepStrictEqual(timePerApp([], MIDNIGHT, null), { apps: [], totalMs: 0 });
});

// ---------- timePerApp: sorting ----------

test('apps are sorted largest first', () => {
  const r = readings([[0, 'Small'], [5, 'Big'], [10, 'Big'], [15, 'Big'], [20, 'Medium'], [25, 'Medium']]);
  assert.deepStrictEqual(timePerApp(r, MIDNIGHT, null).apps.map(a => a.app), ['Big', 'Medium', 'Small']);
});

test('apps with equal time are sorted alphabetically (stable order)', () => {
  const r = readings([[0, 'Zoom'], [5, 'Atom'], [10, 'Mail']]);
  // Zoom 5, Atom 5, Mail 5 (last)
  assert.deepStrictEqual(timePerApp(r, MIDNIGHT, null).apps.map(a => a.app), ['Atom', 'Mail', 'Zoom']);
});

test('readings given out of order are sorted by time first', () => {
  const r = readings([[10, 'Safari'], [0, 'Code'], [5, 'Code']]);
  assert.deepStrictEqual(secondsByApp(timePerApp(r, MIDNIGHT, null)), { Code: 10, Safari: 5 });
});

// ---------- timePerApp: "today" (date range) ----------

test('readings from before today are ignored', () => {
  const yesterdayLate = new Date(2026, 10, 20, 23, 59, 55);
  const r = [
    { t: yesterdayLate, app: 'Yesterday App' },
    ...readings([[0, 'Code']])
  ];
  assert.deepStrictEqual(secondsByApp(timePerApp(r, MIDNIGHT, null)), { Code: 5 });
});

test('a reading just before midnight does not leak time into today', () => {
  // 23:59:58 yesterday, then 00:00:03 today: yesterday's reading isn't counted at all.
  const r = [
    { t: new Date(2026, 10, 20, 23, 59, 58), app: 'Late App' },
    { t: new Date(2026, 10, 21, 0, 0, 3), app: 'Code' }
  ];
  assert.deepStrictEqual(secondsByApp(timePerApp(r, MIDNIGHT, null)), { Code: 5 });
});

test('a reading exactly at midnight belongs to today', () => {
  const r = [{ t: new Date(MIDNIGHT), app: 'Code' }];
  assert.deepStrictEqual(secondsByApp(timePerApp(r, MIDNIGHT, null)), { Code: 5 });
});

test('an end limit ("to") leaves out readings at or after it', () => {
  const r = readings([[0, 'Code'], [5, 'Code'], [10, 'Safari']]);
  const to = new Date(NINE_AM.getTime() + 10 * SEC);
  // Only the two Code readings are in range; the second is now the last → 5 s.
  assert.deepStrictEqual(secondsByApp(timePerApp(r, MIDNIGHT, to)), { Code: 10 });
});

test('no limits (null, null) counts everything', () => {
  const r = [{ t: new Date(2020, 0, 1), app: 'Old' }, ...readings([[0, 'Code']])];
  assert.deepStrictEqual(Object.keys(secondsByApp(timePerApp(r, null, null))).sort(), ['Code', 'Old']);
});

// ---------- timePerApp: "Productivity Tracker" is excluded ----------

test('"Productivity Tracker" never appears in the result', () => {
  const r = readings([[0, 'Productivity Tracker'], [5, 'Productivity Tracker'], [10, 'Code']]);
  const result = timePerApp(r, MIDNIGHT, null);
  assert.deepStrictEqual(result.apps.map(a => a.app), ['Code']);
  assert.strictEqual(result.totalMs, 5 * SEC);
});

test('"Productivity Tracker" time is not added to the app before or after it', () => {
  const r = readings([
    [0, 'Code'], [5, 'Code'],                          // Code: 10 s
    [10, 'Productivity Tracker'], [15, 'Productivity Tracker'], [20, 'Productivity Tracker'],
    [25, 'Safari'], [30, 'Safari']                     // Safari: 5 + last 5 = 10 s
  ]);
  assert.deepStrictEqual(secondsByApp(timePerApp(r, MIDNIGHT, null)), { Code: 10, Safari: 10 });
});

test('only "Productivity Tracker" readings gives an empty result', () => {
  const r = readings([[0, 'Productivity Tracker'], [5, 'Productivity Tracker']]);
  assert.deepStrictEqual(timePerApp(r, MIDNIGHT, null), { apps: [], totalMs: 0 });
});

test('a similarly named app is still counted (exact name match only)', () => {
  const r = readings([[0, 'Productivity Tracker Networking'], [5, 'productivity tracker']]);
  assert.deepStrictEqual(timePerApp(r, MIDNIGHT, null).apps.length, 2);
});

// ---------- timePerApp: odd timestamps ----------

test('if the clock jumps backwards, the negative gap counts as 0, not minus time', () => {
  // Out-of-order input is sorted, so simulate a clock change with equal times instead.
  const r = readings([[0, 'Code'], [0, 'Safari']]);
  const result = secondsByApp(timePerApp(r, MIDNIGHT, null));
  assert.ok(Object.values(result).every(s => s >= 0));
  assert.strictEqual(Object.values(result).reduce((a, b) => a + b, 0), 5); // 0 + last 5
});

// ---------- parseActivityLog: reading the log file ----------

test('log: parses one reading per line', () => {
  const text =
    '{"t":"2026-11-21T09:00:00.000Z","app":"Code"}\n' +
    '{"t":"2026-11-21T09:00:05.000Z","app":"Safari"}\n';
  const result = parseActivityLog(text);
  assert.deepStrictEqual(result.map(r => r.app), ['Code', 'Safari']);
  assert.ok(result[0].t instanceof Date);
  assert.strictEqual(result[1].t.toISOString(), '2026-11-21T09:00:05.000Z');
});

test('log: broken lines are skipped, the rest still load', () => {
  const text =
    '{"t":"2026-11-21T09:00:00.000Z","app":"Code"}\n' +
    '{"t":"2026-11-21T09:00:05.000Z","ap\n' +           // half-written line
    'not json at all\n' +
    '{"t":"2026-11-21T09:00:10.000Z","app":"Mail"}\n';
  assert.deepStrictEqual(parseActivityLog(text).map(r => r.app), ['Code', 'Mail']);
});

test('log: lines without an app name are skipped', () => {
  const text =
    '{"t":"2026-11-21T09:00:00.000Z"}\n' +
    '{"t":"2026-11-21T09:00:05.000Z","app":""}\n' +
    '{"t":"2026-11-21T09:00:10.000Z","app":"   "}\n' +
    '{"t":"2026-11-21T09:00:15.000Z","app":42}\n' +
    '{"t":"2026-11-21T09:00:20.000Z","app":"Code"}\n';
  assert.deepStrictEqual(parseActivityLog(text).map(r => r.app), ['Code']);
});

test('log: lines with a missing or invalid time are skipped', () => {
  const text =
    '{"app":"NoTime"}\n' +
    '{"t":"yesterday-ish","app":"BadTime"}\n' +
    '{"t":"2026-11-21T09:00:00.000Z","app":"Code"}\n';
  assert.deepStrictEqual(parseActivityLog(text).map(r => r.app), ['Code']);
});

test('log: blank lines and a missing final newline are fine', () => {
  const text = '\n\n{"t":"2026-11-21T09:00:00.000Z","app":"Code"}\n\n' +
               '{"t":"2026-11-21T09:00:05.000Z","app":"Mail"}';
  assert.deepStrictEqual(parseActivityLog(text).map(r => r.app), ['Code', 'Mail']);
});

test('log: an empty or missing log gives no readings', () => {
  assert.deepStrictEqual(parseActivityLog(''), []);
  assert.deepStrictEqual(parseActivityLog(null), []);
  assert.deepStrictEqual(parseActivityLog(undefined), []);
});

test('log: a JSON line that is not an object (e.g. null) is skipped', () => {
  assert.deepStrictEqual(parseActivityLog('null\n[]\n"text"\n'), []);
});

// ---------- both together: log text -> today's time per app ----------

test('end to end: log text with junk, yesterday and this app -> correct totals', () => {
  const at = (h, m, s) => new Date(2026, 10, 21, h, m, s).toISOString();
  const text = [
    JSON.stringify({ t: new Date(2026, 10, 20, 22, 0, 0).toISOString(), app: 'Yesterday' }),
    'garbage',
    JSON.stringify({ t: at(9, 0, 0), app: 'Code' }),
    JSON.stringify({ t: at(9, 0, 5), app: 'Code' }),
    JSON.stringify({ t: at(9, 0, 10), app: 'Productivity Tracker' }),
    JSON.stringify({ t: at(9, 0, 15), app: 'Safari' }),
    JSON.stringify({ t: at(10, 0, 0), app: 'Code' })      // after a 1-hour gap
  ].join('\n');
  const result = timePerApp(parseActivityLog(text), MIDNIGHT, null);
  // Code: 5 + 5 + last 5 = 15 s. Safari: capped 10 s.
  assert.deepStrictEqual(result.apps, [{ app: 'Code', ms: 15 * SEC }, { app: 'Safari', ms: 10 * SEC }]);
  assert.strictEqual(result.totalMs, 25 * SEC);
});
