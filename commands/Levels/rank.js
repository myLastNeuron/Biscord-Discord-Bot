/**
 * /rank [user]
 * Shows XP, level, rank title, and progress to the next level.
 */

const { SlashCommandBuilder, EmbedBuilder, MessageFlags } = require('discord.js');
const { getUser, getLevelDefinitions }       = require('../../utils/levelStore');

function progressBar(current, required, length = 20) {
  const pct   = Math.min(current / required, 1);
  const filled = Math.round(pct * length);
  return '█'.repeat(filled) + '░'.repeat(length - filled);
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('rank')
    .setDescription('Check your (or someone else\'s) level and XP.')
    .addUserOption(o => o.setName('user').setDescription('The user to check').setRequired(false)),

  async execute(interaction) {
    const target = interaction.options.getUser('user') ?? interaction.user;
    const member = interaction.guild.members.cache.get(target.id)
      ?? await interaction.guild.members.fetch(target.id).catch(() => null);

    const data  = getUser(interaction.guild.id, target.id);
    const defs  = getLevelDefinitions(interaction.guild.id);
    const current = defs.find(d => d.level === data.level);
    const next    = defs.find(d => d.level === data.level + 1);

    const bar = next
      ? progressBar(data.xp, next.xpRequired)
      : '█'.repeat(20) + ' *(MAX)*';

    const xpDisplay = next
      ? `${data.xp.toLocaleString()} / ${next.xpRequired.toLocaleString()} XP`
      : `${data.xp.toLocaleString()} XP (Max level)`;

    const embed = new EmbedBuilder()
      .setColor(0x5865f2)
      .setAuthor({ name: target.username, iconURL: target.displayAvatarURL({ dynamic: true }) })
      .setTitle(`Level ${data.level} — ${current?.name ?? 'Unranked'}`)
      .addFields(
        { name: 'XP',          value: xpDisplay,                    inline: false },
        { name: 'Progress',    value: `\`${bar}\``,                 inline: false },
        { name: 'Total XP',    value: `\`${data.totalXp.toLocaleString()}\``, inline: true },
        { name: 'Next Level',  value: next ? `Level ${next.level} — ${next.name}` : '—', inline: true },
      )
      .setTimestamp();

    await interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
  },
};
