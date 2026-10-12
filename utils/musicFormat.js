// Pure formatting helpers for the music embeds. Kept dependency-free so they
// can be unit-tested without installing discord.js / @discordjs/voice.
// utils/musicManager.js re-exports these for convenience.

// 90 -> "1:30", 3750 -> "1:02:30"
function fmtTime(totalSec) {
  let t = Math.floor(Number(totalSec) || 0);
  if (t < 0) t = 0;
  const s = t % 60;
  const m = Math.floor(t / 60) % 60;
  const h = Math.floor(t / 3600);
  const mm = h ? String(m).padStart(2, '0') : String(m);
  return h ? `${h}:${mm}:${String(s).padStart(2, '0')}` : `${mm}:${String(s).padStart(2, '0')}`;
}

// Accepts "90" (seconds), "1:30" (m:ss), or "1:02:30" (h:mm:ss). null if unusable.
function parseTime(input) {
  const raw = String(input ?? '').trim();
  if (/^\d+$/.test(raw)) return Number(raw);
  const parts = raw.split(':');
  if (parts.length === 3 && parts.every((p) => /^\d+$/.test(p))) {
    return Number(parts[0]) * 3600 + Number(parts[1]) * 60 + Number(parts[2]);
  }
  if (parts.length === 2 && parts.every((p) => /^\d+$/.test(p))) {
    return Number(parts[0]) * 60 + Number(parts[1]);
  }
  return null;
}

// "0:12 ━━━━🔘──────── 3:45" style track. Unknown duration -> marker at the start.
function progressBar(cur, total, size = 18) {
  if (!total || total <= 0) return `🔘${'─'.repeat(size)}`;
  const ratio = Math.max(0, Math.min(1, cur / total));
  const pos = Math.round(ratio * (size - 1));
  return `${'━'.repeat(pos)}🔘${'─'.repeat(size - 1 - pos)}`;
}

module.exports = { fmtTime, parseTime, progressBar };
