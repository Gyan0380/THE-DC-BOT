require("dotenv").config();
const { REST, Routes, SlashCommandBuilder, PermissionFlagsBits, ChannelType } = require("discord.js");

const commands = [
  new SlashCommandBuilder().setName("rules").setDescription("Show server rules"),
  new SlashCommandBuilder().setName("rules-set").setDescription("Set server rules, one per line")
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addStringOption(o => o.setName("rules").setDescription("Write each rule on a new line").setRequired(true).setMaxLength(4000)),
  new SlashCommandBuilder().setName("welcome-setup").setDescription("Set the welcome channel and message")
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addChannelOption(o => o.setName("channel").setDescription("Channel for new-member messages").setRequired(true).addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement))
    .addStringOption(o => o.setName("message").setDescription("Use {user} and {server}").setMaxLength(1900)),
  new SlashCommandBuilder().setName("goodbye-setup").setDescription("Set the goodbye channel and message")
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addChannelOption(o => o.setName("channel").setDescription("Channel for member-leave messages").setRequired(true).addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement))
    .addStringOption(o => o.setName("message").setDescription("Use {user} and {server}").setMaxLength(1900)),
  new SlashCommandBuilder().setName("timeout").setDescription("Timeout a member")
    .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers)
    .addUserOption(o => o.setName("user").setDescription("Member to timeout").setRequired(true))
    .addIntegerOption(o => o.setName("minutes").setDescription("Duration in minutes (1-40320)").setRequired(true).setMinValue(1).setMaxValue(40320))
    .addStringOption(o => o.setName("reason").setDescription("Reason for timeout").setMaxLength(500)),
  new SlashCommandBuilder().setName("untimeout").setDescription("Remove a member timeout")
    .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers)
    .addUserOption(o => o.setName("user").setDescription("Member to untimeout").setRequired(true))
    .addStringOption(o => o.setName("reason").setDescription("Reason").setMaxLength(500)),
  new SlashCommandBuilder().setName("kick").setDescription("Kick a member")
    .setDefaultMemberPermissions(PermissionFlagsBits.KickMembers)
    .addUserOption(o => o.setName("user").setDescription("Member to kick").setRequired(true))
    .addStringOption(o => o.setName("reason").setDescription("Reason").setMaxLength(500)),
  new SlashCommandBuilder().setName("ban").setDescription("Ban a member")
    .setDefaultMemberPermissions(PermissionFlagsBits.BanMembers)
    .addUserOption(o => o.setName("user").setDescription("Member to ban").setRequired(true))
    .addStringOption(o => o.setName("reason").setDescription("Reason").setMaxLength(500)),
  new SlashCommandBuilder().setName("clear").setDescription("Delete recent messages from this channel")
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageMessages)
    .addIntegerOption(o => o.setName("amount").setDescription("Number of messages (1-100)").setRequired(true).setMinValue(1).setMaxValue(100)),
  new SlashCommandBuilder().setName("modlogs").setDescription("Show recent moderation logs")
    .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers)
];

async function main() {
  const { DISCORD_TOKEN, DISCORD_CLIENT_ID, DISCORD_GUILD_ID } = process.env;
  if (!DISCORD_TOKEN || !DISCORD_CLIENT_ID || !DISCORD_GUILD_ID) throw new Error("Set DISCORD_TOKEN, DISCORD_CLIENT_ID, and DISCORD_GUILD_ID");
  const rest = new REST({ version: "10" }).setToken(DISCORD_TOKEN);
  await rest.put(Routes.applicationGuildCommands(DISCORD_CLIENT_ID, DISCORD_GUILD_ID), { body: commands.map(c => c.toJSON()) });
  console.log("Registered " + commands.length + " guild slash commands.");
}
main().catch(error => { console.error(error); process.exitCode = 1; });
