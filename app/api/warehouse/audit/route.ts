import { NextRequest, NextResponse } from "next/server";
import { AuthError } from "@/lib/auth";
import { requireAdmin } from "@/lib/warehouse-auth";
import { queryProxy } from "@/lib/proxy-db";

export const dynamic = "force-dynamic";

// The Inventory Management audit log: its own table, separate from the Scheduling
// Operation system's app_audit_log (which this route never reads or changes). It starts
// empty and records what admins do on the Inventory Management Admin tab. Admin only.

const PAGE_SIZE = 100;

type AuditRow = {
  id: number;
  username: string;
  action: string;
  entity_type: string;
  entity_id: string | null;
  summary: string;
  created_at: string;
};

let tableReady: Promise<void> | null = null;

// Created on first use (idempotent), so no separate migration step is needed.
function ensureTable(): Promise<void> {
  if (!tableReady) {
    tableReady = queryProxy(
      [
        "create table if not exists public.warehouse_audit_log (",
        "  id bigserial primary key,",
        "  user_id text,",
        "  username text not null,",
        "  action text not null,",
        "  entity_type text not null,",
        "  entity_id text,",
        "  summary text not null,",
        "  created_at timestamptz not null default now()",
        ")",
      ].join(String.fromCharCode(10)),
    )
      .then(() => undefined)
      .catch((error) => {
        tableReady = null;
        throw error;
      });
  }
  return tableReady;
}

function authFailure(error: unknown) {
  const status = error instanceof AuthError ? error.status : 401;
  const message = error instanceof AuthError ? error.message : "Not signed in.";
  return NextResponse.json({ error: message }, { status });
}

export async function GET(request: NextRequest) {
  try {
    await requireAdmin();
  } catch (error) {
    return authFailure(error);
  }

  const params = request.nextUrl.searchParams;
  const search = params.get("search")?.trim() || "";
  const page = Math.max(0, Number(params.get("page")) || 0);

  try {
    await ensureTable();
    const values: unknown[] = [];
    let where = "";
    if (search) {
      values.push(`%${search}%`);
      where = `where summary ilike $${values.length} or username ilike $${values.length} or action ilike $${values.length}`;
    }
    values.push(PAGE_SIZE + 1, page * PAGE_SIZE);
    const rows = await queryProxy<AuditRow>(
      [
        "select id, username, action, entity_type, entity_id, summary, created_at",
        "from public.warehouse_audit_log",
        where,
        "order by created_at desc, id desc",
        `limit $${values.length - 1} offset $${values.length}`,
      ].join(String.fromCharCode(10)),
      values,
    );
    return NextResponse.json({
      entries: rows.slice(0, PAGE_SIZE).map((row) => ({
        id: row.id,
        username: row.username,
        action: row.action,
        entityType: row.entity_type,
        entityId: row.entity_id,
        summary: row.summary,
        createdAt: row.created_at,
      })),
      hasMore: rows.length > PAGE_SIZE,
      page,
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Could not load the audit log." },
      { status: 503 },
    );
  }
}

// Append one entry, attributed to the signed-in admin.
export async function POST(request: Request) {
  let admin;
  try {
    admin = await requireAdmin();
  } catch (error) {
    return authFailure(error);
  }

  const body = (await request.json().catch(() => null)) as {
    action?: unknown;
    entityType?: unknown;
    entityId?: unknown;
    summary?: unknown;
  } | null;
  const action = typeof body?.action === "string" ? body.action.trim().slice(0, 60) : "";
  const entityType = typeof body?.entityType === "string" ? body.entityType.trim().slice(0, 60) : "";
  const summary = typeof body?.summary === "string" ? body.summary.trim().slice(0, 500) : "";
  const entityId = typeof body?.entityId === "string" ? body.entityId.trim().slice(0, 100) : null;
  if (!action || !entityType || !summary) {
    return NextResponse.json({ error: "action, entityType and summary are required." }, { status: 400 });
  }

  try {
    await ensureTable();
    await queryProxy(
      [
        "insert into public.warehouse_audit_log (user_id, username, action, entity_type, entity_id, summary)",
        "values ($1, $2, $3, $4, $5, $6)",
      ].join(String.fromCharCode(10)),
      [admin.id, admin.username, action, entityType, entityId, summary],
    );
    return NextResponse.json({ ok: true });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Could not write the audit log." },
      { status: 503 },
    );
  }
}
