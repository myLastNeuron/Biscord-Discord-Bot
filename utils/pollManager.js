// Shared poll logic used by commands/Poll/poll.js (slash command) and the
// vote/end-poll handlers in events/interactionCreate.js — mirrors the split
// already established by utils/giveawayManager.js for giveaways, so both
// features behave the same shape of way (create/post, vote/finalize, sync).

const { getPoll, savePoll, updatePoll } = require('./db');
const { buildPollEmbed, buildPollComponents } = require('./pollBuilder');

/**
 * Creates a poll record, posts its message, and edits the real message ID
 * into the record. Returns the saved poll (with token/messageId set).
 */
async function createAndPostPoll({ channel, guild, question, optionTexts, multiple, endAt, organiserId }) {
  const token = `poll-${Date.now()}-${Math.floor(Math.random() * 1000)}`;
  const now = Date.now();

  const poll = {
    guildId: guild.id,
    channelId: channel.id,
    messageId: null,
    token,
    question,
    options: optionTexts.map((text, i) => ({ id: `opt-${i}`, text, votes: [] })),
    multiple: !!multiple,
    endAt: endAt || null,
    organiserId,
    status: 'active',
    createdAt: now,
    endedAt: null,
  };

  const message = await channel.send({
    embeds: [buildPollEmbed(poll)],
    components: buildPollComponents(poll),
  });

  poll.messageId = message.id;
  savePoll(token, poll);
  return poll;
}

/**
 * Records `userId`'s vote for `optionIds` (an array — length 1 unless the
 * poll allows multiple choice). Re-voting replaces the previous ballot: the
 * voter is stripped from every option first, then added to the ones just
 * selected, so switching your vote (or changing your multi-select) always
 * works correctly with no leftover stale votes.
 * Returns { poll } on success or { error } if the poll can't be voted on.
 */
function castVote(token, userId, optionIds) {
  const poll = getPoll(token);
  if (!poll) return { error: 'not_found' };
  if (poll.status !== 'active') return { error: 'ended' };

  const validIds = new Set(poll.options.map((o) => o.id));
  const selected = optionIds.filter((id) => validIds.has(id));
  if (selected.length === 0) return { error: 'invalid_option' };

  const options = poll.options.map((opt) => ({
    ...opt,
    votes: opt.votes.filter((id) => id !== userId),
  }));
  for (const opt of options) {
    if (selected.includes(opt.id)) opt.votes.push(userId);
  }

  const updated = updatePoll(token, { options });
  return { poll: updated };
}

/** Marks a poll ended and re-renders its posted message to match. */
async function finalizePoll(client, token) {
  const poll = getPoll(token);
  if (!poll) return null;
  if (poll.status !== 'active') return poll; // already ended — no-op, safe for a double-fire race

  const updated = updatePoll(token, { status: 'ended', endedAt: Date.now() });
  await syncPollMessage(client, updated);
  return updated;
}

/** Re-renders the posted poll message to match its current record state. */
async function syncPollMessage(client, poll) {
  try {
    const channel = await client.channels.fetch(poll.channelId).catch(() => null);
    if (!channel) return;
    const message = poll.messageId ? await channel.messages.fetch(poll.messageId).catch(() => null) : null;
    if (!message) return;
    await message.edit({
      embeds: [buildPollEmbed(poll)],
      components: buildPollComponents(poll),
    }).catch(() => null);
  } catch (err) {
    console.error(`[poll] Failed to sync message for "${poll.question}":`, err);
  }
}

module.exports = { createAndPostPoll, castVote, finalizePoll, syncPollMessage };
