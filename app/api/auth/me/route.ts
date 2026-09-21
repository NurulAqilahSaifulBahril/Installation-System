import { NextResponse } from "next/server";
import {
  getCurrentUser,
  SESSION_COOKIE,
  SESSION_COOKIE_OPTIONS,
} from "@/lib/auth";
import { cookies } from "next/headers";

export const dynamic = "force-dynamic";

export async function GET() {
  let user;
  try {
    user = await getCurrentUser();
  } catch {
    // The check failed, which is not the same as being signed out, and the
    // difference matters: this used to answer 401 here, and the dashboard
    // reads a 401 as "your session is gone" and sends you to the sign-in
    // screen. So one slow or failed round trip to the database — which the
    // very first auth check after a restart is especially prone to, since it
    // runs the schema migration batch first — logged everybody out of a
    // session that was still perfectly valid. 503 says "ask again later".
    return NextResponse.json(
      { user: null, error: "Could not reach the database." },
      { status: 503 },
    );
  }

  if (!user) {
    return NextResponse.json({ user: null }, { status: 401 });
  }

  // Renew the cookie on every check, matching the expiry this same request
  // pushed back on the stored session. Without it the browser's copy would
  // still lapse a term after sign-in however long the account stayed in use.
  const response = NextResponse.json({ user });
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  if (token) {
    response.cookies.set(SESSION_COOKIE, token, SESSION_COOKIE_OPTIONS);
  }
  return response;
}
