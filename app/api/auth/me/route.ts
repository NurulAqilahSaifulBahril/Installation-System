import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json({ user: null }, { status: 401 });
    }
    return NextResponse.json({ user });
  } catch {
    // Database unreachable — report signed-out rather than erroring, so the
    // client can fall back to the login screen.
    return NextResponse.json({ user: null }, { status: 401 });
  }
}
