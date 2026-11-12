import { NextResponse } from "next/server";
import { queryProxy } from "@/lib/proxy-db";
import { ensureWarehouseUsersTable } from "@/lib/warehouse-users";

export const dynamic = "force-dynamic";

// Public on purpose (under /api/public/): the Inventory Management sign-in screen calls it
// to greet a person by username ("Hi jane!") and to know whether to show the Admin tab. It
// returns ONLY the username and the access level (admin or staff) for an active Inventory
// Management user whose phone number matches, or nulls. Nothing else is returned, and there
// is no listing. Because that sign-in does not verify the OTP
// yet, anyone can ask about any phone number: keep this to the username and nothing more.

export async function POST(request: Request) {
  const body = (await request.json().catch(() => null)) as { phone?: unknown } | null;
  const phone = typeof body?.phone === "string" ? body.phone.trim() : "";
  const digits = phone.split("").filter((ch) => ch >= "0" && ch <= "9").join("");
  if (digits.length < 7) return NextResponse.json({ username: null, access: null });

  try {
    await ensureWarehouseUsersTable();
    // Compare digits only, so "012-345 6789" and "0123456789" match.
    const rows = await queryProxy<{ username: string | null; page_access: string | null }>(
      [
        "select username, page_access from public.warehouse_users",
        "where is_active and username is not null",
        "  and regexp_replace(phone, '[^0-9]', '', 'g') = $1",
        "limit 1",
      ].join(String.fromCharCode(10)),
      [digits],
    );
    const access = rows[0]?.page_access === "admin" ? "admin" : rows[0] ? "staff" : null;
    return NextResponse.json({ username: rows[0]?.username ?? null, access });
  } catch {
    return NextResponse.json({ username: null, access: null });
  }
}
