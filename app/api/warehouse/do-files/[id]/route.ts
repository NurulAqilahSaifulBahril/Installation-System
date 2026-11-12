import { NextRequest, NextResponse } from "next/server";
import { AuthError, requireUser } from "@/lib/auth";
import { queryProxy } from "@/lib/proxy-db";
import { ensureDoFilesTable, INLINE_SAFE_TYPES } from "@/lib/warehouse-do-files";

export const dynamic = "force-dynamic";

// Download or view one delivery order. Any signed-in dashboard user.
// Any file type can be uploaded, so the response is locked down: only PDF and common image
// types are shown inline; everything else downloads. "nosniff" and a sandboxing CSP stop a
// browser from running an uploaded page or script.

export async function GET(_request: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    await requireUser();
  } catch (error) {
    const status = error instanceof AuthError ? error.status : 401;
    const message = error instanceof AuthError ? error.message : "Not signed in.";
    return NextResponse.json({ error: message }, { status });
  }

  const { id } = await context.params;
  try {
    await ensureDoFilesTable();
    const rows = await queryProxy<{ file_name: string; mime_type: string; b64: string }>(
      "select file_name, mime_type, encode(data, 'base64') as b64 from public.warehouse_do_files where id = $1",
      [id],
    );
    const row = rows[0];
    if (!row) return NextResponse.json({ error: "Not found." }, { status: 404 });

    const inline = INLINE_SAFE_TYPES.has(row.mime_type);
    const bytes = Buffer.from(row.b64, "base64");
    return new Response(bytes, {
      headers: {
        "Content-Type": inline ? row.mime_type : "application/octet-stream",
        "Content-Length": String(bytes.length),
        "Content-Disposition": `${inline ? "inline" : "attachment"}; filename*=UTF-8''${encodeURIComponent(row.file_name)}`,
        "X-Content-Type-Options": "nosniff",
        "Content-Security-Policy": "sandbox; default-src 'none'; img-src 'self' data:; style-src 'unsafe-inline'",
        "Cache-Control": "private, no-store",
      },
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Could not read the file." },
      { status: 503 },
    );
  }
}
