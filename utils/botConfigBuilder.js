const {
  EmbedBuilder,
  ActionRowBuilder,
  StringSelectMenuBuilder,
  ButtonBuilder,
  ButtonStyle,
} = require('discord.js');

const STATUS_LABELS = {
  online: '🟢 Online',
  idle: '🌙 Idle',
  dnd: '⛔ Do Not Disturb',
  invisible: '⚫ Invisible',
};

const ACTIVITY_TYPE_LABELS = {
  Playing: 'Playing',
  Watching: 'Watching',
  Listening: 'Listening to',
  Competing: 'Competing in',
  Custom: '',
};

function describeActivity(config) {
  if (!config.activityType || !config.activityText) return '*No activity set*';
  const prefix = ACTIVITY_TYPE_LABELS[config.activityType] ?? config.activityType;
  return prefix ? `${prefix} **${config.activityText}**` : `**${config.activityText}**`;
}

// `client` is optional - if passed, pulls live username/avatar straight from
// Discord instead of the cached values in botConfig.json, so the panel never
// shows stale info after a manual change made outside /bot-config.
function buildBotConfigEmbed(config, client) {
  const username = client?.user?.username ?? config.lastUsername ?? 'Unknown';
  const avatarUrl = client?.user?.displayAvatarURL({ size: 256 }) ?? config.lastAvatarUrl ?? null;

  const embed = new EmbedBuilder()
    .setTitle('🤖 Bot Profile & Status')
    .setColor(0x5865f2)
    .addFields(
      { name: 'Username', value: username, inline: true },
      { name: 'Presence', value: STATUS_LABELS[config.status] ?? config.status, inline: true },
      { name: 'Activity', value: describeActivity(config), inline: false },
    )
    .setFooter({ text: 'Only server admins can see or use this panel.' });

  if (avatarUrl) embed.setThumbnail(avatarUrl);
  return embed;
}

// `prefix` selects which customId family the components use so the same
// builders can render both the standalone /bot-config command (default
// "botconfig") and the /panel > Bot Config sub-panel ("panel:botConfig").
// Only the component customIds change — the embed and payload are identical.
function buildBotConfigComponents(config, prefix = 'botconfig') {
  const statusSelect = new StringSelectMenuBuilder()
    .setCustomId(`${prefix}:statusSelect`)
    .setPlaceholder('Change presence status...')
    .addOptions(
      { label: 'Online', emoji: '🟢', value: 'online', default: config.status === 'online' },
      { label: 'Idle', emoji: '🌙', value: 'idle', default: config.status === 'idle' },
      { label: 'Do Not Disturb', emoji: '⛔', value: 'dnd', default: config.status === 'dnd' },
      { label: 'Invisible', emoji: '⚫', value: 'invisible', default: config.status === 'invisible' },
    );

  const activitySelect = new StringSelectMenuBuilder()
    .setCustomId(`${prefix}:activityTypeSelect`)
    .setPlaceholder('Set activity text...')
    .addOptions(
      { label: 'Playing', value: 'Playing', default: config.activityType === 'Playing' },
      { label: 'Watching', value: 'Watching', default: config.activityType === 'Watching' },
      { label: 'Listening to', value: 'Listening', default: config.activityType === 'Listening' },
      { label: 'Competing in', value: 'Competing', default: config.activityType === 'Competing' },
      { label: 'Custom Status', value: 'Custom', default: config.activityType === 'Custom' },
      { label: 'Clear Activity', value: 'clear' },
    );

  const buttonsRow = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`${prefix}:editUsername`).setLabel('Edit Username').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId(`${prefix}:editAvatar`).setLabel('Edit Avatar').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId(`${prefix}:refresh`).setLabel('Refresh').setStyle(ButtonStyle.Primary),
  );

  return [
    new ActionRowBuilder().addComponents(statusSelect),
    new ActionRowBuilder().addComponents(activitySelect),
    buttonsRow,
  ];
}

function buildBotConfigPayload(config, client, prefix = 'botconfig') {
  return {
    embeds: [buildBotConfigEmbed(config, client)],
    components: buildBotConfigComponents(config, prefix),
  };
}

module.exports = { buildBotConfigEmbed, buildBotConfigComponents, buildBotConfigPayload };
