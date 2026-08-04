import type { InstallationJob } from "@/lib/types";

type ProxyRow = {
  bubble_id: string;
  invoice_number: string | null;
  total_amount: string | null;
  balance_due: string | null;
  percent_of_total_amount: string | null;
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
left join agent a on a.linked_user_login = i.linked_agent
left join package p on p.bubble_id = i.linked_package
left join product inverter_product on inverter_product.bubble_id = p.inverter_1
left join seda_registration s on s.bubble_id = i.linked_seda_registration
left join second_payments on second_payments.linked_invoice = i.bubble_id
left join invoice_item_details on invoice_item_details.linked_invoice = i.bubble_id
where coalesce(i.is_deleted, false) = false
order by i.updated_at desc nulls last
limit 1000
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
    secondPaymentDate: row.second_payment_date,
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
    customerAvailabilityStatus: "pending",
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

export async function fetchEligibleSourceJobs(): Promise<InstallationJob[]> {
  const proxyUrl = process.env.PG_PROXY_URL;
  const database = process.env.PG_PROXY_DATABASE;
  const token = process.env.PG_PROXY_TOKEN;

  if (!proxyUrl || !database || !token) {
    throw new Error("Source API environment variables are incomplete.");
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

  return (payload.rows ?? []).map(rowToJob);
}
