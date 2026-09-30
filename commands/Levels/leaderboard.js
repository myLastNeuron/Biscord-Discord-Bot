/**
 * /leaderboard
 * Top 10 users by total XP.
 */

const { SlashCommandBuilder, EmbedBuilder, MessageFlags } = require('discord.js');
const { getLeaderboard, getLevelDefinitions } = require('../../utils/levelStore');

const MEDALS = ['🥇', '🥈', '🥉'];

module.exports = {
  data: new SlashCommandBuilder()
    .setName('leaderboard')
    .setDescription('Show the top 10 XP earners in the server.')
    .addIntegerOption(o =>
      o.setName('limit').setDescription('How many users to show (1–25)').setMinValue(1).setMaxValue(25).setRequired(false)
    ),

  async execute(interaction) {
    await interaction.deferReply();

    const limit = interaction.options.getInteger('limit') ?? 10;
    const board = getLeaderboard(interaction.guild.id, limit);
    const defs  = getLevelDefinitions(interaction.guild.id);

    if (!board.length) {
      return interaction.editReply('No XP data yet — start chatting!');
    }

    const lines = await Promise.all(board.map(async (entry, i) => {
      let username = `Unknown (${entry.id})`;
      try {
        const user = await interaction.client.users.fetch(entry.id);
        username = user.username;
      } catch {}
      const def    = defs.find(d => d.level === entry.level);
      const medal  = MEDALS[i] ?? `**${i + 1}.**`;
      return `${medal} **${username}** — Level ${entry.level} (${def?.name ?? '?'}) · \`${entry.totalXp.toLocaleString()} XP\``;
    }));

    const embed = new EmbedBuilder()
      .setColor(0xf5a623)
      .setTitle('🏆  XP Leaderboard')
      .setDescription(lines.join('\n'))
      .setTimestamp()
      .setFooter({ text: `Top ${board.length} users` });

    await interaction.editReply({ embeds: [embed], flags: MessageFlags.Ephemeral });
  },
};
