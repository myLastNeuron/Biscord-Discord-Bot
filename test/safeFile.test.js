'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

// Point the bot's data directory at a throwaway folder BEFORE the store is
// required — safeFile reads DATA_DIR at module load.
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'biscord-safe-'));
process.env.DATA_DIR = tmp;

const { dataPath, readJson, writeJsonAtomic } = require('../utils/safeFile');

test.after(() => fs.rmSync(tmp, { recursive: true, force: true }));

test('dataPath resolves inside the DATA_DIR override', () => {
  assert.equal(dataPath('things.json'), path.join(tmp, 'things.json'));
});

test('writeJsonAtomic / readJson round-trip', () => {
  const file = dataPath('roundtrip.json');
  writeJsonAtomic(file, { hello: 'world', n: 3 });
  assert.deepEqual(readJson(file), { hello: 'world', n: 3 });
});

test('readJson falls back for missing or corrupt files', () => {
  assert.deepEqual(readJson(dataPath('missing.json'), { fallback: true }), { fallback: true });

  const broken = dataPath('broken.json');
  fs.writeFileSync(broken, '{ this is not json');
  assert.deepEqual(readJson(broken, { fallback: 2 }), { fallback: 2 });
});

test('writeJsonAtomic creates nested directories and leaves no temp files', () => {
  const file = dataPath(path.join('nested', 'deep', 'state.json'));
  writeJsonAtomic(file, { ok: true });
  assert.deepEqual(readJson(file), { ok: true });

  const leftovers = fs.readdirSync(path.dirname(file)).filter((f) => f.includes('.tmp-'));
  assert.deepEqual(leftovers, [], 'no temp files should survive a successful write');
});

test('writeJsonAtomic replaces existing content wholesale', () => {
  const file = dataPath('replace.json');
  writeJsonAtomic(file, { a: 1, b: 2 });
  writeJsonAtomic(file, { a: 9 });
  assert.deepEqual(readJson(file), { a: 9 });
});
