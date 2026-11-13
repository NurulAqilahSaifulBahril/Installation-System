import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { AuthError } from "@/lib/auth";
import { requireUser } from "@/lib/warehouse-auth";
import { queryProxy } from "@/lib/proxy-db";

export const dynamic = "force-dynamic";

// Serial codes scanned on a PO's Stock In Verification page: one row per unit, saved the moment
// it is scanned so nothing is lost on reload. A serial can be on only one PO.
//  - GET ?po=<po id>: the PO's scans, oldest first.
//  - POST { po, serial, lineIdx }: record one serial against a PO line.
//  - DELETE { po, serial }: take a serial off the PO (a wrong scan).
// Any signed-in Inventory Management / dashboard user.

let ready: Promise<void> | null = null;

function ensureTable(): Promise<void> {
  if (!ready) {
    ready = queryProxy(
      [
        "create table if not exists public.warehouse_po_scans (",
        "  po_id text not null,",
        "  serial text not null,",
        "  line_idx integer not null,",
        "  scanned_by text,",
        "  scanned_at timestamptz not null default now(),",
        "  primary key (po_id, serial)",
        ")",
      ].join(String.fromCharCode(10)),
    )
      .then(() => undefined)
      .catch((error) => {
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

type ScanRow = { serial: string; line_idx: number; scanned_by: string | null; scanned_at: string };

export async function GET(request: NextRequest) {
  try {
    await requireUser();
  } catch (error) {
    return authFailure(error);
  }
  const po = request.nextUrl.searchParams.get("po")?.trim() ?? "";
  if (!po) return NextResponse.json({ error: "po is required." }, { status: 400 });
  try {
    await ensureTable();
    const rows = await queryProxy<ScanRow>(
      "select serial, line_idx, scanned_by, scanned_at from public.warehouse_po_scans where po_id = $1 order by scanned_at asc",
      [po],
    );
    return NextResponse.json({
      scans: rows.map((row) => ({
        serial: row.serial,
        lineIdx: Number(row.line_idx),
        scannedBy: row.scanned_by ?? "",
        scannedAt: row.scanned_at,
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
  po: z.string().min(1).max(100),
  serial: z.string().trim().min(1).max(200),
  lineIdx: z.number().int().min(0).max(500),
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
  const { po, serial, lineIdx } = parsed.data;
  try {
    await ensureTable();
    // A serial belongs to one PO only (case-insensitive).
    const existing = await queryProxy<{ po_id: string; file_name: string | null }>(
      [
        "select s.po_id, f.file_name",
        "from public.warehouse_po_scans s",
        "left join public.warehouse_do_files f on f.id = s.po_id",
        "where lower(s.serial) = lower($1)",
        "limit 1",
      ].join(String.fromCharCode(10)),
      [serial],
    );
    if (existing[0]) {
      const where = existing[0].po_id === po ? "this PO" : existing[0].file_name || "another PO";
      return NextResponse.json({ error: `S/N ${serial} was already scanned on ${where}.`, duplicate: true }, { status: 409 });
    }
    await queryProxy(
      "insert into public.warehouse_po_scans (po_id, serial, line_idx, scanned_by) values ($1, $2, $3, $4)",
      [po, serial, lineIdx, user.username || user.displayName],
    );
    return NextResponse.json({ ok: true });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Could not save the scan." },
      { status: 503 },
    );
  }
}

const deleteSchema = z.object({
  po: z.string().min(1).max(100),
  serial: z.string().min(1).max(200),
});

export async function DELETE(request: Request) {
  try {
    await requireUser();
  } catch (error) {
    return authFailure(error);
  }
  const parsed = deleteSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Invalid request." }, { status: 400 });
  try {
    await ensureTable();
    await queryProxy("delete from public.warehouse_po_scans where po_id = $1 and serial = $2", [
      parsed.data.po,
      parsed.data.serial,
    ]);
    return NextResponse.json({ ok: true });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Could not remove the scan." },
      { status: 503 },
    );
  }
}
