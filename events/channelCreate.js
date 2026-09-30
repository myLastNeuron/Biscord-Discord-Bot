const { Events, ChannelType } = require('discord.js');
const { sendAuditLog } = require('../utils/auditLogger');

const CHANNEL_TYPE_NAMES = {
  [ChannelType.GuildText]: 'text',
  [ChannelType.GuildVoice]: 'voice',
  [ChannelType.GuildCategory]: 'category',
  [ChannelType.GuildAnnouncement]: 'announcement',
  [ChannelType.GuildStageVoice]: 'stage',
  [ChannelType.GuildForum]: 'forum',
};

module.exports = {
  name: Events.ChannelCreate,
  async execute(channel) {
    const type = CHANNEL_TYPE_NAMES[channel.type] || 'unknown';
    await sendAuditLog(channel.guild, `➕ Channel created: #${channel.name} (${type})`);
  },
};
