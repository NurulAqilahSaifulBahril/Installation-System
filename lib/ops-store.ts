import { ensureInstallationSchema } from '@/lib/installation-schema';
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
  await ensureInstallationSchema();
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

// `||` on jsonb merges one level deep, which is right for the list keys (the
// client owns the whole list) but wrong for jobUpdates: there, a client sending
// the one job it just edited would replace every other job's saved update. So
// jobUpdates is merged a second level down, per job id, and a patch that leaves
// it out keeps whatever is already stored.
const MERGE_STATE_SQL = [
  'insert into public.installation_ops_state (id, state) values ($1, $2::jsonb)',
  'on conflict (id) do update set',
  '  state = (public.installation_ops_state.state || excluded.state)',
  "    || jsonb_build_object('jobUpdates',",
  "      coalesce(public.installation_ops_state.state->'jobUpdates', '{}'::jsonb)",
  "      || coalesce(excluded.state->'jobUpdates', '{}'::jsonb)",
  '    ),',
  '  updated_at = now()',
  'returning state',
].join('\n');

export async function writeOpsState(patch: Partial<OpsState>): Promise<OpsState> {
  await ensureInstallationSchema();
  const rows = await queryProxy<{ state: unknown }>(MERGE_STATE_SQL, [
    STATE_ROW_ID,
    JSON.stringify(patch),
  ]);
  const state = normalizeState(rows[0]?.state) ?? {};
  return {
    ...EMPTY_OPS_STATE,
    ...state,
  } as OpsState;
}
