const { getDb } = require("./db");

const now = () => new Date();
const safeText = (value, max = 500) => String(value || "").trim().slice(0, max);

async function getProfile(guildId, userId) {
  const ref = getDb().collection("memberProfiles").doc(guildId + "_" + userId);
  const snap = await ref.get();
  if (snap.exists) return { id: snap.id, ...snap.data() };
  const profile = { guildId, userId, reputation: 0, messages: 0, createdAt: now(), updatedAt: now() };
  await ref.set(profile, { merge: true });
  return { id: ref.id, ...profile };
}

async function changeReputation({ guildId, userId, moderatorId, amount, reason }) {
  const n = Number(amount);
  if (!Number.isInteger(n) || n < -100 || n > 100 || n === 0) throw new Error("Reputation change must be an integer from -100 to 100, excluding zero.");
  const ref = getDb().collection("memberProfiles").doc(guildId + "_" + userId);
  await getDb().runTransaction(async tx => {
    const snap = await tx.get(ref);
    const current = snap.exists ? snap.data() : { guildId, userId, reputation: 0, messages: 0, createdAt: now() };
    tx.set(ref, { ...current, reputation: Math.max(-100000, Math.min(100000, Number(current.reputation || 0) + n)), updatedAt: now() }, { merge: true });
  });
  await getDb().collection("reputationEvents").add({ guildId, userId, moderatorId, amount: n, reason: safeText(reason, 500), createdAt: now() });
  return getProfile(guildId, userId);
}

async function addModerationPoints({ guildId, userId, moderatorId, amount, reason }) {
  const n = Number(amount);
  if (!Number.isInteger(n) || n < 1 || n > 100) throw new Error("Points must be an integer from 1 to 100.");
  const db = getDb(), ref = db.collection("memberProfiles").doc(guildId + "_" + userId);
  await ref.set({ guildId, userId, moderationPoints: require("firebase-admin/firestore").FieldValue.increment(n), updatedAt: now() }, { merge: true });
  await db.collection("moderationPointsEvents").add({ guildId, userId, moderatorId, amount: n, reason: safeText(reason, 500), createdAt: now() });
  const snap = await ref.get();
  return Number(snap.data()?.moderationPoints || 0);
}

async function createParty({ guild, owner, name, description, maxMembers, temporaryMinutes }) {
  const db = getDb();
  const settingsSnap = await db.collection("guildSettings").doc(guild.id).get();
  const settings = settingsSnap.exists ? settingsSnap.data().settings || {} : {};
  const parentId = settings.partyCategoryId || null;
  const overwrites = [
    { id: guild.roles.everyone.id, deny: ["ViewChannel"] },
    { id: owner.id, allow: ["ViewChannel", "SendMessages", "ReadMessageHistory", "Connect", "Speak"] }
  ];
  const channel = await guild.channels.create({
    name: ("party-" + safeText(name, 60).toLowerCase().replace(/[^a-z0-9-]+/g, "-").replace(/^-|-$/g, "")).slice(0, 90) || "party",
    type: 0,
    parent: parentId || undefined,
    topic: safeText(description, 900) || "Private party channel managed by THE DC BOT",
    permissionOverwrites: overwrites,
    reason: "THE DC BOT party created by " + owner.tag
  });
  const expiresAt = temporaryMinutes > 0 ? new Date(Date.now() + temporaryMinutes * 60000) : null;
  const ref = await db.collection("parties").add({
    guildId: guild.id, channelId: channel.id, ownerId: owner.id, name: safeText(name, 80),
    description: safeText(description, 900), maxMembers: Math.max(2, Math.min(50, Number(maxMembers) || 5)),
    memberIds: [owner.id], status: "active", temporary: Boolean(expiresAt), expiresAt,
    lastActiveAt: now(), createdAt: now()
  });
  return { id: ref.id, channel, expiresAt };
}

async function touchParty(channel) {
  const match = String(channel?.topic || "").match(/Party ID:\s*([A-Za-z0-9_-]+)/i);
  if (!match) return false;
  const ref = getDb().collection("parties").doc(match[1]);
  const snap = await ref.get();
  if (!snap.exists || snap.data().status !== "active" || snap.data().channelId !== channel.id) return false;
  await ref.update({ lastActiveAt: now(), inactivityWarningAt: null });
  return true;
}

async function findParty(guildId, channelId) {
  const snap = await getDb().collection("parties").where("guildId", "==", guildId).limit(200).get();
  const doc = snap.docs.find(d => d.data().channelId === channelId && d.data().status === "active");
  return doc ? { ref: doc.ref, id: doc.id, ...doc.data() } : null;
}

async function joinParty(guild, userId, partyId) {
  const ref = getDb().collection("parties").doc(partyId);
  return getDb().runTransaction(async tx => {
    const snap = await tx.get(ref);
    if (!snap.exists || snap.data().guildId !== guild.id || snap.data().status !== "active") throw new Error("Active party not found.");
    const data = snap.data(), members = Array.isArray(data.memberIds) ? data.memberIds : [];
    if (members.includes(userId)) return { ...data, alreadyMember: true };
    if (members.length >= Number(data.maxMembers || 5)) throw new Error("This party is full.");
    tx.update(ref, { memberIds: [...members, userId], lastActiveAt: now() });
    return { ...data, memberIds: [...members, userId] };
  });
}

async function leaveParty(guildId, userId, partyId) {
  const ref = getDb().collection("parties").doc(partyId);
  return getDb().runTransaction(async tx => {
    const snap = await tx.get(ref);
    if (!snap.exists || snap.data().guildId !== guildId || snap.data().status !== "active") throw new Error("Active party not found.");
    const data = snap.data();
    if (data.ownerId === userId) throw new Error("The party owner must use /party close.");
    tx.update(ref, { memberIds: (data.memberIds || []).filter(id => id !== userId), lastActiveAt: now() });
    return data;
  });
}

async function closeParty(guild, userId, partyId) {
  const ref = getDb().collection("parties").doc(partyId);
  const snap = await ref.get();
  if (!snap.exists || snap.data().guildId !== guild.id || snap.data().status !== "active") throw new Error("Active party not found.");
  if (snap.data().ownerId !== userId && !guild.members.cache.get(userId)?.permissions.has("ManageChannels")) throw new Error("Only the party owner or a channel manager can close this party.");
  await ref.update({ status: "closed", closedAt: now() });
  const channel = await guild.channels.fetch(snap.data().channelId).catch(() => null);
  if (channel) await channel.delete("Party closed through THE DC BOT").catch(() => {});
  return snap.data();
}

async function createMission({ guildId, channelId, creatorId, title, description, goal }) {
  const target = Number(goal);
  if (!Number.isInteger(target) || target < 1 || target > 1000000) throw new Error("Goal must be between 1 and 1,000,000.");
  const ref = await getDb().collection("missions").add({
    guildId, channelId: channelId || null, creatorId, title: safeText(title, 100),
    description: safeText(description, 900), goal: target, progress: 0, participantIds: [creatorId],
    status: "active", createdAt: now(), updatedAt: now()
  });
  return { id: ref.id, goal: target };
}

async function missionProgress({ guildId, missionId, userId, amount }) {
  const n = Number(amount);
  if (!Number.isInteger(n) || n < 1 || n > 100000) throw new Error("Progress amount must be 1–100000.");
  const ref = getDb().collection("missions").doc(missionId);
  return getDb().runTransaction(async tx => {
    const snap = await tx.get(ref);
    if (!snap.exists || snap.data().guildId !== guildId || snap.data().status !== "active") throw new Error("Active mission not found.");
    const data = snap.data(), progress = Math.min(Number(data.goal), Number(data.progress || 0) + n);
    const participants = Array.isArray(data.participantIds) ? data.participantIds : [];
    tx.update(ref, { progress, participantIds: participants.includes(userId) ? participants : [...participants, userId], status: progress >= Number(data.goal) ? "completed" : "active", updatedAt: now(), ...(progress >= Number(data.goal) ? { completedAt: now() } : {}) });
    return { ...data, progress, status: progress >= Number(data.goal) ? "completed" : "active" };
  });
}

async function listActiveMissions(guildId) {
  const snap = await getDb().collection("missions").where("guildId", "==", guildId).limit(100).get();
  return snap.docs.map(d => ({ id: d.id, ...d.data() })).filter(d => d.status === "active").slice(0, 20);
}

async function recordChatHealth(message) {
  const db = getDb(), date = new Date().toISOString().slice(0, 10);
  const ref = db.collection("chatHealthDaily").doc(message.guildId + "_" + message.author.id + "_" + date);
  await ref.set({
    guildId: message.guildId, userId: message.author.id, date,
    messages: require("firebase-admin/firestore").FieldValue.increment(1),
    lastMessageAt: now(), updatedAt: now()
  }, { merge: true });
  const profileRef = db.collection("memberProfiles").doc(message.guildId + "_" + message.author.id);
  await profileRef.set({
    guildId: message.guildId, userId: message.author.id,
    messages: require("firebase-admin/firestore").FieldValue.increment(1),
    updatedAt: now(), lastSeenAt: now()
  }, { merge: true });
}

async function snapshotChatHealth(guildId) {
  const db = getDb();
  const snap = await db.collection("chatHealthDaily").where("guildId", "==", guildId).limit(1000).get();
  const today = new Date().toISOString().slice(0, 10);
  const byUser = new Map();
  for (const doc of snap.docs) {
    const d = doc.data();
    if (!d.userId || !d.date || d.date > today) continue;
    const row = byUser.get(d.userId) || { userId: d.userId, messages7d: 0, activeDays: 0, lastMessageAt: null };
    if (Date.now() - Date.parse(d.date + "T00:00:00Z") <= 7 * 86400000) row.messages7d += Number(d.messages || 0);
    if (Date.now() - Date.parse(d.date + "T00:00:00Z") <= 7 * 86400000) row.activeDays += 1;
    const t = d.lastMessageAt?.toDate ? d.lastMessageAt.toDate() : new Date(d.lastMessageAt || 0);
    if (!row.lastMessageAt || t > row.lastMessageAt) row.lastMessageAt = t;
    byUser.set(d.userId, row);
  }
  const batch = db.batch();
  const snapshotRef = db.collection("chatHealthSnapshots").doc(guildId + "_" + today);
  batch.set(snapshotRef, { guildId, date: today, users: Array.from(byUser.values()).map(r => ({ ...r, lastMessageAt: r.lastMessageAt || null })), createdAt: now() });
  await batch.commit();
  // Keep only the newest seven daily snapshots per guild; operational data is never auto-deleted here.
  const old = await db.collection("chatHealthSnapshots").where("guildId", "==", guildId).get();
  const ordered = old.docs.sort((a, b) => String(b.data().date || "").localeCompare(String(a.data().date || "")));
  await Promise.all(ordered.slice(7).map(d => d.ref.delete()));
  return Array.from(byUser.values()).sort((a, b) => b.messages7d - a.messages7d).slice(0, 20);
}

async function saveCompanionQuestion({ guildId, userId, question, answer }) {
  const ref = await getDb().collection("companionQuestions").add({
    guildId, userId, question: safeText(question, 1500), answer: safeText(answer, 1800),
    createdAt: now(), expiresAt: new Date(Date.now() + 24 * 3600000), status: "active"
  });
  return ref.id;
}

async function getCompanionRecap(guildId, userId) {
  const snap = await getDb().collection("companionQuestions").where("guildId", "==", guildId).limit(500).get();
  return snap.docs.map(d => ({ id: d.id, ...d.data() })).filter(d => d.userId === userId && d.status === "active" && (d.expiresAt?.toDate ? d.expiresAt.toDate().getTime() : Date.parse(d.expiresAt)) > Date.now()).sort((a,b) => (b.createdAt?.toDate ? b.createdAt.toDate().getTime() : 0) - (a.createdAt?.toDate ? a.createdAt.toDate().getTime() : 0)).slice(0, 10);
}

async function runCommunityMaintenance(client) {
  const db = getDb();
  const parties = await db.collection("parties").where("status", "==", "active").get().catch(() => null);
  if (parties) for (const doc of parties.docs) {
    const data = doc.data();
    const expiry = data.expiresAt?.toDate ? data.expiresAt.toDate().getTime() : Date.parse(data.expiresAt || "");
    const lastActive = data.lastActiveAt?.toDate ? data.lastActiveAt.toDate().getTime() : Date.parse(data.lastActiveAt || data.createdAt || 0);
    const isTemporaryExpired = Boolean(data.temporary) && Number.isFinite(expiry) && expiry <= Date.now();
    const inactiveFor = Date.now() - (Number.isFinite(lastActive) ? lastActive : Date.now());
    const inactiveExpired = !data.temporary && inactiveFor >= 7 * 86400000;
    const shouldWarn = !data.temporary && inactiveFor >= 3 * 86400000 && !data.inactivityWarningAt;
    const guild = await client.guilds.fetch(data.guildId).catch(() => null);
    const channel = guild && await guild.channels.fetch(data.channelId).catch(() => null);
    if (shouldWarn) {
      if (channel?.isTextBased()) await channel.send("Party inactivity notice: this party has been quiet for 3 days. Send a message to keep it active; inactive owner-managed parties close after 7 days.").catch(() => {});
      await doc.ref.update({ inactivityWarningAt: now() }).catch(() => {});
    }
    if (!isTemporaryExpired && !inactiveExpired) continue;
    await doc.ref.update({ status: isTemporaryExpired ? "expired" : "closed", closedAt: now(), closeReason: isTemporaryExpired ? "temporary_expiry" : "inactive_7_days" }).catch(() => {});
    if (channel) await channel.delete(isTemporaryExpired ? "Temporary party expired" : "Inactive party auto-closed after seven days").catch(() => {});
  }
  const qna = await db.collection("companionQuestions").where("status", "==", "active").get().catch(() => null);
  if (qna) for (const doc of qna.docs) {
    const expiry = doc.data().expiresAt?.toDate ? doc.data().expiresAt.toDate().getTime() : Date.parse(doc.data().expiresAt || "");
    if (Number.isFinite(expiry) && expiry <= Date.now()) await doc.ref.delete().catch(() => {});
  }
  for (const guild of client.guilds.cache.values()) {
    const today = new Date().toISOString().slice(0, 10);
    const snapRef = db.collection("chatHealthSnapshots").doc(guild.id + "_" + today);
    const exists = await snapRef.get().catch(() => null);
    if (!exists?.exists) await snapshotChatHealth(guild.id).catch(error => console.error("Chat health snapshot failed:", error.message));
  }
}

function startCommunityWorkers(client) {
  if (global.__theDcCommunityWorker) return;
  const run = () => runCommunityMaintenance(client).catch(error => console.error("Community maintenance failed:", error.message));
  run();
  global.__theDcCommunityWorker = setInterval(run, 5 * 60 * 1000);
  if (typeof global.__theDcCommunityWorker.unref === "function") global.__theDcCommunityWorker.unref();
}

module.exports = { getProfile, changeReputation, addModerationPoints, createParty, touchParty, findParty, joinParty, leaveParty, closeParty, createMission, missionProgress, listActiveMissions, recordChatHealth, snapshotChatHealth, saveCompanionQuestion, getCompanionRecap, startCommunityWorkers, runCommunityMaintenance };
