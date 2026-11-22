// Unit tests for the "Your week" answers (Week 6, step 3, option d — local):
//   activeMsByDay, bestTwoHourWindow, weekAnswers
// Run with:  npm test

const test = require('node:test');
const assert = require('node:assert');
const { activeMsByDay, bestTwoHourWindow, weekAnswers } = require('../server.js');

const SEC = 1000;
const MIN = 60 * SEC;
const HOUR = 60 * MIN;
// "Now" is Wednesday 18 Nov 2026, 14:00 local → this week started Mon 16 Nov 00:00.
const NOW = new Date(2026, 10, 18, 14, 0);
const day = (d, h, m = 0) => new Date(2026, 10, d, h, m); // a time in November 2026

// Readings every 5 s from `start` for `minutes` minutes.
function run(start, minutes, app = 'Code', idle = false) {
  const out = [];
  for (let ms = 0; ms < minutes * MIN; ms += 5 * SEC) {
    const r = { t: new Date(start.getTime() + ms), app };
    if (idle) r.idle = true;
    out.push(r);
  }
  return out;
}

// ---------- activeMsByDay ----------

test('per day: active time lands on the local day it happened', () => {
  const r = [...run(day(16, 9), 60), ...run(day(17, 10), 30)];
  const byDay = activeMsByDay(r, day(16, 0), NOW);
  assert.strictEqual(byDay['2026-11-16'], 60 * MIN + 5 * SEC); // last reading before the overnight gap counts 10 s
  assert.strictEqual(byDay['2026-11-17'], 30 * MIN + 5 * SEC); // last reading counts until "now", capped at 10 s
});

test('per day: idle readings are not counted', () => {
  const r = [...run(day(16, 9), 20), ...run(day(16, 9, 20), 40, 'Code', true)];
  assert.strictEqual(activeMsByDay(r, day(16, 0), NOW)['2026-11-16'], 20 * MIN);
});

// ---------- bestTwoHourWindow ----------

test('best window: picks the two neighbouring hours with the most activity', () => {
  const byHour = new Array(24).fill(0);
  byHour[9] = 40 * MIN; byHour[10] = 50 * MIN; byHour[15] = 60 * MIN;
  assert.deepStrictEqual(bestTwoHourWindow(byHour), { startHour: 9, endHour: 11, ms: 90 * MIN });
});

test('best window: under 30 minutes of activity in total → not enough data', () => {
  const byHour = new Array(24).fill(0);
  byHour[9] = 29 * MIN;
  assert.strictEqual(bestTwoHourWindow(byHour), null);
});

test('best window: does not wrap past midnight (23:00 + 00:00 is not a window)', () => {
  const byHour = new Array(24).fill(0);
  byHour[23] = 40 * MIN; byHour[0] = 40 * MIN;
  const w = bestTwoHourWindow(byHour);
  assert.ok(w.startHour === 22 || w.startHour === 0); // 22–24 or 00–02, each 40 min
  assert.strictEqual(w.ms, 40 * MIN);
});

// ---------- weekAnswers ----------

test('week: empty data gives zeros and "not enough data" answers', () => {
  const a = weekAnswers({ readings: [], sessions: [], now: NOW });
  assert.strictEqual(a.activeMs, 0);
  assert.strictEqual(a.sessions.totalMs, 0);
  assert.strictEqual(a.bestDay, null);
  assert.strictEqual(a.bestWindow, null);
  assert.strictEqual(a.longestStretch, null);
  assert.strictEqual(a.comparison.lastMs, null);
  assert.strictEqual(a.weekStart, day(16, 0).toISOString());
});

test('week: 1. session time by category, only sessions from this week', () => {
  const sessions = [
    { category: 'Work', startTime: day(16, 9).toISOString(), durationMs: 2 * HOUR },
    { category: 'Study', startTime: day(17, 9).toISOString(), durationMs: 1 * HOUR },
    { category: 'Work', startTime: day(12, 9).toISOString(), durationMs: 5 * HOUR } // last week
  ];
  const a = weekAnswers({ readings: [], sessions, now: NOW });
  assert.strictEqual(a.sessions.totals.Work, 2 * HOUR);
  assert.strictEqual(a.sessions.totals.Study, 1 * HOUR);
  assert.strictEqual(a.sessions.totalMs, 3 * HOUR);
});

test('week: 2. best day is the day with the most active time', () => {
  const r = [...run(day(16, 9), 30), ...run(day(17, 9), 90), ...run(day(18, 9), 60)];
  const a = weekAnswers({ readings: r, sessions: [], now: NOW });
  assert.strictEqual(a.bestDay.date, '2026-11-17');
});

test('week: 2. on a tie, the earlier day wins', () => {
  const r = [...run(day(16, 9), 30), ...run(day(17, 9), 30)];
  const a = weekAnswers({ readings: r, sessions: [], now: NOW });
  assert.strictEqual(a.bestDay.date, '2026-11-16');
});

test('week: 3. most productive window adds the same hours across days', () => {
  // Mon and Tue mornings 09–11, a little afternoon work on Wed.
  const r = [...run(day(16, 9), 120), ...run(day(17, 9), 120), ...run(day(18, 13), 30)];
  const w = weekAnswers({ readings: r, sessions: [], now: NOW }).bestWindow;
  assert.strictEqual(w.startHour, 9);
  assert.strictEqual(w.endHour, 11);
});

test('week: 4. longest focus is the longest stretch this week', () => {
  const r = [...run(day(16, 9), 40, 'Code'), ...run(day(17, 14), 75, 'Figma')];
  const s = weekAnswers({ readings: r, sessions: [], now: NOW }).longestStretch;
  assert.strictEqual(s.app, 'Figma');
});

test('week: 5. compares with last week only up to the same point', () => {
  // This week so far: 2 h. Last week: 1 h before Wednesday 14:00, plus 10 h later that
  // week (Thursday) which must NOT count — it's after "the same point last week".
  const thisWeek = run(day(16, 9), 120);
  const lastWeek = [...run(day(9, 9), 60), ...run(day(12, 9), 600)];
  const c = weekAnswers({ readings: [...lastWeek, ...thisWeek], sessions: [], now: NOW }).comparison;
  assert.strictEqual(Math.round(c.lastMs / MIN), 60);
  assert.strictEqual(Math.round(c.thisMs / MIN), 120);
  assert.strictEqual(c.percent, 100);
  assert.ok(c.diffMs > 0);
});

test('week: 5. less than last week gives a negative change', () => {
  const thisWeek = run(day(16, 9), 30);
  const lastWeek = run(day(9, 9), 60);
  const c = weekAnswers({ readings: [...lastWeek, ...thisWeek], sessions: [], now: NOW }).comparison;
  assert.ok(c.diffMs < 0);
  assert.strictEqual(c.percent, -50);
});

test('week: 5. no activity last week → nothing to compare (not "+100%")', () => {
  const c = weekAnswers({ readings: run(day(16, 9), 60), sessions: [], now: NOW }).comparison;
  assert.strictEqual(c.lastMs, null);
  assert.strictEqual(c.percent, null);
  assert.strictEqual(c.diffMs, null);
});

test('week: readings from last week do not leak into this week\'s answers', () => {
  const r = [...run(day(13, 9), 300, 'Old App'), ...run(day(16, 9), 10, 'Code')];
  const a = weekAnswers({ readings: r, sessions: [], now: NOW });
  assert.strictEqual(a.longestStretch.app, 'Code');
  assert.strictEqual(a.bestDay.date, '2026-11-16');
});
