"use client";

import {
  AlertTriangle,
  CalendarDays,
  Check,
  ChevronRight,
  Clock3,
  FileSearch,
  Filter,
  LoaderCircle,
  MapPin,
  Moon,
  PackageCheck,
  Phone,
  RefreshCw,
  Search,
  Sun,
  Truck,
  Users,
  X,
  Zap,
} from "lucide-react";
import { Fragment, useCallback, useEffect, useMemo, useState } from "react";
import dynamic from "next/dynamic";
import type {
  InstallationJob,
  JobUpdate,
  TeamAssignment,
} from "@/lib/types";

const PlanningMap = dynamic(() => import("@/app/components/PlanningMap"), {
  ssr: false,
});

type JobsResponse = {
  jobs: InstallationJob[];
  source: "live" | "demo";
  persistence: "supabase" | "browser";
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
const THEME_STORAGE_KEY = "installation-ops-theme";

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

const teamRoles: { value: TeamAssignment["role"]; label: string }[] = [
  { value: "roof", label: "Roof / panel" },
  { value: "wiring", label: "Wiring / electrical" },
  { value: "battery_inverter", label: "Battery / inverter" },
  { value: "supervisor", label: "Site supervisor" },
];

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

function mergeBrowserUpdates(jobs: InstallationJob[]) {
  try {
    const saved = JSON.parse(
      window.localStorage.getItem(STORAGE_KEY) || "{}",
    ) as Record<string, JobUpdate>;
    return jobs.map((job) => {
      const merged = { ...job, ...(saved[job.id] ?? {}) };
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
  } catch {
    return jobs;
  }
}

export default function DashboardPage() {
  const [view, setView] = useState<DashboardView>("pipeline");
  const [jobs, setJobs] = useState<InstallationJob[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState("active");
  const [stateFilter, setStateFilter] = useState("all");
  const [installationDateFilter, setInstallationDateFilter] = useState("");
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [meta, setMeta] = useState<Omit<JobsResponse, "jobs"> | null>(null);
  const [editMode, setEditMode] = useState(false);
  const [sldOpen, setSldOpen] = useState(false);
  const [darkMode, setDarkMode] = useState(false);
  const [groups, setGroups] = useState<InstallationGroup[]>([]);
  const [deliveryRuns, setDeliveryRuns] = useState<DeliveryRun[]>([]);
  const [teamResources, setTeamResources] =
    useState<TeamResource[]>(defaultTeamResources);
  const [teamWeekAssignments, setTeamWeekAssignments] = useState<
    TeamWeekAssignment[]
  >([]);
  const [composer, setComposer] = useState<"group" | "delivery" | null>(null);
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

  useEffect(() => {
    const savedTheme = window.localStorage.getItem(THEME_STORAGE_KEY);
    const useDark =
      savedTheme === "dark" ||
      (!savedTheme && window.matchMedia("(prefers-color-scheme: dark)").matches);
    setDarkMode(useDark);
    document.documentElement.dataset.theme = useDark ? "dark" : "light";

    try {
      setGroups(
        JSON.parse(window.localStorage.getItem(GROUPS_STORAGE_KEY) || "[]"),
      );
      setDeliveryRuns(
        JSON.parse(
          window.localStorage.getItem(DELIVERY_RUNS_STORAGE_KEY) || "[]",
        ),
      );
      setTeamResources(
        JSON.parse(
          window.localStorage.getItem(TEAMS_STORAGE_KEY) ||
            JSON.stringify(defaultTeamResources),
        ),
      );
      setTeamWeekAssignments(
        JSON.parse(
          window.localStorage.getItem(TEAM_WEEKS_STORAGE_KEY) || "[]",
        ),
      );
    } catch {
      setGroups([]);
      setDeliveryRuns([]);
    }
  }, []);

  const loadJobs = useCallback(async (manual = false) => {
    manual ? setSyncing(true) : setLoading(true);
    setNotice(null);
    try {
      const response = await fetch("/api/jobs", { cache: "no-store" });
      const data = (await response.json()) as JobsResponse;
      if (!response.ok) throw new Error("Could not load installation jobs.");
      const merged = mergeBrowserUpdates(data.jobs);
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

  const states = useMemo(
    () =>
      Array.from(new Set(jobs.map((job) => job.state).filter(Boolean))).sort(),
    [jobs],
  );

  const filteredJobs = useMemo(() => {
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
  }, [jobs, query, stateFilter, status, installationDateFilter]);

  const selected = jobs.find((job) => job.id === selectedId) ?? null;

  const metrics = useMemo(
    () => ({
      newJobs: jobs.filter((job) => job.scheduleStatus === "ready_to_schedule")
        .length,
      ready: jobs.filter(isReady).length,
      attention: jobs.filter(
        (job) =>
          job.scheduleStatus === "pending_approval" ||
          job.deliveryStatus === "pending_stock" ||
          job.paymentPercent < 59,
      ).length,
      scheduled: jobs.filter((job) => Boolean(job.installationDate)).length,
    }),
    [jobs],
  );

  const groupByJobId = useMemo(() => {
    const result = new Map<string, InstallationGroup>();
    groups.forEach((group) =>
      group.jobIds.forEach((jobId) => result.set(jobId, group)),
    );
    return result;
  }, [groups]);

  const deliveryRunByJobId = useMemo(() => {
    const result = new Map<string, DeliveryRun>();
    deliveryRuns.forEach((run) =>
      run.jobIds.forEach((jobId) => result.set(jobId, run)),
    );
    return result;
  }, [deliveryRuns]);

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
  }

  function saveDeliveryRuns(next: DeliveryRun[]) {
    setDeliveryRuns(next);
    window.localStorage.setItem(DELIVERY_RUNS_STORAGE_KEY, JSON.stringify(next));
  }

  function saveTeamResources(next: TeamResource[]) {
    setTeamResources(next);
    window.localStorage.setItem(TEAMS_STORAGE_KEY, JSON.stringify(next));
  }

  function saveTeamWeekAssignments(next: TeamWeekAssignment[]) {
    setTeamWeekAssignments(next);
    window.localStorage.setItem(TEAM_WEEKS_STORAGE_KEY, JSON.stringify(next));
  }

  function toggleTheme() {
    const next = !darkMode;
    setDarkMode(next);
    document.documentElement.dataset.theme = next ? "dark" : "light";
    window.localStorage.setItem(THEME_STORAGE_KEY, next ? "dark" : "light");
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
    setView("groups");
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

    const saved = JSON.parse(
      window.localStorage.getItem(STORAGE_KEY) || "{}",
    ) as Record<string, JobUpdate>;
    saved[updated.id] = operationalUpdate(updated);
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(saved));

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
        setNotice("Installation job saved to Supabase.");
      } else {
        setNotice("Saved in this browser. Add the Supabase service key for shared persistence.");
      }
      setEditMode(false);
    } catch {
      setNotice("Saved in this browser. Supabase is currently unavailable.");
      setEditMode(false);
    } finally {
      setSaving(false);
    }
  }

  async function saveAvailability(updated: InstallationJob) {
    if (updated.customerAvailabilityStatus === "unavailable") {
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
    <main className="app-shell">
      <header className="topbar">
        <div className="brand">
          <div className="brand-logo">
            <img
              src="/eternalgy-logo.png"
              alt="Eternalgy"
              width="1544"
              height="628"
            />
          </div>
          <div>
            <strong>Installation Operations</strong>
            <span>Solar scheduling and delivery</span>
          </div>
        </div>
        <div className="topbar-actions">
          <button
            className="icon-button theme-toggle"
            aria-label={darkMode ? "Use light mode" : "Use dark mode"}
            onClick={toggleTheme}
          >
            {darkMode ? <Sun size={18} /> : <Moon size={18} />}
          </button>
          <div className="connection">
            <span className={`connection-dot ${meta?.source === "live" ? "live" : ""}`} />
            {meta?.source === "live" ? "Live source" : "Demo source"}
          </div>
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

      <nav className="dashboard-tabs" aria-label="Installation workspaces">
        {(
          [
            ["pipeline", "Active pipeline"],
            ["teams", "Team planning"],
            ["groups", "Installation groups"],
            ["delivery", "Stock delivery"],
          ] as [DashboardView, string][]
        ).map(([value, label]) => (
          <button
            key={value}
            className={view === value ? "active" : ""}
            onClick={() => setView(value)}
          >
            {value === "pipeline" && <Search size={16} />}
            {value === "groups" && <CalendarDays size={16} />}
            {value === "teams" && <Users size={16} />}
            {value === "delivery" && <Truck size={16} />}
            {label}
          </button>
        ))}
      </nav>

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
          label="New from API"
          value={metrics.newJobs}
          note="Ready for scheduling"
          icon={<RefreshCw size={18} />}
        />
        <Metric
          label="Ready to install"
          value={metrics.ready}
          note="All requirements met"
          icon={<Check size={18} />}
        />
        <Metric
          label="Needs attention"
          value={metrics.attention}
          note="SEDA, stock, or payment"
          icon={<AlertTriangle size={18} />}
          tone="warning"
        />
        <Metric
          label="Dates arranged"
          value={metrics.scheduled}
          note="Upcoming installations"
          icon={<CalendarDays size={18} />}
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
            </div>
          </div>

          <div className="pipeline-heading">
            <div>
              <h2>Active installation pipeline</h2>
              <p>{filteredJobs.length} jobs shown</p>
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
              <table>
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
                    <th>Installation date</th>
                    <th aria-label="Open" />
                  </tr>
                </thead>
                <tbody>
                  {filteredJobs.map((job) => (
                    <tr
                      key={job.id}
                      className={selected?.id === job.id ? "selected" : ""}
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
              setView("pipeline");
            }}
          />
        )}

        {view === "teams" && (
          <TeamPlanningView
            groups={groups}
            jobs={jobs}
            onCreateSuggestedGroup={(name, area, jobIds) => {
              const movingJobIds = new Set(jobIds);
              saveGroups([
                ...groups.map((group) => ({
                  ...group,
                  jobIds: group.jobIds.filter(
                    (jobId) => !movingJobIds.has(jobId),
                  ),
                })),
                {
                  id: crypto.randomUUID(),
                  name,
                  area,
                  installationDate: "",
                  installationEndDate: "",
                  jobIds,
                  installationTeam: "",
                  wiringTeam: "",
                  supervisor: "",
                },
              ]);
              setView("groups");
            }}
            onUpdateJob={(job) => void saveAvailability(job)}
            onAssignCustomerToGroup={assignJobToGroup}
          />
        )}

        {view === "delivery" && (
          <DeliveryPlanningView
            runs={deliveryRuns}
            jobs={jobs}
            groups={groups}
            onOpenJob={setSelectedId}
            onChange={saveDeliveryRuns}
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
              editing={editMode}
              saving={saving}
              sldOpen={sldOpen}
              onEdit={() => setEditMode(true)}
              onCancel={() => setEditMode(false)}
              onSave={(job) => void saveAvailability(job)}
              onOpenSld={() => setSldOpen(true)}
              onCloseSld={() => setSldOpen(false)}
              onDismiss={() => {
                setSelectedId(null);
                setEditMode(false);
                setSldOpen(false);
              }}
              availableTeams={teamResources}
            />
          </div>
        </div>
      )}
    </main>
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
}) {
  const [groupsWorkspace, setGroupsWorkspace] = useState<
    "schedule" | "teams"
  >("schedule");
  const [openGroupId, setOpenGroupId] = useState<string | null>(null);
  const [expandedWeekKey, setExpandedWeekKey] = useState<string | null>(null);
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
  const [expandedTeamId, setExpandedTeamId] = useState<string | null>(null);

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
      const postcode = postcodeForJob(firstJob);
      const coordinates =
        WEATHER_COORDINATES_BY_POSTCODE_PREFIX[postcode.slice(0, 3)];
      if (coordinates) locations.set(postcode.slice(0, 3), coordinates);
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

  const unscheduledGroups = groups.filter((group) => !group.installationDate);
  const openGroup = groups.find((group) => group.id === openGroupId) || null;

  return (
    <div className="planning-panel">
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

      <div className="groups-workspace-tabs" role="tablist" aria-label="Installation group workspaces">
        <button
          className={groupsWorkspace === "schedule" ? "active" : ""}
          onClick={() => setGroupsWorkspace("schedule")}
          role="tab"
          aria-selected={groupsWorkspace === "schedule"}
        >
          Schedule &amp; assign
        </button>
        <button
          className={groupsWorkspace === "teams" ? "active" : ""}
          onClick={() => setGroupsWorkspace("teams")}
          role="tab"
          aria-selected={groupsWorkspace === "teams"}
        >
          Team management
        </button>
      </div>

      {groupsWorkspace === "teams" && (
        <section className="unified-team-management">
          <div className="group-header">
            <div>
              <h3>Team management</h3>
              <p>Manage each team, its members, and weekly locations in one row.</p>
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
          <div className="table-wrap unified-team-table">
            <table>
              <thead>
                <tr>
                  <th>Team</th>
                  <th>Role</th>
                  <th>Members</th>
                  <th>Contact</th>
                  <th>Base location</th>
                  <th>Current / next weekly location</th>
                  <th aria-label="Actions" />
                </tr>
              </thead>
              <tbody>
                {teams.map((team) => {
                  const assignments = weekAssignments
                    .filter((assignment) => assignment.teamId === team.id)
                    .sort((a, b) => a.startDate.localeCompare(b.startDate));
                  const today = new Date().toISOString().slice(0, 10);
                  const currentAssignment =
                    assignments.find(
                      (assignment) =>
                        assignment.startDate <= today &&
                        assignment.endDate >= today,
                    ) ?? assignments.find((assignment) => assignment.startDate > today);
                  const currentGroup = groups.find(
                    (group) =>
                      group.id === currentAssignment?.installationGroupId,
                  );
                  const expanded = expandedTeamId === team.id;
                  return (
                    <Fragment key={team.id}>
                      <tr>
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
                          {currentAssignment ? (
                            <button
                              className="team-assignment-summary"
                              onClick={() => {
                                setExpandedTeamId(team.id);
                                setWeekDraft({
                                  teamId: team.id,
                                  startDate: "",
                                  endDate: "",
                                  installationGroupId: "",
                                });
                              }}
                            >
                              <strong>{currentGroup?.name || "Group unavailable"}</strong>
                              <span>
                                {currentGroup?.area || "Location unavailable"} ·{" "}
                                {currentAssignment.startDate} to {currentAssignment.endDate}
                              </span>
                            </button>
                          ) : (
                            <span className="muted-cell">No weekly assignment</span>
                          )}
                        </td>
                        <td>
                          <div className="row-actions">
                            <button
                              className="text-button"
                              onClick={() => {
                                setExpandedTeamId(expanded ? null : team.id);
                                setWeekDraft({
                                  teamId: team.id,
                                  startDate: "",
                                  endDate: "",
                                  installationGroupId: "",
                                });
                              }}
                            >
                              {expanded ? "Close" : "Assignments"}
                            </button>
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
                      {expanded && (
                        <tr className="expanded-team-assignment-row">
                          <td colSpan={7}>
                            <div className="expanded-team-assignment">
                              <div className="expanded-assignment-heading">
                                <div>
                                  <strong>{team.name} weekly locations</strong>
                                  <span>{assignments.length} assignment{assignments.length === 1 ? "" : "s"}</span>
                                </div>
                              </div>
                              <div className="inline-weekly-assignment">
                                <input
                                  type="date"
                                  value={weekDraft.startDate}
                                  onChange={(event) =>
                                    setWeekDraft({
                                      ...weekDraft,
                                      teamId: team.id,
                                      startDate: event.target.value,
                                    })
                                  }
                                  aria-label="Assignment from date"
                                />
                                <input
                                  type="date"
                                  min={weekDraft.startDate || undefined}
                                  value={weekDraft.endDate}
                                  onChange={(event) =>
                                    setWeekDraft({
                                      ...weekDraft,
                                      teamId: team.id,
                                      endDate: event.target.value,
                                    })
                                  }
                                  aria-label="Assignment until date"
                                />
                                <select
                                  value={weekDraft.installationGroupId}
                                  onChange={(event) =>
                                    setWeekDraft({
                                      ...weekDraft,
                                      teamId: team.id,
                                      installationGroupId: event.target.value,
                                    })
                                  }
                                  aria-label="Assigned installation group"
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
                                  onClick={addWeekAssignment}
                                  disabled={
                                    !weekDraft.startDate ||
                                    !weekDraft.endDate ||
                                    !weekDraft.installationGroupId
                                  }
                                >
                                  Add assignment
                                </button>
                              </div>
                              <div className="assignment-chip-list">
                                {assignments.length === 0 ? (
                                  <span className="muted-cell">No weekly locations assigned.</span>
                                ) : (
                                  assignments.map((assignment) => {
                                    const assignmentGroup = groups.find(
                                      (group) =>
                                        group.id === assignment.installationGroupId,
                                    );
                                    return (
                                      <div className="assignment-chip" key={assignment.id}>
                                        <div>
                                          <strong>{assignmentGroup?.name || "Group unavailable"}</strong>
                                          <span>
                                            {assignmentGroup?.area || "Location unavailable"} ·{" "}
                                            {assignment.startDate} to {assignment.endDate}
                                          </span>
                                        </div>
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
                                          <X size={15} />
                                        </button>
                                      </div>
                                    );
                                  })
                                )}
                              </div>
                            </div>
                          </td>
                        </tr>
                      )}
                    </Fragment>
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
            <button className="button primary" onClick={onCreate}>
              <CalendarDays size={16} />
              Create group
            </button>
          </div>

          <div className="week-list">
            {weekChunks.map((weekDates, weekIndex) => {
              const weekKey = dateKey(weekDates[0]);
              const weekGroups = groupsForWeek(weekDates);
              const isExpanded = expandedWeekKey === weekKey;
              return (
                <div
                  className={`week-card${isExpanded ? " expanded" : ""}`}
                  key={weekIndex}
                >
                  <button
                    type="button"
                    className="week-card-header"
                    onClick={() =>
                      setExpandedWeekKey(isExpanded ? null : weekKey)
                    }
                    aria-expanded={isExpanded}
                  >
                    <div className="week-card-header-text">
                      <span className="week-row-range">
                        {formatWeekRange(weekDates)}
                      </span>
                      <span className="week-row-groups">
                        {weekGroups.length === 0 ? (
                          <span className="week-row-empty">
                            No groups scheduled
                          </span>
                        ) : (
                          weekGroups.map((group) => {
                            const staffing = groupStaffing(group);
                            return (
                              <span
                                className={`week-row-group ${staffing}`}
                                key={group.id}
                              >
                                {group.name}
                                {group.area ? ` · ${group.area}` : ""}
                                <span className="week-row-group-count">
                                  <Users size={11} /> {group.jobIds.length}
                                </span>
                              </span>
                            );
                          })
                        )}
                      </span>
                    </div>
                    <ChevronRight size={16} className="week-card-chevron" />
                  </button>

                  {isExpanded && (
                    <div className="week-card-body">
                      {weekGroups.length > 0 && (
                        <div className="week-view-groups">
                          {weekGroups.map((group) => {
                            const staffing = groupStaffing(group);
                            return (
                              <div
                                className="week-view-group-bar"
                                key={group.id}
                              >
                                <div className="week-view-group-info">
                                  <span className="week-view-group-name">
                                    {group.name}
                                    {group.area ? ` · ${group.area}` : ""}
                                  </span>
                                  <span
                                    className={`week-view-group-status ${staffing}`}
                                  >
                                    {staffingLabel(staffing)}
                                  </span>
                                  <span className="week-view-group-teams">
                                    Install:{" "}
                                    {group.installationTeam || "unassigned"} ·
                                    Wiring:{" "}
                                    {group.wiringTeam || "unassigned"}
                                  </span>
                                  <span className="week-view-group-count">
                                    <Users size={12} /> {group.jobIds.length}{" "}
                                    customers
                                  </span>
                                </div>
                                <button
                                  className="button secondary"
                                  onClick={() => setOpenGroupId(group.id)}
                                >
                                  Edit group
                                </button>
                              </div>
                            );
                          })}
                        </div>
                      )}

                      <div
                        className="standard-calendar-weekdays"
                        aria-hidden="true"
                      >
                        {["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map(
                          (day) => (
                            <span key={day}>{day}</span>
                          ),
                        )}
                      </div>

                      <div className="week-view-days">
                        {weekDates.map((date) => {
                          const key = dateKey(date);
                          const group = groupForDate(key);
                          const staffing = group
                            ? groupStaffing(group)
                            : null;
                          const dayCustomers = customersForDate(key);
                          const dayDeliveryCount = deliveryRuns.filter(
                            (run) => run.deliveryDate === key,
                          ).length;
                          const weather = calendarWeather[key];
                          const weatherIcon = weather
                            ? weather.weatherCode >= 95
                              ? "⛈"
                              : weather.weatherCode >= 51
                                ? "🌧"
                                : weather.weatherCode >= 1
                                  ? "⛅"
                                  : "☀"
                            : "";
                          const showWeather =
                            weather && weather.rainProbability >= 40;
                          return (
                            <button
                              key={key}
                              type="button"
                              className={`week-day-box${staffing ? ` ${staffing}` : ""}`}
                              onClick={() => onJumpToDate(key)}
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
                                    {weatherIcon} {weather.rainProbability}%
                                  </span>
                                )}
                              </div>
                              {dayCustomers.length > 0 && (
                                <div className="week-day-box-customers">
                                  {dayCustomers.slice(0, 3).map((job) => (
                                    <span key={job.id}>
                                      {formatPersonName(job.customerName)}
                                    </span>
                                  ))}
                                  {dayCustomers.length > 3 && (
                                    <span>
                                      +{dayCustomers.length - 3} more
                                    </span>
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
                  )}
                </div>
              );
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
  onCreateSuggestedGroup,
  onUpdateJob,
  onAssignCustomerToGroup,
}: {
  groups: InstallationGroup[];
  jobs: InstallationJob[];
  onCreateSuggestedGroup: (
    name: string,
    area: string,
    jobIds: string[],
  ) => void;
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
      job.customerAvailabilityStatus !== "unavailable" &&
      (planningFilter === "special" || matchesPlanningStatus(job)),
  );
  const filteredPlanningJobIds = new Set(
    jobs
      .filter(
        (job) =>
          hasPlanningEligibility(job) &&
          matchesPlanningStatus(job) &&
          job.scheduleStatus !== "installed" &&
          job.customerAvailabilityStatus !== "unavailable",
      )
      .map((job) => job.id),
  );
  const unavailableJobs = (
    planningFilter === "special" ? approvedSpecialCases : jobs
  ).filter(
    (job) =>
      job.customerAvailabilityStatus === "unavailable" &&
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
      const key = `${town}|${postcode || "no-postcode"}|${state}`;
      const current = byLocation.get(key);
      byLocation.set(key, {
        town,
        postcode,
        state,
        customers: [...(current?.customers ?? []), job],
      });
    });
    return Array.from(byLocation.values()).flatMap(
      ({ town, postcode, state, customers }) => {
      const chunks = [];
      for (let index = 0; index < customers.length; index += 5) {
        chunks.push({
          id: `${town}-${postcode || state}-${index / 5 + 1}`,
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

  const filteredSuggestions = useMemo(() => {
    const postcodeSearch = postcodeFilter.trim().toLowerCase();
    if (!postcodeSearch) return displayedSuggestions;
    return displayedSuggestions.filter((suggestion) =>
      suggestion.postcode.toLowerCase().includes(postcodeSearch),
    );
  }, [displayedSuggestions, postcodeFilter]);

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
  const addableCustomers = jobs
    .filter(
      (job) =>
        previewSuggestion &&
        !previewSuggestion.customers.some(
          (customer) => customer.id === job.id,
        ) &&
        job.customerAvailabilityStatus !== "unavailable" &&
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
    <div className="planning-panel">
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
                <th>Planning range</th>
                <th aria-label="Create group" />
              </tr>
            </thead>
            <tbody>
              {filteredSuggestions.map((suggestion) => (
                <tr
                  key={suggestion.id}
                  onMouseEnter={() => setHighlightedMapGroupId(suggestion.id)}
                  onMouseLeave={() => setHighlightedMapGroupId(null)}
                  onClick={() => {
                    setMapFocusGroupId(suggestion.id);
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
                  <td>Up to {rangeKm} km</td>
                  <td>
                    <button
                      className="button primary"
                      onClick={(event) => {
                        event.stopPropagation();
                        clearSuggestionDraft(suggestion.id);
                        onCreateSuggestedGroup(
                          `${suggestion.area} · Suggested`,
                          [
                            suggestion.area,
                            suggestion.postcode,
                            suggestion.state,
                          ]
                            .filter(Boolean)
                            .join(" · "),
                          suggestion.customers.map((job) => job.id),
                        );
                      }}
                    >
                      Create group
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
          onMouseDown={() => setPreviewSuggestion(null)}
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
                  onClick={() => setPreviewSuggestion(null)}
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
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Customer</th>
                    <th>Address</th>
                    <th>Payment</th>
                    <th>SEDA</th>
                    <th>Customer availability</th>
                    <th>Preferred installation date</th>
                    <th>Availability remarks</th>
                  </tr>
                </thead>
                <tbody>
                  {previewSuggestion.customers.map((job) => (
                    <tr key={job.id}>
                      <td>
                        <strong>{formatPersonName(job.customerName)}</strong>
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
                      <td>
                        {job.address
                          ? formatCustomerAddress(job.address)
                          : "Address not available"}
                      </td>
                      <td>{job.paymentPercent.toFixed(0)}%</td>
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
                            if (status === "unavailable") {
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
                  ))}
                </tbody>
              </table>
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
  onCreate,
}: {
  runs: DeliveryRun[];
  jobs: InstallationJob[];
  groups: InstallationGroup[];
  onOpenJob: (id: string) => void;
  onChange: (runs: DeliveryRun[]) => void;
  onCreate: () => void;
}) {
  function updateRun(id: string, update: Partial<DeliveryRun>) {
    onChange(runs.map((run) => (run.id === id ? { ...run, ...update } : run)));
  }

  if (runs.length === 0) {
    return (
      <div className="planning-panel empty-state">
        <Truck />
        <p>Create an empty delivery run, then link customers from Active Pipeline.</p>
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
        const runJobs = jobs.filter((job) => run.jobIds.includes(job.id));
        const linkedGroup = groups.find(
          (group) => group.id === run.installationGroupId,
        );
        return (
          <section className="planning-group" key={run.id}>
            <div className="group-header">
              <div>
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
              </div>
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
            <div className="delivery-run-edit-grid">
              <label>
                Delivery run name
                <input
                  value={run.name}
                  onChange={(event) =>
                    updateRun(run.id, { name: event.target.value })
                  }
                />
              </label>
              <label>
                Delivery date
                <input
                  type="date"
                  value={run.deliveryDate}
                  onChange={(event) =>
                    updateRun(run.id, { deliveryDate: event.target.value })
                  }
                />
              </label>
              <label>
                Warehouse
                <input
                  value={run.warehouse}
                  onChange={(event) =>
                    updateRun(run.id, { warehouse: event.target.value })
                  }
                />
              </label>
              <label>
                Linked customer group
                <select
                  value={run.installationGroupId || ""}
                  onChange={(event) => {
                    const groupId = event.target.value;
                    const group = groups.find((item) => item.id === groupId);
                    updateRun(run.id, {
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
                  value={run.deliveryPic || ""}
                  onChange={(event) =>
                    updateRun(run.id, { deliveryPic: event.target.value })
                  }
                />
              </label>
              <label>
                Contact number
                <input
                  type="tel"
                  value={run.contactNumber || ""}
                  onChange={(event) =>
                    updateRun(run.id, { contactNumber: event.target.value })
                  }
                />
              </label>
            </div>
            <div className="table-wrap">
              <table>
                <thead><tr><th>Customer</th><th>Location</th><th>Stock details</th><th>Contact</th><th>Installation</th></tr></thead>
                <tbody>
                  {runJobs.map((job) => (
                    <tr key={job.id} onClick={() => onOpenJob(job.id)}>
                      <td><strong>{job.customerName}</strong><span>{job.invoiceNumber}</span></td>
                      <td>{job.city || job.state || "Not available"}</td>
                      <td>{job.stockDetails || "Not entered"}</td>
                      <td>{job.deliveryContactNumber || job.customerPhone}</td>
                      <td>{job.installationDate || "Not scheduled"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        );
      })}
    </div>
  );
}

function Metric({
  label,
  value,
  note,
  icon,
  tone,
}: {
  label: string;
  value: number;
  note: string;
  icon: React.ReactNode;
  tone?: "warning";
}) {
  return (
    <article className={`metric ${tone ?? ""}`}>
      <div>
        <span>{label}</span>
        <strong>{value}</strong>
        <small>{note}</small>
      </div>
      <div className="metric-icon">{icon}</div>
    </article>
  );
}

function StatusDot({ status }: { status: "good" | "warning" | "danger" | "neutral" }) {
  return <span className={`status-dot ${status}`} aria-hidden="true" />;
}

function JobDetail({
  job,
  editing,
  saving,
  sldOpen,
  onEdit,
  onCancel,
  onSave,
  onOpenSld,
  onCloseSld,
  onDismiss,
  availableTeams,
}: {
  job: InstallationJob;
  editing: boolean;
  saving: boolean;
  sldOpen: boolean;
  onEdit: () => void;
  onCancel: () => void;
  onSave: (job: InstallationJob) => void;
  onOpenSld: () => void;
  onCloseSld: () => void;
  onDismiss: () => void;
  availableTeams: TeamResource[];
}) {
  const [draft, setDraft] = useState(job);

  useEffect(() => setDraft(job), [job]);

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
    {
      label: "Teams",
      value: job.teams.length ? `${job.teams.length} assigned` : "Not assigned",
      state: job.teams.length ? "complete" : "pending",
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
    <aside className="detail-panel">
      <div className="detail-header">
        <div>
          <p className="eyebrow">Installation record</p>
          <h2>Customer and operations</h2>
        </div>
        <div className="detail-actions">
          <button
            className="icon-button"
            aria-label="Close customer details"
            onClick={onDismiss}
          >
            <X size={19} />
          </button>
        </div>
      </div>

      <div className="checkpoints">
        {checkpoints.map((item) => (
          <div className={`checkpoint ${item.state}`} key={item.label}>
            <small>{item.label}</small>
            <strong>{item.value}</strong>
          </div>
        ))}
      </div>

      {editing ? (
        <EditJobForm
          draft={draft}
          saving={saving}
          onChange={setDraft}
          onCancel={() => {
            setDraft(job);
            onCancel();
          }}
          onSave={() => onSave(draft)}
          availableTeams={availableTeams}
        />
      ) : (
        <>
          <div className="detail-sections">
          <DetailSection title="Customer details" order={1}>
            <div className="source-detail-grid">
              <SourceField
                label="Invoice number"
                value={job.invoiceNumber}
                emphasis
              />
              <SourceField label="Customer name" value={job.customerName} />
              <SourceField
                label="Installation address"
                value={
                  job.address
                    ? formatCustomerAddress(job.address)
                    : "Address not available"
                }
              />
              <SourceField
                label="Customer contact"
                value={formatPhoneNumber(job.customerPhone)}
              />
              <SourceField
                label="Sales price"
                value={currency(job.totalAmount)}
              />
              <SourceField label="Sales agent" value={job.agentName} />
              <SourceField
                label="Solar panels"
                value={
                  job.panelQuantity && job.panelRating
                    ? `${job.panelQuantity} panels · ${job.panelRating}W each`
                    : job.panelQuantity
                      ? `${job.panelQuantity} panels · Rating not provided`
                      : job.panelRating
                        ? `Quantity not provided · ${job.panelRating}W each`
                        : "Panel specification not provided"
                }
              />
              <SourceField label="Inverter" value={job.inverter} />
              <SourceField
                label="Electrical phase"
                value={
                  job.phase === "Unknown"
                    ? "Phase information not provided"
                    : job.phase
                }
              />
              <SourceField
                label="Battery"
                value={
                  job.battery === "Not available"
                    ? "Battery information not provided"
                    : job.battery
                }
              />
              <SourceField
                label="Ballast"
                value={job.ballastDetails || "No ballast details recorded"}
              />
              <SourceField
                label="FOC details"
                value={job.focDetails || "No FOC details recorded"}
              />
            </div>
            <div className="customer-detail-actions">
              <button className="button primary" onClick={onEdit}>
                Update job
              </button>
              <button className="button secondary" onClick={onOpenSld}>
                <FileSearch size={16} />
                {job.sldUrl ? "View SLD drawing" : "Check SLD drawing"}
              </button>
            </div>
          </DetailSection>

          <DetailSection title="Material stock delivery" order={4}>
            <div className="source-detail-grid">
              <SourceField
                label="Delivery run"
                value={job.deliveryRunName || "Not assigned"}
                emphasis={Boolean(job.deliveryRunName)}
              />
              <SourceField
                label="Group location"
                value={job.deliveryGroupLocation || "Not assigned"}
              />
              <SourceField
                label="Delivery status"
                value={deliveryLabels[job.deliveryStatus]}
                emphasis={job.deliveryStatus === "delivered"}
              />
              <SourceField
                label="Delivery date"
                value={job.deliveryDate || "Not scheduled"}
              />
              <SourceField
                label="Arrival date"
                value={job.arrivalDate || "Not recorded"}
              />
              <SourceField
                label="Delivery contact"
                value={job.deliveryContactNumber || "Not entered"}
              />
              <SourceField
                label="Stock details"
                value={job.stockDetails || "Stock details not entered"}
              />
              <SourceField
                label="Warehouse / origin"
                value={job.warehouseLocation || "Warehouse not selected"}
              />
              <SourceField
                label="Delivery destination"
                value={
                  job.address
                    ? formatCustomerAddress(job.address)
                    : "Client address unavailable"
                }
              />
            </div>
          </DetailSection>

          <DetailSection title="Installation scheduling" order={2}>
            <div className="source-detail-grid">
              <SourceField
                label="Installation date"
                value={job.installationDate || "Not scheduled"}
              />
              <SourceField
                label="Date approval"
                value={approvalLabels[job.installationApprovalStatus]}
              />
              <SourceField
                label="Scheduling status"
                value={statusLabels[job.scheduleStatus]}
                emphasis={job.scheduleStatus === "ready_to_install"}
              />
              <SourceField
                label="Customer availability"
                value={
                  job.customerAvailabilityStatus === "available"
                    ? "Available"
                    : job.customerAvailabilityStatus === "unavailable"
                      ? "Not available"
                      : "Pending confirmation"
                }
              />
              <SourceField
                label="Preferred installation date"
                value={job.preferredInstallationDate || "Not provided"}
              />
              <SourceField
                label="Availability remarks"
                value={job.availabilityRemarks || "No remarks"}
              />
              <SourceField
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
            </div>
          </DetailSection>

          <DetailSection title="Installation details" order={3}>
            <div className="source-detail-grid">
              <SourceField
                label="Panel"
                value={job.panelDetails || "Panel details not entered"}
              />
              <SourceField
                label="Wiring"
                value={job.wiringDetails || "Wiring details not entered"}
              />
              <SourceField
                label="Battery"
                value={job.batteryDetails || "Battery details not entered"}
              />
            </div>
          </DetailSection>

          <DetailSection title="Team assignments" order={5}>
            <div className="source-detail-grid">
              {job.teams.length ? (
                job.teams.map((team) => (
                  <SourceField
                    key={team.id}
                    label={
                      team.activity === "other"
                        ? team.customActivity || "Other activity"
                        : installationActivities.find(
                            (activity) => activity.value === team.activity,
                          )?.label || "Installation activity"
                    }
                    value={`${team.teamName}${
                      team.contact ? ` · ${team.contact}` : ""
                    }`}
                  />
                ))
              ) : (
                <SourceField
                  label="Assigned teams"
                  value="No teams assigned"
                />
              )}
            </div>
          </DetailSection>

          <DetailSection title="Remarks" order={6}>
            <p className="remarks">{job.remarks || "No remarks."}</p>
          </DetailSection>
          </div>
        </>
      )}
    </aside>
  );
}

function EditJobForm({
  draft,
  saving,
  onChange,
  onCancel,
  onSave,
  availableTeams,
}: {
  draft: InstallationJob;
  saving: boolean;
  onChange: (job: InstallationJob) => void;
  onCancel: () => void;
  onSave: () => void;
  availableTeams: TeamResource[];
}) {
  function addTeam() {
    onChange({
      ...draft,
      teams: [
        ...draft.teams,
        {
          id: crypto.randomUUID(),
          role: "roof",
          teamName: "",
          activity: "hooks_rails",
        },
      ],
    });
  }

  return (
    <div className="edit-form">
      <section className="edit-job-section" style={{ order: 1 }}>
        <div className="form-section-heading">
          <Users size={17} />
          <strong>Customer details</strong>
        </div>
        <div className="source-detail-grid">
          <SourceField label="Invoice number" value={draft.invoiceNumber} />
          <SourceField label="Customer" value={draft.customerName} />
          <SourceField
            label="Customer contact"
            value={formatPhoneNumber(draft.customerPhone)}
          />
          <SourceField label="Sales agent" value={draft.agentName} />
          <SourceField label="Sales price" value={currency(draft.totalAmount)} />
          <SourceField label="Inverter" value={draft.inverter} />
          <SourceField label="Phase" value={draft.phase} />
          <SourceField
            label="Address"
            value={
              draft.address
                ? formatCustomerAddress(draft.address)
                : "Not available"
            }
          />
        </div>
      </section>

      <section className="edit-job-section" style={{ order: 4 }}>
      <div className="form-section-heading">
        <PackageCheck size={17} />
        <strong>Material stock delivery</strong>
      </div>
      <div className="form-grid">
        <label>
          Delivery date
          <input
            type="date"
            value={draft.deliveryDate ?? ""}
            onChange={(event) =>
              onChange({ ...draft, deliveryDate: event.target.value || null })
            }
          />
        </label>
        <label>
          Delivery status
          <select
            value={draft.deliveryStatus}
            onChange={(event) =>
              onChange({
                ...draft,
                deliveryStatus: event.target
                  .value as InstallationJob["deliveryStatus"],
              })
            }
          >
            {Object.entries(deliveryLabels).map(([value, label]) => (
              <option value={value} key={value}>
                {label}
              </option>
            ))}
          </select>
        </label>
        <label>
          Arrival date
          <input
            type="date"
            value={draft.arrivalDate ?? ""}
            onChange={(event) =>
              onChange({ ...draft, arrivalDate: event.target.value || null })
            }
          />
        </label>
        <label>
          Delivery contact number
          <input
            type="tel"
            value={draft.deliveryContactNumber}
            onChange={(event) =>
              onChange({
                ...draft,
                deliveryContactNumber: event.target.value,
              })
            }
          />
        </label>
      </div>
      <label>
        Stock details
        <textarea
          rows={3}
          value={draft.stockDetails}
          onChange={(event) =>
            onChange({ ...draft, stockDetails: event.target.value })
          }
          placeholder="Panels, inverter, battery, rails, wiring and quantities"
        />
      </label>
      <label>
        From warehouse / collection location
        <input
          value={draft.warehouseLocation}
          onChange={(event) =>
            onChange({ ...draft, warehouseLocation: event.target.value })
          }
          placeholder="Warehouse name and address"
        />
      </label>
      <div className="destination-preview">
        <span>Deliver to client address</span>
        <strong>
          {draft.address
            ? formatCustomerAddress(draft.address)
            : "Client address unavailable"}
        </strong>
      </div>
      </section>

      <section className="edit-job-section" style={{ order: 2 }}>
      <div className="form-section-heading">
        <CalendarDays size={17} />
        <strong>Installation scheduling</strong>
      </div>
      <div className="form-grid">
        <label>
          Installation date
          <input
            type="date"
            value={draft.installationDate ?? ""}
            onChange={(event) =>
              onChange({ ...draft, installationDate: event.target.value || null })
            }
          />
        </label>
        <label>
          Date approval
          <select
            value={draft.installationApprovalStatus}
            onChange={(event) =>
              onChange({
                ...draft,
                installationApprovalStatus: event.target
                  .value as InstallationJob["installationApprovalStatus"],
              })
            }
          >
            {Object.entries(approvalLabels).map(([value, label]) => (
              <option value={value} key={value}>
                {label}
              </option>
            ))}
          </select>
        </label>
        <label>
          Scheduling status
          <select
            value={draft.scheduleStatus}
            onChange={(event) =>
              onChange({
                ...draft,
                scheduleStatus: event.target
                  .value as InstallationJob["scheduleStatus"],
              })
            }
          >
            {Object.entries(statusLabels).map(([value, label]) => (
              <option value={value} key={value}>
                {label}
              </option>
            ))}
          </select>
        </label>
        <label>
          Customer availability
          <select
            value={draft.customerAvailabilityStatus}
            onChange={(event) =>
              onChange({
                ...draft,
                customerAvailabilityStatus: event.target
                  .value as InstallationJob["customerAvailabilityStatus"],
              })
            }
          >
            <option value="pending">Pending confirmation</option>
            <option value="available">Available</option>
            <option value="unavailable">Not available</option>
          </select>
        </label>
        <label>
          Preferred installation date
          <input
            type="date"
            value={draft.preferredInstallationDate ?? ""}
            onChange={(event) =>
              onChange({
                ...draft,
                preferredInstallationDate: event.target.value || null,
              })
            }
          />
        </label>
      </div>
      <label>
        Customer availability remarks
        <textarea
          rows={3}
          value={draft.availabilityRemarks}
          onChange={(event) =>
            onChange({ ...draft, availabilityRemarks: event.target.value })
          }
          placeholder="Reason unavailable, alternative dates, or confirmation notes"
        />
      </label>

      <div className="form-section-heading">
        <AlertTriangle size={17} />
        <strong>Below-59% special case</strong>
      </div>
      <div className="form-grid">
        <label>
          Management approval
          <select
            value={draft.paymentOverrideStatus}
            onChange={(event) =>
              onChange({
                ...draft,
                paymentOverrideStatus: event.target
                  .value as InstallationJob["paymentOverrideStatus"],
              })
            }
          >
            <option value="none">Not required</option>
            <option value="pending">Pending management approval</option>
            <option value="approved">Approved by management</option>
            <option value="rejected">Rejected</option>
          </select>
        </label>
        <label>
          Approval reason / reference
          <input
            value={draft.paymentOverrideReason}
            onChange={(event) =>
              onChange({ ...draft, paymentOverrideReason: event.target.value })
            }
            placeholder="Required for a special case"
          />
        </label>
      </div>
      </section>

      <section className="edit-job-section" style={{ order: 3 }}>
      <div className="form-section-heading">
        <Zap size={17} />
        <strong>Installation details</strong>
      </div>
      <div className="form-grid">
        <label>
          Panel
          <textarea
            rows={3}
            value={draft.panelDetails}
            onChange={(event) =>
              onChange({ ...draft, panelDetails: event.target.value })
            }
          />
        </label>
        <label>
          Wiring
          <textarea
            rows={3}
            value={draft.wiringDetails}
            onChange={(event) =>
              onChange({ ...draft, wiringDetails: event.target.value })
            }
            placeholder="Wiring requirements and progress"
          />
        </label>
        <label>
          Battery
          <textarea
            rows={3}
            value={draft.batteryDetails}
            onChange={(event) =>
              onChange({ ...draft, batteryDetails: event.target.value })
            }
          />
        </label>
      </div>
      </section>

      <div className="team-editor" style={{ order: 5 }}>
        <div className="section-title">
          <div>
            <Users size={17} />
            <strong>Team assignments</strong>
          </div>
          <button className="text-button" onClick={addTeam} type="button">
            + Add activity
          </button>
        </div>
        {draft.teams.map((team, index) => (
          <div className="activity-assignment" key={team.id}>
            <div className="assignment-header">
              <strong>Activity {index + 1}</strong>
              <button
                className="icon-button"
                aria-label={`Remove activity ${index + 1}`}
                onClick={() =>
                  onChange({
                    ...draft,
                    teams: draft.teams.filter((item) => item.id !== team.id),
                  })
                }
                type="button"
              >
                <X size={16} />
              </button>
            </div>
            <div className="assignment-fields">
              <label>
                Activity
                <select
                  value={team.activity}
                  onChange={(event) => {
                    const teams = [...draft.teams];
                    teams[index] = {
                      ...team,
                      activity: event.target
                        .value as TeamAssignment["activity"],
                    };
                    onChange({ ...draft, teams });
                  }}
                >
                  {installationActivities.map((activity) => (
                    <option value={activity.value} key={activity.value}>
                      {activity.label}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Installation team role
                <select
                  value={team.role}
                  onChange={(event) => {
                    const teams = [...draft.teams];
                    teams[index] = {
                      ...team,
                      role: event.target.value as TeamAssignment["role"],
                      teamName: "",
                    };
                    onChange({ ...draft, teams });
                  }}
                >
                  {teamRoles.map((role) => (
                    <option value={role.value} key={role.value}>
                      {role.label}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Assigned team
                <select
                  value={team.teamName}
                  onChange={(event) => {
                    const teams = [...draft.teams];
                    teams[index] = {
                      ...team,
                      teamName: event.target.value,
                    };
                    onChange({ ...draft, teams });
                  }}
                >
                  <option value="">Select team</option>
                  {availableTeams
                    .filter((availableTeam) =>
                      team.role === "wiring"
                        ? availableTeam.role === "wiring"
                        : availableTeam.role === "installation",
                    )
                    .map((availableTeam) => (
                      <option value={availableTeam.name} key={availableTeam.id}>
                        {availableTeam.name}
                      </option>
                    ))}
                  {team.teamName &&
                    !availableTeams.some(
                      (availableTeam) =>
                        availableTeam.name === team.teamName,
                    ) && <option value={team.teamName}>{team.teamName}</option>}
                </select>
              </label>
              {team.activity === "other" && (
                <label>
                  Other activity
                  <input
                    placeholder="Describe other activity"
                    value={team.customActivity ?? ""}
                    onChange={(event) => {
                      const teams = [...draft.teams];
                      teams[index] = {
                        ...team,
                        customActivity: event.target.value,
                      };
                      onChange({ ...draft, teams });
                    }}
                  />
                </label>
              )}
            </div>
          </div>
        ))}
      </div>

      <label style={{ order: 6 }}>
        Remarks
        <textarea
          rows={4}
          value={draft.remarks}
          onChange={(event) => onChange({ ...draft, remarks: event.target.value })}
          placeholder="Add blockers, customer confirmation, or special instructions…"
        />
      </label>

      <div className="form-actions" style={{ order: 7 }}>
        <button className="button secondary" type="button" onClick={onCancel}>
          Cancel
        </button>
        <button
          className="button primary"
          type="button"
          onClick={onSave}
          disabled={saving || draft.teams.some((team) => !team.teamName.trim())}
        >
          {saving && <LoaderCircle size={16} className="spin" />}
          {saving ? "Saving…" : "Save changes"}
        </button>
      </div>
    </div>
  );
}

function DetailSection({
  title,
  children,
  order,
}: {
  title: string;
  children: React.ReactNode;
  order?: number;
}) {
  return (
    <section className="detail-section" style={{ order }}>
      <h3>{title}</h3>
      {children}
    </section>
  );
}

function DetailRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="detail-row">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function SourceField({
  label,
  value,
  emphasis = false,
}: {
  label: string;
  value: string;
  emphasis?: boolean;
}) {
  return (
    <div className={`source-field ${emphasis ? "emphasis" : ""}`}>
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}
