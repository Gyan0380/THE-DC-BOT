import { NextResponse } from "next/server";
import { getSession,clearSession } from "../../../../../lib/session";
export async function GET(){const s=await getSession();return NextResponse.json(s?{authenticated:true,user:s.user,guilds:s.guilds}:{authenticated:false})}
export async function DELETE(){await clearSession();return NextResponse.json({ok:true})}
