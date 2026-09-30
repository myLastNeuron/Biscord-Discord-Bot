const { Events } = require('discord.js');
const { getGuildSettings, addInviteUse, recordJoinInviter } = require('../utils/db');
const { buildWelcomeEmbed, buildWelcomeButtons } = require('../utils/welcomeBuilder');
const { resolveUsedInvite, getInviterInviteCounts } = require('../utils/inviteTracker');
const { buildInviteJoinLogEmbed, buildInviteLogComponents } = require('../utils/inviteLogBuilder');
const { sendAuditLog } = require('../utils/auditLogger');

module.exports = {
  name: Events.GuildMemberAdd,
  async execute(member) {
    const settings = getGuildSettings(member.guild.id);

    // Maintenance mode: no welcome message, no invite tracking while turned off.
    if (settings.botEnabled === false) return;

    // ---------- Invite Tracker ----------
    // Runs independently of the welcome message below (still attributes the
    // join even if no welcome channel is set) - only skipped for bots, which
    // join via OAuth2 authorization rather than a trackable invite link.
    // `used` is kept around (not just this block's local concern) because
    // the welcome embed's %inviter% placeholder needs it below - the actual
    // human-readable "who invited them" writeup lives in the dedicated
    // Invite Log channel (settings.inviteLogChannelId) only, not bolted
    // onto the welcome message itself.
    let used = null;
    if (settings.inviteTrackerEnabled && !member.user.bot) {
      used = await resolveUsedInvite(member.guild).catch((err) => {
        console.error(`[inviteTracker] resolveUsedInvite failed for guild ${member.guild.id}:`, err.message);
        return null;
      });

      recordJoinInviter(member.guild.id, member.id, used?.inviterId || null, used?.code || null);

      if (used?.inviterId) {
        addInviteUse(member.guild.id, used.inviterId);
      }

      // ---------- Detailed per-join log message ----------
      // Separate from and in addition to the welcome message below - its
      // own channel, only sent while tracking is on since it needs `used`.
      if (settings.inviteLogChannelId) {
        const logChannel = await member.guild.channels.fetch(settings.inviteLogChannelId).catch(() => null);
        if (logChannel?.isTextBased()) {
          const counts = used?.inviterId ? getInviterInviteCounts(member.guild.id, used.inviterId) : null;
          const embed = buildInviteJoinLogEmbed({ member, client: member.client, used, counts });
          const components = settings.inviteLogShowRevokeButton ? buildInviteLogComponents(used) : [];
          await logChannel.send({ embeds: [embed], components }).catch(() => null);
        }
      }
    }

    if (!settings.welcomeChannelId) return;

    const channel = await member.guild.channels.fetch(settings.welcomeChannelId).catch(() => null);
    if (!channel || !channel.isTextBased()) return;

    // Wrapped defensively: buildWelcomeEmbed/buildWelcomeButtons can throw
    // synchronously (e.g. discord.js builder validation rejecting a bad URL
    // saved into welcomeEmbedDraft) - that's not a promise rejection, so the
    // channel.send() .catch() below wouldn't cover it. One guild's bad
    // config shouldn't be able to crash the whole process on every join.
    try {
      const embed = buildWelcomeEmbed(member, settings, { inviterId: used?.inviterId || null });

      const buttons = buildWelcomeButtons(settings);
      await channel.send({ embeds: [embed], components: buttons }).catch(() => null);
    } catch (err) {
      console.error(`[welcome] Failed to build/send welcome message for guild ${member.guild.id}:`, err);
    }

    // Audit log: member joined
    await sendAuditLog(member.guild, `📥 ${member.user.tag} joined the server (Member #${member.guild.memberCount})`);
  },
};
