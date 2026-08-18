import { NextRequest, NextResponse } from "next/server";
import { AuthError, requireAdmin } from "@/lib/auth";
import { ensureInstallationSchema } from "@/lib/installation-schema";
import { queryProxy } from "@/lib/proxy-db";

export const dynamic = "force-dynamic";

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

export async function GET(request: NextRequest) {
  try {
    await requireAdmin();
  } catch (error) {
    const status = error instanceof AuthError ? error.status : 401;
    const message = error instanceof AuthError ? error.message : "Not signed in.";
    return NextResponse.json({ error: message }, { status });
  }

  const params = request.nextUrl.searchParams;
  const username = params.get("username")?.trim() || "";
  const action = params.get("action")?.trim() || "";
  const search = params.get("search")?.trim() || "";
  const page = Math.max(0, Number(params.get("page")) || 0);

  const where: string[] = [];
  const values: unknown[] = [];

  if (username) {
    values.push(username);
    where.push(`username = $${values.length}`);
  }
  if (action) {
    values.push(action);
    where.push(`action = $${values.length}`);
  }
  if (search) {
    values.push(`%${search}%`);
    where.push(`summary ilike $${values.length}`);
  }

  const whereSql = where.length ? `where ${where.join(" and ")}` : "";
  values.push(PAGE_SIZE + 1, page * PAGE_SIZE);

  try {
    await ensureInstallationSchema();
    const rows = await queryProxy<AuditRow>(
      [
        "select id, username, action, entity_type, entity_id, summary, created_at",
        "from public.app_audit_log",
        whereSql,
        "order by created_at desc, id desc",
        `limit $${values.length - 1} offset $${values.length}`,
      ].join("\n"),
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
      { error: error instanceof Error ? error.message : "Could not load audit log." },
      { status: 503 },
    );
  }
}
