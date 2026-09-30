require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { REST, Routes } = require('discord.js');

// The bot's commands live in the project root sibling of scripts/ — this
// file sits in scripts/, so step up one level to find them.
const COMMANDS_DIR = path.join(__dirname, '..', 'commands');

function loadCommandData(dir = COMMANDS_DIR, out = [], failures = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) loadCommandData(fullPath, out, failures);
    else if (entry.name.endsWith('.js')) {
      try {
        const command = require(fullPath);
        if (command?.data) out.push(command.data.toJSON());
      } catch (err) {
        // Don't let one broken command crash the whole run silently — collect
        // it and report below so the real cause (often a builder misuse) shows.
        failures.push({ file: path.relative(COMMANDS_DIR, fullPath), message: err.message });
      }
    }
  }
  return out;
}

const loadFailures = [];
const commands = loadCommandData(COMMANDS_DIR, [], loadFailures);

if (loadFailures.length) {
  console.error(`✗ ${loadFailures.length} command file(s) failed to load:`);
  for (const f of loadFailures) console.error(`  - ${f.file}: ${f.message}`);
  process.exit(1);
}

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
    // Loading command files pulls in runtime modules that hold live handles
    // (voice/music/keep-alive), which would otherwise leave this CLI hanging
    // after the deploy finishes. Exit explicitly now that the work is done.
    process.exit(0);
  } catch (err) {
    console.error('Failed to deploy commands:', err);
    process.exit(1);
  }
})();
