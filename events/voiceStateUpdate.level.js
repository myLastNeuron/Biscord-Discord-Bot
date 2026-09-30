/**
 * events/voiceStateUpdate.level.js
 * Tracks voice channel join/leave to award XP for time spent in voice.
 */

const { getSettings, setVoiceJoin, flushVoiceXP } = require('../utils/levelStore');
const { getGuildSettings } = require('../utils/db');
const { notifyLevelUp } = require('../utils/levelNotify');

module.exports = {
  name: 'voiceStateUpdate',
  async execute(oldState, newState) {
    const member   = newState.member ?? oldState.member;
    if (!member || member.user.bot || !member.guild) return;

    const guildId = member.guild.id;
    const guildSettings = getGuildSettings(guildId);
    if (guildSettings.botEnabled === false) return; // maintenance mode

    const settings = getSettings(guildId);
    if (settings.enabled === false) return; // level system turned off

    const joinedChannel  = !oldState.channelId && newState.channelId;
    const leftChannel    = oldState.channelId && !newState.channelId;
    const movedChannel   = oldState.channelId && newState.channelId && oldState.channelId !== newState.channelId;

    if (joinedChannel || movedChannel) {
      // Record join time (moved = treat as fresh join for simplicity)
      setVoiceJoin(guildId, member.id);
    }

    if (leftChannel || movedChannel) {
      const result = flushVoiceXP(guildId, member.id, settings.xpPerVoiceMin);
      if (!result || !result.leveledUp) return;

      // Find a text channel to notify in
      const textChannel = member.guild.systemChannel
        ?? member.guild.channels.cache.find(c => c.isTextBased() && c.permissionsFor(member.guild.members.me)?.has('SendMessages'));

      await notifyLevelUp({
        member,
        channel:   textChannel,
        client:    member.client,
        newLevel:  result.newLevel,
        levelName: result.levelDef?.name ?? `Level ${result.newLevel}`,
        totalXp:   result.totalXp ?? 0,
        roleId:    result.levelDef?.roleId ?? null,
      });
    }
  },
};
