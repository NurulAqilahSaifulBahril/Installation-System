import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { AuthError } from "@/lib/auth";
import { requireUser } from "@/lib/warehouse-auth";
import { queryProxy } from "@/lib/proxy-db";

export const dynamic = "force-dynamic";

// Lorry photos for the Loading page's lorry view (Item List - Preparing): one photo per item card
// (Panel, Inverter, Battery, Mounting Structure, Electrical Item) per lorry. A lorry is its slot
// day, driver and plate ("2026-11-16|HERY|WJX 3918"). Once every card has a photo, the lorry
// can be submitted as loaded.
// The same table also keeps a Stock Out job's own photos under "job:<reference>" (e.g. the photo
// of the panel boxes taken on Preparing, item "panel"); those are a record only.
//
//  - GET ?lorry=<key>: { photos: { panel: "data:image/jpeg;base64,…", … } }
//  - PUT { lorry, item, photo }: saves (or replaces) that card's photo.
// Any signed-in Inventory Management user, Loading access included (drivers take these).

const ITEMS = ["panel", "inverter", "battery", "mounting", "electrical", "commercial"] as const;

let ready: Promise<void> | null = null;
function ensureTable(): Promise<void> {
  if (!ready) {
    ready = queryProxy(
      [
        "create table if not exists public.warehouse_lorry_photos (",
        "  lorry_key text not null,",
        "  item text not null,",
        "  photo text not null,",
        "  taken_by text,",
        "  taken_at timestamptz not null default now(),",
        "  primary key (lorry_key, item)",
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

const lorryKey = z.string().min(3).max(200);

export async function GET(request: NextRequest) {
  try {
    await requireUser();
  } catch (error) {
    return authFailure(error);
  }
  const parsed = lorryKey.safeParse(request.nextUrl.searchParams.get("lorry")?.trim() ?? "");
  if (!parsed.success) return NextResponse.json({ error: "lorry is required." }, { status: 400 });
  try {
    await ensureTable();
    const rows = await queryProxy<{ item: string; photo: string }>(
      "select item, photo from public.warehouse_lorry_photos where lorry_key = $1",
      [parsed.data],
    );
    return NextResponse.json({ photos: Object.fromEntries(rows.map((row) => [row.item, row.photo])) });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Could not load the lorry photos." },
      { status: 503 },
    );
  }
}

const putSchema = z.object({
  lorry: lorryKey,
  item: z.enum(ITEMS),
  // A resized JPEG / PNG / WebP as a data: URL (about 3 MB at most), as for New Stock Out.
  photo: z
    .string()
    .max(3_000_000)
    .regex(/^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/),
});

export async function PUT(request: NextRequest) {
  let user;
  try {
    user = await requireUser();
  } catch (error) {
    return authFailure(error);
  }
  const parsed = putSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "A lorry, an item and a photo are required." }, { status: 400 });
  try {
    await ensureTable();
    await queryProxy(
      [
        "insert into public.warehouse_lorry_photos (lorry_key, item, photo, taken_by) values ($1, $2, $3, $4)",
        "on conflict (lorry_key, item) do update set photo = excluded.photo, taken_by = excluded.taken_by, taken_at = now()",
      ].join(String.fromCharCode(10)),
      [parsed.data.lorry, parsed.data.item, parsed.data.photo, user.displayName || user.username],
    );
    return NextResponse.json({ ok: true });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Could not save the photo." },
      { status: 503 },
    );
  }
}
