require("dotenv").config();
const { Client, GatewayIntentBits, Events, PermissionFlagsBits } = require("discord.js");
const { connectDb, getDb } = require("./db");
const { DEFAULT_RULES } = require("./default-rules");
const { inspectMessage, saveReview } = require("./moderation");

const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent]
});

client.once(Events.ClientReady, ready => console.log("Logged in as " + ready.user.tag));

client.on(Events.MessageCreate, async message => {
  if (!message.guild || message.author.bot) return;
  try {
    const finding = inspectMessage(message);
    if (finding.status === "review") await saveReview(client, message, finding);
  } catch (error) {
    console.error("Message review failed:", error);
  }
});

client.on(Events.InteractionCreate, async interaction => {
  if (!interaction.isChatInputCommand()) return;
  try {
    if (interaction.commandName === "rules") {
      const snapshot = await getDb().collection("rules")
        .where("guildId", "==", interaction.guildId)
        .where("enabled", "==", true)
        .get();
      let rules = snapshot.docs.map(doc => ({ ...doc.data(), documentId: doc.id }));
      if (!rules.length) rules = DEFAULT_RULES;
      const list = rules.map(r =>
        "**" + r.id + " — " + r.title + "** (" + r.points + " points)\n" + r.description
      ).join("\n\n");
      await interaction.reply({ content: list.slice(0, 1900), ephemeral: true });
    } else if (interaction.commandName === "modlogs") {
      if (!interaction.memberPermissions?.has(PermissionFlagsBits.ModerateMembers)) {
        await interaction.reply({ content: "You need the Moderate Members permission.", ephemeral: true });
        return;
      }
      const snapshot = await getDb().collection("modlogs")
        .where("guildId", "==", interaction.guildId)
        .orderBy("createdAt", "desc")
        .limit(8)
        .get();
      const logs = snapshot.docs.map(doc => ({ ...doc.data(), documentId: doc.id }));
      const body = logs.length
        ? logs.map(l => "• " + (l.username || l.userId) + " — Rule " + l.ruleId + ": " + l.reason + " [" + l.status + "]").join("\n")
        : "No review records yet.";
      await interaction.reply({ content: body.slice(0, 1900), ephemeral: true });
    }
  } catch (error) {
    console.error(error);
    if (interaction.isRepliable() && !interaction.replied) {
      await interaction.reply({ content: "Something went wrong. Check bot logs.", ephemeral: true }).catch(() => {});
    }
  }
});

async function start() {
  if (!process.env.DISCORD_TOKEN) throw new Error("DISCORD_TOKEN is missing");
  await connectDb();
  await client.login(process.env.DISCORD_TOKEN);
}

start().catch(error => {
  console.error(error);
  process.exit(1);
});
