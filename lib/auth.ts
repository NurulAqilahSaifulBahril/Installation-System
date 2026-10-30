import { randomBytes, scryptSync, timingSafeEqual } from "crypto";
import { cookies } from "next/headers";
import { ensureInstallationSchema } from "@/lib/installation-schema";
import { queryProxy } from "@/lib/proxy-db";

export type UserRole = "admin" | "staff";

export type AppUser = {
  id: string;
  username: string;
  displayName: string;
  phone?: string;
  role: UserRole;
  pageAccess?: string;
  isActive: boolean;
};

export const SESSION_COOKIE = "session_token";
// A year, and renewed on every use (see getSessionUser), so in practice a
// session ends when someone signs out rather than on a timer. The office signs
// in on shared machines and expects to stay signed in between shifts; a 30-day
// cap meant the dashboard demanded a password again for no reason anyone could
// see.
const SESSION_DAYS = 365;
export const SESSION_MAX_AGE_SECONDS = SESSION_DAYS * 24 * 60 * 60;

// One definition for every route that issues the cookie, so sign-in, first-run
// setup and the renewal on /api/auth/me cannot drift apart. No `secure`: the
// dashboard is served over plain http on the office LAN, and a secure cookie
// would simply never be stored.
export const SESSION_COOKIE_OPTIONS = {
  httpOnly: true,
  sameSite: "lax",
  path: "/",
  maxAge: SESSION_MAX_AGE_SECONDS,
} as const;

export class AuthError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

// scrypt rather than bcrypt: it's built into Node (no native addon to
// compile or bundle into the Electron build) and is still a deliberately
// slow, salted KDF — appropriate for a small internal user base.
const SCRYPT_KEY_LENGTH = 64;

export function hashPassword(password: string): string {
  const salt = randomBytes(16).toString("hex");
  const derived = scryptSync(password, salt, SCRYPT_KEY_LENGTH).toString("hex");
  return `${salt}:${derived}`;
}

export function verifyPassword(password: string, stored: string): boolean {
  const [salt, derivedHex] = stored.split(":");
  if (!salt || !derivedHex) return false;
  const expected = Buffer.from(derivedHex, "hex");
  const actual = scryptSync(password, salt, SCRYPT_KEY_LENGTH);
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

export function normalizePhone(raw: string): string {
  const digits = String(raw || "").replace(/\D+/g, "");
  if (digits.startsWith("60") && digits.length >= 10) {
    return "0" + digits.slice(2);
  }
  return digits;
}

const KNOWN_STAFF_PHONES: Record<string, string> = {
  "0173341122": "Yap",
  "0198765432": "Ahzu",
  "0125567812": "Joshua",
  "0168890011": "Kai Kian",
  "0133321199": "Jia Hao",
  "0165678901": "Martin Hing",
  "0129983344": "Wilson",
  "01139824411": "Jamar",
  "0127719023": "Amien",
  "0136628345": "Sharry",
  "01145678901": "Aqim",
  "0182239988": "Hamzah",
  "0184437812": "Yuan",
  "0123345566": "Am",
  "0172233445": "Is",
  "0194456677": "Harun",
  "01123456781": "Muhammad",
  "0167782211": "Shahid",
  "0118890022": "Saham",
  "0193321144": "Mujeeb",
  "0139987766": "Sajeeb",
  "0176654433": "Raheel",
  "0145567890": "Fakhrul",
  "0134456789": "Hafizi",
  "0143325544": "Adi",
  "0117765544": "Jalil",
  "0175549128": "Hakim",
};

type UserRow = {
  id: string;
  username: string;
  display_name: string;
  phone?: string;
  role: UserRole;
  page_access?: string;
  is_active: boolean;
};

function rowToUser(row: UserRow): AppUser {
  return {
    id: row.id,
    username: row.username,
    displayName: row.display_name,
    phone: row.phone || "",
    role: row.role,
    pageAccess: row.page_access || "all",
    isActive: row.is_active,
  };
}

export async function findUserByUsername(
  username: string,
): Promise<(AppUser & { passwordHash: string }) | null> {
  await ensureInstallationSchema();
  const rows = await queryProxy<UserRow & { password_hash: string }>(
    "select id, username, display_name, phone, role, page_access, is_active, password_hash from public.app_users order by created_at asc",
  );
  const trimmed = username.trim().toLowerCase();
  const cleanPhone = normalizePhone(username);
  const row =
    rows.find((r) => r.username.trim().toLowerCase() === trimmed) ||
    (cleanPhone.length >= 7
      ? rows.find(
          (r) =>
            (r.phone && normalizePhone(r.phone) === cleanPhone) ||
            normalizePhone(r.username) === cleanPhone,
        )
      : undefined) ||
    rows.find((r) => r.display_name.trim().toLowerCase() === trimmed);
  if (!row) return null;
  return { ...rowToUser(row), passwordHash: row.password_hash };
}

export async function findOrCreateStaffByPhone(
  rawPhone: string,
): Promise<AppUser | null> {
  await ensureInstallationSchema();
  const cleanPhone = normalizePhone(rawPhone);
  if (!cleanPhone) return null;

  const allUsers = await queryProxy<UserRow>(
    "select id, username, display_name, phone, role, page_access, is_active from public.app_users order by created_at asc",
  );

  // Match against existing user's phone or username
  const matched = allUsers.find(
    (u) =>
      (u.phone && normalizePhone(u.phone) === cleanPhone) ||
      normalizePhone(u.username) === cleanPhone,
  );

  if (matched) {
    return rowToUser(matched);
  }

  // Auto-provision staff account if not yet in app_users
  const id = crypto.randomUUID();
  const displayName = KNOWN_STAFF_PHONES[cleanPhone] || `Staff (${rawPhone.trim()})`;
  const dummyPasswordHash = hashPassword(randomBytes(16).toString("hex"));
  await queryProxy(
    [
      "insert into public.app_users (id, username, display_name, phone, password_hash, role, page_access, is_active)",
      "values ($1, $2, $3, $4, $5, 'staff', 'all', true)",
    ].join("\n"),
    [id, cleanPhone, displayName, rawPhone.trim(), dummyPasswordHash],
  );

  return {
    id,
    username: cleanPhone,
    displayName,
    phone: rawPhone.trim(),
    role: "staff",
    pageAccess: "all",
    isActive: true,
  };
}

export async function createSession(userId: string): Promise<string> {
  const token = randomBytes(32).toString("hex");
  const expiresAt = new Date(Date.now() + SESSION_DAYS * 24 * 60 * 60 * 1000);
  await queryProxy(
    "insert into public.app_sessions (id, user_id, expires_at) values ($1, $2, $3)",
    [token, userId, expiresAt.toISOString()],
  );
  return token;
}

export async function destroySession(token: string) {
  await queryProxy("delete from public.app_sessions where id = $1", [token]);
}

type SessionRow = {
  user_id: string;
  expires_at: string;
  username: string;
  display_name: string;
  phone?: string;
  role: UserRole;
  page_access?: string;
  is_active: boolean;
};

export async function getSessionUser(
  token: string | undefined,
): Promise<AppUser | null> {
  if (!token) return null;
  await ensureInstallationSchema();
  const rows = await queryProxy<SessionRow>(
    [
      "select s.user_id, s.expires_at, u.username, u.display_name, u.phone, u.role, u.page_access, u.is_active",
      "from public.app_sessions s",
      "join public.app_users u on u.id = s.user_id",
      "where s.id = $1",
    ].join("\n"),
    [token],
  );
  const row = rows[0];
  if (!row) return null;
  if (new Date(row.expires_at).getTime() < Date.now()) return null;
  if (!row.is_active) return null;

  queryProxy(
    "update public.app_sessions set last_seen_at = now(), expires_at = $2 where id = $1",
    [token, new Date(Date.now() + SESSION_MAX_AGE_SECONDS * 1000).toISOString()],
  ).catch(() => {});

  return {
    id: row.user_id,
    username: row.username,
    displayName: row.display_name,
    phone: row.phone || "",
    role: row.role,
    pageAccess: row.page_access || "all",
    isActive: row.is_active,
  };
}

export async function getCurrentUser(): Promise<AppUser | null> {
  const store = await cookies();
  const token = store.get(SESSION_COOKIE)?.value;
  return getSessionUser(token);
}

export async function requireUser(): Promise<AppUser> {
  const user = await getCurrentUser();
  if (!user) throw new AuthError("Not signed in.", 401);
  return user;
}

export async function requireAdmin(): Promise<AppUser> {
  const user = await requireUser();
  if (user.role !== "admin") throw new AuthError("Admin access required.", 403);
  return user;
}
