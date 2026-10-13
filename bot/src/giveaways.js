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

async function joinGiveaway(id, guildId, userId) {
  const ref = getDb().collection("giveaways").doc(id);
  return getDb().runTransaction(async tx => {
    const snap = await tx.get(ref);
    if (!snap.exists || snap.data().guildId !== guildId || snap.data().status !== "active") throw new Error("Active giveaway not found.");
    const data = snap.data();
    const end = data.endsAt?.toDate ? data.endsAt.toDate().getTime() : Date.parse(data.endsAt);
    if (!Number.isFinite(end) || end <= Date.now()) throw new Error("This giveaway has ended; wait for the result announcement.");
    const participants = Array.isArray(data.participantIds) ? data.participantIds : [];
    if (participants.includes(userId)) return { alreadyJoined: true, count: participants.length };
    tx.update(ref, { participantIds: [...participants, userId], updatedAt: new Date() });
    return { alreadyJoined: false, count: participants.length + 1 };
  });
}

async function processDueGiveaways(client) {
  const due = await getDueGiveaways(new Date()).catch(error => { console.error("Giveaway scan failed:", error.message); return []; });
  for (const giveaway of due) {
    const ref = getDb().collection("giveaways").doc(giveaway.id);
    const winnerId = Array.isArray(giveaway.participantIds) && giveaway.participantIds.length
      ? giveaway.participantIds[Math.floor(Math.random() * giveaway.participantIds.length)] : null;
    const won = await getDb().runTransaction(async tx => {
      const fresh = await tx.get(ref);
      if (!fresh.exists || fresh.data().status !== "active") return false;
      tx.update(ref, { status: "ended", winnerId, endedAt: new Date() });
      return true;
    }).catch(() => false);
    if (!won) continue;
    const channel = await client.channels.fetch(giveaway.channelId).catch(() => null);
    if (channel?.isTextBased()) {
      await channel.send({ content: winnerId
        ? "🎉 Giveaway ended! Prize: **" + String(giveaway.prize || "Prize").slice(0, 150) + "**\nWinner: <@" + winnerId + ">\nGiveaway ID: `" + giveaway.id + "`"
        : "Giveaway ended with no entries. Prize: **" + String(giveaway.prize || "Prize").slice(0, 150) + "**\nGiveaway ID: `" + giveaway.id + "`"
      }).catch(error => console.error("Could not announce giveaway result:", error.message));
    }
  }
}

function startGiveawayWorker(client) {
  if (global.__theDcGiveawayWorker) return;
  processDueGiveaways(client);
  global.__theDcGiveawayWorker = setInterval(() => processDueGiveaways(client), 15000);
  if (typeof global.__theDcGiveawayWorker.unref === "function") global.__theDcGiveawayWorker.unref();
}

module.exports = { createGiveaway, getDueGiveaways, markGiveawayEnded, joinGiveaway, processDueGiveaways, startGiveawayWorker };
