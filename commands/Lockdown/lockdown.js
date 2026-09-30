const { SlashCommandBuilder, PermissionFlagsBits, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const { lockGuild, unlockGuild, getLockdownStatus, LockdownError, CODES } = require('../../utils/lockdownManager');
const { logAction } = require('../../utils/modLog');
const { PREMIUM_COLORS } = require('../../utils/theme');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('lockdown')
    .setDescription('Lock down the whole server during a raid, then revert when it is over')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageChannels)
    .addSubcommand((sub) => sub
      .setName('on')
      .setDescription('Lock every channel and remember how to undo it')
      .addStringOption((o) => o.setName('reason').setDescription('Why the server is being locked down')))
    .addSubcommand((sub) => sub
      .setName('off')
      .setDescription('Unlock the server and restore every channel to how it was before')
      .addStringOption((o) => o.setName('reason').setDescription('Why the lockdown is being lifted')))
    .addSubcommand((sub) => sub
      .setName('status')
      .setDescription('Show whether the server is currently locked down')),

  async execute(interaction) {
    const sub = interaction.options.getSubcommand();
    const reason = interaction.options.getString('reason');

    if (sub === 'on') return lock(interaction, reason);
    if (sub === 'off') return unlock(interaction, reason);
    return status(interaction);
  },
};

async function lock(interaction, reason) {
  await interaction.deferReply();

  let record;
  try {
    record = await lockGuild(interaction.guild, {
      byId: interaction.user.id,
      byTag: interaction.user.tag,
      reason,
    });
  } catch (err) {
    if (err instanceof LockdownError && err.code === CODES.ALREADY_LOCKED) {
      return interaction.editReply({ content: '🔒 This server is **already in lockdown** — run `/lockdown off` to lift it.' });
    }
    return interaction.editReply({ content: `⚠️ Failed to lock down the server: \`${err.message}\`.` });
  }

  const embed = new EmbedBuilder()
    .setColor(PREMIUM_COLORS.danger)
    .setTitle('🔒 Server Lockdown')
    .setDescription(
      `**<@${interaction.user.id}>** locked down the server.\n` +
      'Every text and voice channel is now blocked for **@everyone** — no messages, no reactions, no joining voice. The bot saved the exact previous permissions so it can put everything back the moment the raid is over.'
    )
    .addFields(
      { name: '🔒 Channels locked', value: `${record.channelsEdited}`, inline: true },
      { name: '⏱️ Started', value: `<t:${Math.floor(record.lockedAt / 1000)}:R>`, inline: true },
    );
  if (reason) embed.addFields({ name: '💬 Reason', value: reason });
  if (record.failures.length) {
    embed.addFields({
      name: `⚠️ ${record.failures.length} channel(s) could not be locked`,
      value: record.failures.map((f) => `• ${f.name || f.id}: ${f.error}`).join('\n').slice(0, 1024),
    });
  }

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId('lockdown:unlock')
      .setLabel('🔓 Unlock Server')
      .setStyle(ButtonStyle.Success),
  );

  await interaction.editReply({ embeds: [embed], components: [row] });

  const logEmbed = new EmbedBuilder()
    .setColor(PREMIUM_COLORS.danger)
    .setTitle('🔒 Server Lockdown Started')
    .addFields(
      { name: 'Moderator', value: interaction.user.tag },
      { name: 'Channels Locked', value: `${record.channelsEdited}`, inline: true },
      { name: 'Started', value: `<t:${Math.floor(record.lockedAt / 1000)}:F>`, inline: true },
    )
    .setTimestamp();
  if (reason) logEmbed.addFields({ name: 'Reason', value: reason });
  await logAction(interaction.guild, logEmbed);
}

async function unlock(interaction, reason) {
  await interaction.deferReply();

  let result;
  try {
    result = await unlockGuild(interaction.guild);
  } catch (err) {
    if (err instanceof LockdownError && err.code === CODES.NOT_LOCKED) {
      return interaction.editReply({ content: '✅ This server is **not currently in lockdown** — there is nothing to restore. Use `/lockdown on` during a raid.' });
    }
    return interaction.editReply({ content: `⚠️ Failed to lift the lockdown: \`${err.message}\`.` });
  }

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
  if (reason) embed.addFields({ name: '💬 Reason', value: reason });

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId('lockdown:relock')
      .setLabel('🔒 Re-Lock Server')
      .setStyle(ButtonStyle.Danger),
  );

  await interaction.editReply({ embeds: [embed], components: [row] });

  const logEmbed = new EmbedBuilder()
    .setColor(PREMIUM_COLORS.success)
    .setTitle('🔓 Lockdown Lifted')
    .addFields(
      { name: 'Moderator', value: interaction.user.tag },
      { name: 'Channels Restored', value: `${result.restored}`, inline: true },
    )
    .setTimestamp();
  if (reason) logEmbed.addFields({ name: 'Reason', value: reason });
  await logAction(interaction.guild, logEmbed);
}

async function status(interaction) {
  const record = getLockdownStatus(interaction.guild.id);

  if (!record) {
    const embed = new EmbedBuilder()
      .setColor(PREMIUM_COLORS.success)
      .setTitle('🟢 No Lockdown Active')
      .setDescription('This server is not locked down. Use `/lockdown on` during a raid, then `/lockdown off` to restore everything afterwards.');
    return interaction.reply({ embeds: [embed] });
  }

  const embed = new EmbedBuilder()
    .setColor(PREMIUM_COLORS.danger)
    .setTitle('🔒 Lockdown Active')
    .setDescription(`Started by <@${record.lockedById || 'unknown'}> — **${record.lockedAt ? `<t:${Math.floor(record.lockedAt / 1000)}:R>` : 'recently'}**`)
    .addFields({ name: '🔒 Channels locked', value: `${Object.keys(record.channels).length}`, inline: true });
  if (record.reason) embed.addFields({ name: '💬 Reason', value: record.reason });

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId('lockdown:unlock')
      .setLabel('🔓 Unlock Server')
      .setStyle(ButtonStyle.Success),
  );

  return interaction.reply({ embeds: [embed], components: [row] });
}