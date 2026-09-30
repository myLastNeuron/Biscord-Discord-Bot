const { SlashCommandBuilder, PermissionFlagsBits, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, MessageFlags } = require('discord.js');
const { lockChannel, unlockChannel, isChannelLocked, getLockedChannels } = require('../../utils/channelLockManager');
const { logAction } = require('../../utils/modLog');
const { PREMIUM_COLORS } = require('../../utils/theme');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('channel-lock')
    .setDescription('Lock or unlock a text channel so only admins can use it')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageChannels)
    .addSubcommand((sub) => sub
      .setName('on')
      .setDescription('Lock the given channel for @everyone, remembering how to undo it')
      .addChannelOption((o) => o.setName('channel').setDescription('Channel to lock (defaults to this one)'))
      .addStringOption((o) => o.setName('reason').setDescription('Why the channel is being locked')))
    .addSubcommand((sub) => sub
      .setName('off')
      .setDescription('Unlock the given channel and restore it to how it was before')
      .addChannelOption((o) => o.setName('channel').setDescription('Channel to unlock (defaults to this one)')))
    .addSubcommand((sub) => sub
      .setName('list')
      .setDescription('List every channel currently locked')),

  async execute(interaction) {
    const sub = interaction.options.getSubcommand();

    if (sub === 'list') return list(interaction);

    const channel = interaction.options.getChannel('channel') || interaction.channel;

    if (!channel || !('permissionOverwrites' in channel)) {
      return interaction.reply({ content: '⚠️ That isn\'t a lockable text channel.', ephemeral: true });
    }

    if (sub === 'on') return lock(interaction, channel);
    return unlock(interaction, channel);
  },
};

async function lock(interaction, channel) {
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  if (isChannelLocked(channel.id)) {
    return interaction.editReply({ content: `🔒 <#${channel.id}> is **already locked** — run \`/channel-lock off\` to unlock it.` });
  }

  const reason = interaction.options.getString('reason');
  try {
    await lockChannel(channel, { byId: interaction.user.id, byTag: interaction.user.tag, reason });
  } catch (err) {
    return interaction.editReply({ content: `⚠️ Failed to lock <#${channel.id}>: \`${err.message}\`.` });
  }

  const embed = new EmbedBuilder()
    .setColor(PREMIUM_COLORS.danger)
    .setTitle('🔒 Channel Locked')
    .setDescription(`**<@${interaction.user.id}>** locked <#${channel.id}> — **@everyone** can no longer send messages, react, or start threads. Admin/mod overwrites are untouched, and the exact previous permissions were saved so unlock restores them.`)
    .addFields({ name: '🔒 Channel', value: `<#${channel.id}>`, inline: true });
  if (reason) embed.addFields({ name: '💬 Reason', value: reason, inline: true });

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`channelLock:unlock:${channel.id}`)
      .setLabel('🔓 Unlock Channel')
      .setStyle(ButtonStyle.Success),
  );

  await interaction.editReply({ embeds: [embed], components: [row] });

  const logEmbed = new EmbedBuilder()
    .setColor(PREMIUM_COLORS.danger)
    .setTitle('🔒 Channel Locked')
    .addFields(
      { name: 'Moderator', value: interaction.user.tag },
      { name: 'Channel', value: `<#${channel.id}>`, inline: true },
    );
  if (reason) logEmbed.addFields({ name: 'Reason', value: reason, inline: true });
  logEmbed.setTimestamp();
  await logAction(interaction.guild, logEmbed);
}

async function unlock(interaction, channel) {
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  try {
    const result = await unlockChannel(channel);
    if (!result.wasLocked) {
      return interaction.editReply({ content: `✅ <#${channel.id}> is **not currently locked** — there is nothing to restore.` });
    }
  } catch (err) {
    return interaction.editReply({ content: `⚠️ Failed to unlock <#${channel.id}>: \`${err.message}\`.` });
  }

  const embed = new EmbedBuilder()
    .setColor(PREMIUM_COLORS.success)
    .setTitle('🔓 Channel Unlocked')
    .setDescription(`**<@${interaction.user.id}>** unlocked <#${channel.id}> — restored to **exactly how it was before** the lock.`);

  await interaction.editReply({ embeds: [embed] });

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

async function list(interaction) {
  const locked = getLockedChannels(interaction.guild.id);

  if (!locked.length) {
    const embed = new EmbedBuilder()
      .setColor(PREMIUM_COLORS.success)
      .setTitle('🟢 No Channels Locked')
      .setDescription('No channels in this server are locked. Use `/channel-lock on` to lock one.');
    return interaction.reply({ embeds: [embed], ephemeral: true });
  }

  const lines = locked.map((r) => (
    `<#${r.channelId}> — locked <t:${Math.floor(r.lockedAt / 1000)}:R> by <@${r.lockedById || 'unknown'}>${r.reason ? ` (${r.reason})` : ''}`
  ));

  const embed = new EmbedBuilder()
    .setColor(PREMIUM_COLORS.danger)
    .setTitle(`🔒 ${locked.length} Channel(s) Locked`)
    .setDescription(lines.join('\n'));

  return interaction.reply({ embeds: [embed], ephemeral: true });
}
