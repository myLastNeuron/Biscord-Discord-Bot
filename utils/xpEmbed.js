/**
 * xpEmbed.js
 * Shared XP card used by both the /xp slash command and the !xp prefix command.
 * Single source of truth so the two can never drift.
 */

const { EmbedBuilder } = require('discord.js');
const { getUser, getLevelDefinitions } = require('./levelStore');

function progressBar(current, required, length = 20) {
  const pct = Math.min(current / required, 1);
  const filled = Math.round(pct * length);
  return '█'.repeat(filled) + '░'.repeat(length - filled);
}

function buildXpEmbed(target, guildId) {
  const data = getUser(guildId, target.id);
  const defs = getLevelDefinitions(guildId);
  const current = defs.find(d => d.level === data.level);
  const next = defs.find(d => d.level === data.level + 1);

  const bar = next
    ? progressBar(data.xp, next.xpRequired)
    : '█'.repeat(20) + ' *(MAX)*';

  const xpDisplay = next
    ? `${data.xp.toLocaleString()} / ${next.xpRequired.toLocaleString()} XP`
    : `${data.xp.toLocaleString()} XP (Max level)`;

  return new EmbedBuilder()
    .setColor(0x5865f2)
    .setAuthor({ name: target.username, iconURL: target.displayAvatarURL({ dynamic: true }) })
    .setTitle(`Level ${data.level}${current ? ` — ${current.name}` : ''}`)
    .addFields(
      { name: 'XP', value: xpDisplay, inline: false },
      { name: 'Progress', value: `\`${bar}\``, inline: false },
      { name: 'Total XP', value: `\`${data.totalXp.toLocaleString()}\``, inline: true },
      { name: 'Messages', value: `\`${(data.messageCount ?? 0).toLocaleString()}\``, inline: true },
      { name: 'Next Level', value: next ? `Level ${next.level} — ${next.name}` : '—', inline: true },
    )
    .setTimestamp();
}

module.exports = { buildXpEmbed };
