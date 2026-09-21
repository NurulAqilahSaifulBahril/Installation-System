import { randomBytes, scryptSync, timingSafeEqual } from "crypto";
import { cookies } from "next/headers";
import { ensureInstallationSchema } from "@/lib/installation-schema";
import { queryProxy } from "@/lib/proxy-db";

export type UserRole = "admin" | "staff";

export type AppUser = {
  id: string;
  username: string;
  displayName: string;
  role: UserRole;
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

type UserRow = {
  id: string;
  username: string;
  display_name: string;
  role: UserRole;
  is_active: boolean;
};

function rowToUser(row: UserRow): AppUser {
  return {
    id: row.id,
    username: row.username,
    displayName: row.display_name,
    role: row.role,
    isActive: row.is_active,
  };
}

export async function findUserByUsername(
  username: string,
): Promise<(AppUser & { passwordHash: string }) | null> {
  await ensureInstallationSchema();
  const rows = await queryProxy<UserRow & { password_hash: string }>(
    "select id, username, display_name, role, is_active, password_hash from public.app_users where lower(username) = lower($1)",
    [username],
  );
  const row = rows[0];
  if (!row) return null;
  return { ...rowToUser(row), passwordHash: row.password_hash };
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
  role: UserRole;
  is_active: boolean;
};

export async function getSessionUser(
  token: string | undefined,
): Promise<AppUser | null> {
  if (!token) return null;
  await ensureInstallationSchema();
  const rows = await queryProxy<SessionRow>(
    [
      "select s.user_id, s.expires_at, u.username, u.display_name, u.role, u.is_active",
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

  // "Last seen" for the admin session view, and the renewal that keeps an
  // active session from ever aging out: every check pushes the expiry back to
  // a full term. Best-effort on purpose — a failure here must not block the
  // request actually being served, and the next check will renew it anyway.
  queryProxy(
    "update public.app_sessions set last_seen_at = now(), expires_at = $2 where id = $1",
    [token, new Date(Date.now() + SESSION_MAX_AGE_SECONDS * 1000).toISOString()],
  ).catch(() => {});

  return {
    id: row.user_id,
    username: row.username,
    displayName: row.display_name,
    role: row.role,
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
