// Unit tests for the menu bar timer's server helpers:
//   - sessionFromActive: "Stop" from the menu bar → a saved session
//   - lastSessionInfo:   which task "Start again" restarts
// Run with:  npm test

const test = require('node:test');
const assert = require('node:assert');
const { sessionFromActive, lastSessionInfo } = require('../server.js');

const MIN = 60 * 1000;

// ---------- sessionFromActive ----------

const active = { task: 'Write report', category: 'Work', startTime: '2026-11-22T09:00:00.000Z' };

test('stop: the running timer becomes a session ending now, duration worked out', () => {
  const s = sessionFromActive(active, new Date('2026-11-22T09:25:00.000Z'));
  assert.deepStrictEqual(s, {
    task: 'Write report',
    category: 'Work',
    startTime: '2026-11-22T09:00:00.000Z',
    endTime: '2026-11-22T09:25:00.000Z',
    durationMs: 25 * MIN
  });
});

test('stop: same checks as any session — an end before the start is rejected', () => {
  assert.throws(() => sessionFromActive(active, new Date('2026-11-22T08:00:00.000Z')),
    /endTime cannot be before startTime/);
});

test('stop: a broken running timer (empty task, unknown category) is rejected', () => {
  const end = new Date('2026-11-22T10:00:00.000Z');
  assert.throws(() => sessionFromActive({ ...active, task: '' }, end), /Task cannot be empty/);
  assert.throws(() => sessionFromActive({ ...active, category: 'Fun' }, end), /Category must be one of/);
});

// ---------- lastSessionInfo ----------

test('last: no sessions → nothing to start again', () => {
  assert.strictEqual(lastSessionInfo([]), null);
});

test('last: picks the session that started most recently, not the last in the list', () => {
  const sessions = [
    { task: 'Newest', category: 'Study', startTime: '2026-11-22T11:00:00.000Z' },
    { task: 'Older', category: 'Work', startTime: '2026-11-22T09:00:00.000Z' } // added later (e.g. "Add past session")
  ];
  assert.deepStrictEqual(lastSessionInfo(sessions), { task: 'Newest', category: 'Study' });
});

test('last: sessions with a broken time or empty task are skipped', () => {
  const sessions = [
    { task: 'Good', category: 'Work', startTime: '2026-11-22T09:00:00.000Z' },
    { task: 'Bad time', category: 'Work', startTime: 'not a date' },
    { task: '  ', category: 'Work', startTime: '2026-11-22T12:00:00.000Z' }
  ];
  assert.deepStrictEqual(lastSessionInfo(sessions), { task: 'Good', category: 'Work' });
});
