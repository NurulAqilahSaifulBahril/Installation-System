import { NextResponse } from "next/server";
import { AuthError, requireAdmin, requireUser } from "@/lib/auth";
import { queryProxy } from "@/lib/proxy-db";
import { DO_MAX_BYTES, ensureDoFilesTable } from "@/lib/warehouse-do-files";

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
};

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
        "select id, file_name, mime_type, size_bytes, note, uploaded_by_name, uploaded_at",
        "from public.warehouse_do_files",
        "order by uploaded_at desc",
        "limit 100",
      ].join(String.fromCharCode(10)),
    );
    return NextResponse.json({
      files: rows.map((row) => ({
        id: row.id,
        fileName: row.file_name,
        mimeType: row.mime_type,
        sizeBytes: Number(row.size_bytes),
        note: row.note ?? "",
        uploadedBy: row.uploaded_by_name,
        uploadedAt: row.uploaded_at,
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
  const fileName = (file.name || "delivery-order").slice(0, 200);

  try {
    await ensureDoFilesTable();
    const id = crypto.randomUUID();
    const base64 = Buffer.from(await file.arrayBuffer()).toString("base64");
    await queryProxy(
      [
        "insert into public.warehouse_do_files",
        "  (id, file_name, mime_type, size_bytes, note, uploaded_by, uploaded_by_name, data)",
        "values ($1, $2, $3, $4, $5, $6, $7, decode($8, 'base64'))",
      ].join(String.fromCharCode(10)),
      [id, fileName, file.type || "application/octet-stream", file.size, note || null, admin.id, admin.displayName || admin.username, base64],
    );
    return NextResponse.json({ ok: true, id, fileName });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Could not save the file." },
      { status: 503 },
    );
  }
}
