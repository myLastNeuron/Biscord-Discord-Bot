/**
 * /reset-level
 * Mod-only: reset a specific user's XP/level, or wipe the entire server.
 */

const { SlashCommandBuilder, EmbedBuilder, PermissionFlagsBits, ButtonBuilder, ButtonStyle, ActionRowBuilder } = require('discord.js');
const { resetUser, resetAll } = require('../../utils/levelStore');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('reset-level')
    .setDescription('(Mod) Reset level/XP data.')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)

    .addSubcommand(sub => sub
      .setName('user')
      .setDescription('Reset a specific user\'s XP and level back to 0.')
      .addUserOption(o => o.setName('user').setDescription('Target user').setRequired(true))
    )

    .addSubcommand(sub => sub
      .setName('all')
      .setDescription('⚠️ Wipe ALL level data for every user in the server.')
    ),

  async execute(interaction) {
    const sub = interaction.options.getSubcommand();

    if (sub === 'user') {
      const target = interaction.options.getUser('user');
      resetUser(interaction.guild.id, target.id);

      await interaction.reply({
        embeds: [new EmbedBuilder().setColor(0xed4245).setTitle('🔄 Level Reset')
          .setDescription(`${target}'s XP and level have been reset to **0**.`)],
        ephemeral: true,
      });
    }

    else if (sub === 'all') {
      // Require a confirmation button before wiping everything
      const confirm = new ButtonBuilder().setCustomId('confirm_reset_all').setLabel('Yes, wipe everything').setStyle(ButtonStyle.Danger);
      const cancel  = new ButtonBuilder().setCustomId('cancel_reset_all').setLabel('Cancel').setStyle(ButtonStyle.Secondary);
      const row     = new ActionRowBuilder().addComponents(confirm, cancel);

      const reply = await interaction.reply({
        embeds: [new EmbedBuilder().setColor(0xed4245).setTitle('⚠️ Are you sure?')
          .setDescription('This will permanently delete **all** level and XP data for every user. This cannot be undone.')],
        components: [row],
        ephemeral: true,
        fetchReply: true,
      });

      const collector = reply.createMessageComponentCollector({ time: 15_000 });
      collector.on('collect', async btn => {
        if (btn.user.id !== interaction.user.id) {
          return btn.reply({ content: 'Not your button.', ephemeral: true });
        }
        if (btn.customId === 'confirm_reset_all') {
          resetAll(interaction.guild.id);
          await btn.update({
            embeds: [new EmbedBuilder().setColor(0xed4245).setTitle('✅ All Data Wiped')
              .setDescription('Every user\'s XP and level data has been deleted.')],
            components: [],
          });
        } else {
          await btn.update({ content: 'Reset cancelled.', embeds: [], components: [] });
        }
        collector.stop();
      });
      collector.on('end', (_, reason) => {
        if (reason === 'time') interaction.editReply({ content: 'Timed out.', embeds: [], components: [] }).catch(() => {});
      });
    }
  },
};
