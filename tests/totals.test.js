// Unit tests for the category totals logic:
//   - totalsByCategory: adds up durationMs per category within a date range
//   - resolveRange: turns ?range= / ?from= / ?to= into actual start/end dates
// Run with:  npm test

const test = require('node:test');
const assert = require('node:assert');
const { totalsByCategory, resolveRange } = require('../server.js');

const MIN = 60 * 1000; // one minute in milliseconds

// Small helper so test data stays short and readable.
function session(category, startTime, minutes) {
  return { task: 'test', category, startTime, durationMs: minutes * MIN };
}

// Note: new Date(2026, 10, 18) means 18 November 2026 at midnight, local time.
// (JavaScript months start at 0, so 10 = November.)
// Using local dates keeps these tests correct in any time zone.

// ---------- totalsByCategory ----------

test('no sessions gives zero for every category', () => {
  const result = totalsByCategory([], null, null);
  assert.deepStrictEqual(result.totals, { Work: 0, Study: 0, Break: 0, Other: 0 });
  assert.strictEqual(result.totalMs, 0);
});

test('adds up durations per category', () => {
  const sessions = [
    session('Work', new Date(2026, 10, 18, 9), 30),
    session('Work', new Date(2026, 10, 18, 11), 15),
    session('Study', new Date(2026, 10, 18, 14), 20),
    session('Break', new Date(2026, 10, 18, 16), 5)
  ];
  const result = totalsByCategory(sessions, null, null);
  assert.deepStrictEqual(result.totals, { Work: 45 * MIN, Study: 20 * MIN, Break: 5 * MIN, Other: 0 });
  assert.strictEqual(result.totalMs, 70 * MIN);
});

test('works with startTime saved as text (as it is in sessions.json)', () => {
  const sessions = [session('Study', '2026-09-06T11:53:52.000Z', 10)];
  assert.strictEqual(totalsByCategory(sessions, null, null).totals.Study, 10 * MIN);
});

test('leaves out sessions that started before "from"', () => {
  const from = new Date(2026, 10, 16);
  const sessions = [
    session('Work', new Date(2026, 10, 15, 23, 59), 60), // Sunday night — excluded
    session('Work', new Date(2026, 10, 16, 9), 10)       // Monday morning — included
  ];
  assert.strictEqual(totalsByCategory(sessions, from, null).totals.Work, 10 * MIN);
});

test('a session starting exactly at "from" is included', () => {
  const from = new Date(2026, 10, 16);
  const sessions = [session('Work', new Date(2026, 10, 16), 10)];
  assert.strictEqual(totalsByCategory(sessions, from, null).totals.Work, 10 * MIN);
});

test('a session starting exactly at "to" is excluded ("to" is the first moment NOT included)', () => {
  const to = new Date(2026, 10, 17);
  const sessions = [
    session('Work', new Date(2026, 10, 16, 23, 59), 10), // included
    session('Work', new Date(2026, 10, 17), 99)          // excluded
  ];
  assert.strictEqual(totalsByCategory(sessions, null, to).totals.Work, 10 * MIN);
});

test('range is decided by START time, even if the session runs past the end', () => {
  // Starts 23:30 Sunday, runs 2 hours into Monday — belongs to Sunday only.
  const sessions = [session('Work', new Date(2026, 10, 15, 23, 30), 120)];
  const mondayOnward = totalsByCategory(sessions, new Date(2026, 10, 16), null);
  assert.strictEqual(mondayOnward.totalMs, 0);
});

test('an unknown category is still counted', () => {
  const sessions = [session('Exercise', new Date(2026, 10, 18), 15)];
  const result = totalsByCategory(sessions, null, null);
  assert.strictEqual(result.totals.Exercise, 15 * MIN);
  assert.strictEqual(result.totalMs, 15 * MIN);
});

test('a session with a missing durationMs counts as 0 instead of breaking the total', () => {
  const sessions = [
    { task: 'old', category: 'Work', startTime: new Date(2026, 10, 18) },
    session('Work', new Date(2026, 10, 18), 10)
  ];
  assert.strictEqual(totalsByCategory(sessions, null, null).totalMs, 10 * MIN);
});

// ---------- resolveRange: preset ranges ----------

// Builds the query part of a URL, e.g. q('range=week') is like "?range=week".
const q = text => new URLSearchParams(text);

const WEDNESDAY = new Date(2026, 10, 18, 15, 30); // Wed 18 Nov 2026, 15:30
const MONDAY = new Date(2026, 10, 16);            // Mon 16 Nov 2026, 00:00

test('no parameters means all time (no limits)', () => {
  assert.deepStrictEqual(resolveRange(q(''), WEDNESDAY), { from: null, to: null });
});

test('range=all means no limits', () => {
  assert.deepStrictEqual(resolveRange(q('range=all'), WEDNESDAY), { from: null, to: null });
});

test('range=today starts at midnight today', () => {
  const { from, to } = resolveRange(q('range=today'), WEDNESDAY);
  assert.deepStrictEqual(from, new Date(2026, 10, 18));
  assert.strictEqual(to, null);
});

test('range=week on a Wednesday starts on that Monday', () => {
  const { from } = resolveRange(q('range=week'), WEDNESDAY);
  assert.deepStrictEqual(from, MONDAY);
});

test('range=week on a Monday starts that same day', () => {
  const { from } = resolveRange(q('range=week'), new Date(2026, 10, 16, 8, 0));
  assert.deepStrictEqual(from, MONDAY);
});

test('range=week on a Sunday goes back 6 days to Monday (not forward)', () => {
  const sundayEvening = new Date(2026, 10, 22, 21, 0);
  const { from } = resolveRange(q('range=week'), sundayEvening);
  assert.deepStrictEqual(from, MONDAY);
});

test('range=week works across a month boundary', () => {
  // Tue 1 Dec 2026 -> week started Mon 30 Nov 2026
  const { from } = resolveRange(q('range=week'), new Date(2026, 11, 1, 12, 0));
  assert.deepStrictEqual(from, new Date(2026, 10, 30));
});

test('range=month starts on the 1st of this month', () => {
  const { from } = resolveRange(q('range=month'), WEDNESDAY);
  assert.deepStrictEqual(from, new Date(2026, 10, 1));
});

test('an unknown range is rejected', () => {
  assert.match(resolveRange(q('range=year'), WEDNESDAY).error, /range must be one of/);
});

// ---------- resolveRange: custom from / to dates ----------

test('from and to cover whole days, including the "to" day', () => {
  const { from, to } = resolveRange(q('from=2026-11-16&to=2026-11-22'), WEDNESDAY);
  assert.deepStrictEqual(from, new Date(2026, 10, 16)); // Mon 00:00
  assert.deepStrictEqual(to, new Date(2026, 10, 23));   // up to (not incl.) Mon 23rd 00:00
});

test('from and to on the same day covers that one day', () => {
  const { from, to } = resolveRange(q('from=2026-11-18&to=2026-11-18'), WEDNESDAY);
  assert.deepStrictEqual(from, new Date(2026, 10, 18));
  assert.deepStrictEqual(to, new Date(2026, 10, 19));
});

test('only from: no end limit', () => {
  const { from, to } = resolveRange(q('from=2026-11-16'), WEDNESDAY);
  assert.deepStrictEqual(from, MONDAY);
  assert.strictEqual(to, null);
});

test('only to: no start limit', () => {
  const { from, to } = resolveRange(q('to=2026-11-16'), WEDNESDAY);
  assert.strictEqual(from, null);
  assert.deepStrictEqual(to, new Date(2026, 10, 17));
});

test('custom dates take priority over range', () => {
  const { from } = resolveRange(q('range=today&from=2026-11-01'), WEDNESDAY);
  assert.deepStrictEqual(from, new Date(2026, 10, 1));
});

test('rejects from after to', () => {
  assert.match(resolveRange(q('from=2026-11-20&to=2026-11-10'), WEDNESDAY).error, /on or before/);
});

test('rejects a badly formatted date', () => {
  assert.match(resolveRange(q('from=banana'), WEDNESDAY).error, /from must be a date/);
  assert.match(resolveRange(q('to=21/11/2026'), WEDNESDAY).error, /to must be a date/);
});

test('rejects a date that does not exist (31 February)', () => {
  assert.match(resolveRange(q('from=2026-02-31'), WEDNESDAY).error, /from must be a date/);
});

// ---------- both together: what /api/totals?range=week actually does ----------

test('"this week" totals only include sessions since Monday', () => {
  const sessions = [
    session('Work', new Date(2026, 10, 13, 10), 60),  // previous Friday — excluded
    session('Work', new Date(2026, 10, 16, 9), 25),   // Monday — included
    session('Study', new Date(2026, 10, 18, 14), 40)  // Wednesday — included
  ];
  const { from, to } = resolveRange(q('range=week'), WEDNESDAY);
  const result = totalsByCategory(sessions, from, to);
  assert.deepStrictEqual(result.totals, { Work: 25 * MIN, Study: 40 * MIN, Break: 0, Other: 0 });
  assert.strictEqual(result.totalMs, 65 * MIN);
});
