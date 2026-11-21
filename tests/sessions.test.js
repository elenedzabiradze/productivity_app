// Unit tests for removeSessionById (used when deleting a session).
// Run with:  npm test

const test = require('node:test');
const assert = require('node:assert');
const { removeSessionById } = require('../server.js');

const sample = () => [
  { id: '111', task: 'Read docs' },
  { id: '222', task: 'Coding' },
  { id: '333', task: 'Break' }
];

test('removes the session with the matching id', () => {
  const result = removeSessionById(sample(), '222');
  assert.strictEqual(result.removed, true);
  assert.deepStrictEqual(result.sessions.map(s => s.id), ['111', '333']);
});

test('reports removed: false and changes nothing when the id does not exist', () => {
  const result = removeSessionById(sample(), '999');
  assert.strictEqual(result.removed, false);
  assert.strictEqual(result.sessions.length, 3);
});

test('does not change the original list (returns a new one)', () => {
  const original = sample();
  removeSessionById(original, '111');
  assert.strictEqual(original.length, 3);
});

test('matches ids whether they are stored as text or numbers', () => {
  const sessions = [{ id: 111, task: 'old numeric id' }];
  assert.strictEqual(removeSessionById(sessions, '111').removed, true);
});

test('works on an empty list', () => {
  const result = removeSessionById([], '111');
  assert.strictEqual(result.removed, false);
  assert.deepStrictEqual(result.sessions, []);
});

// ---------- updateSession (used when editing a session) ----------

const { updateSession } = require('../server.js');

const existing = () => ({
  id: '111',
  task: 'Read docs',
  category: 'Study',
  startTime: '2026-11-21T10:00:00.000Z',
  endTime: '2026-11-21T10:10:00.000Z',
  durationMs: 10 * 60 * 1000
});

const validChanges = () => ({
  task: 'Read Node docs',
  category: 'Work',
  startTime: '2026-11-21T10:00:00.000Z',
  endTime: '2026-11-21T10:45:00.000Z'
});

test('edit: updates task, category and times, keeps the id', () => {
  const updated = updateSession(existing(), validChanges());
  assert.strictEqual(updated.id, '111');
  assert.strictEqual(updated.task, 'Read Node docs');
  assert.strictEqual(updated.category, 'Work');
  assert.strictEqual(updated.endTime, '2026-11-21T10:45:00.000Z');
});

test('edit: recalculates durationMs from the new times', () => {
  const updated = updateSession(existing(), validChanges());
  assert.strictEqual(updated.durationMs, 45 * 60 * 1000);
});

test('edit: ignores any durationMs sent in the changes', () => {
  const updated = updateSession(existing(), { ...validChanges(), durationMs: 1 });
  assert.strictEqual(updated.durationMs, 45 * 60 * 1000);
});

test('edit: trims spaces around the task name', () => {
  const updated = updateSession(existing(), { ...validChanges(), task: '  Coding  ' });
  assert.strictEqual(updated.task, 'Coding');
});

test('edit: stores times in the standard ISO format', () => {
  // Same moment as 10:00 UTC, written with a +01:00 offset.
  const updated = updateSession(existing(), { ...validChanges(), startTime: '2026-11-21T11:00:00+01:00' });
  assert.strictEqual(updated.startTime, '2026-11-21T10:00:00.000Z');
});

test('edit: does not change the original session object', () => {
  const original = existing();
  updateSession(original, validChanges());
  assert.strictEqual(original.task, 'Read docs');
});

test('edit: rejects an empty or blank task', () => {
  assert.throws(() => updateSession(existing(), { ...validChanges(), task: '   ' }), /Task cannot be empty/);
  assert.throws(() => updateSession(existing(), { ...validChanges(), task: undefined }), /Task cannot be empty/);
});

test('edit: rejects an unknown category', () => {
  assert.throws(() => updateSession(existing(), { ...validChanges(), category: 'Gaming' }), /Category must be one of/);
});

test('edit: rejects an end time before the start time', () => {
  const changes = { ...validChanges(), endTime: '2026-11-21T09:00:00.000Z' };
  assert.throws(() => updateSession(existing(), changes), /endTime cannot be before startTime/);
});
