import { queryProxy } from '@/lib/proxy-db';

export type OpsState = {
  groups: unknown[];
  deliveryRuns: unknown[];
  teamResources: unknown[];
  teamWeekAssignments: unknown[];
  jobUpdates: Record<string, unknown>;
};

export const EMPTY_OPS_STATE: OpsState = {
  groups: [],
  deliveryRuns: [],
  teamResources: [],
  teamWeekAssignments: [],
  jobUpdates: {},
};

const STATE_ROW_ID = 'default';
let schemaReady: Promise<void> | null = null;

async function ensureSchema() {
  if (!schemaReady) {
    schemaReady = queryProxy(
      [
        'create table if not exists public.installation_ops_state (',
        '  id text primary key,',
        "  state jsonb not null default '{}'::jsonb,",
        '  updated_at timestamptz not null default now()',
        ');',
      ].join('\n'),
    ).then(() => undefined);
  }
  await schemaReady;
}

function normalizeState(value: unknown): Record<string, unknown> | null {
  if (!value) return null;
  if (typeof value === 'string') {
    return JSON.parse(value) as Record<string, unknown>;
  }
  if (typeof value === 'object') {
    return value as Record<string, unknown>;
  }
  return null;
}

export async function readOpsState(): Promise<{
  exists: boolean;
  state: OpsState;
}> {
  await ensureSchema();
  const rows = await queryProxy<{ state: unknown }>(
    'select state from public.installation_ops_state where id = $1 limit 1',
    [STATE_ROW_ID],
  );
  const state = normalizeState(rows[0]?.state);
  return {
    exists: Boolean(state),
    state: {
      ...EMPTY_OPS_STATE,
      ...(state ?? {}),
    } as OpsState,
  };
}

export async function writeOpsState(patch: Partial<OpsState>): Promise<OpsState> {
  await ensureSchema();
  const rows = await queryProxy<{ state: unknown }>(
    [
      'insert into public.installation_ops_state (id, state) values ($1, $2::jsonb)',
      'on conflict (id) do update set',
      '  state = public.installation_ops_state.state || excluded.state,',
      '  updated_at = now()',
      'returning state',
    ].join('\n'),
    [STATE_ROW_ID, JSON.stringify(patch)],
  );
  const state = normalizeState(rows[0]?.state) ?? {};
  return {
    ...EMPTY_OPS_STATE,
    ...state,
  } as OpsState;
}
