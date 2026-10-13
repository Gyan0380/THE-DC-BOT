const {
  ActionRowBuilder, StringSelectMenuBuilder, ChannelSelectMenuBuilder, ChannelType,
  ButtonBuilder, ButtonStyle, ModalBuilder, TextInputBuilder, TextInputStyle,
  UserSelectMenuBuilder, EmbedBuilder, PermissionFlagsBits
} = require("discord.js");
const { getGuildSettings, patchGuildSettings } = require("./guild-settings");
const { getDb } = require("./db");
const { scheduleAction, cancelScheduledActions } = require("./persistent-timers");

const dashUrl = process.env.DASHBOARD_URL || "https://thedcbot.vercel.app/api/auth/discord";

function textInput(id, label, style = TextInputStyle.Short, required = true, value = "") {
  const input = new TextInputBuilder().setCustomId(id).setLabel(label).setStyle(style).setRequired(required);
  if (value) input.setValue(value);
  return input;
}
function has(interaction, permission) {
  return Boolean(interaction.memberPermissions?.has(permission));
}
async function dmMember(user, guild, moderator, action, reason, duration) {
  const extra = duration ? "\nDuration: " + duration : "";
  const actionLabel = action === "untimeout" ? "Timeout removed" : action === "timeout_expired" || action === "Timeout ended" ? "Timeout ended" : action === "auto_timeout" || action === "Automatic timeout" ? "Automatic timeout" : action.toUpperCase();
  const description = action === "untimeout" ? "Your timeout has been removed in **" + guild.name + "**."
    : action === "timeout_expired" || action === "Timeout ended" ? "Your timeout in **" + guild.name + "** has ended."
    : action === "auto_timeout" || action === "Automatic timeout" ? "The bot applied an automatic timeout in **" + guild.name + "** after detecting a possible rule violation."
    : action === "timeout" ? "You have been timed out in **" + guild.name + "**."
    : "A moderation action was applied to you in **" + guild.name + "**.";
  const embed = new EmbedBuilder()
    .setTitle("Moderation notice")
    .setDescription(description)
    .addFields(
      { name: "Action", value: actionLabel, inline: true },
      { name: "Moderator", value: moderator.tag || moderator.username, inline: true },
      { name: "Reason", value: (reason || "No reason provided").slice(0, 900) }
    )
    .setFooter({ text: "THE DC BOT" })
    .setTimestamp();
  if (extra) embed.addFields({ name: "Duration", value: duration, inline: true });
  try { await user.send({ embeds: [embed] }); return true; } catch { return false; }
}
async function logAction(guildId, entry) {
  await getDb().collection("modlogs").add({ guildId, ...entry, createdAt: new Date() });
}

async function openWelcomePanel(interaction) {
  if (!has(interaction, PermissionFlagsBits.ManageGuild)) {
    await interaction.reply({ content: "You need Manage Server permission.", ephemeral: true }); return;
  }
  const row = new ActionRowBuilder().addComponents(
    new StringSelectMenuBuilder().setCustomId("welcome:kind").setPlaceholder("Choose what to configure")
      .addOptions(
        { label: "Welcome messages", value: "welcome", description: "When a member joins" },
        { label: "Goodbye messages", value: "goodbye", description: "When a member leaves" }
      )
  );
  await interaction.reply({ content: "**Welcome & Goodbye Setup**\nChoose a section, then select its channel. The bot will save your choice to Firebase.", components: [row], ephemeral: true });
}

async function openPunishPanel(interaction) {
  if (!has(interaction, PermissionFlagsBits.ModerateMembers) && !has(interaction, PermissionFlagsBits.KickMembers) && !has(interaction, PermissionFlagsBits.BanMembers)) {
    await interaction.reply({ content: "You need a moderation permission to use this panel.", ephemeral: true }); return;
  }
  const row = new ActionRowBuilder().addComponents(
    new StringSelectMenuBuilder().setCustomId("punish:mode").setPlaceholder("Choose an action")
      .addOptions(
        { label: "Punish a member", value: "punish", description: "Timeout, kick, or ban with a reason" },
        { label: "Unpunish (remove timeout)", value: "unpunish", description: "Remove an active timeout" }
      )
  );
  await interaction.reply({ content: "**Moderation Control Panel**\nChoose Punish or Unpunish. Actions are logged and the affected member is sent a DM when Discord allows it.", components: [row], ephemeral: true });
}

async function handlePanelInteraction(interaction) {
  if (interaction.isButton() && interaction.customId.startsWith("welcome:edit:")) {
    const kind = interaction.customId.split(":")[2];
    const settings = await getGuildSettings(interaction.guildId);
    const current = settings[kind]?.message || (kind === "welcome" ? "Welcome {user} to {server}!" : "Goodbye {user}!");
    const modal = new ModalBuilder().setCustomId("welcome:message:" + kind).setTitle(kind === "welcome" ? "Edit Welcome Message" : "Edit Goodbye Message");
    modal.addComponents(new ActionRowBuilder().addComponents(textInput("message", "Message ({user}, {server})", TextInputStyle.Paragraph, true, current.slice(0, 900))));
    await interaction.showModal(modal);
    return true;
  }
  if (interaction.isButton() && interaction.customId.startsWith("welcome:disable:")) {
    const kind = interaction.customId.split(":")[2];
    const settings = await getGuildSettings(interaction.guildId);
    const old = settings[kind] || {};
    await patchGuildSettings(interaction.guildId, { [kind]: { ...old, enabled: false } });
    await interaction.update({ content: "**" + kind + "** messages are now disabled.", components: [] });
    return true;
  }
  if (interaction.isModalSubmit() && interaction.customId.startsWith("welcome:message:")) {
    const kind = interaction.customId.split(":")[2];
    const settings = await getGuildSettings(interaction.guildId);
    const old = settings[kind] || {};
    const message = interaction.fields.getTextInputValue("message").trim();
    await patchGuildSettings(interaction.guildId, { [kind]: { ...old, enabled: true, message } });
    await interaction.reply({ content: "Saved the " + kind + " message template.", ephemeral: true });
    return true;
  }
  if (interaction.isStringSelectMenu() && interaction.customId === "welcome:kind") {
    const kind = interaction.values[0];
    const row = new ActionRowBuilder().addComponents(
      new ChannelSelectMenuBuilder().setCustomId("welcome:channel:" + kind).setPlaceholder("Select a text channel")
        .setChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement)
    );
    const settings = await getGuildSettings(interaction.guildId);
    await interaction.update({ content: "Choose the channel for **" + kind + "** messages. Current channel: " + (settings[kind]?.channelId ? "<#" + settings[kind].channelId + ">" : "not set") + ".", components: [row] });
    return true;
  }

  if (interaction.isChannelSelectMenu() && interaction.customId.startsWith("welcome:channel:")) {
    const kind = interaction.customId.split(":")[2];
    const channelId = interaction.values[0];
    const settings = await getGuildSettings(interaction.guildId);
    const old = settings[kind] || {};
    const fallback = kind === "welcome" ? "Welcome {user} to {server}!" : "Goodbye {user}!";
    await patchGuildSettings(interaction.guildId, { [kind]: { ...old, enabled: true, channelId, message: old.message || fallback, dmOnAction: true } });
    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId("welcome:edit:" + kind).setLabel("Edit message").setStyle(ButtonStyle.Primary),
      new ButtonBuilder().setCustomId("welcome:disable:" + kind).setLabel("Disable").setStyle(ButtonStyle.Secondary)
    );
    await interaction.update({ content: "Saved **" + kind + "** channel as <#" + channelId + "> and enabled it. You can now edit the message or disable this section.", components: [row] });
    return true;
  }

  if (interaction.isStringSelectMenu() && interaction.customId === "punish:mode") {
    const mode = interaction.values[0];
    const modal = new ModalBuilder().setCustomId("punish:form:" + mode).setTitle(mode === "punish" ? "Punish Member" : "Remove Timeout");
    modal.addComponents(
      new ActionRowBuilder().addComponents(textInput("memberId", "Member ID (copy user ID)")),
      ...(mode === "punish" ? [new ActionRowBuilder().addComponents(textInput("action", "Action: timeout, kick, or ban"))] : []),
      ...(mode === "punish" ? [new ActionRowBuilder().addComponents(textInput("duration", "Timeout minutes (only for timeout)", TextInputStyle.Short, false, "10"))] : []),
      new ActionRowBuilder().addComponents(textInput("reason", "Reason for this action", TextInputStyle.Paragraph, true))
    );
    await interaction.showModal(modal);
    return true;
  }

  if (interaction.isModalSubmit() && interaction.customId.startsWith("punish:form:")) {
    const mode = interaction.customId.split(":")[2];
    const memberId = interaction.fields.getTextInputValue("memberId").trim();
    const reason = interaction.fields.getTextInputValue("reason").trim();
    if (!/^\d{17,20}$/.test(memberId)) {
      await interaction.reply({ content: "That does not look like a valid Discord user ID.", ephemeral: true }); return true;
    }
    const member = await interaction.guild.members.fetch(memberId).catch(() => null);
    if (!member) { await interaction.reply({ content: "Member not found in this server.", ephemeral: true }); return true; }
    let action = "untimeout", duration = null;
    if (mode === "punish") {
      action = interaction.fields.getTextInputValue("action").trim().toLowerCase();
      if (!["timeout", "kick", "ban"].includes(action)) {
        await interaction.reply({ content: "Action must be exactly timeout, kick, or ban.", ephemeral: true }); return true;
      }
      if (action === "timeout" && !has(interaction, PermissionFlagsBits.ModerateMembers)) {
        await interaction.reply({ content: "You need Moderate Members permission.", ephemeral: true }); return true;
      }
      if (action === "kick" && !has(interaction, PermissionFlagsBits.KickMembers)) {
        await interaction.reply({ content: "You need Kick Members permission.", ephemeral: true }); return true;
      }
      if (action === "ban" && !has(interaction, PermissionFlagsBits.BanMembers)) {
        await interaction.reply({ content: "You need Ban Members permission.", ephemeral: true }); return true;
      }
      if (!member.moderatable || member.id === interaction.user.id) {
        await interaction.reply({ content: "The bot cannot moderate this member. Check role hierarchy.", ephemeral: true }); return true;
      }
      if (action === "timeout") {
        const n = Number(interaction.fields.getTextInputValue("duration"));
        if (!Number.isInteger(n) || n < 1 || n > 40320) { await interaction.reply({ content: "Timeout duration must be 1–40320 minutes.", ephemeral: true }); return true; }
        duration = n + " minutes";
        const timerId = await scheduleAction({ guildId: interaction.guildId, userId: member.id, action: "timeout-expire", executeAt: new Date(Date.now() + n * 60000), moderatorId: interaction.user.id, reason });
        try { await member.timeout(n * 60000, reason); }
        catch (error) { await getDb().collection("scheduledActions").doc(timerId).update({ status: "cancelled", cancelledAt: new Date(), lastError: "Panel timeout application failed" }).catch(() => {}); throw error; }
      } else if (action === "kick") {
        await member.kick(reason);
      } else {
        await member.ban({ reason });
      }
    } else {
      if (!has(interaction, PermissionFlagsBits.ModerateMembers)) { await interaction.reply({ content: "You need Moderate Members permission.", ephemeral: true }); return true; }
      if (!member.moderatable) { await interaction.reply({ content: "The bot cannot edit this member due to role hierarchy.", ephemeral: true }); return true; }
      await member.timeout(null, reason || "Timeout removed by moderator");
      await cancelScheduledActions({ guildId: interaction.guildId, userId: member.id, action: "timeout-expire" });
    }
    const dmSent = await dmMember(member.user, interaction.guild, interaction.user, action, reason, duration);
    await logAction(interaction.guildId, {
      action, userId: member.id, username: member.user.tag, moderatorId: interaction.user.id,
      moderatorName: interaction.user.tag, reason, duration, dmSent, status: "completed"
    });
    await interaction.reply({ content: "**" + action.toUpperCase() + " completed** for " + member.user.tag + ".\nDM: " + (dmSent ? "sent" : "could not be delivered (DMs may be closed)") + ".", ephemeral: true });
    return true;
  }
  return false;
}

module.exports = { openWelcomePanel, openPunishPanel, handlePanelInteraction, dmMember, logAction, dashUrl };
