import crypto from "node:crypto";
import { NextResponse } from "next/server";
export async function GET(request){
 const id=process.env.DISCORD_CLIENT_ID, redirect=process.env.DISCORD_REDIRECT_URI;
 if(!id||!redirect||!process.env.DISCORD_CLIENT_SECRET||!process.env.SESSION_SECRET)return NextResponse.json({error:"Discord OAuth environment variables are not configured."},{status:503});
 const state=crypto.randomBytes(24).toString("hex");
 const url=new URL("https://discord.com/oauth2/authorize");
 url.searchParams.set("client_id",id);url.searchParams.set("response_type","code");url.searchParams.set("redirect_uri",redirect);url.searchParams.set("scope","identify guilds");url.searchParams.set("state",state);
 const response=NextResponse.redirect(url);response.cookies.set("dc_oauth_state",state,{httpOnly:true,secure:process.env.NODE_ENV==="production",sameSite:"lax",path:"/",maxAge:600});return response;
}
