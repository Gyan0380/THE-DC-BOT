import { NextResponse } from "next/server";
import { getSession } from "../../../../lib/session";

export const dynamic = "force-dynamic";

export async function POST(request) {
  const session = await getSession();
  const body = await request.json().catch(() => ({}));
  const { guildId, action, userId, reason, minutes } = body;
  if (!guildId || !session?.guilds?.some(g => g.id === guildId)) {
    return NextResponse.json({ error: "Sign in and select a server you manage." }, { status: 403 });
  }
  if (!/^\d{17,20}$/.test(String(userId || ""))) {
    return NextResponse.json({ error: "Enter a valid Discord member ID." }, { status: 400 });
  }
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
  try {
    const response = await fetch(url, {
      method,
      headers: { Authorization: "Bot " + token, "Content-Type": "application/json", "X-Audit-Log-Reason": encodeURIComponent(why) },
      ...(payload ? { body: JSON.stringify(payload) } : {}),
      cache: "no-store"
    });
    if (!response.ok) {
      const data = await response.json().catch(() => ({}));
      const message = response.status === 403 ? "Discord denied this action. Check the bot's permissions and role hierarchy." :
        response.status === 404 ? "Member or server not found, or the bot is not in this server." :
        (data.message || "Discord moderation action failed.");
      return NextResponse.json({ error: message }, { status: response.status });
    }
    return NextResponse.json({ ok: true, message: action + " completed for member ID " + userId + "." });
  } catch {
    return NextResponse.json({ error: "Could not contact Discord. Try again." }, { status: 502 });
  }
}
