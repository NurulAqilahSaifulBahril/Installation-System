import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getSupabaseAdmin } from "@/lib/supabase-admin";

const updateSchema = z.object({
  invoiceNumber: z.string().min(1),
  customerName: z.string().min(1),
  installationDate: z.string().nullable(),
  customerAvailabilityStatus: z.enum([
    "pending",
    "available",
    "unavailable",
  ]),
  preferredInstallationDate: z.string().nullable(),
  availabilityRemarks: z.string(),
  scheduleStatus: z.enum([
    "ready_to_schedule",
    "pending_approval",
    "pending_installation",
    "ready_to_install",
    "installed",
    "reschedule_required",
  ]),
  installationApprovalStatus: z.enum([
    "date_approved",
    "pending_approval_date",
    "pending_seda_approval",
    "other",
  ]),
  deliveryStatus: z.enum([
    "not_planned",
    "pending_stock",
    "delivery_scheduled",
    "delivered",
    "partially_delivered",
  ]),
  deliveryDate: z.string().nullable(),
  arrivalDate: z.string().nullable(),
  stockDetails: z.string(),
  deliveryContactNumber: z.string(),
  warehouseLocation: z.string(),
  panelDetails: z.string(),
  wiringDetails: z.string(),
  batteryDetails: z.string(),
  paymentOverrideStatus: z.enum(["none", "pending", "approved", "rejected"]),
  paymentOverrideReason: z.string(),
  remarks: z.string(),
  teams: z.array(
    z.object({
      id: z.string(),
      role: z.enum(["roof", "wiring", "battery_inverter", "supervisor"]),
      teamName: z.string().min(1),
      contact: z.string().optional(),
      activity: z.enum([
        "hooks_rails",
        "pv_panels",
        "cable_trunking",
        "earthing",
        "other",
      ]),
      customActivity: z.string().optional(),
    }),
  ),
});

export async function PUT(
  request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  const { id } = await context.params;
  const parsed = updateSchema.safeParse(await request.json());

  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid update.", details: parsed.error.flatten() },
      { status: 400 },
    );
  }

  const supabase = getSupabaseAdmin();
  if (!supabase) {
    return NextResponse.json(
      {
        error:
          "Supabase persistence is not configured. The dashboard will keep this change in the browser only.",
      },
      { status: 503 },
    );
  }

  const payload = parsed.data;
  const { data: job, error } = await supabase
    .from("installation_jobs")
    .upsert(
      {
        source_invoice_id: id,
        invoice_number: payload.invoiceNumber,
        customer_name: payload.customerName,
        installation_date: payload.installationDate,
        customer_availability_status: payload.customerAvailabilityStatus,
        preferred_installation_date: payload.preferredInstallationDate,
        availability_remarks: payload.availabilityRemarks,
        installation_approval_status: payload.installationApprovalStatus,
        schedule_status: payload.scheduleStatus,
        delivery_status: payload.deliveryStatus,
        delivery_date: payload.deliveryDate,
        arrival_date: payload.arrivalDate,
        stock_details: payload.stockDetails,
        delivery_contact_number: payload.deliveryContactNumber,
        warehouse_location: payload.warehouseLocation,
        panel_details: payload.panelDetails,
        wiring_details: payload.wiringDetails,
        battery_details: payload.batteryDetails,
        payment_override_status: payload.paymentOverrideStatus,
        payment_override_reason: payload.paymentOverrideReason,
        remarks: payload.remarks,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "source_invoice_id" },
    )
    .select("id")
    .single();

  if (error || !job) {
    return NextResponse.json(
      { error: error?.message || "Could not save installation job." },
      { status: 500 },
    );
  }

  const { error: deleteError } = await supabase
    .from("job_team_assignments")
    .delete()
    .eq("installation_job_id", job.id);

  if (deleteError) {
    return NextResponse.json({ error: deleteError.message }, { status: 500 });
  }

  if (payload.teams.length > 0) {
    const { error: teamError } = await supabase
      .from("job_team_assignments")
      .insert(
        payload.teams.map((team) => ({
          installation_job_id: job.id,
          role: team.role,
          team_name: team.teamName,
          contact: team.contact || null,
          activity: team.activity,
          custom_activity: team.customActivity || null,
        })),
      );

    if (teamError) {
      return NextResponse.json({ error: teamError.message }, { status: 500 });
    }
  }

  await supabase.from("job_status_history").insert({
    installation_job_id: job.id,
    event_type: "job_updated",
    event_data: payload,
  });

  return NextResponse.json({ ok: true });
}
