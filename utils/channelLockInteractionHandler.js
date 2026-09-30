// Button handler for the /channel-lock command's "Unlock Channel" button.
// CustomId: channelLock:unlock:<channelId>

const { PermissionFlagsBits, EmbedBuilder, MessageFlags } = require('discord.js');
const { unlockChannel } = require('./channelLockManager');
const { logAction } = require('./modLog');
const { PREMIUM_COLORS } = require('./theme');

async function handleChannelLockInteraction(interaction) {
  if (!interaction.isButton()) return false;

  if (!interaction.customId.startsWith('channelLock:unlock:')) return false;

  if (!interaction.memberPermissions?.has(PermissionFlagsBits.ManageChannels)) {
    await interaction.reply({
      content: '❌ You need the **Manage Channels** permission to unlock a channel.',
      flags: MessageFlags.Ephemeral,
    });
    return true;
  }

  const channelId = interaction.customId.split(':')[2];
  const channel = await interaction.guild.channels.fetch(channelId).catch(() => null);

  if (!channel) {
    await interaction.reply({ content: '⚠️ That channel no longer exists.', flags: MessageFlags.Ephemeral });
    return true;
  }

  await interaction.deferUpdate();

  try {
    const result = await unlockChannel(channel);

    const embed = new EmbedBuilder()
      .setColor(PREMIUM_COLORS.success)
      .setTitle('🔓 Channel Unlocked')
      .setDescription(result.wasLocked
        ? `**<@${interaction.user.id}>** unlocked <#${channel.id}> — restored to **exactly how it was before** the lock.`
        : `<#${channel.id}> is **not currently locked** — there is nothing to restore.`);

    await interaction.editReply({ embeds: [embed], components: [] });

    if (result.wasLocked) {
      const logEmbed = new EmbedBuilder()
        .setColor(PREMIUM_COLORS.success)
        .setTitle('🔓 Channel Unlocked')
        .addFields(
          { name: 'Moderator', value: interaction.user.tag },
          { name: 'Channel', value: `<#${channel.id}>`, inline: true },
        )
        .setTimestamp();
      await logAction(interaction.guild, logEmbed);
    }
  } catch (err) {
    await interaction.editReply({
      content: `⚠️ Failed to unlock <#${channel.id}>: \`${err.message}\`.`,
      components: [],
    });
  }

  return true;
}

module.exports = { handleChannelLockInteraction };
