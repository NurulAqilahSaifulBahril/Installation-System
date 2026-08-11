import { NextResponse } from "next/server";
import { readOpsState, writeOpsState, type OpsState } from "@/lib/ops-store";

export const dynamic = "force-dynamic";

const ALLOWED_KEYS: (keyof OpsState)[] = [
  "groups",
  "deliveryRuns",
  "teamResources",
  "teamWeekAssignments",
  "availableSuggestions",
  "jobUpdates",
];

export async function GET() {
  const { exists, state } = await readOpsState();
  return NextResponse.json({ exists, state });
}

export async function PUT(request: Request) {
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

  const state = await writeOpsState(patch);
  return NextResponse.json({ state });
}
