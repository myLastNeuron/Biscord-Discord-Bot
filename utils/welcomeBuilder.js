const { EmbedBuilder } = require('discord.js');
const { buildEmbedFromDraft, buildLiveButtonRows } = require('./embedBuilder');
const { resolveWelcomePlaceholders } = require('./placeholders');

// ---------- Legacy plain-text placeholders (curly-brace style) ----------
// Kept for guilds still using the original single-line welcomeMessage string
// (pre-embed-builder). New rich embeds use the %placeholder% style from
// utils/placeholders.js instead - see resolveDraftPlaceholders() below.
function fillPlaceholders(template, member) {
  return template
    .replaceAll('{user}', `<@${member.id}>`)
    .replaceAll('{server}', member.guild.name)
    .replaceAll('{memberCount}', `${member.guild.memberCount}`);
}

// Deep-resolves every %placeholder% in a welcome embed draft's text fields -
// title, description, title URL, author name/icon, footer text/icon, field
// name/value, and (deliberately) thumbnail/image URLs too, so something like
// %userAvatar% can be used directly as the thumbnail/image itself.
function resolveDraftPlaceholders(draft, context) {
  const resolve = (text) => resolveWelcomePlaceholders(text, context);
  const cloned = JSON.parse(JSON.stringify(draft));

  cloned.title = resolve(cloned.title);
  cloned.description = resolve(cloned.description);
  cloned.url = resolve(cloned.url);
  cloned.thumbnail = resolve(cloned.thumbnail);
  cloned.image = resolve(cloned.image);
  if (cloned.author) {
    cloned.author.name = resolve(cloned.author.name);
    cloned.author.iconURL = resolve(cloned.author.iconURL);
  }
  if (cloned.footer) {
    cloned.footer.text = resolve(cloned.footer.text);
    cloned.footer.iconURL = resolve(cloned.footer.iconURL);
  }
  if (cloned.fields?.length) {
    cloned.fields = cloned.fields.map((f) => ({ ...f, name: resolve(f.name), value: resolve(f.value) }));
  }

  return cloned;
}

// Builds the embed sent on member join. Prefers the rich embed-builder draft
// (settings.welcomeEmbedDraft, configured via /panel > Welcome Settings >
// Edit Welcome Embed); falls back to the original single-line
// welcomeMessage/welcomeImage strings for guilds that haven't switched over,
// so existing setups keep working exactly as before with zero migration.
function buildWelcomeEmbed(member, settings, context = {}) {
  if (settings.welcomeEmbedDraft) {
    const resolved = resolveDraftPlaceholders(settings.welcomeEmbedDraft, { member, ...context });
    return buildEmbedFromDraft(resolved);
  }

  const embed = new EmbedBuilder()
    .setColor(0x57f287)
    .setTitle(`Welcome to ${member.guild.name}! 👋`)
    .setDescription(fillPlaceholders(settings.welcomeMessage, member))
    .setThumbnail(member.user.displayAvatarURL({ size: 256 }))
    .setFooter({ text: `Member #${member.guild.memberCount}` })
    .setTimestamp();

  if (settings.welcomeImage) embed.setImage(settings.welcomeImage);
  return embed;
}

// Any self-role/link buttons attached via the embed builder - [] for guilds
// still on the legacy plain welcomeMessage, which never had buttons.
function buildWelcomeButtons(settings) {
  if (!settings.welcomeEmbedDraft) return [];
  return buildLiveButtonRows(settings.welcomeEmbedDraft.buttons || []);
}

module.exports = { buildWelcomeEmbed, buildWelcomeButtons, fillPlaceholders };
