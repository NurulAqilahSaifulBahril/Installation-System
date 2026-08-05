import { NextResponse } from 'next/server';
import { demoJobs } from '@/lib/demo-data';
import { ensureInstallationSchema } from '@/lib/installation-schema';
import { queryProxy } from '@/lib/proxy-db';
import { fetchEligibleSourceJobs } from '@/lib/source-api';
import type { InstallationJob } from '@/lib/types';

export const dynamic = 'force-dynamic';

type OperationalRow = {
  source_invoice_id: string;
  installation_date: string | null;
  customer_availability_status: InstallationJob['customerAvailabilityStatus'] | null;
  preferred_installation_date: string | null;
  availability_remarks: string | null;
  schedule_status: InstallationJob['scheduleStatus'];
  installation_approval_status: InstallationJob['installationApprovalStatus'];
  delivery_status: InstallationJob['deliveryStatus'];
  delivery_date: string | null;
  arrival_date: string | null;
  stock_details: string | null;
  delivery_contact_number: string | null;
  warehouse_location: string | null;
  panel_details: string | null;
  wiring_details: string | null;
  battery_details: string | null;
  payment_override_status: InstallationJob['paymentOverrideStatus'] | null;
  payment_override_reason: string | null;
  remarks: string | null;
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
      installationDate: operation.installation_date,
      customerAvailabilityStatus:
        operation.customer_availability_status ?? 'pending',
      preferredInstallationDate: operation.preferred_installation_date,
      availabilityRemarks: operation.availability_remarks ?? '',
      scheduleStatus: operation.schedule_status,
      installationApprovalStatus: operation.installation_approval_status,
      deliveryStatus: operation.delivery_status,
      deliveryDate: operation.delivery_date,
      arrivalDate: operation.arrival_date,
      stockDetails: operation.stock_details ?? '',
      deliveryContactNumber:
        operation.delivery_contact_number ?? job.customerPhone,
      warehouseLocation: operation.warehouse_location ?? '',
      panelDetails: operation.panel_details ?? job.panelDetails,
      wiringDetails: operation.wiring_details ?? '',
      batteryDetails: operation.battery_details ?? job.battery,
      paymentOverrideStatus: operation.payment_override_status ?? 'none',
      paymentOverrideReason: operation.payment_override_reason ?? '',
      remarks: operation.remarks ?? '',
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
        '  availability_remarks,',
        '  schedule_status,',
        '  installation_approval_status,',
        '  delivery_status,',
        '  delivery_date,',
        '  arrival_date,',
        '  stock_details,',
        '  delivery_contact_number,',
        '  warehouse_location,',
        '  panel_details,',
        '  wiring_details,',
        '  battery_details,',
        '  payment_override_status,',
        '  payment_override_reason,',
        '  remarks',
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

export async function GET() {
  let source: 'live' | 'demo' = 'live';
  let warning: string | null = null;
  let jobs: InstallationJob[];

  try {
    jobs = await fetchEligibleSourceJobs();
  } catch (error) {
    source = 'demo';
    warning =
      error instanceof Error
        ? 'Live source unavailable: ' + error.message
        : 'Live source unavailable.';
    jobs = demoJobs;
  }

  try {
    await ensureInstallationSchema();
    const merged = mergeOperations(jobs, await readOperationalRows(jobs.map((job) => job.id)));
    return NextResponse.json({
      jobs: merged,
      source,
      persistence: 'api-db',
      warning,
      syncedAt: new Date().toISOString(),
    });
  } catch (error) {
    const sharedWarning =
      error instanceof Error
        ? 'API database unavailable: ' + error.message
        : 'API database unavailable.';
    return NextResponse.json({
      jobs,
      source,
      persistence: 'browser',
      warning: warning ? warning + ' ' + sharedWarning : sharedWarning,
      syncedAt: new Date().toISOString(),
    });
  }
}
