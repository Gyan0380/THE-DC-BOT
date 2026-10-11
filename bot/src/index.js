require("dotenv").config();
const { Client, GatewayIntentBits, Events, PermissionFlagsBits, ChannelType } = require("discord.js");
const { connectDb, getDb } = require("./db");
const { registerCommands } = require("./deploy-commands");
const { DEFAULT_RULES } = require("./default-rules");
const { getGuildSettings, patchGuildSettings } = require("./guild-settings");
const { inspectMessage, saveReview } = require("./moderation");
const { PROVIDERS, getProviderConfig, validateApiKey, classifyMessage, shouldInspectWithAi } = require("./ai-provider");
const { encryptApiKey, decryptApiKey } = require("./ai-key-vault");
const { openWelcomePanel, openPunishPanel, handlePanelInteraction, dmMember, logAction, dashUrl } = require("./panels");
const { ActionRowBuilder, ButtonBuilder, ButtonStyle, ModalBuilder, TextInputBuilder, TextInputStyle } = require("discord.js");

const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMembers, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent]
});

client.once(Events.ClientReady, ready => console.log("Logged in as " + ready.user.tag));

client.on(Events.GuildMemberUpdate, async (oldMember, newMember) => {
  try {
    const before = oldMember.communicationDisabledUntilTimestamp;
    const after = newMember.communicationDisabledUntilTimestamp;
    if (before && !after) {
      const audit = await newMember.guild.fetchAuditLogs({ type: 24, limit: 5 }).catch(() => null);
      const latest = audit?.entries?.find(e => e.target?.id === newMember.id);
      const moderator = latest?.executor || client.user;
      const dmSent = await dmMember(newMember.user, newMember.guild, moderator, "Timeout ended", "Your timeout has expired or was removed.", null);
      await logAction(newMember.guild.id, { action: "timeout_expired", userId: newMember.id, username: newMember.user.tag, moderatorId: moderator.id, moderatorName: moderator.tag || "THE DC BOT", reason: "Timeout expired or removed", dmSent, status: "completed" });
    }
  } catch (error) { console.error("Timeout expiry notification failed:", error); }
});

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
    await channel.send({ content: (message.slice(0, 1650) + "\n\n🌐 Dashboard: " + dashUrl).slice(0, 1900), allowedMentions: { users: [member.id] } });
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
    const aiConfig = getProviderConfig(settings);
    if (aiConfig?.enabled && Array.isArray(settings.rules) && settings.rules.length) {
      if (!shouldInspectWithAi(message, settings.rules)) return;
      try {
        const finding = await classifyMessage(settings, message, settings.rules);
        if (finding.status === "review" || finding.status === "violation") {
          const review = {
            status: "review", ruleId: finding.ruleId || "unknown",
            reason: "AI " + finding.status + " (" + Math.round(finding.confidence * 100) + "%): " + finding.reason,
            points: 0, confidence: finding.confidence, source: "ai"
          };
          await saveReview(client, message, review);
          // Automatic punishments are only eligible when the saved rule itself explicitly defines a timeout duration.
          // Until the rule/action is reviewed and configured, ambiguous AI findings remain moderator-review only.
          const ruleText = String(finding.ruleText || "");
          const timeoutMatch = ruleText.match(/\btimeout\s*(?:for\s*)?(\d+)\s*(days?|hours?|minutes?|mins?)(?:\s*(\d+)\s*(hours?|minutes?|mins?))?\b/i);
          if (finding.status === "violation" && finding.confidence >= 0.97 && timeoutMatch) {
            const unit = timeoutMatch[2].toLowerCase();
            const multiplier = unit.startsWith("day") ? 1440 : unit.startsWith("hour") ? 60 : 1;
            const extraUnit = String(timeoutMatch[4] || "").toLowerCase();
            const extraMultiplier = extraUnit.startsWith("hour") ? 60 : 1;
            const minutes = Number(timeoutMatch[1]) * multiplier + (Number(timeoutMatch[3] || 0) * extraMultiplier);
            const member = message.member || await message.guild.members.fetch(message.author.id).catch(() => null);
            if (minutes > 0 && minutes <= 40320 && member?.moderatable) {
              const reason = "Configured rule " + finding.ruleId + ": " + finding.reason;
              await member.timeout(minutes * 60000, reason);
              const dmSent = await dmMember(member.user, message.guild, client.user, "Automatic timeout", "A configured server rule was matched: **" + String(finding.ruleId) + "**.\nReason: " + finding.reason, minutes + " minutes");
              await logAction(message.guildId, { action: "ai_auto_timeout", userId: member.id, username: member.user.tag, moderatorId: client.user.id, moderatorName: client.user.tag, reason, ruleId: finding.ruleId, durationMinutes: minutes, confidence: finding.confidence, dmSent, status: "completed" });
            }
          }
        }
      } catch (aiError) {
        // Never log provider response bodies or secrets. Notify the recorded key owner sparingly for quota/auth failures.
        console.error("AI moderation unavailable:", aiError.message);
        const aiSettings = settings.ai || {};
        const quotaOrAuth = /HTTP (401|402|403|429)|quota|credit|resource exhausted/i.test(aiError.message || "");
        const lastAlert = Date.parse(aiSettings.lastFailureAlertAt || "1970-01-01T00:00:00.000Z");
        if (quotaOrAuth && aiSettings.keyOwnerId && Date.now() - lastAlert > 6 * 60 * 60 * 1000) {
          await patchGuildSettings(message.guildId, { ai: { ...aiSettings, lastFailureAlertAt: new Date().toISOString() } }).catch(() => {});
          const owner = await client.users.fetch(aiSettings.keyOwnerId).catch(() => null);
          if (owner) await owner.send("THE DC BOT AI moderation in **" + message.guild.name + "** could not call its configured provider (" + aiError.message + "). Check the provider key, quota/billing and /diagnose. The key itself is never included in this alert.").catch(() => {});
        }
      }
      return;
    }
    const finding = inspectMessage(message);
    if (finding.status === "review") {
      await saveReview(client, message, finding);
      await dmMember(message.author, message.guild, client.user, "Rule review notice", "A message was flagged for moderator review under Rule " + finding.ruleId + ": " + finding.reason + ". No automatic punishment was applied.", null);
    }
  } catch (error) {
    console.error("Message review failed:", error.message);
  }
});

function isModerator(interaction, permission) {
  return Boolean(interaction.memberPermissions?.has(permission));
}
async function sendModLog(guild, entry) {
  await getDb().collection("modlogs").add({ guildId: guild.id, ...entry, createdAt: new Date() });
}

client.on(Events.InteractionCreate, async interaction => {
  let command = interaction.isChatInputCommand() ? interaction.commandName : "component";
  try {
    if (interaction.isModalSubmit() && interaction.customId.startsWith("ai-key-submit:")) {
      if (!interaction.guild || !isModerator(interaction, PermissionFlagsBits.ManageGuild)) {
        await interaction.reply({ content: "Only server managers can configure this server's AI key.", ephemeral: true }); return;
      }
      await interaction.deferReply({ ephemeral: true });
      const provider = interaction.customId.split(":")[1];
      const apiKey = interaction.fields.getTextInputValue("api_key").trim();
      if (!PROVIDERS[provider] || apiKey.length < 12 || apiKey.length > 500) {
        await interaction.editReply("Invalid provider or key format. Nothing was saved."); return;
      }
      const check = await validateApiKey(provider, apiKey);
      if (!check.ok) { await interaction.editReply("❌ API key check failed. " + check.message + "\nNo key was saved."); return; }
      try {
        const encryptedKey = encryptApiKey(apiKey);
        await patchGuildSettings(interaction.guildId, { ai: { provider, model: PROVIDERS[provider].defaultModel, encryptedKey, keyOwnerId: interaction.user.id, enabled: true, updatedAt: new Date().toISOString() } });
        await interaction.editReply("✅ " + PROVIDERS[provider].label + " key validated and saved encrypted for this server. " + check.message + "\nUse /diagnose to check the setup. Keep your encryption secret configured in Railway.");
      } catch (error) {
        await interaction.editReply("❌ Key was validated but could not be saved securely. Set AI_KEY_ENCRYPTION_SECRET in Railway to a random secret of at least 32 characters, redeploy, then run /ai-setup again.").catch(() => {});
      }
      return;
    }
    if (interaction.isButton() || interaction.isStringSelectMenu() || interaction.isChannelSelectMenu() || interaction.isModalSubmit()) {
      const handled = await handlePanelInteraction(interaction);
      if (handled) return;
    }
    if (!interaction.isChatInputCommand()) return;
    if (interaction.commandName === "ai-setup") {
      if (!interaction.guild || !isModerator(interaction, PermissionFlagsBits.ManageGuild)) { await interaction.reply({ content: "You need Manage Server permission in a server.", ephemeral: true }); return; }
      const provider = interaction.options.getString("provider", true);
      if (!PROVIDERS[provider]) { await interaction.reply({ content: "Choose Gemini or DeepSeek.", ephemeral: true }); return; }
      const modal = new ModalBuilder().setCustomId("ai-key-submit:" + provider).setTitle("Configure " + PROVIDERS[provider].label);
      const keyInput = new TextInputBuilder().setCustomId("api_key").setLabel("API key (never share in chat)").setStyle(TextInputStyle.Short).setRequired(true).setMinLength(12).setMaxLength(500).setPlaceholder("Paste your provider API key");
      modal.addComponents(new ActionRowBuilder().addComponents(keyInput));
      await interaction.showModal(modal); return;
    }
    if (interaction.commandName === "diagnose") {
      if (!interaction.guild || !isModerator(interaction, PermissionFlagsBits.ManageGuild)) { await interaction.reply({ content: "You need Manage Server permission.", ephemeral: true }); return; }
      await interaction.deferReply({ ephemeral: true });
      const checks = [];
      try { await getDb().collection("_health").doc("connection").get(); checks.push("✅ Firestore reachable"); } catch { checks.push("❌ Firestore unreachable"); }
      const settings = await getGuildSettings(interaction.guildId).catch(() => ({}));
      const cfg = getProviderConfig(settings);
      if (!cfg) checks.push("⚠️ No Gemini/DeepSeek API key configured for this server");
      else {
        checks.push("✅ Provider configured: " + PROVIDERS[cfg.provider].label + " (" + cfg.model + ")");
        try {
          const key = decryptApiKey(cfg.encryptedKey);
          const valid = await validateApiKey(cfg.provider, key);
          checks.push((valid.ok ? "✅" : "❌") + " Provider authentication: " + valid.message);
          checks.push(cfg.enabled ? "✅ AI moderation enabled" : "⚠️ AI moderation disabled");
          checks.push("ℹ️ Key owner: " + (cfg.keyOwnerId ? "<@" + cfg.keyOwnerId + ">" : "unknown"));
        } catch (e) { checks.push("❌ Key decryption failed. Check AI_KEY_ENCRYPTION_SECRET; do not rotate it unless you intend to reconfigure saved keys."); }
      }
      checks.push("ℹ️ API credit balance is not reliably exposed by a key-validation check; review the provider billing dashboard too.");
      checks.push("ℹ️ Ambiguous matches go to moderator review. No API key or key fragment is displayed here.");
      await interaction.editReply("**THE DC BOT diagnostics**\n" + checks.join("\n")); return;
    }
    if (interaction.commandName === "dashboard") {
      const row = new ActionRowBuilder().addComponents(new ButtonBuilder().setLabel("Open THE DC BOT Dashboard").setStyle(ButtonStyle.Link).setURL(dashUrl));
      await interaction.reply({ content: "Open the dashboard and sign in with Discord. If you are not logged in, the site will redirect you to Discord login.", components: [row], ephemeral: true });
      return;
    }
    if (!interaction.guild) return;
    command = interaction.commandName;
    if (command === "welcome-config") { await openWelcomePanel(interaction); return; }
    if (command === "punish") { await openPunishPanel(interaction); return; }
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
      const rules = raw.split(/\n|\s*\|\s*/).map(line => line.trim()).filter(Boolean).slice(0, 200);
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
      const dmSent = await dmMember(target.user, interaction.guild, interaction.user, "timeout", reason, minutes + " minute(s)");
      await sendModLog(interaction.guild, { action: "timeout", userId: target.id, username: target.user.tag, moderatorId: interaction.user.id, moderatorName: interaction.user.tag, reason, durationMinutes: minutes, dmSent, status: "completed" });
      await interaction.reply({ content: "Timed out " + target.user.tag + " for " + minutes + " minute(s). Reason: " + reason + "\n" + (dmSent ? "✅ DM notification sent." : "⚠️ Timeout applied, but DM could not be delivered (the member may have DMs disabled or blocked the bot)."), ephemeral: true });
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
  if (process.env.DISCORD_CLIENT_ID) await registerCommands();
  else console.warn("DISCORD_CLIENT_ID is missing; slash commands were not registered.");
  await client.login(process.env.DISCORD_TOKEN);
}

start().catch(error => {
  console.error(error);
  process.exit(1);
});
