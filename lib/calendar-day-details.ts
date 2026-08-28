import type {
  CalendarDayDetail,
  InstallationJob,
  JobVisit,
} from "@/lib/types";

/**
 * Turns jobs, their groups and the crews' week assignments into what the
 * calendar shows for each day.
 *
 * Extracted from the dashboard so the sign-in screen renders the same days
 * from the same rules rather than a second implementation that can drift.
 * Pure: no fetching, no React, so it runs identically in the browser and in
 * the route that serves the sign-in calendar.
 */

// The shape the builder needs from an installation group. Declared structurally
// rather than importing the dashboard's own type, which carries a great deal
// this has no use for.
export type CalendarGroup = {
  id: string;
  jobIds: string[];
  teamLabel?: string;
  installationTeam: string;
  wiringTeam: string;
};

export type CalendarAssignment = {
  installationGroupId: string;
  // "YYYY-MM-DDTHH:mm", or a bare "YYYY-MM-DD" on assignments saved before the
  // field carried a clock.
  startDate: string;
};

export function formatPersonName(name: string) {
  return name
    .trim()
    .toLocaleLowerCase("en-MY")
    .replace(/(^|[\s(/'-])\p{L}/gu, (letter) =>
      letter.toLocaleUpperCase("en-MY"),
    );
}

// "2026-08-11T16:40" -> "16:40". A bare date has no time to show.
function timeOfDay(stamp: string): string | null {
  const time = stamp.split("T")[1];
  return time ? time.slice(0, 5) : null;
}

export function buildCalendarDayDetails(
  jobs: InstallationJob[],
  groups: CalendarGroup[],
  assignments: CalendarAssignment[],
): Record<string, CalendarDayDetail> {
  const assignmentsByGroup = new Map<string, CalendarAssignment[]>();
  assignments.forEach((assignment) => {
    const list = assignmentsByGroup.get(assignment.installationGroupId) ?? [];
    list.push(assignment);
    assignmentsByGroup.set(assignment.installationGroupId, list);
  });

  const groupByJobId = new Map<string, CalendarGroup>();
  groups.forEach((group) =>
    group.jobIds.forEach((jobId) => groupByJobId.set(jobId, group)),
  );

  const details: Record<string, CalendarDayDetail> = {};
  const dayFor = (key: string) =>
    (details[key] ??= { customers: [], crews: [] });

  // Keyed by who the crew IS, not by which group row they sit in. A crew
  // working both halves of a day has two groups (the AM/PM split), and keying
  // on the group would head the card with that crew twice. Customers belonging
  // to no group share the "" bucket and render without a heading.
  const crewFor = (day: CalendarDayDetail, group?: CalendarGroup) => {
    const key = group
      ? [group.teamLabel ?? "", group.installationTeam, group.wiringTeam].join(
          "|",
        )
      : "";
    const existing = day.crews.find((crew) => crew.key === key);
    if (existing) return existing;
    const created = {
      key,
      teamLabel: group?.teamLabel ?? "",
      installationTeam: group?.installationTeam ?? "",
      wiringTeam: group?.wiringTeam ?? "",
      customers: [],
    };
    day.crews.push(created);
    return created;
  };

  jobs.forEach((job) => {
    // Same rule the calendar's own day markers use, so a marked day and its
    // card never disagree about who is installing that day.
    const primary = job.installationDate || job.preferredInstallationDate;

    // Every day this site is worked on, not just the primary one. A return trip
    // carries its own clock and its own reason, so it is listed on its own day
    // rather than folded into the installation date.
    const days = [
      ...(primary ? [{ date: primary, visit: null as JobVisit | null }] : []),
      ...(job.visits ?? [])
        .filter((visit) => visit.date && visit.date !== primary)
        .map((visit) => ({ date: visit.date, visit })),
    ];

    const group = groupByJobId.get(job.id);
    days.forEach(({ date, visit }) => {
      // The crew's start time stands in as the installation time — the schema
      // carries no per-customer clock. Only this customer's own group counts,
      // and only a booking on this day. A visit that names its own time is
      // trusted ahead of the crew's, being the more specific answer.
      const startTimes = (group ? (assignmentsByGroup.get(group.id) ?? []) : [])
        .filter((assignment) => assignment.startDate.slice(0, 10) === date)
        .map((assignment) => timeOfDay(assignment.startDate))
        .filter((time): time is string => Boolean(time))
        .sort();

      const entry = {
        id: job.id,
        name: formatPersonName(job.customerName),
        stockDelivery: visit ? null : job.arrivalTime || null,
        installTime: visit?.time ?? startTimes[0] ?? null,
        visitKind: visit?.kind ?? null,
      };
      const day = dayFor(date);
      day.customers.push(entry);
      crewFor(day, group).customers.push(entry);
    });
  });

  Object.values(details).forEach((day) => {
    day.customers.sort((a, b) => a.name.localeCompare(b.name));
    day.crews.forEach((crew) =>
      // Time first inside a crew: the card is read to find out what that crew
      // is doing next, and a crew works its day in clock order.
      crew.customers.sort(
        (a, b) =>
          (a.installTime ?? "99:99").localeCompare(b.installTime ?? "99:99") ||
          a.name.localeCompare(b.name),
      ),
    );
    // Crews with no heading (customers in no group) go last.
    day.crews.sort(
      (a, b) =>
        Number(!a.teamLabel && !a.installationTeam) -
          Number(!b.teamLabel && !b.installationTeam) ||
        a.teamLabel.localeCompare(b.teamLabel, undefined, { numeric: true }) ||
        a.installationTeam.localeCompare(b.installationTeam),
    );
  });

  return details;
}
