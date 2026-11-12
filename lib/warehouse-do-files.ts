import { queryProxy } from "@/lib/proxy-db";

// Delivery orders (DO) uploaded on the Inventory Management Stock In screen. The file bytes
// live in the operations database (the app has no other durable file storage). The table is
// created on first use (idempotent).

export const DO_MAX_BYTES = 10 * 1024 * 1024;

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
