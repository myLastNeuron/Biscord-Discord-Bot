// Parses a date/time string as if it were written in Europe/London local time,
// and returns the equivalent UTC Date. Uses only built-in Intl APIs — no extra
// npm package needed, and it automatically accounts for GMT/BST switching.

const LONDON_TZ = 'Europe/London';

function londonWallTimeToUTC(year, month, day, hour, minute) {
  // First guess: treat the wall-clock numbers as if they were already UTC.
  const guess = new Date(Date.UTC(year, month - 1, day, hour, minute));

  // Ask: what does this UTC instant actually read as in London?
  const fmt = new Intl.DateTimeFormat('en-GB', {
    timeZone: LONDON_TZ,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hour12: false,
  });
  const parts = fmt.formatToParts(guess).reduce((acc, p) => { acc[p.type] = p.value; return acc; }, {});
  const shown = Date.UTC(
    parseInt(parts.year, 10),
    parseInt(parts.month, 10) - 1,
    parseInt(parts.day, 10),
    parseInt(parts.hour, 10),
    parseInt(parts.minute, 10),
  );

  // Correct our guess by however far off the London reading was.
  const diff = guess.getTime() - shown;
  return new Date(guess.getTime() + diff);
}

/**
 * Parses user input like:
 *   "2026-07-25 18:00"  -> that date/time, London time
 *   "18:00"             -> today (in London's current date) at that time
 * Returns a UTC Date, or null if the input doesn't match either format.
 */
function parseLondonDateTime(input) {
  if (!input) return null;
  const str = input.trim();

  const fullMatch = str.match(/^(\d{4})-(\d{2})-(\d{2})[ T](\d{1,2}):(\d{2})$/);
  if (fullMatch) {
    const [, y, mo, d, h, mi] = fullMatch;
    return londonWallTimeToUTC(+y, +mo, +d, +h, +mi);
  }

  const timeOnlyMatch = str.match(/^(\d{1,2}):(\d{2})$/);
  if (timeOnlyMatch) {
    const [, h, mi] = timeOnlyMatch;
    // Figure out "today" in London's own calendar date, not the server's local date.
    const fmt = new Intl.DateTimeFormat('en-GB', {
      timeZone: LONDON_TZ, year: 'numeric', month: '2-digit', day: '2-digit',
    });
    const parts = fmt.formatToParts(new Date()).reduce((acc, p) => { acc[p.type] = p.value; return acc; }, {});
    return londonWallTimeToUTC(+parts.year, +parts.month, +parts.day, +h, +mi);
  }

  return null;
}

/**
 * Parses a plain "HH:mm" time-of-day string (e.g. for daily recurring schedules).
 * Returns { hour, minute } or null if the input doesn't match.
 */
function parseTimeOfDay(input) {
  if (!input) return null;
  const match = input.trim().match(/^(\d{1,2}):(\d{2})$/);
  if (!match) return null;
  const [, h, mi] = match;
  const hour = parseInt(h, 10);
  const minute = parseInt(mi, 10);
  if (hour > 23 || minute > 59) return null;
  return { hour, minute };
}

/**
 * Returns the current wall-clock time in London as { dateStr, hour, minute }.
 * dateStr is "YYYY-MM-DD" — used to make sure a daily job only fires once per day.
 */
function getLondonNow() {
  const fmt = new Intl.DateTimeFormat('en-GB', {
    timeZone: LONDON_TZ,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hour12: false,
  });
  const parts = fmt.formatToParts(new Date()).reduce((acc, p) => { acc[p.type] = p.value; return acc; }, {});
  return {
    dateStr: `${parts.year}-${parts.month}-${parts.day}`,
    hour: parseInt(parts.hour, 10),
    minute: parseInt(parts.minute, 10),
  };
}

/**
 * Given a daily recurring roster's { hour, minute } and its lastPostedDate
 * ("YYYY-MM-DD" or null), returns the next UTC Date it will fire.
 * If it already posted today, the next run is tomorrow at that time;
 * otherwise it's today (even if that moment has technically just passed —
 * the scheduler will catch it on its next tick).
 */
function nextDailyOccurrenceUTC(hour, minute, lastPostedDate) {
  const now = getLondonNow();
  const [y, mo, d] = now.dateStr.split('-').map(Number);

  if (lastPostedDate === now.dateStr) {
    const tomorrow = new Date(Date.UTC(y, mo - 1, d + 1));
    return londonWallTimeToUTC(tomorrow.getUTCFullYear(), tomorrow.getUTCMonth() + 1, tomorrow.getUTCDate(), hour, minute);
  }
  return londonWallTimeToUTC(y, mo, d, hour, minute);
}

module.exports = { parseLondonDateTime, parseTimeOfDay, getLondonNow, nextDailyOccurrenceUTC };
