"use client";

import {
  AlertTriangle,
  Calendar,
  CalendarDays,
  CalendarOff,
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ChevronUp,
  Clock3,
  CloudLightning,
  CloudRain,
  CloudSun,
  Columns,
  Download,
  FileSearch,
  Info,
  LoaderCircle,
  LogOut,
  MapPin,
  MessageCircle,
  Moon,
  PackageCheck,
  Phone,
  Pin,
  PinOff,
  Plus,
  RefreshCw,
  Search,
  Settings,
  ShieldCheck,
  Snowflake,
  Sun,
  Trash2,
  Truck,
  Users,
  Wallet,
  X,
  Zap,
} from "lucide-react";
import {
  Fragment,
  useCallback,
  useDeferredValue,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import dynamic from "next/dynamic";
import {
  APPROVAL_PAYMENT_PERCENT,
  READY_PAYMENT_PERCENT,
  hasReachedPaymentPercent,
  isSedaApproved,
  normalizeAvailabilityStatus,
  type CalendarDayDetail,
  type CustomerAvailabilityStatus,
  type InstallationJob,
  type JobUpdate,
  type JobVisit,
  type SiteAssessment,
  type TeamAssignment,
} from "@/lib/types";
import {
  EMPTY_DRAFT,
  REGION_LABEL,
  TEAM_REGION,
  normalizeDraft,
  type ScheduleDraft,
  type TeamNumber,
} from "@/lib/schedule-suggest";
import type { UpdateStatus } from "@/lib/electron-desktop";
import {
  MALAYSIA_PUBLIC_HOLIDAYS,
  fetchDailyWeather,
} from "@/lib/calendar-weather";
import { buildCalendarDayDetails } from "@/lib/calendar-day-details";
import { malaysiaToday } from "@/lib/dates";
import {
  addDays,
  confirmedInstallationDate,
  hasPlannedDate,
  isCompleteInstallation,
  needsCompletionVerification,
  resolvedAvailabilityStatus,
  signalsPendingComplete,
} from "@/lib/completion";
import { ROUTE_METHOD_LABELS } from "@/lib/routing";
import SidebarCalendar from "@/app/components/SidebarCalendar";
import GroupMultiSelect from "@/app/components/GroupMultiSelect";
import WeatherGlyph from "@/app/components/WeatherGlyph";
import ReadyToInstallSchedule from "@/app/components/ReadyToInstallSchedule";
import DepositScheduleTable, {
  isJobReschedule,
  isJobPending,
  isJobNeedAttention,
  getJobReviewColor,
  isSpecialCaseApproval,
  isJobOM,
} from "@/app/components/DepositScheduleTable";

const PlanningMap = dynamic(() => import("@/app/components/PlanningMap"), {
  ssr: false,
});

type JobsResponse = {
  jobs: InstallationJob[];
  source: "live" | "demo";
  persistence: "api-db" | "browser";
  warning: string | null;
  syncedAt: string;
  sourceUpdatedAt: string | null;
};

type DashboardView = "groups" | "delivery";

const DASHBOARD_PAGES: Record<DashboardView, { title: string; blurb: string }> = {
  groups: {
    title: "Installation Schedule",
    blurb: "Customers grouped by location and installation date.",
  },
  delivery: {
    title: "Delivery Schedule",
    blurb: "Group customer materials into warehouse delivery routes.",
  },
};

// A skylift booked for the crew — either a single day (until empty) or a
// from/until range. Retired along with the Skylift column it was kept for;
// the type stays only so migrateGroupSkylift below can still type-check
// reading a booking left over from before the column was removed.
type SkyliftBooking = {
  name: string;
  from: string;
  until?: string;
};

type InstallationGroup = {
  id: string;
  name: string;
  area: string;
  installationDate: string;
  installationEndDate: string;
  jobIds: string[];
  installationTeam: string;
  wiringTeam: string;
  // More than one is normal — two supervisors splitting a week, or covering
  // for each other on different days.
  supervisors: string[];
  // Retired — see migrateGroupSupervisor. A group made before supervisors
  // was a list carries its one name here instead; migrated into supervisors
  // as a single entry (not split apart) the first time the group loads.
  supervisor?: string;
  // The sheet's slot label for the crew — "Team 3". Separate from the crew
  // names because the same label carries different crews across weeks.
  teamLabel?: string;
  // That week's wiring crew members, as the sheet lists them.
  wiringMembers?: string[];
  // Vehicles the crew takes out — more than one is normal ("Van + Myvi").
  cars?: string[];
  // Retired — see SkyliftBooking and migrateGroupSkylift. Never written to
  // by anything still in the app; only ever read from an older saved group
  // on its way to being folded into remark.
  skylifts?: SkyliftBooking[];
  // Only ever the starting note for a crew booking that has nobody on it yet —
  // "Add Team" makes such a row, and there is no customer to hang a remark on
  // until one is assigned. Remarks belong to customers, so the first customer
  // added to this booking starts from this text and owns their copy from the
  // first edit onwards. Optional: bookings made before the column existed, and
  // every booking whose note was typed against a customer, have no value here.
  remark?: string;
};

function skyliftBookingLabel(entry: SkyliftBooking) {
  const from = entry.from ? formatDateOnly(entry.from) : "";
  const until = entry.until ? ` – ${formatDateOnly(entry.until)}` : "";
  return [entry.name, from ? `${from}${until}` : ""].filter(Boolean).join(" · ");
}

// One-time migration off the retired Skylift column: any booking a group
// still carries is folded into its remark instead of quietly disappearing
// once the column stops reading it, using the same text the column itself
// used to show. Idempotent — a group with nothing left in skylifts (already
// migrated, or never had any) is returned as-is rather than a new object, so
// callers can tell whether anything actually changed by comparing reference.
function migrateGroupSkylift(group: InstallationGroup): InstallationGroup {
  const skylifts = group.skylifts ?? [];
  if (skylifts.length === 0) return group;
  const { skylifts: _retired, ...rest } = group;
  const skyliftNote = `Skylift: ${skylifts.map(skyliftBookingLabel).join("; ")}`;
  return {
    ...rest,
    remark: [group.remark, skyliftNote].filter(Boolean).join(" · "),
  };
}

// One-time migration off the single-value Supervisor field: the one name a
// group already carries becomes the first (and, until someone adds another,
// only) entry in supervisors — never split apart, since "Kaijie/Ahzu" and
// "Kaikian (Mon & Tue), Ahzu (Wed)" are exactly as likely to be one typed
// value as two names jammed together, and guessing wrong would invent a
// person. Idempotent, same as migrateGroupSkylift above.
function migrateGroupSupervisor(group: InstallationGroup): InstallationGroup {
  if (group.supervisors) return group;
  const { supervisor, ...rest } = group;
  const trimmed = supervisor?.trim();
  return {
    ...rest,
    supervisors: trimmed ? [trimmed] : [],
  };
}

type DeliveryRun = {
  id: string;
  name: string;
  deliveryDate: string;
  // Departure time from the warehouse, "HH:mm". Kept separate from
  // deliveryDate so every existing date comparison stays a plain string
  // match; it is the clock the per-customer ETAs are counted from.
  departureTime?: string;
  warehouse: string;
  // Full street address of the warehouse the lorry departs from. Separate
  // from `warehouse`, which is a short label ("JB") used for display — this
  // is the text handed to the geocoder, so it has to be a real address.
  warehouseAddress?: string;
  deliveryTeam: string;
  deliveryPic: string;
  contactNumber: string;
  installationGroupId: string;
  status: "pending_stock" | "ready" | "in_transit" | "delivered";
  jobIds: string[];
};

// The warehouses a delivery run can depart from, kept as their own list below
// the Stock delivery table rather than retyped into every run. A run stores
// the warehouse *name*; the address behind that name is looked up here, which
// is what the ETA route geocodes.
type Warehouse = {
  id: string;
  name: string;
  city: string;
  address: string;
};

// The roles a team can be given in Installation groups. Rendered by all three
// role dropdowns from this one list so they cannot drift apart.
const TEAM_ROLES = [
  { value: "installation", label: "Installation" },
  { value: "wiring", label: "Wiring" },
  { value: "installer_ar17", label: "Installer AR17" },
  { value: "installer_eternalgy", label: "Installer Eternalgy" },
  { value: "wiring_eternalgy", label: "Wiring Eternalgy" },
] as const;

type TeamResource = {
  id: string;
  name: string;
  role: (typeof TEAM_ROLES)[number]["value"];
  baseLocation: string;
  contact: string;
  members: string[];
  // Typed in by an admin on the Installation groups page. Optional because
  // teams saved before the column existed have no value for it.
  siteSupervisor?: string;
};

// Wiring crews do the cable work; every other role is an installation crew.
// The split is decided here rather than by comparing against "wiring" at each
// call site, so adding a role above cannot silently drop it on the wrong side.
function isWiringRole(role: TeamResource["role"]) {
  return role === "wiring" || role === "wiring_eternalgy";
}

function teamRoleLabel(role: TeamResource["role"]) {
  return TEAM_ROLES.find((item) => item.value === role)?.label ?? "Installation";
}

type TeamWeekAssignment = {
  id: string;
  teamId: string;
  // A single point in time, "YYYY-MM-DDTHH:mm", as produced by
  // `<input type="datetime-local">`. Assignments saved before this was a
  // date-and-time carry a bare "YYYY-MM-DD" here, which still sorts and
  // displays correctly.
  startDate: string;
  // Retired: assignments used to span a range. Kept on the type so records
  // already in the shared database round-trip unchanged instead of losing a
  // field on the next save.
  endDate?: string;
  installationGroupId: string;
};

/**
 * The customers that make a group worth assigning a crew to.
 *
 * Two conditions, both about the customer rather than the group:
 *
 * - They have an installation date. That is their own date if they carry one,
 *   otherwise the group's — the same fallback the customer detail panel uses,
 *   so a customer reads as dated in the dropdown exactly when they read as
 *   dated on their own record.
 * - Their availability is Available or Pending. Unavailable and cancelled
 *   customers have dropped out of planning altogether and are ignored, so one
 *   cancellation cannot hold back a group whose others are ready.
 */
function schedulableMembers(group: InstallationGroup, jobs: InstallationJob[]) {
  return jobs.filter(
    (job) =>
      group.jobIds.includes(job.id) &&
      Boolean(job.installationDate || group.installationDate),
  );
}

// A looser bar than schedulableMembers: no installation date needed yet, just
// a customer who has confirmed (or nearly confirmed) on Customer Scheduling.
// Feeds the Team management "Customer Group" picker, so a crew can be lined
// up against a group before anyone has set a date for it.
function groupHasSchedulingReadyMember(
  group: InstallationGroup,
  jobs: InstallationJob[],
) {
  return jobs.some(
    (job) =>
      group.jobIds.includes(job.id) && isSchedulingInPlay(job),
  );
}

/**
 * A group-level rollup shown on the Team management group picker, not a
 * customer status: Available once every dated member has a date on the table,
 * Pending while any of them has not. Only the customers that qualified the
 * group are consulted — an undated customer never put the group in the list,
 * so it does not get to hold the group at Pending either.
 */
function groupAvailability(group: InstallationGroup, jobs: InstallationJob[]) {
  const members = schedulableMembers(group, jobs);
  const settled =
    members.length > 0 &&
    members.every((job) => job.customerAvailabilityStatus === "propose");
  return settled ? "Available" : "Pending";
}

// The date to show against a group: its own if it has one, otherwise the
// earliest date among the customers that qualified it.
function groupDisplayDate(group: InstallationGroup, jobs: InstallationJob[]) {
  if (group.installationDate) return group.installationDate;
  return schedulableMembers(group, jobs)
    .map((job) => job.installationDate)
    .filter((date): date is string => Boolean(date))
    .sort()[0];
}

// Constructing an Intl.DateTimeFormat is expensive — far more so than calling
// .format() on one — and these were previously built inline, including inside
// the pipeline table's row body. At a few thousand rows that was tens of
// thousands of constructions per render. Built once at module scope instead;
// formatters are stateless and safe to share.
//
// DATE_KL and DATE_PLAIN differ only by time zone, and that difference is
// load-bearing: values that are true instants (payment timestamps) have to be
// read in Malaysian time, while plain "YYYY-MM-DD" values are already local
// and are parsed at midnight, so giving those a zone can shift them a day.
const DATE_PLAIN = new Intl.DateTimeFormat("en-MY", {
  day: "numeric",
  month: "short",
  year: "numeric",
});
const DATE_KL = new Intl.DateTimeFormat("en-MY", {
  day: "numeric",
  month: "short",
  year: "numeric",
  timeZone: "Asia/Kuala_Lumpur",
});
const DATE_TIME_KL = new Intl.DateTimeFormat("en-MY", {
  day: "numeric",
  month: "short",
  year: "numeric",
  hour: "numeric",
  minute: "2-digit",
  timeZone: "Asia/Kuala_Lumpur",
});
const WEEKDAY_KL = new Intl.DateTimeFormat("en-MY", {
  weekday: "long",
  day: "numeric",
  month: "long",
  year: "numeric",
  timeZone: "Asia/Kuala_Lumpur",
});
const DAY_MONTH = new Intl.DateTimeFormat("en-MY", {
  day: "numeric",
  month: "short",
});
const TIME_KL = new Intl.DateTimeFormat("en-MY", {
  hour: "numeric",
  minute: "2-digit",
  timeZone: "Asia/Kuala_Lumpur",
});

// Assignment stamps are stored as plain local strings rather than instants, so
// they are split on the "T" instead of parsed — the same reasoning as
// lib/dates.ts, where reparsing a zone-less value can move it a day.
// A plain ISO date ("2026-08-10") shown the way every other date on the page
// reads. Display only — the date inputs still bind to the raw ISO value.
function formatDateOnly(value: string | null | undefined) {
  if (!value) return "Not set";
  const date = new Date(`${value}T00:00:00`);
  if (Number.isNaN(date.getTime())) return value;
  return DATE_PLAIN.format(date);
}

function formatAssignmentStamp(value: string) {
  if (!value) return "Not set";
  const [datePart, timePart] = value.split("T");
  const date = new Date(`${datePart}T00:00:00`);
  if (Number.isNaN(date.getTime())) return value;
  const label = DATE_PLAIN.format(date);
  return timePart ? `${label}, ${timePart.slice(0, 5)}` : label;
}

const STORAGE_KEY = "installation-ops-updates-v1";
const GROUPS_STORAGE_KEY = "installation-ops-groups-v1";
const DELIVERY_RUNS_STORAGE_KEY = "installation-ops-delivery-runs-v1";
const WAREHOUSES_STORAGE_KEY = "installation-ops-warehouses-v1";
const TEAMS_STORAGE_KEY = "installation-ops-team-resources-v1";
const TEAM_WEEKS_STORAGE_KEY = "installation-ops-team-weeks-v1";
const TEAM_SUGGESTIONS_STORAGE_KEY = "installation-ops-team-suggestions-v1";
const THEME_STORAGE_KEY = "installation-ops-theme";
const SIDEBAR_STORAGE_KEY = "installation-ops-sidebar";
const PINNED_JOBS_STORAGE_KEY = "installation-ops-pinned-jobs-v1";
// Week bands the user has pinned to the top of the Installation groups table.
// Per-device like the pipeline's pinned jobs — a pin is how one person keeps
// the week they are working on in view, not a decision for the whole team.
const PINNED_WEEKS_STORAGE_KEY = "installation-ops-pinned-weeks-v1";
const HIDDEN_CREW_COLUMNS_STORAGE_KEY =
  "installation-ops-hidden-crew-columns-v1";
// Unlike the pin keys above, frozen rows are shared ops data (see
// SharedOpsState) — this key only caches the last-known set locally so the
// page has something to show before the shared store answers, or if it
// cannot be reached at all.
const FROZEN_JOBS_STORAGE_KEY = "installation-ops-frozen-jobs-v1";
// Local caches of the shared roof ratings and schedule draft, for the same
// reason as the frozen-jobs key above.
const SITE_ASSESSMENTS_STORAGE_KEY = "installation-ops-site-assessments-v1";
const SCHEDULE_DRAFT_STORAGE_KEY = "installation-ops-schedule-draft-v1";

function formatPersonName(name: string) {
  return name
    .trim()
    .toLocaleLowerCase("en-MY")
    .replace(/(^|[\s(/'-])\p{L}/gu, (letter) => letter.toLocaleUpperCase("en-MY"));
}

function formatCustomerAddress(address: string) {
  return address ? formatPersonName(address) : address;
}

// "2026-08-11T16:40" -> "16:40". Assignments saved before the field carried a
// clock are a bare "YYYY-MM-DD", which has no time to show rather than a
// midnight one — reporting 00:00 for those would invent a crew start.
function timeOfDay(stamp: string): string | null {
  const time = stamp.split("T")[1];
  return time ? time.slice(0, 5) : null;
}


function dateKey(date: Date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function groupStaffing(group: InstallationGroup): "full" | "partial" | "none" {
  const hasInstallation = Boolean(group.installationTeam);
  const hasWiring = Boolean(group.wiringTeam);
  if (hasInstallation && hasWiring) return "full";
  if (hasInstallation || hasWiring) return "partial";
  return "none";
}

function staffingLabel(staffing: "full" | "partial" | "none") {
  if (staffing === "full") return "Fully assigned";
  if (staffing === "partial") return "Partially assigned";
  return "Unassigned";
}


function holidayForDate(dateStr: string): string | null {
  return MALAYSIA_PUBLIC_HOLIDAYS[dateStr] || null;
}

function toIsoDate(date: Date) {
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${date.getFullYear()}-${month}-${day}`;
}

// Has `limit` working days gone by since `startIso`? Weekends and Malaysian
// public holidays do not count towards the total.
//
// It walks forward day by day and stops the moment the limit is reached, so a
// job whose payment landed three years ago costs the same handful of steps as
// one from last month rather than a walk through a thousand days of calendar.
// Note the holiday table only covers 2026 — windows spanning earlier years
// count those years' holidays as ordinary working days, which shifts the
// answer by at most a few days on jobs that are already long overdue.
function hasWorkingDaysElapsed(
  startIso: string,
  todayIso: string,
  limit: number,
) {
  const cursor = new Date(`${startIso}T00:00:00`);
  const end = new Date(`${todayIso}T00:00:00`);
  if (Number.isNaN(cursor.getTime()) || Number.isNaN(end.getTime())) {
    return false;
  }

  let counted = 0;
  while (counted < limit) {
    cursor.setDate(cursor.getDate() + 1);
    if (cursor > end) return false;
    const weekday = cursor.getDay();
    if (weekday === 0 || weekday === 6) continue;
    if (holidayForDate(toIsoDate(cursor))) continue;
    counted += 1;
  }
  return true;
}

// Anything older than this means the upstream sync has stopped feeding us, not
// that business was quiet — the source is edited many times on a working day.
const STALE_SOURCE_HOURS = 24;

// Describes how old the data is, which is the number that actually matters.
// The fetch time always looks current even when the upstream sync has been
// dead for days, so showing that alone hides an outage rather than surfacing it.
function describeSourceAge(iso: string | null) {
  if (!iso) return null;
  const updated = new Date(iso);
  if (Number.isNaN(updated.getTime())) return null;

  const hours = (Date.now() - updated.getTime()) / 3_600_000;
  const date = DATE_TIME_KL.format(updated);

  let elapsed: string;
  if (hours < 1) elapsed = "under an hour";
  else if (hours < 24) elapsed = `${Math.round(hours)}h`;
  else {
    const days = Math.floor(hours / 24);
    elapsed = `${days} day${days === 1 ? "" : "s"}`;
  }

  const stale = hours >= STALE_SOURCE_HOURS;
  // Worded as an absence rather than an age. "Source data 5 days ago" reads as
  // "this dashboard has not looked recently", so pressing refresh and watching
  // it not move looks like a broken button; what it actually means is that the
  // refresh did run and found nothing newer upstream.
  const headline = stale
    ? `No new source data in ${elapsed} — sync may have stopped`
    : hours < 1
      ? "Source data just now"
      : `Source data ${elapsed} ago`;

  return { date, headline, stale };
}

function formatWeekRange(weekDates: Date[]) {
  const start = weekDates[0];
  const end = weekDates[6];
  const sameMonth = start.getMonth() === end.getMonth();
  const startLabel = start.toLocaleDateString("en-MY", {
    day: "numeric",
    month: sameMonth ? undefined : "short",
  });
  const endLabel = end.toLocaleDateString("en-MY", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
  return `${startLabel} – ${endLabel}`;
}

const WEATHER_COORDINATES_BY_POSTCODE_PREFIX: Record<
  string,
  { latitude: number; longitude: number }
> = {
  "433": { latitude: 3.026, longitude: 101.706 },
  "791": { latitude: 1.423, longitude: 103.635 },
  "810": { latitude: 1.656, longitude: 103.603 },
  "811": { latitude: 1.56, longitude: 103.75 },
  "812": { latitude: 1.5, longitude: 103.7 },
  "813": { latitude: 1.537, longitude: 103.657 },
  "817": { latitude: 1.47, longitude: 103.895 },
  "818": { latitude: 1.599, longitude: 103.817 },
  "830": { latitude: 1.855, longitude: 102.933 },
  "831": { latitude: 1.855, longitude: 102.933 },
  "832": { latitude: 1.855, longitude: 102.933 },
  "837": { latitude: 2.014, longitude: 103.065 },
  "860": { latitude: 2.031, longitude: 103.318 },
};

// Postcode prefixes run in rough geographic order, so an unknown prefix falls
// back to the nearest known one instead of dropping the group's weather. The
// range is kept tight (same district, roughly) so e.g. a Selangor postcode
// never borrows a Johor forecast. Paloh (86600) resolves to 860 / Kluang.
const WEATHER_PREFIX_FALLBACK_RANGE = 20;

// Open-Meteo forecasts 16 days ahead; anything further out simply has no data.
const NO_FORECAST_HINT = "No forecast yet — available about 2 weeks ahead";

// How many distinct postcode areas the calendar will fetch a forecast for when
// it is falling back to the ungrouped pipeline. One request each, and the
// per-date merge keeps the wettest reading, so this is a "worst case across
// where we work" summary rather than an exhaustive per-site forecast.
const WEATHER_LOCATION_LIMIT = 5;

function weatherCoordinatesForPostcode(postcode: string) {
  const prefix = postcode.slice(0, 3);
  if (!prefix) return null;

  const exact = WEATHER_COORDINATES_BY_POSTCODE_PREFIX[prefix];
  if (exact) return { prefix, coordinates: exact };

  const target = Number(prefix);
  if (!Number.isFinite(target)) return null;

  let nearest: { prefix: string; distance: number } | null = null;
  for (const known of Object.keys(WEATHER_COORDINATES_BY_POSTCODE_PREFIX)) {
    const distance = Math.abs(Number(known) - target);
    if (
      distance <= WEATHER_PREFIX_FALLBACK_RANGE &&
      (!nearest || distance < nearest.distance)
    ) {
      nearest = { prefix: known, distance };
    }
  }

  return nearest
    ? {
        prefix: nearest.prefix,
        coordinates: WEATHER_COORDINATES_BY_POSTCODE_PREFIX[nearest.prefix],
      }
    : null;
}

const defaultTeamResources: TeamResource[] = [
  { id: "install-a", name: "Installation Team A", role: "installation", baseLocation: "Johor Bahru", contact: "", members: [] },
  { id: "install-b", name: "Installation Team B", role: "installation", baseLocation: "Kluang", contact: "", members: [] },
  { id: "install-c", name: "Installation Team C", role: "installation", baseLocation: "Kulai", contact: "", members: [] },
  { id: "install-d", name: "Installation Team D", role: "installation", baseLocation: "Muar", contact: "", members: [] },
  { id: "wiring-1", name: "Wiring Team 1", role: "wiring", baseLocation: "Johor Bahru", contact: "", members: [] },
  { id: "wiring-2", name: "Wiring Team 2", role: "wiring", baseLocation: "Kulai", contact: "", members: [] },
  { id: "wiring-3", name: "Wiring Team 3", role: "wiring", baseLocation: "Kluang", contact: "", members: [] },
  { id: "wiring-4", name: "Wiring Team 4", role: "wiring", baseLocation: "Muar", contact: "", members: [] },
];

const deliveryTeams = [
  "Delivery Team 1",
  "Delivery Team 2",
  "Delivery Team 3",
  "Delivery Team 4",
];

const statusLabels: Record<InstallationJob["scheduleStatus"], string> = {
  ready_to_schedule: "Ready to schedule",
  pending_approval: "Pending approval",
  pending_installation: "Pending installation",
  ready_to_install: "Ready to install",
  installed: "Installed",
  reschedule_required: "Reschedule",
};

function scheduleStatusKind(
  status: InstallationJob["scheduleStatus"],
): "good" | "warning" | "danger" {
  if (status === "installed" || status === "ready_to_install") return "good";
  if (status === "pending_approval") return "danger";
  return "warning";
}

const availabilityLabels: Record<CustomerAvailabilityStatus, string> = {
  not_set: "Not Set",
  propose: "Propose",
  reschedule: "Reschedule",
  pending_complete: "Pending Complete",
  complete: "Complete",
};

// Customer Scheduling's definition of "in play": the customer is still active
// work. Everything except the two ends of the list — nobody has started on a
// Not Set customer, and there is nothing left to plan for a Complete one.
// Named rather than repeated inline so the three places that ask this question
// cannot drift apart.
function isSchedulingInPlay(job: InstallationJob) {
  return (
    job.customerAvailabilityStatus === "propose" ||
    job.customerAvailabilityStatus === "reschedule" ||
    job.customerAvailabilityStatus === "pending_complete"
  );
}

// The statuses that get the second date field on Customer Scheduling. Both are
// customers whose original date no longer stands: a Reschedule has called it
// off outright, and a Pending Complete is held up by something — wiring, a
// battery — that will need a new day booked once it clears. Cancellations read
// as Reschedule now, so a called-off date arrives here too.
function awaitsNewDate(job: InstallationJob) {
  return (
    job.customerAvailabilityStatus === "reschedule" ||
    job.customerAvailabilityStatus === "pending_complete"
  );
}

// One of those customers with no replacement date yet. The whole point of the
// status is to get that date agreed, so Customer Scheduling marks these rows
// until one is.
// Deliberately narrower than awaitsNewDate: only a Reschedule is chased for
// the missing date. Getting a replacement agreed is the entire point of that
// status, whereas a Pending Complete is usually waiting on wiring or a battery
// rather than on the customer — flagging all of those amber would mark 34 of
// the 36 rows for something that is not what is actually holding them up. They
// still get the field, just not the marker.
function needsNewDate(job: InstallationJob) {
  return (
    job.customerAvailabilityStatus === "reschedule" &&
    !job.secondPreferredInstallationDate
  );
}

// No availability status takes a customer out of planning any more. The two
// that used to — "unavailable" and "cancelled" — are gone, and a cancelled
// date now reads as Reschedule, which is active work by definition: the job
// still has to be booked, just on a day nobody has agreed yet. Completed jobs
// leave planning by having been done (isHiddenAsCompleted), not by status.


// A booked date that is at least a full day gone counts as installed, without
// waiting on the source system to record the sign-off — otherwise a finished
// job sits on the chase list forever just because nobody marked it.
//
// Availability is deliberately not consulted for the job's own or the
// group's date: admin cancels a customer before the installation date, so a
// date that was allowed to pass is a date that was kept. A cancellation
// arriving after the fact is corrected on the job itself rather than by
// holding every finished job back waiting for a sign-off. (The preferred
// date is the exception — confirmedInstallationDate only counts it while
// the customer is Available, which is what makes it a booking at all.)
// How long after its booked day a job is taken to be finished. Three days
// rather than one: an install that ran late, or slipped to the next morning,
// should not be filed as done while the crew may still be on site.

// Plain "YYYY-MM-DD" plus n days, read back field by field. Not via
// toISOString, which would return UTC and slip a day at UTC+8 — the same trap
// lib/dates.ts documents.



// Group and delivery-run membership live outside the job record, so any
// question about how arranged a job is needs both maps alongside it.
type PlanningLookup = {
  groupByJobId: Map<string, InstallationGroup>;
  deliveryRunByJobId: Map<string, DeliveryRun>;
};

// Builds groupByJobId / deliveryRunByJobId: when a customer sits in more than
// one group or run — a reschedule picked up before the old booking was
// cleared out — the one with the latest date is the one actually current, not
// whichever happens to be last in the list. That matters especially for
// delivery runs, where a brand new run is prepended to the front so it is
// last to be visited here, leaving the stale old one to win by coincidence of
// list order rather than by date.
function latestByJobId<T extends { jobIds: string[] }>(
  items: T[],
  dateOf: (item: T) => string,
): Map<string, T> {
  const result = new Map<string, T>();
  items.forEach((item) => {
    const date = dateOf(item);
    item.jobIds.forEach((jobId) => {
      const current = result.get(jobId);
      if (!current || date > dateOf(current)) {
        result.set(jobId, item);
      }
    });
  });
  return result;
}

// The five arrangement columns on Customer details, in the order they appear
// there. Each test mirrors what its column renders, so a row showing a value
// while the filter disagrees about it is not possible.
function planningGaps(job: InstallationJob, lookup: PlanningLookup): string[] {
  const group = lookup.groupByJobId.get(job.id) ?? null;
  const gaps: string[] = [];
  if (!group?.installationTeam && !group?.wiringTeam) gaps.push("teams");
  if (!group) gaps.push("group");
  if (!lookup.deliveryRunByJobId.get(job.id)) gaps.push("delivery run");
  if (!job.stockDetails.trim()) gaps.push("stock details");
  // The confirmed date, by the one shared definition — their own, their
  // group's, or the Customer Scheduling date of an Available customer. A
  // Pending customer's preferred date still shows in the column labelled as
  // a proposal, and a proposal is not a booking.
  if (!confirmedInstallationDate(job, group)) {
    gaps.push("installation date");
  }
  return gaps;
}

function isFullyPlanned(job: InstallationJob, lookup: PlanningLookup) {
  return planningGaps(job, lookup).length === 0;
}

// Financially free to move: paid to the approval line or above, or carrying
// an approved exception for a job that has not reached it.
function hasPlanningEligibility(job: InstallationJob) {
  return (
    hasReachedPaymentPercent(job.paymentPercent, APPROVAL_PAYMENT_PERCENT) ||
    job.paymentOverrideStatus === "approved"
  );
}

// The 2nd payment date as a sortable number, negated so the most recent
// payment ranks lowest and leads — the office works from the current month
// down. A missing or unparseable date sorts last, matching the pipeline table.
function secondPaymentRank(job: InstallationJob): number {
  if (!job.secondPaymentDate) return Number.POSITIVE_INFINITY;
  const time = new Date(job.secondPaymentDate).getTime();
  return Number.isNaN(time) ? Number.POSITIVE_INFINITY : -time;
}

// Newest 2nd payment first, so the current month leads.
function compareBySecondPayment(a: InstallationJob, b: InstallationJob) {
  const order = secondPaymentRank(a) - secondPaymentRank(b);
  // Two undated jobs give Infinity - Infinity, which is NaN — fall back to the
  // name so their order stays stable instead of being left to sort's whim.
  if (Number.isNaN(order) || order === 0) {
    return a.customerName.localeCompare(b.customerName);
  }
  return order;
}

const MONTH_NAMES = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];

// The 2nd payment filter is a text search rather than a month picker. A month
// input can only ever express one exact month, so "everything in 2026" or
// "every August" was unaskable; the office also says "august", not "2026-08".
//
// Every way of naming the payment's month goes into one haystack — the ISO
// date, the "YYYY-MM" the old picker produced, the year, the month's full and
// short names — and every word typed has to appear somewhere in it. So
// "august" spans years, "2026" spans months, and "august 2026" narrows to the
// one month, without needing a parser for any of those shapes. Keeping
// "YYYY-MM" in the haystack means a filter left over from the month picker
// still matches exactly the jobs it used to.
//
// Every period filter on the dashboard runs through here — 2nd payment on
// Customer details and Customer Scheduling, installation date on Installation
// groups, delivery date on Stock delivery — so "august" means the same thing on
// every tab.
function matchesDateSearch(iso: string | null | undefined, query: string) {
  const needle = query.trim().toLowerCase();
  if (!needle) return true;
  // A record with no date cannot match a search about one, so it drops out
  // while the filter is set — as it did under the pickers this replaced.
  if (!iso) return false;
  const [year, month] = iso.split("-");
  const name = (MONTH_NAMES[Number(month) - 1] ?? "").toLowerCase();
  const haystack = [iso, `${year}-${month}`, year, name, name.slice(0, 3)]
    .join(" ")
    .toLowerCase();
  return needle.split(/\s+/).every((word) => haystack.includes(word));
}

// Shared by all three places that narrow on this field — Customer details,
// Customer Scheduling's card counts, and its table — so a card can never
// disagree with the list it opens.
function matchesSecondPaymentSearch(job: InstallationJob, query: string) {
  return matchesDateSearch(job.secondPaymentDate, query);
}

// A location group is ranked by its most recent 2nd payment, so the postcodes
// with this month's customers surface first.
function groupSecondPaymentRank(customers: InstallationJob[]): number {
  return customers.reduce(
    (newest, job) => Math.min(newest, secondPaymentRank(job)),
    Number.POSITIVE_INFINITY,
  );
}

function compareGroupsBySecondPayment(
  a: { area: string; customers: InstallationJob[] },
  b: { area: string; customers: InstallationJob[] },
) {
  const order =
    groupSecondPaymentRank(a.customers) - groupSecondPaymentRank(b.customers);
  if (Number.isNaN(order) || order === 0) {
    return a.area.localeCompare(b.area);
  }
  return order;
}

const approvalLabels: Record<
  InstallationJob["installationApprovalStatus"],
  string
> = {
  date_approved: "Date approved",
  pending_approval_date: "Pending approval date",
  pending_seda_approval: "Pending SEDA approval",
  other: "Other",
};

const deliveryLabels: Record<InstallationJob["deliveryStatus"], string> = {
  not_planned: "Not planned",
  pending_stock: "Pending stock",
  delivery_scheduled: "Delivery scheduled",
  delivered: "Delivered",
  partially_delivered: "Partially delivered",
};

// Delivery runs carry their own status, separate from the per-job delivery
// status the source seeds.
const deliveryRunStatusLabels: Record<DeliveryRun["status"], string> = {
  pending_stock: "Pending stock",
  ready: "Ready",
  in_transit: "In transit",
  delivered: "Delivered",
};

const installationActivities: {
  value: TeamAssignment["activity"];
  label: string;
}[] = [
  { value: "hooks_rails", label: "Hooks and rails structure at roof" },
  { value: "pv_panels", label: "PV panel installation work" },
  {
    value: "cable_trunking",
    label: "DC & AC cable trunking/casing/conduit works",
  },
  {
    value: "earthing",
    label: "Earthing cable mount to PV structure",
  },
  { value: "inverter_installation", label: "Inverter installation work" },
  { value: "dc_cable_inverter", label: "DC cable connect to inverter" },
  { value: "ac_cable_house_elc", label: "AC cable connect to house ELC" },
  {
    value: "pv_meter_termination",
    label: "Termination at PV meter & circuit breaker",
  },
  { value: "mobile_app_wifi_setup", label: "Mobile app & WiFi Setup" },
  { value: "saj_string_inverter", label: "SAJ String Inverter - H2-6K-LS2" },
  { value: "jinko_panels", label: "JINKO 650W - 16pcs" },
  { value: "skylift", label: "Skylift - 24m" },
  { value: "follow_proposed_drawing", label: "Follow proposed drawing" },
  { value: "rubbish_clear", label: "Rubbish clear" },
  { value: "other", label: "Other activity" },
];

const MAX_INSTALLATION_ACTIVITIES = 11;

function currency(value: number) {
  return new Intl.NumberFormat("en-MY", {
    style: "currency",
    currency: "MYR",
    maximumFractionDigits: 0,
  }).format(value);
}

function formatPhoneNumber(value: string) {
  const digits = value.replace(/\D/g, "");
  if (!digits) return "Not available";
  if (digits.startsWith("60") && digits.length >= 10) {
    const local = `0${digits.slice(2)}`;
    return `${local.slice(0, 3)}-${local.slice(3, 6)} ${local.slice(6)}`;
  }
  if (digits.startsWith("0") && digits.length >= 9) {
    return `${digits.slice(0, 3)}-${digits.slice(3, 6)} ${digits.slice(6)}`;
  }
  return value;
}

function phoneWhatsAppHref(value: string) {
  const digits = value.replace(/\D/g, "");
  if (!digits) return null;
  // wa.me expects the full international number with no plus sign. Local
  // Malaysian numbers ("012...") get the 60 country code swapped in.
  const international = digits.startsWith("60")
    ? digits
    : digits.startsWith("0")
      ? `60${digits.slice(1)}`
      : digits;
  return `https://wa.me/${international}`;
}

function normalizeSeda(status: string) {
  const value = status.toLowerCase();
  return ["approved", "complete", "completed", "success"].some((word) =>
    value.includes(word),
  )
    ? "Approved"
    : status || "Pending";
}

const knownTownships = [
  "Mount Austin",
  "Johor Jaya",
  "Taman Molek",
  "Taman Daya",
  "Setia Indah",
  "Kempas",
  "Skudai",
  "Tampoi",
  "Bandar Putra",
  "Indahpura",
  "Bukit Indah",
  "Nusa Bestari",
  "Permas Jaya",
  "Masai",
  "Ulu Tiram",
  "Senai",
  "Kulai",
  "Kluang",
  "Muar",
];

function townshipForJob(job: InstallationJob) {
  const searchable = `${job.address} ${job.city} ${job.state}`.toLowerCase();
  const known = knownTownships.find((township) =>
    searchable.includes(township.toLowerCase()),
  );
  if (known) return known;

  const tamanMatch = job.address.match(
    /\b(TAMAN|BANDAR)\s+([A-Z0-9'-]+(?:\s+[A-Z0-9'-]+)?)/i,
  );
  if (tamanMatch) {
    return `${tamanMatch[1]} ${tamanMatch[2]}`
      .toLowerCase()
      .replace(/\b\w/g, (letter) => letter.toUpperCase());
  }

  return job.city || job.state || "Location unavailable";
}

function postcodeForJob(job: InstallationJob) {
  const storedPostcode = job.postcode?.match(/\b\d{5}\b/)?.[0];
  if (storedPostcode) return storedPostcode;
  return job.address.match(/\b\d{5}\b/)?.[0] || "";
}

// What the customer search box on every workspace matches against: the name,
// the invoice number, and the whole address as one string — `address` already
// prefers the installation address over the billing one (see rowToJob in
// lib/source-api.ts), and city/state/postcode follow it so "Ayer Keroh" and
// "75450" both find the job.
//
// Shared rather than repeated per workspace: Customer Scheduling, Installation
// groups and Stock delivery all offer the same box, and three copies of the
// test is how they drift into matching three different things.
// Search haystacks, built once per job object instead of once per job per
// keystroke. Typing in a search box re-runs these filters over the whole
// pipeline on every character, and rebuilding the string each time meant tens
// of thousands of array/join/toLowerCase allocations per keypress.
//
// A WeakMap rather than a cleared cache: the key is the job object itself, so
// a reload that replaces `jobs` lets the old entries be collected, and an
// edited job (always a fresh object — the update path spreads rather than
// mutates) misses the cache and is rebuilt. There is no way to read a stale
// haystack for a job whose fields have changed.
const locationHaystacks = new WeakMap<InstallationJob, string>();

function locationHaystack(job: InstallationJob) {
  let text = locationHaystacks.get(job);
  if (text === undefined) {
    text = [
      job.customerName,
      job.invoiceNumber,
      job.address,
      job.city,
      job.state,
      job.postcode,
    ]
      .filter(Boolean)
      .join(" ")
      .toLowerCase();
    locationHaystacks.set(job, text);
  }
  return text;
}

function pipelineHaystack(job: InstallationJob) {
  return locationHaystack(job);
}

function jobMatchesSearch(
  job: InstallationJob,
  search: string,
  group?: InstallationGroup,
) {
  const query = search.trim().toLowerCase();
  if (!query) return true;
  if (locationHaystack(job).includes(query)) return true;
  if (group?.supervisors?.some((name) => name.toLowerCase().includes(query))) return true;
  return false;
}

type LocationSuggestion = {
  id: string;
  area: string;
  postcode: string;
  state: string;
  customers: InstallationJob[];
};

// Groups `eligibleJobs` by town/postcode/state, chunked at 5 customers per
// suggestion — the same grouping Team Planning builds for its suggestion
// list, lifted out so Installation groups can build the same shape from a
// different pool of jobs (Available/Pending customers) without duplicating
// the location-resolution logic.
function buildLocationSuggestions(
  eligibleJobs: InstallationJob[],
  allJobs: InstallationJob[],
): LocationSuggestion[] {
  const locationByPostcode = new Map<string, { town: string; state: string }>();
  allJobs.forEach((job) => {
    const postcode = postcodeForJob(job);
    if (!postcode || locationByPostcode.has(postcode)) return;
    const town = job.city?.trim();
    if (town) {
      locationByPostcode.set(postcode, { town, state: job.state?.trim() || "" });
    }
  });

  const byLocation = new Map<
    string,
    { town: string; postcode: string; state: string; customers: InstallationJob[] }
  >();
  eligibleJobs.forEach((job) => {
    const postcode = postcodeForJob(job);
    const matchedLocation = postcode ? locationByPostcode.get(postcode) : undefined;
    const town = job.city?.trim() || matchedLocation?.town || townshipForJob(job);
    const state = job.state?.trim() || matchedLocation?.state || "";
    // Case/whitespace-insensitive key so source data variants ("Johor Bahru"
    // vs "JOHOR BAHRU") merge into one location instead of splitting.
    const normalizedTown = town.trim().toLowerCase();
    const normalizedState = state.trim().toLowerCase();
    const key = `${normalizedTown}|${postcode || "no-postcode"}|${normalizedState}`;
    const current = byLocation.get(key);
    byLocation.set(key, {
      town: current?.town || town,
      postcode,
      state: current?.state || state,
      customers: [...(current?.customers ?? []), job],
    });
  });

  return Array.from(byLocation.entries())
    .flatMap(([key, { town, postcode, state, customers }]) => {
      const ordered = [...customers].sort(compareBySecondPayment);
      const chunks: LocationSuggestion[] = [];
      for (let index = 0; index < ordered.length; index += 5) {
        chunks.push({
          id: `${key}-${index / 5 + 1}`,
          area: town,
          postcode,
          state,
          customers: ordered.slice(index, index + 5),
        });
      }
      return chunks;
    })
    .sort(compareGroupsBySecondPayment);
}

function operationalUpdate(job: InstallationJob): JobUpdate {
  return {
    installationDate: job.installationDate,
    visits: job.visits,
    customerAvailabilityStatus: job.customerAvailabilityStatus,
    preferredInstallationDate: job.preferredInstallationDate,
    secondPreferredInstallationDate: job.secondPreferredInstallationDate,
    preferredInstallationTime: job.preferredInstallationTime,
    availabilityRemarks: job.availabilityRemarks,
    installationApprovalStatus: job.installationApprovalStatus,
    scheduleStatus: job.scheduleStatus,
    deliveryStatus: job.deliveryStatus,
    deliveryDate: job.deliveryDate,
    arrivalDate: job.arrivalDate,
    arrivalTime: job.arrivalTime,
    stockDetails: job.stockDetails,
    deliveryContactNumber: job.deliveryContactNumber,
    warehouseLocation: job.warehouseLocation,
    panelDetails: job.panelDetails,
    wiringDetails: job.wiringDetails,
    batteryDetails: job.batteryDetails,
    inverterBattery: job.inverterBattery,
    powerOutput: job.powerOutput,
    paymentOverrideStatus: job.paymentOverrideStatus,
    paymentOverrideReason: job.paymentOverrideReason,
    installationRemarks: job.installationRemarks,
    teams: job.teams,
    remarks: job.remarks,
  };
}

// Today as a plain YYYY-MM-DD string in the timezone the team works in, so it
// compares directly against the date-only strings the jobs carry. en-CA is the
// locale that formats as YYYY-MM-DD; toISOString would give UTC and roll the
// day back for the first eight hours of every Malaysian morning.

// The same day as malaysiaToday(), spelled out for the heading. Kept live
// rather than written into the markup so the dashboard cannot sit there
// claiming a date that has already passed.
// The most recent return-trip note, if any — Installation groups shows a
// visit's own note on the row for that specific day, but a one-row-per-job
// summary (Customer details) has no day to key off, so it takes the latest
// one instead.
function latestVisitNote(job: InstallationJob): string {
  const notedVisits = (job.visits ?? []).filter((visit) => visit.notes?.trim());
  if (notedVisits.length === 0) return "";
  return notedVisits.slice().sort((a, b) => b.date.localeCompare(a.date))[0]
    .notes!;
}

function malaysiaTodayLabel() {
  return WEEKDAY_KL.format(new Date());
}

/**
 * The Monday-to-Saturday week a date falls in, as the schedule sheet counts
 * weeks ("INSTALLATION ~ Week : 24/8 ~ 29/8/2026").
 *
 * Built by stepping a local Date rather than by arithmetic on the string, and
 * read back field by field rather than through toISOString — the same reason
 * lib/dates.ts gives: this app runs at UTC+8, so a UTC round trip on a
 * zone-less date lands on the previous day.
 *
 * A Sunday belongs to the week that just ended, not the one about to start,
 * which keeps a Sunday call-out attached to the crew block it follows.
 */
// The schedule sheet writes an unfilled crew or supervisor cell as a lone
// dash rather than leaving it blank, so both spellings mean "not assigned".
function isPlaceholder(value: string | undefined | null): boolean {
  const trimmed = (value ?? "").trim();
  return trimmed === "" || /^[-–—]+$/.test(trimmed);
}

// The crew half of a heading band: the team label plus whichever of the three
// roles actually have someone on them. An empty result means nothing has been
// assigned yet — the state "Add Team" leaves a booking in — and the caller
// suppresses the whole band rather than heading the table with a bare week and
// no crew under it.
// The five columns a heading band already speaks for. Hiding them is a view
// preference, not data, so it lives in localStorage next to the pinned weeks
// rather than in the shared ops state.
const CREW_COLUMNS = [
  { key: "team", label: "Team" },
  { key: "installationTeam", label: "Installation Team" },
  { key: "wiringTeam", label: "Wiring Team" },
  { key: "wiringMembers", label: "Wiring Team Members" },
  { key: "supervisor", label: "Site supervisor" },
] as const;

type CrewColumnKey = (typeof CREW_COLUMNS)[number]["key"];

function crewBandLabel(group: InstallationGroup): string {
  const supervisors = group.supervisors.filter((name) => !isPlaceholder(name));
  return [
    // A lone dash is how the sheet writes "nobody assigned", so it reads as
    // absent here too rather than as a crew called "-".
    isPlaceholder(group.teamLabel) ? "" : (group.teamLabel ?? ""),
    isPlaceholder(group.installationTeam)
      ? ""
      : `Install: ${group.installationTeam}`,
    isPlaceholder(group.wiringTeam) ? "" : `Wiring: ${group.wiringTeam}`,
    supervisors.length ? `Site Supervisor: ${supervisors.join(", ")}` : "",
  ]
    .filter(Boolean)
    .join("  ·  ");
}

function weekBounds(dateStr: string): { start: string; end: string } | null {
  const date = new Date(`${dateStr}T00:00:00`);
  if (Number.isNaN(date.getTime())) return null;
  const local = (value: Date) =>
    `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, "0")}-${String(
      value.getDate(),
    ).padStart(2, "0")}`;
  const monday = new Date(date);
  monday.setDate(date.getDate() - ((date.getDay() + 6) % 7));
  const saturday = new Date(monday);
  saturday.setDate(monday.getDate() + 5);
  return { start: local(monday), end: local(saturday) };
}

// "24 Aug – 29 Aug 2026". The year is stated once, at the end, because a week
// that straddles December would otherwise read as though it spanned one.
function weekRangeLabel(dateStr: string): string {
  const bounds = weekBounds(dateStr);
  if (!bounds) return "Unscheduled";
  const part = (value: string) =>
    DAY_MONTH.format(new Date(`${value}T00:00:00`));
  const year = bounds.end.slice(0, 4);
  return `${part(bounds.start)} – ${part(bounds.end)} ${year}`;
}

// A run's own name when it has one; otherwise its delivery date. Every
// "Create delivery run" click starts the name blank, so without this a freshly
// created run reads as "Not assigned" everywhere it is displayed by name —
// looking unassigned when it is in fact the customer's current run.
function deliveryRunLabel(run: DeliveryRun): string {
  if (run.name.trim()) return run.name;
  if (!run.deliveryDate) return "Unnamed run";
  return DATE_PLAIN.format(new Date(`${run.deliveryDate}T00:00:00`));
}

// How long a paid-up customer may sit with nothing booked before the dashboard
// starts asking about them. Working days: weekends and Malaysian public
// holidays do not count towards the total.
const WORKING_DAYS_BEFORE_ATTENTION = 28;

// Only second payments from this date onward are chased. The gate is on the
// payment date, not on today's date. Gating on today was the first attempt and
// it does not bound the list at all — it only picks the day the whole backlog
// arrives, which is why the card opened on 1 Sept 2026 holding 613 jobs, all
// but one of them already past the threshold before it shipped. Most were
// installs that predate this system and so have no date recorded, not
// customers waiting on anybody. Anchoring the gate to the payment keeps the
// card to the era this system has actually tracked.
const ATTENTION_PAYMENT_FROM = "2026-01-01";

// Paid the deposit but still has no date on the calendar, four working weeks
// on. Jobs that already have a confirmed date — their own, their group's, or
// an Available customer's Customer Scheduling date — drop off this list
// whatever state that booking is in: the card is about customers nobody has
// scheduled, not about bookings that later slipped.
function needsAttention(
  job: InstallationJob,
  todayIso: string,
  group?: InstallationGroup | null,
) {
  // Nobody has put a date against them yet is what makes this a chase list
  // rather than a list of ageing invoices: without it every long-since-
  // installed job whose payment is old enough would sit here too.
  //
  // Any date counts, not just a confirmed booking — see hasPlannedDate. A
  // customer whose date fell through has been got to; they belong in Ready to
  // Install with the rest of the work in progress, not on a list of customers
  // nobody has contacted.
  if (hasPlannedDate(job, group)) return false;
  if (!job.secondPaymentDate) return false;
  if (job.secondPaymentDate < ATTENTION_PAYMENT_FROM) return false;
  return hasWorkingDaysElapsed(
    job.secondPaymentDate,
    todayIso,
    WORKING_DAYS_BEFORE_ATTENTION,
  );
}

// Deposit is gated on the deposit's own date, the same way Need Attention is
// gated on the 2nd payment's. Without it the card counts every part-paid
// invoice this business has ever raised — 495 of them, 223 predating anything
// this system tracked — and those are historic records, not customers partway
// through paying. Anchoring to the payment rather than to today keeps the card
// to the era the dashboard actually covers.
//
// A part-paid invoice with no payment row at all cannot be shown to belong to
// that era, so it is left uncounted rather than assumed recent.
const DEPOSIT_PAYMENT_FROM = "2026-01-01";

// Ready is gated on the date the invoice crossed the threshold, the same way
// Need Attention is. The card is a worklist of customers cleared and waiting,
// and without the gate it fills with invoices that either crossed before this
// system existed or never crossed at all — a backlog of history rather than
// work anyone is waiting on.
const READY_PAYMENT_FROM = "2026-01-01";

// Part-paid, and the deposit landed inside the tracked era. Both halves are
// needed wherever Deposit is decided — the stage below and the Customer
// Scheduling pool — so the two can never drift apart and leave a card
// disagreeing with the list it opens.
function hasCountedDeposit(job: InstallationJob) {
  if (job.paymentPercent <= 0 || hasReachedPaymentPercent(job.paymentPercent)) {
    return false;
  }
  if (!job.firstPaymentDate) return false;
  return job.firstPaymentDate >= DEPOSIT_PAYMENT_FROM;
}

// Cleared to install: the invoice has reached the threshold, and it got there
// inside the tracked era. secondPaymentDate is the date of the payment that
// carried it over the line (see the second_payments CTE in lib/source-api.ts),
// not of the second transaction — a customer who paid the balance in five
// instalments is dated to the one that finished the job. A customer reading at
// the threshold with no crossing date on record cannot be shown to belong to
// this era, so they are left uncounted rather than assumed.
function hasCountedSecondPayment(job: InstallationJob) {
  if (!hasReachedPaymentPercent(job.paymentPercent)) return false;
  if (!job.secondPaymentDate) return false;
  return job.secondPaymentDate >= READY_PAYMENT_FROM;
}

// The unfiltered view. It heads the status dropdown and is where the page
// starts, but it gets no summary card — the cards are the stages, and none of
// them is highlighted while this is selected.
const ALL_JOBS = "all";

const WORK_CATEGORIES = [
  { value: "residential", label: "Residential / Shoplots" },
  { value: "commercial", label: "Commercial" },
  { value: "ev", label: "EV" },
  { value: "om", label: "O&M" },
] as const;

// How many pipeline rows to build DOM for at once, and how many more each
// "Show more" adds. The pipeline is ~8,000 jobs since every live invoice
// became visible, and at nine cells a row that was ~72,000 cells on first
// paint — enough to stall the tab for seconds on load and again on every
// keystroke. Only rendering is capped: the header count, the stage cards and
// every filter still read the full set, so this changes what is drawn, never
// what is matched or counted.
const PIPELINE_PAGE_SIZE = 100;

// The single source of truth for the pipeline: the summary cards, the status
// filter and the counts all read this list, so a card can never show a number
// the filter it opens disagrees with.
//
// There is no "Scheduled Installation" stage. Booking a date does not move a
// customer anywhere — they stay under Ready to Install with the date filled in
// beside them — so a stage for it only ever split the same worklist in two.
//
// The first four are one-per-job and follow from the customer's availability.
// Need Attention is different: it sits on top, so a paid job nobody has
// scheduled in 28 working days shows up there AND in the stage it belongs to.
// That is deliberate — it is a chase list, not a place jobs go — and it means
// the card numbers deliberately do not add up to the job count.
const PIPELINE_STAGES = [
  {
    value: "deposit",
    label: "Deposit",
    note: "Deposit paid",
    hint: `The customer has paid something towards the invoice but is still under ${READY_PAYMENT_PERCENT}%, and is not marked Pending Complete or Complete. Only deposits paid from 1 Jan 2026 onward are counted. Deposit, Ready to Install, Pending Complete and Complete Installation are one-per-job; Need Attention sits on top of whichever of them a job is in.`,
  },
  {
    value: "ready",
    label: "Ready to Install",
    note: "New Ready & Special Case",
    hint: `The invoice has reached ${READY_PAYMENT_PERCENT}% or more, and the customer's availability is Not Set or Reschedule — the job is cleared and still to be installed. A booked date does not move the job out of here; it just fills the date in beside the customer. Only payments from 1 Jan 2026 onward are counted.`,
  },
  {
    value: "pending_complete",
    label: "Pending Complete",
    note: "Reschedule & Pending",
    hint: "The customer's availability is set to Pending Complete or Propose, or a remark says something is being waited on — e.g. \"pending wiring\", \"Pending batt\". \"Pending SEDA Approval\" does not count. Does not require a date or delivery run to already be booked — the status is enough on its own.",
  },
  {
    value: "attention",
    label: "Need Attention",
    note: "Awaiting review, 2nd payment more than 28 working days",
    hint: "Customers in Ready to Install awaiting review (over 28 working days or attention remarks).",
  },
  {
    value: "complete",
    label: "Complete Installation",
    note: "Marked Complete",
    hint: "The customer's availability is set to Complete, or the job is marked installed in the source system, or its installation date is at least 3 days behind us — enough margin for a job that ran a day or two late. A remark reporting something still outstanding holds the job in Pending Complete instead.",
  },
] as const;

type StageValue = (typeof PIPELINE_STAGES)[number]["value"];

// Customer Scheduling offers every stage. "Complete Installation" used to be
// held back because the page's own guards dropped installed jobs before the
// filter ran, so the option could only ever return nothing — selecting it now
// admits them instead. Kept as a list rather than deleted so a future stage
// that genuinely cannot apply here has somewhere to go.
const PLANNING_STAGES: { value: string; label: string }[] = [
  { value: "deposit", label: "Deposit" },
  { value: "to_arrange", label: "Ready to Install" },
  { value: "propose", label: "Propose to Install" },
  { value: "arranged", label: "Arranged Installation" },
];

const stageIcons: Record<StageValue, React.ReactNode> = {
  deposit: <Wallet size={18} />,
  ready: <Check size={18} />,
  pending_complete: <Clock3 size={18} />,
  attention: <AlertTriangle size={18} />,
  complete: <PackageCheck size={18} />,
};

const stageTones: Partial<Record<StageValue, "warning">> = {};

const stageAccents: Partial<Record<StageValue, "amber" | "red">> = {};

// --- New customer pipeline report -------------------------------------------
//
// Where the money is in the pipeline, split by how far the customer has paid
// and whether their installation is booked. The five buckets are mutually
// exclusive and cover every customer exactly once, which is what lets the
// percentages add to 100 and the rows be read as a breakdown rather than as
// five unrelated counts.
//
// The paid/unpaid line is READY_PAYMENT_PERCENT, the same number the Ready to
// Install card uses, so the report and the cards can never disagree about who
// is cleared to install.
type ReportBucket =
  | "deposit_pending"
  | "paid_pending"
  | "paid_installed"
  | "deposit_installed"
  | "unpaid";

function reportBucketOf(
  job: InstallationJob,
  lookup: PlanningLookup,
): ReportBucket {
  const group = lookup.groupByJobId.get(job.id) ?? null;
  // "Booked" the same way the rest of the dashboard means it: their own date,
  // their group's, or the date a Propose customer agreed.
  const booked = Boolean(confirmedInstallationDate(job, group));
  if (job.paymentPercent <= 0) return "unpaid";
  if (hasReachedPaymentPercent(job.paymentPercent)) {
    return booked ? "paid_installed" : "paid_pending";
  }
  return booked ? "deposit_installed" : "deposit_pending";
}

// Rows in the order they are read: the two ordinary payment stages, the
// booked-in group, then the two that describe a record that does not fit the
// normal path and is worth looking at rather than counting silently.
const REPORT_ROWS: {
  key: ReportBucket;
  label: string;
  tone: "amber" | "blue" | "teal" | "slate";
  odd?: boolean;
  desc: string;
}[] = [
  {
    key: "deposit_pending",
    label: "Deposit paid · Pending installation",
    tone: "amber",
    desc: `Something is paid but less than ${READY_PAYMENT_PERCENT}%, and no date is booked. Installation cannot be scheduled until the balance comes in — normally the largest group, and the bottleneck in the pipeline.`,
  },
  {
    key: "paid_pending",
    label: `${READY_PAYMENT_PERCENT}% paid · Pending installation`,
    tone: "blue",
    desc: "Cleared to install, but nobody has booked a date yet. The group to prioritise on Customer Scheduling.",
  },
  {
    key: "paid_installed",
    label: `${READY_PAYMENT_PERCENT}% paid · With installation`,
    tone: "teal",
    desc: "Paid and booked — a date of their own, a group's date, or an agreed date on Customer Scheduling. The balance falls due on completion.",
  },
  {
    key: "deposit_installed",
    label: "Deposit only, but already booked",
    tone: "teal",
    odd: true,
    desc: `Booked for installation while still under ${READY_PAYMENT_PERCENT}% paid. Usually a payment that cleared without being recorded, or an approved exception — worth checking rather than counting as either stage.`,
  },
  {
    key: "unpaid",
    label: "No payment recorded",
    tone: "slate",
    odd: true,
    desc: "The invoice exists but no payment is against it. Financed or otherwise settled outside the payment record, or simply never entered.",
  },
];

// Ringgit, no decimals: these are package totals in the millions, where sen
// are noise and the extra characters cost more than they say.
function formatRinggit(value: number) {
  return `RM ${Math.round(value).toLocaleString("en-MY")}`;
}

// The status filter walks the customer through the pipeline in order: deposit
// cleared, everything ready, a date on the calendar, the date gone by with no
// sign-off, then done. A job can sit in more than one of these at once — they
// are lenses on the same list, not exclusive buckets.
/**
 * Which single stage a job is at.
 *
 * Tested most-advanced-first, and the first match wins: the six stages are a
 * pipeline, not six independent questions, so every job sits in exactly one
 * and the summary cards add up to the customer count. Order matters more than
 * the individual tests — a job paid 70% with a date three days past is
 * Complete, even though it also satisfies Ready and Deposit.
 */
// Booked in: a day has been agreed, or the stock is going out on a run. Both
// count, because either one means the job has left planning and is real work
// on a calendar — which is what separates "pending completion" from a job
// nobody has scheduled yet.
function isBookedIn(
  job: InstallationJob,
  group: InstallationGroup | null | undefined,
  lookup: PlanningLookup,
) {
  return Boolean(
    confirmedInstallationDate(job, group) ||
      lookup.deliveryRunByJobId.get(job.id) ||
      job.deliveryDate ||
      job.arrivalDate,
  );
}

// Whether Customer Scheduling should carry a customer at all.
//
// Its own gate asks "may this customer be put on the calendar?" — paid enough
// or overridden, and neither unavailable nor cancelled. That is the right
// question while a job is still waiting for a date, and the wrong one for a
// job already on one: stock delivered, crew attended, a remark left behind.
// Those are past scheduling, so being booked in exempts them rather than
// hiding work that has already happened.
//
// Without the exemption the tab's Pending Complete and Complete cards disagree
// with every other workspace about the same jobs — a payment gate deciding
// whether a finished installation counts as finished.
//
// Deposit is admitted too, though it sits below the payment gate by
// definition — every Deposit customer is under 60% paid, and none of them has
// ever reached the 59% the gate asks for. Left out, the tab's Deposit card
// read nought and its Deposit filter returned nothing while every other
// workspace counted the same customers, so the stage existed on this tab in
// name only. Admitting them puts the same number on the card wherever it is
// read. Need Attention stays gated: that card is a chase list for customers
// who have paid and are waiting, which is what the gate is there to describe.
function belongsInPlanning(
  job: InstallationJob,
  group: InstallationGroup | null | undefined,
  lookup: PlanningLookup,
) {
  if (isBookedIn(job, group, lookup)) return true;
  if (job.supportTicket || job.issueCategory || job.id.startsWith("ticket-")) return true;
  return hasPlanningEligibility(job) || hasCountedDeposit(job);
}


// A job that reads as completed by date alone (its booked day is 3+ days
// gone) still needs to stay in view if the customer's own status or remarks
// say reschedule, cancel, or pending — the same signal Pending Complete
// Installation runs on. Without this, a job whose date fell through and was
// never cleared disappears from Customer Scheduling as though the crew had
// already been, while the Pipeline tab correctly shows it as still open.
function isHiddenAsCompleted(
  job: InstallationJob,
  todayIso: string,
  group: InstallationGroup | null | undefined,
) {
  if (job.customerAvailabilityStatus === "complete") return true;
  if (group && group.installationDate) return false;
  return (
    isCompleteInstallation(job, todayIso, group) && !signalsPendingComplete(job)
  );
}

// Every stage a job belongs to. Usually one, because the first four are
// mutually exclusive; a job can also carry "attention" alongside whichever of
// those it is in.
//
// The customer's availability picks the stage, and what they have paid decides
// whether they can reach it. That order matters: availability is the thing
// staff actually set, so the pipeline reads back what the office recorded
// rather than second-guessing it from dates and remarks.
function pipelineStagesOf(
  job: InstallationJob,
  todayIso: string,
  lookup: PlanningLookup,
): Set<StageValue> {
  const group = lookup.groupByJobId.get(job.id) ?? null;
  const stages = new Set<StageValue>();

  // Need Attention matches Need Attention from Ready to Install
  if (
    job.customerAvailabilityStatus !== "complete" &&
    !isCompleteInstallation(job, todayIso, group) &&
    !isHiddenAsCompleted(job, todayIso, group) &&
    !isJobOM(job) &&
    matchesPipelineStage(job, "to_arrange", todayIso, lookup) &&
    !isSpecialCaseApproval(job) &&
    !isJobReschedule(job) &&
    !isJobPending(job) &&
    (needsAttention(job, todayIso, group) || isJobNeedAttention(job, todayIso))
  ) {
    stages.add("attention");
  }

  // Done: marked Complete, or its booked day is at least three days behind us,
  // or the source system has said so outright. Complete overrides any pending remark.
  if (
    job.customerAvailabilityStatus === "complete" ||
    isCompleteInstallation(job, todayIso, group)
  ) {
    stages.add("complete");
    return stages;
  }

  // Pending Complete follows sum of Reschedule and Pending from Ready to Install
  if (
    matchesPipelineStage(job, "to_arrange", todayIso, lookup) &&
    !isJobOM(job) &&
    !isSpecialCaseApproval(job) &&
    (isJobReschedule(job) || isJobPending(job))
  ) {
    stages.add("pending_complete");
    return stages;
  }

  // Ready to Install follows sum of New Ready to Install and Special Case
  if (
    matchesPipelineStage(job, "to_arrange", todayIso, lookup) &&
    !isJobOM(job) &&
    (isSpecialCaseApproval(job) ||
      (!isJobReschedule(job) &&
        !isJobPending(job) &&
        !(needsAttention(job, todayIso, group) || isJobNeedAttention(job, todayIso))))
  ) {
    stages.add("ready");
    return stages;
  }

  // Paid before the tracked era — or paid up without a 2nd payment on record —
  // falls through to no stage at all: counted by no card, but the status
  // filter's All jobs still lists it, so the record stays reachable rather
  // than disappearing from the dashboard.
  if (hasCountedDeposit(job)) stages.add("deposit");
  return stages;
}

// The write side of the row-remark read a few lines above its editor: a return
// trip keeps its note on that visit, everyone else on the customer record.
// Mirrors that read exactly, so what is typed lands where it is read back from.
function withRowRemark(
  job: InstallationJob,
  visit: JobVisit | undefined,
  text: string,
): InstallationJob {
  if (!visit) return { ...job, installationRemarks: text };
  return {
    ...job,
    installationRemarks: text,
    visits: (job.visits ?? []).map((item) =>
      item.date === visit.date ? { ...item, notes: text } : item,
    ),
  };
}

function matchesPipelineStage(
  job: InstallationJob,
  stage: string,
  todayIso: string,
  lookup: PlanningLookup,
): boolean {
  if (stage === "deposit") {
    const group = lookup.groupByJobId.get(job.id) ?? null;
    if (
      job.customerAvailabilityStatus === "complete" ||
      isCompleteInstallation(job, todayIso, group) ||
      isHiddenAsCompleted(job, todayIso, group)
    ) {
      return false;
    }
    if (isSpecialCaseApproval(job)) {
      return false;
    }
    if (matchesPipelineStage(job, "to_arrange", todayIso, lookup)) {
      return false;
    }
    return hasCountedDeposit(job) && !hasCountedSecondPayment(job);
  }
  if (stage === "propose") {
    const group = lookup.groupByJobId.get(job.id) ?? null;
    if (
      job.customerAvailabilityStatus === "complete" ||
      isCompleteInstallation(job, todayIso, group)
    ) {
      return false;
    }
    return job.customerAvailabilityStatus === "propose";
  }
  if (stage === "to_arrange") {
    const group = lookup.groupByJobId.get(job.id) ?? null;
    if (job.customerAvailabilityStatus === "complete") {
      return false;
    }
    // Support ticket jobs belong in Ready to Install until arranged into a group
    if (job.supportTicket || job.issueCategory || job.id.startsWith("ticket-")) {
      return !group || !group.installationDate;
    }
    // O&M jobs that are already in an arranged group stay on Arranged Installation
    if (isJobOM(job) && group && group.installationDate) {
      return false;
    }
    // Rule: if no '✓' on arranged install, customer is copied to propose to install.
    // Does not depend on pending, reschedule, etc.
    if (group && group.installationDate) {
      return true;
    }
    if (isCompleteInstallation(job, todayIso, group)) {
      return false;
    }
    if (isSpecialCaseApproval(job)) {
      return true;
    }
    if (isJobPending(job) || isJobReschedule(job)) {
      return isSedaApproved(job.sedaStatus);
    }
    return (
      hasCountedSecondPayment(job) &&
      isSedaApproved(job.sedaStatus)
    );
  }
  if (stage === "ready") {
    // Ready to Install active card follows: sum of New Ready to Install and Special Case
    const group = lookup.groupByJobId.get(job.id) ?? null;
    if (
      job.customerAvailabilityStatus === "complete" ||
      isCompleteInstallation(job, todayIso, group) ||
      isHiddenAsCompleted(job, todayIso, group)
    ) {
      return false;
    }
    if (isJobOM(job)) {
      return false;
    }
    if (!matchesPipelineStage(job, "to_arrange", todayIso, lookup)) {
      return false;
    }
    if (isSpecialCaseApproval(job)) {
      return true;
    }
    if (isJobReschedule(job) || isJobPending(job)) {
      return false;
    }
    if (needsAttention(job, todayIso, group) || isJobNeedAttention(job, todayIso)) {
      return false;
    }
    return true;
  }
  if (stage === "pending_complete") {
    // Pending Complete active card follows: sum of Reschedule and Pending
    const group = lookup.groupByJobId.get(job.id) ?? null;
    if (
      job.customerAvailabilityStatus === "complete" ||
      isCompleteInstallation(job, todayIso, group) ||
      isHiddenAsCompleted(job, todayIso, group)
    ) {
      return false;
    }
    if (isJobOM(job)) {
      return false;
    }
    if (!matchesPipelineStage(job, "to_arrange", todayIso, lookup)) {
      return false;
    }
    if (isSpecialCaseApproval(job)) {
      return false;
    }
    return isJobReschedule(job) || isJobPending(job);
  }
  if (stage === "arranged") {
    const group = lookup.groupByJobId.get(job.id) ?? null;
    if (group && group.installationDate) return true;
    const stages = pipelineStagesOf(job, todayIso, lookup);
    return (
      stages.has("ready") ||
      stages.has("pending_complete") ||
      stages.has("complete")
    );
  }
  if (stage === "attention") {
    const group = lookup.groupByJobId.get(job.id) ?? null;
    if (
      job.customerAvailabilityStatus === "complete" ||
      isCompleteInstallation(job, todayIso, group) ||
      isHiddenAsCompleted(job, todayIso, group)
    ) {
      return false;
    }
    if (isJobOM(job)) {
      return false;
    }
    return (
      matchesPipelineStage(job, "to_arrange", todayIso, lookup) &&
      !isSpecialCaseApproval(job) &&
      !isJobReschedule(job) &&
      !isJobPending(job) &&
      (needsAttention(job, todayIso, group) || isJobNeedAttention(job, todayIso))
    );
  }
  // ALL_JOBS, and anything unrecognised, leaves the list untouched.
  if (!PIPELINE_STAGES.some((item) => item.value === stage)) return true;
  return pipelineStagesOf(job, todayIso, lookup).has(stage as StageValue);
}

// The stored per-job edits, laid over what the API returned, and the status
// brought up to date afterwards. That last step matters here and not only in
// the API: these updates are applied *on top of* the API's job, so a saved
// "available" from before the rename would otherwise put a finished job back
// to Propose on every load, undoing on the client exactly what the server had
// just written to the column.
// The suggested week's map: every Ready to Install customer, one marker group
// per postcode — not the town suggestions, which stop at five a town.
function readyScheduleMapGroups(readyJobs: InstallationJob[]) {
  const byPostcode = new Map<
    string,
    {
      id: string;
      town: string;
      postcode: string;
      state: string;
      customers: {
        id: string;
        name: string;
        address: string;
        paymentPercent: number;
      }[];
    }
  >();
  readyJobs.forEach((job) => {
    const postcode = postcodeForJob(job);
    const key = postcode || `no-postcode-${job.id}`;
    const entry = byPostcode.get(key) ?? {
      id: key,
      town: job.city || townshipForJob(job),
      postcode,
      state: job.state || "",
      customers: [],
    };
    entry.customers.push({
      id: job.id,
      name: job.customerName,
      address: job.address,
      paymentPercent: job.paymentPercent,
    });
    byPostcode.set(key, entry);
  });
  return Array.from(byPostcode.values());
}

function applyJobUpdates(
  jobs: InstallationJob[],
  updates: Record<string, JobUpdate>,
  groups: InstallationGroup[],
  todayIso: string,
) {
  const groupByJobId = new Map<string, InstallationGroup>();
  groups.forEach((group) => {
    group.jobIds.forEach((id) => groupByJobId.set(id, group));
  });
  const existingJobIds = new Set(jobs.map((j) => j.id));
  const syntheticJobs: InstallationJob[] = [];

  groups.forEach((group) => {
    group.jobIds.forEach((jobId) => {
      if (!jobId || existingJobIds.has(jobId)) return;
      existingJobIds.add(jobId);
      const update = (updates[jobId] ?? {}) as Record<string, unknown>;
      const cleanName =
        (typeof update.customerName === "string" && update.customerName) ||
        group.name.replace(/^Team\s*[0-9A-Za-z\s]+?[·-]\s*/i, "").trim() ||
        "Scheduled Customer";
      syntheticJobs.push({
        id: jobId,
        invoiceNumber: (typeof update.invoiceNumber === "string" && update.invoiceNumber) || "",
        customerName: cleanName,
        customerPhone: (typeof update.customerPhone === "string" && update.customerPhone) || "",
        address: (typeof update.address === "string" && update.address) || group.area || "",
        city: group.area || "",
        state: "",
        agentName: "",
        totalAmount: 0,
        paymentPercent: 100,
        paymentBalance: 0,
        panelQuantity: 0,
        panelRating: 0,
        inverter: "",
        battery: "",
        phase: "Three phase",
        inverterType: "",
        derivedInverterModel: "",
        sedaStatus: "Approved",
        sldUrl: null,
        packageName: "",
        packageType: "Residential",
        installationDate: group.installationDate || null,
        customerAvailabilityStatus: "complete",
        preferredInstallationDate: group.installationDate || null,
        secondPreferredInstallationDate: null,
        preferredInstallationTime: (typeof update.preferredInstallationTime === "string" && update.preferredInstallationTime) || "09:00",
        availabilityRemarks: "",
        installationApprovalStatus: "date_approved",
        scheduleStatus: "ready_to_schedule",
        deliveryStatus: "not_planned",
        deliveryDate: null,
        arrivalDate: null,
        arrivalTime: null,
        stockDetails: "",
        deliveryContactNumber: "",
        warehouseLocation: "",
        panelDetails: "",
        wiringDetails: "",
        batteryDetails: "",
        inverterBattery: "",
        powerOutput: "",
        paymentOverrideStatus: "none",
        paymentOverrideReason: "",
        teams: [],
        remarks: (typeof update.remarks === "string" && update.remarks) || group.remark || "",
        installationRemarks: (typeof update.installationRemarks === "string" && update.installationRemarks) || group.remark || "",
      });
    });
  });

  const allJobs = [...jobs, ...syntheticJobs];
  return allJobs.map((job) => {
    const merged = { ...job, ...(updates[job.id] ?? {}) };
    // Stored updates predate the five-value availability scheme, so a saved
    // "available" or "cancelled" is translated before anything reads it.
    const normalized = {
      ...merged,
      customerAvailabilityStatus: normalizeAvailabilityStatus(
        merged.customerAvailabilityStatus,
      ),
    };
    return {
      ...normalized,
      customerAvailabilityStatus: resolvedAvailabilityStatus(
        normalized,
        todayIso,
        groupByJobId.get(job.id),
      ),
      teams: merged.teams.map((team) => ({
        ...team,
        activity:
          team.activity ??
          (team.role === "wiring" ? "cable_trunking" : "pv_panels"),
      })),
    };
  });
}

type SharedOpsState = {
  groups: InstallationGroup[];
  deliveryRuns: DeliveryRun[];
  warehouses: Warehouse[];
  teamResources: TeamResource[];
  teamWeekAssignments: TeamWeekAssignment[];
  jobUpdates: Record<string, JobUpdate>;
  frozenJobIds: string[];
  // Both newer than the rest, so a stored state from an older build can lack
  // them; read through `?? {}`.
  siteAssessments?: Record<string, SiteAssessment>;
  scheduleDraft?: ScheduleDraft;
};

function readLocalJson<T>(key: string, fallback: T): T {
  try {
    const raw = window.localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

async function readError(response: Response, fallback: string) {
  const payload = (await response.json().catch(() => null)) as {
    error?: string;
  } | null;
  return payload?.error || fallback;
}

const UNREACHABLE_MESSAGE = "Cannot reach the dashboard server.";

/**
 * Turn whatever fetch threw into a sentence someone can act on.
 *
 * fetch() rejects with a bare TypeError when no HTTP response comes back at
 * all — the dashboard server restarted, or this window outlived it. Its
 * message ("Failed to fetch") means nothing to the people using this app and
 * describes the wrong layer: the database may well be fine. Anything that did
 * come back from a route is already a written-for-humans sentence, so it is
 * passed through. Either way the result ends in a full stop, because these get
 * concatenated with a following sentence and browser messages carry no
 * punctuation of their own.
 */
function describeRequestError(error: unknown, fallback = UNREACHABLE_MESSAGE) {
  const message = error instanceof Error ? error.message : "";
  if (!message || error instanceof TypeError) return fallback;
  return /[.!?]$/.test(message) ? message : message + ".";
}

// A dropped request is the common failure here — the dashboard server restarts
// under an open window — and it costs one round trip to survive. Only thrown
// (network-level) failures are retried: an HTTP error is a real answer from the
// route and belongs on screen immediately, not after several seconds of delay.
const REQUEST_RETRIES = 2;
const RETRY_DELAY_MS = 700;

// How often to re-check a store that is already known to be offline. Long
// enough that a server which stays down is not hammered, short enough that a
// restart clears the read-only banner before anyone gives up and reloads.
const RECONNECT_INTERVAL_MS = 15_000;

async function fetchWithRetry(input: string, init?: RequestInit) {
  for (let attempt = 0; ; attempt += 1) {
    try {
      return await fetch(input, init);
    } catch (error) {
      if (attempt >= REQUEST_RETRIES) throw error;
      await new Promise((resolve) =>
        setTimeout(resolve, RETRY_DELAY_MS * (attempt + 1)),
      );
    }
  }
}

/**
 * The popups currently on screen, innermost last.
 *
 * A single document listener reads the top of this stack, rather than each
 * popup listening for itself. That matters because popups nest across
 * components: the group drawer lives inside Installation groups, which is
 * rendered inside the Schedule & assign modal owned by the page. With one
 * listener per component both would fire on the same key press and a single
 * Escape would collapse two layers at once. Only the top entry runs, so each
 * press peels off exactly one.
 */
const escapeStack: Array<() => void> = [];

function handleGlobalEscape(event: KeyboardEvent) {
  if (event.key !== "Escape") return;
  escapeStack[escapeStack.length - 1]?.();
}

/**
 * Closes a popup when Escape is pressed.
 *
 * The listener sits on the document rather than the dialog so it fires wherever
 * focus happens to be — a text field inside the popup, or nothing at all when
 * the popup was opened by a click. Nothing is attached while every popup is
 * closed, so Escape stays inert on a plain screen.
 *
 * `onEscape` is held in a ref so passing a fresh closure each render does not
 * re-register the popup on every keystroke. Where one component owns several
 * popups, pass a single handler that closes them in stacking order.
 */
function useEscapeKey(active: boolean, onEscape: () => void) {
  const handler = useRef(onEscape);
  handler.current = onEscape;

  useEffect(() => {
    if (!active) return;
    const entry = () => handler.current();
    escapeStack.push(entry);
    if (escapeStack.length === 1) {
      document.addEventListener("keydown", handleGlobalEscape);
    }
    return () => {
      const index = escapeStack.lastIndexOf(entry);
      if (index >= 0) escapeStack.splice(index, 1);
      if (escapeStack.length === 0) {
        document.removeEventListener("keydown", handleGlobalEscape);
      }
    };
  }, [active]);
}

// Rain forecast per date, sourced from each group's postcode — shared by the
// "Schedule & assign" calendar and the sidebar calendar panel so the two
// never fetch (or disagree on) the same forecast independently.
function useCalendarWeather(
  groups: InstallationGroup[],
  jobs: InstallationJob[],
) {
  const [calendarWeather, setCalendarWeather] = useState<
    Record<string, { rainProbability: number; weatherCode: number }>
  >({});

  useEffect(() => {
    let cancelled = false;
    const locations = new Map<string, { latitude: number; longitude: number }>();
    // Indexed once for the whole pass rather than scanning every customer per
    // group. This effect re-runs whenever jobs change — which is every save —
    // and at 515 groups a scan apiece was several million comparisons each
    // time, for the sake of one postcode per group.
    const byId = new Map(jobs.map((job) => [job.id, job]));
    groups.forEach((group) => {
      const firstJob = group.jobIds.map((id) => byId.get(id)).find(Boolean);
      if (!firstJob) return;
      const match = weatherCoordinatesForPostcode(postcodeForJob(firstJob));
      if (match) locations.set(match.prefix, match.coordinates);
    });

    // Nothing grouped yet is the normal state of a fresh board, and keying the
    // forecast off groups alone left the calendar with no weather at all until
    // someone had done the planning the weather is meant to inform. Fall back
    // to where the pipeline actually is: the busiest postcode areas across the
    // jobs on hand.
    if (!locations.size) {
      const byPrefix = new Map<
        string,
        { count: number; coordinates: { latitude: number; longitude: number } }
      >();
      jobs.forEach((job) => {
        const match = weatherCoordinatesForPostcode(postcodeForJob(job));
        if (!match) return;
        const entry = byPrefix.get(match.prefix);
        if (entry) entry.count += 1;
        else byPrefix.set(match.prefix, { count: 1, coordinates: match.coordinates });
      });
      // Capped because this is one Open-Meteo request per location and the
      // full pipeline spans far more areas than a forecast summary needs.
      Array.from(byPrefix.entries())
        .sort((a, b) => b[1].count - a[1].count)
        .slice(0, WEATHER_LOCATION_LIMIT)
        .forEach(([prefix, entry]) => locations.set(prefix, entry.coordinates));
    }

    if (!locations.size) {
      setCalendarWeather({});
      return;
    }

    async function loadWeather() {
      // Worst-case merge across locations and the null handling both live
      // in lib/calendar-weather, so the sign-in calendar and this one
      // cannot drift apart on what a date's weather is.
      const next = await fetchDailyWeather(Array.from(locations.values()));
      if (!cancelled) setCalendarWeather(next);
    }

    void loadWeather();
    return () => {
      cancelled = true;
    };
  }, [groups, jobs]);

  return calendarWeather;
}

// The group whose installation window covers a date, if any.
function calendarGroupForDate(
  dateStr: string,
  groups: InstallationGroup[],
): InstallationGroup | null {
  return (
    groups.find((group) => {
      if (!group.installationDate) return false;
      const end = group.installationEndDate || group.installationDate;
      return dateStr >= group.installationDate && dateStr <= end;
    }) || null
  );
}

// Customers on a calendar day. Note this counts only jobs that belong to a
// group: an ungrouped job carrying an installation date is deliberately not
// shown, because the calendar is a view of planned group work. Both the day
// cell's count and the day detail list call this, so the number on the cell
// and the rows behind it can never disagree.
function calendarCustomersForDate(
  dateStr: string,
  jobs: InstallationJob[],
  groups: InstallationGroup[],
): InstallationJob[] {
  return jobs.filter((job) => {
    const customerDate = job.installationDate || job.preferredInstallationDate;
    // A site worked on across several days — wiring split over three trips, a
    // return for one part, an O&M callback — is one job with one
    // installationDate, so matching that alone would show the crew on the last
    // day only and leave the earlier trips off the calendar entirely.
    const onThisDay =
      customerDate === dateStr ||
      (job.visits ?? []).some((visit) => visit.date === dateStr);
    return onThisDay && groups.some((group) => group.jobIds.includes(job.id));
  });
}


// One month's worth of day cells — customer names, install/wiring team,
// delivery run, weather risk, and public holidays — shared by the
// "Schedule & assign" full calendar and the sidebar calendar panel so both
// present the same information the same way.
function MonthCalendarGrid({
  month,
  jobs,
  groups,
  deliveryRuns,
  weather,
  onSelectDate,
  selectedDate,
}: {
  month: Date;
  jobs: InstallationJob[];
  groups: InstallationGroup[];
  deliveryRuns: DeliveryRun[];
  weather: Record<string, { rainProbability: number; weatherCode: number }>;
  onSelectDate: (dateKey: string) => void;
  // Only the sidebar panel tracks a chosen day; the Schedule & assign grid
  // leaves this unset and renders no selection.
  selectedDate?: string | null;
}) {
  const calendarStart = new Date(month);
  calendarStart.setDate(1 - ((calendarStart.getDay() + 6) % 7));
  const calendarDays = Array.from({ length: 42 }, (_, index) => {
    const date = new Date(calendarStart);
    date.setDate(calendarStart.getDate() + index);
    return date;
  });

  const groupForDate = (dateStr: string) =>
    calendarGroupForDate(dateStr, groups);
  const customersForDate = (dateStr: string) =>
    calendarCustomersForDate(dateStr, jobs, groups);

  return (
    <>
      <div className="standard-calendar-weekdays" aria-hidden="true">
        {["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map((day) => (
          <span key={day}>{day}</span>
        ))}
      </div>

      <div className="full-calendar-grid">
        {calendarDays.map((date) => {
          const key = dateKey(date);
          const isCurrentMonth = date.getMonth() === month.getMonth();
          const group = groupForDate(key);
          const staffing = group ? groupStaffing(group) : null;
          const dayCustomers = customersForDate(key);
          const dayDeliveryRuns = deliveryRuns.filter(
            (run) => run.deliveryDate === key,
          );
          const dayWeather = weather[key];
          // Open-Meteo is asked for 16 forecast days, so anything further out
          // simply has no entry — the chip disappears rather than reading 0%.
          const holiday = holidayForDate(key);
          return (
            <button
              key={key}
              type="button"
              className={`week-day-box${staffing ? ` ${staffing}` : ""}${isCurrentMonth ? "" : " outside-month"}${selectedDate === key ? " is-selected" : ""}`}
              aria-pressed={selectedDate === key}
              onClick={() => onSelectDate(key)}
            >
              <div className="week-day-box-top">
                <span className="week-day-box-number">{date.getDate()}</span>
                {dayWeather && (
                  <span
                    className={`week-day-box-weather ${
                      dayWeather.rainProbability >= 70
                        ? "high-risk"
                        : dayWeather.rainProbability >= 40
                          ? "medium-risk"
                          : "low-risk"
                    }`}
                  >
                    <WeatherGlyph code={dayWeather.weatherCode} size={13} />
                    {dayWeather.rainProbability}%
                  </span>
                )}
              </div>
              {holiday && (
                <span className="week-day-box-holiday">{holiday}</span>
              )}
              {dayCustomers.length > 0 && (
                <span className="week-day-box-count">
                  {dayCustomers.length} install
                  {dayCustomers.length > 1 ? "s" : ""}
                </span>
              )}
              {dayCustomers.length > 0 && (
                <div className="week-day-box-customers">
                  {dayCustomers.slice(0, 3).map((job) => (
                    <span key={job.id}>{formatPersonName(job.customerName)}</span>
                  ))}
                  {dayCustomers.length > 3 && (
                    <span>+{dayCustomers.length - 3} more</span>
                  )}
                </div>
              )}
              {group && (group.installationTeam || group.wiringTeam) && (
                <div className="week-day-box-teams">
                  {group.installationTeam && (
                    <span>{group.installationTeam}</span>
                  )}
                  {group.wiringTeam && <span>{group.wiringTeam}</span>}
                </div>
              )}
              {dayDeliveryRuns.length > 0 && (
                <div className="week-day-box-delivery">
                  {dayDeliveryRuns.map((run) => (
                    <span key={run.id}>
                      <Truck size={11} />
                      {deliveryRunLabel(run)}
                    </span>
                  ))}
                </div>
              )}
            </button>
          );
        })}
      </div>
    </>
  );
}

function StatusDot({
  status,
}: {
  status: "good" | "warning" | "danger" | "neutral";
}) {
  return <span className={`status-dot ${status}`} aria-hidden="true" />;
}

// The job as the Installation record shows it: the customer's own fields, with
// anything they inherit from their installation group or delivery run filled
// in behind. The record is a summary of where this customer stands, so a date
// held by their group is theirs to display even though nothing was written
// against the customer directly.
//
// Shared rather than built at the point of use because two pages open this
// record now — Customer details and Customer Scheduling — and a record that
// filled its blanks differently depending on which page opened it would be
// worse than no record at all.
function recordJobFor(
  job: InstallationJob,
  group: InstallationGroup | undefined | null,
  deliveryRun: DeliveryRun | undefined | null,
  groups: InstallationGroup[],
): InstallationJob {
  return {
    ...job,
    installationDate:
      job.installationDate || group?.installationDate || null,
    deliveryDate: job.deliveryDate || deliveryRun?.deliveryDate || null,
    warehouseLocation:
      job.warehouseLocation || deliveryRun?.warehouse || "",
    deliveryContactNumber:
      job.deliveryContactNumber ||
      deliveryRun?.contactNumber ||
      job.customerPhone,
    deliveryRunName: deliveryRun?.name || "",
    deliveryGroupLocation:
      groups.find(
        (candidate) => candidate.id === deliveryRun?.installationGroupId,
      )?.area ||
      group?.area ||
      "",
    // A customer with no crew of their own stands in the one their group is
    // booked with, so the record does not read as unstaffed work.
    teams:
      job.teams.length > 0
        ? job.teams
        : [
            ...(group?.installationTeam
              ? [
                  {
                    id: `${group.id}-installation`,
                    role: "roof" as const,
                    teamName: group.installationTeam,
                    activity: "pv_panels" as const,
                  },
                ]
              : []),
            ...(group?.wiringTeam
              ? [
                  {
                    id: `${group.id}-wiring`,
                    role: "wiring" as const,
                    teamName: group.wiringTeam,
                    activity: "cable_trunking" as const,
                  },
                ]
              : []),
          ],
  };
}

// Whether a spec field actually says anything, or is one of the placeholders
// the feed fills a blank with. rowToJob writes "Not available" wherever the
// invoice had nothing, and panelDetails is built as "<qty> panels" — so a job
// with no panel count arrives as the literal "— panels".
//
// Used to let the Installation record fall through to the specification the
// crew typed in on Installation groups when the invoice carries none. The
// invoice feed is missing a package line for a great many jobs, and the record
// was reading it alone: 387 jobs had a power output recorded with nowhere to
// show it, 98 an inverter, and 106 a panel count.
const SPEC_PLACEHOLDERS = new Set([
  "not available",
  "not provided",
  "none recorded",
  "not recorded",
  "n/a",
  "— panels",
  "- panels",
]);

function specFallback(value: string | null | undefined): string | null {
  const text = (value ?? "").trim();
  if (!text) return null;
  return SPEC_PLACEHOLDERS.has(text.toLowerCase()) ? null : text;
}

// Some invoices are for a service with no solar array to describe — panels,
// inverter, battery, phase, SEDA status all read as noise on those, filled
// with "Not provided" placeholders for a system that was never sold.
// lib/source-api.ts leaves packageName blank exactly for this case — no
// is_a_package line on the invoice at all — so an empty string is read as
// "not solar" rather than as missing data. It is never blank for any other
// reason: every other path through rowToJob falls back to "Not available".
function isCleaningServiceJob(job: Pick<InstallationJob, "packageName">) {
  return job.packageName.trim() === "";
}

function jobCategoryText(job: InstallationJob): string {
  return [
    job.packageType,
    job.packageName,
    job.evDetails,
    job.focDetails,
    job.remarks,
    job.customerName,
    ...(job.visits ?? []).map((visit) => visit.kind ?? ""),
  ]
    .filter(Boolean)
    .join("\n");
}

function jobHasEv(job: InstallationJob): boolean {
  if (/^ev charger$/i.test((job.packageType ?? "").trim())) return true;
  return /ev\s*charger|ev\s*wallbox|wallbox|ev charger installation/i.test(
    jobCategoryText(job),
  );
}

function jobIsSolar(job: InstallationJob): boolean {
  return !jobHasEv(job);
}

function jobHasOm(job: InstallationJob): boolean {
  if (isCleaningServiceJob(job)) return true;
  if (job.visits?.some((visit) => /o\s*&\s*m/i.test(visit.kind ?? ""))) {
    return true;
  }
  return /o\s*&\s*m|cleaning and inspection/i.test(jobCategoryText(job));
}

// Narrower than jobHasOm above: the yellow row highlight on Installation
// groups and Stock delivery is keyed off the Remark text itself saying
// "O&M", not the broader work-category signals (cleaning-service package,
// visit kind, category text) that filter counts as O&M work.
function remarkHasOm(remark: string): boolean {
  return /o\s*&\s*m/i.test(remark);
}

function jobIsCommercial(job: InstallationJob): boolean {
  if (/tariff\s*b/i.test(job.packageType ?? "")) return true;
  return /\bselco\b/i.test(job.customerName);
}

function jobIsResidential(job: InstallationJob): boolean {
  const packageType = job.packageType ?? "";
  if (/residential/i.test(packageType)) return true;
  if (/shop[\s-]*lot/i.test(job.customerName)) return true;
  return (
    !jobIsCommercial(job) &&
    !isCleaningServiceJob(job) &&
    !/^ev charger$/i.test(packageType.trim()) &&
    job.packageName.trim() !== ""
  );
}

function getJobYear(job: InstallationJob): string {
  const d =
    job.installationDate ||
    job.secondPaymentDate ||
    job.firstPaymentDate ||
    job.preferredInstallationDate;
  if (d && d.length >= 4) {
    return d.slice(0, 4);
  }
  return "unknown";
}

function jobIsYear2026(job: InstallationJob): boolean {
  return getJobYear(job) === "2026";
}

function matchesWorkCategory(job: InstallationJob, filter: string): boolean {
  if (filter === ALL_JOBS) return true;
  if (filter === "solar")
    return (
      jobIsSolar(job) &&
      hasReachedPaymentPercent(job.paymentPercent, 60) &&
      jobIsYear2026(job)
    );
  if (filter === "ev")
    return (
      jobHasEv(job) &&
      hasReachedPaymentPercent(job.paymentPercent, 60) &&
      jobIsYear2026(job)
    );
  if (filter === "om") return jobHasOm(job);
  if (filter === "commercial") return jobIsCommercial(job);
  if (filter === "residential") return jobIsResidential(job);
  return true;
}

function WorkCategorySelect({
  value,
  onChange,
}: {
  value: string;
  onChange: (next: string) => void;
}) {
  return (
    <select
      className="work-category-filter"
      aria-label="Filter by job type"
      value={value}
      onChange={(event) => onChange(event.target.value)}
    >
      <option value={ALL_JOBS}>All jobs</option>
      {WORK_CATEGORIES.map((item) => (
        <option key={item.value} value={item.value}>
          {item.label}
        </option>
      ))}
    </select>
  );
}

function JobDetail({
  job,
  locationGroupLabel,
  group,
  deliveryRun,
  availableTeams,
  saving,
  sldOpen,
  onSave,
  onOpenSld,
  onCloseSld,
  onDismiss,
}: {
  job: InstallationJob;
  locationGroupLabel: string;
  group: InstallationGroup | null;
  deliveryRun: DeliveryRun | null;
  availableTeams: TeamResource[];
  saving: boolean;
  sldOpen: boolean;
  onSave: (job: InstallationJob) => void;
  onOpenSld: () => void;
  onCloseSld: () => void;
  onDismiss: () => void;
}) {
  // Remarks are the only field this record edits; everything else is owned by
  // Team planning, Installation groups, Stock delivery, or the source system.
  const [remarksDraft, setRemarksDraft] = useState(job.remarks);
  const [editingRemarks, setEditingRemarks] = useState(false);

  const [workDraft, setWorkDraft] = useState({
    activity: "pv_panels" as TeamAssignment["activity"],
    customActivity: "",
    teamName: "",
  });

  useEffect(() => {
    setRemarksDraft(job.remarks);
    setEditingRemarks(false);
  }, [job]);

  function addWorkItem() {
    if (!workDraft.teamName.trim()) return;
    if (workDraft.activity === "other" && !workDraft.customActivity.trim()) {
      return;
    }
    const team = availableTeams.find(
      (candidate) => candidate.name === workDraft.teamName,
    );
    onSave({
      ...job,
      teams: [
        ...job.teams,
        {
          id: crypto.randomUUID(),
          role: team?.role === "wiring" ? "wiring" : "roof",
          teamName: workDraft.teamName,
          contact: team?.contact || undefined,
          activity: workDraft.activity,
          customActivity:
            workDraft.activity === "other"
              ? workDraft.customActivity.trim()
              : undefined,
        },
      ],
    });
    setWorkDraft({ activity: "pv_panels", customActivity: "", teamName: "" });
  }

  function removeWorkItem(id: string) {
    onSave({ ...job, teams: job.teams.filter((team) => team.id !== id) });
  }

  if (sldOpen) {
    return (
      <aside className="detail-panel sld-panel">
        <div className="detail-header">
          <div>
            <p className="eyebrow">Source drawing</p>
            <h2>SLD · {formatPersonName(job.customerName)}</h2>
          </div>
          <button className="icon-button" aria-label="Close SLD" onClick={onCloseSld}>
            <X size={19} />
          </button>
        </div>
        {job.sldUrl ? (
          <>
            <div className="drawing-frame">
              {job.sldUrl.toLowerCase().includes(".pdf") ? (
                <iframe title={`SLD for ${job.customerName}`} src={job.sldUrl} />
              ) : (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={job.sldUrl} alt={`SLD drawing for ${job.customerName}`} />
              )}
            </div>
            <a
              className="button primary full"
              href={job.sldUrl}
              target="_blank"
              rel="noreferrer"
            >
              Open full drawing
            </a>
          </>
        ) : (
          <div className="empty-state drawing-empty">
            <FileSearch />
            <p>No SLD drawing is available from the source.</p>
          </div>
        )}
      </aside>
    );
  }

  return (
    <aside className="record">
      <header className="record-header">
        <div className="record-identity">
          <p className="eyebrow">Installation record</p>
          <h2>{formatPersonName(job.customerName)}</h2>
          <div className="record-idstrip">
            <span>
              <small>Invoice</small>
              {job.invoiceNumber || "—"}
            </span>
            <span>
              <small>Agent</small>
              {job.agentName || "—"}
            </span>
            <span>
              <small>Location</small>
              {job.city || job.state || "—"}
            </span>
            <span>
              <small>Contract value</small>
              {currency(job.totalAmount)}
            </span>
          </div>
        </div>
        <div className="record-header-actions">
          <button className="button secondary" onClick={onOpenSld}>
            <FileSearch size={16} />
            {job.sldUrl ? "View SLD" : "Check SLD"}
          </button>
          <button
            className="icon-button"
            aria-label="Close customer details"
            onClick={onDismiss}
          >
            <X size={19} />
          </button>
        </div>
      </header>

      <div className="record-body">
        <SpecBlock title="Customer and site">
          <SpecRow
            label="Customer name"
            value={formatPersonName(job.customerName)}
            emphasis
          />
          <SpecRow label="Invoice number" value={job.invoiceNumber} />
          <SpecRow
            label="Installation address"
            value={
              job.address
                ? formatCustomerAddress(job.address)
                : "Address not available"
            }
          />
          <SpecRow
            label="Customer contact"
            value={formatPhoneNumber(job.customerPhone)}
          />
          <SpecRow label="Sales agent" value={job.agentName} />
          <SpecRow label="Sales price" value={currency(job.totalAmount)} />
          <SpecRow
            label="Payment received"
            value={`${job.paymentPercent.toFixed(0)}%`}
            emphasis={hasReachedPaymentPercent(
              job.paymentPercent,
              APPROVAL_PAYMENT_PERCENT,
            )}
          />
          <SpecRow label="Balance due" value={currency(job.paymentBalance)} />
          <SpecRow
            label="2nd payment date"
            value={
              job.secondPaymentDate
                ? DATE_KL.format(new Date(job.secondPaymentDate))
                : "Not recorded"
            }
          />
        </SpecBlock>

        {/* Nothing here applies to a cleaning-service invoice — there is no
            array, inverter or SEDA filing behind it — so the block is left
            out entirely rather than filled with placeholders for a system
            that was never sold. */}
        {!isCleaningServiceJob(job) && (
          <SpecBlock title="System specification">
            <SpecRow label="Package" value={job.packageName || "Not recorded"} />
            <SpecRow
              label="Solar panels"
              value={
                job.panelQuantity && job.panelRating
                  ? `${job.panelQuantity} panels · ${job.panelRating}W each`
                  : job.panelQuantity
                    ? `${job.panelQuantity} panels · rating not provided`
                    : job.panelRating
                      ? `Quantity not provided · ${job.panelRating}W each`
                      : specFallback(job.panelDetails) ??
                        "Panel specification not provided"
              }
            />
            <SpecRow
              label="Inverter"
              value={
                specFallback(job.inverter) ??
                specFallback(job.inverterBattery) ??
                job.inverter
              }
            />
            <SpecRow
              label="Electrical phase"
              value={job.phase === "Unknown" ? "Not provided" : job.phase}
            />
            <SpecRow
              label="Battery"
              value={
                specFallback(job.battery) ??
                specFallback(job.batteryDetails) ??
                "Not provided"
              }
            />
            {/* Ops-owned and absent from the invoice feed entirely, so they only
                earn a row once someone has actually typed one in. */}
            {specFallback(job.powerOutput) && (
              <SpecRow label="Power output" value={job.powerOutput} />
            )}
            {specFallback(job.wiringDetails) && (
              <SpecRow label="Wiring" value={job.wiringDetails} />
            )}
            <SpecRow
              label="Ballast"
              value={job.ballastDetails || "None recorded"}
            />
            <SpecRow label="FOC items" value={job.focDetails || "None recorded"} />
            <SpecRow label="SEDA status" value={normalizeSeda(job.sedaStatus)} />
            <SpecRow
              label="SLD drawing"
              value={job.sldUrl ? "Available from source" : "Not available"}
            />
          </SpecBlock>
        )}

        <section className="spec-roof">
          <h3>Installation</h3>
          <div className="spec-roof-body">
            <SpecBlock title="Scheduling" nested>
              <SpecRow
                label="Scheduling status"
                value={statusLabels[job.scheduleStatus]}
                emphasis={job.scheduleStatus === "ready_to_install"}
              />
              <SpecRow
                label="Preferred date"
                value={job.preferredInstallationDate || "Not provided"}
              />
              {/* Only sites the crew returns to have these, so the row is
                  absent — not empty — on an ordinary single-day job. */}
              {(job.visits?.length ?? 0) > 0 && (
                <SpecRow
                  label="Return visits"
                  value={job
                    .visits!.slice()
                    .sort((a, b) => a.date.localeCompare(b.date))
                    .map((visit) =>
                      [
                        formatDateOnly(visit.date),
                        visit.time,
                        visit.kind,
                      ]
                        .filter(Boolean)
                        .join(" · "),
                    )
                    .join("\n")}
                  multiline
                />
              )}
              <SpecRow
                label="Status"
                value={availabilityLabels[job.customerAvailabilityStatus]}
              />
              {/* Only a job below the line that clears it to install has an
                  exception worth asking about, so this tracks that line rather
                  than carrying a number of its own. */}
              {!hasReachedPaymentPercent(job.paymentPercent) && (
                <SpecRow
                  label="Payment exception"
                  value={
                    job.paymentOverrideStatus === "none"
                      ? "Not required"
                      : `${job.paymentOverrideStatus}${
                          job.paymentOverrideReason
                            ? ` · ${job.paymentOverrideReason}`
                            : ""
                        }`
                  }
                />
              )}
            </SpecBlock>

            <SpecBlock title="Group and teams" nested>
              <SpecRow label="Location / group" value={locationGroupLabel} />
              <SpecRow
                label="Installation team"
                value={group?.installationTeam || "Unassigned"}
                emphasis={Boolean(group?.installationTeam)}
              />
              <SpecRow
                label="Wiring team"
                value={group?.wiringTeam || "Unassigned"}
                emphasis={Boolean(group?.wiringTeam)}
              />
              <SpecRow
                label="Supervisor"
                value={
                  group?.supervisors.length
                    ? group.supervisors.join(", ")
                    : "Unassigned"
                }
              />
            </SpecBlock>

            <SpecBlock title="Installation details" nested>
              {job.teams.length === 0 && (
                <div className="work-empty">No installation work added yet.</div>
              )}
              {job.teams.map((team) => (
                <div className="work-row" key={team.id}>
                  <span className="work-activity">
                    {team.activity === "other"
                      ? team.customActivity || "Other activity"
                      : installationActivities.find(
                          (activity) => activity.value === team.activity,
                        )?.label || "Installation activity"}
                  </span>
                  <span className="work-team">{team.teamName}</span>
                  <button
                    type="button"
                    className="icon-button"
                    aria-label={`Remove ${team.teamName}`}
                    disabled={saving}
                    onClick={() => removeWorkItem(team.id)}
                  >
                    <X size={14} />
                  </button>
                </div>
              ))}
              <div className="work-add">
                <select
                  aria-label="Work item"
                  value={workDraft.activity}
                  onChange={(event) =>
                    setWorkDraft((current) => ({
                      ...current,
                      activity: event.target
                        .value as TeamAssignment["activity"],
                    }))
                  }
                >
                  {installationActivities.map((activity) => (
                    <option key={activity.value} value={activity.value}>
                      {activity.label}
                    </option>
                  ))}
                </select>
                {workDraft.activity === "other" && (
                  <input
                    aria-label="Custom work item"
                    placeholder="Describe the work"
                    value={workDraft.customActivity}
                    onChange={(event) =>
                      setWorkDraft((current) => ({
                        ...current,
                        customActivity: event.target.value,
                      }))
                    }
                  />
                )}
                <select
                  aria-label="Team"
                  value={workDraft.teamName}
                  onChange={(event) =>
                    setWorkDraft((current) => ({
                      ...current,
                      teamName: event.target.value,
                    }))
                  }
                >
                  <option value="">Select team</option>
                  {availableTeams.map((team) => (
                    <option key={team.id} value={team.name}>
                      {team.name}
                    </option>
                  ))}
                </select>
                <button
                  type="button"
                  className="button primary"
                  disabled={saving || !workDraft.teamName}
                  onClick={addWorkItem}
                >
                  Add
                </button>
              </div>
            </SpecBlock>
          </div>
        </section>

        <SpecBlock title="Material stock delivery">
          <SpecRow
            label="Delivery run"
            value={deliveryRun?.name || "Not assigned"}
            emphasis={Boolean(deliveryRun)}
          />
          <SpecRow
            label="Delivery status"
            value={
              deliveryRun
                ? deliveryRunStatusLabels[deliveryRun.status]
                : deliveryLabels[job.deliveryStatus]
            }
            emphasis={deliveryRun?.status === "delivered"}
          />
          <SpecRow
            label="Delivery date"
            value={
              deliveryRun?.deliveryDate || job.deliveryDate || "Not scheduled"
            }
          />
          <SpecRow
            label="Arrival date"
            value={job.arrivalDate || "Not recorded"}
          />
          <SpecRow
            label="Warehouse / origin"
            value={
              deliveryRun?.warehouse || job.warehouseLocation || "Not selected"
            }
          />
          <SpecRow
            label="Delivery team"
            value={deliveryRun?.deliveryTeam || "Not assigned"}
          />
          <SpecRow
            label="Delivery PIC"
            value={deliveryRun?.deliveryPic || "Not assigned"}
          />
          <SpecRow
            label="Delivery contact"
            value={
              deliveryRun?.contactNumber ||
              job.deliveryContactNumber ||
              job.customerPhone ||
              "Not entered"
            }
          />
          <SpecRow
            label="Stock details"
            value={job.stockDetails || "Not entered"}
          />
          <SpecRow
            label="Delivery destination"
            value={
              job.address
                ? formatCustomerAddress(job.address)
                : "Client address unavailable"
            }
          />
        </SpecBlock>

        <SpecBlock title="Remarks" wide>
          {editingRemarks ? (
            <div className="record-remarks-edit">
              <textarea
                rows={4}
                value={remarksDraft}
                autoFocus
                aria-label="Remarks"
                placeholder="Add blockers, customer confirmation, or special instructions…"
                onChange={(event) => setRemarksDraft(event.target.value)}
              />
              <div className="form-actions">
                <button
                  className="button secondary"
                  onClick={() => {
                    setRemarksDraft(job.remarks);
                    setEditingRemarks(false);
                  }}
                >
                  Cancel
                </button>
                <button
                  className="button primary"
                  disabled={saving}
                  onClick={() => {
                    onSave({ ...job, remarks: remarksDraft });
                    setEditingRemarks(false);
                  }}
                >
                  {saving ? "Saving…" : "Save remarks"}
                </button>
              </div>
            </div>
          ) : (
            <div className="record-remarks-view">
              <p>{job.remarks || "No remarks recorded."}</p>
              <button
                className="button secondary"
                onClick={() => setEditingRemarks(true)}
              >
                Edit remarks
              </button>
            </div>
          )}
        </SpecBlock>
      </div>
    </aside>
  );
}

// Datasheet blocks: an uppercase rule-under heading with dense label/value
// rows beneath, so a record reads like a spec sheet rather than a form.
function SpecBlock({
  title,
  children,
  nested = false,
  wide = false,
}: {
  title: string;
  children: React.ReactNode;
  nested?: boolean;
  wide?: boolean;
}) {
  return (
    <section
      className={`spec-block${nested ? " nested" : ""}${wide ? " wide" : ""}`}
    >
      <h4>{title}</h4>
      <dl>{children}</dl>
    </section>
  );
}

function SpecRow({
  label,
  value,
  emphasis = false,
  // Opt-in, because every other row is a single value and collapsing its
  // whitespace is the right default. Only set it where the value is a list
  // whose line breaks carry meaning.
  multiline = false,
}: {
  label: string;
  value: string;
  emphasis?: boolean;
  multiline?: boolean;
}) {
  return (
    <div
      className={`spec-row${emphasis ? " emphasis" : ""}${
        multiline ? " is-multiline" : ""
      }`}
    >
      <dt>{label}</dt>
      <dd>{value}</dd>
    </div>
  );
}

export default function DashboardPage() {
  const [view, setView] = useState<DashboardView>("groups");
  // Schedule & assign is no longer a tab on the groups page; it opens as a
  // modal when creating a new installation group.
  const [showScheduleModal, setShowScheduleModal] = useState(false);
  // The pipeline report, opened from under the sidebar calendar. "ytd" counts
  // only customers whose deposit landed this calendar year; "all" counts every
  // customer the source carries.
  const [showReportModal, setShowReportModal] = useState(false);
  const [reportPeriod, setReportPeriod] = useState<"ytd" | "month" | "all">("ytd");
  const [reportMonth, setReportMonth] = useState<string>("");
  // Set by clicking a date in the sidebar calendar; narrows the pipeline table
  // to jobs installing (or, for Available/Pending customers, preferring to
  // install) on that date.
  const [installationDateFilter, setInstallationDateFilter] = useState("");
  const [jobs, setJobs] = useState<InstallationJob[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  // The search box binds to `query` so typing stays instant, but every filter
  // and count downstream reads `deferredQuery`. React renders the keystroke
  // first and the re-filtered table after, so a slow pass over the pipeline
  // can no longer block the character appearing in the input.
  const deferredQuery = useDeferredValue(query);
  const [status, setStatus] = useState<string>(ALL_JOBS);
  const [stateFilter, setStateFilter] = useState("all");
  const [secondPaymentMonthFilter, setSecondPaymentMonthFilter] = useState("");
  // Manually pinned rows on Customer details — a personal, browser-local
  // preference rather than shared job data, so it lives in localStorage only.
  // Starts empty on the server render; the mount effect below fills it in.
  const [pinnedJobIds, setPinnedJobIds] = useState<Set<string>>(new Set());
  // Frozen rows on Customer details — the opposite of the pin above: shared
  // ops data rather than a personal preference, because freezing a customer
  // off the active pipeline is a decision about the row that should hold for
  // everyone, not just the browser that clicked it. The job itself is never
  // touched — freezing only drops it from the summary cards, Customer
  // Scheduling, Installation groups and Stock delivery; it keeps listing here
  // on Customer details so it can be found again and unfrozen.
  const [frozenJobIds, setFrozenJobIds] = useState<Set<string>>(new Set());
  // Customer Scheduling's roof ratings and schedule draft — see SharedOpsState.
  const [siteAssessments, setSiteAssessments] = useState<
    Record<string, SiteAssessment>
  >({});
  const [scheduleDraft, setScheduleDraft] = useState<ScheduleDraft>(EMPTY_DRAFT);
  // Lifted out of Team planning so the summary cards above it can be scoped to
  // the same filters while that page is active — see planningScopedJobs below.
  const [planningFilter, setPlanningFilter] = useState<string>(ALL_JOBS);
  const [planningPostcodeFilter, setPlanningPostcodeFilter] = useState("");
  const [planningMonthFilter, setPlanningMonthFilter] = useState("");
  const [planningCustomerNameFilter, setPlanningCustomerNameFilter] =
    useState("");
  const [workCategoryFilter, setWorkCategoryFilter] = useState<string>(ALL_JOBS);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [meta, setMeta] = useState<Omit<JobsResponse, "jobs"> | null>(null);
  const [editMode, setEditMode] = useState(false);
  const [sldOpen, setSldOpen] = useState(false);
  const [darkMode, setDarkMode] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [roofGuideOpen, setRoofGuideOpen] = useState(true);
  const [updateStatus, setUpdateStatus] = useState<UpdateStatus | null>(null);
  const [groups, setGroups] = useState<InstallationGroup[]>([]);
  const [deliveryRuns, setDeliveryRuns] = useState<DeliveryRun[]>([]);
  const [warehouses, setWarehouses] = useState<Warehouse[]>([]);
  const [teamResources, setTeamResources] =
    useState<TeamResource[]>(defaultTeamResources);
  const [teamWeekAssignments, setTeamWeekAssignments] = useState<
    TeamWeekAssignment[]
  >([]);
  const [composer, setComposer] = useState<"group" | null>(null);
  const [showSettings, setShowSettings] = useState(false);
  const [settingsForm, setSettingsForm] = useState({
    url: "",
    database: "",
    token: "",
  });
  const [settingsHasToken, setSettingsHasToken] = useState(false);
  const [isDesktop, setIsDesktop] = useState(false);
  const [currentUser, setCurrentUser] = useState<{
    id: string;
    username: string;
    displayName: string;
    role: "admin" | "staff";
  } | null>(null);

  useEffect(() => {
    let cancelled = false;

    // Only a 401 means the session is actually gone. Anything else is the
    // check itself having failed — a 503 because the database was unreachable,
    // or the fetch never landing — and reading that as a sign-out is what used
    // to dump people on the login screen mid-shift. The commonest case is the
    // very first check after the server restarts, which runs the schema
    // migration batch before it can answer, so it is also the case most worth
    // retrying: without one, the session survives but the header sits there
    // with no name and no Sign out button until someone reloads.
    async function loadCurrentUser(attemptsLeft: number) {
      try {
        const response = await fetch("/api/auth/me");
        if (cancelled) return;
        if (response.status === 401) {
          window.location.href = "/login";
          return;
        }
        if (!response.ok) throw new Error("check unavailable");
        const payload = (await response.json()) as {
          user: typeof currentUser;
        };
        if (!cancelled) setCurrentUser(payload.user);
      } catch {
        if (cancelled || attemptsLeft <= 0) return;
        setTimeout(() => void loadCurrentUser(attemptsLeft - 1), 3000);
      }
    }

    void loadCurrentUser(2);
    return () => {
      cancelled = true;
    };
  }, []);

  async function signOut() {
    try {
      await fetch("/api/auth/logout", { method: "POST" });
    } finally {
      window.location.href = "/login";
    }
  }
  const [settingsSaving, setSettingsSaving] = useState(false);
  const [settingsError, setSettingsError] = useState<string | null>(null);
  const [groupDraft, setGroupDraft] = useState({
    name: "",
    area: "",
    installationDate: "",
    installationEndDate: "",
  });

  const jobUpdatesRef = useRef<Record<string, JobUpdate>>({});
  // Mirrors the groups state for the same reason jobUpdatesRef mirrors its
  // own: the jobs fetch reads it from a callback that would otherwise close
  // over an empty list on the first load.
  const groupsRef = useRef<InstallationGroup[]>([]);

  // Whether this device has a confirmed connection to the shared database.
  // Held in a ref as well as state because the save helpers below are plain
  // functions that need the current value at call time, not at render time.
  const storeOnlineRef = useRef(false);
  const [storeOnline, setStoreOnline] = useState(false);

  const markStore = useCallback((online: boolean) => {
    storeOnlineRef.current = online;
    setStoreOnline(online);
  }, []);

  // Every write goes through here, and a failure is always reported. This app
  // is the only record of the planning data, so telling someone their work is
  // saved when it never reached the database is how a day's planning is lost.
  const persistOps = useCallback(
    (patch: Partial<SharedOpsState>) => {
      if (!storeOnlineRef.current) {
        setNotice(
          "NOT SAVED to the shared database — this device cannot reach it. " +
            "Your change is on this device only. Reconnecting…",
        );
        return;
      }

      void (async () => {
        try {
          // Retrying is safe: the route merges the patch rather than replacing
          // the row, so the same patch applied twice lands the same state.
          const response = await fetchWithRetry("/api/ops-state", {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(patch),
          });
          if (!response.ok) {
            throw new Error(
              await readError(response, `The database returned ${response.status}.`),
            );
          }
        } catch (error) {
          markStore(false);
          setNotice(
            "NOT SAVED to the shared database. " +
              describeRequestError(error) +
              " Your change is on this device only. Reconnecting…",
          );
        }
      })();
    },
    [markStore],
  );

  const applySharedState = useCallback(
    (state: SharedOpsState) => {
      // Runs on every load, not just once — cheap (a no-op map once nothing
      // has skylifts left, or supervisors is already a list) and it means a
      // group edited on a device that missed a migration still gets caught
      // the next time anyone loads it, rather than depending on every
      // client having upgraded first.
      const migratedGroups = state.groups
        .map(migrateGroupSkylift)
        .map(migrateGroupSupervisor);
      setGroups(migratedGroups);
      setDeliveryRuns(state.deliveryRuns);
      // Older saved states predate the warehouse list, so it can be absent.
      setWarehouses(state.warehouses ?? []);
      setTeamResources(
        state.teamResources.length ? state.teamResources : defaultTeamResources,
      );
      setTeamWeekAssignments(state.teamWeekAssignments);
      // Older saved states predate freezing, so it can be absent.
      setFrozenJobIds(new Set(state.frozenJobIds ?? []));
      setSiteAssessments(state.siteAssessments ?? {});
      setScheduleDraft(normalizeDraft(state.scheduleDraft));
      jobUpdatesRef.current = state.jobUpdates;
      groupsRef.current = migratedGroups;
      setJobs((current) =>
        current.length
          ? applyJobUpdates(
              current,
              state.jobUpdates,
              migratedGroups,
              malaysiaToday(),
            )
          : current,
      );
      if (migratedGroups.some((group, index) => group !== state.groups[index])) {
        persistOps({ groups: migratedGroups });
      }
    },
    [persistOps],
  );

  const loadSharedState = useCallback(
    // `silent` is for the background reconnect below: it retries on a timer, so
    // a failure there is the banner already on screen repeating itself, not
    // news. Without it every attempt would re-raise a notice the user had just
    // dismissed.
    async (seedIfMissing: boolean, silent = false) => {
      const local: SharedOpsState = {
        groups: readLocalJson(GROUPS_STORAGE_KEY, []),
        deliveryRuns: readLocalJson(DELIVERY_RUNS_STORAGE_KEY, []),
        warehouses: readLocalJson(WAREHOUSES_STORAGE_KEY, []),
        teamResources: readLocalJson(TEAMS_STORAGE_KEY, defaultTeamResources),
        teamWeekAssignments: readLocalJson(TEAM_WEEKS_STORAGE_KEY, []),
        jobUpdates: readLocalJson(STORAGE_KEY, {}),
        frozenJobIds: readLocalJson(FROZEN_JOBS_STORAGE_KEY, []),
        siteAssessments: readLocalJson(SITE_ASSESSMENTS_STORAGE_KEY, {}),
        scheduleDraft: readLocalJson(SCHEDULE_DRAFT_STORAGE_KEY, EMPTY_DRAFT),
      };
      try {
        const response = await fetchWithRetry("/api/ops-state", {
          cache: "no-store",
        });
        if (!response.ok) {
          throw new Error(
            await readError(response, "Shared planning data is unavailable."),
          );
        }
        const data = (await response.json()) as {
          exists: boolean;
          state: SharedOpsState;
        };
        const wasOffline = !storeOnlineRef.current;
        markStore(true);
        // Clearing the notice is what actually ends the outage on screen: the
        // red banner goes with storeOnline, but the "changes will not be saved"
        // line it left behind would otherwise sit there contradicting a store
        // that is now writable again.
        if (wasOffline) setNotice(null);
        if (data.exists) {
          applySharedState(data.state);
        } else {
          // No stored row at all — a genuinely fresh database. Seed it with this
          // browser's existing data so nothing already planned is lost. The API
          // answers 503 rather than an empty state when it cannot reach the
          // database, so an outage can never be mistaken for this case.
          if (seedIfMissing) persistOps(local);
          applySharedState(local);
        }
      } catch (error) {
        // Show this device's own copy so work already on screen stays visible,
        // but keep the store marked offline. That blocks writes, which is the
        // point: this snapshot is likely older than what is on the server, and
        // saving it would overwrite colleagues' newer planning with stale data.
        markStore(false);
        applySharedState(local);
        if (!silent) {
          setNotice(
            describeRequestError(error, "Shared planning data is unavailable.") +
              " Showing this device's last copy — changes will not be saved.",
          );
        }
      }
    },
    [applySharedState, markStore, persistOps],
  );

  useEffect(() => {
    setDarkMode(false);
    document.documentElement.dataset.theme = "light";
    window.localStorage.setItem(THEME_STORAGE_KEY, "light");

    setSidebarCollapsed(
      window.localStorage.getItem(SIDEBAR_STORAGE_KEY) === "collapsed",
    );

    setPinnedJobIds(
      new Set(readLocalJson<string[]>(PINNED_JOBS_STORAGE_KEY, [])),
    );

    void loadSharedState(true);
  }, [loadSharedState]);

  // Pick up colleagues' changes when returning to this tab. Uses
  // visibilitychange (not window "focus") because focus fires far too
  // readily — including from opening a native <select> or date picker
  // inside the page — which was replacing `jobs` mid-interaction and
  // interrupting clicks in open modals (e.g. the Team Planning preview).
  useEffect(() => {
    const refresh = () => {
      if (document.visibilityState === "visible") {
        void loadSharedState(false);
      }
    };
    document.addEventListener("visibilitychange", refresh);
    return () => document.removeEventListener("visibilitychange", refresh);
  }, [loadSharedState]);

  // A dashboard-server restart drops the one request that would have loaded the
  // shared store, and nothing else re-runs that load: the job list has its own
  // refresh and recovers by itself, so the app settles into showing a full
  // pipeline behind a permanent "nothing will be saved" banner until somebody
  // notices it and presses Refresh. Keep asking quietly instead — the first
  // answer clears both banners. Only while offline, so there is no polling in
  // the normal case, and only while the window is visible, so a machine left
  // open overnight is not retrying into the dark.
  useEffect(() => {
    if (storeOnline || loading) return;
    const timer = window.setInterval(() => {
      if (document.visibilityState === "visible") {
        void loadSharedState(false, true);
      }
    }, RECONNECT_INTERVAL_MS);
    return () => window.clearInterval(timer);
  }, [storeOnline, loading, loadSharedState]);

  // Only present in the packaged Electron app (see electron/preload.cjs) —
  // absent in a plain browser tab, so this is a no-op there.
  useEffect(() => {
    const desktop = window.installationDesktop;
    if (!desktop) {
      return;
    }
    setIsDesktop(true);
    const unsubscribe = desktop.onUpdateStatus((status) => {
      setUpdateStatus(status);
      if (status.state === "error") {
        setNotice(status.message);
      }
    });
    void desktop.checkForUpdates();
    return unsubscribe;
  }, []);

  const updateButtonLabel = useMemo(() => {
    if (!updateStatus) return null;
    switch (updateStatus.state) {
      case "available":
        return `Install Update (v${updateStatus.version})`;
      case "downloading":
        return `Downloading update… ${Math.round(updateStatus.percent)}%`;
      case "downloaded":
        return "Installing…";
      default:
        return null;
    }
  }, [updateStatus]);

  const sourceAge = useMemo(
    () => describeSourceAge(meta?.sourceUpdatedAt ?? null),
    [meta?.sourceUpdatedAt],
  );

  const loadJobs = useCallback(async (manual = false) => {
    manual ? setSyncing(true) : setLoading(true);
    setNotice(null);
    try {
      // Refresh is also how someone recovers from an outage, so retry the
      // shared store first. It sets jobUpdatesRef, which the merge below needs.
      if (manual) {
        await loadSharedState(false);
      }
      // cache: "no-store" only defeats the browser cache. The route keeps its
      // own short-lived one, so an explicit "check for new jobs" has to ask for
      // ?fresh=1 or a press inside that TTL never reaches the source at all.
      const response = await fetch(manual ? "/api/jobs?fresh=1" : "/api/jobs", {
        cache: "no-store",
      });
      const data = (await response.json()) as JobsResponse;
      if (!response.ok) throw new Error("Could not load installation jobs.");
      const merged = applyJobUpdates(
        data.jobs,
        jobUpdatesRef.current,
        groupsRef.current,
        malaysiaToday(),
      );
      setJobs(merged);
      setMeta({
        source: data.source,
        persistence: data.persistence,
        warning: data.warning,
        syncedAt: data.syncedAt,
        sourceUpdatedAt: data.sourceUpdatedAt,
      });
      // Only when the shared store came back too — otherwise this would paper
      // over the "changes will not be saved" warning loadSharedState just set.
      if (manual && storeOnlineRef.current) {
        setNotice(`Source refreshed. ${merged.length} eligible jobs found.`);
      }
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Dashboard failed to load.");
    } finally {
      setLoading(false);
      setSyncing(false);
    }
  }, [loadSharedState]);

  useEffect(() => {
    void loadJobs();
  }, [loadJobs]);

  const openSettings = useCallback(async () => {
    setSettingsError(null);
    const desktop = window.installationDesktop;
    if (desktop) {
      const current = await desktop.getSettings();
      setSettingsForm({
        url: current.url,
        database: current.database,
        token: "",
      });
      setSettingsHasToken(current.hasToken);
    }
    setShowSettings(true);
  }, []);

  const saveSettings = useCallback(async () => {
    const desktop = window.installationDesktop;
    if (!desktop) {
      return;
    }

    setSettingsSaving(true);
    setSettingsError(null);
    try {
      const result = await desktop.saveSettings(settingsForm);
      if (!result.ok) {
        setSettingsError(result.message);
        return;
      }
      setShowSettings(false);
      setSettingsForm((form) => ({ ...form, token: "" }));
      // Prove the new details actually work rather than just claiming success —
      // the connection dot tells the user whether it took.
      await loadJobs(true);
    } catch (error) {
      setSettingsError(
        error instanceof Error ? error.message : "Could not save the settings.",
      );
    } finally {
      setSettingsSaving(false);
    }
  }, [settingsForm, loadJobs]);

  const states = useMemo(
    () =>
      Array.from(new Set(jobs.map((job) => job.state).filter(Boolean))).sort(),
    [jobs],
  );

  const groupByJobId = useMemo(
    () => latestByJobId(groups, (group) => group.installationDate),
    [groups],
  );

  const deliveryRunByJobId = useMemo(
    () => latestByJobId(deliveryRuns, (run) => run.deliveryDate),
    [deliveryRuns],
  );

  // What "Scheduled Installation" needs to know about a job beyond the job
  // record itself. Declared here, above every stage filter that reads it.
  const planningLookup = useMemo(
    () => ({ groupByJobId, deliveryRunByJobId }),
    [groupByJobId, deliveryRunByJobId],
  );

  // The sidebar calendar sits outside the groups workspace, so it needs its
  // own forecast rather than the one InstallationGroupsView holds.
  const sidebarWeather = useCalendarWeather(groups, jobs);

  // The sidebar calendar's hover model, keyed by date. Resolved here rather
  // than inside the calendar because getting from a customer to their crew
  // runs job -> group -> team assignment, and those lookups belong with the
  // rest of this page's domain logic; the calendar only reads a date off it.
  //
  // Keyed by date rather than built per month, so paging the calendar needs no
  // recomputation and the memo does not depend on which month is on screen.
  // Built by lib/calendar-day-details so the sign-in screen's calendar and
  // this one cannot disagree about a day.
  const calendarDayDetails = useMemo(
    () =>
      buildCalendarDayDetails(jobs, groups, teamWeekAssignments, deliveryRuns, scheduleDraft),
    [jobs, groups, teamWeekAssignments, deliveryRuns, scheduleDraft],
  );

  // Everything but the jobs someone has frozen off the active pipeline. Used
  // everywhere that stands for "active work" — the summary cards, Customer
  // Scheduling, Installation groups and Stock delivery — but deliberately not
  // by pipelineScopedJobs below: a frozen row still has to show up on
  // Customer details, unhighlighted, or there would be no way back to
  // unfreeze it.
  const activeJobs = useMemo(
    () => jobs.filter((job) => !frozenJobIds.has(job.id)),
    [jobs, frozenJobIds],
  );

  // The pipeline narrowed by every filter except the status one: search, state
  // and 2nd payment month. Deliberately excludes status — that is the per-card
  // axis stageCounts computes, and folding it in here would zero every card
  // except the selected one.
  const pipelineScopedJobs = useMemo(() => {
    const needle = deferredQuery.toLowerCase().trim();
    return jobs.filter((job) => {
      const matchesQuery = !needle || pipelineHaystack(job).includes(needle);
      const matchesState = stateFilter === "all" || job.state === stateFilter;
      // A text search over the payment's month and year — "august", "2026",
      // "august 2026". Matched as plain strings, so no date parsing and no
      // timezone can shift a payment into the month next door.
      const matchesSecondPaymentMonth = matchesSecondPaymentSearch(
        job,
        secondPaymentMonthFilter,
      );
      // Set by clicking a date in the calendar panel. Matches the confirmed
      // installation date, or — for a customer with no confirmed date yet —
      // the preferred date they gave on Customer Scheduling, so an Available
      // or Pending customer still shows up under the date they're pencilled
      // in for.
      const matchesInstallationDate =
        !installationDateFilter ||
        job.installationDate === installationDateFilter ||
        job.preferredInstallationDate === installationDateFilter;
      return (
        matchesQuery &&
        matchesState &&
        matchesSecondPaymentMonth &&
        matchesInstallationDate &&
        matchesWorkCategory(job, workCategoryFilter)
      );
    });
  }, [
    jobs,
    deferredQuery,
    stateFilter,
    secondPaymentMonthFilter,
    installationDateFilter,
    workCategoryFilter,
  ]);

  // Computed once per render rather than memoized — it is a cheap
  // Intl.DateTimeFormat call, and every filter/count below needs to agree on
  // exactly the same "today" or their numbers could disagree mid-render.
  const todayIso = malaysiaToday();

  const filteredJobs = useMemo(() => {
    return pipelineScopedJobs
      .filter((job) => matchesPipelineStage(job, status, todayIso, planningLookup))
      .sort((a, b) => {
        if (!a.secondPaymentDate && !b.secondPaymentDate) {
          return a.customerName.localeCompare(b.customerName);
        }
        if (!a.secondPaymentDate) return 1;
        if (!b.secondPaymentDate) return -1;
        // Newest first, so the current month sits at the top.
        const dateOrder =
          new Date(b.secondPaymentDate).getTime() -
          new Date(a.secondPaymentDate).getTime();
        return dateOrder || a.customerName.localeCompare(b.customerName);
      });
  }, [pipelineScopedJobs, status, todayIso, planningLookup]);

  const selected = jobs.find((job) => job.id === selectedId) ?? null;

  // The same pool Team planning itself works from: still to be planned, and
  // narrowed by whichever of its own filters (postcode, 2nd payment month) are
  // active. Deliberately excludes planningFilter/matchesPlanningStatus — that
  // is the per-card axis stageCounts below computes, not a pre-filter.
  const planningScopedJobs = useMemo(() => {
    const postcodeSearch = planningPostcodeFilter.trim().toLowerCase();
    const nameSearch = planningCustomerNameFilter.trim().toLowerCase();
    // Customers already in an installation group are deliberately still
    // counted here: they stay listed on Customer Scheduling so their
    // availability and dates remain editable, so the cards have to describe
    // the same pool the table below shows.
    // Completed installs stay in the counting pool so the Complete
    // Installation card shows its real number instead of a nought that only
    // fills in once clicked. Every other stage carries its own !installed
    // guard, so admitting them here cannot inflate any other card.
    return activeJobs.filter(
      (job) =>
        belongsInPlanning(job, groupByJobId.get(job.id), planningLookup) &&
        matchesSecondPaymentSearch(job, planningMonthFilter) &&
        (!postcodeSearch ||
          postcodeForJob(job).toLowerCase().includes(postcodeSearch)) &&
        jobMatchesSearch(job, nameSearch) &&
        matchesWorkCategory(job, workCategoryFilter),
    );
  }, [
    activeJobs,
    groups,
    groupByJobId,
    planningLookup,
    todayIso,
    planningPostcodeFilter,
    planningMonthFilter,
    planningCustomerNameFilter,
    workCategoryFilter,
  ]);

  // One count per pipeline stage, produced by the same predicate the status
  // filter runs. Clicking a card and reading its number can never disagree.
  // Each workspace counts over its own filtered pool — Team planning's, or the
  // pipeline's search/state/month narrowing — so the cards always describe the
  // list underneath them rather than a global total the filters never touch.
  const stageCounts = useMemo(() => {
    // planningScopedJobs is already built from activeJobs, so this filter is
    // a no-op there; pipelineScopedJobs is not (Customer details keeps
    // frozen rows visible), so it has to be dropped here instead — the cards
    // are the one place on that tab a frozen row must not count.
    const pool = planningScopedJobs.filter(
      (job) => !frozenJobIds.has(job.id),
    );
    const counts = {} as Record<StageValue, number>;
    PIPELINE_STAGES.forEach((stage) => {
      counts[stage.value] = pool.filter((job) =>
        matchesPipelineStage(job, stage.value, todayIso, planningLookup),
      ).length;
    });
    return counts;
  }, [
    planningScopedJobs,
    frozenJobIds,
    todayIso,
    planningLookup,
  ]);

  const solarTotalCount = useMemo(
    () =>
      activeJobs.filter(
        (job) =>
          jobIsSolar(job) &&
          hasReachedPaymentPercent(job.paymentPercent, 60) &&
          jobIsYear2026(job),
      ).length,
    [activeJobs],
  );
  const evTotalCount = useMemo(
    () =>
      activeJobs.filter(
        (job) =>
          jobHasEv(job) &&
          hasReachedPaymentPercent(job.paymentPercent, 60) &&
          jobIsYear2026(job),
      ).length,
    [activeJobs],
  );

  const availableReportMonths = useMemo(() => {
    const set = new Set<string>();
    jobs.forEach((job) => {
      if (job.firstPaymentDate) set.add(job.firstPaymentDate.slice(0, 7));
      if (job.secondPaymentDate) set.add(job.secondPaymentDate.slice(0, 7));
      if (job.installationDate) set.add(job.installationDate.slice(0, 7));
    });
    if (todayIso) set.add(todayIso.slice(0, 7));
    const sorted = Array.from(set).sort().reverse();
    return sorted.map((ym) => {
      const [y, m] = ym.split("-");
      const date = new Date(parseInt(y, 10), parseInt(m, 10) - 1, 1);
      const label = date.toLocaleDateString("en-MY", { month: "long", year: "numeric" });
      return { value: ym, label };
    });
  }, [jobs, todayIso]);

  // The report reads the whole customer list, not the filtered pipeline: it
  // answers "where does the business stand", which a search box left open on
  // another tab must not silently change the answer to.
  const reportData = useMemo(() => {
    const yearStart = `${todayIso.slice(0, 4)}-01-01`;
    const activeMonth = reportMonth || availableReportMonths[0]?.value || (todayIso ? todayIso.slice(0, 7) : "");
    // Year to date is measured on the deposit — the payment that puts a
    // customer into the pipeline in the first place. A customer with no
    // payment recorded has no date to place them by, so they can only ever be
    // counted in the all-time view.
    const scoped =
      reportPeriod === "ytd"
        ? jobs.filter(
            (job) => job.firstPaymentDate && job.firstPaymentDate >= yearStart,
          )
        : reportPeriod === "month"
        ? jobs.filter((job) => {
            const months = [
              job.firstPaymentDate?.slice(0, 7),
              job.installationDate?.slice(0, 7),
              job.secondPaymentDate?.slice(0, 7),
              job.preferredInstallationDate?.slice(0, 7),
            ].filter(Boolean);
            return months.includes(activeMonth);
          })
        : jobs;

    const empty = () => ({ count: 0, value: 0, outstanding: 0 });
    const buckets: Record<ReportBucket, ReturnType<typeof empty>> = {
      deposit_pending: empty(),
      paid_pending: empty(),
      paid_installed: empty(),
      deposit_installed: empty(),
      unpaid: empty(),
    };
    const total = empty();
    const byAgent = new Map<string, number>();

    scoped.forEach((job) => {
      const bucket = buckets[reportBucketOf(job, planningLookup)];
      const value = Number.isFinite(job.totalAmount) ? job.totalAmount : 0;
      const owed = Number.isFinite(job.paymentBalance) ? job.paymentBalance : 0;
      bucket.count += 1;
      bucket.value += value;
      bucket.outstanding += owed;
      total.count += 1;
      total.value += value;
      total.outstanding += owed;
      const agent = job.agentName?.trim();
      if (agent) byAgent.set(agent, (byAgent.get(agent) ?? 0) + 1);
    });

    const agents = Array.from(byAgent, ([name, count]) => ({ name, count }))
      .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name))
      .slice(0, 8);

    return { total, buckets, agents, yearStart };
  }, [jobs, reportPeriod, reportMonth, availableReportMonths, planningLookup, todayIso]);

  // How many of the three arrangement columns a job has filled in: assigned
  // teams, delivery run, installation date. Drives the row shade in the
  // pipeline table — purely informational now, no longer the sort order.
  const arrangedCountFor = useCallback(
    (job: InstallationJob) => {
      const group = groupByJobId.get(job.id);
      const hasTeams = Boolean(group?.installationTeam || group?.wiringTeam);
      const hasDeliveryRun = Boolean(deliveryRunByJobId.get(job.id));
      const hasDate = Boolean(job.installationDate || group?.installationDate);
      return Number(hasTeams) + Number(hasDeliveryRun) + Number(hasDate);
    },
    [groupByJobId, deliveryRunByJobId],
  );

  function togglePinJob(jobId: string) {
    setPinnedJobIds((previous) => {
      const next = new Set(previous);
      if (next.has(jobId)) {
        next.delete(jobId);
      } else {
        next.add(jobId);
      }
      window.localStorage.setItem(
        PINNED_JOBS_STORAGE_KEY,
        JSON.stringify(Array.from(next)),
      );
      return next;
    });
  }

  // Unlike togglePinJob above, this is shared: everyone should see the same
  // row drop from the active pipeline, so the change is written to ops-state
  // rather than kept on this device alone.
  function toggleFreezeJob(jobId: string) {
    setFrozenJobIds((previous) => {
      const next = new Set(previous);
      if (next.has(jobId)) {
        next.delete(jobId);
      } else {
        next.add(jobId);
      }
      const nextIds = Array.from(next);
      window.localStorage.setItem(
        FROZEN_JOBS_STORAGE_KEY,
        JSON.stringify(nextIds),
      );
      persistOps({ frozenJobIds: nextIds });
      return next;
    });
  }

  // Manually pinned rows sort to the top; pinned and unpinned rows each keep
  // their existing payment-date order within their own group.
  const pipelineJobs = useMemo(() => {
    return filteredJobs
      .map((job, index) => ({ job, index, pinned: pinnedJobIds.has(job.id) }))
      .sort((a, b) => Number(b.pinned) - Number(a.pinned) || a.index - b.index)
      .map((entry) => entry.job);
  }, [filteredJobs, pinnedJobIds]);

  // Narrowing the list should start you back at the top of it, so the cap
  // resets whenever the filters change. Pinning is deliberately not in here:
  // it reorders rows you are already looking at, and collapsing the list back
  // to the first hundred underneath the click would lose your place.
  const [visibleCount, setVisibleCount] = useState(PIPELINE_PAGE_SIZE);
  useEffect(() => {
    setVisibleCount(PIPELINE_PAGE_SIZE);
  }, [
    deferredQuery,
    status,
    stateFilter,
    secondPaymentMonthFilter,
    installationDateFilter,
  ]);

  const visiblePipelineJobs = useMemo(
    () => pipelineJobs.slice(0, visibleCount),
    [pipelineJobs, visibleCount],
  );

  // "Team 3, Installer AR17". Teams are stored on a group by name, and two
  // teams can share a name (one installing, one wiring), so the slot decides
  // which of them the role is read from — matching how an assignment routes a
  // team into installationTeam vs wiringTeam in the first place.
  function teamLabelFor(
    name: string | undefined,
    slot: "installation" | "wiring",
  ) {
    if (!name) return "";
    const wantsWiring = slot === "wiring";
    const match =
      teamResources.find(
        (team) => team.name === name && isWiringRole(team.role) === wantsWiring,
      ) ?? teamResources.find((team) => team.name === name);
    return match ? `${name}, ${teamRoleLabel(match.role)}` : name;
  }

  function locationGroupLabelFor(jobId: string) {
    const group = groupByJobId.get(jobId);
    if (group) {
      return [group.name, group.area].filter(Boolean).join(" · ");
    }
    return "Not grouped";
  }

  const selectedPlanningGroup = selected
    ? groupByJobId.get(selected.id)
    : undefined;
  const selectedDeliveryRun = selected
    ? deliveryRunByJobId.get(selected.id)
    : undefined;
  const selectedJobForDisplay = selected
    ? recordJobFor(selected, selectedPlanningGroup, selectedDeliveryRun, groups)
    : null;

  // Escape closes the top-most popup, one layer per press. The order matches
  // how they stack rather than how they are declared: a composer can be opened
  // from inside the schedule modal, and the SLD drawing sits inside the
  // customer record, so both have to give way before the thing underneath.
  const dashboardPopupOpen = Boolean(
    composer ||
      selectedJobForDisplay ||
      showSettings ||
      showScheduleModal,
  );

  const closeTopPopup = useCallback(() => {
    if (composer) {
      setComposer(null);
      return;
    }
    if (selectedJobForDisplay) {
      if (sldOpen) {
        setSldOpen(false);
        return;
      }
      setSelectedId(null);
      setEditMode(false);
      return;
    }
    if (showSettings) {
      setShowSettings(false);
      return;
    }
    if (showScheduleModal) setShowScheduleModal(false);
  }, [
    composer,
    selectedJobForDisplay,
    sldOpen,
    showSettings,
    showScheduleModal,
  ]);

  useEscapeKey(dashboardPopupOpen, closeTopPopup);

  function saveGroups(next: InstallationGroup[]) {
    setGroups(next);
    groupsRef.current = next;
    window.localStorage.setItem(GROUPS_STORAGE_KEY, JSON.stringify(next));
    persistOps({ groups: next });
  }

  function saveDeliveryRuns(next: DeliveryRun[]) {
    setDeliveryRuns(next);
    window.localStorage.setItem(DELIVERY_RUNS_STORAGE_KEY, JSON.stringify(next));
    persistOps({ deliveryRuns: next });
  }

  function saveWarehouses(next: Warehouse[]) {
    setWarehouses(next);
    window.localStorage.setItem(WAREHOUSES_STORAGE_KEY, JSON.stringify(next));
    persistOps({ warehouses: next });
  }

  function saveTeamResources(next: TeamResource[]) {
    setTeamResources(next);
    window.localStorage.setItem(TEAMS_STORAGE_KEY, JSON.stringify(next));
    persistOps({ teamResources: next });
  }

  function saveTeamWeekAssignments(next: TeamWeekAssignment[]) {
    setTeamWeekAssignments(next);
    window.localStorage.setItem(TEAM_WEEKS_STORAGE_KEY, JSON.stringify(next));
    persistOps({ teamWeekAssignments: next });
  }

  // Only the one rating travels: the store merges siteAssessments per job id,
  // so sending the whole map would be wasted bytes, not a correctness issue.
  function saveSiteAssessment(jobId: string, assessment: SiteAssessment) {
    setSiteAssessments((current) => {
      const next = { ...current, [jobId]: assessment };
      window.localStorage.setItem(
        SITE_ASSESSMENTS_STORAGE_KEY,
        JSON.stringify(next),
      );
      return next;
    });
    persistOps({ siteAssessments: { [jobId]: assessment } });
  }

  function saveScheduleDraft(next: ScheduleDraft) {
    setScheduleDraft(next);
    window.localStorage.setItem(SCHEDULE_DRAFT_STORAGE_KEY, JSON.stringify(next));
    persistOps({ scheduleDraft: next });
  }

  function toggleTheme() {
    const next = !darkMode;
    setDarkMode(next);
    document.documentElement.dataset.theme = next ? "dark" : "light";
    window.localStorage.setItem(THEME_STORAGE_KEY, next ? "dark" : "light");
  }

  function toggleSidebar() {
    const next = !sidebarCollapsed;
    setSidebarCollapsed(next);
    window.localStorage.setItem(
      SIDEBAR_STORAGE_KEY,
      next ? "collapsed" : "expanded",
    );
  }

  function createInstallationGroup() {
    if (!groupDraft.name.trim()) return;
    const nextGroup: InstallationGroup = {
      id: crypto.randomUUID(),
      name: groupDraft.name.trim(),
      area:
        groupDraft.area.trim() || "Unspecified area",
      installationDate: groupDraft.installationDate,
      installationEndDate: groupDraft.installationEndDate,
      jobIds: [],
      installationTeam: "",
      wiringTeam: "",
      supervisors: [],
    };
    saveGroups([...groups, nextGroup]);
    setGroupDraft({
      name: "",
      area: "",
      installationDate: "",
      installationEndDate: "",
    });
    setComposer(null);
    setShowScheduleModal(true);
  }


  async function saveJob(updated: InstallationJob) {
    // Demo records are placeholders shown when the live source is unreachable
    // (see lib/demo-data.ts). Saving one would insert a fictional customer into
    // the real database under a "demo-" invoice id.
    if (updated.id.startsWith("demo-")) {
      setNotice(
        "This is placeholder data, shown because the live source is unavailable. " +
          "It cannot be saved. Press Refresh once the connection is back.",
      );
      return;
    }

    setSaving(true);
    setNotice(null);
    // Functional form on purpose: calculating a run's ETAs saves every stop in
    // one tick, and reading `jobs` from the closure would start each of those
    // saves from the same stale snapshot, so only the last stop would survive.
    setJobs((previous) =>
      previous.map((job) => (job.id === updated.id ? updated : job)),
    );

    const update = operationalUpdate(updated);
    const saved = { ...jobUpdatesRef.current, [updated.id]: update };
    jobUpdatesRef.current = saved;
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(saved));
    // Only the job that changed. The server merges it into the stored map per
    // job id, so two people saving different jobs no longer erase each other.
    persistOps({ jobUpdates: { [updated.id]: update } });

    try {
      const response = await fetch(`/api/jobs/${encodeURIComponent(updated.id)}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          invoiceNumber: updated.invoiceNumber,
          customerName: updated.customerName,
          ...update,
        }),
      });
      if (!response.ok) {
        throw new Error(
          await readError(response, `The database returned ${response.status}.`),
        );
      }
      setNotice("Installation job saved to the shared database.");
      setEditMode(false);
    } catch (error) {
      // Deliberately no setEditMode(false): the edit form stays open with the
      // user's work still in it so they can retry, instead of closing and
      // looking exactly like a successful save.
      setNotice(
        "NOT SAVED — " +
          (error instanceof Error
            ? error.message
            : "the database could not be reached.") +
          " Your change is on this device only. Fix the connection and save again.",
      );
    } finally {
      setSaving(false);
    }
  }

  // Setting an availability status no longer pulls a customer out of their
  // installation group. It used to, for the two statuses that meant the job
  // was off — and those are gone: a cancelled date is now a Reschedule, and a
  // rescheduling customer keeps their group while a new date is agreed.
  async function saveAvailability(updated: InstallationJob) {
    await saveJob(updated);
  }

  return (
    <div
      className={`app-layout${sidebarCollapsed ? " sidebar-is-collapsed" : ""}`}
    >
      <aside className="sidebar" aria-label="Installation navigation">
        <div className="brand">
          <div className="brand-logo">
            <img
              src="/eternalgy-logo.png"
              alt="Eternalgy"
              width="1544"
              height="628"
            />
          </div>
          <div className="brand-text">
            <strong>Scheduling Operations</strong>
            <span>Solar scheduling and delivery</span>
            {currentUser && (
              <span className="brand-greeting">
                Hi {currentUser.displayName || currentUser.username}!
              </span>
            )}
          </div>
        </div>

        <button
          className="icon-button sidebar-toggle"
          aria-label={sidebarCollapsed ? "Expand sidebar" : "Collapse sidebar"}
          aria-expanded={!sidebarCollapsed}
          title={sidebarCollapsed ? "Expand sidebar" : "Collapse sidebar"}
          onClick={toggleSidebar}
        >
          {sidebarCollapsed ? (
            <ChevronRight size={16} />
          ) : (
            <ChevronLeft size={16} />
          )}
        </button>

        <div className="sidebar-category-cards" role="group" aria-label="Job category filters">
          <button
            type="button"
            className={`sidebar-category-card card-solar${workCategoryFilter === "solar" ? " is-active" : ""}`}
            onClick={() =>
              setWorkCategoryFilter((current) =>
                current === "solar" ? ALL_JOBS : "solar",
              )
            }
            title={
              sidebarCollapsed
                ? `Solar: ${solarTotalCount} jobs${workCategoryFilter === "solar" ? " (active, click to clear)" : " (click to filter)"}`
                : undefined
            }
            aria-pressed={workCategoryFilter === "solar"}
          >
            <div className="card-top">
              <span className="card-label">Solar</span>
              <div className="card-icon">
                <Sun size={15} />
              </div>
            </div>
            <strong className="card-count">{solarTotalCount}</strong>
            <small className="card-note">
              {workCategoryFilter === "solar" ? "Active filter" : "Installations"}
            </small>
          </button>

          <button
            type="button"
            className={`sidebar-category-card card-ev${workCategoryFilter === "ev" ? " is-active" : ""}`}
            onClick={() =>
              setWorkCategoryFilter((current) =>
                current === "ev" ? ALL_JOBS : "ev",
              )
            }
            title={
              sidebarCollapsed
                ? `EV: ${evTotalCount} jobs${workCategoryFilter === "ev" ? " (active, click to clear)" : " (click to filter)"}`
                : undefined
            }
            aria-pressed={workCategoryFilter === "ev"}
          >
            <div className="card-top">
              <span className="card-label">EV</span>
              <div className="card-icon">
                <Zap size={15} />
              </div>
            </div>
            <strong className="card-count">{evTotalCount}</strong>
            <small className="card-note">
              {workCategoryFilter === "ev" ? "Active filter" : "Chargers"}
            </small>
          </button>
        </div>

        <nav className="dashboard-tabs" aria-label="Installation workspaces">
          {(
            [
              ["groups", "Installation Schedule"],
              ["delivery", "Delivery Schedule"],
            ] as [DashboardView, string][]
          ).map(([value, label]) => (
            <button
              key={value}
              className={view === value ? "active" : ""}
              onClick={() => setView(value)}
              title={sidebarCollapsed ? label : undefined}
            >
              {value === "groups" && <CalendarDays size={16} />}
              {value === "delivery" && <Truck size={16} />}
              <span className="tab-label">{label}</span>
            </button>
          ))}
        </nav>

        {/* Hidden when the sidebar is collapsed — the grid has no readable
            form at icon width. */}
        {!sidebarCollapsed && (
          <div className="sidebar-panels">
            <SidebarCalendar
              dayDetails={calendarDayDetails}
              weather={sidebarWeather}
              holidays={MALAYSIA_PUBLIC_HOLIDAYS}
              selectedDate={installationDateFilter}
              // Clicking a day narrows the Active installation pipeline to it
              // and puts Installation Schedule on screen to show the result.
              // Clicking the day already applied lifts the filter, so the
              // highlighted cell is also the way back out.
              onSelectDate={(key) => {
                setInstallationDateFilter((current) =>
                  current === key ? "" : key,
                );
                setView("groups");
              }}
            />
            {/* Deliberately under the calendar rather than in the workspace
                tabs above: the report is something you open, read and close,
                not a place you work, so it opens over whatever tab you were
                on and leaves you back on it. */}
            <button
              type="button"
              className="button secondary sidebar-report-button"
              onClick={() => setShowReportModal(true)}
            >
              <FileSearch size={16} />
              Scheduling report
            </button>

            <div className="sidebar-roof-guide" title="Roof difficulty rules for installation scheduling">
              <button
                type="button"
                className="roof-guide-header-btn"
                onClick={() => setRoofGuideOpen((prev) => !prev)}
                aria-expanded={roofGuideOpen}
              >
                <div className="roof-guide-header-title">
                  <Info size={13} />
                  <span>Roof Rating Guide</span>
                </div>
                {roofGuideOpen ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
              </button>

              {roofGuideOpen && (
                <div className="roof-guide-body">
                  <div className="roof-guide-section is-easy">
                    <div className="roof-guide-sec-title">
                      <span className="dot" />
                      <strong>EASY</strong>
                    </div>
                    <ul>
                      <li>Metal deck roof (Klip-Lok / Trapezoidal)</li>
                      <li>1–2 storey house</li>
                      <li>1 panel group on 1 roof face</li>
                    </ul>
                  </div>

                  <div className="roof-guide-section is-medium">
                    <div className="roof-guide-sec-title">
                      <span className="dot" />
                      <strong>MEDIUM</strong>
                    </div>
                    <ul>
                      <li>Concrete tiles (CPAC / Monier)</li>
                      <li>1–2 storey house</li>
                      <li>1 panel group on 1 roof face</li>
                    </ul>
                  </div>

                  <div className="roof-guide-section is-hard">
                    <div className="roof-guide-sec-title">
                      <span className="dot" />
                      <strong>HARD</strong> <small style={{ fontWeight: "normal", opacity: 0.85 }}>(Full-day allocation)</small>
                    </div>
                    <ul>
                      <li>2+ panel groups on SLD</li>
                      <li>Concrete / RC flat roof</li>
                      <li>3-storey building or higher</li>
                      <li>Clay / fragile / old tiles</li>
                    </ul>
                  </div>
                </div>
              )}
            </div>
          </div>
        )}
      </aside>

      <main
        className={`app-shell${
          view === "delivery" || view === "groups"
            ? " app-shell-wide"
            : ""
        }`}
      >
      <header className="topbar">
        <div className="topbar-actions">
          <button
            className="connection connection-button"
            onClick={() => void openSettings()}
            title="Connection settings"
          >
            <span className={`connection-dot ${meta?.source === "live" ? "live" : ""}`} />
            {meta?.source === "live" ? "Live source" : "Demo source"}
          </button>
          {isDesktop && meta?.source !== "live" && (
            <button className="button primary" onClick={() => void openSettings()}>
              <Settings size={16} />
              Set up connection
            </button>
          )}
          {updateButtonLabel && (
            <button
              className="button primary"
              onClick={() => void window.installationDesktop?.installUpdate()}
              disabled={updateStatus?.state === "downloading" || updateStatus?.state === "downloaded"}
            >
              <Download size={16} />
              {updateButtonLabel}
            </button>
          )}
          <button
            className="button primary"
            onClick={() => void loadJobs(true)}
            disabled={syncing}
          >
            <RefreshCw size={16} className={syncing ? "spin" : ""} />
            {syncing ? "Checking…" : "Check for new jobs"}
          </button>
          {currentUser && (
            <>
              {currentUser.role === "admin" && (
                <a className="button secondary" href="/admin" title="IT Admin">
                  <ShieldCheck size={16} />
                  IT Admin
                </a>
              )}
              <button
                className="button secondary"
                onClick={() => void signOut()}
                title={`Signed in as ${currentUser.displayName || currentUser.username}`}
              >
                <LogOut size={16} />
                {currentUser.displayName || currentUser.username}
              </button>
            </>
          )}
        </div>
      </header>

      <section className="page-heading">
        <div>
          <p className="eyebrow">{malaysiaTodayLabel()} · Malaysia time</p>
          <h1>{DASHBOARD_PAGES[view].title}</h1>
          <p>{DASHBOARD_PAGES[view].blurb}</p>
        </div>
      </section>

      {/* Not dismissible, unlike the notice below. While the shared database is
          unreachable nothing can be saved, and that has to stay on screen for as
          long as it is true rather than being clicked away and forgotten. */}
      {!storeOnline && !loading && (
        <div className="notice notice-blocking" role="alert">
          <AlertTriangle size={17} />
          <span>
            Not connected to the shared database. You can look, but nothing you
            change will be saved. Trying to reconnect — this will clear by
            itself, or press Refresh to try now.
          </span>
          <button
            type="button"
            onClick={() => void loadJobs(true)}
            disabled={syncing}
          >
            {syncing ? "Reconnecting…" : "Refresh"}
          </button>
        </div>
      )}

      {(notice || meta?.warning) && (
        <div className="notice" role="status">
          <AlertTriangle size={17} />
          <span>{notice || meta?.warning}</span>
          <button aria-label="Dismiss message" onClick={() => setNotice(null)}>
            <X size={16} />
          </button>
        </div>
      )}

      <p className="metrics-note">* All visual cards count starting Jan 2026.</p>

      {/* One card per stage of the status filter, in the same order. Clicking a
          card selects that stage below, so the number and the list always agree;
          clicking the selected one again drops back to All jobs. On Team
          planning the cards read that page's own filter and pool instead, so a
          card always means "the stage you'd land on if you clicked it now". */}
      <section className="metrics" aria-label="Installation summary">
        {PIPELINE_STAGES.map((stage) => {
          const isArrangedStage = ["ready", "pending_complete", "complete"].includes(stage.value);
          const targetFilter =
            stage.value === "deposit"
              ? "deposit"
              : stage.value === "attention"
              ? "to_arrange"
              : isArrangedStage
              ? "arranged"
              : stage.value;
          const active =
            view === "groups" &&
            (planningFilter === stage.value ||
              (planningFilter === "arranged" && isArrangedStage));
          return (
            <Metric
              key={stage.value}
              label={stage.label}
              value={stageCounts[stage.value]}
              note={stage.note}
              hint={`${stage.hint} ${
                active
                  ? "Click again to clear the filter."
                  : "Click to filter Installation Schedule to this stage."
              }`}
              icon={stageIcons[stage.value]}
              tone={stageTones[stage.value]}
              accent={stageAccents[stage.value]}
              selected={active}
              onClick={() => {
                setPlanningFilter(active ? ALL_JOBS : targetFilter);
                setView("groups");
              }}
            />
          );
        })}
      </section>

      <section className="workspace">
        {view === "groups" && (
          <InstallationGroupsView
            groups={groups}
            jobs={activeJobs}
            teams={teamResources}
            weekAssignments={teamWeekAssignments}
            deliveryRuns={deliveryRuns}
            onSaveJob={saveJob}
            onGroupsChange={saveGroups}
            onTeamsChange={saveTeamResources}
            onWeekAssignmentsChange={saveTeamWeekAssignments}
            onCreate={() => setComposer("group")}
            onJumpToDate={() => {
              setSecondPaymentMonthFilter("");
              setView("groups");
            }}
            groupsWorkspace="teams"
            onReassignTeam={() => setShowScheduleModal(false)}
            onOpenSchedule={() => setShowScheduleModal(true)}
            pinnedJobIds={pinnedJobIds}
            onTogglePin={togglePinJob}
            workCategoryFilter={workCategoryFilter}
            onWorkCategoryFilterChange={setWorkCategoryFilter}
            siteAssessments={siteAssessments}
            onSaveSiteAssessment={saveSiteAssessment}
            scheduleDraft={scheduleDraft}
            onChangeScheduleDraft={saveScheduleDraft}
            onOpenInQueue={() => {
              setPlanningFilter("arranged");
              setView("groups");
            }}
          />
        )}

        {view === "delivery" && (
          <DeliveryPlanningView
            runs={deliveryRuns}
            jobs={activeJobs}
            groupByJobId={groupByJobId}
            warehouses={warehouses}
            onChangeWarehouses={saveWarehouses}
            onChange={saveDeliveryRuns}
            onUpdateJob={(job) => void saveJob(job)}
            pinnedJobIds={pinnedJobIds}
            onTogglePin={togglePinJob}
            workCategoryFilter={workCategoryFilter}
            onWorkCategoryFilterChange={setWorkCategoryFilter}
            onSelectJob={(jobId) => setSelectedId(jobId)}
          />
        )}

      </section>
      {composer && (
        <div className="modal-backdrop" role="presentation">
          <div
            className="composer-modal"
            role="dialog"
            aria-modal="true"
            aria-label="Create installation group"
          >
            <div className="detail-header">
              <div>
                <p className="eyebrow">
                  Manual planning
                </p>
                <h2>Create installation group</h2>
              </div>
              <button
                className="icon-button"
                aria-label="Close"
                onClick={() => setComposer(null)}
              >
                <X size={19} />
              </button>
            </div>
            <div className="edit-form">
                <label>
                  Group name
                  <input
                    value={groupDraft.name}
                    onChange={(event) =>
                      setGroupDraft({ ...groupDraft, name: event.target.value })
                    }
                    placeholder="Example: JB North · 12 Aug"
                  />
                </label>
                <label>
                  Area
                  <input
                    value={groupDraft.area}
                    onChange={(event) =>
                      setGroupDraft({ ...groupDraft, area: event.target.value })
                    }
                    placeholder="Kempas, Skudai, Tampoi"
                  />
                </label>
                <label>
                  Installation from
                  <input
                    type="date"
                    value={groupDraft.installationDate}
                    onChange={(event) =>
                      setGroupDraft({
                        ...groupDraft,
                        installationDate: event.target.value,
                      })
                    }
                  />
                </label>
                <label>
                  Installation until
                  <input
                    type="date"
                    min={groupDraft.installationDate || undefined}
                    value={groupDraft.installationEndDate}
                    onChange={(event) =>
                      setGroupDraft({
                        ...groupDraft,
                        installationEndDate: event.target.value,
                      })
                    }
                  />
                </label>
                <div className="form-actions">
                  <button
                    className="button secondary"
                    onClick={() => setComposer(null)}
                  >
                    Cancel
                  </button>
                  <button
                    className="button primary"
                    disabled={!groupDraft.name.trim()}
                    onClick={createInstallationGroup}
                  >
                    Create group
                  </button>
                </div>
              </div>
            </div>
          </div>
      )}
      {selectedJobForDisplay && (
        <div
          className="modal-backdrop"
          role="presentation"
          onMouseDown={() => {
            setSelectedId(null);
            setEditMode(false);
            setSldOpen(false);
          }}
        >
          <div
            className="customer-modal"
            role="dialog"
            aria-modal="true"
            aria-label={`Installation details for ${selectedJobForDisplay.customerName}`}
            onMouseDown={(event) => event.stopPropagation()}
          >
            <JobDetail
              job={selectedJobForDisplay}
              locationGroupLabel={locationGroupLabelFor(
                selectedJobForDisplay.id,
              )}
              group={groupByJobId.get(selectedJobForDisplay.id) ?? null}
              deliveryRun={
                deliveryRunByJobId.get(selectedJobForDisplay.id) ?? null
              }
              availableTeams={teamResources}
              saving={saving}
              sldOpen={sldOpen}
              onSave={(job) => void saveAvailability(job)}
              onOpenSld={() => setSldOpen(true)}
              onCloseSld={() => setSldOpen(false)}
              onDismiss={() => {
                setSelectedId(null);
                setEditMode(false);
                setSldOpen(false);
              }}
            />
          </div>
        </div>
      )}

      {showSettings && (
        <div className="modal-backdrop" role="presentation">
          <div
            className="composer-modal"
            role="dialog"
            aria-modal="true"
            aria-label="Connection settings"
          >
            <div className="detail-header">
              <div>
                <p className="eyebrow">Setup</p>
                <h2>Connection settings</h2>
                <p>
                  These come from Nurul. You only enter them once — they stay
                  saved when the app updates.
                </p>
              </div>
              <button
                className="icon-button"
                aria-label="Close"
                onClick={() => setShowSettings(false)}
              >
                <X size={19} />
              </button>
            </div>

            <div className="settings-form">
              <label>
                <span>Server address</span>
                <input
                  type="text"
                  value={settingsForm.url}
                  placeholder="https://..."
                  onChange={(event) =>
                    setSettingsForm((form) => ({ ...form, url: event.target.value }))
                  }
                />
              </label>
              <label>
                <span>Database name</span>
                <input
                  type="text"
                  value={settingsForm.database}
                  onChange={(event) =>
                    setSettingsForm((form) => ({
                      ...form,
                      database: event.target.value,
                    }))
                  }
                />
              </label>
              <label>
                <span>Access token</span>
                <input
                  type="password"
                  value={settingsForm.token}
                  placeholder={
                    settingsHasToken ? "Saved — leave blank to keep it" : ""
                  }
                  onChange={(event) =>
                    setSettingsForm((form) => ({ ...form, token: event.target.value }))
                  }
                />
              </label>

              {settingsError && <p className="settings-error">{settingsError}</p>}

              <div className="detail-actions">
                <button
                  className="button primary"
                  disabled={settingsSaving}
                  onClick={() => void saveSettings()}
                >
                  {settingsSaving ? "Saving…" : "Save and connect"}
                </button>
                <button
                  className="button"
                  onClick={() => setShowSettings(false)}
                >
                  Cancel
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {showReportModal && (
        <div
          className="modal-backdrop"
          role="presentation"
          onMouseDown={() => setShowReportModal(false)}
        >
          <div
            className="report-modal"
            role="dialog"
            aria-modal="true"
            aria-label="Scheduling report"
            onMouseDown={(event) => event.stopPropagation()}
          >
            <div className="detail-header">
              <div>
                <p className="eyebrow">
                  {reportPeriod === "ytd"
                    ? `Year to date · deposits from ${reportData.yearStart.slice(0, 4)}`
                    : reportPeriod === "month"
                    ? `Monthly report · ${availableReportMonths.find((m) => m.value === (reportMonth || availableReportMonths[0]?.value))?.label || (reportMonth || availableReportMonths[0]?.value)}`
                    : "All customers on record"}
                </p>
                <h2>Scheduling report</h2>
                <p>
                  Where every customer stands on payment and installation.
                </p>
              </div>
              <button
                className="icon-button"
                aria-label="Close"
                onClick={() => setShowReportModal(false)}
              >
                <X size={19} />
              </button>
            </div>

            <div className="report-content">
              <div className="report-period" role="group" aria-label="Report period">
                <button
                  type="button"
                  className={reportPeriod === "ytd" ? "active" : ""}
                  onClick={() => setReportPeriod("ytd")}
                >
                  Year to date
                </button>
                <button
                  type="button"
                  className={reportPeriod === "month" ? "active" : ""}
                  onClick={() => setReportPeriod("month")}
                >
                  Monthly
                </button>
                <button
                  type="button"
                  className={reportPeriod === "all" ? "active" : ""}
                  onClick={() => setReportPeriod("all")}
                >
                  All time
                </button>
              </div>

              {reportPeriod === "month" && (
                <div style={{ marginTop: 12, marginBottom: 16, display: "flex", alignItems: "center", gap: 10 }}>
                  <label htmlFor="report-month-select" style={{ fontSize: "0.85rem", fontWeight: 600, color: "var(--text-color, inherit)" }}>
                    Select Month:
                  </label>
                  <select
                    id="report-month-select"
                    value={reportMonth || availableReportMonths[0]?.value || (todayIso ? todayIso.slice(0, 7) : "")}
                    onChange={(e) => setReportMonth(e.target.value)}
                    style={{
                      padding: "6px 12px",
                      borderRadius: "6px",
                      fontSize: "0.85rem",
                      border: "1px solid var(--border-color, #cbd5e1)",
                      background: "var(--bg-card, #ffffff)",
                      color: "var(--text-color, inherit)",
                    }}
                  >
                    {availableReportMonths.map((m) => (
                      <option key={m.value} value={m.value}>
                        {m.label}
                      </option>
                    ))}
                  </select>
                </div>
              )}

              <div className="report-total">
                <div>
                  <p className="report-total-label">Customers</p>
                  <p className="report-total-value">
                    {reportData.total.count.toLocaleString("en-MY")}
                  </p>
                </div>
                <div>
                  <p className="report-total-label">Package value</p>
                  <p className="report-total-value">
                    {formatRinggit(reportData.total.value)}
                  </p>
                </div>
                <div>
                  <p className="report-total-label">Outstanding</p>
                  <p className="report-total-value">
                    {formatRinggit(reportData.total.outstanding)}
                  </p>
                </div>
              </div>

              {reportData.total.count === 0 ? (
                <p className="report-empty">
                  No customers with a deposit recorded in{" "}
                  {reportData.yearStart.slice(0, 4)}. Switch to All time to see
                  every customer on record.
                </p>
              ) : (
                <div className="report-rows">
                  {REPORT_ROWS.map((row) => {
                    const bucket = reportData.buckets[row.key];
                    const share = reportData.total.count
                      ? (bucket.count / reportData.total.count) * 100
                      : 0;
                    return (
                      <div
                        key={row.key}
                        className={`report-row ${row.tone}${row.odd ? " odd" : ""}`}
                      >
                        <div className="report-row-left">
                          <span className="report-row-count">
                            {bucket.count.toLocaleString("en-MY")}
                          </span>
                          <span className="report-row-share">
                            {share.toFixed(1)}%
                          </span>
                        </div>
                        <div className="report-row-body">
                          <div className="report-row-name">
                            <strong>{row.label}</strong>
                            {row.odd && (
                              <span className="report-row-tag">Check</span>
                            )}
                          </div>
                          <p className="report-row-desc">{row.desc}</p>
                          <div className="report-row-figures">
                            <div>
                              <span>Package value</span>
                              <strong>{formatRinggit(bucket.value)}</strong>
                            </div>
                            <div>
                              <span>Outstanding</span>
                              <strong>
                                {formatRinggit(bucket.outstanding)}
                              </strong>
                            </div>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}

              {reportData.agents.length > 0 && (
                <section className="report-agents">
                  <h3>Top agents by customer count</h3>
                  <p className="report-agents-sub">
                    Share of the{" "}
                    {reportData.total.count.toLocaleString("en-MY")} customers
                    above, top {reportData.agents.length} shown.
                  </p>
                  {reportData.agents.map((agent) => (
                    <div className="report-agent" key={agent.name}>
                      <span className="report-agent-name">{agent.name}</span>
                      <span className="report-agent-track">
                        <span
                          className="report-agent-fill"
                          style={{
                            width: `${
                              (agent.count / reportData.agents[0].count) * 100
                            }%`,
                          }}
                        />
                      </span>
                      <span className="report-agent-value">{agent.count}</span>
                    </div>
                  ))}
                </section>
              )}

              <p className="report-method">
                <strong>How this is counted:</strong> every customer falls in
                exactly one row, so the shares add to 100%. Paid means{" "}
                {READY_PAYMENT_PERCENT}% or more of the invoice — the same line
                the Ready to Install card uses. Booked means an installation
                date on the customer, on their group, or agreed on Customer
                Scheduling. Package value and outstanding are summed from the
                invoice total and its balance.
              </p>
            </div>
          </div>
        </div>
      )}

      {showScheduleModal && (
        <div
          className="modal-backdrop"
          role="presentation"
          onMouseDown={() => setShowScheduleModal(false)}
        >
          <div
            className="schedule-modal"
            role="dialog"
            aria-modal="true"
            aria-label="Schedule and assign"
            onMouseDown={(event) => event.stopPropagation()}
          >
            <div className="detail-header">
              <div>
                <p className="eyebrow">Installation Schedule</p>
                <h2>Schedule &amp; assign</h2>
                <p>Plan group dates, teams, and delivery across the month.</p>
              </div>
              <button
                className="icon-button"
                aria-label="Close"
                onClick={() => setShowScheduleModal(false)}
              >
                <X size={19} />
              </button>
            </div>

            <div className="schedule-modal-content">
              <InstallationGroupsView
                groups={groups}
                jobs={activeJobs}
                teams={teamResources}
                weekAssignments={teamWeekAssignments}
                deliveryRuns={deliveryRuns}
                onSaveJob={saveJob}
                onGroupsChange={saveGroups}
                onTeamsChange={saveTeamResources}
                onWeekAssignmentsChange={saveTeamWeekAssignments}
                onCreate={() => setComposer("group")}
                onJumpToDate={() => {
                  setSecondPaymentMonthFilter("");
                  setShowScheduleModal(false);
                  setView("groups");
                }}
                groupsWorkspace="schedule"
                onReassignTeam={() => {
                  setShowScheduleModal(false);
                  setView("groups");
                }}
                pinnedJobIds={pinnedJobIds}
                onTogglePin={togglePinJob}
                workCategoryFilter={workCategoryFilter}
                onWorkCategoryFilterChange={setWorkCategoryFilter}
              />
            </div>
          </div>
        </div>
      )}

      </main>
    </div>
  );
}

function Metric({
  label,
  value,
  note,
  hint,
  icon,
  tone,
  accent,
  selected,
  onClick,
}: {
  label: string;
  value: number;
  note: string;
  hint?: string;
  icon: React.ReactNode;
  tone?: "warning";
  accent?: "amber" | "red";
  selected?: boolean;
  onClick?: () => void;
}) {
  const className = [
    "metric",
    tone ?? "",
    accent ? `metric-accent-${accent}` : "",
    selected ? "metric-selected" : "",
    onClick ? "metric-clickable" : "",
  ]
    .filter(Boolean)
    .join(" ");

  const content = (
    <>
      <div>
        <span>{label}</span>
        <strong>{value}</strong>
        <small>{note}</small>
      </div>
      <div className="metric-icon">{icon}</div>
    </>
  );

  if (onClick) {
    return (
      <button type="button" className={className} title={hint} onClick={onClick}>
        {content}
      </button>
    );
  }

  return (
    <article className={className} title={hint}>
      {content}
    </article>
  );
}

// Best-effort read of the invoice's own package line — "12X 650W JinkoSolar
// TIGER NEO 3.0 Panel N-Type TOPCon", "20X Astronergy Astro 5 Twins…" — into
// the same shape ops has always typed by hand on Installation groups: "12
// Jinko 650W". Brand is only ever read immediately after the line's leading
// "12X " (and the wattage, when the line states one there too) — the same
// lead-in lib/source-api.ts already requires to read the quantity off this
// exact line — so a brand is never guessed at from a differently-shaped
// line, just left out. Quantity and wattage come from the job's own already-
// resolved fields, not reparsed here, since those already fall back to the
// invoice's panel_qty/panel_rating columns when the text does not state them.
function extractPanelBrand(text: string): string {
  if (!text) return "";
  if (/jinko(?:solar)?|tiger\s*neo/i.test(text)) return "Jinko";
  if (/astronergy(?:\s*astro(?:\s*\d+)?)?|chint/i.test(text)) return "Astronergy";
  if (/longi|hi-?mo/i.test(text)) return "Longi";
  if (/trina(?:solar)?|vertex/i.test(text)) return "Trina";
  if (/ja\s*solar/i.test(text)) return "JA Solar";
  if (/canadian\s*solar/i.test(text)) return "Canadian Solar";
  if (/risen/i.test(text)) return "Risen";
  if (/tongwei|tw\s*solar/i.test(text)) return "Tongwei";
  if (/ae\s*solar/i.test(text)) return "AE Solar";
  if (/suntech/i.test(text)) return "Suntech";
  if (/maxeon|sunpower/i.test(text)) return "Maxeon";
  if (/qcells|hanwha/i.test(text)) return "Qcells";
  if (/hyundai/i.test(text)) return "Hyundai";
  if (/seraphim/i.test(text)) return "Seraphim";
  if (/dah\s*solar/i.test(text)) return "DAH Solar";

  const leadMatch = text.match(
    /^\d+\s*[xX]\s*(?:\d{3,4}\s*W(?:p|att)?\b\s*)?([A-Za-z][A-Za-z-]*)/i,
  );
  if (leadMatch && !/^(?:pcs|panels?|watts?)$/i.test(leadMatch[1])) {
    return leadMatch[1];
  }

  const pcsMatch = text.match(
    /\b\d+\s*(?:pcs|panels?)\s+(?:of\s+)?([A-Za-z][A-Za-z-]*)/i,
  );
  if (pcsMatch && !/^(?:pcs|panels?|watts?|mono|poly|bifacial)$/i.test(pcsMatch[1])) {
    return pcsMatch[1];
  }

  const beforePcsMatch = text.match(
    /\b([A-Za-z][A-Za-z-]*)\s+\d+\s*(?:pcs|panels?)\b/i,
  );
  if (
    beforePcsMatch &&
    !/^(?:pcs|panels?|watts?|mono|poly|bifacial|hybrid|string|single|three|phase)$/i.test(
      beforePcsMatch[1],
    )
  ) {
    return beforePcsMatch[1];
  }

  return "";
}

function derivedPowerOutput(job: InstallationJob): string {
  const existing = job.powerOutput?.trim() || "";
  const existingBrand = extractPanelBrand(existing);
  if (existing) {
    if (existingBrand) return existing;
    const isGenericOldFormat =
      /^\d+\s*(?:×|x|panels?\b)\s*(?:\d{3,4}\s*W)?$/i.test(existing) ||
      /^\d{3,4}\s*W$/i.test(existing);
    if (!isGenericOldFormat) return existing;
  }

  const brand =
    extractPanelBrand(existing) ||
    extractPanelBrand(job.packageName || "") ||
    extractPanelBrand(job.remarks || "") ||
    extractPanelBrand(job.installationRemarks || "") ||
    extractPanelBrand(job.availabilityRemarks || "");

  const qty =
    job.panelQuantity ??
    (() => {
      const m = (job.packageName || existing).match(/(\d+)\s*(?:pcs|panels\b|[xX×]\b)/i);
      return m ? Number(m[1]) : null;
    })();

  const rating =
    job.panelRating ??
    (() => {
      const m = (job.packageName || existing).match(/(\d{3,4})\s*W(?:p|att)?\b/i);
      return m ? Number(m[1]) : null;
    })();

  if (qty && brand && rating) return `${qty} ${brand} ${rating}W`;
  if (qty && brand) return `${qty} ${brand}`;
  if (brand && rating) return `${brand} ${rating}W`;
  if (brand) return brand;
  if (qty && rating) return `${qty} × ${rating}W`;
  if (qty) return `${qty} panels`;
  if (rating) return `${rating}W`;
  return existing;
}

function titleCase(value: string) {
  return value
    .trim()
    .toLocaleLowerCase("en-MY")
    .replace(/(^|[\s(/'-])\p{L}/gu, (letter) => letter.toLocaleUpperCase("en-MY"));
}

function isAtap(name: string) {
  return /\(ATAP\)/i.test(name);
}

function displayName(name: string) {
  return titleCase(name.replace(/\(ATAP\)/gi, "").replace(/\s+/g, " "));
}

function formatPhone(value: string) {
  const digits = value.replace(/\D/g, "");
  if (!digits) return "";
  const local = digits.startsWith("60") ? `0${digits.slice(2)}` : digits;
  return local.length >= 9
    ? `${local.slice(0, 3)}-${local.slice(3, 6)} ${local.slice(6)}`
    : value;
}

function phaseText(job: InstallationJob) {
  if (job.phase === "Single phase") return "Single";
  if (job.phase === "Three phase") return "Three";
  return "–";
}

function inverterText(job: InstallationJob) {
  return (
    job.inverterBattery.trim() ||
    job.derivedInverterModel ||
    (job.inverter === "Not available" ? "" : job.inverter)
  );
}

function shortDate(dateStr?: string | null) {
  if (!dateStr) return "";
  try {
    const d = new Date(dateStr);
    if (isNaN(d.getTime())) return dateStr;
    return d.toLocaleDateString("en-MY", { day: "numeric", month: "short" });
  } catch {
    return dateStr;
  }
}

function InstallationGroupsView({
  groups,
  jobs,
  teams,
  weekAssignments,
  deliveryRuns,
  onSaveJob,
  onGroupsChange,
  onTeamsChange,
  onWeekAssignmentsChange,
  onCreate,
  onJumpToDate,
  groupsWorkspace,
  onReassignTeam,
  onOpenSchedule,
  pinnedJobIds,
  onTogglePin,
  workCategoryFilter,
  onWorkCategoryFilterChange,
  siteAssessments,
  onSaveSiteAssessment,
  scheduleDraft,
  onChangeScheduleDraft,
  onOpenInQueue,
}: {
  groups: InstallationGroup[];
  jobs: InstallationJob[];
  teams: TeamResource[];
  weekAssignments: TeamWeekAssignment[];
  deliveryRuns: DeliveryRun[];
  onSaveJob: (job: InstallationJob) => void;
  onGroupsChange: (groups: InstallationGroup[]) => void;
  onTeamsChange: (teams: TeamResource[]) => void;
  onWeekAssignmentsChange: (assignments: TeamWeekAssignment[]) => void;
  onCreate: () => void;
  onJumpToDate: (date: string) => void;
  groupsWorkspace: "schedule" | "teams";
  onReassignTeam: () => void;
  onOpenSchedule?: () => void;
  pinnedJobIds: Set<string>;
  onTogglePin: (id: string) => void;
  workCategoryFilter: string;
  onWorkCategoryFilterChange: (next: string) => void;
  // Only the page's own Installation groups passes these; the copy inside the
  // schedule popup does not, and keeps its ordinary table for Ready to Install.
  siteAssessments?: Record<string, SiteAssessment>;
  onSaveSiteAssessment?: (jobId: string, assessment: SiteAssessment) => void;
  scheduleDraft?: ScheduleDraft;
  onChangeScheduleDraft?: (draft: ScheduleDraft) => void;
  onOpenInQueue?: (jobId: string) => void;
}) {
  const todayIso = malaysiaToday();
  // Every customer by id, built once per jobs change and shared with the group
  // cards and the drawer below. They are all keyed by job id, and each of them
  // scanning the whole customer list for its own members was the bulk of the
  // lag when editing anything on this page.
  const jobById = useMemo(() => {
    const map = new Map<string, InstallationJob>();
    for (const job of jobs) {
      map.set(job.id, job);
      if (job.invoiceNumber && !map.has(job.invoiceNumber)) {
        map.set(job.invoiceNumber, job);
      }
    }
    return map;
  }, [jobs]);
  // Which group (if any) already holds each job — needed to tell whether a
  // customer offered in the picker below is free, already in this same group,
  // or booked into a different one.
  const groupByJobId = useMemo(
    () => latestByJobId(groups, (group) => group.installationDate),
    [groups],
  );
  // The same stage filter Customer Scheduling carries, reading the same
  // predicate, so "Ready to Install" means one thing across the dashboard and
  // the two pages can never disagree about which customers that is.
  const [planningFilter, setPlanningFilter] = useState<string>("propose");
  const [periodFilter, setPeriodFilter] = useState("");
  const [customerQuery, setCustomerQuery] = useState("");
  const deferredCustomerQuery = useDeferredValue(customerQuery);
  const deferredPeriodFilter = useDeferredValue(periodFilter);
  const planningLookup = useMemo<PlanningLookup>(
    () => ({
      groupByJobId,
      deliveryRunByJobId: latestByJobId(
        deliveryRuns,
        (run) => run.deliveryDate,
      ),
    }),
    [groupByJobId, deliveryRuns],
  );
  // Propose to Install shows the four crews' suggested week instead of the
  // booking table: the same customers Customer Scheduling calls Propose to
  // Install, under the same job-type filter.
  const showSuggestedWeek =
    groupsWorkspace === "teams" &&
    planningFilter === "propose" &&
    Boolean(scheduleDraft && onChangeScheduleDraft && onSaveSiteAssessment);
  const readyScheduleJobs = useMemo(
    () =>
      showSuggestedWeek
        ? jobs.filter(
            (job) =>
              belongsInPlanning(job, groupByJobId.get(job.id), planningLookup) &&
              !isHiddenAsCompleted(job, todayIso, groupByJobId.get(job.id)) &&
              job.customerAvailabilityStatus !== "complete" &&
              matchesPipelineStage(job, "to_arrange", todayIso, planningLookup) &&
              matchesWorkCategory(job, workCategoryFilter) &&
              (!deferredCustomerQuery || jobMatchesSearch(job, deferredCustomerQuery, groupByJobId.get(job.id))),
          )
        : [],
    [
      showSuggestedWeek,
      jobs,
      groupByJobId,
      planningLookup,
      todayIso,
      workCategoryFilter,
      deferredCustomerQuery,
    ],
  );
  const showDepositTable =
    groupsWorkspace === "teams" && planningFilter === "deposit";
  const showToArrangeTable =
    groupsWorkspace === "teams" && planningFilter === "to_arrange";
  const [awaitingReviewFilter, setAwaitingReviewFilter] = useState<string>("all");
  const [scheduleMapJobId, setScheduleMapJobId] = useState<string | null>(null);
  const [openGroupId, setOpenGroupId] = useState<string | null>(null);
  const [showFullCalendar, setShowFullCalendar] = useState(false);
  // The full calendar opens on top of the group drawer, so it closes first.
  useEscapeKey(showFullCalendar || openGroupId !== null, () => {
    if (showFullCalendar) {
      setShowFullCalendar(false);
      return;
    }
    setOpenGroupId(null);
  });
  const [calendarMonth, setCalendarMonth] = useState(() => {
    const now = new Date();
    return new Date(now.getFullYear(), now.getMonth(), 1);
  });
  const [teamDraft, setTeamDraft] = useState({
    name: "",
    role: "installation" as TeamResource["role"],
    baseLocation: "",
    contact: "",
    members: "",
  });
  const [weekDraft, setWeekDraft] = useState({
    teamId: "",
    startDate: "",
    endDate: "",
    installationGroupId: "",
  });
  const calendarWeather = useCalendarWeather(groups, jobs);
  const [rowAssignmentDraft, setRowAssignmentDraft] = useState<
    Record<string, { startDate: string; endDate: string; installationGroupIds: string[] }>
  >({});
  const [memberDraft, setMemberDraft] = useState<Record<string, string>>({});
  // Team management rows start read-only; clicking one toggles just that team
  // into editable fields, the same way a delivery run's row works.
  const [editingTeamIds, setEditingTeamIds] = useState<Set<string>>(new Set());

  // --- Customer schedule table: one row per scheduled customer, shaped like
  // the crew's planning sheet. The team fields live on the group, so editing
  // any one customer's row updates every customer that crew installs that day
  // — the same way one sheet block covers all its rows.
  const [editingRowKeys, setEditingRowKeys] = useState<Set<string>>(new Set());
  // The customer combobox's typed text, per row — keyed by rowKey so two rows
  // open at once can search independently. Also doubles as the box's display
  // value once a customer is picked, so it reads the name back rather than
  // going blank.
  const [customerSearchByRow, setCustomerSearchByRow] = useState<
    Record<string, string>
  >({});
  // Which row's match list is currently dropped open — at most one at a time,
  // since typing in a second box should close the first.
  const [openCustomerRowKey, setOpenCustomerRowKey] = useState<string | null>(
    null,
  );
  // The open row's search text, deferred: eligibleCustomersForRow filters the
  // whole ~8,000-job list on every keystroke, and doing that synchronously
  // was what made typing into the box feel laggy. Deferring it lets the
  // character land immediately (the input below still reads the un-deferred
  // text) while React catches up on the match list a moment later, the same
  // trade the pipeline's own search box makes with deferredQuery.
  const openCustomerSearchText = openCustomerRowKey
    ? (customerSearchByRow[openCustomerRowKey] ?? "")
    : "";
  const deferredCustomerSearchText = useDeferredValue(openCustomerSearchText);
  // Groups added from this table in this session, newest first. Only affects
  // ordering — nothing about them is stored differently.
  const [newRowGroupIds, setNewRowGroupIds] = useState<string[]>([]);
  // Empty means every period — the table opens showing everything rather than
  // silently hiding work behind a default. One box rather than the month and
  // year dropdowns it replaces: those could only ever name one month, so
  // "everything in 2026" and "every August" were both unaskable.
  const [pendingCheckNotice, setPendingCheckNotice] = useState<{
    jobId: string;
    customerName: string;
    type: "pending" | "reschedule";
  } | null>(null);

  const depositScheduleJobs = useMemo(
    () =>
      showDepositTable
        ? jobs.filter(
            (job) =>
              belongsInPlanning(job, groupByJobId.get(job.id), planningLookup) &&
              !isHiddenAsCompleted(job, todayIso, groupByJobId.get(job.id)) &&
              matchesPipelineStage(job, "deposit", todayIso, planningLookup) &&
              matchesWorkCategory(job, workCategoryFilter) &&
              (!deferredCustomerQuery || jobMatchesSearch(job, deferredCustomerQuery, groupByJobId.get(job.id))),
          )
        : [],
    [
      showDepositTable,
      jobs,
      groupByJobId,
      planningLookup,
      todayIso,
      workCategoryFilter,
      deferredCustomerQuery,
    ],
  );

  const {
    rescheduleCount,
    pendingCount,
    attentionCount,
    specialCaseCount,
    newReadyCount,
    omCount,
    totalReadyCount,
  } = useMemo(() => {
    if (!showToArrangeTable) {
      return {
        rescheduleCount: 0,
        pendingCount: 0,
        attentionCount: 0,
        specialCaseCount: 0,
        newReadyCount: 0,
        omCount: 0,
        totalReadyCount: 0,
      };
    }
    const baseJobs = jobs.filter(
      (job) =>
        belongsInPlanning(job, groupByJobId.get(job.id), planningLookup) &&
        !isHiddenAsCompleted(job, todayIso, groupByJobId.get(job.id)) &&
        matchesPipelineStage(job, "to_arrange", todayIso, planningLookup) &&
        matchesWorkCategory(job, workCategoryFilter) &&
        (!deferredCustomerQuery || jobMatchesSearch(job, deferredCustomerQuery, groupByJobId.get(job.id))),
    );
    let sCount = 0;
    let rCount = 0;
    let pCount = 0;
    let aCount = 0;
    let nCount = 0;
    let omCount = 0;
    for (const job of baseJobs) {
      if (isJobOM(job)) {
        omCount++;
      } else if (isSpecialCaseApproval(job)) {
        sCount++;
      } else if (isJobReschedule(job)) {
        rCount++;
      } else if (isJobPending(job)) {
        pCount++;
      } else if (
        needsAttention(job, todayIso, groupByJobId.get(job.id)) ||
        isJobNeedAttention(job, todayIso)
      ) {
        aCount++;
      } else {
        nCount++;
      }
    }
    return {
      specialCaseCount: sCount,
      rescheduleCount: rCount,
      pendingCount: pCount,
      attentionCount: aCount,
      newReadyCount: nCount,
      omCount,
      totalReadyCount: baseJobs.length,
    };
  }, [
    showToArrangeTable,
    jobs,
    groupByJobId,
    planningLookup,
    todayIso,
    workCategoryFilter,
    deferredCustomerQuery,
  ]);

  const toArrangeScheduleJobs = useMemo(
    () =>
      showToArrangeTable
        ? jobs.filter(
            (job) =>
              belongsInPlanning(job, groupByJobId.get(job.id), planningLookup) &&
              !isHiddenAsCompleted(job, todayIso, groupByJobId.get(job.id)) &&
              matchesPipelineStage(job, "to_arrange", todayIso, planningLookup) &&
              matchesWorkCategory(job, workCategoryFilter) &&
              (awaitingReviewFilter === "all" ||
                (awaitingReviewFilter === "om" && isJobOM(job)) ||
                (awaitingReviewFilter === "special_case" && !isJobOM(job) && isSpecialCaseApproval(job)) ||
                (awaitingReviewFilter === "new_ready" &&
                  !isJobOM(job) &&
                  !isSpecialCaseApproval(job) &&
                  !isJobReschedule(job) &&
                  !isJobPending(job) &&
                  !(needsAttention(job, todayIso, groupByJobId.get(job.id)) || isJobNeedAttention(job, todayIso))) ||
                (awaitingReviewFilter === "reschedule" &&
                  !isJobOM(job) &&
                  !isSpecialCaseApproval(job) &&
                  isJobReschedule(job)) ||
                (awaitingReviewFilter === "pending" &&
                  !isJobOM(job) &&
                  !isSpecialCaseApproval(job) &&
                  !isJobReschedule(job) &&
                  isJobPending(job)) ||
                (awaitingReviewFilter === "attention" &&
                  !isJobOM(job) &&
                  !isSpecialCaseApproval(job) &&
                  !isJobReschedule(job) &&
                  !isJobPending(job) &&
                  (needsAttention(job, todayIso, groupByJobId.get(job.id)) || isJobNeedAttention(job, todayIso)))) &&
              (!deferredCustomerQuery || jobMatchesSearch(job, deferredCustomerQuery, groupByJobId.get(job.id))),
          )
        : [],
    [
      showToArrangeTable,
      jobs,
      groupByJobId,
      planningLookup,
      todayIso,
      workCategoryFilter,
      awaitingReviewFilter,
      deferredCustomerQuery,
    ],
  );

  // Read on mount rather than in the initialiser: this component renders on
  // the server too, where localStorage does not exist.
  const [pinnedWeekKeys, setPinnedWeekKeys] = useState<Set<string>>(new Set());
  useEffect(() => {
    try {
      const saved = window.localStorage.getItem(PINNED_WEEKS_STORAGE_KEY);
      if (saved) setPinnedWeekKeys(new Set(JSON.parse(saved) as string[]));
    } catch {
      // A corrupt or unreadable entry just means nothing is pinned.
    }
  }, []);

  const [hiddenCrewColumns, setHiddenCrewColumns] = useState<Set<CrewColumnKey>>(
    new Set(),
  );
  // Which band's column menu is open, or null. Keyed by blockKey so only one
  // is ever open at a time.
  const [openColumnMenu, setOpenColumnMenu] = useState<string | null>(null);
  useEffect(() => {
    try {
      const saved = window.localStorage.getItem(HIDDEN_CREW_COLUMNS_STORAGE_KEY);
      if (saved) {
        const keys = JSON.parse(saved) as string[];
        const valid = new Set(CREW_COLUMNS.map((column) => column.key as string));
        setHiddenCrewColumns(
          new Set(keys.filter((key): key is CrewColumnKey => valid.has(key))),
        );
      }
    } catch {
      // A corrupt or unreadable entry just means every column is showing.
    }
  }, []);

  // Clicking anywhere else closes the menu. Without this it stays open behind
  // whatever the next click was, and every band shows its own copy.
  useEffect(() => {
    if (!openColumnMenu) return;
    const close = (event: MouseEvent) => {
      const target = event.target as HTMLElement | null;
      if (target?.closest(".schedule-band-columns")) return;
      setOpenColumnMenu(null);
    };
    document.addEventListener("click", close);
    return () => document.removeEventListener("click", close);
  }, [openColumnMenu]);

  function toggleCrewColumn(key: CrewColumnKey) {
    setHiddenCrewColumns((previous) => {
      const next = new Set(previous);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      try {
        window.localStorage.setItem(
          HIDDEN_CREW_COLUMNS_STORAGE_KEY,
          JSON.stringify(Array.from(next)),
        );
      } catch {
        // Storage being unavailable must not stop the toggle working for the
        // rest of this session.
      }
      return next;
    });
  }

  // "Add Team" drops its new row straight into edit mode, and the crew fields
  // it needs filling in are exactly the ones hiding takes away. So while any
  // row is being edited the columns come back, and collapse again on Done —
  // otherwise the first thing a hidden view does is block the next crew added.
  const anyRowEditing = editingRowKeys.size > 0;
  const isCrewColumnVisible = (key: CrewColumnKey) =>
    anyRowEditing || !hiddenCrewColumns.has(key);
  // Customer, Agent, Address, Date & time, Package, Inverter, Power Output,
  // Power Supply, Remark, Actions are always there; only the five crew
  // columns come and go. Car moved into the band header, so it no longer
  // counts as a column of its own.
  const visibleColumnCount = 10;

  function togglePinnedWeek(blockKey: string) {
    setPinnedWeekKeys((previous) => {
      const next = new Set(previous);
      if (next.has(blockKey)) next.delete(blockKey);
      else next.add(blockKey);
      try {
        window.localStorage.setItem(
          PINNED_WEEKS_STORAGE_KEY,
          JSON.stringify(Array.from(next)),
        );
      } catch {
        // Storage being unavailable must not stop the pin from working for
        // the rest of this session.
      }
      return next;
    });
  }

  const [groupMemberDraft, setGroupMemberDraft] = useState<
    Record<string, string>
  >({});
  const [groupCarDraft, setGroupCarDraft] = useState<Record<string, string>>(
    {},
  );
  const [groupCrewDraft, setGroupCrewDraft] = useState<
    Record<
      string,
      {
        installationTeam?: string;
        wiringTeam?: string;
        siteSupervisor?: string;
        membersText?: string;
        car?: string;
      }
    >
  >({});
  const [groupSupervisorDraft, setGroupSupervisorDraft] = useState<
    Record<string, string>
  >({});
  // Which row/field is mid-way through typing a brand-new team name after
  // picking "+ Add new…" in its dropdown.
  const [newTeamDraft, setNewTeamDraft] = useState<{
    rowKey: string;
    field: "installationTeam" | "wiringTeam";
    value: string;
  } | null>(null);

  // Precompute the latest scheduled date for every job across groups and visits,
  // so multi-visit / multi-date customers only display the completed checkmark (✓ in green)
  // on their latest date once complete.
  const latestScheduledDateByJobId = useMemo(() => {
    const map = new Map<string, string>();
    for (const group of groups) {
      const gDate = (group.installationDate || "").slice(0, 10);
      if (!gDate) continue;
      for (const jId of group.jobIds || []) {
        if (!jId) continue;
        const currentLatest = map.get(jId);
        if (!currentLatest || gDate > currentLatest) {
          map.set(jId, gDate);
        }
      }
    }
    for (const j of jobs) {
      if (j.visits && j.visits.length > 0) {
        for (const v of j.visits) {
          const vDate = (v.date || "").slice(0, 10);
          if (vDate) {
            const currentLatest = map.get(j.id);
            if (!currentLatest || vDate > currentLatest) {
              map.set(j.id, vDate);
            }
          }
        }
      }
    }
    return map;
  }, [groups, jobs]);

  const scheduleRows = useMemo(() => {
    return groups
      .filter((group) => group.installationDate)
      .filter((group) => matchesDateSearch(group.installationDate, deferredPeriodFilter))
      .flatMap((group) =>
        // A crew booked for a week before anyone is assigned to it still gets
        // a row — otherwise a team added here would vanish the moment it was
        // created, with nothing on screen to fill in.
        (group.jobIds.length ? group.jobIds : [""]).map((jobId) => ({
          rowKey: `${group.id}|${jobId}`,
          group,
          job: jobId ? (jobById.get(jobId) ?? null) : null,
          jobId,
          // What a heading band covers: one crew, working one week.
          // Grouped strictly by week and team label so all customers and supervisors
          // for the same week and team stay together in one unified table section.
          blockKey: [
            weekBounds(group.installationDate)?.start ?? "",
            (group.teamLabel ?? "").trim(),
          ].join("|"),
        })),
      )
      // Applied after the rows are built, not to the groups, because the name
      // being searched for usually lives on the customer rather than on the
      // crew. Site supervisor is the one exception — that's the crew's own
      // field, so it's checked straight off the row's group and can match
      // even a crew row with nobody on it yet.
      .filter((row) => {
        const needle = deferredCustomerQuery.trim();
        if (!needle) return true;
        if (row.job && jobMatchesSearch(row.job, needle)) return true;
        return row.group.supervisors.some((name) =>
          name.toLowerCase().includes(needle.toLowerCase()),
        );
      })
      // Same treatment as the name search above, and for the same reason: the
      // stage belongs to the customer, not to the crew, so an empty crew row
      // has nothing to match and drops out while the filter is running.
      .filter((row) => {
        if (planningFilter === ALL_JOBS) return true;
        return row.job
          ? matchesPipelineStage(row.job, planningFilter, todayIso, planningLookup)
          : false;
      })
      .filter((row) => {
        if (workCategoryFilter === ALL_JOBS) return true;
        return row.job
          ? matchesWorkCategory(row.job, workCategoryFilter)
          : false;
      })
      // Crew first, date within it: every row a given crew works sits together
      // in the order they go out, which is how the schedule sheet itself is
      // laid out. Rows with no team label sort last within their week rather
      // than first, so a blank does not head a week's block.
      .sort((a, b) => {
        const label = (row: typeof a) => row.group.teamLabel?.trim() ?? "";
        const unlabelled = (row: typeof a) => (label(row) ? 0 : 1);
        // Rows added in this session sit at the very top, newest first, so a
        // team you just added is in front of you rather than sorted away into
        // the middle of the table while you are still filling it in. They take
        // their natural place on the next load.
        const pinned = (row: typeof a) => {
          const at = newRowGroupIds.indexOf(row.group.id);
          return at === -1 ? Number.MAX_SAFE_INTEGER : at;
        };
        // A pinned week band and everything under it float above the rest,
        // keeping the week being worked on in view. Rows added this session
        // still come first — those are mid-edit and need to be reachable.
        const pinnedWeek = (row: typeof a) =>
          pinnedWeekKeys.has(row.blockKey) ? 0 : 1;
        const weekStart = (row: typeof a) =>
          weekBounds(row.group.installationDate)?.start ?? "";
        return (
          pinned(a) - pinned(b) ||
          pinnedWeek(a) - pinnedWeek(b) ||
          // Week is the outer grouping, exactly as the schedule sheet lays it
          // out: one week bar, every team's block underneath it. So the whole
          // of the current week sits at the top of the table, whichever team
          // each block belongs to, and older weeks follow. Newest first, so
          // b before a.
          weekStart(b).localeCompare(weekStart(a)) ||
          // Inside the week, not above it. A blank still sorts last among its own week.
          unlabelled(a) - unlabelled(b) ||
          // Numeric-aware so "Team 10" follows "Team 9" instead of "Team 1".
          label(a).localeCompare(label(b), undefined, { numeric: true }) ||
          // Days inside a week still read forwards, Monday to Saturday,
          // because that is the order the crew works them.
          a.group.installationDate.localeCompare(b.group.installationDate) ||
          (a.job?.preferredInstallationTime || groupStartTime(a.group.id) || "99:99").localeCompare(
            b.job?.preferredInstallationTime || groupStartTime(b.group.id) || "99:99",
          ) ||
          (a.job?.customerName ?? "").localeCompare(b.job?.customerName ?? "")
        );
      });
  }, [
    groups,
    jobs,
    weekAssignments,
    newRowGroupIds,
    periodFilter,
    customerQuery,
    planningFilter,
    workCategoryFilter,
    planningLookup,
    todayIso,
    pinnedWeekKeys,
  ]);

  // Maps each (week, team) blockKey to all groups that belong to it, so crew
  // and supervisor fields are unified across all bookings in that week and team.
  const groupsByBlockKey = useMemo(() => {
    const map = new Map<string, InstallationGroup[]>();
    for (const row of scheduleRows) {
      const list = map.get(row.blockKey) ?? [];
      if (!list.some((g) => g.id === row.group.id)) {
        list.push(row.group);
      }
      map.set(row.blockKey, list);
    }
    return map;
  }, [scheduleRows]);

  // Dropdown options: the registered teams plus any name already written on a
  // group, so a value imported from the sheet is always present in its own
  // dropdown even if nobody registered it as a team.
  const installationTeamNames = useMemo(
    () =>
      Array.from(
        new Set([
          ...teams
            .filter((team) => !isWiringRole(team.role))
            .map((team) => team.name),
          ...groups.map((group) => group.installationTeam).filter(Boolean),
        ]),
      ).sort(),
    [teams, groups],
  );
  const wiringTeamNames = useMemo(
    () =>
      Array.from(
        new Set([
          ...teams
            .filter((team) => isWiringRole(team.role))
            .map((team) => team.name),
          ...groups.map((group) => group.wiringTeam).filter(Boolean),
        ]),
      ).sort(),
    [teams, groups],
  );
  // No team resource carries a site supervisor in practice — TeamResource
  // has the field, but nothing in the app writes it — so unlike the two
  // dropdowns above, this one has only ever the names already on a group to
  // draw from.
  const DEFAULT_KNOWN_SUPERVISORS = [
    "Chan Chee Man",
    "Chat Cheh Man",
    "Kaijie",
    "Martin Hing",
    "Ahzu",
    "Jack",
    "John",
  ];
  const supervisorNames = useMemo(
    () =>
      Array.from(
        new Set([
          ...DEFAULT_KNOWN_SUPERVISORS,
          ...groups.flatMap((group) => group.supervisors ?? []),
        ]),
      )
        .filter((s) => s && !isPlaceholder(s))
        .sort(),
    [groups],
  );
  const memberSuggestions = useMemo(
    () =>
      Array.from(
        new Set(groups.flatMap((group) => group.wiringMembers ?? [])),
      ).sort(),
    [groups],
  );
  const carSuggestions = useMemo(
    () => Array.from(new Set(groups.flatMap((group) => group.cars ?? []))).sort(),
    [groups],
  );

  // Who can be picked into a crew row's customer cell: any customer,
  // regardless of stage — Deposit, Ready to Install, Pending Complete and
  // Complete Installation are all fair game, not just the ones financially
  // cleared or not yet installed. The row's own current customer is always
  // included, matching the equivalent picker on Stock delivery.
  //
  // Being in another group is no longer a reason to hide anyone either. The
  // picker used to allow it only for a customer signalling
  // reschedule/cancel/pending, on the reasoning that a stale old group is
  // what holds a customer whose date fell through — but a job can genuinely
  // need two bookings for reasons that have nothing to do with a date
  // falling through: a two-day install, a return trip, work split across
  // crews. Everything downstream already expects it, and deliberately so:
  // the calendar draws one entry per group rather than picking a winner,
  // precisely so a customer in two groups shows on both days.
  //
  // The same customer twice in one group is still refused. A group's members
  // are a list of job ids, so a repeat would be an identical row keyed the
  // same way, not a second booking.
  function eligibleCustomersForRow(
    group: InstallationGroup,
    currentJobId: string,
    search: string,
  ) {
    return jobs
      .filter((job) => {
        if (job.id !== currentJobId && group.jobIds.includes(job.id)) {
          return false;
        }
        return jobMatchesSearch(job, search);
      })
      .sort((a, b) => a.customerName.localeCompare(b.customerName))
      // A short or common search can still match hundreds of the ~8,000
      // jobs; nobody scrolls a dropdown that long, and turning each one into
      // a row is itself part of what made the box feel slow. Narrowing the
      // search is how you get past 30 results, not scrolling.
      .slice(0, 30);
  }

  function updateGroupFields(
    groupId: string,
    patch: Partial<InstallationGroup>,
  ) {
    onGroupsChange(
      groups.map((group) =>
        group.id === groupId ? { ...group, ...patch } : group,
      ),
    );
  }

  // A blank crew row, dated today so it lands in the current week rather than
  // being filtered out for having no date at all. Everything else is left
  // empty for the user to fill in, and the row opens in edit mode.
  function addTeamRow() {
    const today = malaysiaToday();
    const group: InstallationGroup = {
      id: crypto.randomUUID(),
      name: `New team · ${today}`,
      area: "",
      installationDate: today,
      installationEndDate: today,
      jobIds: [],
      installationTeam: "",
      wiringTeam: "",
      supervisors: [],
      teamLabel: "",
      wiringMembers: [],
      cars: [],
      remark: "",
    };
    onGroupsChange([...groups, group]);
    setNewRowGroupIds((previous) => [group.id, ...previous]);
    setEditingRowKeys((previous) => new Set(previous).add(`${group.id}|`));
  }

  /**
   * Remove one row from the schedule.
   *
   * Deliberately two different actions behind one button, because a row means
   * two different things:
   *
   * - A row with a customer is that customer's place on a crew's booking, so
   *   removing it takes them off that booking and leaves the crew, its members
   *   and the other customers alone. The customer keeps their installation
   *   date; they are only unassigned from this crew.
   * - A row with no customer IS the crew booking, so removing it deletes the
   *   booking outright.
   *
   * Removing the last customer therefore leaves the crew behind as an empty
   * row rather than silently discarding the week's crew and car. A second
   * Remove on that row clears it.
   */
  function removeScheduleRow(group: InstallationGroup, jobId: string) {
    if (jobId) {
      onGroupsChange(
        groups.map((item) =>
          item.id === group.id
            ? { ...item, jobIds: item.jobIds.filter((id) => id !== jobId) }
            : item,
        ),
      );
      setEditingRowKeys((previous) => {
        const next = new Set(previous);
        next.delete(`${group.id}|${jobId}`);
        return next;
      });
      return;
    }
    removeTeamRow(group.id);
  }

  // Its week assignment goes too, or the calendar would keep reading a start
  // time for a crew that no longer exists.
  function removeTeamRow(groupId: string) {
    onGroupsChange(groups.filter((group) => group.id !== groupId));
    onWeekAssignmentsChange(
      weekAssignments.filter((item) => item.installationGroupId !== groupId),
    );
    setNewRowGroupIds((previous) => previous.filter((id) => id !== groupId));
    setEditingRowKeys((previous) => {
      const next = new Set(previous);
      next.delete(`${groupId}|`);
      return next;
    });
  }

  function toggleRowEdit(rowKey: string) {
    setEditingRowKeys((previous) => {
      const next = new Set(previous);
      if (next.has(rowKey)) next.delete(rowKey);
      else next.add(rowKey);
      return next;
    });
  }

  function groupStartTime(groupId: string): string {
    const assignment = weekAssignments.find(
      (item) => item.installationGroupId === groupId,
    );
    return assignment?.startDate?.split("T")[1]?.slice(0, 5) ?? "";
  }

  function normalizeSlotTime(raw: string): string {
    const trimmed = raw.trim();
    if (!trimmed || /^(full(\s*day)?|all(\s*day)?|—|-)$/i.test(trimmed)) {
      return "";
    }
    const m = trimmed.match(/^(\d{1,2})(?:[:.](\d{2}))?\s*(am|pm)?$/i);
    if (m) {
      let hours = parseInt(m[1], 10);
      const minutes = m[2] ? m[2] : "00";
      const meridian = m[3]?.toLowerCase();
      if (meridian === "pm" && hours < 12) hours += 12;
      if (meridian === "am" && hours === 12) hours = 0;
      if (hours >= 0 && hours < 24 && parseInt(minutes, 10) >= 0 && parseInt(minutes, 10) < 60) {
        return `${String(hours).padStart(2, "0")}:${minutes}`;
      }
    }
    return trimmed;
  }

  function handleSlotTimeChange(
    group: InstallationGroup,
    job: InstallationJob | null,
    rowVisit: JobVisit | undefined,
    rawVal: string,
  ) {
    const normalized = normalizeSlotTime(rawVal);
    if (job && rowVisit) {
      const nextVisits = (job.visits ?? []).map((v) =>
        v.date === group.installationDate ? { ...v, time: normalized || undefined } : v,
      );
      onSaveJob({ ...job, visits: nextVisits });
    } else if (job) {
      onSaveJob({
        ...job,
        preferredInstallationTime: normalized || null,
      });
    }
    setGroupSchedule(group, group.installationDate, normalized);
  }

  // Date and time edits go to two places on purpose: the date is the group's
  // own field, but the clock lives on the week assignment (the calendar reads
  // it from there). A group that never got an assignment gets one created so
  // its time is not silently dropped.
  function setGroupSchedule(
    group: InstallationGroup,
    date: string,
    time?: string,
  ) {
    const nextDate = date || group.installationDate;
    if (date) {
      updateGroupFields(group.id, {
        installationDate: date,
        installationEndDate: date,
      });
    }
    const cleanTime = time !== undefined ? time.trim() : groupStartTime(group.id);
    const isFullDay = !cleanTime || /^full(\s*day)?$/i.test(cleanTime);
    const stamp = isFullDay ? nextDate : `${nextDate}T${cleanTime}`;
    const existing = weekAssignments.find(
      (item) => item.installationGroupId === group.id,
    );
    if (existing) {
      onWeekAssignmentsChange(
        weekAssignments.map((item) =>
          item.id === existing.id ? { ...item, startDate: stamp } : item,
        ),
      );
    } else {
      const team =
        teams.find(
          (item) =>
            item.name === group.installationTeam && !isWiringRole(item.role),
        ) ?? teams.find((item) => item.name === group.installationTeam);
      onWeekAssignmentsChange([
        ...weekAssignments,
        {
          id: crypto.randomUUID(),
          teamId: team?.id ?? "",
          startDate: stamp,
          installationGroupId: group.id,
        },
      ]);
    }
  }

  function addGroupListItem(
    group: InstallationGroup,
    key: "wiringMembers" | "cars" | "supervisors",
    value: string,
  ) {
    const trimmed = value.trim();
    if (!trimmed) return;
    const current = group[key] ?? [];
    if (current.includes(trimmed)) return;
    updateGroupFields(group.id, { [key]: [...current, trimmed] });
  }

  function removeGroupListItem(
    group: InstallationGroup,
    key: "wiringMembers" | "cars" | "supervisors",
    value: string,
  ) {
    updateGroupFields(group.id, {
      [key]: (group[key] ?? []).filter((item) => item !== value),
    });
  }

  // Choosing "+ Add new…" registers the name as a real team so it appears in
  // every other row's dropdown from then on, not just this one's.
  function commitNewTeam(
    group: InstallationGroup,
    field: "installationTeam" | "wiringTeam",
    name: string,
  ) {
    const trimmed = name.trim();
    if (trimmed) {
      if (!teams.some((team) => team.name === trimmed)) {
        onTeamsChange([
          ...teams,
          {
            id: crypto.randomUUID(),
            name: trimmed,
            role:
              field === "installationTeam"
                ? "installer_ar17"
                : "wiring_eternalgy",
            baseLocation: "",
            contact: "",
            members: [],
          },
        ]);
      }
      updateGroupFields(group.id, { [field]: trimmed });
    }
    setNewTeamDraft(null);
  }


  function toggleTeamEdit(teamId: string) {
    const wasEditing = editingTeamIds.has(teamId);
    setEditingTeamIds((previous) => {
      const next = new Set(previous);
      if (next.has(teamId)) {
        next.delete(teamId);
      } else {
        next.add(teamId);
      }
      return next;
    });
    if (wasEditing) return;

    // Opening a row loads what the team is actually holding into the fields,
    // because the date box and the group box *are* the readout now — there is
    // no chip or label beside them stating the assignment. Seeded on every
    // open rather than merged, so a row abandoned mid-edit comes back showing
    // the truth instead of a stale half-typed draft.
    const committed = weekAssignments.filter(
      (assignment) => assignment.teamId === teamId,
    );
    setRowAssignmentDraft((prev) => ({
      ...prev,
      [teamId]: {
        startDate:
          committed
            .map((assignment) => assignment.startDate)
            .filter(Boolean)
            .sort()[0] || "",
        endDate: "",
        // Normally one. A row assigned before the one-group rule can seed
        // several, which the picker reports as a count until it is narrowed.
        installationGroupIds: committed.map(
          (assignment) => assignment.installationGroupId,
        ),
      },
    }));
  }

  function addMemberTag(teamId: string) {
    const name = (memberDraft[teamId] ?? "").trim();
    if (!name) return;
    const team = teams.find((item) => item.id === teamId);
    if (!team || (team.members ?? []).includes(name)) {
      setMemberDraft((prev) => ({ ...prev, [teamId]: "" }));
      return;
    }
    updateTeam(teamId, { members: [...(team.members ?? []), name] });
    setMemberDraft((prev) => ({ ...prev, [teamId]: "" }));
  }

  function removeMemberTag(teamId: string, name: string) {
    const team = teams.find((item) => item.id === teamId);
    if (!team) return;
    updateTeam(teamId, {
      members: (team.members ?? []).filter((member) => member !== name),
    });
  }

  function getRowAssignmentDraft(teamId: string) {
    return (
      rowAssignmentDraft[teamId] ?? {
        startDate: "",
        endDate: "",
        installationGroupIds: [] as string[],
      }
    );
  }

  function updateRowAssignmentDraft(
    teamId: string,
    update: Partial<{ startDate: string; endDate: string; installationGroupIds: string[] }>,
  ) {
    setRowAssignmentDraft((prev) => ({
      ...prev,
      [teamId]: { ...getRowAssignmentDraft(teamId), ...update },
    }));
  }

  // A team holds exactly one customer group, so this commits the single
  // selected group and releases whatever the team was holding before —
  // assigning is a move, not an accumulation. Legacy rows carrying several
  // groups keep them until someone assigns here, which is why the release
  // covers every prior assignment rather than assuming there was one.
  //
  // The selected id may point at a live suggestion rather than a saved group
  // (see liveGroupSuggestions above); it gets promoted into a real, persisted
  // InstallationGroup here so the assignment has something to reference.
  function addRowWeekAssignment(teamId: string) {
    const draft = getRowAssignmentDraft(teamId);
    // Exactly one — a legacy row released into the draft can hold several,
    // and the Add button stays disabled until that is narrowed to a choice.
    if (!draft.startDate || draft.installationGroupIds.length !== 1) return;
    const [selectedGroupId] = draft.installationGroupIds;
    const team = teams.find((item) => item.id === teamId);
    const teamField = team
      ? isWiringRole(team.role)
        ? "wiringTeam"
        : "installationTeam"
      : null;

    const promotedGroups: InstallationGroup[] = [];
    if (!groups.some((group) => group.id === selectedGroupId)) {
      const suggestion = liveGroupSuggestions.find(
        (item) => item.id === selectedGroupId,
      );
      const jobIds = suggestion?.customers.map((customer) => customer.id) ?? [];
      // A suggestion with nobody in it would promote to an empty group and
      // strand the assignment against a group naming no customers.
      if (jobIds.length === 0) return;
      promotedGroups.push({
        id: selectedGroupId,
        name: `${suggestion?.area || "New group"} · Suggested`,
        area: [suggestion?.area, suggestion?.postcode, suggestion?.state]
          .filter(Boolean)
          .join(" · "),
        installationDate: "",
        installationEndDate: "",
        jobIds,
        installationTeam: "",
        wiringTeam: "",
        supervisors: [],
      });
    }

    const releasedGroupIds = new Set(
      weekAssignments
        .filter((assignment) => assignment.teamId === teamId)
        .map((assignment) => assignment.installationGroupId),
    );

    // A single onGroupsChange call covering the stamp and the release —
    // calling updateGroup once per group here would have each call read the
    // same stale `groups` closure and overwrite the previous call's change.
    onGroupsChange(
      [...groups, ...promotedGroups].map((group) => {
        if (group.id === selectedGroupId && teamField && team) {
          return { ...group, [teamField]: team.name };
        }
        // The group this team just moved off must not keep a crew that is now
        // committed elsewhere. Guarded on the name so a group reassigned to
        // another team in the meantime is left alone.
        if (
          releasedGroupIds.has(group.id) &&
          teamField &&
          team &&
          group[teamField] === team.name
        ) {
          return { ...group, [teamField]: "" };
        }
        return group;
      }),
    );

    onWeekAssignmentsChange([
      ...weekAssignments.filter((assignment) => assignment.teamId !== teamId),
      {
        id: crypto.randomUUID(),
        teamId,
        startDate: draft.startDate,
        installationGroupId: selectedGroupId,
      },
    ]);
    setRowAssignmentDraft((prev) => ({
      ...prev,
      // Holds what was just committed rather than emptying: the fields are the
      // row's readout while it is open, so clearing them here would read as
      // the assignment having vanished the moment it was saved.
      [teamId]: {
        startDate: draft.startDate,
        endDate: "",
        installationGroupIds: [selectedGroupId],
      },
    }));
  }

  // The assignments already made for a team, newest date first — rendered as
  // removable chips in its Customer Group cell.
  function assignmentsForTeam(teamId: string) {
    return weekAssignments
      .filter((assignment) => assignment.teamId === teamId)
      .map((assignment) => ({
        assignment,
        group:
          groups.find((item) => item.id === assignment.installationGroupId) ??
          null,
      }))
      .sort((a, b) =>
        (a.assignment.startDate || "").localeCompare(b.assignment.startDate || ""),
      );
  }

  // Who is actually in an assigned group. The group name alone ("Johor Bahru
  // · Suggested") names a place, not the customers a crew is going to, which
  // is what the Customer Group column is read for.
  function groupCustomerNames(group: InstallationGroup | null) {
    if (!group) return [] as string[];
    return group.jobIds
      .map((jobId) => {
        const job = jobById.get(jobId);
        if (!job) return null;
        const name = formatPersonName(job.customerName);
        return pinnedJobIds.has(jobId) ? `📌 ${name}` : name;
      })
      .filter((name): name is string => Boolean(name));
  }

  // Mirrors addRowWeekAssignment: it both records the assignment and stamps
  // the team onto the group, so removing has to undo both or the group keeps
  // a crew it is no longer assigned to.
  // "Edit" on a team row: releases every assignment it holds back into that
  // row's picker and date field so they can be reworked, and unpins the team.
  // Deliberately never deletes the team itself.
  function unpinTeamAssignments(teamId: string) {
    const mine = weekAssignments.filter(
      (assignment) => assignment.teamId === teamId,
    );
    if (mine.length === 0) return;
    onWeekAssignmentsChange(
      weekAssignments.filter((assignment) => assignment.teamId !== teamId),
    );

    setRowAssignmentDraft((prev) => {
      const current = prev[teamId] ?? {
        startDate: "",
        endDate: "",
        installationGroupIds: [] as string[],
      };
      const ids = new Set(current.installationGroupIds);
      mine.forEach((assignment) => ids.add(assignment.installationGroupId));
      return {
        ...prev,
        [teamId]: {
          ...current,
          // Earliest of the released dates, so the row comes back with a
          // sensible starting point rather than whichever sorted last.
          startDate:
            current.startDate ||
            mine
              .map((assignment) => assignment.startDate)
              .filter(Boolean)
              .sort()[0] ||
            "",
          installationGroupIds: Array.from(ids),
        },
      };
    });

    const team = teams.find((item) => item.id === teamId);
    if (!team) return;
    const teamField = isWiringRole(team.role) ? "wiringTeam" : "installationTeam";
    const releasedGroupIds = new Set(
      mine.map((assignment) => assignment.installationGroupId),
    );
    onGroupsChange(
      groups.map((group) =>
        releasedGroupIds.has(group.id) && group[teamField] === team.name
          ? { ...group, [teamField]: "" }
          : group,
      ),
    );
  }

  function updateGroup(id: string, update: Partial<InstallationGroup>) {
    onGroupsChange(
      groups.map((group) => (group.id === id ? { ...group, ...update } : group)),
    );
  }

  function updateTeam(id: string, update: Partial<TeamResource>) {
    const current = teams.find((team) => team.id === id);
    onTeamsChange(
      teams.map((team) => (team.id === id ? { ...team, ...update } : team)),
    );
    if (current?.name && update.name && update.name !== current.name) {
      onGroupsChange(
        groups.map((group) => ({
          ...group,
          installationTeam:
            group.installationTeam === current.name
              ? update.name!
              : group.installationTeam,
          wiringTeam:
            group.wiringTeam === current.name ? update.name! : group.wiringTeam,
        })),
      );
    }
  }

  function addTeamResource() {
    if (!teamDraft.name.trim()) return;
    onTeamsChange([
      ...teams,
      {
        id: crypto.randomUUID(),
        name: teamDraft.name.trim(),
        role: teamDraft.role,
        baseLocation: teamDraft.baseLocation.trim(),
        contact: teamDraft.contact.trim(),
        members: teamDraft.members
          .split(",")
          .map((member) => member.trim())
          .filter(Boolean),
      },
    ]);
    setTeamDraft({
      name: "",
      role: "installation",
      baseLocation: "",
      contact: "",
      members: "",
    });
  }

  function addBlankTeamResource() {
    onTeamsChange([
      ...teams,
      {
        id: crypto.randomUUID(),
        name: "",
        role: "installation",
        baseLocation: "",
        contact: "",
        members: [],
      },
    ]);
  }

  function addWeekAssignment() {
    if (
      !weekDraft.teamId ||
      !weekDraft.startDate ||
      !weekDraft.installationGroupId
    ) {
      return;
    }
    onWeekAssignmentsChange([
      ...weekAssignments,
      {
        id: crypto.randomUUID(),
        teamId: weekDraft.teamId,
        startDate: weekDraft.startDate,
        installationGroupId: weekDraft.installationGroupId,
      },
    ]);
    setWeekDraft({
      teamId: "",
      startDate: "",
      endDate: "",
      installationGroupId: "",
    });
  }

  const installationOptions = teams.filter((team) => !isWiringRole(team.role));
  const wiringOptions = teams.filter((team) => isWiringRole(team.role));

  // A group is offered once it holds at least one customer with a date who is
  // still in play. The test is on the customer, not the group: a group with no
  // date of its own still qualifies through a customer carrying their own, and
  // a dated group whose customers have all cancelled does not qualify at all.
  const datedGroups = groups.filter(
    (group) => schedulableMembers(group, jobs).length > 0,
  );

  // The Team management "Customer Group" picker: any group with a customer
  // who is Available or Pending on Customer Scheduling, whether or not a date
  // has been set yet.
  const availabilityReadyGroups = groups.filter((group) =>
    groupHasSchedulingReadyMember(group, jobs),
  );

  // Which team already holds each group. A group committed to one team stays
  // selectable for the others: a second crew on the same customers is a real
  // arrangement the planner has to be able to enter, and hiding the option
  // only meant the group could not be moved once the first team took it.
  const teamIdByGroupId = useMemo(() => {
    const owners = new Map<string, string>();
    weekAssignments.forEach((assignment) => {
      owners.set(assignment.installationGroupId, assignment.teamId);
    });
    return owners;
  }, [weekAssignments]);

  // Names the crew already committed to a group, as a suffix for the option
  // label. The choice is allowed, but it cannot be silent — an unlabelled
  // option is how two teams end up at one customer without anyone noticing.
  function heldByLabel(groupId: string, teamId: string) {
    const owner = teamIdByGroupId.get(groupId);
    if (!owner || owner === teamId) return "";
    const holder = teams.find((candidate) => candidate.id === owner);
    return ` · also held by ${holder?.name ?? "another team"}`;
  }

  // Available/Pending customers who aren't in any saved group yet, grouped by
  // town the same way Customer Scheduling groups them — so every Available or
  // Pending customer has *some* option in the picker, not just the ones lucky
  // enough to already sit in a saved group. Picking one and clicking Add
  // creates the group on the fly (see addRowWeekAssignment).
  const assignedJobIds = useMemo(
    () => new Set(groups.flatMap((group) => group.jobIds)),
    [groups],
  );
  const ungroupedSchedulingReadyJobs = jobs.filter(
    (job) =>
      !assignedJobIds.has(job.id) &&
      !isCompleteInstallation(job, todayIso) &&
      isSchedulingInPlay(job),
  );
  const liveGroupSuggestions = useMemo(
    () => buildLocationSuggestions(ungroupedSchedulingReadyJobs, jobs),
    [ungroupedSchedulingReadyJobs, jobs],
  );

  function groupOptionLabel(group: InstallationGroup) {
    return [
      group.name,
      group.area,
      formatAssignmentStamp(groupDisplayDate(group, jobs) ?? ""),
      groupAvailability(group, jobs),
    ]
      .filter(Boolean)
      .join(" · ");
  }

  function suggestionOptionLabel(suggestion: LocationSuggestion) {
    return [
      suggestion.area,
      suggestion.postcode,
      suggestion.state,
      `${suggestion.customers.length} customer${suggestion.customers.length === 1 ? "" : "s"}`,
    ]
      .filter(Boolean)
      .join(" · ");
  }

  const calendarTitle = calendarMonth.toLocaleDateString("en-MY", {
    month: "long",
    year: "numeric",
  });
  const calendarStart = new Date(calendarMonth);
  calendarStart.setDate(1 - ((calendarStart.getDay() + 6) % 7));
  const calendarDays = Array.from({ length: 42 }, (_, index) => {
    const date = new Date(calendarStart);
    date.setDate(calendarStart.getDate() + index);
    return date;
  });
  const weekChunks: Date[][] = [];
  for (let index = 0; index < calendarDays.length; index += 7) {
    weekChunks.push(calendarDays.slice(index, index + 7));
  }

  function deliveryRunsForGroup(groupId: string) {
    const group = groups.find((g) => g.id === groupId);
    const groupJobSet = new Set(group?.jobIds ?? []);
    return deliveryRuns.filter(
      (run) =>
        run.installationGroupId === groupId ||
        (groupJobSet.size > 0 &&
          run.jobIds.some((id) => groupJobSet.has(id))),
    );
  }

  function groupsForWeek(weekDates: Date[]): InstallationGroup[] {
    const weekStartKey = dateKey(weekDates[0]);
    const weekEndKey = dateKey(weekDates[6]);
    return groups
      .filter((group) => group.installationDate)
      .filter((group) => {
        const groupEnd = group.installationEndDate || group.installationDate;
        return !(groupEnd < weekStartKey || group.installationDate > weekEndKey);
      })
      .sort((a, b) => a.installationDate.localeCompare(b.installationDate));
  }

  const unscheduledGroups = groups.filter((group) => !group.installationDate);
  const openGroup = groups.find((group) => group.id === openGroupId) || null;

  // Teams holding a customer group pin to the top of Team management, so the
  // crews already committed read first and the rest are the ones still to
  // place. Ties keep the roster's own order.
  const assignedTeamIds = new Set(
    weekAssignments.map((assignment) => assignment.teamId),
  );
  const orderedTeams = teams
    .map((team, index) => ({ team, index }))
    .sort((a, b) => {
      const aAssigned = assignedTeamIds.has(a.team.id);
      const bAssigned = assignedTeamIds.has(b.team.id);
      if (aAssigned !== bAssigned) return aAssigned ? -1 : 1;
      return a.index - b.index;
    })
    .map((entry) => entry.team);

  const currentPlanningTitle =
    PLANNING_STAGES.find((stage) => stage.value === planningFilter)?.label ||
    "Installation Schedule";

  const currentPlanningSubtitle =
    planningFilter === "deposit"
      ? "Customer with Below 60% Payment and Pending Seda Approved"
      : planningFilter === "to_arrange"
      ? "Customer with Above 60% Payment and Seda Approved"
      : planningFilter === "propose"
      ? "Suggested customer installation dates from Ready to Install pipeline"
      : planningFilter === "arranged"
      ? "Customers scheduled with installation dates and teams"
      : "Customers grouped by location and installation date.";

  return (
    <>
      {groupsWorkspace === "teams" && (
        <div className="installation-schedule-filter-bar">
          <div className="schedule-filters">
            <label className="schedule-search">
              <span>Planning Status</span>
              <select
                value={planningFilter}
                onChange={(event) => {
                  setPlanningFilter(event.target.value);
                  if (event.target.value !== "to_arrange") {
                    setAwaitingReviewFilter("all");
                  }
                }}
                aria-label="Filter by planning status"
              >
                <option value={ALL_JOBS}>All jobs</option>
                {PLANNING_STAGES.map((stage) => (
                  <option key={stage.value} value={stage.value}>
                    {stage.label}
                  </option>
                ))}
              </select>
            </label>
            <label className="schedule-search">
              <span>Month or Year</span>
              <input
                type="search"
                className="second-payment-search"
                value={periodFilter}
                onChange={(event) => setPeriodFilter(event.target.value)}
                placeholder="August, 2026, August 2026…"
                aria-label="Filter by installation month or year"
              />
            </label>
            <label className="schedule-search">
              <span>Customer</span>
              <input
                type="search"
                className="customer-invoice-search"
                value={customerQuery}
                onChange={(event) => setCustomerQuery(event.target.value)}
                placeholder="Search customer, invoice, address, site supervisor…"
                aria-label="Search customer name, invoice number, address or site supervisor"
              />
            </label>
            {(periodFilter ||
              customerQuery ||
              awaitingReviewFilter !== "all") && (
              <button
                type="button"
                className="button secondary"
                onClick={() => {
                  setPeriodFilter("");
                  setCustomerQuery("");
                  setAwaitingReviewFilter("all");
                }}
              >
                Clear
              </button>
            )}
          </div>
        </div>
      )}

      <div className="planning-panel">
        {pendingCheckNotice && (
          <div className="rti-pending-notice" role="alert">
            <div className="rti-pending-alert-content">
              <AlertTriangle size={18} className="rti-pending-alert-icon" />
              <span className="rti-pending-alert-text">
                ⚠️ Customer <strong>{pendingCheckNotice.customerName}</strong> with remark contains <strong>&apos;{pendingCheckNotice.type}&apos;</strong>, please check if the case is complete
              </span>
            </div>
            <div className="rti-pending-alert-actions">
              <button
                type="button"
                className="rti-alert-btn-complete"
                onClick={() => {
                  const targetJob = jobById.get(pendingCheckNotice.jobId);
                  if (targetJob) {
                    onSaveJob({ ...targetJob, customerAvailabilityStatus: "complete" });
                  }
                  setPendingCheckNotice(null);
                }}
              >
                <Check size={14} /> Mark as Complete
              </button>
              <button
                type="button"
                className="rti-alert-btn-dismiss"
                onClick={() => setPendingCheckNotice(null)}
                title="Dismiss alert"
              >
                Dismiss
              </button>
            </div>
          </div>
        )}
        {groupsWorkspace === "teams" && (
          <div className="planning-heading">
            <div>
              <h2>{currentPlanningTitle}</h2>
              <p>{currentPlanningSubtitle}</p>
            </div>
            {!showSuggestedWeek &&
              !showDepositTable &&
              !showToArrangeTable &&
              planningFilter !== "arranged" && (
                <div className="planning-heading-actions">
                  <button className="button primary" onClick={addTeamRow}>
                    <Plus size={16} />
                    Add Team
                  </button>
                </div>
              )}
          </div>
        )}

      {showSuggestedWeek && (
        <div
          className={`team-planning-workspace ready-schedule-workspace${
            scheduleMapJobId ? "" : " map-hidden"
          }`}
        >
          {scheduleMapJobId && (
            <PlanningMap
              focusGroupId={null}
              highlightedGroupId={null}
              highlightedCustomerId={scheduleMapJobId}
              groups={readyScheduleMapGroups(readyScheduleJobs)}
              onClose={() => setScheduleMapJobId(null)}
            />
          )}
          <ReadyToInstallSchedule
            readyJobs={readyScheduleJobs}
            jobById={jobById}
            groups={groups}
            weekAssignments={weekAssignments}
            assessments={siteAssessments ?? {}}
            onSaveAssessment={onSaveSiteAssessment!}
            draft={scheduleDraft ?? null}
            onChangeDraft={onChangeScheduleDraft!}
            onBook={(group, assignment) => {
              // A confirmed customer becomes an ordinary booking, saved the
              // way every other edit on this page is.
              onGroupsChange([...groups, group as InstallationGroup]);
              onWeekAssignmentsChange([...weekAssignments, assignment]);
            }}
            onBatchBook={(bookings) => {
              const newGroups = bookings.map((b) => b.group as InstallationGroup);
              const newAssignments = bookings.map((b) => b.assignment);
              onGroupsChange([...groups, ...newGroups]);
              onWeekAssignmentsChange([...weekAssignments, ...newAssignments]);
            }}
            onShowOnMap={(jobId) =>
              setScheduleMapJobId((current) => (current === jobId ? null : jobId))
            }
            mapJobId={scheduleMapJobId}
            onOpenInQueue={(jobId) => {
              setPlanningFilter("to_arrange");
            }}
            focusJobId={null}
            todayIso={todayIso}
            onSaveJob={onSaveJob}
            teams={teams}
            searchQuery={customerQuery}
          />
        </div>
      )}

      {showDepositTable && (
        <div
          className={`team-planning-workspace ready-schedule-workspace${
            scheduleMapJobId ? "" : " map-hidden"
          }`}
        >
          {scheduleMapJobId && (
            <PlanningMap
              focusGroupId={null}
              highlightedGroupId={null}
              highlightedCustomerId={scheduleMapJobId}
              groups={readyScheduleMapGroups(depositScheduleJobs)}
              onClose={() => setScheduleMapJobId(null)}
            />
          )}
          <DepositScheduleTable
            jobs={depositScheduleJobs}
            assessments={siteAssessments ?? {}}
            onSaveJob={onSaveJob}
            onShowOnMap={(jobId) =>
              setScheduleMapJobId((current) => (current === jobId ? null : jobId))
            }
            mapJobId={scheduleMapJobId}
            onOpenInQueue={(jobId) => onOpenInQueue?.(jobId)}
          />
        </div>
      )}

      {showToArrangeTable && (
        <div
          className={`team-planning-workspace ready-schedule-workspace${
            scheduleMapJobId ? "" : " map-hidden"
          }`}
        >
          {scheduleMapJobId && (
            <PlanningMap
              focusGroupId={null}
              highlightedGroupId={null}
              highlightedCustomerId={scheduleMapJobId}
              groups={readyScheduleMapGroups(toArrangeScheduleJobs)}
              onClose={() => setScheduleMapJobId(null)}
            />
          )}
          <DepositScheduleTable
            jobs={toArrangeScheduleJobs}
            assessments={siteAssessments ?? {}}
            onSaveJob={onSaveJob}
            onShowOnMap={(jobId) =>
              setScheduleMapJobId((current) => (current === jobId ? null : jobId))
            }
            mapJobId={scheduleMapJobId}
            onOpenInQueue={(jobId) => onOpenInQueue?.(jobId)}
            emptyMessage="No ready to install customers found to arrange."
            todayIso={todayIso}
            showAwaitingReviewFilter={true}
            awaitingReviewFilter={awaitingReviewFilter}
            onAwaitingReviewChange={setAwaitingReviewFilter}
            newReadyCount={newReadyCount}
            specialCaseCount={specialCaseCount}
            rescheduleCount={rescheduleCount}
            pendingCount={pendingCount}
            attentionCount={attentionCount}
            omCount={omCount}
          />
        </div>
      )}

      {groupsWorkspace === "teams" && !showSuggestedWeek && !showDepositTable && !showToArrangeTable && (
        <section className="unified-team-management">
          <div className="table-wrap rti-team unified-team-table">
            <datalist id="rti-slot-time-presets">
              <option value="09:00">09:00 (Morning)</option>
              <option value="10:00">10:00</option>
              <option value="11:00">11:00</option>
              <option value="12:00">12:00 (Noon)</option>
              <option value="13:00">13:00</option>
              <option value="14:00">14:00 (Afternoon)</option>
              <option value="14:30">14:30</option>
              <option value="15:00">15:00</option>
              <option value="16:00">16:00</option>
              <option value="Full day">Full day</option>
            </datalist>
            <table>
              <colgroup>
                <col className="rti-col-date" />
                <col className="rti-col-customer" />
                <col className="rti-col-address" />
                <col className="rti-col-phone" />
                <col className="rti-col-email" />
                <col className="rti-col-agent" />
                <col className="rti-col-phase" />
                <col className="rti-col-panel" />
                <col className="rti-col-inverter" />
                <col className="rti-col-remark" />
              </colgroup>
              <tbody>
                {scheduleRows.map(({ rowKey, group, job, jobId, blockKey }, index) => {
                  // A band whenever the crew, the week or the supervisor
                  // changes — the sheet's red week bar and the cyan crew bar
                  // under it, folded into one row.
                  const startsBlock =
                    index === 0 || scheduleRows[index - 1].blockKey !== blockKey;
                  // Nothing assigned yet means no band: a booking "Add
                  // Team" has just created heads the table with a week and an
                  // empty crew line, which reads as a real section that is
                  // simply missing its crew. It appears the moment any of the
                  // four crew fields is filled in.
                  const bandCrew = crewBandLabel(group);
                  const wiringMembers = group.wiringMembers ?? [];
                  const cars = group.cars ?? [];
                  const startTime = groupStartTime(group.id);
                  // Null on the customer's primary installation day; the
                  // return trip itself on any later day the crew goes back.
                  const rowVisit = job?.visits?.find(
                    (visit) => visit.date === group.installationDate,
                  );
                  const effectiveTime =
                    (rowVisit ? rowVisit.time : undefined) ||
                    job?.preferredInstallationTime ||
                    startTime ||
                    "";
                  const ownRemark =
                    (rowVisit ? rowVisit.notes : job?.installationRemarks) ?? "";
                  // No customer on the row: the booking's own note is all
                  // there is. A return trip: its own note and never the
                  // booking's, because it is about that day's visit. Otherwise
                  // the customer's note, falling back to the one the booking
                  // was created with until they are given their own.
                  const rowRemark = !job
                    ? (group.remark ?? "")
                    : rowVisit
                      ? ownRemark
                      : ownRemark || (group.remark ?? "");
                  const addingInstall =
                    newTeamDraft?.rowKey === rowKey &&
                    newTeamDraft.field === "installationTeam";
                  const addingWiring =
                    newTeamDraft?.rowKey === rowKey &&
                    newTeamDraft.field === "wiringTeam";
                  const rawTeamNum = (() => {
                    const raw = `${group.teamLabel || ""} ${group.name || ""}`;
                    const m = raw.match(/\bteam\s*(\d+)\b/i) || (group.teamLabel || "").match(/\b(\d+)\b/);
                    return m ? Number(m[1]) : null;
                  })();
                  const isStandardTeam = rawTeamNum !== null && rawTeamNum >= 1 && rawTeamNum <= 4;
                  const teamNum = isStandardTeam ? rawTeamNum : null;
                  const teamClass = isStandardTeam
                    ? `rti-team-${teamNum}`
                    : "rti-team-other rti-team-default";
                  const teamTitle = (() => {
                    if (rawTeamNum) return `Team ${rawTeamNum}`;
                    if (!isPlaceholder(group.teamLabel)) return group.teamLabel!;
                    return group.name || "Team";
                  })();
                  const baseLabel = (() => {
                    if (group.area && !isPlaceholder(group.area)) {
                      const trimmed = group.area.trim();
                      return /base$/i.test(trimmed) ? trimmed : `${trimmed} base`;
                    }
                    if (teamNum && (teamNum as TeamNumber) in TEAM_REGION) {
                      return REGION_LABEL[TEAM_REGION[teamNum as TeamNumber]];
                    }
                    return null;
                  })();
                  const blockGroups = groupsByBlockKey.get(blockKey) ?? [group];
                  const blockSupervisors = Array.from(
                    new Set(
                      blockGroups
                        .flatMap((g) => g.supervisors ?? [])
                        .map((s) => s.trim())
                        .filter((s) => s && !isPlaceholder(s)),
                    ),
                  );
                  const defaultSupervisor =
                    blockSupervisors.length > 0 ? blockSupervisors.join(", ") : "";

                  const blockInstallTeam =
                    blockGroups.map((g) => g.installationTeam).find((t) => t && !isPlaceholder(t)) ||
                    group.installationTeam ||
                    (teamNum === 1
                      ? "Installation Team A"
                      : teamNum === 2
                        ? "Installation Team C"
                        : teamNum === 3
                          ? "Installation Team B"
                          : teamNum === 4
                            ? "Installation Team D"
                            : "");
                  const blockWiringTeam =
                    blockGroups.map((g) => g.wiringTeam).find((t) => t && !isPlaceholder(t)) ||
                    group.wiringTeam ||
                    (teamNum ? `Wiring Team ${teamNum}` : "");

                  const defaultMembers =
                    Array.from(
                      new Set(
                        blockGroups
                          .flatMap((g) => g.wiringMembers ?? [])
                          .map((s) => s.trim())
                          .filter(Boolean),
                      ),
                    ).join(", ") || (group.wiringMembers?.join(", ") ?? "");

                  const defaultCars =
                    Array.from(
                      new Set(
                        blockGroups
                          .flatMap((g) => g.cars ?? [])
                          .map((s) => s.trim())
                          .filter(Boolean),
                      ),
                    ).join(", ") || (group.cars?.join(", ") ?? "");

                  const crewDetails = [
                    isPlaceholder(blockInstallTeam)
                      ? ""
                      : `Install: ${blockInstallTeam}`,
                    isPlaceholder(blockWiringTeam) ? "" : `Wiring: ${blockWiringTeam}`,
                    blockSupervisors.length
                      ? `Site Supervisor: ${blockSupervisors.join(", ")}`
                      : "",
                  ]
                    .filter(Boolean)
                    .join("  ·  ");
                  return (
                    <Fragment key={rowKey}>
                    {startsBlock && bandCrew && (
                      <>
                        <tr
                          className={`schedule-band rti-team-band rti-team-band-sub${
                            pinnedWeekKeys.has(blockKey) ? " is-pinned" : ""
                          }`}
                        >
                          <th colSpan={visibleColumnCount} scope="colgroup">
                            <div className="schedule-band-sub-content">
                              <button
                                type="button"
                                className="schedule-band-pin"
                                aria-pressed={pinnedWeekKeys.has(blockKey)}
                                aria-label={`${
                                  pinnedWeekKeys.has(blockKey) ? "Unpin" : "Pin"
                                } week ${weekRangeLabel(group.installationDate)}`}
                                title={
                                  pinnedWeekKeys.has(blockKey)
                                    ? "Unpin this week"
                                    : "Pin this week to the top"
                                }
                                onClick={() => togglePinnedWeek(blockKey)}
                              >
                                {pinnedWeekKeys.has(blockKey) ? (
                                  <PinOff size={14} />
                                ) : (
                                  <Pin size={14} />
                                )}
                              </button>
                              <span className="schedule-band-week">
                                Week {weekRangeLabel(group.installationDate)}
                              </span>
                            </div>
                          </th>
                        </tr>
                        <tr
                          className={`schedule-band rti-team-band rti-team-band-main ${teamClass}${
                            pinnedWeekKeys.has(blockKey) ? " is-pinned" : ""
                          }`}
                        >
                          <th colSpan={visibleColumnCount} scope="colgroup">
                            <div className="rti-team-header-main">
                              <div className="rti-team-title-wrap">
                                <span className="rti-team-name">{teamTitle}</span>
                                {baseLabel && (
                                  <span className="rti-team-base">{baseLabel}</span>
                                )}
                              </div>
                              <div className="rti-crew-grid">
                                <div className="rti-crew-col">
                                  <label
                                    className="rti-crew-label"
                                    htmlFor={`arr-crew-inst-${group.id}`}
                                  >
                                    Installation Team
                                  </label>
                                  <input
                                    id={`arr-crew-inst-${group.id}`}
                                    type="text"
                                    list={`arr-install-teams-list-${group.id}`}
                                    className="rti-crew-input rti-crew-input-borderless"
                                    value={
                                      groupCrewDraft[group.id]?.installationTeam !==
                                      undefined
                                        ? groupCrewDraft[group.id]!.installationTeam
                                        : blockInstallTeam
                                    }
                                    placeholder="—"
                                    onChange={(e) => {
                                      const val = e.target.value;
                                      setGroupCrewDraft((prev) => ({
                                        ...prev,
                                        [group.id]: {
                                          ...prev[group.id],
                                          installationTeam: val,
                                        },
                                      }));
                                    }}
                                    onBlur={(e) => {
                                      const val = e.target.value;
                                      const blockIds = new Set(blockGroups.map((g) => g.id));
                                      onGroupsChange(
                                        groups.map((g) =>
                                          blockIds.has(g.id)
                                            ? { ...g, installationTeam: val }
                                            : g,
                                        ),
                                      );
                                    }}
                                    onClick={(e) => e.stopPropagation()}
                                  />
                                  <datalist id={`arr-install-teams-list-${group.id}`}>
                                    {installationTeamNames.map((name) => (
                                      <option key={name} value={name} />
                                    ))}
                                  </datalist>
                                </div>

                                <div className="rti-crew-col">
                                  <label
                                    className="rti-crew-label"
                                    htmlFor={`arr-crew-wir-${group.id}`}
                                  >
                                    Wiring Team
                                  </label>
                                  <input
                                    id={`arr-crew-wir-${group.id}`}
                                    type="text"
                                    list={`arr-wiring-teams-list-${group.id}`}
                                    className="rti-crew-input rti-crew-input-borderless"
                                    value={
                                      groupCrewDraft[group.id]?.wiringTeam !==
                                      undefined
                                        ? groupCrewDraft[group.id]!.wiringTeam
                                        : blockWiringTeam
                                    }
                                    placeholder="—"
                                    onChange={(e) => {
                                      const val = e.target.value;
                                      setGroupCrewDraft((prev) => ({
                                        ...prev,
                                        [group.id]: {
                                          ...prev[group.id],
                                          wiringTeam: val,
                                        },
                                      }));
                                    }}
                                    onBlur={(e) => {
                                      const val = e.target.value;
                                      const blockIds = new Set(blockGroups.map((g) => g.id));
                                      onGroupsChange(
                                        groups.map((g) =>
                                          blockIds.has(g.id)
                                            ? { ...g, wiringTeam: val }
                                            : g,
                                        ),
                                      );
                                    }}
                                    onClick={(e) => e.stopPropagation()}
                                  />
                                  <datalist id={`arr-wiring-teams-list-${group.id}`}>
                                    {wiringTeamNames.map((name) => (
                                      <option key={name} value={name} />
                                    ))}
                                  </datalist>
                                </div>

                                 <div className="rti-crew-col">
                                  <div style={{ display: "flex", alignItems: "center", gap: 4, justifyContent: "space-between" }}>
                                    <label
                                      className="rti-crew-label"
                                      htmlFor={`arr-crew-sup-${group.id}`}
                                    >
                                      Site Supervisor
                                    </label>
                                    <button
                                      type="button"
                                      title="Add supervisor"
                                      style={{
                                        padding: "0 4px",
                                        height: 16,
                                        fontSize: 10,
                                        borderRadius: 3,
                                        cursor: "pointer",
                                        display: "flex",
                                        alignItems: "center",
                                        gap: 2,
                                        background: "rgba(255, 255, 255, 0.15)",
                                        color: "inherit",
                                        border: "none",
                                      }}
                                      onClick={() => {
                                        const current =
                                          groupCrewDraft[group.id]?.siteSupervisor !== undefined
                                            ? groupCrewDraft[group.id]!.siteSupervisor
                                            : defaultSupervisor;
                                        if (!current) {
                                          const el = document.getElementById(`arr-crew-sup-${group.id}`) as HTMLInputElement;
                                          el?.focus();
                                        } else if (!current.endsWith(", ")) {
                                          setGroupCrewDraft((prev) => ({
                                            ...prev,
                                            [group.id]: {
                                              ...prev[group.id],
                                              siteSupervisor: `${current.trim()}, `,
                                            },
                                          }));
                                        }
                                      }}
                                    >
                                      <Plus size={11} />
                                    </button>
                                  </div>
                                  <input
                                    id={`arr-crew-sup-${group.id}`}
                                    type="text"
                                    list={`arr-supervisors-list-${group.id}`}
                                    className="rti-crew-input rti-crew-input-borderless"
                                    value={
                                      groupCrewDraft[group.id]?.siteSupervisor !==
                                      undefined
                                        ? groupCrewDraft[group.id]!.siteSupervisor
                                        : defaultSupervisor
                                    }
                                    placeholder="e.g. Jack, John"
                                    title="Site Supervisor (can have more than one, separated by comma)"
                                    onChange={(e) => {
                                      const val = e.target.value;
                                      setGroupCrewDraft((prev) => ({
                                        ...prev,
                                        [group.id]: {
                                          ...prev[group.id],
                                          siteSupervisor: val,
                                        },
                                      }));
                                    }}
                                    onBlur={(e) => {
                                      const val = e.target.value;
                                      const parsed = val
                                        ? val
                                            .split(/[,/]/)
                                            .map((s) => s.trim())
                                            .filter(Boolean)
                                        : [];
                                      const blockIds = new Set(blockGroups.map((g) => g.id));
                                      onGroupsChange(
                                        groups.map((g) =>
                                          blockIds.has(g.id)
                                            ? { ...g, supervisors: parsed }
                                            : g,
                                        ),
                                      );
                                    }}
                                    onClick={(e) => e.stopPropagation()}
                                  />
                                  <datalist id={`arr-supervisors-list-${group.id}`}>
                                    {supervisorNames.map((name) => (
                                      <option key={name} value={name} />
                                    ))}
                                  </datalist>
                                </div>

                                <div className="rti-crew-col">
                                  <label
                                    className="rti-crew-label"
                                    htmlFor={`arr-crew-mem-${group.id}`}
                                  >
                                    Team Member
                                  </label>
                                  <input
                                    id={`arr-crew-mem-${group.id}`}
                                    type="text"
                                    className="rti-crew-input rti-crew-input-borderless"
                                    value={
                                      groupCrewDraft[group.id]?.membersText !==
                                      undefined
                                        ? groupCrewDraft[group.id]!.membersText
                                        : defaultMembers
                                    }
                                    placeholder="—"
                                    onChange={(e) => {
                                      const val = e.target.value;
                                      setGroupCrewDraft((prev) => ({
                                        ...prev,
                                        [group.id]: {
                                          ...prev[group.id],
                                          membersText: val,
                                        },
                                      }));
                                    }}
                                    onBlur={(e) => {
                                      const val = e.target.value;
                                      const parsed = val
                                        ? val
                                            .split(/[,/]/)
                                            .map((s) => s.trim())
                                            .filter(Boolean)
                                        : [];
                                      const blockIds = new Set(blockGroups.map((g) => g.id));
                                      onGroupsChange(
                                        groups.map((g) =>
                                          blockIds.has(g.id)
                                            ? { ...g, wiringMembers: parsed }
                                            : g,
                                        ),
                                      );
                                    }}
                                    onClick={(e) => e.stopPropagation()}
                                  />
                                </div>

                                <div className="rti-crew-col">
                                  <label
                                    className="rti-crew-label"
                                    htmlFor={`arr-crew-car-${group.id}`}
                                  >
                                    Car
                                  </label>
                                  <input
                                    id={`arr-crew-car-${group.id}`}
                                    type="text"
                                    list="car-options"
                                    className="rti-crew-input rti-crew-input-borderless"
                                    value={
                                      groupCrewDraft[group.id]?.car !==
                                      undefined
                                        ? groupCrewDraft[group.id]!.car
                                        : defaultCars
                                    }
                                    placeholder="—"
                                    onChange={(e) => {
                                      const val = e.target.value;
                                      setGroupCrewDraft((prev) => ({
                                        ...prev,
                                        [group.id]: {
                                          ...prev[group.id],
                                          car: val,
                                        },
                                      }));
                                    }}
                                    onBlur={(e) => {
                                      const val = e.target.value;
                                      const parsed = val
                                        ? val
                                            .split(/[,/]/)
                                            .map((s) => s.trim())
                                            .filter(Boolean)
                                        : [];
                                      const blockIds = new Set(blockGroups.map((g) => g.id));
                                      onGroupsChange(
                                        groups.map((g) =>
                                          blockIds.has(g.id)
                                            ? { ...g, cars: parsed }
                                            : g,
                                        ),
                                      );
                                    }}
                                    onClick={(e) => e.stopPropagation()}
                                  />
                                </div>
                              </div>
                            </div>
                          </th>
                        </tr>
                        <tr className="schedule-column-headers">
                          <th>Slot</th>
                          <th>Customer</th>
                          <th>Address</th>
                          <th>Phone</th>
                          <th>Email</th>
                          <th>Agent</th>
                          <th>Phase</th>
                          <th>Panel</th>
                          <th>Inverter</th>
                          <th>Remark</th>
                        </tr>
                      </>
                    )}
                    <tr
                      className={[
                        "rti-row",
                        Boolean(job && /koh\s*keng\s*kiat/i.test(job.customerName))
                          ? "is-koh-keng-kiat"
                          : "",
                        remarkHasOm(rowRemark) ? "is-om" : "",
                      ]
                        .filter(Boolean)
                        .join(" ")}
                    >
                      {/* 1. Slot */}
                      <td className="rti-date">
                        <strong>{formatDateOnly(group.installationDate)}</strong>
                        <div className="rti-slot-time-wrap">
                          <Clock3 size={11} className="rti-slot-time-icon" />
                          <input
                            type="text"
                            list="rti-slot-time-presets"
                            className="rti-slot-time-input"
                            defaultValue={effectiveTime || "Full day"}
                            key={`slot-time-${rowKey}-${effectiveTime}`}
                            placeholder="Full day"
                            title="Click to edit installation time (e.g. 09:00, 14:00, Full day)"
                            onClick={(e) => e.stopPropagation()}
                            onFocus={(e) => {
                              if (e.target.value === "Full day") {
                                e.target.select();
                              }
                            }}
                            onKeyDown={(e) => {
                              if (e.key === "Enter") {
                                e.currentTarget.blur();
                              }
                            }}
                            onBlur={(e) => {
                              const raw = e.target.value;
                              handleSlotTimeChange(group, job, rowVisit, raw);
                            }}
                          />
                        </div>
                      </td>

                      {/* 2. Customer */}
                      <td>
                        <div className="rti-customer-wrap">
                          {job ? (
                            <>
                              {(() => {
                                const rowDate = (rowVisit?.date || group.installationDate || "").slice(0, 10);
                                const latestDate = latestScheduledDateByJobId.get(job.id);
                                const isLatestDate = !latestDate || !rowDate || rowDate >= latestDate;
                                const isJobComplete = job.customerAvailabilityStatus === "complete";
                                const isRowComplete = isJobComplete && isLatestDate;

                                return (
                                  <button
                                    type="button"
                                    className={`rti-row-complete-btn${isRowComplete ? " is-complete" : ""}`}
                                    title={
                                      isRowComplete
                                        ? "Complete (Click to reopen)"
                                        : isJobComplete && !isLatestDate
                                          ? `Intermediate visit on ${shortDate(rowDate)} · Final completion date: ${shortDate(latestDate)}`
                                          : "Mark as complete (✓)"
                                    }
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      const nextStatus: CustomerAvailabilityStatus = isJobComplete ? "propose" : "complete";
                                      onSaveJob({ ...job, customerAvailabilityStatus: nextStatus });
                                      if (!isJobComplete && pendingCheckNotice?.jobId === job.id) {
                                        setPendingCheckNotice(null);
                                      }
                                    }}
                                  >
                                    <Check size={13} strokeWidth={2.8} />
                                  </button>
                                );
                              })()}
                              <span
                                className="rti-name"
                                title={`SEDA approved: ${job.sedaApprovedDate ? shortDate(job.sedaApprovedDate) : isSedaApproved(job.sedaStatus) ? "Approved" : (job.sedaStatus || "Pending")} · 2nd payment: ${shortDate(job.secondPaymentDate) || "–"}`}
                              >
                                {displayName(job.customerName)}
                              </span>
                              <div className="rti-customer-popover" role="tooltip">
                                <div className="rti-customer-popover-row">
                                  <span className="rti-customer-popover-label">SEDA approved:</span>
                                  <span className="rti-customer-popover-val">
                                    {job.sedaApprovedDate
                                      ? shortDate(job.sedaApprovedDate)
                                      : isSedaApproved(job.sedaStatus)
                                      ? "Approved"
                                      : (job.sedaStatus || "Pending")}
                                  </span>
                                </div>
                                <div className="rti-customer-popover-row">
                                  <span className="rti-customer-popover-label">2nd payment:</span>
                                  <span className="rti-customer-popover-val">
                                    {shortDate(job.secondPaymentDate) || "–"}
                                  </span>
                                </div>
                                <div className="rti-customer-popover-row">
                                  <span className="rti-customer-popover-label">Payment status:</span>
                                  <span className="rti-customer-popover-val">
                                    {(job.paymentPercent ?? 0).toFixed(2)}% paid
                                  </span>
                                </div>
                              </div>
                              {job.invoiceNumber && (
                                <span className="rti-muted rti-invoice">{job.invoiceNumber}</span>
                              )}
                              {isAtap(job.customerName) && (
                                <span className="rti-tag is-roof" title="Roof type from customer name">
                                  ATAP
                                </span>
                              )}
                              {job.battery && job.battery !== "Not available" && (
                                <span className="rti-tag is-battery" title={job.battery}>
                                  Battery
                                </span>
                              )}
                              {job.evDetails && (
                                <span className="rti-tag is-ev" title={job.evDetails}>
                                  EV
                                </span>
                              )}
                            </>
                          ) : (
                            <span className="run-field-readout is-empty">
                              {jobId ? "Customer not in pipeline" : "No customer yet"}
                            </span>
                          )}
                        </div>
                      </td>

                      {/* 3. Address */}
                      <td>
                        {job && job.address ? (
                          <button
                            type="button"
                            className={`rti-link rti-address${scheduleMapJobId === job.id ? " is-active" : ""}`}
                            onClick={(e) => {
                              e.stopPropagation();
                              setScheduleMapJobId((current) => (current === job.id ? null : job.id));
                            }}
                            title="Show on the map"
                          >
                            <MapPin size={13} />
                            {titleCase(job.address) || "Address not available"}
                          </button>
                        ) : (
                          <span className="run-field-readout is-empty">—</span>
                        )}
                      </td>

                      {/* 4. Phone */}
                      <td>
                        {job && job.customerPhone ? (
                          formatPhone(job.customerPhone) || "–"
                        ) : (
                          <span className="run-field-readout is-empty">—</span>
                        )}
                      </td>

                      {/* 5. Email */}
                      <td className="rti-email">
                        {job?.customerEmail || "–"}
                      </td>

                      {/* 6. Agent */}
                      <td className="rti-agent">
                        {job?.agentName?.trim().toUpperCase() || "–"}
                      </td>

                      {/* 7. Phase */}
                      <td>
                        {job ? (
                          phaseText(job)
                        ) : (
                          <span className="run-field-readout is-empty">—</span>
                        )}
                      </td>

                      {/* 8. Panel */}
                      <td className="rti-edit-cell">
                        {job ? (
                          <textarea
                            className="rti-cell-textarea"
                            rows={3}
                            defaultValue={derivedPowerOutput(job)}
                            key={`panel-${job.id}-${job.powerOutput}`}
                            onBlur={(event) => {
                              const text = event.target.value;
                              if (text === derivedPowerOutput(job)) return;
                              onSaveJob({ ...job, powerOutput: text });
                            }}
                            placeholder="e.g. 16 Jinko 650W"
                            aria-label={`Panel for ${displayName(job.customerName)}`}
                          />
                        ) : (
                          <span className="run-field-readout is-empty">—</span>
                        )}
                      </td>

                      {/* 9. Inverter */}
                      <td className="rti-edit-cell">
                        {job ? (
                          <textarea
                            className="rti-cell-textarea"
                            rows={3}
                            defaultValue={inverterText(job)}
                            key={`inverter-${job.id}-${job.inverterBattery}`}
                            onBlur={(event) => {
                              const text = event.target.value;
                              const current = inverterText(job);
                              if (text === current) return;
                              onSaveJob({ ...job, inverterBattery: text });
                            }}
                            placeholder="e.g. 10kW Hybrid"
                            aria-label={`Inverter for ${displayName(job.customerName)}`}
                          />
                        ) : (
                          <span className="run-field-readout is-empty">—</span>
                        )}
                      </td>

                      {/* 10. Remark */}
                      <td className="rti-edit-cell rti-remark-cell">
                        <textarea
                          className="rti-cell-textarea"
                          rows={3}
                          defaultValue={rowRemark}
                          key={`remark-${rowKey}-${rowRemark}`}
                          onBlur={(event) => {
                            const text = event.target.value;
                            if (text === rowRemark) return;
                            if (!job) {
                              updateGroupFields(group.id, { remark: text });
                              return;
                            }
                            const updatedJob = withRowRemark(job, rowVisit, text);
                            onSaveJob(updatedJob);

                            if (job.customerAvailabilityStatus !== "complete") {
                              const stripped = text.replace(/pending\s*seda[a-z\s]*/gi, " ");
                              const isPending = /(\bpending\b|\bwait\b|\bwaiting\b)/i.test(stripped);
                              const isReschedule = /reschedule/i.test(text);
                              if (isPending) {
                                setPendingCheckNotice({
                                  jobId: job.id,
                                  customerName: displayName(job.customerName),
                                  type: "pending",
                                });
                              } else if (isReschedule) {
                                setPendingCheckNotice({
                                  jobId: job.id,
                                  customerName: displayName(job.customerName),
                                  type: "reschedule",
                                });
                              } else if (pendingCheckNotice?.jobId === job.id) {
                                setPendingCheckNotice(null);
                              }
                            }
                          }}
                          placeholder={
                            job
                              ? "Site notes for this customer"
                              : "Notes for this crew booking"
                          }
                          aria-label={
                            job
                              ? `Remark for ${job.customerName}`
                              : "Remark for this crew booking"
                          }
                        />
                      </td>
                    </tr>
                    </Fragment>
                  );
                })}
              </tbody>
            </table>
            <datalist id="wiring-member-options">
              {memberSuggestions.map((name) => (
                <option key={name} value={name} />
              ))}
            </datalist>
            <datalist id="car-options">
              {carSuggestions.map((name) => (
                <option key={name} value={name} />
              ))}
            </datalist>
            <datalist id="supervisor-options">
              {supervisorNames.map((name) => (
                <option key={name} value={name} />
              ))}
            </datalist>
          </div>
        </section>
      )}

      {groupsWorkspace === "teams" && <div className="team-management-legacy">
      <section className="team-directory">
        <div className="group-header">
          <div>
            <h3>Team directory</h3>
            <p>Add teams or edit names, locations, and contacts directly.</p>
          </div>
        </div>
        <div className="team-create-row">
          <input
            value={teamDraft.name}
            onChange={(event) =>
              setTeamDraft({ ...teamDraft, name: event.target.value })
            }
            placeholder="New team name"
            aria-label="New team name"
          />
          <select
            value={teamDraft.role}
            onChange={(event) =>
              setTeamDraft({
                ...teamDraft,
                role: event.target.value as TeamResource["role"],
              })
            }
            aria-label="New team role"
          >
            {TEAM_ROLES.map((item) => (
              <option key={item.value} value={item.value}>
                {item.label}
              </option>
            ))}
          </select>
          <input
            value={teamDraft.baseLocation}
            onChange={(event) =>
              setTeamDraft({ ...teamDraft, baseLocation: event.target.value })
            }
            placeholder="Base location"
            aria-label="New team base location"
          />
          <input
            value={teamDraft.contact}
            onChange={(event) =>
              setTeamDraft({ ...teamDraft, contact: event.target.value })
            }
            placeholder="Contact number"
            aria-label="New team contact"
          />
          <input
            value={teamDraft.members}
            onChange={(event) =>
              setTeamDraft({ ...teamDraft, members: event.target.value })
            }
            placeholder="Members, separated by commas"
            aria-label="New team members"
          />
          <button
            className="button primary"
            disabled={!teamDraft.name.trim()}
            onClick={addTeamResource}
          >
            Add team
          </button>
        </div>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Team name</th>
                <th>Role</th>
                <th>Base location</th>
                <th>Contact</th>
                <th>Members</th>
                <th aria-label="Delete" />
              </tr>
            </thead>
            <tbody>
              {teams.map((team) => (
                <tr key={team.id}>
                  <td>
                    <input
                      value={team.name}
                      onChange={(event) =>
                        updateTeam(team.id, { name: event.target.value })
                      }
                      aria-label={`Edit ${team.name} name`}
                    />
                  </td>
                  <td>
                    <select
                      value={team.role}
                      onChange={(event) =>
                        updateTeam(team.id, {
                          role: event.target.value as TeamResource["role"],
                        })
                      }
                    >
                      {TEAM_ROLES.map((item) => (
                        <option key={item.value} value={item.value}>
                          {item.label}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td>
                    <input
                      value={team.baseLocation}
                      onChange={(event) =>
                        updateTeam(team.id, {
                          baseLocation: event.target.value,
                        })
                      }
                      placeholder="Base location"
                    />
                  </td>
                  <td>
                    <input
                      value={team.contact}
                      onChange={(event) =>
                        updateTeam(team.id, { contact: event.target.value })
                      }
                      placeholder="Contact number"
                    />
                  </td>
                  <td>
                    <input
                      value={(team.members ?? []).join(", ")}
                      onChange={(event) =>
                        updateTeam(team.id, {
                          members: event.target.value
                            .split(",")
                            .map((member) => member.trim())
                            .filter(Boolean),
                        })
                      }
                      placeholder="Member names"
                    />
                  </td>
                  <td>
                    <button
                      className="icon-button"
                      aria-label={`Remove ${team.name}`}
                      onClick={() =>
                        onTeamsChange(
                          teams.filter((item) => item.id !== team.id),
                        )
                      }
                    >
                      <X size={16} />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="team-directory">
        <div className="group-header">
          <div>
            <h3>Weekly team locations</h3>
            <p>Assign each team to a different operating area for each week.</p>
          </div>
        </div>
        <div className="weekly-assignment-row">
          <select
            value={weekDraft.teamId}
            onChange={(event) =>
              setWeekDraft({ ...weekDraft, teamId: event.target.value })
            }
            aria-label="Team for weekly location"
          >
            <option value="">Select team</option>
            {teams.map((team) => (
              <option value={team.id} key={team.id}>
                {team.name}
              </option>
            ))}
          </select>
          <input
            type="datetime-local"
            value={weekDraft.startDate}
            onChange={(event) =>
              setWeekDraft({ ...weekDraft, startDate: event.target.value })
            }
            aria-label="Assignment date and time"
          />
          <select
            value={weekDraft.installationGroupId}
            onChange={(event) =>
              setWeekDraft({
                ...weekDraft,
                installationGroupId: event.target.value,
              })
            }
            aria-label="Assigned installation group"
          >
            <option value="">Select available group</option>
            {datedGroups.map((group) => (
              <option value={group.id} key={group.id}>
                {groupOptionLabel(group)}
              </option>
            ))}
          </select>
          <button
            className="button primary"
            onClick={addWeekAssignment}
            disabled={
              !weekDraft.teamId ||
              !weekDraft.startDate ||
              !weekDraft.installationGroupId
            }
          >
            Add weekly assignment
          </button>
        </div>
        {weekAssignments.length > 0 && (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Date &amp; time</th>
                  <th>Team</th>
                  <th>Role</th>
                  <th>Site supervisor</th>
                  <th>Assigned location</th>
                  <th>Members</th>
                  <th aria-label="Delete" />
                </tr>
              </thead>
              <tbody>
                {[...weekAssignments]
                  .sort((a, b) =>
                    (b.startDate || "").localeCompare(a.startDate || ""),
                  )
                  .map((assignment) => {
                    const team = teams.find(
                      (item) => item.id === assignment.teamId,
                    );
                    return (
                      <tr key={assignment.id}>
                        <td>{formatAssignmentStamp(assignment.startDate)}</td>
                        <td>{team?.name || "Team removed"}</td>
                        <td>
                          {team ? teamRoleLabel(team.role) : "Installation"}
                        </td>
                        <td>{team?.siteSupervisor || "Not assigned"}</td>
                        <td>
                          {groups.find(
                            (group) =>
                              group.id === assignment.installationGroupId,
                          )?.area || "Group not available"}
                        </td>
                        <td>
                          {(team?.members ?? []).join(", ") ||
                            "No members entered"}
                        </td>
                        <td>
                          <button
                            className="icon-button"
                            aria-label="Remove weekly assignment"
                            onClick={() =>
                              onWeekAssignmentsChange(
                                weekAssignments.filter(
                                  (item) => item.id !== assignment.id,
                                ),
                              )
                            }
                          >
                            <X size={16} />
                          </button>
                        </td>
                      </tr>
                    );
                  })}
              </tbody>
            </table>
          </div>
        )}
      </section>
      </div>}

      {groupsWorkspace === "schedule" && (
        <div className="standard-calendar">
          <div className="standard-calendar-header">
            <button
              className="icon-button"
              aria-label="Previous month"
              onClick={() =>
                setCalendarMonth(
                  new Date(calendarMonth.getFullYear(), calendarMonth.getMonth() - 1, 1),
                )
              }
            >
              ‹
            </button>
            <strong>{calendarTitle}</strong>
            <button
              className="icon-button"
              aria-label="Next month"
              onClick={() =>
                setCalendarMonth(
                  new Date(calendarMonth.getFullYear(), calendarMonth.getMonth() + 1, 1),
                )
              }
            >
              ›
            </button>
            <span className="standard-calendar-spacer" />
            <button
              type="button"
              className="button secondary"
              onClick={() => setShowFullCalendar((current) => !current)}
            >
              {showFullCalendar ? "View by week" : "View full month"}
            </button>
          </div>

          {showFullCalendar ? (
            <MonthCalendarGrid
              month={calendarMonth}
              jobs={jobs}
              groups={groups}
              deliveryRuns={deliveryRuns}
              weather={calendarWeather}
              onSelectDate={(key) => {
                setShowFullCalendar(false);
                onJumpToDate(key);
              }}
            />
          ) : (
            <>
              <div className="week-cards-row">
                {weekChunks.map((weekDates, weekIndex) => {
                  const weekGroups = groupsForWeek(weekDates);
                  const weekHoliday = weekDates
                    .map((date) => holidayForDate(dateKey(date)))
                    .find(Boolean);

                  if (weekGroups.length === 0) {
                    return (
                      <div className="week-placeholder" key={weekIndex}>
                        <span className="week-row-range">
                          Week of {formatWeekRange(weekDates)}
                        </span>
                        <span className="week-row-empty">
                          {weekHoliday
                            ? `Public holiday: ${weekHoliday}`
                            : "No group scheduled"}
                        </span>
                      </div>
                    );
                  }

                  return weekGroups.map((group) => (
                    <WeekGroupCard
                      key={group.id}
                      group={group}
                      weekDates={weekDates}
                      jobs={jobs}
                      jobById={jobById}
                      calendarWeather={calendarWeather}
                      deliveryRunsForGroup={deliveryRunsForGroup}
                      onOpenDrawer={() => setOpenGroupId(group.id)}
                      onOpenCalendar={() => setShowFullCalendar(true)}
                      onReassignTeam={onReassignTeam}
                      pinnedJobIds={pinnedJobIds}
                    />
                  ));
                })}
              </div>

              {unscheduledGroups.length > 0 && (
                <div className="standard-calendar-unscheduled">
                  <span className="standard-calendar-unscheduled-label">
                    Not yet scheduled:
                  </span>
                  {unscheduledGroups.map((group) => (
                    <button
                      key={group.id}
                      type="button"
                      className="standard-calendar-unscheduled-chip"
                      onClick={() => setOpenGroupId(group.id)}
                    >
                      {group.name || "Untitled group"}
                      {group.area ? ` · ${group.area}` : ""}
                    </button>
                  ))}
                </div>
              )}
            </>
          )}
        </div>
      )}

      {groupsWorkspace === "schedule" && openGroup && (
        <GroupDrawer
          group={openGroup}
          jobs={jobs}
          jobById={jobById}
          installationOptions={installationOptions}
          wiringOptions={wiringOptions}
          supervisorNames={supervisorNames}
          calendarWeather={calendarWeather}
          deliveryRunsForGroup={deliveryRunsForGroup}
          onUpdateGroup={updateGroup}
          onRemoveGroup={(id) =>
            onGroupsChange(groups.filter((item) => item.id !== id))
          }
          onClose={() => setOpenGroupId(null)}
          pinnedJobIds={pinnedJobIds}
          onTogglePin={onTogglePin}
        />
      )}
      </div>
    </>
  );
}

function WeekGroupCard({
  group,
  jobById,
  weekDates,
  jobs,
  calendarWeather,
  deliveryRunsForGroup,
  onOpenDrawer,
  onOpenCalendar,
  onReassignTeam,
  pinnedJobIds,
}: {
  group: InstallationGroup;
  weekDates: Date[];
  jobs: InstallationJob[];
  jobById: Map<string, InstallationJob>;
  calendarWeather: Record<string, { rainProbability: number; weatherCode: number }>;
  deliveryRunsForGroup: (groupId: string) => DeliveryRun[];
  onOpenDrawer: () => void;
  onOpenCalendar: () => void;
  onReassignTeam: () => void;
  pinnedJobIds: Set<string>;
}) {
  const staffing = groupStaffing(group);
  // Pinned customers lead the list; everyone else holds their existing order,
  // which Array.sort preserves. filter has already made a new array, so this
  // sorts a copy rather than the jobs prop.
  // Walks the group's own members rather than the whole customer list. A card
  // per group each scanning 8,000-odd jobs came to ~157ms every render, and a
  // render happens on every keystroke.
  const linkedJobs = group.jobIds
    .map((id) => jobById.get(id))
    .filter(
      (job): job is InstallationJob =>
        Boolean(job) && !isCompleteInstallation(job!, malaysiaToday(), group),
    )
    .sort(
      (a, b) => Number(pinnedJobIds.has(b.id)) - Number(pinnedJobIds.has(a.id)),
    );
  const runs = deliveryRunsForGroup(group.id);
  const weekHolidays = weekDates
    .map((date) => holidayForDate(dateKey(date)))
    .filter((holiday): holiday is string => Boolean(holiday));

  return (
    <div
      className="week-group-card"
      role="button"
      tabIndex={0}
      onClick={onOpenCalendar}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          onOpenCalendar();
        }
      }}
    >
      <span className="week-group-card-range">
        Week of {formatWeekRange(weekDates)}
      </span>
      <p className="week-group-card-name">{group.name}</p>
      <p className="week-group-card-area">{group.area || "Area not set"}</p>
      <span className={`week-group-card-status ${staffing}`}>
        {staffingLabel(staffing)}
      </span>
      {weekHolidays.length > 0 && (
        <span className="week-group-card-holiday">
          {weekHolidays.join(" · ")}
        </span>
      )}

      <div className="week-group-card-section">
        <h4>Team assignment</h4>
        <div className="week-group-card-row">
          <span>Installation team</span>
          <strong>{group.installationTeam || "Unassigned"}</strong>
        </div>
        <div className="week-group-card-row">
          <span>Wiring team</span>
          <strong>{group.wiringTeam || "Unassigned"}</strong>
        </div>
      </div>

      <div className="week-group-card-section">
        <h4>Customers this week</h4>
        <p className="week-group-card-count">{linkedJobs.length} customers</p>
        {linkedJobs.length > 0 && (
          <p className="week-group-card-preview">
            {linkedJobs
              .slice(0, 3)
              .map((job) => {
                const name = formatPersonName(job.customerName);
                return pinnedJobIds.has(job.id) ? `📌 ${name}` : name;
              })
              .join(", ")}
            {linkedJobs.length > 3 ? ` +${linkedJobs.length - 3} more` : ""}
          </p>
        )}
      </div>

      <div className="week-group-card-section">
        <h4>Delivery Schedule</h4>
        {runs.length === 0 ? (
          <p className="week-group-card-empty">No delivery run linked yet.</p>
        ) : (
          runs.map((run) => (
            <div className="week-group-card-delivery" key={run.id}>
              <div>
                <strong>{deliveryRunLabel(run)}</strong>
                <span>
                  {run.deliveryDate || "No date"} ·{" "}
                  {run.warehouse || "No warehouse"}
                </span>
              </div>
              <span className="week-group-card-delivery-status">
                {run.status.replace(/_/g, " ")}
              </span>
            </div>
          ))
        )}
      </div>

      <div className="week-group-card-section">
        <h4>Weather this week</h4>
        <div className="week-group-card-weather-strip">
          {weekDates.map((date) => {
            const key = dateKey(date);
            const weather = calendarWeather[key];
            return (
              <div key={key} title={weather ? undefined : NO_FORECAST_HINT}>
                <span>
                  {date.toLocaleDateString("en-MY", { weekday: "short" })}
                </span>
                <strong>
                  {weather ? (
                    <WeatherGlyph code={weather.weatherCode} />
                  ) : (
                    <CalendarOff size={14} className="weather-glyph none" />
                  )}
                </strong>
                <small>{weather ? `${weather.rainProbability}%` : "—"}</small>
              </div>
            );
          })}
        </div>
      </div>

      <div className="week-group-card-actions">
        <button
          className="button secondary"
          onClick={(event) => {
            event.stopPropagation();
            onOpenDrawer();
          }}
        >
          Edit group
        </button>
        <button
          className="button secondary"
          onClick={(event) => {
            event.stopPropagation();
            onReassignTeam();
          }}
        >
          Reassign team
        </button>
      </div>
    </div>
  );
}

function GroupDrawer({
  group,
  jobById,
  jobs,
  installationOptions,
  wiringOptions,
  supervisorNames,
  calendarWeather,
  deliveryRunsForGroup,
  onUpdateGroup,
  onRemoveGroup,
  onClose,
  pinnedJobIds,
  onTogglePin,
}: {
  group: InstallationGroup;
  jobs: InstallationJob[];
  jobById: Map<string, InstallationJob>;
  installationOptions: TeamResource[];
  wiringOptions: TeamResource[];
  supervisorNames: string[];
  calendarWeather: Record<string, { rainProbability: number; weatherCode: number }>;
  deliveryRunsForGroup: (groupId: string) => DeliveryRun[];
  onUpdateGroup: (id: string, update: Partial<InstallationGroup>) => void;
  onRemoveGroup: (id: string) => void;
  onClose: () => void;
  pinnedJobIds: Set<string>;
  onTogglePin: (id: string) => void;
}) {
  const staffing = groupStaffing(group);
  const runs = deliveryRunsForGroup(group.id);
  // Only one group is ever open in the drawer at a time, so this needs no
  // per-group key the way the schedule table's equivalent draft does.
  const [supervisorDraft, setSupervisorDraft] = useState("");
  function addSupervisor() {
    const trimmed = supervisorDraft.trim();
    if (!trimmed || group.supervisors.includes(trimmed)) return;
    onUpdateGroup(group.id, { supervisors: [...group.supervisors, trimmed] });
    setSupervisorDraft("");
  }
  // Pinned customers lead the list; everyone else holds their existing order,
  // which Array.sort preserves. filter has already made a new array, so this
  // sorts a copy rather than the jobs prop.
  // Walks the group's own members rather than the whole customer list. A card
  // per group each scanning 8,000-odd jobs came to ~157ms every render, and a
  // render happens on every keystroke.
  const linkedJobs = group.jobIds
    .map((id) => jobById.get(id))
    .filter(
      (job): job is InstallationJob =>
        Boolean(job) && !isCompleteInstallation(job!, malaysiaToday(), group),
    )
    .sort(
      (a, b) => Number(pinnedJobIds.has(b.id)) - Number(pinnedJobIds.has(a.id)),
    );

  const weatherDays: Date[] = [];
  if (group.installationDate) {
    const rangeEnd = group.installationEndDate || group.installationDate;
    const cursor = new Date(`${group.installationDate}T00:00:00`);
    const end = new Date(`${rangeEnd}T00:00:00`);
    while (cursor <= end && weatherDays.length < 14) {
      weatherDays.push(new Date(cursor));
      cursor.setDate(cursor.getDate() + 1);
    }
  }

  return (
    <div
      className="group-drawer-backdrop"
      role="presentation"
      onMouseDown={onClose}
    >
      <div
        className="group-drawer"
        role="dialog"
        aria-modal="true"
        aria-label={`${group.name || "Installation group"} details`}
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="group-drawer-header">
          <div className="group-drawer-title">
            <input
              value={group.name}
              onChange={(event) =>
                onUpdateGroup(group.id, { name: event.target.value })
              }
              aria-label="Group name"
              placeholder="Group name"
            />
            <input
              value={group.area}
              onChange={(event) =>
                onUpdateGroup(group.id, { area: event.target.value })
              }
              aria-label="Area"
              placeholder="Area"
            />
          </div>
          <button className="icon-button" aria-label="Close" onClick={onClose}>
            <X size={18} />
          </button>
        </div>
        <span className={`group-drawer-status ${staffing}`}>
          {staffingLabel(staffing)}
        </span>

        <div className="group-drawer-section">
          <h4>Schedule</h4>
          <div className="group-drawer-dates">
            <label>
              From
              <input
                type="date"
                value={group.installationDate || ""}
                onChange={(event) =>
                  onUpdateGroup(group.id, {
                    installationDate: event.target.value,
                  })
                }
              />
            </label>
            <label>
              Until
              <input
                type="date"
                min={group.installationDate || undefined}
                value={group.installationEndDate || ""}
                onChange={(event) =>
                  onUpdateGroup(group.id, {
                    installationEndDate: event.target.value,
                  })
                }
              />
            </label>
          </div>
        </div>

        <div className="group-drawer-section">
          <h4>Team assignment</h4>
          <label>
            Installation team
            <select
              value={group.installationTeam}
              onChange={(event) =>
                onUpdateGroup(group.id, {
                  installationTeam: event.target.value,
                })
              }
            >
              <option value="">Unassigned</option>
              {installationOptions.map((team) => (
                <option value={team.name} key={team.id}>
                  {team.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            Wiring team
            <select
              value={group.wiringTeam}
              onChange={(event) =>
                onUpdateGroup(group.id, { wiringTeam: event.target.value })
              }
            >
              <option value="">Unassigned</option>
              {wiringOptions.map((team) => (
                <option value={team.name} key={team.id}>
                  {team.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            Supervisor
            <div className="member-tag-input">
              <div className="member-tag-list">
                {group.supervisors.map((name) => (
                  <span className="member-tag" key={name}>
                    {name}
                    <button
                      type="button"
                      aria-label={`Remove ${name}`}
                      onClick={() =>
                        onUpdateGroup(group.id, {
                          supervisors: group.supervisors.filter(
                            (item) => item !== name,
                          ),
                        })
                      }
                    >
                      <X size={12} />
                    </button>
                  </span>
                ))}
              </div>
              <div className="member-tag-add">
                <input
                  list="supervisor-options"
                  value={supervisorDraft}
                  onChange={(event) => setSupervisorDraft(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") {
                      event.preventDefault();
                      addSupervisor();
                    }
                  }}
                  placeholder="Add supervisor"
                  aria-label="Add site supervisor"
                />
                <button
                  type="button"
                  className="icon-button"
                  aria-label="Add site supervisor"
                  onClick={addSupervisor}
                >
                  <Plus size={14} />
                </button>
              </div>
            </div>
          </label>
        </div>

        <div className="group-drawer-section">
          <h4>Customers ({linkedJobs.length})</h4>
          {linkedJobs.length === 0 ? (
            <p className="group-drawer-empty">No customers linked yet.</p>
          ) : (
            <ul className="group-drawer-customer-list">
              {linkedJobs.map((job) => {
                const isPinned = pinnedJobIds.has(job.id);
                return (
                  <li key={job.id} style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                    <button
                      type="button"
                      className={`icon-button pin-toggle ${isPinned ? "is-pinned" : ""}`}
                      aria-label={isPinned ? "Unpin row" : "Pin row to top"}
                      aria-pressed={isPinned}
                      onClick={(event) => {
                        event.stopPropagation();
                        onTogglePin(job.id);
                      }}
                    >
                      {isPinned ? <Pin size={14} /> : <PinOff size={14} />}
                    </button>
                    <span>{formatPersonName(job.customerName)}</span>
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        <div className="group-drawer-section">
          <h4>Delivery Schedule</h4>
          {runs.length === 0 ? (
            <p className="group-drawer-empty">No delivery run linked yet.</p>
          ) : (
            runs.map((run) => (
              <div className="group-drawer-row" key={run.id}>
                <span>{deliveryRunLabel(run)}</span>
                <span>
                  {run.deliveryDate || "No date"} ·{" "}
                  {run.warehouse || "No warehouse"}
                </span>
              </div>
            ))
          )}
        </div>

        {weatherDays.length > 0 && (
          <div className="group-drawer-section">
            <h4>Weather</h4>
            <div className="group-drawer-weather-strip">
              {weatherDays.map((date) => {
                const key = dateKey(date);
                const weather = calendarWeather[key];
                return (
                  <div key={key}>
                    <span>
                      {date.toLocaleDateString("en-MY", { weekday: "short" })}
                    </span>
                    <strong>
                      {weather ? `${weather.rainProbability}%` : "—"}
                    </strong>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        <div className="group-drawer-actions">
          <button
            className="button secondary"
            onClick={() => {
              onRemoveGroup(group.id);
              onClose();
            }}
          >
            Remove group
          </button>
        </div>
      </div>
    </div>
  );
}

function TeamPlanningView({
  groups,
  weekAssignments,
  deliveryRuns,
  jobs,
  planningFilter,
  onPlanningFilterChange,
  postcodeFilter,
  onPostcodeFilterChange,
  secondPaymentMonthFilter,
  onSecondPaymentMonthFilterChange,
  customerNameFilter,
  onCustomerNameFilterChange,
  workCategoryFilter,
  onWorkCategoryFilterChange,
  onUpdateJob,
  manuallyPinnedJobIds,
  onTogglePin,
  availableTeams,
  saving,
}: {
  groups: InstallationGroup[];
  weekAssignments: TeamWeekAssignment[];
  deliveryRuns: DeliveryRun[];
  jobs: InstallationJob[];
  planningFilter: string;
  onPlanningFilterChange: (next: string) => void;
  postcodeFilter: string;
  onPostcodeFilterChange: (next: string) => void;
  secondPaymentMonthFilter: string;
  onSecondPaymentMonthFilterChange: (next: string) => void;
  customerNameFilter: string;
  onCustomerNameFilterChange: (next: string) => void;
  workCategoryFilter: string;
  onWorkCategoryFilterChange: (next: string) => void;
  onUpdateJob: (job: InstallationJob) => void;
  manuallyPinnedJobIds: Set<string>;
  onTogglePin: (id: string) => void;
  availableTeams: TeamResource[];
  saving: boolean;
}) {
  // Every customer by id. The rows here look customers up constantly — once
  // per suggestion member and again per rendered row — and each of those was a
  // scan of the whole customer list.
  const jobById = useMemo(
    () => new Map(jobs.map((job) => [job.id, job])),
    [jobs],
  );
  const [rangeKm, setRangeKm] = useState(20);
  // The Installation record, opened from a customer's name once their row is
  // being edited. Held as an id rather than the job itself so an edit made
  // behind the popup shows through instead of the popup going stale.
  const [recordJobId, setRecordJobId] = useState<string | null>(null);
  const [recordSldOpen, setRecordSldOpen] = useState(false);
  useEscapeKey(recordJobId !== null, () => {
    if (recordSldOpen) {
      setRecordSldOpen(false);
      return;
    }
    setRecordJobId(null);
  });
  // Which group's "add customer" control is open. A group id rather than a
  // snapshot of its customers — the row itself already renders live from
  // `suggestions`, so there is nothing left to hold a copy of.
  const [addingToSuggestionId, setAddingToSuggestionId] = useState<
    string | null
  >(null);
  const [addCustomerId, setAddCustomerId] = useState("");
  const [customerSearch, setCustomerSearch] = useState("");
  useEscapeKey(addingToSuggestionId !== null, () => {
    setAddingToSuggestionId(null);
    setAddCustomerId("");
    setCustomerSearch("");
  });
  const [mapFocusGroupId, setMapFocusGroupId] = useState<string | null>(null);
  // The map stays out of the way until someone clicks a customer's address,
  // then opens zoomed to that customer. Null means the map is hidden.
  const [mapJobId, setMapJobId] = useState<string | null>(null);
  // Customer rows start read-only; clicking one focuses it on the map (as it
  // always has) and opens just that customer's editable fields.
  const [editingJobIds, setEditingJobIds] = useState<Set<string>>(new Set());

  function toggleJobEdit(jobId: string) {
    setEditingJobIds((previous) => {
      const next = new Set(previous);
      if (next.has(jobId)) {
        next.delete(jobId);
      } else {
        next.add(jobId);
      }
      return next;
    });
  }

  const [highlightedMapGroupId, setHighlightedMapGroupId] = useState<
    string | null
  >(null);
  const [highlightedMapCustomerId, setHighlightedMapCustomerId] = useState<
    string | null
  >(null);
  const [suggestionOverrides, setSuggestionOverrides] = useState<
    Record<string, string[]>
  >({});
  // Which installation group a customer already sits in, if any. Assigning no
  // longer removes them from this page — being grouped is shown as a state on
  // the row instead, so their availability and dates stay editable.
  const groupByJobId = useMemo(
    () => latestByJobId(groups, (group) => group.installationDate),
    [groups],
  );

  const planningLookup = useMemo(() => {
    const deliveryRunByJobId = latestByJobId(
      deliveryRuns,
      (run) => run.deliveryDate,
    );
    return { groupByJobId, deliveryRunByJobId };
  }, [groupByJobId, deliveryRuns]);

  // The same predicate the Customer details page runs, so "Need Attention"
  // there and here can never disagree about which jobs qualify.
  const planningTodayIso = malaysiaToday();

  function matchesPlanningStatus(job: InstallationJob) {
    return matchesPipelineStage(
      job,
      planningFilter,
      planningTodayIso,
      planningLookup,
    );
  }

  // The same search the cards above this table count through, so the number on
  // a card and the rows under it can never describe different months.
  function matchesSecondPaymentMonth(job: InstallationJob) {
    return matchesSecondPaymentSearch(job, secondPaymentMonthFilter);
  }

  // The table itself still leads with work still to be planned — a finished
  // install is hidden from an earlier stage's own list (Deposit, Ready to
  // Install, Pending Complete, Need Attention), so picking one of those does
  // not fill up with history. All jobs is meant to be the union of every
  // stage, Complete Installation included, so it has to see them too.
  const showingCompleted =
    planningFilter === "complete" || planningFilter === "arranged" || planningFilter === ALL_JOBS;
  const readyJobs = jobs.filter(
    (job) =>
      belongsInPlanning(job, groupByJobId.get(job.id), planningLookup) &&
      (showingCompleted ||
        !isHiddenAsCompleted(
          job,
          planningTodayIso,
          groupByJobId.get(job.id),
        )) &&
      matchesSecondPaymentMonth(job) &&
      matchesPlanningStatus(job) &&
      matchesWorkCategory(job, workCategoryFilter),
  );
  // Every customer the table is allowed to show. The location groups filter
  // their members through this, so it has to admit finished installs on the
  // same terms readyJobs does — otherwise selecting Complete Installation
  // fills the stage card with a number but empties the list under it.
  const filteredPlanningJobIds = new Set(
    jobs
      .filter(
        (job) =>
          belongsInPlanning(job, groupByJobId.get(job.id), planningLookup) &&
          matchesPlanningStatus(job) &&
          (showingCompleted ||
            !isHiddenAsCompleted(
              job,
              planningTodayIso,
              groupByJobId.get(job.id),
            )) &&
          matchesSecondPaymentMonth(job) &&
          matchesWorkCategory(job, workCategoryFilter),
      )
      .map((job) => job.id),
  );
  useEffect(() => {
    try {
      const saved = JSON.parse(
        window.localStorage.getItem(TEAM_SUGGESTIONS_STORAGE_KEY) || "{}",
      ) as Record<string, string[]>;
      const customerOwner = new Map<string, string>();
      Object.entries(saved).forEach(([suggestionId, jobIds]) => {
        jobIds.forEach((jobId) => customerOwner.set(jobId, suggestionId));
      });
      const cleaned = Object.fromEntries(
        Object.entries(saved).map(([suggestionId, jobIds]) => [
          suggestionId,
          jobIds.filter((jobId) => customerOwner.get(jobId) === suggestionId),
        ]),
      );
      setSuggestionOverrides(cleaned);
      window.localStorage.setItem(
        TEAM_SUGGESTIONS_STORAGE_KEY,
        JSON.stringify(cleaned),
      );
    } catch {
      setSuggestionOverrides({});
    }
  }, []);

  const baseSuggestions = useMemo(
    () => buildLocationSuggestions(readyJobs, jobs),
    [readyJobs, jobs],
  );

  const suggestions = useMemo(() => {
    const claimedBySuggestion = new Map<string, string>();
    Object.entries(suggestionOverrides).forEach(([suggestionId, jobIds]) => {
      jobIds.forEach((jobId) =>
        claimedBySuggestion.set(jobId, suggestionId),
      );
    });

    return baseSuggestions
      .map((suggestion) => {
        const customerIds =
          suggestionOverrides[suggestion.id] ??
          suggestion.customers
            .filter(
              (customer) =>
                !claimedBySuggestion.has(customer.id) ||
                claimedBySuggestion.get(customer.id) === suggestion.id,
            )
            .map((customer) => customer.id);

        return {
          ...suggestion,
          customers: customerIds
            .map((jobId) => jobById.get(jobId))
            .filter(
              (job): job is InstallationJob =>
                Boolean(job) && filteredPlanningJobIds.has(job!.id),
            )
            // Re-sort after the override/claim filtering above, which can drop
            // customers and reorder a saved draft's ids out of date order.
            .sort(compareBySecondPayment)
            .slice(0, 5),
        };
      })
      .filter((suggestion) => suggestion.customers.length > 0)
      .sort(compareGroupsBySecondPayment);
  }, [baseSuggestions, jobs, planningFilter, suggestionOverrides]);

  // The stage filter is applied to the jobs themselves now, so there is no
  // second pass to make here — approved under-59% cases reach the list through
  // hasPlanningEligibility and appear under Deposit like any other paid job.
  const displayedSuggestions = suggestions;

  const filteredSuggestions = useMemo(() => {
    const postcodeSearch = postcodeFilter.trim().toLowerCase();
    const nameSearch = customerNameFilter.trim().toLowerCase();
    return displayedSuggestions
      .filter(
        (suggestion) =>
          !postcodeSearch ||
          suggestion.postcode.toLowerCase().includes(postcodeSearch),
      )
      .map((suggestion) => ({
        ...suggestion,
        // A town group is up to five customers. Searching for one name used
        // to keep the whole group if any member matched, so "Burhanuddin"
        // listed the other four people who only share a postcode. Narrow to
        // the matching customers; empty groups drop out below.
        customers: nameSearch
          ? suggestion.customers.filter((customer) =>
              jobMatchesSearch(customer, nameSearch),
            )
          : suggestion.customers,
      }))
      .filter((suggestion) => suggestion.customers.length > 0);
  }, [displayedSuggestions, postcodeFilter, customerNameFilter]);

  // Available and Pending customers pin to the top of the table, ahead of
  // every location group, so the people who confirmed (or nearly confirmed)
  // their availability are never buried below customers nobody has reached
  // yet. Propose leads Pending Complete within the pinned block; each customer
  // keeps a reference to its original suggestion so the map focus and "which
  // town is this" context still work once it's pulled out of its group.
  // Rank decides both which customers pin and the order they pin in: already
  // in an installation group first (they are the committed work and must stay
  // reachable for rescheduling), then Propose, then Pending Complete. Everyone else
  // stays down in their town group.
  function pinRank(job: InstallationJob) {
    // A pin the user placed themselves outranks every automatic reason, and
    // pins a customer who would not otherwise qualify at all. The button has
    // always said "Pin row to top"; until now it only lit up.
    if (manuallyPinnedJobIds.has(job.id)) return -1;
    if (groupByJobId.has(job.id)) return 0;
    if (job.customerAvailabilityStatus === "propose") return 1;
    if (job.customerAvailabilityStatus === "pending_complete") return 2;
    return null;
  }

  const pinnedEntries = useMemo(() => {
    const entries: {
      job: InstallationJob;
      suggestion: (typeof filteredSuggestions)[number];
      rank: number;
      group: InstallationGroup | null;
    }[] = [];
    filteredSuggestions.forEach((suggestion) => {
      suggestion.customers.forEach((job) => {
        const rank = pinRank(job);
        if (rank === null) return;
        entries.push({
          job,
          suggestion,
          rank,
          group: groupByJobId.get(job.id) ?? null,
        });
      });
    });
    return entries.sort(
      (a, b) => a.rank - b.rank || compareBySecondPayment(a.job, b.job),
    );
  }, [filteredSuggestions, groupByJobId, manuallyPinnedJobIds]);

  const pinnedJobIds = useMemo(
    () => new Set(pinnedEntries.map((entry) => entry.job.id)),
    [pinnedEntries],
  );

  // The grouped section below keeps rendering exactly as before, just with
  // the pinned customers removed from their groups (and any group that pins
  // away entirely dropped) so nobody appears twice.
  const unpinnedSuggestions = useMemo(
    () =>
      filteredSuggestions
        .map((suggestion) => ({
          ...suggestion,
          customers: suggestion.customers.filter(
            (job) => !pinnedJobIds.has(job.id),
          ),
        }))
        .filter((suggestion) => suggestion.customers.length > 0),
    [filteredSuggestions, pinnedJobIds],
  );

  const planningMapGroups = useMemo(
    () =>
      filteredSuggestions.map((suggestion) => ({
        id: suggestion.id,
        town: suggestion.area,
        postcode: suggestion.postcode,
        state: suggestion.state,
        customers: suggestion.customers.map((job) => ({
          id: job.id,
          name: job.customerName,
          address: job.address,
          paymentPercent: job.paymentPercent,
        })),
      })),
    [filteredSuggestions],
  );

  const customerSearchText = customerSearch.trim().toLowerCase();

  // Computed only for whichever single group currently has its add-customer
  // control open, not for all of them — with 300+ groups on screen, building
  // this list for every row would mean filtering the whole job list that many
  // times over for options nobody is looking at.
  function addableCustomersFor(suggestion: { customers: InstallationJob[] }) {
    const memberIds = new Set(suggestion.customers.map((customer) => customer.id));
    return jobs
      .filter(
        (job) =>
          !memberIds.has(job.id) &&
          // Reschedule, cancel, or pending overrides both exclusions below:
          // a customer marked Cancelled but still being chased is not truly
          // out of planning, and a stale past date that was never cleared
          // when the customer rescheduled is not truly a finished install.
          (!isHiddenAsCompleted(
            job,
            planningTodayIso,
            groupByJobId.get(job.id),
          )) &&
          hasPlanningEligibility(job) &&
          matchesPlanningStatus(job) &&
          (!customerSearchText ||
            [
              job.customerName,
              job.invoiceNumber,
              job.customerPhone,
              job.address,
            ]
              .join(" ")
              .toLowerCase()
              .includes(customerSearchText)),
      )
      .sort((a, b) => a.customerName.localeCompare(b.customerName));
  }

  // Commits immediately — there is no separate save step now that the group
  // renders live from `suggestions` rather than a snapshot taken on open.
  function addCustomerToGroup(suggestion: { id: string; customers: InstallationJob[] }) {
    const members =
      displayedSuggestions.find((item) => item.id === suggestion.id)?.customers ??
      suggestion.customers;
    if (!addCustomerId || members.length >= 5) return;
    saveSuggestionDraft(suggestion.id, [
      ...members.map((customer) => customer.id),
      addCustomerId,
    ]);
    setAddCustomerId("");
    setCustomerSearch("");
    setAddingToSuggestionId(null);
  }

  function saveSuggestionDraft(suggestionId: string, jobIds: string[]) {
    setSuggestionOverrides((current) => {
      const selectedCustomers = new Set(jobIds);
      const next = Object.fromEntries(
        Object.entries(current).map(([currentId, currentJobIds]) => [
          currentId,
          currentId === suggestionId
            ? currentJobIds
            : currentJobIds.filter(
                (jobId) => !selectedCustomers.has(jobId),
              ),
        ]),
      );
      next[suggestionId] = jobIds;
      window.localStorage.setItem(
        TEAM_SUGGESTIONS_STORAGE_KEY,
        JSON.stringify(next),
      );
      return next;
    });
  }

  function clearSuggestionDraft(suggestionId: string) {
    setSuggestionOverrides((current) => {
      const next = { ...current };
      delete next[suggestionId];
      window.localStorage.setItem(
        TEAM_SUGGESTIONS_STORAGE_KEY,
        JSON.stringify(next),
      );
      return next;
    });
  }

  // Columns 2 through 8 (Customer through Availability remarks), shared by
  // both the pinned rows and the grouped rows below them so the two blocks
  // never drift apart.
  function renderCustomerCells(job: InstallationJob, isEditing: boolean) {
    return (
      <>
        <td>
          {/* Read-only, the name is just a label — the row's own click is what
              opens the customer for editing. Once it is open the name becomes
              the way into the full Installation record, the same one Customer
              details shows. stopPropagation keeps that click off the row,
              which would otherwise close the editor underneath the popup. */}
          <span
            className="customer-name-hover-target"
            onMouseEnter={() => setHighlightedMapCustomerId(job.id)}
          >
            {isEditing ? (
              <button
                type="button"
                className="customer-name-link"
                title={`Open the installation record for ${formatPersonName(
                  job.customerName,
                )}`}
                onClick={(event) => {
                  event.stopPropagation();
                  setRecordJobId(job.id);
                  setRecordSldOpen(false);
                }}
              >
                <strong>{formatPersonName(job.customerName)}</strong>
              </button>
            ) : (
              <strong>{formatPersonName(job.customerName)}</strong>
            )}
          </span>
          {phoneWhatsAppHref(job.customerPhone) ? (
            <a
              className="phone-number"
              href={phoneWhatsAppHref(job.customerPhone)!}
              target="_blank"
              rel="noopener noreferrer"
              onClick={(event) => event.stopPropagation()}
              title={`WhatsApp ${formatPersonName(job.customerName)}`}
            >
              <MessageCircle size={13} />
              {formatPhoneNumber(job.customerPhone)}
            </a>
          ) : (
            <span className="phone-number">
              <Phone size={13} />
              {formatPhoneNumber(job.customerPhone)}
            </span>
          )}
          {!hasReachedPaymentPercent(
            job.paymentPercent,
            APPROVAL_PAYMENT_PERCENT,
          ) && (
            <span className="special-case-label">
              Special case · Management approval required
            </span>
          )}
        </td>
        <td className="suggestion-address-cell">
          {job.address ? (
            <button
              type="button"
              className={`address-map-link${mapJobId === job.id ? " is-active" : ""}`}
              title={
                mapJobId === job.id
                  ? "Hide the map"
                  : `Show ${formatPersonName(job.customerName)} on the map`
              }
              onClick={(event) => {
                // Kept off the row, whose own click opens the editor.
                event.stopPropagation();
                setMapJobId((current) => (current === job.id ? null : job.id));
              }}
            >
              <MapPin size={13} />
              {formatCustomerAddress(job.address)}
            </button>
          ) : (
            "Address not available"
          )}
        </td>
        <td>{job.paymentPercent.toFixed(0)}%</td>
        <td>
          {job.secondPaymentDate
            ? DATE_KL.format(new Date(job.secondPaymentDate))
            : "Not recorded"}
        </td>
        <td>
          {isEditing ? (
            <select
              value={job.customerAvailabilityStatus}
              onClick={(event) => event.stopPropagation()}
              aria-label={`Status for ${job.customerName}`}
              onChange={(event) => {
                const status = event.target
                  .value as CustomerAvailabilityStatus;
                onUpdateJob({
                  ...job,
                  customerAvailabilityStatus: status,
                });
              }}
            >
              {Object.entries(availabilityLabels).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          ) : (
            <span className="run-field-readout">
              {availabilityLabels[job.customerAvailabilityStatus]}
            </span>
          )}
        </td>
        <td>
          {/* A rescheduling customer keeps the date that fell through and
              gains a second one for the replacement, so the move stays
              legible. Every other
              status has the one date, and the second input is not even
              rendered — there is nothing to reschedule from. */}
          {isEditing ? (
            <div className="preferred-date-pair">
              <input
                type="date"
                value={job.preferredInstallationDate ?? ""}
                onClick={(event) => event.stopPropagation()}
                aria-label={`Preferred installation date for ${job.customerName}`}
                onChange={(event) =>
                  onUpdateJob({
                    ...job,
                    preferredInstallationDate: event.target.value || null,
                  })
                }
              />
              {awaitsNewDate(job) && (
                <label className="preferred-date-second">
                  <span>New date</span>
                  <input
                    type="date"
                    value={job.secondPreferredInstallationDate ?? ""}
                    onClick={(event) => event.stopPropagation()}
                    aria-label={`New installation date for ${job.customerName}`}
                    onChange={(event) =>
                      onUpdateJob({
                        ...job,
                        secondPreferredInstallationDate:
                          event.target.value || null,
                      })
                    }
                  />
                </label>
              )}
            </div>
          ) : (
            <span className="run-field-readout">
              {formatDateOnly(job.preferredInstallationDate)}
              {/* The date once it exists, for either status. The "needed"
                  prompt is only for a Reschedule, matching the amber marker:
                  a Pending Complete has the field to fill in but is not being
                  chased for it. */}
              {awaitsNewDate(job) &&
                (job.secondPreferredInstallationDate ? (
                  <span className="preferred-date-readout-second">
                    {`→ ${formatDateOnly(job.secondPreferredInstallationDate)}`}
                  </span>
                ) : needsNewDate(job) ? (
                  <span className="preferred-date-readout-second">
                    → new date needed
                  </span>
                ) : null)}
            </span>
          )}
        </td>
        <td>
          {isEditing ? (
            // Uncontrolled + onBlur, as before. Collapsing the row is driven by
            // a click, and blur fires ahead of click, so whatever was typed is
            // saved before this input unmounts.
            <input
              defaultValue={job.availabilityRemarks}
              placeholder="Customer availability notes"
              onClick={(event) => event.stopPropagation()}
              aria-label={`Availability remarks for ${job.customerName}`}
              onBlur={(event) =>
                onUpdateJob({
                  ...job,
                  availabilityRemarks: event.target.value,
                })
              }
            />
          ) : (
            <span className="run-field-readout">
              {job.availabilityRemarks || "No remarks"}
            </span>
          )}
        </td>
      </>
    );
  }

  const recordSource = recordJobId
    ? jobs.find((job) => job.id === recordJobId) ?? null
    : null;
  const recordGroup = recordSource
    ? groupByJobId.get(recordSource.id)
    : undefined;
  const recordJob = recordSource
    ? recordJobFor(
        recordSource,
        recordGroup,
        planningLookup.deliveryRunByJobId.get(recordSource.id),
        groups,
      )
    : null;
  const recordGroupLabel = recordGroup
    ? [recordGroup.name, recordGroup.area].filter(Boolean).join(" · ")
    : "Not grouped";

  return (
    <div className="planning-panel team-planning-panel">
      <div className="planning-heading">
        <div>
          <h2>Customer Scheduling</h2>
          <p>Find ready customers and suggest location groups for team planning.</p>
        </div>
        <div className="planning-filters">
          <label className="range-control">
            Job type
            <WorkCategorySelect
              value={workCategoryFilter}
              onChange={onWorkCategoryFilterChange}
            />
          </label>
          <label className="range-control">
            Customer, invoice or address
            <input
              type="search"
              className="customer-invoice-search"
              placeholder="e.g. Tan Wei Ming, INV-1009919, Ayer Keroh"
              value={customerNameFilter}
              onChange={(event) => {
                onCustomerNameFilterChange(event.target.value);
                setAddingToSuggestionId(null);
                setMapFocusGroupId(null);
                setHighlightedMapGroupId(null);
                setHighlightedMapCustomerId(null);
              }}
            />
          </label>
          <label className="range-control">
            Planning status
            <select
              value={planningFilter}
              onChange={(event) => {
                onPlanningFilterChange(event.target.value);
                setAddingToSuggestionId(null);
                setMapFocusGroupId(null);
                setHighlightedMapGroupId(null);
                setHighlightedMapCustomerId(null);
                setAddCustomerId("");
                setCustomerSearch("");
              }}
            >
              <option value={ALL_JOBS}>All jobs</option>
              {PLANNING_STAGES.map((stage) => (
                <option key={stage.value} value={stage.value}>
                  {stage.label}
                </option>
              ))}
            </select>
          </label>
          <label className="range-control">
            Postcode
            <input
              type="search"
              inputMode="numeric"
              placeholder="e.g. 81100"
              value={postcodeFilter}
              onChange={(event) => {
                onPostcodeFilterChange(event.target.value);
                setAddingToSuggestionId(null);
                setMapFocusGroupId(null);
                setHighlightedMapGroupId(null);
                setHighlightedMapCustomerId(null);
              }}
            />
          </label>
          <label className="range-control">
            2nd payment
            <input
              type="search"
              className="second-payment-search"
              placeholder="August, 2026, August 2026…"
              value={secondPaymentMonthFilter}
              onChange={(event) => {
                onSecondPaymentMonthFilterChange(event.target.value);
                setAddingToSuggestionId(null);
                setMapFocusGroupId(null);
                setHighlightedMapGroupId(null);
                setHighlightedMapCustomerId(null);
              }}
            />
          </label>
          {secondPaymentMonthFilter && (
            <button
              type="button"
              className="button"
              onClick={() => {
                onSecondPaymentMonthFilterChange("");
                setAddingToSuggestionId(null);
                setMapFocusGroupId(null);
                setHighlightedMapGroupId(null);
                setHighlightedMapCustomerId(null);
              }}
            >
              Clear month
            </button>
          )}
          <label className="range-control">
            Approximate planning range
            <select
              value={rangeKm}
              onChange={(event) => setRangeKm(Number(event.target.value))}
            >
              <option value={10}>10 km</option>
              <option value={20}>20 km</option>
              <option value={30}>30 km</option>
              <option value={50}>50 km</option>
            </select>
          </label>
        </div>
      </div>
      <div className="planning-note">
        Suggestions group customers by town, postcode, and state. The stored
        postcode is used first; when it is missing, the postcode is extracted
        from the customer address. Each suggestion contains no more than five
        customers.
      </div>
      {filteredSuggestions.length === 0 ? (
        <div className="empty-state">
          <MapPin />
          <p>No customers match the selected planning filters.</p>
        </div>
      ) : (
        <div
          className={`team-planning-workspace${mapJobId ? "" : " map-hidden"}`}
        >
          {mapJobId && (
            <PlanningMap
              focusGroupId={mapFocusGroupId}
              highlightedGroupId={highlightedMapGroupId}
              highlightedCustomerId={highlightedMapCustomerId ?? mapJobId}
              groups={planningMapGroups}
              onClose={() => setMapJobId(null)}
            />
          )}
          <div className="table-wrap team-planning-table">
            <table>
            <thead>
              <tr>
                <th>Town</th>
                <th>Customer</th>
                <th>Address</th>
                <th>Payment</th>
                <th>2nd payment date</th>
                <th>Status</th>
                <th>Preferred installation date</th>
                <th>Availability remarks</th>
                <th aria-label="Pin" />
              </tr>
            </thead>
            <tbody>
              {pinnedEntries.map(({ job: snapshotJob, suggestion, group }) => {
                // Same live-lookup as the grouped rows below: an edit made
                // elsewhere on the page may not have flowed through the
                // suggestion memo yet.
                const job = jobById.get(snapshotJob.id) || snapshotJob;
                return (
                  <tr
                    key={job.id}
                    className={`team-planning-pinned-row ${
                      group
                        ? "status-grouped"
                        : `status-${job.customerAvailabilityStatus}`
                    }${needsNewDate(job) ? " needs-reschedule-date" : ""}`}
                    onMouseEnter={() => {
                      setHighlightedMapGroupId(suggestion.id);
                      setHighlightedMapCustomerId(job.id);
                    }}
                    onMouseLeave={() => {
                      setHighlightedMapGroupId(null);
                      setHighlightedMapCustomerId(null);
                    }}
                    onClick={() => {
                      setMapFocusGroupId(suggestion.id);
                      toggleJobEdit(job.id);
                    }}
                  >
                    <td className="team-planning-group-cell">
                      <strong>{formatPersonName(suggestion.area)}</strong>
                      <span>
                        {suggestion.postcode || "Postcode unavailable"}
                        {suggestion.state ? ` · ${suggestion.state}` : ""}
                      </span>
                      {group && (
                        <span className="assigned-group-badge">
                          Assigned · {group.name || "Installation group"}
                        </span>
                      )}
                    </td>
                    {renderCustomerCells(job, editingJobIds.has(job.id))}
                    <td className="pin-cell" onClick={(event) => event.stopPropagation()}>
                      <button
                        type="button"
                        className={`icon-button pin-toggle ${manuallyPinnedJobIds.has(job.id) ? "is-pinned" : ""}`}
                        aria-label={manuallyPinnedJobIds.has(job.id) ? "Unpin row" : "Pin row to top"}
                        aria-pressed={manuallyPinnedJobIds.has(job.id)}
                        onClick={(event) => {
                          event.stopPropagation();
                          onTogglePin(job.id);
                        }}
                      >
                        {manuallyPinnedJobIds.has(job.id) ? <Pin size={14} /> : <PinOff size={14} />}
                      </button>
                    </td>
                  </tr>
                );
              })}
              {unpinnedSuggestions.flatMap((suggestion) => {
                const fullGroupSize =
                  displayedSuggestions.find((item) => item.id === suggestion.id)
                    ?.customers.length ?? suggestion.customers.length;
                const canAddMore =
                  !customerNameFilter.trim() && fullGroupSize < 5;
                const addingHere = addingToSuggestionId === suggestion.id;
                return suggestion.customers.map((snapshotJob, index) => {
                  // `suggestion.customers` already comes from the live `jobs`
                  // array (there is no snapshot to go stale here), but a job
                  // just edited elsewhere on the page may not have flowed
                  // through the suggestion memo yet — look it up fresh so an
                  // edit never appears to revert for a render or two.
                  const job =
                    jobById.get(snapshotJob.id) || snapshotJob;
                  return (
                    <tr
                      key={job.id}
                      className={
                        needsNewDate(job) ? "needs-reschedule-date" : undefined
                      }
                      onMouseEnter={() => {
                        setHighlightedMapGroupId(suggestion.id);
                        setHighlightedMapCustomerId(job.id);
                      }}
                      onMouseLeave={() => {
                        setHighlightedMapGroupId(null);
                        setHighlightedMapCustomerId(null);
                      }}
                      onClick={() => {
                        setMapFocusGroupId(suggestion.id);
                        toggleJobEdit(job.id);
                      }}
                    >
                      {index === 0 && (
                        <td
                          rowSpan={suggestion.customers.length}
                          className="team-planning-group-cell"
                        >
                          <strong>{formatPersonName(suggestion.area)}</strong>
                          <span>
                            {suggestion.postcode || "Postcode unavailable"}
                            {suggestion.state ? ` · ${suggestion.state}` : ""}
                          </span>
                          <span>
                            {suggestionOverrides[suggestion.id]
                              ? "Saved customer draft"
                              : "Suggested group"}
                          </span>
                          {canAddMore &&
                            (addingHere ? (
                              <div
                                className="team-planning-add-customer"
                                onClick={(event) => event.stopPropagation()}
                              >
                                <input
                                  type="search"
                                  autoFocus
                                  placeholder="Name, invoice, phone or address"
                                  value={customerSearch}
                                  onChange={(event) => {
                                    setCustomerSearch(event.target.value);
                                    setAddCustomerId("");
                                  }}
                                />
                                <select
                                  value={addCustomerId}
                                  onChange={(event) =>
                                    setAddCustomerId(event.target.value)
                                  }
                                >
                                  <option value="">
                                    {(() => {
                                      const count =
                                        addableCustomersFor(suggestion).length;
                                      return count > 0
                                        ? `Select from ${count} customer${
                                            count === 1 ? "" : "s"
                                          }`
                                        : "No matching customers";
                                    })()}
                                  </option>
                                  {addableCustomersFor(suggestion).map(
                                    (customer) => (
                                      <option value={customer.id} key={customer.id}>
                                        {formatPersonName(customer.customerName)}{" "}
                                        · {customer.paymentPercent.toFixed(0)}%
                                        {hasReachedPaymentPercent(
                                          customer.paymentPercent,
                                          APPROVAL_PAYMENT_PERCENT,
                                        )
                                          ? ""
                                          : " · Special case"}
                                      </option>
                                    ),
                                  )}
                                </select>
                                <div className="team-planning-add-customer-actions">
                                  <button
                                    type="button"
                                    className="button primary"
                                    disabled={!addCustomerId}
                                    onClick={() => addCustomerToGroup(suggestion)}
                                  >
                                    Add
                                  </button>
                                  <button
                                    type="button"
                                    className="icon-button"
                                    aria-label="Cancel adding a customer"
                                    onClick={() => {
                                      setAddingToSuggestionId(null);
                                      setAddCustomerId("");
                                      setCustomerSearch("");
                                    }}
                                  >
                                    <X size={15} />
                                  </button>
                                </div>
                              </div>
                            ) : (
                              <button
                                type="button"
                                className="button secondary team-planning-add-customer-toggle"
                                onClick={(event) => {
                                  event.stopPropagation();
                                  setAddingToSuggestionId(suggestion.id);
                                }}
                              >
                                <Plus size={14} />
                                Add customer
                              </button>
                            ))}
                        </td>
                      )}
                      {renderCustomerCells(job, editingJobIds.has(job.id))}
                      <td className="pin-cell" onClick={(event) => event.stopPropagation()}>
                        <button
                          type="button"
                          className={`icon-button pin-toggle ${manuallyPinnedJobIds.has(job.id) ? "is-pinned" : ""}`}
                          aria-label={manuallyPinnedJobIds.has(job.id) ? "Unpin row" : "Pin row to top"}
                          aria-pressed={manuallyPinnedJobIds.has(job.id)}
                          onClick={(event) => {
                            event.stopPropagation();
                            onTogglePin(job.id);
                          }}
                        >
                          {manuallyPinnedJobIds.has(job.id) ? <Pin size={14} /> : <PinOff size={14} />}
                        </button>
                      </td>
                    </tr>
                  );
                });
              })}
            </tbody>
            </table>
          </div>
        </div>
      )}

      {/* The same Installation record Customer details opens, built from the
          same helper so the two cannot show different versions of a customer.
          Read from `jobs` by id rather than captured when the name was
          clicked, so an edit made on the row behind it stays in step. */}
      {recordJob && (
        <div
          className="modal-backdrop"
          role="presentation"
          onMouseDown={() => {
            setRecordJobId(null);
            setRecordSldOpen(false);
          }}
        >
          <div
            className="customer-modal"
            role="dialog"
            aria-modal="true"
            aria-label={`Installation details for ${recordJob.customerName}`}
            onMouseDown={(event) => event.stopPropagation()}
          >
            <JobDetail
              job={recordJob}
              locationGroupLabel={recordGroupLabel}
              group={groupByJobId.get(recordJob.id) ?? null}
              deliveryRun={
                planningLookup.deliveryRunByJobId.get(recordJob.id) ?? null
              }
              availableTeams={availableTeams}
              saving={saving}
              sldOpen={recordSldOpen}
              onSave={onUpdateJob}
              onOpenSld={() => setRecordSldOpen(true)}
              onCloseSld={() => setRecordSldOpen(false)}
              onDismiss={() => {
                setRecordJobId(null);
                setRecordSldOpen(false);
              }}
            />
          </div>
        </div>
      )}
    </div>
  );
}

// What the geocoder is asked to find. Street line first, then postcode + town,
// then state — the order Malaysian addresses are normally written in, which is
// what the geocoder scores best against.
function jobFullAddress(job: InstallationJob) {
  return [
    job.address,
    [job.postcode, job.city].filter(Boolean).join(" "),
    job.state,
  ]
    .map((part) => (part || "").trim())
    .filter(Boolean)
    .join(", ");
}

type EtaFeedback = { busy: boolean; message?: string; failed?: boolean };

const DELIVERY_RUN_STATUS_LABELS: Record<DeliveryRun["status"], string> = {
  pending_stock: "Pending stock",
  ready: "Ready",
  in_transit: "In transit",
  delivered: "Delivered",
};

function DeliveryRunCustomerSearch({
  jobs,
  currentJobIds,
  onSelectCustomer,
  onCancel,
}: {
  jobs: InstallationJob[];
  currentJobIds: string[];
  onSelectCustomer: (jobId: string) => void;
  onCancel: () => void;
}) {
  const [query, setQuery] = useState("");
  const [isOpen, setIsOpen] = useState(true);
  const deferredQuery = useDeferredValue(query);

  const filtered = useMemo(() => {
    const q = deferredQuery.toLowerCase().trim();
    const currentSet = new Set(currentJobIds);
    return jobs.filter((job) => {
      if (currentSet.has(job.id)) return false;
      if (!q) return true;
      return (
        job.customerName?.toLowerCase().includes(q) ||
        job.invoiceNumber?.toLowerCase().includes(q) ||
        job.city?.toLowerCase().includes(q) ||
        job.address?.toLowerCase().includes(q)
      );
    });
  }, [jobs, currentJobIds, deferredQuery]);

  return (
    <div style={{ position: "relative", display: "inline-flex", alignItems: "center", gap: "8px" }}>
      <span style={{ fontSize: "11px", fontWeight: 600, color: "var(--ink, #0f172a)" }}>
        Search customer:
      </span>
      <input
        type="text"
        autoFocus
        style={{
          width: "290px",
          padding: "4px 8px",
          fontSize: "0.83rem",
          borderRadius: "4px",
          border: "1px solid #cbd5e1",
          background: "#ffffff",
          color: "#0f172a",
        }}
        placeholder="Type customer name, invoice or city (e.g. Tan Kim Whui)…"
        value={query}
        onFocus={() => setIsOpen(true)}
        onChange={(e) => {
          setQuery(e.target.value);
          setIsOpen(true);
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter" && filtered.length > 0) {
            onSelectCustomer(filtered[0].id);
            setQuery("");
            setIsOpen(false);
          } else if (e.key === "Escape") {
            setIsOpen(false);
            onCancel();
          }
        }}
      />
      <button
        type="button"
        className="icon-button"
        title="Cancel"
        onClick={() => {
          setIsOpen(false);
          onCancel();
        }}
      >
        <X size={14} />
      </button>

      {isOpen && (
        <>
          <div
            style={{ position: "fixed", inset: 0, zIndex: 999 }}
            onClick={() => setIsOpen(false)}
          />
          <ul
            style={{
              position: "absolute",
              top: "calc(100% + 4px)",
              left: "100px",
              zIndex: 1000,
              width: "360px",
              maxHeight: "240px",
              overflowY: "auto",
              padding: "4px 0",
              margin: 0,
              background: "#1e293b",
              color: "#f8fafc",
              border: "1px solid rgba(255,255,255,0.2)",
              borderRadius: "6px",
              boxShadow: "0 10px 25px -5px rgba(0, 0, 0, 0.6)",
              listStyle: "none",
            }}
          >
            {filtered.length === 0 ? (
              <li style={{ padding: "8px 12px", fontSize: "0.8rem", opacity: 0.7 }}>
                {query ? `No customer found matching "${query}"` : "No customers available"}
              </li>
            ) : (
              filtered.slice(0, 30).map((candidate) => (
                <li
                  key={candidate.id}
                  style={{
                    padding: "7px 12px",
                    fontSize: "0.82rem",
                    cursor: "pointer",
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "center",
                    borderBottom: "1px solid rgba(255,255,255,0.06)",
                  }}
                  onMouseDown={(e) => {
                    e.preventDefault();
                    onSelectCustomer(candidate.id);
                    setQuery("");
                    setIsOpen(false);
                  }}
                >
                  <div>
                    <strong>{displayName(candidate.customerName)}</strong>
                    <span style={{ opacity: 0.75, marginLeft: "6px" }}>
                      · {candidate.city || candidate.address || "No area"}
                    </span>
                  </div>
                  <span style={{ fontSize: "0.75rem", opacity: 0.6, fontStyle: "italic" }}>
                    {candidate.invoiceNumber || ""}
                  </span>
                </li>
              ))
            )}
          </ul>
        </>
      )}
    </div>
  );
}

function DeliveryPlanningView({
  runs,
  jobs,
  groupByJobId,
  warehouses,
  onChangeWarehouses,
  onChange,
  onUpdateJob,
  pinnedJobIds,
  onTogglePin,
  workCategoryFilter,
  onWorkCategoryFilterChange,
  onSelectJob,
}: {
  runs: DeliveryRun[];
  jobs: InstallationJob[];
  groupByJobId: Map<string, InstallationGroup>;
  warehouses: Warehouse[];
  onChangeWarehouses: (warehouses: Warehouse[]) => void;
  onChange: (runs: DeliveryRun[]) => void;
  onUpdateJob: (job: InstallationJob) => void;
  pinnedJobIds: Set<string>;
  onTogglePin: (id: string) => void;
  workCategoryFilter: string;
  onWorkCategoryFilterChange: (next: string) => void;
  onSelectJob?: (jobId: string) => void;
}) {
  const todayIso = malaysiaToday();
  const jobById = useMemo(
    () => new Map(jobs.map((job) => [job.id, job])),
    [jobs],
  );
  const [stockDraft, setStockDraft] = useState<Record<string, string>>({});
  const [etaFeedback, setEtaFeedback] = useState<Record<string, EtaFeedback>>({});
  const [pinnedWeekKeys, setPinnedWeekKeys] = useState<Set<string>>(new Set());
  const [activeAddRunId, setActiveAddRunId] = useState<string | null>(null);

  const [periodFilter, setPeriodFilter] = useState("");
  const [customerQuery, setCustomerQuery] = useState("");
  const [planningFilter, setPlanningFilter] = useState<string>(ALL_JOBS);
  const planningLookup = useMemo<PlanningLookup>(
    () => ({
      groupByJobId,
      deliveryRunByJobId: latestByJobId(runs, (run) => run.deliveryDate),
    }),
    [groupByJobId, runs],
  );

  function togglePinnedWeek(weekKey: string) {
    setPinnedWeekKeys((prev) => {
      const next = new Set(prev);
      if (next.has(weekKey)) {
        next.delete(weekKey);
      } else {
        next.add(weekKey);
      }
      return next;
    });
  }

  function createRun() {
    const id = crypto.randomUUID();
    const nextRun: DeliveryRun = {
      id,
      name: "",
      deliveryDate: todayIso,
      warehouse: warehouses[0]?.name || "",
      deliveryTeam: "Delivery Team 1",
      deliveryPic: "",
      contactNumber: "",
      departureTime: "09:00",
      installationGroupId: "",
      status: "pending_stock",
      jobIds: [],
    };
    onChange([nextRun, ...runs]);
  }

  async function calculateEtas(run: DeliveryRun) {
    const runJobs = jobs.filter(
      (job) =>
        run.jobIds.includes(job.id) &&
        !isCompleteInstallation(job, todayIso, groupByJobId.get(job.id)),
    );
    const linkedCount = run.jobIds.length;

    const warehouseAddress =
      warehouses.find((item) => item.name === run.warehouse)?.address?.trim() ||
      run.warehouseAddress?.trim() ||
      "";

    if (!warehouseAddress) {
      setEtaFeedback((prev) => ({
        ...prev,
        [run.id]: {
          busy: false,
          failed: true,
          message: run.warehouse
            ? `No address saved for "${run.warehouse}". Add it in the Warehouses table below.`
            : "Pick a warehouse for this run first.",
        },
      }));
      return;
    }
    if (!runJobs.length) {
      setEtaFeedback((prev) => ({
        ...prev,
        [run.id]: {
          busy: false,
          failed: true,
          message: linkedCount
            ? "Every customer on this run has completed installation, so there is nothing left to route."
            : "This run has no customers to route to.",
        },
      }));
      return;
    }

    setEtaFeedback((prev) => ({ ...prev, [run.id]: { busy: true } }));

    try {
      const response = await fetch("/api/eta", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          warehouseAddress,
          deliveryDate: run.deliveryDate,
          departureTime: run.departureTime || "09:00",
          stops: runJobs.map((job) => ({
            jobId: job.id,
            address: jobFullAddress(job),
          })),
        }),
      });

      const payload = (await response.json()) as {
        stops?: Array<{
          jobId: string;
          arrivalDate: string;
          arrivalTime: string;
          driveMinutes: number;
        }>;
        unloadMinutes?: number;
        method?: keyof typeof ROUTE_METHOD_LABELS;
        approximateAddresses?: string[];
        error?: string;
      };

      if (!response.ok || !payload.stops) {
        throw new Error(payload.error || `Request failed (${response.status}).`);
      }

      const estimated = payload.stops;

      estimated.forEach((stop) => {
        const job = runJobs.find((item) => item.id === stop.jobId);
        if (!job) return;
        onUpdateJob({
          ...job,
          arrivalDate: stop.arrivalDate,
          arrivalTime: stop.arrivalTime,
        });
      });

      const totalDrive = estimated.reduce(
        (sum, stop) => sum + stop.driveMinutes,
        0,
      );
      const methodLabel = payload.method
        ? ROUTE_METHOD_LABELS[payload.method]
        : "unknown method";
      const approximate = payload.approximateAddresses ?? [];

      setEtaFeedback((prev) => ({
        ...prev,
        [run.id]: {
          busy: false,
          failed: payload.method === "straight-line",
          message:
            `${estimated.length} stop${estimated.length === 1 ? "" : "s"} — ` +
            `${totalDrive} min driving, ${payload.unloadMinutes} min unloading ` +
            `per stop (${methodLabel}).` +
            (approximate.length
              ? ` Located to town only, so times are rough: ${approximate.join("; ")}`
              : ""),
        },
      }));
    } catch (error) {
      setEtaFeedback((prev) => ({
        ...prev,
        [run.id]: {
          busy: false,
          failed: true,
          message:
            error instanceof Error ? error.message : "Could not estimate ETAs.",
        },
      }));
    }
  }

  function updateRun(id: string, update: Partial<DeliveryRun>) {
    onChange(runs.map((run) => (run.id === id ? { ...run, ...update } : run)));
  }

  function stockTags(job: InstallationJob) {
    return (job.stockDetails || "")
      .split(",")
      .map((item) => item.trim())
      .filter(Boolean);
  }

  function addStockTag(job: InstallationJob) {
    const item = (stockDraft[job.id] ?? "").trim();
    if (!item) return;
    const tags = stockTags(job);
    if (!tags.includes(item)) {
      onUpdateJob({ ...job, stockDetails: [...tags, item].join(", ") });
    }
    setStockDraft((prev) => ({ ...prev, [job.id]: "" }));
  }

  function removeStockTag(job: InstallationJob, item: string) {
    onUpdateJob({
      ...job,
      stockDetails: stockTags(job).filter((tag) => tag !== item).join(", "),
    });
  }

  function createWarehouse() {
    onChangeWarehouses([
      ...warehouses,
      { id: crypto.randomUUID(), name: "", city: "", address: "" },
    ]);
  }

  function updateWarehouse(id: string, update: Partial<Warehouse>) {
    onChangeWarehouses(
      warehouses.map((item) => (item.id === id ? { ...item, ...update } : item)),
    );
  }

  function renameWarehouse(id: string, name: string) {
    const previous = warehouses.find((item) => item.id === id)?.name ?? "";
    updateWarehouse(id, { name });
    if (previous && previous !== name) {
      onChange(
        runs.map((run) =>
          run.warehouse === previous ? { ...run, warehouse: name } : run,
        ),
      );
    }
  }

  function removeWarehouse(id: string) {
    onChangeWarehouses(warehouses.filter((item) => item.id !== id));
  }

  function warehouseOptions(current: string) {
    const names = warehouses.map((item) => item.name).filter(Boolean);
    return current && !names.includes(current) ? [current, ...names] : names;
  }

  const warehouseTable = (
    <section className="planning-group warehouse-section">
      <div className="planning-heading">
        <div>
          <h2>Warehouses</h2>
          <p>
            The depots delivery runs leave from. A run picks one by name, and
            the address saved here is what its ETAs are measured from.
          </p>
        </div>
        <button className="button primary" onClick={createWarehouse}>
          <Plus size={16} />
          Add warehouse
        </button>
      </div>
      <div className="table-wrap">
        <table className="warehouse-table">
          <thead>
            <tr>
              <th>Warehouse name</th>
              <th>City</th>
              <th>Address</th>
              <th aria-label="Actions"></th>
            </tr>
          </thead>
          <tbody>
            {warehouses.length === 0 ? (
              <tr className="delivery-run-placeholder-row">
                <td>&mdash;</td>
                <td>&mdash;</td>
                <td>&mdash;</td>
                <td></td>
              </tr>
            ) : (
              warehouses.map((warehouse) => (
                <tr key={warehouse.id}>
                  <td>
                    <input
                      value={warehouse.name}
                      onChange={(event) =>
                        renameWarehouse(warehouse.id, event.target.value)
                      }
                      placeholder="e.g. Ulu Tiram depot"
                      aria-label="Warehouse name"
                    />
                  </td>
                  <td>
                    <input
                      value={warehouse.city}
                      onChange={(event) =>
                        updateWarehouse(warehouse.id, { city: event.target.value })
                      }
                      placeholder="e.g. Johor Bahru"
                      aria-label="Warehouse city"
                    />
                  </td>
                  <td className="warehouse-address-cell">
                    <input
                      value={warehouse.address}
                      onChange={(event) =>
                        updateWarehouse(warehouse.id, { address: event.target.value })
                      }
                      placeholder="e.g. 15 Jalan Kenanga 1/6, Taman Desa Cemerlang, 81800 Ulu Tiram, Johor"
                      aria-label="Warehouse address"
                    />
                  </td>
                  <td>
                    <div className="row-actions">
                      <button
                        type="button"
                        className="button secondary"
                        aria-label={`Remove warehouse ${warehouse.name || "unnamed"}`}
                        onClick={() => removeWarehouse(warehouse.id)}
                      >
                        Remove
                      </button>
                    </div>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </section>
  );

  const query = customerQuery.trim().toLowerCase();
  const stopFiltered =
    Boolean(query) ||
    planningFilter !== ALL_JOBS ||
    workCategoryFilter !== ALL_JOBS;

  const visibleRuns = runs
    .map((run) => {
      const runJobs = run.jobIds
        .map((id) => jobById.get(id))
        .filter((job): job is InstallationJob => Boolean(job));
      const matching = runJobs.filter(
        (job) =>
          (!query ||
            jobMatchesSearch(job, query) ||
            (groupByJobId.get(job.id)?.supervisors ?? []).some((name) =>
              name.toLowerCase().includes(query),
            )) &&
          matchesPipelineStage(job, planningFilter, todayIso, planningLookup) &&
          matchesWorkCategory(job, workCategoryFilter),
      );
      const ordered = matching
        .slice()
        .sort(
          (a, b) =>
            Number(pinnedJobIds.has(b.id)) - Number(pinnedJobIds.has(a.id)),
        );
      return { run, runJobs: ordered };
    })
    .filter(({ run, runJobs }) => {
      if (!matchesDateSearch(run.deliveryDate, periodFilter)) return false;
      if (stopFiltered && !runJobs.length) return false;
      return true;
    })
    .sort((a, b) => {
      const weekA = a.run.deliveryDate
        ? (weekBounds(a.run.deliveryDate)?.start ?? "")
        : "";
      const weekB = b.run.deliveryDate
        ? (weekBounds(b.run.deliveryDate)?.start ?? "")
        : "";
      const weekKeyA = weekA || "undated";
      const weekKeyB = weekB || "undated";
      const pinA = pinnedWeekKeys.has(weekKeyA) ? 0 : 1;
      const pinB = pinnedWeekKeys.has(weekKeyB) ? 0 : 1;
      return (
        pinA - pinB ||
        weekB.localeCompare(weekA) ||
        (a.run.deliveryDate ?? "").localeCompare(b.run.deliveryDate ?? "") ||
        (a.run.departureTime ?? "").localeCompare(b.run.departureTime ?? "") ||
        (a.run.deliveryTeam ?? "").localeCompare(b.run.deliveryTeam ?? "") ||
        (a.run.name ?? "").localeCompare(b.run.name ?? "") ||
        a.run.id.localeCompare(b.run.id)
      );
    });

  const filtered = Boolean(
    periodFilter ||
      customerQuery ||
      planningFilter !== ALL_JOBS ||
      workCategoryFilter !== ALL_JOBS,
  );

  return (
    <div className="planning-panel">
      <div className="planning-heading delivery-schedule-heading">
        <div>
          <h2>Delivery Schedule</h2>
          <p>Group customer materials into warehouse delivery routes.</p>
        </div>
        <div className="planning-heading-actions">
          <div className="schedule-filters">
            <label className="schedule-search">
              <span>Planning status</span>
              <select
                value={planningFilter}
                onChange={(event) => setPlanningFilter(event.target.value)}
                aria-label="Filter by planning status"
              >
                <option value={ALL_JOBS}>All jobs</option>
                {PLANNING_STAGES.map((stage) => (
                  <option key={stage.value} value={stage.value}>
                    {stage.label}
                  </option>
                ))}
              </select>
            </label>
            <label className="schedule-search">
              <span>Month or year</span>
              <input
                type="search"
                className="second-payment-search"
                value={periodFilter}
                onChange={(event) => setPeriodFilter(event.target.value)}
                placeholder="August, 2026, August 2026…"
                aria-label="Filter by delivery month or year"
              />
            </label>
            <label className="schedule-search">
              <span>Customer</span>
              <input
                type="search"
                className="customer-invoice-search"
                value={customerQuery}
                onChange={(event) => setCustomerQuery(event.target.value)}
                placeholder="Search customer, invoice, address, site supervisor…"
                aria-label="Search customer name, invoice number, address or site supervisor"
              />
            </label>
            {filtered && (
              <button
                type="button"
                className="button secondary"
                onClick={() => {
                  setPeriodFilter("");
                  setCustomerQuery("");
                  setPlanningFilter(ALL_JOBS);
                }}
              >
                Clear
              </button>
            )}
          </div>
          <button className="button primary" onClick={createRun}>
            <Truck size={16} />
            Create delivery run
          </button>
        </div>
      </div>
      <section className="planning-group">
        <div className="table-wrap rti-team unified-team-table delivery-schedule-table">
          <table>
            <colgroup>
              <col className="rti-col-date" />
              <col className="rti-col-customer" />
              <col className="rti-col-address" />
              <col className="rti-col-agent" />
              <col className="rti-col-phase" />
              <col className="rti-col-panel" />
              <col className="rti-col-inverter" />
              <col className="rti-col-eta" />
              <col className="rti-col-inst-date" />
              <col className="rti-col-remark" />
            </colgroup>
            <tbody>
              {visibleRuns.length === 0 && (
                <tr className="delivery-run-placeholder-row">
                  <td colSpan={10}>
                    {runs.length
                      ? "No delivery run matches these filters."
                      : "No delivery runs yet."}
                  </td>
                </tr>
              )}
              {visibleRuns.map(({ run, runJobs }, index) => {
                const feedback = etaFeedback[run.id];
                const weekKey = run.deliveryDate
                  ? (weekBounds(run.deliveryDate)?.start ?? "undated")
                  : "undated";
                const startsWeek =
                  index === 0 ||
                  (visibleRuns[index - 1].run.deliveryDate
                    ? (weekBounds(visibleRuns[index - 1].run.deliveryDate)?.start ?? "undated")
                    : "undated") !== weekKey;

                const rawTeamNum = (() => {
                  const raw = `${run.deliveryTeam || ""} ${run.name || ""}`;
                  const m =
                    raw.match(/\bteam\s*(\d+)\b/i) ||
                    (run.deliveryTeam || "").match(/\b(\d+)\b/);
                  return m ? Number(m[1]) : null;
                })();
                const isStandardTeam =
                  rawTeamNum !== null && rawTeamNum >= 1 && rawTeamNum <= 4;
                const teamNum = isStandardTeam ? rawTeamNum : null;
                const teamClass = isStandardTeam
                  ? `rti-team-${teamNum}`
                  : "rti-team-other rti-team-default";
                const runTitle = (() => {
                  if (run.name) return run.name;
                  if (rawTeamNum) return `Delivery Team ${rawTeamNum}`;
                  if (run.deliveryTeam) return run.deliveryTeam;
                  return "Delivery Run";
                })();
                const baseLabel = run.warehouse
                  ? `${run.warehouse} Depot`
                  : null;

                return (
                  <Fragment key={run.id}>
                    {startsWeek && (
                      <tr
                        className={`schedule-band rti-team-band rti-team-band-sub${
                          pinnedWeekKeys.has(weekKey) ? " is-pinned" : ""
                        }`}
                      >
                        <th colSpan={10} scope="colgroup">
                          <div className="schedule-band-sub-content">
                            <button
                              type="button"
                              className="schedule-band-pin"
                              aria-pressed={pinnedWeekKeys.has(weekKey)}
                              aria-label={`${
                                pinnedWeekKeys.has(weekKey) ? "Unpin" : "Pin"
                              } week ${
                                run.deliveryDate
                                  ? weekRangeLabel(run.deliveryDate)
                                  : "Unscheduled"
                              }`}
                              title={
                                pinnedWeekKeys.has(weekKey)
                                  ? "Unpin this week"
                                  : "Pin this week to the top"
                              }
                              onClick={() => togglePinnedWeek(weekKey)}
                            >
                              {pinnedWeekKeys.has(weekKey) ? (
                                <PinOff size={14} />
                              ) : (
                                <Pin size={14} />
                              )}
                            </button>
                            <span className="schedule-band-week">
                              Week{" "}
                              {run.deliveryDate
                                ? weekRangeLabel(run.deliveryDate)
                                : "Unscheduled"}
                            </span>
                          </div>
                        </th>
                      </tr>
                    )}
                    <tr
                      className={`schedule-band rti-team-band rti-team-band-main delivery-run-band${
                        pinnedWeekKeys.has(weekKey) ? " is-pinned" : ""
                      }`}
                    >
                      <th colSpan={10} scope="colgroup">
                        <div className="rti-team-header-main">
                          <div className="rti-team-title-wrap">
                            <span className="rti-team-name">{runTitle}</span>
                            {baseLabel && (
                              <span className="rti-team-base">{baseLabel}</span>
                            )}
                          </div>
                          <div className="rti-crew-grid">
                            <div className="rti-crew-col">
                              <label
                                className="rti-crew-label"
                                htmlFor={`del-team-${run.id}`}
                              >
                                Delivery Team
                              </label>
                              <input
                                id={`del-team-${run.id}`}
                                type="text"
                                list={`del-teams-list-${run.id}`}
                                className="rti-crew-input rti-crew-input-borderless"
                                value={run.deliveryTeam || ""}
                                placeholder="Select team…"
                                onChange={(e) =>
                                  updateRun(run.id, {
                                    deliveryTeam: e.target.value,
                                  })
                                }
                                onClick={(e) => e.stopPropagation()}
                              />
                              <datalist id={`del-teams-list-${run.id}`}>
                                {deliveryTeams.map((name) => (
                                  <option key={name} value={name} />
                                ))}
                              </datalist>
                            </div>

                            <div className="rti-crew-col">
                              <label
                                className="rti-crew-label"
                                htmlFor={`del-pic-${run.id}`}
                              >
                                Delivery PIC
                              </label>
                              <input
                                id={`del-pic-${run.id}`}
                                type="text"
                                className="rti-crew-input rti-crew-input-borderless"
                                value={run.deliveryPic || ""}
                                placeholder="e.g. Khairul"
                                onChange={(e) =>
                                  updateRun(run.id, {
                                    deliveryPic: e.target.value,
                                  })
                                }
                                onClick={(e) => e.stopPropagation()}
                              />
                            </div>

                            <div className="rti-crew-col">
                              <label
                                className="rti-crew-label"
                                htmlFor={`del-contact-${run.id}`}
                              >
                                Contact Number
                              </label>
                              <input
                                id={`del-contact-${run.id}`}
                                type="tel"
                                className="rti-crew-input rti-crew-input-borderless"
                                value={run.contactNumber || ""}
                                placeholder="e.g. 012-3456789"
                                onChange={(e) =>
                                  updateRun(run.id, {
                                    contactNumber: e.target.value,
                                  })
                                }
                                onClick={(e) => e.stopPropagation()}
                              />
                            </div>

                            <div className="rti-crew-col">
                              <label
                                className="rti-crew-label"
                                htmlFor={`del-warehouse-${run.id}`}
                              >
                                Warehouse
                              </label>
                              <select
                                id={`del-warehouse-${run.id}`}
                                className="rti-crew-input rti-crew-input-borderless"
                                value={run.warehouse || ""}
                                onChange={(e) =>
                                  updateRun(run.id, {
                                    warehouse: e.target.value,
                                  })
                                }
                                onClick={(e) => e.stopPropagation()}
                              >
                                <option value="">Select warehouse</option>
                                {warehouseOptions(run.warehouse).map(
                                  (name) => (
                                    <option key={name} value={name}>
                                      {name}
                                    </option>
                                  ),
                                )}
                              </select>
                            </div>
                          </div>

                          <div className="rti-run-actions">
                            <button
                              type="button"
                              className="button secondary rti-run-calc-btn"
                              onClick={(e) => {
                                e.stopPropagation();
                                void calculateEtas(run);
                              }}
                              disabled={feedback?.busy}
                              title="Calculate driving times and estimated arrival for stops"
                            >
                              {feedback?.busy ? (
                                <LoaderCircle size={13} className="spin" />
                              ) : (
                                <MapPin size={13} />
                              )}
                              {feedback?.busy ? "Calculating…" : "Calculate ETAs"}
                            </button>
                            <button
                              type="button"
                              className="icon-button rti-run-delete-btn"
                              title="Delete delivery run"
                              onClick={(e) => {
                                e.stopPropagation();
                                if (
                                  window.confirm(
                                    `Delete delivery run "${
                                      run.name ||
                                      run.deliveryTeam ||
                                      "unnamed"
                                    }"?`,
                                  )
                                ) {
                                  onChange(
                                    runs.filter((item) => item.id !== run.id),
                                  );
                                }
                              }}
                            >
                              <Trash2 size={14} />
                            </button>
                          </div>
                        </div>
                        {feedback?.message && (
                          <div
                            className={
                              feedback.failed
                                ? "run-route-note failed"
                                : "run-route-note"
                            }
                            role={feedback.failed ? "alert" : undefined}
                          >
                            {feedback.message}
                          </div>
                        )}
                      </th>
                    </tr>

                    <tr className="schedule-column-headers">
                      <th>Slot</th>
                      <th>Customer</th>
                      <th>Address</th>
                      <th>Agent</th>
                      <th>Phase</th>
                      <th>Panel</th>
                      <th>Inverter</th>
                      <th>ETA</th>
                      <th>Installation Date</th>
                      <th>Stock / Remark</th>
                    </tr>

                    {runJobs.length === 0 && (
                      <tr>
                        <td
                          colSpan={10}
                          style={{
                            padding: "12px",
                            textAlign: "center",
                            color: "var(--muted, #64748b)",
                            fontStyle: "italic",
                            fontSize: "12px",
                          }}
                        >
                          No customers in this run yet. Use the selector below to add a customer.
                        </td>
                      </tr>
                    )}

                    {runJobs.map((job, stopIndex) => {
                      const assignedGroup = groupByJobId.get(job.id);
                      const instDate =
                        assignedGroup?.installationDate ||
                        job.preferredInstallationDate ||
                        job.visits?.[0]?.date ||
                        null;
                      const rowRemark =
                        job.stockDetails || job.installationRemarks || "";

                      const installTeam =
                        assignedGroup?.installationTeam ||
                        job.teams?.find((t) => t.role === "roof")?.teamName ||
                        "";
                      const wiringTeam =
                        assignedGroup?.wiringTeam ||
                        job.teams?.find((t) => t.role === "wiring")?.teamName ||
                        "";
                      const supervisorText =
                        (assignedGroup?.supervisors && assignedGroup.supervisors.length
                          ? assignedGroup.supervisors.filter(Boolean).join(", ")
                          : assignedGroup?.supervisor) ||
                        job.teams?.find((t) => t.role === "supervisor")?.teamName ||
                        "";

                      const rawTeamNum = (() => {
                        if (!assignedGroup) return null;
                        const raw = `${assignedGroup.teamLabel || ""} ${assignedGroup.name || ""} ${assignedGroup.installationTeam || ""}`;
                        const m =
                          raw.match(/\bteam\s*(\d+)\b/i) ||
                          (assignedGroup.teamLabel || "").match(/\b(\d+)\b/);
                        return m ? Number(m[1]) : null;
                      })();
                      const isStandardTeam =
                        rawTeamNum !== null && rawTeamNum >= 1 && rawTeamNum <= 4;
                      const teamNum = isStandardTeam ? rawTeamNum : null;
                      const teamColorClass = isStandardTeam
                        ? `team-${teamNum}`
                        : assignedGroup
                        ? "team-default"
                        : "team-unassigned";

                      return (
                        <tr
                          key={`${run.id}-${job.id}-${stopIndex}`}
                          className={[
                            "rti-row",
                            Boolean(/koh\s*keng\s*kiat/i.test(job.customerName))
                              ? "is-koh-keng-kiat"
                              : "",
                            remarkHasOm(rowRemark) ? "is-om" : "",
                          ]
                            .filter(Boolean)
                            .join(" ")}
                        >
                          {/* 1. Slot */}
                          <td className="rti-date">
                            <strong>
                              {run.deliveryDate
                                ? formatDateOnly(run.deliveryDate)
                                : "—"}
                            </strong>
                            <div className="rti-slot-time-wrap">
                              <Clock3 size={11} className="rti-slot-time-icon" />
                              <input
                                type="text"
                                list="rti-slot-time-presets"
                                className="rti-slot-time-input"
                                defaultValue={run.departureTime || "09:00"}
                                key={`run-departure-${run.id}-${run.departureTime}`}
                                placeholder="09:00"
                                title="Run departure time"
                                onClick={(e) => e.stopPropagation()}
                                onBlur={(e) =>
                                  updateRun(run.id, {
                                    departureTime: e.target.value,
                                  })
                                }
                              />
                            </div>
                          </td>

                          {/* 2. Customer (Phone and Email on Hover) */}
                          <td>
                            <div className="rti-customer-wrap">
                              <span
                                className="rti-name"
                                title={`Phone: ${
                                  job.customerPhone || "–"
                                } · Email: ${
                                  job.customerEmail || "–"
                                } · SEDA approved: ${
                                  job.sedaApprovedDate
                                    ? shortDate(job.sedaApprovedDate)
                                    : isSedaApproved(job.sedaStatus)
                                    ? "Approved"
                                    : job.sedaStatus || "Pending"
                                } · 2nd payment: ${
                                  shortDate(job.secondPaymentDate) || "–"
                                }`}
                              >
                                {displayName(job.customerName)}
                              </span>
                              <div
                                className="rti-customer-popover"
                                role="tooltip"
                              >
                                <div className="rti-customer-popover-row">
                                  <span className="rti-customer-popover-label">
                                    Phone:
                                  </span>
                                  <span className="rti-customer-popover-val">
                                    {job.customerPhone
                                      ? formatPhone(job.customerPhone)
                                      : "–"}
                                  </span>
                                </div>
                                <div className="rti-customer-popover-row">
                                  <span className="rti-customer-popover-label">
                                    Email:
                                  </span>
                                  <span className="rti-customer-popover-val">
                                    {job.customerEmail || "–"}
                                  </span>
                                </div>
                                <div className="rti-customer-popover-row">
                                  <span className="rti-customer-popover-label">
                                    SEDA approved:
                                  </span>
                                  <span className="rti-customer-popover-val">
                                    {job.sedaApprovedDate
                                      ? shortDate(job.sedaApprovedDate)
                                      : isSedaApproved(job.sedaStatus)
                                      ? "Approved"
                                      : job.sedaStatus || "Pending"}
                                  </span>
                                </div>
                                <div className="rti-customer-popover-row">
                                  <span className="rti-customer-popover-label">
                                    2nd payment:
                                  </span>
                                  <span className="rti-customer-popover-val">
                                    {shortDate(job.secondPaymentDate) || "–"}
                                  </span>
                                </div>
                                <div className="rti-customer-popover-row">
                                  <span className="rti-customer-popover-label">
                                    Payment status:
                                  </span>
                                  <span className="rti-customer-popover-val">
                                    {(job.paymentPercent ?? 0).toFixed(2)}% paid
                                  </span>
                                </div>
                              </div>
                              {job.invoiceNumber && (
                                <span className="rti-muted rti-invoice">
                                  {job.invoiceNumber}
                                </span>
                              )}
                              {isAtap(job.customerName) && (
                                <span
                                  className="rti-tag is-roof"
                                  title="Roof type from customer name"
                                >
                                  ATAP
                                </span>
                              )}
                              {job.battery &&
                                job.battery !== "Not available" && (
                                  <span
                                    className="rti-tag is-battery"
                                    title={job.battery}
                                  >
                                    Battery
                                  </span>
                                )}
                              {job.evDetails && (
                                <span
                                  className="rti-tag is-ev"
                                  title={job.evDetails}
                                >
                                  EV
                                </span>
                              )}
                            </div>
                          </td>

                          {/* 3. Address */}
                          <td>
                            {job.address ? (
                              <button
                                type="button"
                                className="rti-link rti-address"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  const q = encodeURIComponent(
                                    `${job.address}, ${job.postcode || ""} ${
                                      job.city || ""
                                    } ${job.state || ""}`.trim(),
                                  );
                                  window.open(
                                    `https://www.google.com/maps/search/?api=1&query=${q}`,
                                    "_blank",
                                  );
                                }}
                                title="Open address in Google Maps"
                              >
                                <MapPin size={13} />
                                {titleCase(job.address) ||
                                  "Address not available"}
                              </button>
                            ) : (
                              <span className="run-field-readout is-empty">
                                —
                              </span>
                            )}
                          </td>

                          {/* 4. Agent */}
                          <td className="rti-agent">
                            {job.agentName?.trim().toUpperCase() || "–"}
                          </td>

                          {/* 5. Phase */}
                          <td>{phaseText(job)}</td>

                          {/* 6. Panel */}
                          <td
                            className="rti-edit-cell"
                            onClick={(e) => e.stopPropagation()}
                          >
                            <textarea
                              className="rti-cell-textarea"
                              rows={2}
                              defaultValue={derivedPowerOutput(job)}
                              key={`panel-${run.id}-${job.id}-${stopIndex}-${job.powerOutput}`}
                              onBlur={(event) => {
                                const text = event.target.value;
                                if (text === derivedPowerOutput(job)) return;
                                onUpdateJob({ ...job, powerOutput: text });
                              }}
                              placeholder="e.g. 16 Jinko 650W"
                              aria-label={`Panel for ${displayName(
                                job.customerName,
                              )}`}
                            />
                          </td>

                          {/* 7. Inverter */}
                          <td
                            className="rti-edit-cell"
                            onClick={(e) => e.stopPropagation()}
                          >
                            <textarea
                              className="rti-cell-textarea"
                              rows={2}
                              defaultValue={inverterText(job)}
                              key={`inverter-${run.id}-${job.id}-${stopIndex}-${job.inverterBattery}`}
                              onBlur={(event) => {
                                const text = event.target.value;
                                const current = inverterText(job);
                                if (text === current) return;
                                onUpdateJob({ ...job, inverterBattery: text });
                              }}
                              placeholder="e.g. 10kW Hybrid"
                              aria-label={`Inverter for ${displayName(
                                job.customerName,
                              )}`}
                            />
                          </td>

                          {/* 8. ETA (Date and Time estimating arrival) */}
                          <td
                            className="rti-date rti-eta-cell"
                            onClick={(e) => e.stopPropagation()}
                          >
                            <div className="rti-eta-container">
                              <div className="rti-eta-box">
                                <Calendar
                                  size={11}
                                  className="rti-eta-icon"
                                />
                                <input
                                  type="date"
                                  className={`rti-eta-input ${
                                    job.arrivalDate
                                      ? "is-set"
                                      : "is-inherited"
                                  }`}
                                  value={
                                    job.arrivalDate ?? run.deliveryDate ?? ""
                                  }
                                  title={
                                    job.arrivalDate
                                      ? "Estimated arrival date"
                                      : "Inherited from run date (click to customize)"
                                  }
                                  onChange={(e) =>
                                    onUpdateJob({
                                      ...job,
                                      arrivalDate: e.target.value || null,
                                    })
                                  }
                                />
                              </div>
                              <div className="rti-eta-box">
                                <Clock3
                                  size={11}
                                  className="rti-eta-icon"
                                />
                                <input
                                  type="text"
                                  list="rti-slot-time-presets"
                                  className={`rti-eta-input ${
                                    job.arrivalTime
                                      ? "is-set"
                                      : "is-inherited"
                                  }`}
                                  value={
                                    job.arrivalTime ??
                                    run.departureTime ??
                                    "09:00"
                                  }
                                  placeholder="09:00"
                                  title="Estimated arrival time (click to edit)"
                                  onChange={(e) =>
                                    onUpdateJob({
                                      ...job,
                                      arrivalTime: e.target.value || null,
                                    })
                                  }
                                />
                              </div>
                            </div>
                          </td>

                          {/* 9. Installation Date with Team Hover Popover */}
                          <td className="rti-installation-date-cell">
                            <div className="rti-inst-date-wrap">
                              <div
                                className={`rti-inst-date-tag ${
                                  instDate ? "" : "is-unassigned"
                                }`}
                              >
                                <Calendar size={12} />
                                <span className="rti-inst-date-text">
                                  {instDate
                                    ? formatDateOnly(instDate)
                                    : "Unassigned"}
                                </span>
                              </div>

                              <div
                                className={`rti-inst-team-popover ${teamColorClass}`}
                                role="tooltip"
                              >
                                <div className="rti-inst-popover-title">
                                  {assignedGroup?.teamLabel ||
                                    (teamNum
                                      ? `Team ${teamNum}`
                                      : assignedGroup?.name ||
                                        "Installation Assignment")}
                                </div>
                                <div className="rti-inst-popover-row">
                                  <span className="rti-inst-popover-label">
                                    Installation team:
                                  </span>
                                  <span className="rti-inst-popover-val">
                                    {installTeam || "–"}
                                  </span>
                                </div>
                                <div className="rti-inst-popover-row">
                                  <span className="rti-inst-popover-label">
                                    Wiring team:
                                  </span>
                                  <span className="rti-inst-popover-val">
                                    {wiringTeam || "–"}
                                  </span>
                                </div>
                                <div className="rti-inst-popover-row">
                                  <span className="rti-inst-popover-label">
                                    Site supervisor:
                                  </span>
                                  <span className="rti-inst-popover-val">
                                    {supervisorText || "–"}
                                  </span>
                                </div>
                              </div>
                            </div>
                          </td>

                          {/* 10. Stock / Remark & Remove Stop */}
                          <td
                            className="rti-edit-cell rti-remark-cell"
                            onClick={(e) => e.stopPropagation()}
                          >
                            <div
                              style={{
                                display: "flex",
                                alignItems: "flex-start",
                                gap: "4px",
                              }}
                            >
                              <textarea
                                className="rti-cell-textarea"
                                rows={2}
                                defaultValue={rowRemark}
                                key={`stock-remark-${run.id}-${job.id}-${stopIndex}-${rowRemark}`}
                                onBlur={(event) => {
                                  const text = event.target.value;
                                  if (text === (job.stockDetails || ""))
                                    return;
                                  onUpdateJob({
                                    ...job,
                                    stockDetails: text,
                                  });
                                }}
                                placeholder="Stock items & notes"
                                aria-label={`Stock details / Remark for ${displayName(
                                  job.customerName,
                                )}`}
                              />
                              <button
                                type="button"
                                className="rti-stop-remove-btn"
                                title="Remove customer from this delivery run"
                                onClick={() => {
                                  updateRun(run.id, {
                                    jobIds: run.jobIds.filter(
                                      (_, idx) => idx !== stopIndex,
                                    ),
                                  });
                                }}
                              >
                                <X size={12} />
                              </button>
                            </div>
                          </td>
                        </tr>
                      );
                    })}

                    {/* Add Customer row for this run */}
                    <tr className="rti-add-stop-row">
                      <td
                        colSpan={10}
                        style={{
                          padding: "6px 12px",
                          background: "var(--surface-soft, #f8fafc)",
                          borderBottom: "1px solid var(--line, #e2e8f0)",
                        }}
                      >
                        {activeAddRunId !== run.id ? (
                          <button
                            type="button"
                            className="button secondary"
                            style={{
                              fontSize: "11px",
                              padding: "2px 10px",
                              height: "26px",
                              display: "inline-flex",
                              alignItems: "center",
                              gap: "4px",
                            }}
                            onClick={() => {
                              setActiveAddRunId(run.id);
                            }}
                          >
                            <Plus size={13} />
                            Add customer to this run
                          </button>
                        ) : (
                          <DeliveryRunCustomerSearch
                            jobs={jobs}
                            currentJobIds={run.jobIds}
                            onSelectCustomer={(selectedJobId) => {
                              updateRun(run.id, {
                                jobIds: [...run.jobIds, selectedJobId],
                              });
                              setActiveAddRunId(null);
                            }}
                            onCancel={() => setActiveAddRunId(null)}
                          />
                        )}
                      </td>
                    </tr>
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>
      {warehouseTable}
    </div>
  );
}
