// Handles the ticket system's two button interactions: opening a new ticket
// and closing/transcribing one. Extracted from events/interactionCreate.js
// to keep that file from growing unbounded — follows the same
// handle*Interaction(interaction) => boolean pattern already used by
// embedInteractionHandler.js and manualReactHandler.js.
//
// NOTE: TICKET_CATEGORY_ID/TICKET_STAFF_ROLE_ID, getTicketCategoryId/
// getTicketStaffRoleId, buildTicketTranscript, and applyPlaceholders/
// applyDraftPlaceholders are intentionally duplicated here (not imported
// from interactionCreate.js) because interactionCreate.js still needs its
// own copies for the panel:ticketEmbed:* settings handlers, which were left
// untouched during this extraction to keep the change small and reviewable.
const {
  PermissionFlagsBits,
  ChannelType,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  AttachmentBuilder,
} = require('discord.js');
const { getGuildSettings } = require('../utils/db');
const { buildEmbedFromDraft: buildEmbedPreview, buildLiveButtonRows } = require('../utils/embedBuilder');

// ---------- Ticket system config ----------
// Category new ticket channels get created under.
// Falls back to null (not configured) if admins haven't set these via /panel.
const TICKET_CATEGORY_ID = null;
// Role that can see/reply to every ticket, in addition to the person who opened it.
const TICKET_STAFF_ROLE_ID = null;

// Returns the ticket category: whatever's set via /panel > Ticket Settings,
// falling back to the hardcoded default ONLY IF it actually exists inside the
// requesting guild (the fallback was originally the developer's own server's
// channel — it must never reach into another guild). Returns null if neither
// is present, so callers can show a clean "not configured" message.
async function getTicketCategoryId(guild) {
  const settings = getGuildSettings(guild.id);
  const candidate = settings.ticketCategoryId || TICKET_CATEGORY_ID;
  const channel = await guild.channels.fetch(candidate).catch(() => null);
  return channel ? candidate : null;
}

// Same idea, for the staff role that can see tickets.
async function getTicketStaffRoleId(guild) {
  const settings = getGuildSettings(guild.id);
  const candidate = settings.ticketStaffRoleId || TICKET_STAFF_ROLE_ID;
  const role = await guild.roles.fetch(candidate).catch(() => null);
  return role ? candidate : null;
}

// Simple {token} substitution used by the ticket embeds, since draft text
// fields are static strings entered through a modal and can't contain live
// mentions/values directly.
function applyPlaceholders(text, map) {
  if (!text) return text;
  return Object.entries(map).reduce((acc, [token, value]) => acc.split(`{${token}}`).join(value), text);
}

function applyDraftPlaceholders(draft, map) {
  const cloned = JSON.parse(JSON.stringify(draft));
  cloned.title = applyPlaceholders(cloned.title, map);
  cloned.description = applyPlaceholders(cloned.description, map);
  if (cloned.url) cloned.url = applyPlaceholders(cloned.url, map);
  if (cloned.author) cloned.author.name = applyPlaceholders(cloned.author.name, map);
  if (cloned.footer) cloned.footer.text = applyPlaceholders(cloned.footer.text, map);
  if (cloned.fields?.length) {
    cloned.fields = cloned.fields.map((f) => ({
      ...f,
      name: applyPlaceholders(f.name, map),
      value: applyPlaceholders(f.value, map),
    }));
  }
  return cloned;
}

// Pages through every message in a ticket channel (oldest first) and returns
// a plain-text transcript as a Buffer, ready to attach to a message.
async function buildTicketTranscript(channel) {
  const allMessages = [];
  let lastId;

  // Discord only returns 100 messages per call, so keep paging backwards
  // (using `before`) until there's nothing left to fetch.
  while (true) {
    const options = { limit: 100 };
    if (lastId) options.before = lastId;
    const batch = await channel.messages.fetch(options);
    if (batch.size === 0) break;
    allMessages.push(...batch.values());
    lastId = batch.last().id;
    if (batch.size < 100) break;
  }

  allMessages.reverse(); // oldest -> newest, readable order

  const lines = allMessages.map((m) => {
    const time = new Date(m.createdTimestamp).toISOString();
    const attachmentUrls = m.attachments.size ? ` [attachments: ${[...m.attachments.values()].map((a) => a.url).join(', ')}]` : '';
    const content = m.content || (m.embeds.length ? '[embed]' : '');
    return `[${time}] ${m.author.tag}: ${content}${attachmentUrls}`;
  });

  return Buffer.from(lines.length ? lines.join('\n') : 'No messages were sent in this ticket.', 'utf8');
}

// ---------- Tickets: open a new private ticket channel ----------
async function handleTicketOpen(interaction) {
  const categoryId = await getTicketCategoryId(interaction.guild);
  const staffRoleId = await getTicketStaffRoleId(interaction.guild);

  if (!categoryId) {
    return interaction.reply({ content: 'Ticket category is not configured for this server — please tell an admin.', ephemeral: true });
  }
  if (!staffRoleId) {
    return interaction.reply({ content: 'The ticket staff role is not configured for this server — please tell an admin.', ephemeral: true });
  }

  // One open ticket per user: look for an existing channel in the category
  // whose topic we stamped with this user's ID when it was created.
  const existing = interaction.guild.channels.cache.find(
    (c) => c.parentId === categoryId && c.topic === interaction.user.id,
  );
  if (existing) {
    return interaction.reply({ content: `You already have an open ticket: ${existing}`, ephemeral: true });
  }

  const channel = await interaction.guild.channels.create({
    name: `ticket-${interaction.user.username}`.toLowerCase().slice(0, 90),
    type: ChannelType.GuildText,
    parent: categoryId,
    topic: interaction.user.id, // used above to detect an existing open ticket
    permissionOverwrites: [
      { id: interaction.guild.roles.everyone.id, deny: [PermissionFlagsBits.ViewChannel] },
      {
        id: interaction.user.id,
        allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory],
      },
      {
        id: staffRoleId,
        allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory],
      },
    ],
  });

  const guildSettings = getGuildSettings(interaction.guild.id);
  const openedDraft = guildSettings.ticketOpenedEmbedDraft
    ? applyDraftPlaceholders(guildSettings.ticketOpenedEmbedDraft, { user: `${interaction.user}` })
    : null;

  const embed = openedDraft
    ? buildEmbedPreview(openedDraft)
    : new EmbedBuilder()
        .setColor(0x5865f2)
        .setTitle('Ticket Opened')
        .setDescription(`${interaction.user}, thanks for reaching out — staff will be with you shortly.\n\nClick **Close Ticket** below once this is resolved.`);

  const closeRow = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('ticket:close').setLabel('Close Ticket').setStyle(ButtonStyle.Danger),
  );
  // Any decorative link/role buttons the custom draft has go first, the
  // functional Close Ticket button is always appended last and can't be
  // removed via the builder. Capped at 5 rows total (Discord's limit).
  const extraRows = openedDraft ? buildLiveButtonRows(openedDraft.buttons) : [];
  const rows = [...extraRows, closeRow].slice(0, 5);

  await channel.send({ content: `<@&${staffRoleId}>`, embeds: [embed], components: rows });

  return interaction.reply({ content: `Ticket opened: ${channel}`, ephemeral: true });
}

// ---------- Tickets: close the ticket channel and generate a transcript ----------
async function handleTicketClose(interaction) {
  const staffRoleId = await getTicketStaffRoleId(interaction.guild);
  const isStaff =
    (staffRoleId && interaction.member.roles.cache.has(staffRoleId)) ||
    interaction.memberPermissions?.has(PermissionFlagsBits.ManageChannels);
  const isOpener = interaction.channel.topic === interaction.user.id;

  if (!isStaff && !isOpener) {
    return interaction.reply({ content: 'Only the ticket opener or staff can close this ticket.', ephemeral: true });
  }

  await interaction.reply({ content: 'Closing this ticket in 5 seconds — generating transcript...' });

  const channel = interaction.channel;
  const openerId = channel.topic;
  const settings = getGuildSettings(interaction.guild.id);
  const closerTag = interaction.user.tag;

  setTimeout(async () => {
    try {
      const transcriptBuffer = await buildTicketTranscript(channel);
      const attachment = new AttachmentBuilder(transcriptBuffer, { name: `transcript-${channel.name}.txt` });
      let sentSomewhere = false;

      const placeholders = { channelName: channel.name, closerTag };
      const closeDraft = settings.ticketCloseEmbedDraft
        ? applyDraftPlaceholders(settings.ticketCloseEmbedDraft, placeholders)
        : null;
      // Fallback plain-text lines, used only if no custom Close embed is set.
      const fallbackLines = {
        log: `Transcript for **${channel.name}** — closed by ${closerTag}`,
        dm: `Here's the transcript for your ticket **${channel.name}**.`,
        noConfig: `Transcript for **${channel.name}** (no log channel configured):`,
      };
      const closeEmbed = closeDraft ? buildEmbedPreview(closeDraft) : null;

      if (settings.ticketLogChannelId) {
        const logChannel = await interaction.guild.channels.fetch(settings.ticketLogChannelId).catch(() => null);
        if (logChannel) {
          await logChannel
            .send(closeEmbed ? { embeds: [closeEmbed], files: [attachment] } : { content: fallbackLines.log, files: [attachment] })
            .catch(() => null);
          sentSomewhere = true;
        }
      }

      if (settings.ticketDmTranscriptToOpener && openerId) {
        const opener = await interaction.guild.members.fetch(openerId).catch(() => null);
        if (opener) {
          await opener
            .send(closeEmbed ? { embeds: [closeEmbed], files: [attachment] } : { content: fallbackLines.dm, files: [attachment] })
            .catch(() => null);
          sentSomewhere = true;
        }
      }

      // Nothing configured/reachable? DM whoever closed it so the transcript
      // isn't silently lost.
      if (!sentSomewhere) {
        await interaction.user
          .send(closeEmbed ? { embeds: [closeEmbed], files: [attachment] } : { content: fallbackLines.noConfig, files: [attachment] })
          .catch(() => null);
      }
    } catch (err) {
      console.error('[ticket] Failed to build/send transcript:', err);
    }

    await channel.delete().catch(() => null);
  }, 5000);

  return;
}

// Entry point matching the codebase's existing handle*Interaction(interaction)
// => boolean convention (see embedInteractionHandler.js, manualReactHandler.js).
// Returns true if this module handled the interaction (caller should stop
// processing / return), false if it's not a ticket interaction.
async function handleTicketInteraction(interaction) {
  if (interaction.isButton() && interaction.customId === 'ticket:open') {
    await handleTicketOpen(interaction);
    return true;
  }

  if (interaction.isButton() && interaction.customId === 'ticket:close') {
    await handleTicketClose(interaction);
    return true;
  }

  return false;
}

module.exports = { handleTicketInteraction };
