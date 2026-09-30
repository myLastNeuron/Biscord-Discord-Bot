// Builds the compact Components V2 confirmation message used by moderation
// commands (ban/kick/timeout/untimeout/warn/purge) — a colored accent bar +
// a single checkmark line, instead of a classic multi-field embed. Matches
// the same ContainerBuilder/TextDisplayBuilder style already used for
// /panel's dashboard (see panelBuilder.js).
//
// Requires discord.js v14.17+ (same requirement as panelBuilder.js's V2
// usage). IMPORTANT: Discord's IS_COMPONENTS_V2 message flag is permanent
// once a message is first sent with it — it can't be added later via an
// edit. That means if a command defers its reply first (interaction
// .deferReply()), the flag must already be set at defer time, not only
// when editReply() finalizes the content — see purge.js for the pattern.

const { ContainerBuilder, TextDisplayBuilder, MessageFlags } = require('discord.js');

/**
 * @param {object} opts
 * @param {number} opts.color - accent color, e.g. 0xed4245
 * @param {string} opts.emoji - leading emoji, e.g. '✅' or '❌'
 * @param {string} opts.summary - main line, e.g. "ara_rizzon was banned."
 * @param {string[]} [opts.details] - optional extra lines rendered as dim
 *   `-#` subtext underneath the summary (reason, moderator, duration, etc.)
 * @param {boolean} [opts.ephemeral] - adds the Ephemeral flag alongside
 *   IsComponentsV2. Only needed for replies meant to be private (e.g. purge).
 * @returns {{components: ContainerBuilder[], flags: number}} ready to spread
 *   directly into interaction.reply()/editReply()/update().
 */
function buildModActionPayload({ color, emoji, summary, details = [], ephemeral = false }) {
  const container = new ContainerBuilder().setAccentColor(color);

  let content = `${emoji} ${summary}`;
  if (details.length) {
    content += `\n${details.map((d) => `-# ${d}`).join('\n')}`;
  }
  container.addTextDisplayComponents(new TextDisplayBuilder().setContent(content));

  let flags = MessageFlags.IsComponentsV2;
  if (ephemeral) flags |= MessageFlags.Ephemeral;

  return { components: [container], flags };
}

module.exports = { buildModActionPayload };
