/**
 * events/messageReactionAdd.level.js
 * Awards XP to the person who added a reaction (not the message author).
 */

const { getSettings, awardXP, getUser, canEarnXP, setLastMessage } = require('../utils/levelStore');
const { getGuildSettings } = require('../utils/db');
const { notifyLevelUp }                 = require('../utils/levelNotify');

module.exports = {
  name: 'messageReactionAdd',
  async execute(reaction, user) {
    if (user.bot) return;

    // Fetch partial reaction/message if needed
    if (reaction.partial) { try { await reaction.fetch(); } catch { return; } }
    if (!reaction.message.guild) return;

    const guildId = reaction.message.guild.id;
    const guildSettings = getGuildSettings(guildId);
    if (guildSettings.botEnabled === false) return; // maintenance mode

    const settings = getSettings(guildId);
    if (settings.enabled === false) return; // level system turned off
    if (!settings.xpPerReaction) return;

    // Anti-farm: reaction XP respects the same cooldown as message XP
    if (!canEarnXP(guildId, user.id, settings.cooldownMs)) return;

    const result = awardXP(guildId, user.id, settings.xpPerReaction);
    setLastMessage(guildId, user.id);
    if (!result.leveledUp) return;

    const guild  = reaction.message.guild;
    const member = guild.members.cache.get(user.id) ?? await guild.members.fetch(user.id).catch(() => null);
    if (!member) return;

    await notifyLevelUp({
      member,
      channel:   reaction.message.channel,
      client:    reaction.message.client,
      newLevel:  result.newLevel,
      levelName: result.levelDef?.name ?? `Level ${result.newLevel}`,
      totalXp:   getUser(guildId, user.id).totalXp,
      roleId:    result.levelDef?.roleId ?? null,
    });
  },
};
