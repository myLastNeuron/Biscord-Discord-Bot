const { SlashCommandBuilder, MessageFlags, PermissionFlagsBits } = require('discord.js');
const { TTS_LANGS, languageChoices } = require('../../utils/tts');
const ttsLive = require('../../utils/ttsLiveManager');
const { isKeptAlive } = require('../../keepAlive');

function inVoice(guildId) {
  try {
    const { getVoiceConnection } = require('@discordjs/voice');
    if (getVoiceConnection(guildId)) return true;
  } catch { /* ignore */ }
  if (isKeptAlive(guildId)) return true;
  try {
    const music = require('../../utils/musicManager');
    if (music.getState?.(guildId)?.connection) return true;
  } catch { /* ignore */ }
  return false;
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('tts-live')
    .setDescription('Read chat messages aloud in voice (live TTS).')
    .addSubcommand((sub) =>
      sub
        .setName('start')
        .setDescription('Start reading this text channel aloud in voice.')
        // Only "start" is gated: it can pull the bot into voice and speak.
        // Discord's API only supports default_member_permissions at the
        // command level (not per-subcommand), so this is enforced in code in
        // execute() below. stop/status/test stay open so anyone can mute or
        // inspect it.
        .addStringOption((o) =>
          o.setName('language').setDescription('Voice language (default: English)').addChoices(...languageChoices()),
        ),
    )
    .addSubcommand((sub) => sub.setName('stop').setDescription('Stop reading aloud (stay in voice).'))
    .addSubcommand((sub) => sub.setName('status').setDescription('Show the live TTS status.'))
    .addSubcommand((sub) =>
      sub
        .setName('test')
        .setDescription('Speak one line right now (bypasses chat filters — diagnoses silent bots).')
        .addStringOption((o) =>
          o.setName('text').setDescription('What should I say?').setRequired(false).setMaxLength(200),
        ),
    ),

  async execute(interaction) {
    const sub = interaction.options.getSubcommand();
    const guildId = interaction.guildId;

    if (sub === 'start') {
      // Gate "start" in code (see the builder comment above) — it can pull the
      // bot into voice and speak, unlike stop/status/test.
      if (!interaction.memberPermissions?.has(PermissionFlagsBits.MoveMembers)) {
        return interaction.reply({
          content: '⛔ You need the **Move Members** permission to start live TTS.',
          flags: MessageFlags.Ephemeral,
        });
      }
      const vc = interaction.member?.voice?.channel;
      if (!inVoice(guildId) && !vc) {
        return interaction.reply({
          content: '🔇 Join a voice channel first (or run `/join`), then start live TTS.',
          flags: MessageFlags.Ephemeral,
        });
      }
      const lang = interaction.options.getString('language') || ttsLive.getStatus(guildId)?.lang || 'en';
      // If the bot isn't in voice yet but the user is, join them first via
      // the shared keep-alive connection so /leave keeps working. Await Ready
      // so the first chat line isn't dropped while the connection is still
      // coming up on slow handshakes.
      if (!inVoice(guildId) && vc) {
        await interaction.deferReply({ flags: MessageFlags.Ephemeral });
        const { connectToChannel } = require('../../keepAlive');
        const conn = connectToChannel(vc);
        try {
          const { VoiceConnectionStatus, entersState } = require('@discordjs/voice');
          await entersState(conn, VoiceConnectionStatus.Ready, 15_000);
        } catch {
          return interaction.editReply({
            content: "⚠️ I joined but couldn't get voice ready in time — try `/tts-live start` again. Check I have **Connect** + **Speak** in that channel.",
          });
        }
        const voiceChannelId = vc.id;
        ttsLive.start({ guildId, voiceChannelId, textChannelId: interaction.channelId, lang });
        return interaction.editReply({
          content: `🔊 Live TTS **on** — reading ${interaction.channel} aloud (${TTS_LANGS[lang] || 'English'}). Type something here and I'll say it. If you hear nothing, run \`/tts-live test\` to diagnose.`,
        });
      }
      const voiceChannelId =
        vc?.id || interaction.guild?.members?.me?.voice?.channelId || ttsLive.getStatus(guildId)?.voiceChannelId;
      ttsLive.start({ guildId, voiceChannelId, textChannelId: interaction.channelId, lang });
      return interaction.reply({
        content: `🔊 Live TTS **on** — reading ${interaction.channel} aloud (${TTS_LANGS[lang] || 'English'}). I'll say it as "*Name* said *message*". If you hear nothing, run \`/tts-live test\`.`,
        flags: MessageFlags.Ephemeral,
      });
    }

    if (sub === 'stop') {
      const wasOn = ttsLive.stop(guildId);
      return interaction.reply({
        content: wasOn ? '🔇 Live TTS **off** — staying in voice. (`/leave` to disconnect.)' : 'Live TTS is already off.',
        flags: MessageFlags.Ephemeral,
      });
    }

    // status
    const status = ttsLive.getStatus(guildId);
    if (sub === 'test') {
      if (!status) {
        return interaction.reply({
          content: 'Live TTS is **off**. Run `/tts-live start` first, then `/tts-live test`.',
          flags: MessageFlags.Ephemeral,
        });
      }
      if (!inVoice(guildId)) {
        return interaction.reply({
          content: "⚠️ I'm not in voice anymore — run `/tts-live start` again (or `/join`), then retry the test.",
          flags: MessageFlags.Ephemeral,
        });
      }
      const text = interaction.options.getString('text') || 'Live TTS test. If you hear this, chat reading works.';
      try {
        ttsLive.queueTestLine(guildId, text);
      } catch (err) {
        return interaction.reply({ content: `⚠️ Couldn't queue the test: \`${err.message}\``, flags: MessageFlags.Ephemeral });
      }
      return interaction.reply({
        content: `🔊 Queued a test line — listen in <#${status.voiceChannelId}>. If you hear nothing, run \`/tts-live status\` in ~5s; a \`last error\` there (or \`tts-live fetch/playback failed\` in console) says whether it's network vs voice.`,
        flags: MessageFlags.Ephemeral,
      });
    }
    if (!status) {
      return interaction.reply({
        content: 'Live TTS is **off**. Run `/join` or `/tts-live start` to turn it on.',
        flags: MessageFlags.Ephemeral,
      });
    }
    return interaction.reply({
      content:
        `🔊 Live TTS **on** — reading <#${status.textChannelId}> in <#${status.voiceChannelId}> ` +
        `(${TTS_LANGS[status.lang] || status.lang})${status.speaking ? ' · speaking now' : ''}${
          status.queued ? ` · ${status.queued} queued` : ''
        }${status.lastError ? `\n⚠️ Last error: \`${status.lastError}\`` : ''}${
          !status.lastError && !status.speaking && !status.queued
            ? '\n(No errors, nothing queued — make sure you type in the bound text channel above, plain text, no `!` prefix. Or run `/tts-live test`.)'
            : ''
        }.`,
      flags: MessageFlags.Ephemeral,
    });
  },
};
