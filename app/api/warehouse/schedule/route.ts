import { NextResponse } from "next/server";
import { warehouseJobs } from "@/lib/warehouse-jobs";
import { AuthError } from "@/lib/auth";
import { requireUser } from "@/lib/warehouse-auth";
import { malaysiaToday } from "@/lib/dates";
import { readOpsState } from "@/lib/ops-store";
import { fetchDeletedInvoiceIds, fetchInvoiceItemLines } from "@/lib/source-api";
import type { InstallationJob } from "@/lib/types";

export const dynamic = "force-dynamic";

// Booked installations for the Inventory Management page's Stock Out rows.
//
// /warehouse itself is a public page whose own sign-in is only a front-end
// gate, so this route is the real lock: it needs the dashboard session
// (requireUser) and the page falls back to sample data when it answers 401.
// It returns only the fields the dispatch screen shows, not whole job records.

export type WarehouseScheduledJob = {
  jobId: string;
  customerName: string;
  customerPhone: string;
  address: string;
  agentName: string;
  installationDate: string;
  teams: string[];
  packageName: string;
  totalAmount: number;
  paymentPercent: number;
  sedaStatus: string;
  panelQuantity: number | null;
  panelRating: number | null;
  powerOutput: string;
  // "Single phase", "Three phase" or "Unknown": decides the TNB meter type.
  phase: string;
  inverterText: string;
  batteryText: string;
  // Every invoice item line the scheduling system carries, for the warehouse to sort.
  itemLines: string[];
  // The source invoice id: drawings are looked up on demand with it (they are kept
  // out of the job list on purpose, because the links for every invoice are huge).
  sourceId: string;
  // Commercial job, by the dashboard's rule: a Tariff B package, or a Selco customer.
  // Stock out shows the commercial special materials (trunking, cable gland, metal DB box).
  commercial: boolean;
};

// Booked jobs from the 1st of last month (so last month's transactions stay visible) to two weeks ahead.
const DAYS_AHEAD = 14;

function firstOfPreviousMonth(isoDate: string): string {
  const [year, month] = isoDate.split("-").map(Number);
  const d = new Date(Date.UTC(year, month - 2, 1));
  return d.toISOString().slice(0, 10);
}

function shiftDate(isoDate: string, days: number): string {
  const d = new Date(`${isoDate}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export async function GET(request: Request) {
  try {
    await requireUser();
  } catch (error) {
    const status = error instanceof AuthError ? error.status : 401;
    return NextResponse.json({ error: "Not signed in." }, { status });
  }

  // The inventory's copy of the jobs list (see lib/warehouse-jobs), called directly (not over
  // HTTP), so a warehouse session needs no Scheduling cookie.
  // The ops state (Delivery Schedule runs and the ops team's edits) is read alongside; if it
  // cannot be read, the jobs list is used as before.
  let loaded: [InstallationJob[], Awaited<ReturnType<typeof readOpsState>> | null];
  try {
    loaded = await Promise.all([
      warehouseJobs(request.url),
      readOpsState().catch((error) => {
        console.error("[warehouse/schedule] could not read the delivery schedule", error);
        return null;
      }),
    ]);
  } catch {
    return NextResponse.json({ error: "Could not load installation jobs." }, { status: 502 });
  }
  const [rawJobs, ops] = loaded;

  // Customer details as the Delivery Schedule shows them: the ops team's edits on top of the
  // job (name, phone, address, agent, phase, panel, inverter, installation date).
  const str = (value: unknown) => (typeof value === "string" ? value.trim() : "");
  const updates = (ops?.state.jobUpdates ?? {}) as Record<string, Record<string, unknown>>;
  const groupDate = new Map<string, string>();
  ((ops?.state.groups ?? []) as { installationDate?: string; jobIds?: string[] }[]).forEach((group) =>
    (group.jobIds ?? []).forEach((id) => {
      const date = str(group.installationDate).slice(0, 10);
      if (date && !groupDate.has(id)) groupDate.set(id, date);
    }),
  );
  const runDate = new Map<string, string>();
  ((ops?.state.deliveryRuns ?? []) as { deliveryDate?: string; jobIds?: string[] }[]).forEach((run) =>
    (run.jobIds ?? []).forEach((id) => {
      const date = str(run.deliveryDate).slice(0, 10);
      if (date && !runDate.has(id)) runDate.set(id, date);
    }),
  );
  const allJobs: InstallationJob[] = rawJobs.map((job) => {
    const update = updates[job.id] ?? {};
    const installationDate =
      groupDate.get(job.id) || str(update.installationDate).slice(0, 10) || job.installationDate?.slice(0, 10) || runDate.get(job.id) || "";
    return {
      ...job,
      customerName: str(update.customerName) || job.customerName,
      customerPhone: str(update.customerPhone) || job.customerPhone,
      // The Delivery Schedule's address is one line: used whole, without postcode / city added.
      ...(str(update.address) ? { address: str(update.address), postcode: "", city: "", state: "" } : {}),
      agentName: str(update.agentName) || job.agentName,
      phase: (str(update.phase) || job.phase) as InstallationJob["phase"],
      powerOutput: str(update.powerOutput) || job.powerOutput,
      panelDetails: str(update.panelDetails) || job.panelDetails,
      inverterBattery: str(update.inverterBattery) || job.inverterBattery,
      installationDate: installationDate || job.installationDate,
    };
  });

  const today = malaysiaToday();
  const from = firstOfPreviousMonth(today);
  const to = shiftDate(today, DAYS_AHEAD);
  const inWindow = (date: string | undefined) => Boolean(date) && date! >= from && date! <= to;

  // Stock Out goes by the Delivery Schedule: every job on a delivery run in the window, plus
  // booked jobs not (yet) on a run, by installation date.
  const datedJobs = allJobs.filter(
    (job) => Boolean(job.installationDate) && (inWindow(runDate.get(job.id)) || inWindow(job.installationDate?.slice(0, 10))),
  );
  // Two prod_main reads, run side by side: which invoices were deleted (e.g. Heah Kee Thin's
  // INV-1011708, a deleted second invoice whose job stayed in the installation store; those jobs
  // are left out) and each invoice's own item lines (the job's saved text can lack lines, since ops
  // overwrite it from the schedule sheet). If either read fails, every job / the saved text is used.
  const ids = datedJobs.map((job) => job.id);
  const [deletedIds, invoiceLines] = await Promise.all([
    fetchDeletedInvoiceIds(ids).catch((error) => {
      console.error("[warehouse/schedule] could not check for deleted invoices", error);
      return new Set<string>();
    }),
    fetchInvoiceItemLines(ids).catch((error) => {
      console.error("[warehouse/schedule] could not read invoice item lines", error);
      return {} as Record<string, string[]>;
    }),
  ]);
  const windowJobs = datedJobs.filter((job) => !deletedIds.has(job.id));
  // A job made in the Scheduling system without an invoice (e.g. "INV-100" for Ong Kai Ping) has
  // no agent: use the agent of the same customer's real invoice, when exactly one is named.
  const nameKey = (name: string) => name.toUpperCase().replace(/\([^)]*\)/g, " ").replace(/\s+/g, " ").trim();
  const agentsByCustomer = new Map<string, Set<string>>();
  allJobs.forEach((job) => {
    const agent = (job.agentName ?? "").trim();
    if (!agent || agent === "Not available") return;
    const key = nameKey(job.customerName ?? "");
    if (!key) return;
    if (!agentsByCustomer.has(key)) agentsByCustomer.set(key, new Set());
    agentsByCustomer.get(key)!.add(agent);
  });
  const agentFor = (job: InstallationJob) => {
    const own = (job.agentName ?? "").trim();
    if (own && own !== "Not available") return own;
    const named = agentsByCustomer.get(nameKey(job.customerName ?? ""));
    return named && named.size === 1 ? Array.from(named)[0] : own;
  };

  const jobs: WarehouseScheduledJob[] = windowJobs
    .map((job) => ({
      jobId: job.invoiceNumber,
      customerName: job.customerName,
      customerPhone: job.customerPhone,
      address: [job.address, job.postcode, job.city, job.state].filter(Boolean).join(", "),
      agentName: agentFor(job),
      installationDate: job.installationDate!.slice(0, 10),
      teams: job.teams.map((team) => team.teamName).filter(Boolean),
      packageName: job.packageName,
      totalAmount: job.totalAmount,
      paymentPercent: job.paymentPercent,
      sedaStatus: job.sedaStatus,
      panelQuantity: job.panelQuantity,
      panelRating: job.panelRating,
      powerOutput: job.powerOutput,
      phase: job.phase,
      inverterText: job.inverterBattery || job.derivedInverterModel || job.inverter,
      batteryText: job.batteryDetails || job.battery,
      sourceId: job.id,
      commercial: /tariff\s*b/i.test(job.packageType ?? "") || /\bselco\b/i.test(job.customerName),
      itemLines: invoiceLines[job.id]?.length
        ? invoiceLines[job.id]
        : [
            job.panelDetails,
            job.powerOutput,
            job.wiringDetails,
            job.ballastDetails ?? "",
            job.focDetails ?? "",
          ].filter(Boolean),
    }))
    .sort((a, b) => a.installationDate.localeCompare(b.installationDate));

  return NextResponse.json({ source: "live", jobs });
}
