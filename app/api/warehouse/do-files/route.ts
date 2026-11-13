import { NextResponse } from "next/server";
import { AuthError } from "@/lib/auth";
import { requireAdmin, requireUser } from "@/lib/warehouse-auth";
import { queryProxy } from "@/lib/proxy-db";
import { DO_MAX_BYTES, PO_ITEM_TYPES, ensureDoFilesTable } from "@/lib/warehouse-do-files";
import { readPo, readPoLines, type PoLine } from "@/lib/warehouse-po-parse";

export const dynamic = "force-dynamic";

// Delivery order (DO) files for the Stock In screen.
//  - GET: the list, newest first. Any signed-in dashboard user.
//  - POST: upload one file (multipart: "file", optional "note"). Admins only.
// The file bytes never leave the server in this list; they are served by /do-files/[id].

function authFailure(error: unknown) {
  const status = error instanceof AuthError ? error.status : 401;
  const message = error instanceof AuthError ? error.message : "Not signed in.";
  return NextResponse.json({ error: message }, { status });
}

type DoRow = {
  id: string;
  file_name: string;
  mime_type: string;
  size_bytes: string | number;
  note: string | null;
  uploaded_by_name: string;
  uploaded_at: string;
  po_date: string | null;
  item_type: string | null;
  po_lines: PoLine[] | null;
  verified_at: string | null;
  verified_by: string | null;
};

// jsonb can come back from the proxy as a parsed value or as JSON text.
function asPoLines(value: unknown): PoLine[] {
  const parsed = typeof value === "string" ? (() => { try { return JSON.parse(value); } catch { return null; } })() : value;
  return Array.isArray(parsed) ? (parsed as PoLine[]) : [];
}

// POs uploaded before item lines were read have po_lines = null. A few are read per list
// request (from their stored PDF) and saved, so they fill in without a separate job.
const BACKFILL_PER_REQUEST = 3;

async function backfillPoLines(rows: DoRow[]): Promise<void> {
  const missing = rows.filter((row) => row.po_lines === null && row.mime_type === "application/pdf").slice(0, BACKFILL_PER_REQUEST);
  for (const row of missing) {
    try {
      const data = await queryProxy<{ b64: string }>(
        "select encode(data, 'base64') as b64 from public.warehouse_do_files where id = $1",
        [row.id],
      );
      if (!data[0]) continue;
      const lines = await readPoLines(new Uint8Array(Buffer.from(data[0].b64, "base64")), row.mime_type);
      await queryProxy("update public.warehouse_do_files set po_lines = $2::jsonb where id = $1", [row.id, JSON.stringify(lines)]);
      row.po_lines = lines;
    } catch (error) {
      console.error("[warehouse/do-files] could not read PO lines", row.id, error);
    }
  }
}

export async function GET() {
  try {
    await requireUser();
  } catch (error) {
    return authFailure(error);
  }
  try {
    await ensureDoFilesTable();
    const rows = await queryProxy<DoRow>(
      [
        "select f.id, f.file_name, f.mime_type, f.size_bytes, f.note, f.uploaded_at,",
        "  to_char(f.po_date, 'YYYY-MM-DD') as po_date, f.item_type, f.po_lines, f.verified_at, f.verified_by,",
        // Show the uploader's username (Inventory Management user, else dashboard user);
        // the name saved at upload is the fallback for an account that no longer exists.
        "  coalesce(nullif(wu.username, ''), nullif(au.username, ''), f.uploaded_by_name) as uploaded_by_name",
        "from public.warehouse_do_files f",
        "left join public.warehouse_users wu on wu.id::text = f.uploaded_by",
        "left join public.app_users au on au.id::text = f.uploaded_by",
        "order by f.uploaded_at desc",
        "limit 100",
      ].join(String.fromCharCode(10)),
    );
    await backfillPoLines(rows);
    return NextResponse.json({
      files: rows.map((row) => ({
        id: row.id,
        fileName: row.file_name,
        mimeType: row.mime_type,
        sizeBytes: Number(row.size_bytes),
        note: row.note ?? "",
        uploadedBy: row.uploaded_by_name,
        uploadedAt: row.uploaded_at,
        poDate: row.po_date ?? "",
        itemType: row.item_type ?? "",
        poLines: asPoLines(row.po_lines),
        verifiedAt: row.verified_at ?? "",
        verifiedBy: row.verified_by ?? "",
      })),
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Could not load the delivery orders." },
      { status: 503 },
    );
  }
}

export async function POST(request: Request) {
  let admin;
  try {
    admin = await requireAdmin();
  } catch (error) {
    return authFailure(error);
  }

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return NextResponse.json({ error: "Send the file as a form upload." }, { status: 400 });
  }
  const file = form.get("file");
  if (!(file instanceof File) || file.size === 0) {
    return NextResponse.json({ error: "Choose a file to upload." }, { status: 400 });
  }
  if (file.size > DO_MAX_BYTES) {
    return NextResponse.json(
      { error: `That file is ${(file.size / 1024 / 1024).toFixed(1)} MB. The limit is ${DO_MAX_BYTES / 1024 / 1024} MB.` },
      { status: 413 },
    );
  }
  const note = typeof form.get("note") === "string" ? String(form.get("note")).trim().slice(0, 300) : "";
  const fileName = (file.name || "purchase-order").slice(0, 200);
  // The date on the PO (YYYY-MM-DD), entered at upload. Optional; anything else is ignored.
  const poDateRaw = typeof form.get("poDate") === "string" ? String(form.get("poDate")).trim() : "";
  const poDate = /^\d{4}-\d{2}-\d{2}$/.test(poDateRaw) ? poDateRaw : null;
  // What the PO is for; only the known item types are kept.
  const itemTypeRaw = typeof form.get("itemType") === "string" ? String(form.get("itemType")).trim() : "";
  const itemType = (PO_ITEM_TYPES as readonly string[]).includes(itemTypeRaw) ? itemTypeRaw : null;

  try {
    await ensureDoFilesTable();
    const id = crypto.randomUUID();
    const buffer = Buffer.from(await file.arrayBuffer());
    const base64 = buffer.toString("base64");
    // Item lines, date and item type, read from the PO PDF. A date or type sent with the upload
    // wins; otherwise the PO's own date and the guessed type are used.
    const reading = await readPo(new Uint8Array(buffer), file.type || "");
    const poLines = reading.lines;
    const savedPoDate = poDate ?? (reading.date || null);
    const savedItemType = itemType ?? (reading.itemType || null);
    await queryProxy(
      [
        "insert into public.warehouse_do_files",
        "  (id, file_name, mime_type, size_bytes, note, uploaded_by, uploaded_by_name, data, po_date, item_type, po_lines)",
        "values ($1, $2, $3, $4, $5, $6, $7, decode($8, 'base64'), $9::date, $10, $11::jsonb)",
      ].join(String.fromCharCode(10)),
      [id, fileName, file.type || "application/octet-stream", file.size, note || null, admin.id, admin.displayName || admin.username, base64, savedPoDate, savedItemType, JSON.stringify(poLines)],
    );
    return NextResponse.json({ ok: true, id, fileName });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Could not save the file." },
      { status: 503 },
    );
  }
}
