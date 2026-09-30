const {
  EmbedBuilder, ActionRowBuilder, StringSelectMenuBuilder, ButtonBuilder, ButtonStyle,
} = require('discord.js');
const { PREMIUM_COLORS } = require('./theme');

// Every feature the bot offers, grouped into categories. The overview page in
// /help lists each category with its commands; picking one from the select
// menu swaps to a per-command breakdown.
const HELP_CATEGORIES = [
  {
    key: 'admin',
    emoji: '🎛️',
    label: 'Administration',
    blurb: 'Bot configuration, the master dashboard, and member attendance. These are staff-only tools.',
    commands: [
      { name: '/panel', desc: 'One dashboard for everything — welcome, logging, mod roles, levels, bot config, and every module.' },
      { name: '/bot-config', desc: 'Change the bot\'s status text, activity, username, and avatar (also inside /panel → Bot Config).' },
      { name: '/embed', desc: 'Build custom embeds with a visual editor and save them as reusable templates.' },
      { name: '/stats', desc: 'Open a member\'s event-attendance history (counts per category).' },
      { name: '/panel-levels', desc: 'Standalone levels dashboard — reward roles, XP settings, and level-up notifications (also inside /panel → Levels).' },
    ],
  },
  {
    key: 'mod',
    emoji: '🛡️',
    label: 'Moderation',
    blurb: 'Keep the server safe. Every action is logged to your mod-log channel.',
    commands: [
      { name: '/ban', desc: 'Ban a member, optionally with a reason.' },
      { name: '/kick', desc: 'Kick a member, optionally with a reason.' },
      { name: '/timeout', desc: 'Time a member out for a set duration (minutes / hours / days).' },
      { name: '/untimeout', desc: 'Clear a member\'s timeout early.' },
      { name: '/purge', desc: 'Bulk-delete up to 100 messages, or just one user\'s.' },
      { name: '/warn', desc: 'Issue a warning, logged to the mod log.' },
      { name: '/warnings', desc: 'List everyone\'s warnings, view one member\'s, or clear them.' },
    ],
  },
  {
    key: 'events',
    emoji: '📅',
    label: 'Events & Scheduling',
    blurb: 'Signup rosters, one-off scheduled reminders, and daily auto-posted panels (London time).',
    commands: [
      { name: '/event', desc: 'Build roster/signup panels (create, list, close, delete) plus daily autopost rosters.' },
      { name: '/schedule', desc: 'Post a message at a future time — create / list / cancel.' },
      { name: '/roster-lock-time', desc: 'Set how long rosters stay open before they auto-lock.' },
    ],
  },
  {
    key: 'fun',
    emoji: '🎉',
    label: 'Giveaways & Polls',
    blurb: 'Community engagement — run giveaways and multi-choice polls with one command.',
    commands: [
      { name: '/giveaway', desc: 'Run giveaways — create, end, reroll, and delete, with a join button.' },
      { name: '/poll', desc: 'Create multi-choice polls, end them early, and view live results.' },
      { name: '/monopoly', desc: 'Host a Monopoly night in your browser (RichUp) — share the private-room link with friends.' },
      { name: '/tts', desc: 'Turn text into a voice MP3 file (10 languages).' },
    ],
  },
  {
    key: 'messaging',
    emoji: '💬',
    label: 'Messaging & Reactions',
    blurb: 'Message tools — one-off reactions, auto-react rules, auto-replies, and auto-delete. ' +
      'Tip: right-click any message \u2192 Apps \u2192 **React to Message** to react fast.',
    commands: [
      { name: '/react', desc: 'Make the bot react to any specific message with emojis.' },
      { name: '/autoreact', desc: 'Add rules that auto-react to matching messages (keywords, images, channels).' },
      { name: '/replyback', desc: 'Auto-reply or auto-react whenever specific users post in a channel.' },
      { name: '/autodelete', desc: 'Auto-delete messages by prefix, user, or channel.' },
    ],
  },
  {
    key: 'tickets',
    emoji: '🎫',
    label: 'Tickets & Requests',
    blurb: 'Let members open support tickets or request roles right from a channel.',
    commands: [
      { name: '/ticket', desc: 'Post the support-ticket panel; customise ticket settings via /panel.' },
      { name: '/rolerequest', desc: 'Post the role-request panel members use to request roles.' },
    ],
  },
  {
    key: 'voice',
    emoji: '🔊',
    label: 'Voice & VC Tools',
    blurb: 'Everything voice — keep-alive, join notifications, activity logs, and live status.',
    commands: [
      { name: '/connect', desc: 'Put the bot in a voice channel (keep-alive).' },
      { name: '/join', desc: 'Join your voice channel and read chat aloud (live TTS).' },
      { name: '/tts-live', desc: 'Start / stop / check the live chat reader (bound to one text channel).' },
      { name: '/leave', desc: 'Pull the bot out of voice.' },
      { name: '/vcnotify', desc: 'Get pinged whenever a chosen user joins a voice channel.' },
      { name: '/vcactivity', desc: 'Log VC joins/leaves to a channel, with messages using {user} and {vc}.' },
      { name: '/vc-members', desc: 'See who is currently in a voice channel.' },
      { name: '/server-status', desc: 'Live member counts (online / idle / DND), auto-refreshing every 30s.' },
    ],
  },
  {
    key: 'levels',
    emoji: '✨',
    label: 'Levels',
    blurb: 'XP and ranks for your community — automatic from chat activity.',
    commands: [
      { name: '/rank', desc: 'See your level & XP card, or another member\'s.' },
      { name: '/leaderboard', desc: 'The server\'s top leveled members.' },
      { name: '/give-xp', desc: 'Manually award XP to a member. (Staff only)' },
      { name: '/cheat-level', desc: 'Set a member\'s level or XP directly. (Staff only)' },
      { name: '/reset-level', desc: 'Reset progress for one member or the whole server. (Staff only)' },
    ],
  },
  {
    key: 'welcome',
    emoji: '👋',
    label: 'Welcome',
    blurb: 'Greet new members with a custom welcome message or full image card.',
    commands: [
      { name: '/welcome', desc: 'Setup (channel, message, image), preview, or disable the welcome card.' },
    ],
  },
];

function getHelpCategory(key) {
  return HELP_CATEGORIES.find((c) => c.key === key) || null;
}

// The main /help page — every category with its commands, plus a hint that
// some extra modules live inside the /panel dashboard.
function buildHelpOverviewEmbed(guild) {
  const lines = HELP_CATEGORIES.map(
    (c) => `${c.emoji} **${c.label}** — ${c.commands.map((cmd) => `\`${cmd.name}\``).join(' ')}`,
  ).join('\n');

  return new EmbedBuilder()
    .setColor(PREMIUM_COLORS.accent)
    .setTitle(`📚 ${guild.name} — Help Center`)
    .setDescription(
      'Everything I can do, grouped by feature.\n' +
      'Pick a category from the menu below to see what each command does.\n\n' +
      lines +
      '\n\n' +
      '-# Some features live inside **`/panel`** — Upcoming Board, Temp Voice Channels, Invite Tracker, ' +
      'Reaction Approval, Auto-React rules, giveaways, autopost rosters, the **Levels** system, and **Bot Config**.',
    )
    .setFooter({ text: 'Only visible to you · Made for your server' });
}

function buildHelpOverviewComponents() {
  const select = new StringSelectMenuBuilder()
    .setCustomId('help:category')
    .setPlaceholder('Explore a category…')
    .addOptions(HELP_CATEGORIES.map((c) => ({
      emoji: c.emoji,
      label: c.label,
      value: c.key,
      description: c.blurb.slice(0, 100),
    })));

  return [new ActionRowBuilder().addComponents(select)];
}

// A single category — one field per command, with what it does and who it's for.
function buildHelpCategoryEmbed(guild, category) {
  return new EmbedBuilder()
    .setColor(PREMIUM_COLORS.accent)
    .setTitle(`${category.emoji} ${category.label}`)
    .setDescription(category.blurb)
    .addFields(category.commands.map((cmd) => ({ name: `\`${cmd.name}\``, value: cmd.desc })))
    .setFooter({ text: `Behind ${guild.name}'s help menu · Use the menu to jump to another category` });
}

function buildHelpCategoryComponents(categoryKey) {
  const select = new StringSelectMenuBuilder()
    .setCustomId('help:category')
    .setPlaceholder('Jump to another category…')
    .addOptions(HELP_CATEGORIES.map((c) => ({
      emoji: c.emoji,
      label: c.label,
      value: c.key,
      default: c.key === categoryKey,
      description: c.blurb.slice(0, 100),
    })));

  const row1 = new ActionRowBuilder().addComponents(select);
  const row2 = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId('help:overview')
      .setLabel('Back to Overview')
      .setEmoji('🏠')
      .setStyle(ButtonStyle.Secondary),
  );

  return [row1, row2];
}

module.exports = {
  HELP_CATEGORIES,
  getHelpCategory,
  buildHelpOverviewEmbed,
  buildHelpOverviewComponents,
  buildHelpCategoryEmbed,
  buildHelpCategoryComponents,
};