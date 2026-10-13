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
    .addIntegerOption(o => o.setName("duration_hours").setDescription("Optional temporary ban duration in hours (1-8760); omit for permanent").setMinValue(1).setMaxValue(8760)),
  new SlashCommandBuilder().setName("giveaway-create").setDescription("Start a persistent giveaway")
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addStringOption(o => o.setName("prize").setDescription("Giveaway prize").setRequired(true).setMaxLength(150))
    .addIntegerOption(o => o.setName("duration_minutes").setDescription("Duration in minutes (1–10080)").setRequired(true).setMinValue(1).setMaxValue(10080)),
  new SlashCommandBuilder().setName("giveaway-join").setDescription("Enter a giveaway")
    .addStringOption(o => o.setName("giveaway_id").setDescription("Giveaway ID from /giveaway-list").setRequired(true)),
  new SlashCommandBuilder().setName("giveaway-list").setDescription("List active giveaways"),
  new SlashCommandBuilder().setName("profile").setDescription("View your or another member's community profile")
    .addUserOption(o => o.setName("user").setDescription("Member to view")),
  new SlashCommandBuilder().setName("rep-add").setDescription("Add or remove reputation for a member")
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageMessages)
    .addUserOption(o => o.setName("user").setDescription("Member").setRequired(true))
    .addIntegerOption(o => o.setName("amount").setDescription("Reputation change (-100 to 100, not zero)").setRequired(true).setMinValue(-100).setMaxValue(100))
    .addStringOption(o => o.setName("reason").setDescription("Reason").setRequired(true).setMaxLength(500)),
  new SlashCommandBuilder().setName("points-add").setDescription("Add moderation points to a member")
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageMessages)
    .addUserOption(o => o.setName("user").setDescription("Member").setRequired(true))
    .addIntegerOption(o => o.setName("amount").setDescription("Points to add (1–100)").setRequired(true).setMinValue(1).setMaxValue(100))
    .addStringOption(o => o.setName("reason").setDescription("Reason").setRequired(true).setMaxLength(500)),
  new SlashCommandBuilder().setName("party-config").setDescription("Set the server's public party-finder channel")
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addChannelOption(o => o.setName("channel").setDescription("Channel where active parties are listed").setRequired(true)),
  new SlashCommandBuilder().setName("party-list").setDescription("Browse active parties in this server"),
  new SlashCommandBuilder().setName("party-create").setDescription("Create a private party channel")
    .addStringOption(o => o.setName("name").setDescription("Party name").setRequired(true).setMaxLength(60))
    .addStringOption(o => o.setName("description").setDescription("What the party is for").setMaxLength(900))
    .addIntegerOption(o => o.setName("max_members").setDescription("Maximum members (2–50)").setMinValue(2).setMaxValue(50))
    .addIntegerOption(o => o.setName("temporary_minutes").setDescription("Auto-close after minutes (1–10080); omit for owner-managed").setMinValue(1).setMaxValue(10080)),
  new SlashCommandBuilder().setName("party-join").setDescription("Join a private party")
    .addStringOption(o => o.setName("party_id").setDescription("Party ID from the party channel topic").setRequired(true)),
  new SlashCommandBuilder().setName("party-leave").setDescription("Leave a party")
    .addStringOption(o => o.setName("party_id").setDescription("Party ID").setRequired(true)),
  new SlashCommandBuilder().setName("party-close").setDescription("Close a party you own")
    .addStringOption(o => o.setName("party_id").setDescription("Party ID").setRequired(true)),
  new SlashCommandBuilder().setName("mission-create").setDescription("Create a community mission")
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addStringOption(o => o.setName("title").setDescription("Mission title").setRequired(true).setMaxLength(100))
    .addStringOption(o => o.setName("description").setDescription("Mission description").setRequired(true).setMaxLength(900))
    .addIntegerOption(o => o.setName("goal").setDescription("Target progress (1–1000000)").setRequired(true).setMinValue(1).setMaxValue(1000000))
    .addChannelOption(o => o.setName("channel").setDescription("Optional mission channel")),
  new SlashCommandBuilder().setName("mission-progress").setDescription("Contribute progress to a mission")
    .addStringOption(o => o.setName("mission_id").setDescription("Mission ID from /mission-list").setRequired(true))
    .addIntegerOption(o => o.setName("amount").setDescription("Progress amount (1–100000)").setRequired(true).setMinValue(1).setMaxValue(100000)),
  new SlashCommandBuilder().setName("mission-list").setDescription("List active community missions"),
  new SlashCommandBuilder().setName("chat-health").setDescription("Show the server's 7-day chat activity snapshot")
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild),
  new SlashCommandBuilder().setName("companion").setDescription("Ask the Smart Chat Companion or view your recent Q&A")
    .addSubcommand(s => s.setName("ask").setDescription("Save a question for the companion")
      .addStringOption(o => o.setName("question").setDescription("Your question").setRequired(true).setMaxLength(1500)))
    .addSubcommand(s => s.setName("recap").setDescription("DM your active Q&A recap")),

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
