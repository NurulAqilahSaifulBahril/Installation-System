"use client";

import {
  AlertTriangle,
  Ban,
  CalendarDays,
  CalendarOff,
  Check,
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
  Package,
  Moon,
  PackageCheck,
  Phone,
  Plus,
  RefreshCw,
  Search,
  Settings,
  Sun,
  TrendingDown,
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
  InstallationJob,
  JobUpdate,
  TeamAssignment,
} from "@/lib/types";
import type { UpdateStatus } from "@/lib/electron-desktop";

const PlanningMap = dynamic(() => import("@/app/components/PlanningMap"), {
  ssr: false,
});

type JobsResponse = {
  jobs: InstallationJob[];
  source: "live" | "demo";
  persistence: "api-db" | "browser";
  warning: string | null;
  syncedAt: string;
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
  warehouse: string;
  deliveryTeam: string;
  deliveryPic: string;
  contactNumber: string;
  installationGroupId: string;
  status: "pending_stock" | "ready" | "in_transit" | "delivered";
  jobIds: string[];
};

type TeamResource = {
  id: string;
  name: string;
  role: "installation" | "wiring";
  baseLocation: string;
  contact: string;
  members: string[];
};

type TeamWeekAssignment = {
  id: string;
  teamId: string;
  startDate: string;
  endDate: string;
  installationGroupId: string;
};

const STORAGE_KEY = "installation-ops-updates-v1";
const GROUPS_STORAGE_KEY = "installation-ops-groups-v1";
const DELIVERY_RUNS_STORAGE_KEY = "installation-ops-delivery-runs-v1";
const TEAMS_STORAGE_KEY = "installation-ops-team-resources-v1";
const TEAM_WEEKS_STORAGE_KEY = "installation-ops-team-weeks-v1";
const TEAM_SUGGESTIONS_STORAGE_KEY = "installation-ops-team-suggestions-v1";
const AVAILABLE_SUGGESTIONS_STORAGE_KEY =
  "installation-ops-available-suggestions-v1";
const THEME_STORAGE_KEY = "installation-ops-theme";
const SIDEBAR_STORAGE_KEY = "installation-ops-sidebar";

function formatPersonName(name: string) {
  return name
    .trim()
    .toLocaleLowerCase("en-MY")
    .replace(/(^|[\s(/'-])\p{L}/gu, (letter) => letter.toLocaleUpperCase("en-MY"));
}

function formatCustomerAddress(address: string) {
  return address ? formatPersonName(address) : address;
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

const availabilityLabels: Record<
  InstallationJob["customerAvailabilityStatus"],
  string
> = {
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
    label: "DC & AC cable trunking / casing / conduit works",
  },
  {
    value: "earthing",
    label: "Earthing cable mounted to PV structure",
  },
  { value: "other", label: "Other activity" },
];

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

function isReady(job: InstallationJob) {
  return (
    job.paymentPercent >= 59 &&
    normalizeSeda(job.sedaStatus) === "Approved" &&
    job.deliveryStatus === "delivered" &&
    job.customerAvailabilityStatus === "available" &&
    Boolean(job.installationDate) &&
    job.teams.length > 0
  );
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

type AvailableSuggestion = {
  id: string;
  label: string;
  jobIds: string[];
};

type SharedOpsState = {
  groups: InstallationGroup[];
  deliveryRuns: DeliveryRun[];
  teamResources: TeamResource[];
  teamWeekAssignments: TeamWeekAssignment[];
  // Towns marked available on the Team planning page. Pinned to the top of
  // that table, and shared so the whole team sees the same shortlist. The
  // label and member ids are stored alongside the id so the pipeline can show
  // the town in a customer's Location / group without recomputing suggestions.
  availableSuggestions: AvailableSuggestion[];
  jobUpdates: Record<string, JobUpdate>;
};

// An earlier build stored bare suggestion ids here. Those carry no label or
// member list, so they are dropped rather than rendered as a half-populated
// pin; the town simply needs marking available again.
function normalizeAvailableSuggestions(value: unknown): AvailableSuggestion[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry) => {
    if (typeof entry !== "object" || entry === null) return [];
    const { id, label, jobIds } = entry as Partial<AvailableSuggestion>;
    if (typeof id !== "string") return [];
    return [
      {
        id,
        label: typeof label === "string" && label ? label : id,
        jobIds: Array.isArray(jobIds)
          ? jobIds.filter((jobId): jobId is string => typeof jobId === "string")
          : [],
      },
    ];
  });
}

function readLocalJson<T>(key: string, fallback: T): T {
  try {
    const raw = window.localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

// The shared store lives on the dashboard server (data/ops-state.json), so
// every browser and device on the network sees the same planning data.
// localStorage remains a per-browser backup used only when the server call
// fails mid-session.
function persistOps(patch: Partial<SharedOpsState>) {
  void fetch("/api/ops-state", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(patch),
  }).catch(() => {
    // Server unreachable; the localStorage mirror keeps the data locally.
  });
}

export default function DashboardPage() {
  const [view, setView] = useState<DashboardView>("pipeline");
  // Schedule & assign is no longer a tab on the groups page; it opens as a
  // modal from the "Dates arranged" card.
  const [showScheduleModal, setShowScheduleModal] = useState(false);
  const [jobs, setJobs] = useState<InstallationJob[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState("active");
  const [stateFilter, setStateFilter] = useState("all");
  const [installationDateFilter, setInstallationDateFilter] = useState("");
  const [monthFilter, setMonthFilter] = useState(() => {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
  });
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
  const [availableSuggestions, setAvailableSuggestions] = useState<
    AvailableSuggestion[]
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

  const applySharedState = useCallback((state: SharedOpsState) => {
    setGroups(state.groups);
    setDeliveryRuns(state.deliveryRuns);
    setTeamResources(
      state.teamResources.length ? state.teamResources : defaultTeamResources,
    );
    setTeamWeekAssignments(state.teamWeekAssignments);
    setAvailableSuggestions(
      normalizeAvailableSuggestions(state.availableSuggestions),
    );
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
        availableSuggestions: normalizeAvailableSuggestions(
          readLocalJson(AVAILABLE_SUGGESTIONS_STORAGE_KEY, []),
        ),
        jobUpdates: readLocalJson(STORAGE_KEY, {}),
      };
      try {
        const response = await fetch("/api/ops-state", { cache: "no-store" });
        if (!response.ok) throw new Error("ops-state unavailable");
        const data = (await response.json()) as {
          exists: boolean;
          state: SharedOpsState;
        };
        if (data.exists) {
          applySharedState(data.state);
        } else {
          // First run against this server: seed the shared store with this
          // browser's existing data so nothing already planned is lost.
          if (seedIfMissing) persistOps(local);
          applySharedState(local);
        }
      } catch {
        // Server unreachable; fall back to this browser's own copy.
        applySharedState(local);
      }
    },
    [applySharedState],
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

  const loadJobs = useCallback(async (manual = false) => {
    manual ? setSyncing(true) : setLoading(true);
    setNotice(null);
    try {
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
      });
      if (manual) {
        setNotice(`Source refreshed. ${merged.length} eligible jobs found.`);
      }
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Dashboard failed to load.");
    } finally {
      setLoading(false);
      setSyncing(false);
    }
  }, []);

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

  // Jobs without an installation date yet (own date or their group's) always
  // pass the month filter — there's no month to compare against. Only jobs
  // scheduled for a different month get excluded. Team planning candidates
  // are almost always in this "always passes" bucket since they have no date
  // yet.
  const monthFilteredJobs = useMemo(() => {
    if (!monthFilter) return jobs;
    return jobs.filter((job) => {
      const effectiveDate =
        job.installationDate || groupByJobId.get(job.id)?.installationDate;
      return !effectiveDate || effectiveDate.slice(0, 7) === monthFilter;
    });
  }, [jobs, monthFilter, groupByJobId]);

  const filteredJobs = useMemo(() => {
    const needle = query.toLowerCase().trim();
    return monthFilteredJobs.filter((job) => {
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
      const matchesInstallationDate =
        !installationDateFilter ||
        job.installationDate === installationDateFilter;
      const matchesStatus =
        (status === "active" &&
          (job.paymentPercent >= 59 ||
            job.paymentOverrideStatus === "pending" ||
            job.paymentOverrideStatus === "approved")) ||
        (status === "new" && job.scheduleStatus === "ready_to_schedule") ||
        (status === "attention" &&
          (job.scheduleStatus === "pending_approval" ||
            job.deliveryStatus === "pending_stock")) ||
        (status === "ready" && isReady(job)) ||
        (status === "special" &&
          job.paymentPercent < 59 &&
          job.paymentOverrideStatus === "approved") ||
        (status === "installed" && job.scheduleStatus === "installed");
      return (
        matchesQuery &&
        matchesState &&
        matchesInstallationDate &&
        matchesStatus
      );
    }).sort((a, b) => {
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
  }, [monthFilteredJobs, query, stateFilter, status, installationDateFilter]);

  const selected = jobs.find((job) => job.id === selectedId) ?? null;

  const metrics = useMemo(() => {
    const pendingData = getPendingInstallationMetrics(monthFilteredJobs);
    return {
      newJobs: monthFilteredJobs.filter(
        (job) => job.scheduleStatus === "ready_to_schedule",
      ).length,
      ready: monthFilteredJobs.filter(isReady).length,
      attention: monthFilteredJobs.filter(
        (job) =>
          job.scheduleStatus === "pending_approval" ||
          job.deliveryStatus === "pending_stock" ||
          job.paymentPercent < 59,
      ).length,
      scheduled: monthFilteredJobs.filter((job) => Boolean(job.installationDate))
        .length,
      cancelled: monthFilteredJobs.filter(
        (job) => job.customerAvailabilityStatus === "cancelled",
      ).length,
      sedaPending: monthFilteredJobs.filter(
        (job) => normalizeSeda(job.sedaStatus) === "Pending",
      ).length,
      // The two payment cards partition the book: >= 60 and < 60. Using "< 60"
      // rather than "<= 60" keeps the job sitting exactly on 60 out of both
      // cards at once.
      paymentAtLeast60: monthFilteredJobs.filter((job) => job.paymentPercent >= 60)
        .length,
      paymentBelow60: monthFilteredJobs.filter((job) => job.paymentPercent < 60)
        .length,
      pendingStock: monthFilteredJobs.filter(
        (job) => job.deliveryStatus === "pending_stock",
      ).length,
      pendingInstallation: pendingData,
    };
  }, [monthFilteredJobs]);

  const deliveryRunByJobId = useMemo(() => {
    const result = new Map<string, DeliveryRun>();
    deliveryRuns.forEach((run) =>
      run.jobIds.forEach((jobId) => result.set(jobId, run)),
    );
    return result;
  }, [deliveryRuns]);

  // How many of the three arrangement columns a job has filled in: assigned
  // teams, delivery run, installation date. Drives both the pin order and the
  // row shade in the pipeline table.
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

  // Arranged customers pin to the top, most complete first. Everything else
  // keeps the existing payment-date order below them.
  const pipelineJobs = useMemo(() => {
    return filteredJobs
      .map((job, index) => ({ job, index, arranged: arrangedCountFor(job) }))
      .sort(
        (a, b) => b.arranged - a.arranged || a.index - b.index,
      )
      .map((entry) => entry.job);
  }, [filteredJobs, arrangedCountFor]);

  const availableSuggestionByJobId = useMemo(() => {
    const result = new Map<string, AvailableSuggestion>();
    availableSuggestions.forEach((entry) =>
      entry.jobIds.forEach((jobId) => result.set(jobId, entry)),
    );
    return result;
  }, [availableSuggestions]);

  // A real installation group wins; otherwise fall back to the town the
  // customer sits in on Team planning once it is marked available.
  function locationGroupLabelFor(jobId: string) {
    const group = groupByJobId.get(jobId);
    if (group) {
      return [group.name, group.area].filter(Boolean).join(" · ");
    }
    const available = availableSuggestionByJobId.get(jobId);
    if (available) return `${available.label} · Available group`;
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

  function saveAvailableSuggestions(next: AvailableSuggestion[]) {
    setAvailableSuggestions(next);
    window.localStorage.setItem(
      AVAILABLE_SUGGESTIONS_STORAGE_KEY,
      JSON.stringify(next),
    );
    persistOps({ availableSuggestions: next });
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

  function assignJobToGroup(jobId: string, groupId: string) {
    saveGroups(
      groups.map((group) => ({
        ...group,
        jobIds:
          group.id === groupId
            ? Array.from(new Set([...group.jobIds, jobId])).slice(0, 5)
            : group.jobIds.filter((id) => id !== jobId),
      })),
    );
  }

  function assignJobToDeliveryRun(jobId: string, runId: string) {
    saveDeliveryRuns(
      deliveryRuns.map((run) => ({
        ...run,
        jobIds:
          run.id === runId
            ? Array.from(new Set([...run.jobIds, jobId]))
            : run.jobIds.filter((id) => id !== jobId),
      })),
    );
  }

  async function saveJob(updated: InstallationJob) {
    setSaving(true);
    setNotice(null);
    const nextJobs = jobs.map((job) => (job.id === updated.id ? updated : job));
    setJobs(nextJobs);

    const saved = {
      ...jobUpdatesRef.current,
      [updated.id]: operationalUpdate(updated),
    };
    jobUpdatesRef.current = saved;
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(saved));
    persistOps({ jobUpdates: saved });

    try {
      const response = await fetch(`/api/jobs/${encodeURIComponent(updated.id)}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          invoiceNumber: updated.invoiceNumber,
          customerName: updated.customerName,
          ...operationalUpdate(updated),
        }),
      });
      if (response.ok) {
        setNotice("Installation job saved to the API database.");
      } else {
        setNotice("Saved to the shared dashboard on this network.");
      }
      setEditMode(false);
    } catch {
      setNotice("Saved to the shared dashboard on this network.");
      setEditMode(false);
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
    <div className={`app-layout${sidebarCollapsed ? " sidebar-is-collapsed" : ""}`}>
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
              ["teams", "Team planning"],
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
      </aside>

      <main className="app-shell">
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
          <p className="eyebrow">Wednesday, 29 July 2026 · Malaysia time</p>
          <h1>Installation dashboard</h1>
          <p>Plan customer dates, stock delivery, SEDA approval, and installation teams.</p>
        </div>
      </section>

      {(notice || meta?.warning) && (
        <div className="notice" role="status">
          <AlertTriangle size={17} />
          <span>{notice || meta?.warning}</span>
          <button aria-label="Dismiss message" onClick={() => setNotice(null)}>
            <X size={16} />
          </button>
        </div>
      )}

      <section className="metrics" aria-label="Installation summary">
        <Metric
          label="Ready to install"
          value={metrics.ready}
          note="All requirements met"
          hint="Every requirement is met: paid 59% or more, SEDA approved, stock delivered, customer available, an installation date set, and a team assigned. Only jobs clearing all six are counted."
          icon={<Check size={18} />}
        />
        <Metric
          label="Dates arranged"
          value={metrics.scheduled}
          note="Open schedule & assign"
          hint="Jobs that have an installation date set, whatever else is still outstanding. Click to open Schedule & assign."
          icon={<CalendarDays size={18} />}
          onClick={() => setShowScheduleModal(true)}
        />
        <Metric
          label="Cancellation"
          value={metrics.cancelled}
          note="Customer cancelled"
          hint="Customers whose availability was set to Cancellation on the Team planning page. They drop out of planning and are removed from any installation group."
          icon={<Ban size={18} />}
          accent="red"
        />
        <Metric
          label="Pending installation"
          value={metrics.pendingInstallation.total}
          note="2nd payment > 30 days ago"
          hint="Customers whose second payment landed 30 or more days ago and who still have no installation. Click to see the full list with days elapsed."
          icon={<Clock3 size={18} />}
          tone="warning"
          accent="amber"
          onClick={() => setShowPendingModal(true)}
        />
        <Metric
          label="SEDA pending"
          value={metrics.sedaPending}
          note="Not yet approved"
          hint="SEDA registration still sitting at Pending — not yet submitted. Does not include registrations already Submitted and awaiting SEDA, or ones Approved. Read from the source system; the dashboard cannot change it."
          icon={<FileSearch size={18} />}
          tone="warning"
        />
        <Metric
          label="Payment 60% or more"
          value={metrics.paymentAtLeast60}
          note="Deposit threshold met"
          hint="Invoices paid 60% or more of the total. Note the rest of the app treats 59% as the ready-to-schedule threshold, so this card is one point stricter."
          icon={<Wallet size={18} />}
        />
        <Metric
          label="Payment under 60%"
          value={metrics.paymentBelow60}
          note="Below deposit threshold"
          hint="Invoices paid less than 60% of the total. Together with the card to the left this covers every job, so the two always add up to the whole set."
          icon={<TrendingDown size={18} />}
          tone="warning"
        />
        <Metric
          label="Pending stock"
          value={metrics.pendingStock}
          note="Awaiting stock"
          hint="Jobs whose delivery status is set to pending stock. Nothing in the dashboard sets this yet — every job defaults to not planned — so this reads 0 until stock status is recorded."
          icon={<Package size={18} />}
        />
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
                <option value="active">All active jobs</option>
                <option value="new">New / ready to schedule</option>
                <option value="attention">Needs attention</option>
                <option value="ready">Ready to install</option>
                <option value="special">Approved special cases</option>
                <option value="installed">Installed</option>
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
                aria-label="Filter by installation date"
                type="date"
                value={installationDateFilter}
                onChange={(event) =>
                  setInstallationDateFilter(event.target.value)
                }
              />
              <input
                aria-label="Filter by month"
                type="month"
                value={monthFilter}
                onChange={(event) => setMonthFilter(event.target.value)}
              />
              {monthFilter && (
                <button
                  className="icon-button"
                  aria-label="Clear month filter"
                  onClick={() => setMonthFilter("")}
                >
                  <X size={14} />
                </button>
              )}
            </div>
          </div>

          <div className="pipeline-heading">
            <div>
              <h2>Active installation pipeline</h2>
              <p>{pipelineJobs.length} jobs shown</p>
            </div>
            {meta?.syncedAt && (
              <span>
                Updated{" "}
                {new Intl.DateTimeFormat("en-MY", {
                  hour: "numeric",
                  minute: "2-digit",
                  timeZone: "Asia/Kuala_Lumpur",
                }).format(new Date(meta.syncedAt))}
              </span>
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
                  </tr>
                </thead>
                <tbody>
                  {pipelineJobs.map((job) => (
                    <tr
                      key={job.id}
                      className={[
                        selected?.id === job.id ? "selected" : "",
                        arrangedCountFor(job)
                          ? `arranged arranged-${arrangedCountFor(job)}`
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
                        <StatusDot
                          status={
                            job.scheduleStatus === "installed" ||
                            job.scheduleStatus === "ready_to_install"
                              ? "good"
                              : job.scheduleStatus === "pending_approval"
                                ? "danger"
                                : "warning"
                          }
                        />
                        {statusLabels[job.scheduleStatus]}
                        <span>
                          {normalizeSeda(job.sedaStatus) === "Approved"
                            ? "SEDA approved"
                            : `SEDA ${normalizeSeda(job.sedaStatus)}`}
                        </span>
                      </td>
                      <td>
                        <strong>
                          {groupByJobId.get(job.id)?.installationTeam ||
                            "Installation team unassigned"}
                        </strong>
                        <span>
                          {groupByJobId.get(job.id)?.wiringTeam ||
                            "Wiring team unassigned"}
                        </span>
                      </td>
                      <td onClick={(event) => event.stopPropagation()}>
                        <select
                          aria-label={`Installation group for ${job.customerName}`}
                          value={groupByJobId.get(job.id)?.id || ""}
                          onChange={(event) =>
                            assignJobToGroup(job.id, event.target.value)
                          }
                        >
                          <option value="">Not grouped</option>
                          {groups.map((group) => (
                            <option
                              value={group.id}
                              key={group.id}
                              disabled={
                                group.jobIds.length >= 5 &&
                                !group.jobIds.includes(job.id)
                              }
                            >
                              {group.name}
                            </option>
                          ))}
                        </select>
                        <span>
                          {groupByJobId.get(job.id)?.area ||
                            townshipForJob(job)}
                        </span>
                      </td>
                      <td>
                        <select
                          aria-label={`Delivery run for ${job.customerName}`}
                          value={deliveryRunByJobId.get(job.id)?.id || ""}
                          onChange={(event) =>
                            assignJobToDeliveryRun(job.id, event.target.value)
                          }
                          onClick={(event) => event.stopPropagation()}
                        >
                          <option value="">Not assigned</option>
                          {deliveryRuns.map((run) => (
                            <option value={run.id} key={run.id}>
                              {run.name}
                            </option>
                          ))}
                        </select>
                      </td>
                      <td>
                        <strong>{job.stockDetails || "Not entered"}</strong>
                      </td>
                      <td>
                        <strong>
                          {job.installationDate ||
                          groupByJobId.get(job.id)?.installationDate
                            ? new Intl.DateTimeFormat("en-MY", {
                                day: "numeric",
                                month: "short",
                                year: "numeric",
                              }).format(
                                new Date(
                                  `${
                                    job.installationDate ||
                                    groupByJobId.get(job.id)?.installationDate
                                  }T00:00:00`,
                                ),
                              )
                            : "Not scheduled"}
                        </strong>
                      </td>
                      <td>
                        <ChevronRight size={17} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
        )}

        {view === "groups" && (
          <InstallationGroupsView
            groups={groups}
            jobs={monthFilteredJobs}
            teams={teamResources}
            weekAssignments={teamWeekAssignments}
            deliveryRuns={deliveryRuns}
            onOpenJob={setSelectedId}
            onGroupsChange={saveGroups}
            onTeamsChange={saveTeamResources}
            onWeekAssignmentsChange={saveTeamWeekAssignments}
            onCreate={() => setComposer("group")}
            onJumpToDate={(date) => {
              setInstallationDateFilter(date);
              setView("pipeline");
            }}
            groupsWorkspace="teams"
            onReassignTeam={() => setShowScheduleModal(false)}
          />
        )}

        {view === "teams" && (
          <TeamPlanningView
            groups={groups}
            jobs={monthFilteredJobs}
            availableSuggestions={availableSuggestions}
            onAvailableSuggestionsChange={saveAvailableSuggestions}
            onUpdateJob={(job) => void saveAvailability(job)}
            onAssignCustomerToGroup={assignJobToGroup}
          />
        )}

        {view === "delivery" && (
          <DeliveryPlanningView
            runs={deliveryRuns}
            jobs={monthFilteredJobs}
            groups={groups}
            onOpenJob={setSelectedId}
            onChange={saveDeliveryRuns}
            onUpdateJob={(job) => void saveJob(job)}
            onCreate={() => setComposer("delivery")}
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
              availableSuggestion={
                availableSuggestionByJobId.get(selectedJobForDisplay.id) ?? null
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
                onJumpToDate={(date) => {
                  setInstallationDateFilter(date);
                  setShowScheduleModal(false);
                  setView("pipeline");
                }}
                groupsWorkspace="schedule"
                onReassignTeam={() => {
                  setShowScheduleModal(false);
                  setView("groups");
                }}
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
}) {
  const [openGroupId, setOpenGroupId] = useState<string | null>(null);
  const [showFullCalendar, setShowFullCalendar] = useState(false);
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
  const [calendarWeather, setCalendarWeather] = useState<
    Record<string, { rainProbability: number; weatherCode: number }>
  >({});
  const [rowAssignmentDraft, setRowAssignmentDraft] = useState<
    Record<string, { startDate: string; endDate: string; installationGroupId: string }>
  >({});
  const [memberDraft, setMemberDraft] = useState<Record<string, string>>({});

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
        installationGroupId: "",
      }
    );
  }

  function updateRowAssignmentDraft(
    teamId: string,
    update: Partial<{ startDate: string; endDate: string; installationGroupId: string }>,
  ) {
    setRowAssignmentDraft((prev) => ({
      ...prev,
      [teamId]: { ...getRowAssignmentDraft(teamId), ...update },
    }));
  }

  function addRowWeekAssignment(teamId: string) {
    const draft = getRowAssignmentDraft(teamId);
    if (!draft.startDate || !draft.endDate || !draft.installationGroupId) return;
    onWeekAssignmentsChange([
      ...weekAssignments,
      {
        id: crypto.randomUUID(),
        teamId,
        startDate: draft.startDate,
        endDate: draft.endDate,
        installationGroupId: draft.installationGroupId,
      },
    ]);
    const team = teams.find((item) => item.id === teamId);
    if (team) {
      updateGroup(draft.installationGroupId, {
        [team.role === "wiring" ? "wiringTeam" : "installationTeam"]: team.name,
      });
    }
    setRowAssignmentDraft((prev) => ({
      ...prev,
      [teamId]: { startDate: "", endDate: "", installationGroupId: "" },
    }));
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
      !weekDraft.endDate ||
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
        endDate: weekDraft.endDate,
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

  const installationOptions = teams.filter(
    (team) => team.role === "installation",
  );
  const wiringOptions = teams.filter((team) => team.role === "wiring");

  useEffect(() => {
    let cancelled = false;
    const locations = new Map<string, { latitude: number; longitude: number }>();
    groups.forEach((group) => {
      const firstJob = jobs.find((job) => group.jobIds.includes(job.id));
      if (!firstJob) return;
      const match = weatherCoordinatesForPostcode(postcodeForJob(firstJob));
      if (match) locations.set(match.prefix, match.coordinates);
    });
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

  function groupForDate(dateStr: string): InstallationGroup | null {
    return (
      groups.find((group) => {
        if (!group.installationDate) return false;
        const end = group.installationEndDate || group.installationDate;
        return dateStr >= group.installationDate && dateStr <= end;
      }) || null
    );
  }

  function customersForDate(dateStr: string): InstallationJob[] {
    return jobs.filter((job) => {
      const customerDate = job.installationDate || job.preferredInstallationDate;
      return (
        customerDate === dateStr &&
        groups.some((group) => group.jobIds.includes(job.id))
      );
    });
  }

  const unscheduledGroups = groups.filter((group) => !group.installationDate);
  const openGroup = groups.find((group) => group.id === openGroupId) || null;

  return (
    <div className="planning-panel">
      {groupsWorkspace === "teams" && (
        <div className="planning-heading">
          <div>
            <h2>Installation groups</h2>
            <p>Customers grouped by location and installation date.</p>
          </div>
          <button className="button primary" onClick={onCreate}>
            <CalendarDays size={16} />
            Create group
          </button>
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
                  <th>Contact</th>
                  <th>Base location</th>
                  <th>From</th>
                  <th>Until</th>
                  <th>Customer Group</th>
                  <th aria-label="Actions" />
                </tr>
              </thead>
              <tbody>
                {teams.map((team) => {
                  const rowDraft = getRowAssignmentDraft(team.id);
                  return (
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
                          <option value="installation">Installation</option>
                          <option value="wiring">Wiring</option>
                        </select>
                      </td>
                      <td>
                        <div className="member-tag-input">
                          <div className="member-tag-list">
                            {(team.members ?? []).map((member) => (
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
                          type="date"
                          value={rowDraft.startDate}
                          onChange={(event) =>
                            updateRowAssignmentDraft(team.id, {
                              startDate: event.target.value,
                            })
                          }
                          aria-label={`${team.name} assignment from date`}
                        />
                      </td>
                      <td>
                        <input
                          type="date"
                          min={rowDraft.startDate || undefined}
                          value={rowDraft.endDate}
                          onChange={(event) =>
                            updateRowAssignmentDraft(team.id, {
                              endDate: event.target.value,
                            })
                          }
                          aria-label={`${team.name} assignment until date`}
                        />
                      </td>
                      <td>
                        <div className="row-actions">
                          <select
                            value={rowDraft.installationGroupId}
                            onChange={(event) =>
                              updateRowAssignmentDraft(team.id, {
                                installationGroupId: event.target.value,
                              })
                            }
                            aria-label={`${team.name} assigned installation group`}
                          >
                            <option value="">Select installation group</option>
                            {groups.map((group) => (
                              <option value={group.id} key={group.id}>
                                {group.name} · {group.area}
                              </option>
                            ))}
                          </select>
                          <button
                            className="button primary"
                            onClick={() => addRowWeekAssignment(team.id)}
                            disabled={
                              !rowDraft.startDate ||
                              !rowDraft.endDate ||
                              !rowDraft.installationGroupId
                            }
                          >
                            Add
                          </button>
                        </div>
                      </td>
                      <td>
                        <div className="row-actions">
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
                        </div>
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
            <option value="installation">Installation team</option>
            <option value="wiring">Wiring team</option>
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
                      <option value="installation">Installation</option>
                      <option value="wiring">Wiring</option>
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
            type="date"
            value={weekDraft.startDate}
            onChange={(event) =>
              setWeekDraft({ ...weekDraft, startDate: event.target.value })
            }
            aria-label="Assignment from date"
          />
          <input
            type="date"
            value={weekDraft.endDate}
            onChange={(event) =>
              setWeekDraft({ ...weekDraft, endDate: event.target.value })
            }
            aria-label="Assignment until date"
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
            {groups.map((group) => (
              <option value={group.id} key={group.id}>
                {group.name} · {group.area}
              </option>
            ))}
          </select>
          <button
            className="button primary"
            onClick={addWeekAssignment}
            disabled={
              !weekDraft.teamId ||
              !weekDraft.startDate ||
              !weekDraft.endDate ||
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
                  <th>From date</th>
                  <th>Until date</th>
                  <th>Team</th>
                  <th>Role</th>
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
                        <td>{assignment.startDate || "Not set"}</td>
                        <td>{assignment.endDate || "Not set"}</td>
                        <td>{team?.name || "Team removed"}</td>
                        <td>
                          {team?.role === "wiring"
                            ? "Wiring"
                            : "Installation"}
                        </td>
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
          </div>

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
        </div>
      )}

      {groupsWorkspace === "schedule" && showFullCalendar && (
        <div
          className="modal-backdrop"
          role="presentation"
          onMouseDown={() => setShowFullCalendar(false)}
        >
          <div
            className="full-calendar-modal"
            role="dialog"
            aria-modal="true"
            aria-label="Full month calendar"
            onMouseDown={(event) => event.stopPropagation()}
          >
            <div className="full-calendar-header">
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
                className="icon-button"
                aria-label="Close"
                onClick={() => setShowFullCalendar(false)}
              >
                <X size={18} />
              </button>
            </div>

            <div className="standard-calendar-weekdays" aria-hidden="true">
              {["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map((day) => (
                <span key={day}>{day}</span>
              ))}
            </div>

            <div className="full-calendar-grid">
              {calendarDays.map((date) => {
                const key = dateKey(date);
                const isCurrentMonth =
                  date.getMonth() === calendarMonth.getMonth();
                const group = groupForDate(key);
                const staffing = group ? groupStaffing(group) : null;
                const dayCustomers = customersForDate(key);
                const dayDeliveryCount = deliveryRuns.filter(
                  (run) => run.deliveryDate === key,
                ).length;
                const weather = calendarWeather[key];
                const showWeather = weather && weather.rainProbability >= 40;
                const holiday = holidayForDate(key);
                return (
                  <button
                    key={key}
                    type="button"
                    className={`week-day-box${staffing ? ` ${staffing}` : ""}${isCurrentMonth ? "" : " outside-month"}`}
                    onClick={() => {
                      setShowFullCalendar(false);
                      onJumpToDate(key);
                    }}
                  >
                    <div className="week-day-box-top">
                      <span className="week-day-box-number">
                        {date.getDate()}
                      </span>
                      {showWeather && (
                        <span
                          className={`week-day-box-weather ${
                            weather.rainProbability >= 70
                              ? "high-risk"
                              : "medium-risk"
                          }`}
                        >
                          <WeatherGlyph code={weather.weatherCode} size={13} />
                          {weather.rainProbability}%
                        </span>
                      )}
                    </div>
                    {holiday && (
                      <span className="week-day-box-holiday">{holiday}</span>
                    )}
                    {dayCustomers.length > 0 && (
                      <div className="week-day-box-customers">
                        {dayCustomers.slice(0, 3).map((job) => (
                          <span key={job.id}>
                            {formatPersonName(job.customerName)}
                          </span>
                        ))}
                        {dayCustomers.length > 3 && (
                          <span>+{dayCustomers.length - 3} more</span>
                        )}
                      </div>
                    )}
                    {dayDeliveryCount > 0 && (
                      <span className="week-day-box-delivery">
                        <Truck size={11} />
                        {dayDeliveryCount} delivery
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
          </div>
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
}: {
  group: InstallationGroup;
  weekDates: Date[];
  jobs: InstallationJob[];
  calendarWeather: Record<string, { rainProbability: number; weatherCode: number }>;
  deliveryRunsForGroup: (groupId: string) => DeliveryRun[];
  onOpenDrawer: () => void;
  onOpenCalendar: () => void;
  onReassignTeam: () => void;
}) {
  const staffing = groupStaffing(group);
  const linkedJobs = jobs.filter((job) => group.jobIds.includes(job.id));
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
              .map((job) => formatPersonName(job.customerName))
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
}) {
  const staffing = groupStaffing(group);
  const runs = deliveryRunsForGroup(group.id);
  const linkedJobs = jobs.filter((job) => group.jobIds.includes(job.id));

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
              {linkedJobs.map((job) => (
                <li key={job.id}>
                  <button
                    className="text-button"
                    onClick={() => onOpenJob(job.id)}
                  >
                    {formatPersonName(job.customerName)}
                  </button>
                </li>
              ))}
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
  availableSuggestions,
  onAvailableSuggestionsChange,
  onUpdateJob,
  onAssignCustomerToGroup,
}: {
  groups: InstallationGroup[];
  jobs: InstallationJob[];
  availableSuggestions: AvailableSuggestion[];
  onAvailableSuggestionsChange: (next: AvailableSuggestion[]) => void;
  onUpdateJob: (job: InstallationJob) => void;
  onAssignCustomerToGroup: (jobId: string, groupId: string) => void;
}) {
  const [rangeKm, setRangeKm] = useState(20);
  const [planningFilter, setPlanningFilter] = useState<
    "all" | "ready_to_schedule" | "pending_seda" | "special"
  >("all");
  const [postcodeFilter, setPostcodeFilter] = useState("");
  const [previewSuggestion, setPreviewSuggestion] = useState<{
    id: string;
    area: string;
    postcode: string;
    state: string;
    customers: InstallationJob[];
  } | null>(null);
  const [addCustomerId, setAddCustomerId] = useState("");
  const [customerSearch, setCustomerSearch] = useState("");
  const [showCustomerPicker, setShowCustomerPicker] = useState(false);
  const [mapFocusGroupId, setMapFocusGroupId] = useState<string | null>(null);
  const [highlightedMapGroupId, setHighlightedMapGroupId] = useState<
    string | null
  >(null);
  const [highlightedMapCustomerId, setHighlightedMapCustomerId] = useState<
    string | null
  >(null);
  const [suggestionOverrides, setSuggestionOverrides] = useState<
    Record<string, string[]>
  >({});
  const [unavailableGroupSelections, setUnavailableGroupSelections] = useState<
    Record<string, string>
  >({});
  const assignedJobIds = new Set(groups.flatMap((group) => group.jobIds));

  function hasPlanningEligibility(job: InstallationJob) {
    return (
      job.paymentPercent >= 59 ||
      (job.paymentPercent < 59 &&
        job.paymentOverrideStatus === "approved")
    );
  }

  function matchesPlanningStatus(job: InstallationJob) {
    return (
      planningFilter === "all" ||
      (planningFilter === "ready_to_schedule" &&
        job.scheduleStatus === "ready_to_schedule") ||
      (planningFilter === "pending_seda" &&
        normalizeSeda(job.sedaStatus) !== "Approved") ||
      (planningFilter === "special" &&
        job.paymentPercent < 59 &&
        job.paymentOverrideStatus === "approved")
    );
  }

  const approvedSpecialCases = jobs.filter(
    (job) =>
      job.paymentPercent < 59 &&
      job.paymentOverrideStatus === "approved",
  );

  const readyJobs = (
    planningFilter === "special" ? approvedSpecialCases : jobs
  ).filter(
    (job) =>
      !assignedJobIds.has(job.id) &&
      hasPlanningEligibility(job) &&
      job.scheduleStatus !== "installed" &&
      !isOutOfPlanning(job) &&
      (planningFilter === "special" || matchesPlanningStatus(job)),
  );
  const filteredPlanningJobIds = new Set(
    jobs
      .filter(
        (job) =>
          hasPlanningEligibility(job) &&
          matchesPlanningStatus(job) &&
          job.scheduleStatus !== "installed" &&
          !isOutOfPlanning(job),
      )
      .map((job) => job.id),
  );
  const unavailableJobs = (
    planningFilter === "special" ? approvedSpecialCases : jobs
  ).filter(
    (job) =>
      isOutOfPlanning(job) &&
      hasPlanningEligibility(job) &&
      (planningFilter === "special" || matchesPlanningStatus(job)),
  );
  const assignableGroups = groups.filter((group) => group.jobIds.length < 5);

  const locationByPostcode = useMemo(() => {
    const locations = new Map<string, { town: string; state: string }>();
    jobs.forEach((job) => {
      const postcode = postcodeForJob(job);
      if (!postcode || locations.has(postcode)) return;
      const town = job.city?.trim();
      if (town) {
        locations.set(postcode, { town, state: job.state?.trim() || "" });
      }
    });
    return locations;
  }, [jobs]);

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

  const baseSuggestions = useMemo(() => {
    const byLocation = new Map<
      string,
      {
        town: string;
        postcode: string;
        state: string;
        customers: InstallationJob[];
      }
    >();
    readyJobs.forEach((job) => {
      const postcode = postcodeForJob(job);
      const matchedLocation = postcode
        ? locationByPostcode.get(postcode)
        : undefined;
      const town =
        job.city?.trim() || matchedLocation?.town || townshipForJob(job);
      const state = job.state?.trim() || matchedLocation?.state || "";
      // Source data has inconsistent casing for the same town/state (e.g.
      // "Johor Bahru" vs "JOHOR BAHRU", "JOHOR" vs "Johor" vs "johor").
      // Group by a case/whitespace-insensitive key so those variants merge
      // into one location instead of splitting into separate suggestions
      // that then collide on the same display id (the freeze bug reported
      // for Johor Bahru and Iskandar Puteri).
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
    return Array.from(byLocation.entries()).flatMap(
      ([key, { town, postcode, state, customers }]) => {
      const chunks = [];
      for (let index = 0; index < customers.length; index += 5) {
        chunks.push({
          // Derive the id from the same key used to group customers so it
          // is guaranteed unique across suggestions (no more duplicate
          // React keys when town/state casing varies in the source data).
          id: `${key}-${index / 5 + 1}`,
          area: town,
          postcode,
          state,
          customers: customers.slice(index, index + 5),
        });
      }
      return chunks;
    },
    ).sort((a, b) => b.customers.length - a.customers.length);
  }, [readyJobs, rangeKm, locationByPostcode]);

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
          planningFilter === "special"
            ? suggestion.customers.map((customer) => customer.id)
            : suggestionOverrides[suggestion.id] ??
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
            .slice(0, 5),
        };
      })
      .filter((suggestion) => suggestion.customers.length > 0)
      .sort((a, b) => b.customers.length - a.customers.length);
  }, [baseSuggestions, jobs, planningFilter, suggestionOverrides]);

  const displayedSuggestions = useMemo(
    () =>
      planningFilter === "special"
        ? suggestions
            .map((suggestion) => ({
              ...suggestion,
              customers: suggestion.customers.filter(
                (job) =>
                  job.paymentPercent < 59 &&
                  job.paymentOverrideStatus === "approved",
              ),
            }))
            .filter((suggestion) => suggestion.customers.length > 0)
        : suggestions,
    [planningFilter, suggestions],
  );

  const availableSet = useMemo(
    () => new Set(availableSuggestions.map((entry) => entry.id)),
    [availableSuggestions],
  );

  const filteredSuggestions = useMemo(() => {
    const postcodeSearch = postcodeFilter.trim().toLowerCase();
    const matching = postcodeSearch
      ? displayedSuggestions.filter((suggestion) =>
          suggestion.postcode.toLowerCase().includes(postcodeSearch),
        )
      : displayedSuggestions;

    // Marked-available towns pin to the top. Everything else keeps the order
    // it already had, so the list does not reshuffle underneath the user.
    const pinned = matching.filter((suggestion) =>
      availableSet.has(suggestion.id),
    );
    const rest = matching.filter(
      (suggestion) => !availableSet.has(suggestion.id),
    );
    return [...pinned, ...rest];
  }, [displayedSuggestions, postcodeFilter, availableSet]);

  function toggleAvailable(suggestion: {
    id: string;
    area: string;
    postcode: string;
    state: string;
    customers: InstallationJob[];
  }) {
    if (availableSet.has(suggestion.id)) {
      onAvailableSuggestionsChange(
        availableSuggestions.filter((entry) => entry.id !== suggestion.id),
      );
      return;
    }
    onAvailableSuggestionsChange([
      ...availableSuggestions,
      {
        id: suggestion.id,
        label: [suggestion.area, suggestion.postcode, suggestion.state]
          .filter(Boolean)
          .join(" · "),
        jobIds: suggestion.customers.map((job) => job.id),
      },
    ]);
  }

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

  const previewMapGroups = useMemo(() => {
    if (!previewSuggestion) return [];
    return [
      {
        id: previewSuggestion.id,
        town: previewSuggestion.area,
        postcode: previewSuggestion.postcode,
        state: previewSuggestion.state,
        customers: previewSuggestion.customers.map((snapshotJob) => {
          const job =
            jobs.find((candidate) => candidate.id === snapshotJob.id) ||
            snapshotJob;
          return {
            id: job.id,
            name: job.customerName,
            address: job.address,
            paymentPercent: job.paymentPercent,
          };
        }),
      },
    ];
  }, [previewSuggestion, jobs]);

  const customerSearchText = customerSearch.trim().toLowerCase();
  const addableCustomers = jobs
    .filter(
      (job) =>
        previewSuggestion &&
        !previewSuggestion.customers.some(
          (customer) => customer.id === job.id,
        ) &&
        !isOutOfPlanning(job) &&
        job.scheduleStatus !== "installed" &&
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

  function addCustomerToPreview() {
    if (!previewSuggestion || !addCustomerId) return;
    if (previewSuggestion.customers.length >= 5) return;
    const customer = jobs.find((job) => job.id === addCustomerId);
    if (!customer) return;
    setPreviewSuggestion({
      ...previewSuggestion,
      customers: [...previewSuggestion.customers, customer],
    });
    setAddCustomerId("");
    setCustomerSearch("");
    setShowCustomerPicker(false);
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

  return (
    <div className="planning-panel team-planning-panel">
      <div className="planning-heading">
        <div>
          <h2>Team planning</h2>
          <p>Find ready customers and suggest location groups for team planning.</p>
        </div>
        <div className="planning-filters">
          <label className="range-control">
            Planning status
            <select
              value={planningFilter}
              onChange={(event) => {
                setPlanningFilter(
                  event.target.value as typeof planningFilter,
                );
                setPreviewSuggestion(null);
                setMapFocusGroupId(null);
                setHighlightedMapGroupId(null);
                setHighlightedMapCustomerId(null);
                setHighlightedMapCustomerId(null);
                setAddCustomerId("");
                setCustomerSearch("");
                setShowCustomerPicker(false);
              }}
            >
              <option value="all">All ready for planning</option>
              <option value="ready_to_schedule">Ready to schedule</option>
              <option value="pending_seda">Pending SEDA approval</option>
              <option value="special">Approved special cases</option>
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
                setPostcodeFilter(event.target.value);
                setPreviewSuggestion(null);
                setMapFocusGroupId(null);
                setHighlightedMapGroupId(null);
                setHighlightedMapCustomerId(null);
                setHighlightedMapCustomerId(null);
              }}
            />
          </label>
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
                <th>Customers</th>
                <th>Customer names</th>
                <th>Ready for planning</th>
                <th>Ready to schedule</th>
                <th>SEDA pending</th>
                <th>Customer availability</th>
                <th>Planning range</th>
                <th aria-label="Mark available" />
              </tr>
            </thead>
            <tbody>
              {filteredSuggestions.map((suggestion) => (
                <tr
                  key={suggestion.id}
                  className={
                    availableSet.has(suggestion.id) ? "suggestion-available" : ""
                  }
                  onMouseEnter={() => setHighlightedMapGroupId(suggestion.id)}
                  onMouseLeave={() => setHighlightedMapGroupId(null)}
                  onClick={() => {
                    setMapFocusGroupId(suggestion.id);
                    setHighlightedMapCustomerId(null);
                    setPreviewSuggestion(suggestion);
                  }}
                >
                  <td>
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
                  </td>
                  <td>{suggestion.customers.length}</td>
                  <td>
                    {suggestion.customers
                      .slice(0, 3)
                      .map((job) => formatPersonName(job.customerName))
                      .join(", ")}
                    {suggestion.customers.length > 3
                      ? ` +${suggestion.customers.length - 3}`
                      : ""}
                  </td>
                  <td>
                    {suggestion.customers.length}
                  </td>
                  <td>
                    {suggestion.customers.filter(
                      (job) => job.scheduleStatus === "ready_to_schedule",
                    ).length}
                  </td>
                  <td>
                    {suggestion.customers.filter(
                      (job) => normalizeSeda(job.sedaStatus) !== "Approved",
                    ).length}
                  </td>
                  <td>
                    {suggestion.customers.filter(
                      (job) => job.customerAvailabilityStatus === "available",
                    ).length}
                  </td>
                  <td>Up to {rangeKm} km</td>
                  <td>
                    <button
                      className={`button ${
                        availableSet.has(suggestion.id) ? "" : "primary"
                      }`}
                      aria-pressed={availableSet.has(suggestion.id)}
                      onClick={(event) => {
                        event.stopPropagation();
                        toggleAvailable(suggestion);
                      }}
                    >
                      {availableSet.has(suggestion.id) && <Check size={15} />}
                      Available group
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
            </table>
          </div>
        </div>
      )}
      {unavailableJobs.length > 0 && (
        <section className="unavailable-section">
          <div className="group-header">
            <div>
              <h3>Customer unavailable</h3>
              <p>
                These customers are outside installation groups until a new date
                is confirmed.
              </p>
            </div>
          </div>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Customer</th>
                  <th>Township</th>
                  <th>Preferred new date</th>
                  <th>Remarks</th>
                  <th>Next action</th>
                </tr>
              </thead>
              <tbody>
                {unavailableJobs.map((job) => (
                  <tr key={job.id}>
                    <td>
                          <strong>{formatPersonName(job.customerName)}</strong>
                      <span>{job.customerPhone}</span>
                    </td>
                    <td>{formatPersonName(townshipForJob(job))}</td>
                    <td>
                      <input
                        type="date"
                        value={job.preferredInstallationDate ?? ""}
                        onChange={(event) =>
                          onUpdateJob({
                            ...job,
                            preferredInstallationDate:
                              event.target.value || null,
                          })
                        }
                      />
                    </td>
                    <td>
                      <input
                        defaultValue={job.availabilityRemarks}
                        onBlur={(event) =>
                          onUpdateJob({
                            ...job,
                            availabilityRemarks: event.target.value,
                          })
                        }
                        placeholder="Reason or alternative date"
                      />
                    </td>
                    <td>
                      <div className="availability-assignment">
                        <select
                          value={unavailableGroupSelections[job.id] || ""}
                          onChange={(event) =>
                            setUnavailableGroupSelections({
                              ...unavailableGroupSelections,
                              [job.id]: event.target.value,
                            })
                          }
                          aria-label={`Group for ${job.customerName}`}
                        >
                          <option value="">Select installation group</option>
                          {groups.map((group) => (
                            <option
                              value={group.id}
                              key={group.id}
                              disabled={group.jobIds.length >= 5}
                            >
                              {group.name} ({group.jobIds.length}/5)
                              {group.jobIds.length >= 5 ? " · Full" : ""}
                            </option>
                          ))}
                        </select>
                        <button
                          type="button"
                          className="button primary"
                          disabled={
                            !unavailableGroupSelections[job.id] ||
                            !assignableGroups.some(
                              (group) =>
                                group.id ===
                                unavailableGroupSelections[job.id],
                            )
                          }
                          onClick={async () => {
                            const groupId =
                              unavailableGroupSelections[job.id];
                            if (!groupId) return;
                            onAssignCustomerToGroup(job.id, groupId);
                            await onUpdateJob({
                              ...job,
                              customerAvailabilityStatus: "available",
                            });
                            setUnavailableGroupSelections((current) => {
                              const next = { ...current };
                              delete next[job.id];
                              return next;
                            });
                          }}
                        >
                          Mark available & assign
                        </button>
                        {assignableGroups.length === 0 ? (
                          <small className="field-help">
                            Create a new installation group or remove a customer
                            from a full group first.
                          </small>
                        ) : !unavailableGroupSelections[job.id] ? (
                          <small className="field-help">
                            Select an installation group to enable this button.
                          </small>
                        ) : null}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}
      {previewSuggestion && (
        <div
          className="modal-backdrop"
          role="presentation"
          onMouseDown={() => {
            setPreviewSuggestion(null);
            setHighlightedMapCustomerId(null);
          }}
        >
          <div
            className="suggestion-modal"
            role="dialog"
            aria-modal="true"
            aria-label={`${previewSuggestion.area} suggested customers`}
            onMouseDown={(event) => event.stopPropagation()}
          >
            <div className="detail-header">
              <div>
                <p className="eyebrow">Township suggestion</p>
                <h2>{formatPersonName(previewSuggestion.area)}</h2>
              </div>
              <div className="detail-actions">
                <button
                  className="button secondary"
                  disabled={previewSuggestion.customers.length >= 5}
                  onClick={() => setShowCustomerPicker((current) => !current)}
                >
                  <Users size={16} />
                  Add customer
                </button>
                <button
                  className="icon-button"
                  aria-label="Close customer list"
                  onClick={() => {
                    setPreviewSuggestion(null);
                    setHighlightedMapCustomerId(null);
                  }}
                >
                  <X size={19} />
                </button>
              </div>
            </div>
            {showCustomerPicker && (
              <div className="customer-picker">
                <label>
                  Search customer
                  <input
                    type="search"
                    value={customerSearch}
                    onChange={(event) => {
                      setCustomerSearch(event.target.value);
                      setAddCustomerId("");
                    }}
                    placeholder="Name, invoice, phone or address"
                    autoFocus
                  />
                </label>
                <label>
                  Select customer
                  <select
                    value={addCustomerId}
                    onChange={(event) => setAddCustomerId(event.target.value)}
                  >
                    <option value="">
                      {addableCustomers.length > 0
                        ? `Select from ${addableCustomers.length} customer${
                            addableCustomers.length === 1 ? "" : "s"
                          }`
                        : "No matching customers"}
                    </option>
                    {addableCustomers.map((customer) => {
                      const currentGroup = groups.find((group) =>
                        group.jobIds.includes(customer.id),
                      );
                      return (
                        <option value={customer.id} key={customer.id}>
                          {formatPersonName(customer.customerName)} ·{" "}
                          {customer.paymentPercent.toFixed(0)}%
                          {customer.paymentPercent < 59
                            ? " · Special case"
                            : ""}
                          {currentGroup
                            ? ` · From ${currentGroup.name}`
                            : ""}
                        </option>
                      );
                    })}
                  </select>
                </label>
                <button
                  className="button primary"
                  disabled={
                    !addCustomerId ||
                    previewSuggestion.customers.length >= 5
                  }
                  onClick={addCustomerToPreview}
                >
                  Add to this group
                </button>
                <span>
                  {previewSuggestion.customers.length}/5 customers
                </span>
              </div>
            )}
            <div className="suggestion-modal-workspace">
              <PlanningMap
                focusGroupId={previewSuggestion.id}
                highlightedGroupId={null}
                highlightedCustomerId={highlightedMapCustomerId}
                groups={previewMapGroups}
              />
              <div className="table-wrap">
                <table>
                <thead>
                  <tr>
                    <th>Customer</th>
                    <th>Address</th>
                    <th>Payment</th>
                    <th>2nd payment date</th>
                    <th>SEDA</th>
                    <th>Customer availability</th>
                    <th>Preferred installation date</th>
                    <th>Availability remarks</th>
                  </tr>
                </thead>
                <tbody>
                  {previewSuggestion.customers.map((snapshotJob) => {
                    // previewSuggestion.customers is a snapshot taken when
                    // the popup opened (it only tracks *which* customers
                    // are in the draft). Render and edit the live job from
                    // `jobs` instead, or a status/date change would appear
                    // to revert immediately since the controlled inputs
                    // below would still be bound to the stale snapshot.
                    const job =
                      jobs.find((candidate) => candidate.id === snapshotJob.id) ||
                      snapshotJob;
                    return (
                      <tr key={job.id}>
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
                        <td>{normalizeSeda(job.sedaStatus)}</td>
                        <td>
                          <select
                            value={job.customerAvailabilityStatus}
                            onChange={(event) => {
                              const status = event.target
                                .value as InstallationJob["customerAvailabilityStatus"];
                              onUpdateJob({
                                ...job,
                                customerAvailabilityStatus: status,
                              });
                              if (status === "unavailable" || status === "cancelled") {
                                setPreviewSuggestion((current) =>
                                  current
                                    ? {
                                        ...current,
                                        customers: current.customers.filter(
                                          (customer) => customer.id !== job.id,
                                        ),
                                      }
                                    : current,
                                );
                              }
                            }}
                          >
                            <option value="pending">Pending confirmation</option>
                            <option value="available">Available</option>
                            <option value="unavailable">Not available</option>
                            <option value="cancelled">Cancellation</option>
                          </select>
                        </td>
                        <td>
                          <input
                            type="date"
                            value={job.preferredInstallationDate ?? ""}
                            onChange={(event) =>
                              onUpdateJob({
                                ...job,
                                preferredInstallationDate:
                                  event.target.value || null,
                              })
                            }
                          />
                        </td>
                        <td>
                          <input
                            defaultValue={job.availabilityRemarks}
                            placeholder="Customer availability notes"
                            onBlur={(event) =>
                              onUpdateJob({
                                ...job,
                                availabilityRemarks: event.target.value,
                              })
                            }
                          />
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              </div>
            </div>
            <div className="suggestion-actions">
              <span>
                Maximum 5 customers · Approximate range {rangeKm} km
              </span>
              <button
                className="button primary"
                onClick={() => {
                  saveSuggestionDraft(
                    previewSuggestion.id,
                    previewSuggestion.customers.map((job) => job.id),
                  );
                  setPreviewSuggestion(null);
                }}
              >
                <Check size={16} />
                Save changes
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function DeliveryPlanningView({
  runs,
  jobs,
  groups,
  onOpenJob,
  onChange,
  onUpdateJob,
  onCreate,
}: {
  runs: DeliveryRun[];
  jobs: InstallationJob[];
  groups: InstallationGroup[];
  onOpenJob: (id: string) => void;
  onChange: (runs: DeliveryRun[]) => void;
  onUpdateJob: (job: InstallationJob) => void;
  onCreate: () => void;
}) {
  const [openRunId, setOpenRunId] = useState<string | null>(null);
  const [stockDraft, setStockDraft] = useState<Record<string, string>>({});

  function updateRun(id: string, update: Partial<DeliveryRun>) {
    onChange(runs.map((run) => (run.id === id ? { ...run, ...update } : run)));
  }

  const openRun = runs.find((run) => run.id === openRunId) ?? null;

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
        const linkedGroup = groups.find(
          (group) => group.id === run.installationGroupId,
        );
        return (
          <section className="planning-group" key={run.id}>
            <div className="group-header">
              <button
                className="delivery-run-summary"
                onClick={() => setOpenRunId(run.id)}
              >
                <h3>{run.name}</h3>
                <p>
                  {run.deliveryDate || "Date not arranged"} ·{" "}
                  {run.warehouse || "Warehouse not selected"} ·{" "}
                  {linkedGroup
                    ? `${linkedGroup.name} / ${linkedGroup.area}`
                    : "No group location"}{" "}
                  · PIC: {run.deliveryPic || "Not assigned"} ·{" "}
                  {formatPhoneNumber(run.contactNumber || "")}
                </p>
              </button>
              <div className="run-controls">
                <select
                  value={run.deliveryTeam}
                  onChange={(event) =>
                    updateRun(run.id, { deliveryTeam: event.target.value })
                  }
                >
                  <option value="">Delivery team</option>
                  {deliveryTeams.map((team) => <option key={team}>{team}</option>)}
                </select>
                <select
                  value={run.status}
                  onChange={(event) =>
                    updateRun(run.id, {
                      status: event.target.value as DeliveryRun["status"],
                    })
                  }
                >
                  <option value="pending_stock">Pending stock</option>
                  <option value="ready">Ready</option>
                  <option value="in_transit">In transit</option>
                  <option value="delivered">Delivered</option>
                </select>
                <button
                  className="button secondary"
                  onClick={() =>
                    onChange(runs.filter((item) => item.id !== run.id))
                  }
                >
                  Remove delivery run
                </button>
              </div>
            </div>
          </section>
        );
      })}

      {openRun && (
        <div
          className="modal-backdrop"
          role="presentation"
          onMouseDown={() => setOpenRunId(null)}
        >
          <div
            className="delivery-run-modal"
            role="dialog"
            aria-modal="true"
            aria-label={`${openRun.name} delivery run`}
            onMouseDown={(event) => event.stopPropagation()}
          >
            <div className="detail-header">
              <div>
                <p className="eyebrow">Stock delivery</p>
                <h2>{openRun.name}</h2>
              </div>
              <button
                className="icon-button"
                aria-label="Close"
                onClick={() => setOpenRunId(null)}
              >
                <X size={19} />
              </button>
            </div>
            <div className="delivery-run-edit-grid">
              <label>
                Delivery run name
                <input
                  value={openRun.name}
                  onChange={(event) =>
                    updateRun(openRun.id, { name: event.target.value })
                  }
                />
              </label>
              <label>
                Delivery date
                <input
                  type="date"
                  value={openRun.deliveryDate}
                  onChange={(event) =>
                    updateRun(openRun.id, { deliveryDate: event.target.value })
                  }
                />
              </label>
              <label>
                Warehouse
                <input
                  value={openRun.warehouse}
                  onChange={(event) =>
                    updateRun(openRun.id, { warehouse: event.target.value })
                  }
                />
              </label>
              <label>
                Linked customer group
                <select
                  value={openRun.installationGroupId || ""}
                  onChange={(event) => {
                    const groupId = event.target.value;
                    const group = groups.find((item) => item.id === groupId);
                    updateRun(openRun.id, {
                      installationGroupId: groupId,
                      jobIds: group?.jobIds ?? [],
                    });
                  }}
                >
                  <option value="">No linked group</option>
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
                  value={openRun.deliveryPic || ""}
                  onChange={(event) =>
                    updateRun(openRun.id, { deliveryPic: event.target.value })
                  }
                />
              </label>
              <label>
                Contact number
                <input
                  type="tel"
                  value={openRun.contactNumber || ""}
                  onChange={(event) =>
                    updateRun(openRun.id, { contactNumber: event.target.value })
                  }
                />
              </label>
            </div>
            <div className="table-wrap">
              <table>
                <thead><tr><th>Customer</th><th>Location</th><th>Stock details</th><th>Contact</th><th>Installation</th></tr></thead>
                <tbody>
                  {jobs
                    .filter((job) => openRun.jobIds.includes(job.id))
                    .map((job) => (
                      <tr key={job.id} onClick={() => onOpenJob(job.id)}>
                        <td><strong>{job.customerName}</strong><span>{job.invoiceNumber}</span></td>
                        <td>{job.city || job.state || "Not available"}</td>
                        <td onClick={(event) => event.stopPropagation()}>
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
                        </td>
                        <td>{job.deliveryContactNumber || job.customerPhone}</td>
                        <td>{job.installationDate || "Not scheduled"}</td>
                      </tr>
                    ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function Metric({
  label,
  value,
  note,
  icon,
  tone,
  accent,
  hint,
  onClick,
}: {
  label: string;
  value: number;
  note: string;
  icon: React.ReactNode;
  tone?: "warning";
  accent?: "amber" | "red";
  hint?: string;
  onClick?: () => void;
}) {
  const className = [
    "metric",
    tone ?? "",
    accent ? `metric-accent-${accent}` : "",
    onClick ? "metric-clickable" : "",
  ]
    .filter(Boolean)
    .join(" ");

  const body = (
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
      <button type="button" className={className} onClick={onClick} title={hint}>
        {body}
      </button>
    );
  }

  return (
    <article className={className} title={hint}>
      {body}
    </article>
  );
}

// WMO weather codes. Drawn with lucide icons rather than emoji: the sun and
// cloud characters have no emoji presentation by default, so they rendered as
// near-invisible monochrome glyphs.
function WeatherGlyph({ code, size = 15 }: { code: number; size?: number }) {
  if (code >= 95) {
    return <CloudLightning size={size} className="weather-glyph storm" aria-label="Thunderstorm" />;
  }
  if (code >= 51) {
    return <CloudRain size={size} className="weather-glyph rain" aria-label="Rain" />;
  }
  if (code >= 1) {
    return <CloudSun size={size} className="weather-glyph cloudy" aria-label="Partly cloudy" />;
  }
  return <Sun size={size} className="weather-glyph sunny" aria-label="Clear" />;
}

function StatusDot({ status }: { status: "good" | "warning" | "danger" | "neutral" }) {
  return <span className={`status-dot ${status}`} aria-hidden="true" />;
}

function JobDetail({
  job,
  locationGroupLabel,
  group,
  deliveryRun,
  availableSuggestion,
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
  availableSuggestion: AvailableSuggestion | null;
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

  const teamRows = job.teams.map((team) => ({
    key: team.id,
    label:
      team.activity === "other"
        ? team.customActivity || "Other activity"
        : installationActivities.find(
            (activity) => activity.value === team.activity,
          )?.label || "Installation activity",
    value: team.teamName + (team.contact ? " · " + team.contact : ""),
  }));

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
