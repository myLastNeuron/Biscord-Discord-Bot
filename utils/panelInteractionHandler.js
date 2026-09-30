const {
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  MessageFlags,
  PermissionFlagsBits,
} = require('discord.js');
const {
  getGuildSettings, setGuildSettings, resetGuildSettings, resetEverythingForGuild, setRestartFlag,
  getUserStats, clearUserStats,
  getGiveaway, listGiveaways, deleteGiveaway,
  listInviteStats, getInviteStats, addBonusInvites, resetAllInviteStats,
  saveAutopostRoster, listAutopostRosters, deleteAutopostRoster, getAutopostRoster, updateAutopostRoster,
} = require('./db');
const {
  getSettings: getLevelSettings,
  updateSettings: updateLevelSettings,
  getLevelDefinitions, setLevelDefinition, deleteLevelDefinition,
} = require('./levelStore');
const { getBotConfig, setBotConfig } = require('./botConfigStore');
const { buildBotConfigPayload } = require('./botConfigBuilder');
const { buildHelpOverviewEmbed, buildHelpOverviewComponents } = require('./helpBuilder');
const {
  buildPanelPayload, buildResetConfirmEmbed, buildResetConfirmComponents,
  buildRestartConfirmEmbed, buildRestartConfirmComponents,
  buildPowerOptionsEmbed, buildPowerOptionsComponents,
  buildAutopostSettingsEmbed, buildAutopostSettingsComponents,
  buildAutopostDetailEmbed, buildAutopostDetailComponents,
  buildAutopostResetConfirmEmbed, buildAutopostResetConfirmComponents,
  buildAutopostChannelStepEmbed, buildAutopostChannelStepComponents,
  buildAutopostScheduleTypeStepEmbed, buildAutopostScheduleTypeStepComponents,
  buildAutopostHourStepEmbed, buildAutopostHourStepComponents,
  buildRoleRequestSettingsEmbed, buildRoleRequestSettingsComponents,
  buildTicketSettingsEmbed, buildTicketSettingsComponents,
  buildTicketEmbedResetConfirmEmbed, buildTicketEmbedResetConfirmComponents,
  buildWelcomeSettingsEmbed, buildWelcomeSettingsComponents,
  buildWelcomeEmbedResetConfirmEmbed, buildWelcomeEmbedResetConfirmComponents,
  buildWelcomePlaceholdersEmbed,
  buildUpcomingBoardSettingsEmbed, buildUpcomingBoardSettingsComponents,
  buildAutoReactSettingsEmbed, buildAutoReactSettingsComponents,
  buildAutoReactRuleDetailEmbed, buildAutoReactRuleDetailComponents,
  buildAutoReactTriggerStepEmbed, buildAutoReactTriggerStepComponents,
  buildAutoReactMatchModeStepEmbed, buildAutoReactMatchModeStepComponents,
  buildAutoReactChannelStepEmbed, buildAutoReactChannelStepComponents,
  buildAutoReactRemoveConfirmEmbed, buildAutoReactRemoveConfirmComponents,
  buildTempVcSettingsEmbed, buildTempVcSettingsComponents,
  buildInviteTrackerSettingsEmbed, buildInviteTrackerSettingsComponents,
  buildInviteTrackerResetConfirmEmbed, buildInviteTrackerResetConfirmComponents,
  buildPanelPage2Payload,
  buildReactionApprovalSettingsEmbed, buildReactionApprovalSettingsComponents,
  buildStatsPanelPickerEmbed, buildStatsPanelPickerComponents,
  buildStatsPanelDetailComponents,
  buildStatsPanelClearConfirmEmbed, buildStatsPanelClearConfirmComponents,
  buildGiveawaySettingsEmbed, buildGiveawaySettingsComponents,
  buildGiveawayDetailEmbed, buildGiveawayDetailComponents,
  buildGiveawayDeleteConfirmEmbed, buildGiveawayDeleteConfirmComponents,
  buildGiveawayChannelStepEmbed, buildGiveawayChannelStepComponents,
  buildGiveawayTemplateEmbed, buildGiveawayTemplateComponents,
  buildLevelSystemEmbed, buildLevelSystemComponents,
  buildLevelXpSettingsEmbed, buildLevelXpSettingsComponents,
  buildLevelManagerEmbed, buildLevelManagerComponents,
  buildLevelPickEmbed, buildLevelPickComponents,
  buildLevelDeleteConfirmEmbed, buildLevelDeleteConfirmComponents,
  buildLevelNotifyEmbed, buildLevelNotifyComponents,
} = require('./panelBuilder');
const { buildGiveawayEmbed, buildGiveawayButtons } = require('./giveawayBuilder');
const { createAndPostGiveaway, finalizeGiveaway, rerollGiveaway, syncGiveawayMessage } = require('./giveawayManager');
const { parseDuration, formatDuration, MAX_GIVEAWAY_DURATION_MS } = require('./duration');
const { buildStatsEmbed } = require('./statsBuilder');
const { parseEmojiList, describeRule } = require('./autoReactMatcher');
const { refreshUpcomingBoard } = require('./upcomingBoard');
const embedSessionStore = require('./embedSessionStore');
const {
  buildEmbedFromDraft: buildEmbedPreview,
  buildPanelComponents: buildEmbedPanelComponents,
} = require('./embedBuilder');
const giveawayWizardStore = require('./giveawayWizardStore');
const autoReactStore = require('./autoReactStore');
const autoReactWizardStore = require('./autoReactWizardStore');
const autopostWizardStore = require('./autopostWizardStore');
const tempVcStore = require('./tempVcStore');
const {
  AUTOREACT_KEYWORD_TRIGGERS, buildAutoReactWizardModal, buildAutopostWizardModal,
} = require('./panelWizardModals');

// True when the button/select lives on a V2 dashboard message (IsComponentsV2 flag).
// Sub-panels reached from V2 must open as ephemeral replies, not in-place updates.
function isOnV2DashboardMessage(interaction) {
  return interaction.message?.flags?.has(MessageFlags.IsComponentsV2) === true;
}

// ---------- Ticket custom embeds ----------
const TICKET_EMBED_KINDS = {
  panel: {
    field: 'ticketPanelEmbedDraft',
    label: 'Ticket Panel',
    hint: 'This is the embed posted by `/ticket panel`. An **Open Ticket** button is always added automatically.',
    defaultDraft: () => ({ ...embedSessionStore.blankDraft(), title: 'Support Tickets', description: 'Need help? Click the button below to open a private ticket with staff.', color: 0x5865f2 }),
  },
  opened: {
    field: 'ticketOpenedEmbedDraft',
    label: 'Ticket Opened',
    hint: 'Shown inside a new ticket channel. A **Close Ticket** button is always added automatically. Use `{user}` anywhere to insert a mention of whoever opened the ticket.',
    defaultDraft: () => ({ ...embedSessionStore.blankDraft(), title: 'Ticket Opened', description: '{user}, thanks for reaching out — staff will be with you shortly.\n\nClick **Close Ticket** below once this is resolved.', color: 0x5865f2 }),
  },
  close: {
    field: 'ticketCloseEmbedDraft',
    label: 'Ticket Close / Transcript',
    hint: 'Sent alongside the transcript file (log channel, DM to opener, and the closer-fallback DM). Use `{channelName}` and `{closerTag}` as placeholders.',
    defaultDraft: () => ({ ...embedSessionStore.blankDraft(), title: 'Ticket Transcript', description: 'Transcript for **{channelName}** — closed by {closerTag}.', color: 0x5865f2 }),
  },
};

// Seeds the welcome embed builder the *first* time someone opens it for a
// guild that's still on the legacy plain-text welcomeMessage - carries the
// existing text/image over (converted from {curly} to %percent% style) so
// switching to the rich editor doesn't reset anyone's welcome message back
// to blank.
function defaultWelcomeDraft(settings) {
  const legacyDescription = (settings.welcomeMessage || 'Welcome %user% to **%server%**! You are member #%memberCount%.')
    .replaceAll('{user}', '%user%')
    .replaceAll('{server}', '%server%')
    .replaceAll('{memberCount}', '%memberCount%');

  return {
    ...embedSessionStore.blankDraft(),
    title: 'Welcome to %server%! 👋',
    description: legacyDescription,
    color: 0x57f287,
    // No default thumbnail: the images modal validates thumbnail/image as a
    // real URL (isValidUrl in embedBuilder.js) and rejects a literal
    // %placeholder%, so seeding one here could only ever break the raw-draft
    // live preview - it can't actually be set through the UI. (resolveDraft
    // Placeholders in welcomeBuilder.js still resolves %placeholders% in
    // thumbnail/image at send time for any draft that somehow has one, and
    // buildEmbedFromDraft is now hardened to skip rather than crash on an
    // invalid URL either way - see embedBuilder.js.)
    thumbnail: null,
    image: settings.welcomeImage || null,
    footer: { text: 'Member #%memberCount%', iconURL: null },
    timestamp: true,
  };
}

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

// All /panel dashboard interactions: select menus, buttons, and modal submits.
async function handlePanelInteraction(interaction) {
    // Defense-in-depth: the /panel command itself requires Manage Guild, but
    // every panel button/select/modal is its own interaction and the
    // maintenance gate in interactionCreate lets panel components through
    // even while the bot is "off". Enforce Manage Guild here centrally too,
    // so no panel action (restart, reset-everything, giveaway end/reroll/
    // delete, etc.) can ever be triggered without the right permission.
    // Scope to panel:* only — other handlers run after this one.
    if (typeof interaction.customId === 'string' && interaction.customId.startsWith('panel:') &&
        !interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild)) {
      if (interaction.isRepliable()) {
        await interaction.reply({
          content: 'You do not have permission to use the server dashboard.',
          ephemeral: true,
        }).catch(() => null);
      }
      return true;
    }
    // ---------- Dashboard: channel/role select menus ----------
    if (interaction.isChannelSelectMenu() && interaction.customId.startsWith('panel:') && interaction.customId !== 'panel:giveawayCreateChannel') {
      if (interaction.customId === 'panel:autoReactWizard:channel') {
        const session = autoReactWizardStore.updateSession(interaction.guild.id, interaction.user.id, {
          channelId: interaction.values[0],
        });
        return interaction.showModal(buildAutoReactWizardModal(session));
      }

      if (interaction.customId === 'panel:autopostWizard:channel') {
        const session = autopostWizardStore.updateSession(interaction.guild.id, interaction.user.id, {
          channelId: interaction.values[0],
        });
        return interaction.update({
          embeds: [buildAutopostScheduleTypeStepEmbed(session)],
          components: buildAutopostScheduleTypeStepComponents(session),
        });
      }

      if (interaction.customId === 'panel:setRoleRequestLogChannel') {
        setGuildSettings(interaction.guild.id, { roleRequestLogChannelId: interaction.values[0] });
        const settings = getGuildSettings(interaction.guild.id);
        return interaction.update({
          embeds: [buildRoleRequestSettingsEmbed(interaction.guild, settings)],
          components: buildRoleRequestSettingsComponents(),
        });
      }

      if (interaction.customId === 'panel:setTicketCategory') {
        setGuildSettings(interaction.guild.id, { ticketCategoryId: interaction.values[0] });
        const settings = getGuildSettings(interaction.guild.id);
        return interaction.update({
          embeds: [buildTicketSettingsEmbed(interaction.guild, settings)],
          components: buildTicketSettingsComponents(settings),
        });
      }

      if (interaction.customId === 'panel:setTicketLogChannel') {
        setGuildSettings(interaction.guild.id, { ticketLogChannelId: interaction.values[0] });
        const settings = getGuildSettings(interaction.guild.id);
        return interaction.update({
          embeds: [buildTicketSettingsEmbed(interaction.guild, settings)],
          components: buildTicketSettingsComponents(settings),
        });
      }

      if (interaction.customId === 'panel:setInviteLogChannel') {
        setGuildSettings(interaction.guild.id, { inviteLogChannelId: interaction.values[0] });
        const settings = getGuildSettings(interaction.guild.id);
        const leaderboard = listInviteStats(interaction.guild.id);
        return interaction.update({
          embeds: [buildInviteTrackerSettingsEmbed(interaction.guild, settings, leaderboard)],
          components: buildInviteTrackerSettingsComponents(settings),
        });
      }

      if (interaction.customId === 'panel:setUpcomingBoardChannel') {
        const old = getGuildSettings(interaction.guild.id);

        // If the channel is changing and a board message already exists in the
        // old channel, clean it up so we don't leave a stale/orphaned board behind.
        if (old.upcomingBoardMessageId && old.upcomingBoardChannelId && old.upcomingBoardChannelId !== interaction.values[0]) {
          const oldChannel = await interaction.guild.channels.fetch(old.upcomingBoardChannelId).catch(() => null);
          const oldMsg = oldChannel ? await oldChannel.messages.fetch(old.upcomingBoardMessageId).catch(() => null) : null;
          if (oldMsg) await oldMsg.delete().catch(() => null);
          setGuildSettings(interaction.guild.id, { upcomingBoardMessageId: null });
        }

        setGuildSettings(interaction.guild.id, { upcomingBoardChannelId: interaction.values[0] });

        if (getGuildSettings(interaction.guild.id).upcomingBoardEnabled) {
          await refreshUpcomingBoard(interaction.client, interaction.guild.id).catch(() => null);
        }

        const settings = getGuildSettings(interaction.guild.id);
        return interaction.update({
          embeds: [buildUpcomingBoardSettingsEmbed(interaction.guild, settings)],
          components: buildUpcomingBoardSettingsComponents(settings),
        });
      }

      if (interaction.customId === 'panel:setTempVcTrigger') {
        const settings = tempVcStore.setSettings(interaction.guild.id, { triggerChannelId: interaction.values[0] });
        return interaction.update({
          embeds: [buildTempVcSettingsEmbed(interaction.guild, settings)],
          components: buildTempVcSettingsComponents(settings),
        });
      }

      if (interaction.customId === 'panel:setTempVcCategory') {
        const settings = tempVcStore.setSettings(interaction.guild.id, { categoryId: interaction.values[0] });
        return interaction.update({
          embeds: [buildTempVcSettingsEmbed(interaction.guild, settings)],
          components: buildTempVcSettingsComponents(settings),
        });
      }

      if (interaction.customId === 'panel:setReactionApprovalChannel') {
        setGuildSettings(interaction.guild.id, { reactionApprovalChannelId: interaction.values[0] });
        const settings = getGuildSettings(interaction.guild.id);
        return interaction.update({
          embeds: [buildReactionApprovalSettingsEmbed(interaction.guild, settings)],
          components: buildReactionApprovalSettingsComponents(settings),
        });
      }

      if (interaction.customId === 'panel:setReactionApprovalSourceChannel') {
        setGuildSettings(interaction.guild.id, { reactionApprovalSourceChannelId: interaction.values[0] });
        const settings = getGuildSettings(interaction.guild.id);
        return interaction.update({
          embeds: [buildReactionApprovalSettingsEmbed(interaction.guild, settings)],
          components: buildReactionApprovalSettingsComponents(settings),
        });
      }

      if (interaction.customId === 'panel:setWelcomeChannelSub') {
        setGuildSettings(interaction.guild.id, { welcomeChannelId: interaction.values[0] });
        const settings = getGuildSettings(interaction.guild.id);
        return interaction.update({
          embeds: [buildWelcomeSettingsEmbed(interaction.guild, settings)],
          components: buildWelcomeSettingsComponents(settings),
        });
      }

      if (interaction.customId === 'panel:setLevelNotifyChannel') {
        updateLevelSettings(interaction.guild.id, { notifyChannel: interaction.values[0], notifyDedicatedChannel: true });
        const settings = getLevelSettings(interaction.guild.id);
        return interaction.update({
          embeds: [buildLevelNotifyEmbed(interaction.guild, settings)],
          components: buildLevelNotifyComponents(settings),
        });
      }

      if (interaction.customId === 'panel:setAuditLogChannel') {
        setGuildSettings(interaction.guild.id, { auditLogChannelId: interaction.values[0] });
        const settings = getGuildSettings(interaction.guild.id);
        return interaction.update(buildPanelPayload(interaction.guild, settings));
      }

      const field = interaction.customId === 'panel:setWelcomeChannel' ? 'welcomeChannelId' : 'logChannelId';
      setGuildSettings(interaction.guild.id, { [field]: interaction.values[0] });
      const settings = getGuildSettings(interaction.guild.id);
      return interaction.update(buildPanelPayload(interaction.guild, settings));
    }

    if (interaction.isRoleSelectMenu() && interaction.customId === 'panel:setTempVcRole') {
      const settings = tempVcStore.setSettings(interaction.guild.id, { roleId: interaction.values[0] });
      return interaction.update({
        embeds: [buildTempVcSettingsEmbed(interaction.guild, settings)],
        components: buildTempVcSettingsComponents(settings),
      });
    }

    if (interaction.isRoleSelectMenu() && interaction.customId === 'panel:setRoleRequestApproveRole') {
      setGuildSettings(interaction.guild.id, { roleRequestApproveRoleId: interaction.values[0] });
      const settings = getGuildSettings(interaction.guild.id);
      return interaction.update({
        embeds: [buildRoleRequestSettingsEmbed(interaction.guild, settings)],
        components: buildRoleRequestSettingsComponents(),
      });
    }

    if (interaction.isRoleSelectMenu() && interaction.customId === 'panel:setTicketStaffRole') {
      setGuildSettings(interaction.guild.id, { ticketStaffRoleId: interaction.values[0] });
      const settings = getGuildSettings(interaction.guild.id);
      return interaction.update({
        embeds: [buildTicketSettingsEmbed(interaction.guild, settings)],
        components: buildTicketSettingsComponents(settings),
      });
    }

    if (interaction.isStringSelectMenu() && interaction.customId === 'panel:setReactionApprovalTriggerType') {
      const triggerType = interaction.values[0];
      // Switching trigger type invalidates whatever config was set for the
      // previous one (keywords don't make sense for 'any', a template doesn't
      // make sense for 'keyword', etc.) - clear it out so the embed doesn't
      // show stale, no-longer-relevant criteria.
      const settings = setGuildSettings(interaction.guild.id, {
        reactionApprovalTriggerType: triggerType,
        reactionApprovalKeywords: [],
        reactionApprovalMatchAll: false,
        reactionApprovalFormatTemplate: null,
      });
      return interaction.update({
        embeds: [buildReactionApprovalSettingsEmbed(interaction.guild, settings)],
        components: buildReactionApprovalSettingsComponents(settings),
      });
    }

    // ---------- Giveaways: select a giveaway to manage from the list ----------
    if (interaction.isStringSelectMenu() && interaction.customId === 'panel:giveawaySelectManage') {
      const token = interaction.values[0];
      const giveaway = getGiveaway(token);
      if (!giveaway) {
        return interaction.reply({ content: "That giveaway couldn't be found — it may have been deleted.", ephemeral: true });
      }
      return interaction.update({
        embeds: [buildGiveawayDetailEmbed(giveaway)],
        components: buildGiveawayDetailComponents(giveaway),
      });
    }

    // ---------- Giveaways: creation wizard step 1 -> 2 (channel picked, open the modal) ----------
    if (interaction.isChannelSelectMenu() && interaction.customId === 'panel:giveawayCreateChannel') {
      const channelId = interaction.values[0];
      giveawayWizardStore.updateSession(interaction.guild.id, interaction.user.id, { channelId });

      const modal = new ModalBuilder().setCustomId('panel:giveawayCreateModal').setTitle('Create Giveaway');
      const prizeInput = new TextInputBuilder().setCustomId('prize').setLabel('Prize').setStyle(TextInputStyle.Short).setMaxLength(200).setRequired(true);
      const durationInput = new TextInputBuilder().setCustomId('duration').setLabel('Duration (e.g. 30m, 2h, 1d12h)').setStyle(TextInputStyle.Short).setRequired(true);
      const winnersInput = new TextInputBuilder().setCustomId('winners').setLabel('Number of winners').setStyle(TextInputStyle.Short).setValue('1').setRequired(true);

      modal.addComponents(
        new ActionRowBuilder().addComponents(prizeInput),
        new ActionRowBuilder().addComponents(durationInput),
        new ActionRowBuilder().addComponents(winnersInput),
      );
      return interaction.showModal(modal);
    }

    if (interaction.isStringSelectMenu() && interaction.customId === 'panel:selectAutopost') {
      const token = interaction.values[0];
      const rosters = listAutopostRosters(interaction.guild.id);
      const roster = rosters.find((r) => r.token === token);

      if (!roster) {
        return interaction.update({
          content: 'That autopost config no longer exists — it may have already been deleted.',
          embeds: [buildAutopostSettingsEmbed(interaction.guild, rosters)],
          components: buildAutopostSettingsComponents(rosters),
        });
      }

      return interaction.update({
        embeds: [buildAutopostDetailEmbed(interaction.guild, roster)],
        components: buildAutopostDetailComponents(token),
      });
    }

    // ---------- Autopost wizard: schedule type / hour select steps ----------
    if (interaction.isStringSelectMenu() && interaction.customId === 'panel:autopostWizard:scheduleType') {
      const scheduleType = interaction.values[0];
      const session = autopostWizardStore.updateSession(interaction.guild.id, interaction.user.id, {
        scheduleType,
        ...(scheduleType === 'hourly' ? { hour: null } : {}),
      });

      if (scheduleType === 'hourly') {
        return interaction.showModal(buildAutopostWizardModal(session));
      }

      return interaction.update({
        embeds: [buildAutopostHourStepEmbed(session)],
        components: buildAutopostHourStepComponents(session),
      });
    }

    if (interaction.isStringSelectMenu() && interaction.customId === 'panel:autopostWizard:hour') {
      const session = autopostWizardStore.updateSession(interaction.guild.id, interaction.user.id, {
        hour: parseInt(interaction.values[0], 10),
      });
      return interaction.showModal(buildAutopostWizardModal(session));
    }

    if (interaction.isStringSelectMenu() && interaction.customId === 'panel:selectAutoReactRule') {
      const ruleId = interaction.values[0];
      const rules = autoReactStore.listRules(interaction.guild.id);
      const rule = rules.find((r) => r.id === ruleId);

      if (!rule) {
        return interaction.update({
          content: 'That auto-react rule no longer exists — it may have already been removed.',
          embeds: [buildAutoReactSettingsEmbed(interaction.guild, rules)],
          components: buildAutoReactSettingsComponents(rules),
        });
      }

      return interaction.update({
        embeds: [buildAutoReactRuleDetailEmbed(interaction.guild, rule)],
        components: buildAutoReactRuleDetailComponents(ruleId),
      });
    }

    if (interaction.isStringSelectMenu() && interaction.customId === 'panel:autoReactWizard:trigger') {
      const trigger = interaction.values[0];
      const session = autoReactWizardStore.updateSession(interaction.guild.id, interaction.user.id, { trigger });

      if (AUTOREACT_KEYWORD_TRIGGERS.has(trigger)) {
        return interaction.update({
          embeds: [buildAutoReactMatchModeStepEmbed(session)],
          components: buildAutoReactMatchModeStepComponents(),
        });
      }

      return interaction.update({
        embeds: [buildAutoReactChannelStepEmbed(session)],
        components: buildAutoReactChannelStepComponents(),
      });
    }

    // ---------- Levels: pick a level to edit (opens the modal) or delete (opens confirm) ----------
    if (interaction.isStringSelectMenu() && interaction.customId === 'panel:levelEditSelected') {
      const level = parseInt(interaction.values[0], 10);
      const defs = getLevelDefinitions(interaction.guild.id);
      const def = defs.find((d) => d.level === level);
      if (!def) return interaction.reply({ content: 'That level no longer exists — it may have been deleted.', ephemeral: true });

      const modal = new ModalBuilder().setCustomId(`panel:levelModalEdit:${level}`).setTitle(`Edit Level ${level}`);
      modal.addComponents(
        new ActionRowBuilder().addComponents(
          new TextInputBuilder().setCustomId('lvl_name').setLabel('Level name').setStyle(TextInputStyle.Short)
            .setRequired(true).setValue(def.name),
        ),
        new ActionRowBuilder().addComponents(
          new TextInputBuilder().setCustomId('lvl_xp').setLabel('XP required').setStyle(TextInputStyle.Short)
            .setRequired(true).setValue(String(def.xpRequired)),
        ),
        new ActionRowBuilder().addComponents(
          new TextInputBuilder().setCustomId('lvl_role').setLabel('Role ID (blank = none)').setStyle(TextInputStyle.Short)
            .setRequired(false).setValue(def.roleId ?? ''),
        ),
      );
      return interaction.showModal(modal);
    }

    if (interaction.isStringSelectMenu() && interaction.customId === 'panel:levelDeleteSelected') {
      const level = parseInt(interaction.values[0], 10);
      const defs = getLevelDefinitions(interaction.guild.id);
      const def = defs.find((d) => d.level === level);
      if (!def) return interaction.reply({ content: 'That level no longer exists — it may have been deleted.', ephemeral: true });
      return interaction.update({
        embeds: [buildLevelDeleteConfirmEmbed(def)],
        components: buildLevelDeleteConfirmComponents(level),
      });
    }

    if (interaction.isStringSelectMenu() && interaction.customId === 'panel:autoReactWizard:matchMode') {
      const session = autoReactWizardStore.updateSession(interaction.guild.id, interaction.user.id, {
        matchAll: interaction.values[0] === 'all',
      });
      return interaction.update({
        embeds: [buildAutoReactChannelStepEmbed(session)],
        components: buildAutoReactChannelStepComponents(),
      });
    }

    if (interaction.isUserSelectMenu() && interaction.customId === 'panel:statsPanel:selectUser') {
      const targetId = interaction.values[0];
      const targetUser = await interaction.client.users.fetch(targetId).catch(() => null);
      if (!targetUser) return interaction.reply({ content: 'Could not find that user.', ephemeral: true });
      const stats = getUserStats(interaction.guild.id, targetId);
      return interaction.update({
        embeds: [buildStatsEmbed(targetUser, stats)],
        components: buildStatsPanelDetailComponents(targetId),
      });
    }

    if (interaction.isUserSelectMenu() && interaction.customId === 'panel:inviteTracker:bonusUser') {
      const targetId = interaction.values[0];
      const current = getInviteStats(interaction.guild.id, targetId);
      // Target user id travels in the modal's customId since modals can't
      // carry hidden state of their own - handled by the modal-submit block
      // near the other panel modals below.
      const modal = new ModalBuilder()
        .setCustomId(`panel:inviteTracker:bonusModal:${targetId}`)
        .setTitle('Adjust Bonus Invites');
      const amountInput = new TextInputBuilder()
        .setCustomId('amount')
        .setLabel(`Amount (+/-). Current bonus: ${current.bonus}`)
        .setStyle(TextInputStyle.Short)
        .setPlaceholder('e.g. 5 or -3')
        .setRequired(true);
      modal.addComponents(new ActionRowBuilder().addComponents(amountInput));
      return interaction.showModal(modal);
    }

    if (interaction.isRoleSelectMenu() && interaction.customId === 'panel:setModRoles') {
      setGuildSettings(interaction.guild.id, { modRoleIds: interaction.values });
      const settings = getGuildSettings(interaction.guild.id);
      return interaction.update(buildPanelPayload(interaction.guild, settings));
    }

    // ---------- Dashboard: buttons ----------
    if (interaction.isButton() && interaction.customId.startsWith('panel:')) {
      if (interaction.customId === 'panel:refresh') {
        const settings = getGuildSettings(interaction.guild.id);
        return interaction.update(buildPanelPayload(interaction.guild, settings));
      }

      // ---------- Levels sub-panel ----------
      if (interaction.customId === 'panel:levelSystem') {
        const settings = getLevelSettings(interaction.guild.id);
        const defs = getLevelDefinitions(interaction.guild.id);
        const payload = {
          embeds: [buildLevelSystemEmbed(interaction.guild, settings, defs)],
          components: buildLevelSystemComponents(),
        };
        if (isOnV2DashboardMessage(interaction)) {
          return interaction.reply({ ...payload, flags: MessageFlags.Ephemeral });
        }
        // "Back" from a level sub-view — internal navigation on the same message.
        return interaction.update(payload);
      }

      if (interaction.customId === 'panel:levelXp') {
        const settings = getLevelSettings(interaction.guild.id);
        return interaction.update({
          embeds: [buildLevelXpSettingsEmbed(interaction.guild, settings)],
          components: buildLevelXpSettingsComponents(settings),
        });
      }

      // Master on/off switch for the level system (in XP Settings)
      if (interaction.customId === 'panel:levelToggle') {
        const current = getLevelSettings(interaction.guild.id);
        const enabled = current.enabled === false ? true : false; // toggle
        updateLevelSettings(interaction.guild.id, { enabled });
        const settings = getLevelSettings(interaction.guild.id);
        return interaction.update({
          embeds: [buildLevelXpSettingsEmbed(interaction.guild, settings)],
          components: buildLevelXpSettingsComponents(settings),
        });
      }

      if (interaction.customId === 'panel:levelManager') {
        const defs = getLevelDefinitions(interaction.guild.id);
        return interaction.update({
          embeds: [buildLevelManagerEmbed(interaction.guild, defs)],
          components: buildLevelManagerComponents(defs),
        });
      }

      if (interaction.customId === 'panel:levelNotify') {
        const settings = getLevelSettings(interaction.guild.id);
        return interaction.update({
          embeds: [buildLevelNotifyEmbed(interaction.guild, settings)],
          components: buildLevelNotifyComponents(settings),
        });
      }

      if (interaction.customId === 'panel:levelNotifyDm') {
        const current = getLevelSettings(interaction.guild.id);
        updateLevelSettings(interaction.guild.id, { notifyDM: !current.notifyDM });
        const settings = getLevelSettings(interaction.guild.id);
        return interaction.update({
          embeds: [buildLevelNotifyEmbed(interaction.guild, settings)],
          components: buildLevelNotifyComponents(settings),
        });
      }

      if (interaction.customId === 'panel:levelNotifySame') {
        const current = getLevelSettings(interaction.guild.id);
        updateLevelSettings(interaction.guild.id, { notifySameChannel: !current.notifySameChannel });
        const settings = getLevelSettings(interaction.guild.id);
        return interaction.update({
          embeds: [buildLevelNotifyEmbed(interaction.guild, settings)],
          components: buildLevelNotifyComponents(settings),
        });
      }

      if (interaction.customId === 'panel:levelXpMsg') {
        const settings = getLevelSettings(interaction.guild.id);
        const modal = new ModalBuilder().setCustomId('panel:levelModalMsg').setTitle('Set Message XP Range');
        modal.addComponents(
          new ActionRowBuilder().addComponents(
            new TextInputBuilder().setCustomId('min_xp').setLabel('Minimum XP per message').setStyle(TextInputStyle.Short)
              .setRequired(true).setValue(String(settings.xpPerMessage.min)),
          ),
          new ActionRowBuilder().addComponents(
            new TextInputBuilder().setCustomId('max_xp').setLabel('Maximum XP per message').setStyle(TextInputStyle.Short)
              .setRequired(true).setValue(String(settings.xpPerMessage.max)),
          ),
        );
        return interaction.showModal(modal);
      }

      if (interaction.customId === 'panel:levelXpCooldown') {
        const settings = getLevelSettings(interaction.guild.id);
        const modal = new ModalBuilder().setCustomId('panel:levelModalCooldown').setTitle('Set XP Cooldown');
        modal.addComponents(
          new ActionRowBuilder().addComponents(
            new TextInputBuilder().setCustomId('cooldown_sec').setLabel('Cooldown in seconds').setStyle(TextInputStyle.Short)
              .setRequired(true).setValue(String(settings.cooldownMs / 1000)),
          ),
        );
        return interaction.showModal(modal);
      }

      if (interaction.customId === 'panel:levelXpVoice') {
        const settings = getLevelSettings(interaction.guild.id);
        const modal = new ModalBuilder().setCustomId('panel:levelModalVoice').setTitle('Set Voice XP per Minute');
        modal.addComponents(
          new ActionRowBuilder().addComponents(
            new TextInputBuilder().setCustomId('voice_xp').setLabel('XP per minute in voice').setStyle(TextInputStyle.Short)
              .setRequired(true).setValue(String(settings.xpPerVoiceMin)),
          ),
        );
        return interaction.showModal(modal);
      }

      if (interaction.customId === 'panel:levelXpReact') {
        const settings = getLevelSettings(interaction.guild.id);
        const modal = new ModalBuilder().setCustomId('panel:levelModalReact').setTitle('Set Reaction & Command XP');
        modal.addComponents(
          new ActionRowBuilder().addComponents(
            new TextInputBuilder().setCustomId('react_xp').setLabel('XP per reaction').setStyle(TextInputStyle.Short)
              .setRequired(true).setValue(String(settings.xpPerReaction)),
          ),
          new ActionRowBuilder().addComponents(
            new TextInputBuilder().setCustomId('cmd_xp').setLabel('XP per slash command used').setStyle(TextInputStyle.Short)
              .setRequired(true).setValue(String(settings.xpPerCommand)),
          ),
        );
        return interaction.showModal(modal);
      }

      if (interaction.customId === 'panel:levelAdd') {
        const modal = new ModalBuilder().setCustomId('panel:levelModalAdd').setTitle('Add New Level');
        modal.addComponents(
          new ActionRowBuilder().addComponents(
            new TextInputBuilder().setCustomId('lvl_num').setLabel('Level number (e.g. 5)').setStyle(TextInputStyle.Short).setRequired(true),
          ),
          new ActionRowBuilder().addComponents(
            new TextInputBuilder().setCustomId('lvl_name').setLabel('Level name (e.g. Elite)').setStyle(TextInputStyle.Short).setRequired(true),
          ),
          new ActionRowBuilder().addComponents(
            new TextInputBuilder().setCustomId('lvl_xp').setLabel('XP required to reach this level').setStyle(TextInputStyle.Short).setRequired(true),
          ),
          new ActionRowBuilder().addComponents(
            new TextInputBuilder().setCustomId('lvl_role').setLabel('Role ID to assign (leave blank for none)').setStyle(TextInputStyle.Short).setRequired(false),
          ),
        );
        return interaction.showModal(modal);
      }

      if (interaction.customId === 'panel:levelEditSelectOpen') {
        const defs = getLevelDefinitions(interaction.guild.id);
        return interaction.update({
          embeds: [buildLevelPickEmbed('✏️ Choose a level to edit', 0x5865f2)],
          components: buildLevelPickComponents('panel:levelEditSelected', defs),
        });
      }

      if (interaction.customId === 'panel:levelDeleteSelectOpen') {
        const defs = getLevelDefinitions(interaction.guild.id);
        return interaction.update({
          embeds: [buildLevelPickEmbed('🗑️ Choose a level to delete', 0xed4245)],
          components: buildLevelPickComponents('panel:levelDeleteSelected', defs),
        });
      }

      if (interaction.customId.startsWith('panel:levelDeleteYes:')) {
        const level = parseInt(interaction.customId.split(':')[2], 10);
        deleteLevelDefinition(interaction.guild.id, level);
        const defs = getLevelDefinitions(interaction.guild.id);
        return interaction.update({
          content: `✅ Level **${level}** deleted.`,
          embeds: [buildLevelManagerEmbed(interaction.guild, defs)],
          components: buildLevelManagerComponents(defs),
        });
      }

      // ---------- Bot Config sub-panel (bot-wide, needs Administrator) ----------
      if (interaction.customId === 'panel:botConfig') {
        if (!interaction.memberPermissions?.has(PermissionFlagsBits.Administrator)) {
          return interaction.reply({
            content: 'You need **Administrator** permission to change the bot\'s profile and presence.',
            ephemeral: true,
          });
        }
        const config = getBotConfig();
        const payload = buildBotConfigPayload(config, interaction.client, 'panel:botConfig');
        payload.components = [
          ...payload.components,
          new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId('panel:backToMain').setLabel('Back to Main Panel').setStyle(ButtonStyle.Secondary),
          ),
        ];
        return interaction.reply({ ...payload, flags: MessageFlags.Ephemeral });
      }

      // ---------- Help Center sub-panel (reuses the /help screens) ----------
      if (interaction.customId === 'panel:help') {
        return interaction.reply({
          embeds: [buildHelpOverviewEmbed(interaction.guild)],
          components: buildHelpOverviewComponents(),
          flags: MessageFlags.Ephemeral,
        });
      }

      if (interaction.customId === 'panel:roleRequestSettings') {
        const settings = getGuildSettings(interaction.guild.id);
        return interaction.reply({
          embeds: [buildRoleRequestSettingsEmbed(interaction.guild, settings)],
          components: buildRoleRequestSettingsComponents(),
          ephemeral: true,
        });
      }

      if (interaction.customId === 'panel:refreshRoleRequestSettings') {
        const settings = getGuildSettings(interaction.guild.id);
        return interaction.update({
          embeds: [buildRoleRequestSettingsEmbed(interaction.guild, settings)],
          components: buildRoleRequestSettingsComponents(),
        });
      }

      if (interaction.customId === 'panel:ticketSettings') {
        const settings = getGuildSettings(interaction.guild.id);
        if (isOnV2DashboardMessage(interaction)) {
          return interaction.reply({
            embeds: [buildTicketSettingsEmbed(interaction.guild, settings)],
            components: buildTicketSettingsComponents(settings),
            ephemeral: true,
          });
        }
        // "Cancel" from the ticket-embed reset confirmation - internal navigation.
        return interaction.update({
          embeds: [buildTicketSettingsEmbed(interaction.guild, settings)],
          components: buildTicketSettingsComponents(settings),
        });
      }

      if (interaction.customId === 'panel:refreshTicketSettings') {
        const settings = getGuildSettings(interaction.guild.id);
        return interaction.update({
          embeds: [buildTicketSettingsEmbed(interaction.guild, settings)],
          components: buildTicketSettingsComponents(settings),
        });
      }

      if (interaction.customId === 'panel:toggleTicketDm') {
        const current = getGuildSettings(interaction.guild.id);
        setGuildSettings(interaction.guild.id, { ticketDmTranscriptToOpener: !current.ticketDmTranscriptToOpener });
        const updated = getGuildSettings(interaction.guild.id);
        return interaction.update({
          embeds: [buildTicketSettingsEmbed(interaction.guild, updated)],
          components: buildTicketSettingsComponents(updated),
        });
      }

      if (interaction.customId.startsWith('panel:ticketEmbed:') && interaction.customId !== 'panel:ticketEmbed:reset') {
        const kind = interaction.customId.split(':')[2];
        const cfg = TICKET_EMBED_KINDS[kind];
        if (!cfg) return;

        const settings = getGuildSettings(interaction.guild.id);
        const existingDraft = settings[cfg.field] || cfg.defaultDraft();

        const session = embedSessionStore.createSession(interaction.user.id, {
          guildId: interaction.guild.id,
          channelId: interaction.channel.id,
          existingDraft,
          purpose: `ticket:${kind}`,
        });
        const embed = buildEmbedPreview(session.draft);
        const components = buildEmbedPanelComponents(session);
        return interaction.reply({
          content: `Editing the **${cfg.label}** embed. ${cfg.hint}`,
          embeds: [embed],
          components,
          ephemeral: true,
        });
      }

      if (interaction.customId === 'panel:ticketEmbed:reset') {
        const settings = getGuildSettings(interaction.guild.id);
        return interaction.update({
          embeds: [buildTicketEmbedResetConfirmEmbed(settings)],
          components: buildTicketEmbedResetConfirmComponents(),
        });
      }

      if (interaction.customId === 'panel:confirmResetTicketEmbeds') {
        setGuildSettings(interaction.guild.id, {
          ticketPanelEmbedDraft: null,
          ticketOpenedEmbedDraft: null,
          ticketCloseEmbedDraft: null,
        });
        const settings = getGuildSettings(interaction.guild.id);
        return interaction.update({
          embeds: [buildTicketSettingsEmbed(interaction.guild, settings)],
          components: buildTicketSettingsComponents(settings),
        });
      }

      if (interaction.customId === 'panel:welcomeSettings') {
        const settings = getGuildSettings(interaction.guild.id);
        if (isOnV2DashboardMessage(interaction)) {
          return interaction.reply({
            embeds: [buildWelcomeSettingsEmbed(interaction.guild, settings)],
            components: buildWelcomeSettingsComponents(settings),
            ephemeral: true,
          });
        }
        // "Cancel" from the welcome-embed reset confirmation - internal navigation.
        return interaction.update({
          embeds: [buildWelcomeSettingsEmbed(interaction.guild, settings)],
          components: buildWelcomeSettingsComponents(settings),
        });
      }

      if (interaction.customId === 'panel:refreshWelcomeSettings') {
        const settings = getGuildSettings(interaction.guild.id);
        return interaction.update({
          embeds: [buildWelcomeSettingsEmbed(interaction.guild, settings)],
          components: buildWelcomeSettingsComponents(settings),
        });
      }

      if (interaction.customId === 'panel:welcomeEmbed') {
        const settings = getGuildSettings(interaction.guild.id);
        const existingDraft = settings.welcomeEmbedDraft || defaultWelcomeDraft(settings);

        const session = embedSessionStore.createSession(interaction.user.id, {
          guildId: interaction.guild.id,
          channelId: interaction.channel.id,
          existingDraft,
          purpose: 'welcome',
        });
        const embed = buildEmbedPreview(session.draft);
        const components = buildEmbedPanelComponents(session);
        return interaction.reply({
          content: 'Editing the **Welcome Embed** — this is what new members see when they join. ' +
            'Use `%user%`, `%server%`, `%memberCount%` and more (see **Placeholders** on the Welcome Settings screen). ' +
            'Add-a-button supports self-role or link buttons, same as the regular Embed Builder.',
          embeds: [embed],
          components,
          ephemeral: true,
        });
      }

      if (interaction.customId === 'panel:welcomePlaceholders') {
        return interaction.reply({
          embeds: [buildWelcomePlaceholdersEmbed()],
          ephemeral: true,
        });
      }

      if (interaction.customId === 'panel:welcomeEmbedReset') {
        return interaction.update({
          embeds: [buildWelcomeEmbedResetConfirmEmbed()],
          components: buildWelcomeEmbedResetConfirmComponents(),
        });
      }

      if (interaction.customId === 'panel:confirmResetWelcomeEmbed') {
        setGuildSettings(interaction.guild.id, { welcomeEmbedDraft: null });
        const settings = getGuildSettings(interaction.guild.id);
        return interaction.update({
          embeds: [buildWelcomeSettingsEmbed(interaction.guild, settings)],
          components: buildWelcomeSettingsComponents(settings),
        });
      }

      if (interaction.customId === 'panel:upcomingBoardSettings') {
        const settings = getGuildSettings(interaction.guild.id);
        return interaction.reply({
          embeds: [buildUpcomingBoardSettingsEmbed(interaction.guild, settings)],
          components: buildUpcomingBoardSettingsComponents(settings),
          ephemeral: true,
        });
      }

      if (interaction.customId === 'panel:refreshUpcomingBoardSettings') {
        const settings = getGuildSettings(interaction.guild.id);
        return interaction.update({
          embeds: [buildUpcomingBoardSettingsEmbed(interaction.guild, settings)],
          components: buildUpcomingBoardSettingsComponents(settings),
        });
      }

      if (interaction.customId === 'panel:toggleUpcomingBoard') {
        const current = getGuildSettings(interaction.guild.id);
        const turningOn = !current.upcomingBoardEnabled;

        if (turningOn && !current.upcomingBoardChannelId) {
          return interaction.reply({ content: 'Pick a board channel first, then turn it on.', ephemeral: true });
        }

        if (!turningOn && current.upcomingBoardMessageId && current.upcomingBoardChannelId) {
          // Turning off — remove the live message so it doesn't sit there stale.
          const channel = await interaction.guild.channels.fetch(current.upcomingBoardChannelId).catch(() => null);
          const msg = channel ? await channel.messages.fetch(current.upcomingBoardMessageId).catch(() => null) : null;
          if (msg) await msg.delete().catch(() => null);
          setGuildSettings(interaction.guild.id, { upcomingBoardMessageId: null });
        }

        setGuildSettings(interaction.guild.id, { upcomingBoardEnabled: turningOn });

        if (turningOn) {
          await refreshUpcomingBoard(interaction.client, interaction.guild.id).catch(() => null);
        }

        const settings = getGuildSettings(interaction.guild.id);
        return interaction.update({
          embeds: [buildUpcomingBoardSettingsEmbed(interaction.guild, settings)],
          components: buildUpcomingBoardSettingsComponents(settings),
        });
      }

      if (interaction.customId === 'panel:editUpcomingBoardTitleColor') {
        const settings = getGuildSettings(interaction.guild.id);
        const modal = new ModalBuilder().setCustomId('panel:upcomingBoardTitleColorModal').setTitle('Board Title & Color');
        const titleInput = new TextInputBuilder()
          .setCustomId('title')
          .setLabel('Board title')
          .setStyle(TextInputStyle.Short)
          .setValue(settings.upcomingBoardTitle || '📅 Upcoming Rosters')
          .setRequired(true);
        const colorInput = new TextInputBuilder()
          .setCustomId('color')
          .setLabel('Embed color (hex, e.g. 5865f2)')
          .setStyle(TextInputStyle.Short)
          .setValue(settings.upcomingBoardColor != null ? settings.upcomingBoardColor.toString(16).padStart(6, '0') : '5865f2')
          .setRequired(false);
        modal.addComponents(
          new ActionRowBuilder().addComponents(titleInput),
          new ActionRowBuilder().addComponents(colorInput),
        );
        return interaction.showModal(modal);
      }

      if (interaction.customId === 'panel:editUpcomingBoardText') {
        const settings = getGuildSettings(interaction.guild.id);
        const modal = new ModalBuilder().setCustomId('panel:upcomingBoardTextModal').setTitle('Board Header/Footer Text');
        const headerInput = new TextInputBuilder()
          .setCustomId('header')
          .setLabel('Header text (shown above the roster list)')
          .setStyle(TextInputStyle.Paragraph)
          .setValue(settings.upcomingBoardHeaderText || '')
          .setRequired(false);
        const footerInput = new TextInputBuilder()
          .setCustomId('footer')
          .setLabel('Footer text (shown before the time note)')
          .setStyle(TextInputStyle.Short)
          .setValue(settings.upcomingBoardFooterText || '')
          .setRequired(false);
        modal.addComponents(
          new ActionRowBuilder().addComponents(headerInput),
          new ActionRowBuilder().addComponents(footerInput),
        );
        return interaction.showModal(modal);
      }

      if (interaction.customId === 'panel:toggleUpcomingBoardSlots') {
        const current = getGuildSettings(interaction.guild.id);
        setGuildSettings(interaction.guild.id, { upcomingBoardShowSlots: !current.upcomingBoardShowSlots });
        const updated = getGuildSettings(interaction.guild.id);
        await refreshUpcomingBoard(interaction.client, interaction.guild.id).catch(() => null);
        return interaction.update({
          embeds: [buildUpcomingBoardSettingsEmbed(interaction.guild, updated)],
          components: buildUpcomingBoardSettingsComponents(updated),
        });
      }

      if (interaction.customId === 'panel:toggleUpcomingBoardSort') {
        const current = getGuildSettings(interaction.guild.id);
        const next = current.upcomingBoardSortBy === 'channel' ? 'time' : 'channel';
        setGuildSettings(interaction.guild.id, { upcomingBoardSortBy: next });
        const updated = getGuildSettings(interaction.guild.id);
        await refreshUpcomingBoard(interaction.client, interaction.guild.id).catch(() => null);
        return interaction.update({
          embeds: [buildUpcomingBoardSettingsEmbed(interaction.guild, updated)],
          components: buildUpcomingBoardSettingsComponents(updated),
        });
      }

      if (interaction.customId === 'panel:openEmbedBuilder') {
        const session = embedSessionStore.createSession(interaction.user.id, {
          guildId: interaction.guild.id,
          channelId: interaction.channel.id,
        });
        const embed = buildEmbedPreview(session.draft);
        const components = buildEmbedPanelComponents(session);
        return interaction.reply({
          content: `Building for <#${session.channelId}>. Use the menus below — this preview updates live. ` +
            'Paste an image or .gif URL under "Thumbnail & Image" for pictures/GIFs.',
          embeds: [embed],
          components,
          ephemeral: true,
        });
      }

      if (interaction.customId === 'panel:tempVcSettings') {
        const settings = tempVcStore.getSettings(interaction.guild.id);
        return interaction.reply({
          embeds: [buildTempVcSettingsEmbed(interaction.guild, settings)],
          components: buildTempVcSettingsComponents(settings),
          flags: MessageFlags.Ephemeral,
        });
      }

      if (interaction.customId === 'panel:toggleTempVcEnabled') {
        const current = tempVcStore.getSettings(interaction.guild.id);
        const settings = tempVcStore.setSettings(interaction.guild.id, { enabled: !current.enabled });
        return interaction.update({
          embeds: [buildTempVcSettingsEmbed(interaction.guild, settings)],
          components: buildTempVcSettingsComponents(settings),
        });
      }

      if (interaction.customId === 'panel:toggleTempVcRole') {
        const current = tempVcStore.getSettings(interaction.guild.id);
        const settings = tempVcStore.setSettings(interaction.guild.id, { autoRoleEnabled: !current.autoRoleEnabled });
        return interaction.update({
          embeds: [buildTempVcSettingsEmbed(interaction.guild, settings)],
          components: buildTempVcSettingsComponents(settings),
        });
      }

      if (interaction.customId === 'panel:toggleTempVcStatus') {
        const current = tempVcStore.getSettings(interaction.guild.id);
        const settings = tempVcStore.setSettings(interaction.guild.id, { autoStatusEnabled: !current.autoStatusEnabled });
        return interaction.update({
          embeds: [buildTempVcSettingsEmbed(interaction.guild, settings)],
          components: buildTempVcSettingsComponents(settings),
        });
      }

      // ---------- Invite Tracker ----------
      if (interaction.customId === 'panel:inviteTrackerSettings') {
        const settings = getGuildSettings(interaction.guild.id);
        const leaderboard = listInviteStats(interaction.guild.id);
        if (isOnV2DashboardMessage(interaction)) {
          return interaction.reply({
            embeds: [buildInviteTrackerSettingsEmbed(interaction.guild, settings, leaderboard)],
            components: buildInviteTrackerSettingsComponents(settings),
            flags: MessageFlags.Ephemeral,
          });
        }
        // "Cancel" from the Reset All Stats confirmation - internal navigation.
        return interaction.update({
          embeds: [buildInviteTrackerSettingsEmbed(interaction.guild, settings, leaderboard)],
          components: buildInviteTrackerSettingsComponents(settings),
        });
      }

      if (interaction.customId === 'panel:refreshInviteTracker') {
        const settings = getGuildSettings(interaction.guild.id);
        const leaderboard = listInviteStats(interaction.guild.id);
        return interaction.update({
          embeds: [buildInviteTrackerSettingsEmbed(interaction.guild, settings, leaderboard)],
          components: buildInviteTrackerSettingsComponents(settings),
        });
      }

      if (interaction.customId === 'panel:toggleInviteTracker') {
        const current = getGuildSettings(interaction.guild.id);
        setGuildSettings(interaction.guild.id, { inviteTrackerEnabled: !current.inviteTrackerEnabled });
        const settings = getGuildSettings(interaction.guild.id);
        const leaderboard = listInviteStats(interaction.guild.id);
        return interaction.update({
          embeds: [buildInviteTrackerSettingsEmbed(interaction.guild, settings, leaderboard)],
          components: buildInviteTrackerSettingsComponents(settings),
        });
      }

      if (interaction.customId === 'panel:toggleInviteLogRevokeButton') {
        const current = getGuildSettings(interaction.guild.id);
        setGuildSettings(interaction.guild.id, { inviteLogShowRevokeButton: !current.inviteLogShowRevokeButton });
        const settings = getGuildSettings(interaction.guild.id);
        const leaderboard = listInviteStats(interaction.guild.id);
        return interaction.update({
          embeds: [buildInviteTrackerSettingsEmbed(interaction.guild, settings, leaderboard)],
          components: buildInviteTrackerSettingsComponents(settings),
        });
      }

      if (interaction.customId === 'panel:inviteTracker:resetAllConfirm') {
        return interaction.update({
          embeds: [buildInviteTrackerResetConfirmEmbed()],
          components: buildInviteTrackerResetConfirmComponents(),
        });
      }

      if (interaction.customId === 'panel:inviteTracker:confirmResetAll') {
        resetAllInviteStats(interaction.guild.id);
        const settings = getGuildSettings(interaction.guild.id);
        return interaction.update({
          embeds: [buildInviteTrackerSettingsEmbed(interaction.guild, settings, [])],
          components: buildInviteTrackerSettingsComponents(settings),
        });
      }

      if (interaction.customId === 'panel:reactionApprovalSettings') {
        const settings = getGuildSettings(interaction.guild.id);
        return interaction.reply({
          embeds: [buildReactionApprovalSettingsEmbed(interaction.guild, settings)],
          components: buildReactionApprovalSettingsComponents(settings),
          flags: MessageFlags.Ephemeral,
        });
      }

      // ---------- Giveaways ----------
      if (interaction.customId === 'panel:giveawaySettings') {
        const settings = getGuildSettings(interaction.guild.id);
        const giveaways = listGiveaways(interaction.guild.id);
        const payload = {
          embeds: [buildGiveawaySettingsEmbed(interaction.guild, giveaways, settings)],
          components: buildGiveawaySettingsComponents(giveaways),
        };
        if (isOnV2DashboardMessage(interaction)) {
          return interaction.reply({ ...payload, flags: MessageFlags.Ephemeral });
        }
        // "Refresh", or the wizard's "Cancel" button (shares this customId) —
        // internal navigation within the same classic sub-panel message.
        return interaction.update(payload);
      }

      if (interaction.customId === 'panel:giveawayBackToList') {
        const settings = getGuildSettings(interaction.guild.id);
        const giveaways = listGiveaways(interaction.guild.id);
        return interaction.update({
          embeds: [buildGiveawaySettingsEmbed(interaction.guild, giveaways, settings)],
          components: buildGiveawaySettingsComponents(giveaways),
        });
      }

      if (interaction.customId === 'panel:giveawayCreateStart') {
        giveawayWizardStore.startSession(interaction.guild.id, interaction.user.id);
        return interaction.update({
          embeds: [buildGiveawayChannelStepEmbed()],
          components: buildGiveawayChannelStepComponents(),
        });
      }

      if (interaction.customId === 'panel:giveawayCustomizeButton') {
        const settings = getGuildSettings(interaction.guild.id);
        const modal = new ModalBuilder().setCustomId('panel:giveawayCustomizeButtonModal').setTitle('Customize Join Button');
        const labelInput = new TextInputBuilder()
          .setCustomId('label').setLabel('Button label').setStyle(TextInputStyle.Short)
          .setMaxLength(80).setRequired(true).setValue(settings.giveawayJoinButtonLabel || 'Join');
        const emojiInput = new TextInputBuilder()
          .setCustomId('emoji').setLabel('Button emoji (leave blank for none)').setStyle(TextInputStyle.Short)
          .setRequired(false).setValue(settings.giveawayJoinButtonEmoji || '');
        modal.addComponents(
          new ActionRowBuilder().addComponents(labelInput),
          new ActionRowBuilder().addComponents(emojiInput),
        );
        return interaction.showModal(modal);
      }

      // ---------- Giveaways: server-wide message template ----------
      if (interaction.customId === 'panel:giveawayTemplateSettings') {
        const settings = getGuildSettings(interaction.guild.id);
        return interaction.update({
          embeds: [buildGiveawayTemplateEmbed(interaction.guild, settings)],
          components: buildGiveawayTemplateComponents(),
        });
      }

      if (interaction.customId === 'panel:giveawayEditTemplateText') {
        const settings = getGuildSettings(interaction.guild.id);
        const modal = new ModalBuilder().setCustomId('panel:giveawayEditTemplateTextModal').setTitle('Edit Giveaway Message');
        const titleInput = new TextInputBuilder()
          .setCustomId('title').setLabel('Embed title').setStyle(TextInputStyle.Short)
          .setMaxLength(256).setRequired(false).setValue(settings.giveawayEmbedTitle || '');
        const descInput = new TextInputBuilder()
          .setCustomId('description').setLabel('Description (%placeholders% supported)').setStyle(TextInputStyle.Paragraph)
          .setMaxLength(2000).setRequired(false).setValue(settings.giveawayEmbedDescription || '');
        const footerInput = new TextInputBuilder()
          .setCustomId('footer').setLabel('Footer text').setStyle(TextInputStyle.Short)
          .setMaxLength(2048).setRequired(false).setValue(settings.giveawayEmbedFooter || '');
        const colorInput = new TextInputBuilder()
          .setCustomId('color').setLabel('Embed color hex (e.g. fee75c)').setStyle(TextInputStyle.Short)
          .setMaxLength(7).setRequired(false)
          .setValue(settings.giveawayEmbedColor != null ? settings.giveawayEmbedColor.toString(16).padStart(6, '0') : '');
        modal.addComponents(
          new ActionRowBuilder().addComponents(titleInput),
          new ActionRowBuilder().addComponents(descInput),
          new ActionRowBuilder().addComponents(footerInput),
          new ActionRowBuilder().addComponents(colorInput),
        );
        return interaction.showModal(modal);
      }

      if (interaction.customId === 'panel:giveawayEditTemplateImages') {
        const settings = getGuildSettings(interaction.guild.id);
        const modal = new ModalBuilder().setCustomId('panel:giveawayEditTemplateImagesModal').setTitle('Edit Giveaway Images');
        const thumbInput = new TextInputBuilder()
          .setCustomId('thumbnail').setLabel('Thumbnail image URL').setStyle(TextInputStyle.Short)
          .setRequired(false).setValue(settings.giveawayEmbedThumbnail || '');
        const imageInput = new TextInputBuilder()
          .setCustomId('image').setLabel('Main image URL').setStyle(TextInputStyle.Short)
          .setRequired(false).setValue(settings.giveawayEmbedImage || '');
        modal.addComponents(
          new ActionRowBuilder().addComponents(thumbInput),
          new ActionRowBuilder().addComponents(imageInput),
        );
        return interaction.showModal(modal);
      }

      if (interaction.customId === 'panel:giveawayTemplatePreview') {
        const settings = getGuildSettings(interaction.guild.id);
        // Sample data only — not a real stored giveaway, just enough shape
        // for buildGiveawayEmbed to render every placeholder meaningfully.
        const sampleGiveaway = {
          guildId: interaction.guild.id,
          token: 'gw-preview',
          prize: 'Nitro Classic (Sample)',
          winnerCount: 1,
          entries: ['1', '2', '3'],
          organiserId: interaction.user.id,
          status: 'active',
          endAt: Date.now() + 60 * 60 * 1000,
          winners: [],
        };
        return interaction.reply({
          content: '👁️ Preview — this is how a new giveaway will look with sample data:',
          embeds: [buildGiveawayEmbed(sampleGiveaway, settings, interaction.guild)],
          components: buildGiveawayButtons(sampleGiveaway, settings),
          flags: MessageFlags.Ephemeral,
        });
      }

      if (interaction.customId === 'panel:giveawayTemplateReset') {
        const settings = setGuildSettings(interaction.guild.id, {
          giveawayEmbedTitle: null,
          giveawayEmbedDescription: null,
          giveawayEmbedFooter: null,
          giveawayEmbedColor: null,
          giveawayEmbedThumbnail: null,
          giveawayEmbedImage: null,
        });
        return interaction.update({
          content: '🔄 Giveaway message template reset to default.',
          embeds: [buildGiveawayTemplateEmbed(interaction.guild, settings)],
          components: buildGiveawayTemplateComponents(),
        });
      }

      // Full bot-wide reset lives on the main panel (Page 1's "Reset to
      // Default" -> panel:resetSettings) — not duplicated here.

      if (interaction.customId.startsWith('panel:giveawayEndNow:')) {
        const token = interaction.customId.split(':')[2];
        const settings = getGuildSettings(interaction.guild.id);
        const giveaway = await finalizeGiveaway(interaction.client, token, settings);
        if (!giveaway) return interaction.update({ content: 'That giveaway no longer exists.', embeds: [], components: [] });
        return interaction.update({
          embeds: [buildGiveawayDetailEmbed(giveaway)],
          components: buildGiveawayDetailComponents(giveaway),
        });
      }

      if (interaction.customId.startsWith('panel:giveawayReroll:')) {
        const token = interaction.customId.split(':')[2];
        const settings = getGuildSettings(interaction.guild.id);
        const giveaway = await rerollGiveaway(interaction.client, token, settings);
        if (!giveaway) return interaction.update({ content: 'That giveaway no longer exists.', embeds: [], components: [] });
        return interaction.update({
          embeds: [buildGiveawayDetailEmbed(giveaway)],
          components: buildGiveawayDetailComponents(giveaway),
        });
      }

      if (interaction.customId.startsWith('panel:giveawayDeleteConfirm:')) {
        const token = interaction.customId.split(':')[2];
        const giveaway = getGiveaway(token);
        if (!giveaway) return interaction.update({ content: 'That giveaway no longer exists.', embeds: [], components: [] });
        return interaction.update({
          embeds: [buildGiveawayDeleteConfirmEmbed(giveaway)],
          components: buildGiveawayDeleteConfirmComponents(giveaway),
        });
      }

      if (interaction.customId.startsWith('panel:giveawayDeleteNo:')) {
        const token = interaction.customId.split(':')[2];
        const giveaway = getGiveaway(token);
        if (!giveaway) return interaction.update({ content: 'That giveaway no longer exists.', embeds: [], components: [] });
        return interaction.update({
          embeds: [buildGiveawayDetailEmbed(giveaway)],
          components: buildGiveawayDetailComponents(giveaway),
        });
      }

      if (interaction.customId.startsWith('panel:giveawayDeleteYes:')) {
        const token = interaction.customId.split(':')[2];
        const settings = getGuildSettings(interaction.guild.id);
        const giveaway = getGiveaway(token);
        if (giveaway) {
          deleteGiveaway(token);
          await syncGiveawayMessage(interaction.client, { ...giveaway, status: 'ended', winners: giveaway.winners || [] }, settings).catch(() => null);
        }
        const giveaways = listGiveaways(interaction.guild.id);
        return interaction.update({
          content: '🗑️ Giveaway deleted.',
          embeds: [buildGiveawaySettingsEmbed(interaction.guild, giveaways, settings)],
          components: buildGiveawaySettingsComponents(giveaways),
        });
      }

      if (interaction.customId === 'panel:toggleReactionApprovalEnabled') {
        const current = getGuildSettings(interaction.guild.id);
        const settings = setGuildSettings(interaction.guild.id, { reactionApprovalEnabled: !current.reactionApprovalEnabled });
        return interaction.update({
          embeds: [buildReactionApprovalSettingsEmbed(interaction.guild, settings)],
          components: buildReactionApprovalSettingsComponents(settings),
        });
      }

      if (interaction.customId === 'panel:editReactionApprovalConfig') {
        const settings = getGuildSettings(interaction.guild.id);
        const triggerType = settings.reactionApprovalTriggerType;

        if (!triggerType) {
          return interaction.reply({ content: 'Pick a trigger type from the dropdown first.', ephemeral: true });
        }

        const modal = new ModalBuilder()
          .setCustomId('panel:reactionApprovalConfigModal')
          .setTitle('Reaction Approval Config');

        const rows = [];

        if (triggerType === 'format') {
          const templateInput = new TextInputBuilder()
            .setCustomId('formatTemplate')
            .setLabel('Format template (Auto-React wildcards)')
            .setStyle(TextInputStyle.Paragraph)
            .setRequired(true)
            .setPlaceholder('Name: *\nDate: %\nTime: ^');
          if (settings.reactionApprovalFormatTemplate) templateInput.setValue(settings.reactionApprovalFormatTemplate);
          rows.push(new ActionRowBuilder().addComponents(templateInput));
        } else if (triggerType === 'keyword' || triggerType === 'image_keyword') {
          const keywordsInput = new TextInputBuilder()
            .setCustomId('keywords')
            .setLabel('Keywords (comma-separated, * % ^ ok)')
            .setStyle(TextInputStyle.Paragraph)
            .setRequired(true)
            .setPlaceholder('sale, discount, giveaway');
          if (settings.reactionApprovalKeywords?.length) keywordsInput.setValue(settings.reactionApprovalKeywords.join(', '));
          rows.push(new ActionRowBuilder().addComponents(keywordsInput));

          const matchModeInput = new TextInputBuilder()
            .setCustomId('matchMode')
            .setLabel('Match mode: type "any" or "all"')
            .setStyle(TextInputStyle.Short)
            .setRequired(true)
            .setPlaceholder('any')
            .setValue(settings.reactionApprovalMatchAll ? 'all' : 'any');
          rows.push(new ActionRowBuilder().addComponents(matchModeInput));
        }
        // 'any' and 'image' need no extra field beyond the 3 emojis below.

        const pendingInput = new TextInputBuilder()
          .setCustomId('pendingEmoji')
          .setLabel('Pending emoji (added while awaiting review)')
          .setStyle(TextInputStyle.Short)
          .setRequired(true)
          .setPlaceholder('e.g. ⏳');
        if (settings.reactionApprovalPendingEmoji?.raw) pendingInput.setValue(settings.reactionApprovalPendingEmoji.raw);
        rows.push(new ActionRowBuilder().addComponents(pendingInput));

        const approvedInput = new TextInputBuilder()
          .setCustomId('approvedEmoji')
          .setLabel('Approved emoji (added once approved)')
          .setStyle(TextInputStyle.Short)
          .setRequired(true)
          .setPlaceholder('e.g. ✅');
        if (settings.reactionApprovalApprovedEmoji?.raw) approvedInput.setValue(settings.reactionApprovalApprovedEmoji.raw);
        rows.push(new ActionRowBuilder().addComponents(approvedInput));

        const rejectedInput = new TextInputBuilder()
          .setCustomId('rejectedEmoji')
          .setLabel('Rejected emoji (invalid, or reviewer rejects)')
          .setStyle(TextInputStyle.Short)
          .setRequired(true)
          .setPlaceholder('e.g. ❌');
        if (settings.reactionApprovalRejectedEmoji?.raw) rejectedInput.setValue(settings.reactionApprovalRejectedEmoji.raw);
        rows.push(new ActionRowBuilder().addComponents(rejectedInput));

        // Discord modals cap out at 5 action rows - keyword mode uses all 5
        // (keywords + match mode + 3 emojis), format/any/image use fewer.
        modal.addComponents(...rows.slice(0, 5));
        return interaction.showModal(modal);
      }

      if (interaction.customId === 'panel:toggleAuditLog') {
        const current = getGuildSettings(interaction.guild.id);
        setGuildSettings(interaction.guild.id, { auditLogEnabled: !current.auditLogEnabled });
        const settings = getGuildSettings(interaction.guild.id);
        return interaction.update(buildPanelPayload(interaction.guild, settings));
      }

      if (interaction.customId === 'panel:checkUptime') {
        const readyUnix = Math.floor(interaction.client.readyTimestamp / 1000);
        return interaction.reply({
          content: `🟢 Online since <t:${readyUnix}:F> (<t:${readyUnix}:R>)`,
          ephemeral: true,
        });
      }

      if (interaction.customId === 'panel:powerOptions') {
        const settings = getGuildSettings(interaction.guild.id);
        if (isOnV2DashboardMessage(interaction)) {
          return interaction.reply({
            embeds: [buildPowerOptionsEmbed(interaction.guild, settings)],
            components: buildPowerOptionsComponents(settings),
            flags: MessageFlags.Ephemeral,
          });
        }
        // "Cancel" from Restart Confirm — internal navigation within the same
        // classic sub-panel message.
        return interaction.update({
          embeds: [buildPowerOptionsEmbed(interaction.guild, settings)],
          components: buildPowerOptionsComponents(settings),
        });
      }

      if (interaction.customId === 'panel:restartBot') {
        return interaction.update({
          embeds: [buildRestartConfirmEmbed()],
          components: buildRestartConfirmComponents(),
        });
      }

      if (interaction.customId === 'panel:confirmRestartBot') {
        await interaction.update({
          content: '🔁 Restarting now — should be back online in a few seconds.',
          embeds: [],
          components: [],
        });
        console.log(`[panel] Restart triggered by ${interaction.user.tag} (${interaction.user.id}) in guild ${interaction.guild.id}`);
        setRestartFlag({ triggeredBy: interaction.user.id, triggeredByTag: interaction.user.tag });
        // Small delay so the interaction response above actually reaches Discord
        // before the process exits. Exit code 1 signals run.js to respawn —
        // this only works if the bot was started via `node run.js` (see run.js).
        setTimeout(() => process.exit(1), 1000);
        return;
      }

      if (interaction.customId === 'panel:toggleBotEnabled') {
        const current = getGuildSettings(interaction.guild.id);
        const turningOn = current.botEnabled === false;
        setGuildSettings(interaction.guild.id, { botEnabled: turningOn });
        console.log(
          `[panel] Bot ${turningOn ? 'turned back ON' : 'turned OFF (maintenance mode)'} by ` +
          `${interaction.user.tag} (${interaction.user.id}) in guild ${interaction.guild.id}`,
        );
        const updated = getGuildSettings(interaction.guild.id);
        return interaction.update({
          embeds: [buildPowerOptionsEmbed(interaction.guild, updated)],
          components: buildPowerOptionsComponents(updated),
        });
      }

      if (interaction.customId === 'panel:resetSettings') {
        const settings = getGuildSettings(interaction.guild.id);
        return interaction.reply({
          embeds: [buildResetConfirmEmbed(interaction.guild, settings)],
          components: buildResetConfirmComponents(),
          flags: MessageFlags.Ephemeral,
        });
      }

      if (interaction.customId === 'panel:confirmReset') {
        resetEverythingForGuild(interaction.guild.id);
        return interaction.update({
          content: '✅ **Everything reset to default.** Every module\'s data for this server — settings, posted rosters/events, scheduled posts, autopost configs, warnings, stats, reaction-approval history, and giveaways — has been wiped. Run `/panel` again to see the refreshed dashboard.',
          embeds: [],
          components: [],
        });
      }

      if (interaction.customId === 'panel:backToMain') {
        if (isOnV2DashboardMessage(interaction)) {
          // Real "Back to Page 1" click from the V2 Page 2 dashboard.
          const settings = getGuildSettings(interaction.guild.id);
          return interaction.update(buildPanelPayload(interaction.guild, settings));
        }
        // Otherwise this is a "Back to Main Panel" button inside a classic
        // sub-panel that was opened as its own ephemeral reply — the
        // dashboard message itself is untouched and still open above, so
        // just close this one.
        await interaction.deferUpdate();
        return interaction.deleteReply();
      }

      if (interaction.customId === 'panel:page2') {
        if (isOnV2DashboardMessage(interaction)) {
          // Real "Next Page" click from the V2 Page 1 dashboard.
          const settings = getGuildSettings(interaction.guild.id);
          return interaction.update(buildPanelPage2Payload(interaction.guild, settings));
        }
        // Otherwise this is the "Back" button inside a classic sub-panel
        // (Reaction Approval / Stats Panel picker) that was opened as its own
        // ephemeral reply from Page 2 — Page 2 itself is untouched and still
        // open above, so just close this one.
        await interaction.deferUpdate();
        return interaction.deleteReply();
      }

      if (interaction.customId === 'panel:statsPanel') {
        if (isOnV2DashboardMessage(interaction)) {
          return interaction.reply({
            embeds: [buildStatsPanelPickerEmbed(interaction.guild)],
            components: buildStatsPanelPickerComponents(),
            flags: MessageFlags.Ephemeral,
          });
        }
        // "Back" from the Stats detail view — internal navigation within the
        // same classic sub-panel message, unaffected by the V2 dashboard.
        return interaction.update({
          embeds: [buildStatsPanelPickerEmbed(interaction.guild)],
          components: buildStatsPanelPickerComponents(),
        });
      }

      if (interaction.customId.startsWith('panel:statsPanel:clearConfirm:')) {
        const targetId = interaction.customId.split(':')[3];
        const targetUser = await interaction.client.users.fetch(targetId).catch(() => null);
        if (!targetUser) return interaction.reply({ content: 'Could not find that user.', ephemeral: true });
        return interaction.update({
          embeds: [buildStatsPanelClearConfirmEmbed(targetUser)],
          components: buildStatsPanelClearConfirmComponents(targetId),
        });
      }

      if (interaction.customId.startsWith('panel:statsPanel:clearExecute:')) {
        const targetId = interaction.customId.split(':')[3];
        const targetUser = await interaction.client.users.fetch(targetId).catch(() => null);
        clearUserStats(interaction.guild.id, targetId);
        const stats = getUserStats(interaction.guild.id, targetId);
        return interaction.update({
          content: targetUser ? `🗑️ Cleared **${targetUser.tag}**'s event history.` : '🗑️ Cleared that user\'s event history.',
          embeds: targetUser ? [buildStatsEmbed(targetUser, stats)] : [],
          components: targetUser ? buildStatsPanelDetailComponents(targetId) : buildStatsPanelPickerComponents(),
        });
      }

      if (interaction.customId.startsWith('panel:statsPanel:selectUser:')) {
        // "Back" from the clear-confirm screen without deleting anything.
        const targetId = interaction.customId.split(':')[3];
        const targetUser = await interaction.client.users.fetch(targetId).catch(() => null);
        if (!targetUser) return interaction.reply({ content: 'Could not find that user.', ephemeral: true });
        const stats = getUserStats(interaction.guild.id, targetId);
        return interaction.update({
          embeds: [buildStatsEmbed(targetUser, stats)],
          components: buildStatsPanelDetailComponents(targetId),
        });
      }

      if (interaction.customId === 'panel:autopostSettings' || interaction.customId === 'panel:refreshAutopostSettings') {
        const rosters = listAutopostRosters(interaction.guild.id);
        if (interaction.customId === 'panel:autopostSettings' && isOnV2DashboardMessage(interaction)) {
          return interaction.reply({
            embeds: [buildAutopostSettingsEmbed(interaction.guild, rosters)],
            components: buildAutopostSettingsComponents(rosters),
            flags: MessageFlags.Ephemeral,
          });
        }
        // Refresh button, or "Back" from within the classic Autopost
        // sub-panel's own detail/wizard screens — internal navigation.
        return interaction.update({
          embeds: [buildAutopostSettingsEmbed(interaction.guild, rosters)],
          components: buildAutopostSettingsComponents(rosters),
        });
      }

      if (interaction.customId === 'panel:addAutopost') {
        const session = autopostWizardStore.startSession(interaction.guild.id, interaction.user.id);
        return interaction.update({
          embeds: [buildAutopostChannelStepEmbed(session)],
          components: buildAutopostChannelStepComponents(session),
        });
      }

      if (interaction.customId.startsWith('panel:autopostEdit:')) {
        const token = interaction.customId.split(':')[2];
        const roster = getAutopostRoster(token);

        if (!roster) {
          const rosters = listAutopostRosters(interaction.guild.id);
          return interaction.update({
            content: 'That autopost no longer exists — it may have already been removed.',
            embeds: [buildAutopostSettingsEmbed(interaction.guild, rosters)],
            components: buildAutopostSettingsComponents(rosters),
          });
        }

        const session = autopostWizardStore.startSession(interaction.guild.id, interaction.user.id, {
          editingToken: token,
          channelId: roster.channelId,
          scheduleType: roster.scheduleType || 'daily',
          hour: roster.hour,
          titleRaw: roster.title || '',
          descriptionRaw: roster.description || '',
          categorySlotsRaw: `${roster.category || ''}, ${roster.mainSlots}, ${roster.subSlots}`,
          minuteLockRaw: roster.lockAfterMinutes != null ? `${roster.minute}, ${roster.lockAfterMinutes}` : `${roster.minute}`,
          thumbnailRaw: roster.thumbnail || '',
        });
        return interaction.update({
          embeds: [buildAutopostChannelStepEmbed(session)],
          components: buildAutopostChannelStepComponents(session),
        });
      }

      if (interaction.customId.startsWith('panel:autopostRemove:')) {
        const token = interaction.customId.split(':')[2];
        const roster = getAutopostRoster(token);

        if (!roster) {
          const rosters = listAutopostRosters(interaction.guild.id);
          return interaction.update({
            content: 'That autopost no longer exists — it may have already been removed.',
            embeds: [buildAutopostSettingsEmbed(interaction.guild, rosters)],
            components: buildAutopostSettingsComponents(rosters),
          });
        }

        return interaction.update({
          embeds: [buildAutopostResetConfirmEmbed(interaction.guild, roster)],
          components: buildAutopostResetConfirmComponents(token),
        });
      }

      if (interaction.customId.startsWith('panel:confirmResetAutopost:')) {
        const token = interaction.customId.split(':')[2];
        deleteAutopostRoster(token);
        const rosters = listAutopostRosters(interaction.guild.id);
        return interaction.update({
          content: '✅ Autopost config deleted — it will no longer post daily.',
          embeds: [buildAutopostSettingsEmbed(interaction.guild, rosters)],
          components: buildAutopostSettingsComponents(rosters),
        });
      }

      if (interaction.customId === 'panel:autopostWizard:skipChannel') {
        const session = autopostWizardStore.getSession(interaction.guild.id, interaction.user.id);
        if (!session || !session.channelId) {
          return interaction.reply({ content: 'No channel set yet — please select one.', ephemeral: true });
        }
        return interaction.update({
          embeds: [buildAutopostScheduleTypeStepEmbed(session)],
          components: buildAutopostScheduleTypeStepComponents(session),
        });
      }

      if (interaction.customId === 'panel:autopostWizard:skipScheduleType') {
        const session = autopostWizardStore.getSession(interaction.guild.id, interaction.user.id);
        if (!session || !session.scheduleType) {
          return interaction.reply({ content: 'No schedule type set yet — please select one.', ephemeral: true });
        }
        if (session.scheduleType === 'hourly') {
          return interaction.showModal(buildAutopostWizardModal(session));
        }
        return interaction.update({
          embeds: [buildAutopostHourStepEmbed(session)],
          components: buildAutopostHourStepComponents(session),
        });
      }

      if (interaction.customId === 'panel:autopostWizard:skipHour') {
        const session = autopostWizardStore.getSession(interaction.guild.id, interaction.user.id);
        if (!session || session.hour == null) {
          return interaction.reply({ content: 'No hour set yet — please select one.', ephemeral: true });
        }
        return interaction.showModal(buildAutopostWizardModal(session));
      }

      if (interaction.customId === 'panel:autopostWizard:cancel') {
        autopostWizardStore.endSession(interaction.guild.id, interaction.user.id);
        const rosters = listAutopostRosters(interaction.guild.id);
        return interaction.update({
          content: 'Cancelled — no changes made.',
          embeds: [buildAutopostSettingsEmbed(interaction.guild, rosters)],
          components: buildAutopostSettingsComponents(rosters),
        });
      }

      if (interaction.customId === 'panel:autoReactSettings' || interaction.customId === 'panel:refreshAutoReactSettings') {
        const rules = autoReactStore.listRules(interaction.guild.id);
        if (interaction.customId === 'panel:autoReactSettings' && isOnV2DashboardMessage(interaction)) {
          return interaction.reply({
            embeds: [buildAutoReactSettingsEmbed(interaction.guild, rules)],
            components: buildAutoReactSettingsComponents(rules),
            flags: MessageFlags.Ephemeral,
          });
        }
        // Refresh button, or "Back" from within the classic Auto-React
        // sub-panel's own detail/wizard screens — internal navigation.
        return interaction.update({
          embeds: [buildAutoReactSettingsEmbed(interaction.guild, rules)],
          components: buildAutoReactSettingsComponents(rules),
        });
      }

      if (interaction.customId === 'panel:addAutoReact') {
        const session = autoReactWizardStore.startSession(interaction.guild.id, interaction.user.id);
        return interaction.update({
          embeds: [buildAutoReactTriggerStepEmbed(session)],
          components: buildAutoReactTriggerStepComponents(),
        });
      }

      if (interaction.customId === 'panel:autoReactWizard:allChannels') {
        const session = autoReactWizardStore.updateSession(interaction.guild.id, interaction.user.id, { channelId: null });
        return interaction.showModal(buildAutoReactWizardModal(session));
      }

      if (interaction.customId === 'panel:autoReactWizard:cancel') {
        autoReactWizardStore.endSession(interaction.guild.id, interaction.user.id);
        const rules = autoReactStore.listRules(interaction.guild.id);
        return interaction.update({
          content: 'Cancelled — no changes made.',
          embeds: [buildAutoReactSettingsEmbed(interaction.guild, rules)],
          components: buildAutoReactSettingsComponents(rules),
        });
      }

      if (interaction.customId.startsWith('panel:autoReactRuleEdit:')) {
        const ruleId = interaction.customId.split(':')[2];
        const rules = autoReactStore.listRules(interaction.guild.id);
        const rule = rules.find((r) => r.id === ruleId);

        if (!rule) {
          return interaction.update({
            content: 'That rule no longer exists — it may have already been removed.',
            embeds: [buildAutoReactSettingsEmbed(interaction.guild, rules)],
            components: buildAutoReactSettingsComponents(rules),
          });
        }

        const session = autoReactWizardStore.startSession(interaction.guild.id, interaction.user.id, {
          editingId: rule.id,
          trigger: rule.trigger,
          matchAll: rule.matchAll,
          channelId: rule.channelId,
          emojisRaw: (rule.emojis || []).map((e) => e.raw).join(' '),
          keywordsRaw: (rule.keywords || []).join(', '),
        });
        return interaction.update({
          embeds: [buildAutoReactTriggerStepEmbed(session)],
          components: buildAutoReactTriggerStepComponents(),
        });
      }

      if (interaction.customId.startsWith('panel:autoReactRuleRemove:')) {
        const ruleId = interaction.customId.split(':')[2];
        const rules = autoReactStore.listRules(interaction.guild.id);
        const rule = rules.find((r) => r.id === ruleId);

        if (!rule) {
          return interaction.update({
            content: 'That rule no longer exists — it may have already been removed.',
            embeds: [buildAutoReactSettingsEmbed(interaction.guild, rules)],
            components: buildAutoReactSettingsComponents(rules),
          });
        }

        return interaction.update({
          embeds: [buildAutoReactRemoveConfirmEmbed(interaction.guild, rule)],
          components: buildAutoReactRemoveConfirmComponents(ruleId),
        });
      }

      if (interaction.customId.startsWith('panel:confirmRemoveAutoReact:')) {
        const ruleId = interaction.customId.split(':')[2];
        autoReactStore.removeRule(interaction.guild.id, ruleId);
        const rules = autoReactStore.listRules(interaction.guild.id);
        return interaction.update({
          content: '✅ Auto-react rule removed.',
          embeds: [buildAutoReactSettingsEmbed(interaction.guild, rules)],
          components: buildAutoReactSettingsComponents(rules),
        });
      }

      if (interaction.customId === 'panel:editWelcomeMsg') {
        const settings = getGuildSettings(interaction.guild.id);
        const modal = new ModalBuilder().setCustomId('panel:welcomeMsgModal').setTitle('Edit Welcome Message');
        const input = new TextInputBuilder()
          .setCustomId('message')
          .setLabel('Message ({user}, {server}, {memberCount})')
          .setStyle(TextInputStyle.Paragraph)
          .setValue(settings.welcomeMessage)
          .setRequired(true);
        modal.addComponents(new ActionRowBuilder().addComponents(input));
        return interaction.showModal(modal);
      }
    }

    // ---------- Dashboard: upcoming board title/color modal submit ----------
    if (interaction.isModalSubmit() && interaction.customId === 'panel:upcomingBoardTitleColorModal') {
      const title = interaction.fields.getTextInputValue('title').trim() || '📅 Upcoming Rosters';
      const colorRaw = interaction.fields.getTextInputValue('color').trim().replace(/^#/, '');
      const colorParsed = /^[0-9a-fA-F]{6}$/.test(colorRaw) ? parseInt(colorRaw, 16) : null;

      setGuildSettings(interaction.guild.id, {
        upcomingBoardTitle: title,
        ...(colorParsed !== null ? { upcomingBoardColor: colorParsed } : {}),
      });
      await refreshUpcomingBoard(interaction.client, interaction.guild.id).catch(() => null);

      if (colorRaw && colorParsed === null) {
        return interaction.reply({ content: 'Title updated, but that color wasn\'t a valid 6-digit hex code, so color was left as-is.', ephemeral: true });
      }
      return interaction.reply({ content: 'Board title/color updated.', ephemeral: true });
    }

    // ---------- Dashboard: upcoming board header/footer modal submit ----------
    if (interaction.isModalSubmit() && interaction.customId === 'panel:upcomingBoardTextModal') {
      const header = interaction.fields.getTextInputValue('header').trim();
      const footer = interaction.fields.getTextInputValue('footer').trim();

      setGuildSettings(interaction.guild.id, {
        upcomingBoardHeaderText: header || null,
        upcomingBoardFooterText: footer || null,
      });
      await refreshUpcomingBoard(interaction.client, interaction.guild.id).catch(() => null);
      return interaction.reply({ content: 'Board header/footer updated.', ephemeral: true });
    }

    // ---------- Dashboard: welcome message modal submit ----------
    if (interaction.isModalSubmit() && interaction.customId === 'panel:welcomeMsgModal') {
      const message = interaction.fields.getTextInputValue('message');
      setGuildSettings(interaction.guild.id, { welcomeMessage: message });
      return interaction.reply({ content: 'Welcome message updated.', ephemeral: true });
    }

    // ---------- Invite Tracker: bonus invites modal submit ----------
    if (interaction.isModalSubmit() && interaction.customId.startsWith('panel:inviteTracker:bonusModal:')) {
      const targetId = interaction.customId.split(':')[3];
      const raw = interaction.fields.getTextInputValue('amount').trim();
      const amount = Number.parseInt(raw, 10);

      if (!Number.isFinite(amount) || amount === 0) {
        return interaction.reply({ content: `"${raw}" isn't a non-zero whole number (e.g. 5 or -3).`, ephemeral: true });
      }

      const stats = addBonusInvites(interaction.guild.id, targetId, amount);
      return interaction.reply({
        content: `${amount > 0 ? 'Granted' : 'Removed'} ${Math.abs(amount)} bonus invite${Math.abs(amount) === 1 ? '' : 's'} ` +
          `${amount > 0 ? 'to' : 'from'} <@${targetId}>. They now have **${stats.total}** total (${stats.bonus >= 0 ? '+' : ''}${stats.bonus} bonus). ` +
          'Hit Refresh on the Invite Tracker panel to see the updated leaderboard.',
        ephemeral: true,
      });
    }

    // ---------- Dashboard: Reaction Approval format+emojis modal submit ----------
    if (interaction.isModalSubmit() && interaction.customId === 'panel:reactionApprovalConfigModal') {
      const currentSettings = getGuildSettings(interaction.guild.id);
      const triggerType = currentSettings.reactionApprovalTriggerType;

      const pendingRaw = interaction.fields.getTextInputValue('pendingEmoji');
      const approvedRaw = interaction.fields.getTextInputValue('approvedEmoji');
      const rejectedRaw = interaction.fields.getTextInputValue('rejectedEmoji');

      const [pendingEmoji] = parseEmojiList(pendingRaw);
      const [approvedEmoji] = parseEmojiList(approvedRaw);
      const [rejectedEmoji] = parseEmojiList(rejectedRaw);

      if (!pendingEmoji || !approvedEmoji || !rejectedEmoji) {
        return interaction.reply({ content: "I couldn't find an emoji in one of those fields — try again with a single emoji in each.", ephemeral: true });
      }

      const patch = {
        reactionApprovalPendingEmoji: pendingEmoji,
        reactionApprovalApprovedEmoji: approvedEmoji,
        reactionApprovalRejectedEmoji: rejectedEmoji,
      };
      let confirmationExtra = '';

      if (triggerType === 'format') {
        const formatTemplate = interaction.fields.getTextInputValue('formatTemplate').trim();
        if (!formatTemplate) {
          return interaction.reply({ content: "The format template can't be empty.", ephemeral: true });
        }
        patch.reactionApprovalFormatTemplate = formatTemplate;
        confirmationExtra = 'Format template updated. ';
      } else if (triggerType === 'keyword' || triggerType === 'image_keyword') {
        const keywordsRaw = interaction.fields.getTextInputValue('keywords');
        const keywords = keywordsRaw.split(',').map((k) => k.trim()).filter(Boolean);
        if (!keywords.length) {
          return interaction.reply({ content: "I couldn't find any keywords in that.", ephemeral: true });
        }
        const matchModeRaw = interaction.fields.getTextInputValue('matchMode').trim().toLowerCase();
        patch.reactionApprovalKeywords = keywords;
        patch.reactionApprovalMatchAll = matchModeRaw === 'all';
        confirmationExtra = `Keywords updated (${patch.reactionApprovalMatchAll ? 'ALL' : 'ANY'} mode). `;
      }
      // 'any' / 'image' need nothing beyond the 3 emojis, already in patch.

      const settings = setGuildSettings(interaction.guild.id, patch);

      return interaction.reply({
        content: `${confirmationExtra}Emojis: ${pendingEmoji.raw} pending, ${approvedEmoji.raw} approved, ${rejectedEmoji.raw} rejected.`,
        embeds: [buildReactionApprovalSettingsEmbed(interaction.guild, settings)],
        components: buildReactionApprovalSettingsComponents(settings),
        ephemeral: true,
      });
    }

    // ---------- Giveaways: creation wizard final popup submit ----------
    if (interaction.isModalSubmit() && interaction.customId === 'panel:giveawayCreateModal') {
      const session = giveawayWizardStore.getSession(interaction.guild.id, interaction.user.id);
      if (!session || !session.channelId) {
        return interaction.reply({
          content: 'That giveaway creation session expired — open Giveaways and press Create Giveaway again.',
          ephemeral: true,
        });
      }

      const prize = interaction.fields.getTextInputValue('prize').trim();
      const durationRaw = interaction.fields.getTextInputValue('duration').trim();
      const winnersRaw = interaction.fields.getTextInputValue('winners').trim();

      const durationMs = parseDuration(durationRaw);
      if (!durationMs) {
        return interaction.reply({
          content: `❌ Couldn't parse "${durationRaw}" as a duration. Try something like \`30m\`, \`2h\`, or \`1d12h\`.`,
          ephemeral: true,
        });
      }
      if (durationMs > MAX_GIVEAWAY_DURATION_MS) {
        return interaction.reply({
          content: '❌ Giveaways can\'t run longer than 30 days.',
          ephemeral: true,
        });
      }

      const winnerCount = parseInt(winnersRaw, 10);
      if (!Number.isInteger(winnerCount) || winnerCount < 1) {
        return interaction.reply({ content: '❌ Number of winners must be a whole number of 1 or more.', ephemeral: true });
      }
      if (winnerCount > 50) {
        return interaction.reply({ content: '❌ Giveaways can have at most 50 winners.', ephemeral: true });
      }

      const channel = await interaction.guild.channels.fetch(session.channelId).catch(() => null);
      if (!channel) {
        return interaction.reply({ content: "❌ That channel couldn't be found — it may have been deleted. Try again.", ephemeral: true });
      }

      const settings = getGuildSettings(interaction.guild.id);
      await createAndPostGiveaway({
        channel, guild: interaction.guild, settings, prize, winnerCount, durationMs, organiserId: interaction.user.id,
      });
      giveawayWizardStore.endSession(interaction.guild.id, interaction.user.id);

      const giveaways = listGiveaways(interaction.guild.id);
      return interaction.reply({
        content: `🎉 Giveaway for **${prize}** posted in ${channel} — ends in ${formatDuration(durationMs)} with ${winnerCount} winner(s).`,
        embeds: [buildGiveawaySettingsEmbed(interaction.guild, giveaways, settings)],
        components: buildGiveawaySettingsComponents(giveaways),
        ephemeral: true,
      });
    }

    // ---------- Giveaways: join-button customization submit ----------
    if (interaction.isModalSubmit() && interaction.customId === 'panel:giveawayCustomizeButtonModal') {
      const label = interaction.fields.getTextInputValue('label').trim();
      const emoji = interaction.fields.getTextInputValue('emoji').trim();

      if (!label) {
        return interaction.reply({ content: "❌ The button label can't be empty.", ephemeral: true });
      }

      const settings = setGuildSettings(interaction.guild.id, {
        giveawayJoinButtonLabel: label,
        giveawayJoinButtonEmoji: emoji || null,
      });

      const giveaways = listGiveaways(interaction.guild.id);
      return interaction.reply({
        content: `✅ Join button updated: ${emoji ? `${emoji} ` : ''}${label}. Active giveaway messages will pick this up next time they're updated (End/Reroll), or immediately for any new giveaway.`,
        embeds: [buildGiveawaySettingsEmbed(interaction.guild, giveaways, settings)],
        components: buildGiveawaySettingsComponents(giveaways),
        ephemeral: true,
      });
    }

    // ---------- Giveaways: message template text submit ----------
    if (interaction.isModalSubmit() && interaction.customId === 'panel:giveawayEditTemplateTextModal') {
      const title = interaction.fields.getTextInputValue('title').trim();
      const description = interaction.fields.getTextInputValue('description').trim();
      const footer = interaction.fields.getTextInputValue('footer').trim();
      const colorRaw = interaction.fields.getTextInputValue('color').trim().replace(/^#/, '');

      let color = null;
      if (colorRaw) {
        if (!/^[0-9a-fA-F]{6}$/.test(colorRaw)) {
          return interaction.reply({
            content: '❌ Color must be a 6-digit hex code, e.g. `fee75c` or `#fee75c`.',
            ephemeral: true,
          });
        }
        color = parseInt(colorRaw, 16);
      }

      const settings = setGuildSettings(interaction.guild.id, {
        giveawayEmbedTitle: title || null,
        giveawayEmbedDescription: description || null,
        giveawayEmbedFooter: footer || null,
        giveawayEmbedColor: color,
      });

      return interaction.reply({
        content: '✅ Giveaway message template updated. Active giveaways will pick this up next time they\'re updated (End/Reroll), or immediately for any new giveaway. Use Preview to check it.',
        embeds: [buildGiveawayTemplateEmbed(interaction.guild, settings)],
        components: buildGiveawayTemplateComponents(),
        ephemeral: true,
      });
    }

    // ---------- Giveaways: message template images submit ----------
    if (interaction.isModalSubmit() && interaction.customId === 'panel:giveawayEditTemplateImagesModal') {
      const thumbnail = interaction.fields.getTextInputValue('thumbnail').trim();
      const image = interaction.fields.getTextInputValue('image').trim();

      const isValidUrl = (url) => !url || /^https?:\/\/\S+$/i.test(url);
      if (!isValidUrl(thumbnail) || !isValidUrl(image)) {
        return interaction.reply({
          content: '❌ Image URLs must start with `http://` or `https://` (or leave the field blank to clear it).',
          ephemeral: true,
        });
      }

      const settings = setGuildSettings(interaction.guild.id, {
        giveawayEmbedThumbnail: thumbnail || null,
        giveawayEmbedImage: image || null,
      });

      return interaction.reply({
        content: '✅ Giveaway images updated. Use Preview to check them.',
        embeds: [buildGiveawayTemplateEmbed(interaction.guild, settings)],
        components: buildGiveawayTemplateComponents(),
        ephemeral: true,
      });
    }

    // ---------- Dashboard: auto-react wizard final popup submit ----------
    if (interaction.isModalSubmit() && interaction.customId === 'panel:autoReactWizardModal') {
      const session = autoReactWizardStore.getSession(interaction.guild.id, interaction.user.id);
      if (!session || !session.trigger) {
        return interaction.reply({
          content: 'That rule-building session expired — open Auto-React Settings and press Add Rule (or Edit) again.',
          ephemeral: true,
        });
      }

      const emojis = parseEmojiList(interaction.fields.getTextInputValue('emojis'));
      if (!emojis.length) {
        return interaction.reply({ content: "I couldn't find any emojis in that.", ephemeral: true });
      }

      let keywords = [];
      if (AUTOREACT_KEYWORD_TRIGGERS.has(session.trigger)) {
        // Field is TextInputStyle.Paragraph (multi-line), so users naturally
        // put one pattern per line - split on commas AND newlines, not just
        // commas, or a multi-line entry collapses into one unmatchable
        // keyword containing literal \n characters.
        keywords = interaction.fields.getTextInputValue('keywords').split(/[,\n]+/).map((k) => k.trim()).filter(Boolean);
        if (!keywords.length) {
          return interaction.reply({ content: "I couldn't find any keywords in that.", ephemeral: true });
        }
      }

      // "Editing" a rule is implemented as delete-old + create-new, since the
      // store only exposes addRule/removeRule (no in-place update) - the rule
      // gets a fresh id, which is fine, nothing else references rule ids
      // long-term.
      if (session.editingId) {
        autoReactStore.removeRule(interaction.guild.id, session.editingId);
      }

      const rule = autoReactStore.addRule(interaction.guild.id, {
        channelId: session.channelId || null,
        trigger: session.trigger,
        keywords,
        matchAll: session.matchAll,
        emojis,
        createdBy: interaction.user.id,
      });

      autoReactWizardStore.endSession(interaction.guild.id, interaction.user.id);

      return interaction.reply({
        content: `✅ ${session.editingId ? 'Updated' : 'Added'} rule: ${describeRule(rule, interaction.guild)}\n\n` +
          'Open `/panel` → Auto-React Settings again to see the updated list.',
        ephemeral: true,
      });
    }

    // ---------- Dashboard: autopost wizard final popup submit ----------
    if (interaction.isModalSubmit() && interaction.customId === 'panel:autopostWizardModal') {
      const session = autopostWizardStore.getSession(interaction.guild.id, interaction.user.id);
      const scheduleType = session?.scheduleType === 'hourly' ? 'hourly' : 'daily';
      const missingHour = scheduleType === 'daily' && session?.hour == null;

      if (!session || !session.channelId || missingHour) {
        return interaction.reply({
          content: 'That autopost setup session expired — open Autopost Settings and press Add Autopost (or Edit) again.',
          ephemeral: true,
        });
      }

      const channel = await interaction.guild.channels.fetch(session.channelId).catch(() => null);
      if (!channel) {
        autopostWizardStore.endSession(interaction.guild.id, interaction.user.id);
        return interaction.reply({ content: "That channel no longer exists — please start over from Autopost Settings.", ephemeral: true });
      }

      const title = interaction.fields.getTextInputValue('title').trim();
      if (!title) {
        return interaction.reply({ content: 'Title is required.', ephemeral: true });
      }
      const description = interaction.fields.getTextInputValue('description').trim();

      // "Category, Main slots, Sub slots" — merged into one field so the
      // modal (capped at 5 inputs) has room for the Thumbnail field below.
      const [categoryRaw, mainRaw, subRaw] = interaction.fields.getTextInputValue('categorySlots').split(',').map((s) => s.trim());
      const category = categoryRaw || '';
      const mainSlots = Math.max(1, parseInt(mainRaw, 10) || 10);
      const subSlots = Math.max(0, parseInt(subRaw, 10) || 0);

      // "Minute (0-59), Lock-after mins" — one field so minute can be any
      // value 0-59 (a dropdown tops out at 25 options, not enough for 60
      // minutes) while keeping the modal at 5 fields total.
      const [minuteRaw, lockAfterRaw] = interaction.fields.getTextInputValue('minuteLock').split(',').map((s) => s.trim());
      const minute = Math.min(59, Math.max(0, parseInt(minuteRaw, 10) || 0));
      const lockAfterOverride = !lockAfterRaw ? null : Math.max(0, parseInt(lockAfterRaw, 10) || 0);

      // Per-roster override, falling back to the server default set via
      // /roster-lock-time, same as the original /event autopost create command.
      const guildSettings = getGuildSettings(interaction.guild.id);
      const lockAfterMinutes = lockAfterOverride ?? guildSettings.rosterAutoLockMinutes ?? 15;

      const thumbnailRaw = interaction.fields.getTextInputValue('thumbnail').trim();
      const thumbnail = thumbnailRaw || null;

      const scheduleDescription = scheduleType === 'hourly'
        ? `every hour at :${String(minute).padStart(2, '0')}`
        : `daily at ${String(session.hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;

      const rosterPatch = {
        channelId: channel.id,
        title,
        description,
        category,
        mainSlots,
        subSlots,
        scheduleType,
        hour: scheduleType === 'daily' ? session.hour : null,
        minute,
        lockAfterMinutes,
        thumbnail,
      };

      // Editing patches the existing roster in place (preserves hostId/hostTag/
      // lastPostedDate/lastPostedHourKey); creating writes a brand-new token.
      // Switching schedule type clears the other type's "already posted"
      // tracker so the new schedule fires on its own next tick instead of
      // being blocked by a stale guard from the old type.
      if (session.editingToken) {
        const updated = updateAutopostRoster(session.editingToken, {
          ...rosterPatch,
          ...(scheduleType === 'hourly' ? { lastPostedHourKey: null } : { lastPostedDate: null }),
        });

        if (!updated) {
          autopostWizardStore.endSession(interaction.guild.id, interaction.user.id);
          return interaction.reply({ content: 'That autopost no longer exists — it may have already been removed.', ephemeral: true });
        }
      } else {
        const autopostToken = `autopost-${Date.now()}-${interaction.user.id}`;
        saveAutopostRoster(autopostToken, {
          guildId: interaction.guild.id,
          hostId: interaction.user.id,
          hostTag: interaction.user.tag,
          ...rosterPatch,
          lastPostedDate: null, // set once the scheduler posts it the first time
          lastPostedHourKey: null,
        });
      }

      const wasEditing = Boolean(session.editingToken);
      autopostWizardStore.endSession(interaction.guild.id, interaction.user.id);

      // Roster schedule/details just changed — update the board now instead
      // of waiting for the next periodic refresh.
      await refreshUpcomingBoard(interaction.client, interaction.guild.id).catch(() => null);

      return interaction.reply({
        content: `✅ ${wasEditing ? 'Updated' : 'Created'} "${title}" — posts in ${channel} ${scheduleDescription} London time.\n\n` +
          'Open `/panel` → Autopost Settings to see it.',
        ephemeral: true,
      });
    }

  // ---------- Levels modals ----------
      if (interaction.isModalSubmit() && interaction.customId === 'panel:levelModalMsg') {
        const minRaw = interaction.fields.getTextInputValue('min_xp').trim();
        const maxRaw = interaction.fields.getTextInputValue('max_xp').trim();
        const min = parseInt(minRaw, 10);
        const max = parseInt(maxRaw, 10);
        if (!Number.isInteger(min) || !Number.isInteger(max) || min < 0 || max < min) {
          return interaction.reply({ content: '❌ Invalid range — use whole numbers with maximum ≥ minimum ≥ 0.', ephemeral: true });
        }
        updateLevelSettings(interaction.guild.id, { xpPerMessage: { min, max } });
        const settings = getLevelSettings(interaction.guild.id);
        return interaction.reply({
          content: `✅ Message XP set to **${min}–${max}** per message.`,
          embeds: [buildLevelXpSettingsEmbed(interaction.guild, settings)],
          components: buildLevelXpSettingsComponents(settings),
          ephemeral: true,
        });
      }

      if (interaction.isModalSubmit() && interaction.customId === 'panel:levelModalCooldown') {
        const secRaw = interaction.fields.getTextInputValue('cooldown_sec').trim();
        const sec = parseInt(secRaw, 10);
        if (!Number.isInteger(sec) || sec < 0) {
          return interaction.reply({ content: '❌ Cooldown must be a whole number of seconds of 0 or more.', ephemeral: true });
        }
        updateLevelSettings(interaction.guild.id, { cooldownMs: sec * 1000 });
        const settings = getLevelSettings(interaction.guild.id);
        return interaction.reply({
          content: `✅ XP cooldown set to **${sec}s**.`,
          embeds: [buildLevelXpSettingsEmbed(interaction.guild, settings)],
          components: buildLevelXpSettingsComponents(settings),
          ephemeral: true,
        });
      }

      if (interaction.isModalSubmit() && interaction.customId === 'panel:levelModalVoice') {
        const voiceRaw = interaction.fields.getTextInputValue('voice_xp').trim();
        const voice = parseInt(voiceRaw, 10);
        if (!Number.isInteger(voice) || voice < 0) {
          return interaction.reply({ content: '❌ Voice XP must be a whole number of 0 or more.', ephemeral: true });
        }
        updateLevelSettings(interaction.guild.id, { xpPerVoiceMin: voice });
        const settings = getLevelSettings(interaction.guild.id);
        return interaction.reply({
          content: `✅ Voice XP set to **${voice}** per minute.`,
          embeds: [buildLevelXpSettingsEmbed(interaction.guild, settings)],
          components: buildLevelXpSettingsComponents(settings),
          ephemeral: true,
        });
      }

      if (interaction.isModalSubmit() && interaction.customId === 'panel:levelModalReact') {
        const reactRaw = interaction.fields.getTextInputValue('react_xp').trim();
        const cmdRaw = interaction.fields.getTextInputValue('cmd_xp').trim();
        const react = parseInt(reactRaw, 10);
        const cmd = parseInt(cmdRaw, 10);
        if (!Number.isInteger(react) || !Number.isInteger(cmd) || react < 0 || cmd < 0) {
          return interaction.reply({ content: '❌ XP values must be whole numbers of 0 or more.', ephemeral: true });
        }
        updateLevelSettings(interaction.guild.id, { xpPerReaction: react, xpPerCommand: cmd });
        const settings = getLevelSettings(interaction.guild.id);
        return interaction.reply({
          content: `✅ Reaction XP set to **${react}**, command XP set to **${cmd}**.`,
          embeds: [buildLevelXpSettingsEmbed(interaction.guild, settings)],
          components: buildLevelXpSettingsComponents(settings),
          ephemeral: true,
        });
      }

      if (interaction.isModalSubmit() && interaction.customId === 'panel:levelModalAdd') {
        const numRaw = interaction.fields.getTextInputValue('lvl_num').trim();
        const name = interaction.fields.getTextInputValue('lvl_name').trim();
        const xpRaw = interaction.fields.getTextInputValue('lvl_xp').trim();
        const roleRaw = interaction.fields.getTextInputValue('lvl_role').trim();

        const level = parseInt(numRaw, 10);
        const xpRequired = parseInt(xpRaw, 10);
        if (!Number.isInteger(level) || level < 1 || !name || !Number.isInteger(xpRequired) || xpRequired < 1) {
          return interaction.reply({
            content: '❌ Level number must be 1+, name can\'t be empty, and XP required must be 1+.',
            ephemeral: true,
          });
        }
        if (roleRaw && !/^[0-9]{17,20}$/.test(roleRaw)) {
          return interaction.reply({ content: '❌ That doesn\'t look like a valid role ID — leave the field blank for no role.', ephemeral: true });
        }

        setLevelDefinition(interaction.guild.id, level, name, xpRequired, roleRaw || null);
        const defs = getLevelDefinitions(interaction.guild.id);
        return interaction.reply({
          content: `✅ Level **${level} — ${name}** added (requires ${xpRequired} XP${roleRaw ? `, role <@&${roleRaw}>` : ''}).`,
          embeds: [buildLevelManagerEmbed(interaction.guild, defs)],
          components: buildLevelManagerComponents(defs),
          ephemeral: true,
        });
      }

      if (interaction.isModalSubmit() && interaction.customId.startsWith('panel:levelModalEdit:')) {
        const level = parseInt(interaction.customId.split(':')[2], 10);
        const name = interaction.fields.getTextInputValue('lvl_name').trim();
        const xpRaw = interaction.fields.getTextInputValue('lvl_xp').trim();
        const roleRaw = interaction.fields.getTextInputValue('lvl_role').trim();

        const xpRequired = parseInt(xpRaw, 10);
        if (!name || !Number.isInteger(xpRequired) || xpRequired < 1) {
          return interaction.reply({ content: '❌ Name can\'t be empty and XP required must be 1+.', ephemeral: true });
        }
        if (roleRaw && !/^[0-9]{17,20}$/.test(roleRaw)) {
          return interaction.reply({ content: '❌ That doesn\'t look like a valid role ID — leave the field blank for no role.', ephemeral: true });
        }

        setLevelDefinition(interaction.guild.id, level, name, xpRequired, roleRaw || null);
        const defs = getLevelDefinitions(interaction.guild.id);
        return interaction.reply({
          content: `✅ Level **${level}** updated to "${name}" (${xpRequired} XP).`,
          embeds: [buildLevelManagerEmbed(interaction.guild, defs)],
          components: buildLevelManagerComponents(defs),
          ephemeral: true,
        });
      }

  return false;
}

module.exports = { handlePanelInteraction };
