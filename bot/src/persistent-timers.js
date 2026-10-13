const { getDb } = require("./db");
const { EmbedBuilder } = require("discord.js");

// Persistent timers use absolute Firestore timestamps; process memory is never the source of truth.
const COLLECTION = "scheduledActions";
let runner = null;
let running = false;

async function scheduleAction({ guildId, userId, action, executeAt, moderatorId, reason }) {
  const at = executeAt instanceof Date ? executeAt : new Date(executeAt);
  if (!Number.isFinite(at.getTime())) throw new Error("A valid executeAt timestamp is required");
  const ref = await getDb().collection(COLLECTION).add({
    guildId, userId, action, moderatorId: moderatorId || null,
    reason: reason || "Scheduled action expired",
    executeAt: at, status: "pending", createdAt: new Date(),
    attempts: 0, lastError: null
  });
  return ref.id;
}

async function notifyMember(user, guild, action, reason) {
  try {
    const embed = new EmbedBuilder()
      .setTitle(action === "unban" ? "Temporary ban ended" : "Timeout ended")
      .setDescription(action === "unban"
        ? "Your temporary ban in **" + guild.name + "** has expired. You may rejoin the server."
        : "Your timeout in **" + guild.name + "** has ended.")
      .addFields({ name: "Reason", value: String(reason || "Scheduled punishment expired").slice(0, 900) })
      .setFooter({ text: "THE DC BOT" }).setTimestamp();
    await user.send({ embeds: [embed] });
    return true;
  } catch { return false; }
}

async function processDueActions(client) {
  if (running) return;
  running = true;
  try {
    const now = new Date();
    const snapshot = await getDb().collection(COLLECTION)
      .where("status", "==", "pending").get();
    for (const doc of snapshot.docs) {
      const dueAt = doc.data().executeAt?.toDate ? doc.data().executeAt.toDate() : new Date(doc.data().executeAt);
      if (!Number.isFinite(dueAt.getTime()) || dueAt > now) continue;
      const ref = doc.ref;
      let data = doc.data();
      const claimed = await getDb().runTransaction(async tx => {
        const fresh = await tx.get(ref);
        if (!fresh.exists || fresh.data().status !== "pending") return false;
        tx.update(ref, { status: "processing", claimedAt: new Date(), attempts: (fresh.data().attempts || 0) + 1 });
        data = fresh.data();
        return true;
      }).catch(() => false);
      if (!claimed) continue;
      try {
        const guild = await client.guilds.fetch(data.guildId);
        const user = await client.users.fetch(data.userId);
        if (data.action === "timeout-expire") {
          const member = await guild.members.fetch(data.userId).catch(() => null);
          if (member?.communicationDisabledUntilTimestamp && member.communicationDisabledUntilTimestamp > Date.now()) {
            await ref.update({ status: "pending", executeAt: new Date(member.communicationDisabledUntilTimestamp), lastError: null });
            continue;
          }
          if (member?.communicationDisabledUntilTimestamp) {
            await member.timeout(null, "Scheduled timeout expired");
          }
          const dmSent = await notifyMember(user, guild, "untimeout", data.reason);
          await ref.update({ status: "completed", completedAt: new Date(), dmSent, lastError: null });
          await getDb().collection("modlogs").add({
            guildId: data.guildId, action: "timeout_expired", userId: data.userId,
            username: user.tag, moderatorId: data.moderatorId || client.user.id,
            reason: data.reason, dmSent, status: "completed", createdAt: new Date()
          });
        } else if (data.action === "unban") {
          await guild.members.unban(data.userId, "Scheduled temporary ban expired").catch(async error => {
            // Already unbanned is a successful final state; other failures are retried below.
            const ban = await guild.bans.fetch(data.userId).catch(() => null);
            if (ban) throw error;
          });
          const dmSent = await notifyMember(user, guild, "unban", data.reason);
          await ref.update({ status: "completed", completedAt: new Date(), dmSent, lastError: null });
          await getDb().collection("modlogs").add({
            guildId: data.guildId, action: "unban_expired", userId: data.userId,
            username: user.tag, moderatorId: data.moderatorId || client.user.id,
            reason: data.reason, dmSent, status: "completed", createdAt: new Date()
          });
        } else {
          await ref.update({ status: "failed", completedAt: new Date(), lastError: "Unknown scheduled action: " + data.action });
        }
      } catch (error) {
        const attempts = (data.attempts || 0) + 1;
        await ref.update({
          status: attempts >= 5 ? "failed" : "pending",
          executeAt: new Date(Date.now() + Math.min(attempts * 60000, 15 * 60000)),
          lastError: String(error.message || error).slice(0, 900)
        }).catch(() => {});
        console.error("Scheduled action failed:", doc.id, error.message);
      }
    }
  } catch (error) {
    console.error("Persistent timer scan failed:", error.message);
  } finally {
    running = false;
  }
}

async function cancelScheduledActions({ guildId, userId, action }) {
  const snapshot = await getDb().collection(COLLECTION).where("status", "==", "pending").get();
  const matches = snapshot.docs.filter(doc => {
    const d = doc.data();
    return d.guildId === guildId && d.userId === userId && (!action || d.action === action);
  });
  await Promise.all(matches.map(doc => doc.ref.update({ status: "cancelled", cancelledAt: new Date() })));
  return matches.length;
}

function startPersistentTimers(client) {
  if (runner) return;
  // Recover stale claims left by a hard restart, without deleting historical records.
  getDb().collection(COLLECTION).where("status", "==", "processing").get()
    .then(snapshot => Promise.all(snapshot.docs.map(doc => doc.ref.update({
      status: "pending", executeAt: new Date(), lastError: "Recovered after bot restart"
    }))))
    .catch(error => console.error("Could not recover pending timers:", error.message))
    .finally(() => processDueActions(client));
  runner = setInterval(() => processDueActions(client), 15000);
  if (typeof runner.unref === "function") runner.unref();
}

module.exports = { scheduleAction, cancelScheduledActions, processDueActions, startPersistentTimers };
