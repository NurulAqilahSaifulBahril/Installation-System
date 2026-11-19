import { NextResponse } from "next/server";
import { warehouseJobs } from "@/lib/warehouse-jobs";
import { AuthError } from "@/lib/auth";
import { requireUser } from "@/lib/warehouse-auth";
import { malaysiaToday } from "@/lib/dates";
import { readOpsState } from "@/lib/ops-store";
import { cleanDeliveryStockRemark } from "@/lib/delivery-remark";
import type { InstallationJob } from "@/lib/types";

export const dynamic = "force-dynamic";

// Read-only copy of the dashboard's "Delivery Schedule" for the Inventory Management page's
// Project Team > Delivery Schedule tab.
//
// Same lock as /api/warehouse/arranged: /warehouse is a public page whose own sign-in is only a
// front-end gate, so this route needs a signed-in session. Customer name, phone and address are
// returned.

export type DeliveryCustomer = {
  jobId: string;
  invoice: string;
  name: string;
  phone: string;
  address: string;
  agent: string;
  phase: string;
  panel: string;
  inverter: string;
  etaDate: string;
  etaTime: string;
  installDate: string;
  installTime: string;
  team: string;
  // Colour class of the Scheduling Team cell, as on the dashboard ("team-2", "team-default", …).
  teamClass: string;
  remark: string;
  atap: boolean;
  battery: boolean;
  ev: boolean;
  om: boolean;
  kohKengKiat: boolean;
  isWarehouse: boolean;
};

export type DeliveryRunPayload = {
  id: string;
  name: string;
  deliveryDate: string;
  departureTime: string;
  weekLabel: string;
  warehouse: string;
  deliveryPic: string;
  contactNumber: string;
  // The lorry on the sheet ("Lorry 2") and its plate from the run header ("WJX 3918").
  deliveryTeam: string;
  plateNumber: string;
  isWarehouse: boolean;
  // Colour class of the run band, as on the dashboard ("rti-team-2", "rti-team-warehouse", …).
  teamClass: string;
  order: number | null;
  totalPanels: number;
  customers: DeliveryCustomer[];
};

type RawRun = {
  id?: string;
  name?: string;
  deliveryDate?: string;
  departureTime?: string;
  weekLabel?: string;
  warehouse?: string;
  deliveryTeam?: string;
  deliveryPic?: string;
  contactNumber?: string;
  // Lorry plate read from the run header on the sheet ("WJX 3918").
  plateNumber?: string;
  isWarehouseTransfer?: boolean;
  order?: number;
  jobIds?: string[];
};

type RawGroup = {
  name?: string;
  teamLabel?: string;
  installationDate?: string;
  installationTeam?: string;
  wiringTeam?: string;
  jobIds?: string[];
};

// Weeks from the past 12 to the next 4, as on the Installation Schedule tab.
const DAYS_BACK = 84;
const DAYS_AHEAD = 28;

function shiftDate(isoDate: string, days: number): string {
  const d = new Date(`${isoDate}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function str(value: unknown): string {
  return typeof value === "string" ? value : "";
}

// Same reading as the dashboard's Phase column.
function phaseOf(job: Record<string, unknown>): string {
  const p = str(job.phase).toLowerCase();
  if (p.includes("single") || p === "1") return "Single";
  if (p.includes("three") || p === "3") return "Three";
  const text = `${str(job.inverterBattery)} ${str(job.installationRemarks)}`.toLowerCase();
  if (/three[\s-]phase|3[\s-]phase/.test(text)) return "Three";
  if (/single[\s-]phase|1[\s-]phase/.test(text)) return "Single";
  return "";
}

function panelCount(job: Record<string, unknown>, panelText: string): number {
  const qty = job.panelQuantity;
  if (typeof qty === "number" && qty > 0) return qty;
  const m = panelText.match(/(\d+)\s*[xX]\b/) || panelText.match(/(\d+)\s*(?:pcs|panels?)\b/i);
  return m ? Number(m[1]) : 0;
}

// Teams with their own colour on the dashboard.
const STANDARD_TEAMS = [0, 1, 2, 3, 4, 6, 7];

function teamNumber(text: string, fallback = ""): number | null {
  const m = text.match(/\bteam\s*(\d+)\b/i) || fallback.match(/\b(\d+)\b/);
  return m ? Number(m[1]) : null;
}

type Placement = { jobId?: string; team?: number; slot?: string };

function isWarehouseJob(job: Record<string, unknown>): boolean {
  if (job.isWarehouseTransfer) return true;
  const name = str(job.customerName).toLowerCase();
  const addr = str(job.address).toLowerCase();
  const rem = `${str(job.remarks)} ${str(job.stockDetails)}`.toLowerCase();
  if (name.includes("pick up from") || name.includes("pickup from")) return true;
  if (addr.includes("drop off")) return true;
  if (name.includes("warehouse") && (addr.includes("warehouse") || addr.includes("office"))) return true;
  if (rem.includes("warehouse transfer") || rem.includes("lorry transfer")) return true;
  return false;
}

export async function GET(request: Request) {
  try {
    await requireUser();
  } catch (error) {
    const status = error instanceof AuthError ? error.status : 401;
    return NextResponse.json({ error: "Not signed in." }, { status });
  }

  // The runs (who is on which lorry, driver, plate) are read fresh from the ops state every time;
  // customer details come from the inventory's job copy (see lib/warehouse-jobs).
  let opsAndJobs: [Awaited<ReturnType<typeof readOpsState>>, InstallationJob[]];
  try {
    opsAndJobs = await Promise.all([readOpsState(), warehouseJobs(request.url)]);
  } catch {
    return NextResponse.json({ error: "Could not load jobs." }, { status: 502 });
  }
  const [{ state }, jobs] = opsAndJobs;
  const jobById = new Map(jobs.map((job) => [job.id, job as unknown as Record<string, unknown>]));
  const updates = state.jobUpdates as Record<string, Record<string, unknown>>;
  const groupByJobId = new Map<string, RawGroup>();
  (state.groups as RawGroup[]).forEach((group) => (group.jobIds ?? []).forEach((id) => groupByJobId.set(id, group)));
  // Customer Scheduling's proposed placements (shown as "Team N (Proposed)").
  const placementByJobId = new Map<string, Placement>();
  const placements = (state.scheduleDraft as { placements?: Placement[] }).placements ?? [];
  placements.forEach((p) => {
    if (p.jobId && !placementByJobId.has(p.jobId)) placementByJobId.set(p.jobId, p);
  });

  const today = malaysiaToday();
  const from = shiftDate(today, -DAYS_BACK);
  const to = shiftDate(today, DAYS_AHEAD);

  const runs: DeliveryRunPayload[] = (state.deliveryRuns as RawRun[])
    .filter((run) => {
      const date = str(run.deliveryDate).slice(0, 10);
      return Boolean(date) && date >= from && date <= to;
    })
    .map((run) => {
      const deliveryDate = str(run.deliveryDate).slice(0, 10);
      const departureTime = str(run.departureTime) || "09:00";
      let totalPanels = 0;
      let anyWarehouseJob = false;
      const customers: DeliveryCustomer[] = [];
      (run.jobIds ?? []).forEach((jobId) => {
        const base = jobById.get(jobId);
        const update = updates[jobId] ?? {};
        // Jobs only kept in the dashboard (warehouse transfers, custom stops) live in the
        // saved updates alone; like the dashboard, they need a name or an address.
        if (!base && !str(update.customerName) && !str(update.address)) return;
        const job: Record<string, unknown> = { ...(base ?? {}), ...update };
        const group = groupByJobId.get(jobId);
        const placement = placementByJobId.get(jobId);
        const panel = str(job.panelDetails) || str(job.powerOutput);
        totalPanels += panelCount(job, panel);
        const warehouseJob = isWarehouseJob(job);
        if (warehouseJob) anyWarehouseJob = true;
        const visits = Array.isArray(job.visits) ? (job.visits as { date?: string; time?: string }[]) : [];
        const installDate = (
          str(group?.installationDate) ||
          str((placement as { date?: string } | undefined)?.date) ||
          str(job.preferredInstallationDate) ||
          str(job.installationDate) ||
          str(visits[0]?.date)
        ).slice(0, 10);
        const installTime = installDate
          ? str(visits.find((v) => v.date === installDate)?.time) ||
            (str(job.preferredInstallationDate).slice(0, 10) === installDate ? str(job.preferredInstallationTime) : "")
          : "";
        // Scheduling Team text and colour, worked out as on the dashboard.
        const jobTeams = Array.isArray(job.teams) ? (job.teams as { role?: string; teamName?: string }[]) : [];
        const installTeam = str(group?.installationTeam) || str(jobTeams.find((t) => t.role === "roof")?.teamName);
        const wiringTeam = str(group?.wiringTeam) || str(jobTeams.find((t) => t.role === "wiring")?.teamName);
        const rawTeam = group
          ? teamNumber(`${str(group.teamLabel)} ${str(group.name)} ${str(group.installationTeam)}`, str(group.teamLabel))
          : typeof placement?.team === "number"
            ? placement.team
            : null;
        const standard = rawTeam !== null && STANDARD_TEAMS.includes(rawTeam);
        const teamClass = standard
          ? `team-${rawTeam}`
          : group
            ? "team-default"
            : placement
              ? `team-${placement.team}`
              : "team-unassigned";
        const mainLabel = group
          ? str(group.teamLabel) || (standard ? `Team ${rawTeam}` : str(group.name))
          : placement
            ? `Team ${placement.team} (Proposed)`
            : "";
        const teamParts: string[] = [];
        if (mainLabel) teamParts.push(mainLabel);
        if (installTeam) teamParts.push(`Installation Team: ${installTeam}`);
        if (wiringTeam) teamParts.push(`Wiring Team: ${wiringTeam}`);
        const remark = cleanDeliveryStockRemark(str(job.stockDetails));
        const name = str(job.customerName);
        customers.push({
          jobId,
          invoice: str(job.invoiceNumber),
          name: str(job.customerName),
          phone: str(job.customerPhone),
          address: str(job.address),
          agent: str(job.agentName).trim().toUpperCase(),
          phase: phaseOf(job),
          panel,
          inverter:
            str(job.inverterBattery).trim() ||
            str(job.derivedInverterModel) ||
            (str(job.inverter) === "Not available" ? "" : str(job.inverter)),
          etaDate: str(job.arrivalDate) || deliveryDate,
          etaTime: str(job.arrivalTime) || departureTime,
          installDate,
          installTime,
          team: teamParts.join(", "),
          teamClass,
          remark,
          atap: /\(ATAP\)/i.test(name),
          battery: Boolean(str(job.battery)) && str(job.battery) !== "Not available",
          ev: Boolean(str(job.evDetails)),
          om: /o\s*&\s*m/i.test(remark) || /o\s*&\s*m/i.test(str(job.installationRemarks)),
          kohKengKiat: /koh\s*keng\s*kiat/i.test(name),
          isWarehouse: warehouseJob,
        });
      });
      const runName = `${str(run.name)} ${str(run.deliveryTeam)}`.toLowerCase();
      const isWarehouseRun =
        Boolean(run.isWarehouseTransfer) ||
        runName.includes("warehouse transfer") ||
        runName.includes("lorry transfer") ||
        str(run.warehouse).toLowerCase() === "warehouse transfer" ||
        anyWarehouseJob;
      const runTeam = teamNumber(`${str(run.deliveryTeam)} ${str(run.name)}`, str(run.deliveryTeam));
      const runStandard = runTeam !== null && STANDARD_TEAMS.includes(runTeam);
      return {
        id: str(run.id),
        name: str(run.name),
        deliveryDate,
        departureTime,
        weekLabel: str(run.weekLabel),
        warehouse: str(run.warehouse),
        deliveryPic: str(run.deliveryPic),
        contactNumber: str(run.contactNumber),
        deliveryTeam: str(run.deliveryTeam),
        plateNumber: str(run.plateNumber),
        isWarehouse: isWarehouseRun,
        teamClass: isWarehouseRun
          ? "rti-team-warehouse"
          : runStandard
            ? `rti-team-${runTeam}`
            : "rti-team-other rti-team-default",
        order: typeof run.order === "number" ? run.order : null,
        totalPanels,
        customers,
      };
    })
    .sort(
      (a, b) =>
        a.deliveryDate.localeCompare(b.deliveryDate) ||
        (a.order ?? 0) - (b.order ?? 0) ||
        a.departureTime.localeCompare(b.departureTime) ||
        a.name.localeCompare(b.name),
    );

  return NextResponse.json({ runs });
}
