import { queryProxy } from '@/lib/proxy-db';

const INSTALLATION_SCHEMA_SQL = [
  'create table if not exists public.installation_jobs (',
  '  id text primary key,',
  '  source_invoice_id text not null unique,',
  '  invoice_number text not null,',
  '  customer_name text not null,',
  '  installation_date date,',
  "  customer_availability_status text not null default 'pending',",
  '  preferred_installation_date date,',
  "  availability_remarks text not null default '',",
  "  installation_approval_status text not null default 'pending_approval_date',",
  "  schedule_status text not null default 'ready_to_schedule',",
  "  delivery_status text not null default 'not_planned',",
  '  delivery_date date,',
  '  arrival_date date,',
  "  stock_details text not null default '',",
  "  delivery_contact_number text not null default '',",
  "  warehouse_location text not null default '',",
  "  panel_details text not null default '',",
  "  wiring_details text not null default '',",
  "  battery_details text not null default '',",
  "  remarks text not null default '',",
  "  payment_override_status text not null default 'none',",
  "  payment_override_reason text not null default '',",
  '  created_at timestamptz not null default now(),',
  '  updated_at timestamptz not null default now()',
  ');',
  '',
  'create table if not exists public.job_team_assignments (',
  '  id text primary key,',
  '  installation_job_id text not null references public.installation_jobs(id) on delete cascade,',
  '  role text not null,',
  '  team_name text not null,',
  '  contact text,',
  "  activity text not null default 'pv_panels',",
  '  custom_activity text,',
  '  created_at timestamptz not null default now()',
  ');',
  '',
  'create table if not exists public.job_status_history (',
  '  id bigint generated always as identity primary key,',
  '  installation_job_id text not null references public.installation_jobs(id) on delete cascade,',
  '  event_type text not null,',
  "  event_data jsonb not null default '{}'::jsonb,",
  '  created_at timestamptz not null default now()',
  ');',
].join('\n');

let schemaReady: Promise<void> | null = null;

export async function ensureInstallationSchema() {
  if (!schemaReady) {
    schemaReady = queryProxy(INSTALLATION_SCHEMA_SQL).then(() => undefined);
  }
  await schemaReady;
}
