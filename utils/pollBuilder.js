// Builds the embed + vote select menu for the actual poll message posted in
// a guild channel (mirrors utils/giveawayBuilder.js's split between the
// public-facing message and utils/panelBuilder.js's admin screens).

const {
  EmbedBuilder, ActionRowBuilder, StringSelectMenuBuilder, ButtonBuilder, ButtonStyle,
} = require('discord.js');
const { PREMIUM_COLORS } = require('./theme');

const BAR_LENGTH = 12;

function buildBar(votes, totalVotes) {
  const pct = totalVotes > 0 ? votes / totalVotes : 0;
  const filled = Math.round(pct * BAR_LENGTH);
  return '●'.repeat(filled) + '○'.repeat(BAR_LENGTH - filled);
}

function totalVoteCount(poll) {
  // A voter can appear in more than one option's votes[] when poll.multiple
  // is true, so this counts *ballots cast* (unique voters), not the raw sum
  // of option vote array lengths — the sum is used per-bar instead, where
  // double-counting a multi-select voter across their chosen options is
  // exactly what you want for each option's own percentage.
  const voters = new Set();
  for (const opt of poll.options) {
    for (const userId of opt.votes) voters.add(userId);
  }
  return voters.size;
}

function buildPollEmbed(poll) {
  const isActive = poll.status === 'active';
  const sumVotes = poll.options.reduce((sum, o) => sum + o.votes.length, 0);
  const voterCount = totalVoteCount(poll);
  const highest = Math.max(0, ...poll.options.map((o) => o.votes.length));

  const lines = poll.options.map((opt, i) => {
    const isWinner = !isActive && highest > 0 && opt.votes.length === highest;
    const pct = sumVotes > 0 ? Math.round((opt.votes.length / sumVotes) * 100) : 0;
    const marker = isWinner ? '🏆 ' : '';
    return `${marker}**${i + 1}. ${opt.text}**\n${buildBar(opt.votes.length, sumVotes)} ${pct}% (${opt.votes.length})`;
  });

  const embed = new EmbedBuilder()
    .setColor(isActive ? PREMIUM_COLORS.accent : PREMIUM_COLORS.muted)
    .setTitle(`📊 ${poll.question}`)
    .setDescription(lines.join('\n\n'))
    .addFields({ name: 'Total votes', value: `${voterCount}`, inline: true })
    .setFooter({ text: `Poll ID: ${poll.token}${poll.multiple ? ' · Multiple choice' : ''}` });

  if (isActive) {
    if (poll.endAt) {
      embed.addFields({ name: 'Ends', value: `<t:${Math.floor(poll.endAt / 1000)}:R>`, inline: true });
    }
  } else {
    embed.addFields({ name: 'Status', value: 'Ended', inline: true });
  }

  embed.setTimestamp(isActive ? (poll.endAt || Date.now()) : (poll.endedAt || Date.now()));
  return embed;
}

function buildPollComponents(poll) {
  const isActive = poll.status === 'active';

  const select = new StringSelectMenuBuilder()
    .setCustomId(`poll:vote:${poll.token}`)
    .setPlaceholder(isActive ? (poll.multiple ? 'Choose one or more options...' : 'Choose an option...') : 'This poll has ended')
    .setDisabled(!isActive)
    .setMinValues(1)
    .setMaxValues(isActive && poll.multiple ? poll.options.length : 1)
    .addOptions(poll.options.map((opt, i) => ({
      label: opt.text.slice(0, 100),
      value: opt.id,
      description: `Option ${i + 1}`,
    })));

  const rows = [new ActionRowBuilder().addComponents(select)];

  if (isActive) {
    rows.push(new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId(`poll:endNow:${poll.token}`).setLabel('End Poll').setEmoji('🛑').setStyle(ButtonStyle.Danger),
    ));
  }

  return rows;
}

module.exports = { buildPollEmbed, buildPollComponents, totalVoteCount };
