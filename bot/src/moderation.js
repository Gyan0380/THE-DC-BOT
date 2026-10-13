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

function parseRulePoints(ruleText, fallback = 2) {
  const match = String(ruleText || "").match(/\b(\d{1,3})\s*points?\b/i);
  return match ? Math.max(0, Math.min(100, Number(match[1]))) : fallback;
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
function inspectMessage(message, rules = [], spamConfig = {}, rulePolicies = {}) {
  const content = String(message.content || "").trim();
  const normalized = content.toLowerCase().replace(/\s+/g, " ").trim();
  const now = Date.now(), key = message.guildId + ":" + message.author.id;
  const history = (recentMessages.get(key) || []).filter(item => now - item.time <= 60 * 60 * 1000);
  const isLink = /https?:\/\/|www\.|discord\.gg\//i.test(content);
  const isInvite = /discord\.gg\/|discord\.com\/invite/i.test(content);
  const upper = content.replace(/[^A-Za-z]/g, "");
  const capsRatio = upper.length ? (upper.match(/[A-Z]/g) || []).length / upper.length : 0;
  const emojiCount = (content.match(/[\p{Extended_Pictographic}]/gu) || []).length;
  const current = { time: now, content: normalized, isLink, isInvite, mentions: (message.mentions?.users?.size || 0) + (message.mentions?.roles?.size || 0), everyone: /@everyone|@here/.test(content), attachments: message.attachments?.size || 0, capsRatio, emojiCount };
  history.push(current);
  if (history.length > 200) history.splice(0, history.length - 200);
  recentMessages.set(key, history);

  const rapidCount = Math.max(2, Math.min(30, Number(spamConfig.messages || 5)));
  const rapidWindowSeconds = Math.max(1, Math.min(3600, Number(spamConfig.windowSeconds || 6)));
  const repeatCount = Math.max(2, Math.min(20, Number(spamConfig.repeats || 4)));
  const repeatWindowSeconds = Math.max(2, Math.min(3600, Number(spamConfig.repeatWindowSeconds || 15)));
  const usableRules = [];
  let categoryNumber = 0, ruleNumber = 0, category = "#GENERAL";
  for (const raw of (Array.isArray(rules) ? rules : [])) {
    const text = typeof raw === "string" ? raw : [raw?.title, raw?.description, raw?.text].filter(Boolean).join(" ");
    if (!text.trim()) continue;
    if (text.trim().startsWith("#")) { category = text.trim().toUpperCase(); categoryNumber++; ruleNumber = 0; continue; }
    ruleNumber++;
    const title = text.replace(/\s*\(\d+\s+(?:points?|minutes? timeout)\)/gi, "").trim();
    const policy = rulePolicies?.[title] || {};
    if (policy.allChannels === false && !(policy.channelIds || []).includes(message.channelId)) continue;
    if ((policy.excludedChannelIds || []).includes(message.channelId)) continue;
    usableRules.push({ text, title, id: String(raw?.id || (categoryNumber || 1) + "." + ruleNumber), policy });
  }

  for (const rule of usableRules) {
    const { text: ruleText, title, id, policy } = rule;
    const kind = String(policy.kind || (/spam|flood|repeated messages|rapid messages/i.test(ruleText) ? "rapid_spam" : /link|url/i.test(ruleText) ? "links" : /advert|promo/i.test(ruleText) ? "advertising" : "review")).toLowerCase();
    const limit = Math.max(1, Math.min(100, Number(policy.limit || (kind === "repeat_spam" ? repeatCount : rapidCount))));
    const windowSeconds = Math.max(1, Math.min(3600, Number(policy.windowSeconds || (kind === "repeat_spam" ? repeatWindowSeconds : rapidWindowSeconds))));
    const window = history.filter(item => now - item.time <= windowSeconds * 1000);
    let matched = false, reason = "";
    if (["spam","rapid_spam","rapid message spam"].includes(kind)) {
      matched = window.length >= Math.max(2, limit);
      reason = "Rapid messages: " + window.length + " messages within " + windowSeconds + " seconds";
    } else if (["repeat_spam","repeated messages"].includes(kind)) {
      const repeats = window.filter(item => item.content === normalized).length;
      matched = normalized.length >= 3 && repeats >= Math.max(2, limit);
      reason = "Repeated message: same message " + repeats + " times within " + windowSeconds + " seconds";
    } else if (["link_spam","invite_spam"].includes(kind)) {
      const matches = window.filter(item => kind === "invite_spam" ? item.isInvite : item.isLink).length;
      matched = (kind === "invite_spam" ? isInvite : isLink) && matches >= limit;
      reason = (kind === "invite_spam" ? "Invite-link spam" : "Link spam") + ": " + matches + " matching messages within " + windowSeconds + " seconds";
    } else if (["mention_spam","mass_ping"].includes(kind)) {
      matched = current.everyone || current.mentions >= limit;
      reason = current.everyone ? "Mass ping using @everyone/@here" : "Mention spam: " + current.mentions + " mentions";
    } else if (kind === "caps") {
      matched = upper.length >= 8 && capsRatio >= 0.75;
      reason = "Excessive capital letters";
    } else if (kind === "character_flood") {
      matched = /(.)\1{14,}/u.test(content) || content.length > 1800;
      reason = "Character flood or very long message";
    } else if (kind === "attachment_spam") {
      const attachments = window.reduce((sum, item) => sum + item.attachments, 0);
      matched = current.attachments > 0 && attachments >= limit;
      reason = "Attachment spam: " + attachments + " attachments within " + windowSeconds + " seconds";
    } else if (kind === "emoji_spam") {
      const emojis = window.reduce((sum, item) => sum + item.emojiCount, 0);
      matched = current.emojiCount > 0 && emojis >= limit;
      reason = "Emoji spam: " + emojis + " emoji within " + windowSeconds + " seconds";
    } else if (["advertising","links"].includes(kind)) {
      matched = isLink && !detectPromotionChannel(message.channel);
      reason = "Possible promotion outside an allowed promotion channel";
    } else if (kind === "review") {
      const lower = content.toLowerCase();
      matched = /(free nitro|steam gift|crypto giveaway|double your money|send me your password)/i.test(lower);
      reason = "Possible scam wording sent for moderator review";
    }
    if (!matched) continue;
    const alertKey = key + ":" + id;
    if (now - (spamAlerts.get(alertKey) || 0) < 30000) continue;
    spamAlerts.set(alertKey, now);
    const action = parseRuleAction(ruleText);
    return { status: "review", ruleId: id, ruleText, reason, points: parseRulePoints(ruleText), ...action };
  }

  if (content.length > 1800 || /(.)\1{14,}/u.test(content)) {
    return { status: "review", ruleId: "4", ruleText: "Character flood", reason: "Possible message flood", points: 2, action: "warning" };
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
    messageDeleted: Boolean(finding.messageDeleted),
    status: action === "timeout" ? "completed" : "warning",
    source: "rules",
    createdAt: now
  };
  const ref = await getDb().collection("modlogs").add(record);
  if (Number(finding.points) > 0) {
    const profileRef = getDb().collection("memberProfiles").doc(message.guildId + "_" + message.author.id);
    await profileRef.set({ guildId: message.guildId, userId: message.author.id, moderationPoints: require("firebase-admin/firestore").FieldValue.increment(Math.min(100, Math.max(0, Number(finding.points)))), updatedAt: now }, { merge: true }).catch(error => console.warn("Could not update moderation points:", error.message));
  }
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
        { name: "Spam message deleted", value: finding.messageDeleted ? "Yes" : "No (check Manage Messages permission)" },
        { name: "Review ID", value: ref.id }
      ).setTimestamp(now);
    await logChannel.send({ embeds: [embed] }).catch(console.error);
  }
  return ref.id;
}

module.exports = { detectPromotionChannel, inspectMessage, saveReview, parseRuleAction, parseRulePoints };
