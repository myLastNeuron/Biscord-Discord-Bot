'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { fmtTime, parseTime, progressBar } = require('../utils/musicFormat');

test('fmtTime renders m:ss and h:mm:ss', () => {
  assert.equal(fmtTime(0), '0:00');
  assert.equal(fmtTime(12), '0:12');
  assert.equal(fmtTime(90), '1:30');
  assert.equal(fmtTime(3750), '1:02:30');
  assert.equal(fmtTime(-5), '0:00');
  assert.equal(fmtTime(NaN), '0:00');
});

test('parseTime accepts seconds, m:ss, and h:mm:ss', () => {
  assert.equal(parseTime('90'), 90);
  assert.equal(parseTime('1:30'), 90);
  assert.equal(parseTime('1:02:30'), 3750);
  assert.equal(parseTime(' 2:05 '), 125);
});

test('parseTime returns null for anything unusable', () => {
  assert.equal(parseTime(''), null);
  assert.equal(parseTime('abc'), null);
  assert.equal(parseTime('1:2:3:4'), null);
  assert.equal(parseTime('1:xx'), null);
  assert.equal(parseTime(null), null);
});

test('progressBar places the marker proportionally', () => {
  assert.equal(progressBar(0, 100, 11), `🔘${'─'.repeat(10)}`);
  assert.equal(progressBar(100, 100, 11), `${'━'.repeat(10)}🔘`);
  assert.equal(progressBar(50, 100, 11), `${'━'.repeat(5)}🔘${'─'.repeat(5)}`);
});

test('progressBar falls back to a start marker for live/unknown duration', () => {
  assert.equal(progressBar(30, 0, 5), `🔘${'─'.repeat(5)}`);
});
