'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  parseTimeOfDay,
  parseLondonDateTime,
  getLondonNow,
  nextDailyOccurrenceUTC,
} = require('../utils/time');

test('parseTimeOfDay accepts valid HH:mm only', () => {
  assert.deepEqual(parseTimeOfDay('08:30'), { hour: 8, minute: 30 });
  assert.deepEqual(parseTimeOfDay(' 23:59 '), { hour: 23, minute: 59 });
  assert.equal(parseTimeOfDay('24:00'), null);
  assert.equal(parseTimeOfDay('12:60'), null);
  assert.equal(parseTimeOfDay('noon'), null);
  assert.equal(parseTimeOfDay(''), null);
});

test('parseLondonDateTime applies GMT in winter', () => {
  const d = parseLondonDateTime('2026-01-15 12:00');
  assert.equal(d.toISOString(), '2026-01-15T12:00:00.000Z');
});

test('parseLondonDateTime applies BST in summer', () => {
  const d = parseLondonDateTime('2026-07-15 12:00');
  assert.equal(d.toISOString(), '2026-07-15T11:00:00.000Z');
});

test('parseLondonDateTime rejects junk', () => {
  assert.equal(parseLondonDateTime('not a date'), null);
  assert.equal(parseLondonDateTime(''), null);
});

test('getLondonNow returns a well-formed London timestamp', () => {
  const now = getLondonNow();
  assert.match(now.dateStr, /^\d{4}-\d{2}-\d{2}$/);
  assert.ok(now.hour >= 0 && now.hour <= 23);
  assert.ok(now.minute >= 0 && now.minute <= 59);
});

test('nextDailyOccurrenceUTC schedules later today when not yet posted', () => {
  const next = nextDailyOccurrenceUTC(0, 0, null);
  assert.ok(next instanceof Date && !Number.isNaN(next.getTime()));
});
