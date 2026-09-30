const {
  PermissionFlagsBits,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
} = require('discord.js');
const fs = require('fs');
const { getGuildSettings: getPanelGuildSettings } = require('./db');
const { dataPath, writeJsonAtomic } = require('./safeFile');

// ---------- Role request config ----------
// Falls back to null (not configured) if admins haven't set these via /panel.
const ROLE_REQUEST_LOG_CHANNEL_ID = null;
const ROLE_REQUEST_APPROVE_ROLE_ID = null;

// Settings file path — stores customizations per guild
const SETTINGS_FILE = dataPath('roleRequestSettings.json');

// Load or initialize settings
function loadSettings() {
  try {
    if (fs.existsSync(SETTINGS_FILE)) {
      return JSON.parse(fs.readFileSync(SETTINGS_FILE, 'utf-8'));
    }
  } catch (err) {
    console.warn('[rolerequest] Failed to load settings:', err);
  }
  return {};
}

function saveSettings(settings) {
  try {
    writeJsonAtomic(SETTINGS_FILE, settings);
  } catch (err) {
    console.error('[rolerequest] Failed to save settings:', err);
  }
}

function getGuildSettings(guildId) {
  const all = loadSettings();
  return all[guildId] || {};
}

function updateGuildSettings(guildId, updates) {
  const all = loadSettings();
  all[guildId] = { ...all[guildId], ...updates };
  saveSettings(all);
}

// The /panel Role Request settings live in the shared per-guild settings
// (db.js). This handler historically kept its own copy in
// roleRequestSettings.json and the two silently drifted apart — the panel's
// channel/role were ignored. Prefer the panel/db value, fall back to the
// legacy local file, and only then to the hardcoded default — provided it
// actually exists inside THIS guild (the default was the developer's own
// server's channel/role and must never reach into another guild).
async function getRoleRequestLogChannelId(guild) {
  const candidate =
    getPanelGuildSettings(guild.id).roleRequestLogChannelId ||
    getGuildSettings(guild.id).roleRequestLogChannelId ||
    ROLE_REQUEST_LOG_CHANNEL_ID;
  const channel = await guild.channels.fetch(candidate).catch(() => null);
  return channel ? candidate : null;
}

async function getRoleRequestApproveRoleId(guild) {
  const candidate =
    getPanelGuildSettings(guild.id).roleRequestApproveRoleId ||
    getGuildSettings(guild.id).roleRequestApproveRoleId ||
    ROLE_REQUEST_APPROVE_ROLE_ID;
  const role = await guild.roles.fetch(candidate).catch(() => null);
  return role ? candidate : null;
}

function canReviewRoleRequests(interaction) {
  const settings = getGuildSettings(interaction.guild.id);
  const modRoleIds = settings.modRoleIds || [];
  if (modRoleIds.length > 0) {
    return interaction.member.roles.cache.some((role) => modRoleIds.includes(role.id));
  }
  return interaction.memberPermissions?.has(PermissionFlagsBits.ManageRoles);
}

// ---------- Role request: button opens the request modal ----------
async function handleRoleRequestOpen(interaction) {
  const modal = new ModalBuilder().setCustomId('rolerequest:submit').setTitle('Request Role');

  const idInput = new TextInputBuilder()
    .setCustomId('charId')
    .setLabel('ID')
    .setStyle(TextInputStyle.Short)
    .setRequired(true);

  const nameInput = new TextInputBuilder()
    .setCustomId('charName')
    .setLabel('Name')
    .setStyle(TextInputStyle.Short)
    .setRequired(true);

  const rankInput = new TextInputBuilder()
    .setCustomId('rank')
    .setLabel('Rank')
    .setStyle(TextInputStyle.Short)
    .setRequired(true);

  const montagesInput = new TextInputBuilder()
    .setCustomId('montages')
    .setLabel('Montages (write null if none)')
    .setStyle(TextInputStyle.Short)
    .setRequired(true);

  const screenshotInput = new TextInputBuilder()
    .setCustomId('screenshot')
    .setLabel('Screenshot link (of you being in family)')
    .setStyle(TextInputStyle.Short)
    .setPlaceholder('Paste an image link (imgur, Discord CDN, etc.)')
    .setRequired(true);

  modal.addComponents(
    new ActionRowBuilder().addComponents(idInput),
    new ActionRowBuilder().addComponents(nameInput),
    new ActionRowBuilder().addComponents(rankInput),
    new ActionRowBuilder().addComponents(montagesInput),
    new ActionRowBuilder().addComponents(screenshotInput),
  );

  return interaction.showModal(modal);
}

// ---------- Role request: modal submit -> post to log channel for review ----------
async function handleRoleRequestSubmit(interaction) {
  const charId = interaction.fields.getTextInputValue('charId');
  const charName = interaction.fields.getTextInputValue('charName');
  const rank = interaction.fields.getTextInputValue('rank');
  const montages = interaction.fields.getTextInputValue('montages');
  const screenshot = interaction.fields.getTextInputValue('screenshot');

  const logChannelId = await getRoleRequestLogChannelId(interaction.guild);
  if (!logChannelId) {
    return interaction.reply({
      content: 'The role-request review channel is not configured in this server — please tell an admin.',
      ephemeral: true,
    });
  }
  const logChannel = await interaction.guild.channels.fetch(logChannelId).catch(() => null);
  if (!logChannel) {
    return interaction.reply({ content: 'Could not reach the review channel — please tell an admin.', ephemeral: true });
  }

  const embed = new EmbedBuilder()
    .setTitle('New Role Request')
    .setColor(0x5865f2)
    .addFields(
      { name: 'Requested by', value: `${interaction.user} (${interaction.user.tag})`, inline: false },
      { name: 'ID', value: charId, inline: true },
      { name: 'Name', value: charName, inline: true },
      { name: 'Rank', value: rank, inline: true },
      { name: 'Montages', value: montages, inline: false },
      { name: 'Screenshot', value: screenshot, inline: false },
    )
    .setFooter({ text: `User ID: ${interaction.user.id}` })
    .setTimestamp();

  if (/^https?:\/\/.+\.(png|jpe?g|gif|webp)(\?.*)?$/i.test(screenshot.trim())) {
    embed.setImage(screenshot.trim());
  }

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`rolerequest:approve:${interaction.user.id}`)
      .setLabel('Approve')
      .setStyle(ButtonStyle.Success),
    new ButtonBuilder()
      .setCustomId(`rolerequest:reject:${interaction.user.id}`)
      .setLabel('Reject')
      .setStyle(ButtonStyle.Danger),
  );

  await logChannel.send({ embeds: [embed], components: [row] });

  return interaction.reply({ content: 'Your role request has been sent for review. You will be given the role once approved.', ephemeral: true });
}

// ---------- Role request: admin/HC clicks Approve or Reject ----------
async function handleRoleRequestReview(interaction) {
  const [, action, requesterId] = interaction.customId.split(':');

  if (!canReviewRoleRequests(interaction)) {
    return interaction.reply({ content: 'You do not have permission to review role requests.', ephemeral: true });
  }

  const originalEmbed = interaction.message.embeds[0];
  const updatedEmbed = EmbedBuilder.from(originalEmbed);

  if (action === 'approve') {
    const member = await interaction.guild.members.fetch(requesterId).catch(() => null);
    if (!member) {
      return interaction.reply({ content: 'That user is no longer in the server.', ephemeral: true });
    }

    const roleId = await getRoleRequestApproveRoleId(interaction.guild);
    if (!roleId) {
      return interaction.reply({
        content: 'The role to grant for approved requests is not configured in this server. Approve the request manually, or ask an admin to set it in `/panel` → Role Requests.',
        ephemeral: true,
      });
    }
    let roleAddError = null;
    try {
      await member.roles.add(roleId);
    } catch (err) {
      roleAddError = err;
      console.error(`[rolerequest] Failed to add role ${roleId} to ${member.id} in guild ${interaction.guild.id}:`, err);
    }

    if (roleAddError) {
      updatedEmbed.setColor(0xed4245).setTitle('Role Request — Approved (⚠️ role NOT given)');
      updatedEmbed.addFields(
        { name: 'Approved by', value: `${interaction.user}`, inline: false },
        {
          name: '⚠️ Role Assignment Failed',
          value: `Could not give <@&${roleId}> to ${member}. Most likely cause: the bot's role isn't positioned **above** <@&${roleId}> in Server Settings → Roles, or the bot is missing **Manage Roles** permission.\n\`${roleAddError.message || roleAddError}\``,
          inline: false,
        },
      );
    } else {
      updatedEmbed.setColor(0x57f287).setTitle('Role Request — Approved');
      updatedEmbed.addFields({ name: 'Approved by', value: `${interaction.user}`, inline: false });
    }

    await member.send('Your role request was approved! 🎉').catch(() => null);
  } else {
    updatedEmbed.setColor(0xed4245).setTitle('Role Request — Rejected');
    updatedEmbed.addFields({ name: 'Rejected by', value: `${interaction.user}`, inline: false });
    const member = await interaction.guild.members.fetch(requesterId).catch(() => null);
    await member?.send('Your role request was rejected.').catch(() => null);
  }

  const disabledRow = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('rolerequest:approve:done').setLabel('Approve').setStyle(ButtonStyle.Success).setDisabled(true),
    new ButtonBuilder().setCustomId('rolerequest:reject:done').setLabel('Reject').setStyle(ButtonStyle.Danger).setDisabled(true),
  );

  await interaction.update({ embeds: [updatedEmbed], components: [disabledRow] });
  return;
}

// ---------- Customize modal submit ----------
async function handleRoleRequestCustomize(interaction) {
  const title = interaction.fields.getTextInputValue('embedTitle');
  const description = interaction.fields.getTextInputValue('embedDescription');
  const buttonLabel = interaction.fields.getTextInputValue('buttonLabel');
  const colorHex = interaction.fields.getTextInputValue('embedColor');
  const imageUrl = interaction.fields.getTextInputValue('embedImage') || null;

  // Validate hex color
  let color = 0x5865f2;
  if (colorHex && /^[0-9a-fA-F]{6}$/.test(colorHex)) {
    color = parseInt(colorHex, 16);
  } else if (colorHex) {
    return interaction.reply({ content: 'Invalid hex color. Use format: 5865f2 (without #)', ephemeral: true });
  }

  // Validate image URL if provided
  if (imageUrl && !imageUrl.startsWith('http')) {
    return interaction.reply({ content: 'Invalid image URL. Must start with http:// or https://', ephemeral: true });
  }

  // Save settings
  updateGuildSettings(interaction.guild.id, {
    roleRequestTitle: title,
    roleRequestDescription: description,
    roleRequestButtonLabel: buttonLabel,
    roleRequestColor: color,
    roleRequestImageUrl: imageUrl,
  });

  // Show preview
  const previewEmbed = new EmbedBuilder()
    .setTitle(title)
    .setDescription(description)
    .setColor(color);

  if (imageUrl) {
    previewEmbed.setImage(imageUrl);
  }

  return interaction.reply({
    content: '✅ Role request panel customized! Preview:',
    embeds: [previewEmbed],
    ephemeral: true,
  });
}

// Entry point
async function handleRoleRequestInteraction(interaction) {
  if (interaction.isButton() && interaction.customId === 'rolerequest:open') {
    await handleRoleRequestOpen(interaction);
    return true;
  }

  if (interaction.isModalSubmit() && interaction.customId === 'rolerequest:submit') {
    await handleRoleRequestSubmit(interaction);
    return true;
  }

  if (interaction.isModalSubmit() && interaction.customId === 'rolerequest:customize') {
    await handleRoleRequestCustomize(interaction);
    return true;
  }

  if (interaction.isButton() && (interaction.customId.startsWith('rolerequest:approve:') || interaction.customId.startsWith('rolerequest:reject:'))) {
    await handleRoleRequestReview(interaction);
    return true;
  }

  return false;
}

module.exports = { handleRoleRequestInteraction };
