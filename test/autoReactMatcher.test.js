'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  parseEmojiList,
  isImageAttachment,
  matchesKeyword,
  keywordToRegex,
  templateToRegex,
  ruleMatches,
} = require('../utils/autoReactMatcher');

test('parseEmojiList unwraps custom emojis to their ID', () => {
  const parsed = parseEmojiList('<:party:123456789012345678> 👍');
  assert.deepEqual(parsed, [
    { raw: '<:party:123456789012345678>', value: '123456789012345678' },
    { raw: '👍', value: '👍' },
  ]);
});

test('parseEmojiList handles animated emojis and empty input', () => {
  assert.deepEqual(parseEmojiList('<a:dance:987654321098765432>'), [
    { raw: '<a:dance:987654321098765432>', value: '987654321098765432' },
  ]);
  assert.deepEqual(parseEmojiList(''), []);
  assert.deepEqual(parseEmojiList(null), []);
});

test('isImageAttachment trusts contentType and falls back to extension', () => {
  assert.equal(isImageAttachment({ contentType: 'image/png', url: 'https://x/y' }), true);
  assert.equal(isImageAttachment({ contentType: 'video/mp4', url: 'https://x/clip.mp4' }), false);
  assert.equal(isImageAttachment({ url: 'https://x/photo.JPEG' }), true);
  assert.equal(isImageAttachment({ name: 'pic.webp' }), true);
});

test('matchesKeyword OR (default) and AND (matchAll) modes', () => {
  assert.equal(matchesKeyword('hello world', ['hello', 'nope']), true);
  assert.equal(matchesKeyword('hello world', ['hello', 'nope'], true), false);
  assert.equal(matchesKeyword('hello world', ['hello', 'world'], true), true);
  assert.equal(matchesKeyword('', ['hello']), false);
  assert.equal(matchesKeyword('hello', []), false);
});

test('keywordToRegex treats * as a loose wildcard', () => {
  assert.equal(keywordToRegex('hello *').test('hello there friend'), true);
  assert.equal(keywordToRegex('hello *').test('nothing here'), false);
});

test('templateToRegex is anchored to the whole message', () => {
  const re = templateToRegex('report *');
  assert.equal(re.test('report done'), true);
  assert.equal(re.test('say report done'), false);
});

test("% placeholder only accepts date/time-shaped text", () => {
  assert.equal(matchesKeyword('meeting 7/26/2026', ['meeting %']), true);
  assert.equal(matchesKeyword('meeting Aug 3', ['meeting %']), true);
  assert.equal(matchesKeyword('meeting hello', ['meeting %']), false);
});

test('ruleMatches respects channel scope and trigger type', () => {
  const message = {
    channelId: 'chan-1',
    content: 'hello world',
    attachments: [],
  };
  assert.equal(ruleMatches({ trigger: 'any' }, message), true);
  assert.equal(ruleMatches({ trigger: 'any', channelId: 'other' }, message), false);
  assert.equal(ruleMatches({ trigger: 'keyword', keywords: ['hello'] }, message), true);
  assert.equal(ruleMatches({ trigger: 'image', channelId: null }, message), false);
  assert.equal(ruleMatches({ trigger: 'fallback' }, message), false);
});
