import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { AuthError } from "@/lib/auth";
import { requireUser } from "@/lib/warehouse-auth";
import { queryProxy } from "@/lib/proxy-db";
import { toTitleCase } from "@/lib/title-case";

export const dynamic = "force-dynamic";

// Scans made for a Stock Out job, saved so they survive leaving the page and can be made on
// different devices:
//  - stage "warehouse" (To Verify): a panel BOX barcode (kind "box", qty = panels inside), or one
//    unit's serial (kind "serial": a loose panel, an inverter or a battery).
//  - stage "site" (Loading tab, at the customer's house): each panel's own serial, scanned by
//    the driver / site supervisor when the boxes are opened.
// GET ?job=<ref>: every scan for the job. POST: add one. DELETE: remove one (warehouse only).
// A Loading user (driver) may only add / read site scans.

let ready: Promise<void> | null = null;

function ensureTable(): Promise<void> {
  if (!ready) {
    ready = (async () => {
      await queryProxy(
        [
          "create table if not exists public.warehouse_job_scans (",
          "  id bigserial primary key,",
          "  job_ref text not null,",
          "  stage text not null,",
          "  kind text not null,",
          "  category text not null,",
          "  line_idx integer not null default 0,",
          "  code text not null,",
          "  qty integer not null default 1,",
          "  scanned_by text not null,",
          "  created_at timestamptz not null default now()",
          ")",
        ].join(String.fromCharCode(10)),
      );
      await queryProxy(
        "create unique index if not exists warehouse_job_scans_code_idx on public.warehouse_job_scans (job_ref, stage, lower(code))",
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

type Row = {
  stage: string;
  kind: string;
  category: string;
  line_idx: number;
  code: string;
  qty: number;
  scanned_by: string;
  created_at: string;
};

export async function GET(request: NextRequest) {
  try {
    await requireUser();
  } catch (error) {
    return authFailure(error);
  }
  const job = request.nextUrl.searchParams.get("job")?.trim() ?? "";
  if (!job) return NextResponse.json({ error: "job is required." }, { status: 400 });
  try {
    await ensureTable();
    const rows = await queryProxy<Row>(
      [
        "select stage, kind, category, line_idx, code, qty, scanned_by, created_at",
        "from public.warehouse_job_scans where job_ref = $1 order by id",
      ].join(String.fromCharCode(10)),
      [job],
    );
    return NextResponse.json({
      scans: rows.map((row) => ({
        stage: row.stage,
        kind: row.kind,
        category: row.category,
        lineIdx: Number(row.line_idx),
        code: row.code,
        qty: Number(row.qty),
        by: row.scanned_by,
        at: row.created_at,
      })),
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Could not load the scans." },
      { status: 503 },
    );
  }
}

const postSchema = z.object({
  job: z.string().trim().min(1).max(100),
  stage: z.enum(["warehouse", "site"]),
  kind: z.enum(["box", "serial"]),
  category: z.enum(["panel", "inverter", "battery"]),
  lineIdx: z.number().int().min(0).max(100),
  code: z.string().trim().min(1).max(120),
  qty: z.number().int().min(1).max(1000),
});

export async function POST(request: Request) {
  let user;
  try {
    user = await requireUser();
  } catch (error) {
    return authFailure(error);
  }
  const parsed = postSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Invalid scan." }, { status: 400 });
  const scan = parsed.data;
  if (user.role === "loading" && scan.stage !== "site") {
    return NextResponse.json({ error: "Your access is view only (Loading)." }, { status: 403 });
  }
  // On site (Site Check): one serial at a time, panels (out of their boxes), inverters and batteries.
  if (scan.stage === "site" && scan.kind !== "serial") {
    return NextResponse.json({ error: "On site, scan each unit's serial." }, { status: 400 });
  }
  try {
    await ensureTable();
    const inserted = await queryProxy<{ id: string }>(
      [
        "insert into public.warehouse_job_scans (job_ref, stage, kind, category, line_idx, code, qty, scanned_by)",
        "values ($1, $2, $3, $4, $5, $6, $7, $8)",
        "on conflict (job_ref, stage, lower(code)) do nothing",
        "returning id",
      ].join(String.fromCharCode(10)),
      [
        scan.job,
        scan.stage,
        scan.kind,
        scan.category,
        scan.lineIdx,
        scan.code,
        scan.kind === "box" ? scan.qty : 1,
        toTitleCase(user.displayName || user.username),
      ],
    );
    if (inserted.length === 0) {
      return NextResponse.json({ error: `${scan.code} was already scanned for this job.` }, { status: 409 });
    }
    return NextResponse.json({ ok: true });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Could not save the scan." },
      { status: 503 },
    );
  }
}

const deleteSchema = z.object({
  job: z.string().trim().min(1).max(100),
  stage: z.enum(["warehouse", "site"]),
  code: z.string().trim().min(1).max(120),
});

export async function DELETE(request: Request) {
  let user;
  try {
    user = await requireUser();
  } catch (error) {
    return authFailure(error);
  }
  const parsed = deleteSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Invalid request." }, { status: 400 });
  if (user.role === "loading" && parsed.data.stage !== "site") {
    return NextResponse.json({ error: "Your access is view only (Loading)." }, { status: 403 });
  }
  try {
    await ensureTable();
    await queryProxy("delete from public.warehouse_job_scans where job_ref = $1 and stage = $2 and lower(code) = lower($3)", [
      parsed.data.job,
      parsed.data.stage,
      parsed.data.code,
    ]);
    return NextResponse.json({ ok: true });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Could not remove the scan." },
      { status: 503 },
    );
  }
}
