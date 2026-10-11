require("dotenv").config();
const { REST, Routes, SlashCommandBuilder } = require("discord.js");
const commands = [
  new SlashCommandBuilder().setName("rules").setDescription("Show server rules"),
  new SlashCommandBuilder().setName("modlogs").setDescription("Show recent moderation review logs")
];
async function main() {
  const { DISCORD_TOKEN, DISCORD_CLIENT_ID, DISCORD_GUILD_ID } = process.env;
  if (!DISCORD_TOKEN || !DISCORD_CLIENT_ID || !DISCORD_GUILD_ID) throw new Error("Set Discord environment variables");
  const rest = new REST({ version: "10" }).setToken(DISCORD_TOKEN);
  await rest.put(Routes.applicationGuildCommands(DISCORD_CLIENT_ID, DISCORD_GUILD_ID), { body: commands.map(c => c.toJSON()) });
  console.log("Registered starter slash commands.");
}
main().catch(error => { console.error(error); process.exitCode = 1; });
