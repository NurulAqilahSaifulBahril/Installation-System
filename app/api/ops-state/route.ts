import { NextResponse } from "next/server";
import { writeAuditLog } from "@/lib/audit";
import { AuthError, requireUser } from "@/lib/auth";
import { readOpsState, writeOpsState, type OpsState } from "@/lib/ops-store";
import { getCached, getInflight, setCached, setInflight } from "@/lib/ops-state-cache";

export const dynamic = "force-dynamic";

const ALLOWED_KEYS: (keyof OpsState)[] = [
  "groups",
  "deliveryRuns",
  "warehouses",
  "teamResources",
  "teamWeekAssignments",
  "jobUpdates",
  "frozenJobIds",
  "siteAssessments",
  "scheduleDraft",
];

function describe(error: unknown) {
  return error instanceof Error ? error.message : "Unknown database error.";
}

export async function GET() {
  const cached = getCached();
  if (cached) return NextResponse.json(cached);

  // Two tabs loading in at once would otherwise both pay the full round trip
  // to the remote database for the same row; the second rides the first's
  // in-flight request instead of firing a duplicate query.
  const inflight = getInflight();
  if (inflight) {
    try {
      return NextResponse.json(await inflight);
    } catch (error) {
      return NextResponse.json(
        { error: "Shared planning data is unreachable: " + describe(error) },
        { status: 503 },
      );
    }
  }

  const requestPromise = readOpsState();
  setInflight(requestPromise);

  try {
    const body = await requestPromise;
    setCached(body);
    return NextResponse.json(body);
  } catch (error) {
    // 503 rather than 500, and never an empty state: the client has to be able
    // to tell "the shared store is unreachable" apart from "there is nothing
    // saved yet", because it seeds the store from local data in the second case
    // and must not do that in the first.
    return NextResponse.json(
      { error: "Shared planning data is unreachable: " + describe(error) },
      { status: 503 },
    );
  } finally {
    setInflight(null);
  }
}

// Human-readable names for the patch keys, for audit log summaries.
const KEY_LABELS: Record<string, string> = {
  groups: "installation groups",
  deliveryRuns: "delivery runs",
  warehouses: "warehouses",
  teamResources: "teams",
  teamWeekAssignments: "team week assignments",
  jobUpdates: "job updates",
  frozenJobIds: "frozen jobs",
  siteAssessments: "roof difficulty",
  scheduleDraft: "schedule draft",
};

export async function PUT(request: Request) {
  let user;
  try {
    user = await requireUser();
  } catch (error) {
    const status = error instanceof AuthError ? error.status : 401;
    return NextResponse.json({ error: "Not signed in." }, { status });
  }

  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const patch = Object.fromEntries(
    Object.entries(body).filter(([key]) =>
      ALLOWED_KEYS.includes(key as keyof OpsState),
    ),
  ) as Partial<OpsState>;

  if (Object.keys(patch).length === 0) {
    return NextResponse.json(
      { error: "No recognised state keys in body." },
      { status: 400 },
    );
  }

  try {
    const state = await writeOpsState(patch);
    // Updated in place rather than merely invalidated: writeOpsState already
    // hands back the merged row, so the next reader (this tab included) gets
    // it straight from memory instead of paying for a request that just ran.
    setCached({ exists: true, state });

    const touched = Object.keys(patch)
      .map((key) => KEY_LABELS[key] ?? key)
      .join(", ");
    await writeAuditLog({
      user,
      action: "ops_state_updated",
      entityType: "ops_state",
      summary: `Updated ${touched}`,
      details: patch,
    });

    return NextResponse.json({ state });
  } catch (error) {
    return NextResponse.json(
      { error: "Could not save to the shared database: " + describe(error) },
      { status: 503 },
    );
  }
}
