// The installation queue behind Installation groups' Ready to Install view:
// four crews, Monday to Saturday, two houses a day each (a hard site takes the
// whole day), filled for next week (the front line) and the week after
// (provisional) from the customers in the queue.
//
// Pure functions only — no React, no fetching — so the same inputs always give
// the same weeks, and a suggestion never needs saving: only what the manager
// changes by hand (the draft's placements, drop-outs, holds and rain days) is
// stored.
//
// The rules, as agreed with ops:
//
//  - The queue is every Ready to Install customer (60%+ paid) with SEDA
//    approved. Everyone else still shows, but is not placed automatically.
//  - Each customer has 28 working days from reaching 60% to be installed. The
//    queue runs in order of days left on that clock, so whoever is closest to
//    (or past) the limit goes first; on a tie, whoever reached 60% first.
//  - Time on hold because the customer is not available pauses the clock;
//    holds for stock or materials do not, because those are ours to fix.
//  - Team 1 works from Kluang and takes the Kluang, Batu Pahat, Muar and
//    Segamat side; Teams 2–4 work from JB and take everything else.
//  - A day's two houses are paired within 10 km, widening in steps to 30 km.
//    Past 30 km the second slot is left open rather than sending a crew across
//    the state for one house.
//  - Hard jobs and far trips rotate: each day's hardest work goes to the crew
//    that has had the least of it so far that week.
//  - Stock has to be in hand by the install day. Stock arriving on the day
//    itself only goes in the afternoon slot, in case the lorry is late.

import {
  isSedaApproved,
  type InstallationJob,
  type SiteAssessment,
  type SiteDifficulty,
} from "@/lib/types";
import {
  distanceKm,
  postcodeCoordinates,
  type Coordinates,
} from "@/lib/postcode-coords";

export type TeamNumber = 1 | 2 | 3 | 4;
export const TEAM_NUMBERS: TeamNumber[] = [1, 2, 3, 4];

export type Region = "jb" | "kluang";
export const TEAM_REGION: Record<TeamNumber, Region> = {
  1: "kluang",
  2: "jb",
  3: "jb",
  4: "jb",
};
export const REGION_LABEL: Record<Region, string> = {
  jb: "JB base",
  kluang: "Kluang base",
};
const BASE_COORDINATES: Record<Region, Coordinates> = {
  jb: { lat: 1.492, lng: 103.741 },
  kluang: { lat: 2.031, lng: 103.318 },
};

export const DEFAULT_RADIUS_KM = 10;
export const MAX_RADIUS_KM = 30;
const RADIUS_STEPS = [10, 15, 20, 25, 30];
// A trip further than this from the crew's base counts as a far job for the
// rotation.
export const FAR_FROM_BASE_KM = 40;
// Working days (Mon–Fri, public holidays excluded) a customer may wait between
// reaching 60% and being installed — the same limit Need Attention uses.
export const WORKING_DAY_LIMIT = 28;

// am = 9am, pm = 2pm, full = a hard job taking the whole day.
export type Slot = "am" | "pm" | "full";
export const SLOT_TIME: Record<Slot, string> = {
  am: "09:00",
  pm: "14:00",
  full: "09:00",
};

export type Placement = {
  jobId: string;
  weekStart: string;
  team: TeamNumber;
  date: string;
  slot: Slot;
};

// A front-line customer who dropped out of a week, with the manager's remark.
// They are left out of that week only; the queue brings them back after.
export type Removal = { jobId: string; weekStart: string; remark?: string };

export type HoldReason = "customer" | "stock" | "materials";
export const HOLD_LABEL: Record<HoldReason, string> = {
  customer: "Customer not available",
  stock: "No stock",
  materials: "Materials or equipment",
};

// A customer the manager took out of the queue for now. They keep their place:
// releasing the hold (setting `to`) puts them straight back. Only a customer
// hold pauses the 28-day clock.
export type Hold = {
  jobId: string;
  reason: HoldReason;
  remark: string;
  from: string;
  to: string | null;
  // When the customer said they would be ready again, if they did.
  returnOn?: string | null;
};

export type TeamCrewAssignment = {
  installationTeam?: string;
  wiringTeam?: string;
  siteSupervisor?: string;
  membersText?: string;
  car?: string;
};

export type OpenSlot = {
  weekStart: string;
  team: TeamNumber;
  date: string;
  slot: Slot;
};

export type ScheduleDraft = {
  placements: Placement[];
  removals: Removal[];
  holds: Hold[];
  openSlots?: OpenSlot[];
  // Days the manager put on hold for rain: nothing is suggested on them.
  rainHoldDays: string[];
  // Days with rain forecast that the manager chose to go ahead with, so the
  // warning stops asking.
  rainProceedDays: string[];
  teamCrews?: Partial<Record<TeamNumber, TeamCrewAssignment>>;
};

export const EMPTY_DRAFT: ScheduleDraft = {
  placements: [],
  removals: [],
  holds: [],
  openSlots: [],
  rainHoldDays: [],
  rainProceedDays: [],
  teamCrews: {},
};

function isTeamNumber(value: unknown): value is TeamNumber {
  return value === 1 || value === 2 || value === 3 || value === 4;
}

function isSlot(value: unknown): value is Slot {
  return value === "am" || value === "pm" || value === "full";
}

function isIsoDate(value: unknown): value is string {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value);
}

// The draft arrives from the shared store as untyped JSON; anything malformed
// is dropped rather than trusted.
function isHoldReason(value: unknown): value is HoldReason {
  return value === "customer" || value === "stock" || value === "materials";
}

export function normalizeDraft(value: unknown): ScheduleDraft {
  const raw = (value ?? {}) as {
    placements?: unknown;
    removals?: unknown;
    holds?: unknown;
    openSlots?: unknown;
    rainHoldDays?: unknown;
    rainProceedDays?: unknown;
    teamCrews?: unknown;
  };
  const placements = Array.isArray(raw.placements)
    ? raw.placements.filter(
        (item): item is Placement =>
          typeof item?.jobId === "string" &&
          isIsoDate(item?.weekStart) &&
          isTeamNumber(item?.team) &&
          isIsoDate(item?.date) &&
          isSlot(item?.slot),
      )
    : [];
  const removals = Array.isArray(raw.removals)
    ? raw.removals.filter(
        (item): item is Removal =>
          typeof item?.jobId === "string" && isIsoDate(item?.weekStart),
      )
    : [];
  const holds = Array.isArray(raw.holds)
    ? raw.holds.filter(
        (item): item is Hold =>
          typeof item?.jobId === "string" &&
          isHoldReason(item?.reason) &&
          isIsoDate(item?.from) &&
          (item?.to === null || isIsoDate(item?.to)),
      )
    : [];
  const openSlots = Array.isArray(raw.openSlots)
    ? raw.openSlots.filter(
        (item): item is OpenSlot =>
          isIsoDate(item?.weekStart) &&
          isTeamNumber(item?.team) &&
          isIsoDate(item?.date) &&
          isSlot(item?.slot),
      )
    : [];
  const dates = (list: unknown) =>
    Array.isArray(list) ? list.filter((item): item is string => isIsoDate(item)) : [];

  const rawTeamCrews =
    raw.teamCrews && typeof raw.teamCrews === "object"
      ? (raw.teamCrews as Record<string, unknown>)
      : {};
  const teamCrews: Partial<Record<TeamNumber, TeamCrewAssignment>> = {};
  for (const n of [1, 2, 3, 4] as TeamNumber[]) {
    const item = rawTeamCrews[n] || rawTeamCrews[String(n)];
    if (item && typeof item === "object") {
      const c = item as Record<string, unknown>;
      teamCrews[n] = {
        installationTeam: typeof c.installationTeam === "string" ? c.installationTeam : undefined,
        wiringTeam: typeof c.wiringTeam === "string" ? c.wiringTeam : undefined,
        siteSupervisor: typeof c.siteSupervisor === "string" ? c.siteSupervisor : undefined,
        membersText: typeof c.membersText === "string" ? c.membersText : undefined,
        car: typeof c.car === "string" ? c.car : undefined,
      };
    }
  }

  return {
    placements,
    removals,
    holds,
    openSlots,
    rainHoldDays: dates(raw.rainHoldDays),
    rainProceedDays: dates(raw.rainProceedDays),
    teamCrews,
  };
}

// The hold a customer is on right now, if any.
export function activeHold(holds: Hold[], jobId: string): Hold | null {
  return holds.find((hold) => hold.jobId === jobId && hold.to === null) ?? null;
}

/* --------------------------------- dates --------------------------------- */

function parseIso(iso: string): Date {
  const [year, month, day] = iso.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day));
}

function toIso(date: Date): string {
  return date.toISOString().slice(0, 10);
}

export function addDays(iso: string, days: number): string {
  const date = parseIso(iso);
  date.setUTCDate(date.getUTCDate() + days);
  return toIso(date);
}

// The Monday on or before the date.
export function weekStartOf(iso: string): string {
  const date = parseIso(iso);
  const offset = (date.getUTCDay() + 6) % 7;
  return addDays(iso, -offset);
}

// Monday to Saturday.
export function weekDays(weekStart: string): string[] {
  return [0, 1, 2, 3, 4, 5].map((offset) => addDays(weekStart, offset));
}

// The first week suggestions are made for: the one after this one. The current
// week is already under way and is planned by hand.
export function firstPlanningWeek(todayIso: string): string {
  return addDays(weekStartOf(todayIso), 7);
}

// Working days after `startIso` up to and including `endIso`: Monday to Friday,
// public holidays left out — the same count Need Attention makes.
export function workingDaysBetween(
  startIso: string,
  endIso: string,
  holidays: ReadonlySet<string>,
): number {
  if (endIso <= startIso) return 0;
  let count = 0;
  let cursor = startIso;
  // Bounded so a malformed date can never spin forever.
  for (let guard = 0; guard < 3660 && cursor < endIso; guard += 1) {
    cursor = addDays(cursor, 1);
    const weekday = parseIso(cursor).getUTCDay();
    if (weekday === 0 || weekday === 6) continue;
    if (holidays.has(cursor)) continue;
    count += 1;
  }
  return count;
}

/* ------------------------------- candidates ------------------------------- */

export function postcodeOf(job: InstallationJob): string {
  const stored = job.postcode?.match(/\b\d{5}\b/)?.[0];
  if (stored) return stored;
  return job.address.match(/\b\d{5}\b/)?.[0] || "";
}

// Which crew side a postcode belongs to: Batu Pahat (83), Muar (84), Segamat
// (85) and Kluang itself up to Paloh (860–866) go to the Kluang crew; Mersing
// and Endau (868–869) and everything south go to JB.
// Johor's postcodes run 79000–86999. The crews do not travel out of state, so
// anyone else (the odd Seri Kembangan job) is left for planning by hand.
export function inJohor(postcode: string): boolean {
  return /^(79|8[0-6])\d{3}$/.test(postcode);
}

export function regionOf(postcode: string): Region {
  if (/^8[345]/.test(postcode)) return "kluang";
  if (/^86[0-6]/.test(postcode)) return "kluang";
  return "jb";
}

export type Candidate = {
  job: InstallationJob;
  postcode: string;
  coords: Coordinates | null;
  region: Region;
  difficulty: SiteDifficulty | null;
  // Working days left on the 28-day clock; negative once it is over. Null
  // when there is no 60% date to count from.
  daysLeft: number | null;
  // Working days the clock has been paused by customer holds.
  pausedDays: number;
  hold: Hold | null;
  sedaApproved: boolean;
  // The first day the stock is on hand, when a delivery date is known.
  stockDate: string | null;
  // Stock is still being waited on and no date has been given.
  stockHeld: boolean;
  distanceFromBaseKm: number | null;
};

export function candidateFor(
  job: InstallationJob,
  assessment: SiteAssessment | undefined,
  todayIso: string,
  holds: Hold[],
  holidays: ReadonlySet<string>,
): Candidate {
  const postcode = postcodeOf(job);
  const coords = postcode ? postcodeCoordinates(postcode) : null;
  const region = regionOf(postcode);
  const pausedDays = holds
    .filter((hold) => hold.jobId === job.id && hold.reason === "customer")
    .reduce(
      (total, hold) =>
        total + workingDaysBetween(hold.from, hold.to ?? todayIso, holidays),
      0,
    );
  const daysLeft = job.secondPaymentDate
    ? WORKING_DAY_LIMIT -
      (workingDaysBetween(job.secondPaymentDate, todayIso, holidays) - pausedDays)
    : null;
  const stockDate =
    job.arrivalDate ||
    (job.deliveryStatus === "delivery_scheduled" ? job.deliveryDate : null) ||
    null;
  return {
    job,
    postcode,
    coords,
    region,
    difficulty: assessment?.difficulty ?? null,
    daysLeft,
    pausedDays,
    hold: activeHold(holds, job.id),
    sedaApproved: isSedaApproved(job.sedaStatus),
    stockDate,
    stockHeld: job.deliveryStatus === "pending_stock" && !stockDate,
    distanceFromBaseKm: coords
      ? distanceKm(coords, BASE_COORDINATES[region])
      : null,
  };
}

// Queue order: fewest days left on the 28-day clock first (so anyone past it
// leads), then whoever reached 60% first. A customer with no 60% date sorts
// last.
export function compareCandidates(a: Candidate, b: Candidate): number {
  const aLeft = a.daysLeft ?? Number.POSITIVE_INFINITY;
  const bLeft = b.daysLeft ?? Number.POSITIVE_INFINITY;
  if (aLeft !== bLeft) return aLeft < bLeft ? -1 : 1;
  const aDate = a.job.secondPaymentDate ?? "9999-12-31";
  const bDate = b.job.secondPaymentDate ?? "9999-12-31";
  if (aDate !== bDate) return aDate < bDate ? -1 : 1;
  return a.job.invoiceNumber.localeCompare(b.job.invoiceNumber);
}

// Why a ready customer is not being placed automatically, or null when they
// can be.
export function holdReason(candidate: Candidate): string | null {
  if (!candidate.sedaApproved) return "SEDA not approved";
  if (candidate.hold) return HOLD_LABEL[candidate.hold.reason];
  if (candidate.stockHeld) return "Waiting for stock";
  if (!candidate.postcode) return "No postcode";
  if (!inJohor(candidate.postcode)) return "Outside Johor";
  if (!candidate.coords) return "Location unknown";
  return null;
}

/* --------------------------------- weeks --------------------------------- */

export type EntrySource = "booked" | "placed" | "suggested" | "open";

export type SlotEntry = {
  slot: Slot;
  jobId: string | null;
  source: EntrySource;
  // Distance from the other house that day, when it was paired by distance.
  pairDistanceKm?: number;
  // Set when the pair was only found by searching past the 10 km radius.
  widenedKm?: number;
  // Only on open slots.
  openReason?: string;
  // Only on booked slots: the installation group it came from.
  groupId?: string;
};

export type TeamDay = { team: TeamNumber; date: string; entries: SlotEntry[] };

export type TeamWeek = {
  team: TeamNumber;
  days: TeamDay[];
  hard: number;
  far: number;
};

export type WeekSchedule = {
  weekStart: string;
  days: string[];
  teams: TeamWeek[];
  // Every job appearing anywhere in the week.
  jobIds: Set<string>;
};

export type BookedSlot = {
  jobId: string;
  team: TeamNumber;
  date: string;
  slot: Slot;
  groupId: string;
};

type Cell = {
  am?: SlotEntry;
  pm?: SlotEntry;
  full?: SlotEntry;
  // Anything past the two slots — booked groups from before this page existed
  // can hold up to five customers in one booking.
  extra: SlotEntry[];
};

function conflicts(a: Slot, b: Slot) {
  return a === "full" || b === "full" || a === b;
}

function stockAllows(candidate: Candidate, date: string, slot: Slot) {
  if (!candidate.stockDate) return true;
  return slot === "pm"
    ? candidate.stockDate <= date
    : candidate.stockDate < date;
}

export type WeekInput = {
  weekStart: string;
  // Ready customers in priority order (see compareCandidates).
  candidates: Candidate[];
  candidateById: Map<string, Candidate>;
  booked: BookedSlot[];
  draft: ScheduleDraft;
  // Jobs that must not be suggested this week: booked anywhere, placed by hand
  // in another week, or already suggested in an earlier week.
  excluded: Set<string>;
  allowSuggestions: boolean;
  // Coordinates for jobs that are booked but no longer in the ready list.
  coordsFor: (jobId: string) => Coordinates | null;
};

export function buildWeek(input: WeekInput): WeekSchedule {
  const { weekStart, candidates, candidateById, booked, draft, allowSuggestions } =
    input;
  const days = weekDays(weekStart);
  const cells = new Map<string, Cell>();
  const cellFor = (team: TeamNumber, date: string) => {
    const key = `${team}|${date}`;
    let cell = cells.get(key);
    if (!cell) {
      cell = { extra: [] };
      cells.set(key, cell);
    }
    return cell;
  };
  const burden: Record<TeamNumber, { hard: number; far: number }> = {
    1: { hard: 0, far: 0 },
    2: { hard: 0, far: 0 },
    3: { hard: 0, far: 0 },
    4: { hard: 0, far: 0 },
  };
  const used = new Set<string>();

  function countBurden(team: TeamNumber, jobId: string) {
    const candidate = candidateById.get(jobId);
    if (!candidate) return;
    if (candidate.difficulty === "hard") burden[team].hard += 1;
    if ((candidate.distanceFromBaseKm ?? 0) > FAR_FROM_BASE_KM) {
      burden[team].far += 1;
    }
  }

  function put(team: TeamNumber, date: string, entry: SlotEntry) {
    const cell = cellFor(team, date);
    const taken = (["am", "pm", "full"] as Slot[]).some(
      (slot) => cell[slot] && conflicts(slot, entry.slot),
    );
    if (taken) {
      cell.extra.push(entry);
    } else {
      cell[entry.slot] = entry;
    }
    if (entry.jobId) {
      used.add(entry.jobId);
      countBurden(team, entry.jobId);
    }
  }

  const inWeek = new Set(days);
  const removedThisWeek = new Set(
    draft.removals
      .filter((item) => item.weekStart === weekStart)
      .map((item) => item.jobId),
  );

  booked
    .filter((item) => inWeek.has(item.date) && !removedThisWeek.has(item.jobId))
    .forEach((item) =>
      put(item.team, item.date, {
        slot: item.slot,
        jobId: item.jobId,
        source: "booked",
        groupId: item.groupId,
      }),
    );
  draft.placements
    .filter(
      (item) =>
        item.weekStart === weekStart &&
        inWeek.has(item.date) &&
        !used.has(item.jobId) &&
        !removedThisWeek.has(item.jobId),
    )
    .forEach((item) =>
      put(item.team, item.date, {
        slot: item.slot,
        jobId: item.jobId,
        source: "placed",
      }),
    );

  // User-opened slots: kept open to other customers rather than auto-suggested
  (draft.openSlots || [])
    .filter((item) => item.weekStart === weekStart && inWeek.has(item.date))
    .forEach((item) => {
      const cell = cellFor(item.team, item.date);
      (["am", "pm", "full"] as Slot[]).forEach((slot) => {
        if (conflicts(slot, item.slot) && !cell[slot]?.jobId) {
          cell[slot] = {
            slot,
            jobId: null,
            source: "open",
          };
        }
      });
    });
  const pool = allowSuggestions
    ? candidates.filter(
        (candidate) =>
          !input.excluded.has(candidate.job.id) &&
          !removedThisWeek.has(candidate.job.id) &&
          !used.has(candidate.job.id) &&
          holdReason(candidate) === null,
      )
    : [];
  const taken = new Set<string>();

  const weight = (candidate: Candidate) =>
    (candidate.difficulty === "hard" ? 1 : 0) +
    ((candidate.distanceFromBaseKm ?? 0) > FAR_FROM_BASE_KM ? 1 : 0);

  function findPartner(
    near: Coordinates,
    date: string,
    slot: Slot,
    region: Region,
  ): { candidate: Candidate; distance: number; radius: number } | null {
    for (const radius of RADIUS_STEPS) {
      for (const candidate of pool) {
        if (taken.has(candidate.job.id)) continue;
        if (candidate.region !== region) continue;
        if (candidate.difficulty === "hard") continue;
        if (!stockAllows(candidate, date, slot)) continue;
        const distance = distanceKm(near, candidate.coords!);
        if (distance <= radius) return { candidate, distance, radius };
      }
    }
    return null;
  }

  function partnerEntry(
    near: Coordinates | null,
    date: string,
    slot: Slot,
    region: Region,
  ): SlotEntry {
    const found = near ? findPartner(near, date, slot, region) : null;
    if (!found) {
      return {
        slot,
        jobId: null,
        source: "open",
        openReason: allowSuggestions
          ? near
            ? `No ready customer within ${MAX_RADIUS_KM} km`
            : "No location to pair from"
          : "",
      };
    }
    taken.add(found.candidate.job.id);
    return {
      slot,
      jobId: found.candidate.job.id,
      source: "suggested",
      pairDistanceKm: found.distance,
      widenedKm: found.radius > DEFAULT_RADIUS_KM ? found.radius : undefined,
    };
  }

  const regions: Region[] = ["kluang", "jb"];
  const rainHold = new Set(draft.rainHoldDays);
  for (const date of days) {
    if (rainHold.has(date)) {
      // The manager put the day on hold for rain: nothing new goes on it.
      for (const team of TEAM_NUMBERS) {
        const cell = cellFor(team, date);
        if (cell.full) continue;
        (["am", "pm"] as Slot[]).forEach((slot) => {
          if (!cell[slot]) {
            cell[slot] = {
              slot,
              jobId: null,
              source: "open",
              openReason: "Rain day on hold",
            };
          }
        });
      }
      continue;
    }
    for (const region of regions) {
      const teams = TEAM_NUMBERS.filter((team) => TEAM_REGION[team] === region);

      // Crews with the whole day free take a new anchor each: the next
      // customers in priority order that can be installed that day.
      const freeTeams = teams.filter((team) => {
        const cell = cellFor(team, date);
        return !cell.am && !cell.pm && !cell.full;
      });
      const anchors: Candidate[] = [];
      for (const candidate of pool) {
        if (anchors.length >= freeTeams.length) break;
        if (taken.has(candidate.job.id) || candidate.region !== region) continue;
        const fits =
          candidate.difficulty === "hard"
            ? stockAllows(candidate, date, "full")
            : stockAllows(candidate, date, "am") ||
              stockAllows(candidate, date, "pm");
        if (!fits) continue;
        anchors.push(candidate);
        taken.add(candidate.job.id);
      }

      // Rotation: the heaviest anchors go to the crews with the least hard and
      // far work so far this week.
      const heaviestFirst = anchors
        .map((candidate, index) => ({ candidate, index }))
        .sort(
          (a, b) => weight(b.candidate) - weight(a.candidate) || a.index - b.index,
        )
        .map((item) => item.candidate);
      const lightestFirst = [...freeTeams].sort(
        (a, b) =>
          burden[a].hard + burden[a].far - (burden[b].hard + burden[b].far) ||
          a - b,
      );

      heaviestFirst.forEach((anchor, index) => {
        const team = lightestFirst[index];
        if (anchor.difficulty === "hard") {
          put(team, date, { slot: "full", jobId: anchor.job.id, source: "suggested" });
          return;
        }
        const anchorSlot: Slot = stockAllows(anchor, date, "am") ? "am" : "pm";
        const partnerSlot: Slot = anchorSlot === "am" ? "pm" : "am";
        put(team, date, { slot: anchorSlot, jobId: anchor.job.id, source: "suggested" });
        put(team, date, partnerEntry(anchor.coords, date, partnerSlot, region));
      });

      // Crews with one slot already taken get a partner near that customer.
      for (const team of teams) {
        const cell = cellFor(team, date);
        if (cell.full || (cell.am && cell.pm)) continue;
        const occupied = cell.am ?? cell.pm;
        if (!occupied) continue;
        const freeSlot: Slot = cell.am ? "pm" : "am";
        const near = occupied.jobId ? input.coordsFor(occupied.jobId) : null;
        put(team, date, partnerEntry(near, date, freeSlot, region));
      }

      // Anything still empty is open.
      for (const team of teams) {
        const cell = cellFor(team, date);
        if (cell.full) continue;
        (["am", "pm"] as Slot[]).forEach((slot) => {
          if (!cell[slot]) {
            cell[slot] = {
              slot,
              jobId: null,
              source: "open",
              openReason: allowSuggestions ? "No ready customer left" : "",
            };
          }
        });
      }
    }
  }

  const teams: TeamWeek[] = TEAM_NUMBERS.map((team) => ({
    team,
    hard: burden[team].hard,
    far: burden[team].far,
    days: days.map((date) => {
      const cell = cellFor(team, date);
      const entries = cell.full
        ? [cell.full, ...cell.extra]
        : [cell.am!, cell.pm!, ...cell.extra];
      return { team, date, entries };
    }),
  }));

  const jobIds = new Set<string>();
  teams.forEach((week) =>
    week.days.forEach((day) =>
      day.entries.forEach((entry) => entry.jobId && jobIds.add(entry.jobId)),
    ),
  );
  return { weekStart, days, teams, jobIds };
}

// The selected week, with every planning week before it worked out first so a
// customer suggested for an earlier week is not offered again in a later one.
export function buildSchedule(args: {
  weekStart: string;
  todayIso: string;
  candidates: Candidate[];
  booked: BookedSlot[];
  bookedJobIds: Set<string>;
  draft: ScheduleDraft;
  coordsFor: (jobId: string) => Coordinates | null;
}): WeekSchedule {
  const candidateById = new Map(
    args.candidates.map((candidate) => [candidate.job.id, candidate]),
  );
  const firstWeek = firstPlanningWeek(args.todayIso);
  const suggestedEarlier = new Set<string>();

  const excludedFor = (weekStart: string) => {
    const excluded = new Set<string>([...args.bookedJobIds, ...suggestedEarlier]);
    args.draft.placements.forEach((placement) => {
      if (placement.weekStart !== weekStart) excluded.add(placement.jobId);
    });
    return excluded;
  };

  const weekInput = (weekStart: string, allowSuggestions: boolean): WeekInput => ({
    weekStart,
    candidates: args.candidates,
    candidateById,
    booked: args.booked,
    draft: args.draft,
    excluded: excludedFor(weekStart),
    allowSuggestions,
    coordsFor: args.coordsFor,
  });

  if (args.weekStart < firstWeek) {
    return buildWeek(weekInput(args.weekStart, false));
  }

  let week = firstWeek;
  // Bounded: at most a year ahead, however far someone clicks.
  for (let guard = 0; week < args.weekStart && guard < 52; guard += 1) {
    const earlier = buildWeek(weekInput(week, true));
    earlier.teams.forEach((team) =>
      team.days.forEach((day) =>
        day.entries.forEach((entry) => {
          if (entry.source === "suggested" && entry.jobId) {
            suggestedEarlier.add(entry.jobId);
          }
        }),
      ),
    );
    week = addDays(week, 7);
  }
  return buildWeek(weekInput(args.weekStart, true));
}
