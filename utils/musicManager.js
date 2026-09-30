const {
  joinVoiceChannel,
  createAudioPlayer,
  createAudioResource,
  AudioPlayerStatus,
  NoSubscriberBehavior,
  StreamType,
  VoiceConnectionStatus,
  entersState,
} = require('@discordjs/voice');
const { execFile, spawn } = require('child_process');
const { PassThrough } = require('stream');
const path = require('path');

// @discordjs/voice decodes `Arbitrary` streams by spawning ffmpeg itself. It
// looks it up on PATH, so expose the bundled ffmpeg-static binary first.
// Resilient: never crashes the bot at require-time if ffmpeg is missing
// (e.g. fresh Linux upload) — /music play throws a friendly error instead,
// and scripts/ensure-deps.js (run on startup) usually fixes it first.
// utils/ffmpegPath handles the platform-aware lookup (FFMPEG_BIN may point at
// the Linux binary, so it falls back to the bundled .exe on Windows).
const { resolveFfmpegBin, exposeFfmpegOnPath } = require('./ffmpegPath');
const ffmpegStaticPath = resolveFfmpegBin();
if (ffmpegStaticPath) {
  if (require('fs').existsSync(ffmpegStaticPath)) {
    exposeFfmpegOnPath();
  } else {
    console.warn(`[music] ffmpeg binary not found at ${ffmpegStaticPath} — startup bootstrap should download it (or set FFMPEG_BIN).`);
  }
} else {
  console.warn('[music] ffmpeg-static not installed — voice may fail. Startup bootstrap should fix this.');
}

// Allow overriding yt-dlp binary path via env var (for Linux hosts like Wispbyte).
// Supports: YT_DLP_BINARY_PATH (preferred), YTDLP_PATH, YTDLP_DIR+YTDLP_FILENAME.
function defaultYtDlpBinDir() {
  if (process.env.YTDLP_DIR) return process.env.YTDLP_DIR;
  return path.join(__dirname, '..', 'node_modules', '@distube', 'yt-dlp', 'bin');
}

// In-memory per-guild music state. Nothing is persisted on purpose — if the
// bot restarts mid-playback, the queue is gone and that's fine.
//   state = {
//     queue: Track[],          // enqueued, waiting to play
//     current: Track|null,     // what's playing right now
//     loop: 'off'|'song'|'queue',
//     volume: 1-200,
//     player, connection, resource,
//     textChannel,             // where to announce track starts
//     emptyTimer,              // pending auto-leave timer
//   }
//   Track = { title, url, durationSec, thumbnail, channel, requestedBy }

const guilds = new Map();

const AUTO_LEAVE_EMPTY_MS = 60_000;
const MAX_VOLUME = 200;

function getState(guildId) {
  return guilds.get(guildId) || null;
}

function formatDuration(sec) {
  if (!sec || !isFinite(sec)) return 'LIVE';
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = Math.floor(sec % 60);
  const mm = String(m).padStart(2, '0');
  const ss = String(s).padStart(2, '0');
  return h > 0 ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
}

// ---------- Track resolution ----------
// Everything (song names, video URLs, playlists) is resolved through the
// bundled yt-dlp binary — play-dl's search broke against current YouTube and
// its stream() has no usable formats, so yt-dlp is the one source of truth.
const MAX_PLAYLIST_TRACKS = 150;

// Skip DASH/HLS manifest crawling on resolve + stream: bestaudio is almost
// always progressive webm/m4a, and those manifests cost 300-600ms of HTTP.
// `--no-check-formats` skips per-format HEAD probes (another ~200-400ms) —
// safe because our format selector has a `/bestaudio` fallback.
//
// NOTE: yt-dlp deprecated the old `--youtube-skip-dash-manifest` /
// `--youtube-skip-hls-manifest` switches (yt-dlp/yt-dlp#14198). They now emit
// a "please remove them from your command/configuration" warning and do
// nothing — the supported replacement is the `skip` extractor argument.
const YT_FAST_ARGS = [
  '--extractor-args', 'youtube:skip=dash,hls',
  '--no-check-formats',
];

// Wispbyte/Pterodactyl hosts often have broken/slow IPv6: yt-dlp tries it
// first and hangs ~30-60s before falling back to IPv4 — the classic "bot
// takes 1 minute to play" symptom. Force IPv4 on every yt-dlp call
// (resolve, probe, stream). Set YTDLP_NO_FORCE_IPV4=1 if a host is v6-only.
// YTDLP_EXTRA_ARGS (space separated, e.g.
// "--extractor-args youtube:player_client=android") lets us experiment
// without a redeploy.
// YouTube increasingly refuses datacenter/VPS IPs with
// "Sign in to confirm you're not a bot". Point YTDLP_COOKIES at a
// Netscape-format cookies.txt exported from a logged-in browser session and
// it is passed to every yt-dlp call. See .env.example.
function ytCookiesArgs() {
  const cookiePath = process.env.YTDLP_COOKIES || process.env.YT_DLP_COOKIES;
  if (!cookiePath) return [];
  if (!require('fs').existsSync(cookiePath)) {
    console.warn(`[music] YTDLP_COOKIES is set to "${cookiePath}" but no such file exists — ignoring it.`);
    return [];
  }
  return ['--cookies', cookiePath];
}

function ytBaseArgs() {
  const args = [];
  if (process.env.YTDLP_NO_FORCE_IPV4 !== '1') args.push('--force-ipv4');
  args.push(...YT_FAST_ARGS);
  args.push(...ytCookiesArgs());
  const extra = (process.env.YTDLP_EXTRA_ARGS || '').trim();
  if (extra) args.push(...extra.split(/\s+/));
  return args;
}

// Short-lived in-memory resolve cache: repeat plays skip yt-dlp entirely
// (~1-2s saved). Key = normalized query/URL. TTL 10min, cap 200 entries.
const resolveCache = new Map();
const RESOLVE_TTL_MS = 10 * 60 * 1000;
function resolveCacheGet(key) {
  const hit = resolveCache.get(key);
  if (!hit) return null;
  if (Date.now() > hit.expires) {
    resolveCache.delete(key);
    return null;
  }
  // LRU refresh.
  resolveCache.delete(key);
  resolveCache.set(key, hit);
  return hit.data;
}
function resolveCacheSet(key, data) {
  if (resolveCache.size >= 200) {
    const oldest = resolveCache.keys().next().value;
    if (oldest !== undefined) resolveCache.delete(oldest);
  }
  resolveCache.set(key, { data, expires: Date.now() + RESOLVE_TTL_MS });
}
function resolveCacheKey(q) {
  const s = q.trim();
  return looksLikeUrl(s) ? s : s.toLowerCase();
}

function ytDlpBinaryPath() {
  const fs = require('fs');
  const { execSync } = require('child_process');

  // 1. Explicit override (file or directory).
  const override = process.env.YT_DLP_BINARY_PATH || process.env.YTDLP_PATH;
  if (override) {
    try {
      const st = fs.statSync(override);
      if (st.isFile()) return override;
      if (st.isDirectory()) {
        const inside = path.join(override, process.platform === 'win32' ? 'yt-dlp.exe' : 'yt-dlp');
        if (fs.existsSync(inside)) return inside;
      }
    } catch { /* fall through */ }
    // If the env var points nowhere, ignore it and keep resolving.
  }

  // 2. Bundled binary for THIS platform (survives Win<->Linux zip uploads
  //    because ensure-deps.js downloads the missing side instead of replacing).
  const binFile = process.platform === 'win32'
    ? (process.env.YTDLP_FILENAME || 'yt-dlp.exe')
    : (process.env.YTDLP_FILENAME || 'yt-dlp');
  const bundled = path.join(defaultYtDlpBinDir(), binFile);
  if (fs.existsSync(bundled)) {
    if (process.platform !== 'win32') {
      try { fs.chmodSync(bundled, 0o755); } catch { /* ignore */ }
    }
    return bundled;
  }

  // 3. Last resort: system yt-dlp on PATH (apt/pipx installs on VPS hosts).
  try {
    const probe = process.platform === 'win32' ? 'where yt-dlp' : 'which yt-dlp';
    const found = execSync(probe, { encoding: 'utf8', timeout: 5000 }).split(/\r?\n/).find(Boolean);
    if (found && fs.existsSync(found.trim())) return found.trim();
  } catch { /* not on PATH */ }

  // Return the expected bundled path anyway so ENOENT handler below can
  // produce the helpful "run bootstrap" message with the exact path.
  return bundled;
}

// If the binary is missing at runtime (e.g. panel skipped `npm install`),
// try the same download the startup bootstrap does, once, instead of just
// failing. Returns the binary path or throws the friendly error.
let ytDlpHealAttempted = false;
function ensureYtDlpOrThrow() {
  const fs = require('fs');
  const bin = ytDlpBinaryPath();
  if (fs.existsSync(bin)) return bin;
  if (!ytDlpHealAttempted) {
    ytDlpHealAttempted = true;
    console.warn(`[music] yt-dlp missing at ${bin} — attempting one-time download...`);
    try {
      require('../scripts/ensure-deps').ensureYtDlp();
    } catch (err) {
      console.warn(`[music] self-heal failed: ${err && err.message}`);
    }
    const retry = ytDlpBinaryPath();
    if (fs.existsSync(retry)) return retry;
  }
  throw new Error(
    'Music binary (yt-dlp) is missing. It downloads automatically on startup — ' +
    'restart the bot once (it runs `node scripts/ensure-deps.js`). ' +
    `If it keeps failing, run \`node scripts/ensure-deps.js\` manually or set YT_DLP_BINARY_PATH. (looked at ${bin})`,
  );
}

function durationToSeconds(str) {
  if (!str) return 0;
  const parts = str.split(':').map(Number);
  if (parts.includes(NaN)) return 0;
  return parts.reduce((acc, p) => acc * 60 + p, 0);
}

function looksLikeUrl(query) {
  return /^(https?:\/\/|www\.)/.test(query.trim());
}

function playlistIdFromUrl(url) {
  try {
    return new URL(url).searchParams.get('list');
  } catch {
    return null;
  }
}

// Runs yt-dlp with `args`, returns stdout trimmed or throws a friendly error
// built from the tail of yt-dlp's stderr.
function ytDlpExec(args, { timeout = 60_000 } = {}) {
  return new Promise((resolve, reject) => {
    let bin;
    try {
      bin = ensureYtDlpOrThrow();
    } catch (healErr) {
      reject(healErr);
      return;
    }
    execFile(bin, args, { timeout, maxBuffer: 32 * 1024 * 1024 }, (err, stdout, stderr) => {
      if (err) {
        // ENOENT = binary vanished between check and spawn (AV quarantine,
        // bad upload, no exec bit). Point at the fix, not "no results".
        if (err.code === 'ENOENT') {
          reject(new Error(
            `Music binary not runnable at ${bin}. Restart the bot (auto-download runs on startup) ` +
            'or run `node scripts/ensure-deps.js`. On Linux hosts you can also set YT_DLP_BINARY_PATH.',
          ));
          return;
        }
        // EACCES = missing exec bit (classic FTP/zip upload to Pterodactyl).
        if (err.code === 'EACCES') {
          try { require('fs').chmodSync(bin, 0o755); } catch { /* ignore */ }
          reject(new Error(
            `Music binary at ${bin} wasn't executable (fixed permissions — try again). ` +
            'If it repeats, run `node scripts/ensure-deps.js`.',
          ));
          return;
        }
        const stderrText = String(stderr || '');
        // YouTube's anti-bot gate: no amount of retrying fixes it without
        // cookies, so say exactly what to do instead of a cryptic tail.
        if (/sign in to confirm you'?re not a bot/i.test(stderrText)) {
          reject(new Error(
            'YouTube is asking this host to sign in ("confirm you\'re not a bot"). ' +
            'Export cookies from a logged-in browser to a cookies.txt file, set ' +
            'YTDLP_COOKIES=/path/to/cookies.txt, and restart the bot.',
          ));
          return;
        }
        const tail = stderrText.trim().split(/\r?\n/).filter(Boolean).slice(-3).join(' ');
        reject(new Error(tail || (String(err.message).includes('timeout') ? 'Resolution timed out.' : 'No results — the video may be unavailable.')));
        return;
      }
      resolve(String(stdout).trim());
    });
  });
}

const TRACK_PRINT = '%(id)s\t%(title)s\t%(duration_string)s\t%(webpage_url)s\t%(acodec)s\t%(ext)s';

function parseTrackLine(line, requesterId) {
  const [id, title, durationString, url, acodec, ext] = line.split('\t');
  if (!id || !title || !url) return null;
  const codec = (acodec || '').toLowerCase();
  return {
    title,
    url,
    durationSec: durationToSeconds(durationString),
    thumbnail: `https://i.ytimg.com/vi/${id}/hqdefault.jpg`,
    channel: 'Unknown',
    requestedBy: requesterId,
    // True when YouTube already serves this as opus-in-webm: we can forward
    // the packets with StreamType.WebmOpus and skip ffmpeg entirely (same
    // quality, ~80% less CPU). Works on Win + Linux, no extra binaries.
    isOpus: codec.includes('opus') && (ext || '').toLowerCase() === 'webm',
  };
}

// Per-URL opus probe for playlist tracks (flat listing has no codec info).
// Cached in memory so each URL is probed at most once per boot. Returns
// true/false, throws on timeout/unavailable (caller falls back to ffmpeg).
const opusProbeCache = new Map();
// Settled results only (url -> bool). Checked synchronously in playTrack so
// a still-pending background probe never blocks playback startup.
const opusSettledCache = new Map();
const PROBE_CACHE_MAX = 500;
function _capProbeCache(cache) {
  if (cache.size > PROBE_CACHE_MAX) {
    const firstKey = cache.keys().next().value;
    cache.delete(firstKey);
  }
}
async function probeIsOpus(url) {
  if (opusProbeCache.has(url)) return opusProbeCache.get(url);
  const p = (async () => {
    const out = await ytDlpExec(
      ['--no-playlist', '--no-warnings', ...ytBaseArgs(), '--socket-timeout', '5', '--print', '%(acodec)s %(ext)s', '--skip-download', '--', url],
      { timeout: 8_000 },
    );
    const first = out.split(/\r?\n/).find(Boolean) || '';
    const [codec, ext] = first.trim().toLowerCase().split(/\s+/);
    const result = (codec || '').includes('opus') && (ext || '') === 'webm';
    opusSettledCache.set(url, result);
    _capProbeCache(opusSettledCache);
    return result;
  })();
  // Cache the promise itself so concurrent plays of the same URL share it.
  opusProbeCache.set(url, p);
  _capProbeCache(opusProbeCache);
  try {
    return await p;
  } catch {
    opusProbeCache.delete(url);
    return false;
  }
}

// A single song — song name or a video URL.
async function resolveSingleTrack(query, requesterId) {
  const target = looksLikeUrl(query) ? query : `ytsearch1:${query}`;
  const out = await ytDlpExec([
    '--skip-download', '--no-warnings', '--no-playlist',
    ...ytBaseArgs(), '--socket-timeout', '15', '--retries', '2',
    '--print', TRACK_PRINT, '--', target,
  ]);
  const line = out.split(/\r?\n/).find(Boolean);
  const track = line ? parseTrackLine(line, requesterId) : null;
  if (!track) throw new Error(`Couldn't resolve "${query.slice(0, 60)}".`);
  return track;
}

// A YouTube playlist URL — flat listing (titles + URLs, durations unknown
// until played). Caps at MAX_PLAYLIST_TRACKS.
async function resolvePlaylistUrl(url, requesterId) {
  const id = playlistIdFromUrl(url);
  if (!id) throw new Error('Couldn\'t find a playlist ID in that URL.');
  const out = await ytDlpExec([
    '--flat-playlist', '--no-warnings', '--no-simulate',
    ...ytBaseArgs(), '--socket-timeout', '15',
    '--print', '%(id)s\t%(title)s\t%(webpage_url)s', '--', url,
  ]);
  const tracks = out.split(/\r?\n/).filter(Boolean)
    .map((line) => {
      const [stripId, title, webpageUrl] = line.split('\t');
      if (!stripId || !title || !webpageUrl) return null;
      return {
        title,
        url: webpageUrl,
        durationSec: 0,
        thumbnail: `https://i.ytimg.com/vi/${stripId}/hqdefault.jpg`,
        channel: 'Unknown',
        requestedBy: requesterId,
      };
    })
    .filter(Boolean)
    .slice(0, MAX_PLAYLIST_TRACKS);
  if (!tracks.length) throw new Error('That playlist came back empty.');
  return tracks;
}

async function resolveTracks(query, requesterId) {
  const q = query.trim();
  if (!q) throw new Error('Please give me a song name or URL, e.g. `!play never gonna give you up`.');
  if (q.length > 400) throw new Error('That query is way too long — keep it under 400 characters.');

  // Cache hit: re-stamp requester so "requested by" stays correct.
  const key = resolveCacheKey(q);
  const cached = resolveCacheGet(key);
  if (cached) {
    const tracks = cached.tracks.map((t) => ({ ...t, requestedBy: requesterId }));
    return { tracks, kind: cached.kind };
  }

  let result;
  if (looksLikeUrl(q) && playlistIdFromUrl(q)) {
    // Any URL carrying a `list` param (playlist/, watch?v=X&list=, mixes) = playlist.
    const tracks = await resolvePlaylistUrl(q, requesterId);
    result = { tracks, kind: 'playlist' };
  } else {
    const track = await resolveSingleTrack(q, requesterId);
    result = { tracks: [track], kind: looksLikeUrl(q) ? 'video' : 'search' };
  }
  resolveCacheSet(key, result);
  return result;
}

// ---------- Audio streaming ----------
// Low-CPU path: when the source is already opus-in-webm we forward it as
// `StreamType.WebmOpus` — @discordjs/voice demuxes without spawning ffmpeg
// (no re-encode, so quality is actually BETTER than the ffmpeg path).
// Otherwise we fall back to the classic `StreamType.Arbitrary` ffmpeg
// transcode. Both paths work on Windows (.exe) and Linux via
// ytDlpBinaryPath()/ffmpeg-static on PATH. Returns { stream, destroy }.

function streamAudio(url, { opus = false } = {}) {
  const bin = ensureYtDlpOrThrow();
  // Opus-preferred selector still resolves on non-opus videos (falls back
  // to bestaudio) — caller only picks WebmOpus demux when probe says opus,
  // otherwise Arbitrary, so a wrong guess can't break playback.
  const format = opus
    ? 'bestaudio[ext=webm][acodec=opus]/bestaudio[acodec=opus]/bestaudio'
    : 'ba';
  const yt = spawn(
    bin,
    ['--no-playlist', '--no-warnings', ...ytBaseArgs(),
      '-f', format, '--socket-timeout', '30', '--retries', '3',
      '--fragment-retries', '3', '--buffer-size', '128K',
      '-o', '-', '--', url],
    { stdio: ['ignore', 'pipe', 'pipe'] },
  );
  const feed = new PassThrough({ highWaterMark: 1024 * 1024 }); // 1MB buffer absorbs YouTube segment gaps
  yt.stdout.pipe(feed);

  // Timing probe for the "takes 1 minute to play" diagnosis: logs how long
  // from spawn until YouTube delivers the first audio byte.
  const spawnAt = Date.now();
  let firstByteLogged = false;
  yt.stdout.on('data', () => {
    if (!firstByteLogged) {
      firstByteLogged = true;
      console.log(`[music] first audio byte after ${Date.now() - spawnAt}ms (${format})`);
    }
  });

  let ytErr = '';
  let destroyed = false; // true when WE killed yt-dlp (skip/stop/next) — not an error
  yt.stderr.setEncoding('utf8');
  yt.stderr.on('data', (d) => { ytErr = (ytErr + d).slice(-4000); });

  function kill() {
    destroyed = true;
    try { yt.kill('SIGKILL'); } catch { /* already gone */ }
  }

  // If yt-dlp is killed/replaces while still writing, its socket errors — drop
  // it instead of crashing the process.
  yt.stdout.on('error', () => feed.end());
  feed.on('error', kill);
  yt.on('error', kill);
  yt.on('exit', (code, signal) => {
    if (destroyed) return; // intentional skip/stop — silent, was logged as "exited null" before
    if (code !== 0 && code !== null) {
      console.error(`[music] yt-dlp exited ${code}: ${ytErr.slice(0, 500) || 'no stderr'}`);
      // End the feed so the player sees EOF (and advances), instead of hanging.
      feed.destroy(new Error('The song stream failed to download.'));
    } else if (code === null && !signal) {
      console.error(`[music] yt-dlp exited null: ${ytErr.slice(0, 500) || 'no stderr'}`);
      feed.destroy(new Error('The song stream failed to download.'));
    }
    // code 0 = finished normally; code null + SIGKILL with destroyed=false
    // (host OOM-kill) still surfaces via player error handling below.
  });

  return { stream: feed, destroy: kill };
}

// Fire-and-forget: while the current song plays, probe the next queued tracks
// with unknown codecs so their passthrough decision is cached by the time
// they start (no added latency on track change).
// Sequential with 2s delay between probes to avoid CPU spikes that starve
// the live demuxer and cause audio lag.
let warmingProbes = false;
function warmNextProbes(queue) {
  if (warmingProbes) return;
  warmingProbes = true;
  (async () => {
    try {
      let n = 0;
      for (const t of queue) {
        if (n >= 1) break;
        if (t && t.isOpus == null && t.url && !opusSettledCache.has(t.url)) {
          n++;
          try {
            t.isOpus = await probeIsOpus(t.url);
          } catch { /* probe failed — track still plays via ffmpeg path */ }
          // Yield CPU to the live audio stream before probing next track
          await new Promise((r) => setTimeout(r, 2000));
        }
      }
    } finally {
      warmingProbes = false;
    }
  })().catch(() => { warmingProbes = false; });
}

// ---------- Playback ----------
async function playTrack(state, track) {
  state.streamCtl?.destroy?.();
  // Low-CPU decision: opus passthrough only when volume is at 100% (no
  // inlineVolume transform needed) AND the source is opus. Anything else
  // (custom volume, non-opus m4a) uses the ffmpeg path. Same audible
  // quality at 100%; custom volumes still work, just on the ffmpeg path.
  // No blocking probe here: single tracks already carry isOpus from resolve,
  // and playlist tracks (isOpus==null) start on the ffmpeg path immediately
  // while a background probe warms the flag for replays/loops. Exception:
  // if the URL already has a SETTLED probe result, use it with zero delay
  // (sync map check, never awaits a pending probe) for instant passthrough.
  let isOpus = track.isOpus === true;
  if (track.isOpus == null && opusSettledCache.has(track.url)) {
    isOpus = opusSettledCache.get(track.url) === true;
    track.isOpus = isOpus;
  } else if (track.isOpus == null) {
    probeIsOpus(track.url).then((v) => { track.isOpus = v; }).catch(() => {});
  }
  const usePassthrough = isOpus && state.volume === 100;
  const useVolume = state.volume !== 100;

  const { stream, destroy } = streamAudio(track.url, { opus: usePassthrough });
  const resource = createAudioResource(stream, {
    inputType: usePassthrough ? StreamType.WebmOpus : StreamType.Arbitrary,
    inlineVolume: useVolume,
    highWaterMark: 1 << 20, // 1MB — pre-buffer audio to ride out segment gaps
  });
  if (useVolume) resource.volume.setVolume(state.volume / 100);
  // NOTE: stored as { destroy } (object) — every cleanup site calls
  // `state.streamCtl?.destroy?.()`, so storing the bare function would make
  // cleanup a silent no-op and leak yt-dlp processes.
  state.streamCtl = { destroy };
  state.resource = resource;
  state.current = track;
  state.player.play(resource);
}

async function handleTrackEnd(state, { skipAnyLoop = false } = {}) {
  if (!guilds.has(state.guildId) || guilds.get(state.guildId) !== state) return;

  // Consume the intentional-skip flag (set by skip()). Anything else reaching
  // Idle is a natural end — or a stall the player gave up on (see player
  // behaviors). Log suspiciously early ends so they can be told apart.
  const wasManual = state.manualSkip === true;
  state.manualSkip = false;

  if (!skipAnyLoop && state.loop === 'song' && state.current) {
    // Re-play the current track.
    try {
      await playTrack(state, state.current);
    } catch (err) {
      console.error('[music] Failed to replay looping track:', err.message);
      await handleTrackEnd(state, { skipAnyLoop: true });
    }
    return;
  }

  if (!wasManual && state.resource && state.current && state.current.durationSec > 0) {
    const playedSec = (state.resource.playbackDuration || 0) / 1000;
    if (playedSec < state.current.durationSec - 10) {
      console.warn(
        `[music] Track ended early: "${state.current.title}" played ~${Math.round(playedSec)}s of ${state.current.durationSec}s. ` +
        'Likely a download/CPU stall that outlasted the player tolerance — advancing to keep the queue moving.',
      );
    }
  }

  if (state.loop === 'queue') {
    state.queue.push(state.current);
  }

  const next = state.queue.shift();
  if (!next) {
    await finishPlayback(state, '🎶 Queue finished — leaving the voice channel.');
    return;
  }

  try {
    await playTrack(state, next);
    announceTrack(state, next);
    warmNextProbes(state.queue);
  } catch (err) {
    console.error(`[music] Failed to play "${next.title}":`, err.message);
    await handleTrackEnd(state, { skipAnyLoop: true });
  }
}

function announceTrack(state, track) {
  const link = `[${track.title.replace(/[[\]]/g, '')}](${track.url})`;
  const duration = formatDuration(track.durationSec);
  const req = track.requestedBy ? ` — requested by <@${track.requestedBy}>` : '';
  state.textChannel?.send(`▶️ **${link}** \`${duration}\`${req}`).catch(() => null);
}

async function finishPlayback(state, farewell) {
  endingNow(state);
  if (farewell) state.textChannel?.send(farewell).catch(() => null);
}

// ---------- Public commands ----------
async function play(voiceChannel, textChannel, query, requesterId) {
  if (!voiceChannel) throw new Error('You need to be in a voice channel first.');

  // Live TTS may hold the connection's subscription on its own player while
  // ducking music. Hand it back BEFORE we start, otherwise the new track
  // would play on an orphaned (unsubscribed) music player = silence.
  // Lazy require to avoid a load-time cycle (ttsLiveManager also requires us).
  try {
    require('./ttsLiveManager').notifyMusicTakeover(voiceChannel.guild.id);
  } catch { /* TTS off or not loaded — ignore */ }

  // Start resolving immediately in parallel with the voice handshake.
  // Previously these ran sequentially (join ~200-500ms, then resolve ~1s),
  // stacking both waits before the first byte streamed.
  // Timers below diagnose "takes 1 minute to play" reports in the logs.
  const tStart = Date.now();
  const resolvePromise = resolveTracks(query, requesterId).then(
    (r) => {
      console.log(`[music] resolve took ${Date.now() - tStart}ms (${r.kind}, ${r.tracks.length} track(s))`);
      return r;
    },
    (err) => {
      console.log(`[music] resolve failed after ${Date.now() - tStart}ms: ${err && err.message}`);
      throw err;
    },
  );

  let state = guilds.get(voiceChannel.guild.id) || null;
  let isNewConnection = false;

  // Join voice (or reuse the existing connection if the bot is already in
  // the same channel).
  if (state?.connection && state.connection.joinConfig.channelId === voiceChannel.id) {
    // Already connected here. Re-claim the subscription: live TTS may have
    // pointed it at its own player while ducking (now cleared above), and
    // without this the track would play silently on an orphaned player.
    try { state.connection.subscribe(state.player); } catch { /* keep going */ }
  } else {
    if (state) disconnectGuild(voiceChannel.guild.id);
    const connection = joinVoiceChannel({
      channelId: voiceChannel.id,
      guildId: voiceChannel.guild.id,
      adapterCreator: voiceChannel.guild.voiceAdapterCreator,
      selfDeaf: true,
    });
    try {
      await entersState(connection, VoiceConnectionStatus.Ready, 15_000);
      console.log(`[music] voice join took ${Date.now() - tStart}ms`);
    } catch {
      try { connection.destroy(); } catch { /* ignore */ }
      resolvePromise.catch(() => {});
      throw new Error("Couldn't join your voice channel — try again.");
    }

    const player = createAudioPlayer({
      behaviors: {
        // Pause (not Stop) when nobody is subscribed: live-TTS ducking steals
        // the subscription briefly and hands it back, music must resume.
        noSubscriber: NoSubscriberBehavior.Pause,
        // THE early-skip fix. The player calls read() every 20ms and Idle's
        // after `maxMissedFrames` consecutive empty reads. The default (5 =
        // 100ms) treats ANY brief stall — yt-dlp network hiccup, or ffmpeg
        // starved by a concurrent resolve/probe on a small host — as
        // end-of-track and jumps to the next song, typically audibly cutting
        // the ending. 50 (~1s) rides out those hiccups; true ends just gain
        // ~1s of trailing silence before the next track. skip() force-stops,
        // so it stays instant.
        maxMissedFrames: 50,
      },
    });
    const newState = {
      guildId: voiceChannel.guild.id,
      queue: [],
      current: null,
      loop: 'off',
      volume: 100, // 100 = low-CPU opus passthrough; custom levels use ffmpeg path
      manualSkip: false, // set by skip() so Idle can tell intent apart from stall
      player,
      connection,
      resource: null,
      textChannel,
      emptyTimer: null,
    };
    player.on(AudioPlayerStatus.Idle, () => handleTrackEnd(newState));
    player.on('error', (err) => {
      console.error('[music] Audio player error:', err.message);
      handleTrackEnd(newState, { skipAnyLoop: true });
    });
    connection.subscribe(player);

    state = newState;
    isNewConnection = true;
    guilds.set(voiceChannel.guild.id, state);

    connection.on('stateChange', (_old, next) => {
      if (next.status === VoiceConnectionStatus.Disconnected) {
        destroyPlayer(state);
      } else if (next.status === VoiceConnectionStatus.Destroyed) {
        destroyPlayer(state);
      }
    });
  }

  state.textChannel = textChannel || state.textChannel;

  let tracks;
  let kind;
  try {
    ({ tracks, kind } = await resolvePromise);
  } catch (err) {
    // Don't linger in VC if we just joined and have nothing to play.
    if (isNewConnection && !state.current && state.queue.length === 0) {
      disconnectGuild(voiceChannel.guild.id);
    }
    throw err;
  }

  if (!state.current) {
    await playTrack(state, tracks[0]);
    console.log(`[music] playback started ${Date.now() - tStart}ms after command`);
    announceTrack(state, tracks[0]);
    state.queue.push(...tracks.slice(1));
  } else {
    state.queue.push(...tracks);
    console.log(`[music] queued in ${Date.now() - tStart}ms (${tracks.length} track(s), already playing)`);
  }
  warmNextProbes(state.queue);

  return {
    kind,
    count: tracks.length,
    first: tracks[0],
  };
}

function pause(guildId) {
  const state = requireState(guildId);
  if (!state.current) throw new Error('Nothing is playing right now.');
  state.player.pause();
  return '⏸️ Paused — use `resume` (or `/music resume`) to continue.';
}

function resume(guildId) {
  const state = requireState(guildId);
  if (!state.current) throw new Error('Nothing is playing right now.');
  state.player.unpause();
  return '▶️ Resumed.';
}

async function skip(guildId) {
  const state = requireState(guildId);
  if (!state.current) throw new Error('Nothing is playing right now.');
  const skipped = state.current;
  // Mark intentional so the Idle handler doesn't log this as an early end,
  // and force-stop: with the raised maxMissedFrames a graceful stop() would
  // take ~1s of trailing silence before advancing, feeling laggy.
  state.manualSkip = true;
  const stopped = state.player.stop(true);
  if (!stopped) state.manualSkip = false; // already idle — no Idle event coming
  await new Promise((resolve) => setTimeout(resolve, 50));
  return `⏭️ Skipped **${skipped.title}**.`;
}

function shuffle(guildId) {
  const state = requireState(guildId);
  if (state.queue.length < 2) throw new Error('Not enough songs in the queue to shuffle.');
  for (let i = state.queue.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [state.queue[i], state.queue[j]] = [state.queue[j], state.queue[i]];
  }
  return `🔀 Shuffled ${state.queue.length} queued song${state.queue.length === 1 ? '' : 's'}.`;
}

function remove(guildId, position) {
  const state = requireState(guildId);
  const idx = position - 1;
  if (idx < 0 || idx >= state.queue.length) {
    throw new Error(`There's no song at position ${position}. Use \`queue\` to see positions.`);
  }
  const [removed] = state.queue.splice(idx, 1);
  return `🗑️ Removed **${removed.title}** from the queue.`;
}

function setLoop(guildId, mode) {
  const state = requireState(guildId);
  if (!state.current) throw new Error('Nothing is playing right now.');
  state.loop = mode;
  const label = { off: 'off', song: 'current track', queue: 'whole queue' }[mode];
  return `🔁 Loop is now **${label}**.`;
}

function volume(guildId, level) {
  const clamped = Math.max(0, Math.min(MAX_VOLUME, level));
  const state = requireState(guildId);
  state.volume = clamped;
  // Low-CPU passthrough tracks have no volume transformer (inlineVolume off
  // on purpose). Apply now if we can, otherwise it takes effect from the
  // next track, which will use the ffmpeg path. Same behavior on Win/Linux.
  if (state.resource?.volume) {
    state.resource.volume.setVolume(clamped / 100);
    return `🔊 Volume set to **${clamped}%**.`;
  }
  return clamped === 100
    ? '🔊 Volume set to **100%** (low-CPU mode).'
    : `🔊 Volume set to **${clamped}%** — applies from the next track (low-CPU mode is active for the current song).`;
}

function stop(guildId) {
  const state = guilds.get(guildId);
  if (!state || (!state.current && !state.queue.length)) {
    throw new Error('Nothing to stop — the bot isn\'t playing here.');
  }
  disconnectGuild(guildId);
  return '⏹️ Stopped and left the voice channel.';
}

function leave(guildId) {
  const state = guilds.get(guildId);
  if (!state?.connection) throw new Error('I\'m not in a voice channel here.');
  disconnectGuild(guildId);
  return '👋 Left the voice channel.';
}

function queue(guildId) {
  const state = requireState(guildId);
  return {
    current: state.current,
    queue: state.queue,
    volume: state.volume,
    loop: state.loop,
  };
}

function requireState(guildId) {
  const state = guilds.get(guildId);
  if (!state || !state.connection) {
    throw new Error('The bot isn\'t in a voice channel here. Start with `play` (or `/music play`).');
  }
  return state;
}

// ---------- Auto-leave when the channel goes empty ----------
// Called from events/voiceStateUpdate.js. Clears the pending leave timer as
// soon as a human is in the room again, so a quick disconnect never nukes
// the queue.
function handleVoiceStateUpdate(oldState, newState) {
  const guildId = newState.guild?.id || oldState.guild?.id;
  const state = guilds.get(guildId);
  if (!state?.connection) return;

  const vcId = state.connection.joinConfig.channelId;
  const channel = newState.guild?.channels?.cache?.get(vcId);
  const memberCount = channel?.members?.size ?? 1;

  if (state.emptyTimer) {
    clearTimeout(state.emptyTimer);
    state.emptyTimer = null;
  }

  if (memberCount <= 1) {
    state.emptyTimer = setTimeout(() => {
      const current = guilds.get(guildId);
      if (!current || current !== state) return;
      const vcIdNow = current.connection.joinConfig.channelId;
      const chNow = current.textChannel?.guild?.channels?.cache?.get(vcIdNow);
      if (chNow?.members?.size <= 1) {
        finishPlayback(state, '👋 Nobody\'s listening — leaving the voice channel.');
      }
    }, AUTO_LEAVE_EMPTY_MS);
  }
}

// ---------- Teardown ----------
function disconnectGuild(guildId) {
  const state = guilds.get(guildId);
  if (!state) return;
  if (state.emptyTimer) clearTimeout(state.emptyTimer);
  state.streamCtl?.destroy?.();
  if (state.connection && state.connection.state.status !== VoiceConnectionStatus.Destroyed) {
    state.connection.destroy();
  }
  try {
    state.player?.stop(true);
  } catch { /* already stopped */ }
  guilds.delete(guildId);
}

function destroyPlayer(state) {
  if (guilds.get(state.guildId) !== state) return;
  if (state.emptyTimer) clearTimeout(state.emptyTimer);
  state.streamCtl?.destroy?.();
  try {
    state.player?.stop(true);
  } catch { /* no-op */ }
  guilds.delete(state.guildId);
}

function endingNow(state) {
  disconnectGuild(state.guildId);
}

// Force cleanup of stale entries (e.g., connections that were closed externally)
function cleanupStaleGuilds() {
  const now = Date.now();
  for (const [guildId, state] of guilds.entries()) {
    if (!state?.connection || state.connection.state.status === VoiceConnectionStatus.Destroyed) {
      if (state.emptyTimer) clearTimeout(state.emptyTimer);
      state.streamCtl?.destroy?.();
      guilds.delete(guildId);
    }
  }
}

// Periodic cleanup to prevent memory leaks
setInterval(cleanupStaleGuilds, 5 * 60 * 1000); // Every 5 minutes

module.exports = {
  getState,
  resolveTracks,
  play,
  pause,
  resume,
  skip,
  shuffle,
  remove,
  setLoop,
  volume,
  stop,
  leave,
  queue,
  handleVoiceStateUpdate,
  destroyPlayer,
  formatDuration,
  MAX_VOLUME,
};