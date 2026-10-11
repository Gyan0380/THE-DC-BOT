import { NextResponse } from "next/server";
import { getSession } from "../../../lib/session";

export const dynamic = "force-dynamic";

export async function GET(request) {
  const guildId = new URL(request.url).searchParams.get("guildId");
  const session = await getSession();
  if (!guildId || !session?.guilds?.some(g => g.id === guildId)) {
    return NextResponse.json({ error: "Sign in and select a server you manage." }, { status: 403 });
  }
  const token = process.env.DISCORD_TOKEN;
  if (!token) return NextResponse.json({ error: "Add DISCORD_TOKEN to Vercel Environment Variables to load channel names." }, { status: 503 });
  try {
    const response = await fetch("https://discord.com/api/v10/guilds/" + encodeURIComponent(guildId) + "/channels", {
      headers: { Authorization: "Bot " + token }, cache: "no-store"
    });
    const data = await response.json();
    if (!response.ok || !Array.isArray(data)) return NextResponse.json({ error: "Could not load channels. Make sure the bot is in this server." }, { status: response.status || 502 });
    return NextResponse.json({ channels: data.filter(c => c.type === 0 || c.type === 5).map(c => ({ id: c.id, name: c.name, type: c.type })) }, { headers: { "Cache-Control": "no-store" } });
  } catch {
    return NextResponse.json({ error: "Discord channel request failed." }, { status: 502 });
  }
}
