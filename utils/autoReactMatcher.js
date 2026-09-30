// Turns a raw "👍, ❤️ <:custom:123456789012345678>" style string into a list
// of { raw, value } - `raw` is what we show back to the user, `value` is
// what actually gets passed to message.react() (custom emojis need just the
// numeric ID, not the full <:name:id> markdown).
function parseEmojiList(rawInput) {
  if (!rawInput) return [];
  return rawInput
    .split(/[\s,]+/)
    .map((t) => t.trim())
    .filter(Boolean)
    .map((token) => {
      const customMatch = token.match(/^<a?:(\w+):(\d+)>$/);
      return customMatch ? { raw: token, value: customMatch[2] } : { raw: token, value: token };
    });
}

function isImageAttachment(attachment) {
  if (attachment.contentType && attachment.contentType.startsWith('image/')) return true;
  return /\.(png|jpe?g|gif|webp|bmp)(\?.*)?$/i.test(attachment.url || attachment.name || '');
}

// A loose "does this look like a date/time" pattern - matches things like
// 7/26/2026, 26-07-2026, "Aug 3", "August 3rd, 2026", "Aug 3, 8PM".
// It's a heuristic, not a real calendar validator - it just won't match
// random words the way `*` would.
const DATE_PATTERN =
  '(?:\\d{1,2}[\\/\\-.]\\d{1,2}(?:[\\/\\-.]\\d{2,4})?' +
  '|(?:jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\\.?\\s+\\d{1,2}(?:st|nd|rd|th)?(?:,?\\s*\\d{2,4})?)' +
  '(?:[,\\s]+\\d{1,2}(?::\\d{2})?\\s*(?:am|pm)?)?';

// A strict "HH:MM" time-only pattern - stricter than DATE_PATTERN because it
// rejects month names and calendar dates, only a clock time like "8:00" or
// "14:30", optionally with am/pm. Heuristic, not a real time validator (e.g.
// it won't reject "99:99") - it just won't match random words the way `*`
// would, same spirit as DATE_PATTERN.
const TIME_PATTERN = '\\d{1,2}:\\d{2}(?:\\s*(?:am|pm))?';

// Turns a keyword containing `*` / `%` / `^` placeholders into the *body* of
// a regex (no anchors, no flags) - shared by keywordToRegex (substring
// search, used by Auto-React) and templateToRegex (whole-message match, used
// by Reaction Approval's format check) so both features treat the wildcard
// syntax identically.
// `*` = any text goes here (loose wildcard) - anything can be posted here.
// `%` = only something that looks like a date/time goes here (stricter than
//        `*`) - anything else in that spot gets rejected.
// `^` = only something that looks like a time in HH:MM format goes here
//        (stricter still than `%`, and rejects calendar dates too).
function wildcardToRegexBody(pattern) {
  const parts = pattern.split(/([*%^])/);
  return parts
    .map((part) => {
      if (part === '*') return '[\\s\\S]*';
      if (part === '%') return DATE_PATTERN;
      if (part === '^') return TIME_PATTERN;
      return part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    })
    .join('');
}

function keywordToRegex(pattern) {
  return new RegExp(wildcardToRegexBody(pattern), 'i');
}

// Anchored version of the same wildcard syntax - the ENTIRE message has to
// look like the template (not just contain it somewhere), which is what
// "does this message follow the required format" needs.
function templateToRegex(pattern) {
  return new RegExp(`^${wildcardToRegexBody(pattern)}$`, 'i');
}

function matchesOneKeyword(content, keyword) {
  if (keyword.includes('*') || keyword.includes('%') || keyword.includes('^')) return keywordToRegex(keyword).test(content);
  return content.toLowerCase().includes(keyword.toLowerCase());
}

// matchAll=false (default): reacts if ANY keyword/pattern is found (OR).
// matchAll=true: reacts only if EVERY keyword/pattern is found somewhere
// in the message (AND) - useful for a fixed multi-line format where a
// single stray word shouldn't be enough to trigger it.
function matchesKeyword(content, keywords, matchAll = false) {
  if (!content || !keywords?.length) return false;
  return matchAll
    ? keywords.every((k) => matchesOneKeyword(content, k))
    : keywords.some((k) => matchesOneKeyword(content, k));
}

// Does this rule apply to this message?
// NOTE: 'fallback' rules are intentionally NOT handled here - they only
// make sense in the context of "did anything else match this message",
// which is decided in messageCreate.js after trying every other rule.
function ruleMatches(rule, message) {
  if (rule.channelId && rule.channelId !== message.channelId) return false;

  switch (rule.trigger) {
    case 'any':
      return true;
    case 'image':
      return message.attachments.some(isImageAttachment);
    case 'keyword':
      return matchesKeyword(message.content, rule.keywords, rule.matchAll);
    case 'image_keyword':
      return message.attachments.some(isImageAttachment) && matchesKeyword(message.content, rule.keywords, rule.matchAll);
    default:
      return false;
  }
}

async function applyReactions(message, emojis) {
  for (const emoji of emojis) {
    try {
      await message.react(emoji.value);
    } catch (err) {
      console.error(`[autoReact] Failed to react with ${emoji.raw}:`, err.message);
    }
  }
}

function describeRule(rule, guild) {
  const scope = rule.channelId
    ? `#${guild.channels.cache.get(rule.channelId)?.name || 'unknown-channel'}`
    : 'all channels';
  const triggerLabel = {
    any: 'any message',
    image: 'image/attachment',
    keyword: `${rule.matchAll ? 'ALL of' : 'any of'}: ${(rule.keywords || []).join(' | ')}`,
    image_keyword: `image + ${rule.matchAll ? 'ALL of' : 'any of'}: ${(rule.keywords || []).join(' | ')}`,
    fallback: 'fallback (only if exactly one other rule went unmatched)',
  }[rule.trigger] || rule.trigger;
  const emojiDisplay = (rule.emojis || []).map((e) => e.raw).join(' ');
  return `[${scope}] ${triggerLabel} → ${emojiDisplay}`;
}

module.exports = {
  parseEmojiList,
  isImageAttachment,
  matchesKeyword,
  keywordToRegex,
  templateToRegex,
  ruleMatches,
  applyReactions,
  describeRule,
};
