const { getDb } = require("./db");

// Absolute endsAt means downtime does not reset the duration.
async function createGiveaway({ guildId, channelId, prize, durationMs, createdBy }) {
  if (!Number.isFinite(durationMs) || durationMs <= 0) throw new Error("durationMs must be positive");
  return getDb().collection("giveaways").insertOne({
    guildId, channelId, prize, createdBy, endsAt: new Date(Date.now() + durationMs),
    status: "active", createdAt: new Date(), winnerId: null
  });
}
async function getDueGiveaways(now = new Date()) {
  return getDb().collection("giveaways").find({ status: "active", endsAt: { $lte: now } }).toArray();
}
async function markGiveawayEnded(id, winnerId = null) {
  return getDb().collection("giveaways").updateOne(
    { _id: id, status: "active" },
    { $set: { status: "ended", winnerId, endedAt: new Date() } }
  );
}
module.exports = { createGiveaway, getDueGiveaways, markGiveawayEnded };
