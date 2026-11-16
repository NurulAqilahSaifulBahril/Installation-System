import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { AuthError } from "@/lib/auth";
import { requireUser, requireWriter } from "@/lib/warehouse-auth";
import { queryProxy } from "@/lib/proxy-db";
import { toTitleCase } from "@/lib/title-case";
import { ensureAuditTable } from "@/lib/warehouse-verifications";

export const dynamic = "force-dynamic";

// Last-minute Stock Out: items the PIC takes on top of a job's invoice (or for no job, e.g. a
// warranty replacement). Each record gets its own reference "XO-<n>" and then goes through the
// normal Stock Out Verification page (scan / enter quantities, Verified, Loading), whose
// records are kept under that reference.
//  - GET: every record (without photos). Any signed-in Inventory Management user.
//    GET ?photo=XO-<n>: that record's photo (a data: URL), loaded only when shown.
//  - POST: create one. Any signed-in user (staff too); written to the audit log.

let ready: Promise<void> | null = null;

function ensureTable(): Promise<void> {
  if (!ready) {
    ready = (async () => {
      await queryProxy(
      [
        "create table if not exists public.warehouse_extra_stock_outs (",
        "  id bigserial primary key,",
        "  linked_job text,",
        "  customer_name text not null default '',",
        "  taken_by text not null,",
        "  reason text not null,",
        "  note text not null default '',",
        "  warehouse text not null,",
        "  out_date date not null,",
        "  lines jsonb not null,",
        "  created_by text not null,",
        "  created_at timestamptz not null default now()",
        ")",
      ].join(String.fromCharCode(10)),
      );
      // Photo of the items taken (a small JPEG as a data: URL), added after the first version.
      await queryProxy("alter table public.warehouse_extra_stock_outs add column if not exists photo text");
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
  id: string;
  linked_job: string | null;
  customer_name: string;
  taken_by: string;
  reason: string;
  note: string;
  warehouse: string;
  out_date: string;
  lines: unknown;
  created_by: string;
  created_at: string;
  has_photo: boolean;
};

const CATEGORIES = ["panel", "inverter", "battery", "mounting", "electrical"] as const;
const REASONS = ["extra", "replacement", "damaged", "other"] as const;

const lineSchema = z.object({
  category: z.enum(CATEGORIES),
  model: z.string().trim().min(1).max(200),
  qty: z.number().int().min(1).max(10000),
  // Serial numbers scanned on the New Stock Out form (panel / inverter / battery).
  serials: z.array(z.string().trim().min(1).max(100)).max(1000).optional(),
});

const postSchema = z.object({
  linkedJob: z.string().trim().max(100).optional(),
  customerName: z.string().trim().max(200).optional(),
  takenBy: z.string().trim().min(1).max(100),
  reason: z.enum(REASONS),
  note: z.string().trim().max(500).optional(),
  warehouse: z.enum(["JB", "KL", "KLG"]),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  lines: z.array(lineSchema).min(1).max(50),
  // Photo of the items: a resized JPEG / PNG / WebP as a data: URL (about 3 MB at most).
  photo: z
    .string()
    .max(3_000_000)
    .regex(/^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/)
    .optional(),
});

function toRecord(row: Row) {
  return {
    ref: `XO-${row.id}`,
    linkedJob: row.linked_job ?? "",
    customerName: row.customer_name,
    takenBy: row.taken_by,
    reason: row.reason,
    note: row.note,
    warehouse: row.warehouse,
    date: String(row.out_date).slice(0, 10),
    lines: Array.isArray(row.lines) ? row.lines : [],
    createdBy: row.created_by,
    createdAt: row.created_at,
    hasPhoto: row.has_photo === true,
  };
}

const SELECT = [
  "select id, linked_job, customer_name, taken_by, reason, note, warehouse,",
  "  to_char(out_date, 'YYYY-MM-DD') as out_date, lines, created_by, created_at, photo is not null as has_photo",
  "from public.warehouse_extra_stock_outs",
].join(String.fromCharCode(10));

export async function GET(request: NextRequest) {
  try {
    await requireUser();
  } catch (error) {
    return authFailure(error);
  }
  try {
    await ensureTable();
    const photoRef = request.nextUrl.searchParams.get("photo")?.trim() ?? "";
    if (photoRef) {
      const id = /^XO-(\d+)$/i.exec(photoRef)?.[1];
      if (!id) return NextResponse.json({ error: "Unknown reference." }, { status: 400 });
      const rows = await queryProxy<{ photo: string | null }>(
        "select photo from public.warehouse_extra_stock_outs where id = $1",
        [id],
      );
      return NextResponse.json({ photo: rows[0]?.photo ?? null });
    }
    const rows = await queryProxy<Row>(`${SELECT}\norder by id desc\nlimit 2000`);
    return NextResponse.json({ records: rows.map(toRecord) });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Could not load the last-minute stock outs." },
      { status: 503 },
    );
  }
}

export async function POST(request: Request) {
  let user;
  try {
    user = await requireWriter();
  } catch (error) {
    return authFailure(error);
  }
  const parsed = postSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Fill in who took it, the reason, the warehouse, the date and at least one item with a quantity." },
      { status: 400 },
    );
  }
  const body = parsed.data;
  const createdBy = toTitleCase(user.displayName || user.username);
  try {
    await ensureTable();
    await ensureAuditTable();
    const inserted = await queryProxy<{ id: string }>(
      [
        "insert into public.warehouse_extra_stock_outs",
        "  (linked_job, customer_name, taken_by, reason, note, warehouse, out_date, lines, created_by, photo)",
        "values ($1, $2, $3, $4, $5, $6, $7::date, $8::jsonb, $9, $10)",
        "returning id",
      ].join(String.fromCharCode(10)),
      [
        body.linkedJob || null,
        body.customerName ?? "",
        body.takenBy,
        body.reason,
        body.note ?? "",
        body.warehouse,
        body.date,
        JSON.stringify(body.lines),
        createdBy,
        body.photo ?? null,
      ],
    );
    const id = inserted[0]?.id;
    if (!id) throw new Error("The record was not saved.");
    const ref = `XO-${id}`;
    const forWhat = body.linkedJob ? ` for job ${body.linkedJob}` : "";
    await queryProxy(
      [
        "insert into public.warehouse_audit_log (user_id, username, action, entity_type, entity_id, summary)",
        "values ($1, $2, $3, $4, $5, $6)",
      ].join(String.fromCharCode(10)),
      [
        user.id,
        createdBy,
        "extra_stock_out_created",
        "stock_out",
        ref,
        `Created last-minute Stock Out ${ref}${forWhat}, taken by ${body.takenBy}`,
      ],
    );
    const rows = await queryProxy<Row>(`${SELECT}\nwhere id = $1`, [id]);
    return NextResponse.json({ ok: true, record: toRecord(rows[0]) });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Could not save the last-minute stock out." },
      { status: 503 },
    );
  }
}
