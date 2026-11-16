import { NextResponse } from "next/server";
import { AuthError } from "@/lib/auth";
import { requireWarehouseUser } from "@/lib/warehouse-auth";
import { queryProxy } from "@/lib/proxy-db";

export const dynamic = "force-dynamic";

// Who is signed in to Inventory Management in this browser. The page asks on load, so a
// person whose 30-day sign-in cookie is still valid is let straight in (new tab, reopened
// browser, phone that dropped the tab) instead of seeing the sign-in screen again, and a
// change of access (made admin in the Admin tab) is picked up without signing in again.
// Only people added in the Admin tab count (a Scheduling dashboard login does not); a person
// removed or deactivated there is signed out on their next visit. 401 when there is no valid
// sign-in.

export async function GET() {
  let user;
  try {
    user = await requireWarehouseUser();
  } catch (error) {
    // 401 means "not signed in"; a database failure is 503 so the page keeps its sign-in.
    const status = error instanceof AuthError ? error.status : 503;
    return NextResponse.json({ signedIn: false }, { status });
  }

  // The phone number of an Inventory Management user (the page keeps it as its sign-in flag).
  let phone = "";
  try {
    const rows = await queryProxy<{ phone: string | null }>("select phone from public.warehouse_users where id::text = $1", [user.id]);
    phone = rows[0]?.phone ?? "";
  } catch {
    // The phone is only the page's sign-in flag; it can do without it.
  }

  return NextResponse.json(
    {
      signedIn: true,
      username: user.username || user.displayName,
      access: user.role === "admin" ? "admin" : user.role === "loading" ? "loading" : "staff",
      phone,
    },
    { headers: { "Cache-Control": "private, no-store" } },
  );
}
