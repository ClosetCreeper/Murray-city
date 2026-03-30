require('dotenv').config();
const { Client, GatewayIntentBits, Collection } = require('discord.js');
const fs   = require('fs');
const path = require('path');

const REQUIRED = ['DISCORD_TOKEN', 'CLIENT_ID'];
for (const key of REQUIRED) {
  if (!process.env[key]) {
    console.error(`[FATAL] Missing env var: ${key}`);
    process.exit(1);
  }
}

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildMessages,
  ],
});

// ── Load commands ─────────────────────────────────────────────────────────────
client.commands = new Collection();
const commandsPath = path.join(__dirname, 'commands');
for (const file of fs.readdirSync(commandsPath).filter(f => f.endsWith('.js'))) {
  const cmd = require(path.join(commandsPath, file));
  if (cmd.data) {
    client.commands.set(cmd.data.name, cmd);
    console.log(`[Bot] Loaded command: /${cmd.data.name}`);
  }
}

// ── Ready ─────────────────────────────────────────────────────────────────────
client.once('ready', () => {
  console.log(`[Bot] ✅ Logged in as ${client.user.tag}`);
});

// ── Slash commands ────────────────────────────────────────────────────────────
client.on('interactionCreate', async interaction => {
  if (interaction.isChatInputCommand()) {
    const cmd = client.commands.get(interaction.commandName);
    if (!cmd) return;
    try {
      await cmd.execute(interaction);
    } catch (err) {
      console.error(`[Bot] Error in /${interaction.commandName}:`, err);
      const reply = { content: '❌ An error occurred while running this command.', ephemeral: true };
      if (interaction.replied || interaction.deferred) {
        await interaction.followUp(reply).catch(() => {});
      } else {
        await interaction.reply(reply).catch(() => {});
      }
    }
    return;
  }

  // ── Buttons ─────────────────────────────────────────────────────────────────
  if (interaction.isButton()) {
    for (const cmd of client.commands.values()) {
      if (typeof cmd.handleButton === 'function') {
        const handled = await cmd.handleButton(interaction).catch(err => {
          console.error('[Bot] Button handler error:', err);
          return false;
        });
        if (handled) return;
      }
    }
    return;
  }

  // ── Select Menus ─────────────────────────────────────────────────────────────
  if (interaction.isStringSelectMenu()) {
    for (const cmd of client.commands.values()) {
      if (typeof cmd.handleSelect === 'function') {
        const handled = await cmd.handleSelect(interaction).catch(err => {
          console.error('[Bot] Select handler error:', err);
          return false;
        });
        if (handled) return;
      }
    }
    return;
  }

  // ── Modals ────────────────────────────────────────────────────────────────────
  if (interaction.isModalSubmit()) {
    for (const cmd of client.commands.values()) {
      if (typeof cmd.handleModal === 'function') {
        const handled = await cmd.handleModal(interaction).catch(err => {
          console.error('[Bot] Modal handler error:', err);
          return false;
        });
        if (handled) return;
      }
    }
    return;
  }
});

client.login(process.env.DISCORD_TOKEN);
