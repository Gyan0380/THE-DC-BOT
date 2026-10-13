import { NextResponse } from "next/server";
import { getSession } from "../../../lib/session";
import { cert, getApps, initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";

export const dynamic = "force-dynamic";
function db() {
  const raw = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
  if (!raw) throw new Error("Firebase Admin credentials are not configured.");
  const key = JSON.parse(raw); key.private_key = key.private_key.replace(/\\n/g, "\n");
  const app = getApps().find(a => a.name === "dashboard-admin") || initializeApp({ credential: cert(key), projectId: key.project_id }, "dashboard-admin");
  return getFirestore(app);
}
async function context(guildId) {
  const session = await getSession();
  const guild = session?.guilds?.find(g => g.id === guildId);
  if (!guild) return null;
  return { session, guild };
}
async function botRequest(path, init = {}) {
  const token = process.env.DISCORD_TOKEN;
  if (!token) throw new Error("DISCORD_TOKEN is not configured in Vercel.");
  const response = await fetch("https://discord.com/api/v10" + path, { ...init, headers: { Authorization: "Bot " + token, "Content-Type": "application/json", ...(init.headers || {}) }, cache: "no-store" });
  const data = response.status === 204 ? {} : await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.message || "Discord API request failed (HTTP " + response.status + ").");
  return data;
}
export async function GET(request) {
  const guildId = new URL(request.url).searchParams.get("guildId");
  if (!await context(guildId)) return NextResponse.json({ error: "Sign in and select a server you manage." }, { status: 403 });
  try {
    const firestore = db();
    const [partySnap, missionSnap] = await Promise.all([
      firestore.collection("parties").where("guildId", "==", guildId).limit(200).get(),
      firestore.collection("missions").where("guildId", "==", guildId).limit(200).get()
    ]);
    const serialize = (d) => {
      const x = d.data();
      const date = v => v?.toDate ? v.toDate().toISOString() : v instanceof Date ? v.toISOString() : typeof v === "string" ? v : null;
      return { id: d.id, ...x, createdAt: date(x.createdAt), updatedAt: date(x.updatedAt), expiresAt: date(x.expiresAt), lastActiveAt: date(x.lastActiveAt) };
    };
    const settingsSnap = await firestore.collection("guildSettings").doc(guildId).get();
    const settings = settingsSnap.exists ? settingsSnap.data().settings || {} : {};
    return NextResponse.json({
      parties: partySnap.docs.map(serialize).filter(x => x.status === "active").sort((a,b) => Date.parse(b.createdAt || 0)-Date.parse(a.createdAt || 0)).slice(0,50),
      missions: missionSnap.docs.map(serialize).filter(x => x.status === "active").sort((a,b) => Date.parse(b.createdAt || 0)-Date.parse(a.createdAt || 0)).slice(0,50),
      partyLfgChannelId: settings.partyLfgChannelId || ""
    }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) { return NextResponse.json({ error: "Could not load community data: " + error.message }, { status: 500 }); }
}
export async function POST(request) {
  const body = await request.json().catch(() => ({}));
  const { guildId, action } = body;
  const ctx = await context(guildId);
  if (!ctx) return NextResponse.json({ error: "Sign in and select a server you manage." }, { status: 403 });
  try {
    const firestore = db();
    if (action === "configure-party-finder") {
      const channelId = String(body.channelId || "");
      const channels = await botRequest("/guilds/" + encodeURIComponent(guildId) + "/channels");
      const channel = channels.find(c => c.id === channelId && [0,5].includes(c.type));
      if (!channel) return NextResponse.json({ error: "Choose a text or announcement channel in this server." }, { status: 400 });
      const ref = firestore.collection("guildSettings").doc(guildId), snap = await ref.get();
      const settings = snap.exists ? snap.data().settings || {} : {};
      await ref.set({ guildId, settings: { ...settings, partyLfgChannelId: channelId }, updatedAt: new Date().toISOString() }, { merge: true });
      return NextResponse.json({ ok: true, channelId });
    }
    if (action === "mission-progress") {
      const missionId = String(body.missionId || ""), amount = Number(body.amount || 1);
      if (!Number.isInteger(amount) || amount < 1 || amount > 100000) return NextResponse.json({ error: "Progress must be 1–100000." }, { status: 400 });
      const ref = firestore.collection("missions").doc(missionId);
      const result = await firestore.runTransaction(async tx => {
        const snap = await tx.get(ref);
        if (!snap.exists || snap.data().guildId !== guildId || snap.data().status !== "active") throw new Error("Active mission not found.");
        const data = snap.data(), progress = Math.min(Number(data.goal), Number(data.progress || 0) + amount);
        const participants = Array.isArray(data.participantIds) ? data.participantIds : [];
        tx.update(ref, { progress, participantIds: participants.includes(ctx.session.user.id) ? participants : [...participants, ctx.session.user.id], status: progress >= Number(data.goal) ? "completed" : "active", updatedAt: new Date(), ...(progress >= Number(data.goal) ? { completedAt: new Date() } : {}) });
        return { ...data, progress, status: progress >= Number(data.goal) ? "completed" : "active" };
      });
      if (result.channelId) await botRequest("/channels/" + encodeURIComponent(result.channelId) + "/messages", { method: "POST", body: JSON.stringify({ content: "Mission **" + result.title + "** progress: **" + result.progress + "/" + result.goal + "**" + (result.status === "completed" ? "\nMission completed!" : "") }) }).catch(() => null);
      return NextResponse.json({ ok: true, progress: result.progress, goal: result.goal, status: result.status });
    }
    if (action === "create-mission") {
      const title = String(body.title || "").trim(), description = String(body.description || "").trim();
      const goal = Number(body.goal), channelId = String(body.channelId || "");
      if (!title || title.length > 100 || !description || description.length > 900) return NextResponse.json({ error: "Enter a title (max 100) and description (max 900)." }, { status: 400 });
      if (!Number.isInteger(goal) || goal < 1 || goal > 1000000) return NextResponse.json({ error: "Mission goal must be 1–1000000." }, { status: 400 });
      const channels = await botRequest("/guilds/" + encodeURIComponent(guildId) + "/channels");
      const channel = channels.find(c => c.id === channelId && [0,5].includes(c.type));
      if (!channel) return NextResponse.json({ error: "Choose a text or announcement channel in this server." }, { status: 400 });
      const ref = await firestore.collection("missions").add({ guildId, channelId, creatorId: ctx.session.user.id, title, description, goal, progress: 0, participantIds: [ctx.session.user.id], status: "active", createdAt: new Date(), updatedAt: new Date(), source: "dashboard" });
      await botRequest("/channels/" + encodeURIComponent(channelId) + "/messages", { method: "POST", body: JSON.stringify({ content: "**Community mission started**\n" + title + "\n" + description + "\nGoal: " + goal + "\nMission ID: " + ref.id + "\nContribute with /mission-progress." }) });
      return NextResponse.json({ ok: true, id: ref.id });
    }
    if (action === "create-party") {
      const name = String(body.name || "").trim(), description = String(body.description || "").trim();
      const maxMembers = Number(body.maxMembers || 5), temporaryMinutes = Number(body.temporaryMinutes || 0);
      if (!name || name.length > 60 || description.length > 900) return NextResponse.json({ error: "Enter a party name (max 60) and description (max 900)." }, { status: 400 });
      if (!Number.isInteger(maxMembers) || maxMembers < 2 || maxMembers > 50) return NextResponse.json({ error: "Max members must be 2–50." }, { status: 400 });
      if (temporaryMinutes && (!Number.isInteger(temporaryMinutes) || temporaryMinutes < 1 || temporaryMinutes > 10080)) return NextResponse.json({ error: "Temporary duration must be 1–10080 minutes, or 0 for owner-managed." }, { status: 400 });
      const settingsSnap = await firestore.collection("guildSettings").doc(guildId).get();
      const settings = settingsSnap.exists ? settingsSnap.data().settings || {} : {};
      const slug = ("party-" + name.toLowerCase().replace(/[^a-z0-9-]+/g, "-").replace(/^-|-$/g, "")).slice(0, 90) || "party";
      const channel = await botRequest("/guilds/" + encodeURIComponent(guildId) + "/channels", { method: "POST", body: JSON.stringify({
        name: slug, type: 0, parent_id: settings.partyCategoryId || undefined,
        topic: description || "Private party managed by THE DC BOT",
        permission_overwrites: [
          { id: guildId, type: 0, deny: "1024" },
          { id: ctx.session.user.id, type: 1, allow: "3214336" }
        ]
      }) });
      const expiresAt = temporaryMinutes ? new Date(Date.now() + temporaryMinutes * 60000) : null;
      const ref = await firestore.collection("parties").add({ guildId, channelId: channel.id, ownerId: ctx.session.user.id, name, description, maxMembers, memberIds: [ctx.session.user.id], status: "active", temporary: Boolean(expiresAt), expiresAt, lastActiveAt: new Date(), createdAt: new Date(), source: "dashboard" });
      await botRequest("/channels/" + encodeURIComponent(channel.id), { method: "PATCH", body: JSON.stringify({ topic: (description ? description + " | " : "") + "Party ID: " + ref.id + " | Owner: " + ctx.session.user.id }) }).catch(() => null);
      await botRequest("/channels/" + encodeURIComponent(channel.id) + "/messages", { method: "POST", body: JSON.stringify({ content: "**" + name + "**\n" + (description || "Community party") + "\nParty ID: " + ref.id + "\nOwner: <@" + ctx.session.user.id + ">\nMembers: 1/" + maxMembers + "\nUse /party-join to join." }) }).catch(() => null);
      if (settings.partyLfgChannelId) await botRequest("/channels/" + encodeURIComponent(settings.partyLfgChannelId) + "/messages", { method: "POST", body: JSON.stringify({ content: "**New party: " + name + "**\nChannel: <#" + channel.id + ">\nParty ID: " + ref.id + "\nUse /party-join to join." }) }).catch(() => null);
      return NextResponse.json({ ok: true, id: ref.id, channelId: channel.id });
    }
    if (action === "close-party") {
      const partyId = String(body.partyId || ""), ref = firestore.collection("parties").doc(partyId), snap = await ref.get();
      if (!snap.exists || snap.data().guildId !== guildId || snap.data().status !== "active") return NextResponse.json({ error: "Active party not found." }, { status: 404 });
      if (snap.data().ownerId !== ctx.session.user.id && !ctx.guild.owner) return NextResponse.json({ error: "Only the party owner or server owner can close this party from the dashboard." }, { status: 403 });
      await ref.update({ status: "closed", closedAt: new Date(), closeReason: "dashboard" });
      await botRequest("/channels/" + encodeURIComponent(snap.data().channelId), { method: "DELETE" }).catch(() => null);
      return NextResponse.json({ ok: true });
    }
    return NextResponse.json({ error: "Unsupported community action." }, { status: 400 });
  } catch (error) { return NextResponse.json({ error: "Community action failed: " + error.message }, { status: 500 }); }
}
