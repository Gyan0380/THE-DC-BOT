const { getDb } = require("./db");

async function getGuildSettings(guildId) {
  const snap = await getDb().collection("guildSettings").doc(guildId).get();
  return snap.exists ? (snap.data().settings || {}) : {};
}

async function patchGuildSettings(guildId, patch) {
  const ref = getDb().collection("guildSettings").doc(guildId);
  const snap = await ref.get();
  const current = snap.exists ? (snap.data().settings || {}) : {};
  const next = { ...current, ...patch };
  await ref.set({ guildId, settings: next, updatedAt: new Date().toISOString() }, { merge: true });
  return next;
}

module.exports = { getGuildSettings, patchGuildSettings };
