const { EmbedBuilder } = require("discord.js");

// Lightweight in-memory rate tracking. Resets when the bot restarts.
const recentMessages = new Map();
const spamAlerts = new Map();

function detectPromotionChannel(channel) {
  const name = (channel?.name || "").toLowerCase();
  const category = (channel?.parent?.name || "").toLowerCase();
  return /promo|promotion|advert|self[-_ ]?promo|showcase|creator/.test(name) ||
    /promo|promotion|advertisement/.test(category);
}

function parseRuleAction(ruleText) {
  const text = String(ruleText || "");
  // Accept formats such as "spam (30 minutes timeout)", "timeout for 30 minutes", or "30 min timeout".
  const match = text.match(/(?:\(|\b)(?:timeout\s*(?:for\s*)?)?(\d+)\s*(minutes?|mins?|hours?|hrs?|days?)\s*(?:timeout)?\)?/i)
    || text.match(/timeout\s*(?:for\s*)?(\d+)\s*(minutes?|mins?|hours?|hrs?|days?)/i);
  if (!match) return { action: "warning", durationMinutes: null };
  const unit = match[2].toLowerCase();
  const multiplier = unit.startsWith("day") ? 1440 : (unit.startsWith("hour") || unit.startsWith("hr")) ? 60 : 1;
  const durationMinutes = Number(match[1]) * multiplier;
  if (!Number.isInteger(durationMinutes) || durationMinutes < 1 || durationMinutes > 40320) {
    return { action: "warning", durationMinutes: null };
  }
  return { action: "timeout", durationMinutes };
}

// Conservative, rule-aware signal detection. Custom rules define the action; signals define when they match.
function inspectMessage(message, rules = []) {
  const content = (message.content || "").trim();
  const normalized = content.toLowerCase().replace(/\s+/g, " ").trim();
  const now = Date.now();
  const key = message.guildId + ":" + message.author.id;
  const spamRules = (Array.isArray(rules) ? rules : []).filter(r =>
    /spam|flood|repeated messages|rapid messages/i.test(typeof r === "string" ? r : [r?.title, r?.description, r?.text].filter(Boolean).join(" "))
  );
  const hasSpamRule = spamRules.length > 0;
  const history = (recentMessages.get(key) || []).filter(item => now - item.time <= 15000);
  history.push({ time: now, content: normalized });
  recentMessages.set(key, history);

  const rapid = history.filter(item => now - item.time <= 6000).length >= 5;
  const repeated = normalized.length >= 3 && history.filter(item => item.content === normalized).length >= 4;
  const spam = hasSpamRule && (rapid || repeated);
  const spamRule = spamRules[0];
  const ruleText = typeof spamRule === "string" ? spamRule : [spamRule?.title, spamRule?.description, spamRule?.text].filter(Boolean).join(" ");
  if (spam) {
    const alertKey = key + ":spam";
    const lastAlert = spamAlerts.get(alertKey) || 0;
    if (now - lastAlert >= 30000) {
      spamAlerts.set(alertKey, now);
      const action = parseRuleAction(ruleText);
      return {
        status: "review", ruleId: (typeof spamRule === "object" && spamRule.id) || "spam",
        ruleText, reason: rapid ? "Spam: 5 messages within 6 seconds" : "Spam: same message repeated 4 times within 15 seconds",
        points: 2, ...action
      };
    }
  }

  const looksLikePromo = /(https?:\/\/|discord\.gg\/|youtube\.com\/|youtu\.be\/|twitch\.tv\/)/i.test(content);
  if (looksLikePromo && !detectPromotionChannel(message.channel)) {
    return { status: "review", ruleId: "3.2", reason: "Possible promotion outside a promotion channel", points: 2, action: "warning" };
  }
  if (content.length > 1800 || /(.)\1{14,}/u.test(content)) {
    return { status: "review", ruleId: "4", reason: "Possible message flood", points: 2, action: "warning" };
  }
  return { status: "clear" };
}

async function saveReview(client, message, finding) {
  const { getDb } = require("./db");
  const now = new Date();
  const action = finding.action === "timeout" ? "timeout" : "warning";
  const record = {
    guildId: message.guildId,
    userId: message.author.id,
    username: message.author.tag,
    channelId: message.channelId,
    messageId: message.id,
    ruleId: finding.ruleId,
    reason: finding.reason,
    points: finding.points,
    action,
    durationMinutes: action === "timeout" ? finding.durationMinutes : null,
    status: action === "timeout" ? "completed" : "warning",
    source: "rules",
    createdAt: now
  };
  const ref = await getDb().collection("modlogs").add(record);
  const settings = await require("./guild-settings").getGuildSettings(message.guildId).catch(() => ({}));
  const logChannelId = settings.modLogChannelId || settings.modlogChannelId || process.env.MODLOG_CHANNEL_ID;
  const logChannel = logChannelId ? await message.guild.channels.fetch(logChannelId).catch(() => null) : null;
  if (logChannel?.isTextBased()) {
    const embed = new EmbedBuilder().setTitle(action === "timeout" ? "Automatic timeout applied" : "Rule warning")
      .setDescription("Rule " + finding.ruleId + " matched. " + (action === "timeout" ? "Timeout applied for " + finding.durationMinutes + " minute(s)." : "No automatic punishment was configured."))
      .addFields(
        { name: "Member", value: message.author.tag + " (" + message.author.id + ")" },
        { name: "Channel", value: "<#" + message.channelId + ">" },
        { name: "Signal", value: finding.reason },
        { name: "Action", value: action === "timeout" ? "Timeout · " + finding.durationMinutes + " min" : "DM warning" },
        { name: "Review ID", value: ref.id }
      ).setTimestamp(now);
    await logChannel.send({ embeds: [embed] }).catch(console.error);
  }
  return ref.id;
}

module.exports = { detectPromotionChannel, inspectMessage, saveReview, parseRuleAction };
