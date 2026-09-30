// Live VC TTS reader — speaks chat messages aloud in voice, serially.
// Low-RAM design for capped hosts (e.g. Wispbyte 35%):
//  - Reuses utils/tts.js (Google fetch, network wait, ~ms of CPU). No new deps.
//  - No temp files, no audio cache, no setInterval. One small Map entry per
//    guild while enabled; one MP3 Buffer (~tens of KB) alive at a time.
//  - Serial pump: one fetch + one ffmpeg decode at a time, max 5 queued.
//  - Shares the ONE live voice connection (music's if present, else
//    keep-alive's). Never creates a second connection.
//  - Music coexistence: pause music player -> speak on a lightweight TTS
//    player subscribed to the same connection -> re-subscribe music player
//    and unpause. Never touches music queue/current/resource.

const {
  getVoiceConnection,
  createAudioPlayer,
  createAudioResource,
  AudioPlayerStatus,
  StreamType,
  VoiceConnectionStatus,
  entersState,
} = require('@discordjs/voice');
const { Readable } = require('stream');
const { TTS_LANGS, textToSpeechBuffer } = require('./tts');
const { info, warn, debug } = require('./logger');

// @discordjs/voice decodes `Arbitrary` (MP3) by spawning ffmpeg on PATH.
// musicManager normally sets this up, but TTS must not depend on music ever
// having loaded first (e.g. /join with no /music play yet) — so ensure it here
// too. Idempotent, never throws. utils/ffmpegPath does the platform-aware
// lookup (FFMPEG_BIN may point at the Linux binary, not the Windows .exe).
require('./ffmpegPath').exposeFfmpegOnPath();

const MAX_QUEUE = 5; // pending utterances per guild; beyond this we drop oldest
const MAX_SAY_CHARS = 200; // message body cap before "Name said ..." prefix
const MAX_NAME_CHARS = 25;
const MIN_GAP_MS = 800; // breathing room between utterances
const IDLE_TIMEOUT_MS = 20_000; // give up on a stuck utterance after this
const USER_THROTTLE_MS = 1500; // per-user spam throttle, dropped silently

// guildId -> session
const sessions = new Map();

function isEnabled(guildId) {
  const s = sessions.get(guildId);
  return !!s?.enabled;
}

function getStatus(guildId) {
  const s = sessions.get(guildId);
  if (!s?.enabled) return null;
  return {
    textChannelId: s.textChannelId,
    voiceChannelId: s.voiceChannelId,
    lang: s.lang,
    queued: s.queue.length,
    speaking: s.speaking,
    lastError: s.lastError || null,
    lastSpokeAt: s.lastSpokeAt || 0,
  };
}

function ensurePlayer(session) {
  if (session.ttsPlayer) return session.ttsPlayer;
  const player = createAudioPlayer();
  player.on('error', (err) => {
    // Don't crash the pump on a decode blip — log and let the Idle timeout
    // / next iteration recover. The per-utterance wait also listens for this.
    warn('tts-live', `player error: ${err?.message || err}`, { guildId: session.guildId });
  });
  session.ttsPlayer = player;
  return player;
}

// ---------- Sanitizing (keeps fetches small, avoids 429s + weird speech) ----------
function sanitizeName(raw) {
  const clean = (raw || '').replace(/\s+/g, ' ').trim().slice(0, MAX_NAME_CHARS);
  const stripped = clean.replace(/[^\p{L}\p{N} _\-.]/gu, '').trim();
  return stripped || 'Someone';
}

function sanitizeBody(raw) {
  let t = (raw || '')
    .replace(/```[\s\S]*?```/g, ' code block ') // multi-line code first
    .replace(/`[^`]*`/g, ' code ') // inline code
    .replace(/https?:\/\/\S+/gi, ' link ') // URLs -> "link"
    .replace(/<@!?\d+>/g, ' someone ') // user mentions
    .replace(/<#\d+>/g, ' this channel ') // channel mentions
    .replace(/<@&\d+>/g, ' everyone ') // role mentions
    .replace(/@everyone|@here/gi, ' everyone ')
    .replace(/<a?:\w+:\d+>/g, ' emoji ') // custom emoji
    .replace(/\s+/g, ' ')
    .trim();
  if (!t) return '';
  if (t.length > MAX_SAY_CHARS) t = `${t.slice(0, MAX_SAY_CHARS).trim()}…`;
  return t;
}

// Current live connection, preferring whatever discord.js considers active.
function resolveConnection(guildId) {
  const live = getVoiceConnection(guildId);
  if (live) return live;
  try {
    const musicState = require('./musicManager').getState?.(guildId);
    if (musicState?.connection) return musicState.connection;
  } catch { /* music not loaded — ignore */ }
  try {
    const { keepAliveTargets } = require('../keepAlive');
    const target = keepAliveTargets?.get(guildId);
    if (target?.connection) return target.connection;
  } catch { /* ignore */ }
  return null;
}

function connectionReady(conn) {
  return !!conn && conn.state?.status === VoiceConnectionStatus.Ready;
}

// ---------- Public: start / stop ----------
function start({ guildId, voiceChannelId, textChannelId, lang = 'en' }) {
  const normalizedLang = TTS_LANGS[lang] ? lang : 'en';
  let s = sessions.get(guildId);
  if (!s) {
    s = {
      guildId,
      enabled: true,
      textChannelId,
      voiceChannelId,
      lang: normalizedLang,
      queue: [],
      pumping: false,
      speaking: false,
      ttsPlayer: null,
      pausedMusic: false,
      lastEnd: 0,
      lastUserAt: new Map(),
      cooldownUntil: 0,
      lastError: null,
      lastSpokeAt: 0,
      lastErrorAt: 0,
    };
    sessions.set(guildId, s);
  } else {
    s.enabled = true;
    s.textChannelId = textChannelId || s.textChannelId;
    s.voiceChannelId = voiceChannelId || s.voiceChannelId;
    s.lang = normalizedLang;
  }
  ensurePlayer(s);
  info('tts-live', `enabled in guild (lang=${s.lang})`, { guildId });
  return getStatus(guildId);
}

function restoreMusic(guildId) {
  const s = sessions.get(guildId);
  try {
    const music = require('./musicManager');
    const musicState = music.getState?.(guildId);
    if (s?.pausedMusic && musicState?.connection && musicState?.player) {
      if (connectionReady(musicState.connection)) {
        try { musicState.connection.subscribe(musicState.player); } catch { /* ignore */ }
        try { musicState.player.unpause(); } catch { /* ignore */ }
      }
    }
  } catch { /* music gone — nothing to restore */ }
  if (s) s.pausedMusic = false;
}

function stop(guildId) {
  const s = sessions.get(guildId);
  if (!s) return false;
  s.enabled = false;
  s.queue.length = 0;
  s.speaking = false;
  s.cooldownUntil = 0;
  try { s.ttsPlayer?.stop(true); } catch { /* already idle */ }
  restoreMusic(guildId);
  sessions.delete(guildId); // free the entry so idle RAM stays flat
  info('tts-live', 'stopped', { guildId });
  return true;
}

// Called (lazily) by musicManager.play() before it starts a new track, so a
// mid-sentence TTS never leaves the connection subscribed to the wrong player
// (which would make the new song play silently on an orphaned player).
function notifyMusicTakeover(guildId) {
  const s = sessions.get(guildId);
  if (!s) return;
  s.queue.length = 0;
  s.speaking = false;
  try { s.ttsPlayer?.stop(true); } catch { /* ignore */ }
  // Re-point the connection at the music player if we had stolen it. The new
  // track then plays normally; TTS keeps its binding for later messages.
  try {
    const music = require('./musicManager');
    const musicState = music.getState?.(guildId);
    if (musicState?.connection && musicState?.player && connectionReady(musicState.connection)) {
      try { musicState.connection.subscribe(musicState.player); } catch { /* ignore */ }
    }
  } catch { /* ignore */ }
  s.pausedMusic = false;
}

// ---------- Public: enqueue from messageCreate (fire-and-forget) ----------
function enqueue(message, opts = {}) {
  try {
    const guildId = message?.guild?.id;
    if (!guildId) return;
    const s = sessions.get(guildId);
    if (!s?.enabled) return;
    if (!opts.bypassFilters) {
      if (message.author?.bot) return;
      if (message.channelId !== s.textChannelId) {
        debug('tts-live', `drop: wrong channel (got ${message.channelId}, want ${s.textChannelId})`, { guildId });
        return; // bound channel only
      }
    }

    const raw = message.content || '';
    if (!raw.trim()) {
      debug('tts-live', 'drop: empty content (sticker/attachment/embed only)', { guildId });
      return; // stickers / attachments-only / embeds
    }
    if (!opts.bypassFilters && raw.startsWith('!')) {
      debug('tts-live', 'drop: ! prefix (music command)', { guildId });
      return; // music prefix commands (handled elsewhere)
    }

    const now = Date.now();
    if (now < s.cooldownUntil) {
      debug('tts-live', 'drop: upstream 429 backoff active', { guildId });
      return; // upstream 429 backoff
    }
    if (!opts.bypassFilters) {
      const lastUser = s.lastUserAt.get(message.author.id) || 0;
      if (now - lastUser < USER_THROTTLE_MS) {
        debug('tts-live', `drop: per-user throttle (${now - lastUser}ms < ${USER_THROTTLE_MS}ms)`, { guildId });
        return; // spam throttle, silent drop
      }
      s.lastUserAt.set(message.author.id, now);
      if (s.lastUserAt.size > 50) {
        // Bound the throttle map so a raid can't grow RAM.
        const oldest = [...s.lastUserAt.entries()].sort((a, b) => a[1] - b[1])[0];
        if (oldest) s.lastUserAt.delete(oldest[0]);
      }
    }

    const name = sanitizeName(message.member?.displayName ?? message.author?.displayName ?? message.author?.username);
    const body = sanitizeBody(raw);
    if (!body) {
      debug('tts-live', 'drop: empty after sanitize (link/emoji/mention-only?)', { guildId });
      return;
    }

    let sayText = `${name} said ${body}`;
    if (sayText.length > MAX_SAY_CHARS + MAX_NAME_CHARS + 6) {
      sayText = `${name} said ${body}`.slice(0, MAX_SAY_CHARS + MAX_NAME_CHARS + 6);
    }

    if (s.queue.length >= MAX_QUEUE) s.queue.shift(); // drop oldest, keep live
    s.queue.push(sayText);
    s.lastError = null; // new work clears the last sticky error; status shows fresh state
    debug('tts-live', `queued (${s.queue.length}): ${sayText.slice(0, 80)}`, { guildId });
    void pump(guildId).catch((err) => {
      warn('tts-live', `pump failed: ${err?.message || err}`, { guildId });
      try { s.lastError = `pump: ${err?.message || err}`.slice(0, 200); s.lastErrorAt = Date.now(); } catch { /* ignore */ }
    });
  } catch (err) {
    warn('tts-live', `enqueue failed: ${err?.message || err}`, {});
  }
}

// Test hook for /tts-live test: bypasses channel/bot/prefix/throttle filters
// so a silent bot can be diagnosed in one step (fetch vs connection vs
// playback). Still goes through the real pump + voice path.
function queueTestLine(guildId, text) {
  const s = sessions.get(guildId);
  if (!s?.enabled) throw new Error('Live TTS is off — run `/tts-live start` first.');
  const clean = (text || '').trim();
  if (!clean) throw new Error('Give me some text to say.');
  if (s.queue.length >= MAX_QUEUE) s.queue.shift();
  const sayText = clean.slice(0, MAX_SAY_CHARS + MAX_NAME_CHARS + 6);
  s.queue.push(sayText);
  s.lastError = null;
  info('tts-live', `test queued: ${sayText.slice(0, 80)}`, { guildId });
  void pump(guildId).catch((err) => {
    warn('tts-live', `pump failed: ${err?.message || err}`, { guildId });
  });
  return { queued: s.queue.length, text: sayText };
}

function waitIdle(player) {
  return new Promise((resolve, reject) => {
    const onIdle = () => {
      clearTimeout(timer);
      player.off('error', onError);
      resolve();
    };
    const onError = (err) => {
      clearTimeout(timer);
      player.off(AudioPlayerStatus.Idle, onIdle);
      reject(err);
    };
    const timer = setTimeout(() => {
      player.off(AudioPlayerStatus.Idle, onIdle);
      player.off('error', onError);
      reject(new Error('TTS playback timed out'));
    }, IDLE_TIMEOUT_MS);
    // Don't hold the process open on a stuck utterance (Wispbyte-friendly).
    timer.unref?.();
    player.once(AudioPlayerStatus.Idle, onIdle);
    player.once('error', onError);
  });
}

async function pump(guildId) {
  const s = sessions.get(guildId);
  if (!s?.enabled || s.pumping) return;
  s.pumping = true;
  try {
    while (s.enabled && s.queue.length) {
      // Gentle pacing so a flood reads as separate lines, not one blur.
      const gap = MIN_GAP_MS - (Date.now() - s.lastEnd);
      if (gap > 0) await new Promise((r) => setTimeout(r, gap));

      const sayText = s.queue.shift();
      if (!sayText) continue;

      // Fetch FIRST (network wait, no voice interruption yet) so music only
      // pauses for speech that actually exists.
      let audio;
      try {
        const started = Date.now();
        ({ audio } = await textToSpeechBuffer(sayText, s.lang));
        debug('tts-live', `fetch ok: ${audio.length} bytes in ${Date.now() - started}ms`, { guildId });
      } catch (err) {
        if (err?.status === 429) s.cooldownUntil = Date.now() + 10_000;
        warn('tts-live', `fetch failed, skipping: ${err?.message || err}`, { guildId });
        s.lastError = `fetch: ${err?.message || err}`.slice(0, 200);
        s.lastErrorAt = Date.now();
        continue;
      }

      let conn = resolveConnection(guildId);
      if (!connectionReady(conn)) {
        try {
          if (conn) await entersState(conn, VoiceConnectionStatus.Ready, 5000);
        } catch { /* still not ready — re-queue below */ }
        conn = resolveConnection(guildId);
        if (!connectionReady(conn)) {
          // Don't silently eat the line: put it back at the front and wait
          // for the next enqueue/test to retry. Previously this `continue`d,
          // which drained the queue with zero logs or audio ("sits in VC").
          const status = conn?.state?.status || 'no-connection';
          warn('tts-live', `no ready voice connection (status=${status}), re-queued 1 line`, { guildId });
          s.lastError = `no ready voice connection (status=${status}) — I may still be joining; try /tts-live test in a few seconds`.slice(0, 200);
          s.lastErrorAt = Date.now();
          s.queue.unshift(sayText);
          break;
        }
      }

      // Duck music only when it is on THIS connection and actually playing.
      let ducked = false;
      try {
        const music = require('./musicManager');
        const musicState = music.getState?.(guildId);
        const mp = musicState?.player;
        if (
          musicState?.current && mp && musicState.connection === conn &&
          (mp.state?.status === AudioPlayerStatus.Playing || mp.state?.status === AudioPlayerStatus.Paused)
        ) {
          try { mp.pause(); ducked = true; s.pausedMusic = true; } catch { ducked = false; }
        }
      } catch { /* no music — speak directly */ }

      const player = ensurePlayer(s);
      let resource;
      try {
        try { conn.subscribe(player); } catch { /* keep going on stale sub */ }
        // NOTE: must wrap the MP3 Buffer in an array — Readable.from(buffer)
        // iterates byte-by-byte (numbers), which ffmpeg can't decode and the
        // bot just sits silently in VC. [buffer] emits one Buffer chunk.
        resource = createAudioResource(Readable.from([audio]), { inputType: StreamType.Arbitrary });
        audio = null; // release for GC; resource owns the stream now
        s.speaking = true;
        debug('tts-live', 'playing utterance…', { guildId });
        player.play(resource);
        await waitIdle(player);
        s.lastSpokeAt = Date.now();
        s.lastError = null;
        debug('tts-live', 'utterance done', { guildId });
      } catch (err) {
        warn('tts-live', `playback failed, skipping: ${err?.message || err}`, { guildId });
        s.lastError = `playback: ${err?.message || err}`.slice(0, 200);
        s.lastErrorAt = Date.now();
        try { player.stop(true); } catch { /* ignore */ }
      } finally {
        s.speaking = false;
        s.lastEnd = Date.now();
        try { resource?.playStream?.destroy?.(); } catch { /* ignore */ }
        resource = null;
      }

      if (!s.queue.length && ducked) restoreMusic(guildId);
    }
    // Queue drained while ducked (e.g. last line skipped after duck) — restore.
    if (!s.queue.length && s.pausedMusic) restoreMusic(guildId);
  } finally {
    s.pumping = false;
  }
}

// ---------- Public: voiceStateUpdate hook ----------
function handleVoiceStateUpdate(oldState, newState) {
  try {
    const guild = newState.guild || oldState.guild;
    if (!guild) return;
    const s = sessions.get(guild.id);
    if (!s?.enabled) return;

    // Bot left / was kicked / was moved out of voice entirely -> full stop.
    const me = guild.members?.me;
    const botVcId = me?.voice?.channelId ?? null;
    if (!botVcId) {
      stop(guild.id);
      return;
    }
    // Track follows if the bot was moved by a mod.
    if (botVcId !== s.voiceChannelId) s.voiceChannelId = botVcId;

    // Channel went empty (only the bot left) -> clear pending lines so a
    // backlog doesn't blast when someone rejoins. Binding stays on.
    const channel = guild.channels?.cache?.get(botVcId);
    if (channel && channel.members && channel.members.size <= 1 && s.queue.length) {
      s.queue.length = 0;
      info('tts-live', 'cleared queue (channel empty)', { guildId: guild.id });
    }
  } catch (err) {
    warn('tts-live', `voice hook failed: ${err?.message || err}`, {});
  }
}

module.exports = {
  isEnabled,
  getStatus,
  start,
  stop,
  enqueue,
  queueTestLine,
  pump,
  notifyMusicTakeover,
  handleVoiceStateUpdate,
  MAX_QUEUE,
};
