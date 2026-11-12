import { NextResponse } from "next/server";
import { AuthError, requireUser } from "@/lib/auth";
import { malaysiaToday } from "@/lib/dates";
import { readOpsState } from "@/lib/ops-store";
import type { InstallationJob } from "@/lib/types";

export const dynamic = "force-dynamic";

// Read-only copy of the dashboard's "Arranged Installation" for the Inventory
// Management page's Customer Details tab.
//
// /warehouse is a public page whose own sign-in is only a front-end gate, so
// this route is the real lock: it needs the dashboard session (requireUser) and
// the page keeps its sample data when it answers 401. Customer name, phone,
// email and address are returned, so nothing here may be loosened without
// deciding who is allowed to read them.

export type ArrangedCustomer = {
  jobId: string;
  invoice: string;
  name: string;
  address: string;
  phone: string;
  email: string;
  agent: string;
  phase: string;
  panel: string;
  inverter: string;
  remark: string;
  date: string;
  time: string;
  hasBattery: boolean;
};

export type ArrangedGroup = {
  id: string;
  teamLabel: string;
  baseLocation: string;
  installationTeam: string;
  wiringTeam: string;
  supervisors: string[];
  members: string[];
  cars: string[];
  installationDate: string;
  installationEndDate: string;
  customers: ArrangedCustomer[];
};

type RawGroup = {
  id?: string;
  name?: string;
  area?: string;
  installationDate?: string;
  installationEndDate?: string;
  jobIds?: string[];
  installationTeam?: string;
  wiringTeam?: string;
  supervisors?: string[];
  supervisor?: string;
  teamLabel?: string;
  wiringMembers?: string[];
  cars?: string[];
  remark?: string;
};

type RawTeam = { id?: string; name?: string; baseLocation?: string; members?: string[] };
type RawAssignment = { teamId?: string; installationGroupId?: string };

// Weeks from the past 12 to the next 4 — enough for the week picker, small payload.
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

export async function GET(request: Request) {
  try {
    await requireUser();
  } catch (error) {
    const status = error instanceof AuthError ? error.status : 401;
    return NextResponse.json({ error: "Not signed in." }, { status });
  }

  const origin = new URL(request.url).origin;
  const [{ state }, jobsResponse] = await Promise.all([
    readOpsState(),
    fetch(`${origin}/api/jobs`, {
      headers: { cookie: request.headers.get("cookie") ?? "" },
      cache: "no-store",
    }),
  ]);
  if (!jobsResponse.ok) {
    return NextResponse.json({ error: "Could not load installation jobs." }, { status: 502 });
  }
  const { jobs = [] } = (await jobsResponse.json()) as { jobs?: InstallationJob[] };
  const jobById = new Map(jobs.map((job) => [job.id, job]));
  const updates = state.jobUpdates as Record<string, Record<string, unknown>>;
  const teams = state.teamResources as RawTeam[];
  const assignments = state.teamWeekAssignments as RawAssignment[];

  const today = malaysiaToday();
  const from = shiftDate(today, -DAYS_BACK);
  const to = shiftDate(today, DAYS_AHEAD);

  const groups: ArrangedGroup[] = (state.groups as RawGroup[])
    .filter((group) => {
      const start = str(group.installationDate).slice(0, 10);
      const end = str(group.installationEndDate).slice(0, 10) || start;
      return Boolean(start) && end >= from && start <= to;
    })
    .map((group) => {
      const assignment = assignments.find((a) => a.installationGroupId === group.id);
      const team = teams.find((t) => t.id === assignment?.teamId);
      const groupDate = str(group.installationDate).slice(0, 10);

      const customers: ArrangedCustomer[] = (group.jobIds ?? []).map((jobId) => {
        const job = jobById.get(jobId);
        const update = updates[jobId] ?? {};
        const pick = (key: string, fallback: string) => str(update[key]) || fallback;
        return {
          jobId,
          invoice: job?.invoiceNumber ?? str(update.invoiceNumber),
          name: pick("customerName", job?.customerName ?? ""),
          address: pick("address", job?.address ?? ""),
          phone: pick("customerPhone", job?.customerPhone ?? ""),
          email: job?.customerEmail ?? "",
          agent: pick("agentName", job?.agentName ?? ""),
          phase: job?.phase && job.phase !== "Unknown" ? job.phase.replace(" phase", "") : "",
          panel: job?.panelDetails || pick("powerOutput", job?.powerOutput ?? ""),
          inverter: pick("inverterBattery", job?.inverterBattery || job?.derivedInverterModel || job?.inverter || ""),
          remark: pick("installationRemarks", job?.installationRemarks ?? group.remark ?? ""),
          date: (str(update.installationDate) || job?.installationDate || groupDate).slice(0, 10),
          time: pick("preferredInstallationTime", job?.preferredInstallationTime ?? ""),
          hasBattery: Boolean(job?.batteryDetails || job?.battery),
        };
      });

      return {
        id: str(group.id),
        teamLabel: str(group.teamLabel) || str(group.name),
        baseLocation: team?.baseLocation ?? str(group.area),
        installationTeam: str(group.installationTeam),
        wiringTeam: str(group.wiringTeam),
        supervisors: group.supervisors ?? (group.supervisor ? [group.supervisor] : []),
        members: group.wiringMembers ?? [],
        cars: group.cars ?? [],
        installationDate: groupDate,
        installationEndDate: str(group.installationEndDate).slice(0, 10) || groupDate,
        customers,
      };
    })
    .sort((a, b) => a.installationDate.localeCompare(b.installationDate) || a.teamLabel.localeCompare(b.teamLabel));

  return NextResponse.json({ groups });
}
