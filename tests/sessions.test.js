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
