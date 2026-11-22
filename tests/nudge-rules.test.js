// Unit tests for the nudge rules (Week 5):
//   - activeWorkMs: how much active work time a running session has
//   - evaluateNudges: which nudges to send now, with the cooldown rules
// Run with:  npm test

const test = require('node:test');
const assert = require('node:assert');
const { activeWorkMs, initialNudgeState, evaluateNudges } = require('../server.js');

const SEC = 1000;
const MIN = 60 * SEC;
const START = new Date(2026, 10, 22, 9, 0, 0); // session started 09:00 local

// A reading every 5 s from `fromMin` to `toMin` minutes after START.
function steadyReadings(fromMin, toMin, app = 'Code', idle = false) {
  const out = [];
  for (let ms = fromMin * MIN; ms < toMin * MIN; ms += 5 * SEC) {
    const r = { t: new Date(START.getTime() + ms), app };
    if (idle) r.idle = true;
    out.push(r);
  }
  return out;
}
const at = minutes => new Date(START.getTime() + minutes * MIN);

// ---------- activeWorkMs: what counts toward the work length ----------

test('work time: a steady 30 minutes of readings counts as 30 minutes', () => {
  assert.strictEqual(activeWorkMs(steadyReadings(0, 30), START, at(30)), 30 * MIN);
});

test('work time: idle readings add nothing', () => {
  const r = [...steadyReadings(0, 10), ...steadyReadings(10, 20, 'Code', true), ...steadyReadings(20, 30)];
  assert.strictEqual(activeWorkMs(r, START, at(30)), 20 * MIN);
});

test('work time: a gap (Mac asleep, app closed) counts at most 10 seconds', () => {
  // 10 min of work, a 1-hour gap, then 10 more min of work.
  const r = [...steadyReadings(0, 10), ...steadyReadings(70, 80)];
  assert.strictEqual(activeWorkMs(r, START, at(80)), 20 * MIN + 5 * SEC);
  // (the last reading before the gap counts 10 s instead of its usual 5 s)
});

test('work time: readings from before the session started are ignored', () => {
  const before = steadyReadings(-30, 0); // 30 min before the session
  assert.strictEqual(activeWorkMs([...before, ...steadyReadings(0, 5)], START, at(5)), 5 * MIN);
});

test('work time: readings after "now" are ignored', () => {
  assert.strictEqual(activeWorkMs(steadyReadings(0, 30), START, at(10)), 10 * MIN);
});

test('work time: the latest reading counts until now, capped at 10 s', () => {
  const r = [{ t: at(0), app: 'Code' }];
  assert.strictEqual(activeWorkMs(r, START, new Date(START.getTime() + 3 * SEC)), 3 * SEC);
  assert.strictEqual(activeWorkMs(r, START, at(5)), 10 * SEC);
});

test('work time: time in the tracker itself DOES count as work', () => {
  const r = steadyReadings(0, 10, 'Productivity Tracker');
  assert.strictEqual(activeWorkMs(r, START, at(10)), 10 * MIN);
});

test('work time: no readings means no work time', () => {
  assert.strictEqual(activeWorkMs([], START, at(60)), 0);
});

test('work time: readings out of order are handled', () => {
  const r = steadyReadings(0, 10).reverse();
  assert.strictEqual(activeWorkMs(r, START, at(10)), 10 * MIN);
});

// ---------- evaluateNudges: helpers ----------

const SESSION = { task: 'Write report', category: 'Work', startTime: START.toISOString() };
const SETTINGS_50 = { workMinutes: 50, idleEnabled: true, idleMinutes: 10 };

// Runs a series of checks, carrying the memory (state) from one to the next,
// like the server does every 5 seconds. Returns the titles sent at each check.
function runChecks(checks, settings = SETTINGS_50) {
  let state = initialNudgeState();
  return checks.map(input => {
    const result = evaluateNudges(state, { active: SESSION, settings, idleSeconds: 2, ...input });
    state = result.state;
    return result.nudges.map(n => n.title);
  });
}

// ---------- break nudge ----------

test('break: nothing before the work length is reached', () => {
  assert.deepStrictEqual(runChecks([{ activeMs: 0 }, { activeMs: 30 * MIN }, { activeMs: 49.9 * MIN }]),
    [[], [], []]);
});

test('break: exactly one nudge when the work length is reached', () => {
  assert.deepStrictEqual(runChecks([{ activeMs: 49 * MIN }, { activeMs: 50 * MIN }]),
    [[], ['Time for a break']]);
});

test('break: not repeated within the same block', () => {
  assert.deepStrictEqual(runChecks([{ activeMs: 50 * MIN }, { activeMs: 51 * MIN }, { activeMs: 99 * MIN }]),
    [['Time for a break'], [], []]);
});

test('break: again after each further block (100, 150 …)', () => {
  assert.deepStrictEqual(
    runChecks([{ activeMs: 50 * MIN }, { activeMs: 100 * MIN }, { activeMs: 120 * MIN }, { activeMs: 150 * MIN }]),
    [['Time for a break'], ['Time for a break'], [], ['Time for a break']]);
});

test('break: the message names the total minutes and the task', () => {
  let state = initialNudgeState();
  state = evaluateNudges(state, { active: SESSION, settings: SETTINGS_50, activeMs: 50 * MIN, idleSeconds: 1 }).state;
  const { nudges } = evaluateNudges(state, { active: SESSION, settings: SETTINGS_50, activeMs: 100 * MIN, idleSeconds: 1 });
  assert.match(nudges[0].body, /100 minutes/);
  assert.match(nudges[0].body, /"Write report"/);
});

test('break: several missed blocks at once (e.g. after a restart) give ONE nudge', () => {
  assert.deepStrictEqual(runChecks([{ activeMs: 160 * MIN }, { activeMs: 161 * MIN }]),
    [['Time for a break'], []]);
});

test('break: the 25-minute setting nudges at 25 and 50', () => {
  const s25 = { ...SETTINGS_50, workMinutes: 25 };
  assert.deepStrictEqual(runChecks([{ activeMs: 24 * MIN }, { activeMs: 25 * MIN }, { activeMs: 50 * MIN }], s25),
    [[], ['Time for a break'], ['Time for a break']]);
});

test('break: "off" never nudges', () => {
  const off = { ...SETTINGS_50, workMinutes: 'off' };
  assert.deepStrictEqual(runChecks([{ activeMs: 50 * MIN }, { activeMs: 500 * MIN }], off), [[], []]);
});

test('break: idle time pushes the nudge later (via active work time)', () => {
  // 40 min work, 20 min idle, then work again: 50 active minutes only at minute 70.
  const r = [...steadyReadings(0, 40), ...steadyReadings(40, 60, 'Code', true), ...steadyReadings(60, 75)];
  const checkAt = m => ({ activeMs: activeWorkMs(r, START, at(m)) });
  assert.deepStrictEqual(runChecks([checkAt(50), checkAt(60), checkAt(69), checkAt(70)]),
    [[], [], [], ['Time for a break']]);
});

test('break: a new session starts counting again', () => {
  let state = initialNudgeState();
  state = evaluateNudges(state, { active: SESSION, settings: SETTINGS_50, activeMs: 60 * MIN, idleSeconds: 1 }).state;
  const next = { ...SESSION, startTime: at(120).toISOString() };
  const early = evaluateNudges(state, { active: next, settings: SETTINGS_50, activeMs: 10 * MIN, idleSeconds: 1 });
  assert.deepStrictEqual(early.nudges, []);
  const due = evaluateNudges(early.state, { active: next, settings: SETTINGS_50, activeMs: 50 * MIN, idleSeconds: 1 });
  assert.deepStrictEqual(due.nudges.map(n => n.title), ['Time for a break']);
});

// ---------- idle nudge ----------

test('idle: nothing while you are active', () => {
  assert.deepStrictEqual(runChecks([{ activeMs: 0, idleSeconds: 5 }, { activeMs: 0, idleSeconds: 599 }]), [[], []]);
});

test('idle: one nudge at the idle limit', () => {
  assert.deepStrictEqual(runChecks([{ activeMs: 0, idleSeconds: 600 }]), [['Still working?']]);
});

test('idle: only once per idle stretch', () => {
  assert.deepStrictEqual(
    runChecks([{ activeMs: 0, idleSeconds: 600 }, { activeMs: 0, idleSeconds: 900 }, { activeMs: 0, idleSeconds: 3600 }]),
    [['Still working?'], [], []]);
});

test('idle: again only after there has been input in between', () => {
  assert.deepStrictEqual(
    runChecks([
      { activeMs: 0, idleSeconds: 600 },  // nudge
      { activeMs: 0, idleSeconds: 2 },    // back at the keyboard
      { activeMs: 0, idleSeconds: 600 }   // away again → nudge again
    ]),
    [['Still working?'], [], ['Still working?']]);
});

test('idle: a failed idle check (null) never triggers it — and counts as activity', () => {
  assert.deepStrictEqual(
    runChecks([
      { activeMs: 0, idleSeconds: null },
      { activeMs: 0, idleSeconds: 600 },  // nudge
      { activeMs: 0, idleSeconds: null }, // unknown → treated as active, resets
      { activeMs: 0, idleSeconds: 600 }   // nudge again
    ]),
    [[], ['Still working?'], [], ['Still working?']]);
});

test('idle: switched off → no idle nudge', () => {
  const off = { ...SETTINGS_50, idleEnabled: false };
  assert.deepStrictEqual(runChecks([{ activeMs: 0, idleSeconds: 3600 }], off), [[]]);
});

test('idle: uses the idle minutes setting', () => {
  const one = { ...SETTINGS_50, idleMinutes: 1 };
  assert.deepStrictEqual(runChecks([{ activeMs: 0, idleSeconds: 59 }, { activeMs: 0, idleSeconds: 60 }], one),
    [[], ['Still working?']]);
});

test('idle: the message names the minutes and the task', () => {
  const { nudges } = evaluateNudges(initialNudgeState(),
    { active: SESSION, settings: SETTINGS_50, activeMs: 0, idleSeconds: 600 });
  assert.match(nudges[0].body, /10 minutes/);
  assert.match(nudges[0].body, /"Write report"/);
});

// ---------- both, and no session ----------

test('no running session → no nudges at all', () => {
  const { nudges } = evaluateNudges(initialNudgeState(),
    { active: null, settings: SETTINGS_50, activeMs: 500 * MIN, idleSeconds: 3600 });
  assert.deepStrictEqual(nudges, []);
});

test('stopping the session clears the memory (no leftovers for the next one)', () => {
  let state = evaluateNudges(initialNudgeState(),
    { active: SESSION, settings: SETTINGS_50, activeMs: 50 * MIN, idleSeconds: 600 }).state;
  state = evaluateNudges(state, { active: null, settings: SETTINGS_50, activeMs: 0, idleSeconds: 600 }).state;
  assert.deepStrictEqual(state, initialNudgeState());
});

test('break and idle can both be due in the same check', () => {
  const { nudges } = evaluateNudges(initialNudgeState(),
    { active: SESSION, settings: SETTINGS_50, activeMs: 50 * MIN, idleSeconds: 600 });
  assert.deepStrictEqual(nudges.map(n => n.title), ['Time for a break', 'Still working?']);
});

test('the decision does not change the memory object it was given', () => {
  const state = initialNudgeState();
  evaluateNudges(state, { active: SESSION, settings: SETTINGS_50, activeMs: 50 * MIN, idleSeconds: 600 });
  assert.deepStrictEqual(state, initialNudgeState());
});
