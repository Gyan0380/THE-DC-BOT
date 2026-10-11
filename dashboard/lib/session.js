import crypto from "node:crypto";
import { cookies } from "next/headers";
const COOKIE = "dc_dashboard_session";
function secret(){const s=process.env.SESSION_SECRET;if(!s||s.length<32)throw new Error("SESSION_SECRET must be at least 32 characters");return s}
function sign(data){return crypto.createHmac("sha256",secret()).update(data).digest("base64url")}
export async function setSession(value){const jar=await cookies();const data=Buffer.from(JSON.stringify({...value,expiresAt:Date.now()+7*86400000})).toString("base64url");jar.set(COOKIE,data+"."+sign(data),{httpOnly:true,secure:process.env.NODE_ENV==="production",sameSite:"lax",path:"/",maxAge:7*86400})}
export async function getSession(){const jar=await cookies();const raw=jar.get(COOKIE)?.value;if(!raw)return null;const [data,signature]=raw.split(".");if(!data||!signature||!crypto.timingSafeEqual(Buffer.from(sign(data)),Buffer.from(signature)))return null;try{const value=JSON.parse(Buffer.from(data,"base64url").toString());if(value.expiresAt<Date.now())return null;return value}catch{return null}}
export async function clearSession(){(await cookies()).delete(COOKIE)}
