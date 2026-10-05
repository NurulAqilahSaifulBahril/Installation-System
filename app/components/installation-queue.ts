"use client";

import { useMemo } from "react";
import { MALAYSIA_PUBLIC_HOLIDAYS } from "@/lib/calendar-weather";
import { postcodeCoordinates } from "@/lib/postcode-coords";
import {
  EMPTY_DRAFT,
  addDays,
  buildSchedule,
  candidateFor,
  compareCandidates,
  firstPlanningWeek,
  holdReason,
  postcodeOf,
  type BookedSlot,
  type Candidate,
  type ScheduleDraft,
  type Slot,
  type SlotEntry,
  type TeamNumber,
} from "@/lib/schedule-suggest";
import type { InstallationJob, SiteAssessment } from "@/lib/types";
import { isJobPending, isJobReschedule } from "@/app/components/DepositScheduleTable";

// The installation queue, worked out once from the shared data so the two
// pages that show it can never disagree: Customer Scheduling lists it (queue
// order, standby, holds), Installation groups lays next week's front line out
// as the four crews' tables.

// The parts of an installation group and its week assignment the queue reads
// and creates. The page's own types carry more; these are the fields that
// matter here, so the page can pass its lists straight in.
export type ScheduleGroup = {
  id: string;
  name: string;
  area: string;
  installationDate: string;
  installationEndDate: string;
  jobIds: string[];
  installationTeam: string;
  wiringTeam: string;
  supervisors: string[];
  teamLabel?: string;
  wiringMembers?: string[];
  cars?: string[];
};

export type ScheduleWeekAssignment = {
  id: string;
  teamId: string;
  startDate: string;
  installationGroupId: string;
};

export const HOLIDAYS: ReadonlySet<string> = new Set(
  Object.keys(MALAYSIA_PUBLIC_HOLIDAYS),
);

// A group counts as one of the four crews when its sheet label says so —
// "Team 1" to "Team 4".
function teamOfGroup(group: ScheduleGroup): TeamNumber | null {
  const match = group.teamLabel?.match(/\bteam\s*([1-4])\b/i);
  return match ? (Number(match[1]) as TeamNumber) : null;
}

export type QueuePosition = { team: TeamNumber; date: string; entry: SlotEntry };

export type QueueStage =
  | { kind: "front"; position: QueuePosition }
  | { kind: "scheduled"; date: string | null }
  | { kind: "standby" }
  | { kind: "hold"; reason: string }
  | { kind: "not-queued"; reason: string };

export function useInstallationQueue({
  readyJobs,
  jobById,
  groups,
  weekAssignments,
  assessments,
  draft,
  todayIso,
}: {
  // The Ready to Install customers, before any search or month filter: the
  // queue is the same whatever the page is currently narrowed to.
  readyJobs: InstallationJob[];
  jobById: Map<string, InstallationJob>;
  groups: ScheduleGroup[];
  weekAssignments: ScheduleWeekAssignment[];
  assessments: Record<string, SiteAssessment>;
  draft: ScheduleDraft | null | undefined;
  todayIso: string;
}) {
  const scheduleDraft = draft ?? EMPTY_DRAFT;
  const frontWeek = firstPlanningWeek(todayIso);

  const startTimeByGroup = useMemo(() => {
    const byGroup = new Map<string, string>();
    weekAssignments.forEach((assignment) => {
      const time = assignment.startDate.split("T")[1]?.slice(0, 5);
      if (time) byGroup.set(assignment.installationGroupId, time);
    });
    return byGroup;
  }, [weekAssignments]);

  const candidates = useMemo(
    () =>
      readyJobs
        .filter((job) => job.customerAvailabilityStatus !== "complete")
        .map((job) =>
          candidateFor(job, assessments[job.id], todayIso, scheduleDraft.holds, HOLIDAYS),
        )
        .sort(compareCandidates),
    [readyJobs, assessments, todayIso, scheduleDraft.holds],
  );
  const candidateById = useMemo(
    () => new Map(candidates.map((candidate) => [candidate.job.id, candidate])),
    [candidates],
  );

  // Every crew booking already made in Installation groups. A job in any group
  // at all is booked (Scheduled) and leaves the queue — unless the customer has
  // asked to move, in which case they need a new date.
  const { booked, bookedJobIds, bookedDateByJob } = useMemo(() => {
    const slots: BookedSlot[] = [];
    const ids = new Set<string>();
    const dates = new Map<string, string>();

    // Completed jobs (green checkmark) are finished and excluded from Propose to Install
    jobById.forEach((job, jobId) => {
      if (job.customerAvailabilityStatus === "complete") {
        ids.add(jobId);
      }
    });

    groups.forEach((group) => {
      group.jobIds.forEach((jobId) => {
        const job = jobById.get(jobId);
        const hasCheck = Boolean(job) && job?.customerAvailabilityStatus === "complete";
        if (hasCheck) ids.add(jobId);
        if (group.installationDate) dates.set(jobId, group.installationDate.slice(0, 10));
      });
      const team = teamOfGroup(group);
      if (!team || !group.installationDate) return;
      const time = startTimeByGroup.get(group.id) ?? "09:00";
      group.jobIds.forEach((jobId, index) => {
        const hard = assessments[jobId]?.difficulty === "hard";
        const slot: Slot =
          group.jobIds.length === 1 && hard
            ? "full"
            : group.jobIds.length === 1
              ? time >= "12:00"
                ? "pm"
                : "am"
              : index === 0
                ? "am"
                : "pm";
        slots.push({
          jobId,
          team,
          date: group.installationDate.slice(0, 10),
          slot,
          groupId: group.id,
        });
      });
    });
    return { booked: slots, bookedJobIds: ids, bookedDateByJob: dates };
  }, [groups, jobById, startTimeByGroup, assessments]);

  const coordsFor = useMemo(
    () => (jobId: string) => {
      const candidate = candidateById.get(jobId);
      if (candidate) return candidate.coords;
      const job = jobById.get(jobId);
      return job ? postcodeCoordinates(postcodeOf(job)) : null;
    },
    [candidateById, jobById],
  );

  const secondWeek = addDays(frontWeek, 7);

  const schedule1 = useMemo(
    () =>
      buildSchedule({
        weekStart: frontWeek,
        todayIso,
        candidates,
        booked,
        bookedJobIds,
        draft: scheduleDraft,
        coordsFor,
      }),
    [frontWeek, todayIso, candidates, booked, bookedJobIds, scheduleDraft, coordsFor],
  );

  const schedule2 = useMemo(
    () =>
      buildSchedule({
        weekStart: secondWeek,
        todayIso,
        candidates,
        booked,
        bookedJobIds,
        draft: scheduleDraft,
        coordsFor,
      }),
    [secondWeek, todayIso, candidates, booked, bookedJobIds, scheduleDraft, coordsFor],
  );

  const schedules = useMemo(() => [schedule1, schedule2], [schedule1, schedule2]);

  const positions = useMemo(() => {
    const byJob = new Map<string, QueuePosition>();
    schedules.forEach((sch) => {
      sch.teams.forEach((team) =>
        team.days.forEach((day) =>
          day.entries.forEach((entry) => {
            if (entry.jobId && !byJob.has(entry.jobId)) {
              byJob.set(entry.jobId, { team: team.team, date: day.date, entry });
            }
          }),
        ),
      );
    });
    return byJob;
  }, [schedules]);

  // The queue: everyone cleared to install (60% + SEDA approved) who is not
  // booked yet, in queue order. A customer on hold keeps their number.
  const queue = useMemo(
    () =>
      candidates.filter(
        (candidate) => candidate.sedaApproved && !bookedJobIds.has(candidate.job.id),
      ),
    [candidates, bookedJobIds],
  );
  const queueNumber = useMemo(
    () => new Map(queue.map((candidate, index) => [candidate.job.id, index + 1])),
    [queue],
  );

  // Standby: meets every front-line rule, just further back in the queue.
  const standby = useMemo(
    () =>
      queue.filter(
        (candidate) => !positions.has(candidate.job.id) && holdReason(candidate) === null,
      ),
    [queue, positions],
  );

  function stageOf(candidate: Candidate): QueueStage {
    const id = candidate.job.id;
    if (bookedJobIds.has(id)) {
      return { kind: "scheduled", date: bookedDateByJob.get(id) ?? null };
    }
    const position = positions.get(id);
    if (position) return { kind: "front", position };
    if (!candidate.sedaApproved) return { kind: "not-queued", reason: "SEDA not approved" };
    if (candidate.hold || candidate.stockHeld) {
      return { kind: "hold", reason: holdReason(candidate) ?? "On hold" };
    }
    const reason = holdReason(candidate);
    if (reason) return { kind: "not-queued", reason };
    return { kind: "standby" };
  }

  return {
    draft: scheduleDraft,
    frontWeek,
    secondWeek,
    candidates,
    candidateById,
    booked,
    bookedJobIds,
    coordsFor,
    schedule: schedule1,
    schedules,
    positions,
    queue,
    queueNumber,
    standby,
    stageOf,
  };
}
