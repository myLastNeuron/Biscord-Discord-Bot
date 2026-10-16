/**
 * /roleinfo <role>
 * The details you'd otherwise dig out of Server Settings — colour, position,
 * member count and the role's flags. The embed colour uses the role's own
 * colour so it reads at a glance.
 */

const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const { PREMIUM_COLORS } = require('../../utils/theme');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('roleinfo')
    .setDescription('Show information about a role.')
    .addRoleOption((o) => o.setName('role').setDescription('The role to inspect').setRequired(true)),

  async execute(interaction) {
    const role = interaction.options.getRole('role');
    const hex = `#${role.color.toString(16).padStart(6, '0').toUpperCase()}`;

    const embed = new EmbedBuilder()
      .setColor(role.color || PREMIUM_COLORS.accent)
      .setTitle(`Role — ${role.name}`)
      .addFields(
        { name: 'ID', value: role.id, inline: true },
        { name: 'Color', value: role.color ? hex : 'Default', inline: true },
        { name: 'Position', value: `${role.position}`, inline: true },
        { name: 'Members', value: `${role.members.size}`, inline: true },
        { name: 'Mentionable', value: role.mentionable ? 'Yes' : 'No', inline: true },
        { name: 'Displayed separately', value: role.hoist ? 'Yes' : 'No', inline: true },
        { name: 'Managed', value: role.managed ? 'Yes (bot/integration role)' : 'No', inline: true },
        { name: 'Created', value: `<t:${Math.floor(role.createdTimestamp / 1000)}:R>`, inline: true },
      )
      .setFooter({ text: `Requested by ${interaction.user.tag}` });

    await interaction.reply({ embeds: [embed] });
  },
};
