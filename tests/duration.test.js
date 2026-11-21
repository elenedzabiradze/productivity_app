// Unit tests for calculateDurationMs (start/end time -> durationMs).
// Uses Node's built-in test runner — no packages to install.
// Run with:  npm test

const test = require('node:test');
const assert = require('node:assert');
const { calculateDurationMs } = require('../server.js');

test('a 25-minute session gives 25 * 60 * 1000 ms', () => {
  const ms = calculateDurationMs('2026-11-21T10:00:00.000Z', '2026-11-21T10:25:00.000Z');
  assert.strictEqual(ms, 25 * 60 * 1000);
});

test('keeps millisecond precision', () => {
  const ms = calculateDurationMs('2026-09-06T11:57:41.246Z', '2026-09-06T11:57:44.177Z');
  assert.strictEqual(ms, 2931);
});

test('accepts Date objects as well as strings', () => {
  const start = new Date('2026-11-21T10:00:00.000Z');
  const end = new Date('2026-11-21T11:00:00.000Z');
  assert.strictEqual(calculateDurationMs(start, end), 60 * 60 * 1000);
});

test('same start and end time gives 0', () => {
  const t = '2026-11-21T10:00:00.000Z';
  assert.strictEqual(calculateDurationMs(t, t), 0);
});

test('a session that runs past midnight is counted fully', () => {
  // 23:30 to 00:30 the next day = 1 hour
  const ms = calculateDurationMs('2026-11-21T23:30:00.000Z', '2026-11-22T00:30:00.000Z');
  assert.strictEqual(ms, 60 * 60 * 1000);
});

test('times in different time zones are compared correctly', () => {
  // 12:00 in UTC+1 is the same moment as 11:00 UTC, so 11:00Z -> 12:30+01:00 is 30 minutes.
  const ms = calculateDurationMs('2026-11-21T11:00:00Z', '2026-11-21T12:30:00+01:00');
  assert.strictEqual(ms, 30 * 60 * 1000);
});

test('rejects an end time before the start time', () => {
  assert.throws(
    () => calculateDurationMs('2026-11-21T10:00:00Z', '2026-11-21T09:00:00Z'),
    /endTime cannot be before startTime/
  );
});

test('rejects a missing start time', () => {
  assert.throws(() => calculateDurationMs(undefined, '2026-11-21T10:00:00Z'), /startTime/);
});

test('rejects a missing end time', () => {
  assert.throws(() => calculateDurationMs('2026-11-21T10:00:00Z', null), /endTime/);
});

test('rejects text that is not a date', () => {
  assert.throws(() => calculateDurationMs('banana', '2026-11-21T10:00:00Z'), /startTime/);
});
