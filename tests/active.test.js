// Unit tests for validateActiveSession (used when a timer is started, so it
// can be resumed after the app is closed).
// Run with:  npm test

const test = require('node:test');
const assert = require('node:assert');
const { validateActiveSession } = require('../server.js');

const valid = () => ({ task: 'Coding', category: 'Work', startTime: '2026-11-21T10:00:00.000Z' });

test('accepts a valid running session and returns a clean copy', () => {
  assert.deepStrictEqual(validateActiveSession(valid()), {
    task: 'Coding', category: 'Work', startTime: '2026-11-21T10:00:00.000Z'
  });
});

test('trims spaces around the task name', () => {
  assert.strictEqual(validateActiveSession({ ...valid(), task: '  Coding  ' }).task, 'Coding');
});

test('stores the start time in the standard ISO format', () => {
  const result = validateActiveSession({ ...valid(), startTime: '2026-11-21T11:00:00+01:00' });
  assert.strictEqual(result.startTime, '2026-11-21T10:00:00.000Z');
});

test('drops any extra fields that were sent', () => {
  const result = validateActiveSession({ ...valid(), durationMs: 5, hacked: true });
  assert.deepStrictEqual(Object.keys(result).sort(), ['category', 'startTime', 'task']);
});

test('rejects an empty task', () => {
  assert.throws(() => validateActiveSession({ ...valid(), task: '  ' }), /Task cannot be empty/);
});

test('rejects an unknown category', () => {
  assert.throws(() => validateActiveSession({ ...valid(), category: 'Gaming' }), /Category must be one of/);
});

test('rejects a missing or invalid start time', () => {
  assert.throws(() => validateActiveSession({ ...valid(), startTime: undefined }), /startTime/);
  assert.throws(() => validateActiveSession({ ...valid(), startTime: 'banana' }), /startTime/);
});

test('rejects an empty request (null)', () => {
  assert.throws(() => validateActiveSession(null), /Task cannot be empty/);
});
