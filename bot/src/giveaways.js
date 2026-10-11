const { getDb } = require("./db");

// Store a fixed end timestamp so downtime does not reset the duration.
async function createGiveaway({ guildId, channelId, prize, durationMs, createdBy }) {
  if (!Number.isFinite(durationMs) || durationMs <= 0) throw new Error("durationMs must be positive");
  const endsAt = new Date(Date.now() + durationMs);
  const ref = await getDb().collection("giveaways").add({
    guildId,
    channelId,
    prize,
    createdBy,
    endsAt,
    status: "active",
    createdAt: new Date(),
    winnerId: null,
    participantIds: []
  });
  return { id: ref.id, endsAt };
}

async function getDueGiveaways(now = new Date()) {
  const snapshot = await getDb().collection("giveaways")
    .where("status", "==", "active")
    .where("endsAt", "<=", now)
    .get();
  return snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
}

async function markGiveawayEnded(id, winnerId = null) {
  const ref = getDb().collection("giveaways").doc(id);
  const snapshot = await ref.get();
  if (!snapshot.exists || snapshot.data().status !== "active") return false;
  await ref.update({ status: "ended", winnerId, endedAt: new Date() });
  return true;
}

module.exports = { createGiveaway, getDueGiveaways, markGiveawayEnded };
