const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const { listAutopostRosters, getGuildSettings, setGuildSettings } = require('./db');
const { getLondonNow } = require('./time');

/** How often the self-contained refresher re-checks every guild's board (ms). */
const REFRESH_INTERVAL_MS = 60 * 1000;

function buildUpcomingBoardEmbed(guild) {
  const settings = getGuildSettings(guild.id);
  const rosters = listAutopostRosters(guild.id);

  const title = settings.upcomingBoardTitle || '📅 Upcoming Rosters';
  const color = settings.upcomingBoardColor ?? 0x5865f2;

  if (rosters.length === 0) {
    return new EmbedBuilder()
      .setColor(color)
      .setTitle(title)
      .setDescription('No recurring daily rosters are set up yet. Use `/event autopost create` to add one.')
      .setTimestamp();
  }

  const { dateStr, hour, minute } = getLondonNow();
  const nowMinutes = hour * 60 + minute;

  // Only rosters still ahead of us today: haven't posted yet today AND their
  // time-of-day hasn't passed. Once either is true they roll to tomorrow and
  // drop off the board until then — this is what stops already-posted or
  // already-passed rosters (like "5:23 PM (an hour ago)") from lingering.
  let upcoming = rosters.filter((r) => r.lastPostedDate !== dateStr && (r.hour * 60 + r.minute) > nowMinutes);

  upcoming = settings.upcomingBoardSortBy === 'channel'
    ? upcoming.sort((a, b) => (a.channelId || '').localeCompare(b.channelId || '') || (a.hour * 60 + a.minute) - (b.hour * 60 + b.minute))
    : upcoming.sort((a, b) => (a.hour * 60 + a.minute) - (b.hour * 60 + b.minute));

  const timeNote = `Times shown are London time • current London time is ${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
  const footerText = settings.upcomingBoardFooterText ? `${settings.upcomingBoardFooterText} • ${timeNote}` : timeNote;

  if (upcoming.length === 0) {
    const emptyBody = 'Nothing left to post today — check back tomorrow.';
    return new EmbedBuilder()
      .setColor(color)
      .setTitle(title)
      .setDescription(settings.upcomingBoardHeaderText ? `${settings.upcomingBoardHeaderText}\n\n${emptyBody}` : emptyBody)
      .setFooter({ text: footerText })
      .setTimestamp();
  }

  const lines = upcoming.map((r) => {
    const time = `${String(r.hour).padStart(2, '0')}:${String(r.minute).padStart(2, '0')}`;
    let slotsText = '';
    if (settings.upcomingBoardShowSlots && (r.mainSlots || r.subSlots)) {
      slotsText = ` • ${r.mainSlots || 0} main`;
      if (r.subSlots) slotsText += ` + ${r.subSlots} subs`;
    }
    return `**${r.title}**\n<#${r.channelId}> • ${time} London time${slotsText}`;
  });

  const description = settings.upcomingBoardHeaderText
    ? `${settings.upcomingBoardHeaderText}\n\n${lines.join('\n\n')}`
    : lines.join('\n\n');

  return new EmbedBuilder()
    .setColor(color)
    .setTitle(title)
    .setDescription(description)
    .setFooter({ text: footerText })
    .setTimestamp();
}

function buildUpcomingBoardComponents() {
  return [
    new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId('upcomingBoard:refresh').setLabel('Refresh').setEmoji('🔄').setStyle(ButtonStyle.Secondary),
    ),
  ];
}

/**
 * Creates or updates the persistent board message for one guild, based on its
 * current settings. Safe to call as often as needed — does nothing if the
 * board is disabled or no channel has been picked yet.
 */
async function refreshUpcomingBoard(client, guildId) {
  const settings = getGuildSettings(guildId);
  if (!settings.upcomingBoardEnabled || !settings.upcomingBoardChannelId) return;

  const guild = await client.guilds.fetch(guildId).catch(() => null);
  if (!guild) return;

  const channel = await guild.channels.fetch(settings.upcomingBoardChannelId).catch(() => null);
  if (!channel) return;

  const embed = buildUpcomingBoardEmbed(guild);
  const components = buildUpcomingBoardComponents();

  if (settings.upcomingBoardMessageId) {
    const existing = await channel.messages.fetch(settings.upcomingBoardMessageId).catch(() => null);
    if (existing) {
      await existing.edit({ embeds: [embed], components }).catch(() => null);
      return;
    }
  }

  // No existing message (first time enabling, or it was deleted/channel changed) — post fresh.
  const message = await channel.send({ embeds: [embed], components }).catch(() => null);
  if (message) setGuildSettings(guildId, { upcomingBoardMessageId: message.id });
}

/**
 * Starts a self-contained interval that keeps every guild's board up to date.
 * Call this once from index.js after the client is ready, e.g.:
 *   const { startUpcomingBoardRefresher } = require('./utils/upcomingBoard');
 *   startUpcomingBoardRefresher(client);
 */
function startUpcomingBoardRefresher(client) {
  setInterval(() => {
    client.guilds.cache.forEach((guild) => {
      refreshUpcomingBoard(client, guild.id).catch((err) => console.error('[upcomingBoard] refresh failed:', err));
    });
  }, REFRESH_INTERVAL_MS);
}

module.exports = { buildUpcomingBoardEmbed, buildUpcomingBoardComponents, refreshUpcomingBoard, startUpcomingBoardRefresher };
