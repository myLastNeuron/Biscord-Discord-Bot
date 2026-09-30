// Queries Discord's API directly (not the Discord client's cache) to show
// exactly what commands are registered right now, in each scope, with their
// IDs. Two entries with the same name but DIFFERENT ids means they really
// are two separate registrations (global + guild). If a scope only shows
// each name once, but Discord's UI still shows duplicates, that's just
// client-side cache and a client restart (or waiting for the global
// propagation delay) will fix it - not a deploy problem.

require('dotenv').config();
const { REST, Routes } = require('discord.js');

const rest = new REST().setToken(process.env.DISCORD_TOKEN);

(async () => {
  try {
    console.log('CLIENT_ID in use:', process.env.CLIENT_ID);
    console.log('GUILD_ID in use:', process.env.GUILD_ID || '(not set)');

    console.log('\n--- GLOBAL commands ---');
    const globalCmds = await rest.get(Routes.applicationCommands(process.env.CLIENT_ID));
    console.log(`(${globalCmds.length} total)`);
    for (const c of globalCmds) {
      console.log(`  /${c.name}   id=${c.id}`);
    }

    if (process.env.GUILD_ID) {
      console.log(`\n--- GUILD commands (guild ${process.env.GUILD_ID}) ---`);
      const guildCmds = await rest.get(
        Routes.applicationGuildCommands(process.env.CLIENT_ID, process.env.GUILD_ID)
      );
      console.log(`(${guildCmds.length} total)`);
      for (const c of guildCmds) {
        console.log(`  /${c.name}   id=${c.id}`);
      }
    } else {
      console.log('\n(No GUILD_ID set - skipping guild command check.)');
    }

    console.log('\nIf a name appears once in GLOBAL and once in GUILD (different ids),');
    console.log('that is a real duplicate registration - the global clear either');
    console.log('failed or has not propagated yet (can take up to ~1 hour).');
    console.log('If a name appears only once total here but Discord still shows it');
    console.log('twice in the UI, that is just the client cache - fully restart Discord.');
  } catch (err) {
    console.error('Failed to fetch commands:', err);
  }
})();
