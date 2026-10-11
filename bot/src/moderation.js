const { EmbedBuilder } = require("discord.js");

function detectPromotionChannel(channel) {
  const name = (channel?.name || "").toLowerCase();
  const category = (channel?.parent?.name || "").toLowerCase();
  return /promo|promotion|advert|self[-_ ]?promo|showcase|creator/.test(name) ||
    /promo|promotion|advertisement/.test(category);
}

// Conservative signal detection only, not a final policy decision.
function inspectMessage(message) {
  const content = (message.content || "").trim();
  const looksLikePromo = /(https?:\\/\\/|discord\\.gg\\/|youtube\\.com\\/|youtu\\.be\\/|twitch\\.tv\\/)/i.test(content);
  if (looksLikePromo && !detectPromotionChannel(message.channel)) {
    return { status: "review", ruleId: "3.2", reason: "Possible promotion outside a promotion channel", points: 2 };
  }
  if (content.length > 1800 || /(.)\\1{14,}/u.test(content)) {
    return { status: "review", ruleId: "4", reason: "Possible message flood", points: 2 };
  }
  return { status: "clear" };
}

async function saveReview(client, message, finding) {
  const { getDb } = require("./db");
  const now = new Date();
  const record = {
    guildId: message.guildId,
    userId: message.author.id,
    username: message.author.tag,
    channelId: message.channelId,
    messageId: message.id,
    ruleId: finding.ruleId,
    reason: finding.reason,
    points: finding.points,
    status: "needs_review",
    createdAt: now
  };
  const ref = await getDb().collection("modlogs").add(record);
  const logChannelId = process.env.MODLOG_CHANNEL_ID;
  const logChannel = logChannelId ? await message.guild.channels.fetch(logChannelId).catch(() => null) : null;
  if (logChannel?.isTextBased()) {
    const embed = new EmbedBuilder().setTitle("Moderation review needed")
      .setDescription("Potential rule " + finding.ruleId + " issue. No automatic punishment was applied.")
      .addFields(
        { name: "Member", value: message.author.tag + " (" + message.author.id + ")" },
        { name: "Channel", value: "<#" + message.channelId + ">" },
        { name: "Signal", value: finding.reason },
        { name: "Proposed points", value: String(finding.points) },
        { name: "Review ID", value: ref.id }
      ).setTimestamp(now);
    await logChannel.send({ embeds: [embed] }).catch(console.error);
  }
  return ref.id;
}

module.exports = { detectPromotionChannel, inspectMessage, saveReview };
