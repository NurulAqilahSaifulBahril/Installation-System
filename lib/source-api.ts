import { toDateOnly } from "@/lib/dates";
import {
  APPROVAL_PAYMENT_PERCENT,
  READY_PAYMENT_PERCENT,
  hasReachedPaymentPercent,
  isSedaApproved,
  type InstallationJob,
} from "@/lib/types";

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
  inverter_type_details: string | null;
  package_item_description: string | null;
  first_item_description: string | null;
  package_type: string | null;
  ev_details: string | null;
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
  email: string | null;
  roof_photo_count: number | string | null;
  site_photo_count: number | string | null;
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
    ) as payment_sequence,
    -- The ledger read forwards: what the invoice stood at once this payment
    -- had landed. second_payments below walks this to find the crossing.
    sum(coalesce(amount, 0)) over (
      partition by linked_invoice
      order by payment_date asc nulls last, created_at asc, id asc
      rows between unbounded preceding and current row
    ) as paid_to_date
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
-- The deposit: the earliest payment, taken by rank rather than by
-- min(payment_date) so an invoice whose first payments share a date still
-- resolves to exactly one row.
first_payments as (
  select linked_invoice, payment_date as first_payment_date
  from ranked_payments
  where payment_sequence = 1
),
-- The date the invoice reached the installation threshold, carried under the
-- second_payment name the UI still shows as "2nd payment". It is deliberately
-- NOT the literal second transaction: customers pay the balance in as many
-- instalments as they like, so the second row is only the crossing when the
-- balance happened to arrive in one piece. SOONG KOK MING (INV-1010945) paid
-- 30,000 across six payments and crossed on the sixth (16 Aug), while their
-- second row was 500 on 28 Jul at 5% paid — a date that would have claimed
-- they were cleared to install three weeks before the balance existed. Since
-- everything downstream reads this as "when were they cleared" (Ready to
-- Install's era gate, Need Attention's 28-working-day clock, the 2nd payment
-- column and its month filter), it has to be the crossing itself.
--
-- distinct on takes the first row in threshold order, so a customer who later
-- pays in full still dates to the payment that first got them there.
--
-- The threshold is a share of the invoice, so an invoice with no usable
-- total_amount is left null rather than guessed at: a percentage of nothing
-- cannot say when the threshold was passed.
second_payments as (
  select distinct on (ranked_payments.linked_invoice)
    ranked_payments.linked_invoice,
    ranked_payments.payment_date as second_payment_date
  from ranked_payments
  join invoice threshold_invoice
    on threshold_invoice.bubble_id = ranked_payments.linked_invoice
  where coalesce(threshold_invoice.total_amount, 0) > 0
    and ranked_payments.paid_to_date
      >= threshold_invoice.total_amount * ${READY_PAYMENT_PERCENT} / 100.0
  order by ranked_payments.linked_invoice, ranked_payments.payment_sequence
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
      as battery_details,
    -- A micro inverter add-on is its own line item, sold and priced
    -- separately from the package's own string/hybrid inverter — see
    -- INV-1009209, whose "Micro Inverter" line sits outside is_a_package
    -- entirely. Read together in rowToJob to say what inverter types the
    -- invoice actually carries, not just whichever line the package names.
    string_agg(description, E'\n\n' order by sort nulls last, id)
      filter (where lower(coalesce(description, '')) like '%inverter%')
      as inverter_type_details,
    string_agg(description, E'\n\n' order by sort nulls last, id)
      filter (
        where lower(coalesce(description, '')) like '%ev %'
          or lower(coalesce(description, '')) like '%evcharger%'
          or lower(coalesce(description, '')) like '%wallbox%'
          or lower(coalesce(description, '')) like '%ev charger%'
      ) as ev_details
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
-- The invoice's own first line, whatever it is, with no is_a_package filter.
-- Solar invoices already have a package_items row above and never need this;
-- it exists for the invoices that do not — a cleaning or inspection call-out
-- billed as its own line, never marked as a package because it isn't one.
-- linked_package can still point an invoice like that at an unrelated solar
-- product left over from how it was set up, which is exactly the value
-- package_name below would otherwise surface as "the package" it was never
-- sold. Read together with package_items in rowToJob: only consulted when
-- that CTE has nothing for the invoice.
first_invoice_items as (
  select distinct on (linked_invoice)
    linked_invoice,
    description as first_item_description
  from invoice_item
  where linked_invoice is not null
  order by linked_invoice, sort nulls last, id
),
-- Emails that reported an approval but that the automated SEDA_ATAP_APPROVAL
-- matcher couldn't confidently attach to a seda_registration row (below its
-- confidence threshold) sit here as still-pending, needing-review tasks. The
-- customer name is the only link back to an invoice, so it is normalised the
-- same way on both sides of the joins below.
--
-- Matched in two passes, because one pass cannot be both safe and generous.
--
-- The exact pass drops "(ATAP)" and reduces every run of punctuation to a
-- single space, but keeps brackets otherwise. That alone rescues the misses
-- that were only ever about a full stop -- the task writes "SDN. BHD." where
-- the customer record writes "SDN BHD" -- while "(M)" and the site codes stay
-- part of the name, so no two customers are conflated.
--
-- The loose pass then takes what the first could not place and strips every
-- bracket, which is what finally lets "WONG PECK YIN" reach "WONG PECK YIN
-- (SHOP-LOT) (ATAP)". That is a blunter key, so it is only trusted when it
-- lands on exactly one customer. It has to be: the two Eng Ann commercial
-- sites, (PLO46) and (PTD 53661 - SELCO), differ *only* inside their brackets
-- and reduce to the same text. An approval carries one application number and
-- so belongs to one site; marking the wrong job Approved would let it be
-- scheduled against a permit it does not hold, which is worse than leaving it
-- Pending for a human to settle. Ambiguous names are therefore withheld and
-- stay a manual review.
--
-- Measured against the live source when this was written: the exact pass
-- reproduces all 125 names the old matcher found, the loose pass adds 9 that
-- had been sitting approved and unseen for weeks, and 1 is withheld.
customer_keys as (
  select
    customer_id,
    trim(regexp_replace(
      replace(upper(coalesce(name, '')), '(ATAP)', ''),
      '[^A-Z0-9()]+', ' ', 'g'
    )) as exact_key,
    trim(regexp_replace(
      regexp_replace(upper(coalesce(name, '')), '[(][^)]*[)]', ' ', 'g'),
      '[^A-Z0-9]+', ' ', 'g'
    )) as loose_key
  from customer
  where coalesce(name, '') <> ''
),
ambiguous_loose_keys as (
  select loose_key
  from customer_keys
  where loose_key <> ''
  group by loose_key
  having count(distinct customer_id) > 1
),
task_status as (
  select
    trim(regexp_replace(
      replace(upper(coalesce(customer_name, '')), '(ATAP)', ''),
      '[^A-Z0-9()]+', ' ', 'g'
    )) as exact_key,
    trim(regexp_replace(
      regexp_replace(upper(coalesce(customer_name, '')), '[(][^)]*[)]', ' ', 'g'),
      '[^A-Z0-9]+', ' ', 'g'
    )) as loose_key,
    payload ->> 'status' as requested_seda_status,
    created_at
  from seda_tasks
  where status = 'PENDING'
    and requires_manual_review = true
    and coalesce(customer_name, '') <> ''
    and payload ->> 'status' is not null
),
-- The empty-key guards are not decoration: a name that reduces to nothing
-- would otherwise match every other name that does the same.
requested_exact as (
  select distinct on (exact_key)
    exact_key,
    requested_seda_status
  from task_status
  where exact_key <> ''
  order by exact_key, created_at desc
),
requested_loose as (
  select distinct on (loose_key)
    loose_key,
    requested_seda_status
  from task_status
  where loose_key <> ''
    and loose_key not in (select loose_key from ambiguous_loose_keys)
  order by loose_key, created_at desc
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
  invoice_item_details.inverter_type_details,
  package_items.package_item_description,
  first_invoice_items.first_item_description,
  invoice_item_details.ev_details,
  coalesce(nullif(trim(i.package_type), ''), p.type) as package_type,
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
  coalesce(nullif(trim(s.email), ''), nullif(trim(c.email), '')) as email,
  coalesce(array_length(i.linked_roof_image, 1), 0) as roof_photo_count,
  coalesce(array_length(i.site_assessment_image, 1), 0) as site_photo_count,
  coalesce(
    requested_exact.requested_seda_status,
    requested_loose.requested_seda_status
  ) as requested_seda_status
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
left join first_invoice_items on first_invoice_items.linked_invoice = i.bubble_id
left join requested_exact
  on requested_exact.exact_key
    = trim(regexp_replace(
        replace(upper(coalesce(c.name, '')), '(ATAP)', ''),
        '[^A-Z0-9()]+', ' ', 'g'
      ))
left join requested_loose
  on requested_loose.loose_key
    = trim(regexp_replace(
        regexp_replace(upper(coalesce(c.name, '')), '[(][^)]*[)]', ' ', 'g'),
        '[^A-Z0-9]+', ' ', 'g'
      ))
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
  return isSedaApproved(status);
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

// The wattage sits in the same package line as the quantity — "17X 650W
// JinkoSolar TIGER NEO 3.0 Panel" — but only the quantity was ever read off
// it, and invoice.panel_rating is empty on every one of the 2,702 live
// invoices whose line states a wattage. So the record said "17 panels · rating
// not provided" about a line that plainly says 650W.
//
// The column still wins where it is filled in; it never disagreed with the
// text on any invoice, so this only fills blanks. Bounded to three or four
// digits so a price or a model number cannot be read as a panel rating.
function parsePanelRatingFromPackageLine(line: string): number | null {
  const match = line.match(/^\d+\s*[xX]\s*(\d{3,4})\s*W(?:p|att)?\b/i);
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

// Which inverter types the invoice actually carries — String, Hybrid, Micro,
// or any combination (a string inverter for the array plus micro inverters
// as a later add-on is a real, common setup, not a contradiction to pick one
// side of). Read off inverter_type_details, which already carries every line
// item mentioning "inverter" at all — the package's own line and any
// separately sold add-on alike — so this only has to classify what is there,
// not go hunting for it across rows itself. Order fixed so two invoices
// naming the same combination always read the same way.
const INVERTER_TYPES: { label: string; pattern: RegExp }[] = [
  { label: "String", pattern: /string\s*inverter/i },
  { label: "Hybrid", pattern: /hybrid\s*inverter/i },
  { label: "Micro", pattern: /micro\s*inverter/i },
];

function parseInverterTypesFromText(text: string | null): string {
  if (!text) return "";
  const found = INVERTER_TYPES.filter((type) => type.pattern.test(text)).map(
    (type) => type.label,
  );
  if (found.length === 0) return "";
  return `${found.join(" + ")} Inverter`;
}

// One inverter's own model code out of a block of free text — "SAJ R6 12KW
// String Inverter" or "SAJ M2-1.0K S2 Micro Inverter". Two shapes, because
// that is the two the invoice text actually uses:
//
//  - The R6 string inverter states only the family and capacity ("R6
//    12KW"), never the "-T2" every R6 unit is actually sold as — that
//    suffix is fixed for the whole series, not read off anything, so it is
//    appended rather than parsed.
//  - A micro inverter's code is already complete in the text ("M2-1.0K
//    S2"), just inconsistently punctuated — a hyphen here, a space there,
//    stray spaces around the wattage there ("M2- 2.0K -S4") — so this only
//    has to normalise it, not invent anything.
//
// Deliberately narrow: a model family neither pattern recognises returns
// null rather than a guess, and stays whatever ops last typed.
function extractInverterModel(text: string): string | null {
  const r6 = text.match(/\bR6\s+(\d+(?:\.\d+)?)\s*KW\b/i);
  if (r6) return `R6-${r6[1]}K-T2`;
  const micro = text.match(/\bM(\d+)[\s-]*([\d.]+)\s*K\s*-?\s*S(\d+)\b/i);
  if (micro) return `M${micro[1]}-${micro[2]}K-S${micro[3]}`;
  return null;
}

// The full model list for Installation groups' Inverter / Battery Model
// column — every inverter unit on the invoice, "+"-joined, each read the
// same way SAJ's own paperwork counts them: one unit unless the line says
// otherwise, which none of these do. inverter_type_details already carries
// one paragraph per line item (see invoice_item_details), so this splits
// back along the same blank-line boundaries string_agg joined them with.
//
// A "change to" item is a swap on a unit the invoice already named, not a
// second one — INV-1008980's package line states its string inverter as
// "R6 5KW", and a later, separate line item records that same inverter
// changing to "R6 6KW". Counted independently that reads as two inverters
// on a one-inverter job, so a change is matched back against whichever
// earlier entry named its own "before" model and replaces it in place,
// rather than being appended as a new unit. Only once nothing already on
// the list names that model — a genuinely new unit changing before it was
// even installed — does it get appended as its own "old => new" entry (see
// INV-1009209's micro inverter, swapped without ever being counted as the
// original model first).
function parseInverterModelsFromText(text: string | null): string {
  if (!text) return "";
  const entries: { model: string; display: string }[] = [];
  for (const item of text.split(/\n\s*\n/)) {
    const change = item.match(/change\s*to/i);
    if (change) {
      const before = item.slice(0, change.index);
      const after = item.slice((change.index ?? 0) + change[0].length);
      const oldModel = extractInverterModel(before);
      const newModel = extractInverterModel(after);
      if (oldModel && newModel) {
        const display = `1 X ${oldModel} => 1 X ${newModel}`;
        const existing = entries.find((entry) => entry.model === oldModel);
        if (existing) {
          existing.model = newModel;
          existing.display = display;
        } else {
          entries.push({ model: newModel, display });
        }
        continue;
      }
      const single = oldModel || newModel;
      if (single && !entries.some((entry) => entry.model === single)) {
        entries.push({ model: single, display: `1 X ${single}` });
      }
      continue;
    }
    const model = extractInverterModel(item);
    if (model && !entries.some((entry) => entry.model === model)) {
      entries.push({ model, display: `1 X ${model}` });
    }
  }
  return entries.map((entry) => entry.display).join(" + ");
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

// invoice.balance_due suffers the same staleness as percent_of_total_amount
// above but was never given the same fix: SOONG KOK MING (INV-1010945) paid
// 24,000 of a 30,000 invoice — 80%, which percent_of_total_amount correctly
// shows — while balance_due still reads 20,300, a figure that matches no
// point in the six-payment history and contradicts the 80% sitting right next
// to it in the same UI column. Deriving the balance from the already-
// reconciled percent keeps the two numbers consistent and inherits
// resolvePaymentPercent's handling of the opposite failure (a payment taken
// but never entered as a row), rather than trusting the same unreliable
// column a second time.
function resolvePaymentBalance(row: ProxyRow, paymentPercent: number): number {
  const total = Number(row.total_amount ?? 0);
  const stored = Number(row.balance_due ?? 0);
  const safeStored = Number.isFinite(stored) ? stored : 0;
  if (!Number.isFinite(total) || total <= 0) return safeStored;
  return Math.max(0, total * (1 - paymentPercent / 100));
}

function resolveSourceAddress(
  installationAddress: string | null,
  customerAddress: string | null,
): string {
  const inst = (installationAddress || "").trim();
  if (
    !inst ||
    /^(same(\s+as\s+(above|customer|billing))?|as\s+above|same\s+address|n\/?a|-)$/i.test(
      inst,
    )
  ) {
    return (customerAddress || "").trim();
  }
  return inst;
}

function rowToJob(row: ProxyRow): InstallationJob {
  const paymentPercent = resolvePaymentPercent(row);
  // Compared through the shared test rather than with a bare `<`: an invoice
  // paid to exactly the approval line does not reliably read as having reached
  // it once the percentage has been through a division. See
  // hasReachedPaymentPercent.
  const belowApprovalLine = !hasReachedPaymentPercent(
    paymentPercent,
    APPROVAL_PAYMENT_PERCENT,
  );
  const sedaApproved = hasSedaApproval(row.seda_status);
  const sourceAddress = resolveSourceAddress(row.installation_address, row.address);

  const packageLine = firstPackageLine(row.package_item_description);
  const resolvedPanelQty = parsePanelQtyFromPackageLine(packageLine) ?? row.panel_qty;
  const resolvedPanelRating =
    row.panel_rating ?? parsePanelRatingFromPackageLine(packageLine);
  const parsedInverter = parseInverterFromText(row.package_item_description);
  const parsedPhase = parsePhaseFromText(row.package_item_description);
  const inverterTypes = parseInverterTypesFromText(row.inverter_type_details);
  const derivedInverterModel = parseInverterModelsFromText(
    row.inverter_type_details,
  );
  const ballastText = linesMatching(row.ballast_details, /ballast/i);
  const batteryText = linesMatching(row.battery_details, /batter/i);
  // No is_a_package line on the invoice at all — nothing solar was sold on
  // it, so there is no package to report. linked_package can still resolve
  // to a product below (see the join on `p`), left over from how the invoice
  // was set up rather than describing what it is; packageName is left blank
  // instead of surfacing that. first_item_description carries what the
  // invoice actually bills for one of these — a cleaning or inspection
  // call-out — through to remarks below.
  const hasPackageItem = Boolean(row.package_item_description);
  const nonPackageDescription = hasPackageItem
    ? ""
    : (row.first_item_description || "").trim();

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
    paymentBalance: resolvePaymentBalance(row, paymentPercent),
    firstPaymentDate: toDateOnly(row.first_payment_date),
    secondPaymentDate: toDateOnly(row.second_payment_date),
    panelQuantity: resolvedPanelQty,
    panelRating: resolvedPanelRating,
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
    inverterType: inverterTypes,
    derivedInverterModel,
    sedaStatus: row.seda_status || "Pending",
    sldUrl: textUrl(row.drawing_pdf_system) || textUrl(row.pv_system_drawing),
    packageName: hasPackageItem
      ? packageLine || row.package_name || "Not available"
      : "",
    packageType: (row.package_type || "").trim(),
    evDetails: row.ev_details?.trim() || "",
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
      belowApprovalLine
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
      resolvedPanelRating ? ` × ${resolvedPanelRating}W` : ""
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
    // Leads with what the invoice actually is, for the jobs that have no
    // package item, ahead of whichever payment/SEDA hint applies below — an
    // ops note on the record from the moment it first arrives here, same as
    // those hints, rather than a separate field of its own.
    remarks: [
      nonPackageDescription,
      belowApprovalLine
        ? `Below ${APPROVAL_PAYMENT_PERCENT}% payment · Management approval required`
        : sedaApproved
          ? ""
          : "Pending SEDA Approval",
    ]
      .filter(Boolean)
      .join("\n\n"),
    installationRemarks: "",
    customerEmail: row.email?.trim() || "",
    roofPhotoCount: Number(row.roof_photo_count ?? 0) || 0,
    sitePhotoCount: Number(row.site_photo_count ?? 0) || 0,
    sourceUpdatedAt: row.updated_at || undefined,
  };
}

// The read-only connection to the upstream business database (invoices,
// customers, payments). Deliberately separate from PG_PROXY_* (lib/proxy-db.ts),
// which is the app's own read-write operational store.
//
// Falls back to the operational connection when no separate source one is
// configured. Splitting them is the better arrangement, but a deployment that
// only ever had PG_PROXY_* must keep reading its pipeline rather than dropping
// to demo data the moment it updates.
export async function querySource<T>(
  sql: string,
  params: unknown[] = [],
): Promise<T[]> {
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
    body: JSON.stringify({ db_name: database, sql, params }),
    cache: "no-store",
    signal: AbortSignal.timeout(20_000),
  });

  const payload = (await response.json()) as { rows?: T[]; error?: string };
  if (!response.ok || payload.error) {
    throw new Error(payload.error || `Source API returned ${response.status}.`);
  }
  return payload.rows ?? [];
}

export async function fetchEligibleSourceJobs(): Promise<SourceJobsResult> {
  const rows = await querySource<ProxyRow>(INSTALLATION_SOURCE_QUERY);
  const patchedRows = applyRequestedSedaStatusOverrides(rows);
  return {
    jobs: patchedRows.map(rowToJob),
    truncated: rows.length >= SOURCE_ROW_LIMIT,
  };
}

export type JobFiles = {
  sld: string[];
  roof: string[];
  site: string[];
};

function urlList(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.filter(
      (item): item is string => typeof item === "string" && Boolean(item),
    );
  }
  return typeof value === "string" && value ? [value] : [];
}

// One customer's SLD drawing, roof photos and site-assessment photos, for the
// viewer on Customer Scheduling. The SLD follows rowToJob's order: the SEDA
// engineering drawing first, the invoice's PV layout after it.
export async function fetchJobFiles(invoiceId: string): Promise<JobFiles | null> {
  const rows = await querySource<{
    drawing_pdf_system: unknown;
    pv_system_drawing: unknown;
    linked_roof_image: unknown;
    site_assessment_image: unknown;
  }>(
    [
      "select s.drawing_pdf_system, i.pv_system_drawing,",
      "  i.linked_roof_image, i.site_assessment_image",
      "from invoice i",
      "left join seda_registration s on s.bubble_id = i.linked_seda_registration",
      "where i.bubble_id = $1",
      "limit 1",
    ].join("\n"),
    [invoiceId],
  );
  const row = rows[0];
  if (!row) return null;
  return {
    sld: [...urlList(row.drawing_pdf_system), ...urlList(row.pv_system_drawing)],
    roof: urlList(row.linked_roof_image),
    site: urlList(row.site_assessment_image),
  };
}
