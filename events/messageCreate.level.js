/**
 * events/messageCreate.level.js
 * Plug this into your existing messageCreate event, OR register it as its own event.
 * Grants XP on messages, respects cooldown, fires level-up notification.
 */

const { getSettings, getUser, awardXP, setLastMessage } = require('../utils/levelStore');
const { getGuildSettings } = require('../utils/db');
const { notifyLevelUp } = require('../utils/levelNotify');

module.exports = {
  name: 'messageCreate',
  async execute(message) {
    // Ignore bots, DMs, system messages
    if (message.author.bot || !message.guild || message.system) return;

    const guildSettings = getGuildSettings(message.guild.id);
    if (guildSettings.botEnabled === false) return; // maintenance mode

    const settings = getSettings(message.guild.id);
    if (settings.enabled === false) return; // level system turned off
    if (!settings.xpPerMessage) return; // XP from messages disabled

    const user = getUser(message.guild.id, message.author.id);
    const now  = Date.now();

    // Cooldown check
    if (now - user.lastMessageAt < settings.cooldownMs) return;

    // Random XP in the configured range
    const { min, max } = settings.xpPerMessage;
    const xp = Math.floor(Math.random() * (max - min + 1)) + min;

    setLastMessage(message.guild.id, message.author.id);
    const result = awardXP(message.guild.id, message.author.id, xp);

    if (result.leveledUp) {
      const member = message.guild.members.cache.get(message.author.id)
        ?? await message.guild.members.fetch(message.author.id).catch(() => null);
      if (!member) return;

      await notifyLevelUp({
        member,
        channel: message.channel,
        client:  message.client,
        newLevel:  result.newLevel,
        levelName: result.levelDef?.name ?? `Level ${result.newLevel}`,
        totalXp:   getUser(message.guild.id, message.author.id).totalXp,
        roleId:    result.levelDef?.roleId ?? null,
      });
    }
  },
};
