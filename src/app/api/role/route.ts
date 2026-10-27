import { NextRequest, NextResponse } from "next/server";
import { DEMO_USERS, roleSwitchEnabled, type Role } from "@/server/auth";

export async function POST(req: NextRequest) {
  if (!roleSwitchEnabled()) return NextResponse.json({ error: "Role switching is disabled on this deployment" }, { status: 403 });
  const { role } = (await req.json().catch(() => ({}))) as { role?: string };
  if (!role || !(role in DEMO_USERS)) return NextResponse.json({ error: "Unknown role" }, { status: 400 });
  const res = NextResponse.json({ ok: true, actor: DEMO_USERS[role as Role] });
  res.cookies.set("inkloom_role", role, { path: "/", sameSite: "lax", httpOnly: false, maxAge: 60 * 60 * 24 });
  return res;
}
