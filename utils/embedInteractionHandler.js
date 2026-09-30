const {
  buildEmbedFromDraft,
  buildLiveButtonRows,
  buildPanelComponents,
  buildGuideText,
  buildModal,
  parseColor,
  isValidUrl,
  CID,
  buildRoleSelectMenu,
  buildStyleSelectMenu,
  buildButtonManageSelect,
  buildReactionManageSelect,
  BUTTON_STYLES,
} = require('./embedBuilder');
const sessionStore = require('./embedSessionStore');
const templateStore = require('./embedTemplateStore');
const { setGuildSettings } = require('./db');

const {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
} = require('discord.js');

// Maps a ticket session's purpose suffix ('panel'/'opened'/'close') to the
// guildSettings field its draft gets saved into. Kept here (rather than in
// interactionCreate.js) so the save button and the field name can't drift
// apart from each other.
const TICKET_EMBED_FIELDS = {
  panel: 'ticketPanelEmbedDraft',
  opened: 'ticketOpenedEmbedDraft',
  close: 'ticketCloseEmbedDraft',
};

// The welcome embed doesn't have sub-kinds like tickets do (just one embed,
// session.purpose === 'welcome' exactly) so it gets its own single field
// rather than a slot in TICKET_EMBED_FIELDS.
const WELCOME_EMBED_FIELD = 'welcomeEmbedDraft';

const TICKET_EMBED_USAGE_HINT = {
  panel: 'whenever `/ticket panel` posts the panel',
  opened: 'whenever a new ticket channel is opened',
  close: 'on the transcript message sent when a ticket is closed',
};

async function refreshPanel(interaction, session) {
  const embed = buildEmbedFromDraft(session.draft);
  const components = buildPanelComponents(session);
  await interaction.editReply({
    content: buildGuideText(session),
    embeds: [embed],
    components,
  });
}

// Public entry point - wraps the real handler so that ANY error (bad user
// input, a Discord API rejection, a bug in this file) shows up as a normal
// "something went wrong" reply instead of an uncaught exception that takes
// the whole bot process down.
async function handleEmbedInteraction(interaction) {
  try {
    return await handleEmbedInteractionInner(interaction);
  } catch (err) {
    console.error('[embedInteractionHandler] Unhandled error:', err);
    const msg = { content: 'Something went wrong with the embed builder. Your progress so far is still saved.', ephemeral: true };
    try {
      if (interaction.deferred || interaction.replied) await interaction.followUp(msg);
      else if (interaction.isRepliable()) await interaction.reply(msg);
    } catch {
      // interaction is unrecoverable (e.g. already expired) - nothing more we can do
    }
    return true; // we own this interaction either way, don't let other handlers touch it
  }
}

// Returns true if this interaction was handled here, so the caller knows
// not to fall through to other handlers.
async function handleEmbedInteractionInner(interaction) {
  const customId = interaction.customId;
  if (!customId) return false;

  // ---- Stateless live role-toggle button on a *sent* embed ----
  if (interaction.isButton() && customId.startsWith('embedbtn:role:')) {
    const roleId = customId.split(':')[2];
    const member = interaction.member;

    // Safety guards: refuse to toggle roles that can't or shouldn't be
    // self-assigned — @everyone, integration/managed roles (e.g. bot roles),
    // or roles this bot can't actually manage.
    const role = interaction.guild.roles.cache.get(roleId);
    if (!role || role.id === interaction.guild.id || role.managed) {
      await interaction.reply({
        content: "I can't toggle that role.",
        ephemeral: true,
      }).catch(() => null);
      return true;
    }

    try {
      if (member.roles.cache.has(roleId)) {
        await member.roles.remove(roleId);
        await interaction.reply({ content: `Removed <@&${roleId}>.`, ephemeral: true });
      } else {
        await member.roles.add(roleId);
        await interaction.reply({ content: `Gave you <@&${roleId}>.`, ephemeral: true });
      }
    } catch (err) {
      await interaction.reply({
        content: 'I couldn\'t change that role - check my role position and permissions.',
        ephemeral: true,
      });
    }
    return true;
  }

  // Everything below this line only applies to the builder panel itself,
  // namespaced under "embedbuilder:"
  if (!customId.startsWith(`${CID}:`)) return false;

  const session = sessionStore.getSession(interaction.user.id);
  if (!session) {
    const msg = { content: 'This builder session expired. Run `/embed new` again.', ephemeral: true };
    if (interaction.isRepliable()) {
      interaction.deferred || interaction.replied
        ? await interaction.followUp(msg)
        : await interaction.reply(msg);
    }
    return true;
  }

  // ---- Content select menu (edit the embed's main content) ----
  if (interaction.isStringSelectMenu() && customId === `${CID}:content`) {
    const value = interaction.values[0];
    if (value === 'timestamp') {
      sessionStore.updateSession(interaction.user.id, (s) => { s.draft.timestamp = !s.draft.timestamp; });
      await interaction.deferUpdate();
      await refreshPanel(interaction, sessionStore.getSession(interaction.user.id));
      return true;
    }
    await interaction.showModal(buildModal(value, session));
    return true;
  }

  // ---- Add select menu (new fields / buttons / reactions) ----
  if (interaction.isStringSelectMenu() && customId === `${CID}:add`) {
    const value = interaction.values[0];
    if (value === 'field') {
      await interaction.showModal(buildModal('add_field'));
      return true;
    }
    if (value === 'link') {
      await interaction.showModal(buildModal('add_link_button'));
      return true;
    }
    if (value === 'role') {
      await showRoleSelectForButton(interaction);
      return true;
    }
    if (value === 'reaction') {
      await interaction.showModal(buildModal('add_reaction'));
      return true;
    }
    return true;
  }

  // ---- Manage select menu (edit / remove existing items) ----
  if (interaction.isStringSelectMenu() && customId === `${CID}:manage`) {
    const value = interaction.values[0];
    if (value === 'fields') {
      await showFieldManager(interaction, session);
      return true;
    }
    if (value === 'buttons') {
      await showButtonManager(interaction, session);
      return true;
    }
    if (value === 'reactions') {
      await showReactionManager(interaction, session);
      return true;
    }
    if (value === 'clear') {
      sessionStore.updateSession(interaction.user.id, (s) => { s.draft.fields = []; });
      await interaction.deferUpdate();
      await refreshPanel(interaction, sessionStore.getSession(interaction.user.id));
      return true;
    }
    return true;
  }

  // ---- Role select for button ----
  if (interaction.isRoleSelectMenu() && customId === `${CID}:role_select`) {
    const roleId = interaction.values[0];
    sessionStore.updateSession(interaction.user.id, (s) => {
      s._pendingButton = { roleId, label: null, style: 'Primary', emoji: null };
    });
    // Just show the modal - the user knows which role they selected
    await interaction.showModal(buildModal('add_role_button'));
    return true;
  }

  // ---- Button manage select ----
  if (interaction.isStringSelectMenu() && customId === `${CID}:button_manage_select`) {
    const idx = parseInt(interaction.values[0], 10);
    const btn = session.draft.buttons[idx];
    if (!btn) {
      await interaction.reply({ content: 'Button not found.', ephemeral: true });
      return true;
    }
    await showButtonEditMenu(interaction, session, idx);
    return true;
  }

  // ---- Button edit/remove actions ----
  if (interaction.isButton() && customId.startsWith(`${CID}:button_edit:`)) {
    const idx = parseInt(customId.split(':')[2], 10);
    sessionStore.updateSession(interaction.user.id, (s) => { s._editingButtonIdx = idx; });
    const updatedSession = sessionStore.getSession(interaction.user.id);
    await interaction.showModal(buildModal('edit_button', updatedSession));
    return true;
  }

  if (interaction.isButton() && customId.startsWith(`${CID}:button_remove:`)) {
    const idx = parseInt(customId.split(':')[2], 10);
    sessionStore.updateSession(interaction.user.id, (s) => { s.draft.buttons.splice(idx, 1); });
    await interaction.deferUpdate();
    await refreshPanel(interaction, sessionStore.getSession(interaction.user.id));
    return true;
  }

  if (interaction.isButton() && customId === `${CID}:button_back`) {
    await interaction.deferUpdate();
    await refreshPanel(interaction, session);
    return true;
  }

  // ---- Reaction manage select ----
  if (interaction.isStringSelectMenu() && customId === `${CID}:reaction_manage_select`) {
    const idx = parseInt(interaction.values[0], 10);
    sessionStore.updateSession(interaction.user.id, (s) => { s.draft.reactions.splice(idx, 1); });
    await interaction.deferUpdate();
    const newSession = sessionStore.getSession(interaction.user.id);
    if (newSession.draft.reactions.length > 0) {
      await showReactionManager(interaction, newSession);
    } else {
      await refreshPanel(interaction, newSession);
    }
    return true;
  }

  // ---- Field manage select ----
  if (interaction.isStringSelectMenu() && customId === `${CID}:field_manage_select`) {
    const idx = parseInt(interaction.values[0], 10);
    sessionStore.updateSession(interaction.user.id, (s) => { s.draft.fields.splice(idx, 1); });
    await interaction.deferUpdate();
    const newSession = sessionStore.getSession(interaction.user.id);
    if (newSession.draft.fields.length > 0) {
      await showFieldManager(interaction, newSession);
    } else {
      await refreshPanel(interaction, newSession);
    }
    return true;
  }

  // ---- Panel action buttons ----
  if (interaction.isButton() && customId === `${CID}:cancel`) {
    sessionStore.deleteSession(interaction.user.id);
    await interaction.update({ content: 'Builder cancelled.', embeds: [], components: [] });
    return true;
  }

  if (interaction.isButton() && customId === `${CID}:save`) {
    await interaction.showModal(buildModal('save_template', session));
    return true;
  }

  if (interaction.isButton() && customId === `${CID}:sendnow`) {
    await interaction.deferUpdate();
    await sendDraft(interaction, session);
    return true;
  }

  // ---- Update Message (edit session primary action) ----
  if (interaction.isButton() && customId === `${CID}:updatenow`) {
    await interaction.deferUpdate();
    await updateDraft(interaction, session);
    return true;
  }

  if (interaction.isButton() && customId === `${CID}:saveSettings`) {
    await interaction.deferUpdate();
    await saveSettingsDraft(interaction, session);
    return true;
  }

  // ---- Modal submissions ----
  if (interaction.isModalSubmit() && customId.startsWith(`${CID}:modal:`)) {
    const kind = customId.split(':')[2];
    await handleModalSubmit(interaction, kind, session);
    return true;
  }

  return false;
}

// ---- Helper functions for multi-step flows ----

async function showRoleSelectForButton(interaction) {
  const row = buildRoleSelectMenu(`${CID}:role_select`);
  const cancelButton = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`${CID}:button_back`)
      .setLabel('Cancel')
      .setStyle(ButtonStyle.Secondary)
  );
  // NOTE: this must be .update() (like showButtonManager/showReactionManager/
  // showFieldManager below), not .reply(). .reply() would spawn a brand new
  // ephemeral message instead of editing the existing builder panel - the
  // later modal-submit's refreshPanel() would then update that *new* message,
  // leaving the original panel stuck showing stale components (e.g. never
  // gaining the "Edit/Remove Buttons" option after a role button is added).
  await interaction.update({
    content: '**Select a role for the button:**',
    embeds: [],
    components: [row, cancelButton],
  });
}

async function showButtonManager(interaction, session) {
  const selectRow = buildButtonManageSelect(session);
  if (!selectRow) {
    await interaction.reply({ content: 'No buttons to manage.', ephemeral: true });
    return;
  }
  const backButton = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`${CID}:button_back`)
      .setLabel('Back')
      .setStyle(ButtonStyle.Secondary)
  );
  await interaction.update({
    content: '**Select a button to edit or remove:**',
    embeds: [],
    components: [selectRow, backButton],
  });
}

async function showButtonEditMenu(interaction, session, idx) {
  const btn = session.draft.buttons[idx];
  const typeLabel = btn.type === 'link' ? 'Link Button' : 'Role Button';
  const target = btn.type === 'link' ? btn.url : `<@&${btn.roleId}>`;
  const styleLabel = BUTTON_STYLES.find(s => s.value === btn.style)?.label || btn.style;

  const editBtn = new ButtonBuilder()
    .setCustomId(`${CID}:button_edit:${idx}`)
    .setLabel('Edit Label/Style')
    .setStyle(ButtonStyle.Primary)
    .setEmoji('✏️');

  const removeBtn = new ButtonBuilder()
    .setCustomId(`${CID}:button_remove:${idx}`)
    .setLabel('Remove')
    .setStyle(ButtonStyle.Danger)
    .setEmoji('🗑️');

  const backBtn = new ButtonBuilder()
    .setCustomId(`${CID}:button_back`)
    .setLabel('Back')
    .setStyle(ButtonStyle.Secondary);

  await interaction.update({
    content: `**${typeLabel} #${idx + 1}**\n• Label: ${btn.label}\n• Target: ${target}\n• Style: ${styleLabel}${btn.emoji ? `\n• Emoji: ${btn.emoji}` : ''}`,
    embeds: [],
    components: [
      new ActionRowBuilder().addComponents(editBtn, removeBtn),
      new ActionRowBuilder().addComponents(backBtn),
    ],
  });
}

async function showReactionManager(interaction, session) {
  const selectRow = buildReactionManageSelect(session);
  if (!selectRow) {
    await interaction.reply({ content: 'No reactions to manage.', ephemeral: true });
    return;
  }
  const backButton = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`${CID}:button_back`)
      .setLabel('Back')
      .setStyle(ButtonStyle.Secondary)
  );
  await interaction.update({
    content: '**Select a reaction to remove:**',
    embeds: [],
    components: [selectRow, backButton],
  });
}

async function showFieldManager(interaction, session) {
  const fields = session.draft.fields;
  if (!fields.length) {
    await interaction.reply({ content: 'No fields to manage.', ephemeral: true });
    return;
  }

  const selectMenu = new ActionRowBuilder().addComponents(
    new (require('discord.js').StringSelectMenuBuilder)()
      .setCustomId(`${CID}:field_manage_select`)
      .setPlaceholder('Select a field to remove...')
      .addOptions(fields.map((f, i) => ({
        label: f.name.slice(0, 25),
        value: String(i),
        description: f.value.slice(0, 50),
      })))
  );

  const backButton = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`${CID}:button_back`)
      .setLabel('Back')
      .setStyle(ButtonStyle.Secondary)
  );

  await interaction.update({
    content: `**${fields.length} field(s)** - Select one to remove:`,
    embeds: [],
    components: [selectMenu, backButton],
  });
}

// A single %placeholder% token used as a whole URL value (e.g. "%userAvatar%"
// for the thumbnail field) - deliberately NOT "contains a %token% anywhere",
// since a URL field needs to resolve to one complete URL, not text with a
// token embedded in it.
const PLACEHOLDER_TOKEN = /^%[a-zA-Z]+%$/;

async function handleModalSubmit(interaction, kind, session) {
  const f = (id) => interaction.fields.getTextInputValue(id)?.trim() || null;

  // Only the welcome embed actually resolves %placeholders% before sending
  // (see resolveDraftPlaceholders in welcomeBuilder.js) - ticket/normal
  // embeds have no such resolution step, so a %token% saved into one of
  // those would just render as broken literal text forever. Scope the
  // allowance to welcome only.
  const allowPlaceholderUrls = session.purpose === 'welcome';

  // Collects the names of any URL-type fields that got rejected, so we can
  // tell the user what happened instead of just silently dropping them.
  const rejected = [];
  // Collects any %placeholder% tokens that got accepted as a URL, so we can
  // explain why the live preview below won't actually show that image (no
  // real member to resolve it against yet).
  const placeholderUrls = [];
  const urlOrNull = (id, label) => {
    const value = f(id);
    if (allowPlaceholderUrls && value && PLACEHOLDER_TOKEN.test(value)) {
      placeholderUrls.push(`${label} (${value})`);
      return value;
    }
    if (isValidUrl(value)) return value;
    rejected.push(label);
    return null;
  };

  let buttonRejected = null;

  sessionStore.updateSession(interaction.user.id, (s) => {
    const d = s.draft;
    switch (kind) {
      case 'basic':
        d.title = f('title');
        d.description = f('description');
        d.color = parseColor(f('color'));
        d.url = d.title ? urlOrNull('url', 'Title URL') : null;
        break;
      case 'author':
        d.author = {
          name: f('name'),
          iconURL: urlOrNull('iconURL', 'Author Icon URL'),
          url: urlOrNull('url', 'Author URL'),
        };
        break;
      case 'footer':
        d.footer = { text: f('text'), iconURL: urlOrNull('iconURL', 'Footer Icon URL') };
        break;
      case 'images':
        d.thumbnail = urlOrNull('thumbnail', 'Thumbnail URL');
        d.image = urlOrNull('image', 'Image URL');
        break;
      case 'add_field': {
        const name = f('name');
        const value = f('value');
        const inline = (f('inline') || '').toLowerCase().startsWith('y');
        if (name && value) d.fields.push({ name, value, inline });
        break;
      }
      case 'add_reaction': {
        const emoji = f('emoji');
        if (emoji) d.reactions.push(emoji);
        break;
      }
      case 'add_link_button': {
        const label = f('label');
        const url = f('url');
        const emoji = f('emoji');
        if (!label || !url) {
          buttonRejected = 'Label and URL are required.';
          break;
        }
        if (!isValidUrl(url)) {
          buttonRejected = `"${url}" isn't a valid URL (must start with http:// or https://).`;
          break;
        }
        d.buttons.push({ type: 'link', label, url, emoji: emoji || undefined });
        break;
      }
      case 'add_role_button': {
        const label = f('label');
        const styleInput = f('style');
        const emoji = f('emoji');

        // Get the role ID from the pending button (set when role was selected)
        const pending = s._pendingButton;
        const roleId = pending?.roleId;

        if (!roleId) {
          buttonRejected = 'No role selected. Please use the role selector first.';
          break;
        }
        if (!label) {
          buttonRejected = 'Button label is required.';
          break;
        }

        // Normalize style input - accept any case
        const normalizedStyle = styleInput ? styleInput.charAt(0).toUpperCase() + styleInput.slice(1).toLowerCase() : 'Primary';
        const validStyles = ['Primary', 'Secondary', 'Success', 'Danger'];
        const style = validStyles.includes(normalizedStyle) ? normalizedStyle : 'Primary';

        d.buttons.push({ type: 'role', label, roleId, style, emoji: emoji || undefined });
        s._pendingButton = null;
        break;
      }
      case 'edit_button': {
        const idx = s._editingButtonIdx;
        if (idx === undefined || idx === null) {
          buttonRejected = 'Lost track of which button to edit.';
          break;
        }
        const label = f('label');
        const target = f('target');
        const styleInput = f('style');
        const emoji = f('emoji');

        const oldBtn = d.buttons[idx];
        if (!oldBtn) {
          buttonRejected = 'Button not found.';
          break;
        }

        if (!label || !target) {
          buttonRejected = 'Label and target are required.';
          break;
        }

        const style = styleInput && ['Primary', 'Secondary', 'Success', 'Danger'].includes(styleInput)
          ? styleInput
          : oldBtn.style || 'Primary';

        if (oldBtn.type === 'link') {
          if (!isValidUrl(target)) {
            buttonRejected = `"${target}" isn't a valid URL.`;
            break;
          }
          d.buttons[idx] = { type: 'link', label, url: target, style, emoji: emoji || undefined };
        } else {
          d.buttons[idx] = { type: 'role', label, roleId: target, style, emoji: emoji || undefined };
        }
        s._editingButtonIdx = null;
        break;
      }
    }
  });

  if (buttonRejected) {
    await interaction.reply({ content: `Button not saved: ${buttonRejected}`, ephemeral: true });
    return;
  }

  if (kind === 'save_template') {
    const name = interaction.fields.getTextInputValue('name')?.trim();
    if (name) {
      const s = sessionStore.getSession(interaction.user.id);
      templateStore.saveTemplate(s.guildId, name, {
        embed: s.draft,
        reactions: s.draft.reactions,
        buttons: s.draft.buttons,
        createdBy: interaction.user.id,
      });
      sessionStore.updateSession(interaction.user.id, (s2) => { s2.name = name; });
      await interaction.reply({ content: `Saved template **${name}**.`, ephemeral: true });
      return;
    }
  }

  // deferUpdate first - followUp requires the interaction to already be
  // deferred or replied to, so the URL-rejection note has to come after this.
  await interaction.deferUpdate();

  if (rejected.length) {
    await interaction.followUp({
      content: `Note: ${rejected.join(', ')} ${rejected.length > 1 ? 'were' : 'was'} not a valid URL and got skipped. Everything else was saved.`,
      ephemeral: true,
    }).catch(() => null);
  }

  if (placeholderUrls.length) {
    await interaction.followUp({
      content: `Saved ${placeholderUrls.join(', ')} — it won't show in this preview (there's no real member to resolve it against yet), but it'll render correctly in the actual welcome message.`,
      ephemeral: true,
    }).catch(() => null);
  }

  await refreshPanel(interaction, sessionStore.getSession(interaction.user.id));
}

async function sendDraft(interaction, session) {
  const embed = buildEmbedFromDraft(session.draft);
  const buttonRows = buildLiveButtonRows(session.draft.buttons);

  const channel = await interaction.client.channels.fetch(session.channelId);
  const sentMessage = await channel.send({ embeds: [embed], components: buttonRows });

  for (const emoji of session.draft.reactions) {
    try {
      await sentMessage.react(emoji);
    } catch (err) {
      console.error(`[embedBuilder] Failed to react with ${emoji}:`, err.message);
    }
  }

  sessionStore.deleteSession(interaction.user.id);
  await interaction.editReply({
    content: `Sent to <#${session.channelId}>.`,
    embeds: [],
    components: [],
  });
}

// Patch an existing message with the current draft.
// Called when the user clicks "Update Message" in an edit session
// (session.editMessageId is set). Fetches the original message, calls
// message.edit() with the new embed + buttons, then closes the session.
//
// Reactions are intentionally NOT synced here: Discord provides no API to
// remove all reactions and re-add them atomically, and partially-updated
// reactions look worse than stale ones. If the user needs to change
// reactions, they should delete and re-send.
async function updateDraft(interaction, session) {
  const { editMessageId, editChannelId, channelId } = session;

  // editChannelId is the channel the original message lives in;
  // channelId is where the builder panel was opened (may differ).
  const targetChannelId = editChannelId ?? channelId;

  let targetChannel;
  try {
    targetChannel = await interaction.client.channels.fetch(targetChannelId);
  } catch (err) {
    sessionStore.deleteSession(interaction.user.id);
    await interaction.editReply({
      content: `Couldn't find the channel (<#${targetChannelId}>). The session has been closed.`,
      embeds: [],
      components: [],
    });
    return;
  }

  let targetMessage;
  try {
    targetMessage = await targetChannel.messages.fetch(editMessageId);
  } catch (err) {
    sessionStore.deleteSession(interaction.user.id);
    await interaction.editReply({
      content: `Couldn't find message \`${editMessageId}\` in <#${targetChannelId}>. It may have been deleted. The session has been closed.`,
      embeds: [],
      components: [],
    });
    return;
  }

  // Verify the bot authored the message - we can only edit our own messages.
  if (targetMessage.author.id !== interaction.client.user.id) {
    sessionStore.deleteSession(interaction.user.id);
    await interaction.editReply({
      content: `That message wasn't sent by me, so I can't edit it. The session has been closed.`,
      embeds: [],
      components: [],
    });
    return;
  }

  const embed = buildEmbedFromDraft(session.draft);
  const buttonRows = buildLiveButtonRows(session.draft.buttons);

  try {
    await targetMessage.edit({ embeds: [embed], components: buttonRows });
  } catch (err) {
    console.error('[embedBuilder] Failed to edit message:', err);
    // Don't close the session - the user's work is still there and they can try again.
    await interaction.editReply({
      content: `Failed to update the message (Discord returned: ${err.message}). Your draft is still open.`,
      embeds: [buildEmbedFromDraft(session.draft)],
      components: buildPanelComponents(session),
    });
    return;
  }

  sessionStore.deleteSession(interaction.user.id);
  await interaction.editReply({
    content: `Updated [the message](https://discord.com/channels/${session.guildId}/${targetChannelId}/${editMessageId}) in <#${targetChannelId}>.`,
    embeds: [],
    components: [],
  });
}

// "Save & Use" counterpart to sendDraft() - the draft doesn't get posted
// anywhere right now, it gets saved so the relevant system renders it later
// (ticket panel/opened/close message, or the join welcome message). Covers
// both ticket embeds (session.purpose = 'ticket:panel'|'ticket:opened'|
// 'ticket:close') and the welcome embed (session.purpose = 'welcome') -
// they're different enough in "how many kinds" to need separate branches,
// but identical in what actually happens: the whole draft (including any
// attached buttons) gets written straight into guildSettings.
async function saveSettingsDraft(interaction, session) {
  if (session.purpose === 'welcome') {
    setGuildSettings(session.guildId, { [WELCOME_EMBED_FIELD]: session.draft });
    sessionStore.deleteSession(interaction.user.id);
    await interaction.editReply({
      content: 'Saved. This embed (and any attached buttons) will now be used for the welcome message when someone joins. ' +
        'Run `/welcome test` any time to preview it with placeholders filled in.',
      embeds: [],
      components: [],
    });
    return;
  }

  const kind = typeof session.purpose === 'string' ? session.purpose.split(':')[1] : null;
  const field = TICKET_EMBED_FIELDS[kind];

  if (!field) {
    sessionStore.deleteSession(interaction.user.id);
    await interaction.editReply({
      content: "Couldn't tell which embed this was for, so nothing was saved. Please reopen it from the relevant settings panel.",
      embeds: [],
      components: [],
    });
    return;
  }

  setGuildSettings(session.guildId, { [field]: session.draft });
  sessionStore.deleteSession(interaction.user.id);

  await interaction.editReply({
    content: `Saved. This embed will now be used ${TICKET_EMBED_USAGE_HINT[kind]}.`,
    embeds: [],
    components: [],
  });
}

module.exports = { handleEmbedInteraction };
