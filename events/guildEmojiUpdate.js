const { Events } = require('discord.js');
const { sendAuditLog } = require('../utils/auditLogger');

module.exports = {
  name: Events.GuildEmojiUpdate,
  async execute(oldEmoji, newEmoji) {
    if (oldEmoji.name !== newEmoji.name) {
      await sendAuditLog(newEmoji.guild, `😀 Emoji renamed: ${oldEmoji.name} → ${newEmoji.name}`);
    }
  },
};
