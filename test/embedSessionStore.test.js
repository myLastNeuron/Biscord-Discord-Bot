'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const sessionStore = require('../utils/embedSessionStore');

test('each embed purpose gets its own session (no shared history)', () => {
  const userId = 'u1';
  const ticket = sessionStore.createSession(userId, { guildId: 'g', channelId: 'c', purpose: 'ticket:panel' });
  const welcome = sessionStore.createSession(userId, { guildId: 'g', channelId: 'c', purpose: 'welcome' });

  sessionStore.updateSession(ticket, (s) => { s.draft.title = 'Ticket title'; });

  // Opening the welcome builder must not carry the ticket draft over.
  assert.equal(sessionStore.getSessionByToken(userId, ticket.token).draft.title, 'Ticket title');
  assert.equal(sessionStore.getSessionByToken(userId, welcome.token).draft.title, null);

  sessionStore.deleteSession(ticket);
  assert.equal(sessionStore.getSessionByToken(userId, ticket.token), null);
  assert.ok(sessionStore.getSessionByToken(userId, welcome.token));
});

test('replacing a session invalidates its old token; tokens are user-scoped', () => {
  const first = sessionStore.createSession('u2', { guildId: 'g', channelId: 'c', purpose: 'welcome' });
  const second = sessionStore.createSession('u2', { guildId: 'g', channelId: 'c', purpose: 'welcome' });

  assert.equal(sessionStore.getSessionByToken('u2', first.token), null);
  assert.equal(sessionStore.getSessionByToken('u2', second.token), second);
  assert.equal(sessionStore.getSessionByToken('someone-else', second.token), null);
});
