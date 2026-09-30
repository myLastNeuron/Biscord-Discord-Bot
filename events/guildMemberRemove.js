const { Events } = require('discord.js');
const { getGuildSettings, getJoinInviter, removeJoinInviter, recordInviteLeave } = require('../utils/db');
const { sendAuditLog } = require('../utils/auditLogger');

module.exports = {
  name: Events.GuildMemberRemove,
  async execute(member) {
    const settings = getGuildSettings(member.guild.id);
    if (settings.botEnabled === false) return; // maintenance mode
    if (!settings.inviteTrackerEnabled) return;

    // Look up who we recorded as having invited this member (set in
    // guildMemberAdd.js when they joined) and forget the record either way -
    // whether they leave once or a hundred times, it should only ever
    // decrement their inviter's count once per join.
    const join = getJoinInviter(member.guild.id, member.id);
    removeJoinInviter(member.guild.id, member.id);

    if (join?.inviterId) {
      recordInviteLeave(member.guild.id, join.inviterId);
    }

    // Audit log: member left
    await sendAuditLog(member.guild, `📤 ${member.user.tag} left the server`);
  },
};
