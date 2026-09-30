const {
  play, pause, resume, skip, shuffle, remove, setLoop, volume,
  stop, leave, queue, formatDuration,
} = require('./musicManager');

const PREFIX = '!';

const ALIASES = {
  play: 'play',
  p: 'play',
  playlist: 'playlist',
  pause: 'pause',
  resume: 'resume',
  res: 'resume',
  skip: 'skip',
  s: 'skip',
  stop: 'stop',
  shuffle: 'shuffle',
  queue: 'queue',
  q: 'queue',
  np: 'nowplaying',
  nowplaying: 'nowplaying',
  volume: 'volume',
  vol: 'volume',
  v: 'volume',
  loop: 'loop',
  remove: 'remove',
  rm: 'remove',
  leave: 'leave',
  l: 'leave',
};

function formatDurationLabel(sec) {
  return sec ? `\`${formatDuration(sec)}\`` : '`LIVE`';
}

// Handles `!`-prefixed music commands. Returns true if the message was a
// music command (so the caller can skip auto-delete / auto-react against it).
async function handleMusicCommand(message) {
  if (!message.guild || message.author.bot) return false;
  if (!message.content.startsWith(PREFIX)) return false;

  const [rawCmd, ...args] = message.content.slice(PREFIX.length).trim().split(/\s+/);
  const cmd = (rawCmd || '').toLowerCase();
  if (!cmd) return false;

  const name = ALIASES[cmd];
  if (!name) return false; // not a recognized music command — let other handling proceed

  const guildId = message.guild.id;
  const arg = args.join(' ').trim();
  const reply = (text) => message.channel.send(text).catch(() => null);
  const fail = (text) => reply(`❌ ${text}`);

  try {
    switch (name) {
      case 'play': {
        if (!arg) return fail('give me a song name or URL, e.g. `!play never gonna give you up`.');
        const vc = message.member.voice?.channel;
        if (!vc) return fail('join a voice channel first, then try again.');
        const result = await play(vc, message.channel, arg, message.author.id);
        const first = result.first;
        if (result.kind === 'playlist') {
          await reply(`🗒️ Loaded **${result.count}** songs from the playlist — starting with **${first.title}**.`);
        } else if (result.count > 1) {
          await reply(`🎵 Added **${result.count}** songs — starting with **${first.title}**.`);
        } else {
          await reply(`🎵 Playing **${first.title}**.`);
        }
        return true;
      }
      case 'pause': await reply(pause(guildId)); return true;
      case 'resume': await reply(resume(guildId)); return true;
      case 'skip': await reply(await skip(guildId)); return true;
      case 'stop': await reply(stop(guildId)); return true;
      case 'shuffle': await reply(shuffle(guildId)); return true;
      case 'leave': await reply(leave(guildId)); return true;

      case 'volume': {
        let level = parseInt(arg, 10);
        if (!Number.isFinite(level)) return fail('usage: `!volume <0-200>`');
        level = Math.max(0, Math.min(200, level));
        await reply(volume(guildId, level));
        return true;
      }

      case 'loop': {
        const mode = arg.toLowerCase();
        const valid = { off: 'off', song: 'song', track: 'song', queue: 'queue', all: 'queue' };
        if (!valid[mode]) return fail('usage: `!loop off|song|queue`');
        await reply(setLoop(guildId, valid[mode]));
        return true;
      }

      case 'remove': {
        const pos = parseInt(arg, 10);
        if (!Number.isFinite(pos)) return fail('usage: `!remove <position>` — see `!queue`.');
        await reply(remove(guildId, pos));
        return true;
      }

      case 'queue': {
        const snapshot = queue(guildId);
        const { current, queue: q } = snapshot;
        if (!current && !q.length) return fail('the queue is empty — add something with `!play`.');
        const lines = [];
        if (current) lines.push(`▶️ **${current.title}** ${formatDurationLabel(current.durationSec)}`);
        if (q.length) {
          lines.push('');
          q.slice(0, 10).forEach((t, i) => lines.push(`\`${i + 1}.\` **${t.title}** ${formatDurationLabel(t.durationSec)} — <@${t.requestedBy}>`));
          if (q.length > 10) lines.push(`*… and ${q.length - 10} more*`);
        }
        lines.push('', `🔊 Volume ${snapshot.volume}% · 🔁 Loop ${snapshot.loop}`);
        await reply(lines.join('\n'));
        return true;
      }

      case 'nowplaying': {
        const snapshot = queue(guildId);
        if (!snapshot.current) return fail('nothing is playing right now.');
        const t = snapshot.current;
        await reply(`▶️ **${t.title}** ${formatDurationLabel(t.durationSec)} — requested by <@${t.requestedBy}>`);
        return true;
      }

      default:
        return false;
    }
  } catch (err) {
    await fail(err.message || 'something went wrong.');
    return true;
  }
}

module.exports = { handleMusicCommand, PREFIX };