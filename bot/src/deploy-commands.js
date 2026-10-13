require("dotenv").config();
const { REST, Routes, SlashCommandBuilder, PermissionFlagsBits } = require("discord.js");

const commands = [
  new SlashCommandBuilder().setName("rules").setDescription("Show server rules"),
  new SlashCommandBuilder().setName("ai-setup").setDescription("Securely configure this server’s Gemini or DeepSeek API key")
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addStringOption(o => o.setName("provider").setDescription("AI provider").setRequired(true).addChoices({ name: "Google Gemini", value: "gemini" }, { name: "DeepSeek", value: "deepseek" })),
  new SlashCommandBuilder().setName("diagnose").setDescription("Check AI key, provider authentication and bot setup")
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild),
  new SlashCommandBuilder().setName("rules-set").setDescription("Set server rules, one per line")
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addStringOption(o => o.setName("rules").setDescription("Write each rule on a new line, including explicit actions/durations").setRequired(true).setMaxLength(4000)),
  new SlashCommandBuilder().setName("welcome-config").setDescription("Open the Welcome & Goodbye setup panel")
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild),
  new SlashCommandBuilder().setName("punish").setDescription("Open the moderation control panel")
    .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers),
  new SlashCommandBuilder().setName("dashboard").setDescription("Get the THE DC BOT web dashboard link"),
  new SlashCommandBuilder().setName("clear").setDescription("Delete recent messages from this channel")
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageMessages)
    .addIntegerOption(o => o.setName("amount").setDescription("Number of messages (1-100)").setRequired(true).setMinValue(1).setMaxValue(100)),
  new SlashCommandBuilder().setName("modlogs").setDescription("Show recent moderation logs")
    .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers),
  new SlashCommandBuilder().setName("timeout").setDescription("Timeout a member")
    .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers)
    .addUserOption(o => o.setName("user").setDescription("Member to timeout").setRequired(true))
    .addIntegerOption(o => o.setName("minutes").setDescription("Timeout duration in minutes (1-40320)").setRequired(true).setMinValue(1).setMaxValue(40320))
    .addStringOption(o => o.setName("reason").setDescription("Reason for timeout").setMaxLength(500)),
  new SlashCommandBuilder().setName("untimeout").setDescription("Remove a member timeout")
    .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers)
    .addUserOption(o => o.setName("user").setDescription("Member to untimeout").setRequired(true))
    .addStringOption(o => o.setName("reason").setDescription("Reason for removing timeout").setMaxLength(500)),
  new SlashCommandBuilder().setName("kick").setDescription("Kick a member")
    .setDefaultMemberPermissions(PermissionFlagsBits.KickMembers)
    .addUserOption(o => o.setName("user").setDescription("Member to kick").setRequired(true))
    .addStringOption(o => o.setName("reason").setDescription("Reason for kick").setMaxLength(500)),
  new SlashCommandBuilder().setName("ban").setDescription("Ban a member, optionally for a fixed duration")
    .setDefaultMemberPermissions(PermissionFlagsBits.BanMembers)
    .addUserOption(o => o.setName("user").setDescription("Member to ban").setRequired(true))
    .addStringOption(o => o.setName("reason").setDescription("Reason for ban").setMaxLength(500))
    .addIntegerOption(o => o.setName("duration_hours").setDescription("Optional temporary ban duration in hours (1-8760); omit for permanent").setMinValue(1).setMaxValue(8760))
];

async function registerCommands() {
  const { DISCORD_TOKEN, DISCORD_CLIENT_ID } = process.env;
  if (!DISCORD_TOKEN || !DISCORD_CLIENT_ID) throw new Error("Set DISCORD_TOKEN and DISCORD_CLIENT_ID");
  const rest = new REST({ version: "10" }).setToken(DISCORD_TOKEN);
  const body = commands.map(c => c.toJSON());
  await rest.put(Routes.applicationCommands(DISCORD_CLIENT_ID), { body });
  console.log("Registered " + commands.length + " GLOBAL slash commands. Discord global propagation can take some time.");
}
if (require.main === module) registerCommands().catch(error => { console.error("Slash-command registration failed:", error.message); process.exitCode = 1; });
module.exports = { commands, registerCommands };
