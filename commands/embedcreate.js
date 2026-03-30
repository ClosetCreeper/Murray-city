/**
 * /embedcreate — Interactive embed builder
 *
 * Flow:
 *   1. User runs /embedcreate #channel
 *   2. Bot replies (ephemeral) with a live preview embed + a "Edit…" dropdown + Send button
 *   3. User picks a field from the dropdown → bot opens a Modal for that field
 *   4. User submits modal → bot updates the preview
 *   5. User hits Send → bot posts the finished embed to the target channel
 *
 * State is kept in-memory per session (keyed by authorId:channelId).
 * Sessions expire after 30 minutes of inactivity.
 */

const {
  SlashCommandBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  StringSelectMenuBuilder,
  EmbedBuilder,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  PermissionFlagsBits,
} = require('discord.js');

// ── In-memory session store ────────────────────────────────────────────────────
// key: `${userId}:${interactionId}` → { channelId, data, previewMessageId, timeout }
const sessions = new Map();
const SESSION_TTL_MS = 30 * 60 * 1000; // 30 min

function makeSessionKey(userId, sessionId) {
  return `${userId}:${sessionId}`;
}

function touchSession(key, session) {
  clearTimeout(session.timeout);
  session.timeout = setTimeout(() => sessions.delete(key), SESSION_TTL_MS);
}

// ── Helpers ────────────────────────────────────────────────────────────────────

/** Parse a hex color string like #FF0000 or FF0000 → integer, or null */
function parseColor(raw) {
  if (!raw) return null;
  const cleaned = raw.replace(/^#/, '').trim();
  if (!/^[0-9a-fA-F]{6}$/.test(cleaned)) return null;
  return parseInt(cleaned, 16);
}

/** Build a live-preview EmbedBuilder from session data */
function buildPreviewEmbed(data) {
  const embed = new EmbedBuilder();

  if (data.color) embed.setColor(data.color);
  else embed.setColor(0x5865f2); // default Discord blurple

  if (data.title)       embed.setTitle(data.title);
  if (data.description) embed.setDescription(data.description);
  if (data.footer)      embed.setFooter({ text: data.footer });
  if (data.imageUrl)    embed.setImage(data.imageUrl);
  if (data.thumbnailUrl) embed.setThumbnail(data.thumbnailUrl);
  if (data.authorName)  embed.setAuthor({ name: data.authorName, iconURL: data.authorIcon || undefined });
  if (data.timestamp)   embed.setTimestamp();

  // Show a placeholder if totally empty
  if (!data.title && !data.description) {
    embed.setDescription('*No content yet — use the dropdown below to build your embed!*');
  }

  return embed;
}

/** Build the dropdown select menu */
function buildDropdown(sessionId) {
  return new ActionRowBuilder().addComponents(
    new StringSelectMenuBuilder()
      .setCustomId(`embedcreate_field:${sessionId}`)
      .setPlaceholder('✏️  Edit a field…')
      .addOptions([
        { label: 'Title',        value: 'title',       description: 'The bold title at the top',        emoji: '🔤' },
        { label: 'Description',  value: 'description', description: 'The main body text',               emoji: '📝' },
        { label: 'Color',        value: 'color',       description: 'Sidebar color (hex, e.g. #FF0000)', emoji: '🎨' },
        { label: 'Footer',       value: 'footer',      description: 'Small text at the bottom',         emoji: '🔖' },
        { label: 'Image URL',    value: 'imageUrl',    description: 'Large image shown at the bottom',  emoji: '🖼️' },
        { label: 'Thumbnail URL',value: 'thumbnailUrl',description: 'Small image shown top-right',      emoji: '🖼️' },
        { label: 'Author Name',  value: 'authorName',  description: 'Author name above the title',      emoji: '👤' },
        { label: 'Author Icon URL', value: 'authorIcon', description: 'Icon shown next to author name', emoji: '🔗' },
        { label: 'Timestamp',    value: 'timestamp',   description: 'Toggle current timestamp on/off',  emoji: '🕐' },
      ])
  );
}

/** Build the Send / Clear buttons */
function buildButtons(sessionId) {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`embedcreate_send:${sessionId}`)
      .setLabel('📤 Send Embed')
      .setStyle(ButtonStyle.Success),
    new ButtonBuilder()
      .setCustomId(`embedcreate_clear:${sessionId}`)
      .setLabel('🗑️ Clear All')
      .setStyle(ButtonStyle.Danger),
  );
}

// ── Modal definitions per field ────────────────────────────────────────────────
function buildModal(field, sessionId, currentValue) {
  const modal = new ModalBuilder()
    .setCustomId(`embedcreate_modal:${field}:${sessionId}`)
    .setTitle(fieldLabel(field));

  let input;

  if (field === 'description') {
    input = new TextInputBuilder()
      .setCustomId('value')
      .setLabel('Description (supports markdown)')
      .setStyle(TextInputStyle.Paragraph)
      .setRequired(false)
      .setMaxLength(4096)
      .setValue(currentValue || '');
  } else if (field === 'color') {
    input = new TextInputBuilder()
      .setCustomId('value')
      .setLabel('Hex color (e.g. #FF0000 or FF0000)')
      .setStyle(TextInputStyle.Short)
      .setRequired(false)
      .setMaxLength(7)
      .setValue(currentValue ? `#${currentValue.toString(16).padStart(6, '0').toUpperCase()}` : '');
  } else if (field === 'timestamp') {
    input = new TextInputBuilder()
      .setCustomId('value')
      .setLabel('Enable timestamp? (yes / no)')
      .setStyle(TextInputStyle.Short)
      .setRequired(false)
      .setMaxLength(3)
      .setValue(currentValue ? 'yes' : 'no');
  } else {
    input = new TextInputBuilder()
      .setCustomId('value')
      .setLabel(fieldLabel(field))
      .setStyle(TextInputStyle.Short)
      .setRequired(false)
      .setMaxLength(256)
      .setValue(currentValue || '');
  }

  modal.addComponents(new ActionRowBuilder().addComponents(input));
  return modal;
}

function fieldLabel(field) {
  const map = {
    title:       'Embed Title',
    description: 'Embed Description',
    color:       'Embed Color',
    footer:      'Footer Text',
    imageUrl:    'Image URL',
    thumbnailUrl:'Thumbnail URL',
    authorName:  'Author Name',
    authorIcon:  'Author Icon URL',
    timestamp:   'Timestamp',
  };
  return map[field] || field;
}

// ── Command definition ─────────────────────────────────────────────────────────
module.exports = {
  data: new SlashCommandBuilder()
    .setName('embedcreate')
    .setDescription('Interactively build and send a custom embed')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageMessages)
    .addChannelOption(opt =>
      opt.setName('channel')
        .setDescription('The channel to send the finished embed to')
        .setRequired(true)
    ),

  // ── /embedcreate ─────────────────────────────────────────────────────────────
  async execute(interaction) {
    const targetChannel = interaction.options.getChannel('channel');
    const sessionId     = interaction.id; // unique per invocation
    const key           = makeSessionKey(interaction.user.id, sessionId);

    // Create session
    const session = {
      channelId: targetChannel.id,
      data: {},
      previewMessageId: null,
      timeout: null,
    };
    sessions.set(key, session);
    touchSession(key, session);

    const previewEmbed = buildPreviewEmbed(session.data);
    const infoEmbed = new EmbedBuilder()
      .setColor(0x5865f2)
      .setDescription(`**Embed Builder** — sending to ${targetChannel}\n\nUse the dropdown to edit fields, then hit **📤 Send Embed** when you're happy!`);

    const reply = await interaction.reply({
      embeds: [infoEmbed, previewEmbed],
      components: [buildDropdown(sessionId), buildButtons(sessionId)],
      ephemeral: true,
      fetchReply: true,
    });

    session.previewMessageId = reply.id;
  },

  // ── Select menu → open the right modal ───────────────────────────────────────
  async handleSelect(interaction) {
    if (!interaction.customId.startsWith('embedcreate_field:')) return false;

    const sessionId = interaction.customId.split(':')[1];
    const key       = makeSessionKey(interaction.user.id, sessionId);
    const session   = sessions.get(key);

    if (!session) {
      await interaction.reply({ content: '⏰ This embed session has expired. Run `/embedcreate` again.', ephemeral: true });
      return true;
    }

    touchSession(key, session);

    const field = interaction.values[0];
    const currentValue = session.data[field];
    const modal = buildModal(field, sessionId, currentValue);

    await interaction.showModal(modal);
    return true;
  },

  // ── Modal submit → update preview ────────────────────────────────────────────
  async handleModal(interaction) {
    if (!interaction.customId.startsWith('embedcreate_modal:')) return false;

    const [, field, sessionId] = interaction.customId.split(':');
    const key     = makeSessionKey(interaction.user.id, sessionId);
    const session = sessions.get(key);

    if (!session) {
      await interaction.reply({ content: '⏰ This embed session has expired. Run `/embedcreate` again.', ephemeral: true });
      return true;
    }

    touchSession(key, session);

    const raw = interaction.fields.getTextInputValue('value').trim();

    if (field === 'color') {
      const parsed = parseColor(raw);
      if (raw && parsed === null) {
        await interaction.reply({
          content: '❌ Invalid hex color. Use a format like `#FF0000` or `FF0000`.',
          ephemeral: true,
        });
        return true;
      }
      session.data.color = parsed; // null = cleared
    } else if (field === 'timestamp') {
      session.data.timestamp = raw.toLowerCase().startsWith('y');
    } else {
      // Store empty string as undefined (clears the field)
      session.data[field] = raw || undefined;
    }

    const infoEmbed = new EmbedBuilder()
      .setColor(0x5865f2)
      .setDescription(`**Embed Builder** — sending to <#${session.channelId}>\n\nUse the dropdown to edit fields, then hit **📤 Send Embed** when you're happy!`);

    await interaction.update({
      embeds: [infoEmbed, buildPreviewEmbed(session.data)],
      components: [buildDropdown(sessionId), buildButtons(sessionId)],
    });

    return true;
  },

  // ── Buttons: Send or Clear ────────────────────────────────────────────────────
  async handleButton(interaction) {
    if (
      !interaction.customId.startsWith('embedcreate_send:') &&
      !interaction.customId.startsWith('embedcreate_clear:')
    ) return false;

    const [action, sessionId] = interaction.customId.split(':');
    const key     = makeSessionKey(interaction.user.id, sessionId);
    const session = sessions.get(key);

    if (!session) {
      await interaction.update({
        content: '⏰ This embed session has expired. Run `/embedcreate` again.',
        embeds: [],
        components: [],
      });
      return true;
    }

    touchSession(key, session);

    // ── CLEAR ──────────────────────────────────────────────────────────────────
    if (action === 'embedcreate_clear') {
      session.data = {};

      const infoEmbed = new EmbedBuilder()
        .setColor(0x5865f2)
        .setDescription(`**Embed Builder** — sending to <#${session.channelId}>\n\nAll fields cleared. Start fresh!`);

      await interaction.update({
        embeds: [infoEmbed, buildPreviewEmbed(session.data)],
        components: [buildDropdown(sessionId), buildButtons(sessionId)],
      });
      return true;
    }

    // ── SEND ───────────────────────────────────────────────────────────────────
    if (action === 'embedcreate_send') {
      const { data } = session;

      if (!data.title && !data.description) {
        await interaction.reply({
          content: '❌ Your embed needs at least a **title** or **description** before it can be sent.',
          ephemeral: true,
        });
        return true;
      }

      const targetChannel = await interaction.client.channels.fetch(session.channelId).catch(() => null);
      if (!targetChannel) {
        await interaction.reply({
          content: '❌ Could not find the target channel. It may have been deleted.',
          ephemeral: true,
        });
        return true;
      }

      try {
        await targetChannel.send({ embeds: [buildPreviewEmbed(data)] });
      } catch (err) {
        console.error('[EmbedCreate] Failed to send embed:', err);
        await interaction.reply({
          content: `❌ Failed to send the embed. Make sure I have permission to send messages in ${targetChannel}.`,
          ephemeral: true,
        });
        return true;
      }

      // Clean up session
      clearTimeout(session.timeout);
      sessions.delete(key);

      await interaction.update({
        embeds: [
          new EmbedBuilder()
            .setColor(0x57f287)
            .setDescription(`✅ **Embed sent successfully** to <#${session.channelId}>!`),
        ],
        components: [],
      });
      return true;
    }

    return false;
  },
};
