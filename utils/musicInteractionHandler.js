// Handles the buttons on the music player card:
//   music:pause · music:skip · music:loop · music:volume · music:stop
// Follows the codebase's handle*Interaction(interaction) => boolean convention
// (see pollInteractionHandler.js) and is wired up in events/interactionCreate.js.
const { MessageFlags } = require('discord.js');
const music = require('./musicManager');

async function handleMusicInteraction(interaction) {
  if (!interaction.isButton?.()) return false;
  const customId = interaction.customId;
  if (typeof customId !== 'string' || !customId.startsWith('music:')) return false;

  const action = customId.slice('music:'.length);
  const guildId = interaction.guildId;
  const session = music.getSession(guildId);

  // Only people sharing the bot's voice channel can control playback.
  if (session?.voiceChannelId && interaction.member?.voice?.channelId !== session.voiceChannelId) {
    await interaction.reply({
      content: '🎧 Join my voice channel to control playback.',
      flags: MessageFlags.Ephemeral,
    }).catch(() => null);
    return true;
  }

  if (action === 'stop') {
    music.leave(guildId);
    await interaction.update({ embeds: [music.stoppedEmbed()], components: [] }).catch(() => null);
    return true;
  }

  if (!session?.current) {
    await interaction.reply({ content: 'Nothing is playing right now.', flags: MessageFlags.Ephemeral }).catch(() => null);
    return true;
  }

  switch (action) {
    case 'pause':
      music.togglePause(guildId);
      break;
    case 'loop':
      music.cycleLoop(guildId);
      break;
    case 'volume':
      music.cycleVolume(guildId);
      break;
    case 'skip':
      music.skip(guildId);
      // The pump edits this same message to the next track — just acknowledge.
      await interaction.deferUpdate().catch(() => null);
      return true;
    default:
      return false;
  }

  await interaction.update({
    embeds: [music.nowPlayingEmbed(session)],
    components: music.playerComponents(session),
  }).catch(() => null);
  return true;
}

module.exports = { handleMusicInteraction };
