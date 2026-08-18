import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { writeAuditLog } from "@/lib/audit";
import { destroySession, getSessionUser, SESSION_COOKIE } from "@/lib/auth";

export const dynamic = "force-dynamic";

export async function POST() {
  const store = await cookies();
  const token = store.get(SESSION_COOKIE)?.value;

  if (token) {
    try {
      const user = await getSessionUser(token);
      await destroySession(token);
      if (user) {
        await writeAuditLog({
          user,
          action: "logout",
          entityType: "auth",
          summary: `${user.displayName || user.username} signed out`,
        });
      }
    } catch {
      // Losing the server-side session row is acceptable; clearing the
      // cookie below still signs the browser out.
    }
  }

  const response = NextResponse.json({ ok: true });
  response.cookies.set(SESSION_COOKIE, "", { path: "/", maxAge: 0 });
  return response;
}
