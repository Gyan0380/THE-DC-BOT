import { NextResponse } from "next/server";
import { getSession } from "../../../lib/session";
import { cert, getApps, initializeApp } from "firebase-admin/app";
import { FieldValue, getFirestore } from "firebase-admin/firestore";

export const dynamic = "force-dynamic";
function db() {
  const raw = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
  if (!raw) throw new Error("Firebase Admin credentials are not configured.");
  const key = JSON.parse(raw); key.private_key = key.private_key.replace(/\\n/g, "\n");
  const app = getApps().find(a => a.name === "dashboard-admin") || initializeApp({ credential: cert(key), projectId: key.project_id }, "dashboard-admin");
  return getFirestore(app);
}
export async function POST(request) {
  const session = await getSession(), body = await request.json().catch(() => ({}));
  const { guildId, userId, reason } = body, amount = Number(body.amount);
  if (!guildId || !session?.guilds?.some(g => g.id === guildId)) return NextResponse.json({ error: "Sign in and select a server you manage." }, { status: 403 });
  if (!/^\d{17,20}$/.test(String(userId || ""))) return NextResponse.json({ error: "Enter a valid Discord member ID." }, { status: 400 });
  if (!Number.isInteger(amount) || amount < 1 || amount > 100) return NextResponse.json({ error: "Points must be 1–100." }, { status: 400 });
  if (!String(reason || "").trim()) return NextResponse.json({ error: "A reason is required." }, { status: 400 });
  try {
    const firestore = db(), profileRef = firestore.collection("memberProfiles").doc(guildId + "_" + userId);
    await profileRef.set({ guildId, userId, moderationPoints: FieldValue.increment(amount), updatedAt: new Date() }, { merge: true });
    await firestore.collection("moderationPointsEvents").add({ guildId, userId, moderatorId: session.user?.id || "dashboard", amount, reason: String(reason).trim().slice(0, 500), createdAt: new Date() });
    await firestore.collection("modlogs").add({ guildId, action: "points_add", userId, moderatorId: session.user?.id || "dashboard", moderatorName: session.user?.username || "Dashboard moderator", reason: String(reason).trim().slice(0, 500), points: amount, status: "completed", createdAt: new Date() });
    const snap = await profileRef.get();
    return NextResponse.json({ ok: true, total: Number(snap.data()?.moderationPoints || 0) });
  } catch (error) { return NextResponse.json({ error: "Could not save moderation points: " + error.message }, { status: 500 }); }
}
