// Unit tests for the Focus view calculations (Week 6): focusSummary turns
// activity readings into active time, the longest unbroken stretch in one app,
// time per app, and active time per hour of day.
// Run with:  npm test

const test = require('node:test');
const assert = require('node:assert');
const { focusSummary, parseActivityLog } = require('../server.js');

const SEC = 1000;
const MIN = 60 * SEC;
const MIDNIGHT = new Date(2026, 10, 22);          // Sun 22 Nov 2026, 00:00 local
const at = (h, m = 0, s = 0) => new Date(2026, 10, 22, h, m, s);

// Readings every 5 s from start (inclusive) for `minutes` minutes.
function run(start, minutes, app, idle = false) {
  const out = [];
  for (let ms = 0; ms < minutes * MIN; ms += 5 * SEC) {
    const r = { t: new Date(start.getTime() + ms), app };
    if (idle) r.idle = true;
    out.push(r);
  }
  return out;
}

// ---------- empty and basic ----------

test('empty log: no active time, no stretch, no apps, all hours zero', () => {
  const s = focusSummary([], MIDNIGHT, at(12));
  assert.strictEqual(s.activeMs, 0);
  assert.strictEqual(s.longestStretch, null);
  assert.deepStrictEqual(s.apps, []);
  assert.deepStrictEqual(s.byHour, new Array(24).fill(0));
});

test('active time: 30 minutes of readings is 30 minutes', () => {
  const s = focusSummary(run(at(9), 30, 'Code'), MIDNIGHT, at(9, 30));
  assert.strictEqual(s.activeMs, 30 * MIN);
});

test('active time: the latest reading counts until now, at most 10 s', () => {
  const r = [{ t: at(9), app: 'Code' }];
  assert.strictEqual(focusSummary(r, MIDNIGHT, at(9, 0, 4)).activeMs, 4 * SEC);
  assert.strictEqual(focusSummary(r, MIDNIGHT, at(10)).activeMs, 10 * SEC);
});

// ---------- longest stretch ----------

test('longest stretch: picks the longest run in one app, with start and end', () => {
  const r = [...run(at(9), 20, 'Code'), ...run(at(9, 20), 10, 'Safari'), ...run(at(9, 30), 45, 'Code')];
  const s = focusSummary(r, MIDNIGHT, at(10, 15)).longestStretch;
  assert.strictEqual(s.app, 'Code');
  assert.strictEqual(s.ms, 45 * MIN);
  assert.strictEqual(s.start, at(9, 30).toISOString());
  assert.strictEqual(s.end, at(10, 15).toISOString());
});

test('longest stretch: switching apps ends a stretch (no merging across a switch)', () => {
  // Code 20, Safari 1, Code 20 → longest is 20, not 40.
  const r = [...run(at(9), 20, 'Code'), ...run(at(9, 20), 1, 'Safari'), ...run(at(9, 21), 20, 'Code')];
  assert.strictEqual(focusSummary(r, MIDNIGHT, at(9, 41)).longestStretch.ms, 20 * MIN);
});

test('longest stretch: an idle reading splits a stretch', () => {
  // Code 30, idle 10 (same app still in front), Code 25 → two stretches, longest 30.
  const r = [...run(at(9), 30, 'Code'), ...run(at(9, 30), 10, 'Code', true), ...run(at(9, 40), 25, 'Code')];
  const s = focusSummary(r, MIDNIGHT, at(10, 5)).longestStretch;
  assert.strictEqual(s.ms, 30 * MIN);
  assert.strictEqual(s.end, at(9, 30).toISOString());
});

test('longest stretch: even a single idle reading splits it', () => {
  const r = [...run(at(9), 20, 'Code'), { t: at(9, 20), app: 'Code', idle: true }, ...run(at(9, 20, 5), 15, 'Code')];
  assert.strictEqual(focusSummary(r, MIDNIGHT, at(9, 35, 5)).longestStretch.ms, 20 * MIN);
});

test('longest stretch: a gap over 10 s (Mac asleep) ends the stretch', () => {
  // Code 20 min, 1-hour gap, Code 15 min → longest 20 (plus the capped 10 s), not 35.
  const r = [...run(at(9), 20, 'Code'), ...run(at(10, 20), 15, 'Code')];
  const s = focusSummary(r, MIDNIGHT, at(10, 35)).longestStretch;
  assert.strictEqual(s.ms, 20 * MIN + 5 * SEC);
  assert.strictEqual(s.start, at(9).toISOString());
});

test('longest stretch: the tracker itself can never be the longest stretch', () => {
  const r = [...run(at(9), 60, 'Productivity Tracker'), ...run(at(10), 5, 'Code')];
  const s = focusSummary(r, MIDNIGHT, at(10, 5)).longestStretch;
  assert.strictEqual(s.app, 'Code');
  assert.strictEqual(s.ms, 5 * MIN);
});

test('longest stretch: switching to the tracker ends a stretch', () => {
  // Code 10, tracker 1, Code 10 → two separate 10-minute stretches.
  const r = [...run(at(9), 10, 'Code'), ...run(at(9, 10), 1, 'Productivity Tracker'), ...run(at(9, 11), 10, 'Code')];
  assert.strictEqual(focusSummary(r, MIDNIGHT, at(9, 21)).longestStretch.ms, 10 * MIN);
});

test('longest stretch: on a tie, the earlier stretch is kept', () => {
  const r = [...run(at(9), 10, 'Code'), ...run(at(9, 10), 10, 'Safari')];
  assert.strictEqual(focusSummary(r, MIDNIGHT, at(9, 20)).longestStretch.app, 'Code');
});

test('longest stretch: only idle readings → no stretch', () => {
  assert.strictEqual(focusSummary(run(at(9), 30, 'Code', true), MIDNIGHT, at(9, 30)).longestStretch, null);
});

// ---------- idle and the tracker in the totals ----------

test('idle readings add no active time', () => {
  const r = [...run(at(9), 20, 'Code'), ...run(at(9, 20), 30, 'Code', true), ...run(at(9, 50), 10, 'Code')];
  assert.strictEqual(focusSummary(r, MIDNIGHT, at(10)).activeMs, 30 * MIN);
});

test('the tracker counts in active time but not in time per app', () => {
  const r = [...run(at(9), 10, 'Code'), ...run(at(9, 10), 5, 'Productivity Tracker')];
  const s = focusSummary(r, MIDNIGHT, at(9, 15));
  assert.strictEqual(s.activeMs, 15 * MIN);
  assert.deepStrictEqual(s.apps.map(a => a.app), ['Code']);
});

test('time per app: largest first, idle not counted', () => {
  const r = [...run(at(9), 5, 'Safari'), ...run(at(9, 5), 20, 'Code'), ...run(at(9, 25), 10, 'Mail', true)];
  const apps = focusSummary(r, MIDNIGHT, at(9, 35)).apps;
  assert.deepStrictEqual(apps.map(a => a.app), ['Code', 'Safari']);
});

// ---------- active time per hour ----------

test('per hour: time goes to the hour it happened in', () => {
  const r = [...run(at(9, 30), 45, 'Code')]; // 09:30–10:15
  const byHour = focusSummary(r, MIDNIGHT, at(10, 15)).byHour;
  assert.strictEqual(byHour[9], 30 * MIN);
  assert.strictEqual(byHour[10], 15 * MIN);
  assert.strictEqual(byHour.reduce((a, b) => a + b, 0), 45 * MIN);
});

test('per hour: idle time is not counted in any hour', () => {
  const r = [...run(at(14), 10, 'Code'), ...run(at(14, 10), 50, 'Code', true)];
  assert.strictEqual(focusSummary(r, MIDNIGHT, at(15)).byHour[14], 10 * MIN);
});

test('per hour: always 24 numbers, hours with no activity are 0', () => {
  const byHour = focusSummary(run(at(23, 50), 10, 'Code'), MIDNIGHT, at(23, 59, 59)).byHour;
  assert.strictEqual(byHour.length, 24);
  assert.strictEqual(byHour[23], 10 * MIN - 5 * SEC + 4 * SEC); // last reading counts until "now"
  assert.ok(byHour.slice(0, 23).every(ms => ms === 0));
});

test('per hour, week view: the same hour on different days is added together', () => {
  const monday = new Date(2026, 10, 16);
  const mon9 = new Date(2026, 10, 16, 9);
  const wed9 = new Date(2026, 10, 18, 9);
  const r = [...run(mon9, 20, 'Code'), ...run(wed9, 30, 'Code')];
  const byHour = focusSummary(r, monday, at(12)).byHour;
  // Each run's last reading counts 10 s instead of 5 s (Monday's: gap until
  // Wednesday, capped; Wednesday's: until "now", capped) → +5 s each.
  assert.strictEqual(byHour[9], 50 * MIN + 10 * SEC);
});

// ---------- other days and broken lines ----------

test('readings from other days (before the range) are ignored', () => {
  const yesterday = run(new Date(2026, 10, 21, 22), 60, 'Late App');
  const s = focusSummary([...yesterday, ...run(at(9), 10, 'Code')], MIDNIGHT, at(9, 10));
  assert.strictEqual(s.activeMs, 10 * MIN);
  assert.deepStrictEqual(s.apps.map(a => a.app), ['Code']);
  assert.strictEqual(s.longestStretch.app, 'Code');
  assert.strictEqual(s.byHour[22], 0);
});

test('readings after "now" are ignored', () => {
  const s = focusSummary(run(at(9), 60, 'Code'), MIDNIGHT, at(9, 30));
  assert.strictEqual(s.activeMs, 30 * MIN);
});

test('broken log lines are skipped (log text → readings → summary)', () => {
  const line = (h, m, s, app, idle) => JSON.stringify({ t: at(h, m, s).toISOString(), app, ...(idle ? { idle: true } : {}) });
  const text = [
    line(9, 0, 0, 'Code'),
    '{"t":"2026-11-22T08:00:05',        // half-written line
    'not json',
    '{"t":"2026-11-22T08:00:10.000Z"}', // no app name
    line(9, 0, 5, 'Code'),
    line(9, 0, 10, 'Code')
  ].join('\n');
  const s = focusSummary(parseActivityLog(text), MIDNIGHT, at(9, 0, 15));
  assert.strictEqual(s.activeMs, 15 * SEC);
  assert.strictEqual(s.longestStretch.ms, 15 * SEC);
});

test('readings given out of order are sorted first', () => {
  const r = run(at(9), 10, 'Code').reverse();
  const s = focusSummary(r, MIDNIGHT, at(9, 10));
  assert.strictEqual(s.activeMs, 10 * MIN);
  assert.strictEqual(s.longestStretch.ms, 10 * MIN);
});
