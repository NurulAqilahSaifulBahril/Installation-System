import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { AuthError, requireAdmin } from "@/lib/auth";
import { queryProxy } from "@/lib/proxy-db";
import { ensureWarehouseUsersTable } from "@/lib/warehouse-users";

export const dynamic = "force-dynamic";

// Edit an Inventory Management user (warehouse_users). The name comes from prod_main and
// is not editable here; the username, phone number, page access and active flag are.

const patchSchema = z.object({
  username: z.string().min(2).max(50).optional(),
  phone: z.string().min(1).max(50).optional(),
  pageAccess: z.enum(["admin", "staff"]).optional(),
  isActive: z.boolean().optional(),
});

export async function PATCH(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    await requireAdmin();
  } catch (error) {
    const status = error instanceof AuthError ? error.status : 401;
    const message = error instanceof AuthError ? error.message : "Not signed in.";
    return NextResponse.json({ error: message }, { status });
  }

  const { id } = await context.params;
  const parsed = patchSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success || Object.keys(parsed.data).length === 0) {
    return NextResponse.json({ error: "Nothing to update." }, { status: 400 });
  }

  try {
    await ensureWarehouseUsersTable();
    const target = await queryProxy<{ id: string }>("select id from public.warehouse_users where id = $1", [id]);
    if (target.length === 0) return NextResponse.json({ error: "User not found." }, { status: 404 });

    const sets: string[] = ["updated_at = now()"];
    const params: unknown[] = [id];
    if (parsed.data.phone !== undefined) {
      const phone = parsed.data.phone.trim();
      const clash = await queryProxy<{ id: string }>(
        "select id from public.warehouse_users where lower(phone) = lower($1) and id <> $2",
        [phone, id],
      );
      if (clash.length > 0) {
        return NextResponse.json({ error: "That phone number is already registered." }, { status: 409 });
      }
      params.push(phone);
      sets.push(`phone = $${params.length}`);
    }
    if (parsed.data.username !== undefined) {
      // Spaces are allowed in a username.
      const username = parsed.data.username.trim().replace(/ +/g, " ");
      const taken = await queryProxy<{ id: string }>(
        "select id from public.warehouse_users where lower(username) = lower($1) and id <> $2",
        [username, id],
      );
      if (taken.length > 0) {
        return NextResponse.json({ error: "That username is already taken." }, { status: 409 });
      }
      params.push(username);
      sets.push(`username = $${params.length}`);
    }
    if (parsed.data.pageAccess !== undefined) {
      params.push(parsed.data.pageAccess);
      sets.push(`page_access = $${params.length}`);
    }
    if (parsed.data.isActive !== undefined) {
      params.push(parsed.data.isActive);
      sets.push(`is_active = $${params.length}`);
    }
    await queryProxy(`update public.warehouse_users set ${sets.join(", ")} where id = $1`, params);
    return NextResponse.json({ ok: true });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Could not save the changes." },
      { status: 503 },
    );
  }
}
