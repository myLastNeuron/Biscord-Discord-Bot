const {
  SlashCommandBuilder, PermissionFlagsBits, EmbedBuilder, ChannelType,
} = require('discord.js');
const { saveScheduledMessage, deleteScheduledMessage, listScheduledMessages } = require('../../utils/db');
const { parseLondonDateTime } = require('../../utils/time');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('schedule')
    .setDescription('Schedule a plain message to be posted at a future time (London time)')
    .addSubcommand(sub => sub.setName('create')
      .setDescription('Schedule a message')
      .addStringOption(o => o.setName('time').setDescription('When to send it, London time (e.g. "2026-07-25 18:00" or "18:00" for today)').setRequired(true))
      .addStringOption(o => o.setName('message').setDescription('The message content to send').setRequired(true))
      .addChannelOption(o => o.setName('channel').setDescription('Channel to send it in (defaults to here)').addChannelTypes(ChannelType.GuildText)))
    .addSubcommand(sub => sub.setName('list')
      .setDescription('List all pending scheduled messages in this server'))
    .addSubcommand(sub => sub.setName('cancel')
      .setDescription('Cancel a pending scheduled message')
      .addStringOption(o => o.setName('id').setDescription('The schedule ID (shown in /schedule list)').setRequired(true)))
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageMessages),

  async execute(interaction) {
    const sub = interaction.options.getSubcommand();

    if (sub === 'create') {
      const timeInput = interaction.options.getString('time');
      const content = interaction.options.getString('message');
      const targetChannel = interaction.options.getChannel('channel') || interaction.channel;

      const parsed = parseLondonDateTime(timeInput);
      if (!parsed) {
        return interaction.reply({
          content: 'I couldn\'t read that time. Use `YYYY-MM-DD HH:mm` (e.g. `2026-07-25 18:00`) or just `HH:mm` for today — London time.',
          ephemeral: true,
        });
      }

      const sendAt = parsed.getTime();
      if (sendAt <= Date.now()) {
        return interaction.reply({ content: 'That time is in the past — pick a time in the future.', ephemeral: true });
      }

      const token = `msg-${Date.now()}-${interaction.user.id}`;
      saveScheduledMessage(token, {
        guildId: interaction.guild.id,
        channelId: targetChannel.id,
        authorId: interaction.user.id,
        content,
        sendAt,
      });

      const unix = Math.floor(sendAt / 1000);
      return interaction.reply({
        content: `Scheduled — this will be posted in ${targetChannel} at <t:${unix}:F> (<t:${unix}:R>). ID: \`${token}\``,
        ephemeral: true,
      });
    }

    if (sub === 'list') {
      const items = listScheduledMessages(interaction.guild.id);
      if (!items.length) return interaction.reply({ content: 'No pending scheduled messages.', ephemeral: true });

      const embed = new EmbedBuilder()
        .setColor(0x5865f2)
        .setTitle('Pending Scheduled Messages')
        .setDescription(items.map(item => {
          const unix = Math.floor(item.sendAt / 1000);
          const preview = item.content.length > 60 ? `${item.content.slice(0, 60)}...` : item.content;
          return `\`${item.token}\` — <#${item.channelId}> at <t:${unix}:f>\n"${preview}"`;
        }).join('\n\n'));
      return interaction.reply({ embeds: [embed], ephemeral: true });
    }

    if (sub === 'cancel') {
      const id = interaction.options.getString('id');
      const items = listScheduledMessages(interaction.guild.id);
      const match = items.find(item => item.token === id);
      if (!match) return interaction.reply({ content: 'No scheduled message found with that ID.', ephemeral: true });

      deleteScheduledMessage(id);
      return interaction.reply({ content: 'Scheduled message canceled.', ephemeral: true });
    }
  },
};
