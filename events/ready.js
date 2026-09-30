const { Events, EmbedBuilder } = require('discord.js');
const { getRestartFlag, clearRestartFlag, getGuildSettings } = require('../utils/db');
const { cacheGuildInvites } = require('../utils/inviteTracker');
const { getBotConfig } = require('../utils/botConfigStore');
const { applyBotPresence } = require('../utils/botConfigInteractionHandler');

module.exports = {
  name: Events.ClientReady,
  once: true,
  async execute(client) {
    console.log(`✅ Logged in as ${client.user.tag}`);

    // Apply whatever status/activity is saved in botConfig.json (with the
    // /panel > Bot Config and /bot-config panels) instead of a hardcoded
    // presence — otherwise every configured status is wiped on restart.
    const savedConfig = getBotConfig();
    applyBotPresence(client, savedConfig);
    if (savedConfig.activityType && savedConfig.activityText) {
      console.log(`   presence: ${savedConfig.status} · ${savedConfig.activityType} "${savedConfig.activityText}"`);
    } else {
      console.log(`   presence: ${savedConfig.status} · no activity`);
    }

    // ---------- Prime the invite-use cache for every guild, so the first
    // join after startup has something to diff against. Runs unconditionally
    // (unlike the restart announcement below) since it's needed on every
    // boot, not just intentional dashboard restarts.
    for (const guild of client.guilds.cache.values()) {
      await cacheGuildInvites(guild); // logs its own error per-guild on failure
    }

    // ---------- Announce a successful restart, but only if this boot was
    // triggered by /panel > Restart Bot. A normal `npm start` or a
    // crash-recovery respawn (uncaught error, host reboot, etc.) stays
    // silent — only the intentional dashboard restart gets announced.
    const flag = getRestartFlag();
    if (!flag) return;
    clearRestartFlag();

    try {
      const embed = new EmbedBuilder()
        .setColor(0x57f287)
        .setTitle('✅ Bot Restarted Successfully')
        .setDescription('All systems are back online and every command is active.')
        .addFields(
          { name: 'Commands Loaded', value: `${client.commands.size}`, inline: true },
          { name: 'Servers', value: `${client.guilds.cache.size}`, inline: true },
          ...(flag.triggeredByTag ? [{ name: 'Restarted By', value: flag.triggeredByTag, inline: true }] : []),
        )
        .setTimestamp();

      for (const guild of client.guilds.cache.values()) {
        const settings = getGuildSettings(guild.id);
        if (!settings.logChannelId) continue;

        const channel = await guild.channels.fetch(settings.logChannelId).catch(() => null);
        if (!channel) continue;

        await channel.send({ embeds: [embed] }).catch((err) => {
          console.error(`[ready] Failed to post restart announcement in guild ${guild.id}:`, err);
        });
      }
    } catch (err) {
      console.error('[ready] Restart announcement failed:', err);
    }
  },
};
