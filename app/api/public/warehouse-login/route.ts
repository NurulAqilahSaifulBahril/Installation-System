import { NextResponse } from "next/server";
import { queryProxy } from "@/lib/proxy-db";
import { ensureWarehouseUsersTable } from "@/lib/warehouse-users";
import { createWarehouseSession, WAREHOUSE_COOKIE, WAREHOUSE_COOKIE_MAX_AGE } from "@/lib/warehouse-auth";

export const dynamic = "force-dynamic";

// The Inventory Management sign-in: a registered phone number plus a 6-digit OTP. The OTP is a
// placeholder for now (any 6 digits are accepted) until the real OTP is connected, so the phone
// number must belong to an active Inventory Management user (added in the Admin tab); nobody else
// gets a session. The session opens only the warehouse routes, never the Scheduling ones.

export async function POST(request: Request) {
  const body = (await request.json().catch(() => null)) as { phone?: unknown; otp?: unknown } | null;
  const phone = typeof body?.phone === "string" ? body.phone : "";
  const otp = typeof body?.otp === "string" ? body.otp.trim() : "";
  const digits = phone.split("").filter((ch) => ch >= "0" && ch <= "9").join("");
  if (digits.length < 7 || otp.length !== 6 || otp.split("").some((ch) => ch < "0" || ch > "9")) {
    return NextResponse.json({ error: "Enter the phone number and the 6-digit OTP." }, { status: 400 });
  }

  try {
    await ensureWarehouseUsersTable();
    const rows = await queryProxy<{ id: string; username: string | null; name: string; page_access: string }>(
      [
        "select id, username, name, page_access from public.warehouse_users",
        "where is_active and regexp_replace(phone, '[^0-9]', '', 'g') = $1",
        "limit 1",
      ].join(String.fromCharCode(10)),
      [digits],
    );
    const user = rows[0];
    if (!user) {
      return NextResponse.json({ error: "This phone number is not registered for Inventory Management." }, { status: 401 });
    }
    const token = await createWarehouseSession(user.id);
    const response = NextResponse.json({
      username: user.username || user.name,
      access: user.page_access === "admin" ? "admin" : "staff",
    });
    const secure = (request.headers.get("x-forwarded-proto") ?? new URL(request.url).protocol.replace(":", "")) === "https";
    response.cookies.set(WAREHOUSE_COOKIE, token, {
      httpOnly: true,
      sameSite: "lax",
      path: "/",
      maxAge: WAREHOUSE_COOKIE_MAX_AGE,
      secure,
    });
    return response;
  } catch {
    return NextResponse.json({ error: "Could not sign in. Try again." }, { status: 503 });
  }
}
