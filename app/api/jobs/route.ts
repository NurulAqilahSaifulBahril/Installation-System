import { NextResponse } from 'next/server';
import { malaysiaToday, toDateOnly } from '@/lib/dates';
import { isSedaApproved, normalizeAvailabilityStatus } from '@/lib/types';
import { resolvedAvailabilityStatus } from '@/lib/completion';
import { readOpsState, writeOpsState } from '@/lib/ops-store';
import {
  RECONCILE_INSERT_SQL,
  RECONCILE_UPDATE_SQL,
  applyStoreReconciliation,
  planStoreReconciliation,
} from '@/lib/store-reconcile';
import { demoJobs } from '@/lib/demo-data';
import { ensureInstallationSchema } from '@/lib/installation-schema';
import { queryProxy } from '@/lib/proxy-db';
import { fetchEligibleSourceJobs } from '@/lib/source-api';
import { fetchActiveSupportTicketJobs } from '@/lib/support-tickets';
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
      // The column is plain text and still holds values from the seven-status
      // scheme, so it is translated on the way out rather than migrated.
      customerAvailabilityStatus: normalizeAvailabilityStatus(
        operation.customer_availability_status,
      ),
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

// A group as this route needs to read it: which jobs are in it, and the date
// it is booked for. The stored shape is wider and belongs to the page, so it
// is narrowed here rather than imported.
type StoredGroup = { jobIds?: unknown; installationDate?: unknown };

function groupDatesByJobId(groups: unknown[]): Map<string, string | null> {
  const byJob = new Map<string, string | null>();
  for (const entry of groups) {
    const group = entry as StoredGroup;
    const date =
      typeof group?.installationDate === 'string' ? group.installationDate : null;
    if (!Array.isArray(group?.jobIds)) continue;
    for (const id of group.jobIds) {
      if (typeof id === 'string') byJob.set(id, date);
    }
  }
  return byJob;
}

// Bring the stored status up to date with where the job actually stands: one
// that has reached Complete Installation reads Complete, whatever it was last
// set to. Returned to the caller and written back to the column, so the
// database and the dashboard agree rather than the page having to re-derive it
// on every render.
//
// The only two values it can ever write. resolvedAvailabilityStatus returns
// the job's existing status untouched in every other case, so a job can be
// moved to Complete or held at Pending Complete and nothing else — it cannot
// invent a date, clear a status, or overrule a Reschedule.
//
// The comparison is against the already-normalised status, not the raw column,
// so a row still holding a legacy value is left alone unless the rule actually
// changes where the job stands. Translating those is a read-time concern (see
// normalizeAvailabilityStatus); this is only for drift the rule itself causes.
function applyResolvedStatus(
  jobs: InstallationJob[],
  groupDates: Map<string, string | null>,
  todayIso: string,
): { jobs: InstallationJob[]; corrected: Map<string, string[]> } {
  const corrected = new Map<string, string[]>();
  const resolved = jobs.map((job) => {
    const group = { installationDate: groupDates.get(job.id) ?? null };
    const status = resolvedAvailabilityStatus(job, todayIso, group);
    if (status === job.customerAvailabilityStatus) return job;
    corrected.set(status, [...(corrected.get(status) ?? []), job.id]);
    return { ...job, customerAvailabilityStatus: status };
  });
  return { jobs: resolved, corrected };
}

// Stamps each invoice with the day this app first saw its SEDA status read
// Approved, and hands the recorded dates back. The source keeps no approval
// date, so this is the only way Customer Scheduling can say how long someone
// has been cleared.
//
// The very first run finds hundreds of invoices approved at some unknown point
// in the past. Dating them all to that first day would make them look newly
// ready and bury them under genuinely new customers, so they are recorded with
// no date instead and read as "approved before recording began".
async function recordSedaApprovals(
  jobs: InstallationJob[],
  todayIso: string,
): Promise<Map<string, string | null>> {
  const rows = await queryProxy<{
    source_invoice_id: string;
    approved_on: string | null;
  }>(
    'select source_invoice_id, approved_on from public.installation_seda_approvals',
  );
  const recorded = new Map(
    rows.map((row) => [row.source_invoice_id, toDateOnly(row.approved_on)]),
  );
  const firstRun = rows.length === 0;
  const newlyApproved = jobs
    .filter((job) => isSedaApproved(job.sedaStatus) && !recorded.has(job.id))
    .map((job) => job.id);
  if (newlyApproved.length > 0) {
    const approvedOn = firstRun ? null : todayIso;
    await queryProxy(
      'insert into public.installation_seda_approvals (source_invoice_id, approved_on) ' +
        'select id, $2::date from unnest($1::text[]) as id ' +
        'on conflict (source_invoice_id) do nothing',
      [newlyApproved, approvedOn],
    );
    newlyApproved.forEach((id) => recorded.set(id, approvedOn));
  }
  return recorded;
}

async function loadJobsPayload() {
  let source: 'live' | 'demo' = 'live';
  let warning: string | null = null;
  let jobs: InstallationJob[];

  // The source query and the schema check talk to two different databases and
  // neither needs the other's answer, so they are started together rather than
  // one after the other. Each is still awaited inside the block that owns its
  // failure mode, so the fallbacks below are unchanged.
  const sourcePromise = fetchEligibleSourceJobs();
  const supportTicketPromise = fetchActiveSupportTicketJobs().catch((err) => {
    console.error('Failed to fetch support tickets:', err);
    return [] as InstallationJob[];
  });
  const schemaPromise = ensureInstallationSchema();
  // schemaPromise is not awaited until the second block, and a rejection with
  // nothing attached in the meantime is an unhandled rejection — fatal on
  // Node's default in recent versions. This observes it without swallowing it:
  // the await below still sees the same rejected promise and still throws.
  schemaPromise.catch(() => {});

  try {
    const [result, supportJobs] = await Promise.all([
      sourcePromise,
      supportTicketPromise,
    ]);
    jobs = [...result.jobs, ...supportJobs];
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
    await schemaPromise;
    // Two independent reads against the same database, previously sequential.
    // readOpsState calls ensureInstallationSchema itself, but that is memoised
    // and already resolved by this point, so it costs nothing here.
    const [operationalRows, { state }] = await Promise.all([
      readOperationalRows(jobs.map((job) => job.id)),
      readOpsState(),
    ]);
    const merged = mergeOperations(jobs, operationalRows);

    // Step one: fill in anything the table is missing that the browser-side
    // store holds. See lib/store-reconcile.ts — it only ever fills columns in,
    // never clears them, because the loss between the two stores runs one way.
    const patches = planStoreReconciliation(merged, state.jobUpdates);
    if (patches.length > 0) {
      const payload = JSON.stringify(patches);
      try {
        // Create-then-fill: the insert only adds rows that were missing, the
        // update only touches columns the patch actually carries.
        await queryProxy(RECONCILE_INSERT_SQL, [payload]);
        await queryProxy(RECONCILE_UPDATE_SQL, [payload]);
      } catch {
        // Same reasoning as the status write below: the response is already
        // correct, so a failed write costs a retry rather than a wrong answer.
      }
    }

    // Step two: resolve the status, now that the dates it reads are whole.
    const { jobs: resolved, corrected } = applyResolvedStatus(
      applyStoreReconciliation(merged, patches),
      groupDatesByJobId(state.groups),
      malaysiaToday(),
    );
    // Written back rather than only returned: a job goes Complete by its date
    // passing, which happens with nobody at a keyboard, so nothing else would
    // ever record it. One statement, only the rows that drifted, and it
    // settles to a no-op once they are all in step.
    for (const [status, ids] of corrected) {
      try {
        await queryProxy(
          'update public.installation_jobs set customer_availability_status = $1 ' +
            'where source_invoice_id = any($2::text[])',
          [status, ids],
        );
      } catch {
        // A failed write is not worth failing the read over: the response
        // already carries the corrected status, so the dashboard is right
        // either way and the next load tries again.
      }
    }

    // And the same status into the other store. Without this the table moves
    // to Complete while jobUpdates keeps whatever it was last saved with, and
    // the two disagree for good — the client re-derives the status on load, so
    // nothing on screen would ever reveal the divergence.
    //
    // The stored entry is spread rather than replaced: jsonb merges jobUpdates
    // per job id but swaps each id's object wholesale, so sending the one field
    // on its own would drop everything else saved against that job.
    // Driven by the resolved jobs rather than by what changed on this load:
    // a job the table settled days ago still has a stale copy sitting in
    // jobUpdates, and keying off this load's corrections would never reach it.
    // Comparing the raw stored string also retires the legacy values still in
    // there — an "available" becomes the "propose" it already reads as.
    const statusPatch: Record<string, unknown> = {};
    for (const job of resolved) {
      const stored = state.jobUpdates[job.id] as
        | Record<string, unknown>
        | undefined;
      if (!stored) continue;
      if (stored.customerAvailabilityStatus === job.customerAvailabilityStatus) {
        continue;
      }
      statusPatch[job.id] = {
        ...stored,
        customerAvailabilityStatus: job.customerAvailabilityStatus,
      };
    }
    if (Object.keys(statusPatch).length > 0) {
      try {
        await writeOpsState({
          jobUpdates: statusPatch,
        } as Parameters<typeof writeOpsState>[0]);
      } catch {
        // As above.
      }
    }

    // Demo jobs are made up, so recording their approval would put invented
    // invoices into the real table.
    let withApprovals = resolved;
    if (source === 'live') {
      try {
        const approvals = await recordSedaApprovals(resolved, malaysiaToday());
        withApprovals = resolved.map((job) =>
          approvals.has(job.id)
            ? { ...job, sedaApprovedDate: approvals.get(job.id) ?? null }
            : job,
        );
      } catch {
        // The dates are a nicety on top of the pipeline, not part of it: a
        // failed read or write leaves them blank for this load only.
      }
    }

    return {
      jobs: withApprovals,
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
