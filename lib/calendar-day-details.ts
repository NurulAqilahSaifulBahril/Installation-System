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
  installationDate: string;
};

export type CalendarAssignment = {
  installationGroupId: string;
  // "YYYY-MM-DDTHH:mm", or a bare "YYYY-MM-DD" on assignments saved before the
  // field carried a clock.
  startDate: string;
};

// The shape the builder needs from a delivery run.
export type CalendarDeliveryRun = {
  id: string;
  jobIds: string[];
  deliveryDate: string;
  deliveryPic?: string;
  deliveryTeam?: string;
  departureTime?: string;
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

// What heads a crew's block on the day card — an installation crew's own
// team fields, or a delivery run's PIC/team standing in for one so a
// delivery day never reads as an installation crew.
type CrewHeading = {
  teamLabel: string;
  installationTeam: string;
  wiringTeam: string;
};

export function buildCalendarDayDetails(
  jobs: InstallationJob[],
  groups: CalendarGroup[],
  assignments: CalendarAssignment[],
  deliveryRuns: CalendarDeliveryRun[] = [],
): Record<string, CalendarDayDetail> {
  const assignmentsByGroup = new Map<string, CalendarAssignment[]>();
  assignments.forEach((assignment) => {
    const list = assignmentsByGroup.get(assignment.installationGroupId) ?? [];
    list.push(assignment);
    assignmentsByGroup.set(assignment.installationGroupId, list);
  });

  // Every group a job belongs to, not just one — a customer moved to a new
  // booking without being taken out of the old one (a reschedule picked up
  // before the old booking was cleared) is still real, separate work on both
  // days, so both need their own calendar entry rather than one winning.
  const groupsByJobId = new Map<string, CalendarGroup[]>();
  groups.forEach((group) => {
    group.jobIds.forEach((jobId) => {
      const list = groupsByJobId.get(jobId) ?? [];
      list.push(group);
      groupsByJobId.set(jobId, list);
    });
  });

  // Same idea for delivery runs: a job can be on more than one at once for
  // the same reason, and each is a real day materials move.
  const runsByJobId = new Map<string, CalendarDeliveryRun[]>();
  deliveryRuns.forEach((run) => {
    run.jobIds.forEach((jobId) => {
      const list = runsByJobId.get(jobId) ?? [];
      list.push(run);
      runsByJobId.set(jobId, list);
    });
  });

  const details: Record<string, CalendarDayDetail> = {};
  const dayFor = (key: string) =>
    (details[key] ??= { customers: [], crews: [] });

  // Keyed by who the crew IS, not by which group row (or delivery run) it
  // came from — a crew working both halves of a day has two groups (the
  // AM/PM split), and keying on the group would head the card with that crew
  // twice. Customers belonging to no group and no delivery run share the ""
  // bucket and render without a heading.
  const crewFor = (day: CalendarDayDetail, heading?: CrewHeading) => {
    const key = heading
      ? [heading.teamLabel, heading.installationTeam, heading.wiringTeam].join(
          "|",
        )
      : "";
    const existing = day.crews.find((crew) => crew.key === key);
    if (existing) return existing;
    const created = {
      key,
      teamLabel: heading?.teamLabel ?? "",
      installationTeam: heading?.installationTeam ?? "",
      wiringTeam: heading?.wiringTeam ?? "",
      customers: [],
    };
    day.crews.push(created);
    return created;
  };

  jobs.forEach((job) => {
    const jobGroups = (groupsByJobId.get(job.id) ?? []).filter(
      (group) => group.installationDate,
    );

    // One entry per group the job is in, each on that group's own date —
    // deliberately not deduplicated to whichever is latest, the way the
    // dashboard's own summary fields are. A job not yet in any group falls
    // back to its own date, or the date proposed on Customer Scheduling.
    const installDays: { date: string; group: CalendarGroup | null }[] =
      jobGroups.length > 0
        ? jobGroups.map((group) => ({ date: group.installationDate, group }))
        : (() => {
            const date = job.installationDate || job.preferredInstallationDate;
            return date ? [{ date, group: null }] : [];
          })();

    // Every return-trip visit is its own day too, on top of the install
    // day(s) above, unless a visit happens to land on a date already
    // covered by one of them. A visit carries no group of its own, so it is
    // credited to whichever of the job's groups has the latest date — a
    // cosmetic heading choice only, since the date itself comes from the
    // visit either way.
    const installDates = new Set(installDays.map((entry) => entry.date));
    const latestGroup = jobGroups.length
      ? jobGroups.reduce((latest, group) =>
          group.installationDate > latest.installationDate ? group : latest,
        )
      : null;
    const visitDays = (job.visits ?? [])
      .filter((visit) => visit.date && !installDates.has(visit.date))
      .map((visit) => ({ date: visit.date, group: latestGroup, visit }));

    const days: {
      date: string;
      group: CalendarGroup | null;
      visit: JobVisit | null;
    }[] = [
      ...installDays.map(({ date, group }) => ({
        date,
        group,
        visit: null as JobVisit | null,
      })),
      ...visitDays,
    ];

    days.forEach(({ date, group, visit }) => {
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
        // Delivery is now its own separate calendar entry (see jobRuns
        // below), so an installation or return-trip day never carries a
        // stock time of its own — one is not necessarily the other's date.
        stockDelivery: null,
        installTime: visit?.time ?? startTimes[0] ?? null,
        visitKind: visit?.kind ?? null,
      };
      const day = dayFor(date);
      day.customers.push(entry);
      crewFor(
        day,
        group
          ? {
              teamLabel: group.teamLabel ?? "",
              installationTeam: group.installationTeam,
              wiringTeam: group.wiringTeam,
            }
          : undefined,
      ).customers.push(entry);
    });

    // Delivery runs get their own days, entirely separate from installation
    // — a customer can be delivered to on one date and installed on another,
    // and both are real. Headed by the run's PIC or team rather than an
    // installation crew, so "materials arriving" never reads as "crew on
    // site".
    const jobRuns = (runsByJobId.get(job.id) ?? []).filter(
      (run) => run.deliveryDate,
    );
    jobRuns.forEach((run) => {
      const entry = {
        id: job.id,
        name: formatPersonName(job.customerName),
        stockDelivery: run.departureTime || job.arrivalTime || null,
        installTime: null,
        visitKind: null,
      };
      const day = dayFor(run.deliveryDate);
      day.customers.push(entry);
      crewFor(day, {
        teamLabel: "Delivery",
        installationTeam:
          run.deliveryPic?.trim() || run.deliveryTeam?.trim() || "",
        wiringTeam: "",
      }).customers.push(entry);
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
