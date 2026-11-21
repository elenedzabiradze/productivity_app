// Unit tests for reading the frontmost app's name from macOS's `lsappinfo`
// output. A failed or empty reading must come back as null (= skip it),
// never crash.
// Run with:  npm test

const test = require('node:test');
const assert = require('node:assert');
const { parseFrontAsn, parseAppName } = require('../server.js');

// ---------- parseFrontAsn: output of `lsappinfo front` ----------

test('front: returns the app ID from normal output', () => {
  assert.strictEqual(parseFrontAsn('ASN:0x0-0x212212:\n'), 'ASN:0x0-0x212212:');
});

test('front: empty output means no reading', () => {
  assert.strictEqual(parseFrontAsn(''), null);
  assert.strictEqual(parseFrontAsn('   \n'), null);
});

test('front: a failed command (null) means no reading', () => {
  assert.strictEqual(parseFrontAsn(null), null);
  assert.strictEqual(parseFrontAsn(undefined), null);
});

test('front: error text means no reading', () => {
  assert.strictEqual(parseFrontAsn('lsappinfo: unable to connect to server'), null);
});

test('front: an ID with extra words after it is rejected', () => {
  assert.strictEqual(parseFrontAsn('ASN:0x0-0x1: something else'), null);
});

// ---------- parseAppName: output of `lsappinfo info -only name <ID>` ----------

test('name: returns the app name from normal output', () => {
  assert.strictEqual(parseAppName('"LSDisplayName"="Code"\n'), 'Code');
});

test('name: keeps spaces inside app names', () => {
  assert.strictEqual(parseAppName('"LSDisplayName"="Google Chrome"'), 'Google Chrome');
  assert.strictEqual(parseAppName('"LSDisplayName"="Productivity Tracker"'), 'Productivity Tracker');
});

test('name: handles non-English app names', () => {
  assert.strictEqual(parseAppName('"LSDisplayName"="Café Écrire"'), 'Café Écrire');
});

test('name: empty output means no reading', () => {
  assert.strictEqual(parseAppName(''), null);
});

test('name: a failed command (null) means no reading', () => {
  assert.strictEqual(parseAppName(null), null);
});

test('name: output without a name field means no reading', () => {
  // e.g. the app quit between the two commands
  assert.strictEqual(parseAppName('"bundleID"="com.example.app"'), null);
  assert.strictEqual(parseAppName('lsappinfo: no such application'), null);
});

test('name: an empty or blank name means no reading', () => {
  assert.strictEqual(parseAppName('"LSDisplayName"=""'), null);
  assert.strictEqual(parseAppName('"LSDisplayName"="   "'), null);
});
