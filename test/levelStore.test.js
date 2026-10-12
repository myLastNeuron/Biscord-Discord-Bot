'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

// Isolate level-store writes. DATA_DIR is read when utils/safeFile is first required.
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'biscord-levels-'));
process.env.DATA_DIR = tmp;

const store = require('../utils/levelStore');

test.after(() => fs.rmSync(tmp, { recursive: true, force: true }));

test('message counts increment independently of XP', () => {
  store.incrementMessageCount('g1', 'u1');
  store.incrementMessageCount('g1', 'u1');
  assert.equal(store.getUser('g1', 'u1').messageCount, 2);
});
