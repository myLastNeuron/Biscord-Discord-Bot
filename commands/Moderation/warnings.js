const {
  SlashCommandBuilder,
  PermissionFlagsBits,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
} = require('discord.js');
const { getWarnings, listWarnings, clearWarnings } = require('../../utils/db');
const { buildModActionPayload } = require('../../utils/moderationBuilder');
const { PREMIUM_COLORS } = require('../../utils/theme');

// Shared builder so the /warnings list command and the Refresh button (handled
// in events/interactionCreate.js) always produce an identical embed — no risk
// of the two drifting apart over time.
async function buildWarningsListEmbed(guild) {
  const entries = listWarnings(guild.id);

  if (entries.length === 0) {
    return { embed: null, empty: true };
  }

  // Resolve tags where possible; falls back to the raw ID if the member has left.
  const lines = await Promise.all(
    entries.map(async (entry, i) => {
      const member = await guild.members.fetch(entry.userId).catch(() => null);
      const label = member ? `${member.user.tag}` : `Unknown user (${entry.userId})`;
      return `**${i + 1}.** ${label} — ${entry.count} warning${entry.count === 1 ? '' : 's'}`;
    }),
  );

  const embed = new EmbedBuilder()
    .setColor(PREMIUM_COLORS.warn)
    .setTitle('⚠️ Warned Members')
    .setDescription(lines.join('\n'))
    .setFooter({ text: `${entries.length} member${entries.length === 1 ? '' : 's'} with warnings • Updated` })
    .setTimestamp();

  return { embed, empty: false };
}

function buildRefreshRow() {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('warnings:refresh').setLabel('Refresh').setEmoji('🔄').setStyle(ButtonStyle.Secondary),
  );
}

async function checkHierarchy(interaction, targetUser) {
  if (targetUser.id === interaction.user.id) {
    await interaction.reply({ content: "You can't perform this action on yourself.", ephemeral: true });
    return false;
  }
  if (targetUser.id === interaction.client.user.id) {
    await interaction.reply({ content: "I can't perform this action on myself.", ephemeral: true });
    return false;
  }
  const member = await interaction.guild.members.fetch(targetUser.id).catch(() => null);
  if (!member) {
    await interaction.reply({ content: 'That user is not in this server.', ephemeral: true });
    return false;
  }
  if (member.id === interaction.guild.ownerId) {
    await interaction.reply({ content: `I can't do that to ${targetUser.tag} — they own the server.`, ephemeral: true });
    return false;
  }
  const invoker = await interaction.guild.members.fetch(interaction.user.id).catch(() => null);
  if (!invoker) {
    await interaction.reply({ content: "Couldn't verify your roles — try again.", ephemeral: true });
    return false;
  }
  const invokerPos = invoker.roles?.highest?.position ?? -1;
  const targetPos = member.roles?.highest?.position ?? -1;
  if (interaction.user.id !== interaction.guild.ownerId && invokerPos <= targetPos) {
    await interaction.reply({ content: `You can't perform this action on ${targetUser.tag} — their role is higher than or equal to yours.`, ephemeral: true });
    return false;
  }
  return true;
}

module.exports = {
  buildWarningsListEmbed,
  buildRefreshRow,
  data: new SlashCommandBuilder()
    .setName('warnings')
    .setDescription('View or manage member warnings')
    .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers)
    .addSubcommand((sub) => sub.setName('list').setDescription('List every warned member, sorted by warning count'))
    .addSubcommand((sub) =>
      sub
        .setName('view')
        .setDescription("View one member's full warning history")
        .addUserOption((o) => o.setName('user').setDescription('User to check').setRequired(true)),
    )
    .addSubcommand((sub) =>
      sub
        .setName('clear')
        .setDescription("Clear a member's warning history")
        .addUserOption((o) => o.setName('user').setDescription('User to clear').setRequired(true)),
    ),

  async execute(interaction) {
    const sub = interaction.options.getSubcommand();
    const guildId = interaction.guild.id;

    if (sub === 'list') {
      const { embed, empty } = await buildWarningsListEmbed(interaction.guild);

      if (empty) {
        return interaction.reply({ content: 'No members have any warnings.', ephemeral: true });
      }

      return interaction.reply({ embeds: [embed], components: [buildRefreshRow()], ephemeral: true });
    }

    if (sub === 'view') {
      const target = interaction.options.getUser('user');
      const history = getWarnings(guildId, target.id);

      if (history.length === 0) {
        return interaction.reply({ content: `${target.tag} has no warnings.`, ephemeral: true });
      }

      const embed = new EmbedBuilder()
        .setColor(PREMIUM_COLORS.warn)
        .setTitle(`⚠️ Warnings — ${target.tag}`)
        .setDescription(
          history
            .map((w, i) => `**${i + 1}.** ${w.reason}\n*by ${w.moderator} — <t:${Math.floor(w.timestamp / 1000)}:R>*`)
            .join('\n\n'),
        )
        .setFooter({ text: `${history.length} total warning${history.length === 1 ? '' : 's'}` });

      return interaction.reply({ embeds: [embed], ephemeral: true });
    }

    if (sub === 'clear') {
      const target = interaction.options.getUser('user');
      const ok = await checkHierarchy(interaction, target);
      if (!ok) return;
      const history = getWarnings(guildId, target.id);

      if (history.length === 0) {
        return interaction.reply({ content: `${target.tag} has no warnings to clear.`, ephemeral: true });
      }

      clearWarnings(guildId, target.id);
      return interaction.reply(buildModActionPayload({
        color: PREMIUM_COLORS.success,
        emoji: '✅',
        summary: `Cleared ${history.length} warning(s) for ${target.tag}.`,
      }));
    }
  },
};
