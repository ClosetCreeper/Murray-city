const {
  SlashCommandBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
} = require('discord.js');

const ROLE_REQUEST_CHANNEL_ID = '1487992443852034252';

module.exports = {
  data: new SlashCommandBuilder()
    .setName('rolerequest')
    .setDescription('Request a role from staff')
    .addRoleOption(opt =>
      opt.setName('role')
        .setDescription('The role you are requesting')
        .setRequired(true)
    )
    .addStringOption(opt =>
      opt.setName('reason')
        .setDescription('Why are you requesting this role?')
        .setRequired(true)
        .setMaxLength(500)
    ),

  async execute(interaction) {
    const role   = interaction.options.getRole('role');
    const reason = interaction.options.getString('reason');

    await interaction.reply({
      content: `✅ **Role request received!** Your request for ${role} has been sent to staff for review.`,
      ephemeral: true,
    });

    const requestChannel = await interaction.client.channels.fetch(ROLE_REQUEST_CHANNEL_ID).catch(() => null);
    if (!requestChannel) {
      console.error(`[RoleRequest] Could not find channel: ${ROLE_REQUEST_CHANNEL_ID}`);
      return;
    }

    const embed = new EmbedBuilder()
      .setTitle('📋 NEW ROLE REQUEST')
      .setDescription(
        `${interaction.user} has requested the ${role} role. The reason they provided was: ${reason}. Please accept or decline this request below.`
      )
      .setColor(0x5865f2)
      .addFields(
        { name: 'User',   value: `${interaction.user} (${interaction.user.tag})`, inline: true },
        { name: 'Role',   value: `${role}`,                                        inline: true },
        { name: 'Reason', value: reason,                                           inline: false },
      )
      .setTimestamp();

    const acceptBtn = new ButtonBuilder()
      .setCustomId(`rolereq_accept:${interaction.user.id}:${role.id}`)
      .setLabel('✅ Accept')
      .setStyle(ButtonStyle.Success);

    const denyBtn = new ButtonBuilder()
      .setCustomId(`rolereq_deny:${interaction.user.id}:${role.id}`)
      .setLabel('❌ Deny')
      .setStyle(ButtonStyle.Danger);

    const row = new ActionRowBuilder().addComponents(acceptBtn, denyBtn);

    await requestChannel.send({ embeds: [embed], components: [row] });
  },

  async handleButton(interaction) {
    if (
      !interaction.customId.startsWith('rolereq_accept:') &&
      !interaction.customId.startsWith('rolereq_deny:')
    ) return false;

    const [action, userId, roleId] = interaction.customId.split(':');
    const guild  = interaction.guild;
    const member = await guild.members.fetch(userId).catch(() => null);

    if (!member) {
      await interaction.update({
        content: '❌ Could not find that user in the server. They may have left.',
        embeds: [],
        components: [],
      });
      return true;
    }

    if (action === 'rolereq_accept') {
      const role = guild.roles.cache.get(roleId);
      if (!role) {
        await interaction.update({
          content: '❌ That role no longer exists.',
          embeds: [],
          components: [],
        });
        return true;
      }

      try {
        await member.roles.add(role);
      } catch (err) {
        console.error('[RoleRequest] Failed to assign role:', err);
        await interaction.update({
          content: `❌ Failed to assign the role. Make sure my role is above **${role.name}** in the role hierarchy.`,
          embeds: [],
          components: [],
        });
        return true;
      }

      await member.send(
        `✅ **Role Request Approved!**\nYour request for the **${role.name}** role has been approved. The role has been added to your account!`
      ).catch(() => {
        console.warn(`[RoleRequest] Could not DM user ${userId} — they may have DMs disabled.`);
      });

      await interaction.update({
        embeds: [
          EmbedBuilder.from(interaction.message.embeds[0])
            .setColor(0x57f287)
            .setFooter({ text: `✅ Approved by ${interaction.user.tag}` }),
        ],
        components: [],
      });

    } else if (action === 'rolereq_deny') {
      const role = guild.roles.cache.get(roleId);
      const roleName = role ? role.name : 'the requested role';

      await member.send(
        `❌ **Role Request Denied.**\nYour request for the **${roleName}** role has been denied by staff.`
      ).catch(() => {
        console.warn(`[RoleRequest] Could not DM user ${userId} — they may have DMs disabled.`);
      });

      await interaction.update({
        embeds: [
          EmbedBuilder.from(interaction.message.embeds[0])
            .setColor(0xed4245)
            .setFooter({ text: `❌ Denied by ${interaction.user.tag}` }),
        ],
        components: [],
      });
    }

    return true;
  },
};
