const { Events } = require('discord.js');
const { sendAuditLog } = require('../utils/auditLogger');

module.exports = {
  name: Events.GuildStickerCreate,
  async execute(sticker) {
    await sendAuditLog(sticker.guild, `🏷️ Sticker created: ${sticker.name}`);
  },
};
