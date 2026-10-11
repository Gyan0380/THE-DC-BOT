import { NextResponse } from "next/server";
import { getSession } from "../../../lib/session";
import { initializeApp, cert, getApps } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";

export const dynamic = "force-dynamic";

function db() {
  const raw = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
  if (!raw) throw new Error("Firebase Admin credentials are not configured.");
  const key = JSON.parse(raw);
  key.private_key = key.private_key.replace(/\\n/g, "\n");
  const app = getApps().find(a => a.name === "dashboard-admin") ||
    initializeApp({ credential: cert(key), projectId: key.project_id }, "dashboard-admin");
  return getFirestore(app);
}

function serializeLog(doc) {
  const data = doc.data();
  let createdAt = null;
  if (data.createdAt?.toDate) createdAt = data.createdAt.toDate().toISOString();
  else if (data.createdAt instanceof Date) createdAt = data.createdAt.toISOString();
  else if (typeof data.createdAt === "string") createdAt = data.createdAt;
  else if (typeof data.createdAt?.seconds === "number") createdAt = new Date(data.createdAt.seconds * 1000).toISOString();
  return {
    id: doc.id, guildId: data.guildId || "", action: data.action || "",
    userId: data.userId || "", username: data.username || "",
    moderatorId: data.moderatorId || "", moderatorName: data.moderatorName || "",
    reason: String(data.reason || "").slice(0, 1200), ruleId: data.ruleId || "",
    status: data.status || "logged", source: data.source || "",
    confidence: typeof data.confidence === "number" ? data.confidence : null,
    durationMinutes: typeof data.durationMinutes === "number" ? data.durationMinutes : null,
    createdAt
  };
}

export async function GET(request) {
  const guildId = new URL(request.url).searchParams.get("guildId");
  const session = await getSession();
  if (!guildId || !session?.guilds?.some(g => g.id === guildId)) {
    return NextResponse.json({ error: "Sign in and select a server you manage." }, { status: 403 });
  }
  try {
    const snapshot = await db().collection("modlogs").where("guildId", "==", guildId).limit(250).get();
    const logs = snapshot.docs.map(serializeLog).sort((a, b) => Date.parse(b.createdAt || 0) - Date.parse(a.createdAt || 0));
    return NextResponse.json({ logs }, { headers: { "Cache-Control": "no-store, max-age=0" } });
  } catch (error) {
    console.error("Could not load guild-scoped moderation logs:", error.message);
    return NextResponse.json({ error: "Could not load moderation logs. Check Firebase configuration and permissions." }, { status: 500 });
  }
}
