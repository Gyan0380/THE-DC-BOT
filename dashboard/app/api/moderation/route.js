import { NextResponse } from "next/server";
import { getSession } from "../../../lib/session";
import { initializeApp, cert, getApps } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";

function db() {
  const raw = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
  if (!raw) return null;
  const key = JSON.parse(raw);
  key.private_key = key.private_key.replace(/\\n/g, "\n");
  const app = getApps().find(a => a.name === "dashboard-admin") || initializeApp({ credential: cert(key), projectId: key.project_id }, "dashboard-admin");
  return getFirestore(app);
}

export const dynamic = "force-dynamic";

export async function POST(request) {
  const session = await getSession();
  const body = await request.json().catch(() => ({}));
  const { guildId, action, userId, reason, minutes, durationHours } = body;
  if (!guildId || !session?.guilds?.some(g => g.id === guildId)) {
    return NextResponse.json({ error: "Sign in and select a server you manage." }, { status: 403 });
  }
  if (!/^\d{17,20}$/.test(String(userId || ""))) {
    return NextResponse.json({ error: "Enter a valid Discord member ID." }, { status: 400 });
  }
  if (action === "ban" && durationHours != null && durationHours !== "" && (!Number.isInteger(Number(durationHours)) || Number(durationHours) < 1 || Number(durationHours) > 8760)) return NextResponse.json({ error: "Temporary ban duration must be 1–8760 hours." }, { status: 400 });
  const token = process.env.DISCORD_TOKEN;
  if (!token) return NextResponse.json({ error: "DISCORD_TOKEN is not configured in Vercel." }, { status: 503 });
  const why = String(reason || "Action from THE DC BOT dashboard").slice(0, 500);
  const base = "https://discord.com/api/v10/guilds/" + encodeURIComponent(guildId) + "/members/" + encodeURIComponent(userId);
  let url = base, method = "PATCH", payload = null;
  if (action === "timeout") {
    const n = Number(minutes);
    if (!Number.isInteger(n) || n < 1 || n > 40320) return NextResponse.json({ error: "Timeout must be 1–40320 minutes." }, { status: 400 });
    payload = { communication_disabled_until: new Date(Date.now() + n * 60000).toISOString() };
  } else if (action === "untimeout") {
    payload = { communication_disabled_until: null };
  } else if (action === "kick") {
    url = base; method = "DELETE";
  } else if (action === "ban") {
    url = "https://discord.com/api/v10/guilds/" + encodeURIComponent(guildId) + "/bans/" + encodeURIComponent(userId);
    method = "PUT"; payload = { delete_message_seconds: 0 };
  } else {
    return NextResponse.json({ error: "Unsupported moderation action." }, { status: 400 });
  }
  let timerRef = null;
  if (action === "timeout" || (action === "ban" && durationHours != null && durationHours !== "")) {
    try {
      const firestore = db();
      if (!firestore) throw new Error("Firebase Admin credentials are not configured.");
      const timerAction = action === "timeout" ? "timeout-expire" : "unban";
      const executeAt = action === "timeout" ? new Date(Date.now() + Number(minutes) * 60000) : new Date(Date.now() + Number(durationHours) * 3600000);
      timerRef = await firestore.collection("scheduledActions").add({ guildId, userId, action: timerAction, executeAt, moderatorId: session.user?.id || "dashboard", reason: why, status: "pending", createdAt: new Date(), attempts: 0, lastError: null });
    } catch (error) {
      return NextResponse.json({ error: "Could not save the persistent timer, so no moderation action was applied. " + error.message }, { status: 503 });
    }
  }
  try {
    const response = await fetch(url, {
      method,
      headers: { Authorization: "Bot " + token, "Content-Type": "application/json", "X-Audit-Log-Reason": encodeURIComponent(why) },
      ...(payload ? { body: JSON.stringify(payload) } : {}),
      cache: "no-store"
    });
    if (!response.ok) {
      if (timerRef) await timerRef.update({ status: "cancelled", cancelledAt: new Date(), lastError: "Discord rejected the moderation action" }).catch(() => {});
      const data = await response.json().catch(() => ({}));
      const message = response.status === 403 ? "Discord denied this action. Check the bot's permissions and role hierarchy." :
        response.status === 404 ? "Member or server not found, or the bot is not in this server." :
        (data.message || "Discord moderation action failed.");
      return NextResponse.json({ error: message }, { status: response.status });
    }
    if (timerRef) {
      try {
        const firestore = db();
        const pending = await firestore.collection("scheduledActions").where("status", "==", "pending").get();
        const timerAction = action === "timeout" ? "timeout-expire" : "unban";
        await Promise.all(pending.docs.filter(d => d.id !== timerRef.id && d.data().guildId === guildId && d.data().userId === userId && d.data().action === timerAction).map(d => d.ref.update({ status: "cancelled", cancelledAt: new Date() })));
      } catch (error) { console.error("Could not cancel prior punishment timers:", error.message); }
    }
    if (action === "untimeout") {
      try {
        const firestore = db();
        if (firestore) {
          const pending = await firestore.collection("scheduledActions").where("status", "==", "pending").get();
          await Promise.all(pending.docs.filter(d => d.data().guildId === guildId && d.data().userId === userId && d.data().action === "timeout-expire").map(d => d.ref.update({ status: "cancelled", cancelledAt: new Date() })));
        }
      } catch (error) { console.error("Could not cancel dashboard timeout timer:", error.message); }
    }
    let dmSent = false;
    try {
      const dmChannelResponse = await fetch("https://discord.com/api/v10/users/@me/channels", {
        method: "POST", headers: { Authorization: "Bot " + token, "Content-Type": "application/json" },
        body: JSON.stringify({ recipient_id: userId }), cache: "no-store"
      });
      const dmChannel = await dmChannelResponse.json();
      if (dmChannelResponse.ok && dmChannel.id) {
        const actionLabel = action === "untimeout" ? "Timeout removed" : action.toUpperCase();
        const description = action === "timeout"
          ? "You have been timed out in this server for " + minutes + " minute(s)."
          : action === "untimeout" ? "Your timeout has been removed."
          : action === "kick" ? "You have been kicked from this server."
          : "You have been banned from this server." + (durationHours ? " Temporary ban duration: " + durationHours + " hour(s)." : " This ban is permanent.");
        const messageResponse = await fetch("https://discord.com/api/v10/channels/" + dmChannel.id + "/messages", {
          method: "POST", headers: { Authorization: "Bot " + token, "Content-Type": "application/json" },
          body: JSON.stringify({ embeds: [{ title: "Moderation Notice", description, fields: [
            { name: "Action", value: actionLabel, inline: true },
            { name: "Moderator", value: String(session.user?.username || "Server moderator"), inline: true },
            { name: "Reason", value: why.slice(0, 900) },
            ...(action === "ban" && durationHours ? [{ name: "Duration", value: durationHours + " hour(s)" }] : [])
          ], footer: { text: "THE DC BOT" }, timestamp: new Date().toISOString() }] }), cache: "no-store"
        });
        dmSent = messageResponse.ok;
      }
    } catch {}
    try {
      const firestore = db();
      if (firestore) await firestore.collection("modlogs").add({
        guildId, action, userId, moderatorId: session.user?.id || "dashboard",
        moderatorName: session.user?.username || "Dashboard moderator", reason: why,
        durationMinutes: action === "timeout" ? Number(minutes) : null,
        durationHours: action === "ban" && durationHours ? Number(durationHours) : null,
        dmSent, status: "completed", createdAt: new Date()
      });
    } catch (error) { console.error("Could not save dashboard moderation log:", error); }
    return NextResponse.json({ ok: true, dmSent, message: action + " completed for member ID " + userId + (action === "ban" && durationHours ? " for " + durationHours + " hour(s)." : ".") + " DM " + (dmSent ? "sent." : "could not be delivered; the member may have DMs disabled.") });
  } catch {
    if (timerRef) await timerRef.update({ status: "cancelled", cancelledAt: new Date(), lastError: "Discord request failed before confirmation" }).catch(() => {});
    return NextResponse.json({ error: "Could not contact Discord. Try again." }, { status: 502 });
  }
}
