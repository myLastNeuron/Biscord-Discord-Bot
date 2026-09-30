// Centralized error handling with process-level guards
// Call init(client) early in index.js to install guards

const { MessageFlags } = require('discord.js');
const { err, info } = require('./logger');

let clientRef = null;
let isShuttingDown = false;

// ---------- Interaction error handler (idempotent) ----------
async function handleInteractionError(interaction, error) {
  const customId = interaction.isButton() ? interaction.customId
    : interaction.isSelectMenu() ? interaction.customId
    : interaction.isModalSubmit() ? interaction.customId
    : interaction.isCommand() ? interaction.commandName
    : 'unknown';

  const tag = `interaction:${customId}`;
  err(tag, error, { interactionId: interaction.id, customId, userId: interaction.user?.id });

  // Idempotent acknowledgement — try reply, then followUp, swallow all errors
  const ephemeralContent = '⚠️ Something went wrong. The team has been notified.';
  const tryReply = async (fn) => {
    try { await fn(); } catch (_) { /* swallow */ }
  };

  const ephemeralFlags = MessageFlags.Ephemeral;

  if (interaction.replied || interaction.deferred) {
    await tryReply(() => interaction.followUp({ content: ephemeralContent, flags: ephemeralFlags }));
  } else {
    await tryReply(() => interaction.reply({ content: ephemeralContent, flags: ephemeralFlags }));
  }
}

// ---------- Process-level guards ----------
function installProcessGuards() {
  // uncaughtException — synchronous throw not caught anywhere
  process.on('uncaughtException', (error) => {
    if (isShuttingDown) return;
    err('process:uncaughtException', error, { type: 'uncaughtException' });
    fatalExit(error);
  });

  // unhandledRejection — promise rejection with no .catch()
  process.on('unhandledRejection', (reason, promise) => {
    if (isShuttingDown) return;
    const error = reason instanceof Error ? reason : new Error(String(reason));
    err('process:unhandledRejection', error, { type: 'unhandledRejection' });
    // Non-fatal: log + report but keep process alive
    reportToLogChannel(error, 'unhandledRejection');
  });

  // SIGTERM / SIGINT — graceful shutdown
  process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
  process.on('SIGINT', () => gracefulShutdown('SIGINT'));
}

async function reportToLogChannel(error, context) {
  if (!clientRef) return;
  try {
    const { getGuildSettings } = require('./db');
    // Stacks can contain absolute file paths, internal module names and env
    // hints, and log channels are usually readable by many members. Default to
    // a short summary; set LOG_ERROR_STACKS=1 to include the stack on purpose.
    const includeStack = process.env.LOG_ERROR_STACKS === '1';
    const stack = includeStack && error.stack
      ? `\n\`\`\`${error.stack.slice(0, 1500)}\`\`\``
      : '';
    const summary = String(error.message || error).slice(0, 900);
    // Broadcast to all guilds' log channels
    for (const guild of clientRef.guilds.cache.values()) {
      const settings = getGuildSettings(guild.id);
      if (!settings?.logChannelId) continue;
      const channel = await guild.channels.fetch(settings.logChannelId).catch(() => null);
      if (!channel?.isTextBased()) continue;
      const msg = `⚠️ **${context}** — ${summary}${stack}`;
      await channel.send({ content: msg }).catch(() => null);
    }
  } catch (_) { /* swallow */ }
}

function fatalExit(error) {
  isShuttingDown = true;
  // Attempt to notify log channels before exit
  reportToLogChannel(error, 'fatal:uncaughtException').finally(() => {
    // Exit with nonzero to trigger run.js restart
    process.exit(1);
  });
}

async function gracefulShutdown(signal) {
  if (isShuttingDown) return;
  isShuttingDown = true;
  info('process', `Received ${signal}, shutting down gracefully...`);
  try {
    if (clientRef) await clientRef.destroy();
  } catch (_) { /* ignore */ }
  process.exit(0);
}

// ---------- Public API ----------
function init(client) {
  clientRef = client;
  installProcessGuards();
  info('process', 'Error handlers initialized');
}

module.exports = {
  init,
  handleInteractionError,
  fatalExit,
  gracefulShutdown,
};