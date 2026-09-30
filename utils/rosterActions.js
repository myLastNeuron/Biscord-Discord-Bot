// Pure roster logic — no Discord API calls here, just array bookkeeping.
// Keeping this separate makes the join/leave/promote rules easy to test and tweak.

const { recordAttendance } = require('./db');

function compact(arr, size) {
  const values = arr.filter(Boolean);
  while (values.length < size) values.push(null);
  return values.slice(0, size);
}

/** Returns { result: 'joined-main'|'joined-sub'|'already-in'|'full', event } */
function joinRoster(event, userId) {
  if (event.main.includes(userId) || event.subs.includes(userId)) {
    return { result: 'already-in', event };
  }

  const mainIndex = event.main.indexOf(null);
  if (mainIndex !== -1) {
    event.main[mainIndex] = userId;
    return { result: 'joined-main', event };
  }

  const subIndex = event.subs.indexOf(null);
  if (event.subSlots > 0 && subIndex !== -1) {
    event.subs[subIndex] = userId;
    return { result: 'joined-sub', event };
  }

  return { result: 'full', event };
}

/** Returns { result: 'left'|'not-in', event, promotedUserId } and auto-promotes the first sub into any opened main slot. */
function leaveRoster(event, userId) {
  const wasInMain = event.main.includes(userId);
  const wasInSubs = event.subs.includes(userId);

  if (!wasInMain && !wasInSubs) return { result: 'not-in', event, promotedUserId: null };

  event.main = event.main.map(id => (id === userId ? null : id));
  event.subs = event.subs.map(id => (id === userId ? null : id));

  event.main = compact(event.main, event.mainSlots);
  event.subs = compact(event.subs, event.subSlots);

  // Promote the first waiting sub into the newly opened main slot, if any.
  let promotedUserId = null;
  const openMainIndex = event.main.indexOf(null);
  const firstSubIndex = event.subs.findIndex(Boolean);
  if (openMainIndex !== -1 && firstSubIndex !== -1) {
    promotedUserId = event.subs[firstSubIndex];
    event.main[openMainIndex] = promotedUserId;
    event.subs[firstSubIndex] = null;
    event.subs = compact(event.subs, event.subSlots);
  }

  return { result: 'left', event, promotedUserId };
}

function toggleLock(event) {
  event.locked = !event.locked;
  return event;
}

// Call this whenever a roster transitions to locked — from the manual Lock
// button or the scheduler's auto-lock sweep. Credits attendance for everyone
// currently sitting in a MAIN slot at that exact moment (subs are on standby,
// not confirmed as playing). Anyone who joined and then left before the lock
// never appears in event.main at this point, so they simply never get
// credited — no separate "un-counting" step needed.
//
// Idempotent per user via event.attendedRecorded, so re-locking a roster
// after a manual unlock only credits people who weren't already recorded.
function recordLockAttendance(event) {
  event.attendedRecorded ??= [];
  for (const userId of event.main) {
    if (!userId) continue;
    if (event.attendedRecorded.includes(userId)) continue;
    event.attendedRecorded.push(userId);
    recordAttendance(event.guildId, userId, event.category);
  }
  return event;
}

module.exports = { joinRoster, leaveRoster, toggleLock, recordLockAttendance };
