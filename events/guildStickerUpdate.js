const { Events } = require('discord.js');
const { sendAuditLog } = require('../utils/auditLogger');

module.exports = {
  name: Events.GuildStickerUpdate,
  async execute(oldSticker, newSticker) {
    if (oldSticker.name !== newSticker.name) {
      await sendAuditLog(newSticker.guild, `🏷️ Sticker renamed: ${oldSticker.name} → ${newSticker.name}`);
    }
  },
};
