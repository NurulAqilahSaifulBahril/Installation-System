import { queryProxy } from '@/lib/proxy-db';

// Schema setup has to be idempotent in both directions: safe on an empty
// database, and safe on one that already holds live data from an older build.
// "create table if not exists" alone only covers the first case — on a database
// where the table already exists it does nothing at all, so a column added in a
// later version never arrives and every insert referencing it fails.
//
// So each table is created with only the columns that cannot be added after the
// fact (keys and identities), and every other column is applied as its own
// "add column if not exists". To add a column in a future version, append one
// line here; do not edit the create statements, because those are inert on any
// database that already ran.
const MIGRATION_SQL = [
  'create table if not exists public.installation_jobs (',
  '  id text primary key,',
  '  source_invoice_id text not null unique',
  ');',
  '',
  "alter table public.installation_jobs add column if not exists invoice_number text not null default '';",
  "alter table public.installation_jobs add column if not exists customer_name text not null default '';",
  'alter table public.installation_jobs add column if not exists installation_date date;',
  "alter table public.installation_jobs add column if not exists customer_availability_status text not null default 'pending';",
  'alter table public.installation_jobs add column if not exists preferred_installation_date date;',
  'alter table public.installation_jobs add column if not exists second_preferred_installation_date date;',
  // text, not time: the app carries clocks as plain "HH:mm" strings everywhere
  // else, and a real time column round-trips through the proxy as a timestamp.
  "alter table public.installation_jobs add column if not exists preferred_installation_time text;",
  "alter table public.installation_jobs add column if not exists availability_remarks text not null default '';",
  "alter table public.installation_jobs add column if not exists installation_approval_status text not null default 'pending_approval_date';",
  "alter table public.installation_jobs add column if not exists schedule_status text not null default 'ready_to_schedule';",
  "alter table public.installation_jobs add column if not exists delivery_status text not null default 'not_planned';",
  'alter table public.installation_jobs add column if not exists delivery_date date;',
  'alter table public.installation_jobs add column if not exists arrival_date date;',
  'alter table public.installation_jobs add column if not exists arrival_time text;',
  "alter table public.installation_jobs add column if not exists stock_details text not null default '';",
  "alter table public.installation_jobs add column if not exists delivery_contact_number text not null default '';",
  "alter table public.installation_jobs add column if not exists warehouse_location text not null default '';",
  "alter table public.installation_jobs add column if not exists panel_details text not null default '';",
  "alter table public.installation_jobs add column if not exists wiring_details text not null default '';",
  "alter table public.installation_jobs add column if not exists battery_details text not null default '';",
  "alter table public.installation_jobs add column if not exists inverter_battery text not null default '';",
  "alter table public.installation_jobs add column if not exists power_output text not null default '';",
  "alter table public.installation_jobs add column if not exists remarks text not null default '';",
  "alter table public.installation_jobs add column if not exists installation_remarks text not null default '';",
  "alter table public.installation_jobs add column if not exists payment_override_status text not null default 'none';",
  "alter table public.installation_jobs add column if not exists payment_override_reason text not null default '';",
  'alter table public.installation_jobs add column if not exists created_at timestamptz not null default now();',
  'alter table public.installation_jobs add column if not exists updated_at timestamptz not null default now();',
  '',
  'create table if not exists public.job_team_assignments (',
  '  id text primary key,',
  '  installation_job_id text not null references public.installation_jobs(id) on delete cascade',
  ');',
  '',
  "alter table public.job_team_assignments add column if not exists role text not null default 'roof';",
  "alter table public.job_team_assignments add column if not exists team_name text not null default '';",
  'alter table public.job_team_assignments add column if not exists contact text;',
  "alter table public.job_team_assignments add column if not exists activity text not null default 'pv_panels';",
  'alter table public.job_team_assignments add column if not exists custom_activity text;',
  'alter table public.job_team_assignments add column if not exists created_at timestamptz not null default now();',
  '',
  'create table if not exists public.job_status_history (',
  '  id bigint generated always as identity primary key,',
  '  installation_job_id text not null references public.installation_jobs(id) on delete cascade',
  ');',
  '',
  "alter table public.job_status_history add column if not exists event_type text not null default 'job_updated';",
  "alter table public.job_status_history add column if not exists event_data jsonb not null default '{}'::jsonb;",
  'alter table public.job_status_history add column if not exists created_at timestamptz not null default now();',
  '',
  'create table if not exists public.installation_ops_state (',
  '  id text primary key',
  ');',
  '',
  "alter table public.installation_ops_state add column if not exists state jsonb not null default '{}'::jsonb;",
  'alter table public.installation_ops_state add column if not exists updated_at timestamptz not null default now();',
  '',
  'create table if not exists public.app_users (',
  '  id text primary key',
  ');',
  '',
  "alter table public.app_users add column if not exists username text not null default '';",
  'create unique index if not exists app_users_username_key on public.app_users (lower(username));',
  "alter table public.app_users add column if not exists display_name text not null default '';",
  "alter table public.app_users add column if not exists password_hash text not null default '';",
  "alter table public.app_users add column if not exists role text not null default 'staff';",
  'alter table public.app_users add column if not exists is_active boolean not null default true;',
  'alter table public.app_users add column if not exists created_at timestamptz not null default now();',
  'alter table public.app_users add column if not exists updated_at timestamptz not null default now();',
  '',
  'create table if not exists public.app_sessions (',
  '  id text primary key',
  ');',
  '',
  'alter table public.app_sessions add column if not exists user_id text references public.app_users(id) on delete cascade;',
  'alter table public.app_sessions add column if not exists created_at timestamptz not null default now();',
  'alter table public.app_sessions add column if not exists expires_at timestamptz not null default now();',
  'alter table public.app_sessions add column if not exists last_seen_at timestamptz not null default now();',
  '',
  // Named app_audit_log, not audit_log: this shared database already holds
  // an unrelated public.audit_log owned by another tool, and reusing that
  // name silently corrupted both (its id column has no identity, so our
  // inserts failed; our alters grew its schema).
  'create table if not exists public.app_audit_log (',
  '  id bigint generated always as identity primary key',
  ');',
  '',
  'alter table public.app_audit_log add column if not exists user_id text;',
  "alter table public.app_audit_log add column if not exists username text not null default 'unknown';",
  "alter table public.app_audit_log add column if not exists action text not null default '';",
  "alter table public.app_audit_log add column if not exists entity_type text not null default '';",
  'alter table public.app_audit_log add column if not exists entity_id text;',
  "alter table public.app_audit_log add column if not exists summary text not null default '';",
  "alter table public.app_audit_log add column if not exists details jsonb not null default '{}'::jsonb;",
  'alter table public.app_audit_log add column if not exists created_at timestamptz not null default now();',
  'create index if not exists app_audit_log_created_at_idx on public.app_audit_log (created_at desc);',
].join('\n');

let schemaReady: Promise<void> | null = null;

export async function ensureInstallationSchema() {
  // Clearing the cache on failure matters: a rejected promise left in place
  // would be re-awaited by every later request, so one blip while the database
  // was down would keep the app broken until it was restarted.
  if (!schemaReady) {
    schemaReady = queryProxy(MIGRATION_SQL)
      .then(() => undefined)
      .catch((error) => {
        schemaReady = null;
        throw error;
      });
  }

  await schemaReady;
}
