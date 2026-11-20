import { queryProxy } from "@/lib/proxy-db";

// Inventory Management has its own users table, separate from the Scheduling Operation
// system's app_users: nothing here reads, shares or changes those accounts. The table is
// created on first use (idempotent), so no migration step is needed.

let ready: Promise<void> | null = null;

export function ensureWarehouseUsersTable(): Promise<void> {
  if (!ready) {
    ready = (async () => {
      await queryProxy(
        [
          "create table if not exists public.warehouse_users (",
          "  id text primary key,",
          "  name text not null,",
          "  phone text not null,",
          "  page_access text not null default 'staff',",
          "  is_active boolean not null default true,",
          "  created_by text,",
          "  created_at timestamptz not null default now(),",
          "  updated_at timestamptz not null default now()",
          ")",
        ].join(String.fromCharCode(10)),
      );
      await queryProxy(
        "create unique index if not exists warehouse_users_phone_idx on public.warehouse_users (lower(phone))",
      );
      await queryProxy("alter table public.warehouse_users add column if not exists username text");
      // The person's job role (IT Admin, Driver, ...): a label only, it grants nothing.
      await queryProxy("alter table public.warehouse_users add column if not exists role text");
      await queryProxy(
        "create unique index if not exists warehouse_users_username_idx on public.warehouse_users (lower(username)) where username is not null",
      );
    })().catch((error) => {
      ready = null;
      throw error;
    });
  }
  return ready;
}

export type WarehouseUserRow = {
  id: string;
  name: string;
  username: string | null;
  phone: string;
  page_access: string;
  role: string | null;
  is_active: boolean;
  created_at: string;
};

// Job roles offered on the Admin page. A label only: page access decides what a user can open.
export const WAREHOUSE_ROLES = [
  "IT Admin",
  "Warehouse Manager",
  "Warehouse Assistant",
  "Sales Agent",
  "Storekeeper",
  "Driver",
] as const;

// Roles whose people may be added without a name in prod_main (e.g. lorry drivers and store
// helpers who have no company account): the typed name and phone number are used.
export const OUTSIDE_PROD_MAIN_ROLES: readonly string[] = ["Driver", "Storekeeper"];

export function toWarehouseUser(row: WarehouseUserRow) {
  return {
    id: row.id,
    name: row.name,
    username: row.username ?? "",
    phone: row.phone,
    pageAccess: row.page_access,
    role: row.role ?? "",
    isActive: row.is_active,
    createdAt: row.created_at,
  };
}
