const { Events } = require('discord.js');
const { sendAuditLog } = require('../utils/auditLogger');

module.exports = {
  name: Events.GuildStickerDelete,
  async execute(sticker) {
    await sendAuditLog(sticker.guild, `🏷️ Sticker deleted: ${sticker.name}`);
  },
};
