"use client";

import {
  AlertTriangle,
  CalendarDays,
  CalendarOff,
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Clock3,
  CloudLightning,
  CloudRain,
  CloudSun,
  Download,
  FileSearch,
  Filter,
  LoaderCircle,
  MapPin,
  Moon,
  PackageCheck,
  Phone,
  Pin,
  PinOff,
  Plus,
  RefreshCw,
  Search,
  Settings,
  Sun,
  Truck,
  Users,
  Wallet,
  X,
  Zap,
} from "lucide-react";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import dynamic from "next/dynamic";
import type {
  CalendarDayDetail,
  InstallationJob,
  JobUpdate,
  TeamAssignment,
} from "@/lib/types";
import type { UpdateStatus } from "@/lib/electron-desktop";
import { ROUTE_METHOD_LABELS } from "@/lib/routing";
import SidebarCalendar from "@/app/components/SidebarCalendar";
import GroupMultiSelect from "@/app/components/GroupMultiSelect";
import WeatherGlyph from "@/app/components/WeatherGlyph";

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

type DashboardView = "pipeline" | "groups" | "teams" | "delivery";

type InstallationGroup = {
  id: string;
  name: string;
  area: string;
  installationDate: string;
  installationEndDate: string;
  jobIds: string[];
  installationTeam: string;
  wiringTeam: string;
  supervisor: string;
};

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
      !isOutOfPlanning(job) &&
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
      group.jobIds.includes(job.id) &&
      (job.customerAvailabilityStatus === "available" ||
        job.customerAvailabilityStatus === "pending"),
  );
}

/**
 * Available once every dated, in-play customer has confirmed; Pending while any
 * of them has not. Only the customers that qualified the group are consulted —
 * an undated customer never put the group in the list, so it does not get to
 * hold the group at Pending either.
 */
function groupAvailability(group: InstallationGroup, jobs: InstallationJob[]) {
  const members = schedulableMembers(group, jobs);
  const settled =
    members.length > 0 &&
    members.every((job) => job.customerAvailabilityStatus === "available");
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

// Assignment stamps are stored as plain local strings rather than instants, so
// they are split on the "T" instead of parsed — the same reasoning as
// lib/dates.ts, where reparsing a zone-less value can move it a day.
// A plain ISO date ("2026-08-10") shown the way every other date on the page
// reads. Display only — the date inputs still bind to the raw ISO value.
function formatDateOnly(value: string | null | undefined) {
  if (!value) return "Not set";
  const date = new Date(`${value}T00:00:00`);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("en-MY", {
    day: "numeric",
    month: "short",
    year: "numeric",
  }).format(date);
}

function formatAssignmentStamp(value: string) {
  if (!value) return "Not set";
  const [datePart, timePart] = value.split("T");
  const date = new Date(`${datePart}T00:00:00`);
  if (Number.isNaN(date.getTime())) return value;
  const label = new Intl.DateTimeFormat("en-MY", {
    day: "numeric",
    month: "short",
    year: "numeric",
  }).format(date);
  return timePart ? `${label}, ${timePart.slice(0, 5)}` : label;
}

const STORAGE_KEY = "installation-ops-updates-v1";
const GROUPS_STORAGE_KEY = "installation-ops-groups-v1";
const DELIVERY_RUNS_STORAGE_KEY = "installation-ops-delivery-runs-v1";
const TEAMS_STORAGE_KEY = "installation-ops-team-resources-v1";
const TEAM_WEEKS_STORAGE_KEY = "installation-ops-team-weeks-v1";
const TEAM_SUGGESTIONS_STORAGE_KEY = "installation-ops-team-suggestions-v1";
const THEME_STORAGE_KEY = "installation-ops-theme";
const SIDEBAR_STORAGE_KEY = "installation-ops-sidebar";
const PINNED_JOBS_STORAGE_KEY = "installation-ops-pinned-jobs-v1";

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

// Standard Malaysia federal public holidays. Islamic and Hindu calendar
// dates (Raya, Wesak, Awal Muharram, Maulidur Rasul, Deepavali) are
// estimates and should be checked against the official government
// gazette closer to the date. State-specific holidays are not included.
const MALAYSIA_PUBLIC_HOLIDAYS: Record<string, string> = {
  "2026-01-01": "New Year's Day",
  "2026-02-17": "Chinese New Year",
  "2026-02-18": "Chinese New Year (2nd day)",
  "2026-03-21": "Hari Raya Puasa",
  "2026-03-22": "Hari Raya Puasa (2nd day)",
  "2026-05-01": "Labour Day",
  "2026-05-27": "Hari Raya Haji",
  "2026-05-31": "Wesak Day",
  "2026-06-01": "Agong's Birthday",
  "2026-06-16": "Awal Muharram",
  "2026-08-25": "Prophet Muhammad's Birthday",
  "2026-08-31": "National Day",
  "2026-09-16": "Malaysia Day",
  "2026-11-08": "Deepavali",
  "2026-12-25": "Christmas Day",
};

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
  const date = new Intl.DateTimeFormat("en-MY", {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZone: "Asia/Kuala_Lumpur",
  }).format(updated);

  let age: string;
  if (hours < 1) age = "just now";
  else if (hours < 24) age = `${Math.round(hours)}h ago`;
  else {
    const days = Math.floor(hours / 24);
    age = `${days} day${days === 1 ? "" : "s"} ago`;
  }

  return { date, age, stale: hours >= STALE_SOURCE_HOURS };
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

const availabilityLabels: Record<
  InstallationJob["customerAvailabilityStatus"],
  string
> = {
  not_set: "Not set",
  pending: "Pending confirmation",
  available: "Available",
  unavailable: "Not available",
  cancelled: "Cancellation",
};

// Both statuses take the customer out of planning: they drop out of the
// suggestion lists and are removed from any installation group.
function isOutOfPlanning(job: InstallationJob) {
  return (
    job.customerAvailabilityStatus === "unavailable" ||
    job.customerAvailabilityStatus === "cancelled"
  );
}

// A customer who was available on installation day and whose date is at
// least a full day gone is assumed complete without waiting on the source
// system to mark it installed — otherwise a finished job can sit on the
// chase list indefinitely just because the sign-off never got recorded.
// Customers who were only pending/not set, or who went unavailable or
// cancelled, keep chasing as before regardless of how overdue the date is.
// The date itself follows the same confirmed-else-preferred fallback the
// Customer details "Installation date" column already shows — a preferred
// date that was never overridden counts the same as a confirmed one here.
function isAssumedComplete(job: InstallationJob, todayIso: string) {
  const effectiveDate = job.installationDate || job.preferredInstallationDate;
  return (
    job.customerAvailabilityStatus === "available" &&
    effectiveDate !== null &&
    effectiveDate < todayIso
  );
}

function isCompleteInstallation(job: InstallationJob, todayIso: string) {
  return job.scheduleStatus === "installed" || isAssumedComplete(job, todayIso);
}

// Financially free to move: paid 59% or more, or carrying an approved
// exception for a job that has not reached that threshold.
function hasPlanningEligibility(job: InstallationJob) {
  return (
    job.paymentPercent >= 59 ||
    (job.paymentPercent < 59 && job.paymentOverrideStatus === "approved")
  );
}

// How long a job has been waiting, expressed as a sortable number. A missing or
// unparseable 2nd payment date sorts last, matching the pipeline table.
function secondPaymentRank(job: InstallationJob): number {
  if (!job.secondPaymentDate) return Number.POSITIVE_INFINITY;
  const time = new Date(job.secondPaymentDate).getTime();
  return Number.isNaN(time) ? Number.POSITIVE_INFINITY : time;
}

// Oldest 2nd payment first, so the longest-waiting customer leads.
function compareBySecondPayment(a: InstallationJob, b: InstallationJob) {
  const order = secondPaymentRank(a) - secondPaymentRank(b);
  // Two undated jobs give Infinity - Infinity, which is NaN — fall back to the
  // name so their order stays stable instead of being left to sort's whim.
  if (Number.isNaN(order) || order === 0) {
    return a.customerName.localeCompare(b.customerName);
  }
  return order;
}

// A location group is ranked by its longest-waiting customer, so the most
// overdue postcode surfaces first.
function groupSecondPaymentRank(customers: InstallationJob[]): number {
  return customers.reduce(
    (oldest, job) => Math.min(oldest, secondPaymentRank(job)),
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

function normalizeSeda(status: string) {
  const value = status.toLowerCase();
  return ["approved", "complete", "completed", "success"].some((word) =>
    value.includes(word),
  )
    ? "Approved"
    : status || "Pending";
}

function calculateDaysSince(dateStr: string): number | null {
  if (!dateStr) return null;
  const date = new Date(dateStr);
  const now = new Date();
  const diffTime = now.getTime() - date.getTime();
  const diffDays = Math.floor(diffTime / (1000 * 60 * 60 * 24));
  return diffDays >= 0 ? diffDays : null;
}

function getPendingInstallationMetrics(jobs: InstallationJob[]) {
  // Overdue is 30+ days since the second payment. calculateDaysSince is the only
  // thing that decides how old a job is, here and in the breakdown below, so the
  // total can never disagree with the three buckets it is split into.
  const overdue = jobs.filter((job) => {
    if (!job.secondPaymentDate) return false;
    const days = calculateDaysSince(job.secondPaymentDate);
    return days !== null && days >= 30;
  });

  const breakdown = {
    days30to60: overdue.filter(job => {
      const days = calculateDaysSince(job.secondPaymentDate!);
      return days !== null && days >= 30 && days < 60;
    }).length,
    days60to90: overdue.filter(job => {
      const days = calculateDaysSince(job.secondPaymentDate!);
      return days !== null && days >= 60 && days < 90;
    }).length,
    days90plus: overdue.filter(job => {
      const days = calculateDaysSince(job.secondPaymentDate!);
      return days !== null && days >= 90;
    }).length,
  };

  return {
    total: overdue.length,
    breakdown,
    jobs: overdue,
  };
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
    customerAvailabilityStatus: job.customerAvailabilityStatus,
    preferredInstallationDate: job.preferredInstallationDate,
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
    paymentOverrideStatus: job.paymentOverrideStatus,
    paymentOverrideReason: job.paymentOverrideReason,
    teams: job.teams,
    remarks: job.remarks,
  };
}

// Today as a plain YYYY-MM-DD string in the timezone the team works in, so it
// compares directly against the date-only strings the jobs carry. en-CA is the
// locale that formats as YYYY-MM-DD; toISOString would give UTC and roll the
// day back for the first eight hours of every Malaysian morning.
function malaysiaToday() {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Kuala_Lumpur",
  }).format(new Date());
}

// The same day as malaysiaToday(), spelled out for the heading. Kept live
// rather than written into the markup so the dashboard cannot sit there
// claiming a date that has already passed.
function malaysiaTodayLabel() {
  return new Intl.DateTimeFormat("en-MY", {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "Asia/Kuala_Lumpur",
  }).format(new Date());
}

// How long a paid-up customer may sit with nothing booked before the dashboard
// starts asking about them. Counted in working days, not calendar days.
const WORKING_DAYS_BEFORE_ATTENTION = 28;

// Paid the deposit but still has no date on the calendar, four working weeks
// on. Jobs that already have an installation date drop off this list whatever
// state that booking is in — the card is about customers nobody has scheduled,
// not about bookings that later slipped.
function needsAttention(job: InstallationJob, todayIso: string) {
  if (job.paymentPercent < 60) return false;
  if (job.installationDate) return false;
  if (!job.secondPaymentDate) return false;
  return hasWorkingDaysElapsed(
    job.secondPaymentDate,
    todayIso,
    WORKING_DAYS_BEFORE_ATTENTION,
  );
}

// The unfiltered view. It heads the status dropdown and is where the page
// starts, but it gets no summary card — the cards are the stages, and none of
// them is highlighted while this is selected.
const ALL_JOBS = "all";

// The single source of truth for the pipeline: the summary cards, the status
// filter and the counts all read this list, so a card can never show a number
// the filter it opens disagrees with.
const PIPELINE_STAGES = [
  {
    value: "deposit",
    label: "Deposit",
    note: "1st payment received",
    hint: "The customer has made their first payment against the invoice. This is the entry stage — every job that has paid anything at all sits here.",
  },
  {
    value: "ready",
    label: "Ready to Install",
    note: "SEDA approved, paid 60%+",
    hint: "SEDA registration approved and 60% or more of the invoice paid. Stock, a date and a crew are the stages that follow, not conditions for this one.",
  },
  {
    value: "scheduled",
    label: "Scheduled Installation",
    note: "Dated, customer in play",
    hint: "An installation date is set and the customer's availability is Available or Pending. Customers who have gone unavailable or cancelled are not counted even though the date is still on the record.",
  },
  {
    value: "pending_complete",
    label: "Pending Complete Installation",
    note: "Booked, not finished",
    hint: "Has a date but is not installed: the customer cancelled or went unavailable, or hasn't confirmed availability and the date passed with no sign-off, or it is installation day and the stock is still not delivered. Bookings still in the future are not counted here — those stay under Scheduled Installation. An available customer whose date has passed counts as Complete Installation instead.",
  },
  {
    value: "complete",
    label: "Complete Installation",
    note: "Installation done",
    hint: "Marked installed in the source system, or assumed complete once an available customer's installation date is at least a day past.",
  },
  {
    value: "attention",
    label: "Need Attention",
    note: "28 working days, no date",
    hint: "Paid 60% or more on the 2nd payment, but still has no installation date 28 working days on. Working days exclude weekends and Malaysian public holidays.",
  },
] as const;

type StageValue = (typeof PIPELINE_STAGES)[number]["value"];

// Team planning offers the same stages, minus the ones its own guards make
// unreachable: it only ever lists work still to be planned, so a stage meaning
// "already installed" could never return a row and would read as a broken filter.
const UNPLANNABLE_STAGES: StageValue[] = ["complete"];

const PLANNING_STAGES = PIPELINE_STAGES.filter(
  (stage) => !UNPLANNABLE_STAGES.includes(stage.value),
);

const stageIcons: Record<StageValue, React.ReactNode> = {
  deposit: <Wallet size={18} />,
  ready: <Check size={18} />,
  scheduled: <CalendarDays size={18} />,
  pending_complete: <Clock3 size={18} />,
  complete: <PackageCheck size={18} />,
  attention: <AlertTriangle size={18} />,
};

// Only the two stages that mean something has gone wrong carry colour: amber
// for a booking that has slipped, red for a paid customer nobody has scheduled.
const stageTones: Partial<Record<StageValue, "warning">> = {
  pending_complete: "warning",
  attention: "warning",
};

const stageAccents: Partial<Record<StageValue, "amber" | "red">> = {
  pending_complete: "amber",
  attention: "red",
};

// The status filter walks the customer through the pipeline in order: deposit
// cleared, everything ready, a date on the calendar, the date gone by with no
// sign-off, then done. A job can sit in more than one of these at once — they
// are lenses on the same list, not exclusive buckets.
function matchesPipelineStage(
  job: InstallationJob,
  stage: string,
  todayIso: string,
) {
  const installationDate = job.installationDate;
  const installed = isCompleteInstallation(job, todayIso);
  const availability = job.customerAvailabilityStatus;

  switch (stage) {
    // The customer has paid something towards the invoice. The deposit date is
    // the reliable signal; percent is the fallback for invoices whose payment
    // rows have no date on them.
    case "deposit":
      return Boolean(job.firstPaymentDate) || job.paymentPercent > 0;

    // Cleared to be installed: the registration is through and the money is in.
    // Deliberately not the same as "everything is arranged" — stock, a date and
    // a crew are the next stages, not preconditions for this one.
    //
    // A finished job still satisfies both conditions forever, so it has to be
    // excluded explicitly or it never leaves this stage — the same guard
    // "scheduled" and "pending_complete" already carry.
    case "ready":
      return (
        !installed &&
        normalizeSeda(job.sedaStatus) === "Approved" &&
        job.paymentPercent >= 60
      );

    // A date is on the calendar and the customer is still in play. Someone who
    // has gone unavailable or cancelled is not a scheduled installation even
    // though the date is still sitting on the record.
    case "scheduled":
      return (
        installationDate !== null &&
        !installed &&
        (availability === "available" ||
          availability === "pending" ||
          availability === "not_set")
      );

    // Booked but not finished — the chase list. Three ways in: the customer
    // pulled out, the date came and went with no sign-off, or it is
    // installation day and the stock still is not delivered (the crew would
    // arrive with nothing to fit).
    //
    // Undelivered stock deliberately does NOT count before the day itself. A
    // job booked next week whose stock has not shipped yet is a normal
    // Scheduled Installation, not an unfinished one; flagging it early filled
    // this list with healthy bookings and double-counted them under both
    // cards at once.
    case "pending_complete":
      return (
        installationDate !== null &&
        !installed &&
        (isOutOfPlanning(job) ||
          installationDate < todayIso ||
          (installationDate === todayIso &&
            job.deliveryStatus !== "delivered"))
      );

    case "complete":
      return installed;

    case "attention":
      return needsAttention(job, todayIso);

    // ALL_JOBS, and anything unrecognised, leaves the list untouched.
    default:
      return true;
  }
}

function applyJobUpdates(
  jobs: InstallationJob[],
  updates: Record<string, JobUpdate>,
) {
  return jobs.map((job) => {
    const merged = { ...job, ...(updates[job.id] ?? {}) };
    return {
      ...merged,
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
  teamResources: TeamResource[];
  teamWeekAssignments: TeamWeekAssignment[];
  jobUpdates: Record<string, JobUpdate>;
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
    groups.forEach((group) => {
      const firstJob = jobs.find((job) => group.jobIds.includes(job.id));
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
      const forecasts = await Promise.all(
        Array.from(locations.values()).map(async ({ latitude, longitude }) => {
          try {
            const query = new URLSearchParams({
              latitude: String(latitude),
              longitude: String(longitude),
              daily: "weather_code,precipitation_probability_max",
              timezone: "Asia/Kuala_Lumpur",
              forecast_days: "16",
            });
            const response = await fetch(
              `https://api.open-meteo.com/v1/forecast?${query}`,
            );
            if (!response.ok) return null;
            return (await response.json()) as {
              daily?: {
                time?: string[];
                weather_code?: number[];
                precipitation_probability_max?: number[];
              };
            };
          } catch {
            return null;
          }
        }),
      );
      const next: Record<
        string,
        { rainProbability: number; weatherCode: number }
      > = {};
      forecasts.forEach((forecast) => {
        forecast?.daily?.time?.forEach((date, index) => {
          const rainProbability =
            forecast.daily?.precipitation_probability_max?.[index] ?? 0;
          const weatherCode = forecast.daily?.weather_code?.[index] ?? 0;
          const current = next[date];
          if (!current || rainProbability > current.rainProbability) {
            next[date] = { rainProbability, weatherCode };
          }
        });
      });
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
    return (
      customerDate === dateStr &&
      groups.some((group) => group.jobIds.includes(job.id))
    );
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
                      {run.name}
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

  const checkpoints = [
    {
      label: "Payment",
      value: `${job.paymentPercent.toFixed(0)}% · ${
        job.paymentPercent >= 59 ? "Eligible" : "Review"
      }`,
      state: job.paymentPercent >= 59 ? "complete" : "blocked",
    },
    {
      label: "SEDA",
      value: normalizeSeda(job.sedaStatus),
      state:
        normalizeSeda(job.sedaStatus) === "Approved" ? "complete" : "blocked",
    },
    {
      label: "Stock",
      value: deliveryLabels[job.deliveryStatus],
      state: job.deliveryStatus === "delivered" ? "complete" : "pending",
    },
    {
      label: "Date",
      value: job.installationDate || "Not arranged",
      state: job.installationDate ? "complete" : "pending",
    },
  ];

  if (sldOpen) {
    return (
      <aside className="detail-panel sld-panel">
        <div className="detail-header">
          <div>
            <p className="eyebrow">Source drawing</p>
            <h2>SLD · {job.customerName}</h2>
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

      <div className="checkpoints">
        {checkpoints.map((item) => (
          <div className={`checkpoint ${item.state}`} key={item.label}>
            <small>{item.label}</small>
            <strong>{item.value}</strong>
          </div>
        ))}
      </div>

      <div className="record-body">
        <SpecBlock title="Customer and site">
          <SpecRow label="Customer name" value={job.customerName} emphasis />
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
            emphasis={job.paymentPercent >= 59}
          />
          <SpecRow label="Balance due" value={currency(job.paymentBalance)} />
          <SpecRow
            label="2nd payment date"
            value={
              job.secondPaymentDate
                ? new Intl.DateTimeFormat("en-MY", {
                    day: "numeric",
                    month: "short",
                    year: "numeric",
                    timeZone: "Asia/Kuala_Lumpur",
                  }).format(new Date(job.secondPaymentDate))
                : "Not recorded"
            }
          />
        </SpecBlock>

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
                    : "Panel specification not provided"
            }
          />
          <SpecRow label="Inverter" value={job.inverter} />
          <SpecRow
            label="Electrical phase"
            value={job.phase === "Unknown" ? "Not provided" : job.phase}
          />
          <SpecRow
            label="Battery"
            value={
              job.battery === "Not available" ? "Not provided" : job.battery
            }
          />
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
              <SpecRow
                label="Customer availability"
                value={availabilityLabels[job.customerAvailabilityStatus]}
              />
              {job.paymentPercent < 60 && (
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
                value={group?.supervisor || "Unassigned"}
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
}: {
  label: string;
  value: string;
  emphasis?: boolean;
}) {
  return (
    <div className={`spec-row${emphasis ? " emphasis" : ""}`}>
      <dt>{label}</dt>
      <dd>{value}</dd>
    </div>
  );
}

export default function DashboardPage() {
  const [view, setView] = useState<DashboardView>("pipeline");
  // Schedule & assign is no longer a tab on the groups page; it opens as a
  // modal when creating a new installation group.
  const [showScheduleModal, setShowScheduleModal] = useState(false);
  // Set by clicking a date in the sidebar calendar; narrows the pipeline table
  // to jobs installing (or, for Available/Pending customers, preferring to
  // install) on that date.
  const [installationDateFilter, setInstallationDateFilter] = useState("");
  const [jobs, setJobs] = useState<InstallationJob[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState<string>(ALL_JOBS);
  const [stateFilter, setStateFilter] = useState("all");
  const [secondPaymentMonthFilter, setSecondPaymentMonthFilter] = useState("");
  // Manually pinned rows on Customer details — a personal, browser-local
  // preference rather than shared job data, so it lives in localStorage only.
  // Starts empty on the server render; the mount effect below fills it in.
  const [pinnedJobIds, setPinnedJobIds] = useState<Set<string>>(new Set());
  // Lifted out of Team planning so the summary cards above it can be scoped to
  // the same filters while that page is active — see planningScopedJobs below.
  const [planningFilter, setPlanningFilter] = useState<string>(ALL_JOBS);
  const [planningPostcodeFilter, setPlanningPostcodeFilter] = useState("");
  const [planningMonthFilter, setPlanningMonthFilter] = useState("");
  const [planningCustomerNameFilter, setPlanningCustomerNameFilter] =
    useState("");
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [meta, setMeta] = useState<Omit<JobsResponse, "jobs"> | null>(null);
  const [editMode, setEditMode] = useState(false);
  const [sldOpen, setSldOpen] = useState(false);
  const [darkMode, setDarkMode] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [updateStatus, setUpdateStatus] = useState<UpdateStatus | null>(null);
  const [groups, setGroups] = useState<InstallationGroup[]>([]);
  const [deliveryRuns, setDeliveryRuns] = useState<DeliveryRun[]>([]);
  const [teamResources, setTeamResources] =
    useState<TeamResource[]>(defaultTeamResources);
  const [teamWeekAssignments, setTeamWeekAssignments] = useState<
    TeamWeekAssignment[]
  >([]);
  const [composer, setComposer] = useState<"group" | "delivery" | null>(null);
  const [showPendingModal, setShowPendingModal] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [settingsForm, setSettingsForm] = useState({
    url: "",
    database: "",
    token: "",
  });
  const [settingsHasToken, setSettingsHasToken] = useState(false);
  const [isDesktop, setIsDesktop] = useState(false);
  const [settingsSaving, setSettingsSaving] = useState(false);
  const [settingsError, setSettingsError] = useState<string | null>(null);
  const [groupDraft, setGroupDraft] = useState({
    name: "",
    area: "",
    installationDate: "",
    installationEndDate: "",
  });
  const [deliveryDraft, setDeliveryDraft] = useState({
    name: "",
    deliveryDate: "",
    warehouse: "",
    deliveryPic: "",
    contactNumber: "",
    installationGroupId: "",
  });

  const jobUpdatesRef = useRef<Record<string, JobUpdate>>({});

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
            "Your change is on this device only. Press Refresh to reconnect.",
        );
        return;
      }

      void (async () => {
        try {
          const response = await fetch("/api/ops-state", {
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
            "NOT SAVED to the shared database: " +
              (error instanceof Error ? error.message : "the connection failed.") +
              " Your change is on this device only. Press Refresh to reconnect.",
          );
        }
      })();
    },
    [markStore],
  );

  const applySharedState = useCallback((state: SharedOpsState) => {
    setGroups(state.groups);
    setDeliveryRuns(state.deliveryRuns);
    setTeamResources(
      state.teamResources.length ? state.teamResources : defaultTeamResources,
    );
    setTeamWeekAssignments(state.teamWeekAssignments);
    jobUpdatesRef.current = state.jobUpdates;
    setJobs((current) =>
      current.length ? applyJobUpdates(current, state.jobUpdates) : current,
    );
  }, []);

  const loadSharedState = useCallback(
    async (seedIfMissing: boolean) => {
      const local: SharedOpsState = {
        groups: readLocalJson(GROUPS_STORAGE_KEY, []),
        deliveryRuns: readLocalJson(DELIVERY_RUNS_STORAGE_KEY, []),
        teamResources: readLocalJson(TEAMS_STORAGE_KEY, defaultTeamResources),
        teamWeekAssignments: readLocalJson(TEAM_WEEKS_STORAGE_KEY, []),
        jobUpdates: readLocalJson(STORAGE_KEY, {}),
      };
      try {
        const response = await fetch("/api/ops-state", { cache: "no-store" });
        if (!response.ok) {
          throw new Error(
            await readError(response, "Shared planning data is unavailable."),
          );
        }
        const data = (await response.json()) as {
          exists: boolean;
          state: SharedOpsState;
        };
        markStore(true);
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
        setNotice(
          (error instanceof Error
            ? error.message
            : "Shared planning data is unavailable.") +
            " Showing this device's last copy — changes will not be saved.",
        );
      }
    },
    [applySharedState, markStore, persistOps],
  );

  useEffect(() => {
    const savedTheme = window.localStorage.getItem(THEME_STORAGE_KEY);
    const useDark =
      savedTheme === "dark" ||
      (!savedTheme && window.matchMedia("(prefers-color-scheme: dark)").matches);
    setDarkMode(useDark);
    document.documentElement.dataset.theme = useDark ? "dark" : "light";

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
      const response = await fetch("/api/jobs", { cache: "no-store" });
      const data = (await response.json()) as JobsResponse;
      if (!response.ok) throw new Error("Could not load installation jobs.");
      const merged = applyJobUpdates(data.jobs, jobUpdatesRef.current);
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

  const groupByJobId = useMemo(() => {
    const result = new Map<string, InstallationGroup>();
    groups.forEach((group) =>
      group.jobIds.forEach((jobId) => result.set(jobId, group)),
    );
    return result;
  }, [groups]);

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
  const calendarDayDetails = useMemo(() => {
    const assignmentsByGroup = new Map<string, TeamWeekAssignment[]>();
    teamWeekAssignments.forEach((assignment) => {
      const list = assignmentsByGroup.get(assignment.installationGroupId) ?? [];
      list.push(assignment);
      assignmentsByGroup.set(assignment.installationGroupId, list);
    });

    const teamById = new Map(teamResources.map((team) => [team.id, team]));
    const details: Record<string, CalendarDayDetail> = {};
    const dayFor = (key: string) =>
      (details[key] ??= { teams: [], customers: [] });

    // Crews are keyed off the date they are booked for, not off their group's
    // customers. A crew is committed to that day whether or not anyone in the
    // group has been pencilled in yet — reaching them through the customer
    // list would hide a real booking behind an unset customer date.
    teamWeekAssignments.forEach((assignment) => {
      const key = assignment.startDate.slice(0, 10);
      const team = teamById.get(assignment.teamId);
      if (!key || !team) return;
      const label = `${team.name}, ${teamRoleLabel(team.role)}`;
      const day = dayFor(key);
      if (!day.teams.includes(label)) day.teams.push(label);
    });

    jobs.forEach((job) => {
      // Same rule the calendar's own day markers use, so a marked day and its
      // card never disagree about who is installing that day.
      const key = job.installationDate || job.preferredInstallationDate;
      if (!key) return;

      const group = groupByJobId.get(job.id);
      // The crew's start time stands in as the installation time — the schema
      // carries no per-customer clock. Only this customer's own group counts,
      // and only a booking on this day: another group's crew being out today
      // says nothing about when this customer is worked on. Earliest wins when
      // both an installation and a wiring crew are booked.
      const startTimes = (group ? (assignmentsByGroup.get(group.id) ?? []) : [])
        .filter((assignment) => assignment.startDate.slice(0, 10) === key)
        .map((assignment) => timeOfDay(assignment.startDate))
        .filter((time): time is string => Boolean(time))
        .sort();

      dayFor(key).customers.push({
        id: job.id,
        name: formatPersonName(job.customerName),
        stockDelivery: job.arrivalTime || null,
        installTime: startTimes[0] ?? null,
      });
    });

    Object.values(details).forEach((day) =>
      day.customers.sort((a, b) => a.name.localeCompare(b.name)),
    );
    return details;
  }, [jobs, groupByJobId, teamWeekAssignments, teamResources]);

  // The pipeline narrowed by every filter except the status one: search, state
  // and 2nd payment month. Deliberately excludes status — that is the per-card
  // axis stageCounts computes, and folding it in here would zero every card
  // except the selected one.
  const pipelineScopedJobs = useMemo(() => {
    const needle = query.toLowerCase().trim();
    return jobs.filter((job) => {
      const matchesQuery =
        !needle ||
        [
          job.customerName,
          job.invoiceNumber,
          job.address,
          job.agentName,
          job.inverter,
        ]
          .join(" ")
          .toLowerCase()
          .includes(needle);
      const matchesState = stateFilter === "all" || job.state === stateFilter;
      // The filter is a month, "YYYY-MM". Comparing the first seven characters
      // of the stored "YYYY-MM-DD" keeps this a plain string match — no date
      // parsing, so no timezone can shift a payment into the month next door.
      const matchesSecondPaymentMonth =
        !secondPaymentMonthFilter ||
        job.secondPaymentDate?.slice(0, 7) === secondPaymentMonthFilter;
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
        matchesInstallationDate
      );
    });
  }, [
    jobs,
    query,
    stateFilter,
    secondPaymentMonthFilter,
    installationDateFilter,
  ]);

  // Computed once per render rather than memoized — it is a cheap
  // Intl.DateTimeFormat call, and every filter/count below needs to agree on
  // exactly the same "today" or their numbers could disagree mid-render.
  const todayIso = malaysiaToday();

  const filteredJobs = useMemo(() => {
    return pipelineScopedJobs
      .filter((job) => matchesPipelineStage(job, status, todayIso))
      .sort((a, b) => {
        if (!a.secondPaymentDate && !b.secondPaymentDate) {
          return a.customerName.localeCompare(b.customerName);
        }
        if (!a.secondPaymentDate) return 1;
        if (!b.secondPaymentDate) return -1;
        const dateOrder =
          new Date(a.secondPaymentDate).getTime() -
          new Date(b.secondPaymentDate).getTime();
        return dateOrder || a.customerName.localeCompare(b.customerName);
      });
  }, [pipelineScopedJobs, status, todayIso]);

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
    return jobs.filter(
      (job) =>
        hasPlanningEligibility(job) &&
        !isCompleteInstallation(job, todayIso) &&
        !isOutOfPlanning(job) &&
        (!planningMonthFilter ||
          Boolean(job.secondPaymentDate?.startsWith(planningMonthFilter))) &&
        (!postcodeSearch ||
          postcodeForJob(job).toLowerCase().includes(postcodeSearch)) &&
        (!nameSearch ||
          job.customerName?.toLowerCase().includes(nameSearch)),
    );
  }, [
    jobs,
    groups,
    todayIso,
    planningPostcodeFilter,
    planningMonthFilter,
    planningCustomerNameFilter,
  ]);

  // One count per pipeline stage, produced by the same predicate the status
  // filter runs. Clicking a card and reading its number can never disagree.
  // Each workspace counts over its own filtered pool — Team planning's, or the
  // pipeline's search/state/month narrowing — so the cards always describe the
  // list underneath them rather than a global total the filters never touch.
  const stageCounts = useMemo(() => {
    const pool = view === "teams" ? planningScopedJobs : pipelineScopedJobs;
    const counts = {} as Record<StageValue, number>;
    PIPELINE_STAGES.forEach((stage) => {
      counts[stage.value] = pool.filter((job) =>
        matchesPipelineStage(job, stage.value, todayIso),
      ).length;
    });
    return counts;
  }, [view, planningScopedJobs, pipelineScopedJobs, todayIso]);

  const metrics = useMemo(
    () => ({ pendingInstallation: getPendingInstallationMetrics(jobs) }),
    [jobs],
  );

  const deliveryRunByJobId = useMemo(() => {
    const result = new Map<string, DeliveryRun>();
    deliveryRuns.forEach((run) =>
      run.jobIds.forEach((jobId) => result.set(jobId, run)),
    );
    return result;
  }, [deliveryRuns]);

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

  // Manually pinned rows sort to the top; pinned and unpinned rows each keep
  // their existing payment-date order within their own group.
  const pipelineJobs = useMemo(() => {
    return filteredJobs
      .map((job, index) => ({ job, index, pinned: pinnedJobIds.has(job.id) }))
      .sort((a, b) => Number(b.pinned) - Number(a.pinned) || a.index - b.index)
      .map((entry) => entry.job);
  }, [filteredJobs, pinnedJobIds]);

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
    ? {
        ...selected,
        installationDate:
          selected.installationDate ||
          selectedPlanningGroup?.installationDate ||
          null,
        deliveryDate:
          selected.deliveryDate || selectedDeliveryRun?.deliveryDate || null,
        warehouseLocation:
          selected.warehouseLocation ||
          selectedDeliveryRun?.warehouse ||
          "",
        deliveryContactNumber:
          selected.deliveryContactNumber ||
          selectedDeliveryRun?.contactNumber ||
          selected.customerPhone,
        deliveryRunName: selectedDeliveryRun?.name || "",
        deliveryGroupLocation:
          groups.find(
            (group) =>
              group.id === selectedDeliveryRun?.installationGroupId,
          )?.area ||
          selectedPlanningGroup?.area ||
          "",
        teams:
          selected.teams.length > 0
            ? selected.teams
            : [
                ...(selectedPlanningGroup?.installationTeam
                  ? [
                      {
                        id: `${selectedPlanningGroup.id}-installation`,
                        role: "roof" as const,
                        teamName: selectedPlanningGroup.installationTeam,
                        activity: "pv_panels" as const,
                      },
                    ]
                  : []),
                ...(selectedPlanningGroup?.wiringTeam
                  ? [
                      {
                        id: `${selectedPlanningGroup.id}-wiring`,
                        role: "wiring" as const,
                        teamName: selectedPlanningGroup.wiringTeam,
                        activity: "cable_trunking" as const,
                      },
                    ]
                  : []),
              ],
      }
    : null;

  // Escape closes the top-most popup, one layer per press. The order matches
  // how they stack rather than how they are declared: a composer can be opened
  // from inside the schedule modal, and the SLD drawing sits inside the
  // customer record, so both have to give way before the thing underneath.
  const dashboardPopupOpen = Boolean(
    composer ||
      selectedJobForDisplay ||
      showSettings ||
      showPendingModal ||
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
    if (showPendingModal) {
      setShowPendingModal(false);
      return;
    }
    if (showScheduleModal) setShowScheduleModal(false);
  }, [
    composer,
    selectedJobForDisplay,
    sldOpen,
    showSettings,
    showPendingModal,
    showScheduleModal,
  ]);

  useEscapeKey(dashboardPopupOpen, closeTopPopup);

  function saveGroups(next: InstallationGroup[]) {
    setGroups(next);
    window.localStorage.setItem(GROUPS_STORAGE_KEY, JSON.stringify(next));
    persistOps({ groups: next });
  }

  function saveDeliveryRuns(next: DeliveryRun[]) {
    setDeliveryRuns(next);
    window.localStorage.setItem(DELIVERY_RUNS_STORAGE_KEY, JSON.stringify(next));
    persistOps({ deliveryRuns: next });
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
      supervisor: "",
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

  function createDeliveryRun() {
    if (!deliveryDraft.name.trim()) return;
    const nextRun: DeliveryRun = {
      id: crypto.randomUUID(),
      name: deliveryDraft.name.trim(),
      deliveryDate: deliveryDraft.deliveryDate,
      warehouse: deliveryDraft.warehouse.trim(),
      deliveryTeam: "",
      deliveryPic: deliveryDraft.deliveryPic.trim(),
      contactNumber: deliveryDraft.contactNumber.trim(),
      installationGroupId: deliveryDraft.installationGroupId,
      status: "pending_stock",
      jobIds:
        groups.find(
          (group) => group.id === deliveryDraft.installationGroupId,
        )?.jobIds ?? [],
    };
    saveDeliveryRuns([...deliveryRuns, nextRun]);
    setDeliveryDraft({
      name: "",
      deliveryDate: "",
      warehouse: "",
      deliveryPic: "",
      contactNumber: "",
      installationGroupId: "",
    });
    setComposer(null);
    setView("delivery");
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

  async function saveAvailability(updated: InstallationJob) {
    if (isOutOfPlanning(updated)) {
      saveGroups(
        groups.map((group) => ({
          ...group,
          jobIds: group.jobIds.filter((id) => id !== updated.id),
        })),
      );
    }
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
            <strong>Installation Operations</strong>
            <span>Solar scheduling and delivery</span>
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

        <nav className="dashboard-tabs" aria-label="Installation workspaces">
          {(
            [
              ["pipeline", "Customer details"],
              ["teams", "Customer Scheduling"],
              ["groups", "Installation groups"],
              ["delivery", "Stock delivery"],
            ] as [DashboardView, string][]
          ).map(([value, label]) => (
            <button
              key={value}
              className={view === value ? "active" : ""}
              onClick={() => setView(value)}
              title={sidebarCollapsed ? label : undefined}
            >
              {value === "pipeline" && <Search size={16} />}
              {value === "groups" && <CalendarDays size={16} />}
              {value === "teams" && <Users size={16} />}
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
              // and puts Customer details on screen to show the result.
              // Clicking the day already applied lifts the filter, so the
              // highlighted cell is also the way back out.
              onSelectDate={(key) => {
                setInstallationDateFilter((current) =>
                  current === key ? "" : key,
                );
                setView("pipeline");
              }}
            />
            <button
              className="sidebar-pending"
              onClick={() => setShowPendingModal(true)}
            >
              <Clock3 size={15} />
              <span>Pending installations</span>
              <strong>{metrics.pendingInstallation.total}</strong>
            </button>
          </div>
        )}
      </aside>

      <main
        className={`app-shell${
          view === "teams" || view === "delivery" ? " app-shell-wide" : ""
        }`}
      >
      <header className="topbar">
        <div className="topbar-actions">
          <button
            className="icon-button theme-toggle"
            aria-label={darkMode ? "Use light mode" : "Use dark mode"}
            onClick={toggleTheme}
          >
            {darkMode ? <Sun size={18} /> : <Moon size={18} />}
          </button>
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
        </div>
      </header>

      <section className="page-heading">
        <div>
          <p className="eyebrow">{malaysiaTodayLabel()} · Malaysia time</p>
          <h1>Installation dashboard</h1>
          <p>Plan customer dates, stock delivery, SEDA approval, and installation teams.</p>
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
            change will be saved. Press Refresh to try again.
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

      {/* One card per stage of the status filter, in the same order. Clicking a
          card selects that stage below, so the number and the list always agree;
          clicking the selected one again drops back to All jobs. On Team
          planning the cards read that page's own filter and pool instead, so a
          card always means "the stage you'd land on if you clicked it now". */}
      <section className="metrics" aria-label="Installation summary">
        {PIPELINE_STAGES.map((stage) => {
          const onPlanning = view === "teams";
          // Team planning's own dropdown never offers Complete Installation —
          // its guards already exclude installed jobs, so the stage can never
          // apply there. Clicking the card while viewing Team planning would
          // set a filter value the dropdown has no matching option for.
          const plannable = PLANNING_STAGES.some((s) => s.value === stage.value);
          const disabledHere = onPlanning && !plannable;
          const active =
            !disabledHere &&
            (onPlanning ? planningFilter === stage.value : status === stage.value);
          return (
            <Metric
              key={stage.value}
              label={stage.label}
              value={stageCounts[stage.value]}
              note={stage.note}
              hint={
                disabledHere
                  ? `${stage.hint} Not applicable to Team planning, which only ever lists work still to be installed.`
                  : `${stage.hint} ${
                      active
                        ? "Click again to clear the filter."
                        : onPlanning
                          ? "Click to filter Team planning to this stage."
                          : "Click to filter the pipeline to this stage."
                    }`
              }
              icon={stageIcons[stage.value]}
              tone={stageTones[stage.value]}
              accent={stageAccents[stage.value]}
              selected={active}
              onClick={
                disabledHere
                  ? undefined
                  : () => {
                      if (onPlanning) {
                        setPlanningFilter(active ? ALL_JOBS : stage.value);
                        return;
                      }
                      setStatus(active ? ALL_JOBS : stage.value);
                      setView("pipeline");
                    }
              }
            />
          );
        })}
      </section>

      <section className="workspace">
        {view === "pipeline" && (
        <div className="pipeline-panel">
          <div className="toolbar">
            <div className="search-field">
              <Search size={17} />
              <input
                aria-label="Search installations"
                placeholder="Search customer, invoice, address…"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
              />
            </div>
            <div className="filters">
              <Filter size={16} />
              <select
                aria-label="Filter by status"
                value={status}
                onChange={(event) => setStatus(event.target.value)}
              >
                <option value={ALL_JOBS}>All jobs</option>
                {PIPELINE_STAGES.map((stage) => (
                  <option key={stage.value} value={stage.value}>
                    {stage.label}
                  </option>
                ))}
              </select>
              <select
                aria-label="Filter by state"
                value={stateFilter}
                onChange={(event) => setStateFilter(event.target.value)}
              >
                <option value="all">All states</option>
                {states.map((item) => (
                  <option key={item} value={item}>
                    {item}
                  </option>
                ))}
              </select>
              <input
                aria-label="Filter by 2nd payment month"
                type="month"
                value={secondPaymentMonthFilter}
                onChange={(event) =>
                  setSecondPaymentMonthFilter(event.target.value)
                }
              />
              {secondPaymentMonthFilter && (
                <button
                  className="icon-button"
                  aria-label="Clear 2nd payment month filter"
                  onClick={() => setSecondPaymentMonthFilter("")}
                >
                  <X size={14} />
                </button>
              )}
            </div>
          </div>

          {installationDateFilter && (
            <div className="installation-date-filter-banner">
              <CalendarDays size={14} />
              <span>
                Showing installations for{" "}
                {new Intl.DateTimeFormat("en-MY", {
                  day: "numeric",
                  month: "short",
                  year: "numeric",
                }).format(new Date(`${installationDateFilter}T00:00:00`))}
              </span>
              <button
                type="button"
                className="button secondary"
                onClick={() => setInstallationDateFilter("")}
              >
                Clear
              </button>
            </div>
          )}

          <div className="pipeline-heading">
            <div>
              <h2>Active installation pipeline</h2>
              <p>{pipelineJobs.length} jobs shown</p>
            </div>
            {sourceAge ? (
              <span
                className={`source-age${sourceAge.stale ? " stale" : ""}`}
                title={
                  sourceAge.stale
                    ? "No upstream change in over a day — the sync feeding this dashboard may have stopped."
                    : undefined
                }
              >
                <strong>
                  {sourceAge.stale && "⚠ "}
                  Source data {sourceAge.age}
                </strong>
                <small>
                  Newest record {sourceAge.date}
                  {meta?.syncedAt &&
                    ` · checked ${new Intl.DateTimeFormat("en-MY", {
                      hour: "numeric",
                      minute: "2-digit",
                      timeZone: "Asia/Kuala_Lumpur",
                    }).format(new Date(meta.syncedAt))}`}
                </small>
              </span>
            ) : (
              meta?.syncedAt && (
                <span className="source-age">
                  <small>
                    Checked{" "}
                    {new Intl.DateTimeFormat("en-MY", {
                      hour: "numeric",
                      minute: "2-digit",
                      timeZone: "Asia/Kuala_Lumpur",
                    }).format(new Date(meta.syncedAt))}
                  </small>
                </span>
              )
            )}
          </div>

          {loading ? (
            <div className="empty-state">
              <LoaderCircle className="spin" />
              <p>Loading eligible installations…</p>
            </div>
          ) : filteredJobs.length === 0 ? (
            <div className="empty-state">
              <Search />
              <p>No jobs match these filters.</p>
            </div>
          ) : (
            <div className="table-wrap">
              <table className="pipeline-table">
                <thead>
                  <tr>
                    <th>Customer / site</th>
                    <th>Agent</th>
                    <th>Payment</th>
                    <th>2nd payment date</th>
                    <th>Schedule</th>
                    <th>Assigned teams</th>
                    <th>Location / group</th>
                    <th>Delivery run</th>
                    <th>Stock details</th>
                    <th>Installation date</th>
                    <th aria-label="Open" />
                    <th aria-label="Pin" />
                  </tr>
                </thead>
                <tbody>
                  {pipelineJobs.map((job) => {
                    const isPinned = pinnedJobIds.has(job.id);
                    return (
                    <tr
                      key={job.id}
                      className={[
                        selected?.id === job.id ? "selected" : "",
                        isPinned ? "pinned" : "",
                        arrangedCountFor(job)
                          ? `arranged arranged-${arrangedCountFor(job)}`
                          : "",
                        isCompleteInstallation(job, todayIso)
                          ? "installation-complete"
                          : "",
                        job.customerAvailabilityStatus === "cancelled"
                          ? "availability-cancelled"
                          : "",
                      ]
                        .filter(Boolean)
                        .join(" ")}
                      onClick={() => {
                        setSelectedId(job.id);
                        setEditMode(false);
                        setSldOpen(false);
                      }}
                    >
                      <td>
                          <strong>{formatPersonName(job.customerName)}</strong>
                        <span>{job.city || job.state || job.invoiceNumber}</span>
                      </td>
                      <td>
                        <strong>{formatPersonName(job.agentName)}</strong>
                        <span>Sales agent</span>
                      </td>
                      <td>
                        <strong>{job.paymentPercent.toFixed(0)}%</strong>
                        <span>{currency(job.paymentBalance)} balance</span>
                      </td>
                      <td>
                        <strong>
                          {job.secondPaymentDate
                            ? new Intl.DateTimeFormat("en-MY", {
                                day: "numeric",
                                month: "short",
                                year: "numeric",
                                timeZone: "Asia/Kuala_Lumpur",
                              }).format(new Date(job.secondPaymentDate))
                            : "Not recorded"}
                        </strong>
                      </td>
                      <td>
                        <StatusDot status={scheduleStatusKind(job.scheduleStatus)} />
                        {statusLabels[job.scheduleStatus]}
                        <span>
                          {normalizeSeda(job.sedaStatus) === "Approved"
                            ? "SEDA approved"
                            : `SEDA ${normalizeSeda(job.sedaStatus)}`}
                        </span>
                      </td>
                      <td>
                        <strong>
                          {teamLabelFor(
                            groupByJobId.get(job.id)?.installationTeam,
                            "installation",
                          ) || "Installation team unassigned"}
                        </strong>
                        <span>
                          {teamLabelFor(
                            groupByJobId.get(job.id)?.wiringTeam,
                            "wiring",
                          ) || "Wiring team unassigned"}
                        </span>
                      </td>
                      <td>
                        <strong>
                          {groupByJobId.get(job.id)?.name || "Not grouped"}
                        </strong>
                        <span>
                          {groupByJobId.get(job.id)?.area ||
                            townshipForJob(job)}
                        </span>
                      </td>
                      <td>
                        <strong>
                          {deliveryRunByJobId.get(job.id)?.name ||
                            "Not assigned"}
                        </strong>
                      </td>
                      <td>
                        <strong>{job.stockDetails || "Not entered"}</strong>
                      </td>
                      {(() => {
                        // A confirmed date wins: the customer's own, else the
                        // group's. With neither, fall back to the preferred
                        // date set on Customer Scheduling so the intent set
                        // there is visible here — labelled, because a
                        // proposed date is a weaker claim than a booked one.
                        const confirmedDate =
                          job.installationDate ||
                          groupByJobId.get(job.id)?.installationDate ||
                          null;
                        const shownDate =
                          confirmedDate || job.preferredInstallationDate;
                        return (
                          <td>
                            <strong>
                              {shownDate
                                ? new Intl.DateTimeFormat("en-MY", {
                                    day: "numeric",
                                    month: "short",
                                    year: "numeric",
                                  }).format(new Date(`${shownDate}T00:00:00`))
                                : "Not scheduled"}
                            </strong>
                            {shownDate && !confirmedDate && (
                              <span className="is-inherited">Preferred</span>
                            )}
                          </td>
                        );
                      })()}
                      <td>
                        <ChevronRight size={17} />
                      </td>
                      <td className="pin-cell">
                        <button
                          type="button"
                          className="icon-button pin-toggle"
                          aria-label={isPinned ? "Unpin row" : "Pin row to top"}
                          aria-pressed={isPinned}
                          onClick={(event) => {
                            event.stopPropagation();
                            togglePinJob(job.id);
                          }}
                        >
                          {isPinned ? <Pin size={14} /> : <PinOff size={14} />}
                        </button>
                      </td>
                    </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
        )}

        {view === "groups" && (
          <InstallationGroupsView
            groups={groups}
            jobs={jobs}
            teams={teamResources}
            weekAssignments={teamWeekAssignments}
            deliveryRuns={deliveryRuns}
            onOpenJob={setSelectedId}
            onGroupsChange={saveGroups}
            onTeamsChange={saveTeamResources}
            onWeekAssignmentsChange={saveTeamWeekAssignments}
            onCreate={() => setComposer("group")}
            onJumpToDate={() => {
              // The pipeline no longer filters on installation date, so the
              // calendar can only hand the user back to the full list.
              setSecondPaymentMonthFilter("");
              setView("pipeline");
            }}
            groupsWorkspace="teams"
            onReassignTeam={() => setShowScheduleModal(false)}
            onOpenSchedule={() => setShowScheduleModal(true)}
            pinnedJobIds={pinnedJobIds}
            onTogglePin={togglePinJob}
          />
        )}

        {view === "teams" && (
          <TeamPlanningView
            groups={groups}
            jobs={jobs}
            planningFilter={planningFilter}
            onPlanningFilterChange={setPlanningFilter}
            postcodeFilter={planningPostcodeFilter}
            onPostcodeFilterChange={setPlanningPostcodeFilter}
            secondPaymentMonthFilter={planningMonthFilter}
            onSecondPaymentMonthFilterChange={setPlanningMonthFilter}
            customerNameFilter={planningCustomerNameFilter}
            onCustomerNameFilterChange={setPlanningCustomerNameFilter}
            onUpdateJob={(job) => void saveAvailability(job)}
            manuallyPinnedJobIds={pinnedJobIds}
            onTogglePin={togglePinJob}
          />
        )}

        {view === "delivery" && (
          <DeliveryPlanningView
            runs={deliveryRuns}
            jobs={jobs}
            onChange={saveDeliveryRuns}
            onUpdateJob={(job) => void saveJob(job)}
            onCreate={() => setComposer("delivery")}
            pinnedJobIds={pinnedJobIds}
            onTogglePin={togglePinJob}
          />
        )}

      </section>
      {composer && (
        <div className="modal-backdrop" role="presentation">
          <div
            className="composer-modal"
            role="dialog"
            aria-modal="true"
            aria-label={
              composer === "group"
                ? "Create installation group"
                : "Create delivery run"
            }
          >
            <div className="detail-header">
              <div>
                <p className="eyebrow">
                  Manual planning
                </p>
                <h2>
                  {composer === "group"
                    ? "Create installation group"
                    : "Create delivery run"}
                </h2>
              </div>
              <button
                className="icon-button"
                aria-label="Close"
                onClick={() => setComposer(null)}
              >
                <X size={19} />
              </button>
            </div>
            {composer === "group" ? (
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
            ) : (
              <div className="edit-form">
                <label>
                  Delivery run name
                  <input
                    value={deliveryDraft.name}
                    onChange={(event) =>
                      setDeliveryDraft({
                        ...deliveryDraft,
                        name: event.target.value,
                      })
                    }
                    placeholder="Example: Johor Route 08"
                  />
                </label>
                <label>
                  Delivery date
                  <input
                    type="date"
                    value={deliveryDraft.deliveryDate}
                    onChange={(event) =>
                      setDeliveryDraft({
                        ...deliveryDraft,
                        deliveryDate: event.target.value,
                      })
                    }
                  />
                </label>
                <label>
                  Warehouse
                  <input
                    value={deliveryDraft.warehouse}
                    onChange={(event) =>
                      setDeliveryDraft({
                        ...deliveryDraft,
                        warehouse: event.target.value,
                      })
                    }
                    placeholder="Warehouse name and location"
                  />
                </label>
                <label>
                  Group location
                  <select
                    value={deliveryDraft.installationGroupId}
                    onChange={(event) =>
                      setDeliveryDraft({
                        ...deliveryDraft,
                        installationGroupId: event.target.value,
                      })
                    }
                  >
                    <option value="">Select customer group</option>
                    {groups.map((group) => (
                      <option value={group.id} key={group.id}>
                        {group.name} · {group.area}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  Delivery PIC
                  <input
                    value={deliveryDraft.deliveryPic}
                    onChange={(event) =>
                      setDeliveryDraft({
                        ...deliveryDraft,
                        deliveryPic: event.target.value,
                      })
                    }
                    placeholder="Person in charge"
                  />
                </label>
                <label>
                  Contact number
                  <input
                    type="tel"
                    value={deliveryDraft.contactNumber}
                    onChange={(event) =>
                      setDeliveryDraft({
                        ...deliveryDraft,
                        contactNumber: event.target.value,
                      })
                    }
                    placeholder="Delivery PIC contact"
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
                    disabled={!deliveryDraft.name.trim()}
                    onClick={createDeliveryRun}
                  >
                    Create delivery run
                  </button>
                </div>
              </div>
            )}
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
                <p className="eyebrow">Installation groups</p>
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
                jobs={jobs}
                teams={teamResources}
                weekAssignments={teamWeekAssignments}
                deliveryRuns={deliveryRuns}
                onOpenJob={setSelectedId}
                onGroupsChange={saveGroups}
                onTeamsChange={saveTeamResources}
                onWeekAssignmentsChange={saveTeamWeekAssignments}
                onCreate={() => setComposer("group")}
                onJumpToDate={() => {
                  setSecondPaymentMonthFilter("");
                  setShowScheduleModal(false);
                  setView("pipeline");
                }}
                groupsWorkspace="schedule"
                onReassignTeam={() => {
                  setShowScheduleModal(false);
                  setView("groups");
                }}
                pinnedJobIds={pinnedJobIds}
                onTogglePin={togglePinJob}
              />
            </div>
          </div>
        </div>
      )}

      {showPendingModal && (
        <div className="modal-backdrop" role="presentation">
          <div
            className="pending-modal"
            role="dialog"
            aria-modal="true"
            aria-label="Pending installations monitoring"
          >
            <div className="detail-header">
              <div>
                <p className="eyebrow">Installation monitoring</p>
                <h2>Pending installations</h2>
                <p>Customers awaiting installation beyond 30 days from 2nd payment date</p>
              </div>
              <button
                className="icon-button"
                aria-label="Close"
                onClick={() => setShowPendingModal(false)}
              >
                <X size={19} />
              </button>
            </div>

            <div className="pending-modal-content">
              <div className="pending-table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>Customer / site</th>
                      <th>Agent</th>
                      <th>2nd payment date</th>
                      <th>Days since</th>
                      <th>Location</th>
                      <th>Installation date</th>
                    </tr>
                  </thead>
                  <tbody>
                    {metrics.pendingInstallation.jobs
                      .sort((a, b) => {
                        const daysA = calculateDaysSince(a.secondPaymentDate!) || 0;
                        const daysB = calculateDaysSince(b.secondPaymentDate!) || 0;
                        return daysB - daysA;
                      })
                      .map((job) => {
                        const daysSince = calculateDaysSince(job.secondPaymentDate!);
                        const rowClass =
                          daysSince && daysSince >= 90
                            ? "critical-overdue"
                            : daysSince && daysSince >= 60
                            ? "severe-overdue"
                            : "overdue";

                        return (
                          <tr key={job.id} className={`pending-row ${rowClass}`}>
                            <td>
                              <strong>{formatPersonName(job.customerName)}</strong>
                              <span>{job.invoiceNumber}</span>
                            </td>
                            <td>
                              <strong>{formatPersonName(job.agentName)}</strong>
                              <span>Sales agent</span>
                            </td>
                            <td>
                              <strong>
                                {job.secondPaymentDate
                                  ? new Intl.DateTimeFormat("en-MY", {
                                      day: "numeric",
                                      month: "short",
                                      year: "numeric",
                                    }).format(new Date(job.secondPaymentDate))
                                  : "Not recorded"}
                              </strong>
                            </td>
                            <td>
                              <strong className={`days-badge ${rowClass}`}>
                                {daysSince ? `${daysSince}d` : "—"}
                              </strong>
                            </td>
                            <td>
                              <span>{townshipForJob(job)}</span>
                            </td>
                            <td>
                              <strong className="not-scheduled">Not scheduled</strong>
                            </td>
                          </tr>
                        );
                      })}
                  </tbody>
                </table>
              </div>
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

function InstallationGroupsView({
  groups,
  jobs,
  teams,
  weekAssignments,
  deliveryRuns,
  onOpenJob,
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
}: {
  groups: InstallationGroup[];
  jobs: InstallationJob[];
  teams: TeamResource[];
  weekAssignments: TeamWeekAssignment[];
  deliveryRuns: DeliveryRun[];
  onOpenJob: (id: string) => void;
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
}) {
  const todayIso = malaysiaToday();
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
        supervisor: "",
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
        const job = jobs.find((j) => j.id === jobId);
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

  // Which team already holds each group. A customer group belongs to one team
  // only, so the picker below hides a group another team is committed to —
  // two crews turning up at the same customers is the failure this prevents,
  // and it is cheaper to make unavailable than to detect afterwards.
  const teamIdByGroupId = useMemo(() => {
    const owners = new Map<string, string>();
    weekAssignments.forEach((assignment) => {
      owners.set(assignment.installationGroupId, assignment.teamId);
    });
    return owners;
  }, [weekAssignments]);

  function heldByAnotherTeam(groupId: string, teamId: string) {
    const owner = teamIdByGroupId.get(groupId);
    return Boolean(owner) && owner !== teamId;
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
      (job.customerAvailabilityStatus === "available" ||
        job.customerAvailabilityStatus === "pending"),
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
    return deliveryRuns.filter((run) => run.installationGroupId === groupId);
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

  return (
    <div className="planning-panel">
      {groupsWorkspace === "teams" && (
        <div className="planning-heading">
          <div>
            <h2>Installation groups</h2>
            <p>Customers grouped by location and installation date.</p>
          </div>
          <div className="planning-heading-actions">
            {/* The way back into an existing group: Schedule & assign holds
                the week cards whose drawer edits dates, teams and customers. */}
            {onOpenSchedule && (
              <button className="button secondary" onClick={onOpenSchedule}>
                <CalendarDays size={16} />
                Schedule &amp; assign
              </button>
            )}
            <button className="button primary" onClick={onCreate}>
              <Plus size={16} />
              Create group
            </button>
          </div>
        </div>
      )}

      {groupsWorkspace === "teams" && (
        <section className="unified-team-management">
          <div className="group-header">
            <div>
              <h3>Team management</h3>
              <p>Manage each team, its members, and weekly locations in one row.</p>
            </div>
          </div>
          <div className="team-create-row">
            <button
              className="button primary"
              onClick={addBlankTeamResource}
            >
              Add team
            </button>
          </div>
          <div className="table-wrap unified-team-table">
            <table>
              <thead>
                <tr>
                  <th>Team</th>
                  <th>Role</th>
                  <th>Members</th>
                  <th>Site supervisor</th>
                  <th>Date &amp; time</th>
                  <th>Customer Group</th>
                  <th aria-label="Actions" />
                </tr>
              </thead>
              <tbody>
                {orderedTeams.map((team) => {
                  const rowDraft = getRowAssignmentDraft(team.id);
                  const teamAssignments = assignmentsForTeam(team.id);
                  const isEditing = editingTeamIds.has(team.id);
                  const stopWhenEditing = isEditing
                    ? (event: React.MouseEvent) => event.stopPropagation()
                    : undefined;
                  const members = team.members ?? [];
                  // "Add" moves the draft date onto the assignments and clears
                  // the draft, so a pinned row has a date even though its draft
                  // is empty. Read the committed dates first and fall back to
                  // the draft, or the Date & time column reads "Not set" for a
                  // row that plainly has one.
                  const assignedDateLabel = Array.from(
                    new Set(
                      teamAssignments
                        .map(({ assignment }) => assignment.startDate)
                        .filter(Boolean),
                    ),
                  )
                    .sort()
                    .map((startDate) => formatAssignmentStamp(startDate))
                    .join("; ");
                  return (
                    <tr
                      key={team.id}
                      className={[
                        teamAssignments.length > 0 ? "team-row-assigned" : "",
                        isEditing ? "selected" : "",
                      ]
                        .filter(Boolean)
                        .join(" ")}
                      onClick={() => toggleTeamEdit(team.id)}
                    >
                      <td onClick={stopWhenEditing}>
                        {isEditing ? (
                          <input
                            value={team.name}
                            onChange={(event) =>
                              updateTeam(team.id, { name: event.target.value })
                            }
                            aria-label={`Edit ${team.name} name`}
                          />
                        ) : (
                          <span className="run-field-readout">
                            {team.name || "Unnamed team"}
                          </span>
                        )}
                      </td>
                      <td onClick={stopWhenEditing}>
                        {isEditing ? (
                          <select
                            value={team.role}
                            onChange={(event) =>
                              updateTeam(team.id, {
                                role: event.target.value as TeamResource["role"],
                              })
                            }
                            aria-label={`${team.name} role`}
                          >
                            {TEAM_ROLES.map((item) => (
                              <option key={item.value} value={item.value}>
                                {item.label}
                              </option>
                            ))}
                          </select>
                        ) : (
                          <span className="run-field-readout">
                            {TEAM_ROLES.find((item) => item.value === team.role)
                              ?.label ?? team.role}
                          </span>
                        )}
                      </td>
                      <td onClick={stopWhenEditing}>
                        {isEditing ? (
                          <div className="member-tag-input">
                            <div className="member-tag-list">
                              {members.map((member) => (
                                <span className="member-tag" key={member}>
                                  {member}
                                  <button
                                    type="button"
                                    aria-label={`Remove ${member}`}
                                    onClick={() => removeMemberTag(team.id, member)}
                                  >
                                    <X size={12} />
                                  </button>
                                </span>
                              ))}
                            </div>
                            <div className="member-tag-add">
                              <input
                                value={memberDraft[team.id] ?? ""}
                                onChange={(event) =>
                                  setMemberDraft((prev) => ({
                                    ...prev,
                                    [team.id]: event.target.value,
                                  }))
                                }
                                onKeyDown={(event) => {
                                  if (event.key === "Enter") {
                                    event.preventDefault();
                                    addMemberTag(team.id);
                                  }
                                }}
                                placeholder="Add member name"
                                aria-label={`Add member to ${team.name}`}
                              />
                              <button
                                type="button"
                                className="icon-button"
                                aria-label={`Add member to ${team.name}`}
                                onClick={() => addMemberTag(team.id)}
                              >
                                <Plus size={14} />
                              </button>
                            </div>
                          </div>
                        ) : (
                          <span className="run-field-readout">
                            {members.length > 0
                              ? members.join(", ")
                              : "No members"}
                          </span>
                        )}
                      </td>
                      <td onClick={stopWhenEditing}>
                        {isEditing ? (
                          <input
                            value={team.siteSupervisor ?? ""}
                            onChange={(event) =>
                              updateTeam(team.id, {
                                siteSupervisor: event.target.value,
                              })
                            }
                            placeholder="Supervisor name"
                            aria-label={`${team.name} site supervisor`}
                          />
                        ) : (
                          <span className="run-field-readout">
                            {team.siteSupervisor || "Not assigned"}
                          </span>
                        )}
                      </td>
                      <td onClick={stopWhenEditing}>
                        {isEditing ? (
                          // The committed date is seeded into the input on
                          // open, so the box itself states when the team is
                          // going out — no separate line above restating it.
                          <input
                            type="datetime-local"
                            value={rowDraft.startDate}
                            onChange={(event) =>
                              updateRowAssignmentDraft(team.id, {
                                startDate: event.target.value,
                              })
                            }
                            aria-label={`${team.name} assignment date and time`}
                          />
                        ) : (
                          <span className="run-field-readout">
                            {assignedDateLabel ||
                              formatAssignmentStamp(rowDraft.startDate)}
                          </span>
                        )}
                      </td>
                      <td onClick={stopWhenEditing}>
                        {!isEditing ? (
                          <span className="run-field-readout">
                            {teamAssignments.length > 0
                              ? teamAssignments
                                  .map(({ assignment, group }) => {
                                    const customers = groupCustomerNames(group);
                                    return `${group?.name || "Group removed"}${
                                      assignment.startDate
                                        ? ` · ${formatAssignmentStamp(assignment.startDate)}`
                                        : ""
                                    }${
                                      customers.length
                                        ? ` — ${customers.join(", ")}`
                                        : ""
                                    }`;
                                  })
                                  .join("; ")
                              : "No groups assigned"}
                          </span>
                        ) : (
                          // The assigned group is seeded into the picker on
                          // open and reads out of its own box, so there is no
                          // chip list above it. Clearing goes through Unpin in
                          // the actions column, which releases the assignment
                          // back into these fields.
                          <div className="row-actions">
                          <GroupMultiSelect
                            single
                            emptyLabel="Every group is taken"
                            ariaLabel={`${team.name} assigned installation group`}
                            selectedIds={rowDraft.installationGroupIds}
                            onChange={(installationGroupIds) =>
                              updateRowAssignmentDraft(team.id, {
                                installationGroupIds,
                              })
                            }
                            sections={[
                              {
                                label: "Existing groups",
                                // A group put back by removing its chip has to
                                // stay selectable even if it no longer holds an
                                // Available/Pending customer, otherwise the
                                // picker would show a selection it cannot name.
                                // The same reason keeps this row's own draft
                                // exempt from the other-team filter.
                                options: groups
                                  .filter(
                                    (group) =>
                                      rowDraft.installationGroupIds.includes(
                                        group.id,
                                      ) ||
                                      (availabilityReadyGroups.some(
                                        (ready) => ready.id === group.id,
                                      ) &&
                                        !heldByAnotherTeam(group.id, team.id)),
                                  )
                                  .map((group) => ({
                                    id: group.id,
                                    label: groupOptionLabel(group),
                                  })),
                              },
                              {
                                label: "Available customers not yet grouped",
                                options: liveGroupSuggestions
                                  .filter(
                                    (suggestion) =>
                                      !heldByAnotherTeam(suggestion.id, team.id),
                                  )
                                  .map((suggestion) => ({
                                    id: suggestion.id,
                                    label: suggestionOptionLabel(suggestion),
                                  })),
                              },
                            ]}
                          />
                          <button
                            className="button primary"
                            onClick={() => addRowWeekAssignment(team.id)}
                            // Exactly one: zero is nothing to commit, and more
                            // than one only happens on a row assigned before
                            // the one-group rule — that has to be narrowed to
                            // a choice here rather than silently truncated.
                            disabled={
                              !rowDraft.startDate ||
                              rowDraft.installationGroupIds.length !== 1
                            }
                          >
                            {teamAssignments.length > 0 ? "Replace" : "Add"}
                          </button>
                          </div>
                        )}
                      </td>
                      <td onClick={stopWhenEditing}>
                        {isEditing && (
                          <div className="row-actions">
                            {/* Every cell stops the click from reaching the row
                                while editing — otherwise a stray click inside a
                                field would collapse the row mid-edit — so this
                                is the way back to read view, not a dead pixel
                                hunt. */}
                            <button
                              className="button primary"
                              aria-label={`Finish editing ${team.name}`}
                              onClick={() => toggleTeamEdit(team.id)}
                            >
                              Done
                            </button>
                            {/* Releases the team's assignments back into its
                                edit row — it does not delete the team. Also
                                the way a group is cleared now that the fields
                                hold the assignment and no chip carries an X.
                                Icon-only, so the label lives on aria-label and
                                the title tooltip rather than in the button. */}
                            <button
                              className="button secondary"
                              aria-label={`Unpin ${team.name} assignments for editing`}
                              title={`Unpin ${team.name} assignments for editing`}
                              disabled={teamAssignments.length === 0}
                              onClick={() => unpinTeamAssignments(team.id)}
                            >
                              <PinOff size={14} />
                            </button>
                          </div>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
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
          installationOptions={installationOptions}
          wiringOptions={wiringOptions}
          calendarWeather={calendarWeather}
          deliveryRunsForGroup={deliveryRunsForGroup}
          onUpdateGroup={updateGroup}
          onRemoveGroup={(id) =>
            onGroupsChange(groups.filter((item) => item.id !== id))
          }
          onOpenJob={onOpenJob}
          onClose={() => setOpenGroupId(null)}
          pinnedJobIds={pinnedJobIds}
          onTogglePin={onTogglePin}
        />
      )}
    </div>
  );
}

function WeekGroupCard({
  group,
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
  calendarWeather: Record<string, { rainProbability: number; weatherCode: number }>;
  deliveryRunsForGroup: (groupId: string) => DeliveryRun[];
  onOpenDrawer: () => void;
  onOpenCalendar: () => void;
  onReassignTeam: () => void;
  pinnedJobIds: Set<string>;
}) {
  const staffing = groupStaffing(group);
  const linkedJobs = jobs.filter(
    (job) =>
      group.jobIds.includes(job.id) &&
      !isCompleteInstallation(job, malaysiaToday()),
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
        <h4>Stock delivery</h4>
        {runs.length === 0 ? (
          <p className="week-group-card-empty">No delivery run linked yet.</p>
        ) : (
          runs.map((run) => (
            <div className="week-group-card-delivery" key={run.id}>
              <div>
                <strong>{run.name}</strong>
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
  jobs,
  installationOptions,
  wiringOptions,
  calendarWeather,
  deliveryRunsForGroup,
  onUpdateGroup,
  onRemoveGroup,
  onOpenJob,
  onClose,
  pinnedJobIds,
  onTogglePin,
}: {
  group: InstallationGroup;
  jobs: InstallationJob[];
  installationOptions: TeamResource[];
  wiringOptions: TeamResource[];
  calendarWeather: Record<string, { rainProbability: number; weatherCode: number }>;
  deliveryRunsForGroup: (groupId: string) => DeliveryRun[];
  onUpdateGroup: (id: string, update: Partial<InstallationGroup>) => void;
  onRemoveGroup: (id: string) => void;
  onOpenJob: (id: string) => void;
  onClose: () => void;
  pinnedJobIds: Set<string>;
  onTogglePin: (id: string) => void;
}) {
  const staffing = groupStaffing(group);
  const runs = deliveryRunsForGroup(group.id);
  const linkedJobs = jobs.filter(
    (job) =>
      group.jobIds.includes(job.id) &&
      !isCompleteInstallation(job, malaysiaToday()),
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
            <input
              value={group.supervisor}
              onChange={(event) =>
                onUpdateGroup(group.id, { supervisor: event.target.value })
              }
              placeholder="Supervisor"
            />
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
                    <button
                      className="text-button"
                      onClick={() => onOpenJob(job.id)}
                    >
                      {formatPersonName(job.customerName)}
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        <div className="group-drawer-section">
          <h4>Stock delivery</h4>
          {runs.length === 0 ? (
            <p className="group-drawer-empty">No delivery run linked yet.</p>
          ) : (
            runs.map((run) => (
              <div className="group-drawer-row" key={run.id}>
                <span>{run.name}</span>
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
  jobs,
  planningFilter,
  onPlanningFilterChange,
  postcodeFilter,
  onPostcodeFilterChange,
  secondPaymentMonthFilter,
  onSecondPaymentMonthFilterChange,
  customerNameFilter,
  onCustomerNameFilterChange,
  onUpdateJob,
  manuallyPinnedJobIds,
  onTogglePin,
}: {
  groups: InstallationGroup[];
  jobs: InstallationJob[];
  planningFilter: string;
  onPlanningFilterChange: (next: string) => void;
  postcodeFilter: string;
  onPostcodeFilterChange: (next: string) => void;
  secondPaymentMonthFilter: string;
  onSecondPaymentMonthFilterChange: (next: string) => void;
  customerNameFilter: string;
  onCustomerNameFilterChange: (next: string) => void;
  onUpdateJob: (job: InstallationJob) => void;
  manuallyPinnedJobIds: Set<string>;
  onTogglePin: (id: string) => void;
}) {
  const [rangeKm, setRangeKm] = useState(20);
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
  const groupByJobId = useMemo(() => {
    const result = new Map<string, InstallationGroup>();
    groups.forEach((group) =>
      group.jobIds.forEach((jobId) => result.set(jobId, group)),
    );
    return result;
  }, [groups]);

  // The same predicate the Customer details page runs, so "Need Attention"
  // there and here can never disagree about which jobs qualify.
  const planningTodayIso = malaysiaToday();

  function matchesPlanningStatus(job: InstallationJob) {
    return matchesPipelineStage(job, planningFilter, planningTodayIso);
  }

  // Whole-month match: the filter holds "YYYY-MM" and dates are ISO "YYYY-MM-DD",
  // so a prefix test covers the month without parsing or timezone drift. Undated
  // customers can never match, so they drop out while the filter is set.
  function matchesSecondPaymentMonth(job: InstallationJob) {
    return (
      !secondPaymentMonthFilter ||
      Boolean(job.secondPaymentDate?.startsWith(secondPaymentMonthFilter))
    );
  }

  const readyJobs = jobs.filter(
    (job) =>
      hasPlanningEligibility(job) &&
      !isCompleteInstallation(job, planningTodayIso) &&
      !isOutOfPlanning(job) &&
      matchesSecondPaymentMonth(job) &&
      matchesPlanningStatus(job),
  );
  const filteredPlanningJobIds = new Set(
    jobs
      .filter(
        (job) =>
          hasPlanningEligibility(job) &&
          matchesPlanningStatus(job) &&
          !isCompleteInstallation(job, planningTodayIso) &&
          !isOutOfPlanning(job) &&
          matchesSecondPaymentMonth(job),
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
            .map((jobId) => jobs.find((job) => job.id === jobId))
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
    const matching = displayedSuggestions
      .filter(
        (suggestion) =>
          !postcodeSearch ||
          suggestion.postcode.toLowerCase().includes(postcodeSearch),
      )
      .filter(
        (suggestion) =>
          !nameSearch ||
          suggestion.customers.some((customer) =>
            customer.customerName?.toLowerCase().includes(nameSearch),
          ),
      );

    // Every group takes its place by 2nd payment date, so working top-down
    // always reaches the longest-waiting customers first.
    return matching;
  }, [displayedSuggestions, postcodeFilter, customerNameFilter]);

  // Available and Pending customers pin to the top of the table, ahead of
  // every location group, so the people who confirmed (or nearly confirmed)
  // their availability are never buried below customers nobody has reached
  // yet. Available leads Pending within the pinned block; each customer
  // keeps a reference to its original suggestion so the map focus and "which
  // town is this" context still work once it's pulled out of its group.
  // Rank decides both which customers pin and the order they pin in: already
  // in an installation group first (they are the committed work and must stay
  // reachable for rescheduling), then Available, then Pending. Everyone else
  // stays down in their town group.
  function pinRank(job: InstallationJob) {
    if (groupByJobId.has(job.id)) return 0;
    if (job.customerAvailabilityStatus === "available") return 1;
    if (job.customerAvailabilityStatus === "pending") return 2;
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
  }, [filteredSuggestions, groupByJobId]);

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
          !isOutOfPlanning(job) &&
          !isCompleteInstallation(job, planningTodayIso) &&
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
    if (!addCustomerId || suggestion.customers.length >= 5) return;
    saveSuggestionDraft(suggestion.id, [
      ...suggestion.customers.map((customer) => customer.id),
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
          <span
            className="customer-name-hover-target"
            onMouseEnter={() => setHighlightedMapCustomerId(job.id)}
          >
            <strong>{formatPersonName(job.customerName)}</strong>
          </span>
          <span className="phone-number">
            <Phone size={13} />
            {formatPhoneNumber(job.customerPhone)}
          </span>
          {job.paymentPercent < 59 && (
            <span className="special-case-label">
              Special case · Management approval required
            </span>
          )}
        </td>
        <td className="suggestion-address-cell">
          {job.address
            ? formatCustomerAddress(job.address)
            : "Address not available"}
        </td>
        <td>{job.paymentPercent.toFixed(0)}%</td>
        <td>
          {job.secondPaymentDate
            ? new Intl.DateTimeFormat("en-MY", {
                day: "numeric",
                month: "short",
                year: "numeric",
                timeZone: "Asia/Kuala_Lumpur",
              }).format(new Date(job.secondPaymentDate))
            : "Not recorded"}
        </td>
        <td>
          {isEditing ? (
            <select
              value={job.customerAvailabilityStatus}
              onClick={(event) => event.stopPropagation()}
              aria-label={`Customer availability for ${job.customerName}`}
              onChange={(event) => {
                const status = event.target
                  .value as InstallationJob["customerAvailabilityStatus"];
                onUpdateJob({
                  ...job,
                  customerAvailabilityStatus: status,
                });
              }}
            >
              <option value="not_set">Not set</option>
              <option value="pending">Pending confirmation</option>
              <option value="available">Available</option>
              <option value="unavailable">Not available</option>
              <option value="cancelled">Cancellation</option>
            </select>
          ) : (
            <span className="run-field-readout">
              {availabilityLabels[job.customerAvailabilityStatus]}
            </span>
          )}
        </td>
        <td>
          {isEditing ? (
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
          ) : (
            <span className="run-field-readout">
              {formatDateOnly(job.preferredInstallationDate)}
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

  return (
    <div className="planning-panel team-planning-panel">
      <div className="planning-heading">
        <div>
          <h2>Customer Scheduling</h2>
          <p>Find ready customers and suggest location groups for team planning.</p>
        </div>
        <div className="planning-filters">
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
            Customer name
            <input
              type="search"
              placeholder="e.g. Tan Wei Ming"
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
            2nd payment month
            <input
              type="month"
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
        <div className="team-planning-workspace">
          <PlanningMap
            focusGroupId={mapFocusGroupId}
            highlightedGroupId={highlightedMapGroupId}
            highlightedCustomerId={highlightedMapCustomerId}
            groups={planningMapGroups}
          />
          <div className="table-wrap team-planning-table">
            <table>
            <thead>
              <tr>
                <th>Town</th>
                <th>Customer</th>
                <th>Address</th>
                <th>Payment</th>
                <th>2nd payment date</th>
                <th>Customer availability</th>
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
                const job =
                  jobs.find((candidate) => candidate.id === snapshotJob.id) ||
                  snapshotJob;
                return (
                  <tr
                    key={job.id}
                    className={`team-planning-pinned-row ${
                      group
                        ? "status-grouped"
                        : `status-${job.customerAvailabilityStatus}`
                    }`}
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
                const canAddMore = suggestion.customers.length < 5;
                const addingHere = addingToSuggestionId === suggestion.id;
                return suggestion.customers.map((snapshotJob, index) => {
                  // `suggestion.customers` already comes from the live `jobs`
                  // array (there is no snapshot to go stale here), but a job
                  // just edited elsewhere on the page may not have flowed
                  // through the suggestion memo yet — look it up fresh so an
                  // edit never appears to revert for a render or two.
                  const job =
                    jobs.find((candidate) => candidate.id === snapshotJob.id) ||
                    snapshotJob;
                  return (
                    <tr
                      key={job.id}
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
                                        {customer.paymentPercent < 59
                                          ? " · Special case"
                                          : ""}
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

function DeliveryPlanningView({
  runs,
  jobs,
  onChange,
  onUpdateJob,
  onCreate,
  pinnedJobIds,
  onTogglePin,
}: {
  runs: DeliveryRun[];
  jobs: InstallationJob[];
  onChange: (runs: DeliveryRun[]) => void;
  onUpdateJob: (job: InstallationJob) => void;
  onCreate: () => void;
  pinnedJobIds: Set<string>;
  onTogglePin: (id: string) => void;
}) {
  const todayIso = malaysiaToday();
  const [stockDraft, setStockDraft] = useState<Record<string, string>>({});
  // Each run's fields start read-only; clicking its row (on anything but an
  // input/select/button, which stop the click from bubbling) toggles that one
  // run in or out of this set — independent of every other run's state.
  const [editingRunIds, setEditingRunIds] = useState<Set<string>>(new Set());
  const [etaFeedback, setEtaFeedback] = useState<Record<string, EtaFeedback>>({});

  async function calculateEtas(run: DeliveryRun) {
    const runJobs = jobs.filter(
      (job) => run.jobIds.includes(job.id) && !isCompleteInstallation(job, todayIso),
    );

    if (!run.warehouseAddress?.trim()) {
      setEtaFeedback((prev) => ({
        ...prev,
        [run.id]: {
          busy: false,
          failed: true,
          message: "Enter the warehouse address first.",
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
          message: "This run has no customers to route to.",
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
          warehouseAddress: run.warehouseAddress,
          deliveryDate: run.deliveryDate,
          departureTime: run.departureTime || "09:00",
          // Array order is the delivery order the chain is built from.
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
          // A straight-line estimate is a materially weaker number than a real
          // road route, so it is flagged rather than reported as a plain success.
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

  function toggleRunEdit(id: string) {
    setEditingRunIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
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

  if (runs.length === 0) {
    return (
      <div className="planning-panel empty-state">
        <Truck />
        <p>Create an empty delivery run, then link customers from Customer details.</p>
        <button className="button primary" onClick={onCreate}>
          Create delivery run
        </button>
      </div>
    );
  }

  return (
    <div className="planning-panel">
      <div className="planning-heading">
        <div>
          <h2>Stock delivery</h2>
          <p>Group customer materials into warehouse delivery routes.</p>
        </div>
        <button className="button primary" onClick={onCreate}>
          <Truck size={16} />
          Create delivery run
        </button>
      </div>
      {runs.map((run) => {
        const isEditing = editingRunIds.has(run.id);
        const feedback = etaFeedback[run.id];
        return (
          <section className="planning-group" key={run.id}>
            <div className="run-route-bar">
              <label className="run-route-address">
                <span>Warehouse address</span>
                <input
                  value={run.warehouseAddress ?? ""}
                  onChange={(event) =>
                    updateRun(run.id, { warehouseAddress: event.target.value })
                  }
                  placeholder="e.g. 15 Jalan Kenanga 1/6, Taman Desa Cemerlang, 81800 Ulu Tiram, Johor"
                  aria-label="Warehouse address"
                />
              </label>
              <button
                type="button"
                className="button secondary"
                onClick={() => void calculateEtas(run)}
                disabled={feedback?.busy}
              >
                {feedback?.busy ? (
                  <LoaderCircle size={15} className="spin" />
                ) : (
                  <MapPin size={15} />
                )}
                {feedback?.busy ? "Calculating…" : "Calculate ETAs"}
              </button>
              {feedback?.message && (
                <span
                  className={
                    feedback.failed
                      ? "run-route-note failed"
                      : "run-route-note"
                  }
                  role={feedback.failed ? "alert" : undefined}
                >
                  {feedback.message}
                </span>
              )}
            </div>
            <div className="table-wrap">
              <table className="delivery-run-customers">
                <thead>
                  <tr>
                    <th>Run name</th>
                    <th>Status</th>
                    <th>Delivery date &amp; departure</th>
                    <th>Warehouse</th>
                    <th>Delivery PIC</th>
                    <th>Contact number</th>
                    <th aria-label="Pin"></th>
                    <th>Customer</th>
                    <th>Location</th>
                    <th>Stock details</th>
                    <th>ETA</th>
                    <th aria-label="Actions"></th>
                  </tr>
                </thead>
                <tbody>
                  {(() => {
                    // One row per customer carrying the whole run: the run
                    // fields are rendered once and spanned down the rows, so
                    // each line reads run + customer end to end. Completed
                    // installations drop out of the list entirely — once
                    // every customer in a run is done, the run itself
                    // collapses to a single note rather than an empty table.
                    const runJobs = jobs.filter(
                      (job) =>
                        run.jobIds.includes(job.id) &&
                        !isCompleteInstallation(job, todayIso),
                    );
                    if (runJobs.length === 0) {
                      return (
                        <tr>
                          <td colSpan={12} className="run-all-complete">
                            All customers in this run have completed installation.
                          </td>
                        </tr>
                      );
                    }
                    return runJobs.map((job, index) => (
                      <tr
                        key={job.id}
                        className={isEditing ? "selected" : undefined}
                        onClick={() => toggleRunEdit(run.id)}
                      >
                        {index === 0 && (
                          <td
                            rowSpan={runJobs.length}
                            className="run-field-cell"
                            onClick={isEditing ? (event) => event.stopPropagation() : undefined}
                          >
                            {isEditing ? (
                              <input
                                value={run.name}
                                onChange={(event) =>
                                  updateRun(run.id, { name: event.target.value })
                                }
                                aria-label="Delivery run name"
                              />
                            ) : (
                              <span className="run-field-readout">
                                {run.name || "Unnamed run"}
                              </span>
                            )}
                          </td>
                        )}
                        {index === 0 && (
                          <td
                            rowSpan={runJobs.length}
                            className="run-field-cell"
                            onClick={isEditing ? (event) => event.stopPropagation() : undefined}
                          >
                            {isEditing ? (
                              <select
                                value={run.status}
                                onChange={(event) =>
                                  updateRun(run.id, {
                                    status: event.target.value as DeliveryRun["status"],
                                  })
                                }
                                aria-label="Delivery run status"
                              >
                                <option value="pending_stock">Pending stock</option>
                                <option value="ready">Ready</option>
                                <option value="in_transit">In transit</option>
                                <option value="delivered">Delivered</option>
                              </select>
                            ) : (
                              <span className="run-field-readout">
                                {DELIVERY_RUN_STATUS_LABELS[run.status]}
                              </span>
                            )}
                          </td>
                        )}
                        {index === 0 && (
                          <td
                            rowSpan={runJobs.length}
                            className="run-field-cell"
                            onClick={isEditing ? (event) => event.stopPropagation() : undefined}
                          >
                            {isEditing ? (
                              <div className="delivery-date-pair">
                                <input
                                  type="date"
                                  value={run.deliveryDate}
                                  onChange={(event) =>
                                    updateRun(run.id, { deliveryDate: event.target.value })
                                  }
                                  aria-label="Delivery date"
                                />
                                <input
                                  type="time"
                                  value={run.departureTime || "09:00"}
                                  onChange={(event) =>
                                    updateRun(run.id, { departureTime: event.target.value })
                                  }
                                  aria-label="Departure time from warehouse"
                                  title="Time the lorry leaves the warehouse — each customer's ETA counts up from here."
                                />
                              </div>
                            ) : (
                              <span className="run-field-readout">
                                {run.deliveryDate || "Date not arranged"} ·{" "}
                                {run.departureTime || "09:00"}
                              </span>
                            )}
                          </td>
                        )}
                        {index === 0 && (
                          <td
                            rowSpan={runJobs.length}
                            className="run-field-cell"
                            onClick={isEditing ? (event) => event.stopPropagation() : undefined}
                          >
                            {isEditing ? (
                              <input
                                value={run.warehouse}
                                onChange={(event) =>
                                  updateRun(run.id, { warehouse: event.target.value })
                                }
                                aria-label="Warehouse"
                              />
                            ) : (
                              <span className="run-field-readout">
                                {run.warehouse || "Not selected"}
                              </span>
                            )}
                          </td>
                        )}
                        {index === 0 && (
                          <td
                            rowSpan={runJobs.length}
                            className="run-field-cell"
                            onClick={isEditing ? (event) => event.stopPropagation() : undefined}
                          >
                            {isEditing ? (
                              <input
                                value={run.deliveryPic || ""}
                                onChange={(event) =>
                                  updateRun(run.id, { deliveryPic: event.target.value })
                                }
                                aria-label="Delivery PIC"
                              />
                            ) : (
                              <span className="run-field-readout">
                                {run.deliveryPic || "Not assigned"}
                              </span>
                            )}
                          </td>
                        )}
                        {index === 0 && (
                          <td
                            rowSpan={runJobs.length}
                            className="run-field-cell"
                            onClick={isEditing ? (event) => event.stopPropagation() : undefined}
                          >
                            {isEditing ? (
                              <input
                                type="tel"
                                value={run.contactNumber || ""}
                                onChange={(event) =>
                                  updateRun(run.id, { contactNumber: event.target.value })
                                }
                                aria-label="Contact number"
                              />
                            ) : (
                              <span className="run-field-readout">
                                {formatPhoneNumber(run.contactNumber || "")}
                              </span>
                            )}
                          </td>
                        )}
                        <td className="pin-cell" onClick={(event) => event.stopPropagation()}>
                          <button
                            type="button"
                            className={`icon-button pin-toggle ${pinnedJobIds.has(job.id) ? "is-pinned" : ""}`}
                            aria-label={pinnedJobIds.has(job.id) ? "Unpin row" : "Pin row to top"}
                            aria-pressed={pinnedJobIds.has(job.id)}
                            onClick={(event) => {
                              event.stopPropagation();
                              onTogglePin(job.id);
                            }}
                          >
                            {pinnedJobIds.has(job.id) ? <Pin size={14} /> : <PinOff size={14} />}
                          </button>
                        </td>
                        <td><strong>{job.customerName}</strong><span>{job.invoiceNumber}</span></td>
                        <td>{job.city || job.state || "Not available"}</td>
                        <td onClick={isEditing ? (event) => event.stopPropagation() : undefined}>
                          {isEditing ? (
                            <div className="member-tag-input">
                              <div className="member-tag-list">
                                {stockTags(job).map((item) => (
                                  <span className="member-tag" key={item}>
                                    {item}
                                    <button
                                      type="button"
                                      aria-label={`Remove ${item}`}
                                      onClick={() => removeStockTag(job, item)}
                                    >
                                      <X size={12} />
                                    </button>
                                  </span>
                                ))}
                              </div>
                              <div className="member-tag-add">
                                <input
                                  value={stockDraft[job.id] ?? ""}
                                  onChange={(event) =>
                                    setStockDraft((prev) => ({
                                      ...prev,
                                      [job.id]: event.target.value,
                                    }))
                                  }
                                  onKeyDown={(event) => {
                                    if (event.key === "Enter") {
                                      event.preventDefault();
                                      addStockTag(job);
                                    }
                                  }}
                                  placeholder="Add stock item"
                                  aria-label={`Add stock item for ${job.customerName}`}
                                />
                                <button
                                  type="button"
                                  className="icon-button"
                                  aria-label={`Add stock item for ${job.customerName}`}
                                  onClick={() => addStockTag(job)}
                                >
                                  <Plus size={14} />
                                </button>
                              </div>
                            </div>
                          ) : (
                            <span className="run-field-readout">
                              {stockTags(job).length > 0
                                ? stockTags(job).join(", ")
                                : "No stock details"}
                            </span>
                          )}
                        </td>
                        {/* Estimated arrival at the customer's address. Falls
                            back to the run's delivery date/departure time
                            until someone gives this customer their own, the
                            same way a job's installation date falls back to
                            its group's. The fallback is shown, not saved:
                            leaving the row alone keeps arrivalDate/arrivalTime
                            null, so moving the run's date or departure time
                            carries every un-estimated stop along with it. */}
                        <td onClick={isEditing ? (event) => event.stopPropagation() : undefined}>
                          {isEditing ? (
                            <div className="delivery-date-pair">
                              <input
                                type="date"
                                className={job.arrivalDate ? "" : "is-inherited"}
                                value={job.arrivalDate ?? run.deliveryDate ?? ""}
                                onChange={(event) =>
                                  onUpdateJob({
                                    ...job,
                                    arrivalDate: event.target.value || null,
                                  })
                                }
                                aria-label={`Estimated arrival date for ${job.customerName}`}
                                title={
                                  job.arrivalDate
                                    ? "Estimated for this customer. Clear it to go back to the run's delivery date."
                                    : "Taken from the delivery run. Set a date here to estimate this stop on its own."
                                }
                              />
                              <input
                                type="time"
                                className={job.arrivalTime ? "" : "is-inherited"}
                                value={job.arrivalTime ?? run.departureTime ?? "09:00"}
                                onChange={(event) =>
                                  onUpdateJob({
                                    ...job,
                                    arrivalTime: event.target.value || null,
                                  })
                                }
                                aria-label={`Estimated arrival time for ${job.customerName}`}
                                title={
                                  job.arrivalTime
                                    ? "Estimated for this customer. Clear it to go back to the run's departure time."
                                    : "Taken from the delivery run's departure time. Set a time here to estimate this stop on its own."
                                }
                              />
                            </div>
                          ) : (
                            <span className="run-field-readout">
                              {job.arrivalDate ?? run.deliveryDate ?? "Not set"} ·{" "}
                              {job.arrivalTime ?? run.departureTime ?? "09:00"}
                            </span>
                          )}
                        </td>
                        {index === 0 && (
                          <td
                            rowSpan={runJobs.length}
                            onClick={(event) => event.stopPropagation()}
                          >
                            <div className="row-actions">
                              {/* Editable cells stop the click from reaching the
                                  row, so leaving edit mode needs its own control
                                  rather than depending on finding a cell that
                                  happens not to swallow it. */}
                              {isEditing && (
                                <button
                                  type="button"
                                  className="button primary"
                                  aria-label={`Finish editing delivery run ${run.name}`}
                                  onClick={() => toggleRunEdit(run.id)}
                                >
                                  Done
                                </button>
                              )}
                              <button
                                type="button"
                                className="button secondary"
                                aria-label={`Remove delivery run ${run.name}`}
                                onClick={() =>
                                  onChange(runs.filter((item) => item.id !== run.id))
                                }
                              >
                                Remove
                              </button>
                            </div>
                          </td>
                        )}
                      </tr>                    ));
                  })()}
                </tbody>
              </table>
            </div>
          </section>
        );
      })}
    </div>
  );
}
