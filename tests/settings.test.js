// Unit tests for nudge settings:
//   - normalizeSettings: what's read from settings.json (missing/broken → defaults)
//   - applySettingsChange: changes sent by the page (invalid → rejected)
// Run with:  npm test

const test = require('node:test');
const assert = require('node:assert');
const { DEFAULT_SETTINGS, normalizeSettings, applySettingsChange } = require('../server.js');

const DEFAULTS = { workMinutes: 25, idleEnabled: true, idleMinutes: 10 };

// ---------- defaults and reading from disk ----------

test('defaults: work 25 min, idle nudge on after 10 min', () => {
  assert.deepStrictEqual({ ...DEFAULT_SETTINGS }, DEFAULTS);
});

test('read: a missing or empty file gives the defaults', () => {
  assert.deepStrictEqual(normalizeSettings(undefined), DEFAULTS);
  assert.deepStrictEqual(normalizeSettings(null), DEFAULTS);
  assert.deepStrictEqual(normalizeSettings({}), DEFAULTS);
});

test('read: a broken file (not an object) gives the defaults', () => {
  assert.deepStrictEqual(normalizeSettings('garbage'), DEFAULTS);
  assert.deepStrictEqual(normalizeSettings(42), DEFAULTS);
});

test('read: saved valid values are used', () => {
  const saved = { workMinutes: 50, idleEnabled: false, idleMinutes: 15 };
  assert.deepStrictEqual(normalizeSettings(saved), saved);
});

test('read: "off" is a valid work length', () => {
  assert.strictEqual(normalizeSettings({ workMinutes: 'off' }).workMinutes, 'off');
});

test('read: invalid saved values fall back to the default, valid ones are kept', () => {
  const saved = { workMinutes: 30, idleEnabled: 'yes', idleMinutes: 15 };
  assert.deepStrictEqual(normalizeSettings(saved), { workMinutes: 25, idleEnabled: true, idleMinutes: 15 });
});

test('read: unknown settings in the file are dropped', () => {
  assert.deepStrictEqual(normalizeSettings({ ...DEFAULTS, colour: 'blue' }), DEFAULTS);
});

test('read: the defaults themselves are never changed', () => {
  const s = normalizeSettings({});
  s.workMinutes = 50;
  assert.strictEqual(DEFAULT_SETTINGS.workMinutes, 25);
});

// ---------- changing settings ----------

test('change: one setting at a time, the others stay', () => {
  assert.deepStrictEqual(applySettingsChange(DEFAULTS, { workMinutes: 50 }),
    { workMinutes: 50, idleEnabled: true, idleMinutes: 10 });
  assert.deepStrictEqual(applySettingsChange(DEFAULTS, { idleEnabled: false }),
    { workMinutes: 25, idleEnabled: false, idleMinutes: 10 });
});

test('change: several settings at once', () => {
  assert.deepStrictEqual(applySettingsChange(DEFAULTS, { workMinutes: 'off', idleMinutes: 20 }),
    { workMinutes: 'off', idleEnabled: true, idleMinutes: 20 });
});

test('change: does not modify the current settings object', () => {
  const current = { ...DEFAULTS };
  applySettingsChange(current, { workMinutes: 50 });
  assert.strictEqual(current.workMinutes, 25);
});

test('change: work length other than 25, 50 or "off" is rejected', () => {
  for (const bad of [30, -5, 0, '25', 'abc', null, true]) {
    assert.throws(() => applySettingsChange(DEFAULTS, { workMinutes: bad }), /Work length must be 25, 50 or "off"/,
      `should reject ${JSON.stringify(bad)}`);
  }
});

test('change: idle minutes must be a whole number from 1 to 240', () => {
  for (const bad of [0, -5, 241, 2.5, '10', 'abc', null]) {
    assert.throws(() => applySettingsChange(DEFAULTS, { idleMinutes: bad }), /whole number from 1 to 240/,
      `should reject ${JSON.stringify(bad)}`);
  }
  assert.strictEqual(applySettingsChange(DEFAULTS, { idleMinutes: 1 }).idleMinutes, 1);
  assert.strictEqual(applySettingsChange(DEFAULTS, { idleMinutes: 240 }).idleMinutes, 240);
});

test('change: idle on/off must be true or false', () => {
  assert.throws(() => applySettingsChange(DEFAULTS, { idleEnabled: 'yes' }), /true or false/);
  assert.throws(() => applySettingsChange(DEFAULTS, { idleEnabled: 1 }), /true or false/);
});

test('change: if one value is invalid, nothing is changed', () => {
  assert.throws(() => applySettingsChange(DEFAULTS, { workMinutes: 50, idleMinutes: -5 }));
});

test('change: unknown setting names are ignored', () => {
  assert.deepStrictEqual(applySettingsChange(DEFAULTS, { colour: 'blue' }), DEFAULTS);
});

test('change: something that is not an object is rejected', () => {
  assert.throws(() => applySettingsChange(DEFAULTS, null), /must be sent as an object/);
  assert.throws(() => applySettingsChange(DEFAULTS, [50]), /must be sent as an object/);
  assert.throws(() => applySettingsChange(DEFAULTS, 'off'), /must be sent as an object/);
});
