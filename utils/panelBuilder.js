const {
  EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle,
  ChannelSelectMenuBuilder, RoleSelectMenuBuilder, StringSelectMenuBuilder, UserSelectMenuBuilder, ChannelType,
  ContainerBuilder, SectionBuilder, TextDisplayBuilder, ThumbnailBuilder,
  SeparatorBuilder, SeparatorSpacingSize, MessageFlags,
} = require('discord.js');
const { describeRule } = require('./autoReactMatcher');
const { PREMIUM_COLORS, toSmallCaps } = require('./theme');

// ---------- Page 1 (main dashboard) ----------
// Built with Components V2 (ContainerBuilder + friends) instead of a classic
// embed. Requires discord.js v14.17+ and MUST be sent/edited with
// `flags: MessageFlags.IsComponentsV2` and NO `embeds` array — see
// buildPanelPayload() below, which bundles both correctly. Once a message is
// first sent as V2 it can only ever be edited as V2 again (the flag can't be
// removed later), so every place that sends/updates this message — including
// the /panel slash command's initial reply — must use buildPanelPayload().
function buildPanelContainer(guild, settings, flashMessage) {
  const set = (v) => (v ? '✅' : '⚪');
  const iconUrl = guild.iconURL({ size: 128 }) || null;

  const container = new ContainerBuilder().setAccentColor(PREMIUM_COLORS.dash);
  const divider = () => new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small);

  // Optional one-off confirmation banner (e.g. "Settings reset to default.").
  // V2 messages can't mix a top-level `content` string with V2 components,
  // so this is how call sites surface a quick confirmation instead.
  if (flashMessage) {
    container.addTextDisplayComponents(new TextDisplayBuilder().setContent(`✅ ${flashMessage}`));
    container.addSeparatorComponents(divider());
  }

  // Header — clean card: server name large, small-caps eyebrow, faint
  // helper line. Icon pinned to the right.
  const headerText = new TextDisplayBuilder().setContent(
    `# ${guild.name}\n### ${toSmallCaps('Server dashboard')}\n-# Core settings below · all modules live on Page 2`,
  );
  if (iconUrl) {
    const header = new SectionBuilder()
      .addTextDisplayComponents(headerText)
      .setThumbnailAccessory(new ThumbnailBuilder().setURL(iconUrl).setDescription(`${guild.name} icon`));
    container.addSectionComponents(header);
  } else {
    container.addTextDisplayComponents(headerText);
  }

  container.addSeparatorComponents(divider());

  // Core settings — one trimmed status line per setting, then the pickers.
  // Mod Roles moved to Page 2 to free a row for Audit Log controls (Discord max 5 rows).
  const modRoles = settings.modRoleIds?.length ? settings.modRoleIds.map(id => `<@&${id}>`).join(' ') : null;
  container.addTextDisplayComponents(
    new TextDisplayBuilder().setContent(
      `${set(settings.welcomeChannelId)} **Welcome** — ${settings.welcomeChannelId ? `<#${settings.welcomeChannelId}>` : 'Not set'}\n` +
      `${set(settings.logChannelId)} **Logging** — ${settings.logChannelId ? `<#${settings.logChannelId}>` : 'Not set'}\n` +
      `${set(settings.auditLogEnabled)} **Audit Log** — ${settings.auditLogEnabled ? (settings.auditLogChannelId ? `<#${settings.auditLogChannelId}>` : 'Enabled (no channel)') : 'Disabled'}\n` +
      `${set(modRoles)} **Mod Roles** — ${modRoles || 'Not set (see Page 2)'}`,
    ),
  );

  container.addActionRowComponents(
    new ActionRowBuilder().addComponents(
      new ChannelSelectMenuBuilder()
        .setCustomId('panel:setWelcomeChannel')
        .setPlaceholder('Welcome channel')
        .addChannelTypes(ChannelType.GuildText),
    ),
    new ActionRowBuilder().addComponents(
      new ChannelSelectMenuBuilder()
        .setCustomId('panel:setLogChannel')
        .setPlaceholder('Mod-log channel')
        .addChannelTypes(ChannelType.GuildText),
    ),
    new ActionRowBuilder().addComponents(
      new ChannelSelectMenuBuilder()
        .setCustomId('panel:setAuditLogChannel')
        .setPlaceholder('Audit log channel')
        .addChannelTypes(ChannelType.GuildText),
    ),
  );

  container.addSeparatorComponents(divider());

  container.addTextDisplayComponents(
    new TextDisplayBuilder().setContent(
      settings.welcomeEmbedDraft
        ? `${set(true)} **Welcome Message** — using a custom rich embed · edit it via the Welcome module on Page 2`
        : `${set(settings.welcomeMessage)} **Welcome Message**\n\`\`\`\n${settings.welcomeMessage}\n\`\`\``,
    ),
  );

  container.addSeparatorComponents(divider());

  // Navigation + controls + danger live on their own dedicated rows at the
  // bottom of every dashboard page so module buttons never share a row with them.
  container.addActionRowComponents(
    new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId('panel:page2').setLabel('All Modules').setEmoji('➡️').setStyle(ButtonStyle.Secondary),
      new ButtonBuilder()
        .setCustomId('panel:toggleAuditLog')
        .setLabel(settings.auditLogEnabled ? 'Audit Log: ON' : 'Audit Log: OFF')
        .setEmoji('📋')
        .setStyle(settings.auditLogEnabled ? ButtonStyle.Success : ButtonStyle.Secondary),
    ),
    new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId('panel:resetSettings').setLabel('Reset').setEmoji('♻️').setStyle(ButtonStyle.Danger),
      new ButtonBuilder().setCustomId('panel:powerOptions').setLabel('Power').setEmoji('🔌').setStyle(ButtonStyle.Danger),
    ),
  );

  container.addTextDisplayComponents(
    new TextDisplayBuilder().setContent('-# Page 1/2 · Core settings · tip: use `/event create` for signup rosters'),
  );

  return container;
}

// Bundles the container + the required V2 flag into one payload object so
// call sites can just do `interaction.update(buildPanelPayload(...))` —
// no separate `embeds`/`components` keys to remember, and no risk of
// forgetting the flag.
function buildPanelPayload(guild, settings, flashMessage) {
  return {
    content: '',
    embeds: [],
    components: [buildPanelContainer(guild, settings, flashMessage)],
    flags: MessageFlags.IsComponentsV2,
  };
}

// ---------- Page 2 (opened via the "Next Page" button on the main dashboard) ----------
// Main dashboard's 5 action rows were already full (3 select-menu rows + 2
// five-button rows), so Temp Voice Channels moved here to make room for
// "Next Page", alongside the new Stats admin panel.
// ---------- Page 2 ----------
// Same Components V2 approach as Page 1 — see buildPanelPayload's comment
// above for the flag/embeds rules. Use buildPanelPage2Payload() everywhere
// this page is sent or updated.
function buildPanelPage2Container(guild, settings) {
  const set = (v) => (v ? '✅' : '⚪');
  const container = new ContainerBuilder().setAccentColor(PREMIUM_COLORS.dash);
  const divider = () => new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small);

  container.addTextDisplayComponents(
    new TextDisplayBuilder().setContent(
      `# ${guild.name}\n### ${toSmallCaps('Server dashboard')} · All Modules\n-# Jump into any module below · back to Page 1 for core settings`,
    ),
  );

  container.addSeparatorComponents(divider());

  container.addTextDisplayComponents(new TextDisplayBuilder().setContent('### 🧩 Modules'));

  const rowA = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('panel:roleRequestSettings').setLabel('Role Requests').setEmoji('🎫').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId('panel:ticketSettings').setLabel('Tickets').setEmoji('🎟️').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId('panel:welcomeSettings').setLabel('Welcome').setEmoji('👋').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId('panel:autoReactSettings').setLabel('Auto-React').setEmoji('🔁').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId('panel:upcomingBoardSettings').setLabel('Upcoming').setEmoji('📅').setStyle(ButtonStyle.Secondary),
  );
  const rowB = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('panel:giveawaySettings').setLabel('Giveaways').setEmoji('🎉').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId('panel:reactionApprovalSettings').setLabel('Reaction Approval').setEmoji('✅').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId('panel:autopostSettings').setLabel('Autopost').setEmoji('🗓️').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId('panel:openEmbedBuilder').setLabel('Embed Builder').setEmoji('🧩').setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId('panel:inviteTrackerSettings').setLabel('Invite Tracker').setEmoji('📨').setStyle(ButtonStyle.Secondary),
  );
  const rowC = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('panel:levelSystem').setLabel('Levels').setEmoji('✨').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId('panel:tempVcSettings').setLabel('Temp Voice').setEmoji('🔊').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId('panel:statsPanel').setLabel('Stats').setEmoji('📊').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId('panel:botConfig').setLabel('Bot Config').setEmoji('🤖').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId('panel:help').setLabel('Help').setEmoji('📚').setStyle(ButtonStyle.Secondary),
  );
  container.addActionRowComponents(rowA, rowB, rowC);

  container.addSeparatorComponents(divider());

  container.addTextDisplayComponents(new TextDisplayBuilder().setContent('### ⚙️ Core Settings'));

  const modRoles = settings.modRoleIds?.length ? settings.modRoleIds.map(id => `<@&${id}>`).join(' ') : null;
  container.addTextDisplayComponents(
    new TextDisplayBuilder().setContent(
      `${set(modRoles)} **Mod Roles** — ${modRoles || 'Not set'}`,
    ),
  );

  container.addActionRowComponents(
    new ActionRowBuilder().addComponents(
      new RoleSelectMenuBuilder()
        .setCustomId('panel:setModRoles')
        .setPlaceholder('Mod roles')
        .setMinValues(1)
        .setMaxValues(5),
    ),
  );

  container.addSeparatorComponents(divider());

  // Same footer block as Page 1 — navigation and danger on their own rows.
  container.addActionRowComponents(
    new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId('panel:backToMain').setLabel('Back to Page 1').setEmoji('⬅️').setStyle(ButtonStyle.Secondary),
    ),
    new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId('panel:resetSettings').setLabel('Reset').setEmoji('♻️').setStyle(ButtonStyle.Danger),
      new ButtonBuilder().setCustomId('panel:powerOptions').setLabel('Power').setEmoji('🔌').setStyle(ButtonStyle.Danger),
    ),
  );

  container.addTextDisplayComponents(
    new TextDisplayBuilder().setContent('-# Page 2/2 · All modules'),
  );

  return container;
}

function buildPanelPage2Payload(guild, settings) {
  return {
    embeds: [],
    components: [buildPanelPage2Container(guild, settings)],
    flags: MessageFlags.IsComponentsV2,
  };
}

// ---------- Reaction Approval sub-panel ----------
// Messages posted in reactionApprovalSourceChannelId are checked against a
// rule determined by reactionApprovalTriggerType (see db.js). Valid ones get
// reactionApprovalPendingEmoji + a review request in reactionApprovalChannelId;
// invalid ones just get reactionApprovalRejectedEmoji. See
// events/messageCreate.js and the `reactionapproval:` handlers in
// events/interactionCreate.js.
const REACTION_APPROVAL_TRIGGER_LABELS = {
  any: 'Any message',
  image: 'Has image/attachment',
  keyword: 'Contains keyword(s)',
  image_keyword: 'Image + keyword(s)',
  format: 'Format template (custom)',
};

function buildReactionApprovalSettingsEmbed(guild, settings) {
  const enabled = settings.reactionApprovalEnabled === true;
  const pending = settings.reactionApprovalPendingEmoji;
  const approved = settings.reactionApprovalApprovedEmoji;
  const rejected = settings.reactionApprovalRejectedEmoji;
  const triggerType = settings.reactionApprovalTriggerType;
  const template = settings.reactionApprovalFormatTemplate;
  const keywords = settings.reactionApprovalKeywords || [];

  let criteriaLine;
  if (!triggerType) {
    criteriaLine = '**Match criteria:** Not set — pick a trigger type below.';
  } else if (triggerType === 'format') {
    criteriaLine = `**Match criteria (format template):**\n${template ? `\`\`\`\n${template}\n\`\`\`` : 'Not set'}`;
  } else if (triggerType === 'keyword' || triggerType === 'image_keyword') {
    const modeLabel = settings.reactionApprovalMatchAll ? 'ALL of' : 'ANY of';
    criteriaLine = `**Match criteria:** ${REACTION_APPROVAL_TRIGGER_LABELS[triggerType]} — ${modeLabel}: ${keywords.length ? keywords.join(' | ') : 'Not set'}`;
  } else {
    criteriaLine = `**Match criteria:** ${REACTION_APPROVAL_TRIGGER_LABELS[triggerType]}`;
  }

  return new EmbedBuilder()
    .setColor(enabled ? PREMIUM_COLORS.success : PREMIUM_COLORS.muted)
    .setTitle('✅ Reaction Approval')
    .setDescription(
      'Messages posted in the **Source Channel** are checked against the match criteria below. ' +
      'If they match, the bot reacts with the **Pending Emoji** and sends a review request to the **Approval Channel**. ' +
      'If they don\'t match, the bot just reacts with the **Rejected Emoji**.\n\n' +
      'When an HC/Admin reviews the request, the bot swaps the Pending reaction for the **Approved Emoji** (or the ' +
      '**Rejected Emoji** if they reject it).\n\n' +
      'Reviewing uses the same permission as Role Requests: your configured **Mod Roles** (Dashboard page 1), or ' +
      'Manage Roles if none are set.\n\n' +
      criteriaLine,
    )
    .addFields(
      { name: 'Status', value: enabled ? '🟢 Enabled' : '🔴 Disabled', inline: true },
      { name: 'Source Channel', value: settings.reactionApprovalSourceChannelId ? `<#${settings.reactionApprovalSourceChannelId}>` : 'Not set', inline: true },
      { name: 'Approval Channel', value: settings.reactionApprovalChannelId ? `<#${settings.reactionApprovalChannelId}>` : 'Not set', inline: true },
      { name: 'Pending Emoji', value: pending ? pending.raw : 'Not set', inline: true },
      { name: 'Approved Emoji', value: approved ? approved.raw : 'Not set', inline: true },
      { name: 'Rejected Emoji', value: rejected ? rejected.raw : 'Not set', inline: true },
    )
    .setFooter({ text: 'Only visible to you.' });
}

function buildReactionApprovalSettingsComponents(settings) {
  const enabled = settings.reactionApprovalEnabled === true;
  const triggerType = settings.reactionApprovalTriggerType;

  const row1 = new ActionRowBuilder().addComponents(
    new ChannelSelectMenuBuilder()
      .setCustomId('panel:setReactionApprovalSourceChannel')
      .setPlaceholder('Select source channel (where submissions are posted)')
      .addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement),
  );

  const row2 = new ActionRowBuilder().addComponents(
    new ChannelSelectMenuBuilder()
      .setCustomId('panel:setReactionApprovalChannel')
      .setPlaceholder('Select approval channel')
      .addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement),
  );

  const row3 = new ActionRowBuilder().addComponents(
    new StringSelectMenuBuilder()
      .setCustomId('panel:setReactionApprovalTriggerType')
      .setPlaceholder('Select trigger type')
      .addOptions(
        Object.entries(REACTION_APPROVAL_TRIGGER_LABELS).map(([value, label]) => ({
          label,
          value,
          default: value === triggerType,
        })),
      ),
  );

  const row4 = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('panel:editReactionApprovalConfig').setLabel('Configure Trigger & Emojis').setEmoji('✏️').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId('panel:toggleReactionApprovalEnabled')
      .setLabel(enabled ? 'Disable Feature' : 'Enable Feature')
      .setEmoji(enabled ? '🔴' : '🟢')
      .setStyle(enabled ? ButtonStyle.Danger : ButtonStyle.Success),
    new ButtonBuilder().setCustomId('panel:page2').setLabel('Back').setEmoji('⬅️').setStyle(ButtonStyle.Secondary),
  );

  return [row1, row2, row3, row4];
}

// ---------- Giveaways ----------
// Public-facing giveaway messages (embed/buttons posted in a guild channel)
// live in utils/giveawayBuilder.js — these are the admin-only /panel screens
// for creating and managing them. Business logic (drawing winners, ending,
// rerolling) lives in utils/giveawayManager.js, shared with /giveaway's
// slash command and the scheduler's auto-end sweep.
function buildGiveawaySettingsEmbed(guild, giveaways, settings) {
  const active = giveaways.filter((g) => g.status === 'active');
  const ended = giveaways.filter((g) => g.status !== 'active');

  const lines = active.length
    ? active.slice(0, 10).map((g) => `🟢 **${g.prize}** — ${g.entries.length} entries · ends <t:${Math.floor(g.endAt / 1000)}:R>`).join('\n')
    : '*No active giveaways.*';

  return new EmbedBuilder()
    .setColor(PREMIUM_COLORS.accent)
    .setTitle('🎉 Giveaways')
    .setDescription(
      'Create and manage giveaways for this server. Anyone can enter by pressing the button on the posted message ' +
      'until it ends, at which point winner(s) are drawn automatically.\n\n' +
      `**Active (${active.length}):**\n${lines}`,
    )
    .addFields(
      { name: 'Ended (kept for history)', value: `${ended.length}`, inline: true },
      { name: 'Join Button', value: `${settings.giveawayJoinButtonEmoji || ''} ${settings.giveawayJoinButtonLabel || 'Join'}`.trim(), inline: true },
    )
    .setFooter({ text: 'Only visible to you.' });
}

function buildGiveawaySettingsComponents(giveaways) {
  const rows = [];

  if (giveaways.length) {
    const options = giveaways.slice(0, 25).map((g) => ({
      label: g.prize.slice(0, 100),
      value: g.token,
      description: `${g.status === 'active' ? '🟢 Active' : '⚪ Ended'} · ${g.entries.length} entries · ${g.winnerCount} winner(s)`.slice(0, 100),
    }));
    rows.push(new ActionRowBuilder().addComponents(
      new StringSelectMenuBuilder()
        .setCustomId('panel:giveawaySelectManage')
        .setPlaceholder('Select a giveaway to manage')
        .addOptions(options),
    ));
  }

  rows.push(new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('panel:giveawayCreateStart').setLabel('Create Giveaway').setEmoji('🎉').setStyle(ButtonStyle.Success),
    new ButtonBuilder().setCustomId('panel:giveawayCustomizeButton').setLabel('Customize Join Button').setEmoji('✏️').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId('panel:giveawayTemplateSettings').setLabel('Message Template').setEmoji('🖋️').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId('panel:giveawaySettings').setLabel('Refresh').setEmoji('🔄').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId('panel:page2').setLabel('Back').setEmoji('⬅️').setStyle(ButtonStyle.Secondary),
  ));

  rows.push(new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('panel:giveawayTemplateReset').setLabel('Reset Template').setEmoji('🔄').setStyle(ButtonStyle.Danger),
  ));

  return rows;
}

function buildGiveawayDetailEmbed(giveaway) {
  const isActive = giveaway.status === 'active';
  const embed = new EmbedBuilder()
    .setColor(isActive ? PREMIUM_COLORS.accent : PREMIUM_COLORS.muted)
    .setTitle(`🎉 ${giveaway.prize}`)
    .addFields(
      { name: 'Status', value: isActive ? '🟢 Active' : '⚪ Ended', inline: true },
      { name: 'Entries', value: `${giveaway.entries.length}`, inline: true },
      { name: 'Winner count', value: `${giveaway.winnerCount}`, inline: true },
      { name: 'Channel', value: `<#${giveaway.channelId}>`, inline: true },
      { name: 'Hosted by', value: `<@${giveaway.organiserId}>`, inline: true },
    );

  if (isActive) {
    embed.addFields({ name: 'Ends', value: `<t:${Math.floor(giveaway.endAt / 1000)}:R>` });
  } else {
    embed.addFields({
      name: 'Winner(s)',
      value: giveaway.winners?.length ? giveaway.winners.map((id) => `<@${id}>`).join(', ') : 'None drawn',
    });
  }

  return embed.setFooter({ text: `Giveaway ID: ${giveaway.token} · Only visible to you.` });
}

function buildGiveawayDetailComponents(giveaway) {
  const isActive = giveaway.status === 'active';
  const row1 = new ActionRowBuilder().addComponents(
    isActive
      ? new ButtonBuilder().setCustomId(`panel:giveawayEndNow:${giveaway.token}`).setLabel('End Now').setEmoji('🛑').setStyle(ButtonStyle.Danger)
      : new ButtonBuilder().setCustomId(`panel:giveawayReroll:${giveaway.token}`).setLabel('Reroll Winner(s)').setEmoji('🔁').setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId(`panel:giveawayDeleteConfirm:${giveaway.token}`).setLabel('Delete').setEmoji('🗑️').setStyle(ButtonStyle.Danger),
    new ButtonBuilder().setCustomId('panel:giveawayBackToList').setLabel('Back to List').setEmoji('⬅️').setStyle(ButtonStyle.Secondary),
  );
  return [row1];
}

function buildGiveawayDeleteConfirmEmbed(giveaway) {
  return new EmbedBuilder()
    .setColor(PREMIUM_COLORS.danger)
    .setTitle('⚠️ Delete this giveaway?')
    .setDescription(
      `This permanently deletes the record for **${giveaway.prize}** and disables its posted message. ` +
      'This can\'t be undone.',
    );
}

function buildGiveawayDeleteConfirmComponents(giveaway) {
  const row1 = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`panel:giveawayDeleteYes:${giveaway.token}`).setLabel('Yes, Delete').setEmoji('🗑️').setStyle(ButtonStyle.Danger),
    new ButtonBuilder().setCustomId(`panel:giveawayDeleteNo:${giveaway.token}`).setLabel('Cancel').setEmoji('↩️').setStyle(ButtonStyle.Secondary),
  );
  return [row1];
}

// Step 1 of the creation wizard — pick a channel, then a modal collects
// prize/duration/winners (built inline in interactionCreate.js, matching
// how the other modals in this file are handled).
function buildGiveawayChannelStepEmbed() {
  return new EmbedBuilder()
    .setColor(PREMIUM_COLORS.accent)
    .setTitle('🎉 Create Giveaway — Step 1 of 2')
    .setDescription('Select the channel to post the giveaway in.');
}

function buildGiveawayChannelStepComponents() {
  const row1 = new ActionRowBuilder().addComponents(
    new ChannelSelectMenuBuilder()
      .setCustomId('panel:giveawayCreateChannel')
      .setPlaceholder('Select a channel')
      .addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement),
  );
  const row2 = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('panel:giveawaySettings').setLabel('Cancel').setEmoji('✖️').setStyle(ButtonStyle.Secondary),
  );
  return [row1, row2];
}

// Server-wide giveaway message template (title/description/footer/color/
// thumbnail/image, all with %placeholder% support) — applies to every
// giveaway embed posted in this guild. See DEFAULT_GUILD_SETTINGS in
// utils/db.js and utils/placeholders.js for the field/placeholder list.
function buildGiveawayTemplateEmbed(guild, settings) {
  const colorText = settings.giveawayEmbedColor != null
    ? `#${settings.giveawayEmbedColor.toString(16).padStart(6, '0')}`
    : '*(default)*';

  return new EmbedBuilder()
    .setColor(settings.giveawayEmbedColor ?? PREMIUM_COLORS.accent)
    .setTitle('🖋️ Giveaway Message Template')
    .setDescription(
      'Customize how every giveaway embed posted in this server looks. Leave a field blank to use the default.\n\n' +
      '**Giveaway placeholders:**\n' +
      '`%prize%` `%endAtDiscordFormation%` `%endAt%` `%winners%` `%organiser%` `%enteredCount%` `%entryCount%` `%sponsorLink%`\n\n' +
      '**Global placeholders:**\n' +
      '`%botName%` `%botID%` `%botAvatar%` `%botTag%` `%botMention%` `%guildName%` `%guildID%` `%guildIcon%`\n' +
      '`%timestamp%` `%shortTime%` `%longTime%` `%shortDate%` `%longDate%` `%shortDateTime%` `%longDateTime%` `%relativeTime%`',
    )
    .addFields(
      { name: 'Title', value: settings.giveawayEmbedTitle || '*(default)*' },
      { name: 'Description', value: settings.giveawayEmbedDescription || '*(default)*' },
      { name: 'Footer', value: settings.giveawayEmbedFooter || '*(default)*' },
      { name: 'Color', value: colorText, inline: true },
      { name: 'Thumbnail', value: settings.giveawayEmbedThumbnail ? '✅ Set' : '*(none)*', inline: true },
      { name: 'Image', value: settings.giveawayEmbedImage ? '✅ Set' : '*(none)*', inline: true },
    )
    .setFooter({ text: 'Only visible to you.' });
}

function buildGiveawayTemplateComponents() {
  const row1 = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('panel:giveawayEditTemplateText').setLabel('Edit Text').setEmoji('✏️').setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId('panel:giveawayEditTemplateImages').setLabel('Edit Images').setEmoji('🖼️').setStyle(ButtonStyle.Primary),
  );
  const row2 = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('panel:giveawayTemplatePreview').setLabel('Preview').setEmoji('👁️').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId('panel:giveawayTemplateReset').setLabel('Reset to Default').setEmoji('🔄').setStyle(ButtonStyle.Danger),
    new ButtonBuilder().setCustomId('panel:giveawaySettings').setLabel('Back').setEmoji('⬅️').setStyle(ButtonStyle.Secondary),
  );
  return [row1, row2];
}

// ---------- Stats panel (admin tool to view/clear a player's attendance history) ----------
function buildStatsPanelPickerEmbed(guild) {
  return new EmbedBuilder()
    .setColor(PREMIUM_COLORS.accent)
    .setTitle('📊 Stats Panel')
    .setDescription('Select a member below to view their event attendance history, or clear it.');
}

function buildStatsPanelPickerComponents() {
  const row1 = new ActionRowBuilder().addComponents(
    new UserSelectMenuBuilder()
      .setCustomId('panel:statsPanel:selectUser')
      .setPlaceholder('Select a member'),
  );
  const row2 = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('panel:page2').setLabel('Back').setEmoji('⬅️').setStyle(ButtonStyle.Secondary),
  );
  return [row1, row2];
}

// Embed for this is built with statsBuilder's buildStatsEmbed (same one /stats
// uses) — only the button row below is specific to the panel.
function buildStatsPanelDetailComponents(targetUserId) {
  const row1 = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`panel:statsPanel:clearConfirm:${targetUserId}`).setLabel('Clear History').setEmoji('🗑️').setStyle(ButtonStyle.Danger),
    new ButtonBuilder().setCustomId('panel:statsPanel').setLabel('Back').setEmoji('⬅️').setStyle(ButtonStyle.Secondary),
  );
  return [row1];
}

function buildStatsPanelClearConfirmEmbed(targetUser) {
  return new EmbedBuilder()
    .setColor(PREMIUM_COLORS.danger)
    .setTitle('⚠️ Clear Event History?')
    .setDescription(
      `This will permanently delete **${targetUser.tag}**'s entire event attendance history ` +
      '(total count, per-category breakdown, last attendance). This cannot be undone.',
    );
}

function buildStatsPanelClearConfirmComponents(targetUserId) {
  const row1 = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`panel:statsPanel:clearExecute:${targetUserId}`).setLabel('Yes, Clear It').setStyle(ButtonStyle.Danger),
    new ButtonBuilder().setCustomId(`panel:statsPanel:selectUser:${targetUserId}`).setLabel('Cancel').setStyle(ButtonStyle.Secondary),
  );
  return [row1];
}

// ---------- Power sub-panel (opened via the "Power" button) ----------
// Groups Restart and the maintenance-mode toggle together since the main
// dashboard is already at Discord's 5-action-row limit — this avoids
// needing extra top-level buttons.
function buildPowerOptionsEmbed(guild, settings) {
  const isOff = settings.botEnabled === false;
  return new EmbedBuilder()
    .setColor(isOff ? PREMIUM_COLORS.danger : PREMIUM_COLORS.success)
    .setTitle('🔌 Bot Power Options')
    .setDescription(
      isOff
        ? '🔴 **Maintenance Mode is ON.** Every command and interaction is disabled in this server except `/panel` itself, ' +
          'so an admin can always get back in here to turn it back on.'
        : '🟢 The bot is running normally in this server.\n\n' +
          '**Turn Bot Off** puts it into maintenance mode — every command and interaction stops responding except `/panel`, ' +
          'until someone turns it back on right here. This only affects this server.\n\n' +
          '**Restart Bot** is different: it fully restarts the process (affects every server the bot is in) and comes back online automatically in a few seconds.'
    )
    .addFields({ name: 'Status', value: isOff ? '🔴 OFF (Maintenance Mode)' : '🟢 ON', inline: true })
    .setFooter({ text: 'Only visible to you.' });
}

function buildPowerOptionsComponents(settings) {
  const isOff = settings.botEnabled === false;

  const row1 = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('panel:restartBot').setLabel('Restart Bot').setEmoji('🔁').setStyle(ButtonStyle.Danger),
    new ButtonBuilder()
      .setCustomId('panel:toggleBotEnabled')
      .setLabel(isOff ? 'Turn Bot On' : 'Turn Bot Off')
      .setEmoji(isOff ? '🟢' : '🔴')
      .setStyle(isOff ? ButtonStyle.Success : ButtonStyle.Danger),
    new ButtonBuilder().setCustomId('panel:checkUptime').setLabel('Uptime').setEmoji('⏱️').setStyle(ButtonStyle.Secondary),
  );
  const row2 = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('panel:backToMain').setLabel('Back to Main Panel').setStyle(ButtonStyle.Secondary),
  );

  return [row1, row2];
}

// ---------- Reset confirmation sub-panel (opened via the "Reset to Default" button) ----------
function buildResetConfirmEmbed(guild, settings) {
  return new EmbedBuilder()
    .setColor(PREMIUM_COLORS.danger)
    .setTitle('♻️ Reset Settings to Default?')
    .setDescription(
      `This wipes **everything** for **${guild.name}** back to default, across every module: ` +
      "settings (welcome/log channels, mod roles, role requests, tickets, upcoming board, giveaway config), " +
      "posted event/roster panels, scheduled events and messages, recurring autopost configs, warnings, " +
      "attendance stats, reaction-approval history, giveaways (active and ended), polls (active and ended), " +
      "auto-react rules, and " +
      "temp voice channel config.\n\n" +
      "**Not touched:** the Embed Builder feature (separate storage — clear it from its own panel), and any " +
      "messages/channels already posted/created in Discord (their underlying records are deleted, but the " +
      "messages/channels themselves aren't auto-deleted — live temp VCs in particular will stop being " +
      "auto-cleaned-up once their record is gone).\n\n" +
      "This can't be undone. Are you sure?"
    )
    .addFields(
      { name: 'Welcome Channel', value: settings.welcomeChannelId ? `<#${settings.welcomeChannelId}>` : 'Not set', inline: true },
      { name: 'Log Channel', value: settings.logChannelId ? `<#${settings.logChannelId}>` : 'Not set', inline: true },
      { name: 'Mod Roles', value: settings.modRoleIds?.length ? `${settings.modRoleIds.length} set` : 'Not set', inline: true },
    )
    .setFooter({ text: 'Only visible to you.' });
}

function buildResetConfirmComponents() {
  const row1 = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('panel:confirmReset').setLabel('Yes, Reset Everything').setEmoji('⚠️').setStyle(ButtonStyle.Danger),
    new ButtonBuilder().setCustomId('panel:backToMain').setLabel('Cancel').setStyle(ButtonStyle.Secondary),
  );

  return [row1];
}

// ---------- Restart confirmation sub-panel (opened via the "Restart Bot" button) ----------
function buildRestartConfirmEmbed() {
  return new EmbedBuilder()
    .setColor(PREMIUM_COLORS.danger)
    .setTitle('🔁 Restart the Bot?')
    .setDescription(
      'This restarts the **entire bot process** — it affects every server the bot is in, not just this one.\n\n' +
      'It will go offline for a few seconds and come back automatically. Any open modals, pending select-menu ' +
      'flows, or in-progress creations elsewhere will be lost.\n\n' +
      "Are you sure?",
    )
    .setFooter({ text: 'Only visible to you.' });
}

function buildRestartConfirmComponents() {
  const row1 = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('panel:confirmRestartBot').setLabel('Yes, Restart Now').setEmoji('⚠️').setStyle(ButtonStyle.Danger),
    new ButtonBuilder().setCustomId('panel:powerOptions').setLabel('Cancel').setStyle(ButtonStyle.Secondary),
  );

  return [row1];
}

// ---------- Autopost Settings hub (opened via the "Autopost Settings" button) ----------
// Lists every recurring daily roster config for this server. Press Add
// Autopost to create one via the 3-step wizard below, or select an existing
// one to open its detail view (Edit / Remove).
function buildAutopostSettingsEmbed(guild, rosters) {
  const list = rosters.length
    ? rosters.slice(0, 20).map((r) => {
      const schedule = r.scheduleType === 'hourly'
        ? `every hour at :${String(r.minute).padStart(2, '0')}`
        : `daily at ${String(r.hour).padStart(2, '0')}:${String(r.minute).padStart(2, '0')}`;
      return `• **${r.title || 'Untitled roster'}** — <#${r.channelId}> ${schedule} London (${r.mainSlots}+${r.subSlots})`;
    }).join('\n')
    : 'No autopost rosters configured on this server yet.';

  return new EmbedBuilder()
    .setColor(PREMIUM_COLORS.accent)
    .setTitle('🗓️ Autopost Settings')
    .setDescription(
      'Autopost rosters automatically post a fresh signup panel every day at a set time (London time).\n\n' +
      'Press **Add Autopost** to create one, or select an existing one below to edit or remove it.',
    )
    .addFields({ name: `Current Autoposts (${rosters.length})`, value: list })
    .setFooter({ text: 'Only visible to you.' });
}

function buildAutopostSettingsComponents(rosters) {
  const actionRow = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('panel:addAutopost').setLabel('Add Autopost').setEmoji('➕').setStyle(ButtonStyle.Success),
    new ButtonBuilder().setCustomId('panel:refreshAutopostSettings').setLabel('Refresh').setEmoji('🔄').setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId('panel:backToMain').setLabel('Back to Main Panel').setStyle(ButtonStyle.Secondary),
  );

  if (!rosters.length) return [actionRow];

  const options = rosters.slice(0, 25).map((r) => {
    const schedule = r.scheduleType === 'hourly'
      ? `Every hour :${String(r.minute).padStart(2, '0')}`
      : `${String(r.hour).padStart(2, '0')}:${String(r.minute).padStart(2, '0')} London`;
    return {
      label: (r.title || 'Untitled roster').slice(0, 100),
      description: `${schedule} • ${r.category || 'Uncategorized'}`.slice(0, 100),
      value: r.token,
    };
  });

  const selectRow = new ActionRowBuilder().addComponents(
    new StringSelectMenuBuilder()
      .setCustomId('panel:selectAutopost')
      .setPlaceholder('Select an autopost to manage')
      .addOptions(options),
  );

  return [selectRow, actionRow];
}

// ---------- Autopost detail sub-panel (Edit / Remove a single autopost) ----------
function buildAutopostDetailEmbed(guild, roster) {
  const schedule = roster.scheduleType === 'hourly'
    ? `Every hour, at :${String(roster.minute).padStart(2, '0')} past`
    : `${String(roster.hour).padStart(2, '0')}:${String(roster.minute).padStart(2, '0')} London time`;
  return new EmbedBuilder()
    .setColor(PREMIUM_COLORS.accent)
    .setTitle(`🗓️ ${roster.title || 'Untitled roster'}`)
    .setDescription(roster.description || null)
    .setThumbnail(roster.thumbnail || null)
    .addFields(
      { name: 'Channel', value: roster.channelId ? `<#${roster.channelId}>` : 'Unknown', inline: true },
      { name: 'Category', value: roster.category || 'Uncategorized', inline: true },
      { name: 'Schedule', value: schedule, inline: true },
      { name: 'Slots', value: `${roster.mainSlots} main + ${roster.subSlots} subs`, inline: true },
      { name: 'Auto-Lock After', value: roster.lockAfterMinutes != null ? `${roster.lockAfterMinutes} min` : 'Server default', inline: true },
      { name: 'Last Posted', value: roster.lastPostedDate || (roster.lastPostedHourKey ? roster.lastPostedHourKey.replace('-', ' ') : 'Never yet'), inline: true },
      { name: 'Thumbnail', value: roster.thumbnail ? '✅ Set' : 'Not set', inline: true },
    )
    .setFooter({ text: 'Only visible to you.' });
}

function buildAutopostDetailComponents(token) {
  const row1 = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`panel:autopostEdit:${token}`).setLabel('Edit').setEmoji('✏️').setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId(`panel:autopostRemove:${token}`).setLabel('Remove').setEmoji('🗑️').setStyle(ButtonStyle.Danger),
    new ButtonBuilder().setCustomId('panel:autopostSettings').setLabel('Back').setStyle(ButtonStyle.Secondary),
  );
  return [row1];
}

// ---------- Autopost remove confirmation sub-panel ----------
// Fully deletes the recurring config — schedule, slot counts, and lock-after
// time all gone. Does not touch a roster panel already posted today.
function buildAutopostResetConfirmEmbed(guild, roster) {
  return new EmbedBuilder()
    .setColor(PREMIUM_COLORS.danger)
    .setTitle('⚠️ Remove This Autopost?')
    .setDescription(
      `This will **permanently delete** the autopost config for **${roster.title || 'Untitled roster'}**` +
      (roster.channelId ? ` in <#${roster.channelId}>` : '') +
      '.\n\nSchedule, slot counts, and lock-after time will all be gone — it would need to be set up from scratch ' +
      'again.\n\n**This does not touch** any roster panel already posted today.\n\n' +
      "This can't be undone. Are you sure?",
    )
    .setFooter({ text: 'Only visible to you.' });
}

function buildAutopostResetConfirmComponents(token) {
  const row1 = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`panel:confirmResetAutopost:${token}`).setLabel('Yes, Delete It').setEmoji('⚠️').setStyle(ButtonStyle.Danger),
    new ButtonBuilder().setCustomId('panel:autopostSettings').setLabel('Back').setStyle(ButtonStyle.Secondary),
  );

  return [row1];
}

// ---------- Autopost Add/Edit wizard steps ----------
// Channel -> Schedule Type -> (Daily only: Hour) -> a final modal for
// title/description/category/slots/minute/lock-after. Minute is typed in
// the modal (not a select) so it can be any value 0-59, not just a handful
// of dropdown options.
function buildAutopostChannelStepEmbed(session) {
  return new EmbedBuilder()
    .setColor(PREMIUM_COLORS.accent)
    .setTitle(session.editingToken ? '✏️ Edit Autopost — Channel' : '➕ Add Autopost — Channel')
    .setDescription('Pick the channel this roster should be posted in.')
    .setFooter({ text: 'Only visible to you.' });
}

function buildAutopostChannelStepComponents(session) {
  const channelSelect = new ChannelSelectMenuBuilder()
    .setCustomId('panel:autopostWizard:channel')
    .setPlaceholder('Select a channel')
    .addChannelTypes(ChannelType.GuildText);
  if (session.channelId) channelSelect.setDefaultChannels(session.channelId);

  const row1 = new ActionRowBuilder().addComponents(channelSelect);

  // Skip only shows once a channel is already set (i.e. editing an existing
  // roster) — lets you move on without re-picking the same channel.
  const row2Buttons = [];
  if (session.channelId) {
    row2Buttons.push(
      new ButtonBuilder().setCustomId('panel:autopostWizard:skipChannel').setLabel('Skip (keep current)').setEmoji('⏭️').setStyle(ButtonStyle.Secondary),
    );
  }
  row2Buttons.push(new ButtonBuilder().setCustomId('panel:autopostWizard:cancel').setLabel('Cancel').setStyle(ButtonStyle.Secondary));
  const row2 = new ActionRowBuilder().addComponents(...row2Buttons);

  return [row1, row2];
}

function buildAutopostScheduleTypeStepEmbed(session) {
  return new EmbedBuilder()
    .setColor(PREMIUM_COLORS.accent)
    .setTitle(session.editingToken ? '✏️ Edit Autopost — Schedule Type' : '➕ Add Autopost — Schedule Type')
    .setDescription(
      '**Daily** — posts once a day at a specific hour and minute (e.g. every day at 15:00).\n\n' +
      '**Every Hour** — posts once every hour, at a chosen minute past the hour (e.g. every hour at :20, so 21:20, 22:20, 23:20, and so on).',
    )
    .setFooter({ text: 'Only visible to you.' });
}

function buildAutopostScheduleTypeStepComponents(session) {
  const row1 = new ActionRowBuilder().addComponents(
    new StringSelectMenuBuilder()
      .setCustomId('panel:autopostWizard:scheduleType')
      .setPlaceholder('Select a schedule type')
      .addOptions(
        { label: 'Daily (once a day at HH:MM)', value: 'daily', default: session.scheduleType === 'daily' },
        { label: 'Every Hour (at :MM past)', value: 'hourly', default: session.scheduleType === 'hourly' },
      ),
  );

  const row2Buttons = [];
  if (session.scheduleType) {
    row2Buttons.push(
      new ButtonBuilder().setCustomId('panel:autopostWizard:skipScheduleType').setLabel('Skip (keep current)').setEmoji('⏭️').setStyle(ButtonStyle.Secondary),
    );
  }
  row2Buttons.push(new ButtonBuilder().setCustomId('panel:autopostWizard:cancel').setLabel('Cancel').setStyle(ButtonStyle.Secondary));
  const row2 = new ActionRowBuilder().addComponents(...row2Buttons);

  return [row1, row2];
}

const AUTOPOST_HOUR_OPTIONS = Array.from({ length: 24 }, (_, h) => String(h).padStart(2, '0'));

function buildAutopostHourStepEmbed(session) {
  return new EmbedBuilder()
    .setColor(PREMIUM_COLORS.accent)
    .setTitle(session.editingToken ? '✏️ Edit Autopost — Hour' : '➕ Add Autopost — Hour')
    .setDescription(
      "What **hour** (London time, 24h) should this post at?\n\n" +
      "Next you'll fill in the title, description, category, slots, and minute in a short popup.",
    )
    .setFooter({ text: 'Only visible to you.' });
}

function buildAutopostHourStepComponents(session) {
  const currentHour = session.hour != null ? String(session.hour).padStart(2, '0') : null;
  const row1 = new ActionRowBuilder().addComponents(
    new StringSelectMenuBuilder()
      .setCustomId('panel:autopostWizard:hour')
      .setPlaceholder('Select hour (24h, London time)')
      .addOptions(AUTOPOST_HOUR_OPTIONS.map((h) => ({ label: `${h}:00`, value: h, default: h === currentHour }))),
  );

  const row2Buttons = [];
  if (session.hour != null) {
    row2Buttons.push(
      new ButtonBuilder().setCustomId('panel:autopostWizard:skipHour').setLabel('Skip (keep current)').setEmoji('⏭️').setStyle(ButtonStyle.Secondary),
    );
  }
  row2Buttons.push(new ButtonBuilder().setCustomId('panel:autopostWizard:cancel').setLabel('Cancel').setStyle(ButtonStyle.Secondary));
  const row2 = new ActionRowBuilder().addComponents(...row2Buttons);

  return [row1, row2];
}

// ---------- Role Request sub-panel (opened via the "Role Request Settings" button) ----------
function buildRoleRequestSettingsEmbed(guild, settings) {
  return new EmbedBuilder()
    .setColor(PREMIUM_COLORS.accent)
    .setTitle('🎫 Role Request Settings')
    .setDescription('Configure where role requests get reviewed, and which role is granted on approval.')
    .addFields(
      {
        name: 'Review/Log Channel',
        value: settings.roleRequestLogChannelId ? `<#${settings.roleRequestLogChannelId}>` : 'Not set (using bot default)',
        inline: true,
      },
      {
        name: 'Approve Role',
        value: settings.roleRequestApproveRoleId ? `<@&${settings.roleRequestApproveRoleId}>` : 'Not set (using bot default)',
        inline: true,
      },
    )
    .setFooter({ text: 'Only visible to you.' });
}

function buildRoleRequestSettingsComponents() {
  const row1 = new ActionRowBuilder().addComponents(
    new ChannelSelectMenuBuilder()
      .setCustomId('panel:setRoleRequestLogChannel')
      .setPlaceholder('Select role-request review channel')
      .addChannelTypes(ChannelType.GuildText),
  );

  const row2 = new ActionRowBuilder().addComponents(
    new RoleSelectMenuBuilder()
      .setCustomId('panel:setRoleRequestApproveRole')
      .setPlaceholder('Select role to grant on approval')
      .setMinValues(1)
      .setMaxValues(1),
  );

  const row3 = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('panel:refreshRoleRequestSettings').setLabel('Refresh').setEmoji('🔄').setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId('panel:backToMain').setLabel('Back to Main Panel').setStyle(ButtonStyle.Secondary),
  );

  return [row1, row2, row3];
}

// ---------- Ticket sub-panel (opened via the "Ticket Settings" button) ----------
function buildTicketSettingsEmbed(guild, settings) {
  return new EmbedBuilder()
    .setColor(PREMIUM_COLORS.accent)
    .setTitle('🎟️ Ticket Settings')
    .setDescription('Configure where tickets get created, who can see them, where transcripts go, and whether the opener gets a copy.')
    .addFields(
      {
        name: 'Ticket Category',
        value: settings.ticketCategoryId ? `<#${settings.ticketCategoryId}>` : 'Not set (using bot default)',
        inline: true,
      },
      {
        name: 'Staff Role',
        value: settings.ticketStaffRoleId ? `<@&${settings.ticketStaffRoleId}>` : 'Not set (using bot default)',
        inline: true,
      },
      {
        name: 'Transcript Log Channel',
        value: settings.ticketLogChannelId ? `<#${settings.ticketLogChannelId}>` : 'Not set',
        inline: true,
      },
      {
        name: 'DM Transcript to Opener',
        value: settings.ticketDmTranscriptToOpener ? '✅ On' : '❌ Off',
        inline: true,
      },
      {
        name: 'Custom Embeds',
        value:
          `${settings.ticketPanelEmbedDraft ? '🟢' : '⚪'} Panel   ` +
          `${settings.ticketOpenedEmbedDraft ? '🟢' : '⚪'} Opened   ` +
          `${settings.ticketCloseEmbedDraft ? '🟢' : '⚪'} Close/Transcript`,
        inline: false,
      },
    )
    .setFooter({ text: 'Only visible to you.' });
}

function buildTicketSettingsComponents(settings) {
  const row1 = new ActionRowBuilder().addComponents(
    new ChannelSelectMenuBuilder()
      .setCustomId('panel:setTicketCategory')
      .setPlaceholder('Select ticket category')
      .addChannelTypes(ChannelType.GuildCategory),
  );

  const row2 = new ActionRowBuilder().addComponents(
    new RoleSelectMenuBuilder()
      .setCustomId('panel:setTicketStaffRole')
      .setPlaceholder('Select staff role for tickets')
      .setMinValues(1)
      .setMaxValues(1),
  );

  const row3 = new ActionRowBuilder().addComponents(
    new ChannelSelectMenuBuilder()
      .setCustomId('panel:setTicketLogChannel')
      .setPlaceholder('Select transcript log channel')
      .addChannelTypes(ChannelType.GuildText),
  );

  const row4 = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId('panel:toggleTicketDm')
      .setLabel(settings.ticketDmTranscriptToOpener ? 'DM Transcript: ON' : 'DM Transcript: OFF')
      .setStyle(settings.ticketDmTranscriptToOpener ? ButtonStyle.Success : ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId('panel:refreshTicketSettings').setLabel('Refresh').setEmoji('🔄').setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId('panel:backToMain').setLabel('Back to Main Panel').setStyle(ButtonStyle.Secondary),
  );

  const row5 = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('panel:ticketEmbed:panel').setLabel('Edit Panel Embed').setEmoji('🧩').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId('panel:ticketEmbed:opened').setLabel('Edit Opened Embed').setEmoji('📨').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId('panel:ticketEmbed:close').setLabel('Edit Close Embed').setEmoji('📋').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId('panel:ticketEmbed:reset').setLabel('Reset Custom Embeds').setEmoji('♻️').setStyle(ButtonStyle.Danger),
  );

  return [row1, row2, row3, row4, row5];
}

// ---------- Ticket custom-embed reset confirmation ----------
function buildTicketEmbedResetConfirmEmbed(settings) {
  return new EmbedBuilder()
    .setColor(PREMIUM_COLORS.danger)
    .setTitle('♻️ Reset Custom Ticket Embeds?')
    .setDescription(
      'This clears any custom Panel / Opened / Close embeds and reverts them to the built-in defaults. ' +
      "This can't be undone. Are you sure?"
    )
    .addFields(
      { name: 'Panel', value: settings.ticketPanelEmbedDraft ? '🟢 Customized' : '⚪ Default', inline: true },
      { name: 'Opened', value: settings.ticketOpenedEmbedDraft ? '🟢 Customized' : '⚪ Default', inline: true },
      { name: 'Close/Transcript', value: settings.ticketCloseEmbedDraft ? '🟢 Customized' : '⚪ Default', inline: true },
    )
    .setFooter({ text: 'Only visible to you.' });
}

function buildTicketEmbedResetConfirmComponents() {
  const row1 = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('panel:confirmResetTicketEmbeds').setLabel('Yes, Reset Embeds').setEmoji('⚠️').setStyle(ButtonStyle.Danger),
    new ButtonBuilder().setCustomId('panel:ticketSettings').setLabel('Cancel').setStyle(ButtonStyle.Secondary),
  );

  return [row1];
}

// ---------- Welcome sub-panel (opened via the "Welcome Settings" button) ----------
function buildWelcomeSettingsEmbed(guild, settings) {
  const hasEmbed = Boolean(settings.welcomeEmbedDraft);
  const buttonCount = settings.welcomeEmbedDraft?.buttons?.length || 0;
  const preview = hasEmbed
    ? (settings.welcomeEmbedDraft.title || settings.welcomeEmbedDraft.description || '*(embed has no title/description yet - open Edit Welcome Embed)*')
    : settings.welcomeMessage;

  return new EmbedBuilder()
    .setColor(PREMIUM_COLORS.accent)
    .setTitle('👋 Welcome Settings')
    .setDescription('Configure what new members see when they join — a quick text line, or a full rich embed with images, fields, and buttons.')
    .addFields(
      { name: 'Welcome Channel', value: settings.welcomeChannelId ? `<#${settings.welcomeChannelId}>` : 'Not set (welcomer is off)', inline: true },
      { name: 'Mode', value: hasEmbed ? '🧩 Rich Embed' : '✏️ Legacy Text', inline: true },
      { name: 'Attached Buttons', value: `${buttonCount}`, inline: true },
      { name: hasEmbed ? 'Embed Preview' : 'Message Preview', value: `\`\`\`\n${(preview || '').slice(0, 500)}\n\`\`\`` },
    )
    .setFooter({ text: 'Only visible to you.' });
}

function buildWelcomeSettingsComponents(settings) {
  const row1 = new ActionRowBuilder().addComponents(
    new ChannelSelectMenuBuilder()
      .setCustomId('panel:setWelcomeChannelSub')
      .setPlaceholder('Select welcome channel')
      .addChannelTypes(ChannelType.GuildText),
  );

  const row2 = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('panel:welcomeEmbed').setLabel('Edit Welcome Embed').setEmoji('🧩').setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId('panel:editWelcomeMsg').setLabel('Edit Legacy Text').setEmoji('✏️').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId('panel:welcomePlaceholders').setLabel('Placeholders').setEmoji('📋').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId('panel:welcomeEmbedReset').setLabel('Reset to Legacy Text').setEmoji('♻️').setStyle(ButtonStyle.Danger),
  );

  const row3 = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('panel:refreshWelcomeSettings').setLabel('Refresh').setEmoji('🔄').setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId('panel:backToMain').setLabel('Back to Main Panel').setStyle(ButtonStyle.Secondary),
  );

  return [row1, row2, row3];
}

// ---------- Welcome embed reset confirmation ----------
function buildWelcomeEmbedResetConfirmEmbed() {
  return new EmbedBuilder()
    .setColor(PREMIUM_COLORS.danger)
    .setTitle('♻️ Reset to Legacy Text Welcome?')
    .setDescription(
      "This clears your custom welcome embed (and any attached buttons) and reverts to the plain-text welcome message below it. " +
      "This can't be undone. Are you sure?"
    )
    .setFooter({ text: 'Only visible to you.' });
}

function buildWelcomeEmbedResetConfirmComponents() {
  const row1 = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('panel:confirmResetWelcomeEmbed').setLabel('Yes, Reset').setEmoji('⚠️').setStyle(ButtonStyle.Danger),
    new ButtonBuilder().setCustomId('panel:welcomeSettings').setLabel('Cancel').setStyle(ButtonStyle.Secondary),
  );
  return [row1];
}

// ---------- Welcome placeholder reference (opened via the "Placeholders" button) ----------
function buildWelcomePlaceholdersEmbed() {
  return new EmbedBuilder()
    .setColor(PREMIUM_COLORS.accent)
    .setTitle('📋 Welcome Placeholders')
    .setDescription('Use these anywhere in the welcome embed — title, description, footer, fields, even thumbnail/image URLs (e.g. `%userAvatar%` as the thumbnail).')
    .addFields(
      { name: 'Member', value: '`%user%` `%mention%` `%username%` `%userTag%` `%userId%` `%userAvatar%`', inline: false },
      { name: 'Server', value: '`%server%` `%serverId%` `%serverImage%` `%memberCount%` `%ordinal%` `%boostCount%`', inline: false },
      { name: 'Join Info', value: '`%inviter%` `%joinDate%` `%accountCreated%` `%accountAge%`', inline: false },
      { name: 'General', value: '`%botName%` `%timestamp%` `%relativeTime%`', inline: false },
    )
    .setFooter({ text: 'Unrecognized %placeholders% are left as-is, so a typo is visible instead of vanishing.' });
}

// ---------- Upcoming Board sub-panel (opened via the "Upcoming Board" button) ----------
function buildUpcomingBoardSettingsEmbed(guild, settings) {
  return new EmbedBuilder()
    .setColor(PREMIUM_COLORS.accent)
    .setTitle('📅 Upcoming Board Settings')
    .setDescription('Configure the live-updating board that shows recurring daily rosters and when they post next.')
    .addFields(
      {
        name: 'Board Channel',
        value: settings.upcomingBoardChannelId ? `<#${settings.upcomingBoardChannelId}>` : 'Not set',
        inline: true,
      },
      {
        name: 'Status',
        value: settings.upcomingBoardEnabled ? '✅ On' : '❌ Off',
        inline: true,
      },
      {
        name: 'Sort Order',
        value: settings.upcomingBoardSortBy === 'channel' ? 'By channel' : 'By time',
        inline: true,
      },
      {
        name: 'Title',
        value: settings.upcomingBoardTitle || '📅 Upcoming Rosters',
        inline: true,
      },
      {
        name: 'Color',
        value: settings.upcomingBoardColor != null ? `#${settings.upcomingBoardColor.toString(16).padStart(6, '0')}` : 'Default',
        inline: true,
      },
      {
        name: 'Slot Counts',
        value: settings.upcomingBoardShowSlots ? '✅ Shown' : '❌ Hidden',
        inline: true,
      },
      {
        name: 'Header Text',
        value: settings.upcomingBoardHeaderText || 'Not set',
        inline: false,
      },
      {
        name: 'Footer Text',
        value: settings.upcomingBoardFooterText || 'Not set',
        inline: false,
      },
    )
    .setFooter({ text: 'Only visible to you. A channel must be set before turning this on.' });
}

function buildUpcomingBoardSettingsComponents(settings) {
  const row1 = new ActionRowBuilder().addComponents(
    new ChannelSelectMenuBuilder()
      .setCustomId('panel:setUpcomingBoardChannel')
      .setPlaceholder('Select the board channel')
      .addChannelTypes(ChannelType.GuildText),
  );

  const row2 = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('panel:editUpcomingBoardTitleColor').setLabel('Edit Title & Color').setEmoji('🎨').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId('panel:editUpcomingBoardText').setLabel('Edit Header/Footer').setEmoji('📝').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId('panel:toggleUpcomingBoardSlots')
      .setLabel(settings.upcomingBoardShowSlots ? 'Slot Counts: ON' : 'Slot Counts: OFF')
      .setStyle(settings.upcomingBoardShowSlots ? ButtonStyle.Success : ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId('panel:toggleUpcomingBoardSort')
      .setLabel(settings.upcomingBoardSortBy === 'channel' ? 'Sort: By Channel' : 'Sort: By Time')
      .setStyle(ButtonStyle.Secondary),
  );

  const row3 = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId('panel:toggleUpcomingBoard')
      .setLabel(settings.upcomingBoardEnabled ? 'Board: ON' : 'Board: OFF')
      .setStyle(settings.upcomingBoardEnabled ? ButtonStyle.Success : ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId('panel:refreshUpcomingBoardSettings').setLabel('Refresh').setEmoji('🔄').setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId('panel:backToMain').setLabel('Back to Main Panel').setStyle(ButtonStyle.Secondary),
  );

  return [row1, row2, row3];
}

// ---------- Auto-React sub-panel (opened via the "Auto-React Settings" button) ----------
// Rule creation and editing happen via the wizard below (trigger -> match
// mode -> channel -> a small emoji/keywords popup), since Discord modals
// only support text fields - no dropdowns - so trigger type and match mode
// have to be picked as their own steps before the modal.
function buildAutoReactSettingsEmbed(guild, rules) {
  const wildcardLegend =
    '`*` — matches **anything** in that spot (that part of the message can change)\n' +
    '`%` — only matches a **date/time** in that spot; anything else posted there gets rejected\n' +
    '`^` — only matches a **time** in `HH:MM` format in that spot; anything else posted there gets rejected';

  const rulesList = rules.length
    ? rules.slice(0, 20).map((r) => `• ${describeRule(r, guild)}`).join('\n')
    : 'No auto-react rules set up yet.';

  return new EmbedBuilder()
    .setColor(PREMIUM_COLORS.accent)
    .setTitle('🔁 Auto-React Settings')
    .setDescription('Press **Add Rule** to create a new one, or select an existing rule below to edit or remove it.')
    .addFields(
      { name: 'Keyword Wildcards', value: wildcardLegend },
      { name: `Current Rules (${rules.length})`, value: rulesList },
    )
    .setFooter({ text: 'Only visible to you.' });
}

function buildAutoReactSettingsComponents(rules) {
  const actionRow = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('panel:addAutoReact').setLabel('Add Rule').setEmoji('➕').setStyle(ButtonStyle.Success),
    new ButtonBuilder().setCustomId('panel:refreshAutoReactSettings').setLabel('Refresh').setEmoji('🔄').setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId('panel:backToMain').setLabel('Back to Main Panel').setStyle(ButtonStyle.Secondary),
  );

  if (!rules.length) return [actionRow];

  const options = rules.slice(0, 25).map((r) => ({
    label: (r.trigger + (r.keywords?.length ? `: ${r.keywords.join(' | ')}` : '')).slice(0, 100),
    description: (r.emojis || []).map((e) => e.raw).join(' ').slice(0, 100) || undefined,
    value: r.id,
  }));

  const selectRow = new ActionRowBuilder().addComponents(
    new StringSelectMenuBuilder()
      .setCustomId('panel:selectAutoReactRule')
      .setPlaceholder('Select a rule to manage')
      .addOptions(options),
  );

  return [selectRow, actionRow];
}

// ---------- Auto-React rule detail sub-panel (Edit / Remove a single rule) ----------
function buildAutoReactRuleDetailEmbed(guild, rule) {
  return new EmbedBuilder()
    .setColor(PREMIUM_COLORS.accent)
    .setTitle('🔁 Rule Details')
    .setDescription(describeRule(rule, guild))
    .setFooter({ text: 'Only visible to you.' });
}

function buildAutoReactRuleDetailComponents(ruleId) {
  const row1 = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`panel:autoReactRuleEdit:${ruleId}`).setLabel('Edit').setEmoji('✏️').setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId(`panel:autoReactRuleRemove:${ruleId}`).setLabel('Remove').setEmoji('🗑️').setStyle(ButtonStyle.Danger),
    new ButtonBuilder().setCustomId('panel:autoReactSettings').setLabel('Back').setStyle(ButtonStyle.Secondary),
  );
  return [row1];
}

// ---------- Auto-React Add/Edit wizard steps ----------
function buildAutoReactTriggerStepEmbed(session) {
  return new EmbedBuilder()
    .setColor(PREMIUM_COLORS.accent)
    .setTitle(session.editingId ? '✏️ Edit Auto-React Rule (1/3)' : '➕ Add Auto-React Rule (1/3)')
    .setDescription('Pick what should trigger the reaction.')
    .setFooter({ text: 'Only visible to you.' });
}

function buildAutoReactTriggerStepComponents() {
  const row1 = new ActionRowBuilder().addComponents(
    new StringSelectMenuBuilder()
      .setCustomId('panel:autoReactWizard:trigger')
      .setPlaceholder('Select a trigger type')
      .addOptions(
        { label: 'Any message', value: 'any' },
        { label: 'Has image/attachment', value: 'image' },
        { label: 'Contains keyword(s)', value: 'keyword' },
        { label: 'Image + keyword(s)', value: 'image_keyword' },
        { label: 'Fallback (only if exactly one rule is unmatched)', value: 'fallback' },
      ),
  );
  const row2 = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('panel:autoReactWizard:cancel').setLabel('Cancel').setStyle(ButtonStyle.Secondary),
  );
  return [row1, row2];
}

function buildAutoReactMatchModeStepEmbed(session) {
  return new EmbedBuilder()
    .setColor(PREMIUM_COLORS.accent)
    .setTitle(session.editingId ? '✏️ Edit Auto-React Rule (2/3)' : '➕ Add Auto-React Rule (2/3)')
    .setDescription(
      'This trigger needs keywords/patterns. Should it react if **any one** matches, or only if **every** one matches?\n\n' +
      "You'll enter the actual keywords/patterns in the next step.",
    )
    .setFooter({ text: 'Only visible to you.' });
}

function buildAutoReactMatchModeStepComponents() {
  const row1 = new ActionRowBuilder().addComponents(
    new StringSelectMenuBuilder()
      .setCustomId('panel:autoReactWizard:matchMode')
      .setPlaceholder('Select match mode')
      .addOptions(
        { label: 'Any keyword/pattern found', value: 'any' },
        { label: 'ALL keywords/patterns must be found', value: 'all' },
      ),
  );
  const row2 = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('panel:autoReactWizard:cancel').setLabel('Cancel').setStyle(ButtonStyle.Secondary),
  );
  return [row1, row2];
}

function buildAutoReactChannelStepEmbed(session) {
  return new EmbedBuilder()
    .setColor(PREMIUM_COLORS.accent)
    .setTitle(session.editingId ? '✏️ Edit Auto-React Rule (3/3)' : '➕ Add Auto-React Rule (3/3)')
    .setDescription(
      "Limit this rule to one channel, or leave it for the whole server. Next you'll enter the emoji(s) " +
      "(and keywords, if this trigger needs them) in a short popup.",
    )
    .setFooter({ text: 'Only visible to you.' });
}

function buildAutoReactChannelStepComponents() {
  const row1 = new ActionRowBuilder().addComponents(
    new ChannelSelectMenuBuilder()
      .setCustomId('panel:autoReactWizard:channel')
      .setPlaceholder('Select a channel (optional)')
      .addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement),
  );
  const row2 = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('panel:autoReactWizard:allChannels').setLabel('All Channels (skip)').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId('panel:autoReactWizard:cancel').setLabel('Cancel').setStyle(ButtonStyle.Secondary),
  );
  return [row1, row2];
}

// ---------- Auto-React remove confirmation sub-panel ----------
function buildAutoReactRemoveConfirmEmbed(guild, rule) {
  return new EmbedBuilder()
    .setColor(PREMIUM_COLORS.danger)
    .setTitle('⚠️ Remove This Auto-React Rule?')
    .setDescription(
      `This will **permanently delete**:\n${describeRule(rule, guild)}\n\nThis can't be undone. Are you sure?`,
    )
    .setFooter({ text: 'Only visible to you.' });
}

function buildAutoReactRemoveConfirmComponents(ruleId) {
  const row1 = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`panel:confirmRemoveAutoReact:${ruleId}`).setLabel('Yes, Remove It').setEmoji('⚠️').setStyle(ButtonStyle.Danger),
    new ButtonBuilder().setCustomId('panel:autoReactSettings').setLabel('Back').setStyle(ButtonStyle.Secondary),
  );

  return [row1];
}

// ---------- Temp Voice Channels sub-panel ----------
function buildTempVcSettingsEmbed(guild, settings) {
  const activeCount = Object.keys(settings.activeChannels || {}).length;
  return new EmbedBuilder()
    .setColor(settings.enabled ? PREMIUM_COLORS.success : PREMIUM_COLORS.muted)
    .setTitle('🔊 Temp Voice Channels')
    .setDescription(
      'Members join the **Trigger Channel** below to instantly get their own personal voice channel, ' +
      'moved into automatically. It\'s deleted a few seconds after everyone leaves.\n\n' +
      '**Auto Role** (optional): applied to anyone in *any* voice channel on the server, removed the moment they leave voice entirely.\n' +
      '**Auto Status** (optional): keeps *every* voice channel\'s status showing a live member count (overwrites any status set manually).',
    )
    .addFields(
      { name: 'Status', value: settings.enabled ? '🟢 Enabled' : '🔴 Disabled', inline: true },
      { name: 'Active Temp Channels', value: `${activeCount}`, inline: true },
      { name: 'Trigger Channel', value: settings.triggerChannelId ? `<#${settings.triggerChannelId}>` : 'Not set', inline: false },
      { name: 'Creates In', value: settings.categoryId ? `<#${settings.categoryId}>` : 'Same category as trigger channel', inline: false },
      { name: 'Auto Role', value: settings.roleId ? `<@&${settings.roleId}> (${settings.autoRoleEnabled ? 'on' : 'off'})` : 'Not set', inline: false },
      { name: 'Auto Status', value: settings.autoStatusEnabled ? 'On — shows live member count' : 'Off', inline: false },
    )
    .setFooter({ text: 'Only visible to you.' });
}

function buildTempVcSettingsComponents(settings) {
  const row1 = new ActionRowBuilder().addComponents(
    new ChannelSelectMenuBuilder()
      .setCustomId('panel:setTempVcTrigger')
      .setPlaceholder('Select trigger channel (join this to create a VC)')
      .addChannelTypes(ChannelType.GuildVoice),
  );
  const row2 = new ActionRowBuilder().addComponents(
    new ChannelSelectMenuBuilder()
      .setCustomId('panel:setTempVcCategory')
      .setPlaceholder('Select category for new temp VCs (optional)')
      .addChannelTypes(ChannelType.GuildCategory),
  );
  const row3 = new ActionRowBuilder().addComponents(
    new RoleSelectMenuBuilder()
      .setCustomId('panel:setTempVcRole')
      .setPlaceholder('Select auto-role for temp VC members (optional)'),
  );
  const row4 = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId('panel:toggleTempVcEnabled')
      .setLabel(settings.enabled ? 'Disable Feature' : 'Enable Feature')
      .setEmoji(settings.enabled ? '🔴' : '🟢')
      .setStyle(settings.enabled ? ButtonStyle.Danger : ButtonStyle.Success),
    new ButtonBuilder()
      .setCustomId('panel:toggleTempVcRole')
      .setLabel(settings.autoRoleEnabled ? 'Auto Role: On' : 'Auto Role: Off')
      .setStyle(settings.autoRoleEnabled ? ButtonStyle.Success : ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId('panel:toggleTempVcStatus')
      .setLabel(settings.autoStatusEnabled ? 'Auto Status: On' : 'Auto Status: Off')
      .setStyle(settings.autoStatusEnabled ? ButtonStyle.Success : ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId('panel:backToMain').setLabel('Back to Main Panel').setStyle(ButtonStyle.Secondary),
  );

  return [row1, row2, row3, row4];
}

// ---------- Invite Tracker sub-panel (opened via the "Invite Tracker" button on Page 2) ----------
function buildInviteTrackerSettingsEmbed(guild, settings, leaderboard) {
  const top = leaderboard.slice(0, 10);
  const lines = top.length
    ? top
        .map((entry, i) =>
          `**${i + 1}.** <@${entry.userId}> — **${entry.total}** total ` +
          `(${entry.regular} joined, ${entry.bonus >= 0 ? '+' : ''}${entry.bonus} bonus, -${entry.leaves} left)`,
        )
        .join('\n')
    : '*No invite activity tracked yet.*';

  return new EmbedBuilder()
    .setColor(settings.inviteTrackerEnabled ? PREMIUM_COLORS.success : PREMIUM_COLORS.muted)
    .setTitle('📨 Invite Tracker')
    .setDescription(
      'Tracks who invites new members: regular joins, manually-granted bonus invites, and members who ' +
      'later leave (subtracted from whoever invited them).\n\n' +
      "Requires the bot to have **Manage Server** permission in this server to read invite use counts — " +
      'without it, joins are attributed as "Unknown".',
    )
    .addFields(
      { name: 'Status', value: settings.inviteTrackerEnabled ? '🟢 Enabled' : '🔴 Disabled', inline: true },
      { name: 'Join-Log Channel', value: settings.inviteLogChannelId ? `<#${settings.inviteLogChannelId}>` : '*Not set*', inline: true },
      { name: 'Revoke Button', value: settings.inviteLogShowRevokeButton ? '🟢 Shown' : '⚪ Hidden', inline: true },
      { name: 'Leaderboard (Top 10)', value: lines, inline: false },
    )
    .setFooter({ text: 'Only visible to you.' });
}

function buildInviteTrackerSettingsComponents(settings) {
  const row1 = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId('panel:toggleInviteTracker')
      .setLabel(settings.inviteTrackerEnabled ? 'Disable Tracking' : 'Enable Tracking')
      .setEmoji(settings.inviteTrackerEnabled ? '🔴' : '🟢')
      .setStyle(settings.inviteTrackerEnabled ? ButtonStyle.Danger : ButtonStyle.Success),
    new ButtonBuilder()
      .setCustomId('panel:toggleInviteLogRevokeButton')
      .setLabel(settings.inviteLogShowRevokeButton ? 'Revoke Button: On' : 'Revoke Button: Off')
      .setStyle(settings.inviteLogShowRevokeButton ? ButtonStyle.Success : ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId('panel:refreshInviteTracker').setLabel('Refresh').setEmoji('🔄').setStyle(ButtonStyle.Primary),
  );

  const row2 = new ActionRowBuilder().addComponents(
    new ChannelSelectMenuBuilder()
      .setCustomId('panel:setInviteLogChannel')
      .setPlaceholder(
        settings.inviteLogChannelId ? 'Log channel set — pick a new one to change it' : 'Select a join-log channel (optional)',
      )
      .addChannelTypes(ChannelType.GuildText),
  );

  const row3 = new ActionRowBuilder().addComponents(
    new UserSelectMenuBuilder()
      .setCustomId('panel:inviteTracker:bonusUser')
      .setPlaceholder('Select a member to grant/remove bonus invites'),
  );

  const row4 = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('panel:inviteTracker:resetAllConfirm').setLabel('Reset All Stats').setEmoji('♻️').setStyle(ButtonStyle.Danger),
    new ButtonBuilder().setCustomId('panel:backToMain').setLabel('Back to Main Panel').setStyle(ButtonStyle.Secondary),
  );

  return [row1, row2, row3, row4];
}

function buildInviteTrackerResetConfirmEmbed() {
  return new EmbedBuilder()
    .setColor(PREMIUM_COLORS.danger)
    .setTitle('♻️ Reset All Invite Stats?')
    .setDescription(
      'This wipes every tracked invite count (regular joins, bonus invites, and leave counts) for **every ' +
      "member** in this server, and forgets who invited everyone currently in the server (so future leaves " +
      "won't be attributed). This can't be undone. Are you sure?",
    )
    .setFooter({ text: 'Only visible to you.' });
}

function buildInviteTrackerResetConfirmComponents() {
  const row1 = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('panel:inviteTracker:confirmResetAll').setLabel('Yes, Reset Everything').setEmoji('⚠️').setStyle(ButtonStyle.Danger),
    new ButtonBuilder().setCustomId('panel:inviteTrackerSettings').setLabel('Cancel').setStyle(ButtonStyle.Secondary),
  );

  return [row1];
}

// ---------- Level System sub-panel (opened via the "Levels" button on Page 2) ----------
// Admin dashboard for the XP/level module. Data lives in utils/levelStore.js
// (per-guild); the builders here are pure renderers and the handler in
// panelInteractionHandler.js does the reads/writes, same as every other
// sub-panel in this file. Mirrors the standalone /panel-levels command.
function buildLevelSystemEmbed(guild, settings, defs) {
  const xpSection =
    `**Message XP:** ${settings.xpPerMessage.min}–${settings.xpPerMessage.max} (random per message)\n` +
    `**Cooldown:** ${settings.cooldownMs / 1000}s between message XP grants\n` +
    `**Voice XP:** ${settings.xpPerVoiceMin} XP/min\n` +
    `**Reaction XP:** ${settings.xpPerReaction} XP\n` +
    `**Command XP:** ${settings.xpPerCommand} XP`;

  const notifySection =
    `**DM on level-up:** ${settings.notifyDM ? '✅' : '❌'}\n` +
    `**Same channel:** ${settings.notifySameChannel ? '✅' : '❌'}\n` +
    `**Dedicated channel:** ${settings.notifyDedicatedChannel && settings.notifyChannel ? `✅ <#${settings.notifyChannel}>` : '❌'}`;

  const levelSection = defs.length
    ? defs.map((d) => `**Lv ${d.level}** — ${d.name} · ${d.xpRequired.toLocaleString()} XP${d.roleId ? ` · <@&${d.roleId}>` : ''}`).join('\n')
    : '*No levels defined.*';

  return new EmbedBuilder()
    .setColor(PREMIUM_COLORS.accent)
    .setTitle('✨ Level System')
    .setDescription('XP and ranks for your community — automatic from chat activity. Members earn XP from messages, voice time, reactions, and slash commands.')
    .addFields(
      { name: '📈 XP Settings', value: xpSection, inline: false },
      { name: '🔔 Notifications', value: notifySection, inline: false },
      { name: '🏆 Level Definitions', value: levelSection, inline: false },
    )
    .setFooter({ text: 'Only visible to you.' });
}

function buildLevelSystemComponents() {
  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('panel:levelXp').setLabel('XP Settings').setEmoji('📈').setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId('panel:levelManager').setLabel('Level Manager').setEmoji('🏆').setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId('panel:levelNotify').setLabel('Notifications').setEmoji('🔔').setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId('panel:backToMain').setLabel('Back').setEmoji('⬅️').setStyle(ButtonStyle.Secondary),
  );
  return [row];
}

function buildLevelXpSettingsEmbed(guild, settings) {
  const enabled = settings.enabled !== false;
  return new EmbedBuilder()
    .setColor(PREMIUM_COLORS.accent)
    .setTitle('📈 XP Settings')
    .setDescription('How much XP members earn per activity, and how often. These values are per-server — other servers on this bot are unaffected.')
    .addFields(
      { name: 'System Status', value: enabled ? '🟢 **ON** — members are earning XP' : '🔴 **OFF** — no XP is being awarded', inline: false },
      { name: 'Message XP Range', value: `${settings.xpPerMessage.min}–${settings.xpPerMessage.max}`, inline: true },
      { name: 'XP Cooldown', value: `${settings.cooldownMs / 1000}s`, inline: true },
      { name: 'Voice XP / min', value: `${settings.xpPerVoiceMin}`, inline: true },
      { name: 'Reaction XP', value: `${settings.xpPerReaction}`, inline: true },
      { name: 'Command XP', value: `${settings.xpPerCommand}`, inline: true },
    )
    .setFooter({ text: 'Only visible to you.' });
}

function buildLevelXpSettingsComponents(settings) {
  const enabled = settings.enabled !== false;
  const toggleBtn = new ButtonBuilder()
    .setCustomId('panel:levelToggle')
    .setLabel(enabled ? '⏻ Turn OFF Level System' : '⏻ Turn ON Level System')
    .setStyle(enabled ? ButtonStyle.Danger : ButtonStyle.Success);

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('panel:levelXpMsg').setLabel('Message XP').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId('panel:levelXpCooldown').setLabel('Cooldown').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId('panel:levelXpVoice').setLabel('Voice XP').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId('panel:levelXpReact').setLabel('Reaction XP').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId('panel:levelSystem').setLabel('Back').setEmoji('⬅️').setStyle(ButtonStyle.Danger),
  );

  const row2 = new ActionRowBuilder().addComponents(toggleBtn);
  return [row, row2];
}

function buildLevelManagerEmbed(guild, defs) {
  const listed = defs.length
    ? defs.map((d) => `**Lv ${d.level}** — ${d.name} · ${d.xpRequired.toLocaleString()} XP${d.roleId ? ` · <@&${d.roleId}>` : ''}`).join('\n')
    : '*No levels defined yet. Add one below.*';

  return new EmbedBuilder()
    .setColor(PREMIUM_COLORS.accent)
    .setTitle('🏆 Level Manager')
    .setDescription('Each level has an XP threshold, and optionally a role that\'s granted when a member reaches it.')
    .addFields({ name: `Level Definitions (${defs.length})`, value: listed })
    .setFooter({ text: 'Only visible to you.' });
}

function buildLevelManagerComponents(defs) {
  const empty = defs.length === 0;
  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('panel:levelAdd').setLabel('Add Level').setEmoji('➕').setStyle(ButtonStyle.Success),
    new ButtonBuilder().setCustomId('panel:levelEditSelectOpen').setLabel('Edit Level').setEmoji('✏️').setStyle(ButtonStyle.Secondary).setDisabled(empty),
    new ButtonBuilder().setCustomId('panel:levelDeleteSelectOpen').setLabel('Delete Level').setEmoji('🗑️').setStyle(ButtonStyle.Danger).setDisabled(empty),
    new ButtonBuilder().setCustomId('panel:levelSystem').setLabel('Back').setEmoji('⬅️').setStyle(ButtonStyle.Danger),
  );
  return [row];
}

// Shared "pick one of the existing levels" screen used by both Edit (blue) and
// Delete (red) — select menu with one option per level definition.
function buildLevelPickEmbed(title, color) {
  return new EmbedBuilder()
    .setColor(color)
    .setTitle(title)
    .setFooter({ text: 'Only visible to you.' });
}

function buildLevelPickComponents(customId, defs) {
  const select = new StringSelectMenuBuilder()
    .setCustomId(customId)
    .setPlaceholder('Choose a level…')
    .addOptions(defs.map((d) => ({
      label: `Lv ${d.level} — ${d.name}`,
      description: `${d.xpRequired.toLocaleString()} XP${d.roleId ? ' · role set' : ''}`.slice(0, 100),
      value: String(d.level),
    })));

  const cancel = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('panel:levelManager').setLabel('Cancel').setEmoji('✖️').setStyle(ButtonStyle.Secondary),
  );

  return [new ActionRowBuilder().addComponents(select), cancel];
}

function buildLevelDeleteConfirmEmbed(def) {
  return new EmbedBuilder()
    .setColor(PREMIUM_COLORS.danger)
    .setTitle('⚠️ Delete This Level?')
    .setDescription(
      `This permanently removes **Level ${def.level} — ${def.name}** (${def.xpRequired.toLocaleString()} XP) from this server. ` +
      'Members already at that level keep their XP, they just won\'t receive its role anymore.\n\n' +
      "This can't be undone. Are you sure?",
    )
    .setFooter({ text: 'Only visible to you.' });
}

function buildLevelDeleteConfirmComponents(level) {
  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`panel:levelDeleteYes:${level}`).setLabel('Yes, Delete').setEmoji('⚠️').setStyle(ButtonStyle.Danger),
    new ButtonBuilder().setCustomId('panel:levelManager').setLabel('Cancel').setStyle(ButtonStyle.Secondary),
  );
  return [row];
}

function buildLevelNotifyEmbed(guild, settings) {
  return new EmbedBuilder()
    .setColor(PREMIUM_COLORS.accent)
    .setTitle('🔔 Level-Up Notifications')
    .setDescription('Where the level-up card gets posted. Multiple destinations can be on at the same time.')
    .addFields(
      { name: 'DM the member', value: settings.notifyDM ? '✅ On' : '❌ Off', inline: true },
      { name: 'Same channel', value: settings.notifySameChannel ? '✅ On' : '❌ Off', inline: true },
      { name: 'Dedicated channel', value: settings.notifyDedicatedChannel && settings.notifyChannel ? `✅ <#${settings.notifyChannel}>` : '❌ Off', inline: true },
    )
    .setFooter({ text: 'Only visible to you.' });
}

function buildLevelNotifyComponents(settings) {
  const row1 = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId('panel:levelNotifyDm')
      .setLabel(`DM: ${settings.notifyDM ? 'ON' : 'OFF'}`)
      .setStyle(settings.notifyDM ? ButtonStyle.Success : ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId('panel:levelNotifySame')
      .setLabel(`Same Channel: ${settings.notifySameChannel ? 'ON' : 'OFF'}`)
      .setStyle(settings.notifySameChannel ? ButtonStyle.Success : ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId('panel:levelSystem').setLabel('Back').setEmoji('⬅️').setStyle(ButtonStyle.Danger),
  );
  const row2 = new ActionRowBuilder().addComponents(
    new ChannelSelectMenuBuilder()
      .setCustomId('panel:setLevelNotifyChannel')
      .setPlaceholder(settings.notifyChannel ? 'Dedicated channel set — pick another to change it' : 'Select a dedicated level-up channel (optional)')
      .addChannelTypes(ChannelType.GuildText),
  );
  return [row1, row2];
}

module.exports = {
  buildPanelPayload,
  buildPanelPage2Payload,
  buildPowerOptionsEmbed,
  buildPowerOptionsComponents,
  buildResetConfirmEmbed,
  buildResetConfirmComponents,
  buildRestartConfirmEmbed,
  buildRestartConfirmComponents,
  buildAutopostSettingsEmbed,
  buildAutopostSettingsComponents,
  buildAutopostDetailEmbed,
  buildAutopostDetailComponents,
  buildAutopostResetConfirmEmbed,
  buildAutopostResetConfirmComponents,
  buildAutopostChannelStepEmbed,
  buildAutopostChannelStepComponents,
  buildAutopostScheduleTypeStepEmbed,
  buildAutopostScheduleTypeStepComponents,
  buildAutopostHourStepEmbed,
  buildAutopostHourStepComponents,
  buildRoleRequestSettingsEmbed,
  buildRoleRequestSettingsComponents,
  buildTicketSettingsEmbed,
  buildTicketSettingsComponents,
  buildTicketEmbedResetConfirmEmbed,
  buildTicketEmbedResetConfirmComponents,
  buildWelcomeSettingsEmbed,
  buildWelcomeSettingsComponents,
  buildWelcomeEmbedResetConfirmEmbed,
  buildWelcomeEmbedResetConfirmComponents,
  buildWelcomePlaceholdersEmbed,
  buildUpcomingBoardSettingsEmbed,
  buildUpcomingBoardSettingsComponents,
  buildAutoReactSettingsEmbed,
  buildAutoReactSettingsComponents,
  buildAutoReactRuleDetailEmbed,
  buildAutoReactRuleDetailComponents,
  buildAutoReactTriggerStepEmbed,
  buildAutoReactTriggerStepComponents,
  buildAutoReactMatchModeStepEmbed,
  buildAutoReactMatchModeStepComponents,
  buildAutoReactChannelStepEmbed,
  buildAutoReactChannelStepComponents,
  buildAutoReactRemoveConfirmEmbed,
  buildAutoReactRemoveConfirmComponents,
  buildTempVcSettingsEmbed,
  buildTempVcSettingsComponents,
  buildInviteTrackerSettingsEmbed,
  buildInviteTrackerSettingsComponents,
  buildInviteTrackerResetConfirmEmbed,
  buildInviteTrackerResetConfirmComponents,
  buildReactionApprovalSettingsEmbed,
  buildReactionApprovalSettingsComponents,
  buildGiveawaySettingsEmbed,
  buildGiveawaySettingsComponents,
  buildGiveawayDetailEmbed,
  buildGiveawayDetailComponents,
  buildGiveawayDeleteConfirmEmbed,
  buildGiveawayDeleteConfirmComponents,
  buildGiveawayChannelStepEmbed,
  buildGiveawayChannelStepComponents,
  buildGiveawayTemplateEmbed,
  buildGiveawayTemplateComponents,
  buildStatsPanelPickerEmbed,
  buildStatsPanelPickerComponents,
  buildStatsPanelDetailComponents,
  buildStatsPanelClearConfirmEmbed,
  buildStatsPanelClearConfirmComponents,
  buildLevelSystemEmbed,
  buildLevelSystemComponents,
  buildLevelXpSettingsEmbed,
  buildLevelXpSettingsComponents,
  buildLevelManagerEmbed,
  buildLevelManagerComponents,
  buildLevelPickEmbed,
  buildLevelPickComponents,
  buildLevelDeleteConfirmEmbed,
  buildLevelDeleteConfirmComponents,
  buildLevelNotifyEmbed,
  buildLevelNotifyComponents,
};
