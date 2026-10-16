// Grant / revoke a role in response to a reaction on a reaction-role message.
//
// Both reaction events (messageReactionAdd / messageReactionRemove) call into
// here so the "which emoji, which role, and can we actually assign it" rules
// live in exactly one place. Anything that goes wrong is swallowed and logged
// rather than thrown — a thrown reaction event surfaces as an unhandled
// rejection, not a user-visible error, and can't be caught per-user.
const { PermissionFlagsBits } = require('discord.js');
const store = require('./reactionRoleStore');
const logger = require('./logger');

// Normalises an emoji to the key we store at save time: a custom emoji's
// numeric ID, or the unicode character itself. This is the same reduction
// parseEmojiList() does, so a mapping saved from the builder's emoji input
// matches the emoji that arrives on the reaction event.
function emojiKeyFor(emoji) {
  return emoji.id ? emoji.id : emoji.name;
}

function resolveMapping(record, emoji) {
  if (!record?.mappings?.length) return null;
  const key = emojiKeyFor(emoji);
  return record.mappings.find((m) => m.emojiKey === key) || null;
}

// Guards mirror the role-button path in embedInteractionHandler.js: refuse
// @everyone, integration/managed roles, roles the bot's own top role can't sit
// above, and anything we lack ManageRoles for.
function canManageRole(guild, role, botMember) {
  if (!role) return false;
  if (role.id === guild.id) return false;                 // @everyone
  if (role.managed) return false;                         // bot/integration role
  if (!botMember?.permissions?.has(PermissionFlagsBits.ManageRoles)) return false;
  if (botMember.roles.highest.comparePositionTo(role) <= 0) return false;
  return true;
}

async function applyReactionRole(reaction, user, { add }) {
  if (user.bot) return;

  // After a restart the reacted message can arrive as a partial; fetch it so we
  // have its id, channel and guild.
  let message = reaction.message;
  if (message.partial) {
    message = await message.fetch().catch(() => null);
    if (!message) return;
  }

  const record = store.getByMessage(message.id);
  if (!record) return;

  // Removals are opt-in per message (competitor bots toggle by default, so
  // that's what the builder stores).
  if (!add && !record.toggleOnRemove) return;

  const guild = message.guild;
  if (!guild || guild.id !== record.guildId) return;

  const mapping = resolveMapping(record, reaction.emoji);
  if (!mapping) return;

  const role = guild.roles.cache.get(mapping.roleId)
    ?? await guild.roles.fetch(mapping.roleId).catch(() => null);

  const me = guild.members.me ?? await guild.members.fetchMe().catch(() => null);
  if (!canManageRole(guild, role, me)) {
    logger.warn('reactionRoles', `Skipping ${add ? 'add' : 'remove'} of role ${mapping.roleId} on message ${message.id} (unmanageable or missing)`);
    return;
  }

  const member = await guild.members.fetch(user.id).catch(() => null);
  if (!member) return;

  try {
    if (add) {
      if (!member.roles.cache.has(role.id)) await member.roles.add(role, 'Reaction role');
    } else if (member.roles.cache.has(role.id)) {
      await member.roles.remove(role, 'Reaction role removed');
    }
  } catch (err) {
    logger.err('reactionRoles', err, { messageId: message.id, roleId: role.id, userId: user.id });
  }
}

module.exports = { applyReactionRole };
