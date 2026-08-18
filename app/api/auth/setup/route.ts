import { NextResponse } from "next/server";
import { z } from "zod";
import { writeAuditLog } from "@/lib/audit";
import { createSession, hashPassword, SESSION_COOKIE } from "@/lib/auth";
import { ensureInstallationSchema } from "@/lib/installation-schema";
import { queryProxy } from "@/lib/proxy-db";

export const dynamic = "force-dynamic";

// First-run bootstrap: works only while the user table is empty, so the very
// first person in creates the IT Admin account. As soon as one user exists,
// this endpoint refuses everything and admin-only user management takes over.

async function countUsers(): Promise<number> {
  await ensureInstallationSchema();
  const rows = await queryProxy<{ count: string }>(
    "select count(*)::text as count from public.app_users",
  );
  return Number(rows[0]?.count ?? "0");
}

export async function GET() {
  try {
    const count = await countUsers();
    return NextResponse.json({ needsSetup: count === 0 });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Database unreachable." },
      { status: 503 },
    );
  }
}

const setupSchema = z.object({
  username: z.string().min(2).max(50),
  displayName: z.string().min(1).max(100),
  password: z.string().min(6).max(200),
});

export async function POST(request: Request) {
  const parsed = setupSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Username (2+), display name and password (6+ chars) are required." },
      { status: 400 },
    );
  }

  try {
    if ((await countUsers()) > 0) {
      return NextResponse.json(
        { error: "Setup has already been completed." },
        { status: 403 },
      );
    }

    const id = crypto.randomUUID();
    await queryProxy(
      [
        "insert into public.app_users (id, username, display_name, password_hash, role)",
        "values ($1, $2, $3, $4, 'admin')",
      ].join("\n"),
      [
        id,
        parsed.data.username.trim(),
        parsed.data.displayName.trim(),
        hashPassword(parsed.data.password),
      ],
    );

    const user = {
      id,
      username: parsed.data.username.trim(),
      displayName: parsed.data.displayName.trim(),
      role: "admin" as const,
      isActive: true,
    };

    await writeAuditLog({
      user,
      action: "user_created",
      entityType: "app_user",
      entityId: id,
      summary: `First admin account "${user.username}" created via setup`,
    });

    const token = await createSession(id);
    const response = NextResponse.json({ ok: true });
    response.cookies.set(SESSION_COOKIE, token, {
      httpOnly: true,
      sameSite: "lax",
      path: "/",
      maxAge: 30 * 24 * 60 * 60,
    });
    return response;
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Could not complete setup." },
      { status: 503 },
    );
  }
}
