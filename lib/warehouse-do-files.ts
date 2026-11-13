import { queryProxy } from "@/lib/proxy-db";

// Delivery orders (DO) uploaded on the Inventory Management Stock In screen. The file bytes
// live in the operations database (the app has no other durable file storage). The table is
// created on first use (idempotent).

export const DO_MAX_BYTES = 10 * 1024 * 1024;

// Item types a PO can be for (the Stock In "Item Type" column).
export const PO_ITEM_TYPES = ["panel", "inverter", "battery", "mounting", "electrical", "special", "other"] as const;

let ready: Promise<void> | null = null;

export function ensureDoFilesTable(): Promise<void> {
  if (!ready) {
    ready = queryProxy(
      [
        "create table if not exists public.warehouse_do_files (",
        "  id text primary key,",
        "  file_name text not null,",
        "  mime_type text not null,",
        "  size_bytes bigint not null,",
        "  note text,",
        "  uploaded_by text,",
        "  uploaded_by_name text not null,",
        "  uploaded_at timestamptz not null default now(),",
        "  data bytea not null",
        ")",
      ].join(String.fromCharCode(10)),
    )
      // The date written on the PO, entered when it is uploaded (added later, so older rows
      // have none and fall back to their upload day).
      .then(() => queryProxy("alter table public.warehouse_do_files add column if not exists po_date date"))
      // What the PO is for (panel, inverter, battery, ...), chosen at upload.
      .then(() => queryProxy("alter table public.warehouse_do_files add column if not exists item_type text"))
      // Item lines read from the PO PDF (item code, description, unit, qty). Null = not read yet.
      .then(() => queryProxy("alter table public.warehouse_do_files add column if not exists po_lines jsonb"))
      // Stock In verification of the PO: who verified it (every unit scanned) and when.
      .then(() => queryProxy("alter table public.warehouse_do_files add column if not exists verified_at timestamptz"))
      .then(() => queryProxy("alter table public.warehouse_do_files add column if not exists verified_by text"))
      .then(() => undefined)
      .catch((error) => {
        ready = null;
        throw error;
      });
  }
  return ready;
}

// Any file type may be uploaded, so what comes back out is locked down: only these types
// are ever shown in the browser; everything else (html, svg, scripts, ...) is download-only.
export const INLINE_SAFE_TYPES = new Set([
  "application/pdf",
  "image/png",
  "image/jpeg",
  "image/gif",
  "image/webp",
]);
