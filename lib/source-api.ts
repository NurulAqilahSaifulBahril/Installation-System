import { toDateOnly } from "@/lib/dates";
import type { InstallationJob } from "@/lib/types";

type ProxyRow = {
  bubble_id: string;
  invoice_number: string | null;
  total_amount: string | null;
  balance_due: string | null;
  percent_of_total_amount: string | null;
  amount_paid: string | null;
  first_payment_date: string | null;
  second_payment_date: string | null;
  ballast_details: string | null;
  foc_details: string | null;
  battery_details: string | null;
  package_item_description: string | null;
  panel_qty: number | null;
  panel_rating: number | null;
  pv_system_drawing: string[] | string | null;
  customer_name: string | null;
  phone: string | null;
  address: string | null;
  city: string | null;
  state: string | null;
  postcode: string | null;
  agent_name: string | null;
  package_name: string | null;
  inverter_name: string | null;
  seda_status: string | null;
  phase_type: string | null;
  seda_inverter: string | null;
  installation_address: string | null;
  drawing_pdf_system: string[] | string | null;
  updated_at: string | null;
  requested_seda_status: string | null;
  invoice_date: string | null;
};

type ProxyResponse = {
  rows?: ProxyRow[];
  error?: string;
};

// A backstop against an unbounded payload, not a business rule. Now that every
// non-deleted invoice is in scope, this has to sit clear of the whole table
// (8,025 rows as of this writing, ~6 MB and under 2s over the proxy) — the
// order is `updated_at desc`, so a limit that bites would drop the
// longest-untouched jobs, which are exactly the ones still awaiting
// installation. Reaching it means rows are being dropped, so
// fetchEligibleSourceJobs reports it instead of truncating silently.
const SOURCE_ROW_LIMIT = 20000;

export type SourceJobsResult = {
  jobs: InstallationJob[];
  truncated: boolean;
};

const INSTALLATION_SOURCE_QUERY = `
with ranked_payments as (
  select
    linked_invoice,
    payment_date,
    row_number() over (
      partition by linked_invoice
      order by payment_date asc nulls last, created_at asc, id asc
    ) as payment_sequence
  from payment
  where linked_invoice is not null
),
-- What the customer has actually handed over, added up from the ledger.
-- invoice.percent_of_total_amount cannot be trusted on its own: it is written
-- when a payment is first recorded and then left behind, so a customer who has
-- since paid in full still reads at their deposit. It is also inconsistent
-- about units — the same 5% deposit appears as 5 on one invoice and as 0.05 on
-- another. Summing the payments avoids both problems. See rowToJob.
payment_totals as (
  select linked_invoice, sum(amount) as amount_paid
  from payment
  where linked_invoice is not null
  group by linked_invoice
),
-- The deposit. Ranked the same way as the second payment rather than taken as
-- min(payment_date), so an invoice whose payments share a date still resolves
-- to one first and one second row instead of both collapsing onto the same one.
first_payments as (
  select linked_invoice, payment_date as first_payment_date
  from ranked_payments
  where payment_sequence = 1
),
second_payments as (
  select linked_invoice, payment_date as second_payment_date
  from ranked_payments
  where payment_sequence = 2
),
invoice_item_details as (
  select
    linked_invoice,
    string_agg(description, E'\n\n' order by sort nulls last, id)
      filter (where lower(coalesce(description, '')) like '%ballast%')
      as ballast_details,
    string_agg(description, E'\n\n' order by sort nulls last, id)
      filter (
        where lower(coalesce(description, '')) like '%foc%'
          and lower(coalesce(description, '')) not like '%ballast%'
      ) as foc_details,
    string_agg(description, E'\n\n' order by sort nulls last, id)
      filter (where lower(coalesce(description, '')) like '%battery%')
      as battery_details
  from invoice_item
  group by linked_invoice
),
-- The package's own line item, marked by is_a_package rather than found by
-- position — a package can share its invoice with any number of discount and
-- voucher rows in any order. Some invoices carry several is_a_package rows
-- (a later swap re-adds one instead of editing the original); the earliest
-- by sort/id is kept so a post-sale change doesn't silently override what was
-- originally sold. This is the primary source for package/panel/inverter/
-- phase in rowToJob below — the linked_package/product/seda_registration
-- joins are only a backup for the invoices where this text is itself empty.
package_items as (
  select distinct on (linked_invoice)
    linked_invoice,
    description as package_item_description
  from invoice_item
  where is_a_package = true and linked_invoice is not null
  order by linked_invoice, sort nulls last, id
),
-- Emails that reported an approval but that the automated SEDA_ATAP_APPROVAL
-- matcher couldn't confidently attach to a seda_registration row (below its
-- confidence threshold) sit here as still-pending, needing-review tasks. The
-- customer name is the only link back to an invoice, so it's normalised the
-- same way on both sides of the join below (case, whitespace, the "(ATAP)"
-- suffix some customer records carry and the task rows never do).
requested_status as (
  select distinct on (normalized_name)
    normalized_name,
    payload ->> 'status' as requested_seda_status
  from (
    select
      trim(replace(upper(trim(coalesce(customer_name, ''))), '(ATAP)', ''))
        as normalized_name,
      payload,
      created_at
    from seda_tasks
    where status = 'PENDING'
      and requires_manual_review = true
      and coalesce(customer_name, '') <> ''
      and payload ->> 'status' is not null
  ) parsed
  order by normalized_name, created_at desc
)
select
  i.bubble_id,
  i.invoice_number,
  i.invoice_date,
  i.total_amount,
  i.balance_due,
  i.percent_of_total_amount,
  payment_totals.amount_paid,
  first_payments.first_payment_date,
  second_payments.second_payment_date,
  invoice_item_details.ballast_details,
  invoice_item_details.foc_details,
  invoice_item_details.battery_details,
  package_items.package_item_description,
  i.panel_qty,
  i.panel_rating,
  i.pv_system_drawing,
  i.updated_at,
  c.name as customer_name,
  c.phone,
  c.address,
  c.city,
  c.state,
  c.postcode,
  a.name as agent_name,
  p.package_name,
  inverter_product.name as inverter_name,
  s.seda_status,
  s.phase_type,
  s.inverter as seda_inverter,
  s.installation_address,
  s.drawing_pdf_system,
  requested_status.requested_seda_status
from invoice i
left join customer c on c.customer_id = i.linked_customer
-- linked_agent is inconsistent in the source data: most invoices store the
-- agent's linked_user_login there, but a meaningful minority (630 as of this
-- writing) store the agent's own bubble_id instead. Matching either avoids
-- silently blank agent names for that second group. Confirmed collision-free:
-- no agent's linked_user_login equals another agent's bubble_id.
left join agent a
  on a.linked_user_login = i.linked_agent
  or a.bubble_id = i.linked_agent
left join package p on p.bubble_id = i.linked_package
left join product inverter_product on inverter_product.bubble_id = p.inverter_1
left join seda_registration s on s.bubble_id = i.linked_seda_registration
left join first_payments on first_payments.linked_invoice = i.bubble_id
left join second_payments on second_payments.linked_invoice = i.bubble_id
left join payment_totals on payment_totals.linked_invoice = i.bubble_id
left join invoice_item_details on invoice_item_details.linked_invoice = i.bubble_id
left join package_items on package_items.linked_invoice = i.bubble_id
left join requested_status
  on requested_status.normalized_name
    = trim(replace(upper(trim(coalesce(c.name, ''))), '(ATAP)', ''))
-- Every live invoice belongs in the installation system, whatever it has
-- been paid. Payment is a gate on *scheduling*, not on visibility: anything
-- under the threshold arrives with scheduleStatus 'pending_approval' and the
-- below-threshold remark, so it is present and searchable while still being
-- blocked from being planned. Deletion is the only exclusion.
where coalesce(i.is_deleted, false) = false
order by i.updated_at desc nulls last
limit ${SOURCE_ROW_LIMIT}
`;

function textUrl(value: string[] | string | null): string | null {
  if (Array.isArray(value)) return value.find(Boolean) ?? null;
  return value || null;
}

function phaseLabel(value: string | null): InstallationJob["phase"] {
  const normalized = value?.trim().toLowerCase() ?? "";
  if (
    normalized === "1" ||
    normalized.includes("single") ||
    normalized.includes("1 phase")
  ) {
    return "Single phase";
  }
  if (
    normalized === "3" ||
    normalized.includes("three") ||
    normalized.includes("3 phase")
  ) {
    return "Three phase";
  }
  return "Unknown";
}

function hasSedaApproval(status: string | null): boolean {
  const normalized = status?.toLowerCase() ?? "";
  return ["approved", "complete", "completed", "success"].some((word) =>
    normalized.includes(word),
  );
}

function normalizeCustomerName(name: string | null): string {
  return (name ?? "")
    .trim()
    .toUpperCase()
    .replace(/\(ATAP\)/g, "")
    .trim();
}

// A pending SEDA task's requested status is only trustworthy once it's tied
// to one specific invoice. Matching is by customer name alone (the task queue
// has nothing better to join on), and the same name can legitimately cover
// more than one invoice — a genuine duplicate/re-created record, not just a
// coincidence. Among those, the one still awaiting SEDA submission is the one
// that has actually put down a deposit; a zero-payment duplicate can't be
// the invoice a real approval email is about, so it's left untouched.
function applyRequestedSedaStatusOverrides(rows: ProxyRow[]): ProxyRow[] {
  const byName = new Map<string, ProxyRow[]>();
  for (const row of rows) {
    const key = normalizeCustomerName(row.customer_name);
    if (!key) continue;
    const group = byName.get(key);
    if (group) group.push(row);
    else byName.set(key, [row]);
  }

  const overrideIds = new Set<string>();
  for (const group of byName.values()) {
    const requestedStatus = group.find(
      (row) => row.requested_seda_status,
    )?.requested_seda_status;
    if (!requestedStatus || !hasSedaApproval(requestedStatus)) continue;

    const pending = group.filter(
      (row) => (row.seda_status ?? "").trim().toLowerCase() === "pending",
    );

    // Resolved rather than stored, for the reason resolvePaymentPercent gives:
    // the stored column can leave a fully-paid invoice reading at its deposit,
    // which would hand the approval to a less-paid sibling.
    let winner: ProxyRow | null = null;
    for (const candidate of pending) {
      const candidatePercent = resolvePaymentPercent(candidate);
      const winnerPercent = winner ? resolvePaymentPercent(winner) : -1;
      if (candidatePercent > winnerPercent) winner = candidate;
    }

    if (winner && resolvePaymentPercent(winner) > 0) {
      overrideIds.add(winner.bubble_id);
    }
  }

  if (!overrideIds.size) return rows;
  return rows.map((row) =>
    overrideIds.has(row.bubble_id) ? { ...row, seda_status: "Approved" } : row,
  );
}

// The seda_tasks pipeline (applyRequestedSedaStatusOverrides above) only has
// email history from when it went live — it has nothing to say about older
// invoices. For those, a paid-up deposit stands in for the missing paper
// trail: an invoice from before the automation existed that has already
// reached 60% payment has, in practice, cleared SEDA by now regardless of
// what the registration link shows (stale "Pending"/"Submitted", or no
// linked registration row at all). Below 60%, or on or after the cutoff, the
// real registration status (or the "Pending" rowToJob defaults a missing one
// to) still applies unchanged.
const PRE_AUTOMATION_CUTOFF = "2026-07-01";

function isBeforePreAutomationCutoff(invoiceDate: string | null): boolean {
  return Boolean(invoiceDate) && invoiceDate! < PRE_AUTOMATION_CUTOFF;
}

function applyPreAutomationPaymentAssumption(rows: ProxyRow[]): ProxyRow[] {
  return rows.map((row) => {
    if (hasSedaApproval(row.seda_status)) return row;
    if (!isBeforePreAutomationCutoff(row.invoice_date)) return row;
    // Resolved, not stored: an old invoice that has been paid in full but whose
    // percentage column stopped at the deposit would otherwise be denied the
    // assumption and left showing a SEDA status nobody has maintained.
    if (resolvePaymentPercent(row) < 60) return row;
    return { ...row, seda_status: "Approved" };
  });
}

function focOnly(value: string | null) {
  if (!value) return "";
  return value
    .split(/\n\s*\n/)
    .map((item) => {
      const lines = item.split(/\r?\n/);
      const focIndex = lines.findIndex((line) => /foc/i.test(line));
      return focIndex >= 0 ? lines.slice(focIndex).join("\n").trim() : "";
    })
    .filter(Boolean)
    .join("\n\n");
}

// Ballast/battery line items are short standalone lines ("4x Ballast
// System"), unlike FOC notes which run to the end of their paragraph — so
// only the matching lines themselves are kept, not the rest of the block.
function linesMatching(value: string | null, pattern: RegExp): string {
  if (!value) return "";
  return value
    .split(/\n\s*\n/)
    .map((item) =>
      item
        .split(/\r?\n/)
        .filter((line) => pattern.test(line))
        .join("\n")
        .trim(),
    )
    .filter(Boolean)
    .join("\n\n");
}

// Parsing of the package's own invoice_item line — the primary source for
// package/panel/inverter/phase (see rowToJob). The package line is freeform
// text typed by sales, e.g. "19X Jinko Tiger Neo N-type 72HL4-(V) TOPCon |
// Bi-Facial" on its own first line, followed by "1X SAJ R6 10KW String
// Inverter" and other lines.
function firstPackageLine(text: string | null): string {
  if (!text) return "";
  return (text.split(/\r?\n/)[0] ?? "").trim();
}

function parsePanelQtyFromPackageLine(line: string): number | null {
  const match = line.match(/^(\d+)\s*[xX]\b/);
  return match ? Number(match[1]) : null;
}

// Matches "String Inverter"/"Hybrid Inverter" and the "Hybird Inverter"
// typo that recurs throughout the source data (the word "Inverter" itself
// is spelled correctly, so matching on it alone still catches it). NEP BDM
// micro-inverter lines never say the word "inverter" at all, so they need
// their own fallback.
function parseInverterFromText(text: string | null): string {
  if (!text) return "";
  const lines = text.split(/\r?\n/);
  const line =
    lines.find((l) => /inverter/i.test(l)) ??
    lines.find((l) => /\bBDM\b/i.test(l));
  return line?.trim() ?? "";
}

// Phase shows up two ways in the source text: an inline [1P]/[3P] tag, or
// spelled out as "single phase"/"3-phase"/"three-phase" etc. Most package
// lines mention neither (phase is implied by the inverter model, not
// stated) — that's an expected "Unknown", not a parsing miss.
function parsePhaseFromText(text: string | null): InstallationJob["phase"] {
  if (!text) return "Unknown";
  if (/\[3P\]|3[\s-]?phase/i.test(text)) return "Three phase";
  if (/\[1P\]|1[\s-]?phase|single[\s-]?phase/i.test(text)) return "Single phase";
  return "Unknown";
}

// How much of the invoice the customer has paid.
//
// invoice.percent_of_total_amount is written when a payment is first recorded
// and then not maintained, so a customer who has since paid in full still reads
// at their deposit — MARY WONG (1008543) paid 1,400 + 16,800 + 9,800 against a
// 28,000 invoice, the whole of it, and the column still says 0.05. It is also
// inconsistent about units: the same 5% deposit is `5` on one invoice and
// `0.05` on another. 161 invoices are understated this way.
//
// So the payment ledger leads. The stored figure is kept as a floor rather than
// discarded: 10 invoices read higher than their payments add up to, where a
// payment was evidently taken but never entered as a row, and 5 more carry a
// percentage with no payment rows at all. Taking the larger of the two keeps
// those whole while fixing everyone the ledger knows better than the column.
function resolvePaymentPercent(row: ProxyRow): number {
  const stored = Number(row.percent_of_total_amount ?? 0);
  const total = Number(row.total_amount ?? 0);
  const paid = Number(row.amount_paid ?? 0);
  const safeStored = Number.isFinite(stored) ? stored : 0;
  if (!Number.isFinite(total) || total <= 0) return safeStored;
  if (!Number.isFinite(paid) || paid <= 0) return safeStored;
  return Math.max(safeStored, (paid / total) * 100);
}

function rowToJob(row: ProxyRow): InstallationJob {
  const paymentPercent = resolvePaymentPercent(row);
  const sedaApproved = hasSedaApproval(row.seda_status);
  const sourceAddress = row.installation_address || row.address || "";

  const packageLine = firstPackageLine(row.package_item_description);
  const resolvedPanelQty = parsePanelQtyFromPackageLine(packageLine) ?? row.panel_qty;
  const parsedInverter = parseInverterFromText(row.package_item_description);
  const parsedPhase = parsePhaseFromText(row.package_item_description);
  const ballastText = linesMatching(row.ballast_details, /ballast/i);
  const batteryText = linesMatching(row.battery_details, /batter/i);

  return {
    id: row.bubble_id,
    invoiceNumber: row.invoice_number || row.bubble_id,
    customerName: row.customer_name || "Unnamed customer",
    customerPhone: row.phone || "Not available",
    address: sourceAddress,
    city: row.city || "",
    state: row.state || "",
    postcode: row.postcode || "",
    agentName: row.agent_name || "Not available",
    totalAmount: Number(row.total_amount ?? 0),
    paymentPercent,
    paymentBalance: Number(row.balance_due ?? 0),
    firstPaymentDate: toDateOnly(row.first_payment_date),
    secondPaymentDate: toDateOnly(row.second_payment_date),
    panelQuantity: resolvedPanelQty,
    panelRating: row.panel_rating,
    inverter:
      parsedInverter ||
      row.inverter_name ||
      row.seda_inverter ||
      row.package_name ||
      "Not available",
    battery: batteryText || "Not available",
    ballastDetails: ballastText,
    focDetails: focOnly(row.foc_details),
    phase: parsedPhase !== "Unknown" ? parsedPhase : phaseLabel(row.phase_type),
    sedaStatus: row.seda_status || "Pending",
    sldUrl: textUrl(row.drawing_pdf_system) || textUrl(row.pv_system_drawing),
    packageName: packageLine || row.package_name || "Not available",
    installationDate: null,
    // A job just arrived from the source system — nobody has looked at
    // availability yet. Distinct from "pending", which means someone actively
    // reached out and is waiting on the customer to confirm.
    customerAvailabilityStatus: "not_set",
    preferredInstallationDate: null,
    secondPreferredInstallationDate: null,
    preferredInstallationTime: null,
    availabilityRemarks: "",
    installationApprovalStatus: sedaApproved
      ? "pending_approval_date"
      : "pending_seda_approval",
    scheduleStatus:
      paymentPercent < 59
        ? "pending_approval"
        : sedaApproved
          ? "ready_to_schedule"
          : "pending_approval",
    deliveryStatus: "not_planned",
    deliveryDate: null,
    arrivalDate: null,
    arrivalTime: null,
    stockDetails: "",
    deliveryContactNumber: row.phone || "",
    warehouseLocation: "",
    panelDetails: `${resolvedPanelQty ?? "—"} panels${
      row.panel_rating ? ` × ${row.panel_rating}W` : ""
    }`,
    wiringDetails: "",
    batteryDetails: batteryText || "Not available",
    // Owned by ops, not the source system: it is filled from the schedule
    // sheet or typed in, so a job arriving from the invoice feed starts blank.
    inverterBattery: "",
    // Also ops-owned. The invoice feed has panel_qty and panel_rating, but not
    // the brand the sheet names, so this is not derived from them.
    powerOutput: "",
    paymentOverrideStatus: "none",
    paymentOverrideReason: "",
    teams: [],
    remarks:
      paymentPercent < 59
        ? "Below 59% payment · Management approval required"
        : sedaApproved
          ? ""
          : "Pending SEDA Approval",
    installationRemarks: "",
    sourceUpdatedAt: row.updated_at || undefined,
  };
}

export async function fetchEligibleSourceJobs(): Promise<SourceJobsResult> {
  // Deliberately separate from PG_PROXY_* (lib/proxy-db.ts), which is the
  // app's own read-write operational store. This is the read-only connection
  // to the upstream business database (invoices, customers, payments) that
  // the pipeline is built from.
  // Falls back to the operational connection when no separate source one is
  // configured. Splitting them is the better arrangement, but a deployment
  // that only ever had PG_PROXY_* must keep reading its pipeline rather than
  // dropping to demo data the moment it updates.
  const proxyUrl =
    process.env.PG_SOURCE_PROXY_URL || process.env.PG_PROXY_URL;
  const database =
    process.env.PG_SOURCE_PROXY_DATABASE || process.env.PG_PROXY_DATABASE;
  const token =
    process.env.PG_SOURCE_PROXY_TOKEN || process.env.PG_PROXY_TOKEN;

  if (!proxyUrl || !database || !token) {
    throw new Error(
      "No database connection is configured. Open Connection settings and " +
        "enter the address, database name and access token.",
    );
  }

  const response = await fetch(proxyUrl, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      db_name: database,
      sql: INSTALLATION_SOURCE_QUERY,
      params: [],
    }),
    cache: "no-store",
    signal: AbortSignal.timeout(20_000),
  });

  const payload = (await response.json()) as ProxyResponse;
  if (!response.ok || payload.error) {
    throw new Error(payload.error || `Source API returned ${response.status}.`);
  }

  const rows = payload.rows ?? [];
  const patchedRows = applyPreAutomationPaymentAssumption(
    applyRequestedSedaStatusOverrides(rows),
  );
  return {
    jobs: patchedRows.map(rowToJob),
    truncated: rows.length >= SOURCE_ROW_LIMIT,
  };
}
