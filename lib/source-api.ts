import { toDateOnly } from "@/lib/dates";
import { queryProxy } from "@/lib/proxy-db";
import type { InstallationJob } from "@/lib/types";

type ProxyRow = {
  bubble_id: string;
  invoice_number: string | null;
  total_amount: string | null;
  balance_due: string | null;
  percent_of_total_amount: string | null;
  first_payment_date: string | null;
  second_payment_date: string | null;
  ballast_details: string | null;
  foc_details: string | null;
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
};

type ProxyResponse = {
  rows?: ProxyRow[];
  error?: string;
};

// A backstop against an unbounded payload, not a business rule — the pipeline
// filter below is what decides which jobs belong. Reaching this limit means
// rows are being dropped, so fetchEligibleSourceJobs reports it instead of
// truncating silently.
const SOURCE_ROW_LIMIT = 5000;

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
      ) as foc_details
  from invoice_item
  group by linked_invoice
)
select
  i.bubble_id,
  i.invoice_number,
  i.total_amount,
  i.balance_due,
  i.percent_of_total_amount,
  first_payments.first_payment_date,
  second_payments.second_payment_date,
  invoice_item_details.ballast_details,
  invoice_item_details.foc_details,
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
  s.drawing_pdf_system
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
left join invoice_item_details on invoice_item_details.linked_invoice = i.bubble_id
where coalesce(i.is_deleted, false) = false
  and (
    -- An invoice with no payment at all is an unsent quote, not an
    -- installation candidate. Filtering on the pipeline itself (rather than
    -- taking the N most recently touched invoices) is what keeps older jobs
    -- that are still awaiting installation from silently falling off the
    -- dashboard once newer rows arrive.
    coalesce(i.percent_of_total_amount, 0) > 0
    -- ...unless operations have already acted on it. A payment override can
    -- legitimately put a zero-payment invoice into the pipeline, and dropping
    -- it here would discard work someone already did. installation_jobs lives
    -- in the app's own operational database, not this read-only source one,
    -- so the id list is fetched separately and passed in rather than joined.
    or i.bubble_id = any($1::text[])
  )
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

function rowToJob(row: ProxyRow): InstallationJob {
  const paymentPercent = Number(row.percent_of_total_amount ?? 0);
  const sedaApproved = hasSedaApproval(row.seda_status);
  const sourceAddress = row.installation_address || row.address || "";

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
    panelQuantity: row.panel_qty,
    panelRating: row.panel_rating,
    inverter:
      row.inverter_name ||
      row.seda_inverter ||
      row.package_name ||
      "Not available",
    battery: "Not available",
    ballastDetails: row.ballast_details || "",
    focDetails: focOnly(row.foc_details),
    phase: phaseLabel(row.phase_type),
    sedaStatus: row.seda_status || "Pending",
    sldUrl: textUrl(row.drawing_pdf_system) || textUrl(row.pv_system_drawing),
    packageName: row.package_name || "Not available",
    installationDate: null,
    // A job just arrived from the source system — nobody has looked at
    // availability yet. Distinct from "pending", which means someone actively
    // reached out and is waiting on the customer to confirm.
    customerAvailabilityStatus: "not_set",
    preferredInstallationDate: null,
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
    panelDetails: `${row.panel_qty ?? "—"} panels${
      row.panel_rating ? ` × ${row.panel_rating}W` : ""
    }`,
    wiringDetails: "",
    batteryDetails: "Not available",
    paymentOverrideStatus: "none",
    paymentOverrideReason: "",
    teams: [],
    remarks:
      paymentPercent < 59
        ? "Below 59% payment · Management approval required"
        : sedaApproved
          ? ""
          : "Pending SEDA Approval",
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

  // Invoices operations already have an installation_jobs record for (e.g. a
  // payment override) stay in the pipeline even at zero payment. That table
  // lives in the ops database, not this read-only source one, so its ids are
  // fetched over the other connection and handed to the source query as a
  // parameter. A failure here just means that carve-out doesn't apply for
  // this load — it must not take down the whole source fetch.
  let overrideInvoiceIds: string[] = [];
  try {
    const rows = await queryProxy<{ source_invoice_id: string }>(
      "select source_invoice_id from public.installation_jobs",
    );
    overrideInvoiceIds = rows.map((row) => row.source_invoice_id);
  } catch {
    overrideInvoiceIds = [];
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
      params: [overrideInvoiceIds],
    }),
    cache: "no-store",
    signal: AbortSignal.timeout(20_000),
  });

  const payload = (await response.json()) as ProxyResponse;
  if (!response.ok || payload.error) {
    throw new Error(payload.error || `Source API returned ${response.status}.`);
  }

  const rows = payload.rows ?? [];
  return {
    jobs: rows.map(rowToJob),
    truncated: rows.length >= SOURCE_ROW_LIMIT,
  };
}
