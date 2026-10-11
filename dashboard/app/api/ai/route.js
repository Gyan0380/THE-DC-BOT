import { NextResponse } from "next/server";
import crypto from "node:crypto";
import { getSession } from "../../../lib/session";
import { initializeApp, cert, getApps } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";

const PROVIDERS = {
  gemini: { label: "Google Gemini", model: "gemini-2.5-flash" },
  deepseek: { label: "DeepSeek", model: "deepseek-chat" }
};

function db() {
  const raw = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
  if (!raw) throw new Error("Firebase Admin credentials are not configured.");
  const key = JSON.parse(raw); key.private_key = key.private_key.replace(/\\n/g, "\n");
  const app = getApps().find(a => a.name === "dashboard-admin") || initializeApp({ credential: cert(key), projectId: key.project_id }, "dashboard-admin");
  return getFirestore(app);
}
async function authorizedGuild(guildId) {
  const session = await getSession();
  return session?.guilds?.some(g => g.id === guildId) ? session : null;
}
function encryptionKey() {
  const secret = process.env.AI_KEY_ENCRYPTION_SECRET;
  if (!secret || secret.length < 32) throw new Error("Server security is not configured. The dashboard owner must set AI_KEY_ENCRYPTION_SECRET in the hosting environment.");
  return crypto.createHash("sha256").update(secret, "utf8").digest();
}
function encryptApiKey(apiKey) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", encryptionKey(), iv);
  const ciphertext = Buffer.concat([cipher.update(apiKey, "utf8"), cipher.final()]);
  return { version: 1, algorithm: "aes-256-gcm", iv: iv.toString("base64"), tag: cipher.getAuthTag().toString("base64"), ciphertext: ciphertext.toString("base64") };
}
async function checkKey(provider, key) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 12000);
  try {
    const url = provider === "gemini" ? "https://generativelanguage.googleapis.com/v1beta/models" : "https://api.deepseek.com/models";
    const headers = provider === "gemini" ? { "x-goog-api-key": key } : { Authorization: "Bearer " + key };
    const res = await fetch(url, { headers, signal: controller.signal });
    if (res.ok) return { ok: true, message: "Provider accepted the key. Credit balance is not verified." };
    if (res.status === 401 || res.status === 403) return { ok: false, message: "Provider rejected this key or its permissions (HTTP " + res.status + ")." };
    if (res.status === 429) return { ok: false, message: "Provider rate-limited validation (HTTP 429). Retry later; no key was saved." };
    return { ok: false, message: "Provider returned HTTP " + res.status + "; no key was saved." };
  } catch (e) {
    return { ok: false, message: e.name === "AbortError" ? "Provider check timed out; no key was saved." : "Could not reach provider; no key was saved." };
  } finally { clearTimeout(timer); }
}

export async function GET(req) {
  const guildId = new URL(req.url).searchParams.get("guildId");
  if (!guildId || !await authorizedGuild(guildId)) return NextResponse.json({ error: "Sign in with Discord and select a server you manage." }, { status: 403 });
  try {
    const snap = await db().collection("guildSettings").doc(guildId).get();
    const ai = snap.exists ? snap.data().settings?.ai || {} : {};
    return NextResponse.json({ configured: Boolean(ai.encryptedKey), enabled: ai.enabled === true, provider: ai.provider || "", model: ai.model || "", keyOwnerId: ai.keyOwnerId || "", updatedAt: ai.updatedAt || null });
  } catch { return NextResponse.json({ error: "Could not read AI settings." }, { status: 500 }); }
}
export async function PUT(req) {
  const body = await req.json().catch(() => null);
  const guildId = body?.guildId;
  const session = guildId && await authorizedGuild(guildId);
  if (!session) return NextResponse.json({ error: "Sign in with Discord and select a server you manage." }, { status: 403 });
  const provider = body?.provider;
  const apiKey = typeof body?.apiKey === "string" ? body.apiKey.trim() : "";
  if (!PROVIDERS[provider] || apiKey.length < 12 || apiKey.length > 500) return NextResponse.json({ error: "Choose a supported provider and enter a valid-looking key." }, { status: 400 });
  try {
    const check = await checkKey(provider, apiKey);
    if (!check.ok) return NextResponse.json({ error: check.message }, { status: 400 });
    const encryptedKey = encryptApiKey(apiKey);
    const ref = db().collection("guildSettings").doc(guildId);
    const snap = await ref.get();
    const settings = snap.exists ? (snap.data().settings || {}) : {};
    settings.ai = { provider, model: PROVIDERS[provider].model, encryptedKey, keyOwnerId: session.user?.id || session.id || null, enabled: true, updatedAt: new Date().toISOString() };
    await ref.set({ guildId, settings, updatedAt: new Date().toISOString() }, { merge: true });
    return NextResponse.json({ ok: true, provider: PROVIDERS[provider].label, message: check.message });
  } catch (e) {
    return NextResponse.json({ error: e.message?.includes("AI_KEY_ENCRYPTION_SECRET") ? e.message : "Could not securely save the key. No key value is returned or logged." }, { status: 500 });
  }
}
export async function DELETE(req) {
  const guildId = new URL(req.url).searchParams.get("guildId");
  if (!guildId || !await authorizedGuild(guildId)) return NextResponse.json({ error: "Sign in with Discord and select a server you manage." }, { status: 403 });
  try {
    const ref = db().collection("guildSettings").doc(guildId);
    const snap = await ref.get();
    if (snap.exists) {
      const settings = snap.data().settings || {};
      delete settings.ai;
      await ref.set({ guildId, settings, updatedAt: new Date().toISOString() }, { merge: true });
    }
    return NextResponse.json({ ok: true });
  } catch { return NextResponse.json({ error: "Could not remove AI configuration." }, { status: 500 }); }
}
