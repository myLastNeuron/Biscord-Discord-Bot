const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const {
  play, pause, resume, skip, shuffle, remove, setLoop, volume,
  stop, leave, queue, formatDuration, trackEmbed, MAX_VOLUME,
} = require('../../utils/musicManager');
const { PREMIUM_COLORS } = require('../../utils/theme');

function musicEmbed(color, title, description, fields = [], footer) {
  const embed = new EmbedBuilder()
    .setColor(color)
    .setTitle(title)
    .setDescription(description)
    .addFields(fields);
  if (footer) embed.setFooter(footer);
  return embed;
}

function replyQueue(interaction, snapshot) {
  const { current, queue: q, volume: v, loop } = snapshot;
  if (!current && q.length === 0) {
    return interaction.reply({ content: 'The queue is empty — add something with `/music play`.', ephemeral: true });
  }

  const lines = [];
  if (current) {
    lines.push(
      `▶️ **[${current.title.replace(/[[\]]/g, '')}](${current.url})** — \`${formatDuration(current.durationSec)}\``,
    );
  }
  if (q.length) {
    const shown = q.slice(0, 10);
    lines.push('', ...shown.map((t, i) => `\`${i + 1}.\` [${t.title.replace(/[[\]]/g, '')}](${t.url}) — \`${formatDuration(t.durationSec)}\` requested by <@${t.requestedBy}>`));
    if (q.length > 10) lines.push(`*… and ${q.length - 10} more*`);
  } else {
    lines.push('');
    lines.push('*Nothing else queued — next track ends the session.*');
  }

  return interaction.reply({
    embeds: [musicEmbed(
      PREMIUM_COLORS.accent,
      '🎶 Queue',
      lines.join('\n'),
      [
        { name: 'Volume', value: `${v}%`, inline: true },
        { name: 'Loop', value: loop, inline: true },
      ],
      { text: current && q.length ? `${q.length} queued` : 'Up next' },
    )],
  });
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('music')
    .setDescription('Play music from YouTube in a voice channel')
    .addSubcommand(sub => sub
      .setName('play')
      .setDescription('Play a song by name or YouTube URL (adds to the queue)')
      .addStringOption(opt => opt.setName('query').setDescription('Song name or YouTube URL (playlists work too)').setRequired(true)))
    .addSubcommand(sub => sub.setName('pause').setDescription('Pause the current song'))
    .addSubcommand(sub => sub.setName('resume').setDescription('Resume the paused song'))
    .addSubcommand(sub => sub.setName('skip').setDescription('Skip to the next song in the queue'))
    .addSubcommand(sub => sub
      .setName('shuffle')
      .setDescription('Shuffle the queued songs'))
    .addSubcommand(sub => sub.setName('stop').setDescription('Stop playback, clear the queue, and leave voice'))
    .addSubcommand(sub => sub.setName('leave').setDescription('Leave the voice channel (queue is kept)'))
    .addSubcommand(sub => sub
      .setName('remove')
      .setDescription('Remove a song from the queue by position (see /music queue)')
      .addIntegerOption(opt => opt.setName('position').setDescription('Position of the song in the queue').setRequired(true).setMinValue(1)))
    .addSubcommand(sub => sub
      .setName('loop')
      .setDescription('Set the loop mode')
      .addStringOption(opt => opt.setName('mode')
        .setDescription('What to loop')
        .setRequired(true)
        .addChoices(
          { name: 'Off', value: 'off' },
          { name: 'Current track', value: 'song' },
          { name: 'Whole queue', value: 'queue' },
        )))
    .addSubcommand(sub => sub
      .setName('volume')
      .setDescription('Set the playback volume')
      .addIntegerOption(opt => opt.setName('level').setDescription(`Volume 0-${MAX_VOLUME}`).setRequired(true).setMinValue(0).setMaxValue(MAX_VOLUME)))
    .addSubcommand(sub => sub.setName('queue').setDescription('Show the current queue'))
    .addSubcommand(sub => sub.setName('nowplaying').setDescription('Show what\'s currently playing')),

  async execute(interaction) {
    const sub = interaction.options.getSubcommand();
    const guildId = interaction.guild.id;

    try {
      switch (sub) {
        case 'play': {
          const query = interaction.options.getString('query');
          const vc = interaction.member.voice?.channel;
          if (!vc) {
            return interaction.reply({ content: '🔇 Join a voice channel first, then try again.', ephemeral: true });
          }
          await interaction.deferReply();
          const result = await play(vc, interaction.channel, query, interaction.user.id);
          const first = result.first;
          const header = result.started
            ? (result.kind === 'playlist' ? '🎶 Now Playing — Playlist' : '🎶 Now Playing')
            : '📥 Added to Queue';
          await interaction.editReply({
            embeds: [trackEmbed(first, {
              header,
              requesterId: interaction.user.id,
              queued: result.started ? result.count - 1 : result.count,
            })],
          });
          return;
        }
        case 'pause': return interaction.reply(pause(guildId));
        case 'resume': return interaction.reply(resume(guildId));
        case 'skip': return interaction.reply(await skip(guildId));
        case 'shuffle': return interaction.reply(shuffle(guildId));
        case 'remove': {
          const position = interaction.options.getInteger('position');
          return interaction.reply(remove(guildId, position));
        }
        case 'loop': {
          const mode = interaction.options.getString('mode');
          return interaction.reply(setLoop(guildId, mode));
        }
        case 'volume': {
          const level = interaction.options.getInteger('level');
          return interaction.reply(volume(guildId, level));
        }
        case 'stop': return interaction.reply(stop(guildId));
        case 'leave': return interaction.reply(leave(guildId));
        case 'queue': return replyQueue(interaction, queue(guildId));
        case 'nowplaying': {
          const snapshot = queue(guildId);
          if (!snapshot.current) {
            return interaction.reply({ content: 'Nothing is playing right now.', ephemeral: true });
          }
          const t = snapshot.current;
          return interaction.reply({
            embeds: [trackEmbed(t, {
              positionSec: snapshot.position,
              volume: snapshot.volume,
              loop: snapshot.loop,
              queued: snapshot.queue.length,
              requesterId: t.requestedBy,
            })],
          });
        }
        default:
          return interaction.reply({ content: 'Unknown music subcommand.', ephemeral: true });
      }
    } catch (err) {
      const payload = { content: `❌ ${err.message}`, ephemeral: true };
      if (interaction.replied || interaction.deferred) await interaction.followUp(payload).catch(() => null);
      else await interaction.reply(payload).catch(() => null);
    }
  },
};