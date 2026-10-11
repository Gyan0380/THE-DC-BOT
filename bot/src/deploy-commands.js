require("dotenv").config();
const { REST, Routes, SlashCommandBuilder, PermissionFlagsBits, ChannelType } = require("discord.js");

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
    .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers)
];

async function registerCommands() {
  const { DISCORD_TOKEN, DISCORD_CLIENT_ID, DISCORD_GUILD_ID } = process.env;
  if (!DISCORD_TOKEN || !DISCORD_CLIENT_ID || !DISCORD_GUILD_ID) throw new Error("Set DISCORD_TOKEN, DISCORD_CLIENT_ID, and DISCORD_GUILD_ID");
  const rest = new REST({ version: "10" }).setToken(DISCORD_TOKEN);
  await rest.put(Routes.applicationGuildCommands(DISCORD_CLIENT_ID, DISCORD_GUILD_ID), { body: commands.map(c => c.toJSON()) });
  console.log("Registered " + commands.length + " guild slash commands.");
}
if (require.main === module) registerCommands().catch(error => { console.error(error); process.exitCode = 1; });
module.exports = { commands, registerCommands };
