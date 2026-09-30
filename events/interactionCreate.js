const {
  Events,
  PermissionFlagsBits,
} = require('discord.js');
const {
  getEvent, saveEvent, saveScheduledEvent,
  saveAutopostRoster,
  getGuildSettings, setGuildSettings,
} = require('../utils/db');
const { buildRosterEmbed, buildRosterButtons } = require('../utils/rosterBuilder');
const { refreshUpcomingBoard } = require('../utils/upcomingBoard');
const { handleEmbedInteraction } = require('../utils/embedInteractionHandler');
const { handleManualReactInteraction } = require('../utils/manualReactHandler');
const { handleTicketInteraction } = require('../utils/ticketInteractionHandler');
const { handlePollInteraction } = require('../utils/pollInteractionHandler');
const { handleGiveawayInteraction } = require('../utils/giveawayInteractionHandler');
const { handleRoleRequestInteraction } = require('../utils/roleRequestInteractionHandler');
const { handleReactionApprovalInteraction } = require('../utils/reactionApprovalInteractionHandler');
const { handleUpcomingBoardInteraction } = require('../utils/upcomingBoardInteractionHandler');
const { handleRosterInteraction } = require('../utils/rosterInteractionHandler');
const { handleWarningsInteraction } = require('../utils/warningsInteractionHandler');
const { handleInviteLogInteraction } = require('../utils/inviteLogInteractionHandler');
const { handlePanelInteraction } = require('../utils/panelInteractionHandler');
const { handleChannelLockInteraction } = require('../utils/channelLockInteractionHandler');
const { handleLockdownInteraction } = require('../utils/lockdownInteractionHandler');
const { handleHelpInteraction } = require('../utils/helpInteractionHandler');
const { handleBotConfigInteraction } = require('../utils/botConfigInteractionHandler');
const { handleInteractionError } = require('../utils/errorHandler');

// If the requested time is less than this far in the future, just post immediately
// instead of scheduling — avoids a pointless near-instant "wait" for a few seconds.
const IMMEDIATE_THRESHOLD_MS = 15 * 1000;

// ---------- Role request config ----------
// Channel where Approve/Reject requests are reviewed by admins/HC.
// Falls back to null (not configured) if admins haven't set these via /panel.
const ROLE_REQUEST_LOG_CHANNEL_ID = null;
// Role handed out automatically when a request is approved.
const ROLE_REQUEST_APPROVE_ROLE_ID = null;

// Returns the review/log channel for role requests: whatever admins set via
// /panel > Role Request Settings, falling back to the hardcoded default above
// if they've never touched it.
function getRoleRequestLogChannelId(guildId) {
  const settings = getGuildSettings(guildId);
  return settings.roleRequestLogChannelId || ROLE_REQUEST_LOG_CHANNEL_ID;
}

// Same idea, for the role granted on approval.
function getRoleRequestApproveRoleId(guildId) {
  const settings = getGuildSettings(guildId);
  return settings.roleRequestApproveRoleId || ROLE_REQUEST_APPROVE_ROLE_ID;
}

// ---------- Ticket system config ----------
// Category new ticket channels get created under.
// Falls back to null (not configured) if admins haven't set these via /panel.
const TICKET_CATEGORY_ID = null;
// Role that can see/reply to every ticket, in addition to the person who opened it.
const TICKET_STAFF_ROLE_ID = null;

// Returns the ticket category: whatever's set via /panel > Ticket Settings,
// falling back to the hardcoded default if admins haven't touched it.
function getTicketCategoryId(guildId) {
  const settings = getGuildSettings(guildId);
  return settings.ticketCategoryId || TICKET_CATEGORY_ID;
}

// Same idea, for the staff role that can see tickets.
function getTicketStaffRoleId(guildId) {
  const settings = getGuildSettings(guildId);
  return settings.ticketStaffRoleId || TICKET_STAFF_ROLE_ID;
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

// Returns true if the member is allowed to Approve/Reject role requests.
// Uses the mod roles configured in /panel if any are set; otherwise falls
// back to requiring Manage Roles so this never accidentally opens up to everyone.
function canReviewRoleRequests(interaction) {
  const settings = getGuildSettings(interaction.guild.id);
  const modRoleIds = settings.modRoleIds || [];
  if (modRoleIds.length > 0) {
    return interaction.member.roles.cache.some((role) => modRoleIds.includes(role.id));
  }
  return interaction.memberPermissions?.has(PermissionFlagsBits.ManageRoles);
}

// Same permission model as role requests (configured Mod Roles, falling back
// to Manage Roles) - reused for approving/rejecting Reaction Approval requests.
function canReviewReactionApprovals(interaction) {
  return canReviewRoleRequests(interaction);
}

module.exports = {
  name: Events.InteractionCreate,
  async execute(interaction) {
   try {
    // ---------- Maintenance mode gate ----------
    // While a guild has botEnabled: false (toggled via /panel > Power), block
    // every interaction except /panel itself and anything already inside the
    // panel (customIds starting with "panel:"), so an admin can always get
    // back in to turn it on again. Runs before everything else on purpose.
    if (interaction.guild) {
      const maintenanceSettings = getGuildSettings(interaction.guild.id);
      if (maintenanceSettings.botEnabled === false) {
        const commandName = interaction.commandName; // present on chat-input, context-menu, and autocomplete interactions
        const isPanelCommand = commandName === 'panel';
        const isPanelComponent = typeof interaction.customId === 'string' && interaction.customId.startsWith('panel:');

        if (!isPanelCommand && !isPanelComponent) {
          if (interaction.isAutocomplete()) {
            return interaction.respond([]).catch(() => null);
          }
          if (interaction.isRepliable()) {
            await interaction.reply({
              content: '🔧 This bot is currently turned off for maintenance in this server. An admin can turn it back on via `/panel` → Power.',
              ephemeral: true,
            }).catch(() => null);
          }
          return;
        }
      }
    }

    // ---------- Slash commands & context menu commands ----------
    if (interaction.isChatInputCommand() || interaction.isContextMenuCommand()) {
      const command = interaction.client.commands.get(interaction.commandName);
      if (!command) return;
      try {
        await command.execute(interaction);
      } catch (err) {
        console.error(`Error running /${interaction.commandName}:`, err);
        const payload = { content: 'Something went wrong running that command.', ephemeral: true };
        if (interaction.replied || interaction.deferred) await interaction.followUp(payload).catch(() => null);
        else await interaction.reply(payload).catch(() => null);
      }
      return;
    }

    // ---------- Slash command autocomplete ----------
    if (interaction.isAutocomplete()) {
      const command = interaction.client.commands.get(interaction.commandName);
      if (!command?.autocomplete) return;
      try {
        await command.autocomplete(interaction);
      } catch (err) {
        console.error(`Error running autocomplete for /${interaction.commandName}:`, err);
      }
      return;
    }

    // ---------- Upcoming board: public "Refresh" button ----------
    if (await handleUpcomingBoardInteraction(interaction)) return;

    // ---------- Giveaways: enter button ----------
    if (await handleGiveawayInteraction(interaction)) return;

    // ---------- Polls: vote / end poll ----------
    if (await handlePollInteraction(interaction)) return;

    // ---------- Embed builder: panel select menus / modals / buttons,
    // and role-toggle buttons on already-sent embeds ----------
    if (await handleEmbedInteraction(interaction)) return;

    // ---------- "React to Message" context menu: emoji modal submit ----------
    if (await handleManualReactInteraction(interaction)) return;

    // ---------- Modal submit: creating an event panel ----------
    if (interaction.isModalSubmit() && interaction.customId.startsWith('eventCreate:')) {
      const token = interaction.customId.split(':')[1];
      const pending = interaction.client.pendingEventCreations?.get(token);
      interaction.client.pendingEventCreations?.delete(token);

      if (!pending) {
        return interaction.reply({ content: 'That creation session expired — please run /event create again.', ephemeral: true });
      }

      const channel = await interaction.guild.channels.fetch(pending.channelId).catch(() => null);
      if (!channel) return interaction.reply({ content: 'That channel no longer exists.', ephemeral: true });

      const title = interaction.fields.getTextInputValue('title');
      const description = interaction.fields.getTextInputValue('description') || '';
      const category = interaction.fields.getTextInputValue('category').trim();

      const [mainRaw, subRaw] = interaction.fields.getTextInputValue('slots').split(',').map((s) => s.trim());
      const mainSlots = Math.max(1, parseInt(mainRaw, 10) || 10);
      const subSlots = Math.max(0, parseInt(subRaw, 10) || 0);

      const lockAfterRaw = interaction.fields.getTextInputValue('lockAfter').trim();
      const lockAfterOverride = lockAfterRaw === '' ? null : Math.max(0, parseInt(lockAfterRaw, 10) || 0);

      const thumbnail = pending.thumbnail || null;
      const scheduledFor = pending.scheduledFor || null;

      // Per-event override typed into the "Auto-lock after" box, falling back to
      // the server default set via /roster-lock-time. 0 means auto-lock is off.
      const guildSettings = getGuildSettings(interaction.guild.id);
      const lockAfterMinutes = lockAfterOverride ?? guildSettings.rosterAutoLockMinutes ?? 15;

      const event = {
        guildId: interaction.guild.id,
        channelId: channel.id,
        hostId: interaction.user.id,
        hostTag: interaction.user.tag,
        title,
        description,
        category,
        thumbnail,
        scheduledFor,
        lockAfterMinutes,
        autoLockTriggered: false,
        mainSlots,
        subSlots,
        main: new Array(mainSlots).fill(null),
        subs: new Array(subSlots).fill(null),
        attendedRecorded: [], // userIds already credited with attendance for this panel
        locked: false,
        createdAt: Date.now(),
        editedAt: Date.now(),
      };

      // If a future time was given, hold the panel and let utils/scheduler.js post it
      // automatically once that time arrives — instead of posting it right now.
      if (scheduledFor && scheduledFor > Date.now() + IMMEDIATE_THRESHOLD_MS) {
        const scheduleToken = `sched-${Date.now()}-${interaction.user.id}`;
        saveScheduledEvent(scheduleToken, event);
        const unix = Math.floor(scheduledFor / 1000);
        return interaction.reply({
          content: `Panel scheduled — it will be posted automatically in ${channel} at <t:${unix}:F> (<t:${unix}:R>).`,
          ephemeral: true,
        });
      }

      // Send with NO buttons yet — the real message ID isn't known until after this
      // send resolves, so there's no window where a clickable-but-wrong-ID button exists.
      try {
        const message = await channel.send({
          embeds: [buildRosterEmbed(event, interaction.guild)],
        });

        saveEvent(message.id, event);
        await message.edit({ components: buildRosterButtons(message.id, false) });

        return interaction.reply({ content: `Event panel created in ${channel}.`, ephemeral: true });
      } catch (err) {
        console.error('[event create] Failed to post panel or attach buttons:', err);
        const payload = { content: `Something went wrong creating the panel: \`${err.message}\`. Check the bot console for details.`, ephemeral: true };
        if (interaction.replied || interaction.deferred) return interaction.followUp(payload).catch(() => null);
        return interaction.reply(payload).catch(() => null);
      }
    }

    // ---------- Modal submit: setting up a recurring daily roster ----------
    if (interaction.isModalSubmit() && interaction.customId.startsWith('eventAutopostCreate:')) {
      const token = interaction.customId.split(':')[1];
      const pending = interaction.client.pendingAutopostCreations?.get(token);
      interaction.client.pendingAutopostCreations?.delete(token);

      if (!pending) {
        return interaction.reply({ content: 'That setup session expired — please run /event autopost create again.', ephemeral: true });
      }

      const channel = await interaction.guild.channels.fetch(pending.channelId).catch(() => null);
      if (!channel) return interaction.reply({ content: 'That channel no longer exists.', ephemeral: true });

      const title = interaction.fields.getTextInputValue('title');
      const description = interaction.fields.getTextInputValue('description') || '';
      const category = interaction.fields.getTextInputValue('category').trim();

      const [mainRaw, subRaw] = interaction.fields.getTextInputValue('slots').split(',').map((s) => s.trim());
      const mainSlots = Math.max(1, parseInt(mainRaw, 10) || 10);
      const subSlots = Math.max(0, parseInt(subRaw, 10) || 0);

      const lockAfterRaw = interaction.fields.getTextInputValue('lockAfter').trim();
      const lockAfterOverride = lockAfterRaw === '' ? null : Math.max(0, parseInt(lockAfterRaw, 10) || 0);

      // Per-roster override typed into the "Auto-lock after" box, falling back to
      // the server default set via /roster-lock-time. Stored here so every future
      // daily post the scheduler creates from this config inherits the same value.
      const guildSettings = getGuildSettings(interaction.guild.id);
      const lockAfterMinutes = lockAfterOverride ?? guildSettings.rosterAutoLockMinutes ?? 15;

      const autopostToken = `autopost-${Date.now()}-${interaction.user.id}`;
      saveAutopostRoster(autopostToken, {
        guildId: interaction.guild.id,
        channelId: channel.id,
        hostId: interaction.user.id,
        hostTag: interaction.user.tag,
        title,
        description,
        category,
        thumbnail: pending.thumbnail || null,
        mainSlots,
        subSlots,
        hour: pending.hour,
        minute: pending.minute,
        lockAfterMinutes,
        lastPostedDate: null, // set once the scheduler posts it the first time
      });

      // New roster was just added — update the board now instead of waiting
      // for the next periodic refresh, so it reflects reality immediately.
      await refreshUpcomingBoard(interaction.client, interaction.guild.id).catch(() => null);

      const time = `${String(pending.hour).padStart(2, '0')}:${String(pending.minute).padStart(2, '0')}`;
      return interaction.reply({
        content: `Set up! A fresh "${title}" roster will be posted in ${channel} every day at ${time} London time.`,
        ephemeral: true,
      });
    }

    // ---------- Buttons: join / leave / lock ----------
    if (await handleRosterInteraction(interaction)) return;

    // ---------- Role request: open / submit / review ----------
    if (await handleRoleRequestInteraction(interaction)) return;

    // ---------- Reaction Approval: approve / reject ----------
    if (await handleReactionApprovalInteraction(interaction)) return;

    // ---------- Tickets: open / close ----------
    if (await handleTicketInteraction(interaction)) return;

    // ---------- Warnings: refresh list embed ----------
    if (await handleWarningsInteraction(interaction)) return;

    // ---------- Invite Tracker: revoke invite button ----------
    if (await handleInviteLogInteraction(interaction)) return;

    // ---------- Channel Lock: unlock button ----------
    if (await handleChannelLockInteraction(interaction)) return;

    // ---------- Lockdown: Unlock / Re-Lock buttons ----------
    if (await handleLockdownInteraction(interaction)) return;

    // ---------- Dashboard: all panel: interactions ----------
    if (await handlePanelInteraction(interaction)) return;

    // ---------- /help: category select + back-to-overview ----------
    if (await handleHelpInteraction(interaction)) return;

    // ---------- /bot-config: all interactions ----------
    if (await handleBotConfigInteraction(interaction)) return;
   } catch (error) {
    // Last-resort safety net for the whole dispatch chain above: a
    // synchronous throw (e.g. a discord.js builder validation error like
    // the %userAvatar%-as-thumbnail crash) or an unguarded rejection lands
    // here instead of becoming an uncaughtException that kills the entire
    // process for every guild. See errorHandler.js for the actual
    // log-and-reply logic; individual handlers above still keep their own
    // more specific try/catch where they need custom recovery.
    await handleInteractionError(interaction, error);
   }
  },
};
