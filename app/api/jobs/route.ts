import { NextResponse } from "next/server";
import { demoJobs } from "@/lib/demo-data";
import { fetchEligibleSourceJobs } from "@/lib/source-api";
import { getSupabaseAdmin } from "@/lib/supabase-admin";
import type { InstallationJob } from "@/lib/types";

export const dynamic = "force-dynamic";

type OperationalRow = {
  source_invoice_id: string;
  installation_date: string | null;
  customer_availability_status: InstallationJob["customerAvailabilityStatus"];
  preferred_installation_date: string | null;
  availability_remarks: string | null;
  schedule_status: InstallationJob["scheduleStatus"];
  installation_approval_status: InstallationJob["installationApprovalStatus"];
  delivery_status: InstallationJob["deliveryStatus"];
  delivery_date: string | null;
  arrival_date: string | null;
  stock_details: string | null;
  delivery_contact_number: string | null;
  warehouse_location: string | null;
  panel_details: string | null;
  wiring_details: string | null;
  battery_details: string | null;
  payment_override_status: InstallationJob["paymentOverrideStatus"] | null;
  payment_override_reason: string | null;
  remarks: string | null;
  job_team_assignments:
    | {
        id: string;
        role: "roof" | "wiring" | "battery_inverter" | "supervisor";
        team_name: string;
        contact: string | null;
        activity:
          | "hooks_rails"
          | "pv_panels"
          | "cable_trunking"
          | "earthing"
          | "other";
        custom_activity: string | null;
      }[]
    | null;
};

function mergeOperations(
  jobs: InstallationJob[],
  operations: OperationalRow[],
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
        operation.customer_availability_status ?? "pending",
      preferredInstallationDate: operation.preferred_installation_date,
      availabilityRemarks: operation.availability_remarks ?? "",
      scheduleStatus: operation.schedule_status,
      installationApprovalStatus: operation.installation_approval_status,
      deliveryStatus: operation.delivery_status,
      deliveryDate: operation.delivery_date,
      arrivalDate: operation.arrival_date,
      stockDetails: operation.stock_details ?? "",
      deliveryContactNumber:
        operation.delivery_contact_number ?? job.customerPhone,
      warehouseLocation: operation.warehouse_location ?? "",
      panelDetails: operation.panel_details ?? job.panelDetails,
      wiringDetails: operation.wiring_details ?? "",
      batteryDetails: operation.battery_details ?? job.battery,
      paymentOverrideStatus: operation.payment_override_status ?? "none",
      paymentOverrideReason: operation.payment_override_reason ?? "",
      remarks: operation.remarks ?? "",
      teams: (operation.job_team_assignments ?? []).map((team) => ({
        id: team.id,
        role: team.role,
        teamName: team.team_name,
        contact: team.contact ?? undefined,
        activity: team.activity ?? "pv_panels",
        customActivity: team.custom_activity ?? undefined,
      })),
    };
  });
}

export async function GET() {
  let source: "live" | "demo" = "live";
  let warning: string | null = null;
  let jobs: InstallationJob[];

  try {
    jobs = await fetchEligibleSourceJobs();
  } catch (error) {
    source = "demo";
    warning =
      error instanceof Error
        ? `Live source unavailable: ${error.message}`
        : "Live source unavailable.";
    jobs = demoJobs;
  }

  const supabase = getSupabaseAdmin();
  if (!supabase) {
    return NextResponse.json({
      jobs,
      source,
      persistence: "browser",
      warning:
        warning ||
        "Supabase service role key is not configured. Operational changes are stored in this browser.",
      syncedAt: new Date().toISOString(),
    });
  }

  const sourceIds = jobs.map((job) => job.id);
  const { data, error } = await supabase
    .from("installation_jobs")
    .select(
      "source_invoice_id, installation_date, customer_availability_status, preferred_installation_date, availability_remarks, installation_approval_status, schedule_status, delivery_status, delivery_date, arrival_date, stock_details, delivery_contact_number, warehouse_location, panel_details, wiring_details, battery_details, payment_override_status, payment_override_reason, remarks, job_team_assignments(id, role, team_name, contact, activity, custom_activity)",
    )
    .in("source_invoice_id", sourceIds);

  if (error) {
    warning = `Supabase read failed: ${error.message}`;
  } else {
    jobs = mergeOperations(jobs, (data ?? []) as OperationalRow[]);
  }

  return NextResponse.json({
    jobs,
    source,
    persistence: error ? "browser" : "supabase",
    warning,
    syncedAt: new Date().toISOString(),
  });
}
