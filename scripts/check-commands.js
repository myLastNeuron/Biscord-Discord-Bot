// Run this to WIPE registered slash commands for a given scope, then
// redeploy with your normal deploy-commands.js afterwards.
//
// Usage:
//   node scripts/clear-commands.js global   -> deletes all GLOBAL commands
//   node scripts/clear-commands.js guild    -> deletes all GUILD commands (uses GUILD_ID from .env)
//   node scripts/clear-commands.js both     -> deletes both
//
// This is why you're seeing doubled commands: at some point commands were
// deployed globally (no GUILD_ID set) AND separately deployed to your guild
// (GUILD_ID set). Discord treats these as two totally separate command sets -
// it doesn't dedupe by name - so both show up in the server at once.

require('dotenv').config();
const { REST, Routes } = require('discord.js');

const rest = new REST().setToken(process.env.DISCORD_TOKEN);
const scope = process.argv[2];

if (!['global', 'guild', 'both'].includes(scope)) {
  console.error('Usage: node scripts/clear-commands.js <global|guild|both>');
  process.exit(1);
}

(async () => {
  try {
    if (scope === 'global' || scope === 'both') {
      console.log('Clearing GLOBAL commands...');
      await rest.put(Routes.applicationCommands(process.env.CLIENT_ID), { body: [] });
      console.log('✅ Global commands cleared. (May take up to an hour to disappear everywhere.)');
    }

    if (scope === 'guild' || scope === 'both') {
      if (!process.env.GUILD_ID) {
        console.error('GUILD_ID is not set in .env - cannot clear guild commands.');
      } else {
        console.log(`Clearing GUILD commands for guild ${process.env.GUILD_ID}...`);
        await rest.put(
          Routes.applicationGuildCommands(process.env.CLIENT_ID, process.env.GUILD_ID),
          { body: [] }
        );
        console.log('✅ Guild commands cleared instantly.');
      }
    }

    console.log('\nNow run your normal deploy script (npm run deploy) to re-register');
    console.log('commands for whichever ONE scope you actually want to use.');
  } catch (err) {
    console.error('Failed to clear commands:', err);
  }
})();
