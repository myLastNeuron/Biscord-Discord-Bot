const { Events } = require('discord.js');
const { sendAuditLog } = require('../utils/auditLogger');

module.exports = {
  name: Events.GuildEmojiCreate,
  async execute(emoji) {
    await sendAuditLog(emoji.guild, `😀 Emoji created: ${emoji.name}`);
  },
};
