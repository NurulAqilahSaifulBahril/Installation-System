import { queryProxy } from "@/lib/proxy-db";

// Who verified what on the Stock Out Verification screen. One row per job and material
// (the first time that material was completed, or the job was verified), so reloading the
// page no longer loses it, and the report can print who packed each material.
// Tables are created on first use (idempotent).

let verificationsReady: Promise<void> | null = null;
let auditReady: Promise<void> | null = null;

export function ensureVerificationsTable(): Promise<void> {
  if (!verificationsReady) {
    verificationsReady = (async () => {
      await queryProxy(
        [
          "create table if not exists public.warehouse_verifications (",
          "  id bigserial primary key,",
          "  job_ref text not null,",
          "  material text not null,",
          "  username text not null,",
          "  user_id text,",
          "  created_at timestamptz not null default now()",
          ")",
        ].join(String.fromCharCode(10)),
      );
      await queryProxy(
        "create unique index if not exists warehouse_verifications_job_material_idx on public.warehouse_verifications (job_ref, material)",
      );
    })().catch((error) => {
      verificationsReady = null;
      throw error;
    });
  }
  return verificationsReady;
}

// The Inventory Management audit log table (shared by the audit route and the verifications route).
export function ensureAuditTable(): Promise<void> {
  if (!auditReady) {
    auditReady = queryProxy(
      [
        "create table if not exists public.warehouse_audit_log (",
        "  id bigserial primary key,",
        "  user_id text,",
        "  username text not null,",
        "  action text not null,",
        "  entity_type text not null,",
        "  entity_id text,",
        "  summary text not null,",
        "  created_at timestamptz not null default now()",
        ")",
      ].join(String.fromCharCode(10)),
    )
      .then(() => undefined)
      .catch((error) => {
        auditReady = null;
        throw error;
      });
  }
  return auditReady;
}

// "loaded": the verified job's items were loaded and moved to the customer's house (Stock Out's
// Loading tab).
// "mounting_rail" / "mounting_hook": who packed the Rail, and the Hook, Bracket & Clamp parts.
export const MATERIALS = [
  "job",
  "panel",
  "inverter",
  "battery",
  "mounting",
  "mounting_rail",
  "mounting_hook",
  "electrical",
  "commercial",
  // Every unit of the job scanned on Stock Out › Preparing; the job waits there until its
  // lorry's Submit verifies every customer on the lorry together ("job").
  "scanned",
  "loaded",
  // All panels scanned on site by the driver (Loading tab): arrived safely.
  "arrived",
] as const;
export type Material = (typeof MATERIALS)[number];
