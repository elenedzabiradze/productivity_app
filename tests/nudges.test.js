// Unit tests for the nudge queue: nudges waiting to be shown as Mac
// notifications, collected by the desktop app every 15 seconds.
// Run with:  npm test

const test = require('node:test');
const assert = require('node:assert');
const { createNudgeQueue } = require('../server.js');

test('queue: starts empty', () => {
  const q = createNudgeQueue(20);
  assert.strictEqual(q.size(), 0);
  assert.deepStrictEqual(q.takeAll(), []);
});

test('queue: hands out nudges in the order they were added', () => {
  const q = createNudgeQueue(20);
  q.add({ title: 'First', body: 'a' });
  q.add({ title: 'Second', body: 'b' });
  assert.deepStrictEqual(q.takeAll().map(n => n.title), ['First', 'Second']);
});

test('queue: each nudge is handed out only once', () => {
  const q = createNudgeQueue(20);
  q.add({ title: 'Once', body: 'only' });
  assert.strictEqual(q.takeAll().length, 1);
  assert.deepStrictEqual(q.takeAll(), []); // second collection gets nothing
  assert.strictEqual(q.size(), 0);
});

test('queue: new nudges after a collection are kept for the next one', () => {
  const q = createNudgeQueue(20);
  q.add({ title: 'A', body: '' });
  q.takeAll();
  q.add({ title: 'B', body: '' });
  assert.deepStrictEqual(q.takeAll().map(n => n.title), ['B']);
});

test('queue: over the limit, the oldest nudges are dropped', () => {
  const q = createNudgeQueue(3);
  for (const title of ['1', '2', '3', '4', '5']) q.add({ title, body: '' });
  assert.strictEqual(q.size(), 3);
  assert.deepStrictEqual(q.takeAll().map(n => n.title), ['3', '4', '5']);
});

test('queue: keeps only title and body, as text', () => {
  const q = createNudgeQueue(20);
  q.add({ title: 42, body: null, extra: 'ignored' });
  assert.deepStrictEqual(q.takeAll(), [{ title: '42', body: 'null' }]);
});
