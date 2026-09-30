// Handler registry — imports all feature handlers
// Each handler exports: { match(interaction), async execute(interaction) }

const roster = require('./roster');
const ticket = require('./ticket');
const giveaway = require('./giveaway');
const poll = require('./poll');
const roleRequest = require('./roleRequest');
const reactionApproval = require('./reactionApproval');
const invites = require('./invites');
const warnings = require('./warnings');
const autoPost = require('./autoPost');
const eventCreate = require('./eventCreate');
const upcomingBoard = require('./upcomingBoard');
const botConfig = require('./botConfig');
const autoReact = require('./autoReact');
const stats = require('./stats');
const moderation = require('./moderation');
const misc = require('./misc');

// Order matters: more specific prefixes first, then general ones
const handlers = [
  roster,
  ticket,
  giveaway,
  poll,
  roleRequest,
  reactionApproval,
  invites,
  warnings,
  autoPost,
  eventCreate,
  upcomingBoard,
  botConfig,
  autoReact,
  stats,
  moderation,
  misc,
];

module.exports = handlers;