import { NextRequest, NextResponse } from "next/server";
import { AuthError } from "@/lib/auth";
import { requireAdmin } from "@/lib/warehouse-auth";
import { querySource } from "@/lib/source-api";

export const dynamic = "force-dynamic";

// Names an admin may pick when adding an Inventory Management user: people who exist in
// prod_main's "user" table. Admin only; returns a short, searchable list, never the table.

export async function GET(request: NextRequest) {
  try {
    await requireAdmin();
  } catch (error) {
    const status = error instanceof AuthError ? error.status : 401;
    const message = error instanceof AuthError ? error.message : "Not signed in.";
    return NextResponse.json({ error: message }, { status });
  }

  const term = request.nextUrl.searchParams.get("q")?.trim() ?? "";
  if (term.length < 2) return NextResponse.json({ people: [] });

  try {
    const rows = await querySource<{ name: string | null; contact: string | null }>(
      [
        'select name, contact from public."user"',
        "where name ilike $1 and trim(coalesce(name, '')) <> ''",
        "order by name",
        "limit 20",
      ].join(String.fromCharCode(10)),
      [`%${term}%`],
    );
    return NextResponse.json({
      people: rows.map((row) => ({ name: (row.name ?? "").trim(), phone: (row.contact ?? "").trim() })),
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Could not search names." },
      { status: 503 },
    );
  }
}
