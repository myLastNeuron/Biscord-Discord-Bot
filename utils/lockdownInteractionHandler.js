// Button handler for the lockdown command's messages — the "Unlock Server"
// button (one-click revert after a raid) and the "Re-Lock Server" button on
// the lifted confirmation. CustomIds: lockdown:unlock / lockdown:relock.

const { PermissionFlagsBits, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, MessageFlags } = require('discord.js');
const { lockGuild, unlockGuild, LockdownError } = require('./lockdownManager');
const { logAction } = require('./modLog');
const { PREMIUM_COLORS } = require('./theme');

const ROW = {
  unlock: () => new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('lockdown:unlock').setLabel('🔓 Unlock Server').setStyle(ButtonStyle.Success),
  ),
  relock: () => new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('lockdown:relock').setLabel('🔒 Re-Lock Server').setStyle(ButtonStyle.Danger),
  ),
};

async function handleLockdownInteraction(interaction) {
  if (!interaction.isButton()) return false;

  const action = interaction.customId === 'lockdown:unlock' ? 'unlock'
    : interaction.customId === 'lockdown:relock' ? 'relock'
    : null;
  if (!action) return false;

  if (!interaction.memberPermissions?.has(PermissionFlagsBits.ManageChannels)) {
    await interaction.reply({
      content: '❌ You need the **Manage Channels** permission to change the lockdown.',
      flags: MessageFlags.Ephemeral,
    });
    return true;
  }

  await interaction.deferUpdate();

  try {
    if (action === 'unlock') {
      const result = await unlockGuild(interaction.guild);

      if (!result.allRestored) {
        const embed = new EmbedBuilder()
          .setColor(PREMIUM_COLORS.muted)
          .setTitle('⚠️ Lockdown Partially Lifted')
          .setDescription(`Restored **${result.restored}** channel(s), but **${result.failures.length}** could not be reverted. Run \`/lockdown off\` again to retry those.`)
          .addFields({
            name: '⚠️ Not restored',
            value: result.failures.map((f) => `• ${f.name || f.id}: ${f.error}`).join('\n').slice(0, 1024),
          });
        return interaction.editReply({ embeds: [embed] });
      }

      const embed = new EmbedBuilder()
        .setColor(PREMIUM_COLORS.success)
        .setTitle('🔓 Lockdown Lifted')
        .setDescription(`**<@${interaction.user.id}>** lifted the lockdown — every channel has been **restored to exactly how it was before**.`)
        .addFields({ name: '✅ Channels restored', value: `${result.restored}`, inline: true });

      await interaction.editReply({ embeds: [embed], components: [ROW.relock()] });

      const logEmbed = new EmbedBuilder()
        .setColor(PREMIUM_COLORS.success)
        .setTitle('🔓 Lockdown Lifted')
        .addFields(
          { name: 'Moderator', value: interaction.user.tag },
          { name: 'Channels Restored', value: `${result.restored}`, inline: true },
        )
        .setTimestamp();
      await logAction(interaction.guild, logEmbed);
      return true;
    }

    // action === 'relock' — fresh lockdown, snapshot taken again.
    const record = await lockGuild(interaction.guild, {
      byId: interaction.user.id,
      byTag: interaction.user.tag,
      reason: 'Re-locked from the lockdown message',
    });

    const embed = new EmbedBuilder()
      .setColor(PREMIUM_COLORS.danger)
      .setTitle('🔒 Server Relocked')
      .setDescription(
        `**<@${interaction.user.id}>** locked the server back down.\n` +
        'Every text and voice channel is blocked for **@everyone** again — the bot remembered the permissions before this lockdown to restore them later.'
      )
      .addFields({ name: '🔒 Channels locked', value: `${record.channelsEdited}`, inline: true });
    if (record.failures.length) {
      embed.addFields({
        name: `⚠️ ${record.failures.length} channel(s) could not be locked`,
        value: record.failures.map((f) => `• ${f.name || f.id}: ${f.error}`).join('\n').slice(0, 1024),
      });
    }

    await interaction.editReply({ embeds: [embed], components: [ROW.unlock()] });

    const logEmbed = new EmbedBuilder()
      .setColor(PREMIUM_COLORS.danger)
      .setTitle('🔒 Server Lockdown Started')
      .addFields(
        { name: 'Moderator', value: interaction.user.tag },
        { name: 'Channels Locked', value: `${record.channelsEdited}`, inline: true },
      )
      .setTimestamp();
    await logAction(interaction.guild, logEmbed);
    return true;
  } catch (err) {
    return interaction.editReply({
      content: err instanceof LockdownError
        ? `⚠️ ${err.message}`
        : `⚠️ Something went wrong: \`${err.message}\`.`,
    });
  }
}

module.exports = { handleLockdownInteraction };