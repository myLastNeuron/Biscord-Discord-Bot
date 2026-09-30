// Polls every 30 seconds for two kinds of pending items:
//   1. Scheduled event panels (scheduledEvents.json) — posted as a roster panel.
//   2. Scheduled plain messages (scheduledMessages.json) — posted as a normal message.
// Both are removed from their "pending" store once sent.

const {
  getScheduledEvents, deleteScheduledEvent, saveEvent,
  getScheduledMessages, deleteScheduledMessage,
  getAutopostRosters, saveAutopostRoster,
  listAllEvents,
  listActiveGiveaways, getGuildSettings,
  listActivePolls,
} = require('./db');
const { buildRosterEmbed, buildRosterButtons } = require('./rosterBuilder');
const { recordLockAttendance } = require('./rosterActions');
const { getLondonNow } = require('./time');
const { finalizeGiveaway } = require('./giveawayManager');
const { finalizePoll } = require('./pollManager');

const CHECK_INTERVAL_MS = 30 * 1000;

async function processScheduledEvents(client) {
  const scheduled = getScheduledEvents();
  const now = Date.now();

  for (const [token, event] of Object.entries(scheduled)) {
    if (!event.scheduledFor || event.scheduledFor > now) continue;

    try {
      const guild = await client.guilds.fetch(event.guildId).catch(() => null);
      const channel = guild ? await guild.channels.fetch(event.channelId).catch(() => null) : null;

      if (!channel) {
        console.error(`[scheduler] Channel for scheduled panel "${event.title}" no longer exists — dropping it.`);
        deleteScheduledEvent(token);
        continue;
      }

      // Send with NO buttons yet — see interactionCreate.js for why.
      const message = await channel.send({
        embeds: [buildRosterEmbed(event)],
      });

      saveEvent(message.id, event);
      await message.edit({ components: buildRosterButtons(message.id, false) });

      deleteScheduledEvent(token);
    } catch (err) {
      console.error(`[scheduler] Failed to post scheduled panel "${event.title}":`, err);
    }
  }
}

async function processScheduledMessages(client) {
  const scheduled = getScheduledMessages();
  const now = Date.now();

  for (const [token, item] of Object.entries(scheduled)) {
    if (!item.sendAt || item.sendAt > now) continue;

    try {
      const guild = await client.guilds.fetch(item.guildId).catch(() => null);
      const channel = guild ? await guild.channels.fetch(item.channelId).catch(() => null) : null;

      if (!channel) {
        console.error('[scheduler] Channel for scheduled message no longer exists — dropping it.');
        deleteScheduledMessage(token);
        continue;
      }

      await channel.send({ content: item.content });
      deleteScheduledMessage(token);
    } catch (err) {
      console.error('[scheduler] Failed to send scheduled message:', err);
    }
  }
}

// Actually posts one autopost roster's panel to its channel. Shared by both
// the daily and hourly scheduling branches below — only the "have I already
// fired for this tick" bookkeeping differs between them.
async function postAutopostRosterPanel(client, roster) {
  const guild = await client.guilds.fetch(roster.guildId).catch(() => null);
  const channel = guild ? await guild.channels.fetch(roster.channelId).catch(() => null) : null;

  if (!channel) {
    console.error(`[scheduler] Channel for autopost roster "${roster.title}" no longer exists — skipping.`);
    return false;
  }

  const event = {
    guildId: roster.guildId,
    channelId: roster.channelId,
    hostId: roster.hostId,
    hostTag: roster.hostTag,
    title: roster.title,
    description: roster.description,
    category: roster.category,
    thumbnail: roster.thumbnail,
    scheduledFor: null,
    mainSlots: roster.mainSlots,
    subSlots: roster.subSlots,
    main: new Array(roster.mainSlots).fill(null),
    subs: new Array(roster.subSlots).fill(null),
    attendedRecorded: [],
    lockAfterMinutes: roster.lockAfterMinutes ?? 15,
    autoLockTriggered: false,
    locked: false,
    createdAt: Date.now(),
    editedAt: Date.now(),
  };

  // Send with no buttons yet — see interactionCreate.js for why.
  const message = await channel.send({ embeds: [buildRosterEmbed(event)] });
  saveEvent(message.id, event);
  await message.edit({ components: buildRosterButtons(message.id, false) });
  return true;
}

async function processAutopostRosters(client) {
  const rosters = getAutopostRosters();
  const { dateStr, hour, minute } = getLondonNow();
  const hourKey = `${dateStr}-${String(hour).padStart(2, '0')}`;

  for (const [token, roster] of Object.entries(rosters)) {
    const scheduleType = roster.scheduleType === 'hourly' ? 'hourly' : 'daily';

    if (scheduleType === 'hourly') {
      // Fire once per hour: only when the minute matches AND it hasn't
      // already posted this hour (hourKey guards against multiple 30s ticks
      // within the same minute, same idea as dateStr does for daily below).
      if (roster.minute !== minute) continue;
      if (roster.lastPostedHourKey === hourKey) continue;

      try {
        const posted = await postAutopostRosterPanel(client, roster);
        if (posted) saveAutopostRoster(token, { ...roster, lastPostedHourKey: hourKey });
      } catch (err) {
        console.error(`[scheduler] Failed to post hourly autopost roster "${roster.title}":`, err);
      }
      continue;
    }

    // Daily: fire once per day, only when the clock matches AND it hasn't
    // already posted today (dateStr guards against multiple 30s ticks
    // within the minute).
    if (roster.hour !== hour || roster.minute !== minute) continue;
    if (roster.lastPostedDate === dateStr) continue;

    try {
      const posted = await postAutopostRosterPanel(client, roster);
      if (posted) saveAutopostRoster(token, { ...roster, lastPostedDate: dateStr });
    } catch (err) {
      console.error(`[scheduler] Failed to post autopost roster "${roster.title}":`, err);
    }
  }
}

// Auto-locks rosters once (createdAt + lockAfterMinutes) has passed — i.e. a
// fixed window after the roster was POSTED, regardless of whether it has a
// scheduled time. This is what stops people joining/leaving hours after the
// panel went up — previously locking was 100% manual.
//
// `lockAfterMinutes` is set per-roster at creation time (via the /event
// create or /event autopost create `lock_after` option, falling back to the
// server default from /roster-lock-time). 0/null means auto-lock is off for
// that roster.
//
// `autoLockTriggered` makes this fire-once: if a host manually unlocks a
// roster after auto-lock kicked in, we don't fight them by re-locking it
// on the next 30s tick.
async function processRosterAutoLock(client) {
  const events = listAllEvents();
  const now = Date.now();

  for (const event of events) {
    if (event.locked || event.autoLockTriggered) continue;
    if (!event.createdAt) continue;

    const lockMinutes = event.lockAfterMinutes;
    if (!lockMinutes || lockMinutes <= 0) continue; // auto-lock disabled for this roster

    const lockAt = event.createdAt + lockMinutes * 60 * 1000;
    if (now < lockAt) continue;

    try {
      event.locked = true;
      event.autoLockTriggered = true;
      event.editedAt = now;
      recordLockAttendance(event); // credit anyone still in a main slot right now
      saveEvent(event.messageId, event);

      const guild = await client.guilds.fetch(event.guildId).catch(() => null);
      const channel = guild ? await guild.channels.fetch(event.channelId).catch(() => null) : null;
      const message = channel ? await channel.messages.fetch(event.messageId).catch(() => null) : null;

      if (message) {
        await message.edit({
          embeds: [buildRosterEmbed(event, guild)],
          components: buildRosterButtons(event.messageId, true),
        }).catch(() => null);
      }
    } catch (err) {
      console.error(`[scheduler] Failed to auto-lock roster "${event.title}":`, err);
    }
  }
}

// Ends any giveaway whose timer (endAt) has passed — draws winners, edits
// the posted message, and announces the result. Same finalizeGiveaway()
// used by /panel's "End Now" and /giveaway end, so a giveaway ending on its
// own timer behaves identically to one ended manually.
async function processGiveaways(client) {
  const active = listActiveGiveaways();
  const now = Date.now();

  for (const giveaway of active) {
    if (!giveaway.endAt || giveaway.endAt > now) continue;

    try {
      const settings = getGuildSettings(giveaway.guildId);
      await finalizeGiveaway(client, giveaway.token, settings);
    } catch (err) {
      console.error(`[scheduler] Failed to auto-end giveaway "${giveaway.prize}":`, err);
    }
  }
}

// Ends any poll whose timer (endAt) has passed — marks it ended and
// re-renders its posted message. Same finalizePoll() used by the manual
// end flow, so a poll ending on its own timer behaves identically to one
// ended manually. finalizePoll is a no-op for already-ended polls, so a
// double-fire race between two ticks is safe.
async function processPolls(client) {
  const active = listActivePolls();
  const now = Date.now();

  for (const poll of active) {
    if (!poll.endAt || poll.endAt > now) continue;

    try {
      await finalizePoll(client, poll.token);
    } catch (err) {
      console.error(`[scheduler] Failed to auto-end poll "${poll.question}":`, err);
    }
  }
}

function startScheduler(client) {
  setTimeout(() => {
    processScheduledEvents(client);
    processScheduledMessages(client);
    processAutopostRosters(client);
    processRosterAutoLock(client);
    processGiveaways(client);
    processPolls(client);
    setInterval(() => {
      processScheduledEvents(client);
      processScheduledMessages(client);
      processAutopostRosters(client);
      processRosterAutoLock(client);
      processGiveaways(client);
      processPolls(client);
    }, CHECK_INTERVAL_MS);
  }, 16000);
}

module.exports = { startScheduler };
