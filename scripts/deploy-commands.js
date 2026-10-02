require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { REST, Routes } = require('discord.js');

// The bot's commands live in the project root sibling of scripts/ — this
// file sits in scripts/, so step up one level to find them.
const COMMANDS_DIR = path.join(__dirname, '..', 'commands');

function loadCommandData(dir = COMMANDS_DIR, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) loadCommandData(fullPath, out);
    else if (entry.name.endsWith('.js')) {
      const command = require(fullPath);
      if (command?.data) out.push(command.data.toJSON());
    }
  }
  return out;
}

const commands = loadCommandData();
const rest = new REST().setToken(process.env.DISCORD_TOKEN);

(async () => {
  try {
    console.log(`Deploying ${commands.length} slash command(s)...`);

    const route = process.env.GUILD_ID
      ? Routes.applicationGuildCommands(process.env.CLIENT_ID, process.env.GUILD_ID)
      : Routes.applicationCommands(process.env.CLIENT_ID);

    await rest.put(route, { body: commands });

    console.log(
      process.env.GUILD_ID
        ? '✅ Deployed instantly to the test guild.'
        : '✅ Deployed globally (may take up to 1 hour to appear everywhere).'
    );
  } catch (err) {
    console.error('Failed to deploy commands:', err);
  }
})();
