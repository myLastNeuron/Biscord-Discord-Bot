const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');
const { connectToChannel, isKeptAlive } = require('../../keepAlive');
const ttsLive = require('../../utils/ttsLiveManager');

// /join — joins your voice channel (same keep-alive connection /leave uses)
// and auto-enables the live TTS reader bound to the text channel where you
// ran the command. Use /tts-live stop to mute reading without leaving.
module.exports = {
  data: new SlashCommandBuilder()
    .setName('join')
    .setDescription('Join your voice channel and read chat aloud (live TTS).')
    // Summoning the bot into voice and making it read a channel aloud is a
    // moderation action — restrict to members who can move members.
    .setDefaultMemberPermissions(PermissionFlagsBits.MoveMembers),

  async execute(interaction) {
    const channel = interaction.member?.voice?.channel;

    if (!channel) {
      return interaction.reply({
        content: 'You need to be in a voice channel for me to join.',
        ephemeral: true,
      });
    }

    if (channel.joinable === false) {
      return interaction.reply({
        content: "I can't join that voice channel — check my **Connect** permission.",
        ephemeral: true,
      });
    }
    if (channel.speakable === false) {
      return interaction.reply({
        content: "I can't speak in that voice channel — check my **Speak** permission.",
        ephemeral: true,
      });
    }

    if (isKeptAlive(interaction.guildId)) {
      // Already holding a VC: just (re)bind the reader instead of erroring,
      // so /join doubles as "read THIS channel now".
      ttsLive.start({
        guildId: interaction.guildId,
        voiceChannelId: channel.id,
        textChannelId: interaction.channelId,
        lang: ttsLive.getStatus(interaction.guildId)?.lang || 'en',
      });
      return interaction.reply({
        content: `I'm already in voice — now reading ${interaction.channel} aloud in **${channel.name}**. Use \`/tts-live stop\` to mute, \`/leave\` to disconnect.`,
        ephemeral: true,
      });
    }

    await interaction.deferReply({ ephemeral: true });
    const conn = connectToChannel(channel);
    try {
      const { VoiceConnectionStatus, entersState } = require('@discordjs/voice');
      await entersState(conn, VoiceConnectionStatus.Ready, 15_000);
    } catch {
      return interaction.editReply({
        content: "⚠️ I joined but couldn't get voice ready in time — try `/join` again. Check I have **Connect** + **Speak** in that channel.",
      });
    }
    ttsLive.start({
      guildId: interaction.guildId,
      voiceChannelId: channel.id,
      textChannelId: interaction.channelId,
      lang: 'en',
    });

    return interaction.editReply({
      content: `Joined **${channel.name}** and reading ${interaction.channel} aloud. Type anything here and I'll say it live. (If you hear nothing, run \`/tts-live test\`. \`/tts-live stop\` to mute, \`/leave\` to disconnect.)`,
    });
  },
};
