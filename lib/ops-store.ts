import { ensureInstallationSchema } from '@/lib/installation-schema';
import { queryProxy } from '@/lib/proxy-db';

export type OpsState = {
  groups: unknown[];
  deliveryRuns: unknown[];
  warehouses: unknown[];
  teamResources: unknown[];
  teamWeekAssignments: unknown[];
  jobUpdates: Record<string, unknown>;
  // Job ids frozen off the active pipeline. Shared like the lists above (the
  // client owns and replaces the whole set) rather than per-device like a
  // pin, because freezing is a decision about the row itself, not about one
  // person's view of it.
  frozenJobIds: string[];
  // The installation manager's roof/site difficulty per job id. Merged per job
  // like jobUpdates (see MERGE_STATE_SQL), so two people rating different
  // customers at once do not overwrite each other.
  siteAssessments: Record<string, unknown>;
  // Customer Scheduling's draft: the placements and removals people have made
  // by hand on top of the automatic suggestion. The client owns and replaces
  // the whole object, like the lists above.
  scheduleDraft: Record<string, unknown>;
};

export const EMPTY_OPS_STATE: OpsState = {
  groups: [],
  deliveryRuns: [],
  warehouses: [],
  teamResources: [],
  teamWeekAssignments: [],
  jobUpdates: {},
  frozenJobIds: [],
  siteAssessments: {},
  scheduleDraft: {},
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
// it out keeps whatever is already stored. siteAssessments is keyed by job id
// the same way and merged the same way.
const MERGE_STATE_SQL = [
  'insert into public.installation_ops_state (id, state) values ($1, $2::jsonb)',
  'on conflict (id) do update set',
  '  state = (public.installation_ops_state.state || excluded.state)',
  "    || jsonb_build_object('jobUpdates',",
  "      coalesce(public.installation_ops_state.state->'jobUpdates', '{}'::jsonb)",
  "      || coalesce(excluded.state->'jobUpdates', '{}'::jsonb)",
  "    , 'siteAssessments',",
  "      coalesce(public.installation_ops_state.state->'siteAssessments', '{}'::jsonb)",
  "      || coalesce(excluded.state->'siteAssessments', '{}'::jsonb)",
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
