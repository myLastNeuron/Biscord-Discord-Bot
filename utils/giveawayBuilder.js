// Builds the embed + button for the actual giveaway message posted in a
// guild channel (as opposed to panelBuilder.js, which builds the admin-only
// /panel management screens for giveaways).

const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const { resolveGiveawayPlaceholders } = require('./placeholders');
const { PREMIUM_COLORS } = require('./theme');

// Guards setThumbnail/setImage against bad/empty template input — discord.js
// throws if given something that isn't a well-formed URL.
function isValidImageUrl(url) {
  return typeof url === 'string' && /^https?:\/\/\S+$/i.test(url.trim());
}

/**
 * `settings` (guild settings) optionally carries a server-wide message
 * template (giveawayEmbedTitle/Description/Footer/Color/Thumbnail/Image —
 * see DEFAULT_GUILD_SETTINGS in utils/db.js). Any unset field falls back to
 * the hardcoded default below. `guild` (a discord.js Guild) is used to
 * resolve %placeholders% like %guildName% or %botAvatar% — pass it whenever
 * available; placeholders needing it just resolve to '' without it (e.g. a
 * giveaway record round-tripped without a guild reference).
 */
function buildGiveawayEmbed(giveaway, settings = {}, guild = null) {
  const isActive = giveaway.status === 'active';
  const ctx = { giveaway, guild };

  const embed = new EmbedBuilder()
    .setColor(settings.giveawayEmbedColor ?? (isActive ? PREMIUM_COLORS.accent : PREMIUM_COLORS.muted));

  const title = settings.giveawayEmbedTitle
    ? resolveGiveawayPlaceholders(settings.giveawayEmbedTitle, ctx)
    : (isActive ? '🎉 Giveaway!' : '🎉 Giveaway Ended');
  embed.setTitle(title);

  const description = settings.giveawayEmbedDescription
    ? resolveGiveawayPlaceholders(settings.giveawayEmbedDescription, ctx)
    : `**Prize:** ${giveaway.prize}`;
  embed.setDescription(description);

  embed.addFields(
    { name: 'Winners', value: `${giveaway.winnerCount}`, inline: true },
    { name: 'Entries', value: `${giveaway.entries.length}`, inline: true },
    { name: 'Hosted by', value: `<@${giveaway.organiserId}>`, inline: true },
  );

  if (isActive) {
    embed.addFields({ name: 'Ends', value: `<t:${Math.floor(giveaway.endAt / 1000)}:R>` });
  } else {
    const winnerLine = giveaway.winners?.length
      ? giveaway.winners.map((id) => `<@${id}>`).join(', ')
      : 'No valid entries — no winner could be drawn.';
    embed.addFields({ name: 'Winner(s)', value: winnerLine });
  }

  const footerText = settings.giveawayEmbedFooter
    ? resolveGiveawayPlaceholders(settings.giveawayEmbedFooter, ctx)
    : `Giveaway ID: ${giveaway.token}`;
  embed.setFooter({ text: footerText }).setTimestamp(isActive ? giveaway.endAt : (giveaway.endedAt || Date.now()));

  if (settings.giveawayEmbedThumbnail) {
    const url = resolveGiveawayPlaceholders(settings.giveawayEmbedThumbnail, ctx);
    if (isValidImageUrl(url)) embed.setThumbnail(url);
  }
  if (settings.giveawayEmbedImage) {
    const url = resolveGiveawayPlaceholders(settings.giveawayEmbedImage, ctx);
    if (isValidImageUrl(url)) embed.setImage(url);
  }

  return embed;
}

function buildGiveawayButtons(giveaway, settings) {
  const isActive = giveaway.status === 'active';
  const button = new ButtonBuilder()
    .setCustomId(`giveaway:enter:${giveaway.token}`)
    .setLabel(isActive ? (settings.giveawayJoinButtonLabel || 'Join') : 'Giveaway Ended')
    .setStyle(isActive ? ButtonStyle.Success : ButtonStyle.Secondary)
    .setDisabled(!isActive);

  if (isActive && settings.giveawayJoinButtonEmoji) {
    button.setEmoji(settings.giveawayJoinButtonEmoji);
  }

  return [new ActionRowBuilder().addComponents(button)];
}

module.exports = { buildGiveawayEmbed, buildGiveawayButtons };
