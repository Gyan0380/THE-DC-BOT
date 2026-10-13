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
  const snapshot = await getDb().collection("giveaways").where("status", "==", "active").get();
  return snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() })).filter(item => {
    const end = item.endsAt?.toDate ? item.endsAt.toDate() : new Date(item.endsAt);
    return Number.isFinite(end.getTime()) && end <= now;
  });
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

async function processDueGiveawaysInternal(client) {
  const db = getDb();
  const due = await getDueGiveaways(new Date()).catch(error => { console.error("Giveaway scan failed:", error.message); return []; });
  for (const giveaway of due) {
    const ref = db.collection("giveaways").doc(giveaway.id);
    const winnerId = Array.isArray(giveaway.participantIds) && giveaway.participantIds.length
      ? giveaway.participantIds[Math.floor(Math.random() * giveaway.participantIds.length)] : null;
    const claimed = await db.runTransaction(async tx => {
      const fresh = await tx.get(ref);
      if (!fresh.exists || fresh.data().status !== "active") return false;
      tx.update(ref, { status: "ended", winnerId, endedAt: new Date(), announcementStatus: "pending" });
      return true;
    }).catch(error => { console.error("Could not finalize giveaway:", error.message); return false; });
    if (!claimed) continue;
  }

  // A failed send leaves a durable pending announcement which is retried after restart.
  const pending = await db.collection("giveaways").where("announcementStatus", "==", "pending").get()
    .catch(error => { console.error("Giveaway announcement scan failed:", error.message); return null; });
  if (!pending) return;
  for (const doc of pending.docs) {
    const giveaway = { id: doc.id, ...doc.data() };
    const channel = await client.channels.fetch(giveaway.channelId).catch(() => null);
    if (!channel?.isTextBased()) {
      await doc.ref.update({ announcementAttempts: require("firebase-admin/firestore").FieldValue.increment(1), lastAnnouncementError: "Announcement channel unavailable" }).catch(() => {});
      continue;
    }
    const content = giveaway.winnerId
      ? "🎉 Giveaway ended! Prize: **" + String(giveaway.prize || "Prize").slice(0, 150) + "**\\nWinner: <@" + giveaway.winnerId + ">\\nGiveaway ID: `" + giveaway.id + "`"
      : "Giveaway ended with no entries. Prize: **" + String(giveaway.prize || "Prize").slice(0, 150) + "**\\nGiveaway ID: `" + giveaway.id + "`";
    try {
      await channel.send({ content });
      await doc.ref.update({ announcementStatus: "sent", announcementSentAt: new Date(), announcementAttempts: require("firebase-admin/firestore").FieldValue.increment(1), lastAnnouncementError: null });
    } catch (error) {
      await doc.ref.update({ announcementAttempts: require("firebase-admin/firestore").FieldValue.increment(1), lastAnnouncementError: String(error.message || error).slice(0, 500) }).catch(() => {});
      console.error("Could not announce giveaway result; will retry:", error.message);
    }
  }
}

let giveawayWorkerRunning = false;
async function processDueGiveaways(client) {
  if (giveawayWorkerRunning) return;
  giveawayWorkerRunning = true;
  try { await processDueGiveawaysInternal(client); }
  finally { giveawayWorkerRunning = false; }
}

function startGiveawayWorker(client) {
  if (global.__theDcGiveawayWorker) return;
  processDueGiveaways(client);
  global.__theDcGiveawayWorker = setInterval(() => processDueGiveaways(client), 15000);
  if (typeof global.__theDcGiveawayWorker.unref === "function") global.__theDcGiveawayWorker.unref();
}

module.exports = { createGiveaway, getDueGiveaways, markGiveawayEnded, joinGiveaway, processDueGiveaways, startGiveawayWorker };
