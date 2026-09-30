// Bot Config handlers: botconfig:statusSelect, botconfig:activityTypeSelect,
// botconfig:activityTextModal, botconfig:editUsername, botconfig:usernameModal,
// botconfig:editAvatar, botconfig:avatarModal, botconfig:refresh

const {
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  PermissionFlagsBits,
  MessageFlags,
} = require('discord.js');
const { getBotConfig, setBotConfig } = require('../utils/botConfigStore');
const { buildBotConfigPayload } = require('../utils/botConfigBuilder');
const { applyBotPresence } = require('../events/interactionCreate');
const { err } = require('../utils/logger');

// Activity type labels for confirmation replies
const ACTIVITY_TYPE_LABELS = { Playing: 'Playing', Watching: 'Watching', Listening: 'Listening to', Competing: 'Competing in', Custom: '' };

function match(interaction) {
  if (interaction.isStringSelectMenu() && interaction.customId === 'botconfig:statusSelect') return true;
  if (interaction.isStringSelectMenu() && interaction.customId === 'botconfig:activityTypeSelect') return true;
  if (interaction.isModalSubmit() && interaction.customId.startsWith('botconfig:activityTextModal:')) return true;
  if (interaction.isButton() && interaction.customId === 'botconfig:editUsername') return true;
  if (interaction.isModalSubmit() && interaction.customId === 'botconfig:usernameModal') return true;
  if (interaction.isButton() && interaction.customId === 'botconfig:editAvatar') return true;
  if (interaction.isModalSubmit() && interaction.customId === 'botconfig:avatarModal') return true;
  if (interaction.isButton() && interaction.customId === 'botconfig:refresh') return true;
  return false;
}

async function execute(interaction) {
  const customId = interaction.customId;

  try {
    // Status select
    if (customId === 'botconfig:statusSelect') {
      const config = setBotConfig({ status: interaction.values[0] });
      applyBotPresence(interaction.client, config);
      return interaction.update(buildBotConfigPayload(config, interaction.client));
    }

    // Activity type select
    if (customId === 'botconfig:activityTypeSelect') {
      const chosen = interaction.values[0];

      if (chosen === 'clear') {
        const config = setBotConfig({ activityType: null, activityText: '' });
        applyBotPresence(interaction.client, config);
        return interaction.update(buildBotConfigPayload(config, interaction.client));
      }

      const modal = new ModalBuilder()
        .setCustomId(`botconfig:activityTextModal:${chosen}`)
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
      return interaction.showModal(modal);
    }

    // Activity text modal submit
    if (customId.startsWith('botconfig:activityTextModal:')) {
      const activityType = customId.split(':')[2];
      const activityText = interaction.fields.getTextInputValue('activityText').trim();

      if (!activityText) {
        return interaction.reply({ content: 'Activity text cannot be empty.', ephemeral: true });
      }

      const config = setBotConfig({ activityType, activityText });
      applyBotPresence(interaction.client, config);

      return interaction.reply({
        content: `✅ Activity set to "${ACTIVITY_TYPE_LABELS[activityType] ?? activityType} ${activityText}". Run \`/bot-config\` again to see the updated panel.`,
        ephemeral: true,
      });
    }

    // Edit username button
    if (customId === 'botconfig:editUsername') {
      const modal = new ModalBuilder()
        .setCustomId('botconfig:usernameModal')
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
      return interaction.showModal(modal);
    }

    // Username modal submit
    if (customId === 'botconfig:usernameModal') {
      const newUsername = interaction.fields.getTextInputValue('username').trim();

      if (newUsername === interaction.client.user.username) {
        return interaction.reply({ content: 'That’s already the bot’s current username.', ephemeral: true });
      }

      await interaction.deferReply({ ephemeral: true });

      try {
        const updatedUser = await interaction.client.user.setUsername(newUsername);
        setBotConfig({ lastUsername: updatedUser.username });
        return interaction.editReply({ content: `✅ Username changed to **${updatedUser.username}**.` });
      } catch (err) {
        const rateLimited = err?.code === 50035 || /rate.?limit/i.test(err?.message || '');
        console.error('[bot-config] setUsername failed:', err);
        return interaction.editReply({
          content: rateLimited
            ? '⏳ Discord rate-limits username changes to 2 per hour — try again later.'
            : `❌ Couldn't change the username: ${err.message || 'unknown error'}`,
        });
      }
    }

    // Edit avatar button
    if (customId === 'botconfig:editAvatar') {
      const modal = new ModalBuilder()
        .setCustomId('botconfig:avatarModal')
        .setTitle('Change Bot Avatar');

      const urlInput = new TextInputBuilder()
        .setCustomId('avatarUrl')
        .setLabel('Direct image URL (png/jpg/gif)')
        .setStyle(TextInputStyle.Short)
        .setPlaceholder('https://example.com/image.png')
        .setRequired(true);

      modal.addComponents(new ActionRowBuilder().addComponents(urlInput));
      return interaction.showModal(modal);
    }

    // Avatar modal submit
    if (customId === 'botconfig:avatarModal') {
      const avatarUrl = interaction.fields.getTextInputValue('avatarUrl').trim();

      if (!/^https?:\/\/.+\.(png|jpe?g|gif|webp)(\?.*)?$/i.test(avatarUrl)) {
        return interaction.reply({
          content: '❌ That doesn’t look like a direct image URL (must end in .png, .jpg, .jpeg, .gif, or .webp).',
          ephemeral: true,
        });
      }

      await interaction.deferReply({ ephemeral: true });

      try {
        await interaction.client.user.setAvatar(avatarUrl);
        setBotConfig({ lastAvatarUrl: avatarUrl });
        return interaction.editReply({ content: '✅ Avatar updated.' });
      } catch (err) {
        console.error('[bot-config] setAvatar failed:', err);
        return interaction.editReply({
          content: `❌ Couldn't change the avatar: ${err.message || 'unknown error'}. Make sure the URL is a direct, publicly accessible image link.`,
        });
      }
    }

    // Refresh button
    if (customId === 'botconfig:refresh') {
      const config = getBotConfig();
      return interaction.update(buildBotConfigPayload(config, interaction.client));
    }
  } catch (error) {
    err(error, { tag: 'handlers:botConfig', customId, userId: interaction.user.id });
    throw error;
  }
}

module.exports = { match, execute };