// Parses human-friendly duration strings like "30m", "2h", "1d", "1d12h30m"
// into milliseconds, and formats milliseconds back into a readable string.
// Used by giveaway creation (both /giveaway create and the /panel wizard).

const UNIT_MS = {
  w: 7 * 24 * 60 * 60 * 1000,
  d: 24 * 60 * 60 * 1000,
  h: 60 * 60 * 1000,
  m: 60 * 1000,
  s: 1000,
};

// Hard cap for giveaway durations (30 days) — prevents a never-ending
// giveaway (or an accidental typo like "3w" instead of "3d") from running
// for months on end.
const MAX_GIVEAWAY_DURATION_MS = 30 * 24 * 60 * 60 * 1000;

const SEGMENT_RE = /(\d+)\s*(w|d|h|m|s)/gi;

/**
 * Parses a duration string. Accepts one or more "<number><unit>" segments in
 * any combination, e.g. "45m", "2h", "1d12h", "1w 2d 6h". Returns
 * milliseconds, or null if nothing valid could be parsed.
 */
function parseDuration(input) {
  if (!input || typeof input !== 'string') return null;

  let totalMs = 0;
  let matched = false;
  let match;
  SEGMENT_RE.lastIndex = 0;
  while ((match = SEGMENT_RE.exec(input)) !== null) {
    matched = true;
    const amount = parseInt(match[1], 10);
    const unit = match[2].toLowerCase();
    totalMs += amount * UNIT_MS[unit];
  }

  if (!matched || totalMs <= 0) return null;
  return totalMs;
}

/** Formats milliseconds as a compact human string, e.g. "1d 6h 30m". */
function formatDuration(ms) {
  if (!ms || ms <= 0) return '0s';

  const parts = [];
  let remaining = ms;

  for (const [unit, unitMs] of [['w', UNIT_MS.w], ['d', UNIT_MS.d], ['h', UNIT_MS.h], ['m', UNIT_MS.m], ['s', UNIT_MS.s]]) {
    const count = Math.floor(remaining / unitMs);
    if (count > 0) {
      parts.push(`${count}${unit}`);
      remaining -= count * unitMs;
    }
  }

  return parts.slice(0, 3).join(' ') || '0s'; // cap at 3 units so it stays readable
}

module.exports = { parseDuration, formatDuration, MAX_GIVEAWAY_DURATION_MS };
