// Shared visual theme for the bot's panels/embeds — a single source of
// truth for colors so the whole bot reads as one cohesive "premium" look
// instead of each file picking its own shade of Discord's default palette.
//
// Discord doesn't support custom fonts or arbitrary button colors (buttons
// are locked to Primary/Secondary/Success/Danger/Link), so "premium" here
// means: a deliberate, restrained color palette (deep jewel tones instead
// of bright default reds/greens/yellows), and small-caps text for major
// headers as a typographic accent where markdown alone falls flat.

const PREMIUM_COLORS = {
  // Primary brand accent — used for neutral/informational panels (the
  // dashboard itself, giveaways, anything that isn't a "status" color).
  accent: 0xC9A961, // champagne gold

  // Status tones — deeper/richer than Discord's stock palette, but still
  // semantically red=bad, green=good, gray=neutral so nothing gets harder
  // to scan at a glance.
  success: 0x2E8B57, // deep sea green
  danger: 0x9B2226,  // deep crimson
  muted: 0x8C8577,   // warm taupe gray (visible against Discord's dark theme,
                      // unlike a near-black which would vanish into the sidebar)

  // Per-action mod-log tones — distinct enough to tell actions apart at a
  // glance in a busy log channel, all pulled from the same warm/jewel-tone
  // family instead of ban=red kick=orange etc. of the default palette.
  ban: 0x9B2226,      // deep crimson (same as danger — a ban IS the danger case)
  kick: 0xB5651D,     // burnt amber
  timeout: 0x5B3256,  // deep plum
  untimeout: 0x2E8B57, // deep sea green (same as success)
  warn: 0xA8862E,     // antique gold (distinct from the main accent gold)
};

// Maps a-z to Unicode small-caps letters (the common "premium Discord bot"
// header style). Characters with no good small-caps glyph (q, x) and
// anything that isn't a-z (numbers, punctuation, emoji) pass through
// unchanged, so this is safe to run on any header string.
const SMALL_CAPS_MAP = {
  a: 'ᴀ', b: 'ʙ', c: 'ᴄ', d: 'ᴅ', e: 'ᴇ', f: 'ꜰ', g: 'ɢ', h: 'ʜ', i: 'ɪ',
  j: 'ᴊ', k: 'ᴋ', l: 'ʟ', m: 'ᴍ', n: 'ɴ', o: 'ᴏ', p: 'ᴘ', r: 'ʀ', s: 'ꜱ',
  t: 'ᴛ', u: 'ᴜ', v: 'ᴠ', w: 'ᴡ', y: 'ʏ', z: 'ᴢ',
};

/**
 * Converts a string to small caps for use in headers, e.g.
 * toSmallCaps('Server Dashboard') -> 'ꜱᴇʀᴠᴇʀ ᴅᴀꜱʜʙᴏᴀʀᴅ'
 * Intended for short header/title lines, not body text or button labels —
 * small caps hurt readability at Discord's small UI font sizes anywhere
 * you'd actually need to read closely.
 */
function toSmallCaps(text) {
  return text
    .toLowerCase()
    .split('')
    .map((ch) => SMALL_CAPS_MAP[ch] || ch)
    .join('');
}

module.exports = { PREMIUM_COLORS, toSmallCaps };
