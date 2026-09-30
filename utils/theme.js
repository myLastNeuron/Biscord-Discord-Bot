// Shared visual theme for the bot's panels/embeds — a single source of
// truth for colors so the whole bot reads as one cohesive look instead of
// each file picking its own shade.
//
// Palette: a clean, saturated "Dyno-style" blue as the brand accent (not
// Discord's stock purple-leaning blurple), with vivid-but-legible status
// tones layered on top. Status colors stay semantically red=bad, green=good,
// gray=neutral so panels are still scannable at a glance — only the neutral
// "branding" chrome (headers, informational panels, toggles-off state)
// actually shifts blue.
//
// Discord doesn't support custom fonts or arbitrary button colors (buttons
// are locked to Primary/Secondary/Success/Danger/Link), so small-caps text
// for major headers is still used as a typographic accent where markdown
// alone falls flat.

const PREMIUM_COLORS = {
  // Primary brand accent — used for neutral/informational panels (the
  // dashboard itself, giveaways, anything that isn't a "status" color).
  accent: 0x3B82F6,      // Dyno-style blue
  accentDark: 0x1D4ED8,  // deeper blue, for emphasis (e.g. active/selected states)
  accentLight: 0x93C5FD, // pale blue, for subtle highlights against dark UI

  // Status tones — vivid and modern, but still semantically red=bad,
  // green=good, gray=neutral so nothing gets harder to scan at a glance.
  success: 0x22C55E, // clean green
  danger: 0xEF4444,  // clean red
  muted: 0x64748B,   // slate blue-gray (fits the blue family, still visible
                      // against Discord's dark theme unlike a near-black)

  // Per-action mod-log tones — distinct enough to tell actions apart at a
  // glance in a busy log channel, pulled from a "cool" palette that sits
  // alongside the blue brand accent instead of clashing with it.
  ban: 0xEF4444,      // clean red (same as danger — a ban IS the danger case)
  kick: 0xF97316,     // orange (kept warm on purpose — deliberate contrast
                       // against the blue theme so it still pops in a log)
  timeout: 0x6366F1,  // indigo (cool-toned, distinct from the main accent blue)
  untimeout: 0x22C55E, // clean green (same as success)
  warn: 0xEAB308,     // amber (kept warm for the same reason as kick)

  // Minimalist "dark dashboard" tone — a neutral graphite used for the
  // /panel main container(s). Deliberately monochrome (no blue) so the
  // dashboard reads as clean/minimal against Discord's dark theme; the
  // colourful status tones above stay reserved for actual mod/log actions.
  dash: 0x6B7280,     // gray-500 graphite
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
