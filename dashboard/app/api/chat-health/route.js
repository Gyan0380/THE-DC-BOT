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
export async function GET(request) {
  const guildId = new URL(request.url).searchParams.get("guildId");
  const session = await getSession();
  if (!guildId || !session?.guilds?.some(g => g.id === guildId)) return NextResponse.json({ error: "Sign in and select a server you manage." }, { status: 403 });
  try {
    const snapshots = await db().collection("chatHealthSnapshots").where("guildId", "==", guildId).limit(30).get();
    const docs = snapshots.docs.sort((a,b) => String(b.data().date || "").localeCompare(String(a.data().date || "")));
    const latest = docs[0]?.data() || null;
    const users = Array.isArray(latest?.users) ? latest.users.map(u => ({
      userId: String(u.userId || ""), messages7d: Number(u.messages7d || 0),
      activeDays: Number(u.activeDays || 0),
      lastMessageAt: u.lastMessageAt?.toDate ? u.lastMessageAt.toDate().toISOString() : (typeof u.lastMessageAt === "string" ? u.lastMessageAt : null)
    })).sort((a,b) => b.messages7d-a.messages7d).slice(0, 50) : [];
    return NextResponse.json({ date: latest?.date || null, users, snapshotCount: docs.length }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) { return NextResponse.json({ error: "Could not load chat health: " + error.message }, { status: 500 }); }
}
