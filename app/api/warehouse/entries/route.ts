import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { AuthError } from "@/lib/auth";
import { requireUser } from "@/lib/warehouse-auth";
import { queryProxy } from "@/lib/proxy-db";

export const dynamic = "force-dynamic";

// The quantities typed on the Stock Out Verification screen (mounting parts loaded, and the
// bulk items such as electrical accessories), saved per job so they are still there when the
// job is opened again or the page is reloaded. Needs a dashboard session, like the jobs.

type EntryRow = { job_ref: string; kind: string; entry_key: string; value: string };

let ready: Promise<void> | null = null;

function ensureTable(): Promise<void> {
  if (!ready) {
    ready = (async () => {
      await queryProxy(
        [
          "create table if not exists public.warehouse_job_entries (",
          "  job_ref text not null,",
          "  kind text not null,",
          "  entry_key text not null,",
          "  value text not null,",
          "  updated_by text,",
          "  updated_at timestamptz not null default now(),",
          "  primary key (job_ref, kind, entry_key)",
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

function authFailure(error: unknown) {
  const status = error instanceof AuthError ? error.status : 401;
  const message = error instanceof AuthError ? error.message : "Not signed in.";
  return NextResponse.json({ error: message }, { status });
}

export async function GET(request: NextRequest) {
  try {
    await requireUser();
  } catch (error) {
    return authFailure(error);
  }
  // One job (?job=INV-1) or several at once (?jobs=INV-1,INV-2), for the report.
  const single = request.nextUrl.searchParams.get("job")?.trim() ?? "";
  const many = (request.nextUrl.searchParams.get("jobs") ?? "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean)
    .slice(0, 300);
  const jobs = single ? [single] : many;
  if (jobs.length === 0) return NextResponse.json({ error: "job or jobs is required." }, { status: 400 });
  try {
    await ensureTable();
    const rows = await queryProxy<EntryRow>(
      "select job_ref, kind, entry_key, value from public.warehouse_job_entries where job_ref = any($1::text[])",
      [jobs],
    );
    return NextResponse.json({
      entries: rows.map((row) => ({ job: row.job_ref, kind: row.kind, key: row.entry_key, value: row.value })),
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Could not load the saved quantities." },
      { status: 503 },
    );
  }
}

const putSchema = z.object({
  job: z.string().min(1).max(100),
  // The full current set for these kinds: anything saved earlier but not listed is removed.
  kinds: z.array(z.enum(["mounting_part", "bulk_line", "electrical_part", "pv_drawing"])).min(1),
  entries: z
    .array(
      z.object({
        kind: z.enum(["mounting_part", "bulk_line", "electrical_part", "pv_drawing"]),
        key: z.string().min(1).max(1000),
        value: z.string().min(1).max(20),
      }),
    )
    .max(200),
});

export async function PUT(request: Request) {
  let user;
  try {
    user = await requireUser();
  } catch (error) {
    return authFailure(error);
  }
  const parsed = putSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Invalid quantities." }, { status: 400 });
  const { job, kinds, entries } = parsed.data;

  try {
    await ensureTable();
    // Remove what was cleared, then save what is there now.
    for (const kind of kinds) {
      const keep = entries.filter((entry) => entry.kind === kind).map((entry) => entry.key);
      await queryProxy(
        "delete from public.warehouse_job_entries where job_ref = $1 and kind = $2 and entry_key <> all($3::text[])",
        [job, kind, keep],
      );
    }
    for (const entry of entries) {
      await queryProxy(
        [
          "insert into public.warehouse_job_entries (job_ref, kind, entry_key, value, updated_by)",
          "values ($1, $2, $3, $4, $5)",
          "on conflict (job_ref, kind, entry_key) do update",
          "  set value = excluded.value, updated_by = excluded.updated_by, updated_at = now()",
        ].join(String.fromCharCode(10)),
        [job, entry.kind, entry.key, entry.value, user.displayName || user.username],
      );
    }
    return NextResponse.json({ ok: true });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Could not save the quantities." },
      { status: 503 },
    );
  }
}
