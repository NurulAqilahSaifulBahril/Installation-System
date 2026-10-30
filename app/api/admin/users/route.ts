import { NextResponse } from "next/server";
import { z } from "zod";
import { writeAuditLog } from "@/lib/audit";
import { AuthError, hashPassword, requireAdmin } from "@/lib/auth";
import { ensureInstallationSchema } from "@/lib/installation-schema";
import { queryProxy } from "@/lib/proxy-db";

export const dynamic = "force-dynamic";

function authFailure(error: unknown) {
  const status = error instanceof AuthError ? error.status : 401;
  const message =
    error instanceof AuthError ? error.message : "Not signed in.";
  return NextResponse.json({ error: message }, { status });
}

type UserRow = {
  id: string;
  username: string;
  display_name: string;
  phone?: string;
  role: "admin" | "staff";
  page_access?: string;
  is_active: boolean;
  created_at: string;
  last_seen_at: string | null;
};

export async function GET() {
  try {
    await requireAdmin();
  } catch (error) {
    return authFailure(error);
  }

  try {
    await ensureInstallationSchema();
    const rows = await queryProxy<UserRow>(
      [
        "select u.id, u.username, u.display_name, u.phone, u.role, u.page_access, u.is_active, u.created_at,",
        "  (select max(s.last_seen_at) from public.app_sessions s where s.user_id = u.id) as last_seen_at",
        "from public.app_users u",
        "order by u.created_at asc",
      ].join("\n"),
    );
    return NextResponse.json({
      users: rows.map((row) => ({
        id: row.id,
        username: row.username,
        displayName: row.display_name,
        phone: row.phone || "",
        role: row.role,
        pageAccess: row.page_access || "all",
        isActive: row.is_active,
        createdAt: row.created_at,
        lastSeenAt: row.last_seen_at,
      })),
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Could not load users." },
      { status: 503 },
    );
  }
}

const createSchema = z.object({
  username: z.string().min(2).max(50),
  phone: z.string().max(50).optional(),
  displayName: z.string().min(1).max(100),
  password: z.string().max(200).optional(),
  role: z.enum(["admin", "staff"]),
  pageAccess: z.string().optional(),
});

export async function POST(request: Request) {
  let admin;
  try {
    admin = await requireAdmin();
  } catch (error) {
    return authFailure(error);
  }

  const parsed = createSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Phone number (or username), display name, and role are required." },
      { status: 400 },
    );
  }
  if (parsed.data.role === "admin" && (!parsed.data.password || parsed.data.password.length < 6)) {
    return NextResponse.json(
      { error: "Admin accounts require a password of at least 6 characters." },
      { status: 400 },
    );
  }

  try {
    await ensureInstallationSchema();
    const existing = await queryProxy<{ id: string }>(
      "select id from public.app_users where lower(username) = lower($1)",
      [parsed.data.username.trim()],
    );
    if (existing.length > 0) {
      return NextResponse.json(
        { error: "That phone number or username is already registered." },
        { status: 409 },
      );
    }

    const id = crypto.randomUUID();
    const pageAccess = parsed.data.pageAccess || "all";
    const phoneVal = (parsed.data.phone ?? parsed.data.username).trim();
    const rawPassword = parsed.data.password && parsed.data.password.length >= 6
      ? parsed.data.password
      : crypto.randomUUID();
    await queryProxy(
      [
        "insert into public.app_users (id, username, display_name, phone, password_hash, role, page_access)",
        "values ($1, $2, $3, $4, $5, $6, $7)",
      ].join("\n"),
      [
        id,
        parsed.data.username.trim(),
        parsed.data.displayName.trim(),
        phoneVal,
        hashPassword(rawPassword),
        parsed.data.role,
        pageAccess,
      ],
    );

    await writeAuditLog({
      user: admin,
      action: "user_created",
      entityType: "app_user",
      entityId: id,
      summary: `Created user "${parsed.data.username}" (${parsed.data.role}, access: ${pageAccess})`,
    });

    return NextResponse.json({ ok: true, id });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Could not create user." },
      { status: 503 },
    );
  }
}
