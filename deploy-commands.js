require('dotenv').config();
const { REST, Routes } = require('discord.js');
const fs   = require('fs');
const path = require('path');

const REQUIRED = ['DISCORD_TOKEN', 'CLIENT_ID'];
for (const key of REQUIRED) {
  if (!process.env[key]) {
    console.error(`[FATAL] Missing env var: ${key}`);
    process.exit(1);
  }
}

const commands = [];
const commandsPath = path.join(__dirname, 'commands');
const commandFiles = fs.readdirSync(commandsPath).filter(f => f.endsWith('.js'));

for (const file of commandFiles) {
  const command = require(path.join(commandsPath, file));
  if (command.data) {
    commands.push(command.data.toJSON());
    console.log(`[Deploy] Queued: /${command.data.name}`);
  }
}

const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_TOKEN);

(async () => {
  try {
    console.log(`\n[Deploy] Registering ${commands.length} slash command(s)...`);

    if (process.env.GUILD_ID) {
      await rest.put(
        Routes.applicationGuildCommands(process.env.CLIENT_ID, process.env.GUILD_ID),
        { body: commands }
      );
      console.log(`[Deploy] ✅ Commands registered to guild ${process.env.GUILD_ID} (instant)`);
    } else {
      await rest.put(
        Routes.applicationCommands(process.env.CLIENT_ID),
        { body: commands }
      );
      console.log('[Deploy] ✅ Commands registered globally (may take up to 1 hour to propagate)');
    }
  } catch (err) {
    console.error('[Deploy] ❌ Error:', err);
  }
})();
