/**
 * events/interactionCreate.level.js
 * Awards a small amount of XP whenever a user uses any slash command.
 * Plug this into your existing interactionCreate event handler, or register standalone.
 */

const { getSettings, awardXP, getUser, canEarnXP, setLastMessage } = require('../utils/levelStore');
const { getGuildSettings } = require('../utils/db');
const { notifyLevelUp }                 = require('../utils/levelNotify');

module.exports = {
  name: 'interactionCreate',
  async execute(interaction) {
    if (!interaction.isChatInputCommand()) return;
    if (interaction.user.bot) return;
    if (!interaction.guild) return;

    const guildSettings = getGuildSettings(interaction.guild.id);
    if (guildSettings.botEnabled === false) return; // maintenance mode

    const settings = getSettings(interaction.guild.id);
    if (settings.enabled === false) return; // level system turned off
    if (!settings.xpPerCommand) return;

    // Anti-farm: command XP respects the same cooldown as message XP
    if (!canEarnXP(interaction.guild.id, interaction.user.id, settings.cooldownMs)) return;

    const result = awardXP(interaction.guild.id, interaction.user.id, settings.xpPerCommand);
    setLastMessage(interaction.guild.id, interaction.user.id);
    if (!result.leveledUp) return;

    const member = interaction.guild.members.cache.get(interaction.user.id)
      ?? await interaction.guild.members.fetch(interaction.user.id).catch(() => null);
    if (!member) return;

    await notifyLevelUp({
      member,
      channel:   interaction.channel,
      client:    interaction.client,
      newLevel:  result.newLevel,
      levelName: result.levelDef?.name ?? `Level ${result.newLevel}`,
      totalXp:   getUser(interaction.guild.id, interaction.user.id).totalXp,
      roleId:    result.levelDef?.roleId ?? null,
    });
  },
};
