import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { destroyWarehouseSession, WAREHOUSE_COOKIE } from "@/lib/warehouse-auth";

export const dynamic = "force-dynamic";

// Ends the Inventory Management session (the warehouse one only).
export async function POST() {
  const store = await cookies();
  const token = store.get(WAREHOUSE_COOKIE)?.value;
  if (token) await destroyWarehouseSession(token).catch(() => {});
  const response = NextResponse.json({ ok: true });
  response.cookies.set(WAREHOUSE_COOKIE, "", { httpOnly: true, sameSite: "lax", path: "/", maxAge: 0 });
  return response;
}
