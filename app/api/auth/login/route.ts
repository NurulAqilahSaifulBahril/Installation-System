import { NextResponse } from "next/server";
import { z } from "zod";
import { writeAuditLog } from "@/lib/audit";
import {
  createSession,
  findUserByUsername,
  SESSION_COOKIE,
  SESSION_COOKIE_OPTIONS,
  verifyPassword,
} from "@/lib/auth";

export const dynamic = "force-dynamic";

const loginSchema = z.object({
  username: z.string().min(1),
  password: z.string().min(1),
});

export async function POST(request: Request) {
  const parsed = loginSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Enter a username and password." },
      { status: 400 },
    );
  }

  try {
    const user = await findUserByUsername(parsed.data.username);
    // One generic message for wrong user, wrong password, and deactivated
    // account — no probing which usernames exist.
    if (
      !user ||
      !user.isActive ||
      !verifyPassword(parsed.data.password, user.passwordHash)
    ) {
      await writeAuditLog({
        user: null,
        action: "login_failed",
        entityType: "auth",
        summary: `Failed sign-in attempt for "${parsed.data.username}"`,
      });
      return NextResponse.json(
        { error: "Incorrect username or password." },
        { status: 401 },
      );
    }

    const token = await createSession(user.id);
    await writeAuditLog({
      user,
      action: "login",
      entityType: "auth",
      summary: `${user.displayName || user.username} signed in`,
    });

    const response = NextResponse.json({
      user: {
        id: user.id,
        username: user.username,
        displayName: user.displayName,
        role: user.role,
      },
    });
    response.cookies.set(SESSION_COOKIE, token, SESSION_COOKIE_OPTIONS);
    return response;
  } catch (error) {
    return NextResponse.json(
      {
        error:
          "Could not sign in: " +
          (error instanceof Error ? error.message : "unknown error"),
      },
      { status: 503 },
    );
  }
}
