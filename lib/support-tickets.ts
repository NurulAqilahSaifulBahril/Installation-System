import {
  querySource,
  firstPackageLine,
  parsePanelQtyFromPackageLine,
  parsePanelRatingFromPackageLine,
  parseInverterFromText,
  parsePhaseFromText,
  phaseLabel,
  extractPanelBrand,
} from "@/lib/source-api";
import type { InstallationJob, IssueCategory, IssuePriority } from "@/lib/types";

type SupportTicketRow = {
  id: number;
  bubble_id: string | null;
  title: string | null;
  problem_description: string | null;
  technician_remark: string | null;
  status: string | null;
  link_customer: string | null;
  images: string[] | null;
  video_url: string | null;
  created_date: string | null;
  modified_date: string | null;
  customer_name: string | null;
  customer_phone: string | null;
  customer_address: string | null;
  customer_email: string | null;
  customer_city: string | null;
  customer_state: string | null;
  agent_name: string | null;
  creator_name: string | null;
  invoice_number: string | null;
  invoice_bubble_id: string | null;
  panel_qty: number | null;
  panel_rating: number | null;
  phase_type: string | null;
  package_item_description: string | null;
  inverter_type_details: string | null;
};

const SUPPORT_TICKETS_QUERY = `
  select
    st.id,
    st.bubble_id,
    st.title,
    st.problem_description,
    st.technician_remark,
    st.status,
    st.link_customer,
    st.images,
    st.video_url,
    st.created_date,
    st.modified_date,
    coalesce(nullif(trim(c.name), ''), nullif(trim(cp.name), ''), 'Support Customer') as customer_name,
    coalesce(nullif(trim(c.phone), ''), nullif(trim(cp.contact), ''), nullif(trim(cp.whatsapp), ''), '') as customer_phone,
    coalesce(nullif(trim(s.installation_address), ''), nullif(trim(c.address), ''), nullif(trim(cp.address), ''), '') as customer_address,
    coalesce(nullif(trim(s.email), ''), nullif(trim(c.email), ''), '') as customer_email,
    coalesce(nullif(trim(c.city), ''), '') as customer_city,
    coalesce(nullif(trim(c.state), ''), nullif(trim(cp.state), ''), '') as customer_state,
    coalesce(nullif(trim(a.name), ''), nullif(trim(u.name), ''), '') as agent_name,
    u.name as creator_name,
    i.invoice_number,
    i.bubble_id as invoice_bubble_id,
    i.panel_qty,
    i.panel_rating,
    s.phase_type,
    package_items.package_item_description,
    inverter_items.inverter_type_details
  from public.support_ticket st
  left join public.customer c on c.customer_id = st.link_customer or c.id::text = st.link_customer
  left join public.customer_profile cp on cp.bubble_id = st.link_customer or cp.id::text = st.link_customer
  left join public.user u on u.bubble_id = st.created_by or u.id::text = st.created_by
  left join lateral (
    select 
      inv.bubble_id,
      coalesce(nullif(trim(inv.invoice_id::text), ''), nullif(trim(inv.invoice_number::text), ''), inv.bubble_id) as invoice_number,
      inv.panel_qty,
      inv.panel_rating,
      inv.linked_agent,
      inv.linked_package,
      inv.linked_seda_registration
    from public.invoice inv
    where (inv.linked_customer = c.customer_id 
        or inv.linked_customer = st.link_customer 
        or inv.linked_customer = cp.bubble_id
        or (c.name is not null and length(trim(c.name)) > 3 and inv.linked_customer in (select c2.customer_id from public.customer c2 where lower(trim(c2.name)) = lower(trim(c.name))))
    )
      and coalesce(inv.is_deleted, false) = false
    order by inv.created_at desc
    limit 1
  ) i on true
  left join public.agent a on a.linked_user_login = i.linked_agent or a.bubble_id = i.linked_agent
  left join public.seda_registration s on s.bubble_id = i.linked_seda_registration
  left join lateral (
    select string_agg(ii.description, E'\n') as package_item_description
    from public.invoice_item ii
    where ii.linked_invoice = i.bubble_id
      and coalesce(ii.is_a_package, false) = true
  ) package_items on true
  left join lateral (
    select string_agg(ii.description, E'\n\n') as inverter_type_details
    from public.invoice_item ii
    where ii.linked_invoice = i.bubble_id
      and ii.description ilike '%inverter%'
  ) inverter_items on true
  where st.status not in ('solved', 'deleted')
  order by st.created_date desc
`;

export function categorizeIssue(
  title: string | null | undefined,
  description: string | null | undefined,
): Exclude<IssueCategory, "all"> {
  const titleText = (title || "").toLowerCase();
  const descText = (description || "").toLowerCase();
  const combined = `${titleText} ${descText}`;

  // Prioritize high-intent matches in title
  if (/\b(leak|leaking|leakage|water|roof|ceiling|drip|retention|rain)\b/i.test(titleText)) {
    return "leaking";
  }
  if (/\b(generation|generate|sun peak|kwh|yield|bill|tnb)\b/i.test(titleText)) {
    return "generation";
  }
  if (/\b(inverter|micro inverter|battery|panel|fan|equipment|hardware|module)\b/i.test(titleText)) {
    return "inverter_equipment";
  }
  if (/\b(wiring|wire|wireman|electrical|trip|tripped|db\b|breaker|short circuit|socket|meter)\b/i.test(titleText)) {
    return "wiring";
  }

  // Combined fallback
  if (/\b(leak|leaking|leakage|water|roof|ceiling|drip|retention)\b/i.test(combined)) {
    return "leaking";
  }
  if (/\b(generation|generate|low generation|bill|tnb|sun peak|export|performance|kwh|yield)\b/i.test(combined)) {
    return "generation";
  }
  if (/\b(inverter|micro inverter|battery|panel|fan|equipment|hardware|module)\b/i.test(combined)) {
    return "inverter_equipment";
  }
  if (/\b(wiring|wire|wireman|electrical|trip|tripped|db\b|breaker|short circuit|socket|meter)\b/i.test(combined)) {
    return "wiring";
  }

  return "other";
}

export function formatCategoryLabel(category: IssueCategory): string {
  switch (category) {
    case "leaking":
      return "Leaking";
    case "wiring":
      return "Wiring";
    case "inverter_equipment":
      return "Inverter / Equipment";
    case "generation":
      return "Generation";
    case "other":
      return "Other";
    case "all":
    default:
      return "All Issues";
  }
}

export function derivePriority(
  title: string | null | undefined,
  description: string | null | undefined,
): Exclude<IssuePriority, "all"> {
  const text = `${title || ""} ${description || ""}`.toLowerCase();

  // Critical: immediate hazards, burning, electrical trip/fuse, heavy active leak/hole
  if (/\b(bakar|burn|burnt|fire|spark|smoke|trip|tripped|fuse blew|short circuit|urgent|emergency|danger)\b/i.test(text)) {
    return "critical";
  }
  if (/\b(hole in the roof|water coming in|pouring|heavy leak)\b/i.test(text)) {
    return "critical";
  }

  // High: active leaking (roof leaks cause interior damage) or equipment breakdown
  if (/\b(leak|leaking|leakage|water|bocor)\b/i.test(text)) {
    return "high";
  }
  if (/\b(faulty|rosak|replace|no function|no generation|shut down|broken|damage|damaged)\b/i.test(text)) {
    return "high";
  }

  // Medium: reduced performance, query with issue, battery balance
  if (/\b(half|low generation|sun peak|minimum|drop|slow|query|load data|problem)\b/i.test(text)) {
    return "medium";
  }

  // Low: cosmetic, general inquiry, tnb bill, cleanup
  return "low";
}

export function formatPriorityLabel(priority: IssuePriority): string {
  switch (priority) {
    case "critical":
      return "Critical";
    case "high":
      return "High";
    case "medium":
      return "Medium";
    case "low":
      return "Low";
    case "all":
    default:
      return "All Priorities";
  }
}

export async function fetchActiveSupportTicketJobs(): Promise<InstallationJob[]> {
  const rows = await querySource<SupportTicketRow>(SUPPORT_TICKETS_QUERY);

  return rows.map((row) => {
    const category = categorizeIssue(row.title, row.problem_description);
    const priority = derivePriority(row.title, row.problem_description);
    const catLabel = formatCategoryLabel(category);
    const ticketTitle = (row.title || "Support Ticket").trim();
    const problemDesc = (row.problem_description || "").trim();

    const remarkText = `[O&M: ${catLabel}] ${ticketTitle}${problemDesc ? ` — ${problemDesc}` : ""}`;

    const packageLine = firstPackageLine(row.package_item_description);
    const resolvedPanelQty = parsePanelQtyFromPackageLine(packageLine) ?? row.panel_qty ?? null;
    const resolvedPanelRating = row.panel_rating ?? parsePanelRatingFromPackageLine(packageLine) ?? null;
    const panelBrand = extractPanelBrand(packageLine || "");

    const derivedPanel = (() => {
      if (resolvedPanelQty && panelBrand && resolvedPanelRating) return `${resolvedPanelQty} ${panelBrand} ${resolvedPanelRating}W`;
      if (resolvedPanelQty && panelBrand) return `${resolvedPanelQty} ${panelBrand}`;
      if (panelBrand && resolvedPanelRating) return `${panelBrand} ${resolvedPanelRating}W`;
      if (resolvedPanelQty && resolvedPanelRating) return `${resolvedPanelQty} × ${resolvedPanelRating}W`;
      if (resolvedPanelQty) return `${resolvedPanelQty} panels`;
      if (packageLine) return packageLine;
      return "";
    })();

    const parsedInverter = parseInverterFromText(row.package_item_description || row.inverter_type_details);

    const parsedPhase = parsePhaseFromText(row.package_item_description);
    const resolvedPhase: InstallationJob["phase"] =
      parsedPhase !== "Unknown"
        ? parsedPhase
        : phaseLabel(row.phase_type);

    let resolvedAddress = row.customer_address || "";
    if (!resolvedAddress && problemDesc) {
      const match = problemDesc.match(/\b\d{1,4}[A-Za-z0-9\s/,-]+(?:jalan|jln|lorong|taman|tmn|bandar|kampung|kg)\b[^\r\n]*/i);
      if (match) {
        resolvedAddress = match[0].trim();
      }
    }

    return {
      id: `ticket-${row.id}`,
      invoiceNumber: row.invoice_number ? String(row.invoice_number) : `ST-${row.id}`,
      customerName: row.customer_name || "Support Customer",
      customerPhone: row.customer_phone || "",
      customerEmail: row.customer_email || "",
      address: resolvedAddress,
      city: row.customer_city || "",
      state: row.customer_state || "",
      agentName: row.agent_name || row.creator_name || "",
      totalAmount: 0,
      paymentPercent: 100,
      paymentBalance: 0,
      panelQuantity: resolvedPanelQty ?? 0,
      panelRating: resolvedPanelRating ?? 0,
      inverter: parsedInverter || "",
      battery: "",
      phase: resolvedPhase,
      inverterType: "",
      derivedInverterModel: "",
      sedaStatus: "Approved",
      sldUrl: null,
      packageName: packageLine || ticketTitle,
      packageType: "O&M",
      installationDate: null,
      customerAvailabilityStatus: "propose",
      preferredInstallationDate: null,
      secondPreferredInstallationDate: null,
      preferredInstallationTime: "09:00",
      availabilityRemarks: "",
      installationApprovalStatus: "date_approved",
      scheduleStatus: "ready_to_schedule",
      deliveryStatus: "not_planned",
      deliveryDate: null,
      arrivalDate: null,
      arrivalTime: null,
      stockDetails: "",
      deliveryContactNumber: row.customer_phone || "",
      warehouseLocation: "",
      panelDetails: derivedPanel,
      wiringDetails: "",
      batteryDetails: "",
      inverterBattery: parsedInverter || "",
      powerOutput: derivedPanel,
      paymentOverrideStatus: "none",
      paymentOverrideReason: "",
      teams: [],
      remarks: remarkText,
      installationRemarks: problemDesc || ticketTitle,
      issueCategory: category,
      priority,
      supportTicket: {
        id: row.id,
        bubbleId: row.bubble_id,
        title: ticketTitle,
        problemDescription: problemDesc,
        technicianRemark: row.technician_remark,
        status: row.status || "unread",
        priority,
        images: row.images,
        videoUrl: row.video_url,
        createdDate: row.created_date,
      },
    };
  });
}
