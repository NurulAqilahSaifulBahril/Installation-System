import { NextResponse } from "next/server";
import { GET as getJobs } from "@/app/api/jobs/route";
import { AuthError } from "@/lib/auth";
import { requireUser } from "@/lib/warehouse-auth";
import { malaysiaToday } from "@/lib/dates";
import { fetchInvoiceItemLines } from "@/lib/source-api";
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

  // Reuse the jobs pipeline (and its short cache) 
  // Called directly (not over HTTP), so a warehouse session needs no Scheduling cookie.
  const response = await getJobs(new Request(new URL("/api/jobs", request.url)));
  if (!response.ok) {
    return NextResponse.json({ error: "Could not load installation jobs." }, { status: 502 });
  }
  const data = (await response.json()) as { jobs?: InstallationJob[]; source?: string };

  const today = malaysiaToday();
  const from = firstOfPreviousMonth(today);
  const to = shiftDate(today, DAYS_AHEAD);

  const windowJobs = (data.jobs ?? []).filter((job) => {
    const date = job.installationDate?.slice(0, 10);
    return Boolean(date) && date! >= from && date! <= to;
  });

  // The job's saved text can lack lines (ops overwrite it from the schedule sheet), so the
  // invoice's own item lines are read directly. If that read fails, the saved text is used.
  let invoiceLines: Record<string, string[]> = {};
  try {
    invoiceLines = await fetchInvoiceItemLines(windowJobs.map((job) => job.id));
  } catch (error) {
    console.error("[warehouse/schedule] could not read invoice item lines", error);
  }

  const jobs: WarehouseScheduledJob[] = windowJobs
    .map((job) => ({
      jobId: job.invoiceNumber,
      customerName: job.customerName,
      customerPhone: job.customerPhone,
      address: [job.address, job.postcode, job.city, job.state].filter(Boolean).join(", "),
      agentName: job.agentName,
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

  return NextResponse.json({ source: data.source ?? "live", jobs });
}
