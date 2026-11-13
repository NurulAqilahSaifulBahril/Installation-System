import { NextRequest, NextResponse } from "next/server";
import { AuthError } from "@/lib/auth";
import { requireAdmin, requireUser } from "@/lib/warehouse-auth";
import { queryProxy } from "@/lib/proxy-db";
import { ensureDoFilesTable, INLINE_SAFE_TYPES, PO_ITEM_TYPES } from "@/lib/warehouse-do-files";

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

// Update a PO:
//  - { itemType }: what the PO is for (its Stock In "Item Type"). Admins only, like uploading.
//  - { verified: true }: Stock In verification done (every unit scanned). Any signed-in user;
//    records who and when. { verified: false } clears it.
export async function PATCH(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const body = (await request.json().catch(() => ({}))) as { itemType?: unknown; verified?: unknown };
  const { id } = await context.params;

  if (typeof body.verified === "boolean") {
    let user;
    try {
      user = await requireUser();
    } catch (error) {
      const status = error instanceof AuthError ? error.status : 401;
      const message = error instanceof AuthError ? error.message : "Not signed in.";
      return NextResponse.json({ error: message }, { status });
    }
    try {
      await ensureDoFilesTable();
      const rows = await queryProxy<{ id: string; verified_at: string | null; verified_by: string | null }>(
        body.verified
          ? "update public.warehouse_do_files set verified_at = now(), verified_by = $2 where id = $1 returning id, verified_at, verified_by"
          : "update public.warehouse_do_files set verified_at = null, verified_by = null where id = $1 returning id, verified_at, verified_by",
        body.verified ? [id, user.username || user.displayName] : [id],
      );
      if (!rows[0]) return NextResponse.json({ error: "Not found." }, { status: 404 });
      return NextResponse.json({ ok: true, id, verifiedAt: rows[0].verified_at ?? "", verifiedBy: rows[0].verified_by ?? "" });
    } catch (error) {
      return NextResponse.json(
        { error: error instanceof Error ? error.message : "Could not save the verification." },
        { status: 503 },
      );
    }
  }

  try {
    await requireAdmin();
  } catch (error) {
    const status = error instanceof AuthError ? error.status : 401;
    const message = error instanceof AuthError ? error.message : "Not signed in.";
    return NextResponse.json({ error: message }, { status });
  }

  const itemType = typeof body.itemType === "string" ? body.itemType : "";
  if (!(PO_ITEM_TYPES as readonly string[]).includes(itemType)) {
    return NextResponse.json({ error: "Choose a valid item type." }, { status: 400 });
  }

  try {
    await ensureDoFilesTable();
    const rows = await queryProxy<{ id: string }>(
      "update public.warehouse_do_files set item_type = $2 where id = $1 returning id",
      [id, itemType],
    );
    if (!rows[0]) return NextResponse.json({ error: "Not found." }, { status: 404 });
    return NextResponse.json({ ok: true, id, itemType });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Could not save the item type." },
      { status: 503 },
    );
  }
}
