import { NextResponse } from "next/server";
import { cert, getApps, initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";

export const dynamic = "force-dynamic";

function getAdminDb() {
  const raw = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
  if (!raw) throw new Error("Firebase Admin credentials are not configured.");
  const account = JSON.parse(raw);
  if (!account.project_id || !account.client_email || !account.private_key) {
    throw new Error("Firebase service account is incomplete.");
  }
  account.private_key = account.private_key.replace(/\\n/g, "\n");
  const app = getApps().find(item => item.name === "dashboard-health")
    || initializeApp({ credential: cert(account), projectId: account.project_id }, "dashboard-health");
  return getFirestore(app);
}

export async function GET() {
  let firebase = "not_configured";
  let bot = "unknown";
  try {
    const db = getAdminDb();
    const snapshot = await db.collection("_health").doc("connection").get();
    firebase = "connected";
    if (snapshot.exists) {
      const checkedAt = Date.parse(snapshot.data()?.checkedAt || "");
      if (Number.isFinite(checkedAt) && Date.now() - checkedAt <= 90000) {
        bot = "online";
      } else {
        bot = "offline";
      }
    } else {
      bot = "offline";
    }
  } catch (error) {
    firebase = process.env.FIREBASE_SERVICE_ACCOUNT_JSON ? "unavailable" : "not_configured";
  }

  return NextResponse.json({ firebase, bot, checkedAt: new Date().toISOString() }, {
    headers: { "Cache-Control": "no-store, max-age=0" }
  });
}
