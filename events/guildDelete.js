const { Events } = require('discord.js');
const { clearGuildInviteCache } = require('../utils/inviteTracker');

module.exports = {
  name: Events.GuildDelete,
  once: false,
  execute(guild) {
    clearGuildInviteCache(guild.id);
  },
};
