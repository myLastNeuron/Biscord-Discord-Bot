// Google Translate TTS helper — zero-dep, zero CPU (no ffmpeg/yt-dlp).
// Fetches tiny MP3 bytes over HTTPS and concats them. The 20ms of local
// work is string splitting + Buffer.concat; everything else is network wait,
// so this is safe on capped hosts (e.g. Wispbyte 35% CPU).
//
// Endpoint: https://translate.google.com/translate_tts?ie=UTF-8&tl=<lang>&q=<text>&client=tw-ob
// Free, no API key. Hard limit ~200 chars per request — we chunk below that.

const TTS_LANGS = {
  en: 'English',
  es: 'Spanish',
  fr: 'French',
  de: 'German',
  it: 'Italian',
  pt: 'Portuguese',
  hi: 'Hindi',
  ar: 'Arabic',
  tr: 'Turkish',
  uk: 'Ukrainian',
};

const MAX_CHARS_PER_REQUEST = 180; // stay under Google's ~200 limit with margin
const MAX_TOTAL_CHARS = 300; // v1 cap: max 2 fetches per /tts call
const MAX_AUDIO_BYTES = 1_000_000; // sanity cap (~1MB)
const FETCH_TIMEOUT_MS = 10_000;

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36';

// Split text into <=maxChunk pieces on sentence/phrase boundaries.
// Never cuts mid-word; falls back to hard slice for pathological long words.
function splitForTts(text, maxChunk = MAX_CHARS_PER_REQUEST) {
  const clean = (text || '').replace(/\s+/g, ' ').trim();
  if (!clean) return [];
  if (clean.length <= maxChunk) return [clean];

  // Split on sentence/phrase endings, keep delimiter attached.
  const sentences = clean.match(/[^.!?;\n]+[.!?;\n]*\s*/g) || [clean];
  const chunks = [];
  let current = '';

  for (const sentence of sentences) {
    const piece = sentence.trim();
    if (!piece) continue;
    if ((current + ' ' + piece).trim().length <= maxChunk) {
      current = (current + ' ' + piece).trim();
    } else {
      if (current) chunks.push(current);
      if (piece.length <= maxChunk) {
        current = piece;
      } else {
        // Single sentence longer than limit — hard-slice on word boundaries.
        const words = piece.split(' ');
        current = '';
        for (const word of words) {
          if ((current + ' ' + word).trim().length <= maxChunk) {
            current = (current + ' ' + word).trim();
          } else {
            if (current) chunks.push(current);
            // Word itself longer than limit — hard slice it.
            if (word.length > maxChunk) {
              for (let i = 0; i < word.length; i += maxChunk) {
                chunks.push(word.slice(i, i + maxChunk));
              }
              current = '';
            } else {
              current = word;
            }
          }
        }
      }
    }
  }
  if (current) chunks.push(current);
  return chunks.filter(Boolean);
}

async function fetchTtsMp3(chunk, lang = 'en') {
  const url =
    'https://translate.google.com/translate_tts?ie=UTF-8' +
    `&tl=${encodeURIComponent(lang)}` +
    `&q=${encodeURIComponent(chunk)}` +
    '&client=tw-ob';

  const res = await fetch(url, {
    headers: { 'User-Agent': UA },
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });

  if (!res.ok) {
    const err = new Error(`TTS request failed (HTTP ${res.status})`);
    err.status = res.status;
    throw err;
  }
  const buf = Buffer.from(await res.arrayBuffer());
  if (!buf.length) throw new Error('TTS returned empty audio');
  return buf;
}

// Main entry: validate -> chunk -> fetch (parallel, order preserved) -> concat.
// Throws with user-friendly messages the command can surface directly.
async function textToSpeechBuffer(text, lang = 'en') {
  const normalizedLang = TTS_LANGS[lang] ? lang : 'en';
  const clean = (text || '').replace(/\s+/g, ' ').trim();
  if (!clean) throw new Error('Please provide some text to speak.');
  if (clean.length > MAX_TOTAL_CHARS) {
    throw new Error(`Keep it under ${MAX_TOTAL_CHARS} characters (you sent ${clean.length}).`);
  }

  const chunks = splitForTts(clean);
  if (!chunks.length) throw new Error('Please provide some text to speak.');

  const started = Date.now();
  const parts = await Promise.all(chunks.map((c) => fetchTtsMp3(c, normalizedLang)));
  const audio = Buffer.concat(parts);

  if (audio.length > MAX_AUDIO_BYTES) {
    throw new Error('Generated audio was unexpectedly large — try shorter text.');
  }

  return { audio, chunks: chunks.length, lang: normalizedLang, tookMs: Date.now() - started };
}

module.exports = { TTS_LANGS, MAX_TOTAL_CHARS, splitForTts, fetchTtsMp3, textToSpeechBuffer };
