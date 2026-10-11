import { NextResponse } from "next/server";
import { setSession } from "../../../../../lib/session";
export async function GET(request){
 const u=new URL(request.url),code=u.searchParams.get("code"),state=u.searchParams.get("state"),saved=request.cookies.get("dc_oauth_state")?.value;
 const fail=(message)=>NextResponse.redirect(new URL("/?authError="+encodeURIComponent(message),u.origin));
 if(!code||!state||!saved||state!==saved)return fail("Discord login check failed. Please try again.");
 const clientId=process.env.DISCORD_CLIENT_ID,clientSecret=process.env.DISCORD_CLIENT_SECRET,redirect=process.env.DISCORD_REDIRECT_URI;
 if(!clientId||!clientSecret||!redirect||!process.env.SESSION_SECRET)return fail("Discord OAuth is not configured in Vercel.");
 try{
  const tokenRes=await fetch("https://discord.com/api/oauth2/token",{method:"POST",headers:{"Content-Type":"application/x-www-form-urlencoded"},body:new URLSearchParams({client_id:clientId,client_secret:clientSecret,grant_type:"authorization_code",code,redirect_uri:redirect}),cache:"no-store"});
  const token=await tokenRes.json();if(!tokenRes.ok||!token.access_token)return fail("Discord token exchange failed.");
  const userRes=await fetch("https://discord.com/api/users/@me",{headers:{Authorization:"Bearer "+token.access_token},cache:"no-store"});const user=await userRes.json();if(!userRes.ok)return fail("Could not load Discord profile.");
  const guildRes=await fetch("https://discord.com/api/users/@me/guilds",{headers:{Authorization:"Bearer "+token.access_token},cache:"no-store"});const guilds=await guildRes.json();if(!guildRes.ok||!Array.isArray(guilds))return fail("Could not load your Discord servers.");
  await setSession({user:{id:user.id,username:user.global_name||user.username,avatar:user.avatar},guilds:guilds.filter(g=>(BigInt(g.permissions)&BigInt(0x20))===BigInt(0x20)||g.owner).map(g=>({id:g.id,name:g.name,icon:g.icon,owner:g.owner}))});
  const response=NextResponse.redirect(new URL("/",u.origin));response.cookies.delete("dc_oauth_state");return response;
 }catch{return fail("Discord login failed. Check OAuth settings and try again.")}
}
