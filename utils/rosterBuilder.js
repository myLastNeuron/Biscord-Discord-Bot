const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');

const STATUS_DOT = { open: '🟢', closed: '🔴' };

/**
 * event shape (stored in db.events):
 * {
 *   guildId, channelId, hostId, title, description, thumbnail,
 *   mainSlots, subSlots, main: [userId,...], subs: [userId,...],
 *   scheduledFor: ms epoch UTC | null (set via London time input on /event create),
 *   hostIsCrowned: bool (marks host with 🏆 if they join),
 *   locked: bool, createdAt, editedAt
 * }
 */

function isInVoiceChannel(guild, userId) {
  if (!guild) return false;
  const voiceState = guild.voiceStates.cache.get(userId);
  return Boolean(voiceState && voiceState.channelId);
}

function formatSlotLine(index, userId, crownFor, guild) {
  if (!userId) return `${index}. -`;
  const crown = userId === crownFor ? '🏆 ' : '';
  const tick = isInVoiceChannel(guild, userId) ? '✅ ' : '';
  return `${index}. ${crown}${tick}<@${userId}>`;
}

function buildRosterEmbed(event, guild = null) {
  const mainLines = [];
  for (let i = 0; i < event.mainSlots; i++) {
    mainLines.push(formatSlotLine(i + 1, event.main[i], event.hostId, guild));
  }

  const subLines = [];
  for (let i = 0; i < event.subSlots; i++) {
    subLines.push(formatSlotLine(i + 1, event.subs[i], event.hostId, guild));
  }

  const filled = event.main.filter(Boolean).length + event.subs.filter(Boolean).length;
  const total = event.mainSlots + event.subSlots;
  const statusKey = event.locked ? 'closed' : 'open';

  const embed = new EmbedBuilder()
    .setColor(event.locked ? 0xed4245 : 0x2ecc71)
    .setTitle(event.title)
    .setDescription(event.description || null);

  if (event.scheduledFor) {
    const unix = Math.floor(event.scheduledFor / 1000);
    embed.addFields({ name: 'Scheduled Time', value: `<t:${unix}:F> (<t:${unix}:R>)`, inline: false });
  }

  embed.addFields(
    { name: `Main Roster (1-${event.mainSlots})`, value: mainLines.join('\n') || '-', inline: false },
  );

  if (event.subSlots > 0) {
    embed.addFields({ name: 'Subs Roster', value: subLines.join('\n') || '-', inline: false });
  }

  if (event.thumbnail) embed.setThumbnail(event.thumbnail);

  embed.setFooter({
    text: `Status: ${STATUS_DOT[statusKey]} ${event.locked ? 'Closed' : 'Open'}  |  Spots: ${filled}/${total}  |  Hosted by ${event.hostTag || 'Unknown'}  |  ✅ = in voice`,
  });
  embed.setTimestamp(new Date(event.createdAt));

  return embed;
}

function buildRosterButtons(eventId, locked) {
  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`roster:join:${eventId}`)
      .setLabel('Join')
      .setEmoji('✅')
      .setStyle(ButtonStyle.Success)
      .setDisabled(locked),
    new ButtonBuilder()
      .setCustomId(`roster:leave:${eventId}`)
      .setLabel('Leave')
      .setEmoji('❌')
      .setStyle(ButtonStyle.Danger)
      .setDisabled(locked),
    new ButtonBuilder()
      .setCustomId(`roster:lock:${eventId}`)
      .setLabel(locked ? 'Unlock' : 'Lock / Unlock')
      .setEmoji('🔒')
      .setStyle(ButtonStyle.Secondary),
  );
  return [row];
}

module.exports = { buildRosterEmbed, buildRosterButtons };
