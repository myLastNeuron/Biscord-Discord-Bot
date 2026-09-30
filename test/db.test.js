'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

// Isolate all db writes in a throwaway directory. DATA_DIR is read when
// utils/safeFile (and therefore utils/db) is first required.
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'biscord-db-'));
process.env.DATA_DIR = tmp;

const db = require('../utils/db');
const { readJson } = require('../utils/safeFile');

test.after(() => fs.rmSync(tmp, { recursive: true, force: true }));

test('honours the DATA_DIR override', () => {
  assert.equal(db.DATA_DIR, tmp);
});

test('unknown guilds get the documented defaults', () => {
  const settings = db.getGuildSettings('guild-unknown');
  assert.deepEqual(settings, { ...db.DEFAULT_GUILD_SETTINGS });
});

test('guild settings merge patches and are visible immediately', () => {
  db.setGuildSettings('g1', { welcomeChannelId: 'chan-1' });
  db.setGuildSettings('g1', { logChannelId: 'chan-2' });
  const settings = db.getGuildSettings('g1');
  assert.equal(settings.welcomeChannelId, 'chan-1');
  assert.equal(settings.logChannelId, 'chan-2');
  // Untouched defaults survive the merge.
  assert.equal(settings.ticketDmTranscriptToOpener, true);
});

test('warnings accumulate, list and clear', () => {
  db.addWarning('g1', 'u1', { reason: 'spam', timestamp: 1 });
  db.addWarning('g1', 'u1', { reason: 'spam again', timestamp: 2 });
  assert.equal(db.getWarnings('g1', 'u1').length, 2);

  const listed = db.listWarnings('g1');
  assert.equal(listed.length, 1);
  assert.equal(listed[0].userId, 'u1');
  assert.equal(listed[0].count, 2);

  db.clearWarnings('g1', 'u1');
  assert.deepEqual(db.getWarnings('g1', 'u1'), []);
});

test('giveaways save, update, list and delete', () => {
  db.saveGiveaway('tok-1', { guildId: 'g1', status: 'active', prize: 'Nitro' });
  db.updateGiveaway('tok-1', { status: 'ended' });

  assert.equal(db.getGiveaway('tok-1').status, 'ended');
  assert.equal(db.listGiveaways('g1').length, 1);
  assert.equal(db.listActiveGiveaways().length, 0);

  db.deleteGiveaway('tok-1');
  assert.equal(db.getGiveaway('tok-1'), null);
});

test('attendance stats increment', () => {
  db.recordAttendance('g1', 'u1', 'Raid');
  const stats = db.recordAttendance('g1', 'u1', 'Raid');
  assert.equal(stats.total, 2);
  assert.equal(stats.categories.Raid, 2);
  assert.equal(db.getUserStats('g1', 'u1').total, 2);
});

test('restart flag is written to disk immediately', () => {
  db.setRestartFlag({ reason: 'unit-test' });
  const onDisk = readJson(path.join(tmp, 'restartFlag.json'));
  assert.equal(onDisk.active, true);
  assert.equal(onDisk.reason, 'unit-test');

  db.clearRestartFlag();
  assert.deepEqual(readJson(path.join(tmp, 'restartFlag.json')), {});
});

test('coalesced writes reach disk after flush and leave no temp files', () => {
  db.addWarning('g2', 'u2', { reason: 'queued', timestamp: 5 });
  // Not necessarily on disk yet...
  db.flush();
  // ...but after flush it must be.
  const onDisk = readJson(path.join(tmp, 'warnings.json'));
  assert.equal(onDisk.g2.u2.length, 1);

  const leftovers = fs.readdirSync(tmp).filter((f) => f.includes('.tmp-'));
  assert.deepEqual(leftovers, []);
});
