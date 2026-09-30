const { EmbedBuilder } = require('discord.js');

function buildStatsEmbed(targetUser, stats) {
  const perEventLines = Object.entries(stats.categories)
    .sort((a, b) => b[1] - a[1])
    .map(([category, count]) => `• **${category}:** ${count}`);

  const embed = new EmbedBuilder()
    .setColor(0x5865f2)
    .setAuthor({ name: '📊 Event Stats' })
    .setDescription(`**${targetUser.tag}** | \`${targetUser.id}\``)
    .setThumbnail(targetUser.displayAvatarURL({ size: 256 }))
    .addFields(
      { name: 'Total Events Attended', value: `${stats.total}`, inline: true },
      {
        name: 'Last Attendance',
        value: stats.lastAttendance ? `<t:${Math.floor(stats.lastAttendance / 1000)}:f>` : 'Never',
        inline: true,
      },
    );

  embed.addFields({
    name: 'Per Event',
    value: perEventLines.length ? perEventLines.join('\n') : 'No events attended yet.',
  });

  return embed;
}

module.exports = { buildStatsEmbed };
