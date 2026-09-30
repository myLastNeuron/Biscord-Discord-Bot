const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');
const { getGuildSettings, setGuildSettings } = require('../../utils/db');

// Sets the SERVER DEFAULT for how many minutes after a roster is posted it
// auto-locks (blocks both join and leave). This is only a fallback — hosts
// can override it per-roster with the `lock_after` option on
// /event create and /event autopost create.
module.exports = {
  data: new SlashCommandBuilder()
    .setName('roster-lock-time')
    .setDescription('Set the default minutes after a roster is posted that it auto-locks (no join/leave after).')
    .addIntegerOption((option) =>
      option
        .setName('minutes')
        .setDescription('Default minutes after posting to auto-lock. Use 0 to turn auto-lock off by default.')
        .setMinValue(0)
        .setMaxValue(10080)
        .setRequired(true))
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageEvents),

  async execute(interaction) {
    const minutes = interaction.options.getInteger('minutes');
    setGuildSettings(interaction.guild.id, { rosterAutoLockMinutes: minutes });

    if (minutes === 0) {
      return interaction.reply({
        content: 'Roster auto-lock is now **off by default**. New rosters will only lock when someone clicks the Lock button, '
          + 'unless the host sets `lock_after` when creating one.',
        ephemeral: true,
      });
    }

    return interaction.reply({
      content: `✅ New rosters will now auto-lock **${minutes} minute(s) after being posted** by default — no joining or leaving after that. `
        + 'Hosts can still override this per-roster with the `lock_after` option on `/event create`.',
      ephemeral: true,
    });
  },

  // Optional convenience for other commands/panels that want to read the current value.
  async currentValue(guildId) {
    return getGuildSettings(guildId).rosterAutoLockMinutes ?? 15;
  },
};
