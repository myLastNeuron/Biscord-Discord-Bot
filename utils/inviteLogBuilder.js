const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');

function formatDateTime(timestamp) {
  if (!timestamp) return 'Never';
  const d = new Date(timestamp);
  const datePart = d.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });
  const timePart = d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true });
  return `${datePart} at ${timePart}`;
}

// `used` is whatever inviteTracker.resolveUsedInvite() returned (or null if
// it couldn't be determined at all). `counts` is inviteTracker's
// getInviterInviteCounts() result for the inviter, or null when there's no
// inviter to count (vanity / unknown).
function buildInviteJoinLogEmbed({ member, client, used, counts }) {
  const embed = new EmbedBuilder()
    .setColor(0x57f287)
    .setTitle('📥 New Member Joined')
    .setDescription(`${member}`)
    .setThumbnail(member.displayAvatarURL())
    .setFooter({ text: `Powered by ${client.user.username}`, iconURL: client.user.displayAvatarURL() })
    .setTimestamp();

  if (!used) {
    embed.addFields({
      name: 'Invite',
      value: "Couldn't be determined — the bot may be missing **Manage Server** permission in this server.",
      inline: false,
    });
    return embed;
  }

  embed.addFields(
    {
      name: 'Invited By',
      value: used.inviterId
        ? `<@${used.inviterId}>${counts ? ` (${counts.active}/${counts.total} active)` : ''}`
        : used.isVanity
          ? '*Vanity URL*'
          : '*Unknown*',
      inline: true,
    },
    { name: 'Invite Code', value: `||${used.code}||`, inline: true },
  );

  if (used.channelId) embed.addFields({ name: 'Channel', value: `<#${used.channelId}>`, inline: true });

  if (used.createdTimestamp || used.expiresTimestamp) {
    embed.addFields({
      name: 'Invite Details',
      value: `Created ${formatDateTime(used.createdTimestamp)} → Expires ${formatDateTime(used.expiresTimestamp)}`,
      inline: false,
    });
  }

  return embed;
}

// Only meaningful for a real (non-vanity) invite with a code to revoke.
function buildInviteLogComponents(used) {
  if (!used || used.isVanity) return [];
  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`invitelog:revoke:${used.code}`)
      .setLabel('Revoke this invite')
      .setEmoji('🗑️')
      .setStyle(ButtonStyle.Danger),
  );
  return [row];
}

module.exports = { buildInviteJoinLogEmbed, buildInviteLogComponents };
