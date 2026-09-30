// One-off cleanup: wipes ALL guild-specific slash commands for GUILD_ID,
// leaving only the globally-registered ones in place. Run this once, then
// delete this file (or leave it - it's harmless to keep, just rerun if
// duplicates ever show up again).
//
// Usage:
//   1. Make sure GUILD_ID is set in .env to the server showing duplicates.
//   2. node clear-guild-commands.js
//   3. Fully quit and reopen Discord (not just Ctrl+R) so it drops its
//      cached command list.

require('dotenv').config();
const { REST, Routes } = require('discord.js');

if (!process.env.GUILD_ID) {
  console.error('GUILD_ID is not set in .env - set it to the server ID showing duplicates first.');
  process.exit(1);
}

const rest = new REST().setToken(process.env.DISCORD_TOKEN);

(async () => {
  try {
    console.log(`Clearing guild commands for guild ${process.env.GUILD_ID}...`);
    await rest.put(
      Routes.applicationGuildCommands(process.env.CLIENT_ID, process.env.GUILD_ID),
      { body: [] },
    );
    console.log('✅ Guild commands cleared. Only global commands remain now.');
    console.log('Fully quit and reopen your Discord client to clear its local cache.');
  } catch (err) {
    console.error('Failed to clear guild commands:', err);
  }
})();
