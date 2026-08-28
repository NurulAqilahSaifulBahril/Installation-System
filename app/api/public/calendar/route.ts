import { NextResponse } from 'next/server';
import { buildCalendarDayDetails } from '@/lib/calendar-day-details';
import type { CalendarAssignment, CalendarGroup } from '@/lib/calendar-day-details';
import { fetchEligibleSourceJobs } from '@/lib/source-api';
import { readOpsState } from '@/lib/ops-store';
import type { InstallationJob, JobUpdate } from '@/lib/types';

/**
 * The installation calendar, served WITHOUT a session, for the sign-in screen.
 *
 * Read this before changing it. Everything this returns is readable by anyone
 * who can reach the app — and `npm run start` binds 0.0.0.0, so that is every
 * machine on the office network, not just this one. It exists because showing
 * the schedule on the sign-in page was asked for deliberately.
 *
 * It returns the assembled calendar and nothing else: customer name, crew,
 * installation time, and the stock-delivery ETA. It deliberately does NOT
 * reuse /api/jobs, which would also expose phone numbers, addresses, invoice
 * numbers, payment percentages and balances. If a field is not on the calendar
 * card, it must not appear in this response.
 *
 * Set INSTALLATION_PUBLIC_CALENDAR=off to turn it off without a redeploy; the
 * sign-in page then falls back to dates, holidays and weather only.
 */

export const dynamic = 'force-dynamic';

// Mirrors applyJobUpdates on the dashboard: the operational edits are stored
// separately from the source record and have to be merged over it, or the
// calendar would show the source's dates rather than the ones ops set.
function applyUpdates(
  jobs: InstallationJob[],
  updates: Record<string, JobUpdate>,
): InstallationJob[] {
  return jobs.map((job) => ({ ...job, ...(updates[job.id] ?? {}) }));
}

export async function GET() {
  if ((process.env.INSTALLATION_PUBLIC_CALENDAR ?? '').toLowerCase() === 'off') {
    return NextResponse.json({ dayDetails: {}, disabled: true });
  }

  try {
    const [{ jobs }, ops] = await Promise.all([
      fetchEligibleSourceJobs(),
      readOpsState(),
    ]);

    const state = ops.state as unknown as {
      groups?: CalendarGroup[];
      teamWeekAssignments?: CalendarAssignment[];
      jobUpdates?: Record<string, JobUpdate>;
    };

    const dayDetails = buildCalendarDayDetails(
      applyUpdates(jobs, state.jobUpdates ?? {}),
      state.groups ?? [],
      state.teamWeekAssignments ?? [],
    );

    return NextResponse.json({ dayDetails });
  } catch {
    // A sign-in screen must still render when the database is unreachable —
    // the calendar simply shows no work. The reason is deliberately not
    // returned: this response is public, and connection errors name the host.
    return NextResponse.json({ dayDetails: {} });
  }
}
