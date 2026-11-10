"use client";

import { useMemo, useState, useEffect, useRef, startTransition } from "react";
import {
  AlertCircle,
  Briefcase,
  Calendar,
  Car,
  CheckCircle2,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Clock,
  Copy,
  Edit2,
  Filter,
  GraduationCap,
  HardHat,
  Info,
  MapPin,
  Phone,
  Plus,
  RefreshCw,
  Search,
  Shield,
  ShieldAlert,
  ShieldCheck,
  Sparkles,
  Trash2,
  Truck,
  UserCheck,
  UserMinus,
  UserPlus,
  Users,
  Wrench,
  X,
  Zap,
} from "lucide-react";
import type { InstallationJob } from "@/lib/types";
import type { TeamCrewAssignment } from "@/lib/schedule-suggest";

export type ProjectTeamMemberRole = "site_supervisor" | "technician" | "intern";

export type MemberAvailabilityStatus = "available" | "mc" | "leave";

export const EXPERTISE_OPTIONS = [
  "Electrical Wiring (AC/DC)",
  "Inverter & BESS Commissioning",
  "Roof Mounting & Structural",
  "High Voltage / Substation",
  "Testing & Commissioning (T&C)",
  "SEDA & Safety Compliance",
  "Troubleshooting & O&M",
] as const;

export type ExpertiseOption = (typeof EXPERTISE_OPTIONS)[number];

export type ProjectTeamMember = {
  id: string;
  name: string;
  role: ProjectTeamMemberRole;
  phone: string;
  email?: string;
  expertise: string[];
  availability: {
    status: MemberAvailabilityStatus;
    reason?: string;
    startDate?: string;
    endDate?: string;
  };
  assignedCrewId?: string | null;
  notes?: string;
};

export type InstallationCrew = {
  id: string;
  name: string;
  supervisorId?: string | null;
  technicianIds: string[];
  internIds: string[];
  baseLocation: string;
  vehicle?: string;
  targetDate?: string;
  notes?: string;
  installationTeam?: string;
  wiringTeam?: string;
  supervisorsText?: string;
  membersText?: string;
  sectionIndex?: number;
  groupIds?: string[];
};

export function isPlaceholder(value: string | undefined | null): boolean {
  const trimmed = (value ?? "").trim();
  return trimmed === "" || /^[-–—]+$/.test(trimmed);
}

export function isWiringRole(role?: string): boolean {
  return role === "wiring" || role === "wiring_eternalgy";
}

export type TeamResourceItem = {
  id: string;
  name: string;
  role?: string;
  baseLocation?: string;
  contact?: string;
  members?: string[];
  siteSupervisor?: string;
  [key: string]: any;
};

export type VehicleType = "4x4_pickup" | "van" | "sedan_mpv" | "lorry" | "skylift";
export type VehicleAvailabilityStatus = "available" | "in_use" | "maintenance";

export const VEHICLE_SUITABILITY_OPTIONS = [
  "Solar Panel Transport (Roof Rack)",
  "Roof Mounting Rail Carrier",
  "Inverter & Battery (BESS) Weatherproof",
  "High-Rise Roof / Skylift Access",
  "Extension Ladder Mount",
  "Electrical AC/DC Wiring Kits",
  "Outstation & Off-Road 4WD",
  "Bulk Pallet / Heavy Hardware",
] as const;

export type VehicleSuitabilityOption = (typeof VEHICLE_SUITABILITY_OPTIONS)[number];

export type ProjectVehicle = {
  id: string;
  plateNumber: string;
  model: string;
  type: VehicleType;
  capacityPax: number;
  payloadKg: number;
  baseLocation: string;
  suitability: string[];
  status: VehicleAvailabilityStatus;
  currentTeamId?: string | null;
  roadTaxExpiry: string;
  notes?: string;
};

export type ProjectTeamScheduleViewProps = {
  jobs: InstallationJob[];
  groups?: any[];
  teams: any[];
  onTeamsChange?: (teams: any[]) => void;
  onGroupsChange?: (groups: any[]) => void;
  onSaveJob?: (job: InstallationJob) => void;
  todayIso?: string;
  readOnly?: boolean;
  // The crew entered per team on Propose to Install (scheduleDraft.teamCrews),
  // used for weeks still being planned
  proposeTeamCrews?: Partial<Record<number, TeamCrewAssignment>>;
};

const PROJECT_MEMBERS_STORAGE_KEY = "installation_project_team_members_v7";
const PROJECT_CREWS_STORAGE_KEY = "installation_project_crews_v6";
const PROJECT_WEEKLY_CREWS_KEY = "installation_project_weekly_crews_v6";
const PROJECT_CARS_STORAGE_KEY = "installation_project_cars_v4";

// Minimum date / week start for Team Grouping schedule (starting from October 2026)
const MIN_TEAM_GROUPING_DATE = "2026-10-01";
const MIN_TEAM_GROUPING_WEEK = "2026-09-28";

// Date formatting utilities matching Arranged Installation
const DAY_MONTH = new Intl.DateTimeFormat("en-GB", {
  day: "numeric",
  month: "short",
});

function weekBounds(dateStr: string): { start: string; end: string } | null {
  const date = new Date(`${dateStr}T00:00:00`);
  if (Number.isNaN(date.getTime())) return null;
  const local = (value: Date) =>
    `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, "0")}-${String(
      value.getDate()
    ).padStart(2, "0")}`;
  const monday = new Date(date);
  monday.setDate(date.getDate() - ((date.getDay() + 6) % 7));
  const saturday = new Date(monday);
  saturday.setDate(monday.getDate() + 5);
  return { start: local(monday), end: local(saturday) };
}

function weekRangeLabel(dateStr: string): string {
  const bounds = weekBounds(dateStr);
  if (!bounds) return "Unscheduled";
  const part = (value: string) =>
    DAY_MONTH.format(new Date(`${value}T00:00:00`));
  const year = bounds.end.slice(0, 4);
  return `${part(bounds.start)} – ${part(bounds.end)} ${year}`;
}

function addDays(isoDate: string, days: number): string {
  const d = new Date(`${isoDate}T00:00:00`);
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

// Check if a member is unavailable (MC / Leave) during a specific week
function isMemberUnavailableInWeek(member: ProjectTeamMember, weekStart: string): boolean {
  if (member.availability.status === "available") return false;
  const bounds = weekBounds(weekStart);
  if (!bounds) return true;

  const { start: wStart, end: wEnd } = bounds;
  const mStart = member.availability.startDate;
  const mEnd = member.availability.endDate;

  if (mStart && mEnd) {
    return mStart <= wEnd && mEnd >= wStart;
  }
  if (mStart) {
    return mStart <= wEnd;
  }
  return true;
}

// Brand color palette matching Arranged Installation team bands
export function getTeamColor(teamName: string) {
  const m = teamName.match(/\bteam\s*(\d+)\b/i) || teamName.match(/\b(\d+)\b/);
  if (m) {
    const num = Number(m[1]);
    if (num === 1)
      return {
        bg: "#2563eb",
        border: "#2563eb",
        text: "#ffffff",
        subText: "rgba(255, 255, 255, 0.9)",
        badgeBg: "#2563eb",
        badgeText: "#ffffff",
        isLight: false,
      };
    if (num === 2)
      return {
        bg: "#ea580c",
        border: "#ea580c",
        text: "#ffffff",
        subText: "rgba(255, 255, 255, 0.9)",
        badgeBg: "#ea580c",
        badgeText: "#ffffff",
        isLight: false,
      };
    if (num === 3)
      return {
        bg: "#16a34a",
        border: "#16a34a",
        text: "#ffffff",
        subText: "rgba(255, 255, 255, 0.9)",
        badgeBg: "#16a34a",
        badgeText: "#ffffff",
        isLight: false,
      };
    if (num === 4)
      return {
        bg: "#db2777",
        border: "#db2777",
        text: "#ffffff",
        subText: "rgba(255, 255, 255, 0.9)",
        badgeBg: "#db2777",
        badgeText: "#ffffff",
        isLight: false,
      };
    if (num === 0)
      return {
        bg: "#7c3aed",
        border: "#7c3aed",
        text: "#ffffff",
        subText: "rgba(255, 255, 255, 0.9)",
        badgeBg: "#7c3aed",
        badgeText: "#ffffff",
        isLight: false,
      };
    if (num === 6)
      return {
        bg: "#2dd4bf",
        border: "#14b8a6",
        text: "#042f2e",
        subText: "rgba(4, 47, 46, 0.85)",
        badgeBg: "#2dd4bf",
        badgeText: "#042f2e",
        isLight: true,
      };
    if (num === 7)
      return {
        bg: "#b7b7b7",
        border: "#9ca3af",
        text: "#111827",
        subText: "rgba(17, 24, 39, 0.8)",
        badgeBg: "#b7b7b7",
        badgeText: "#111827",
        isLight: true,
      };
  }
  return {
    bg: "#2dd4bf",
    border: "#14b8a6",
    text: "#042f2e",
    subText: "rgba(4, 47, 46, 0.85)",
    badgeBg: "#2dd4bf",
    badgeText: "#042f2e",
    isLight: true,
  };
}

// Canonical Arranged Installation roster configuration
export const KEY_ARRANGED_SUPERVISORS = [
  "kaije",
  "xiangjun",
  "ahzu",
  "siongchin",
  "joshua",
  "kai kian",
  "jia hao",
  "martin hing",
  "wilson",
];

export const KEY_ARRANGED_TECHS = [
  "jamar",
  "amien",
  "sharry",
  "aqim",
  "hamzah",
  "yuan",
  "ah yuan",
  "am",
  "is",
  "harun",
  "muhammad",
  "shahid",
  "saham",
  "mujeeb",
  "sajeeb",
  "raheel",
  "fakhrul",
  "hafizi",
  "adi",
  "jalil",
];

export const KEY_ARRANGED_INTERNS = [
  "hakim",
];

export const ARRANGED_INSTALLATION_NAMES = new Set<string>([
  ...KEY_ARRANGED_SUPERVISORS,
  ...KEY_ARRANGED_TECHS,
  ...KEY_ARRANGED_INTERNS,
  "kaijie",
  "jiajie",
  "ah yuan",
  "loh shun yuan",
  "intern hakim",
]);

// Names that were previously created as mock/dummy entries to be completely deleted
export const CREATED_DUMMY_NAMES = new Set<string>([
  "chan chee man",
  "chat cheh man",
  "jack",
  "john",
  "chong jia ming",
  "arun raj",
  "nur aina",
  "daniel wong",
  "farhan zulkifli",
]);

// Normalizes any string name and resolves its canonical role according to Arranged Installation
export function normalizeArrangedName(
  raw: string,
  contextRole?: ProjectTeamMemberRole
): { name: string; role: ProjectTeamMemberRole } | null {
  if (!raw) return null;
  const isInternHint = /\bintern\b/i.test(raw);
  let clean = raw.trim();
  clean = clean
    .replace(/\([^)]*\)/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (
    !clean ||
    clean === "-" ||
    /^(none|unassigned|tbd|na|n\/a|intern|intern x1|intern 1)$/i.test(clean) ||
    /^\d+$/.test(clean) ||
    clean.length <= 1
  ) {
    return null;
  }

  const lower = clean.toLowerCase();

  // Explicitly ignore any created mock/dummy names
  if (CREATED_DUMMY_NAMES.has(lower)) {
    return null;
  }

  // Known Arranged Installation supervisors
  if (lower === "kaije" || lower === "kaijie" || lower === "jiajie") return { name: "Kaije", role: "site_supervisor" };
  if (lower === "xiangjun" || lower === "xiang jun") return { name: "XiangJun", role: "site_supervisor" };
  if (lower === "ahzu" || lower === "ah zu" || lower === "ah") return { name: "Ahzu", role: "site_supervisor" };
  if (lower === "siongchin" || lower === "siong chin") return { name: "SiongChin", role: "site_supervisor" };
  if (lower === "joshua" || lower === "joshia") return { name: "Joshua", role: "site_supervisor" };
  if (lower === "kai kian" || lower === "kaikian") return { name: "Kai Kian", role: "site_supervisor" };
  if (lower === "jia hao" || lower === "jiahao") return { name: "Jia Hao", role: "site_supervisor" };
  if (lower === "martin" || lower === "martin hing") return { name: "Martin Hing", role: "site_supervisor" };
  if (lower === "wilson") return { name: "Wilson", role: "site_supervisor" };

  // Known Arranged Installation interns
  if (lower === "intern hakim" || lower === "hakim" || lower.startsWith("intern hakim")) return { name: "Hakim", role: "intern" };
  if (lower === "intern" || lower === "intern x1" || lower === "intern 1") return null;

  // Known Arranged Installation technicians
  if (lower === "jamar") return { name: "Jamar", role: "technician" };
  if (lower === "amien") return { name: "Amien", role: "technician" };
  if (lower === "sharry") return { name: "Sharry", role: "technician" };
  if (lower === "aqim") return { name: "Aqim", role: "technician" };
  if (lower === "hamzah") return { name: "Hamzah", role: "technician" };
  if (lower === "yuan" || lower === "ah yuan" || lower === "loh shun yuan") return { name: "Yuan", role: "technician" };
  if (lower === "am" || lower === "team :am" || lower === "team am") return { name: "Am", role: "technician" };
  if (lower === "is" || lower === "team is") return { name: "Is", role: "technician" };
  if (lower === "harun" || lower === "team harun") return { name: "Harun", role: "technician" };
  if (lower === "muhammad" || lower === "amir") return { name: "Muhammad", role: "technician" };
  if (lower === "shahid") return { name: "Shahid", role: "technician" };
  if (lower === "saham") return { name: "Saham", role: "technician" };
  if (lower === "sajeeb") return { name: "Sajeeb", role: "technician" };
  if (lower === "raheel") return { name: "Raheel", role: "technician" };
  if (lower === "mujeeb") return { name: "Mujeeb", role: "technician" };
  if (lower === "fakhrul") return { name: "Fakhrul", role: "technician" };
  if (lower === "hafizi" || lower === "fizi") return { name: "Hafizi", role: "technician" };
  if (lower === "adi") return { name: "Adi", role: "technician" };
  if (lower === "jalil") return { name: "Jalil", role: "technician" };

  // If contextual role provided
  let inferredRole: ProjectTeamMemberRole = contextRole || "technician";
  if (isInternHint || lower.includes("intern")) {
    inferredRole = "intern";
    clean = clean.replace(/intern\s*/i, "").trim() || clean;
  }
  const formattedName = clean.replace(/\b\w/g, (l) => l.toUpperCase());
  return { name: formattedName, role: inferredRole };
}

// Canonical seed members mapped directly from Arranged Installation (only authentic personnel)
export const DEFAULT_MEMBERS: ProjectTeamMember[] = [
  // --- Site Supervisors from Arranged Installation ---
  {
    id: "mem-sup-kaije",
    name: "Kaije",
    role: "site_supervisor",
    phone: "017-890 1234",
    expertise: ["Electrical Wiring (AC/DC)", "Inverter & BESS Commissioning", "Testing & Commissioning (T&C)"],
    availability: { status: "available" },
    assignedCrewId: null,
    notes: "Lead site supervisor in Arranged Installation. Inverter & grid connection specialist.",
  },
  {
    id: "mem-sup-xiangjun",
    name: "XiangJun",
    role: "site_supervisor",
    phone: "017-334 1122",
    expertise: ["Roof Mounting & Structural", "Electrical Wiring (AC/DC)", "Testing & Commissioning (T&C)"],
    availability: { status: "available" },
    assignedCrewId: null,
    notes: "Site supervisor in Arranged Installation.",
  },
  {
    id: "mem-sup-ahzu",
    name: "Ahzu",
    role: "site_supervisor",
    phone: "019-876 5432",
    expertise: ["Roof Mounting & Structural", "Electrical Wiring (AC/DC)", "Testing & Commissioning (T&C)"],
    availability: { status: "available" },
    assignedCrewId: null,
    notes: "Site supervisor & technical installer in Arranged Installation.",
  },
  {
    id: "mem-sup-siongchin",
    name: "SiongChin",
    role: "site_supervisor",
    phone: "012-778 9900",
    expertise: ["Roof Mounting & Structural", "Electrical Wiring (AC/DC)", "Testing & Commissioning (T&C)"],
    availability: { status: "available" },
    assignedCrewId: null,
    notes: "Site supervisor in Arranged Installation.",
  },
  {
    id: "mem-sup-joshua",
    name: "Joshua",
    role: "site_supervisor",
    phone: "012-556 7812",
    expertise: ["SEDA & Safety Compliance", "Roof Mounting & Structural", "Testing & Commissioning (T&C)"],
    availability: { status: "available" },
    assignedCrewId: null,
    notes: "Site supervisor in Arranged Installation.",
  },
  {
    id: "mem-sup-kaikian",
    name: "Kai Kian",
    role: "site_supervisor",
    phone: "016-889 0011",
    expertise: ["Electrical Wiring (AC/DC)", "SEDA & Safety Compliance"],
    availability: { status: "available" },
    assignedCrewId: null,
    notes: "Site supervisor in Arranged Installation.",
  },
  {
    id: "mem-sup-jiahao",
    name: "Jia Hao",
    role: "site_supervisor",
    phone: "013-332 1199",
    expertise: ["Testing & Commissioning (T&C)", "Roof Mounting & Structural"],
    availability: { status: "available" },
    assignedCrewId: null,
    notes: "Site supervisor in Arranged Installation.",
  },
  {
    id: "mem-sup-martin",
    name: "Martin Hing",
    role: "site_supervisor",
    phone: "016-567 8901",
    expertise: ["Inverter & BESS Commissioning", "SEDA & Safety Compliance", "Troubleshooting & O&M"],
    availability: { status: "available" },
    assignedCrewId: null,
    notes: "Commercial & BESS battery storage installation supervisor in Arranged Installation.",
  },
  {
    id: "mem-sup-wilson",
    name: "Wilson",
    role: "site_supervisor",
    phone: "012-998 3344",
    expertise: ["Roof Mounting & Structural", "Testing & Commissioning (T&C)"],
    availability: { status: "available" },
    assignedCrewId: null,
    notes: "Site supervisor in Arranged Installation.",
  },

  // --- Technicians from Arranged Installation ---
  {
    id: "mem-tech-jamar",
    name: "Jamar",
    role: "technician",
    phone: "011-3982 4411",
    expertise: ["Electrical Wiring (AC/DC)", "Inverter & BESS Commissioning", "Testing & Commissioning (T&C)"],
    availability: { status: "available" },
    assignedCrewId: null,
    notes: "Lead wireman in Arranged Installation (Team Jamar). AC/DC trunking, inverter termination and Deye/Huawei hybrid setups.",
  },
  {
    id: "mem-tech-amien",
    name: "Amien",
    role: "technician",
    phone: "012-771 9023",
    expertise: ["Roof Mounting & Structural", "Troubleshooting & O&M"],
    availability: { status: "available" },
    assignedCrewId: null,
    notes: "Senior mounting technician in Arranged Installation. Rapid solar rail alignment, tile & metal deck brackets.",
  },
  {
    id: "mem-tech-sharry",
    name: "Sharry",
    role: "technician",
    phone: "013-662 8345",
    expertise: ["Electrical Wiring (AC/DC)", "Testing & Commissioning (T&C)"],
    availability: { status: "available" },
    assignedCrewId: null,
    notes: "Electrical wireman in Arranged Installation. String voltage testing, DC combiner box and earthing.",
  },
  {
    id: "mem-tech-aqim",
    name: "Aqim",
    role: "technician",
    phone: "011-4567 8901",
    expertise: ["Electrical Wiring (AC/DC)", "Roof Mounting & Structural"],
    availability: { status: "available" },
    assignedCrewId: null,
    notes: "Solar technician in Arranged Installation. PV module handling, bracket mounting & DC wiring.",
  },
  {
    id: "mem-tech-hamzah",
    name: "Hamzah",
    role: "technician",
    phone: "018-223 9988",
    expertise: ["Roof Mounting & Structural", "Electrical Wiring (AC/DC)"],
    availability: { status: "available" },
    assignedCrewId: null,
    notes: "PV module installer & solar technician in Arranged Installation.",
  },
  {
    id: "mem-tech-yuan",
    name: "Yuan",
    role: "technician",
    phone: "018-443 7812",
    expertise: ["Roof Mounting & Structural", "Troubleshooting & O&M"],
    availability: { status: "available" },
    assignedCrewId: null,
    notes: "Roof mounting & structural specialist in Arranged Installation (Ah Yuan / Loh Shun Yuan). Expert in leak-proof flashing and waterproofing.",
  },
  {
    id: "mem-tech-am",
    name: "Am",
    role: "technician",
    phone: "012-334 5566",
    expertise: ["Electrical Wiring (AC/DC)", "Roof Mounting & Structural"],
    availability: { status: "available" },
    assignedCrewId: null,
    notes: "Senior technician & installation lead in Arranged Installation (Team Am).",
  },
  {
    id: "mem-tech-is",
    name: "Is",
    role: "technician",
    phone: "017-223 3445",
    expertise: ["Roof Mounting & Structural", "Electrical Wiring (AC/DC)"],
    availability: { status: "available" },
    assignedCrewId: null,
    notes: "Technician & installation lead in Arranged Installation (Team Is).",
  },
  {
    id: "mem-tech-harun",
    name: "Harun",
    role: "technician",
    phone: "019-445 6677",
    expertise: ["Electrical Wiring (AC/DC)", "Roof Mounting & Structural"],
    availability: { status: "available" },
    assignedCrewId: null,
    notes: "Technician & installation lead in Arranged Installation (Team Harun).",
  },
  {
    id: "mem-tech-muhammad",
    name: "Muhammad",
    role: "technician",
    phone: "011-2345 6781",
    expertise: ["Electrical Wiring (AC/DC)", "Inverter & BESS Commissioning"],
    availability: { status: "available" },
    assignedCrewId: null,
    notes: "Certified Wireman PW4 in Arranged Installation. Cable trunking, AC termination and earthing.",
  },
  {
    id: "mem-tech-shahid",
    name: "Shahid",
    role: "technician",
    phone: "016-778 2211",
    expertise: ["Roof Mounting & Structural"],
    availability: { status: "available" },
    assignedCrewId: null,
    notes: "Roof mounting installer in Arranged Installation.",
  },
  {
    id: "mem-tech-saham",
    name: "Saham",
    role: "technician",
    phone: "011-889 0022",
    expertise: ["Electrical Wiring (AC/DC)"],
    availability: { status: "available" },
    assignedCrewId: null,
    notes: "Cable conduit and DC wiring installer in Arranged Installation.",
  },
  {
    id: "mem-tech-mujeeb",
    name: "Mujeeb",
    role: "technician",
    phone: "019-332 1144",
    expertise: ["Roof Mounting & Structural"],
    availability: { status: "available" },
    assignedCrewId: null,
    notes: "Roof brackets & rail technician in Arranged Installation.",
  },
  {
    id: "mem-tech-sajeeb",
    name: "Sajeeb",
    role: "technician",
    phone: "013-998 7766",
    expertise: ["Roof Mounting & Structural", "Electrical Wiring (AC/DC)"],
    availability: { status: "available" },
    assignedCrewId: null,
    notes: "Solar PV mounting technician in Arranged Installation.",
  },
  {
    id: "mem-tech-raheel",
    name: "Raheel",
    role: "technician",
    phone: "017-665 4433",
    expertise: ["Electrical Wiring (AC/DC)"],
    availability: { status: "available" },
    assignedCrewId: null,
    notes: "DC string wiring and inverter cable runs in Arranged Installation.",
  },
  {
    id: "mem-tech-fakhrul",
    name: "Fakhrul",
    role: "technician",
    phone: "014-556 7890",
    expertise: ["Electrical Wiring (AC/DC)", "Testing & Commissioning (T&C)"],
    availability: { status: "available" },
    assignedCrewId: null,
    notes: "Electrical wiring & commissioning technician in Arranged Installation.",
  },
  {
    id: "mem-tech-hafizi",
    name: "Hafizi",
    role: "technician",
    phone: "013-445 6789",
    expertise: ["Roof Mounting & Structural", "Troubleshooting & O&M"],
    availability: { status: "available" },
    assignedCrewId: null,
    notes: "Structural rail installer & panel mounting in Arranged Installation.",
  },
  {
    id: "mem-tech-adi",
    name: "Adi",
    role: "technician",
    phone: "014-332 5544",
    expertise: ["Roof Mounting & Structural"],
    availability: { status: "available" },
    assignedCrewId: null,
    notes: "Structural and flashing technician in Arranged Installation.",
  },
  {
    id: "mem-tech-jalil",
    name: "Jalil",
    role: "technician",
    phone: "011-776 5544",
    expertise: ["Electrical Wiring (AC/DC)"],
    availability: { status: "available" },
    assignedCrewId: null,
    notes: "Cable termination technician in Arranged Installation.",
  },

  // --- Interns from Arranged Installation ---
  {
    id: "mem-int-hakim",
    name: "Hakim",
    role: "intern",
    phone: "017-554 9128",
    expertise: ["Inverter & BESS Commissioning", "Electrical Wiring (AC/DC)"],
    availability: { status: "available" },
    assignedCrewId: null,
    notes: "Technical intern in Arranged Installation (Intern Hakim). Inverter setups & commissioning assistance.",
  },
];

// Synchronizes and maps members ensuring all Arranged Installation personnel have canonical names & roles
export function syncArrangedMembers(
  existingMembers: ProjectTeamMember[],
  groups?: any[],
  proposeTeamCrews?: Partial<Record<number, TeamCrewAssignment>>
): ProjectTeamMember[] {
  const memberMapByName = new Map<string, ProjectTeamMember>();

  // 1. First populate with DEFAULT_MEMBERS
  for (const dm of DEFAULT_MEMBERS) {
    memberMapByName.set(dm.name.toLowerCase().trim(), { ...dm });
  }

  // 2. Merge existing members, but ensure canonical Arranged Installation role and standardized name
  for (const em of existingMembers) {
    const rawLower = em.name.toLowerCase().trim();
    // Delete any created dummy/mock names
    if (CREATED_DUMMY_NAMES.has(rawLower)) continue;

    const normalized = normalizeArrangedName(em.name, em.role);
    if (!normalized || CREATED_DUMMY_NAMES.has(normalized.name.toLowerCase().trim())) continue;

    const normKey = normalized.name.toLowerCase().trim();
    const existingEntry = memberMapByName.get(normKey) || memberMapByName.get(rawLower);

    if (existingEntry) {
      memberMapByName.set(normKey, {
        ...existingEntry,
        name: normalized.name,
        role: normalized.role,
        phone: em.phone && em.phone !== "011-000 0000" && em.phone !== "012-000 0000" ? em.phone : existingEntry.phone,
        notes: em.notes || existingEntry.notes,
        availability: em.availability || existingEntry.availability,
        assignedCrewId: em.assignedCrewId !== undefined ? em.assignedCrewId : existingEntry.assignedCrewId,
      });
      if (normKey !== rawLower) {
        memberMapByName.delete(rawLower);
      }
    } else {
      memberMapByName.set(normKey, {
        ...em,
        name: normalized.name,
        role: normalized.role,
      });
    }
  }

  const registerSupervisorString = (sup: string) => {
    if (!sup) return;
    const split = String(sup).split(/[,/&]/);
    for (const s of split) {
      const norm = normalizeArrangedName(s, "site_supervisor");
      if (!norm || CREATED_DUMMY_NAMES.has(norm.name.toLowerCase().trim())) continue;
      const k = norm.name.toLowerCase().trim();
      if (!memberMapByName.has(k)) {
        memberMapByName.set(k, {
          id: `mem-sup-auto-${k.replace(/\s+/g, "-")}`,
          name: norm.name,
          role: norm.role,
          phone: "012-000 0000",
          expertise: ["SEDA & Safety Compliance", "Roof Mounting & Structural", "Testing & Commissioning (T&C)"],
          availability: { status: "available" },
          assignedCrewId: null,
          notes: "Imported from Arranged Installation supervisors schedule.",
        });
      }
    }
  };

  const registerCrewMemberString = (wm: string) => {
    if (!wm) return;
    const split = String(wm).split(/[,/&]/);
    for (const m of split) {
      const norm = normalizeArrangedName(m, "technician");
      if (!norm || CREATED_DUMMY_NAMES.has(norm.name.toLowerCase().trim())) continue;
      const k = norm.name.toLowerCase().trim();
      if (!memberMapByName.has(k)) {
        memberMapByName.set(k, {
          id: `mem-${norm.role === "intern" ? "int" : "tech"}-auto-${k.replace(/\s+/g, "-")}`,
          name: norm.name,
          role: norm.role,
          phone: "011-000 0000",
          expertise: ["Electrical Wiring (AC/DC)", "Roof Mounting & Structural", "Testing & Commissioning (T&C)"],
          availability: { status: "available" },
          assignedCrewId: null,
          notes: "Imported from Arranged Installation wiring crew.",
        });
      }
    }
  };

  // 3. Scan live groups from Arranged Installation if available
  if (Array.isArray(groups) && groups.length > 0) {
    for (const g of groups) {
      const sups = [
        ...(Array.isArray(g.supervisors) ? g.supervisors : []),
        ...(g.supervisor ? [g.supervisor] : []),
      ];
      for (const sup of sups) {
        registerSupervisorString(String(sup));
      }

      const wms = Array.isArray(g.wiringMembers) ? g.wiringMembers : [];
      for (const wm of wms) {
        registerCrewMemberString(String(wm));
      }
    }
  }

  // 4. Scan Propose to Install teamCrews if available
  if (proposeTeamCrews) {
    for (const pCrew of Object.values(proposeTeamCrews)) {
      if (!pCrew) continue;
      if (pCrew.siteSupervisor) registerSupervisorString(pCrew.siteSupervisor);
      if (pCrew.membersText) registerCrewMemberString(pCrew.membersText);
    }
  }

  return Array.from(memberMapByName.values());
}

// Default teams matching Arranged Installation: Team 1, Team 2, Team 3, Team 4 as empty cards
export const DEFAULT_CREWS: InstallationCrew[] = [
  {
    id: "crew-1",
    name: "Team 1",
    supervisorId: null,
    technicianIds: [],
    internIds: [],
    baseLocation: "Johor Bahru",
    vehicle: "",
    notes: "",
  },
  {
    id: "crew-2",
    name: "Team 2",
    supervisorId: null,
    technicianIds: [],
    internIds: [],
    baseLocation: "Kluang",
    vehicle: "",
    notes: "",
  },
  {
    id: "crew-3",
    name: "Team 3",
    supervisorId: null,
    technicianIds: [],
    internIds: [],
    baseLocation: "Kulai",
    vehicle: "",
    notes: "",
  },
  {
    id: "crew-4",
    name: "Team 4",
    supervisorId: null,
    technicianIds: [],
    internIds: [],
    baseLocation: "Muar",
    vehicle: "",
    notes: "",
  },
];

const DEFAULT_CARS: ProjectVehicle[] = [];

interface SearchableMemberAssignerProps {
  role: "site_supervisor" | "technician" | "intern";
  placeholder: string;
  alreadyAssignedIds: string[];
  onAssign: (memberId: string) => void;
  members: ProjectTeamMember[];
  activeWeek: string;
  currentWeekCrews: InstallationCrew[];
}

function SearchableMemberAssigner({
  role,
  placeholder,
  alreadyAssignedIds,
  onAssign,
  members,
  activeWeek,
  currentWeekCrews,
}: SearchableMemberAssignerProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [query, setQuery] = useState("");
  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setIsOpen(false);
        setQuery("");
      }
    }
    if (isOpen) {
      document.addEventListener("mousedown", handleClickOutside);
      return () => document.removeEventListener("mousedown", handleClickOutside);
    }
  }, [isOpen]);

  const candidates = useMemo(() => {
    const list = members
      .filter((m) => m.role === role && !alreadyAssignedIds.includes(m.id))
      .filter((m) => {
        if (!query.trim()) return true;
        const q = query.toLowerCase().trim();
        return (
          m.name.toLowerCase().includes(q) ||
          m.phone.toLowerCase().includes(q) ||
          m.expertise.some((e) => e.toLowerCase().includes(q))
        );
      });

    return list.sort((a, b) => {
      const aKey = a.name.toLowerCase().trim();
      const bKey = b.name.toLowerCase().trim();
      if (role === "site_supervisor") {
        const aIdx = KEY_ARRANGED_SUPERVISORS.indexOf(aKey);
        const bIdx = KEY_ARRANGED_SUPERVISORS.indexOf(bKey);
        if (aIdx !== -1 && bIdx !== -1) return aIdx - bIdx;
        if (aIdx !== -1) return -1;
        if (bIdx !== -1) return 1;
      } else if (role === "technician") {
        const aIdx = KEY_ARRANGED_TECHS.indexOf(aKey);
        const bIdx = KEY_ARRANGED_TECHS.indexOf(bKey);
        if (aIdx !== -1 && bIdx !== -1) return aIdx - bIdx;
        if (aIdx !== -1) return -1;
        if (bIdx !== -1) return 1;
      } else if (role === "intern") {
        const aIdx = KEY_ARRANGED_INTERNS.indexOf(aKey);
        const bIdx = KEY_ARRANGED_INTERNS.indexOf(bKey);
        if (aIdx !== -1 && bIdx !== -1) return aIdx - bIdx;
        if (aIdx !== -1) return -1;
        if (bIdx !== -1) return 1;
      }
      return a.name.localeCompare(b.name);
    });
  }, [members, role, alreadyAssignedIds, query]);

  return (
    <div
      ref={containerRef}
      style={{
        position: "relative",
        zIndex: isOpen ? 50 : "auto",
      }}
    >
      {/* Search box trigger on the red line */}
      <div
        onClick={() => {
          setIsOpen(true);
          inputRef.current?.focus();
        }}
        style={{
          display: "inline-flex",
          alignItems: "center",
          gap: "4px",
          padding: "3px 8px",
          borderRadius: "6px",
          border: isOpen ? "1px solid #2563eb" : "1px solid var(--line)",
          background: "var(--surface)",
          cursor: "text",
          width: "155px",
          boxShadow: isOpen ? "0 0 0 2px rgba(37, 99, 235, 0.15)" : "none",
          transition: "border-color 0.15s ease, box-shadow 0.15s ease",
        }}
      >
        <Search size={12} style={{ color: "var(--muted)", flexShrink: 0 }} />
        <input
          ref={inputRef}
          type="text"
          value={query}
          onFocus={() => setIsOpen(true)}
          onChange={(e) => {
            setQuery(e.target.value);
            setIsOpen(true);
          }}
          placeholder={placeholder}
          style={{
            border: "none",
            background: "transparent",
            outline: "none",
            fontSize: "0.75rem",
            color: "var(--ink)",
            width: "100%",
            padding: 0,
            textOverflow: "ellipsis",
          }}
        />
        {query ? (
          <button
            type="button"
            onMouseDown={(e) => {
              e.preventDefault();
              e.stopPropagation();
              setQuery("");
            }}
            style={{
              background: "transparent",
              border: "none",
              padding: 0,
              cursor: "pointer",
              color: "var(--muted)",
              display: "flex",
              alignItems: "center",
              flexShrink: 0,
            }}
          >
            <X size={12} />
          </button>
        ) : (
          <ChevronDown size={12} style={{ color: "var(--muted)", flexShrink: 0 }} />
        )}
      </div>

      {/* Autocomplete Dropdown */}
      {isOpen && (
        <div
          style={{
            position: "absolute",
            top: "calc(100% + 4px)",
            right: 0,
            width: "280px",
            maxHeight: "260px",
            overflowY: "auto",
            background: "var(--surface)",
            border: "1px solid var(--line)",
            borderRadius: "8px",
            boxShadow: "0 10px 25px rgba(0, 0, 0, 0.18)",
            zIndex: 100,
            padding: "4px",
          }}
        >
          <div
            style={{
              padding: "4px 8px 6px 8px",
              fontSize: "0.7rem",
              color: "var(--muted)",
              fontWeight: 600,
              borderBottom: "1px solid var(--line)",
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
            }}
          >
            <span>
              {query.trim()
                ? `Matching (${candidates.length})`
                : `All ${role === "site_supervisor" ? "Supervisors" : role === "technician" ? "Technicians" : "Interns"} (${candidates.length})`}
            </span>
            <span style={{ fontSize: "0.65rem" }}>Click to assign</span>
          </div>

          {candidates.length === 0 ? (
            <div
              style={{
                padding: "16px 12px",
                textAlign: "center",
                fontSize: "0.75rem",
                color: "var(--muted)",
              }}
            >
              No {role === "site_supervisor" ? "supervisors" : role === "technician" ? "technicians" : "interns"} found
              {query ? ` matching "${query}"` : ""}
            </div>
          ) : (
            candidates.map((m) => {
              const assignedCrew = currentWeekCrews.find(
                (c) =>
                  c.supervisorId === m.id ||
                  c.technicianIds.includes(m.id) ||
                  c.internIds.includes(m.id)
              );
              const isUnavailable = isMemberUnavailableInWeek(m, activeWeek);

              return (
                <div
                  key={m.id}
                  onMouseDown={(e) => {
                    e.preventDefault();
                    onAssign(m.id);
                    setIsOpen(false);
                    setQuery("");
                  }}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    padding: "6px 8px",
                    borderRadius: "6px",
                    cursor: "pointer",
                    transition: "background 0.15s ease",
                    gap: "6px",
                  }}
                  onMouseEnter={(e) => (e.currentTarget.style.background = "var(--surface-soft)")}
                  onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
                >
                  <div style={{ display: "flex", alignItems: "center", gap: "6px", minWidth: 0 }}>
                    {role === "site_supervisor" && <HardHat size={14} style={{ color: "#2563eb", flexShrink: 0 }} />}
                    {role === "technician" && <Wrench size={14} style={{ color: "#059669", flexShrink: 0 }} />}
                    {role === "intern" && <GraduationCap size={14} style={{ color: "#9333ea", flexShrink: 0 }} />}

                    <div style={{ minWidth: 0 }}>
                      <div
                        style={{
                          fontSize: "0.8rem",
                          fontWeight: 600,
                          color: "var(--ink)",
                          whiteSpace: "nowrap",
                          overflow: "hidden",
                          textOverflow: "ellipsis",
                        }}
                      >
                        {m.name}
                      </div>
                      <div style={{ fontSize: "0.68rem", color: "var(--muted)" }}>
                        {m.phone}
                      </div>
                    </div>
                  </div>

                  <div style={{ display: "flex", alignItems: "center", gap: "4px", flexShrink: 0 }}>
                    {isUnavailable ? (
                      <span
                        style={{
                          fontSize: "0.65rem",
                          padding: "1px 5px",
                          borderRadius: "4px",
                          fontWeight: 700,
                          background: "#fee2e2",
                          color: "#dc2626",
                        }}
                      >
                        {m.availability.status.toUpperCase()}
                      </span>
                    ) : assignedCrew ? (
                      <span
                        style={{
                          fontSize: "0.65rem",
                          padding: "1px 5px",
                          borderRadius: "4px",
                          fontWeight: 700,
                          background: getTeamColor(assignedCrew.name).bg,
                          color: getTeamColor(assignedCrew.name).text,
                          border: `1px solid ${getTeamColor(assignedCrew.name).border}`,
                        }}
                      >
                        {assignedCrew.name}
                      </span>
                    ) : (
                      <span
                        style={{
                          fontSize: "0.65rem",
                          padding: "1px 5px",
                          borderRadius: "4px",
                          fontWeight: 600,
                          background: "var(--surface-soft)",
                          color: "var(--muted)",
                          border: "1px solid var(--line)",
                        }}
                      >
                        Available
                      </span>
                    )}
                  </div>
                </div>
              );
            })
          )}
        </div>
      )}
    </div>
  );
}

export function ProjectTeamScheduleView({
  jobs,
  groups,
  teams,
  onTeamsChange,
  onGroupsChange,
  onSaveJob,
  todayIso = new Date().toISOString().slice(0, 10),
  readOnly = false,
  proposeTeamCrews,
}: ProjectTeamScheduleViewProps) {
  // Members state following Arranged Installation roster
  const [members, setMembers] = useState<ProjectTeamMember[]>(() => {
    if (typeof window !== "undefined") {
      try {
        const saved =
          window.localStorage.getItem(PROJECT_MEMBERS_STORAGE_KEY) ||
          window.localStorage.getItem("installation_project_team_members_v6") ||
          window.localStorage.getItem("installation_project_team_members_v4") ||
          window.localStorage.getItem("installation_project_team_members");
        if (saved) {
          const parsed = JSON.parse(saved) as ProjectTeamMember[];
          if (Array.isArray(parsed) && parsed.length > 0) {
            return syncArrangedMembers(parsed, groups, proposeTeamCrews);
          }
        }
      } catch {
        // fallback
      }
    }
    return syncArrangedMembers(DEFAULT_MEMBERS, groups, proposeTeamCrews);
  });

  // Auto-sync members from Arranged Installation schedule and Propose to Install
  useEffect(() => {
    setMembers((prevMembers) => syncArrangedMembers(prevMembers, groups, proposeTeamCrews));
  }, [groups, proposeTeamCrews]);

  // Week-by-week crews state: Record<weekStartIso, InstallationCrew[]>
  const [weeklyCrews, setWeeklyCrews] = useState<Record<string, InstallationCrew[]>>(() => {
    if (typeof window !== "undefined") {
      try {
        const savedWeekly = window.localStorage.getItem(PROJECT_WEEKLY_CREWS_KEY);
        if (savedWeekly) {
          const parsed = JSON.parse(savedWeekly) as Record<string, InstallationCrew[]>;
          if (parsed && typeof parsed === "object") {
            return parsed;
          }
        }
      } catch {
        // fallback
      }
    }
    return {};
  });

  // The week being worked, by the same rule as Arranged Installation: from
  // Saturday the coming Monday's week counts as current. Project Team opens
  // on it; later weeks are the ones Propose to Install is still planning.
  const currentWorkWeek = weekBounds(addDays(todayIso, 2))?.start || todayIso;

  // Arranged Installation & Propose to Install weeks starting from October 2026
  const arrangedWeeks = useMemo(() => {
    const weeks = new Set<string>();
    for (const group of groups || []) {
      if (group.installationDate && group.installationDate >= MIN_TEAM_GROUPING_DATE) {
        const start = weekBounds(group.installationDate)?.start;
        if (start && start >= MIN_TEAM_GROUPING_WEEK) {
          weeks.add(start);
        }
      }
    }
    const currentWeekStart = weekBounds(todayIso)?.start;
    if (currentWeekStart && currentWeekStart >= MIN_TEAM_GROUPING_WEEK) {
      weeks.add(currentWeekStart);
    }
    if (currentWorkWeek >= MIN_TEAM_GROUPING_WEEK) {
      weeks.add(currentWorkWeek);
      weeks.add(addDays(currentWorkWeek, 7));
    }
    return Array.from(weeks).sort();
  }, [groups, todayIso, currentWorkWeek]);

  const latestArrangedWeek = useMemo(() => {
    let latest = "";
    for (const group of groups || []) {
      if (group.installationDate && group.installationDate >= MIN_TEAM_GROUPING_DATE) {
        const start = weekBounds(group.installationDate)?.start;
        if (start && start > latest) {
          latest = start;
        }
      }
    }
    return latest || (arrangedWeeks.length > 0 ? arrangedWeeks[arrangedWeeks.length - 1] : "");
  }, [groups, arrangedWeeks]);

  const [selectedWeek, setSelectedWeek] = useState<string | null>(null);
  const activeWeek = selectedWeek ?? currentWorkWeek;

  const allNavWeeks = useMemo(() => {
    const set = new Set(arrangedWeeks);
    if (activeWeek && activeWeek >= MIN_TEAM_GROUPING_WEEK) {
      set.add(activeWeek);
    }
    return Array.from(set).sort();
  }, [arrangedWeeks, activeWeek]);

  const handlePrevWeek = () => {
    if (!activeWeek) return;
    const idx = allNavWeeks.indexOf(activeWeek);
    startTransition(() => {
      if (idx > 0) {
        setSelectedWeek(allNavWeeks[idx - 1]);
      } else {
        const prev = addDays(activeWeek, -7);
        if (prev >= MIN_TEAM_GROUPING_WEEK) {
          setSelectedWeek(prev);
        }
      }
    });
  };

  const handleNextWeek = () => {
    if (!activeWeek) return;
    const idx = allNavWeeks.indexOf(activeWeek);
    startTransition(() => {
      if (idx !== -1 && idx < allNavWeeks.length - 1) {
        setSelectedWeek(allNavWeeks[idx + 1]);
      } else {
        setSelectedWeek(addDays(activeWeek, 7));
      }
    });
  };

  // Derive crews for the selected week from Arranged Installation & Propose to Install (starting from Oct 2026)
  const derivedWeekCrews = useMemo((): InstallationCrew[] => {
    if (!activeWeek || activeWeek < MIN_TEAM_GROUPING_WEEK) {
      return DEFAULT_CREWS;
    }

    type HeaderBlock = {
      key: string;
      teamLabel: string;
      teamNum: number | null;
      sectionIndex: number | undefined;
      firstDate: string;
      lastDate: string;
      installationTeam: string;
      wiringTeam: string;
      supervisors: string[];
      wiringMembers: string[];
      cars: string[];
      groupIds: string[];
    };

    const blockMap = new Map<string, HeaderBlock>();
    const weekGroups = (groups || []).filter(
      (g: any) => g.installationDate && weekBounds(g.installationDate)?.start === activeWeek
    );

    for (const g of weekGroups) {
      const rawTeamLabel = String(g.teamLabel || g.name || g.installationTeam || "Team").trim();
      const tm = rawTeamLabel.match(/\bteam\s*(\d+)\b/i) || rawTeamLabel.match(/^(\d+)$/);
      const teamNum = tm ? Number(tm[1]) : null;
      const instTeam =
        g.installationTeam && !isPlaceholder(g.installationTeam) ? String(g.installationTeam).trim() : "";
      const wirTeam =
        g.wiringTeam && !isPlaceholder(g.wiringTeam) ? String(g.wiringTeam).trim() : "";
      const sups: string[] = Array.from(
        new Set<string>(
          [
            ...(Array.isArray(g.supervisors) ? g.supervisors : []),
            ...(g.supervisor ? [g.supervisor] : []),
          ]
            .map((s: any) => String(s).trim())
            .filter((s: string) => Boolean(s) && !isPlaceholder(s))
        )
      );
      const mems: string[] = Array.from(
        new Set<string>(
          (Array.isArray(g.wiringMembers) ? g.wiringMembers : [])
            .map((s: any) => String(s).trim())
            .filter((s: string) => Boolean(s) && !isPlaceholder(s))
        )
      );
      const carsList: string[] = Array.from(
        new Set<string>(
          (Array.isArray(g.cars) ? g.cars : [])
            .map((s: any) => String(s).trim())
            .filter((s: string) => Boolean(s) && !isPlaceholder(s))
        )
      );
      const secIdx =
        g.sectionIndex !== undefined && g.sectionIndex !== null ? Number(g.sectionIndex) : undefined;
      const secKey = secIdx !== undefined ? String(secIdx) : "";
      const sig = [
        rawTeamLabel.toLowerCase(),
        secKey,
        instTeam,
        wirTeam,
        sups.join(", "),
        mems.join(", "),
        carsList.join(", "),
      ].join("|");

      const existing = blockMap.get(sig);
      if (existing) {
        if (!existing.groupIds.includes(g.id)) existing.groupIds.push(g.id);
        if (g.installationDate < existing.firstDate) existing.firstDate = g.installationDate;
        if (g.installationDate > existing.lastDate) existing.lastDate = g.installationDate;
      } else {
        blockMap.set(sig, {
          key: sig,
          teamLabel: rawTeamLabel,
          teamNum,
          sectionIndex: secIdx,
          firstDate: g.installationDate,
          lastDate: g.installationDate,
          installationTeam: instTeam,
          wiringTeam: wirTeam,
          supervisors: sups,
          wiringMembers: mems,
          cars: carsList,
          groupIds: [g.id],
        });
      }
    }

    const blocks = Array.from(blockMap.values());

    // Merge Propose to Install (proposeTeamCrews) for current & future planning weeks
    if (activeWeek >= currentWorkWeek && proposeTeamCrews) {
      for (const tNum of [1, 2, 3, 4]) {
        const pCrew = proposeTeamCrews[tNum];
        const matchingBlocks = blocks.filter((b) => b.teamNum === tNum);
        const pInst = pCrew?.installationTeam && !isPlaceholder(pCrew.installationTeam) ? pCrew.installationTeam.trim() : "";
        const pWir = pCrew?.wiringTeam && !isPlaceholder(pCrew.wiringTeam) ? pCrew.wiringTeam.trim() : "";
        const pSup = pCrew?.siteSupervisor && !isPlaceholder(pCrew.siteSupervisor) ? pCrew.siteSupervisor.trim() : "";
        const pMem = pCrew?.membersText && !isPlaceholder(pCrew.membersText) ? pCrew.membersText.trim() : "";
        const pCar = pCrew?.car && !isPlaceholder(pCrew.car) ? pCrew.car.trim() : "";

        if (matchingBlocks.length > 0) {
          for (const b of matchingBlocks) {
            if (pInst && (!b.installationTeam || activeWeek > currentWorkWeek)) b.installationTeam = pInst;
            if (pWir && (!b.wiringTeam || activeWeek > currentWorkWeek)) b.wiringTeam = pWir;
            if (pSup && (b.supervisors.length === 0 || activeWeek > currentWorkWeek)) {
              b.supervisors = pSup.split(/[,/]/).map((s) => s.trim()).filter(Boolean);
            }
            if (pMem && (b.wiringMembers.length === 0 || activeWeek > currentWorkWeek)) {
              b.wiringMembers = [pMem];
            }
            if (pCar && (b.cars.length === 0 || activeWeek > currentWorkWeek)) {
              b.cars = pCar.split(/[,/]/).map((s) => s.trim()).filter(Boolean);
            }
          }
        } else if (pInst || pWir || pSup || pMem || pCar || blocks.length === 0) {
          blocks.push({
            key: `propose-team-${tNum}`,
            teamLabel: `Team ${tNum}`,
            teamNum: tNum,
            sectionIndex: tNum,
            firstDate: activeWeek,
            lastDate: activeWeek,
            installationTeam: pInst,
            wiringTeam: pWir,
            supervisors: pSup ? pSup.split(/[,/]/).map((s) => s.trim()).filter(Boolean) : [],
            wiringMembers: pMem ? [pMem] : [],
            cars: pCar ? pCar.split(/[,/]/).map((s) => s.trim()).filter(Boolean) : [],
            groupIds: [],
          });
        }
      }
    }

    if (blocks.length === 0) {
      return DEFAULT_CREWS;
    }

    blocks.sort((a, b) => {
      const aNum = a.teamNum ?? 999;
      const bNum = b.teamNum ?? 999;
      if (aNum !== bNum) return aNum - bNum;
      const labelCmp = a.teamLabel.localeCompare(b.teamLabel);
      if (labelCmp !== 0) return labelCmp;
      if (a.firstDate !== b.firstDate) return a.firstDate.localeCompare(b.firstDate);
      return (a.sectionIndex ?? 9999) - (b.sectionIndex ?? 9999);
    });

    // Count blocks per teamLabel to annotate multi-header teams (e.g. Team 1's 4 groups, Team 3's 3 groups)
    const countByTeam = new Map<string, number>();
    for (const b of blocks) {
      const k = b.teamLabel.toLowerCase();
      countByTeam.set(k, (countByTeam.get(k) || 0) + 1);
    }
    const indexByTeam = new Map<string, number>();

    return blocks.map((b, idx) => {
      const k = b.teamLabel.toLowerCase();
      const totalForTeam = countByTeam.get(k) || 1;
      const curIdx = (indexByTeam.get(k) || 0) + 1;
      indexByTeam.set(k, curIdx);

      // Resolve supervisorId from supervisors
      let supervisorId: string | null = null;
      for (const supStr of b.supervisors) {
        const tokens = supStr.split(/[,/&]/).map((s) => s.trim()).filter(Boolean);
        for (const tok of tokens) {
          const norm = normalizeArrangedName(tok, "site_supervisor");
          const targetName = (norm?.name || tok).toLowerCase().trim();
          const matchedSup =
            members.find((m) => m.role === "site_supervisor" && m.name.toLowerCase().trim() === targetName) ||
            members.find((m) => m.name.toLowerCase().trim() === targetName);
          if (matchedSup) {
            supervisorId = matchedSup.id;
            break;
          }
        }
        if (supervisorId) break;
      }

      // Resolve technicianIds and internIds from wiringMembers
      const technicianIds: string[] = [];
      const internIds: string[] = [];
      for (const wmStr of b.wiringMembers) {
        const tokens = wmStr.split(/[,/&]/).map((s) => s.trim()).filter(Boolean);
        for (const tok of tokens) {
          const norm = normalizeArrangedName(tok, "technician");
          if (!norm) continue;
          const targetName = norm.name.toLowerCase().trim();
          const matchedMem = members.find((m) => m.name.toLowerCase().trim() === targetName);
          if (matchedMem) {
            if (matchedMem.role === "intern" || norm.role === "intern") {
              if (!internIds.includes(matchedMem.id)) internIds.push(matchedMem.id);
            } else {
              if (!technicianIds.includes(matchedMem.id)) technicianIds.push(matchedMem.id);
            }
          }
        }
      }

      const baseLocation = /kluang/i.test(b.teamLabel)
        ? "Kluang"
        : /\bjb\b|johor/i.test(b.teamLabel)
        ? "Johor Bahru"
        : b.teamNum === 2
        ? "Kluang"
        : "Johor Bahru";

      let multiHeaderSubtitle = "";
      if (totalForTeam > 1) {
        const fmtDay = (d: string) => {
          const dt = new Date(`${d}T00:00:00`);
          return Number.isNaN(dt.getTime()) ? d : DAY_MONTH.format(dt);
        };
        const dateSpan =
          b.firstDate && b.lastDate
            ? b.firstDate === b.lastDate
              ? fmtDay(b.firstDate)
              : `${fmtDay(b.firstDate)} – ${fmtDay(b.lastDate)}`
            : "";
        multiHeaderSubtitle = `Group ${curIdx} of ${totalForTeam}${dateSpan ? ` · ${dateSpan}` : ""}`;
      }

      return {
        id: `crew-${activeWeek}-${b.sectionIndex ?? idx}-${b.teamLabel.toLowerCase().replace(/[^a-z0-9]+/g, "-")}-${idx}`,
        name: b.teamLabel,
        supervisorId,
        technicianIds,
        internIds,
        baseLocation,
        vehicle: b.cars.join(", "),
        targetDate: multiHeaderSubtitle || undefined,
        notes: "",
        installationTeam: b.installationTeam,
        wiringTeam: b.wiringTeam,
        supervisorsText: b.supervisors.join(", "),
        membersText: b.wiringMembers.join(", "),
        sectionIndex: b.sectionIndex,
        groupIds: b.groupIds,
      };
    });
  }, [activeWeek, groups, proposeTeamCrews, currentWorkWeek, members]);

  // Active crews for the selected week (merging any user edits over derivedWeekCrews)
  const currentWeekCrews = useMemo(() => {
    const saved = weeklyCrews[activeWeek];
    if (!saved || saved.length === 0) {
      return derivedWeekCrews;
    }
    const savedById = new Map(saved.map((c) => [c.id, c]));
    const merged = derivedWeekCrews.map((derived) => {
      const override = savedById.get(derived.id);
      return override ? { ...derived, ...override } : derived;
    });
    const derivedIds = new Set(derivedWeekCrews.map((d) => d.id));
    for (const s of saved) {
      if (!derivedIds.has(s.id) && !/^crew-[1-4]$/.test(s.id)) {
        merged.push(s);
      }
    }
    return merged;
  }, [weeklyCrews, activeWeek, derivedWeekCrews]);

  function updateCurrentWeekCrews(nextCrews: InstallationCrew[]) {
    setWeeklyCrews((prev) => ({
      ...prev,
      [activeWeek]: nextCrews,
    }));
  }

  // UI state
  const [activeTab, setActiveTab] = useState<"crews" | "members" | "cars" | "availability">("crews");
  const [visitedTabs, setVisitedTabs] = useState<Set<string>>(() => new Set(["crews"]));

  const handleSelectTab = (tab: "crews" | "members" | "cars" | "availability") => {
    setVisitedTabs((prev) => (prev.has(tab) ? prev : new Set(prev).add(tab)));
    startTransition(() => {
      setActiveTab(tab);
    });
  };
  const [searchQuery, setSearchQuery] = useState("");
  const [isSearchDropdownOpen, setIsSearchDropdownOpen] = useState(false);
  const searchContainerRef = useRef<HTMLDivElement>(null);

  const [roleFilter, setRoleFilter] = useState<string>("all");
  const [availabilityFilter, setAvailabilityFilter] = useState<string>("all");
  const [expertiseFilter, setExpertiseFilter] = useState<string>("all");

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (searchContainerRef.current && !searchContainerRef.current.contains(e.target as Node)) {
        setIsSearchDropdownOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const searchDropdownMembers = useMemo(() => {
    let list = members;
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase().trim();
      list = members.filter(
        (m) =>
          m.name.toLowerCase().includes(q) ||
          m.phone.toLowerCase().includes(q) ||
          m.expertise.some((e) => e.toLowerCase().includes(q))
      );
    }
    return [...list].sort((a, b) => {
      const roleOrder: Record<string, number> = { site_supervisor: 1, technician: 2, intern: 3 };
      const diff = (roleOrder[a.role] || 9) - (roleOrder[b.role] || 9);
      if (diff !== 0) return diff;
      const aKey = a.name.toLowerCase().trim();
      const bKey = b.name.toLowerCase().trim();
      if (a.role === "site_supervisor") {
        const aIdx = KEY_ARRANGED_SUPERVISORS.indexOf(aKey);
        const bIdx = KEY_ARRANGED_SUPERVISORS.indexOf(bKey);
        if (aIdx !== -1 && bIdx !== -1) return aIdx - bIdx;
        if (aIdx !== -1) return -1;
        if (bIdx !== -1) return 1;
      } else if (a.role === "technician") {
        const aIdx = KEY_ARRANGED_TECHS.indexOf(aKey);
        const bIdx = KEY_ARRANGED_TECHS.indexOf(bKey);
        if (aIdx !== -1 && bIdx !== -1) return aIdx - bIdx;
        if (aIdx !== -1) return -1;
        if (bIdx !== -1) return 1;
      } else if (a.role === "intern") {
        const aIdx = KEY_ARRANGED_INTERNS.indexOf(aKey);
        const bIdx = KEY_ARRANGED_INTERNS.indexOf(bKey);
        if (aIdx !== -1 && bIdx !== -1) return aIdx - bIdx;
        if (aIdx !== -1) return -1;
        if (bIdx !== -1) return 1;
      }
      return a.name.localeCompare(b.name);
    });
  }, [members, searchQuery]);

  // Cars state
  const [cars, setCars] = useState<ProjectVehicle[]>(() => {
    if (typeof window !== "undefined") {
      try {
        const saved = window.localStorage.getItem(PROJECT_CARS_STORAGE_KEY);
        if (saved) {
          const parsed = JSON.parse(saved);
          if (Array.isArray(parsed)) {
            // Filter out default sample cars created originally (car-1 to car-9)
            return parsed.filter((c: ProjectVehicle) => !/^car-[1-9]$/.test(c.id));
          }
        }
      } catch {
        // fallback
      }
    }
    return DEFAULT_CARS;
  });

  useEffect(() => {
    if (typeof window !== "undefined") {
      try {
        window.localStorage.setItem(PROJECT_CARS_STORAGE_KEY, JSON.stringify(cars));
      } catch {
        // ignore
      }
    }
  }, [cars]);

  // Car UI filters & Modals
  const [carSearchQuery, setCarSearchQuery] = useState("");
  const [carTypeFilter, setCarTypeFilter] = useState<string>("all");
  const [carStatusFilter, setCarStatusFilter] = useState<string>("all");
  const [carSuitabilityFilter, setCarSuitabilityFilter] = useState<string>("all");

  const [isCarModalOpen, setIsCarModalOpen] = useState(false);
  const [editingCar, setEditingCar] = useState<ProjectVehicle | null>(null);

  // Car stats
  const carStats = useMemo(() => {
    const total = cars.length;
    let availableCount = 0;
    let inUseCount = 0;
    let maintenanceCount = 0;

    for (const c of cars) {
      if (c.status === "available") availableCount++;
      else if (c.status === "in_use") inUseCount++;
      else if (c.status === "maintenance") maintenanceCount++;
    }

    return { total, availableCount, inUseCount, maintenanceCount };
  }, [cars]);

  // Filtered cars list
  const filteredCars = useMemo(() => {
    return cars.filter((c) => {
      if (carTypeFilter !== "all" && c.type !== carTypeFilter) return false;
      if (carStatusFilter !== "all" && c.status !== carStatusFilter) return false;
      if (carSuitabilityFilter !== "all" && !c.suitability.includes(carSuitabilityFilter)) return false;

      if (carSearchQuery.trim()) {
        const q = carSearchQuery.toLowerCase();
        const matchPlate = c.plateNumber.toLowerCase().includes(q);
        const matchModel = c.model.toLowerCase().includes(q);
        const matchLoc = c.baseLocation.toLowerCase().includes(q);
        const matchNotes = (c.notes || "").toLowerCase().includes(q);
        const matchSuit = c.suitability.some((s) => s.toLowerCase().includes(q));
        if (!matchPlate && !matchModel && !matchLoc && !matchNotes && !matchSuit) return false;
      }
      return true;
    });
  }, [cars, carTypeFilter, carStatusFilter, carSuitabilityFilter, carSearchQuery]);

  // Car actions
  function handleToggleCarStatus(carId: string, nextStatus: VehicleAvailabilityStatus) {
    setCars((prev) =>
      prev.map((c) => {
        if (c.id !== carId) return c;
        return {
          ...c,
          status: nextStatus,
          currentTeamId: nextStatus === "maintenance" ? null : c.currentTeamId,
        };
      })
    );
  }

  function handleDeleteCar(carId: string) {
    const car = cars.find((c) => c.id === carId);
    if (!car) return;
    if (confirm(`Are you sure you want to delete vehicle ${car.plateNumber} (${car.model})?`)) {
      setCars((prev) => prev.filter((c) => c.id !== carId));
    }
  }

  function handleSaveCar(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    const plateNumber = String(fd.get("plateNumber") || "").trim().toUpperCase();
    const model = String(fd.get("model") || "").trim();
    const type = String(fd.get("type") || "4x4_pickup") as VehicleType;
    const baseLocation = String(fd.get("baseLocation") || "Johor Bahru").trim();
    const capacityPax = Number(fd.get("capacityPax") || 5);
    const payloadKg = Number(fd.get("payloadKg") || 1000);
    const roadTaxExpiry = String(fd.get("roadTaxExpiry") || "2027-12-31");
    const status = String(fd.get("status") || "available") as VehicleAvailabilityStatus;
    const currentTeamId = String(fd.get("currentTeamId") || "") || null;
    const notes = String(fd.get("notes") || "").trim();

    const checkedSuitability: string[] = [];
    VEHICLE_SUITABILITY_OPTIONS.forEach((opt) => {
      if (fd.get(`suitability_${opt}`) === "on") {
        checkedSuitability.push(opt);
      }
    });

    if (!plateNumber || !model) {
      alert("Please provide both Plate Number and Vehicle Model.");
      return;
    }

    if (editingCar) {
      setCars((prev) =>
        prev.map((c) =>
          c.id === editingCar.id
            ? {
                ...c,
                plateNumber,
                model,
                type,
                baseLocation,
                capacityPax,
                payloadKg,
                roadTaxExpiry,
                status,
                currentTeamId,
                suitability: checkedSuitability,
                notes,
              }
            : c
        )
      );
    } else {
      const newCar: ProjectVehicle = {
        id: `car-${Date.now()}`,
        plateNumber,
        model,
        type,
        baseLocation,
        capacityPax,
        payloadKg,
        roadTaxExpiry,
        status,
        currentTeamId,
        suitability: checkedSuitability,
        notes,
      };
      setCars((prev) => [...prev, newCar]);
    }

    setIsCarModalOpen(false);
    setEditingCar(null);
  }

  // Modals state
  const [isMemberModalOpen, setIsMemberModalOpen] = useState(false);
  const [editingMember, setEditingMember] = useState<ProjectTeamMember | null>(null);

  const [isCrewModalOpen, setIsCrewModalOpen] = useState(false);
  const [editingCrew, setEditingCrew] = useState<InstallationCrew | null>(null);

  const [quickAvailabilityMember, setQuickAvailabilityMember] = useState<ProjectTeamMember | null>(null);
  const [quickStatus, setQuickStatus] = useState<MemberAvailabilityStatus>("available");
  const [quickReason, setQuickReason] = useState("");
  const [quickStartDate, setQuickStartDate] = useState(todayIso);
  const [quickEndDate, setQuickEndDate] = useState(todayIso);

  // Save to localStorage on change
  useEffect(() => {
    if (typeof window !== "undefined") {
      try {
        window.localStorage.setItem(PROJECT_MEMBERS_STORAGE_KEY, JSON.stringify(members));
      } catch {
        // ignore
      }
    }
  }, [members]);

  useEffect(() => {
    if (typeof window !== "undefined") {
      try {
        window.localStorage.setItem(PROJECT_WEEKLY_CREWS_KEY, JSON.stringify(weeklyCrews));
      } catch {
        // ignore
      }
    }
  }, [weeklyCrews]);

  // Arranged Installation datalists and options
  const installationTeamNames = useMemo(
    () =>
      Array.from(
        new Set([
          "Team 0",
          "Team 1",
          "Team 2",
          "Team 3",
          "Team 4",
          "Team 6",
          "Team 7",
          "AR01",
          "AR02",
          "AR17",
          "Team Is",
          "Team Harun",
          "Team Am",
          ...(teams || [])
            .filter((team: any) => !isWiringRole(team.role))
            .map((team: any) => team.name),
          ...(groups || []).map((group: any) => group.installationTeam).filter(Boolean),
        ]),
      ).sort(),
    [teams, groups],
  );

  const wiringTeamNames = useMemo(
    () =>
      Array.from(
        new Set([
          "Wiring Team 0",
          "Wiring Team 1",
          "Wiring Team 2",
          "Wiring Team 3",
          "Wiring Team 4",
          "Wiring Team 6",
          "Wiring Team 7",
          "Team Jamar",
          "Eternalgy Team Jamar",
          ...(teams || [])
            .filter((team: any) => isWiringRole(team.role))
            .map((team: any) => team.name),
          ...(groups || []).map((group: any) => group.wiringTeam).filter(Boolean),
        ]),
      ).sort(),
    [teams, groups],
  );

  const supervisorNames = useMemo(
    () =>
      Array.from(
        new Set([
          "Kaijie",
          "Martin Hing",
          "Ahzu",
          "Xiangjun",
          "Joshua",
          "Kai Kian",
          "Jia Hao",
          "Wilson",
          "Chan Chee Man",
          ...members
            .filter((m) => m.role === "site_supervisor")
            .map((m) => m.name),
          ...(groups || []).flatMap((group: any) => group.supervisors ?? []),
        ]),
      )
        .filter((s) => s && !isPlaceholder(s))
        .sort(),
    [members, groups],
  );

  const carOptions = useMemo(
    () =>
      Array.from(
        new Set([
          ...cars.map((c) => `${c.model} (${c.plateNumber})`),
          ...(groups || []).flatMap((g: any) => g.cars ?? []),
        ]),
      ).filter(Boolean).sort(),
    [cars, groups],
  );

  // Draft state for inline Team Box inputs before committing on blur
  const [crewDrafts, setCrewDrafts] = useState<
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

  // Expand / collapse state for team personnel roster drawer
  const [expandedCrewIds, setExpandedCrewIds] = useState<Set<string>>(() => new Set(["all"]));

  function toggleCrewExpanded(crewId: string) {
    setExpandedCrewIds((prev) => {
      const next = new Set(prev);
      if (next.has("all")) {
        next.delete("all");
        for (const c of currentWeekCrews) {
          if (c.id !== crewId) next.add(c.id);
        }
        return next;
      }
      if (next.has(crewId)) {
        next.delete(crewId);
      } else {
        next.add(crewId);
      }
      return next;
    });
  }

  function isCrewExpanded(crewId: string) {
    return expandedCrewIds.has("all") || expandedCrewIds.has(crewId);
  }

  // Bi-directional sync with Arranged Installation groups
  function syncCrewToGroups(crew: InstallationCrew, field: string, value: string) {
    if (!onGroupsChange || !groups || !Array.isArray(groups)) return;

    const targetGroupIds = new Set<string>(crew.groupIds && crew.groupIds.length > 0 ? crew.groupIds : []);

    if (targetGroupIds.size === 0) {
      const raw = `${crew.name || ""}`;
      const m = raw.match(/\bteam\s*(\d+)\b/i) || (crew.name || "").match(/\b(\d+)\b/);
      const teamNum = m ? Number(m[1]) : null;

      for (const g of groups) {
        if (!g.installationDate) continue;
        const start = weekBounds(g.installationDate)?.start;
        if (start !== activeWeek) continue;
        if (crew.sectionIndex !== undefined && g.sectionIndex !== undefined && g.sectionIndex !== crew.sectionIndex) {
          continue;
        }

        if (teamNum !== null) {
          const gRaw = `${g.teamLabel || ""} ${g.name || ""} ${g.installationTeam || ""} ${g.wiringTeam || ""}`;
          const gm = gRaw.match(/\bteam\s*(\d+)\b/i) || (g.teamLabel || "").match(/\b(\d+)\b/);
          if (gm && Number(gm[1]) === teamNum) {
            targetGroupIds.add(g.id);
            continue;
          }
        }
        if (g.name && g.name.toLowerCase().trim() === crew.name.toLowerCase().trim()) {
          targetGroupIds.add(g.id);
        } else if (g.teamLabel && g.teamLabel.toLowerCase().trim() === crew.name.toLowerCase().trim()) {
          targetGroupIds.add(g.id);
        }
      }
    }

    if (targetGroupIds.size === 0) return;

    onGroupsChange(
      groups.map((g) => {
        if (!targetGroupIds.has(g.id)) return g;
        if (field === "installationTeam") {
          return { ...g, installationTeam: value };
        }
        if (field === "wiringTeam") {
          return { ...g, wiringTeam: value };
        }
        if (field === "siteSupervisor") {
          const parsed = value ? value.split(/[,/]/).map((s) => s.trim()).filter(Boolean) : [];
          return { ...g, supervisors: parsed };
        }
        if (field === "membersText") {
          const parsed = value ? [value.trim()] : [];
          return { ...g, wiringMembers: parsed };
        }
        if (field === "vehicle" || field === "car") {
          const parsed = value ? value.split(/[,/]/).map((s) => s.trim()).filter(Boolean) : [];
          return { ...g, cars: parsed };
        }
        return g;
      })
    );
  }

  function getCrewFieldValues(crew: InstallationCrew) {
    if (
      crew.installationTeam !== undefined ||
      crew.wiringTeam !== undefined ||
      crew.supervisorsText !== undefined ||
      crew.membersText !== undefined
    ) {
      return {
        installationTeam: crew.installationTeam ?? "",
        wiringTeam: crew.wiringTeam ?? "",
        siteSupervisor:
          crew.supervisorsText ??
          (crew.supervisorId ? memberMap.get(crew.supervisorId)?.name ?? "" : ""),
        membersText:
          crew.membersText ??
          [...crew.technicianIds, ...crew.internIds]
            .map((id) => memberMap.get(id)?.name)
            .filter(Boolean)
            .join(", "),
        car: crew.vehicle ?? "",
      };
    }

    const raw = `${crew.name || ""}`;
    const m = raw.match(/\bteam\s*(\d+)\b/i) || (crew.name || "").match(/\b(\d+)\b/);
    const teamNum = m ? Number(m[1]) : null;

    const matchingGroups = (groups || []).filter((g: any) => {
      if (!g.installationDate) return false;
      const start = weekBounds(g.installationDate)?.start;
      if (start !== activeWeek) return false;
      if (teamNum !== null) {
        const gRaw = `${g.teamLabel || ""} ${g.name || ""} ${g.installationTeam || ""} ${g.wiringTeam || ""}`;
        const gm = gRaw.match(/\bteam\s*(\d+)\b/i) || (g.teamLabel || "").match(/\b(\d+)\b/);
        if (gm && Number(gm[1]) === teamNum) return true;
      }
      return (
        (g.name && g.name.toLowerCase().trim() === crew.name.toLowerCase().trim()) ||
        (g.teamLabel && g.teamLabel.toLowerCase().trim() === crew.name.toLowerCase().trim())
      );
    });

    const proposeCrew =
      teamNum !== null && activeWeek >= currentWorkWeek ? proposeTeamCrews?.[teamNum] : undefined;
    const fromPropose = (value: string | undefined) =>
      value && !isPlaceholder(value) ? value.trim() : "";

    const blockInstallTeam =
      matchingGroups.map((g: any) => g.installationTeam).find((t: any) => t && !isPlaceholder(t)) ||
      fromPropose(proposeCrew?.installationTeam) ||
      "";

    const blockWiringTeam =
      matchingGroups.map((g: any) => g.wiringTeam).find((t: any) => t && !isPlaceholder(t)) ||
      fromPropose(proposeCrew?.wiringTeam) ||
      "";

    const blockSupervisors = Array.from(
      new Set(
        matchingGroups
          .flatMap((g: any) => g.supervisors ?? [])
          .map((s: any) => s.trim())
          .filter((s: any) => s && !isPlaceholder(s)),
      ),
    );
    const defaultSupervisor =
      blockSupervisors.length > 0
        ? blockSupervisors.join(", ")
        : fromPropose(proposeCrew?.siteSupervisor) ||
          (crew.supervisorId ? memberMap.get(crew.supervisorId)?.name ?? "" : "");

    const defaultMembers =
      matchingGroups.length > 0 && matchingGroups.some((g: any) => g.wiringMembers?.length)
        ? Array.from(
            new Set(
              matchingGroups
                .flatMap((g: any) => g.wiringMembers ?? [])
                .map((s: any) => s.trim())
                .filter(Boolean),
            ),
          ).join(", ")
        : fromPropose(proposeCrew?.membersText) ||
          crew.technicianIds.map((id) => memberMap.get(id)?.name).filter(Boolean).join(", ");

    const defaultCars =
      crew.vehicle ||
      Array.from(
        new Set(
          matchingGroups
            .flatMap((g: any) => g.cars ?? [])
            .map((s: any) => s.trim())
            .filter(Boolean),
        ),
      ).join(", ") ||
      fromPropose(proposeCrew?.car);

    return {
      installationTeam: blockInstallTeam,
      wiringTeam: blockWiringTeam,
      siteSupervisor: defaultSupervisor,
      membersText: defaultMembers,
      car: defaultCars,
    };
  }

  function handleCommitCrewField(crew: InstallationCrew, field: string, value: string) {
    const nextCrews = currentWeekCrews.map((c) => {
      if (c.id !== crew.id) return c;
      const updated = { ...c };
      if (field === "installationTeam") updated.installationTeam = value;
      else if (field === "wiringTeam") updated.wiringTeam = value;
      else if (field === "siteSupervisor") {
        updated.supervisorsText = value;
        const firstSupRaw = value.split(/[,/&]/)[0]?.trim();
        if (firstSupRaw) {
          const norm = normalizeArrangedName(firstSupRaw, "site_supervisor");
          const targetName = (norm?.name || firstSupRaw).toLowerCase().trim();
          const found =
            members.find((m) => m.role === "site_supervisor" && m.name.toLowerCase().trim() === targetName) ||
            members.find((m) => m.name.toLowerCase().trim() === targetName);
          if (found) updated.supervisorId = found.id;
        } else if (!value.trim()) {
          updated.supervisorId = null;
        }
      } else if (field === "membersText") {
        updated.membersText = value;
        const rawTokens = value.split(/[,/&]/).map((s) => s.trim()).filter(Boolean);
        const matchedTechIds: string[] = [];
        const matchedInternIds: string[] = [];
        for (const rawTok of rawTokens) {
          const norm = normalizeArrangedName(rawTok, "technician");
          const targetName = (norm?.name || rawTok).toLowerCase().trim();
          const found = members.find((m) => m.name.toLowerCase().trim() === targetName);
          if (found) {
            if (found.role === "intern" || norm?.role === "intern") {
              if (!matchedInternIds.includes(found.id)) matchedInternIds.push(found.id);
            } else {
              if (!matchedTechIds.includes(found.id)) matchedTechIds.push(found.id);
            }
          }
        }
        updated.technicianIds = matchedTechIds;
        updated.internIds = matchedInternIds;
      } else if (field === "vehicle" || field === "car") {
        updated.vehicle = value;
      }
      return updated;
    });

    updateCurrentWeekCrews(nextCrews);

    setCrewDrafts((prev) => {
      const copy = { ...prev };
      if (copy[crew.id]) {
        const fieldKey = field === "vehicle" ? "car" : field;
        delete copy[crew.id][fieldKey as keyof (typeof copy)[string]];
        if (Object.keys(copy[crew.id]).length === 0) delete copy[crew.id];
      }
      return copy;
    });

    syncCrewToGroups(crew, field, value);
  }

  // Member map for quick lookup
  const memberMap = useMemo(() => {
    const map = new Map<string, ProjectTeamMember>();
    for (const m of members) {
      map.set(m.id, m);
    }
    return map;
  }, [members]);

  // Stats calculation respecting activeWeek's absences
  const stats = useMemo(() => {
    const total = members.length;
    let availableCount = 0;
    let mcCount = 0;
    let leaveCount = 0;
    let supervisorsCount = 0;
    let techniciansCount = 0;
    let internsCount = 0;

    for (const m of members) {
      const isAwayInActiveWeek = isMemberUnavailableInWeek(m, activeWeek);
      if (!isAwayInActiveWeek) availableCount++;
      else if (m.availability.status === "mc") mcCount++;
      else if (m.availability.status === "leave") leaveCount++;

      if (m.role === "site_supervisor") supervisorsCount++;
      else if (m.role === "technician") techniciansCount++;
      else if (m.role === "intern") internsCount++;
    }

    return {
      total,
      availableCount,
      mcCount,
      leaveCount,
      supervisorsCount,
      techniciansCount,
      internsCount,
      crewsCount: currentWeekCrews.length,
    };
  }, [members, currentWeekCrews, activeWeek]);

  // Filtered members list following Arranged Installation priority
  const filteredMembers = useMemo(() => {
    const list = members.filter((m) => {
      if (roleFilter !== "all" && m.role !== roleFilter) return false;
      if (availabilityFilter !== "all" && m.availability.status !== availabilityFilter) return false;
      if (expertiseFilter !== "all" && !m.expertise.includes(expertiseFilter)) return false;

      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase();
        const matchName = m.name.toLowerCase().includes(q);
        const matchPhone = m.phone.toLowerCase().includes(q);
        const matchNotes = (m.notes || "").toLowerCase().includes(q);
        const matchSkills = m.expertise.some((e) => e.toLowerCase().includes(q));
        if (!matchName && !matchPhone && !matchNotes && !matchSkills) return false;
      }
      return true;
    });

    return list.sort((a, b) => {
      const roleOrder: Record<string, number> = { site_supervisor: 1, technician: 2, intern: 3 };
      const diff = (roleOrder[a.role] || 9) - (roleOrder[b.role] || 9);
      if (diff !== 0) return diff;

      const aKey = a.name.toLowerCase().trim();
      const bKey = b.name.toLowerCase().trim();

      if (a.role === "site_supervisor" && b.role === "site_supervisor") {
        const aIdx = KEY_ARRANGED_SUPERVISORS.indexOf(aKey);
        const bIdx = KEY_ARRANGED_SUPERVISORS.indexOf(bKey);
        if (aIdx !== -1 && bIdx !== -1) return aIdx - bIdx;
        if (aIdx !== -1) return -1;
        if (bIdx !== -1) return 1;
      }

      if (a.role === "technician" && b.role === "technician") {
        const aIdx = KEY_ARRANGED_TECHS.indexOf(aKey);
        const bIdx = KEY_ARRANGED_TECHS.indexOf(bKey);
        if (aIdx !== -1 && bIdx !== -1) return aIdx - bIdx;
        if (aIdx !== -1) return -1;
        if (bIdx !== -1) return 1;
      }

      if (a.role === "intern" && b.role === "intern") {
        const aIdx = KEY_ARRANGED_INTERNS.indexOf(aKey);
        const bIdx = KEY_ARRANGED_INTERNS.indexOf(bKey);
        if (aIdx !== -1 && bIdx !== -1) return aIdx - bIdx;
        if (aIdx !== -1) return -1;
        if (bIdx !== -1) return 1;
      }

      return a.name.localeCompare(b.name);
    });
  }, [members, roleFilter, availabilityFilter, expertiseFilter, searchQuery]);

  // Unassigned available members pool for the current week
  const unassignedMembers = useMemo(() => {
    return members.filter(
      (m) =>
        !currentWeekCrews.some(
          (c) =>
            c.supervisorId === m.id ||
            c.technicianIds.includes(m.id) ||
            c.internIds.includes(m.id)
        ) && !isMemberUnavailableInWeek(m, activeWeek)
    );
  }, [members, currentWeekCrews, activeWeek]);

  // Skill analysis per crew for the current week
  function getCrewSkillCoverage(crew: InstallationCrew) {
    const assignedMembers: ProjectTeamMember[] = [];
    const seenIds = new Set<string>();
    if (crew.supervisorId) {
      const sup = memberMap.get(crew.supervisorId);
      if (sup && !seenIds.has(sup.id)) {
        seenIds.add(sup.id);
        assignedMembers.push(sup);
      }
    }
    for (const tid of crew.technicianIds) {
      const tech = memberMap.get(tid);
      if (tech && !seenIds.has(tech.id)) {
        seenIds.add(tech.id);
        assignedMembers.push(tech);
      }
    }
    for (const iid of crew.internIds) {
      const intern = memberMap.get(iid);
      if (intern && !seenIds.has(intern.id)) {
        seenIds.add(intern.id);
        assignedMembers.push(intern);
      }
    }

    const allSkills = new Set<string>();
    let hasUnavailableMember = false;
    const unavailableList: { name: string; status: MemberAvailabilityStatus; reason?: string }[] = [];

    for (const m of assignedMembers) {
      m.expertise.forEach((exp) => allSkills.add(exp));
      if (isMemberUnavailableInWeek(m, activeWeek)) {
        hasUnavailableMember = true;
        unavailableList.push({
          name: m.name,
          status: m.availability.status,
          reason: m.availability.reason,
        });
      }
    }

    const hasWiring = allSkills.has("Electrical Wiring (AC/DC)") || allSkills.has("High Voltage / Substation");
    const hasMounting = allSkills.has("Roof Mounting & Structural");
    const hasInverter = allSkills.has("Inverter & BESS Commissioning") || allSkills.has("Testing & Commissioning (T&C)");
    const hasSupervisor = Boolean(crew.supervisorId);

    const isFullyCovered = hasWiring && hasMounting && hasInverter && hasSupervisor && !hasUnavailableMember;

    return {
      assignedMembers,
      hasWiring,
      hasMounting,
      hasInverter,
      hasSupervisor,
      isFullyCovered,
      hasUnavailableMember,
      unavailableList,
      totalCount: assignedMembers.length,
    };
  }

  // Handle Quick Availability status toggle
  function handleOpenQuickAvailability(member: ProjectTeamMember) {
    if (readOnly) return;
    setQuickAvailabilityMember(member);
    setQuickStatus(member.availability.status);
    setQuickReason(member.availability.reason || "");
    setQuickStartDate(member.availability.startDate || todayIso);
    setQuickEndDate(member.availability.endDate || todayIso);
  }

  function handleSaveQuickAvailability() {
    if (readOnly || !quickAvailabilityMember) return;
    setMembers((prev) =>
      prev.map((m) => {
        if (m.id !== quickAvailabilityMember.id) return m;
        return {
          ...m,
          availability: {
            status: quickStatus,
            reason: quickStatus !== "available" ? quickReason.trim() : undefined,
            startDate: quickStatus !== "available" ? quickStartDate : undefined,
            endDate: quickStatus !== "available" ? quickEndDate : undefined,
          },
        };
      })
    );
    setQuickAvailabilityMember(null);
  }

  // Remove member from a crew in active week
  function handleRemoveMemberFromCrew(crewId: string, memberId: string) {
    if (readOnly) return;
    const nextCrews = currentWeekCrews.map((c) => {
      if (c.id !== crewId) return c;
      return {
        ...c,
        supervisorId: c.supervisorId === memberId ? null : c.supervisorId,
        technicianIds: c.technicianIds.filter((id) => id !== memberId),
        internIds: c.internIds.filter((id) => id !== memberId),
      };
    });
    updateCurrentWeekCrews(nextCrews);
  }

  // Assign member to a crew in active week
  function handleAssignMemberToCrew(crewId: string, memberId: string) {
    if (readOnly) return;
    const member = memberMap.get(memberId);
    if (!member) return;

    const nextCrews = currentWeekCrews.map((c) => {
      if (c.id !== crewId) {
        return {
          ...c,
          supervisorId: c.supervisorId === memberId ? null : c.supervisorId,
          technicianIds: c.technicianIds.filter((id) => id !== memberId),
          internIds: c.internIds.filter((id) => id !== memberId),
        };
      }
      if (member.role === "site_supervisor") {
        return { ...c, supervisorId: memberId };
      }
      if (member.role === "technician") {
        return {
          ...c,
          technicianIds: c.technicianIds.includes(memberId)
            ? c.technicianIds
            : [...c.technicianIds, memberId],
        };
      }
      return {
        ...c,
        internIds: c.internIds.includes(memberId)
          ? c.internIds
          : [...c.internIds, memberId],
      };
    });

    updateCurrentWeekCrews(nextCrews);
  }

  // Delete member
  function handleDeleteMember(memberId: string) {
    if (readOnly) return;
    if (!confirm("Are you sure you want to remove this project team member?")) return;
    setMembers((prev) => prev.filter((m) => m.id !== memberId));
    const nextCrews = currentWeekCrews.map((c) => ({
      ...c,
      supervisorId: c.supervisorId === memberId ? null : c.supervisorId,
      technicianIds: c.technicianIds.filter((id) => id !== memberId),
      internIds: c.internIds.filter((id) => id !== memberId),
    }));
    updateCurrentWeekCrews(nextCrews);
  }

  // Delete crew in active week
  function handleDeleteCrew(crewId: string) {
    if (readOnly) return;
    if (!confirm("Are you sure you want to delete this installation crew?")) return;
    const nextCrews = currentWeekCrews.filter((c) => c.id !== crewId);
    updateCurrentWeekCrews(nextCrews);
  }

  // Inline update handlers for direct table editing (like Ready to Install)
  function handleInlineUpdateMember<K extends keyof ProjectTeamMember>(
    memberId: string,
    field: K,
    value: ProjectTeamMember[K]
  ) {
    if (readOnly) return;
    setMembers((prev) =>
      prev.map((m) => (m.id === memberId ? { ...m, [field]: value } : m))
    );
  }

  function handleInlineUpdateCar<K extends keyof ProjectVehicle>(
    carId: string,
    field: K,
    value: ProjectVehicle[K]
  ) {
    if (readOnly) return;
    setCars((prev) =>
      prev.map((c) => (c.id === carId ? { ...c, [field]: value } : c))
    );
  }

  function handleInlineUpdateCrew<K extends keyof InstallationCrew>(
    crewId: string,
    field: K,
    value: InstallationCrew[K]
  ) {
    if (readOnly) return;
    const nextCrews = currentWeekCrews.map((c) =>
      c.id === crewId ? { ...c, [field]: value } : c
    );
    updateCurrentWeekCrews(nextCrews);
  }

  return (
    <div className="project-team-container" style={{ padding: "16px 20px", display: "flex", flexDirection: "column", gap: "20px" }}>
      {/* KPI Stats Cards */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))",
          gap: "14px",
        }}
      >
        <div
          style={{
            background: "var(--surface)",
            padding: "14px 18px",
            borderRadius: "10px",
            border: "1px solid var(--line)",
            boxShadow: "var(--shadow)",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
          }}
        >
          <div>
            <div style={{ fontSize: "0.82rem", color: "#000000", fontWeight: 600 }}>Total Personnel</div>
            <div style={{ fontSize: "1.5rem", fontWeight: 700, color: "#000000" }}>{stats.total}</div>
            <div style={{ fontSize: "0.75rem", color: "#000000", marginTop: "2px" }}>
              {stats.supervisorsCount} Sups · {stats.techniciansCount} Techs · {stats.internsCount} Interns
            </div>
          </div>
          <div style={{ background: "#eff6ff", padding: "10px", borderRadius: "10px", color: "#2563eb" }}>
            <Users size={22} />
          </div>
        </div>

        <div
          style={{
            background: "var(--surface)",
            padding: "14px 18px",
            borderRadius: "10px",
            border: "1px solid var(--line)",
            boxShadow: "var(--shadow)",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
          }}
        >
          <div>
            <div style={{ fontSize: "0.82rem", color: "#000000", fontWeight: 600 }}>Available This Week</div>
            <div style={{ fontSize: "1.5rem", fontWeight: 700, color: "#000000" }}>{stats.availableCount}</div>
            <div style={{ fontSize: "0.75rem", color: "#000000", marginTop: "2px", fontWeight: 500 }}>
              {Math.round((stats.availableCount / (stats.total || 1)) * 100)}% Available for Schedule
            </div>
          </div>
          <div style={{ background: "#dcfce7", padding: "10px", borderRadius: "10px", color: "#16a34a" }}>
            <UserCheck size={22} />
          </div>
        </div>

        <div
          style={{
            background: "var(--surface)",
            padding: "14px 18px",
            borderRadius: "10px",
            border: "1px solid var(--line)",
            boxShadow: "var(--shadow)",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
          }}
        >
          <div>
            <div style={{ fontSize: "0.82rem", color: "#000000", fontWeight: 600 }}>On Leave</div>
            <div style={{ fontSize: "1.5rem", fontWeight: 700, color: "#000000" }}>
              {stats.mcCount + stats.leaveCount}
            </div>
            <div style={{ fontSize: "0.75rem", color: "#000000", marginTop: "2px" }}>
              {stats.mcCount + stats.leaveCount > 0
                ? `${stats.leaveCount} Leave · ${stats.mcCount} MC`
                : "No staff on leave or MC this week"}
            </div>
          </div>
          <div style={{ background: "#fef3c7", padding: "10px", borderRadius: "10px", color: "#d97706" }}>
            <Clock size={22} />
          </div>
        </div>
      </div>

      {/* Tabs navigation */}
      <div style={{ display: "flex", gap: "8px", borderBottom: "1px solid var(--line)", paddingBottom: "2px" }}>
        <button
          onClick={() => handleSelectTab("crews")}
          style={{
            display: "flex",
            alignItems: "center",
            gap: "8px",
            padding: "10px 18px",
            fontSize: "0.9rem",
            fontWeight: 600,
            background: activeTab === "crews" ? "var(--surface)" : "transparent",
            color: activeTab === "crews" ? "var(--ink)" : "var(--muted)",
            border: "1px solid",
            borderColor: activeTab === "crews" ? "var(--line)" : "transparent",
            borderBottom: activeTab === "crews" ? "2px solid #2563eb" : "none",
            borderRadius: "8px 8px 0 0",
            cursor: "pointer",
          }}
        >
          <Shield size={16} />
          Team Grouping ({currentWeekCrews.length})
        </button>

        <button
          onClick={() => handleSelectTab("members")}
          style={{
            display: "flex",
            alignItems: "center",
            gap: "8px",
            padding: "10px 18px",
            fontSize: "0.9rem",
            fontWeight: 600,
            background: activeTab === "members" ? "var(--surface)" : "transparent",
            color: activeTab === "members" ? "var(--ink)" : "var(--muted)",
            border: "1px solid",
            borderColor: activeTab === "members" ? "var(--line)" : "transparent",
            borderBottom: activeTab === "members" ? "2px solid #2563eb" : "none",
            borderRadius: "8px 8px 0 0",
            cursor: "pointer",
          }}
        >
          <Users size={16} />
          Manpower & Expertise ({members.length})
        </button>

        <button
          onClick={() => handleSelectTab("cars")}
          style={{
            display: "flex",
            alignItems: "center",
            gap: "8px",
            padding: "10px 18px",
            fontSize: "0.9rem",
            fontWeight: 600,
            background: activeTab === "cars" ? "var(--surface)" : "transparent",
            color: activeTab === "cars" ? "var(--ink)" : "var(--muted)",
            border: "1px solid",
            borderColor: activeTab === "cars" ? "var(--line)" : "transparent",
            borderBottom: activeTab === "cars" ? "2px solid #2563eb" : "none",
            borderRadius: "8px 8px 0 0",
            cursor: "pointer",
          }}
        >
          <Car size={16} />
          Car ({cars.length})
        </button>

        <button
          onClick={() => handleSelectTab("availability")}
          style={{
            display: "flex",
            alignItems: "center",
            gap: "8px",
            padding: "10px 18px",
            fontSize: "0.9rem",
            fontWeight: 600,
            background: activeTab === "availability" ? "var(--surface)" : "transparent",
            color: activeTab === "availability" ? "var(--ink)" : "var(--muted)",
            border: "1px solid",
            borderColor: activeTab === "availability" ? "var(--line)" : "transparent",
            borderBottom: activeTab === "availability" ? "2px solid #2563eb" : "none",
            borderRadius: "8px 8px 0 0",
            cursor: "pointer",
          }}
        >
          <Calendar size={16} />
          Availability & MC / Leave Calendar ({stats.mcCount + stats.leaveCount})
        </button>
      </div>

      {/* TAB 1: TEAM GROUPING */}
      {visitedTabs.has("crews") && (
        <div style={{ display: activeTab === "crews" ? "flex" : "none", flexDirection: "column", gap: "18px" }}>
          {/* Datalists for inline team header assignment */}
          <datalist id="registered-crew-cars">
            {carOptions.map((opt) => (
              <option key={opt} value={opt} />
            ))}
          </datalist>
          <datalist id="crew-install-teams-datalist">
            {installationTeamNames.map((name) => (
              <option key={name} value={name} />
            ))}
          </datalist>
          <datalist id="crew-wiring-teams-datalist">
            {wiringTeamNames.map((name) => (
              <option key={name} value={name} />
            ))}
          </datalist>
          <datalist id="crew-supervisors-datalist">
            {supervisorNames.map((name) => (
              <option key={name} value={name} />
            ))}
          </datalist>

          {/* Week Selector Toolbar matching Arranged Installation */}
          <div
            style={{
              display: "flex",
              flexWrap: "wrap",
              alignItems: "center",
              justifyContent: "space-between",
              gap: "12px",
              background: "var(--surface)",
              padding: "12px 18px",
              borderRadius: "10px",
              border: "1px solid var(--line)",
              boxShadow: "var(--shadow)",
            }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: "10px", flexWrap: "wrap" }}>
              <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                <Calendar size={18} style={{ color: "#2563eb" }} />
                <span style={{ fontWeight: 700, fontSize: "0.92rem", color: "var(--ink)" }}>
                  Scheduled Week:
                </span>
              </div>

              <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                <button
                  type="button"
                  onClick={handlePrevWeek}
                  disabled={allNavWeeks.indexOf(activeWeek) <= 0}
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    gap: "4px",
                    padding: "6px 12px",
                    borderRadius: "6px",
                    border: "1px solid var(--line)",
                    background: "var(--surface)",
                    color: "var(--ink)",
                    fontSize: "0.82rem",
                    fontWeight: 600,
                    cursor: allNavWeeks.indexOf(activeWeek) <= 0 ? "not-allowed" : "pointer",
                    opacity: allNavWeeks.indexOf(activeWeek) <= 0 ? 0.5 : 1,
                  }}
                  title="Previous week"
                >
                  <ChevronLeft size={15} />
                  Previous
                </button>

                <select
                  value={activeWeek}
                  onChange={(e) => setSelectedWeek(e.target.value)}
                  style={{
                    padding: "6px 12px",
                    borderRadius: "6px",
                    border: "1px solid var(--line)",
                    background: "var(--surface)",
                    color: "var(--ink)",
                    fontSize: "0.85rem",
                    fontWeight: 600,
                    cursor: "pointer",
                  }}
                  aria-label="Select week"
                >
                  {allNavWeeks.map((w) => (
                    <option key={w} value={w}>
                      Week {weekRangeLabel(w)} {w === latestArrangedWeek ? "(Latest)" : ""}
                    </option>
                  ))}
                </select>

                <button
                  type="button"
                  onClick={handleNextWeek}
                  disabled={allNavWeeks.indexOf(activeWeek) === allNavWeeks.length - 1}
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    gap: "4px",
                    padding: "6px 12px",
                    borderRadius: "6px",
                    border: "1px solid var(--line)",
                    background: "var(--surface)",
                    color: "var(--ink)",
                    fontSize: "0.82rem",
                    fontWeight: 600,
                    cursor: allNavWeeks.indexOf(activeWeek) === allNavWeeks.length - 1 ? "not-allowed" : "pointer",
                    opacity: allNavWeeks.indexOf(activeWeek) === allNavWeeks.length - 1 ? 0.5 : 1,
                  }}
                  title="Next week"
                >
                  Next
                  <ChevronRight size={15} />
                </button>
              </div>

              {activeWeek === latestArrangedWeek && (
                <span
                  style={{
                    background: "#eff6ff",
                    color: "#1d4ed8",
                    padding: "3px 8px",
                    borderRadius: "12px",
                    fontSize: "0.74rem",
                    fontWeight: 700,
                    border: "1px solid #bfdbfe",
                  }}
                >
                  Latest Week
                </span>
              )}
            </div>

            {!readOnly && (
              <div>
                <button
                  type="button"
                  onClick={() => {
                    setEditingCrew(null);
                    setIsCrewModalOpen(true);
                  }}
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    gap: "6px",
                    padding: "6px 14px",
                    borderRadius: "6px",
                    background: "var(--ink)",
                    color: "var(--surface)",
                    border: "none",
                    fontSize: "0.82rem",
                    fontWeight: 600,
                    cursor: "pointer",
                  }}
                >
                  <Plus size={15} />
                  New Team
                </button>
              </div>
            )}
          </div>

          {/* Crews Grid */}
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fill, minmax(360px, 1fr))",
              gap: "18px",
            }}
          >
            {currentWeekCrews.map((crew) => {
              const coverage = getCrewSkillCoverage(crew);
              const supervisor = crew.supervisorId ? memberMap.get(crew.supervisorId) : null;
              const teamColor = getTeamColor(crew.name);
              const fieldVals = getCrewFieldValues(crew);
              const draft = crewDrafts[crew.id] || {};
              const displayInstallTeam = draft.installationTeam ?? fieldVals.installationTeam;
              const displayWiringTeam = draft.wiringTeam ?? fieldVals.wiringTeam;
              const displaySupervisor = draft.siteSupervisor ?? fieldVals.siteSupervisor;
              const displayMembers = draft.membersText ?? fieldVals.membersText;
              const displayCar = draft.car ?? fieldVals.car;

              const setDraftField = (
                field: "installationTeam" | "wiringTeam" | "siteSupervisor" | "membersText" | "car",
                val: string
              ) => {
                setCrewDrafts((prev) => ({
                  ...prev,
                  [crew.id]: {
                    ...(prev[crew.id] || {}),
                    [field]: val,
                  },
                }));
              };

              return (
                <div
                  key={crew.id}
                  style={{
                    background: "var(--surface)",
                    borderRadius: "12px",
                    border: coverage.hasUnavailableMember
                      ? "2px solid #ef4444"
                      : `1px solid ${teamColor.border}`,
                    boxShadow: "var(--shadow)",
                    display: "flex",
                    flexDirection: "column",
                    overflow: "visible",
                    position: "relative",
                  }}
                >
                  {/* Crew Header */}
                  <div
                    style={{
                      padding: "14px 16px",
                      background: teamColor.bg,
                      color: teamColor.text,
                      borderRadius: coverage.hasUnavailableMember ? "10px 10px 0 0" : "11px 11px 0 0",
                      borderBottom: `1px solid ${teamColor.border}`,
                      display: "flex",
                      flexDirection: "column",
                      gap: "10px",
                    }}
                  >
                    <div
                      style={{
                        display: "flex",
                        alignItems: "flex-start",
                        justifyContent: "space-between",
                        gap: "10px",
                      }}
                    >
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ display: "flex", alignItems: "center", gap: "8px", flexWrap: "wrap" }}>
                          <input
                            type="text"
                            className={`crew-header-input${teamColor.isLight ? " is-light" : ""}`}
                            value={crew.name}
                            onChange={(e) => handleInlineUpdateCrew(crew.id, "name", e.target.value)}
                            placeholder="Team Name"
                            style={{
                              fontWeight: 800,
                              fontSize: "0.95rem",
                              letterSpacing: "0.2px",
                              padding: "3px 6px",
                              width: "auto",
                              maxWidth: "150px",
                              color: teamColor.text,
                            }}
                            title="Click to edit team name"
                          />
                          {crew.targetDate && (
                            <span
                              style={{
                                background: teamColor.isLight ? "rgba(0, 0, 0, 0.12)" : "rgba(255, 255, 255, 0.2)",
                                color: teamColor.text,
                                padding: "2px 8px",
                                borderRadius: "12px",
                                fontSize: "0.71rem",
                                fontWeight: 700,
                              }}
                            >
                              {crew.targetDate}
                            </span>
                          )}
                          {coverage.hasUnavailableMember ? (
                            <span
                              style={{
                                background: "#fee2e2",
                                color: "#b91c1c",
                                padding: "2px 8px",
                                borderRadius: "12px",
                                fontSize: "0.72rem",
                                fontWeight: 700,
                                display: "inline-flex",
                                alignItems: "center",
                                gap: "4px",
                              }}
                            >
                              <AlertCircle size={12} />
                              Unavailable Cover Needed
                            </span>
                          ) : coverage.totalCount === 0 && !displayInstallTeam && !displayWiringTeam ? (
                            <span
                              style={{
                                background: "rgba(255, 255, 255, 0.92)",
                                color: "#334155",
                                padding: "2px 8px",
                                borderRadius: "12px",
                                fontSize: "0.72rem",
                                fontWeight: 700,
                              }}
                            >
                              Empty Team
                            </span>
                          ) : coverage.isFullyCovered ? (
                            <span
                              style={{
                                background: "#dcfce7",
                                color: "#15803d",
                                padding: "2px 8px",
                                borderRadius: "12px",
                                fontSize: "0.72rem",
                                fontWeight: 700,
                                display: "inline-flex",
                                alignItems: "center",
                                gap: "4px",
                              }}
                            >
                              <CheckCircle2 size={12} />
                              Ready & Balanced
                            </span>
                          ) : (
                            <span
                              style={{
                                background: "rgba(255, 255, 255, 0.92)",
                                color: "#1e293b",
                                padding: "2px 8px",
                                borderRadius: "12px",
                                fontSize: "0.72rem",
                                fontWeight: 700,
                              }}
                            >
                              {displayInstallTeam || "Scheduled"}
                            </span>
                          )}
                        </div>

                        <div
                          style={{
                            display: "flex",
                            alignItems: "center",
                            gap: "8px",
                            fontSize: "0.78rem",
                            color: teamColor.subText,
                            marginTop: "4px",
                            flexWrap: "wrap",
                          }}
                        >
                          <div style={{ display: "flex", alignItems: "center", gap: "3px" }}>
                            <MapPin size={13} style={{ color: teamColor.subText, flexShrink: 0 }} />
                            <input
                              type="text"
                              className={`crew-header-input${teamColor.isLight ? " is-light" : ""}`}
                              value={crew.baseLocation}
                              onChange={(e) => handleInlineUpdateCrew(crew.id, "baseLocation", e.target.value)}
                              placeholder="Base Location"
                              style={{
                                fontSize: "0.78rem",
                                fontWeight: 600,
                                color: teamColor.text,
                                padding: "2px 6px",
                                width: "110px",
                              }}
                              title="Click to edit base location"
                            />
                          </div>
                        </div>
                      </div>

                      <div style={{ display: "flex", gap: "4px" }}>
                        <button
                          onClick={() => handleDeleteCrew(crew.id)}
                          title="Delete Crew"
                          style={{
                            background: teamColor.isLight ? "rgba(0, 0, 0, 0.08)" : "rgba(255, 255, 255, 0.16)",
                            border: "none",
                            color: teamColor.text,
                            cursor: "pointer",
                            padding: "5px",
                            borderRadius: "6px",
                            display: "inline-flex",
                            alignItems: "center",
                            justifyContent: "center",
                          }}
                        >
                          <Trash2 size={15} />
                        </button>
                      </div>
                    </div>

                    {/* Team Header Details from Propose to Install & Arranged Installation */}
                    <div
                      style={{
                        display: "grid",
                        gridTemplateColumns: "repeat(2, minmax(0, 1fr))",
                        gap: "8px",
                        paddingTop: "8px",
                        borderTop: teamColor.isLight
                          ? "1px solid rgba(0, 0, 0, 0.12)"
                          : "1px solid rgba(255, 255, 255, 0.22)",
                      }}
                    >
                      <div>
                        <div
                          style={{
                            fontSize: "0.66rem",
                            fontWeight: 700,
                            textTransform: "uppercase",
                            letterSpacing: "0.4px",
                            color: teamColor.subText,
                            marginBottom: "2px",
                          }}
                        >
                          Installation Team
                        </div>
                        <input
                          type="text"
                          list="crew-install-teams-datalist"
                          className={`crew-header-input${teamColor.isLight ? " is-light" : ""}`}
                          value={displayInstallTeam}
                          readOnly={readOnly}
                          onChange={(e) => setDraftField("installationTeam", e.target.value)}
                          onBlur={(e) => handleCommitCrewField(crew, "installationTeam", e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === "Enter") (e.target as HTMLInputElement).blur();
                          }}
                          placeholder="Assign installation team..."
                          style={{
                            width: "100%",
                            fontSize: "0.78rem",
                            fontWeight: 700,
                            color: teamColor.text,
                            padding: "4px 7px",
                            background: teamColor.isLight ? "rgba(255, 255, 255, 0.45)" : "rgba(0, 0, 0, 0.18)",
                            borderRadius: "6px",
                            border: teamColor.isLight
                              ? "1px solid rgba(0, 0, 0, 0.15)"
                              : "1px solid rgba(255, 255, 255, 0.25)",
                          }}
                        />
                      </div>

                      <div>
                        <div
                          style={{
                            fontSize: "0.66rem",
                            fontWeight: 700,
                            textTransform: "uppercase",
                            letterSpacing: "0.4px",
                            color: teamColor.subText,
                            marginBottom: "2px",
                          }}
                        >
                          Wiring Team
                        </div>
                        <input
                          type="text"
                          list="crew-wiring-teams-datalist"
                          className={`crew-header-input${teamColor.isLight ? " is-light" : ""}`}
                          value={displayWiringTeam}
                          readOnly={readOnly}
                          onChange={(e) => setDraftField("wiringTeam", e.target.value)}
                          onBlur={(e) => handleCommitCrewField(crew, "wiringTeam", e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === "Enter") (e.target as HTMLInputElement).blur();
                          }}
                          placeholder="Assign wiring team..."
                          style={{
                            width: "100%",
                            fontSize: "0.78rem",
                            fontWeight: 700,
                            color: teamColor.text,
                            padding: "4px 7px",
                            background: teamColor.isLight ? "rgba(255, 255, 255, 0.45)" : "rgba(0, 0, 0, 0.18)",
                            borderRadius: "6px",
                            border: teamColor.isLight
                              ? "1px solid rgba(0, 0, 0, 0.15)"
                              : "1px solid rgba(255, 255, 255, 0.25)",
                          }}
                        />
                      </div>

                      <div>
                        <div
                          style={{
                            fontSize: "0.66rem",
                            fontWeight: 700,
                            textTransform: "uppercase",
                            letterSpacing: "0.4px",
                            color: teamColor.subText,
                            marginBottom: "2px",
                          }}
                        >
                          Site Supervisor
                        </div>
                        <input
                          type="text"
                          list="crew-supervisors-datalist"
                          className={`crew-header-input${teamColor.isLight ? " is-light" : ""}`}
                          value={displaySupervisor}
                          readOnly={readOnly}
                          onChange={(e) => setDraftField("siteSupervisor", e.target.value)}
                          onBlur={(e) => handleCommitCrewField(crew, "siteSupervisor", e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === "Enter") (e.target as HTMLInputElement).blur();
                          }}
                          placeholder="Assign site supervisor..."
                          style={{
                            width: "100%",
                            fontSize: "0.78rem",
                            fontWeight: 700,
                            color: teamColor.text,
                            padding: "4px 7px",
                            background: teamColor.isLight ? "rgba(255, 255, 255, 0.45)" : "rgba(0, 0, 0, 0.18)",
                            borderRadius: "6px",
                            border: teamColor.isLight
                              ? "1px solid rgba(0, 0, 0, 0.15)"
                              : "1px solid rgba(255, 255, 255, 0.25)",
                          }}
                        />
                      </div>

                      <div>
                        <div
                          style={{
                            fontSize: "0.66rem",
                            fontWeight: 700,
                            textTransform: "uppercase",
                            letterSpacing: "0.4px",
                            color: teamColor.subText,
                            marginBottom: "2px",
                          }}
                        >
                          Car
                        </div>
                        <input
                          type="text"
                          list="registered-crew-cars"
                          className={`crew-header-input${teamColor.isLight ? " is-light" : ""}`}
                          value={displayCar}
                          readOnly={readOnly}
                          onChange={(e) => setDraftField("car", e.target.value)}
                          onBlur={(e) => handleCommitCrewField(crew, "car", e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === "Enter") (e.target as HTMLInputElement).blur();
                          }}
                          placeholder="Assign car / vehicle..."
                          style={{
                            width: "100%",
                            fontSize: "0.78rem",
                            fontWeight: 700,
                            color: teamColor.text,
                            padding: "4px 7px",
                            background: teamColor.isLight ? "rgba(255, 255, 255, 0.45)" : "rgba(0, 0, 0, 0.18)",
                            borderRadius: "6px",
                            border: teamColor.isLight
                              ? "1px solid rgba(0, 0, 0, 0.15)"
                              : "1px solid rgba(255, 255, 255, 0.25)",
                          }}
                        />
                      </div>

                      <div style={{ gridColumn: "1 / -1" }}>
                        <div
                          style={{
                            fontSize: "0.66rem",
                            fontWeight: 700,
                            textTransform: "uppercase",
                            letterSpacing: "0.4px",
                            color: teamColor.subText,
                            marginBottom: "2px",
                          }}
                        >
                          Team Member
                        </div>
                        <input
                          type="text"
                          className={`crew-header-input${teamColor.isLight ? " is-light" : ""}`}
                          value={displayMembers}
                          readOnly={readOnly}
                          onChange={(e) => setDraftField("membersText", e.target.value)}
                          onBlur={(e) => handleCommitCrewField(crew, "membersText", e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === "Enter") (e.target as HTMLInputElement).blur();
                          }}
                          placeholder="Team members (e.g. Jamar, Faiz, Shahir)..."
                          style={{
                            width: "100%",
                            fontSize: "0.78rem",
                            fontWeight: 700,
                            color: teamColor.text,
                            padding: "4px 7px",
                            background: teamColor.isLight ? "rgba(255, 255, 255, 0.45)" : "rgba(0, 0, 0, 0.18)",
                            borderRadius: "6px",
                            border: teamColor.isLight
                              ? "1px solid rgba(0, 0, 0, 0.15)"
                              : "1px solid rgba(255, 255, 255, 0.25)",
                          }}
                        />
                      </div>
                    </div>
                  </div>

                  {/* Unavailable warning banner for active week */}
                  {coverage.hasUnavailableMember && (
                    <div
                      style={{
                        background: "#fee2e2",
                        color: "#991b1b",
                        padding: "8px 14px",
                        fontSize: "0.78rem",
                        borderBottom: "1px solid #fca5a5",
                        display: "flex",
                        flexDirection: "column",
                        gap: "2px",
                      }}
                    >
                      {coverage.unavailableList.map((un, uidx) => (
                        <div key={uidx} style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                          <AlertCircle size={14} style={{ color: "#dc2626", flexShrink: 0 }} />
                          <span>
                            <strong>{un.name}</strong> is {un.status === "mc" ? "on MC" : "on Leave"} this week
                            {un.reason ? ` (${un.reason})` : ""}.
                          </span>
                        </div>
                      ))}
                    </div>
                  )}

                  {/* Skill coverage badges */}
                  {coverage.totalCount > 0 && (
                    <div
                      style={{
                        padding: "10px 16px",
                        background: "var(--surface)",
                        borderBottom: "1px solid var(--line)",
                        display: "flex",
                        flexWrap: "wrap",
                        gap: "6px",
                      }}
                    >
                      <span
                        style={{
                          fontSize: "0.72rem",
                          padding: "3px 8px",
                          borderRadius: "12px",
                          fontWeight: 600,
                          display: "inline-flex",
                          alignItems: "center",
                          gap: "4px",
                          background: coverage.hasSupervisor ? "#eff6ff" : "#fef2f2",
                          color: coverage.hasSupervisor ? "#1d4ed8" : "#b91c1c",
                          border: coverage.hasSupervisor ? "1px solid #bfdbfe" : "1px solid #fecaca",
                        }}
                      >
                        {coverage.hasSupervisor ? "✓" : "✗"} Supervisor
                      </span>

                      <span
                        style={{
                          fontSize: "0.72rem",
                          padding: "3px 8px",
                          borderRadius: "12px",
                          fontWeight: 600,
                          display: "inline-flex",
                          alignItems: "center",
                          gap: "4px",
                          background: coverage.hasWiring ? "#f0fdf4" : "#fef2f2",
                          color: coverage.hasWiring ? "#15803d" : "#b91c1c",
                          border: coverage.hasWiring ? "1px solid #bbf7d0" : "1px solid #fecaca",
                        }}
                      >
                        ⚡ {coverage.hasWiring ? "✓ Wiring" : "✗ Wiring Missing"}
                      </span>

                      <span
                        style={{
                          fontSize: "0.72rem",
                          padding: "3px 8px",
                          borderRadius: "12px",
                          fontWeight: 600,
                          display: "inline-flex",
                          alignItems: "center",
                          gap: "4px",
                          background: coverage.hasMounting ? "#f0fdf4" : "#fef2f2",
                          color: coverage.hasMounting ? "#15803d" : "#b91c1c",
                          border: coverage.hasMounting ? "1px solid #bbf7d0" : "1px solid #fecaca",
                        }}
                      >
                        🔧 {coverage.hasMounting ? "✓ Mounting" : "✗ Mounting Missing"}
                      </span>

                      <span
                        style={{
                          fontSize: "0.72rem",
                          padding: "3px 8px",
                          borderRadius: "12px",
                          fontWeight: 600,
                          display: "inline-flex",
                          alignItems: "center",
                          gap: "4px",
                          background: coverage.hasInverter ? "#f0fdf4" : "#fef2f2",
                          color: coverage.hasInverter ? "#15803d" : "#b91c1c",
                          border: coverage.hasInverter ? "1px solid #bbf7d0" : "1px solid #fecaca",
                        }}
                      >
                        🔋 {coverage.hasInverter ? "✓ Inverter/T&C" : "✗ Inverter Missing"}
                      </span>
                    </div>
                  )}

                  {/* Crew Roster List */}
                  <div style={{ padding: "14px 16px", display: "flex", flexDirection: "column", gap: "12px", flex: 1 }}>
                    {/* Site Supervisor section */}
                    <div>
                      <div style={{ fontSize: "0.75rem", fontWeight: 700, color: "var(--muted)", textTransform: "uppercase", marginBottom: "6px", display: "flex", justifyContent: "space-between" }}>
                        <span>Site Supervisor</span>
                        {supervisor && supervisor.phone && <span>{supervisor.phone}</span>}
                      </div>

                      {supervisor ? (
                        <div
                          style={{
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "space-between",
                            padding: "8px 12px",
                            background: isMemberUnavailableInWeek(supervisor, activeWeek) ? "#fee2e2" : "var(--surface-soft)",
                            borderRadius: "8px",
                            border: "1px solid",
                            borderColor: isMemberUnavailableInWeek(supervisor, activeWeek) ? "#fca5a5" : "var(--line)",
                          }}
                        >
                          <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                            <HardHat size={16} style={{ color: "#2563eb" }} />
                            <div>
                              <strong style={{ fontSize: "0.85rem", color: "var(--ink)" }}>{supervisor.name}</strong>
                              {isMemberUnavailableInWeek(supervisor, activeWeek) && (
                                <span style={{ marginLeft: "8px", fontSize: "0.72rem", color: "#dc2626", fontWeight: 600 }}>
                                  ({supervisor.availability.status.toUpperCase()})
                                </span>
                              )}
                            </div>
                          </div>

                          <button
                            onClick={() => handleRemoveMemberFromCrew(crew.id, supervisor.id)}
                            title="Remove supervisor"
                            style={{ background: "transparent", border: "none", color: "var(--muted)", cursor: "pointer", padding: "2px" }}
                          >
                            <X size={15} />
                          </button>
                        </div>
                      ) : (
                        <div
                          style={{
                            padding: "8px 12px",
                            border: "1px dashed var(--line)",
                            borderRadius: "8px",
                            fontSize: "0.8rem",
                            color: "var(--muted)",
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "space-between",
                          }}
                        >
                          <span>No supervisor assigned</span>
                          {!readOnly && (
                            <SearchableMemberAssigner
                              role="site_supervisor"
                              placeholder="+ Assign Supervisor"
                              alreadyAssignedIds={crew.supervisorId ? [crew.supervisorId] : []}
                              onAssign={(id) => handleAssignMemberToCrew(crew.id, id)}
                              members={members}
                              activeWeek={activeWeek}
                              currentWeekCrews={currentWeekCrews}
                            />
                          )}
                        </div>
                      )}
                    </div>

                    {/* Technicians section */}
                    <div>
                      <div style={{ fontSize: "0.75rem", fontWeight: 700, color: "var(--muted)", textTransform: "uppercase", marginBottom: "6px", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                        <span>Technicians ({crew.technicianIds.length})</span>
                        {!readOnly && (
                          <SearchableMemberAssigner
                            role="technician"
                            placeholder="+ Add Tech"
                            alreadyAssignedIds={crew.technicianIds}
                            onAssign={(id) => handleAssignMemberToCrew(crew.id, id)}
                            members={members}
                            activeWeek={activeWeek}
                            currentWeekCrews={currentWeekCrews}
                          />
                        )}
                      </div>

                      {crew.technicianIds.length === 0 ? (
                        <div style={{ padding: "8px 12px", border: "1px dashed var(--line)", borderRadius: "8px", fontSize: "0.8rem", color: "var(--muted)" }}>
                          No technicians assigned
                        </div>
                      ) : (
                        <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
                          {crew.technicianIds.map((tid) => {
                            const tech = memberMap.get(tid);
                            if (!tech) return null;
                            const isUnavailable = isMemberUnavailableInWeek(tech, activeWeek);

                            return (
                              <div
                                key={tid}
                                style={{
                                  display: "flex",
                                  alignItems: "center",
                                  justifyContent: "space-between",
                                  padding: "8px 12px",
                                  background: isUnavailable ? "#fee2e2" : "var(--surface-soft)",
                                  borderRadius: "8px",
                                  border: "1px solid",
                                  borderColor: isUnavailable ? "#fca5a5" : "var(--line)",
                                }}
                              >
                                <div>
                                  <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                                    <Wrench size={14} style={{ color: "#059669" }} />
                                    <strong style={{ fontSize: "0.82rem", color: "var(--ink)" }}>{tech.name}</strong>
                                    {isUnavailable && (
                                      <span style={{ fontSize: "0.7rem", color: "#dc2626", fontWeight: 700 }}>
                                        ({tech.availability.status.toUpperCase()})
                                      </span>
                                    )}
                                  </div>
                                  <div style={{ display: "flex", flexWrap: "wrap", gap: "4px", marginTop: "3px" }}>
                                    {tech.expertise.map((exp, eidx) => (
                                      <span
                                        key={eidx}
                                        style={{
                                          fontSize: "0.68rem",
                                          padding: "1px 5px",
                                          borderRadius: "4px",
                                          background: "var(--surface)",
                                          border: "1px solid var(--line)",
                                          color: "var(--muted)",
                                        }}
                                      >
                                        {exp.split(" ")[0]}
                                      </span>
                                    ))}
                                  </div>
                                </div>

                                <button
                                  onClick={() => handleRemoveMemberFromCrew(crew.id, tech.id)}
                                  title="Remove from crew"
                                  style={{ background: "transparent", border: "none", color: "var(--muted)", cursor: "pointer", padding: "2px" }}
                                >
                                  <X size={14} />
                                </button>
                              </div>
                            );
                          })}
                        </div>
                      )}
                    </div>

                    {/* Interns section */}
                    <div>
                      <div style={{ fontSize: "0.75rem", fontWeight: 700, color: "var(--muted)", textTransform: "uppercase", marginBottom: "6px", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                        <span>Interns ({crew.internIds.length})</span>
                        {!readOnly && (
                          <SearchableMemberAssigner
                            role="intern"
                            placeholder="+ Add Intern"
                            alreadyAssignedIds={crew.internIds}
                            onAssign={(id) => handleAssignMemberToCrew(crew.id, id)}
                            members={members}
                            activeWeek={activeWeek}
                            currentWeekCrews={currentWeekCrews}
                          />
                        )}
                      </div>

                      {crew.internIds.length === 0 ? (
                        <div style={{ padding: "8px 12px", border: "1px dashed var(--line)", borderRadius: "8px", fontSize: "0.8rem", color: "var(--muted)", background: "var(--surface)" }}>
                          No interns assigned
                        </div>
                      ) : (
                        <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
                          {crew.internIds.map((iid) => {
                            const intern = memberMap.get(iid);
                            if (!intern) return null;
                            const isUnavailable = isMemberUnavailableInWeek(intern, activeWeek);

                            return (
                              <div
                                key={iid}
                                style={{
                                  display: "flex",
                                  alignItems: "center",
                                  justifyContent: "space-between",
                                  padding: "8px 12px",
                                  background: isUnavailable ? "#fee2e2" : "var(--surface-soft)",
                                  borderRadius: "8px",
                                  border: "1px solid",
                                  borderColor: isUnavailable ? "#fca5a5" : "var(--line)",
                                }}
                              >
                                <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                                  <GraduationCap size={14} style={{ color: "var(--ink)" }} />
                                  <strong style={{ fontSize: "0.82rem", color: "var(--ink)" }}>{intern.name}</strong>
                                  {isUnavailable && (
                                    <span style={{ fontSize: "0.7rem", color: "#dc2626", fontWeight: 700 }}>
                                      ({intern.availability.status.toUpperCase()})
                                    </span>
                                  )}
                                </div>

                                <button
                                  onClick={() => handleRemoveMemberFromCrew(crew.id, intern.id)}
                                  title="Remove from crew"
                                  style={{ background: "transparent", border: "none", color: "var(--muted)", cursor: "pointer", padding: "2px" }}
                                >
                                  <X size={14} />
                                </button>
                              </div>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* TAB 2: MANPOWER & EXPERTISE */}
      {visitedTabs.has("members") && (
        <div style={{ display: activeTab === "members" ? "flex" : "none", flexDirection: "column", gap: "16px" }}>
          {/* Filter Toolbar */}
          <div
            style={{
              background: "var(--surface)",
              padding: "14px 18px",
              borderRadius: "10px",
              border: "1px solid var(--line)",
              display: "flex",
              flexWrap: "wrap",
              alignItems: "center",
              justifyContent: "space-between",
              gap: "12px",
            }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: "10px", flex: 1, minWidth: "260px" }}>
              <div ref={searchContainerRef} style={{ position: "relative", width: "100%", maxWidth: "320px" }}>
                <Search size={16} style={{ position: "absolute", left: "10px", top: "10px", color: "var(--muted)" }} />
                <input
                  type="text"
                  placeholder="Search name, phone, skill..."
                  value={searchQuery}
                  onFocus={() => setIsSearchDropdownOpen(true)}
                  onChange={(e) => {
                    setSearchQuery(e.target.value);
                    setIsSearchDropdownOpen(true);
                  }}
                  style={{
                    width: "100%",
                    padding: "8px 30px 8px 32px",
                    borderRadius: "8px",
                    border: "1px solid var(--line)",
                    fontSize: "0.85rem",
                    background: "var(--bg)",
                    color: "var(--ink)",
                  }}
                />
                {searchQuery && (
                  <button
                    type="button"
                    onClick={() => {
                      setSearchQuery("");
                      setIsSearchDropdownOpen(false);
                    }}
                    title="Clear search"
                    style={{
                      position: "absolute",
                      right: "8px",
                      top: "8px",
                      background: "transparent",
                      border: "none",
                      color: "var(--muted)",
                      cursor: "pointer",
                      padding: "2px",
                      display: "flex",
                      alignItems: "center",
                    }}
                  >
                    <X size={15} />
                  </button>
                )}

                {/* Autocomplete Dropdown */}
                {isSearchDropdownOpen && searchDropdownMembers.length > 0 && (
                  <div
                    style={{
                      position: "absolute",
                      top: "calc(100% + 4px)",
                      left: 0,
                      width: "100%",
                      minWidth: "320px",
                      maxHeight: "320px",
                      overflowY: "auto",
                      background: "var(--surface)",
                      border: "1px solid var(--line)",
                      borderRadius: "8px",
                      boxShadow: "0 8px 24px rgba(0, 0, 0, 0.12)",
                      zIndex: 60,
                      padding: "4px",
                    }}
                  >
                    <div
                      style={{
                        padding: "6px 10px",
                        fontSize: "0.72rem",
                        color: "var(--muted)",
                        fontWeight: 600,
                        borderBottom: "1px solid var(--line)",
                        display: "flex",
                        justifyContent: "space-between",
                        alignItems: "center",
                      }}
                    >
                      <span>{searchQuery.trim() ? `Matching Personnel (${searchDropdownMembers.length})` : "All Personnel"}</span>
                      <span style={{ fontSize: "0.68rem" }}>Click to filter</span>
                    </div>
                    {searchDropdownMembers.map((m) => {
                      const isUnavailable = isMemberUnavailableInWeek(m, activeWeek);
                      return (
                        <div
                          key={m.id}
                          onMouseDown={(e) => {
                            e.preventDefault();
                            setSearchQuery(m.name);
                            setIsSearchDropdownOpen(false);
                          }}
                          style={{
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "space-between",
                            padding: "8px 10px",
                            borderRadius: "6px",
                            cursor: "pointer",
                            transition: "background 0.15s ease",
                            gap: "8px",
                          }}
                          onMouseEnter={(e) => (e.currentTarget.style.background = "var(--surface-soft)")}
                          onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
                        >
                          <div style={{ display: "flex", alignItems: "center", gap: "8px", minWidth: 0 }}>
                            {m.role === "site_supervisor" && <HardHat size={15} style={{ color: "#2563eb", flexShrink: 0 }} />}
                            {m.role === "technician" && <Wrench size={15} style={{ color: "#059669", flexShrink: 0 }} />}
                            {m.role === "intern" && <GraduationCap size={15} style={{ color: "#9333ea", flexShrink: 0 }} />}

                            <div style={{ minWidth: 0 }}>
                              <div style={{ fontSize: "0.85rem", fontWeight: 600, color: "var(--ink)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                                {m.name}
                              </div>
                              <div style={{ fontSize: "0.72rem", color: "var(--muted)" }}>
                                {m.phone} · {m.role === "site_supervisor" ? "Site Supervisor" : m.role === "technician" ? "Technician" : "Intern"}
                              </div>
                            </div>
                          </div>

                          <div style={{ display: "flex", alignItems: "center", gap: "6px", flexShrink: 0 }}>
                            <span
                              style={{
                                fontSize: "0.68rem",
                                padding: "2px 6px",
                                borderRadius: "10px",
                                fontWeight: 600,
                                background: isUnavailable ? "#fee2e2" : "#dcfce7",
                                color: isUnavailable ? "#b91c1c" : "#15803d",
                              }}
                            >
                              {isUnavailable ? m.availability.status.toUpperCase() : "Available"}
                            </span>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>

              {/* Role filter */}
              <select
                value={roleFilter}
                onChange={(e) => setRoleFilter(e.target.value)}
                style={{
                  padding: "8px 12px",
                  borderRadius: "8px",
                  border: "1px solid var(--line)",
                  fontSize: "0.85rem",
                  background: "var(--surface)",
                  color: "var(--ink)",
                }}
              >
                <option value="all">All Roles</option>
                <option value="site_supervisor">Site Supervisors</option>
                <option value="technician">Technicians</option>
                <option value="intern">Interns</option>
              </select>

              {/* Availability filter */}
              <select
                value={availabilityFilter}
                onChange={(e) => setAvailabilityFilter(e.target.value)}
                style={{
                  padding: "8px 12px",
                  borderRadius: "8px",
                  border: "1px solid var(--line)",
                  fontSize: "0.85rem",
                  background: "var(--surface)",
                  color: "var(--ink)",
                }}
              >
                <option value="all">All Status</option>
                <option value="available">🟢 Available Only</option>
                <option value="mc">🔴 On MC Only</option>
                <option value="leave">🟡 On Leave Only</option>
              </select>

              {/* Expertise filter */}
              <select
                value={expertiseFilter}
                onChange={(e) => setExpertiseFilter(e.target.value)}
                style={{
                  padding: "8px 12px",
                  borderRadius: "8px",
                  border: "1px solid var(--line)",
                  fontSize: "0.85rem",
                  background: "var(--surface)",
                  color: "var(--ink)",
                  maxWidth: "200px",
                }}
              >
                <option value="all">All Expertise</option>
                {EXPERTISE_OPTIONS.map((opt) => (
                  <option key={opt} value={opt}>
                    {opt}
                  </option>
                ))}
              </select>
            </div>

            <div style={{ display: "flex", alignItems: "center", gap: "12px", flexWrap: "wrap" }}>
              <div style={{ fontSize: "0.85rem", color: "var(--muted)", fontWeight: 500 }}>
                Showing {filteredMembers.length} of {members.length} team members (Arranged Installation Roster)
              </div>
              {!readOnly && (
                <button
                  type="button"
                  onClick={() => {
                    setEditingMember(null);
                    setIsMemberModalOpen(true);
                  }}
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    gap: "6px",
                    padding: "6px 12px",
                    borderRadius: "6px",
                    background: "var(--ink)",
                    color: "var(--surface)",
                    border: "none",
                    fontSize: "0.82rem",
                    fontWeight: 600,
                    cursor: "pointer",
                  }}
                >
                  <UserPlus size={15} />
                  Add Member
                </button>
              )}
            </div>
          </div>

          {/* Members Table */}
          <div
            className="table-wrap rti-team"
            style={{
              background: "var(--surface)",
              borderRadius: "12px",
              border: "1px solid var(--line)",
              boxShadow: "var(--shadow)",
              overflow: "hidden",
            }}
          >
            <div style={{ overflowX: "auto" }}>
              <table className="deposit-schedule-table" style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.85rem" }}>
                <thead>
                  <tr style={{ background: "var(--surface-soft)", borderBottom: "1px solid var(--line)", textAlign: "left" }}>
                    <th style={{ padding: "12px 16px", fontWeight: 700, color: "#000000", minWidth: "200px" }}>Name</th>
                    <th style={{ padding: "12px 16px", fontWeight: 700, color: "#000000", minWidth: "160px" }}>Role</th>
                    <th style={{ padding: "12px 16px", fontWeight: 700, color: "#000000", minWidth: "160px" }}>Contact</th>
                    <th style={{ padding: "12px 16px", fontWeight: 700, color: "#000000", minWidth: "280px" }}>Expertise / Skills</th>
                    <th style={{ padding: "12px 16px", fontWeight: 700, color: "#000000", width: "90px", textAlign: "right" }}>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredMembers.length === 0 ? (
                    <tr>
                      <td colSpan={5} style={{ padding: "32px 16px", textAlign: "center", color: "var(--muted)" }}>
                        No team members found matching the selected filters.
                      </td>
                    </tr>
                  ) : (
                    filteredMembers.map((member) => {
                      return (
                        <tr
                          key={member.id}
                          style={{
                            borderBottom: "1px solid var(--line)",
                          }}
                        >
                          {/* Name */}
                          <td className="team-edit-cell" style={{ padding: "8px 12px" }}>
                            <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                              {member.role === "site_supervisor" && <HardHat size={16} style={{ color: "#2563eb", flexShrink: 0 }} />}
                              {member.role === "technician" && <Wrench size={16} style={{ color: "#059669", flexShrink: 0 }} />}
                              {member.role === "intern" && <GraduationCap size={16} style={{ color: "#9333ea", flexShrink: 0 }} />}
                              <input
                                type="text"
                                className="team-cell-input"
                                value={member.name}
                                onChange={(e) => handleInlineUpdateMember(member.id, "name", e.target.value)}
                                placeholder="Member name..."
                                style={{
                                  fontSize: "0.88rem",
                                  fontWeight: 600,
                                }}
                              />
                            </div>
                          </td>

                          {/* Role */}
                          <td className="team-edit-cell" style={{ padding: "8px 12px" }}>
                            <select
                              className="team-cell-select"
                              value={member.role}
                              onChange={(e) => handleInlineUpdateMember(member.id, "role", e.target.value as ProjectTeamMemberRole)}
                              style={{
                                fontSize: "0.82rem",
                                fontWeight: 600,
                                color:
                                  member.role === "site_supervisor"
                                    ? "#1d4ed8"
                                    : member.role === "technician"
                                    ? "#15803d"
                                    : "#7c3aed",
                              }}
                            >
                              <option value="site_supervisor">👷 Site Supervisor</option>
                              <option value="technician">🔧 Technician</option>
                              <option value="intern">🎓 Intern</option>
                            </select>
                          </td>

                          {/* Contact */}
                          <td className="team-edit-cell" style={{ padding: "8px 12px" }}>
                            <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                              <Phone size={13} style={{ color: "var(--muted)", flexShrink: 0 }} />
                              <input
                                type="text"
                                className="team-cell-input"
                                value={member.phone || ""}
                                placeholder="Phone number..."
                                onChange={(e) => handleInlineUpdateMember(member.id, "phone", e.target.value)}
                                style={{
                                  fontSize: "0.84rem",
                                }}
                              />
                            </div>
                          </td>

                          {/* Expertise / Skills */}
                          <td className="team-edit-cell" style={{ padding: "8px 12px" }}>
                            <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: "5px" }}>
                              {member.expertise.map((exp, eidx) => (
                                <span
                                  key={eidx}
                                  style={{
                                    fontSize: "0.74rem",
                                    padding: "3px 8px",
                                    borderRadius: "6px",
                                    background: "#f1f5f9",
                                    color: "#1e293b",
                                    border: "1px solid #cbd5e1",
                                    fontWeight: 500,
                                    display: "inline-flex",
                                    alignItems: "center",
                                    gap: "4px",
                                  }}
                                >
                                  <span>{exp}</span>
                                  <button
                                    type="button"
                                    onClick={() => {
                                      const next = member.expertise.filter((_, i) => i !== eidx);
                                      handleInlineUpdateMember(member.id, "expertise", next);
                                    }}
                                    title={`Remove ${exp}`}
                                    style={{
                                      background: "transparent",
                                      border: "none",
                                      color: "#64748b",
                                      cursor: "pointer",
                                      padding: "0 2px",
                                      fontSize: "0.85rem",
                                      fontWeight: 700,
                                      lineHeight: 1,
                                    }}
                                  >
                                    ×
                                  </button>
                                </span>
                              ))}
                              <select
                                value=""
                                onChange={(e) => {
                                  const chosen = e.target.value;
                                  if (chosen && !member.expertise.includes(chosen)) {
                                    handleInlineUpdateMember(member.id, "expertise", [...member.expertise, chosen]);
                                  }
                                }}
                                className="team-cell-select"
                                style={{
                                  fontSize: "0.74rem",
                                  padding: "3px 8px",
                                  borderRadius: "6px",
                                  color: "var(--muted)",
                                  width: "auto",
                                  minWidth: "110px",
                                }}
                              >
                                <option value="">+ Add Skill</option>
                                {EXPERTISE_OPTIONS.filter((opt) => !member.expertise.includes(opt)).map((opt) => (
                                  <option key={opt} value={opt}>
                                    {opt}
                                  </option>
                                ))}
                              </select>
                            </div>
                          </td>

                          {/* Actions */}
                          <td className="team-edit-cell" style={{ padding: "8px 12px", textAlign: "right", whiteSpace: "nowrap" }}>
                            <button
                              type="button"
                              onClick={() => handleDeleteMember(member.id)}
                              title="Delete Member"
                              style={{
                                background: "var(--surface)",
                                border: "1px solid #fecaca",
                                padding: "5px 10px",
                                borderRadius: "6px",
                                cursor: "pointer",
                                color: "#dc2626",
                                fontSize: "0.76rem",
                                fontWeight: 600,
                                display: "inline-flex",
                                alignItems: "center",
                                gap: "4px",
                              }}
                            >
                              <Trash2 size={13} />
                              Delete
                            </button>
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* TAB 3: CAR & FLEET MANAGEMENT */}
      {visitedTabs.has("cars") && (
        <div style={{ display: activeTab === "cars" ? "flex" : "none", flexDirection: "column", gap: "16px" }}>
          {/* Top KPI mini cards for Fleet */}
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))",
              gap: "12px",
            }}
          >
            <div
              style={{
                background: "var(--surface)",
                padding: "14px 18px",
                borderRadius: "10px",
                border: "1px solid var(--line)",
                boxShadow: "var(--shadow)",
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
              }}
            >
              <div>
                <div style={{ fontSize: "0.8rem", color: "var(--muted)", fontWeight: 500 }}>Total Fleet</div>
                <div style={{ fontSize: "1.45rem", fontWeight: 700, color: "var(--ink)" }}>{carStats.total}</div>
                <div style={{ fontSize: "0.74rem", color: "var(--muted)", marginTop: "2px" }}>
                  Registered vehicles
                </div>
              </div>
              <div style={{ background: "#eff6ff", padding: "10px", borderRadius: "10px", color: "#2563eb" }}>
                <Car size={20} />
              </div>
            </div>

            <div
              style={{
                background: "var(--surface)",
                padding: "14px 18px",
                borderRadius: "10px",
                border: "1px solid var(--line)",
                boxShadow: "var(--shadow)",
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
              }}
            >
              <div>
                <div style={{ fontSize: "0.8rem", color: "var(--muted)", fontWeight: 500 }}>Available Cars</div>
                <div style={{ fontSize: "1.45rem", fontWeight: 700, color: "#16a34a" }}>{carStats.availableCount}</div>
                <div style={{ fontSize: "0.74rem", color: "#16a34a", marginTop: "2px", fontWeight: 600 }}>
                  Ready to deploy
                </div>
              </div>
              <div style={{ background: "#dcfce7", padding: "10px", borderRadius: "10px", color: "#16a34a" }}>
                <CheckCircle2 size={20} />
              </div>
            </div>

            <div
              style={{
                background: "var(--surface)",
                padding: "14px 18px",
                borderRadius: "10px",
                border: "1px solid var(--line)",
                boxShadow: "var(--shadow)",
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
              }}
            >
              <div>
                <div style={{ fontSize: "0.8rem", color: "var(--muted)", fontWeight: 500 }}>In Use / Assigned</div>
                <div style={{ fontSize: "1.45rem", fontWeight: 700, color: "#2563eb" }}>{carStats.inUseCount}</div>
                <div style={{ fontSize: "0.74rem", color: "#2563eb", marginTop: "2px" }}>
                  Assigned to teams
                </div>
              </div>
              <div style={{ background: "#dbeafe", padding: "10px", borderRadius: "10px", color: "#2563eb" }}>
                <Shield size={20} />
              </div>
            </div>

            <div
              style={{
                background: "var(--surface)",
                padding: "14px 18px",
                borderRadius: "10px",
                border: "1px solid var(--line)",
                boxShadow: "var(--shadow)",
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
              }}
            >
              <div>
                <div style={{ fontSize: "0.8rem", color: "var(--muted)", fontWeight: 500 }}>In Maintenance</div>
                <div style={{ fontSize: "1.45rem", fontWeight: 700, color: "#dc2626" }}>{carStats.maintenanceCount}</div>
                <div style={{ fontSize: "0.74rem", color: "#dc2626", marginTop: "2px" }}>
                  {carStats.maintenanceCount > 0 ? "Workshop / Service" : "All roadworthy"}
                </div>
              </div>
              <div style={{ background: "#fee2e2", padding: "10px", borderRadius: "10px", color: "#dc2626" }}>
                <Wrench size={20} />
              </div>
            </div>
          </div>

          {/* Vehicle Suitability Guide */}
          <div
            style={{
              background: "#eff6ff",
              border: "1px solid #bfdbfe",
              borderRadius: "10px",
              padding: "12px 18px",
              display: "flex",
              flexDirection: "column",
              gap: "6px",
            }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
              <Info size={16} style={{ color: "#2563eb" }} />
              <strong style={{ fontSize: "0.88rem", color: "#1e40af" }}>
                Solar Installation Vehicle Suitability Guide
              </strong>
            </div>
            <p style={{ margin: 0, fontSize: "0.8rem", color: "#1e3a8a", lineHeight: 1.5 }}>
              • <strong>4x4 Pickups (Hilux / D-Max / Ranger)</strong>: Best for carrying 12–24 solar panels on roof racks, mounting rails, and reaching estate / rural off-road sites.<br />
              • <strong>Cargo Vans (Hiace)</strong>: Weatherproof dry cargo space, ideal for transporting sensitive Deye/Huawei inverters, battery storage (BESS) units, and AC/DC testing instruments.<br />
              • <strong>1-Ton Skylift Truck (14m)</strong>: Essential for high-rise commercial buildings, 3-storey shophouses, and high roof eaves without scaffolding.
            </p>
          </div>

          {/* Filter Toolbar */}
          <div
            style={{
              background: "var(--surface)",
              padding: "14px 18px",
              borderRadius: "10px",
              border: "1px solid var(--line)",
              display: "flex",
              flexWrap: "wrap",
              alignItems: "center",
              justifyContent: "space-between",
              gap: "12px",
            }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: "10px", flex: 1, minWidth: "260px", flexWrap: "wrap" }}>
              <div style={{ position: "relative", width: "100%", maxWidth: "260px" }}>
                <Search size={16} style={{ position: "absolute", left: "10px", top: "10px", color: "var(--muted)" }} />
                <input
                  type="text"
                  placeholder="Search plate, model, location..."
                  value={carSearchQuery}
                  onChange={(e) => setCarSearchQuery(e.target.value)}
                  style={{
                    width: "100%",
                    padding: "8px 12px 8px 32px",
                    borderRadius: "8px",
                    border: "1px solid var(--line)",
                    fontSize: "0.85rem",
                    background: "var(--bg)",
                    color: "var(--ink)",
                  }}
                />
              </div>

              {/* Type filter */}
              <select
                value={carTypeFilter}
                onChange={(e) => setCarTypeFilter(e.target.value)}
                style={{
                  padding: "8px 12px",
                  borderRadius: "8px",
                  border: "1px solid var(--line)",
                  fontSize: "0.85rem",
                  background: "var(--surface)",
                  color: "var(--ink)",
                }}
              >
                <option value="all">All Vehicle Types</option>
                <option value="4x4_pickup">4x4 Pickup</option>
                <option value="van">Cargo Van</option>
                <option value="sedan_mpv">Sedan / MPV / Car</option>
                <option value="lorry">Lorry Truck</option>
                <option value="skylift">Skylift Boom</option>
              </select>

              {/* Availability filter */}
              <select
                value={carStatusFilter}
                onChange={(e) => setCarStatusFilter(e.target.value)}
                style={{
                  padding: "8px 12px",
                  borderRadius: "8px",
                  border: "1px solid var(--line)",
                  fontSize: "0.85rem",
                  background: "var(--surface)",
                  color: "var(--ink)",
                }}
              >
                <option value="all">All Availability</option>
                <option value="available">🟢 Available Only</option>
                <option value="in_use">🔵 In Use Only</option>
                <option value="maintenance">🔴 In Maintenance Only</option>
              </select>

              {/* Suitability filter */}
              <select
                value={carSuitabilityFilter}
                onChange={(e) => setCarSuitabilityFilter(e.target.value)}
                style={{
                  padding: "8px 12px",
                  borderRadius: "8px",
                  border: "1px solid var(--line)",
                  fontSize: "0.85rem",
                  background: "var(--surface)",
                  color: "var(--ink)",
                  maxWidth: "200px",
                }}
              >
                <option value="all">All Suitability</option>
                {VEHICLE_SUITABILITY_OPTIONS.map((opt) => (
                  <option key={opt} value={opt}>
                    {opt}
                  </option>
                ))}
              </select>
            </div>

            <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
              <span style={{ fontSize: "0.82rem", color: "var(--muted)", fontWeight: 500 }}>
                Showing {filteredCars.length} of {cars.length} cars
              </span>
              {!readOnly && (
                <button
                  type="button"
                  onClick={() => {
                    setEditingCar(null);
                    setIsCarModalOpen(true);
                  }}
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    gap: "6px",
                    padding: "8px 14px",
                    borderRadius: "8px",
                    border: "none",
                    background: "#2563eb",
                    color: "#ffffff",
                    fontSize: "0.85rem",
                    fontWeight: 600,
                    cursor: "pointer",
                  }}
                >
                  <Plus size={15} />
                  Add Vehicle
                </button>
              )}
            </div>
          </div>

          {/* Cars Table */}
          <div
            className="table-wrap rti-team"
            style={{
              background: "var(--surface)",
              borderRadius: "12px",
              border: "1px solid var(--line)",
              boxShadow: "var(--shadow)",
              overflow: "hidden",
            }}
          >
            <div style={{ overflowX: "auto" }}>
              <table className="deposit-schedule-table" style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.85rem" }}>
                <thead>
                  <tr style={{ background: "var(--surface-soft)", borderBottom: "1px solid var(--line)", textAlign: "left" }}>
                    <th style={{ padding: "12px 16px", fontWeight: 700, color: "#000000", minWidth: "220px" }}>Plate & Vehicle Model</th>
                    <th style={{ padding: "12px 16px", fontWeight: 700, color: "#000000", minWidth: "170px" }}>Type & Status</th>
                    <th style={{ padding: "12px 16px", fontWeight: 700, color: "#000000", minWidth: "280px" }}>Suitable Installation Work</th>
                    <th style={{ padding: "12px 16px", fontWeight: 700, color: "#000000", minWidth: "160px" }}>Road Tax</th>
                    <th style={{ padding: "12px 16px", fontWeight: 700, color: "#000000", width: "90px", textAlign: "right" }}>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredCars.length === 0 ? (
                    <tr>
                      <td colSpan={5} style={{ padding: "36px 16px", textAlign: "center", color: "var(--muted)" }}>
                        {cars.length === 0 ? (
                          <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: "8px" }}>
                            <Car size={32} style={{ color: "var(--line)" }} />
                            <span style={{ fontSize: "0.92rem", fontWeight: 600, color: "var(--ink)" }}>No vehicles registered yet</span>
                            <span style={{ fontSize: "0.8rem", color: "var(--muted)" }}>Click &quot;+ Add Vehicle&quot; above to register your fleet transport.</span>
                          </div>
                        ) : (
                          "No vehicles found matching the selected filters."
                        )}
                      </td>
                    </tr>
                  ) : (
                    filteredCars.map((car) => {
                      const isMaintenance = car.status === "maintenance";

                      return (
                        <tr
                          key={car.id}
                          style={{
                            borderBottom: "1px solid var(--line)",
                            background: isMaintenance ? "rgba(254, 242, 242, 0.4)" : "transparent",
                          }}
                        >
                          {/* Plate & Vehicle Model */}
                          <td className="team-edit-cell" style={{ padding: "8px 12px" }}>
                            <div style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
                              <input
                                type="text"
                                className="team-cell-input"
                                value={car.plateNumber}
                                onChange={(e) => handleInlineUpdateCar(car.id, "plateNumber", e.target.value.toUpperCase())}
                                placeholder="Plate (e.g. JXX 4488)"
                                style={{
                                  fontFamily: "monospace",
                                  fontWeight: 700,
                                  letterSpacing: "0.06em",
                                  textTransform: "uppercase",
                                  fontSize: "0.88rem",
                                }}
                              />
                              <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                                <Car size={14} style={{ color: "var(--muted)", flexShrink: 0, marginLeft: "4px" }} />
                                <input
                                  type="text"
                                  className="team-cell-input"
                                  value={car.model}
                                  onChange={(e) => handleInlineUpdateCar(car.id, "model", e.target.value)}
                                  placeholder="Vehicle model (e.g. Toyota Hilux)"
                                  style={{
                                    fontSize: "0.84rem",
                                    fontWeight: 500,
                                  }}
                                />
                              </div>
                            </div>
                          </td>

                          {/* Type & Status */}
                          <td className="team-edit-cell" style={{ padding: "8px 12px" }}>
                            <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
                              <select
                                className="team-cell-select"
                                value={car.type}
                                onChange={(e) => handleInlineUpdateCar(car.id, "type", e.target.value as VehicleType)}
                                style={{ fontWeight: 600, fontSize: "0.8rem" }}
                              >
                                <option value="4x4_pickup">🛻 4x4 Pickup</option>
                                <option value="van">🚐 Cargo Van</option>
                                <option value="sedan_mpv">🚗 Sedan / MPV</option>
                                <option value="lorry">🚚 Lorry Truck</option>
                                <option value="skylift">🏗️ Skylift Boom</option>
                              </select>
                              <select
                                className="team-cell-select"
                                value={car.status}
                                onChange={(e) => handleInlineUpdateCar(car.id, "status", e.target.value as VehicleAvailabilityStatus)}
                                style={{
                                  fontWeight: 600,
                                  fontSize: "0.8rem",
                                  color:
                                    car.status === "available"
                                      ? "#15803d"
                                      : car.status === "in_use"
                                      ? "#1d4ed8"
                                      : "#b91c1c",
                                }}
                              >
                                <option value="available">🟢 Available</option>
                                <option value="in_use">🔵 In Use</option>
                                <option value="maintenance">🔴 In Maintenance</option>
                              </select>
                            </div>
                          </td>

                          {/* Suitable Installation Work */}
                          <td className="team-edit-cell" style={{ padding: "8px 12px" }}>
                            <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: "5px" }}>
                              {car.suitability.map((suit, sidx) => (
                                <span
                                  key={sidx}
                                  style={{
                                    fontSize: "0.74rem",
                                    padding: "3px 8px",
                                    borderRadius: "6px",
                                    background: "#f8fafc",
                                    color: "#1e293b",
                                    border: "1px solid #cbd5e1",
                                    fontWeight: 500,
                                    display: "inline-flex",
                                    alignItems: "center",
                                    gap: "4px",
                                  }}
                                >
                                  <span>
                                    {suit.includes("Panel")
                                      ? "📦"
                                      : suit.includes("Inverter") || suit.includes("Battery")
                                      ? "🔋"
                                      : suit.includes("Skylift") || suit.includes("High-Rise")
                                      ? "🏗️"
                                      : suit.includes("4WD")
                                      ? "🛣️"
                                      : suit.includes("Wiring")
                                      ? "⚡"
                                      : "🔧"}{" "}
                                    {suit}
                                  </span>
                                  <button
                                    type="button"
                                    onClick={() => {
                                      const next = car.suitability.filter((_, i) => i !== sidx);
                                      handleInlineUpdateCar(car.id, "suitability", next);
                                    }}
                                    title={`Remove ${suit}`}
                                    style={{
                                      background: "transparent",
                                      border: "none",
                                      color: "#64748b",
                                      cursor: "pointer",
                                      padding: "0 2px",
                                      fontSize: "0.85rem",
                                      fontWeight: 700,
                                      lineHeight: 1,
                                    }}
                                  >
                                    ×
                                  </button>
                                </span>
                              ))}
                              <select
                                value=""
                                onChange={(e) => {
                                  const chosen = e.target.value as VehicleSuitabilityOption;
                                  if (chosen && !car.suitability.includes(chosen)) {
                                    handleInlineUpdateCar(car.id, "suitability", [...car.suitability, chosen]);
                                  }
                                }}
                                className="team-cell-select"
                                style={{
                                  fontSize: "0.74rem",
                                  padding: "3px 8px",
                                  borderRadius: "6px",
                                  color: "var(--muted)",
                                  width: "auto",
                                  minWidth: "125px",
                                }}
                              >
                                <option value="">+ Add Work</option>
                                {VEHICLE_SUITABILITY_OPTIONS.filter((opt) => !car.suitability.includes(opt)).map((opt) => (
                                  <option key={opt} value={opt}>
                                    {opt}
                                  </option>
                                ))}
                              </select>
                            </div>
                          </td>

                          {/* Road Tax Expiry */}
                          <td className="team-edit-cell" style={{ padding: "8px 12px" }}>
                            <div style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
                              <input
                                type="date"
                                className="team-cell-input"
                                value={car.roadTaxExpiry || ""}
                                onChange={(e) => handleInlineUpdateCar(car.id, "roadTaxExpiry", e.target.value)}
                                style={{
                                  padding: "6px 8px",
                                  fontSize: "0.82rem",
                                  fontWeight: 600,
                                  color: car.roadTaxExpiry && car.roadTaxExpiry < todayIso ? "#dc2626" : "var(--ink)",
                                }}
                              />
                              {car.roadTaxExpiry && car.roadTaxExpiry < todayIso && (
                                <span style={{ fontSize: "0.7rem", color: "#dc2626", fontWeight: 700, display: "inline-flex", alignItems: "center", gap: "3px" }}>
                                  ⚠️ Expired Road Tax
                                </span>
                              )}
                            </div>
                          </td>

                          {/* Actions */}
                          <td className="team-edit-cell" style={{ padding: "8px 12px", textAlign: "right", whiteSpace: "nowrap" }}>
                            <button
                              type="button"
                              onClick={() => handleDeleteCar(car.id)}
                              title="Delete Vehicle"
                              style={{
                                background: "var(--surface)",
                                border: "1px solid #fecaca",
                                padding: "5px 10px",
                                borderRadius: "6px",
                                cursor: "pointer",
                                color: "#dc2626",
                                display: "inline-flex",
                                alignItems: "center",
                                gap: "4px",
                                fontSize: "0.76rem",
                                fontWeight: 600,
                              }}
                            >
                              <Trash2 size={13} />
                              Delete
                            </button>
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* TAB 4: AVAILABILITY & MC / LEAVE CALENDAR */}
      {visitedTabs.has("availability") && (
        <div style={{ display: activeTab === "availability" ? "flex" : "none", flexDirection: "column", gap: "16px" }}>
          <div
            style={{
              background: "var(--surface)",
              borderRadius: "12px",
              border: "1px solid var(--line)",
              padding: "16px 20px",
              boxShadow: "var(--shadow)",
            }}
          >
            <h3 style={{ margin: "0 0 12px 0", fontSize: "1.05rem", fontWeight: 700, color: "var(--ink)", display: "flex", alignItems: "center", gap: "8px" }}>
              <Calendar size={18} style={{ color: "#2563eb" }} />
              Live Absence & Leave Log (Week {weekRangeLabel(activeWeek)})
            </h3>
            <p style={{ margin: "0 0 16px 0", fontSize: "0.85rem", color: "var(--muted)" }}>
              All project team members on Medical Certificate (MC) or Leave. Notice that personnel unavailable during Week {weekRangeLabel(activeWeek)} are flagged so schedulers do not book installation jobs with absent crew members.
            </p>

            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(320px, 1fr))", gap: "14px" }}>
              {members
                .filter((m) => m.availability.status !== "available")
                .map((m) => {
                  const isMC = m.availability.status === "mc";
                  const isAwayInActiveWeek = isMemberUnavailableInWeek(m, activeWeek);
                  const assignedCrew = currentWeekCrews.find(
                    (c) =>
                      c.supervisorId === m.id ||
                      c.technicianIds.includes(m.id) ||
                      c.internIds.includes(m.id)
                  );

                  return (
                    <div
                      key={m.id}
                      style={{
                        padding: "14px 16px",
                        borderRadius: "10px",
                        border: "1px solid",
                        borderColor: isMC ? "#fca5a5" : "#fde68a",
                        background: isMC ? "#fff5f5" : "#fffbeb",
                        display: "flex",
                        flexDirection: "column",
                        gap: "8px",
                      }}
                    >
                      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                        <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                          {isMC ? (
                            <ShieldAlert size={18} style={{ color: "#dc2626" }} />
                          ) : (
                            <Clock size={18} style={{ color: "#d97706" }} />
                          )}
                          <strong style={{ fontSize: "0.95rem", color: "var(--ink)" }}>{m.name}</strong>
                          <span
                            style={{
                              fontSize: "0.72rem",
                              padding: "2px 6px",
                              borderRadius: "4px",
                              fontWeight: 700,
                              background: isMC ? "#fee2e2" : "#fef3c7",
                              color: isMC ? "#991b1b" : "#92400e",
                            }}
                          >
                            {isMC ? "MEDICAL CERTIFICATE" : "ON LEAVE"}
                          </span>
                        </div>

                        {!readOnly && (
                          <button
                            onClick={() => handleOpenQuickAvailability(m)}
                            style={{
                              fontSize: "0.75rem",
                              padding: "3px 8px",
                              borderRadius: "6px",
                              border: "1px solid var(--line)",
                              background: "var(--surface)",
                              cursor: "pointer",
                            }}
                          >
                            Update
                          </button>
                        )}
                      </div>

                      <div style={{ fontSize: "0.82rem", color: "var(--ink)" }}>
                        <strong>Reason:</strong> {m.availability.reason || "Not specified"}
                      </div>

                      <div style={{ fontSize: "0.8rem", color: "var(--muted)", display: "flex", alignItems: "center", gap: "6px" }}>
                        <Calendar size={13} />
                        Period: {m.availability.startDate || todayIso} to {m.availability.endDate || todayIso}
                      </div>

                      <div style={{ fontSize: "0.76rem", fontWeight: 600, color: isAwayInActiveWeek ? "#b91c1c" : "#15803d" }}>
                        {isAwayInActiveWeek
                          ? `⚠️ Affects scheduled Week ${weekRangeLabel(activeWeek)}`
                          : `✓ Available for scheduled Week ${weekRangeLabel(activeWeek)}`}
                      </div>

                      {assignedCrew && isAwayInActiveWeek && (
                        <div
                          style={{
                            marginTop: "4px",
                            padding: "6px 10px",
                            background: "var(--surface)",
                            borderRadius: "6px",
                            border: "1px solid var(--line)",
                            fontSize: "0.78rem",
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "space-between",
                          }}
                        >
                          <span>Assigned to: <strong>{assignedCrew.name}</strong></span>
                          <span style={{ color: "#dc2626", fontWeight: 600 }}>Needs Replacement</span>
                        </div>
                      )}
                    </div>
                  );
                })}

              {members.filter((m) => m.availability.status !== "available").length === 0 && (
                <div style={{ padding: "20px", textAlign: "center", color: "#16a34a", fontSize: "0.9rem", fontWeight: 600 }}>
                  ✓ All project team members are currently Available and ready for installation schedule!
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* MODAL: ADD / EDIT MEMBER */}
      {isMemberModalOpen && (
        <div
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(0, 0, 0, 0.5)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            zIndex: 9999,
            padding: "20px",
          }}
        >
          <div
            style={{
              background: "var(--surface)",
              borderRadius: "14px",
              padding: "24px",
              width: "100%",
              maxWidth: "520px",
              boxShadow: "0 20px 25px -5px rgba(0, 0, 0, 0.2)",
              display: "flex",
              flexDirection: "column",
              gap: "16px",
            }}
          >
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
              <h3 style={{ margin: 0, fontSize: "1.15rem", fontWeight: 700, color: "var(--ink)" }}>
                {editingMember ? "Edit Project Team Member" : "Add Project Team Member"}
              </h3>
              <button
                onClick={() => setIsMemberModalOpen(false)}
                style={{ background: "transparent", border: "none", color: "var(--muted)", cursor: "pointer" }}
              >
                <X size={20} />
              </button>
            </div>

            <form
              onSubmit={(e) => {
                e.preventDefault();
                const form = e.currentTarget;
                const name = (form.elements.namedItem("name") as HTMLInputElement).value.trim();
                const role = (form.elements.namedItem("role") as HTMLSelectElement).value as ProjectTeamMemberRole;
                const phone = (form.elements.namedItem("phone") as HTMLInputElement).value.trim();
                const notes = (form.elements.namedItem("notes") as HTMLTextAreaElement).value.trim();
                const status = (form.elements.namedItem("status") as HTMLSelectElement).value as MemberAvailabilityStatus;
                const reason = (form.elements.namedItem("reason") as HTMLInputElement).value.trim();

                const checkedSkills: string[] = [];
                EXPERTISE_OPTIONS.forEach((opt) => {
                  const cb = form.elements.namedItem(`exp_${opt}`) as HTMLInputElement;
                  if (cb && cb.checked) checkedSkills.push(opt);
                });

                if (!name) return;

                if (editingMember) {
                  setMembers((prev) =>
                    prev.map((m) => {
                      if (m.id !== editingMember.id) return m;
                      return {
                        ...m,
                        name,
                        role,
                        phone,
                        notes,
                        expertise: checkedSkills,
                        availability: {
                          status,
                          reason: status !== "available" ? reason : undefined,
                        },
                      };
                    })
                  );
                } else {
                  const newMember: ProjectTeamMember = {
                    id: `mem-${Date.now()}`,
                    name,
                    role,
                    phone,
                    notes,
                    expertise: checkedSkills,
                    availability: {
                      status,
                      reason: status !== "available" ? reason : undefined,
                    },
                    assignedCrewId: null,
                  };
                  setMembers((prev) => [...prev, newMember]);
                }

                setIsMemberModalOpen(false);
              }}
              style={{ display: "flex", flexDirection: "column", gap: "14px" }}
            >
              <div>
                <label style={{ fontSize: "0.82rem", fontWeight: 600, color: "var(--ink)", display: "block", marginBottom: "4px" }}>
                  Full Name *
                </label>
                <input
                  name="name"
                  defaultValue={editingMember?.name || ""}
                  required
                  placeholder="e.g. Kaijie, Muhammad Amir"
                  style={{
                    width: "100%",
                    padding: "8px 12px",
                    borderRadius: "8px",
                    border: "1px solid var(--line)",
                    fontSize: "0.85rem",
                    background: "var(--bg)",
                    color: "var(--ink)",
                  }}
                />
              </div>

              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "12px" }}>
                <div>
                  <label style={{ fontSize: "0.82rem", fontWeight: 600, color: "var(--ink)", display: "block", marginBottom: "4px" }}>
                    Project Role *
                  </label>
                  <select
                    name="role"
                    defaultValue={editingMember?.role || "technician"}
                    style={{
                      width: "100%",
                      padding: "8px 12px",
                      borderRadius: "8px",
                      border: "1px solid var(--line)",
                      fontSize: "0.85rem",
                      background: "var(--surface)",
                      color: "var(--ink)",
                    }}
                  >
                    <option value="site_supervisor">Site Supervisor</option>
                    <option value="technician">Technician</option>
                    <option value="intern">Intern</option>
                  </select>
                </div>

                <div>
                  <label style={{ fontSize: "0.82rem", fontWeight: 600, color: "var(--ink)", display: "block", marginBottom: "4px" }}>
                    Contact Phone *
                  </label>
                  <input
                    name="phone"
                    defaultValue={editingMember?.phone || ""}
                    required
                    placeholder="012-345 6789"
                    style={{
                      width: "100%",
                      padding: "8px 12px",
                      borderRadius: "8px",
                      border: "1px solid var(--line)",
                      fontSize: "0.85rem",
                      background: "var(--bg)",
                      color: "var(--ink)",
                    }}
                  />
                </div>
              </div>

              {/* Expertise selection */}
              <div>
                <label style={{ fontSize: "0.82rem", fontWeight: 600, color: "var(--ink)", display: "block", marginBottom: "6px" }}>
                  Expertise & Skills
                </label>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "6px" }}>
                  {EXPERTISE_OPTIONS.map((opt) => {
                    const isChecked = editingMember?.expertise.includes(opt);
                    return (
                      <label key={opt} style={{ display: "flex", alignItems: "center", gap: "6px", fontSize: "0.78rem", color: "var(--ink)", cursor: "pointer" }}>
                        <input
                          type="checkbox"
                          name={`exp_${opt}`}
                          defaultChecked={isChecked}
                        />
                        {opt}
                      </label>
                    );
                  })}
                </div>
              </div>

              {/* Availability */}
              <div style={{ display: "grid", gridTemplateColumns: "1fr 2fr", gap: "10px" }}>
                <div>
                  <label style={{ fontSize: "0.82rem", fontWeight: 600, color: "var(--ink)", display: "block", marginBottom: "4px" }}>
                    Availability Status
                  </label>
                  <select
                    name="status"
                    defaultValue={editingMember?.availability.status || "available"}
                    style={{
                      width: "100%",
                      padding: "8px 10px",
                      borderRadius: "8px",
                      border: "1px solid var(--line)",
                      fontSize: "0.85rem",
                      background: "var(--surface)",
                      color: "var(--ink)",
                    }}
                  >
                    <option value="available">🟢 Available</option>
                    <option value="mc">🔴 On MC</option>
                    <option value="leave">🟡 On Leave</option>
                  </select>
                </div>

                <div>
                  <label style={{ fontSize: "0.82rem", fontWeight: 600, color: "var(--ink)", display: "block", marginBottom: "4px" }}>
                    Reason / Clinic Note (if MC or Leave)
                  </label>
                  <input
                    name="reason"
                    defaultValue={editingMember?.availability.reason || ""}
                    placeholder="e.g. Fever (Poliklinik Penawar)"
                    style={{
                      width: "100%",
                      padding: "8px 10px",
                      borderRadius: "8px",
                      border: "1px solid var(--line)",
                      fontSize: "0.85rem",
                      background: "var(--bg)",
                      color: "var(--ink)",
                    }}
                  />
                </div>
              </div>

              <div>
                <label style={{ fontSize: "0.82rem", fontWeight: 600, color: "var(--ink)", display: "block", marginBottom: "4px" }}>
                  Notes & Certifications
                </label>
                <textarea
                  name="notes"
                  defaultValue={editingMember?.notes || ""}
                  rows={2}
                  placeholder="e.g. Certified Wireman PW4, SEDA grid-connected installer"
                  style={{
                    width: "100%",
                    padding: "8px 12px",
                    borderRadius: "8px",
                    border: "1px solid var(--line)",
                    fontSize: "0.85rem",
                    background: "var(--bg)",
                    color: "var(--ink)",
                  }}
                />
              </div>

              <div style={{ display: "flex", justifyContent: "flex-end", gap: "10px", marginTop: "8px" }}>
                <button
                  type="button"
                  onClick={() => setIsMemberModalOpen(false)}
                  style={{
                    padding: "8px 16px",
                    borderRadius: "8px",
                    border: "1px solid var(--line)",
                    background: "transparent",
                    color: "var(--muted)",
                    fontSize: "0.85rem",
                    cursor: "pointer",
                  }}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  style={{
                    padding: "8px 18px",
                    borderRadius: "8px",
                    border: "none",
                    background: "#2563eb",
                    color: "#ffffff",
                    fontSize: "0.85rem",
                    fontWeight: 600,
                    cursor: "pointer",
                  }}
                >
                  {editingMember ? "Save Changes" : "Create Member"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* MODAL: CREATE / EDIT VEHICLE (CAR) */}
      {isCarModalOpen && (
        <div
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(0, 0, 0, 0.5)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            zIndex: 9999,
            padding: "20px",
          }}
        >
          <div
            style={{
              background: "var(--surface)",
              borderRadius: "14px",
              padding: "24px",
              width: "100%",
              maxWidth: "560px",
              maxHeight: "90vh",
              overflowY: "auto",
              boxShadow: "0 20px 25px -5px rgba(0, 0, 0, 0.2)",
              display: "flex",
              flexDirection: "column",
              gap: "16px",
            }}
          >
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
              <h3 style={{ margin: 0, fontSize: "1.15rem", fontWeight: 700, color: "var(--ink)", display: "flex", alignItems: "center", gap: "8px" }}>
                <Car size={20} style={{ color: "#2563eb" }} />
                {editingCar ? "Edit Vehicle Details" : "Register New Installation Vehicle"}
              </h3>
              <button
                type="button"
                onClick={() => setIsCarModalOpen(false)}
                style={{ background: "transparent", border: "none", color: "var(--muted)", cursor: "pointer" }}
              >
                <X size={20} />
              </button>
            </div>

            <form onSubmit={handleSaveCar} style={{ display: "flex", flexDirection: "column", gap: "14px" }}>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "12px" }}>
                <div>
                  <label style={{ fontSize: "0.82rem", fontWeight: 600, color: "var(--ink)", display: "block", marginBottom: "4px" }}>
                    Plate Number *
                  </label>
                  <input
                    name="plateNumber"
                    defaultValue={editingCar?.plateNumber || ""}
                    required
                    placeholder="e.g. JXX 4488"
                    style={{
                      width: "100%",
                      padding: "8px 12px",
                      borderRadius: "8px",
                      border: "1px solid var(--line)",
                      fontSize: "0.85rem",
                      background: "var(--bg)",
                      color: "var(--ink)",
                      textTransform: "uppercase",
                      fontWeight: 700,
                    }}
                  />
                </div>

                <div>
                  <label style={{ fontSize: "0.82rem", fontWeight: 600, color: "var(--ink)", display: "block", marginBottom: "4px" }}>
                    Vehicle Type *
                  </label>
                  <select
                    name="type"
                    defaultValue={editingCar?.type || "4x4_pickup"}
                    style={{
                      width: "100%",
                      padding: "8px 12px",
                      borderRadius: "8px",
                      border: "1px solid var(--line)",
                      fontSize: "0.85rem",
                      background: "var(--bg)",
                      color: "var(--ink)",
                    }}
                  >
                    <option value="4x4_pickup">4x4 Pickup (Hilux / D-Max / Ranger)</option>
                    <option value="van">Cargo Van (Hiace / Weatherproof)</option>
                    <option value="sedan_mpv">Sedan / MPV (Avanza / Alza / Myvi)</option>
                    <option value="lorry">1-Ton / 3-Ton Lorry Truck</option>
                    <option value="skylift">Skylift Boom Truck (14m Aerial)</option>
                  </select>
                </div>
              </div>

              <div>
                <label style={{ fontSize: "0.82rem", fontWeight: 600, color: "var(--ink)", display: "block", marginBottom: "4px" }}>
                  Vehicle Make & Model *
                </label>
                <input
                  name="model"
                  defaultValue={editingCar?.model || ""}
                  required
                  placeholder="e.g. Toyota Hilux Double Cab 2.4"
                  style={{
                    width: "100%",
                    padding: "8px 12px",
                    borderRadius: "8px",
                    border: "1px solid var(--line)",
                    fontSize: "0.85rem",
                    background: "var(--bg)",
                    color: "var(--ink)",
                  }}
                />
              </div>

              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "12px" }}>
                <div>
                  <label style={{ fontSize: "0.82rem", fontWeight: 600, color: "var(--ink)", display: "block", marginBottom: "4px" }}>
                    Operating Base Location
                  </label>
                  <input
                    name="baseLocation"
                    defaultValue={editingCar?.baseLocation || "Johor Bahru"}
                    placeholder="Johor Bahru, Kluang, Kulai, Muar..."
                    style={{
                      width: "100%",
                      padding: "8px 12px",
                      borderRadius: "8px",
                      border: "1px solid var(--line)",
                      fontSize: "0.85rem",
                      background: "var(--bg)",
                      color: "var(--ink)",
                    }}
                  />
                </div>

                <div>
                  <label style={{ fontSize: "0.82rem", fontWeight: 600, color: "var(--ink)", display: "block", marginBottom: "4px" }}>
                    Availability Status
                  </label>
                  <select
                    name="status"
                    defaultValue={editingCar?.status || "available"}
                    style={{
                      width: "100%",
                      padding: "8px 12px",
                      borderRadius: "8px",
                      border: "1px solid var(--line)",
                      fontSize: "0.85rem",
                      background: "var(--bg)",
                      color: "var(--ink)",
                    }}
                  >
                    <option value="available">🟢 Available for Deployment</option>
                    <option value="in_use">🔵 In Use (Assigned to Team)</option>
                    <option value="maintenance">🔴 In Maintenance / Workshop</option>
                  </select>
                </div>
              </div>

              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: "12px" }}>
                <div>
                  <label style={{ fontSize: "0.82rem", fontWeight: 600, color: "var(--ink)", display: "block", marginBottom: "4px" }}>
                    Pax Capacity
                  </label>
                  <input
                    type="number"
                    name="capacityPax"
                    defaultValue={editingCar?.capacityPax || 5}
                    min={1}
                    max={15}
                    style={{
                      width: "100%",
                      padding: "8px 12px",
                      borderRadius: "8px",
                      border: "1px solid var(--line)",
                      fontSize: "0.85rem",
                      background: "var(--bg)",
                      color: "var(--ink)",
                    }}
                  />
                </div>

                <div>
                  <label style={{ fontSize: "0.82rem", fontWeight: 600, color: "var(--ink)", display: "block", marginBottom: "4px" }}>
                    Payload (kg)
                  </label>
                  <input
                    type="number"
                    name="payloadKg"
                    defaultValue={editingCar?.payloadKg || 1000}
                    min={100}
                    max={10000}
                    style={{
                      width: "100%",
                      padding: "8px 12px",
                      borderRadius: "8px",
                      border: "1px solid var(--line)",
                      fontSize: "0.85rem",
                      background: "var(--bg)",
                      color: "var(--ink)",
                    }}
                  />
                </div>

                <div>
                  <label style={{ fontSize: "0.82rem", fontWeight: 600, color: "var(--ink)", display: "block", marginBottom: "4px" }}>
                    Road Tax Expiry
                  </label>
                  <input
                    type="date"
                    name="roadTaxExpiry"
                    defaultValue={editingCar?.roadTaxExpiry || "2027-12-31"}
                    style={{
                      width: "100%",
                      padding: "8px 12px",
                      borderRadius: "8px",
                      border: "1px solid var(--line)",
                      fontSize: "0.85rem",
                      background: "var(--bg)",
                      color: "var(--ink)",
                    }}
                  />
                </div>
              </div>

              <div>
                <label style={{ fontSize: "0.82rem", fontWeight: 600, color: "var(--ink)", display: "block", marginBottom: "4px" }}>
                  Assigned Team
                </label>
                <select
                  name="currentTeamId"
                  defaultValue={editingCar?.currentTeamId || ""}
                  style={{
                    width: "100%",
                    padding: "8px 12px",
                    borderRadius: "8px",
                    border: "1px solid var(--line)",
                    fontSize: "0.85rem",
                    background: "var(--bg)",
                    color: "var(--ink)",
                  }}
                >
                  <option value="">None (Unassigned / General Pool)</option>
                  {currentWeekCrews.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name} ({c.baseLocation})
                    </option>
                  ))}
                </select>
              </div>

              {/* Suitability Checklist */}
              <div>
                <label style={{ fontSize: "0.82rem", fontWeight: 600, color: "var(--ink)", display: "block", marginBottom: "6px" }}>
                  Suitability & Equipment Capabilities (Check all that apply)
                </label>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "8px" }}>
                  {VEHICLE_SUITABILITY_OPTIONS.map((opt) => {
                    const isChecked = editingCar ? editingCar.suitability.includes(opt) : true;
                    return (
                      <label
                        key={opt}
                        style={{
                          display: "flex",
                          alignItems: "center",
                          gap: "8px",
                          fontSize: "0.8rem",
                          color: "var(--ink)",
                          background: "var(--surface-soft)",
                          padding: "6px 10px",
                          borderRadius: "6px",
                          border: "1px solid var(--line)",
                          cursor: "pointer",
                        }}
                      >
                        <input
                          type="checkbox"
                          name={`suitability_${opt}`}
                          defaultChecked={isChecked}
                        />
                        <span>{opt}</span>
                      </label>
                    );
                  })}
                </div>
              </div>

              <div>
                <label style={{ fontSize: "0.82rem", fontWeight: 600, color: "var(--ink)", display: "block", marginBottom: "4px" }}>
                  Equipment Notes / Workshop Remarks
                </label>
                <textarea
                  name="notes"
                  defaultValue={editingCar?.notes || ""}
                  rows={2}
                  placeholder="e.g. Equipped with 24-panel roof rack, emergency beacon, ladder carrier..."
                  style={{
                    width: "100%",
                    padding: "8px 12px",
                    borderRadius: "8px",
                    border: "1px solid var(--line)",
                    fontSize: "0.85rem",
                    background: "var(--bg)",
                    color: "var(--ink)",
                    resize: "vertical",
                  }}
                />
              </div>

              <div style={{ display: "flex", justifyContent: "flex-end", gap: "10px", marginTop: "8px" }}>
                <button
                  type="button"
                  onClick={() => setIsCarModalOpen(false)}
                  style={{
                    padding: "8px 16px",
                    borderRadius: "8px",
                    border: "1px solid var(--line)",
                    background: "transparent",
                    color: "var(--muted)",
                    fontSize: "0.85rem",
                    cursor: "pointer",
                  }}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  style={{
                    padding: "8px 18px",
                    borderRadius: "8px",
                    border: "none",
                    background: "#2563eb",
                    color: "#ffffff",
                    fontSize: "0.85rem",
                    fontWeight: 600,
                    cursor: "pointer",
                  }}
                >
                  {editingCar ? "Save Vehicle" : "Register Vehicle"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* MODAL: CREATE / EDIT CREW IN ACTIVE WEEK */}
      {isCrewModalOpen && (
        <div
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(0, 0, 0, 0.5)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            zIndex: 9999,
            padding: "20px",
          }}
        >
          <div
            style={{
              background: "var(--surface)",
              borderRadius: "14px",
              padding: "24px",
              width: "100%",
              maxWidth: "460px",
              boxShadow: "0 20px 25px -5px rgba(0, 0, 0, 0.2)",
              display: "flex",
              flexDirection: "column",
              gap: "16px",
            }}
          >
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
              <h3 style={{ margin: 0, fontSize: "1.15rem", fontWeight: 700, color: "var(--ink)" }}>
                {editingCrew ? "Edit Team" : `Create Team for Week ${weekRangeLabel(activeWeek).split(" ")[0]}…`}
              </h3>
              <button
                onClick={() => setIsCrewModalOpen(false)}
                style={{ background: "transparent", border: "none", color: "var(--muted)", cursor: "pointer" }}
              >
                <X size={20} />
              </button>
            </div>

            <form
              onSubmit={(e) => {
                e.preventDefault();
                const form = e.currentTarget;
                const name = (form.elements.namedItem("crewName") as HTMLInputElement).value.trim();
                const baseLocation = (form.elements.namedItem("baseLocation") as HTMLInputElement).value.trim();
                const vehicle = (form.elements.namedItem("vehicle") as HTMLInputElement).value.trim();

                if (!name) return;

                if (editingCrew) {
                  const nextCrews = currentWeekCrews.map((c) => {
                    if (c.id !== editingCrew.id) return c;
                    return { ...c, name, baseLocation, vehicle };
                  });
                  updateCurrentWeekCrews(nextCrews);
                } else {
                  const newCrew: InstallationCrew = {
                    id: `crew-${Date.now()}`,
                    name,
                    supervisorId: null,
                    technicianIds: [],
                    internIds: [],
                    baseLocation: baseLocation || "Johor Bahru",
                    vehicle: vehicle || "Van",
                  };
                  updateCurrentWeekCrews([...currentWeekCrews, newCrew]);
                }

                setIsCrewModalOpen(false);
              }}
              style={{ display: "flex", flexDirection: "column", gap: "14px" }}
            >
              <div>
                <label style={{ fontSize: "0.82rem", fontWeight: 600, color: "var(--ink)", display: "block", marginBottom: "4px" }}>
                  Team Name *
                </label>
                <input
                  name="crewName"
                  defaultValue={editingCrew?.name || `Team ${currentWeekCrews.length + 1}`}
                  required
                  placeholder="e.g. Team 1, Team 2, Team 3"
                  style={{
                    width: "100%",
                    padding: "8px 12px",
                    borderRadius: "8px",
                    border: "1px solid var(--line)",
                    fontSize: "0.85rem",
                    background: "var(--bg)",
                    color: "var(--ink)",
                  }}
                />
              </div>

              <div>
                <label style={{ fontSize: "0.82rem", fontWeight: 600, color: "var(--ink)", display: "block", marginBottom: "4px" }}>
                  Base Location
                </label>
                <input
                  name="baseLocation"
                  defaultValue={editingCrew?.baseLocation || "Johor Bahru"}
                  placeholder="Johor Bahru, Kluang, Kulai, Muar..."
                  style={{
                    width: "100%",
                    padding: "8px 12px",
                    borderRadius: "8px",
                    border: "1px solid var(--line)",
                    fontSize: "0.85rem",
                    background: "var(--bg)",
                    color: "var(--ink)",
                  }}
                />
              </div>

              <div>
                <label style={{ fontSize: "0.82rem", fontWeight: 600, color: "var(--ink)", display: "block", marginBottom: "4px" }}>
                  Vehicle / Transport
                </label>
                <input
                  name="vehicle"
                  list="registered-crew-cars"
                  defaultValue={editingCrew?.vehicle || ""}
                  placeholder="e.g. Toyota Hilux (JXX 4488) + Van"
                  style={{
                    width: "100%",
                    padding: "8px 12px",
                    borderRadius: "8px",
                    border: "1px solid var(--line)",
                    fontSize: "0.85rem",
                    background: "var(--bg)",
                    color: "var(--ink)",
                  }}
                />
                <datalist id="registered-crew-cars">
                  {cars.map((c) => (
                    <option key={c.id} value={`${c.model} (${c.plateNumber})`} />
                  ))}
                </datalist>
              </div>

              <div style={{ display: "flex", justifyContent: "flex-end", gap: "10px", marginTop: "8px" }}>
                <button
                  type="button"
                  onClick={() => setIsCrewModalOpen(false)}
                  style={{
                    padding: "8px 16px",
                    borderRadius: "8px",
                    border: "1px solid var(--line)",
                    background: "transparent",
                    color: "var(--muted)",
                    fontSize: "0.85rem",
                    cursor: "pointer",
                  }}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  style={{
                    padding: "8px 18px",
                    borderRadius: "8px",
                    border: "none",
                    background: "#2563eb",
                    color: "#ffffff",
                    fontSize: "0.85rem",
                    fontWeight: 600,
                    cursor: "pointer",
                  }}
                >
                  {editingCrew ? "Save Changes" : "Create Team"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* MODAL: QUICK AVAILABILITY STATUS TOGGLE */}
      {quickAvailabilityMember && (
        <div
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(0, 0, 0, 0.5)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            zIndex: 9999,
            padding: "20px",
          }}
        >
          <div
            style={{
              background: "var(--surface)",
              borderRadius: "14px",
              padding: "22px",
              width: "100%",
              maxWidth: "420px",
              boxShadow: "0 20px 25px -5px rgba(0, 0, 0, 0.2)",
              display: "flex",
              flexDirection: "column",
              gap: "14px",
            }}
          >
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
              <div>
                <h3 style={{ margin: 0, fontSize: "1.1rem", fontWeight: 700, color: "var(--ink)" }}>
                  Update Availability
                </h3>
                <span style={{ fontSize: "0.85rem", color: "var(--muted)" }}>
                  {quickAvailabilityMember.name} ({quickAvailabilityMember.role.replace("_", " ")})
                </span>
              </div>
              <button
                onClick={() => setQuickAvailabilityMember(null)}
                style={{ background: "transparent", border: "none", color: "var(--muted)", cursor: "pointer" }}
              >
                <X size={18} />
              </button>
            </div>

            <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
              <div>
                <label style={{ fontSize: "0.82rem", fontWeight: 600, color: "var(--ink)", display: "block", marginBottom: "6px" }}>
                  Status
                </label>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: "8px" }}>
                  <button
                    type="button"
                    onClick={() => setQuickStatus("available")}
                    style={{
                      padding: "8px",
                      borderRadius: "8px",
                      border: "1px solid",
                      borderColor: quickStatus === "available" ? "#16a34a" : "var(--line)",
                      background: quickStatus === "available" ? "#dcfce7" : "var(--surface)",
                      color: quickStatus === "available" ? "#166534" : "var(--ink)",
                      fontWeight: 600,
                      fontSize: "0.82rem",
                      cursor: "pointer",
                    }}
                  >
                    🟢 Available
                  </button>

                  <button
                    type="button"
                    onClick={() => setQuickStatus("mc")}
                    style={{
                      padding: "8px",
                      borderRadius: "8px",
                      border: "1px solid",
                      borderColor: quickStatus === "mc" ? "#dc2626" : "var(--line)",
                      background: quickStatus === "mc" ? "#fee2e2" : "var(--surface)",
                      color: quickStatus === "mc" ? "#991b1b" : "var(--ink)",
                      fontWeight: 600,
                      fontSize: "0.82rem",
                      cursor: "pointer",
                    }}
                  >
                    🔴 On MC
                  </button>

                  <button
                    type="button"
                    onClick={() => setQuickStatus("leave")}
                    style={{
                      padding: "8px",
                      borderRadius: "8px",
                      border: "1px solid",
                      borderColor: quickStatus === "leave" ? "#d97706" : "var(--line)",
                      background: quickStatus === "leave" ? "#fef3c7" : "var(--surface)",
                      color: quickStatus === "leave" ? "#92400e" : "var(--ink)",
                      fontWeight: 600,
                      fontSize: "0.82rem",
                      cursor: "pointer",
                    }}
                  >
                    🟡 On Leave
                  </button>
                </div>
              </div>

              {quickStatus !== "available" && (
                <>
                  <div>
                    <label style={{ fontSize: "0.82rem", fontWeight: 600, color: "var(--ink)", display: "block", marginBottom: "4px" }}>
                      Reason / Clinic Note
                    </label>
                    <input
                      type="text"
                      value={quickReason}
                      onChange={(e) => setQuickReason(e.target.value)}
                      placeholder={quickStatus === "mc" ? "e.g. Flu, fever (Clinic Penawar)" : "e.g. Annual leave"}
                      style={{
                        width: "100%",
                        padding: "8px 12px",
                        borderRadius: "8px",
                        border: "1px solid var(--line)",
                        fontSize: "0.85rem",
                        background: "var(--bg)",
                        color: "var(--ink)",
                      }}
                    />
                  </div>

                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "10px" }}>
                    <div>
                      <label style={{ fontSize: "0.82rem", fontWeight: 600, color: "var(--ink)", display: "block", marginBottom: "4px" }}>
                        Start Date
                      </label>
                      <input
                        type="date"
                        value={quickStartDate}
                        onChange={(e) => setQuickStartDate(e.target.value)}
                        style={{
                          width: "100%",
                          padding: "6px 10px",
                          borderRadius: "8px",
                          border: "1px solid var(--line)",
                          fontSize: "0.82rem",
                          background: "var(--surface)",
                          color: "var(--ink)",
                        }}
                      />
                    </div>

                    <div>
                      <label style={{ fontSize: "0.82rem", fontWeight: 600, color: "var(--ink)", display: "block", marginBottom: "4px" }}>
                        End Date
                      </label>
                      <input
                        type="date"
                        value={quickEndDate}
                        onChange={(e) => setQuickEndDate(e.target.value)}
                        style={{
                          width: "100%",
                          padding: "6px 10px",
                          borderRadius: "8px",
                          border: "1px solid var(--line)",
                          fontSize: "0.82rem",
                          background: "var(--surface)",
                          color: "var(--ink)",
                        }}
                      />
                    </div>
                  </div>
                </>
              )}

              <div style={{ display: "flex", justifyContent: "flex-end", gap: "10px", marginTop: "8px" }}>
                <button
                  type="button"
                  onClick={() => setQuickAvailabilityMember(null)}
                  style={{
                    padding: "8px 14px",
                    borderRadius: "8px",
                    border: "1px solid var(--line)",
                    background: "transparent",
                    color: "var(--muted)",
                    fontSize: "0.85rem",
                    cursor: "pointer",
                  }}
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={handleSaveQuickAvailability}
                  style={{
                    padding: "8px 16px",
                    borderRadius: "8px",
                    border: "none",
                    background: "#2563eb",
                    color: "#ffffff",
                    fontSize: "0.85rem",
                    fontWeight: 600,
                    cursor: "pointer",
                  }}
                >
                  Save Status
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default ProjectTeamScheduleView;
