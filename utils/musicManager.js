// Music playback engine.
// -----------------------
// Source: the `yt-dlp` binary (resolve + stream). Transcode: `ffmpeg-static`
// (already a dependency). Playback: `@discordjs/voice` (already a dependency).
// No new npm deps, no temp files, no audio cache — one Map entry per guild
// while a session is alive, same low-RAM shape as utils/ttsLiveManager.js.
//
// Pipeline per track:  yt-dlp -f bestaudio -o -  |  ffmpeg -> s16le 48k stereo
// -> createAudioResource(StreamType.Raw) -> AudioPlayer -> voice connection.
//
// yt-dlp is expected on PATH; override with YTDLP_PATH. If it's missing every
// play fails with a clear message instead of a silent no-op.

const { spawn } = require('child_process');
const {
  joinVoiceChannel,
  getVoiceConnection,
  createAudioPlayer,
  createAudioResource,
  AudioPlayerStatus,
  VoiceConnectionStatus,
  entersState,
  StreamType,
} = require('@discordjs/voice');
const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const { info, warn, debug } = require('./logger');
const { fmtTime, parseTime, progressBar } = require('./musicFormat');

// The music module deliberately does NOT use the bot's shared small-caps theme —
// it has its own modern player look: a violet accent, emoji section headers,
// and inline stat fields.
const MUSIC_COLORS = {
  accent: 0x7C5CFF, // violet
  stop: 0xED4245,   // clean red
};

const YTDLP = process.env.YTDLP_PATH || 'yt-dlp';

let FFMPEG = 'ffmpeg';
try {
  const p = require('ffmpeg-static');
  if (typeof p === 'string' && p) FFMPEG = p;
} catch { /* fall back to ffmpeg on PATH */ }

const PREFIX = '!';
const READY_TIMEOUT_MS = 15_000;
const RESOLVE_TIMEOUT_MS = 25_000;
const VOLUME_MAX = 200; // percent

// ---------- Errors users are allowed to see verbatim ----------
class UserError extends Error {}

// guildId -> session
const sessions = new Map();

function getSession(guildId) {
  const s = sessions.get(guildId);
  return s && !s.destroyed ? s : null;
}

function createSession(guildId) {
  const player = createAudioPlayer();
  const session = {
    guildId,
    queue: [],
    current: null,
    player,
    connection: null,
    voiceChannelId: null,
    textChannelId: null,
    loop: 'off',
    volume: 1,
    pumping: false,
    destroyed: false,
    skipRequested: false,
    restartRequested: false,
    trackStartedAt: 0,
    pausedAt: 0,
    pausedTotal: 0,
    proc: null,
    resource: null,
    playerMessage: null, // the message the buttons/embed get edited on track changes
  };
  player.on('error', (err) => warn('music', `player error: ${err?.message || err}`, { guildId }));
  sessions.set(guildId, session);
  return session;
}

// ---------- yt-dlp: metadata ----------
function runYtdlp(args, timeoutMs = RESOLVE_TIMEOUT_MS) {
  return new Promise((resolve, reject) => {
    let proc;
    try {
      proc = spawn(YTDLP, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    } catch (err) {
      return reject(new UserError(`Could not start yt-dlp: ${err.message}`));
    }
    let out = '';
    let errOut = '';
    const timer = setTimeout(() => {
      try { proc.kill('SIGKILL'); } catch { /* gone */ }
      reject(new UserError('Lookup timed out — try again.'));
    }, timeoutMs);
    timer.unref?.();

    proc.stdout.on('data', (d) => { out += d; });
    proc.stderr.on('data', (d) => { errOut += d; });
    proc.on('error', (err) => {
      clearTimeout(timer);
      reject(err.code === 'ENOENT'
        ? new UserError('`yt-dlp` isn’t installed on the host — install it or set `YTDLP_PATH`.')
        : new UserError(`Could not start yt-dlp: ${err.message}`));
    });
    proc.on('close', (code) => {
      clearTimeout(timer);
      if (code === 0 && out.trim()) return resolve(out);
      const firstLine = errOut.split('\n').map((l) => l.trim()).find(Boolean);
      reject(new UserError(firstLine ? firstLine.slice(0, 200) : 'No results found.'));
    });
  });
}

async function resolveTrack(query, ctx) {
  const raw = (query || '').trim();
  if (!raw) throw new UserError('Give me a song name or a URL.');
  const target = /^https?:\/\//i.test(raw) ? raw : `ytsearch1:${raw}`;
  const fields = '%(id)s\t%(title)s\t%(duration)s\t%(uploader)s\t%(thumbnail)s\t%(webpage_url)s';
  const out = await runYtdlp(['--no-playlist', '--no-warnings', '--print', fields, target]);
  const line = out.split('\n').map((l) => l.trim()).filter(Boolean)[0];
  if (!line) throw new UserError('No results found.');
  const [id, title, duration, uploader, thumbnail, webpageUrl] = line.split('\t');
  return {
    id: id || webpageUrl,
    title: title || 'Unknown title',
    duration: Number(duration) || 0,
    uploader: uploader || '',
    thumbnail: thumbnail || null,
    webpageUrl: webpageUrl || raw,
    url: webpageUrl || raw,
    requesterId: ctx?.userId || null,
    requesterTag: ctx?.tag || 'unknown',
    startOffset: 0,
  };
}

// ---------- Voice connection ----------
async function ensureConnection(voiceChannel) {
  const guildId = voiceChannel.guild.id;
  let conn = getVoiceConnection(guildId);
  const sameChannel = conn && conn.joinConfig?.channelId === voiceChannel.id;

  if (sameChannel && conn.state.status !== VoiceConnectionStatus.Destroyed) {
    if (conn.state.status !== VoiceConnectionStatus.Ready) {
      try { await entersState(conn, VoiceConnectionStatus.Ready, READY_TIMEOUT_MS); } catch { /* try anyway */ }
    }
    return conn;
  }

  if (conn) { try { conn.destroy(); } catch { /* already gone */ } }
  conn = joinVoiceChannel({
    channelId: voiceChannel.id,
    guildId,
    adapterCreator: voiceChannel.guild.voiceAdapterCreator,
    selfDeaf: true,
  });
  try {
    await entersState(conn, VoiceConnectionStatus.Ready, READY_TIMEOUT_MS);
  } catch {
    throw new UserError('I couldn’t connect to voice in time — check my **Connect** + **Speak** permissions and try again.');
  }
  return conn;
}

async function attach(session, voiceChannel) {
  const conn = await ensureConnection(voiceChannel);
  if (session.connection !== conn) {
    session.connection = conn;
    session.subscribedTo = null;
  }
  if (session.subscribedTo !== conn) {
    try {
      conn.subscribe(session.player);
      session.subscribedTo = conn;
    } catch (err) {
      warn('music', `subscribe failed: ${err?.message || err}`, { guildId: session.guildId });
    }
  }
  session.voiceChannelId = voiceChannel.id;
}

// ---------- Audio pipeline ----------
function spawnStream(track) {
  const ffArgs = ['-hide_banner', '-loglevel', 'error'];
  const offset = Number(track.startOffset) || 0;
  if (offset > 0) ffArgs.push('-ss', String(offset));
  ffArgs.push('-i', 'pipe:0', '-vn', '-f', 's16le', '-ar', '48000', '-ac', '2', 'pipe:1');

  const ffmpeg = spawn(FFMPEG, ffArgs, { stdio: ['pipe', 'pipe', 'ignore'] });
  const ytdlp = spawn(YTDLP, ['-f', 'bestaudio', '--no-playlist', '--no-warnings', '-o', '-', track.url], {
    stdio: ['ignore', 'pipe', 'ignore'],
  });

  ytdlp.stdout.pipe(ffmpeg.stdin);
  ytdlp.on('close', () => { try { ffmpeg.stdin.end(); } catch { /* already closed */ } });
  ytdlp.on('error', () => { try { ffmpeg.stdin.end(); } catch { /* already closed */ } });
  return { ytdlp, ffmpeg };
}

function cleanupProc(session) {
  const p = session.proc;
  session.proc = null;
  session.resource = null;
  if (!p) return;
  try { p.ytdlp.stdout?.unpipe?.(); } catch { /* ignore */ }
  try { p.ytdlp.kill('SIGKILL'); } catch { /* ignore */ }
  try { p.ffmpeg.stdin?.destroy?.(); } catch { /* ignore */ }
  try { p.ffmpeg.kill('SIGKILL'); } catch { /* ignore */ }
}

function spawnError(err, which) {
  if (err?.code === 'ENOENT') {
    return new UserError(`\`${which}\` isn’t installed on the host — install it (or set \`${which === 'yt-dlp' ? 'YTDLP_PATH' : 'FFMPEG_PATH'}\`).`);
  }
  return new UserError(`${which} failed: ${err?.message || err}`);
}

function playTrack(session, track) {
  return new Promise((resolve, reject) => {
    const player = session.player;
    let settled = false;

    const onIdle = () => finish(null);
    const onError = (err) => finish(err);
    const finish = (err) => {
      if (settled) return;
      settled = true;
      player.off(AudioPlayerStatus.Idle, onIdle);
      player.off('error', onError);
      if (err) {
        try { player.stop(true); } catch { /* ignore */ }
        reject(err);
      } else {
        resolve();
      }
    };

    let streams;
    try { streams = spawnStream(track); } catch (err) { return finish(err); }
    session.proc = streams;

    streams.ytdlp.on('error', (e) => finish(spawnError(e, 'yt-dlp')));
    streams.ffmpeg.on('error', (e) => finish(spawnError(e, 'ffmpeg')));

    const resource = createAudioResource(streams.ffmpeg.stdout, {
      inputType: StreamType.Raw,
      inlineVolume: true,
    });
    if (resource.volume) resource.volume.setVolume(session.volume);
    session.resource = resource;

    player.once(AudioPlayerStatus.Idle, onIdle);
    player.once('error', onError);
    try { player.play(resource); } catch (err) { finish(err); }
  });
}

// ---------- Queue pump (one track at a time, promise-based — same shape as
// the ttsLiveManager pump, which keeps this easy to reason about). ----------
async function pump(session) {
  if (session.pumping || session.destroyed) return;
  session.pumping = true;
  try {
    while (!session.destroyed && session.queue.length) {
      const track = session.queue[0];
      session.current = track;
      session.trackStartedAt = Date.now();
      session.pausedAt = 0;
      session.pausedTotal = 0;
      await updatePlayerMessage(session); // no-op on the very first track

      let playErr = null;
      try {
        await playTrack(session, track);
      } catch (err) {
        playErr = err;
        warn('music', `playback error: ${err?.message || err}`, { guildId: session.guildId });
      }
      cleanupProc(session);
      if (session.destroyed) break;

      // /seek restarts the same track without touching the queue.
      if (session.restartRequested) {
        session.restartRequested = false;
        continue;
      }
      // A failed track is dropped, never re-looped (would spin forever).
      if (playErr) {
        session.queue.shift();
        session.current = null;
        continue;
      }

      const skipped = session.skipRequested;
      session.skipRequested = false;
      session.current = null;

      if (!skipped && session.loop === 'track') continue; // replay queue[0]

      const finished = session.queue.shift();
      if (!skipped && session.loop === 'queue' && finished) session.queue.push(finished);
    }
  } finally {
    session.pumping = false;
    session.current = null;
  }
  if (!session.destroyed) await finalizePlayerMessage(session);
}

// ---------- Public: playback ----------
async function play(ctx, query) {
  const voiceChannel = ctx?.member?.voice?.channel;
  if (!voiceChannel) throw new UserError('Join a voice channel first, then run that again.');
  if (voiceChannel.joinable === false) throw new UserError('I can’t join that channel — check my **Connect** permission.');
  if (voiceChannel.speakable === false) throw new UserError('I can’t speak in that channel — check my **Speak** permission.');

  let session = getSession(ctx.guildId);
  if (session && session.voiceChannelId && session.voiceChannelId !== voiceChannel.id) {
    throw new UserError(`I’m already playing in <#${session.voiceChannelId}>. Join that channel, or run \`/stop\` first.`);
  }
  if (!session) session = createSession(ctx.guildId);

  const track = await resolveTrack(query, ctx);
  const wasEmpty = session.queue.length === 0;
  session.queue.push(track);
  session.textChannelId = ctx.textChannelId;

  await attach(session, voiceChannel);
  void pump(session).catch((err) => warn('music', `pump failed: ${err?.message || err}`, { guildId: ctx.guildId }));

  debug('music', `queued "${track.title}" (pos ${session.queue.length})`, { guildId: ctx.guildId });
  return { track, position: session.queue.length, nowPlaying: wasEmpty, session };
}

function skip(guildId) {
  const s = getSession(guildId);
  if (!s?.current) return null;
  const skipped = s.current;
  s.skipRequested = true;
  try { s.player.stop(true); } catch { /* already idle */ }
  return skipped;
}

function pause(guildId) {
  const s = getSession(guildId);
  if (!s?.current) return false;
  const ok = s.player.pause();
  if (ok) s.pausedAt = Date.now();
  return ok;
}

function resume(guildId) {
  const s = getSession(guildId);
  if (!s) return false;
  const ok = s.player.unpause();
  if (ok && s.pausedAt) {
    s.pausedTotal += Date.now() - s.pausedAt;
    s.pausedAt = 0;
  }
  return ok;
}

function isPaused(guildIdOrSession) {
  const s = typeof guildIdOrSession === 'string' ? getSession(guildIdOrSession) : guildIdOrSession;
  return s?.player?.state?.status === AudioPlayerStatus.Paused;
}

// One button does both: pause if playing, resume if paused.
function togglePause(guildId) {
  const s = getSession(guildId);
  if (!s?.current) return null;
  if (isPaused(s)) {
    resume(guildId);
    return 'resumed';
  }
  pause(guildId);
  return 'paused';
}

function seek(guildId, seconds) {
  const s = getSession(guildId);
  if (!s?.current) return false;
  s.current.startOffset = Math.max(0, seconds);
  s.trackStartedAt = Date.now();
  s.pausedAt = 0;
  s.pausedTotal = 0;
  s.restartRequested = true;
  try { s.player.stop(true); } catch { /* already idle */ }
  return true;
}

function setLoop(guildId, mode) {
  const s = getSession(guildId);
  if (!s) return null;
  const normalized = mode === 'song' ? 'track' : mode;
  if (['off', 'track', 'queue'].includes(normalized)) s.loop = normalized;
  return s.loop;
}

function cycleLoop(guildId) {
  const s = getSession(guildId);
  if (!s) return null;
  s.loop = s.loop === 'off' ? 'track' : s.loop === 'track' ? 'queue' : 'off';
  return s.loop;
}

function setVolume(guildId, percent) {
  const s = getSession(guildId);
  if (!s) return null;
  const v = Math.max(0, Math.min(VOLUME_MAX, Math.round(percent)));
  s.volume = v / 100;
  try { s.resource?.volume?.setVolume(s.volume); } catch { /* no active resource */ }
  return v;
}

// The volume button steps through these presets.
const VOLUME_STEPS = [0, 25, 50, 75, 100, 125, 150, 200];

function cycleVolume(guildId) {
  const s = getSession(guildId);
  if (!s) return null;
  const current = Math.round(s.volume * 100);
  const idx = VOLUME_STEPS.indexOf(current);
  const next = idx === -1 ? 100 : VOLUME_STEPS[(idx + 1) % VOLUME_STEPS.length];
  return setVolume(guildId, next);
}

function shuffle(guildId) {
  const s = getSession(guildId);
  if (!s) return false;
  const start = s.current ? 1 : 0; // never move the track that's playing
  for (let i = s.queue.length - 1; i > start; i--) {
    const j = start + Math.floor(Math.random() * (i - start + 1));
    [s.queue[i], s.queue[j]] = [s.queue[j], s.queue[i]];
  }
  return true;
}

function clearQueue(guildId) {
  const s = getSession(guildId);
  if (!s) return -1;
  const keep = s.current ? 1 : 0;
  const removed = s.queue.length - keep;
  s.queue.length = keep;
  return removed;
}

function removeAt(guildId, pos) {
  const s = getSession(guildId);
  if (!s) return null;
  const offset = s.current ? 1 : 0;
  const idx = offset + pos - 1;
  if (pos < 1 || idx >= s.queue.length) return null;
  return s.queue.splice(idx, 1)[0];
}

function jumpTo(guildId, pos) {
  const s = getSession(guildId);
  if (!s) return null;
  const offset = s.current ? 1 : 0;
  const idx = offset + pos - 1;
  if (pos < 1 || idx >= s.queue.length) return null;
  const [track] = s.queue.splice(idx, 1);
  s.queue.splice(offset, 0, track);
  if (s.current) {
    s.skipRequested = true;
    try { s.player.stop(true); } catch { /* already idle */ }
  } else {
    void pump(s).catch(() => null);
  }
  return track;
}

// Drop the bot from voice, mirroring /leave's cleanup so a keep-alive or live
// TTS session can't quietly pull it back in. Returns whether a connection existed.
function disconnectVoice(guildId) {
  try { require('../keepAlive').stopKeepAlive(guildId); } catch { /* not kept alive */ }
  try { require('./ttsLiveManager').stop(guildId); } catch { /* tts off */ }
  const conn = getVoiceConnection(guildId);
  if (conn) { try { conn.destroy(); } catch { /* already gone */ } }
  return !!conn;
}

// Fully stop music: clear the queue, kill the audio pipeline, and leave voice.
// Returns what was actually torn down so callers can report accurately.
function leave(guildId) {
  const s = getSession(guildId);
  const hadSession = !!s;

  // Disconnect voice FIRST — stopKeepAlive must run before the connection is
  // destroyed, otherwise keep-alive's Destroyed handler tries to rejoin.
  const hadConnection = disconnectVoice(guildId) || !!s?.connection;

  if (s) {
    s.destroyed = true;
    s.queue.length = 0;
    s.current = null;
    try { s.player.stop(true); } catch { /* already idle */ }
    cleanupProc(s);
    try { s.connection?.destroy?.(); } catch { /* already gone */ }
    sessions.delete(guildId);
  }

  if (hadSession || hadConnection) info('music', 'left voice', { guildId });
  return { session: hadSession, connection: hadConnection };
}

// ---------- Embeds ----------
function truncate(text, max) {
  const s = String(text ?? '');
  return s.length > max ? `${s.slice(0, max - 1)}…` : s;
}

function capitalize(text) {
  const s = String(text ?? '');
  return s ? s[0].toUpperCase() + s.slice(1) : s;
}

function elapsedSeconds(s) {
  if (!s?.current || !s.trackStartedAt) return 0;
  const pausedNow = s.pausedAt ? Date.now() - s.pausedAt : 0;
  const since = (Date.now() - s.trackStartedAt - (s.pausedTotal || 0) - pausedNow) / 1000;
  return Math.max(0, since + (s.current.startOffset || 0));
}

function loopLabel(mode) {
  return mode === 'track' ? 'Song' : mode === 'queue' ? 'Queue' : 'Off';
}

// The player card — a modern layout: emoji section header, hyperlinked title,
// artist line, a live progress bar, and three inline stat fields. Its own look,
// not the bot's shared small-caps theme.
function nowPlayingEmbed(session, track = session?.current) {
  if (!track) return errorEmbed('Nothing is playing right now.');
  const isCurrent = track === session.current;
  const cur = isCurrent ? elapsedSeconds(session) : 0;
  const total = track.duration || 0;
  const upcoming = session.queue.length - (session.current ? 1 : 0);

  const embed = new EmbedBuilder()
    .setColor(MUSIC_COLORS.accent)
    .setAuthor({ name: isPaused(session) ? '⏸️ Paused' : '🎵 Now Playing' })
    .setTitle(truncate(track.title, 90))
    .setDescription(
      `${track.uploader ? `**${truncate(track.uploader, 60)}**\n` : ''}` +
      `\`${fmtTime(cur)}\` ${progressBar(cur, total)} \`${total ? fmtTime(total) : 'live'}\``,
    )
    .addFields(
      { name: '🔊 Volume', value: `${Math.round(session.volume * 100)}%`, inline: true },
      { name: '🔁 Loop', value: loopLabel(session.loop), inline: true },
      { name: '📜 Queue', value: `${upcoming}`, inline: true },
    )
    .setFooter({ text: `Requested by ${track.requesterTag || 'unknown'}` });
  if (track.webpageUrl) embed.setURL(track.webpageUrl);
  if (track.thumbnail) embed.setThumbnail(track.thumbnail);
  return embed;
}

function addedEmbed(track, position) {
  const embed = new EmbedBuilder()
    .setColor(MUSIC_COLORS.accent)
    .setAuthor({ name: '➕ Added to Queue' })
    .setTitle(truncate(track.title, 90))
    .setDescription(`Position **#${position}**` + (track.duration ? `  ·  \`${fmtTime(track.duration)}\`` : ''))
    .setFooter({ text: `Requested by ${track.requesterTag || 'unknown'}` });
  if (track.webpageUrl) embed.setURL(track.webpageUrl);
  if (track.thumbnail) embed.setThumbnail(track.thumbnail);
  return embed;
}

function playResultEmbed({ track, position, nowPlaying, session }) {
  if (nowPlaying) return nowPlayingEmbed(session, track);
  return addedEmbed(track, position);
}

function stoppedEmbed() {
  return new EmbedBuilder()
    .setColor(MUSIC_COLORS.stop)
    .setAuthor({ name: '⏹️ Stopped' })
    .setDescription('Playback stopped and the queue was cleared.');
}

function finishedEmbed() {
  return new EmbedBuilder()
    .setColor(MUSIC_COLORS.accent)
    .setAuthor({ name: '🎵 Queue Finished' })
    .setDescription('Nothing is playing right now. Add more with `/play`.');
}

function queueEmbed(session) {
  const upcoming = session.queue.slice(session.current ? 1 : 0);
  const embed = new EmbedBuilder()
    .setColor(MUSIC_COLORS.accent)
    .setAuthor({ name: '📜 Queue' });

  if (session.current) {
    embed.setDescription(
      `**Now playing**\n▶️ ${truncate(session.current.title, 80)}` +
      (session.current.duration ? `  \`${fmtTime(session.current.duration)}\`` : ''),
    );
  }

  if (upcoming.length) {
    const shown = upcoming.slice(0, 10).map((t, i) => `\`${i + 1}.\` ${truncate(t.title, 70)}${t.duration ? `  \`${fmtTime(t.duration)}\`` : ''}`);
    embed.addFields({
      name: `Up next — ${upcoming.length} song${upcoming.length === 1 ? '' : 's'}`,
      value: shown.join('\n') + (upcoming.length > 10 ? `\n…and ${upcoming.length - 10} more` : ''),
    });
    const total = upcoming.reduce((sum, t) => sum + (t.duration || 0), 0);
    if (total) embed.setFooter({ text: `Total queued: ${fmtTime(total)}  ·  Loop: ${loopLabel(session.loop)}` });
  } else if (!session.current) {
    embed.setDescription('The queue is empty.');
  }

  return embed;
}

function infoEmbed(title, description) {
  return new EmbedBuilder()
    .setColor(MUSIC_COLORS.accent)
    .setAuthor({ name: `✅ ${capitalize(title)}` })
    .setDescription(description);
}

function errorEmbed(message) {
  return new EmbedBuilder()
    .setColor(MUSIC_COLORS.stop)
    .setAuthor({ name: '⚠️ Error' })
    .setDescription(message);
}

// ---------- Player buttons ----------
// One row: Pause/Resume · Skip · Loop · Volume · Stop. The Volume button steps
// through presets (a select menu would be more precise, but a button matches
// the requested layout).
function playerComponents(session) {
  if (!session) return [];
  const paused = isPaused(session);
  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId('music:pause')
      .setLabel(paused ? 'Resume' : 'Pause')
      .setEmoji(paused ? '▶️' : '⏸️')
      .setStyle(paused ? ButtonStyle.Success : ButtonStyle.Primary),
    new ButtonBuilder()
      .setCustomId('music:skip')
      .setLabel('Skip')
      .setEmoji('⏭️')
      .setStyle(ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId('music:loop')
      .setLabel(`Loop: ${loopLabel(session.loop)}`)
      .setEmoji('🔁')
      .setStyle(ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId('music:volume')
      .setLabel(`Vol: ${Math.round(session.volume * 100)}%`)
      .setEmoji('🔊')
      .setStyle(ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId('music:stop')
      .setLabel('Stop')
      .setEmoji('⏹️')
      .setStyle(ButtonStyle.Danger),
  );
  return [row];
}

// Register the message the player card lives on, so track changes edit it in
// place instead of spamming a new card per song. Only the first one wins.
function attachPlayerMessage(guildId, message) {
  const s = getSession(guildId);
  if (!s || s.playerMessage) return;
  if (!message || typeof message.edit !== 'function') return;
  s.playerMessage = message;
}

async function updatePlayerMessage(session) {
  if (!session?.playerMessage || session.destroyed) return;
  try {
    await session.playerMessage.edit({
      embeds: [nowPlayingEmbed(session)],
      components: playerComponents(session),
    });
  } catch (err) {
    warn('music', `could not update player card: ${err?.message || err}`, { guildId: session.guildId });
    session.playerMessage = null;
  }
}

async function finalizePlayerMessage(session) {
  if (!session?.playerMessage) return;
  try {
    await session.playerMessage.edit({ embeds: [finishedEmbed()], components: [] });
  } catch { /* message gone — nothing to do */ }
  session.playerMessage = null;
}

// ---------- Prefix router: !p / !np / !s / !lp (+ a few natural aliases) ----------
const PREFIX_SKIP = 'skip';
const PREFIX_PAUSE = 'pause';
const PREFIX_RESUME = 'resume';
const PREFIX_QUEUE = 'queue';
const PREFIX_DISCONNECT = 'disconnect';

function prefixCtx(message) {
  return {
    guildId: message.guild.id,
    member: message.member,
    userId: message.author.id,
    tag: message.author.tag ?? message.author.username,
    textChannelId: message.channelId,
  };
}

async function handlePrefix(message) {
  const content = message.content || '';
  if (!content.startsWith(PREFIX)) return false;
  const match = content.slice(PREFIX.length).match(/^(\S+)\s*([\s\S]*)$/);
  if (!match) return false;

  const cmd = match[1].toLowerCase();
  const arg = (match[2] || '').trim();
  const guildId = message.guild.id;
  const known = ['p', 'play', 'np', 'nowplaying', 'now', 's', 'stop', 'lp', 'loop',
    PREFIX_SKIP, 'next', PREFIX_PAUSE, PREFIX_RESUME, 'q', PREFIX_QUEUE, 'dc', PREFIX_DISCONNECT, 'leave'];
  if (!known.includes(cmd)) return false;

  try {
    switch (cmd) {
      case 'p':
      case 'play': {
        if (!arg) { await message.reply({ embeds: [errorEmbed('Usage: `!p <song name or URL>`')] }); return true; }
        const result = await play(prefixCtx(message), arg);
        const msg = await message.channel.send({
          embeds: [playResultEmbed(result)],
          components: result.nowPlaying ? playerComponents(result.session) : [],
        });
        if (result.nowPlaying) attachPlayerMessage(guildId, msg);
        return true;
      }
      case 'np':
      case 'nowplaying':
      case 'now': {
        const s = getSession(guildId);
        if (!s?.current) { await message.reply({ embeds: [errorEmbed('Nothing is playing right now.')] }); return true; }
        const msg = await message.channel.send({ embeds: [nowPlayingEmbed(s)], components: playerComponents(s) });
        attachPlayerMessage(guildId, msg);
        return true;
      }
      case 's':
      case 'stop': {
        const { session } = leave(guildId);
        await message.channel.send({ embeds: [session ? stoppedEmbed() : errorEmbed('Nothing is playing right now.')] });
        return true;
      }
      case 'lp':
      case 'loop': {
        const s = getSession(guildId);
        if (!s) { await message.reply({ embeds: [errorEmbed('Nothing is playing right now.')] }); return true; }
        if (arg) {
          const mode = ['off', 'track', 'queue', 'song'].includes(arg.toLowerCase()) ? arg.toLowerCase() : null;
          if (!mode) { await message.reply({ embeds: [errorEmbed('Loop mode must be `off`, `track`, or `queue`.')] }); return true; }
          setLoop(guildId, mode);
        } else {
          cycleLoop(guildId);
        }
        await message.channel.send({ embeds: [infoEmbed('loop', `Loop mode set to **${loopLabel(s.loop)}**.`)] });
        return true;
      }
      case PREFIX_SKIP:
      case 'next': {
        const skipped = skip(guildId);
        await message.channel.send({ embeds: [skipped ? infoEmbed('skipped', `Skipped **${truncate(skipped.title, 80)}**.`) : errorEmbed('Nothing is playing right now.')] });
        return true;
      }
      case PREFIX_PAUSE: {
        const ok = pause(guildId);
        await message.channel.send({ embeds: [ok ? infoEmbed('paused', 'Playback paused. Use `!resume` to continue.') : errorEmbed('Nothing is playing right now.')] });
        return true;
      }
      case PREFIX_RESUME: {
        const ok = resume(guildId);
        await message.channel.send({ embeds: [ok ? infoEmbed('resumed', 'Playback resumed.') : errorEmbed('Nothing is paused right now.')] });
        return true;
      }
      case 'q':
      case PREFIX_QUEUE: {
        const s = getSession(guildId);
        if (!s) { await message.reply({ embeds: [errorEmbed('The queue is empty.')] }); return true; }
        await message.channel.send({ embeds: [queueEmbed(s)] });
        return true;
      }
      case 'dc':
      case PREFIX_DISCONNECT:
      case 'leave': {
        const { session, connection } = leave(guildId);
        await message.channel.send({ embeds: [(session || connection) ? stoppedEmbed() : errorEmbed("I'm not in a voice channel.")] });
        return true;
      }
      default:
        return false;
    }
  } catch (err) {
    if (err instanceof UserError) {
      await message.reply({ embeds: [errorEmbed(err.message)] }).catch(() => null);
      return true;
    }
    warn('music', `prefix ${cmd} failed: ${err?.message || err}`, { guildId });
    await message.reply({ embeds: [errorEmbed('Something went wrong running that.')] }).catch(() => null);
    return true;
  }
}

module.exports = {
  UserError,
  PREFIX,
  getSession,
  play,
  skip,
  pause,
  resume,
  seek,
  setLoop,
  cycleLoop,
  setVolume,
  cycleVolume,
  isPaused,
  togglePause,
  shuffle,
  clearQueue,
  removeAt,
  jumpTo,
  leave,
  nowPlayingEmbed,
  addedEmbed,
  playResultEmbed,
  stoppedEmbed,
  finishedEmbed,
  queueEmbed,
  infoEmbed,
  errorEmbed,
  playerComponents,
  attachPlayerMessage,
  loopLabel,
  handlePrefix,
  // exported for tests / reuse
  resolveTrack,
  fmtTime,
  parseTime,
  progressBar,
};
