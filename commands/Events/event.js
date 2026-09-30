const {
  SlashCommandBuilder, PermissionFlagsBits, ModalBuilder, TextInputBuilder,
  TextInputStyle, ActionRowBuilder, EmbedBuilder, ChannelType,
} = require('discord.js');
const {
  saveEvent, getEvent, deleteEvent, listEvents,
  saveAutopostRoster, deleteAutopostRoster, listAutopostRosters,
} = require('../../utils/db');
const { buildRosterEmbed, buildRosterButtons } = require('../../utils/rosterBuilder');
const { parseLondonDateTime, parseTimeOfDay } = require('../../utils/time');
const { refreshUpcomingBoard } = require('../../utils/upcomingBoard');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('event')
    .setDescription('Create and manage event / roster signup panels')
    .addSubcommand(sub => sub.setName('create')
      .setDescription('Open a form to create a new event signup panel')
      .addChannelOption(o => o.setName('channel').setDescription('Channel to post the panel in (defaults to here)').addChannelTypes(ChannelType.GuildText))
      .addStringOption(o => o.setName('thumbnail').setDescription('Thumbnail image URL for the panel (optional)'))
      .addStringOption(o => o.setName('time').setDescription('Scheduled time, London time (e.g. "2026-07-25 18:00" or "18:00" for today)')))
    .addSubcommand(sub => sub.setName('list')
      .setDescription('List all active event panels in this server'))
    .addSubcommand(sub => sub.setName('close')
      .setDescription('Lock a panel so no one can join')
      .addStringOption(o => o.setName('message_id').setDescription('Message ID of the panel').setRequired(true)))
    .addSubcommand(sub => sub.setName('delete')
      .setDescription('Delete an event panel entirely')
      .addStringOption(o => o.setName('message_id').setDescription('Message ID of the panel').setRequired(true)))
    .addSubcommandGroup(group => group.setName('autopost')
      .setDescription('Automatically post a fresh roster panel every day at a set time')
      .addSubcommand(sub => sub.setName('create')
        .setDescription('Set up a daily recurring roster panel')
        .addStringOption(o => o.setName('time').setDescription('Time of day to post, London time (e.g. "18:00")').setRequired(true))
        .addChannelOption(o => o.setName('channel').setDescription('Channel to post in (defaults to here)').addChannelTypes(ChannelType.GuildText))
        .addStringOption(o => o.setName('thumbnail').setDescription('Thumbnail image URL for the panel (optional)')))
      .addSubcommand(sub => sub.setName('list')
        .setDescription('List all recurring daily rosters in this server'))
      .addSubcommand(sub => sub.setName('delete')
        .setDescription('Stop a recurring daily roster')
        .addStringOption(o => o.setName('id').setDescription('The autopost ID (shown in /event autopost list)').setRequired(true))))
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageEvents),

  async execute(interaction) {
    const group = interaction.options.getSubcommandGroup(false);
    const sub = interaction.options.getSubcommand();

    // ---------- /event autopost ... ----------
    if (group === 'autopost') {
      if (sub === 'create') {
        const timeInput = interaction.options.getString('time');
        const targetChannel = interaction.options.getChannel('channel') || interaction.channel;
        const thumbnail = interaction.options.getString('thumbnail') || '';

        const parsedTime = parseTimeOfDay(timeInput);
        if (!parsedTime) {
          return interaction.reply({
            content: 'I couldn\'t read that time. Use 24-hour `HH:mm` format, e.g. `18:00` — London time.',
            ephemeral: true,
          });
        }

        // Same pending-token pattern as /event create — stash the config, then open
        // the modal to collect title/description/category/slot counts.
        const token = `${interaction.user.id}-${Date.now()}`;
        interaction.client.pendingAutopostCreations ??= new Map();
        interaction.client.pendingAutopostCreations.set(token, {
          channelId: targetChannel.id,
          thumbnail,
          hour: parsedTime.hour,
          minute: parsedTime.minute,
        });
        // Expire abandoned pending entries after 15 minutes
        const _autopostTtl = setTimeout(() => {
          interaction.client.pendingAutopostCreations?.delete(token);
        }, 15 * 60 * 1000);
        _autopostTtl.unref?.();

        const modal = new ModalBuilder()
          .setCustomId(`eventAutopostCreate:${token}`)
          .setTitle('Set Up Daily Roster');

        const titleInput = new TextInputBuilder()
          .setCustomId('title').setLabel('Event title')
          .setStyle(TextInputStyle.Short).setRequired(true);

        const descInput = new TextInputBuilder()
          .setCustomId('description').setLabel('Description')
          .setStyle(TextInputStyle.Paragraph).setRequired(false);

        const categoryInput = new TextInputBuilder()
          .setCustomId('category').setLabel('Event category (used for /stats grouping)')
          .setStyle(TextInputStyle.Short).setRequired(true);

        const slotsInput = new TextInputBuilder()
          .setCustomId('slots').setLabel('Roster slots — main,subs')
          .setStyle(TextInputStyle.Short).setPlaceholder('10,2 (use 0 subs for none)').setRequired(true);

        const lockAfterInput = new TextInputBuilder()
          .setCustomId('lockAfter').setLabel('Auto-lock after (minutes since posted)')
          .setStyle(TextInputStyle.Short).setPlaceholder('Blank = server default (/roster-lock-time)').setRequired(false);

        modal.addComponents(
          new ActionRowBuilder().addComponents(titleInput),
          new ActionRowBuilder().addComponents(descInput),
          new ActionRowBuilder().addComponents(categoryInput),
          new ActionRowBuilder().addComponents(slotsInput),
          new ActionRowBuilder().addComponents(lockAfterInput),
        );

        return interaction.showModal(modal);
      }

      if (sub === 'list') {
        const rosters = listAutopostRosters(interaction.guild.id);
        if (!rosters.length) return interaction.reply({ content: 'No recurring daily rosters set up in this server.', ephemeral: true });

        const embed = new EmbedBuilder()
          .setColor(0x5865f2)
          .setTitle('Recurring Daily Rosters')
          .setDescription(rosters.map(r => {
            const time = `${String(r.hour).padStart(2, '0')}:${String(r.minute).padStart(2, '0')}`;
            const last = r.lastPostedDate ? ` • last posted ${r.lastPostedDate}` : ' • not posted yet';
            return `\`${r.token}\` — **${r.title}**\n<#${r.channelId}> • daily at ${time} London time${last}`;
          }).join('\n\n'));
        return interaction.reply({ embeds: [embed], ephemeral: true });
      }

      if (sub === 'delete') {
        const id = interaction.options.getString('id');
        const rosters = listAutopostRosters(interaction.guild.id);
        const match = rosters.find(r => r.token === id);
        if (!match) return interaction.reply({ content: 'No recurring roster found with that ID.', ephemeral: true });

        deleteAutopostRoster(id);
        await refreshUpcomingBoard(interaction.client, interaction.guild.id).catch(() => null);
        return interaction.reply({ content: 'Recurring daily roster stopped.', ephemeral: true });
      }
      return;
    }

    // ---------- /event create / list / close / delete ----------
    if (sub === 'create') {
      const targetChannel = interaction.options.getChannel('channel') || interaction.channel;
      const thumbnail = interaction.options.getString('thumbnail') || '';
      const timeInput = interaction.options.getString('time') || '';

      let scheduledFor = null;
      if (timeInput) {
        const parsed = parseLondonDateTime(timeInput);
        if (!parsed) {
          return interaction.reply({
            content: 'I couldn\'t read that time. Use `YYYY-MM-DD HH:mm` (e.g. `2026-07-25 18:00`) or just `HH:mm` for today — London time.',
            ephemeral: true,
          });
        }
        scheduledFor = parsed.getTime();
      }

      // Stash channel + thumbnail + scheduledFor in a pending map keyed by a short token,
      // since modal customIds have a length limit and this data can be long.
      const token = `${interaction.user.id}-${Date.now()}`;
      interaction.client.pendingEventCreations ??= new Map();
      interaction.client.pendingEventCreations.set(token, { channelId: targetChannel.id, thumbnail, scheduledFor });
      // Expire abandoned pending entries after 15 minutes
      const _eventTtl = setTimeout(() => {
        interaction.client.pendingEventCreations?.delete(token);
      }, 15 * 60 * 1000);
      _eventTtl.unref?.();

      const modal = new ModalBuilder()
        .setCustomId(`eventCreate:${token}`)
        .setTitle('Create Event Roster');

      const titleInput = new TextInputBuilder()
        .setCustomId('title').setLabel('Event title')
        .setStyle(TextInputStyle.Short).setRequired(true);

      const descInput = new TextInputBuilder()
        .setCustomId('description').setLabel('Description')
        .setStyle(TextInputStyle.Paragraph).setRequired(false);

      const categoryInput = new TextInputBuilder()
        .setCustomId('category').setLabel('Event category (used for /stats grouping)')
        .setStyle(TextInputStyle.Short).setRequired(true);

      const slotsInput = new TextInputBuilder()
        .setCustomId('slots').setLabel('Roster slots — main,subs')
        .setStyle(TextInputStyle.Short).setPlaceholder('10,2 (use 0 subs for none)').setRequired(true);

      const lockAfterInput = new TextInputBuilder()
        .setCustomId('lockAfter').setLabel('Auto-lock after (minutes since posted)')
        .setStyle(TextInputStyle.Short).setPlaceholder('Blank = server default (/roster-lock-time)').setRequired(false);

      modal.addComponents(
        new ActionRowBuilder().addComponents(titleInput),
        new ActionRowBuilder().addComponents(descInput),
        new ActionRowBuilder().addComponents(categoryInput),
        new ActionRowBuilder().addComponents(slotsInput),
        new ActionRowBuilder().addComponents(lockAfterInput),
      );

      return interaction.showModal(modal);
    }

    if (sub === 'list') {
      const events = listEvents(interaction.guild.id);
      if (!events.length) return interaction.reply({ content: 'No active event panels in this server.', ephemeral: true });

      const embed = new EmbedBuilder()
        .setColor(0x5865f2)
        .setTitle('Active Event Panels')
        .setDescription(events.map(ev => {
          const filled = ev.main.filter(Boolean).length + ev.subs.filter(Boolean).length;
          const total = ev.mainSlots + ev.subSlots;
          const when = ev.scheduledFor ? ` • <t:${Math.floor(ev.scheduledFor / 1000)}:f>` : '';
          return `**${ev.title}** — \`${ev.messageId}\`\n<#${ev.channelId}> • ${filled}/${total} filled • ${ev.locked ? '🔒 Locked' : '🟢 Open'}${when}`;
        }).join('\n\n'));
      return interaction.reply({ embeds: [embed], ephemeral: true });
    }

    if (sub === 'close' || sub === 'delete') {
      const messageId = interaction.options.getString('message_id');
      const event = getEvent(messageId);
      if (!event || event.guildId !== interaction.guild.id) {
        return interaction.reply({ content: 'No event panel found with that message ID.', ephemeral: true });
      }

      const channel = await interaction.guild.channels.fetch(event.channelId).catch(() => null);
      const message = channel ? await channel.messages.fetch(messageId).catch(() => null) : null;

      if (sub === 'close') {
        event.locked = true;
        event.editedAt = Date.now();
        saveEvent(messageId, event);
        if (message) {
          await message.edit({ embeds: [buildRosterEmbed(event)], components: buildRosterButtons(messageId, true) });
        }
        return interaction.reply({ content: 'Panel locked — no one can join until it is unlocked.', ephemeral: true });
      }

      if (sub === 'delete') {
        deleteEvent(messageId);
        if (message) await message.delete().catch(() => null);
        return interaction.reply({ content: 'Event panel deleted.', ephemeral: true });
      }
    }
  },
};
