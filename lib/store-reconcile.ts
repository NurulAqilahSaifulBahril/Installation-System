import type { InstallationJob } from '@/lib/types';

// Two stores hold the same per-job fields: the installation_jobs table, which
// the jobs API reads, and the jobUpdates blob inside installation_ops_state,
// which the browser lays over the API's answer. saveJob writes both, so they
// agree for anything saved while both paths were working — but a save whose
// table write failed leaves the edit in ops-state alone, and the client goes
// on showing it, so nothing ever reveals the loss.
//
// Measured on live data, the gap ran one way only: 57 delivery dates, two
// replacement dates and two availability remarks sat in ops-state with the
// table column empty, and the table held nothing ops-state lacked. So the rule
// is deliberately asymmetric — a value in ops-state fills a table column that
// disagrees, and an empty ops-state value never clears a stored one. It cannot
// delete; the worst it can do is fail to fill something in.
const RECONCILED_FIELDS = [
  // The status belongs in this list, and leaving it out did real damage.
  // Reconciling every other field ops-state -> table while letting the table
  // decide the status meant a job with no table row at all read as "not_set",
  // and that default was then written back over the Reschedule someone had
  // actually set. Three customers lost their status that way. Every field the
  // two stores share has to travel the same direction; the computed part of
  // the status is applied afterwards, on top of whichever value survives here.
  ['customerAvailabilityStatus', 'customer_availability_status'],
  ['installationDate', 'installation_date'],
  ['preferredInstallationDate', 'preferred_installation_date'],
  ['secondPreferredInstallationDate', 'second_preferred_installation_date'],
  ['preferredInstallationTime', 'preferred_installation_time'],
  ['availabilityRemarks', 'availability_remarks'],
  ['deliveryDate', 'delivery_date'],
  ['arrivalDate', 'arrival_date'],
  ['warehouseLocation', 'warehouse_location'],
  ['stockDetails', 'stock_details'],
] as const;

export type StorePatch = Record<string, string | null>;

function usableValue(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed === '' ? null : trimmed;
}

// A date column compared as a plain day. The table returns timestamps and
// ops-state stores "YYYY-MM-DD", so comparing them raw reports every date as
// a disagreement and rewrites the whole table on every load.
function sameValue(a: unknown, b: unknown): boolean {
  const left = usableValue(a);
  const right = usableValue(b);
  if (left === null || right === null) return left === right;
  return left.slice(0, 10) === right.slice(0, 10);
}

// The rows whose table columns are behind what ops-state holds. One entry per
// job, carrying only the fields that actually differ, so the update statement
// touches nothing it does not have to.
// jobUpdates is stored as opaque JSON (see OpsState), so it arrives untyped
// and each entry is read defensively rather than trusted to be a JobUpdate.
export function planStoreReconciliation(
  jobs: InstallationJob[],
  jobUpdates: Record<string, unknown>,
): StorePatch[] {
  const patches: StorePatch[] = [];
  for (const job of jobs) {
    const stored = jobUpdates[job.id] as Record<string, unknown> | undefined;
    if (!stored) continue;
    const patch: StorePatch = {};
    let changed = false;
    for (const [jobKey, column] of RECONCILED_FIELDS) {
      const opsValue = usableValue(stored[jobKey]);
      if (opsValue === null) continue;
      if (sameValue(opsValue, (job as unknown as Record<string, unknown>)[jobKey])) {
        continue;
      }
      patch[column] = opsValue;
      changed = true;
    }
    if (!changed) continue;
    patch.source_invoice_id = job.id;
    // Only read when the row has to be created; an existing row keeps its own.
    patch.invoice_number = job.invoiceNumber ?? '';
    patch.customer_name = job.customerName ?? '';
    patches.push(patch);
  }
  return patches;
}

// Applies those patches to the jobs about to be returned, so the response and
// the table say the same thing on this load rather than only on the next one.
export function applyStoreReconciliation(
  jobs: InstallationJob[],
  patches: StorePatch[],
): InstallationJob[] {
  if (patches.length === 0) return jobs;
  const byId = new Map(patches.map((patch) => [patch.source_invoice_id, patch]));
  const columnToKey = new Map<string, string>(
    RECONCILED_FIELDS.map(([jobKey, column]) => [column as string, jobKey as string]),
  );
  return jobs.map((job) => {
    const patch = byId.get(job.id);
    if (!patch) return job;
    const next = { ...job } as unknown as Record<string, unknown>;
    for (const [column, value] of Object.entries(patch)) {
      const key = columnToKey.get(column);
      if (key) next[key] = value;
    }
    return next as unknown as InstallationJob;
  });
}

// Two statements rather than one upsert, and the reason is worth keeping.
//
// An upsert reads its update values from `excluded`, which is the row the
// insert would have written — and that row has already had every absent field
// turned into '' to satisfy the not-null columns. So `coalesce(excluded.col,
// existing)` never sees a null, and a patch carrying one changed field would
// blank every other text column on that row. Splitting the two keeps the
// update reading the patch directly, where an absent field really is null and
// coalesce does what it looks like it does.
//
// The insert half exists because six jobs were found holding edits in
// ops-state with no table row at all to receive them — notes like "Reschedule
// from 22/7 to later, wait customer inform, house under reno" that lived
// nowhere but the JSON blob. An update alone would have skipped exactly the
// rows in most danger of being lost.
const RECONCILE_COLUMNS = RECONCILED_FIELDS.map(([, column]) => column);

const isDateColumn = (column: string) => column.endsWith('_date');

// What a newly inserted row gets for a column the patch does not carry. Text
// columns are empty by default, but the status column is not free-text — an
// empty string there is not a status any of the code recognises, and it would
// read as "not_set" only by accident. Spelling it out keeps a created row
// indistinguishable from one the app itself would have written.
const INSERT_FALLBACKS: Record<string, string> = {
  customer_availability_status: 'not_set',
};

const insertedValue = (column: string) =>
  isDateColumn(column)
    ? `  patch.${column}::date`
    : `  coalesce(patch.${column}, '${INSERT_FALLBACKS[column] ?? ''}')`;

const PATCH_RECORDSET = [
  'from jsonb_to_recordset($1::jsonb) as patch(',
  '  source_invoice_id text,',
  '  invoice_number text,',
  '  customer_name text,',
  RECONCILE_COLUMNS.map((column) => `  ${column} text`).join(',\n'),
  ')',
].join('\n');

// Creates only the rows that do not exist yet. `on conflict do nothing` rather
// than `do update`, so an existing row is left entirely to the update below.
export const RECONCILE_INSERT_SQL = [
  'insert into public.installation_jobs (',
  '  id,',
  '  source_invoice_id,',
  '  invoice_number,',
  '  customer_name,',
  RECONCILE_COLUMNS.map((column) => `  ${column}`).join(',\n'),
  ')',
  'select',
  '  patch.source_invoice_id,',
  '  patch.source_invoice_id,',
  "  coalesce(patch.invoice_number, ''),",
  "  coalesce(patch.customer_name, ''),",
  RECONCILE_COLUMNS.map(insertedValue).join(',\n'),
  PATCH_RECORDSET,
  'on conflict (source_invoice_id) do nothing',
].join('\n');

// Fills in existing rows. Reading straight from `patch` is the point: a field
// the patch does not carry arrives as a genuine null, so coalesce keeps what
// the row already had instead of overwriting it with an empty string.
export const RECONCILE_UPDATE_SQL = [
  'update public.installation_jobs as target set',
  RECONCILE_COLUMNS.map(
    (column) =>
      `  ${column} = coalesce(patch.${column}${
        isDateColumn(column) ? '::date' : ''
      }, target.${column})`,
  ).join(',\n'),
  PATCH_RECORDSET,
  'where target.source_invoice_id = patch.source_invoice_id',
].join('\n');
