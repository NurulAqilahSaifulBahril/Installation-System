import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { writeAuditLog } from "@/lib/audit";
import { AuthError, hashPassword, requireAdmin } from "@/lib/auth";
import { ensureInstallationSchema } from "@/lib/installation-schema";
import { queryProxy } from "@/lib/proxy-db";

export const dynamic = "force-dynamic";

function authFailure(error: unknown) {
  const status = error instanceof AuthError ? error.status : 401;
  const message = error instanceof AuthError ? error.message : "Not signed in.";
  return NextResponse.json({ error: message }, { status });
}

const patchSchema = z.object({
  displayName: z.string().min(1).max(100).optional(),
  role: z.enum(["admin", "staff"]).optional(),
  isActive: z.boolean().optional(),
  password: z.string().min(6).max(200).optional(),
});

export async function PATCH(
  request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  let admin;
  try {
    admin = await requireAdmin();
  } catch (error) {
    return authFailure(error);
  }

  const { id } = await context.params;
  const parsed = patchSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success || Object.keys(parsed.data).length === 0) {
    return NextResponse.json({ error: "Nothing to update." }, { status: 400 });
  }

  // The last safeguard on the last admin: an admin cannot demote or
  // deactivate themselves, so the system can never end up with zero admins.
  if (
    id === admin.id &&
    (parsed.data.role === "staff" || parsed.data.isActive === false)
  ) {
    return NextResponse.json(
      { error: "You cannot demote or deactivate your own account." },
      { status: 400 },
    );
  }

  try {
    await ensureInstallationSchema();
    const rows = await queryProxy<{ username: string }>(
      "select username from public.app_users where id = $1",
      [id],
    );
    const target = rows[0];
    if (!target) {
      return NextResponse.json({ error: "User not found." }, { status: 404 });
    }

    const sets: string[] = ["updated_at = now()"];
    const params: unknown[] = [id];
    const changes: string[] = [];

    if (parsed.data.displayName !== undefined) {
      params.push(parsed.data.displayName.trim());
      sets.push(`display_name = $${params.length}`);
      changes.push("name");
    }
    if (parsed.data.role !== undefined) {
      params.push(parsed.data.role);
      sets.push(`role = $${params.length}`);
      changes.push(`role → ${parsed.data.role}`);
    }
    if (parsed.data.isActive !== undefined) {
      params.push(parsed.data.isActive);
      sets.push(`is_active = $${params.length}`);
      changes.push(parsed.data.isActive ? "activated" : "deactivated");
    }
    if (parsed.data.password !== undefined) {
      params.push(hashPassword(parsed.data.password));
      sets.push(`password_hash = $${params.length}`);
      changes.push("password reset");
    }

    await queryProxy(
      `update public.app_users set ${sets.join(", ")} where id = $1`,
      params,
    );

    // Deactivation must bite immediately, not at next sign-in.
    if (parsed.data.isActive === false || parsed.data.password !== undefined) {
      await queryProxy("delete from public.app_sessions where user_id = $1", [id]);
    }

    await writeAuditLog({
      user: admin,
      action: "user_updated",
      entityType: "app_user",
      entityId: id,
      summary: `Updated user "${target.username}": ${changes.join(", ")}`,
    });

    return NextResponse.json({ ok: true });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Could not update user." },
      { status: 503 },
    );
  }
}
