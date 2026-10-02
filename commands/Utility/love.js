/**
 * /love [user1] [user2]
 * A playful, randomized "compatibility" score between two members.
 */

const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const { PREMIUM_COLORS } = require('../../utils/theme');

function verdict(pct) {
  if (pct >= 90) return { emoji: '💞', text: 'Soulmates — this one\'s written in the stars.' };
  if (pct >= 75) return { emoji: '❤️', text: 'A match made in heaven.' };
  if (pct >= 50) return { emoji: '💛', text: 'Good vibes — worth a shot.' };
  if (pct >= 25) return { emoji: '🤝', text: 'Better as friends, probably.' };
  return { emoji: '💔', text: 'Oof. Maybe don\'t sit together at dinner.' };
}

function heartBar(pct, length = 10) {
  const filled = Math.round((pct / 100) * length);
  return '❤️'.repeat(filled) + '🖤'.repeat(length - filled);
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('love')
    .setDescription('Calculate a playful compatibility score between two members.')
    .addUserOption((o) => o.setName('user1').setDescription('First member').setRequired(true))
    .addUserOption((o) => o.setName('user2').setDescription('Second member').setRequired(true)),

  async execute(interaction) {
    const one = interaction.options.getUser('user1');
    const two = interaction.options.getUser('user2');

    // Totally random each run — deliberately not seeded, so re-running rerolls.
    const pct = Math.floor(Math.random() * 101); // 0–100 inclusive
    const { emoji, text } = verdict(pct);

    const embed = new EmbedBuilder()
      .setColor(PREMIUM_COLORS.accent)
      .setTitle(`${emoji} Love Calculator`)
      .setDescription(`${one}  💕  ${two}\n\n\`${heartBar(pct)}\`\n**${pct}%** — ${text}`)
      .setFooter({ text: 'For entertainment only ✨' });

    await interaction.reply({ embeds: [embed] });
  },
};
