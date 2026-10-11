require("dotenv").config();
const { Client, GatewayIntentBits, Events, PermissionFlagsBits, ChannelType } = require("discord.js");
const { connectDb, getDb } = require("./db");
const { DEFAULT_RULES } = require("./default-rules");
const { getGuildSettings, patchGuildSettings } = require("./guild-settings");
const { inspectMessage, saveReview } = require("./moderation");

const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMembers, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent]
});

client.once(Events.ClientReady, ready => console.log("Logged in as " + ready.user.tag));

client.on(Events.GuildMemberAdd, async member => {
  try {
    const settings = await getGuildSettings(member.guild.id);
    const cfg = settings.welcome || {};
    if (!cfg.enabled || !cfg.channelId) return;
    const channel = await member.guild.channels.fetch(cfg.channelId).catch(() => null);
    if (!channel?.isTextBased()) return;
    const message = String(cfg.message || "Welcome {user} to {server}!")
      .replaceAll("{user}", member.toString())
      .replaceAll("{server}", member.guild.name);
    await channel.send({ content: message.slice(0, 1900), allowedMentions: { users: [member.id] } });
  } catch (error) { console.error("Welcome handler failed:", error); }
});

client.on(Events.GuildMemberRemove, async member => {
  try {
    const settings = await getGuildSettings(member.guild.id);
    const cfg = settings.goodbye || {};
    if (!cfg.enabled || !cfg.channelId) return;
    const channel = await member.guild.channels.fetch(cfg.channelId).catch(() => null);
    if (!channel?.isTextBased()) return;
    const message = String(cfg.message || "Goodbye {user}!")
      .replaceAll("{user}", member.user?.tag || member.user?.username || "A member")
      .replaceAll("{server}", member.guild.name);
    await channel.send({ content: message.slice(0, 1900) });
  } catch (error) { console.error("Goodbye handler failed:", error); }
});

client.on(Events.MessageCreate, async message => {
  if (!message.guild || message.author.bot) return;
  try {
    const settings = await getGuildSettings(message.guildId);
    if (settings.automod?.enabled === false) return;
    const finding = inspectMessage(message);
    if (finding.status === "review") await saveReview(client, message, finding);
  } catch (error) {
    console.error("Message review failed:", error);
  }
});

function isModerator(interaction, permission) {
  return Boolean(interaction.memberPermissions?.has(permission));
}
async function sendModLog(guild, entry) {
  await getDb().collection("modlogs").add({ guildId: guild.id, ...entry, createdAt: new Date() });
}

client.on(Events.InteractionCreate, async interaction => {
  if (!interaction.isChatInputCommand() || !interaction.guild) return;
  const command = interaction.commandName;
  try {
    if (command === "rules") {
      const settings = await getGuildSettings(interaction.guildId);
      let rules = Array.isArray(settings.rules) && settings.rules.length ? settings.rules : null;
      if (!rules) {
        const snapshot = await getDb().collection("rules").where("guildId", "==", interaction.guildId).where("enabled", "==", true).get();
        rules = snapshot.docs.map(doc => doc.data());
      }
      if (!rules.length) rules = DEFAULT_RULES;
      const list = rules.map((r, i) => {
        if (typeof r === "string") return "**" + (i + 1) + ".** " + r;
        return "**" + (r.id || i + 1) + " — " + (r.title || "Rule") + "**" + (r.points ? " (" + r.points + " points)" : "") + (r.description ? "\n" + r.description : "");
      }).join("\n\n");
      await interaction.reply({ content: list.slice(0, 1900), ephemeral: true });
      return;
    }

    if (command === "welcome-setup" || command === "goodbye-setup") {
      if (!isModerator(interaction, PermissionFlagsBits.ManageGuild)) {
        await interaction.reply({ content: "You need Manage Server permission.", ephemeral: true }); return;
      }
      const kind = command === "welcome-setup" ? "welcome" : "goodbye";
      const channel = interaction.options.getChannel("channel", true);
      if (![ChannelType.GuildText, ChannelType.GuildAnnouncement].includes(channel.type)) {
        await interaction.reply({ content: "Choose a text or announcement channel.", ephemeral: true }); return;
      }
      const message = interaction.options.getString("message") || (kind === "welcome" ? "Welcome {user} to {server}!" : "Goodbye {user}!");
      await patchGuildSettings(interaction.guildId, { [kind]: { enabled: true, channelId: channel.id, message } });
      await interaction.reply({ content: kind === "welcome" ? "Welcome messages enabled in " + channel + "." : "Goodbye messages enabled in " + channel + ".", ephemeral: true });
      return;
    }

    if (command === "rules-set") {
      if (!isModerator(interaction, PermissionFlagsBits.ManageGuild)) {
        await interaction.reply({ content: "You need Manage Server permission.", ephemeral: true }); return;
      }
      const raw = interaction.options.getString("rules", true);
      const rules = raw.split("\n").map(line => line.trim()).filter(Boolean).slice(0, 30);
      if (!rules.length) { await interaction.reply({ content: "Add at least one rule, one per line.", ephemeral: true }); return; }
      await patchGuildSettings(interaction.guildId, { rules });
      await interaction.reply({ content: "Saved " + rules.length + " rules. The /rules command now uses these rules.", ephemeral: true });
      return;
    }

    if (command === "timeout") {
      if (!isModerator(interaction, PermissionFlagsBits.ModerateMembers)) { await interaction.reply({ content: "You need Moderate Members permission.", ephemeral: true }); return; }
      const target = interaction.options.getMember("user", true);
      const minutes = interaction.options.getInteger("minutes", true);
      const reason = interaction.options.getString("reason") || "No reason provided";
      if (!target.moderatable || target.id === interaction.user.id) { await interaction.reply({ content: "I cannot timeout that member. Check role hierarchy and permissions.", ephemeral: true }); return; }
      await target.timeout(minutes * 60 * 1000, reason);
      await sendModLog(interaction.guild, { action: "timeout", userId: target.id, username: target.user.tag, moderatorId: interaction.user.id, reason, durationMinutes: minutes, status: "completed" });
      await interaction.reply({ content: "Timed out " + target.user.tag + " for " + minutes + " minute(s). Reason: " + reason, ephemeral: true });
      return;
    }

    if (command === "untimeout") {
      if (!isModerator(interaction, PermissionFlagsBits.ModerateMembers)) { await interaction.reply({ content: "You need Moderate Members permission.", ephemeral: true }); return; }
      const target = interaction.options.getMember("user", true);
      const reason = interaction.options.getString("reason") || "No reason provided";
      if (!target.moderatable) { await interaction.reply({ content: "I cannot edit that member. Check role hierarchy and permissions.", ephemeral: true }); return; }
      await target.timeout(null, reason);
      await sendModLog(interaction.guild, { action: "untimeout", userId: target.id, username: target.user.tag, moderatorId: interaction.user.id, reason, status: "completed" });
      await interaction.reply({ content: "Timeout removed for " + target.user.tag + ".", ephemeral: true });
      return;
    }

    if (command === "kick" || command === "ban") {
      const permission = command === "kick" ? PermissionFlagsBits.KickMembers : PermissionFlagsBits.BanMembers;
      if (!isModerator(interaction, permission)) { await interaction.reply({ content: "You do not have permission to use this command.", ephemeral: true }); return; }
      const target = interaction.options.getMember("user", true);
      const reason = interaction.options.getString("reason") || "No reason provided";
      if (!target.moderatable || target.id === interaction.user.id) { await interaction.reply({ content: "I cannot moderate that member. Check role hierarchy.", ephemeral: true }); return; }
      if (command === "kick") await target.kick(reason); else await target.ban({ reason });
      await sendModLog(interaction.guild, { action: command, userId: target.id, username: target.user.tag, moderatorId: interaction.user.id, reason, status: "completed" });
      await interaction.reply({ content: target.user.tag + " was " + (command === "kick" ? "kicked." : "banned."), ephemeral: true });
      return;
    }

    if (command === "clear") {
      if (!isModerator(interaction, PermissionFlagsBits.ManageMessages)) { await interaction.reply({ content: "You need Manage Messages permission.", ephemeral: true }); return; }
      const amount = interaction.options.getInteger("amount", true);
      const channel = interaction.channel;
      if (!channel?.isTextBased() || !channel.bulkDelete) { await interaction.reply({ content: "This channel does not support bulk delete.", ephemeral: true }); return; }
      const deleted = await channel.bulkDelete(amount, true);
      await interaction.reply({ content: "Deleted " + deleted.size + " recent messages. Messages older than 14 days cannot be bulk-deleted.", ephemeral: true });
      await sendModLog(interaction.guild, { action: "clear", moderatorId: interaction.user.id, channelId: channel.id, reason: "Bulk delete " + deleted.size + " messages", status: "completed" });
      return;
    }

    if (command === "modlogs") {
      if (!isModerator(interaction, PermissionFlagsBits.ModerateMembers)) {
        await interaction.reply({ content: "You need the Moderate Members permission.", ephemeral: true }); return;
      }
      const snapshot = await getDb().collection("modlogs").where("guildId", "==", interaction.guildId).orderBy("createdAt", "desc").limit(8).get();
      const logs = snapshot.docs.map(doc => doc.data());
      const body = logs.length ? logs.map(l => "• " + (l.username || l.userId || "unknown") + " — " + (l.action || ("Rule " + l.ruleId)) + ": " + (l.reason || "No reason") + " [" + (l.status || "logged") + "]").join("\n") : "No moderation records yet.";
      await interaction.reply({ content: body.slice(0, 1900), ephemeral: true });
    }
  } catch (error) {
    console.error("Command failed:", command, error);
    if (interaction.isRepliable() && !interaction.replied) {
      await interaction.reply({ content: "Command failed: check bot permissions, role hierarchy, and Railway logs.", ephemeral: true }).catch(() => {});
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
