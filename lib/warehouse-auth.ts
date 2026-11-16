import { randomBytes } from "crypto";
import { cookies } from "next/headers";
import { AuthError, getCurrentUser } from "@/lib/auth";
import { queryProxy } from "@/lib/proxy-db";
import { ensureWarehouseUsersTable } from "@/lib/warehouse-users";

// Inventory Management sign-in. It is kept apart from the Scheduling system's sessions: a person
// who signs in on /warehouse with their registered phone number gets a warehouse session, which
// opens the /api/warehouse routes (and a job's PV drawings) and nothing else. The Scheduling
// dashboard's own login still works on these routes, as before.

export const WAREHOUSE_COOKIE = "wh_session";
const SESSION_DAYS = 30;
export const WAREHOUSE_COOKIE_MAX_AGE = SESSION_DAYS * 24 * 60 * 60;

export type WarehouseSessionUser = {
  id: string;
  username: string;
  displayName: string;
  // "loading": can only view the Loading tabs (Stock Out, Stock Transfer); it cannot save anything.
  role: "admin" | "staff" | "loading";
};

let ready: Promise<void> | null = null;

function ensureSessionsTable(): Promise<void> {
  if (!ready) {
    ready = (async () => {
      await queryProxy(
        [
          "create table if not exists public.warehouse_sessions (",
          "  id text primary key,",
          "  user_id text not null,",
          "  expires_at timestamptz not null,",
          "  created_at timestamptz not null default now()",
          ")",
        ].join(String.fromCharCode(10)),
      );
    })().catch((error) => {
      ready = null;
      throw error;
    });
  }
  return ready;
}

export async function createWarehouseSession(userId: string): Promise<string> {
  await ensureSessionsTable();
  const token = randomBytes(32).toString("hex");
  const expires = new Date(Date.now() + WAREHOUSE_COOKIE_MAX_AGE * 1000).toISOString();
  await queryProxy("insert into public.warehouse_sessions (id, user_id, expires_at) values ($1, $2, $3)", [
    token,
    userId,
    expires,
  ]);
  return token;
}

export async function destroyWarehouseSession(token: string): Promise<void> {
  await ensureSessionsTable();
  await queryProxy("delete from public.warehouse_sessions where id = $1", [token]);
}

async function warehouseSessionUser(token: string | undefined): Promise<WarehouseSessionUser | null> {
  if (!token) return null;
  await ensureSessionsTable();
  await ensureWarehouseUsersTable();
  const rows = await queryProxy<{ id: string; name: string; username: string | null; page_access: string }>(
    [
      "select u.id, u.name, u.username, u.page_access",
      "from public.warehouse_sessions s",
      "join public.warehouse_users u on u.id = s.user_id",
      "where s.id = $1 and s.expires_at > now() and u.is_active",
    ].join(String.fromCharCode(10)),
    [token],
  );
  const row = rows[0];
  if (!row) return null;
  return {
    id: row.id,
    username: row.username || row.name,
    displayName: row.name,
    role: row.page_access === "admin" ? "admin" : row.page_access === "loading" ? "loading" : "staff",
  };
}

// Signed in either with a warehouse session or with the Scheduling dashboard login.
export async function requireUser(): Promise<WarehouseSessionUser> {
  const store = await cookies();
  const fromWarehouse = await warehouseSessionUser(store.get(WAREHOUSE_COOKIE)?.value).catch(() => null);
  if (fromWarehouse) return fromWarehouse;
  const dashboard = await getCurrentUser();
  if (dashboard) {
    return { id: dashboard.id, username: dashboard.username, displayName: dashboard.displayName, role: dashboard.role };
  }
  throw new AuthError("Not signed in.", 401);
}

// Signed in to Inventory Management itself: only a person added in the Admin tab (an active
// warehouse user) has such a session. The Scheduling dashboard login does not count here, so it
// cannot open the Inventory Management page.
export async function requireWarehouseUser(): Promise<WarehouseSessionUser> {
  const store = await cookies();
  const user = await warehouseSessionUser(store.get(WAREHOUSE_COOKIE)?.value);
  if (!user) throw new AuthError("Not signed in.", 401);
  return user;
}

// Signed in and allowed to record things (verify, load, scan, save quantities): everyone except
// a "loading" user, whose access is view only.
export async function requireWriter(): Promise<WarehouseSessionUser> {
  const user = await requireUser();
  if (user.role === "loading") throw new AuthError("Your access is view only (Loading).", 403);
  return user;
}

export async function requireAdmin(): Promise<WarehouseSessionUser> {
  const user = await requireUser();
  if (user.role !== "admin") throw new AuthError("Admin access required.", 403);
  return user;
}
