// Unit tests for the lock-screen rule: while the Mac is locked, macOS reports
// "loginwindow" as the frontmost app. Those readings count as idle everywhere.
// Run with:  npm test

const test = require('node:test');
const assert = require('node:assert');
const { parseActivityLog, timePerApp, focusSummary } = require('../server.js');

const SEC = 1000;
const MIN = 60 * SEC;
const MIDNIGHT = new Date(2026, 10, 22);
const at = (h, m = 0) => new Date(2026, 10, 22, h, m);

// Log text: a reading every 5 s for `minutes` minutes, in the format of activity.jsonl.
function logLines(start, minutes, app) {
  const lines = [];
  for (let ms = 0; ms < minutes * MIN; ms += 5 * SEC) {
    lines.push(JSON.stringify({ t: new Date(start.getTime() + ms).toISOString(), app }));
  }
  return lines;
}

// 20 min Code, 30 min locked, 10 min Code — written like an older log (no idle flag).
const text = [
  ...logLines(at(9), 20, 'Code'),
  ...logLines(at(9, 20), 30, 'loginwindow'),
  ...logLines(at(9, 50), 10, 'Code')
].join('\n');

test('lock screen: older "loginwindow" log lines are read as idle', () => {
  const readings = parseActivityLog(text);
  const locked = readings.filter(r => r.app === 'loginwindow');
  assert.ok(locked.length > 0);
  assert.ok(locked.every(r => r.idle === true));
  assert.ok(readings.filter(r => r.app === 'Code').every(r => r.idle !== true));
});

test('lock screen: not listed in time per app', () => {
  const apps = timePerApp(parseActivityLog(text), MIDNIGHT, null).apps;
  assert.deepStrictEqual(apps.map(a => a.app), ['Code']);
});

test('lock screen: locked time is not active time', () => {
  const s = focusSummary(parseActivityLog(text), MIDNIGHT, at(10));
  assert.strictEqual(s.activeMs, 30 * MIN); // 20 + 10 minutes of Code only
});

test('lock screen: locking ends a focus stretch', () => {
  const s = focusSummary(parseActivityLog(text), MIDNIGHT, at(10));
  assert.strictEqual(s.longestStretch.ms, 20 * MIN); // not 30 (20 + 10 merged)
});

test('lock screen: only the exact name counts (an app called e.g. "loginwindow helper" does not)', () => {
  const readings = parseActivityLog(JSON.stringify({ t: at(9).toISOString(), app: 'loginwindow helper' }));
  assert.strictEqual(readings[0].idle, undefined);
});
