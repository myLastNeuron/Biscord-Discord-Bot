const { createLogger } = require('./logger');

const logger = createLogger('aspal:room');

const API_BASE = 'https://aspal.io/api';
const SITE_BASE = 'https://aspal.io';

// Anonymous session cookie (ownup_token) reused for every room.
// Adjusted lazily on the first request so we never hit the site for
// nothing if the command is never run.
let sessionCookie = '';
let sessionLock = null;

// Pulls the anonymous ownup_token cookie out of a Set-Cookie header so we
// can replay it on later requests. Set-Cookie may be a single header or
// repeated (one per cookie) depending on the server/undici version.
function extractTrackedCookie(setCookieList) {
  const headers = Array.isArray(setCookieList) ? setCookieList : [setCookieList];
  for (const raw of headers) {
    const match = String(raw || '').match(/ownup_token=([^;]+)/);
    if (match) return match[1].trim();
  }
  return null;
}

async function requestJson(path, headers = {}) {
  const res = await fetch(`${API_BASE}${path}`, {
    headers: { ...headers, cookie: sessionCookie },
    redirect: 'follow',
  });

  const setCookies = res.headers.getSetCookie ? res.headers.getSetCookie() : [res.headers.get('set-cookie')];
  const token = extractTrackedCookie(setCookies);
  if (token) sessionCookie = `ownup_token=${token}`;

  if (res.status === 403) {
    let body = null;
    try { body = await res.json(); } catch { /* non-json */ }
    if (body?.error === 'captcha-required') throw new Error('captcha-required');
  }
  if (!res.ok) throw new Error(`aspal.io API ${res.status} for ${path}`);

  return res.json();
}

async function ensureSession() {
  if (sessionCookie) return;
  if (sessionLock) return sessionLock;
  sessionLock = (async () => {
    await requestJson('/captcha/status');
  })().finally(() => {
    sessionLock = null;
  });
  return sessionLock;
}

// Creates a fresh private room on aspal.io and returns the shareable join
// link. No sign-in required — anyone with the link can join.
async function createRoom() {
  await ensureSession();
  const data = await requestJson('/room/new?isPrivate=true');
  const roomId = data.roomId;
  if (!roomId) throw new Error('aspal.io returned no roomId');
  logger.info('Created private room', { roomId, link: `${SITE_BASE}/room/${roomId}` });
  return { roomId, link: `${SITE_BASE}/room/${roomId}` };
}

// Expands a user-supplied room id into a full join link.
function roomLinkFromCode(code) {
  return `${SITE_BASE}/room/${encodeURIComponent(code)}`;
}

module.exports = { createRoom, roomLinkFromCode };