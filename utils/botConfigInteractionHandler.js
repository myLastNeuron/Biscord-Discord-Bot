const {
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  ActionRowBuilder,
  PermissionFlagsBits,
} = require('discord.js');
const { getBotConfig, setBotConfig } = require('./botConfigStore');
const { buildBotConfigPayload } = require('./botConfigBuilder');

// CustomId families this handler owns. The standalone /bot-config command uses
// `botconfig:*`; inside /panel > Bot Config the same builders run under
// `panel:botConfig:*` so the panel's ManageGuild gate protects them too.
const BOTCONFIG_LEGACY_PREFIX = 'botconfig';
const BOTCONFIG_PANEL_PREFIX = 'panel:botConfig';

// Strips a known prefix, returning just the action part (e.g. "statusSelect",
// "activityTypeSelect", "refresh", "usernameModal", "avatarModal").
function botConfigSubId(customId) {
  for (const prefix of [BOTCONFIG_LEGACY_PREFIX, BOTCONFIG_PANEL_PREFIX]) {
    const marker = `${prefix}:`;
    if (typeof customId === 'string' && customId.startsWith(marker)) {
      return customId.slice(marker.length);
    }
  }
  return null;
}

// discord.js ActivityType enum values (avoids importing ActivityType just for
// this lookup) - used when applying the saved activityType to setPresence().
const BOTCONFIG_ACTIVITY_TYPE_MAP = {
  Playing: 0,
  Listening: 2,
  Watching: 3,
  Custom: 4,
  Competing: 5,
};

// Pushes the current botConfig.json values to Discord via setPresence().
// Called after every status/activity change so the bot's live presence
// always matches what's saved - also reused by ready.js on startup/reconnect
// if that file is wired up to call it (see README note).
function applyBotPresence(client, config) {
  const presence = { status: config.status || 'online', activities: [] };
  if (config.activityType && config.activityText) {
    const type = BOTCONFIG_ACTIVITY_TYPE_MAP[config.activityType] ?? 0;
    presence.activities = [{ name: config.activityText, type }];
  }
  client.user.setPresence(presence);
}

// Small label lookup used only in the activity-text modal submit reply below
// - separate from botConfigBuilder's internal map since this one's just for
// human-readable confirmation text, not for rendering the panel.
function ACTIVITY_TYPE_LABELS_FOR_REPLY(activityType) {
  const labels = { Playing: 'Playing', Watching: 'Watching', Listening: 'Listening to', Competing: 'Competing in', Custom: '' };
  return labels[activityType] ?? activityType;
}

// All /bot-config panel interactions: presence status select, activity type
// select + text modal, username edit + modal, avatar edit + modal, refresh.
// Handles both the standalone /bot-config command (botconfig:*) and the
// sub-panel opened from /panel > Bot Config (panel:botConfig:*).
async function handleBotConfigInteraction(interaction) {
  const subId = botConfigSubId(interaction.customId);
  if (subId === null) return false;

  // When reached from /panel, the dashboard only guarantees ManageGuild —
  // editing the bot's global username/avatar/presence is bot-wide, so keep
  // the same Administrator bar /bot-config command enforces.
  const isPanelSession = String(interaction.customId).startsWith(`${BOTCONFIG_PANEL_PREFIX}:`);
  if (isPanelSession && !interaction.memberPermissions?.has(PermissionFlagsBits.Administrator)) {
    if (interaction.isRepliable()) {
      await interaction.reply({
        content: 'You need **Administrator** permission to change the bot\'s profile and presence.',
        ephemeral: true,
      }).catch(() => null);
    }
    return true;
  }

  // ---------- presence status select ----------
  if (interaction.isStringSelectMenu() && subId === 'statusSelect') {
    const config = setBotConfig({ status: interaction.values[0] });
    applyBotPresence(interaction.client, config);
    await interaction.update(buildBotConfigPayload(config, interaction.client, String(interaction.customId).startsWith(`${BOTCONFIG_PANEL_PREFIX}:`) ? BOTCONFIG_PANEL_PREFIX : BOTCONFIG_LEGACY_PREFIX));
    return true;
  }

  // ---------- activity type select ----------
  // "Clear Activity" applies immediately; every other option needs the
  // activity text, which only fits in a modal (select menus are text-free).
  if (interaction.isStringSelectMenu() && subId === 'activityTypeSelect') {
    const chosen = interaction.values[0];

    if (chosen === 'clear') {
      const config = setBotConfig({ activityType: null, activityText: '' });
      applyBotPresence(interaction.client, config);
      await interaction.update(buildBotConfigPayload(config, interaction.client, isPanelSession ? BOTCONFIG_PANEL_PREFIX : BOTCONFIG_LEGACY_PREFIX));
      return true;
    }

    const modal = new ModalBuilder()
      .setCustomId(`${isPanelSession ? BOTCONFIG_PANEL_PREFIX : BOTCONFIG_LEGACY_PREFIX}:activityTextModal:${chosen}`)
      .setTitle(`Set "${chosen}" Activity`);

    const textInput = new TextInputBuilder()
      .setCustomId('activityText')
      .setLabel('Activity text')
      .setStyle(TextInputStyle.Short)
      .setPlaceholder(chosen === 'Custom' ? 'e.g. Ask me anything!' : 'e.g. with your server')
      .setValue(getBotConfig().activityText || '')
      .setRequired(true)
      .setMaxLength(128);

    modal.addComponents(new ActionRowBuilder().addComponents(textInput));
    await interaction.showModal(modal);
    return true;
  }

  // ---------- activity text modal submit ----------
  if (interaction.isModalSubmit() && subId.startsWith('activityTextModal:')) {
    const activityType = subId.split(':')[1];
    const activityText = interaction.fields.getTextInputValue('activityText').trim();

    if (!activityText) {
      await interaction.reply({ content: 'Activity text cannot be empty.', ephemeral: true });
      return true;
    }

    const config = setBotConfig({ activityType, activityText });
    applyBotPresence(interaction.client, config);

    await interaction.reply({
      content: `✅ Activity set to "${ACTIVITY_TYPE_LABELS_FOR_REPLY(activityType)} ${activityText}". Run \`/bot-config\` again to see the updated panel.`,
      ephemeral: true,
    });
    return true;
  }

  // ---------- edit username button ----------
  if (interaction.isButton() && subId === 'editUsername') {
    const modal = new ModalBuilder()
      .setCustomId(`${isPanelSession ? BOTCONFIG_PANEL_PREFIX : BOTCONFIG_LEGACY_PREFIX}:usernameModal`)
      .setTitle('Change Bot Username');

    const usernameInput = new TextInputBuilder()
      .setCustomId('username')
      .setLabel('New username')
      .setStyle(TextInputStyle.Short)
      .setPlaceholder(interaction.client.user.username)
      .setValue(interaction.client.user.username)
      .setRequired(true)
      .setMinLength(2)
      .setMaxLength(32);

    modal.addComponents(new ActionRowBuilder().addComponents(usernameInput));
    await interaction.showModal(modal);
    return true;
  }

  // ---------- username modal submit ----------
  // Discord heavily rate-limits username changes (2 per hour) - surface
  // that specific failure clearly instead of a generic error.
  if (interaction.isModalSubmit() && subId === 'usernameModal') {
    const newUsername = interaction.fields.getTextInputValue('username').trim();

    if (newUsername === interaction.client.user.username) {
      await interaction.reply({ content: 'That\u2019s already the bot\u2019s current username.', ephemeral: true });
      return true;
    }

    await interaction.deferReply({ ephemeral: true });

    try {
      const updatedUser = await interaction.client.user.setUsername(newUsername);
      setBotConfig({ lastUsername: updatedUser.username });
      await interaction.editReply({ content: `✅ Username changed to **${updatedUser.username}**.` });
    } catch (err) {
      const rateLimited = err?.code === 50035 || /rate.?limit/i.test(err?.message || '');
      console.error('[bot-config] setUsername failed:', err);
      await interaction.editReply({
        content: rateLimited
          ? '⏳ Discord rate-limits username changes to 2 per hour — try again later.'
          : `❌ Couldn't change the username: ${err.message || 'unknown error'}`,
      });
    }
    return true;
  }

  // ---------- edit avatar button ----------
  if (interaction.isButton() && subId === 'editAvatar') {
    const modal = new ModalBuilder()
      .setCustomId(`${isPanelSession ? BOTCONFIG_PANEL_PREFIX : BOTCONFIG_LEGACY_PREFIX}:avatarModal`)
      .setTitle('Change Bot Avatar');

    const urlInput = new TextInputBuilder()
      .setCustomId('avatarUrl')
      .setLabel('Direct image URL (png/jpg/gif)')
      .setStyle(TextInputStyle.Short)
      .setPlaceholder('https://example.com/image.png')
      .setRequired(true);

    modal.addComponents(new ActionRowBuilder().addComponents(urlInput));
    await interaction.showModal(modal);
    return true;
  }

  // ---------- avatar modal submit ----------
  if (interaction.isModalSubmit() && subId === 'avatarModal') {
    const avatarUrl = interaction.fields.getTextInputValue('avatarUrl').trim();

    if (!/^https?:\/\/.+\.(png|jpe?g|gif|webp)(\?.*)?$/i.test(avatarUrl)) {
      await interaction.reply({
        content: '❌ That doesn\u2019t look like a direct image URL (must end in .png, .jpg, .jpeg, .gif, or .webp).',
        ephemeral: true,
      });
      return true;
    }

    await interaction.deferReply({ ephemeral: true });

    try {
      await interaction.client.user.setAvatar(avatarUrl);
      setBotConfig({ lastAvatarUrl: avatarUrl });
      await interaction.editReply({ content: '✅ Avatar updated.' });
    } catch (err) {
      console.error('[bot-config] setAvatar failed:', err);
      await interaction.editReply({
        content: `❌ Couldn't change the avatar: ${err.message || 'unknown error'}. Make sure the URL is a direct, publicly accessible image link.`,
      });
    }
    return true;
  }

  // ---------- refresh button ----------
  if (interaction.isButton() && subId === 'refresh') {
    const config = getBotConfig();
    await interaction.update(buildBotConfigPayload(config, interaction.client, isPanelSession ? BOTCONFIG_PANEL_PREFIX : BOTCONFIG_LEGACY_PREFIX));
    return true;
  }

  return false;
}

module.exports = { handleBotConfigInteraction, applyBotPresence };
