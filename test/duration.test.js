'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  parseDuration,
  formatDuration,
  MAX_GIVEAWAY_DURATION_MS,
} = require('../utils/duration');

test('parseDuration handles single and combined units', () => {
  assert.equal(parseDuration('30m'), 30 * 60 * 1000);
  assert.equal(parseDuration('2h'), 2 * 60 * 60 * 1000);
  assert.equal(parseDuration('1d12h30m'), (24 * 3600 + 12 * 3600 + 30 * 60) * 1000);
  assert.equal(parseDuration('1w 2d 6h'), (7 * 24 * 3600 + 2 * 24 * 3600 + 6 * 3600) * 1000);
});

test('parseDuration is case-insensitive', () => {
  assert.equal(parseDuration('45M'), 45 * 60 * 1000);
  assert.equal(parseDuration('2H'), 2 * 60 * 60 * 1000);
});

test('parseDuration returns null for anything unusable', () => {
  assert.equal(parseDuration(''), null);
  assert.equal(parseDuration('abc'), null);
  assert.equal(parseDuration('0m'), null);
  assert.equal(parseDuration(null), null);
  assert.equal(parseDuration(undefined), null);
  assert.equal(parseDuration(12345), null);
});

test('parseDuration does not leak regex state between calls', () => {
  assert.equal(parseDuration('10m'), 10 * 60 * 1000);
  assert.equal(parseDuration('10m'), 10 * 60 * 1000);
});

test('formatDuration renders compact, capped strings', () => {
  assert.equal(formatDuration(0), '0s');
  assert.equal(formatDuration(90 * 1000), '1m 30s');
  assert.equal(formatDuration((24 * 3600 + 6 * 3600 + 30 * 60) * 1000), '1d 6h 30m');
});

test('giveaway duration cap is 30 days', () => {
  assert.equal(MAX_GIVEAWAY_DURATION_MS, 30 * 24 * 60 * 60 * 1000);
});
