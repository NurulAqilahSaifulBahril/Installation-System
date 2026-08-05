-- Run this once in the Supabase SQL editor for the installation project.

create extension if not exists pgcrypto;

create type public.installation_schedule_status as enum (
  'ready_to_schedule',
  'pending_approval',
  'pending_installation',
  'ready_to_install',
  'installed',
  'reschedule_required'
);

create type public.installation_delivery_status as enum (
  'not_planned',
  'pending_stock',
  'delivery_scheduled',
  'delivered',
  'partially_delivered'
);

create type public.installation_team_role as enum (
  'roof',
  'wiring',
  'battery_inverter',
  'supervisor'
);

create table public.installation_jobs (
  id uuid primary key default gen_random_uuid(),
  source_invoice_id text not null unique,
  invoice_number text not null,
  customer_name text not null,
  installation_date date,
  customer_availability_status text not null default 'pending',
  preferred_installation_date date,
  availability_remarks text not null default '',
  installation_approval_status text not null default 'pending_approval_date',
  schedule_status public.installation_schedule_status not null default 'ready_to_schedule',
  delivery_status public.installation_delivery_status not null default 'not_planned',
  delivery_date date,
  arrival_date date,
  stock_details text not null default '',
  delivery_contact_number text not null default '',
  warehouse_location text not null default '',
  panel_details text not null default '',
  wiring_details text not null default '',
  battery_details text not null default '',
  remarks text not null default '',
  payment_override_status text not null default 'none',
  payment_override_reason text not null default '',
  payment_override_approved_by uuid,
  payment_override_approved_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.job_team_assignments (
  id uuid primary key default gen_random_uuid(),
  installation_job_id uuid not null references public.installation_jobs(id) on delete cascade,
  role public.installation_team_role not null,
  team_name text not null,
  contact text,
  activity text not null default 'pv_panels',
  custom_activity text,
  attendance_date date,
  remarks text not null default '',
  created_at timestamptz not null default now()
);

create table public.job_status_history (
  id bigint generated always as identity primary key,
  installation_job_id uuid not null references public.installation_jobs(id) on delete cascade,
  event_type text not null,
  event_data jsonb not null default '{}'::jsonb,
  changed_by uuid,
  created_at timestamptz not null default now()
);

create table public.delivery_items (
  id uuid primary key default gen_random_uuid(),
  installation_job_id uuid not null references public.installation_jobs(id) on delete cascade,
  material_name text not null,
  quantity_required numeric not null default 1,
  quantity_delivered numeric not null default 0,
  stock_status text not null default 'pending_stock',
  remarks text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index installation_jobs_schedule_idx
  on public.installation_jobs(schedule_status, installation_date);

create index installation_jobs_delivery_idx
  on public.installation_jobs(delivery_status, delivery_date);

create index job_team_assignments_job_idx
  on public.job_team_assignments(installation_job_id);

alter table public.installation_jobs enable row level security;
alter table public.job_team_assignments enable row level security;
alter table public.job_status_history enable row level security;
alter table public.delivery_items enable row level security;

-- The localhost server uses the service-role key. Add authenticated-user
-- policies here before exposing direct browser access to Supabase.
