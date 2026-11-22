// Unit tests for the local weekly summary (Week 6, step 4): weeklySummary picks
// up to three observations by fixed rules and writes them from templates.
// Run with:  npm test

const test = require('node:test');
const assert = require('node:assert');
const { weeklySummary } = require('../server.js');

const MIN = 60 * 1000;
const HOUR = 60 * MIN;

// A "nothing special" week; each test changes only what it needs.
function answers(overrides = {}) {
  return {
    sessions: { totals: {}, totalMs: 0 },
    activeMs: 5 * HOUR,
    bestDay: { date: '2026-11-18', ms: 2 * HOUR },  // a Wednesday
    daysWithActivity: 3,
    bestWindow: { startHour: 9, endHour: 11, ms: 3 * HOUR },
    longestStretch: { app: 'Code', ms: 30 * MIN },  // neither strong nor short
    comparison: { thisMs: 5 * HOUR, lastMs: null, diffMs: null, percent: null },
    ...overrides
  };
}
const emojis = list => list.map(o => o.emoji);

// ---------- 1. compared with last week (always first) ----------

test('no last-week data: first line says the comparison starts next week', () => {
  const s = weeklySummary(answers());
  assert.strictEqual(s[0].emoji, '🗓️');
  assert.match(s[0].text, /starts next week/);
});

test('more active than last week: 📈 with percent and time', () => {
  const s = weeklySummary(answers({ comparison: { thisMs: 0, lastMs: 4 * HOUR, diffMs: 1 * HOUR, percent: 25 } }));
  assert.strictEqual(s[0].emoji, '📈');
  assert.match(s[0].text, /25% more active/);
  assert.match(s[0].text, /\+1h 0m/);
});

test('less active than last week: 📉', () => {
  const s = weeklySummary(answers({ comparison: { thisMs: 0, lastMs: 4 * HOUR, diffMs: -2 * HOUR, percent: -50 } }));
  assert.strictEqual(s[0].emoji, '📉');
  assert.match(s[0].text, /50% less active/);
  assert.match(s[0].text, /−2h 0m/);
});

test('within ±10%: ⚖️ "about as active"', () => {
  const s = weeklySummary(answers({ comparison: { thisMs: 0, lastMs: 4 * HOUR, diffMs: 20 * MIN, percent: 8 } }));
  assert.strictEqual(s[0].emoji, '⚖️');
});

// ---------- 2. focus ----------

test('a 45+ minute stretch is praised', () => {
  const s = weeklySummary(answers({ longestStretch: { app: 'Figma', ms: 72 * MIN } }));
  assert.ok(s.some(o => o.emoji === '🎯' && /1h 12m straight in Figma/.test(o.text)));
});

test('a longest stretch under 20 minutes is called short bursts', () => {
  const s = weeklySummary(answers({ longestStretch: { app: 'Code', ms: 14 * MIN } }));
  assert.ok(s.some(o => o.emoji === '🔀' && /14m/.test(o.text)));
});

test('a middling stretch (20–45 min) gets no focus line', () => {
  assert.ok(!emojis(weeklySummary(answers())).some(e => e === '🎯' || e === '🔀'));
});

// ---------- 3. timer check ----------

test('sessions far longer than computer use → gentle timer check', () => {
  const s = weeklySummary(answers({ sessions: { totals: {}, totalMs: 15 * HOUR }, activeMs: 4 * HOUR }));
  assert.ok(s.some(o => o.emoji === '📝' && /timer was left running/.test(o.text)));
});

test('timer check needs both: more than double AND at least 3 hours apart', () => {
  // More than double but only 2 h apart → no check.
  const small = weeklySummary(answers({ sessions: { totals: {}, totalMs: 3 * HOUR }, activeMs: 1 * HOUR }));
  assert.ok(!emojis(small).includes('📝'));
  // 3+ h apart but not double → no check.
  const notDouble = weeklySummary(answers({ sessions: { totals: {}, totalMs: 9 * HOUR }, activeMs: 6 * HOUR }));
  assert.ok(!emojis(notDouble).includes('📝'));
});

// ---------- 4–5. peak hours and best day ----------

test('peak hours are mentioned when there is a best window', () => {
  const s = weeklySummary(answers({ longestStretch: null }));
  assert.ok(s.some(o => o.emoji === '⚡' && /between 09:00 and 11:00/.test(o.text)));
});

test('best day needs at least two days with activity', () => {
  const base = { longestStretch: null, bestWindow: null };
  assert.ok(weeklySummary(answers({ ...base, daysWithActivity: 2 })).some(o => /Wednesday was your strongest day/.test(o.text)));
  assert.ok(!emojis(weeklySummary(answers({ ...base, daysWithActivity: 1 }))).includes('🏆'));
});

// ---------- picking ----------

test('never more than three observations, in priority order', () => {
  const s = weeklySummary(answers({
    comparison: { thisMs: 0, lastMs: 4 * HOUR, diffMs: 1 * HOUR, percent: 25 },
    longestStretch: { app: 'Code', ms: 60 * MIN },
    sessions: { totals: {}, totalMs: 15 * HOUR },
    activeMs: 4 * HOUR
  }));
  assert.deepStrictEqual(emojis(s), ['📈', '🎯', '📝']); // ⚡ and 🏆 didn't make the cut
});

test('an empty week still gives a sensible single line', () => {
  const s = weeklySummary(answers({
    activeMs: 0, bestDay: null, daysWithActivity: 0, bestWindow: null, longestStretch: null
  }));
  assert.deepStrictEqual(emojis(s), ['🗓️']);
});

test('the maximum can be changed', () => {
  assert.strictEqual(weeklySummary(answers({ longestStretch: { app: 'Code', ms: 60 * MIN } }), 1).length, 1);
});
