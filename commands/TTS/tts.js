const { SlashCommandBuilder, MessageFlags } = require('discord.js');
const { TTS_LANGS, MAX_TOTAL_CHARS, textToSpeechBuffer } = require('../../utils/tts');
const { info, warn } = require('../../utils/logger');

// 10s per-user cooldown — TTS is network-cheap but unbounded spam would
// hammer Google (429s) and flood channels. In-memory only; resets on restart.
const cooldowns = new Map(); // userId -> timestamp ms
const COOLDOWN_MS = 10_000;

function languageChoices() {
  return Object.entries(TTS_LANGS).map(([code, name]) => ({ name: `${name} (${code})`, value: code }));
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('tts')
    .setDescription('Turn text into a voice MP3 file')
    .addStringOption((o) =>
      o
        .setName('text')
        .setDescription(`What should I say? (max ${MAX_TOTAL_CHARS} chars)`)
        .setRequired(true)
        .setMaxLength(MAX_TOTAL_CHARS),
    )
    .addStringOption((o) =>
      o.setName('language').setDescription('Voice language (default: English)').addChoices(...languageChoices()),
    )
    .addBooleanOption((o) => o.setName('spoiler').setDescription('Send the MP3 as a spoiler file')),

  async execute(interaction) {
    const userId = interaction.user.id;
    const now = Date.now();

    const lastUsed = cooldowns.get(userId) || 0;
    if (now - lastUsed < COOLDOWN_MS) {
      const wait = Math.ceil((COOLDOWN_MS - (now - lastUsed)) / 1000);
      return interaction.reply({
        content: `⏳ Slow down — try again in ${wait}s.`,
        flags: MessageFlags.Ephemeral,
      });
    }
    cooldowns.set(userId, now);

    const text = interaction.options.getString('text', true);
    const lang = interaction.options.getString('language') || 'en';
    const spoiler = interaction.options.getBoolean('spoiler') || false;

    await interaction.deferReply();

    try {
      const { audio, chunks, tookMs } = await textToSpeechBuffer(text, lang);
      info('tts', `generated ${audio.length} bytes in ${tookMs}ms (${chunks} chunk(s))`, {
        userId,
        guildId: interaction.guildId,
      });

      const preview = text.length > 150 ? `${text.slice(0, 150)}…` : text;
      const filename = spoiler ? 'SPOILER_tts.mp3' : 'tts.mp3';

      return interaction.editReply({
        content: `🔊 **${preview}**`,
        files: [{ attachment: audio, name: filename }],
      });
    } catch (err) {
      // Don't hold the cooldown against users when the upstream failed.
      cooldowns.delete(userId);
      warn('tts', `failed: ${err.message}`, { userId, guildId: interaction.guildId });

      const friendly = err.status === 429
        ? '⚠️ TTS is rate-limited right now — try again in ~10s.'
        : `⚠️ Couldn't generate that audio: \`${err.message || err}\``;
      return interaction.editReply({ content: friendly });
    }
  },
};
