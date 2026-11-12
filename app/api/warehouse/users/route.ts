import { NextResponse } from "next/server";
import { z } from "zod";
import { AuthError } from "@/lib/auth";
import { requireAdmin } from "@/lib/warehouse-auth";
import { queryProxy } from "@/lib/proxy-db";
import { querySource } from "@/lib/source-api";
import { toTitleCase } from "@/lib/title-case";
import { ensureWarehouseUsersTable, toWarehouseUser, type WarehouseUserRow } from "@/lib/warehouse-users";

export const dynamic = "force-dynamic";

// Inventory Management users: their own table (warehouse_users), separate from the
// Scheduling Operation system's accounts. Opening this tab still needs a signed-in
// dashboard admin; the people listed here are not dashboard accounts.

function authFailure(error: unknown) {
  const status = error instanceof AuthError ? error.status : 401;
  const message = error instanceof AuthError ? error.message : "Not signed in.";
  return NextResponse.json({ error: message }, { status });
}

export async function GET() {
  try {
    await requireAdmin();
  } catch (error) {
    return authFailure(error);
  }
  try {
    await ensureWarehouseUsersTable();
    const rows = await queryProxy<WarehouseUserRow>(
      "select id, name, username, phone, page_access, is_active, created_at from public.warehouse_users order by created_at asc",
    );
    return NextResponse.json({ users: rows.map(toWarehouseUser) });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Could not load users." },
      { status: 503 },
    );
  }
}

const createSchema = z.object({
  name: z.string().min(1).max(100),
  username: z.string().min(2).max(50),
  phone: z.string().max(50).optional(),
  // Admin: every page. Staff: every page except Admin.
  pageAccess: z.enum(["admin", "staff"]).optional(),
});

// The name has to be one that exists in prod_main's "user" table: checked here on the
// server, whatever the form sends.
export async function POST(request: Request) {
  let admin;
  try {
    admin = await requireAdmin();
  } catch (error) {
    return authFailure(error);
  }

  const parsed = createSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "A name and a username (2+ characters) are required." }, { status: 400 });
  }

  try {
    const found = await querySource<{ name: string | null; contact: string | null }>(
      'select name, contact from public."user" where lower(trim(name)) = lower($1) limit 1',
      [parsed.data.name.trim()],
    );
    const person = found[0];
    if (!person?.name) {
      return NextResponse.json(
        { error: "That name is not in prod_main. Pick a name from the list." },
        { status: 400 },
      );
    }
    const name = toTitleCase(person.name);
    const phone = (parsed.data.phone ?? person.contact ?? "").trim();
    if (!phone) {
      return NextResponse.json(
        { error: "This person has no phone number in prod_main. Enter the phone number to use for the OTP." },
        { status: 400 },
      );
    }

    await ensureWarehouseUsersTable();
    // Spaces are allowed in a username ("Kow Kok Yong" is fine).
    const username = parsed.data.username.trim().replace(/ +/g, " ");
    const existing = await queryProxy<{ id: string; username: string | null }>(
      "select id, username from public.warehouse_users where lower(phone) = lower($1) or lower(username) = lower($2)",
      [phone, username],
    );
    if (existing.length > 0) {
      const sameUsername = existing.some((row) => (row.username ?? "").toLowerCase() === username.toLowerCase());
      return NextResponse.json(
        { error: sameUsername ? "That username is already taken." : "That phone number is already registered." },
        { status: 409 },
      );
    }

    const id = crypto.randomUUID();
    await queryProxy(
      "insert into public.warehouse_users (id, name, username, phone, page_access, created_by) values ($1, $2, $3, $4, $5, $6)",
      [id, name, username, phone, parsed.data.pageAccess || "staff", admin.id],
    );
    return NextResponse.json({ ok: true, id, name, phone });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Could not add the user." },
      { status: 503 },
    );
  }
}
