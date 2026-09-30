/**
 * levelNotify.js
 * Sends a level-up message according to the server's notification settings.
 * Also handles role assignment for the new level.
 */

const { EmbedBuilder } = require('discord.js');
const { getSettings }  = require('./levelStore');

/**
 * @param {object} opts
 * @param {import('discord.js').GuildMember} opts.member
 * @param {import('discord.js').TextChannel}  opts.channel   — the channel the action happened in
 * @param {import('discord.js').Client}       opts.client
 * @param {number}  opts.newLevel
 * @param {string}  opts.levelName
 * @param {number}  opts.totalXp
 * @param {string|null} opts.roleId   — role to assign, or null
 */
async function notifyLevelUp({ member, channel, client, newLevel, levelName, totalXp, roleId }) {
  const settings = getSettings(member.guild.id);

  // ── 1. Assign role ────────────────────────────────────────────────────────
  if (roleId) {
    try {
      const role = member.guild.roles.cache.get(roleId);
      if (role && !member.roles.cache.has(roleId)) {
        await member.roles.add(role, `Level ${newLevel} — ${levelName}`);
      }
    } catch (err) {
      console.warn(`[levels] Could not assign role ${roleId} to ${member.user.tag}:`, err.message);
    }
  }

  // ── 2. Build embed ────────────────────────────────────────────────────────
  const embed = new EmbedBuilder()
    .setColor(0xf5a623)
    .setTitle('⬆️  Level Up!')
    .setDescription(
      `${member} just reached **Level ${newLevel}** — **${levelName}**!` +
      (roleId ? `\n🎭 You've been given the <@&${roleId}> role.` : '')
    )
    .addFields(
      { name: 'Total XP', value: `\`${totalXp.toLocaleString()}\``, inline: true },
      { name: 'New Level', value: `\`${newLevel}\``, inline: true },
      { name: 'Rank Title', value: `\`${levelName}\``, inline: true },
    )
    .setThumbnail(member.user.displayAvatarURL({ dynamic: true }))
    .setTimestamp();

  const send = (target) => target.send({ embeds: [embed] }).catch(() => {});

  // ── 3. Send according to settings ─────────────────────────────────────────
  const tasks = [];

  if (settings.notifyDM) {
    tasks.push(member.user.send({ embeds: [embed] }).catch(() => {}));
  }

  if (settings.notifyDedicatedChannel && settings.notifyChannel) {
    const ch = client.channels.cache.get(settings.notifyChannel);
    if (ch) tasks.push(send(ch));
  }

  if (settings.notifySameChannel && channel) {
    tasks.push(send(channel));
  }

  await Promise.allSettled(tasks);
}

module.exports = { notifyLevelUp };
