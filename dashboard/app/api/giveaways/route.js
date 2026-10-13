import { NextResponse } from "next/server";
import { getSession } from "../../../lib/session";
import { cert, getApps, initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";

export const dynamic = "force-dynamic";

function db() {
  const raw = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
  if (!raw) throw new Error("Firebase Admin credentials are not configured.");
  const key = JSON.parse(raw);
  key.private_key = key.private_key.replace(/\\n/g, "\n");
  const app = getApps().find(a => a.name === "dashboard-admin") || initializeApp({ credential: cert(key), projectId: key.project_id }, "dashboard-admin");
  return getFirestore(app);
}
async function allowed(guildId) {
  const session = await getSession();
  return Boolean(guildId && session?.guilds?.some(g => g.id === guildId));
}

export async function GET(request) {
  const guildId = new URL(request.url).searchParams.get("guildId");
  if (!await allowed(guildId)) return NextResponse.json({ error: "Sign in and select a server you manage." }, { status: 403 });
  try {
    const snap = await db().collection("giveaways").where("guildId", "==", guildId).limit(200).get();
    const giveaways = snap.docs.map(doc => {
      const d = doc.data();
      const date = value => value?.toDate ? value.toDate().toISOString() : value instanceof Date ? value.toISOString() : typeof value === "string" ? value : null;
      return { id: doc.id, prize: String(d.prize || "Prize"), status: d.status || "unknown", channelId: d.channelId || "", participantCount: Array.isArray(d.participantIds) ? d.participantIds.length : 0, endsAt: date(d.endsAt), createdAt: date(d.createdAt), winnerId: d.winnerId || null };
    }).sort((a,b) => Date.parse(b.createdAt || 0) - Date.parse(a.createdAt || 0)).slice(0, 50);
    return NextResponse.json({ giveaways }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) { return NextResponse.json({ error: "Could not load giveaways: " + error.message }, { status: 500 }); }
}

export async function POST(request) {
  const session = await getSession();
  const body = await request.json().catch(() => ({}));
  const { guildId, channelId, prize } = body;
  const durationMinutes = Number(body.durationMinutes);
  if (!guildId || !session?.guilds?.some(g => g.id === guildId)) return NextResponse.json({ error: "Sign in and select a server you manage." }, { status: 403 });
  if (!/^\d{17,20}$/.test(String(channelId || ""))) return NextResponse.json({ error: "Choose a valid giveaway channel." }, { status: 400 });
  if (!String(prize || "").trim() || String(prize).trim().length > 150) return NextResponse.json({ error: "Prize is required (maximum 150 characters)." }, { status: 400 });
  if (!Number.isInteger(durationMinutes) || durationMinutes < 1 || durationMinutes > 10080) return NextResponse.json({ error: "Duration must be 1–10080 minutes." }, { status: 400 });
  const token = process.env.DISCORD_TOKEN;
  if (!token) return NextResponse.json({ error: "DISCORD_TOKEN is not configured in Vercel." }, { status: 503 });
  try {
    const channelsResponse = await fetch("https://discord.com/api/v10/guilds/" + encodeURIComponent(guildId) + "/channels", { headers: { Authorization: "Bot " + token }, cache: "no-store" });
    if (!channelsResponse.ok) return NextResponse.json({ error: "Bot cannot list channels for this server. Check its membership and permissions." }, { status: 502 });
    const channels = await channelsResponse.json();
    const channel = channels.find(c => c.id === channelId && [0, 5].includes(c.type));
    if (!channel) return NextResponse.json({ error: "The selected channel is not a text or announcement channel in this server." }, { status: 400 });
    const firestore = db();
    const now = new Date(), endsAt = new Date(Date.now() + durationMinutes * 60000);
    const ref = await firestore.collection("giveaways").add({ guildId, channelId, prize: String(prize).trim(), createdBy: session.user?.id || "dashboard", endsAt, status: "active", createdAt: now, winnerId: null, participantIds: [], source: "dashboard" });
    const post = await fetch("https://discord.com/api/v10/channels/" + encodeURIComponent(channelId) + "/messages", {
      method: "POST", headers: { Authorization: "Bot " + token, "Content-Type": "application/json" },
      body: JSON.stringify({ content: "🎉 **GIVEAWAY** 🎉\nPrize: **" + String(prize).trim() + "**\nEnds: <t:" + Math.floor(endsAt.getTime()/1000) + ":R>\nEnter with `/giveaway-join giveaway_id:" + ref.id + "`\nID: `" + ref.id + "`\nEntries are saved persistently; downtime does not reset the end time." }),
      cache: "no-store"
    });
    if (!post.ok) {
      const detail = await post.json().catch(() => ({}));
      await ref.update({ status: "failed", lastError: String(detail.message || "Discord announcement failed").slice(0, 300) });
      return NextResponse.json({ error: "Giveaway was saved but Discord could not post it. Check Send Messages permission; record is marked failed." }, { status: 502 });
    }
    const postData = await post.json().catch(() => ({}));
    await ref.update({ messageId: postData.id || null });
    return NextResponse.json({ ok: true, id: ref.id, endsAt: endsAt.toISOString(), channelName: channel.name });
  } catch (error) { return NextResponse.json({ error: "Could not create giveaway: " + error.message }, { status: 500 }); }
}
