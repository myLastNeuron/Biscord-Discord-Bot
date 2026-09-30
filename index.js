require('dotenv').config();
const fs = require('fs');
const path = require('path');

const figlet = require('figlet');

const { Client, GatewayIntentBits, Partials, Collection } = require('discord.js');
const { startScheduler } = require('./utils/scheduler');
const { init: initErrorHandler } = require('./utils/errorHandler');
const { startStatsChannels } = require('./statsChannels');
const { startServerStatusUpdater } = require('./serverStatusTracker');
const { startUpcomingBoardRefresher } = require('./utils/upcomingBoard');

// ─────────────────────────────────────────────
//  Startup UI — just the figlet banner, nothing else
// ─────────────────────────────────────────────

function stripAnsi(str) {
  return str.replace(/\x1b\[[0-9;]*m/g, '');
}

function renderBanner() {
  // figlet's "ANSI Shadow" font — clean double-line block glyphs, no jagged
  // hand-built diagonals. horizontalLayout keeps letters from crowding.
  const raw = figlet.textSync('BISCORD', {
    font: 'ANSI Shadow',
    horizontalLayout: 'default',
  });
  // trim trailing blank line figlet tends to leave
  return raw.replace(/\n+$/, '');
}

function printStartupBanner() {
  const banner = renderBanner();
  const bannerWidth = Math.max(...banner.split('\n').map(l => stripAnsi(l).length));
  const centeredBanner = banner
    .split('\n')
    .map(l => ' '.repeat(Math.max(0, Math.floor((bannerWidth - stripAnsi(l).length) / 2))) + l)
    .join('\n');

  console.log('');
  console.log(`\x1b[96m${centeredBanner}\x1b[0m`);
  console.log('');
}

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,      // needed for welcomer + moderation member fetches
    GatewayIntentBits.GuildPresences,    // needed for online/idle/DND status (server-status command)
    GatewayIntentBits.GuildMessages,     // needed for purge
    GatewayIntentBits.GuildVoiceStates,  // needed for temp voice channels (join/leave/move events)
    GatewayIntentBits.GuildBans,         // needed for audit log: ban/unban events
    GatewayIntentBits.MessageContent,    // required: prefix music commands, auto-react/auto-delete/reply-back matching, media-only enforcement
  ],
  partials: [Partials.GuildMember, Partials.User],
});

// Initialize centralized error handling (process guards + interaction handler)
initErrorHandler(client);

client.commands = new Collection();

// ---------- Load commands recursively from /commands ----------
// Some helper/utility modules live alongside real commands in commands/
// subfolders (e.g. autoReactStore.js, moderationBuilder.js, theme.js).
// They don't export data/execute on purpose — list them here so the loader
// skips them silently instead of logging a false-positive warning.
const NON_COMMAND_FILES = new Set([
  'autoReactStore.js',
  'moderationBuilder.js',
  'theme.js',
]);

function loadCommands(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      loadCommands(fullPath);
    } else if (entry.name.endsWith('.js')) {
      if (NON_COMMAND_FILES.has(entry.name)) continue;
      const command = require(fullPath);
      if (command?.data?.name && typeof command.execute === 'function') {
        client.commands.set(command.data.name, command);
      } else {
        console.warn(`[commands] Skipped ${fullPath} — missing "data"/"execute" export.`);
      }
    }
  }
}
loadCommands(path.join(__dirname, 'commands'));

// ---------- Load events from /events ----------
const eventsDir = path.join(__dirname, 'events');
const eventFiles = fs.readdirSync(eventsDir).filter(f => f.endsWith('.js'));
for (const file of eventFiles) {
  const event = require(path.join(eventsDir, file));
  if (event.once) client.once(event.name, (...args) => event.execute(...args));
  else client.on(event.name, (...args) => event.execute(...args));
}

// Print just the banner — no system/init boxes, no connecting messages.
printStartupBanner();

client.once('clientReady', () => {
  // Start the auto-updating "Members: N" / "Online: N" voice channel labels.
  // No-op if STATS_MEMBERS_CHANNEL_ID / STATS_ONLINE_CHANNEL_ID aren't set in .env.
  startStatsChannels(client);

  // Start the /server-status auto-refresh loop (edits the tracked reply
  // message every 30s). No-op until /server-status has been run at least
  // once, since that's what registers the message to refresh.
  startServerStatusUpdater(client);

  // Start the upcoming board auto-refresh loop (edits the board message
  // every 30s for each guild that has it enabled). Staggered 24s from boot
  // so it doesn't fire in the same tick as the other 30s loops.
  setTimeout(() => startUpcomingBoardRefresher(client), 24000);
});

client.login(process.env.DISCORD_TOKEN);

// ---------- Start background scheduler ----------
// Checks scheduledEvents.json every 30s and posts any panel whose scheduled time has arrived.
startScheduler(client);
