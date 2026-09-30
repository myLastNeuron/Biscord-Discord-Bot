const { Events } = require('discord.js');
const { sendAuditLog } = require('../utils/auditLogger');

module.exports = {
  name: Events.GuildEmojiDelete,
  async execute(emoji) {
    await sendAuditLog(emoji.guild, `😀 Emoji deleted: ${emoji.name}`);
  },
};
