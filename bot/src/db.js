const { initializeApp, cert, getApps } = require("firebase-admin/app");
const { getFirestore } = require("firebase-admin/firestore");

let database;

function parseServiceAccount() {
  const raw = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
  if (!raw) {
    throw new Error("FIREBASE_SERVICE_ACCOUNT_JSON is missing. Add your Firebase service-account JSON as a Railway variable.");
  }
  try {
    const account = JSON.parse(raw);
    if (!account.project_id || !account.client_email || !account.private_key) {
      throw new Error("service account JSON is missing project_id, client_email, or private_key");
    }
    account.private_key = account.private_key.replace(/\\n/g, "\n");
    return account;
  } catch (error) {
    throw new Error("FIREBASE_SERVICE_ACCOUNT_JSON must contain valid service-account JSON: " + error.message);
  }
}

async function connectDb() {
  if (database) return database;
  const serviceAccount = parseServiceAccount();
  const appName = "the-dc-bot";
  const existing = getApps().find(app => app.name === appName);
  const app = existing || initializeApp({ credential: cert(serviceAccount), projectId: serviceAccount.project_id }, appName);
  database = getFirestore(app);
  const healthRef = database.collection("_health").doc("connection");
  const heartbeat = async () => {
    await healthRef.set({
      service: "the-dc-bot",
      checkedAt: new Date().toISOString()
    }, { merge: true });
  };
  await heartbeat();
  // Keep a live heartbeat so the dashboard can distinguish a running bot
  // from a stale startup record. Do not keep Node alive just for this timer.
  const timer = setInterval(() => {
    heartbeat().catch(error => console.error("Bot heartbeat failed:", error.message));
  }, 30000);
  if (typeof timer.unref === "function") timer.unref();
  console.log("Connected to Firebase Cloud Firestore project:", serviceAccount.project_id);
  return database;
}

function getDb() {
  if (!database) throw new Error("Firebase Firestore is not connected");
  return database;
}

async function closeDb() {
  database = undefined;
}

module.exports = { connectDb, getDb, closeDb };
