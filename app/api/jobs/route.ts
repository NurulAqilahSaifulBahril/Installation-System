import { NextResponse } from 'next/server';
import { toDateOnly } from '@/lib/dates';
import { demoJobs } from '@/lib/demo-data';
import { ensureInstallationSchema } from '@/lib/installation-schema';
import { queryProxy } from '@/lib/proxy-db';
import { fetchEligibleSourceJobs } from '@/lib/source-api';
import type { InstallationJob } from '@/lib/types';

import { getCached, getInflight, setCached, setInflight } from '@/lib/jobs-cache';

export const dynamic = 'force-dynamic';

// The source query joins invoice/payment/customer/agent/seda_registration over
// a remote proxy (Railway), so every uncached request pays full network +
// join latency. A short TTL turns repeat loads (tab switches, accidental
// double-fetches, quick navigation back to the dashboard) into a memory hit
// instead of a multi-second round trip, without staling the pipeline for long.

type OperationalRow = {
  source_invoice_id: string;
  installation_date: string | null;
  customer_availability_status: InstallationJob['customerAvailabilityStatus'] | null;
  preferred_installation_date: string | null;
  second_preferred_installation_date: string | null;
  preferred_installation_time: string | null;
  availability_remarks: string | null;
  schedule_status: InstallationJob['scheduleStatus'];
  installation_approval_status: InstallationJob['installationApprovalStatus'];
  delivery_status: InstallationJob['deliveryStatus'];
  delivery_date: string | null;
  arrival_date: string | null;
  arrival_time: string | null;
  stock_details: string | null;
  delivery_contact_number: string | null;
  warehouse_location: string | null;
  panel_details: string | null;
  wiring_details: string | null;
  battery_details: string | null;
  inverter_battery: string | null;
  power_output: string | null;
  payment_override_status: InstallationJob['paymentOverrideStatus'] | null;
  payment_override_reason: string | null;
  remarks: string | null;
  installation_remarks: string | null;
};

type TeamRow = {
  source_invoice_id: string;
  id: string;
  role: InstallationJob['teams'][number]['role'];
  team_name: string;
  contact: string | null;
  activity: InstallationJob['teams'][number]['activity'];
  custom_activity: string | null;
};

function mergeOperations(
  jobs: InstallationJob[],
  operations: Array<OperationalRow & { teams: TeamRow[] }>,
): InstallationJob[] {
  const bySourceId = new Map(
    operations.map((row) => [row.source_invoice_id, row]),
  );

  return jobs.map((job) => {
    const operation = bySourceId.get(job.id);
    if (!operation) return job;

    return {
      ...job,
      installationDate: toDateOnly(operation.installation_date),
      customerAvailabilityStatus:
        operation.customer_availability_status ?? 'not_set',
      preferredInstallationDate: toDateOnly(operation.preferred_installation_date),
      preferredInstallationTime: operation.preferred_installation_time || null,
      secondPreferredInstallationDate: toDateOnly(
        operation.second_preferred_installation_date,
      ),
      availabilityRemarks: operation.availability_remarks ?? '',
      scheduleStatus: operation.schedule_status,
      installationApprovalStatus: operation.installation_approval_status,
      deliveryStatus: operation.delivery_status,
      deliveryDate: toDateOnly(operation.delivery_date),
      arrivalDate: toDateOnly(operation.arrival_date),
      arrivalTime: operation.arrival_time,
      stockDetails: operation.stock_details ?? '',
      deliveryContactNumber:
        operation.delivery_contact_number ?? job.customerPhone,
      warehouseLocation: operation.warehouse_location ?? '',
      panelDetails: operation.panel_details ?? job.panelDetails,
      wiringDetails: operation.wiring_details ?? '',
      batteryDetails: operation.battery_details ?? job.battery,
      inverterBattery: operation.inverter_battery ?? job.inverterBattery,
      powerOutput: operation.power_output ?? job.powerOutput,
      paymentOverrideStatus: operation.payment_override_status ?? 'none',
      paymentOverrideReason: operation.payment_override_reason ?? '',
      remarks: operation.remarks ?? '',
      installationRemarks: operation.installation_remarks ?? '',
      teams: operation.teams.map((team) => ({
        id: team.id,
        role: team.role,
        teamName: team.team_name,
        contact: team.contact ?? undefined,
        activity: team.activity ?? 'pv_panels',
        customActivity: team.custom_activity ?? undefined,
      })),
    };
  });
}

async function readOperationalRows(sourceIds: string[]) {
  const [jobs, teams] = await Promise.all([
    queryProxy<OperationalRow>(
      [
        'select',
        '  source_invoice_id,',
        '  installation_date,',
        '  customer_availability_status,',
        '  preferred_installation_date,',
        '  preferred_installation_time,',
        '  second_preferred_installation_date,',
        '  availability_remarks,',
        '  schedule_status,',
        '  installation_approval_status,',
        '  delivery_status,',
        '  delivery_date,',
        '  arrival_date,',
        '  arrival_time,',
        '  stock_details,',
        '  delivery_contact_number,',
        '  warehouse_location,',
        '  panel_details,',
        '  wiring_details,',
        '  battery_details,',
        '  inverter_battery,',
        '  power_output,',
        '  payment_override_status,',
        '  payment_override_reason,',
        '  remarks,',
        '  installation_remarks',
        'from public.installation_jobs',
        'where source_invoice_id = any($1::text[])',
        'order by updated_at desc nulls last, source_invoice_id asc',
      ].join('\n'),
      [sourceIds],
    ),
    queryProxy<TeamRow>(
      [
        'select',
        '  ij.source_invoice_id,',
        '  jta.id,',
        '  jta.role,',
        '  jta.team_name,',
        '  jta.contact,',
        '  jta.activity,',
        '  jta.custom_activity',
        'from public.job_team_assignments jta',
        'join public.installation_jobs ij on ij.id = jta.installation_job_id',
        'where ij.source_invoice_id = any($1::text[])',
        'order by ij.source_invoice_id asc, jta.created_at asc, jta.id asc',
      ].join('\n'),
      [sourceIds],
    ),
  ]);

  const teamsBySource = new Map<string, TeamRow[]>();
  teams.forEach((team) => {
    const existing = teamsBySource.get(team.source_invoice_id) ?? [];
    existing.push(team);
    teamsBySource.set(team.source_invoice_id, existing);
  });

  return jobs.map((job) => ({
    ...job,
    teams: teamsBySource.get(job.source_invoice_id) ?? [],
  }));
}

// The newest upstream edit across the returned jobs. This is the age of the
// data itself, which is not the same thing as syncedAt (the moment we queried)
// — a stalled upstream sync leaves syncedAt current while the data goes stale.
function newestSourceUpdate(jobs: InstallationJob[]): string | null {
  let newest: string | null = null;
  for (const job of jobs) {
    const updated = job.sourceUpdatedAt;
    if (updated && (!newest || updated > newest)) {
      newest = updated;
    }
  }
  return newest;
}

async function loadJobsPayload() {
  let source: 'live' | 'demo' = 'live';
  let warning: string | null = null;
  let jobs: InstallationJob[];

  try {
    const result = await fetchEligibleSourceJobs();
    jobs = result.jobs;
    if (result.truncated) {
      warning =
        'Source returned the maximum number of rows, so some jobs are missing. ' +
        'Raise SOURCE_ROW_LIMIT in lib/source-api.ts.';
    }
  } catch (error) {
    source = 'demo';
    warning =
      error instanceof Error
        ? 'Live source unavailable: ' + error.message
        : 'Live source unavailable.';
    jobs = demoJobs;
  }

  const sourceUpdatedAt = newestSourceUpdate(jobs);

  try {
    await ensureInstallationSchema();
    const merged = mergeOperations(jobs, await readOperationalRows(jobs.map((job) => job.id)));
    return {
      jobs: merged,
      source,
      persistence: 'api-db',
      warning,
      syncedAt: new Date().toISOString(),
      sourceUpdatedAt,
    };
  } catch (error) {
    const sharedWarning =
      error instanceof Error
        ? 'API database unavailable: ' + error.message
        : 'API database unavailable.';
    return {
      jobs,
      source,
      persistence: 'browser',
      warning: warning ? warning + ' ' + sharedWarning : sharedWarning,
      syncedAt: new Date().toISOString(),
      sourceUpdatedAt,
    };
  }
}

export async function GET(request: Request) {
  const bypassCache = new URL(request.url).searchParams.get('fresh') === '1';

  if (!bypassCache) {
    const cached = getCached();
    if (cached) return NextResponse.json(cached);

    // Two tabs/effects racing in on a cold cache would otherwise both pay the
    // full remote-join latency; the second one rides the first's in-flight
    // request instead of firing a duplicate query.
    const inflight = getInflight();
    if (inflight) return NextResponse.json(await inflight);
  }

  const requestPromise = loadJobsPayload();
  setInflight(requestPromise);

  try {
    const body = await requestPromise;
    setCached(body);
    return NextResponse.json(body);
  } finally {
    setInflight(null);
  }
}
