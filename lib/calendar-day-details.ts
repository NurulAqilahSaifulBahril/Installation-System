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
  // Only ever compared against "delivered", to tell a run that still describes
  // future work from one that is already history. Optional and widened to
  // string so this stays a structural view of DeliveryRun rather than a copy
  // of its status union.
  status?: string;
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

export type CalendarPlacement = {
  jobId: string;
  team: number;
  date: string;
  slot: "am" | "pm" | "full";
};

export type CalendarScheduleDraft = {
  placements?: CalendarPlacement[];
  teamCrews?: Partial<Record<number, { installationTeam?: string; wiringTeam?: string }>>;
};

const SLOT_TIME: Record<string, string> = {
  am: "09:00",
  pm: "14:00",
  full: "09:00",
};

export function buildCalendarDayDetails(
  jobs: InstallationJob[],
  groups: CalendarGroup[],
  assignments: CalendarAssignment[],
  deliveryRuns: CalendarDeliveryRun[] = [],
  scheduleDraft?: CalendarScheduleDraft,
): Record<string, CalendarDayDetail> {
  const assignmentsByGroup = new Map<string, CalendarAssignment[]>();
  assignments.forEach((assignment) => {
    const list = assignmentsByGroup.get(assignment.installationGroupId) ?? [];
    list.push(assignment);
    assignmentsByGroup.set(assignment.installationGroupId, list);
  });

  const placementsByJobId = new Map<string, CalendarPlacement[]>();
  if (scheduleDraft?.placements) {
    scheduleDraft.placements.forEach((placement) => {
      if (!placement.jobId || !placement.date) return;
      const list = placementsByJobId.get(placement.jobId) ?? [];
      list.push(placement);
      placementsByJobId.set(placement.jobId, list);
    });
  }

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
    const jobPlacements = placementsByJobId.get(job.id) ?? [];
    const jobGroups = (groupsByJobId.get(job.id) ?? []).filter(
      (group) => group.installationDate,
    );

    const placementDays = jobPlacements.map((placement) => ({
      date: placement.date,
      group: null as CalendarGroup | null,
      placement,
    }));

    // One entry per placement or group the job is in, each on that slot/group's own date
    const installDays: {
      date: string;
      group: CalendarGroup | null;
      placement?: CalendarPlacement;
    }[] =
      placementDays.length > 0
        ? placementDays
        : jobGroups.length > 0
        ? jobGroups.map((group) => ({ date: group.installationDate, group }))
        : (() => {
            const date = job.installationDate || job.preferredInstallationDate;
            return date ? [{ date, group: null }] : [];
          })();

    // Every return-trip visit is its own day too, on top of the install
    // day(s) above, unless a visit happens to land on a date already
    // covered by one of them.
    const installDates = new Set(installDays.map((entry) => entry.date));
    const latestGroup = jobGroups.length
      ? jobGroups.reduce((latest, group) =>
          group.installationDate > latest.installationDate ? group : latest,
        )
      : null;
    const visitDays = (job.visits ?? [])
      .filter((visit) => visit.date && !installDates.has(visit.date))
      .map((visit) => ({ date: visit.date, group: latestGroup, placement: undefined as CalendarPlacement | undefined, visit }));

    const days: {
      date: string;
      group: CalendarGroup | null;
      placement?: CalendarPlacement;
      visit: JobVisit | null;
    }[] = [
      ...installDays.map(({ date, group, placement }) => ({
        date,
        group,
        placement,
        visit: null as JobVisit | null,
      })),
      ...visitDays,
    ];

    days.forEach(({ date, group, placement, visit }) => {
      const slotTime = placement ? (SLOT_TIME[placement.slot] ?? "09:00") : null;
      const startTimes = (group ? (assignmentsByGroup.get(group.id) ?? []) : [])
        .filter((assignment) => assignment.startDate.slice(0, 10) === date)
        .map((assignment) => timeOfDay(assignment.startDate))
        .filter((time): time is string => Boolean(time))
        .sort();

      const teamCrew = placement ? scheduleDraft?.teamCrews?.[placement.team] : undefined;

      const entry = {
        id: job.id,
        name: formatPersonName(job.customerName),
        stockDelivery: slotTime ?? null,
        installTime: visit?.time ?? slotTime ?? startTimes[0] ?? null,
        visitKind: visit?.kind ?? null,
      };
      const day = dayFor(date);
      day.customers.push(entry);
      crewFor(
        day,
        placement
          ? {
              teamLabel: `Team ${placement.team}`,
              installationTeam: teamCrew?.installationTeam || `Team ${placement.team}`,
              wiringTeam: teamCrew?.wiringTeam || "",
            }
          : group
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
    // Which day a stop lands on. The customer's own estimated arrival wins
    // when they have one: Stock delivery offers that field per stop and tells
    // the user it overrides the run ("Clear it to go back to the run's
    // delivery date"), so the calendar has to honour the same promise. Reading
    // only the run's date put 236 of the 383 stops that carry an estimate on
    // the wrong day, and left the stops on undated runs off the calendar
    // altogether — LEONG YEU JIAN (INV-1010725) sat on an undated run with a
    // 5 Sep estimate and appeared nowhere.
    //
    // Falls back to the run's date, so a stop with no estimate of its own is
    // placed exactly as before.
    // An estimate only describes a delivery that has not happened yet. Once a
    // run is marked delivered its date is a record of when the materials
    // actually moved, and the customer's estimate — a single field they carry
    // across every run they are on — must not overwrite it.
    //
    // LEONG YEU JIAN (INV-1010725) shows why: delivered on 25 Aug, and pending
    // again on 5 Sep. One estimate of 5 Sep applied to both runs erased the
    // 25 Aug delivery from the calendar entirely. Two deliveries happened;
    // both belong on it.
    const stopDayFor = (run: CalendarDeliveryRun) =>
      run.status === "delivered"
        ? run.deliveryDate
        : job.arrivalDate || run.deliveryDate;

    // One entry per day, not per run. Two runs still mean two real deliveries
    // when they fall on different days, and both are kept — but the arrival
    // estimate above is a single field on the customer, so a customer sitting
    // on more than one run has every one of those runs resolve to that same
    // day. LEONG YEU JIAN (INV-1010725) is on two, and appeared twice on
    // 5 Sep: once at 12:00 from the undated run and once at 15:00 from the
    // 25 Aug one.
    //
    // Where two runs do collide on a day, the live one wins the row: a run
    // still to be delivered describes what is going to happen, while one
    // already marked delivered is history. Failing that, the later-dated run,
    // so the heading names the most recent movement rather than an older one.
    const stopByDay = new Map<string, CalendarDeliveryRun>();
    (runsByJobId.get(job.id) ?? []).forEach((run) => {
      const day = stopDayFor(run);
      if (!day) return;
      const held = stopByDay.get(day);
      if (!held) {
        stopByDay.set(day, run);
        return;
      }
      const isLive = (candidate: CalendarDeliveryRun) =>
        candidate.status !== "delivered";
      if (isLive(run) !== isLive(held)) {
        if (isLive(run)) stopByDay.set(day, run);
        return;
      }
      if ((run.deliveryDate ?? "") > (held.deliveryDate ?? "")) {
        stopByDay.set(day, run);
      }
    });

    const jobRuns = [...stopByDay.values()];
    jobRuns.forEach((run) => {
      const entry = {
        id: job.id,
        name: formatPersonName(job.customerName),
        stockDelivery: run.departureTime || job.arrivalTime || null,
        installTime: null,
        visitKind: null,
      };
      const day = dayFor(stopDayFor(run));
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
