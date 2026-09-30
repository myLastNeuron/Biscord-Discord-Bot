// Shared giveaway logic used by commands/Giveaway/giveaway.js (slash
// command), the /panel giveaway module (interactionCreate.js), and
// scheduler.js's auto-end sweep — so all three paths draw winners, post
// messages, and update records identically.

const { saveGiveaway, updateGiveaway, getGiveaway } = require('./db');
const { buildGiveawayEmbed, buildGiveawayButtons } = require('./giveawayBuilder');

/** Random sample of `count` unique entries from `pool`, order-independent. */
function drawWinners(pool, count) {
  const shuffled = [...pool];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  return shuffled.slice(0, Math.max(0, count));
}

/**
 * Creates a giveaway record, posts its message, and edits it in with the
 * real message ID attached to the Enter button's customId. Returns the
 * saved giveaway record (with token/messageId set).
 */
async function createAndPostGiveaway({ channel, guild, settings, prize, winnerCount, durationMs, organiserId }) {
  const token = `gw-${Date.now()}-${Math.floor(Math.random() * 1000)}`;
  const now = Date.now();

  const giveaway = {
    guildId: guild.id,
    channelId: channel.id,
    messageId: null,
    token,
    prize,
    winnerCount,
    endAt: now + durationMs,
    organiserId,
    entries: [],
    status: 'active',
    winners: [],
    createdAt: now,
    endedAt: null,
  };

  const message = await channel.send({
    embeds: [buildGiveawayEmbed(giveaway, settings, guild)],
    components: buildGiveawayButtons(giveaway, settings),
  });

  giveaway.messageId = message.id;
  saveGiveaway(token, giveaway);
  return giveaway;
}

/**
 * Draws winners from current entries, marks the giveaway ended, and updates
 * both the posted message and the stored record. Used by the scheduler's
 * timer sweep, and by `/giveaway end`'s manual "End Now".
 * Safe to call on an already-ended giveaway (re-ends idempotently) so a
 * double-fire from a race never throws.
 */
async function finalizeGiveaway(client, token, settings) {
  const giveaway = getGiveaway(token);
  if (!giveaway) return null;

  const winners = drawWinners(giveaway.entries, giveaway.winnerCount);
  const updated = updateGiveaway(token, {
    status: 'ended',
    winners,
    endedAt: Date.now(),
  });

  await syncGiveawayMessage(client, updated, settings);

  if (winners.length) {
    await announceInChannel(client, updated, `🎉 Congratulations ${winners.map((id) => `<@${id}>`).join(', ')}! You won **${updated.prize}**!`);
  } else {
    await announceInChannel(client, updated, `😔 The giveaway for **${updated.prize}** ended with no valid entries — no winner could be drawn.`);
  }

  return updated;
}

/**
 * Re-draws winners for an already-ended giveaway. `count` defaults to the
 * giveaway's original winnerCount.
 */
async function rerollGiveaway(client, token, settings, count) {
  const giveaway = getGiveaway(token);
  if (!giveaway) return null;

  const winnerCount = count && count > 0 ? count : giveaway.winnerCount;
  const winners = drawWinners(giveaway.entries, winnerCount);
  const updated = updateGiveaway(token, { winners, winnerCount });

  await syncGiveawayMessage(client, updated, settings);

  if (winners.length) {
    await announceInChannel(client, updated, `🎉 New winner(s) drawn for **${updated.prize}**: ${winners.map((id) => `<@${id}>`).join(', ')}!`);
  } else {
    await announceInChannel(client, updated, `😔 Reroll for **${updated.prize}** found no valid entries — no winner could be drawn.`);
  }

  return updated;
}

/** Re-renders the posted giveaway message to match its current record state. */
async function syncGiveawayMessage(client, giveaway, settings) {
  try {
    const channel = await client.channels.fetch(giveaway.channelId).catch(() => null);
    if (!channel) return;
    const message = giveaway.messageId ? await channel.messages.fetch(giveaway.messageId).catch(() => null) : null;
    if (!message) return;
    await message.edit({
      embeds: [buildGiveawayEmbed(giveaway, settings, channel.guild)],
      components: buildGiveawayButtons(giveaway, settings),
    }).catch(() => null);
  } catch (err) {
    console.error(`[giveaway] Failed to sync message for "${giveaway.prize}":`, err);
  }
}

async function announceInChannel(client, giveaway, content) {
  try {
    const channel = await client.channels.fetch(giveaway.channelId).catch(() => null);
    if (!channel) return;
    await channel.send({ content, reply: giveaway.messageId ? { messageReference: giveaway.messageId, failIfNotExists: false } : undefined }).catch(() => null);
  } catch (err) {
    console.error(`[giveaway] Failed to announce result for "${giveaway.prize}":`, err);
  }
}

module.exports = {
  drawWinners,
  createAndPostGiveaway,
  finalizeGiveaway,
  rerollGiveaway,
  syncGiveawayMessage,
};
