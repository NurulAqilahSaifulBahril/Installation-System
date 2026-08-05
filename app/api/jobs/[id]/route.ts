import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { ensureInstallationSchema } from '@/lib/installation-schema';
import { queryProxy } from '@/lib/proxy-db';

const updateSchema = z.object({
  invoiceNumber: z.string().min(1),
  customerName: z.string().min(1),
  installationDate: z.string().nullable(),
  customerAvailabilityStatus: z.enum([
    'pending',
    'available',
    'unavailable',
  ]),
  preferredInstallationDate: z.string().nullable(),
  availabilityRemarks: z.string(),
  scheduleStatus: z.enum([
    'ready_to_schedule',
    'pending_approval',
    'pending_installation',
    'ready_to_install',
    'installed',
    'reschedule_required',
  ]),
  installationApprovalStatus: z.enum([
    'date_approved',
    'pending_approval_date',
    'pending_seda_approval',
    'other',
  ]),
  deliveryStatus: z.enum([
    'not_planned',
    'pending_stock',
    'delivery_scheduled',
    'delivered',
    'partially_delivered',
  ]),
  deliveryDate: z.string().nullable(),
  arrivalDate: z.string().nullable(),
  stockDetails: z.string(),
  deliveryContactNumber: z.string(),
  warehouseLocation: z.string(),
  panelDetails: z.string(),
  wiringDetails: z.string(),
  batteryDetails: z.string(),
  paymentOverrideStatus: z.enum(['none', 'pending', 'approved', 'rejected']),
  paymentOverrideReason: z.string(),
  remarks: z.string(),
  teams: z.array(
    z.object({
      id: z.string(),
      role: z.enum(['roof', 'wiring', 'battery_inverter', 'supervisor']),
      teamName: z.string().min(1),
      contact: z.string().optional(),
      activity: z.enum([
        'hooks_rails',
        'pv_panels',
        'cable_trunking',
        'earthing',
        'other',
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
      { error: 'Invalid update.', details: parsed.error.flatten() },
      { status: 400 },
    );
  }

  try {
    await ensureInstallationSchema();
    const payload = parsed.data;
    const jobRows = await queryProxy<{ id: string }>(
      [
        'insert into public.installation_jobs (',
        '  id,',
        '  source_invoice_id,',
        '  invoice_number,',
        '  customer_name,',
        '  installation_date,',
        '  customer_availability_status,',
        '  preferred_installation_date,',
        '  availability_remarks,',
        '  installation_approval_status,',
        '  schedule_status,',
        '  delivery_status,',
        '  delivery_date,',
        '  arrival_date,',
        '  stock_details,',
        '  delivery_contact_number,',
        '  warehouse_location,',
        '  panel_details,',
        '  wiring_details,',
        '  battery_details,',
        '  remarks,',
        '  payment_override_status,',
        '  payment_override_reason,',
        '  updated_at',
        ') values (',
        '  $1,',
        '  $1,',
        '  $2,',
        '  $3,',
        '  $4,',
        '  $5,',
        '  $6,',
        '  $7,',
        '  $8,',
        '  $9,',
        '  $10,',
        '  $11,',
        '  $12,',
        '  $13,',
        '  $14,',
        '  $15,',
        '  $16,',
        '  $17,',
        '  $18,',
        '  $19,',
        '  $20,',
        '  $21,',
        '  now()',
        ') on conflict (source_invoice_id) do update set',
        '  invoice_number = excluded.invoice_number,',
        '  customer_name = excluded.customer_name,',
        '  installation_date = excluded.installation_date,',
        '  customer_availability_status = excluded.customer_availability_status,',
        '  preferred_installation_date = excluded.preferred_installation_date,',
        '  availability_remarks = excluded.availability_remarks,',
        '  installation_approval_status = excluded.installation_approval_status,',
        '  schedule_status = excluded.schedule_status,',
        '  delivery_status = excluded.delivery_status,',
        '  delivery_date = excluded.delivery_date,',
        '  arrival_date = excluded.arrival_date,',
        '  stock_details = excluded.stock_details,',
        '  delivery_contact_number = excluded.delivery_contact_number,',
        '  warehouse_location = excluded.warehouse_location,',
        '  panel_details = excluded.panel_details,',
        '  wiring_details = excluded.wiring_details,',
        '  battery_details = excluded.battery_details,',
        '  remarks = excluded.remarks,',
        '  payment_override_status = excluded.payment_override_status,',
        '  payment_override_reason = excluded.payment_override_reason,',
        '  updated_at = now()',
        'returning id',
      ].join('\n'),
      [
        id,
        payload.invoiceNumber,
        payload.customerName,
        payload.installationDate,
        payload.customerAvailabilityStatus,
        payload.preferredInstallationDate,
        payload.availabilityRemarks,
        payload.installationApprovalStatus,
        payload.scheduleStatus,
        payload.deliveryStatus,
        payload.deliveryDate,
        payload.arrivalDate,
        payload.stockDetails,
        payload.deliveryContactNumber,
        payload.warehouseLocation,
        payload.panelDetails,
        payload.wiringDetails,
        payload.batteryDetails,
        payload.remarks,
        payload.paymentOverrideStatus,
        payload.paymentOverrideReason,
      ],
    );

    const job = jobRows[0];
    if (!job) {
      throw new Error('Could not save installation job.');
    }

    await queryProxy(
      'delete from public.job_team_assignments where installation_job_id = $1',
      [job.id],
    );

    if (payload.teams.length > 0) {
      await queryProxy(
        [
          'insert into public.job_team_assignments (',
          '  id,',
          '  installation_job_id,',
          '  role,',
          '  team_name,',
          '  contact,',
          '  activity,',
          '  custom_activity',
          ')',
          'select',
          '  t.id,',
          '  $1,',
          '  t.role,',
          '  t.team_name,',
          '  t.contact,',
          '  t.activity,',
          '  t.custom_activity',
          'from jsonb_to_recordset($2::jsonb) as t(',
          '  id text,',
          '  role text,',
          '  team_name text,',
          '  contact text,',
          '  activity text,',
          '  custom_activity text',
          ')',
        ].join('\n'),
        [job.id, JSON.stringify(payload.teams)],
      );
    }

    await queryProxy(
      [
        'insert into public.job_status_history (',
        '  installation_job_id,',
        '  event_type,',
        '  event_data',
        ') values (',
        '  $1,',
        '  $2,',
        '  $3::jsonb',
        ')',
      ].join('\n'),
      [job.id, 'job_updated', JSON.stringify(payload)],
    );

    return NextResponse.json({ ok: true });
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : 'Could not save installation job.',
      },
      { status: 500 },
    );
  }
}
