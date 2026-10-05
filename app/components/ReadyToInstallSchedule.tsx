"use client";

import { CloudRain, FileText, MapPin, Minus, Plus, X } from "lucide-react";
import { Fragment, useEffect, useMemo, useState, useDeferredValue } from "react";
import { fetchDailyWeather, type DailyWeather } from "@/lib/calendar-weather";
import { distanceKm } from "@/lib/postcode-coords";
import {
  HOLD_LABEL,
  MAX_RADIUS_KM,
  REGION_LABEL,
  SLOT_TIME,
  TEAM_REGION,
  WORKING_DAY_LIMIT,
  addDays,
  postcodeOf,
  weekDays,
  type Candidate,
  type HoldReason,
  type Placement,
  type Region,
  type ScheduleDraft,
  type Slot,
  type SlotEntry,
  type TeamCrewAssignment,
  type TeamNumber,
} from "@/lib/schedule-suggest";
import {
  isSedaApproved,
  type InstallationJob,
  type SiteAssessment,
  type SiteDifficulty,
} from "@/lib/types";
import {
  isJobNeedAttention,
  isJobPending,
  isJobReschedule,
} from "@/app/components/DepositScheduleTable";
import {
  useInstallationQueue,
  type QueuePosition,
  type ScheduleGroup,
  type ScheduleWeekAssignment,
} from "@/app/components/installation-queue";

const DEFAULT_KNOWN_SUPERVISORS = [
  "Chan Chee Man",
  "Chat Cheh Man",
  "Kaijie",
  "Martin Hing",
  "Ahzu",
  "Jack",
  "John",
];

// Installation groups under Planning status Ready to Install: next week's
// front line from the installation queue, laid out as the four crews' tables.
// The queue itself — order, standby, holds — is kept on Customer Scheduling;
// both read the same shared data through useInstallationQueue.

type JobFiles = { sld: string[]; roof: string[]; site: string[] };
type FilesState =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "ready"; files: JobFiles };

// A day is flagged for the manager once the worst forecast across the crew's
// area reaches this chance of rain.
const RAIN_WARNING_PERCENT = 70;

// How close to the 28-working-day limit a customer gets a warning tag.
const CLOCK_WARNING_DAYS = 5;

const REGION_WEATHER: Record<Region, { latitude: number; longitude: number }> = {
  jb: { latitude: 1.492, longitude: 103.741 },
  kluang: { latitude: 2.031, longitude: 103.318 },
};

const DAY_LABEL = new Intl.DateTimeFormat("en-MY", {
  weekday: "short",
  day: "numeric",
  month: "short",
  timeZone: "UTC",
});
const SHORT_DATE = new Intl.DateTimeFormat("en-MY", {
  day: "numeric",
  month: "short",
  year: "numeric",
  timeZone: "UTC",
});

function isoToUtcDate(iso: string) {
  return new Date(`${iso}T00:00:00Z`);
}

export function dayLabel(iso: string) {
  return DAY_LABEL.format(isoToUtcDate(iso));
}

function shortDate(iso: string | null | undefined) {
  return iso ? SHORT_DATE.format(isoToUtcDate(iso.slice(0, 10))) : "";
}

function weekLabel(weekStart: string) {
  const end = addDays(weekStart, 5);
  return `${shortDate(weekStart).replace(/ \d{4}$/, "")} – ${shortDate(end)}`;
}

function titleCase(value: string) {
  return value
    .trim()
    .toLocaleLowerCase("en-MY")
    .replace(/(^|[\s(/'-])\p{L}/gu, (letter) => letter.toLocaleUpperCase("en-MY"));
}

// "(ATAP)" is how the sheet marks a tile roof on the customer's name. It is
// shown as its own tag instead.
function isAtap(name: string) {
  return /\(ATAP\)/i.test(name);
}

function displayName(name: string) {
  return titleCase(name.replace(/\(ATAP\)/gi, "").replace(/\s+/g, " "));
}

function isJobOM(job: InstallationJob): boolean {
  if (job.visits && job.visits.length > 0) return true;
  const remarks = ((job.installationRemarks || "") + " " + (job.preferredInstallationTime || "")).toLowerCase();
  return /(\bo&m\b|\bmaintenance\b|\bwiring\s*only\b|\bcallback\b|\brepair\b|\brectification\b|\bservice\b)/i.test(remarks);
}

function formatPhone(value: string) {
  const digits = value.replace(/\D/g, "");
  if (!digits) return "";
  const local = digits.startsWith("60") ? `0${digits.slice(2)}` : digits;
  return local.length >= 9
    ? `${local.slice(0, 3)}-${local.slice(3, 6)} ${local.slice(6)}`
    : value;
}

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

function panelText(job: InstallationJob): string {
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

function inverterText(job: InstallationJob) {
  return (
    job.inverterBattery.trim() ||
    job.derivedInverterModel ||
    (job.inverter === "Not available" ? "" : job.inverter)
  );
}

function phaseText(job: InstallationJob) {
  if (job.phase === "Single phase") return "Single";
  if (job.phase === "Three phase") return "Three";
  return "–";
}

function townOf(job: InstallationJob) {
  return titleCase(job.city || "") || postcodeOf(job) || "Unknown area";
}

export const SLOT_LABEL: Record<Slot, string> = {
  am: "9am",
  pm: "2pm",
  full: "Full day",
};

const DIFFICULTY_LABEL: Record<SiteDifficulty, string> = {
  easy: "Easy",
  medium: "Medium",
  hard: "Hard",
};



function isImageUrl(url: string) {
  return /\.(jpe?g|png|webp|gif|bmp|heic)(\?|$)/i.test(url);
}

function isVideoUrl(url: string) {
  return /\.(mov|mp4|m4v|webm)(\?|$)/i.test(url);
}

type SlotRef = { weekStart: string; team: TeamNumber; date: string; slot: Slot };

function slotsConflict(a: Slot, b: Slot) {
  return a === "full" || b === "full" || a === b;
}

function stockAllows(candidate: Candidate, date: string, slot: Slot) {
  if (!candidate.stockDate) return true;
  return slot === "pm" ? candidate.stockDate <= date : candidate.stockDate < date;
}

type DropMove = "queue" | "day" | "hold";
type Panel =
  | { kind: "drop"; jobId: string; ref: SlotRef }
  | { kind: "files"; jobId: string };

function OpenSlotCustomerSearch({
  queue,
  bookedJobIds,
  positions,
  onSelectCustomer,
}: {
  queue: Candidate[];
  bookedJobIds: Set<string>;
  positions: Map<string, QueuePosition>;
  onSelectCustomer: (jobId: string) => void;
}) {
  const [query, setQuery] = useState("");
  const [isOpen, setIsOpen] = useState(false);
  const deferredQuery = useDeferredValue(query);

  const filtered = useMemo(() => {
    const q = deferredQuery.toLowerCase().trim();
    return queue.filter((c) => {
      if (bookedJobIds.has(c.job.id)) return false;
      if (!q) return true;
      return (
        displayName(c.job.customerName).toLowerCase().includes(q) ||
        c.job.invoiceNumber.toLowerCase().includes(q) ||
        townOf(c.job).toLowerCase().includes(q)
      );
    });
  }, [queue, bookedJobIds, deferredQuery]);

  return (
    <div style={{ position: "relative", display: "inline-block", marginLeft: "10px" }}>
      <input
        type="text"
        className="rti-crew-input"
        style={{
          width: "270px",
          padding: "4px 8px",
          fontSize: "0.83rem",
          borderRadius: "4px",
          border: "1px solid #cbd5e1",
          background: "#ffffff",
          color: "#0f172a",
        }}
        placeholder="Type customer name to add (e.g. Tan Kim Whui)…"
        value={query}
        onFocus={() => setIsOpen(true)}
        onChange={(e) => {
          setQuery(e.target.value);
          setIsOpen(true);
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter" && filtered.length > 0) {
            onSelectCustomer(filtered[0].job.id);
            setQuery("");
            setIsOpen(false);
          } else if (e.key === "Escape") {
            setIsOpen(false);
          }
        }}
      />
      {isOpen && (
        <>
          <div
            style={{ position: "fixed", inset: 0, zIndex: 999 }}
            onClick={() => setIsOpen(false)}
          />
          <ul
            style={{
              position: "absolute",
              top: "calc(100% + 2px)",
              left: 0,
              zIndex: 1000,
              width: "340px",
              maxHeight: "220px",
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
                No customer found matching "{query}"
              </li>
            ) : (
              filtered.slice(0, 30).map((candidate) => {
                const pos = positions.get(candidate.job.id);
                const posLabel = pos ? ` (slotted ${shortDate(pos.date)})` : "";
                return (
                  <li
                    key={candidate.job.id}
                    style={{
                      padding: "6px 12px",
                      fontSize: "0.82rem",
                      cursor: "pointer",
                      display: "flex",
                      justifyContent: "space-between",
                      alignItems: "center",
                      borderBottom: "1px solid rgba(255,255,255,0.06)",
                    }}
                    onMouseDown={(e) => {
                      e.preventDefault();
                      onSelectCustomer(candidate.job.id);
                      setQuery("");
                      setIsOpen(false);
                    }}
                  >
                    <div>
                      <strong>{displayName(candidate.job.customerName)}</strong>
                      <span style={{ opacity: 0.75, marginLeft: "6px" }}>· {townOf(candidate.job)}</span>
                    </div>
                    {posLabel && (
                      <span style={{ fontSize: "0.74rem", opacity: 0.6, fontStyle: "italic" }}>
                        {posLabel}
                      </span>
                    )}
                  </li>
                );
              })
            )}
          </ul>
        </>
      )}
    </div>
  );
}

export default function ReadyToInstallSchedule({
  readyJobs,
  jobById,
  groups,
  weekAssignments,
  assessments,
  onSaveAssessment,
  draft,
  onChangeDraft,
  onBook,
  onBatchBook,
  onShowOnMap,
  mapJobId,
  onOpenInQueue,
  focusJobId,
  todayIso,
  onSaveJob,
  teams,
  searchQuery = "",
}: {
  readyJobs: InstallationJob[];
  jobById: Map<string, InstallationJob>;
  groups: ScheduleGroup[];
  weekAssignments: ScheduleWeekAssignment[];
  assessments: Record<string, SiteAssessment>;
  onSaveAssessment: (jobId: string, assessment: SiteAssessment) => void;
  draft: ScheduleDraft | null;
  onChangeDraft: (draft: ScheduleDraft) => void;
  // Books one confirmed customer: a group and its start time, the same records
  // Installation groups keeps for every booking.
  onBook: (group: ScheduleGroup, assignment: ScheduleWeekAssignment) => void;
  onBatchBook?: (
    bookings: { group: ScheduleGroup; assignment: ScheduleWeekAssignment }[],
  ) => void;
  onShowOnMap: (jobId: string) => void;
  mapJobId: string | null;
  // Opens the customer in the queue on Customer Scheduling.
  onOpenInQueue: (jobId: string) => void;
  // A customer to scroll to and highlight, arriving from the queue.
  focusJobId: string | null;
  todayIso: string;
  onSaveJob?: (job: InstallationJob) => void;
  teams?: { id: string; name: string; role: string; siteSupervisor?: string; members?: string[] }[];
  searchQuery?: string;
}) {
  const {
    draft: scheduleDraft,
    frontWeek: weekStart,
    candidateById,
    booked,
    bookedJobIds,
    coordsFor,
    schedule,
    schedules,
    positions,
    queue,
    queueNumber,
    standby,
  } = useInstallationQueue({
    readyJobs,
    jobById,
    groups,
    weekAssignments,
    assessments,
    draft,
    todayIso,
  });

  const availableInstallTeams = useMemo(() => {
    const set = new Set<string>();
    if (teams) {
      teams.filter((t) => t.role !== "wiring").forEach((t) => set.add(t.name));
    }
    groups.forEach((g) => {
      if (g.installationTeam) set.add(g.installationTeam);
    });
    if (set.size === 0) {
      ["Installation Team A", "Installation Team B", "Installation Team C", "Installation Team D"].forEach((t) => set.add(t));
    }
    return Array.from(set);
  }, [teams, groups]);

  const availableWiringTeams = useMemo(() => {
    const set = new Set<string>();
    if (teams) {
      teams.filter((t) => t.role === "wiring").forEach((t) => set.add(t.name));
    }
    groups.forEach((g) => {
      if (g.wiringTeam) set.add(g.wiringTeam);
    });
    if (set.size === 0) {
      ["Wiring Team 1", "Wiring Team 2", "Wiring Team 3", "Wiring Team 4"].forEach((t) => set.add(t));
    }
    return Array.from(set);
  }, [teams, groups]);

  const availableSupervisors = useMemo(() => {
    const set = new Set<string>(DEFAULT_KNOWN_SUPERVISORS);
    if (teams) {
      teams.forEach((t) => {
        if (t.siteSupervisor) set.add(t.siteSupervisor);
      });
    }
    groups.forEach((g) => {
      g.supervisors?.forEach((s) => {
        if (s) set.add(s);
      });
    });
    return Array.from(set).sort();
  }, [teams, groups]);

  const availableCars = useMemo(() => {
    const set = new Set<string>();
    groups.forEach((g) => {
      g.cars?.forEach((c) => {
        if (c) set.add(c);
      });
    });
    return Array.from(set).sort();
  }, [groups]);

  function checkAndGraduateTeam(
    teamNum: TeamNumber,
    crews: Partial<Record<TeamNumber, TeamCrewAssignment>>,
  ) {
    const crew = crews[teamNum];
    const inst = crew?.installationTeam?.trim() || "";
    const wir = crew?.wiringTeam?.trim() || "";
    const mem = crew?.membersText?.trim() || "";
    const sup = crew?.siteSupervisor?.trim() || "";

    // Moves once at least installation team and wiring team (or member) are assigned
    if (!inst || (!wir && !mem)) return;

    // Find all slotted jobs for this team in the proposed schedule that aren't booked yet
    const teamSchedule = schedule.teams.find((t) => t.team === teamNum);
    if (!teamSchedule) return;

    const entriesToMove: { jobId: string; date: string; slot: Slot }[] = [];
    teamSchedule.days.forEach((day) => {
      day.entries.forEach((entry) => {
        if (entry.jobId && entry.source !== "booked") {
          entriesToMove.push({
            jobId: entry.jobId,
            date: day.date,
            slot: entry.slot,
          });
        }
      });
    });

    if (entriesToMove.length === 0) return;

    const wiringMembers = crew?.membersText
      ? crew.membersText
          .split(",")
          .map((s) => s.trim())
          .filter(Boolean)
      : [];

    const cars = crew?.car
      ? crew.car
          .split(",")
          .map((s) => s.trim())
          .filter(Boolean)
      : [];

    const bookings = entriesToMove.map((item) => {
      const job = jobById.get(item.jobId);
      const town = job ? townOf(job) : "";
      const id = crypto.randomUUID();
      return {
        group: {
          id,
          name: `Team ${teamNum} · ${town}`,
          area: town,
          installationDate: item.date,
          installationEndDate: item.date,
          jobIds: [item.jobId],
          installationTeam: inst,
          wiringTeam: wir || (mem ? `Team ${teamNum}` : ""),
          supervisors: sup ? [sup] : [],
          wiringMembers,
          cars,
          teamLabel: `Team ${teamNum}`,
        } as ScheduleGroup,
        assignment: {
          id: crypto.randomUUID(),
          teamId: "",
          startDate: `${item.date}T${SLOT_TIME[item.slot]}`,
          installationGroupId: id,
        } as ScheduleWeekAssignment,
      };
    });

    if (onBatchBook) {
      onBatchBook(bookings);
    } else {
      bookings.forEach((b) => onBook(b.group, b.assignment));
    }

    let nextDraft: ScheduleDraft = {
      ...scheduleDraft,
      teamCrews: crews,
    };
    entriesToMove.forEach((item) => {
      nextDraft = withoutJob(nextDraft, item.jobId);
    });
    onChangeDraft(nextDraft);

    const details = [inst, wir || (wiringMembers.length ? wiringMembers.join(", ") : ""), sup]
      .filter(Boolean)
      .join(", ");
    setNotice(
      `Team ${teamNum} (${entriesToMove.length} customer${
        entriesToMove.length === 1 ? "" : "s"
      }) moved to Arranged Installation with ${details}.`,
    );
  }

  function updateCrewField(team: TeamNumber, field: keyof TeamCrewAssignment, value: string) {
    const currentCrew = scheduleDraft.teamCrews?.[team] || {};
    const nextCrews = {
      ...(scheduleDraft.teamCrews || {}),
      [team]: {
        ...currentCrew,
        [field]: value,
      },
    };
    onChangeDraft({
      ...scheduleDraft,
      teamCrews: nextCrews,
    });

    const inst = (field === "installationTeam" ? value : (currentCrew.installationTeam ?? "")).trim();
    const wir = (field === "wiringTeam" ? value : (currentCrew.wiringTeam ?? "")).trim();
    const mem = (field === "membersText" ? value : (currentCrew.membersText ?? "")).trim();

    const isOptionMatch =
      (field === "installationTeam" && availableInstallTeams.includes(value.trim())) ||
      (field === "wiringTeam" && availableWiringTeams.includes(value.trim()));

    if (isOptionMatch && inst && (wir || mem)) {
      checkAndGraduateTeam(team, nextCrews);
    }
  }

  function handleCrewBlur(team: TeamNumber, field: keyof TeamCrewAssignment, value: string) {
    const currentCrew = scheduleDraft.teamCrews?.[team] || {};
    const nextCrews = {
      ...(scheduleDraft.teamCrews || {}),
      [team]: {
        ...currentCrew,
        [field]: value,
      },
    };
    checkAndGraduateTeam(team, nextCrews);
  }

  const [panel, setPanel] = useState<Panel | null>(null);
  const [filesByJob, setFilesByJob] = useState<Record<string, FilesState>>({});
  const [notice, setNotice] = useState<string | null>(null);
  const [noteDraft, setNoteDraft] = useState<Record<string, string>>({});
  const [panelDraft, setPanelDraft] = useState<Record<string, string>>({});
  const [inverterDraft, setInverterDraft] = useState<Record<string, string>>({});
  const [remarkDraft, setRemarkDraft] = useState<Record<string, string>>({});
  const [timeDraft, setTimeDraft] = useState<Record<string, string>>({});
  const [openSlotSearch, setOpenSlotSearch] = useState<Record<string, string>>({});
  const [replacementSearch, setReplacementSearch] = useState("");

  function handlePanelChange(jobId: string, value: string) {
    setPanelDraft((prev) => ({ ...prev, [jobId]: value }));
  }

  function handlePanelBlur(job: InstallationJob) {
    const draftVal = panelDraft[job.id];
    if (draftVal !== undefined && draftVal !== job.powerOutput) {
      onSaveJob?.({ ...job, powerOutput: draftVal });
    }
  }

  function handleInverterChange(jobId: string, value: string) {
    setInverterDraft((prev) => ({ ...prev, [jobId]: value }));
  }

  function handleInverterBlur(job: InstallationJob) {
    const draftVal = inverterDraft[job.id];
    if (draftVal !== undefined && draftVal !== job.inverterBattery) {
      onSaveJob?.({ ...job, inverterBattery: draftVal });
    }
  }

  function handleRemarkChange(jobId: string, value: string) {
    setRemarkDraft((prev) => ({ ...prev, [jobId]: value }));
  }

  function handleRemarkBlur(job: InstallationJob) {
    const draftVal = remarkDraft[job.id];
    if (draftVal !== undefined && draftVal !== (job.installationRemarks || "")) {
      onSaveJob?.({ ...job, installationRemarks: draftVal });
    }
  }
  // The drop-out form. One panel is open at a time, so one set of fields
  // serves it.
  const [dropMove, setDropMove] = useState<DropMove>("queue");
  const [dropDay, setDropDay] = useState<{ date: string; slot: Slot } | null>(null);
  const [remark, setRemark] = useState("");
  const [holdReasonChoice, setHoldReasonChoice] = useState<HoldReason>("customer");
  const [returnOn, setReturnOn] = useState("");
  const [replacementId, setReplacementId] = useState<string | null | undefined>(
    undefined,
  );
  const [weather, setWeather] = useState<Record<Region, Record<string, DailyWeather>>>({
    jb: {},
    kluang: {},
  });

  function openPanel(next: Panel | null) {
    setPanel(next);
    setDropMove("queue");
    setDropDay(null);
    setRemark("");
    setHoldReasonChoice("customer");
    setReturnOn("");
    setReplacementId(undefined);
  }

  // Arriving from the queue: bring that customer's row into view.
  useEffect(() => {
    if (!focusJobId) return;
    const row = document.getElementById(`rti-row-${focusJobId}`);
    row?.scrollIntoView({ behavior: "smooth", block: "center" });
  }, [focusJobId, schedule]);

  // Load the photos the first time a customer's viewer is opened.
  const filesJobId = panel?.kind === "files" ? panel.jobId : null;
  useEffect(() => {
    if (!filesJobId || filesByJob[filesJobId]) return;
    const jobId = filesJobId;
    setFilesByJob((current) => ({ ...current, [jobId]: { status: "loading" } }));
    void (async () => {
      try {
        const response = await fetch(`/api/jobs/${encodeURIComponent(jobId)}/files`, {
          cache: "no-store",
        });
        const body = (await response.json()) as JobFiles & { error?: string };
        if (!response.ok) throw new Error(body.error || "Could not load the photos.");
        setFilesByJob((current) => ({ ...current, [jobId]: { status: "ready", files: body } }));
      } catch (error) {
        setFilesByJob((current) => ({
          ...current,
          [jobId]: {
            status: "error",
            message: error instanceof Error ? error.message : "Could not load the photos.",
          },
        }));
      }
    })();
  }, [filesJobId, filesByJob]);

  // Rain outlook for the two bases, once.
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const [jb, kluang] = await Promise.all([
        fetchDailyWeather([REGION_WEATHER.jb]).catch(() => ({})),
        fetchDailyWeather([REGION_WEATHER.kluang]).catch(() => ({})),
      ]);
      if (!cancelled) setWeather({ jb, kluang });
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  /* ------------------------------ draft edits ------------------------------ */

  function bookedAt(ref: SlotRef) {
    const isOpenInDraft = (scheduleDraft.openSlots || []).some(
      (s) =>
        s.weekStart === ref.weekStart &&
        s.team === ref.team &&
        s.date === ref.date &&
        slotsConflict(s.slot, ref.slot),
    );
    if (isOpenInDraft) return false;

    return booked.some(
      (item) =>
        item.team === ref.team && item.date === ref.date && slotsConflict(item.slot, ref.slot),
    );
  }

  function withoutJob(next: ScheduleDraft, jobId: string): ScheduleDraft {
    return {
      ...next,
      placements: next.placements.filter((placement) => placement.jobId !== jobId),
      removals: next.removals.filter((removal) => removal.jobId !== jobId),
    };
  }

  // Puts a customer into a slot by hand. Anyone placed there by hand before is
  // bumped back to the queue; a slot holding only a suggestion re-plans around
  // it.
  function placementDraft(base: ScheduleDraft, jobId: string, target: SlotRef): ScheduleDraft {
    const hard = assessments[jobId]?.difficulty === "hard";
    const slot: Slot = hard ? "full" : target.slot;
    const cleared = withoutJob(base, jobId);
    const nextOpenSlots = (cleared.openSlots || []).filter(
      (s) =>
        !(
          s.weekStart === target.weekStart &&
          s.team === target.team &&
          s.date === target.date &&
          slotsConflict(s.slot, slot)
        ),
    );
    return {
      ...cleared,
      openSlots: nextOpenSlots,
      placements: [
        ...cleared.placements.filter(
          (placement) =>
            !(
              placement.weekStart === target.weekStart &&
              placement.team === target.team &&
              placement.date === target.date &&
              slotsConflict(placement.slot, slot)
            ),
        ),
        { jobId, weekStart: target.weekStart, team: target.team, date: target.date, slot } as Placement,
      ],
    };
  }

  function removeCustomerFromSlot(jobId: string, ref: SlotRef) {
    let next = withoutJob(scheduleDraft, jobId);
    const nextRemovals = [
      ...next.removals.filter((r) => !(r.jobId === jobId && r.weekStart === ref.weekStart)),
      { jobId, weekStart: ref.weekStart, remark: "Removed by user" },
    ];
    const nextOpenSlots = [
      ...(next.openSlots || []).filter(
        (s) => !(s.weekStart === ref.weekStart && s.team === ref.team && s.date === ref.date && s.slot === ref.slot),
      ),
      { weekStart: ref.weekStart, team: ref.team, date: ref.date, slot: ref.slot },
    ];
    next = {
      ...next,
      removals: nextRemovals,
      openSlots: nextOpenSlots,
    };
    onChangeDraft(next);
    const job = jobById.get(jobId);
    setNotice(`${displayName(job?.customerName ?? "")} removed. Slot is now open.`);
  }

  function changeSlot(jobId: string, currentRef: SlotRef, newSlot: Slot) {
    if (newSlot === currentRef.slot) return;

    const teamSchedule = schedule.teams.find((t) => t.team === currentRef.team);
    const daySchedule = teamSchedule?.days.find((d) => d.date === currentRef.date);
    const entries = daySchedule?.entries ?? [];

    let next = { ...scheduleDraft };

    // Case 1: Switching between AM and PM (e.g. AM -> PM or PM -> AM)
    if ((currentRef.slot === "am" && newSlot === "pm") || (currentRef.slot === "pm" && newSlot === "am")) {
      const otherSlot: Slot = newSlot;
      const otherEntry = entries.find((e) => e.slot === otherSlot && e.jobId);

      if (otherEntry && otherEntry.jobId) {
        // Swap with the job in the target slot!
        const otherJobId = otherEntry.jobId;
        next = withoutJob(next, jobId);
        next = withoutJob(next, otherJobId);

        next.openSlots = (next.openSlots || []).filter(
          (s) => !(s.weekStart === currentRef.weekStart && s.team === currentRef.team && s.date === currentRef.date),
        );

        next.placements = [
          ...next.placements.filter(
            (p) => !(p.weekStart === currentRef.weekStart && p.team === currentRef.team && p.date === currentRef.date),
          ),
          { jobId, weekStart: currentRef.weekStart, team: currentRef.team, date: currentRef.date, slot: newSlot },
          { jobId: otherJobId, weekStart: currentRef.weekStart, team: currentRef.team, date: currentRef.date, slot: currentRef.slot },
        ];

        onChangeDraft(next);
        const job = jobById.get(jobId);
        const otherJob = jobById.get(otherJobId);
        setNotice(
          `Swapped slots: ${displayName(job?.customerName ?? "")} is now ${SLOT_LABEL[newSlot]}, and ${displayName(otherJob?.customerName ?? "")} is now ${SLOT_LABEL[currentRef.slot]}.`,
        );
        return;
      } else {
        // Target slot is empty or open:
        next = withoutJob(next, jobId);

        // Remove old openSlots for target slot
        next.openSlots = (next.openSlots || []).filter(
          (s) =>
            !(
              s.weekStart === currentRef.weekStart &&
              s.team === currentRef.team &&
              s.date === currentRef.date &&
              s.slot === newSlot
            ),
        );
        // The slot we vacated (currentRef.slot) now becomes an open slot
        next.openSlots.push({
          weekStart: currentRef.weekStart,
          team: currentRef.team,
          date: currentRef.date,
          slot: currentRef.slot,
        });

        next.placements = [
          ...next.placements.filter(
            (p) =>
              !(
                p.weekStart === currentRef.weekStart &&
                p.team === currentRef.team &&
                p.date === currentRef.date &&
                slotsConflict(p.slot, newSlot)
              ),
          ),
          { jobId, weekStart: currentRef.weekStart, team: currentRef.team, date: currentRef.date, slot: newSlot },
        ];

        onChangeDraft(next);
        const job = jobById.get(jobId);
        setNotice(
          `${displayName(job?.customerName ?? "")} moved to ${SLOT_LABEL[newSlot]}. The ${SLOT_LABEL[currentRef.slot]} slot is now open.`,
        );
        return;
      }
    }

    // Case 2: Changing to "full" (Full day)
    if (newSlot === "full") {
      const conflictingJobs = entries.filter((e) => e.jobId && e.jobId !== jobId);
      next = withoutJob(next, jobId);
      conflictingJobs.forEach((e) => {
        if (e.jobId) {
          next = withoutJob(next, e.jobId);
          next.removals = [
            ...next.removals.filter((r) => !(r.jobId === e.jobId && r.weekStart === currentRef.weekStart)),
            { jobId: e.jobId, weekStart: currentRef.weekStart, remark: "Bumped for full day slot" },
          ];
        }
      });

      next.openSlots = (next.openSlots || []).filter(
        (s) => !(s.weekStart === currentRef.weekStart && s.team === currentRef.team && s.date === currentRef.date),
      );

      next.placements = [
        ...next.placements.filter(
          (p) => !(p.weekStart === currentRef.weekStart && p.team === currentRef.team && p.date === currentRef.date),
        ),
        { jobId, weekStart: currentRef.weekStart, team: currentRef.team, date: currentRef.date, slot: "full" },
      ];

      onChangeDraft(next);
      const job = jobById.get(jobId);
      setNotice(`${displayName(job?.customerName ?? "")} set to Full day.`);
      return;
    }

    // Case 3: Changing from "full" to "am" or "pm"
    if (currentRef.slot === "full" && (newSlot === "am" || newSlot === "pm")) {
      next = withoutJob(next, jobId);
      const otherSlot: Slot = newSlot === "am" ? "pm" : "am";

      next.openSlots = (next.openSlots || []).filter(
        (s) => !(s.weekStart === currentRef.weekStart && s.team === currentRef.team && s.date === currentRef.date),
      );
      next.openSlots.push({
        weekStart: currentRef.weekStart,
        team: currentRef.team,
        date: currentRef.date,
        slot: otherSlot,
      });

      next.placements = [
        ...next.placements.filter(
          (p) => !(p.weekStart === currentRef.weekStart && p.team === currentRef.team && p.date === currentRef.date),
        ),
        { jobId, weekStart: currentRef.weekStart, team: currentRef.team, date: currentRef.date, slot: newSlot },
      ];

      onChangeDraft(next);
      const job = jobById.get(jobId);
      setNotice(
        `${displayName(job?.customerName ?? "")} changed to ${SLOT_LABEL[newSlot]}. The ${SLOT_LABEL[otherSlot]} slot is now open.`,
      );
      return;
    }
  }

  function changeOpenSlot(ref: SlotRef, newSlot: Slot) {
    if (newSlot === ref.slot) return;
    let next = { ...scheduleDraft };
    next.openSlots = (next.openSlots || []).filter(
      (s) =>
        !(
          s.weekStart === ref.weekStart &&
          s.team === ref.team &&
          s.date === ref.date &&
          slotsConflict(s.slot, ref.slot)
        ),
    );
    next.openSlots.push({
      weekStart: ref.weekStart,
      team: ref.team,
      date: ref.date,
      slot: newSlot,
    });
    onChangeDraft(next);
    setNotice(`Slot updated to ${SLOT_LABEL[newSlot]}.`);
  }

  function addToSlot(jobId: string, target: SlotRef) {
    if (bookedAt(target)) {
      setNotice("That slot is already booked. Pick another slot.");
      return;
    }
    const crew = scheduleDraft.teamCrews?.[target.team];
    const inst = crew?.installationTeam?.trim() || "";
    const wir = crew?.wiringTeam?.trim() || "";
    const sup = crew?.siteSupervisor?.trim() || "";
    if (inst && wir && sup) {
      confirm(jobId, target.team, target.date, target.slot);
    } else {
      onChangeDraft(placementDraft(scheduleDraft, jobId, target));
      setNotice(null);
    }
  }

  // Confirm: the customer agreed, so the slot becomes a booking.
  function confirm(jobId: string, team: TeamNumber, date: string, slot: Slot) {
    const job = jobById.get(jobId);
    if (!job) return;
    const id = crypto.randomUUID();
    const town = townOf(job);
    const crew = scheduleDraft.teamCrews?.[team];
    const wiringMembers = crew?.membersText
      ? crew.membersText
          .split(",")
          .map((s) => s.trim())
          .filter(Boolean)
      : [];
    const cars = crew?.car
      ? crew.car
          .split(",")
          .map((s) => s.trim())
          .filter(Boolean)
      : [];
    onBook(
      {
        id,
        name: `Team ${team} · ${town}`,
        area: town,
        installationDate: date,
        installationEndDate: date,
        jobIds: [jobId],
        installationTeam: crew?.installationTeam || "",
        wiringTeam: crew?.wiringTeam || "",
        supervisors: crew?.siteSupervisor ? [crew.siteSupervisor] : [],
        wiringMembers,
        cars,
        teamLabel: `Team ${team}`,
      },
      {
        id: crypto.randomUUID(),
        teamId: "",
        startDate: `${date}T${SLOT_TIME[slot]}`,
        installationGroupId: id,
      },
    );
    onChangeDraft(withoutJob(scheduleDraft, jobId));
    setNotice(
      `${displayName(job.customerName)} is scheduled for Team ${team}, ${dayLabel(date)} ${SLOT_LABEL[slot]}.`,
    );
  }

  // Standbys who could take a freed slot: same side of Johor, not a hard roof
  // when only half the day is free, stock in time, and within reach of the
  // other house that day.
  function standbyFor(ref: SlotRef, droppedJobId: string) {
    let partnerId: string | null = null;
    positions.forEach((position, jobId) => {
      if (jobId !== droppedJobId && position.team === ref.team && position.date === ref.date) {
        partnerId = jobId;
      }
    });
    const partnerCoords = partnerId ? coordsFor(partnerId) : null;
    return standby.filter((candidate) => {
      if (candidate.job.id === droppedJobId) return false;
      if (candidate.region !== TEAM_REGION[ref.team]) return false;
      if (ref.slot !== "full" && candidate.difficulty === "hard") return false;
      if (!stockAllows(candidate, ref.date, ref.slot)) return false;
      if (partnerCoords && candidate.coords) {
        return distanceKm(partnerCoords, candidate.coords) <= MAX_RADIUS_KM;
      }
      return true;
    });
  }

  function applyDrop(jobId: string, ref: SlotRef, replacement: string | null) {
    let next = withoutJob(scheduleDraft, jobId);
    if (dropMove === "day") {
      if (!dropDay?.date) {
        setNotice("Choose the day and time to move them to.");
        return;
      }
      const target: SlotRef = { ...ref, date: dropDay.date, slot: dropDay.slot };
      if (bookedAt(target)) {
        setNotice("That slot is already booked. Pick another day or time.");
        return;
      }
      next = placementDraft(next, jobId, target);
    } else {
      next = {
        ...next,
        removals: [...next.removals, { jobId, weekStart, remark: remark.trim() }],
      };
      if (dropMove === "hold") {
        next = {
          ...next,
          holds: [
            ...next.holds.filter((hold) => !(hold.jobId === jobId && hold.to === null)),
            {
              jobId,
              reason: holdReasonChoice,
              remark: remark.trim(),
              from: todayIso,
              to: null,
              returnOn: returnOn || null,
            },
          ],
        };
      }
    }
    if (replacement) next = placementDraft(next, replacement, ref);
    onChangeDraft(next);
    openPanel(null);
    setNotice(null);
  }

  function saveDifficulty(jobId: string, difficulty: SiteDifficulty) {
    onSaveAssessment(jobId, {
      difficulty,
      note: noteDraft[jobId] ?? assessments[jobId]?.note ?? "",
      updatedAt: new Date().toISOString(),
    });
  }

  function saveNote(jobId: string) {
    const current = assessments[jobId];
    const note = noteDraft[jobId];
    if (!current || note === undefined || note === current.note) return;
    onSaveAssessment(jobId, { difficulty: current.difficulty, note, updatedAt: new Date().toISOString() });
  }

  function setRainDay(date: string, choice: "hold" | "proceed" | "clear") {
    const without = (list: string[]) => list.filter((item) => item !== date);
    onChangeDraft({
      ...scheduleDraft,
      rainHoldDays:
        choice === "hold" ? [...without(scheduleDraft.rainHoldDays), date] : without(scheduleDraft.rainHoldDays),
      rainProceedDays:
        choice === "proceed"
          ? [...without(scheduleDraft.rainProceedDays), date]
          : without(scheduleDraft.rainProceedDays),
    });
  }

  /* -------------------------------- derived -------------------------------- */

  // Rain forecast rendered directly on the slot.
  function renderSlotRain(teamNum: TeamNumber, date: string) {
    const region = TEAM_REGION[teamNum];
    const dayWeather = weather[region]?.[date];
    const chance = dayWeather?.rainProbability ?? 0;
    const isHeld = scheduleDraft.rainHoldDays.includes(date);
    const isRain = chance >= RAIN_WARNING_PERCENT;

    if (isHeld) {
      return (
        <div className="rti-slot-rain is-held" role="status" title={`${dayLabel(date)} is on hold for rain`}>
          <span className="rti-slot-rain-label">
            <CloudRain size={12} /> Rain hold
          </span>
        </div>
      );
    }

    if (isRain) {
      return (
        <div
          className="rti-slot-rain is-warning"
          role="status"
          title={`Rain expected on ${dayLabel(date)}: ${chance}% chance`}
        >
          <span className="rti-slot-rain-label">
            <CloudRain size={12} /> Rain expected ({chance}%)
          </span>
        </div>
      );
    }

    return null;
  }




  /* ------------------------------- rendering ------------------------------- */

  // Shown only when it matters: over the 28-working-day limit, or close to it.
  function clockWarning(candidate: Candidate | undefined) {
    if (!candidate || candidate.daysLeft === null) return null;
    if (candidate.daysLeft < 0) {
      return <span className="rti-tag is-hard">{-candidate.daysLeft} days over {WORKING_DAY_LIMIT}</span>;
    }
    if (candidate.daysLeft <= CLOCK_WARNING_DAYS) {
      return <span className="rti-tag is-medium">{candidate.daysLeft} days left</span>;
    }
    return null;
  }

  function tags(job: InstallationJob, candidate: Candidate | undefined, entry?: SlotEntry) {
    const clock = clockWarning(candidate);
    const widened = entry?.widenedKm ? (
      <span className="rti-tag is-warning">Widened to {entry.widenedKm} km</span>
    ) : null;

    let reviewBadge = null;
    if (isJobOM(job)) {
      reviewBadge = <span className="rti-review-badge is-om">O&M</span>;
    } else if (isJobReschedule(job)) {
      reviewBadge = <span className="rti-review-badge is-reschedule">Reschedule</span>;
    } else if (isJobPending(job) || job.scheduleStatus === "pending_approval") {
      reviewBadge = <span className="rti-review-badge is-pending">Pending</span>;
    }

    if (!clock && !widened && !reviewBadge) return null;

    return (
      <span className="rti-tags">
        {reviewBadge}
        {clock}
        {widened}
      </span>
    );
  }



  function sedaCell(job: InstallationJob) {
    if (job.sedaApprovedDate) return shortDate(job.sedaApprovedDate);
    if (isSedaApproved(job.sedaStatus)) {
      return <span className="rti-muted">Approved, date not recorded</span>;
    }
    return <span className="rti-warning-text">{job.sedaStatus || "Pending"}</span>;
  }

  function filesButton(job: InstallationJob) {
    const counts = [
      job.sldUrl ? "SLD" : null,
      job.roofPhotoCount ? `${job.roofPhotoCount} roof` : null,
      job.sitePhotoCount ? `${job.sitePhotoCount} site` : null,
    ].filter(Boolean);
    if (!counts.length) return <span className="rti-warning-text">No SLD</span>;
    const open = filesJobId === job.id;
    return (
      <button
        type="button"
        className={`rti-link${open ? " is-active" : ""}`}
        onClick={() => openPanel(open ? null : { kind: "files", jobId: job.id })}
        title="Show the SLD, roof and site-assessment photos"
      >
        <FileText size={13} />
        {job.sldUrl ? "View" : "Photos"}
        <span className="rti-muted">{counts.join(" · ")}</span>
      </button>
    );
  }

  function filesPanel(job: InstallationJob) {
    const state = filesByJob[job.id];
    const assessment = assessments[job.id];
    const renderFiles = (urls: string[], label: string) =>
      urls.length === 0 ? (
        <p className="rti-muted">No {label.toLowerCase()}.</p>
      ) : (
        <div className="rti-thumbs">
          {urls.map((url, index) =>
            isImageUrl(url) ? (
              <a key={url} href={url} target="_blank" rel="noopener noreferrer">
                <img src={url} alt={`${label} ${index + 1}`} loading="lazy" />
              </a>
            ) : (
              <a key={url} className="rti-file-link" href={url} target="_blank" rel="noopener noreferrer">
                <FileText size={14} />
                {isVideoUrl(url) ? "Video" : label} {index + 1}
              </a>
            ),
          )}
        </div>
      );
    return (
      <div className="rti-files">
        <div className="rti-files-head">
          <strong>{displayName(job.customerName)} · SLD and site photos</strong>
          <button type="button" className="icon-button" aria-label="Close photos" onClick={() => openPanel(null)}>
            <X size={15} />
          </button>
        </div>
        {!state || state.status === "loading" ? (
          <p className="rti-muted">Loading…</p>
        ) : state.status === "error" ? (
          <p className="rti-warning-text">{state.message}</p>
        ) : (
          <div className="rti-files-body">
            <section>
              <h4>SLD drawing</h4>
              {renderFiles(state.files.sld, "SLD")}
            </section>
            <section>
              <h4>Roof photos</h4>
              {renderFiles(state.files.roof, "Roof photo")}
            </section>
            <section>
              <h4>Site assessment</h4>
              {renderFiles(state.files.site, "Site photo")}
            </section>
          </div>
        )}
        <div className="rti-rate">
          <span>Difficulty</span>
          {(Object.keys(DIFFICULTY_LABEL) as SiteDifficulty[]).map((level) => (
            <button
              key={level}
              type="button"
              className={`rti-rate-button is-${level}${assessment?.difficulty === level ? " is-selected" : ""}`}
              aria-pressed={assessment?.difficulty === level}
              onClick={() => saveDifficulty(job.id, level)}
            >
              {DIFFICULTY_LABEL[level]}
            </button>
          ))}
          <input
            value={noteDraft[job.id] ?? assessment?.note ?? ""}
            placeholder="e.g. atap, 2 storey, old tiles"
            aria-label={`Difficulty note for ${displayName(job.customerName)}`}
            onChange={(event) => setNoteDraft((current) => ({ ...current, [job.id]: event.target.value }))}
            onBlur={() => saveNote(job.id)}
          />
          <span className="rti-muted">Hard jobs take the whole day.</span>
        </div>
      </div>
    );
  }

  function dropPanel(jobId: string, ref: SlotRef) {
    const job = jobById.get(jobId);
    const options = standbyFor(ref, jobId);
    const chosen = replacementId === undefined ? (options[0]?.job.id ?? null) : replacementId;
    return (
      <div className="rti-move">
        <strong>
          {displayName(job?.customerName ?? "")} — Hold or Remove from Team {ref.team}, {dayLabel(ref.date)}{" "}
          {SLOT_LABEL[ref.slot]}
        </strong>
        <div className="rti-move-row">
          <span className="rti-muted">Action:</span>
          <select value={dropMove} aria-label="Action" onChange={(event) => setDropMove(event.target.value as DropMove)}>
            <option value="queue">Remove from this week (return to Ready to Install queue)</option>
            <option value="hold">Put on hold</option>
            <option value="day">Move to another day this week</option>
          </select>
          {dropMove === "day" && (
            <>
              <select
                value={dropDay?.date ?? ""}
                aria-label="Day"
                onChange={(event) => setDropDay({ date: event.target.value, slot: dropDay?.slot ?? "am" })}
              >
                <option value="">Day…</option>
                {weekDays(weekStart)
                  .filter((date) => date !== ref.date)
                  .map((date) => (
                    <option key={date} value={date}>
                      {dayLabel(date)}
                    </option>
                  ))}
              </select>
              <select
                value={dropDay?.slot ?? "am"}
                aria-label="Time"
                onChange={(event) => setDropDay({ date: dropDay?.date ?? "", slot: event.target.value as Slot })}
              >
                <option value="am">9am</option>
                <option value="pm">2pm</option>
              </select>
            </>
          )}
          {dropMove === "hold" && (
            <>
              <select
                value={holdReasonChoice}
                aria-label="Hold reason"
                onChange={(event) => setHoldReasonChoice(event.target.value as HoldReason)}
              >
                {(Object.keys(HOLD_LABEL) as HoldReason[]).map((reason) => (
                  <option key={reason} value={reason}>
                    {HOLD_LABEL[reason]}
                    {reason === "customer" ? " (clock paused)" : " (clock keeps running)"}
                  </option>
                ))}
              </select>
              <label className="rti-inline">
                Back on
                <input type="date" value={returnOn} onChange={(event) => setReturnOn(event.target.value)} />
              </label>
            </>
          )}
          <input
            className="rti-remark"
            value={remark}
            placeholder="Manager remark, e.g. customer overseas / delay requested"
            aria-label="Manager remark"
            onChange={(event) => setRemark(event.target.value)}
          />
        </div>
        <div className="rti-move-row">
          <span className="rti-muted">Replacement from Ready to Install:</span>
          <input
            type="text"
            className="rti-crew-input"
            style={{
              width: "200px",
              padding: "3px 8px",
              fontSize: "0.82rem",
              borderRadius: "4px",
              border: "1px solid #cbd5e1",
              background: "#ffffff",
              color: "#0f172a",
            }}
            placeholder="Search replacement customer…"
            value={replacementSearch}
            onChange={(e) => setReplacementSearch(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                const query = replacementSearch.toLowerCase().trim();
                if (query) {
                  const match = queue.find(
                    (c) =>
                      c.job.id !== jobId &&
                      !bookedJobIds.has(c.job.id) &&
                      (displayName(c.job.customerName).toLowerCase().includes(query) ||
                       c.job.invoiceNumber.toLowerCase().includes(query) ||
                       townOf(c.job).toLowerCase().includes(query)),
                  );
                  if (match) {
                    setReplacementId(match.job.id);
                  }
                }
              }
            }}
          />
          <select
            value={chosen ?? ""}
            aria-label="Replacement taking the slot"
            onChange={(event) => setReplacementId(event.target.value || null)}
          >
            {queue
              .filter((candidate) => {
                if (candidate.job.id === jobId || bookedJobIds.has(candidate.job.id)) return false;
                const q = replacementSearch.toLowerCase().trim();
                if (!q) return true;
                return (
                  displayName(candidate.job.customerName).toLowerCase().includes(q) ||
                  candidate.job.invoiceNumber.toLowerCase().includes(q) ||
                  townOf(candidate.job).toLowerCase().includes(q)
                );
              })
              .map((candidate, idx) => {
                const pos = positions.get(candidate.job.id);
                const posLabel = pos ? ` (slotted ${shortDate(pos.date)})` : "";
                return (
                  <option key={candidate.job.id} value={candidate.job.id}>
                    {idx === 0 && !replacementSearch ? "★ Next in line eligible: " : ""}
                    {displayName(candidate.job.customerName)} · {townOf(candidate.job)}{posLabel}
                  </option>
                );
              })}
            <option value="">Leave slot for automatic suggestion to fill</option>
          </select>
          <button type="button" className="button primary" onClick={() => applyDrop(jobId, ref, chosen)}>
            Confirm & Replace
          </button>
          <button type="button" className="button secondary" onClick={() => openPanel(null)}>
            Cancel
          </button>
        </div>
      </div>
    );
  }

  const [activeWeekIndex, setActiveWeekIndex] = useState<number>(0);

  const COLUMN_COUNT = 11;
  const currentSchedules = schedules || [schedule];
  const currentWeekSchedule = currentSchedules[activeWeekIndex] ?? currentSchedules[0];
  const displayedSchedules = [currentWeekSchedule];

  const weekStats = useMemo(() => {
    if (!currentWeekSchedule) {
      return {
        total: 0,
        newInstall: 0,
        reschedule: 0,
        pending: 0,
        attention: 0,
        om: 0,
        newPct: 0,
        reschPct: 0,
        pendPct: 0,
        attPct: 0,
        omPct: 0,
      };
    }
    const jobIds = new Set<string>();
    currentWeekSchedule.teams.forEach((t) =>
      t.days.forEach((d) =>
        d.entries.forEach((e) => {
          if (e.jobId) jobIds.add(e.jobId);
        }),
      ),
    );

    let newInstall = 0;
    let reschedule = 0;
    let pending = 0;
    let attention = 0;
    let om = 0;

    jobIds.forEach((jobId) => {
      const job = jobById.get(jobId);
      if (!job || job.customerAvailabilityStatus === "complete") return;
      if (isJobOM(job)) {
        om++;
      } else if (isJobReschedule(job)) {
        reschedule++;
      } else if (
        isJobPending(job) ||
        job.scheduleStatus === "pending_approval"
      ) {
        pending++;
      } else if (isJobNeedAttention(job, todayIso)) {
        attention++;
      } else {
        newInstall++;
      }
    });

    const total = newInstall + reschedule + pending + attention + om;
    return {
      total,
      newInstall,
      reschedule,
      pending,
      attention,
      om,
      newPct: total > 0 ? Math.round((newInstall / total) * 100) : 0,
      reschPct: total > 0 ? Math.round((reschedule / total) * 100) : 0,
      pendPct: total > 0 ? Math.round((pending / total) * 100) : 0,
      attPct: total > 0 ? Math.round((attention / total) * 100) : 0,
      omPct: total > 0 ? Math.round((om / total) * 100) : 0,
    };
  }, [currentWeekSchedule, jobById, todayIso]);

  return (
    <div className="rti">
      <div className="rti-toolbar" style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 12, marginBottom: 16 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
          {currentSchedules.map((sch, idx) => (
            <button
              key={sch.weekStart}
              type="button"
              className={`button ${activeWeekIndex === idx ? "primary" : "secondary"}`}
              onClick={() => setActiveWeekIndex(idx)}
              style={{ fontSize: "0.85rem", padding: "5px 12px" }}
            >
              Week {weekLabel(sch.weekStart)}
            </button>
          ))}
        </div>
      </div>

      {currentWeekSchedule && (
        <div
          className="rti-week-stats-bar"
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            flexWrap: "wrap",
            gap: "12px",
            padding: "10px 16px",
            borderRadius: "8px",
            background: "rgba(255, 255, 255, 0.05)",
            border: "1px solid rgba(255, 255, 255, 0.1)",
            marginBottom: "16px",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: "12px", flexWrap: "wrap", fontSize: "0.85rem" }}>
            <strong style={{ color: "inherit" }}>
              Week {weekLabel(currentWeekSchedule.weekStart)} Summary ({weekStats.total} scheduled):
            </strong>
            <span style={{ display: "inline-flex", alignItems: "center", gap: "4px", padding: "3px 10px", borderRadius: "12px", background: "rgba(34, 197, 94, 0.18)", color: "#4ade80", border: "1px solid rgba(34, 197, 94, 0.35)", fontWeight: 600 }}>
              New Install: {weekStats.newInstall} ({weekStats.newPct}%)
            </span>
            <span style={{ display: "inline-flex", alignItems: "center", gap: "4px", padding: "3px 10px", borderRadius: "12px", background: "rgba(59, 130, 246, 0.18)", color: "#60a5fa", border: "1px solid rgba(59, 130, 246, 0.35)", fontWeight: 600 }}>
              Reschedule: {weekStats.reschedule} ({weekStats.reschPct}%)
            </span>
            <span style={{ display: "inline-flex", alignItems: "center", gap: "4px", padding: "3px 10px", borderRadius: "12px", background: "rgba(234, 179, 8, 0.18)", color: "#facc15", border: "1px solid rgba(234, 179, 8, 0.35)", fontWeight: 600 }}>
              Pending: {weekStats.pending} ({weekStats.pendPct}%)
            </span>
            <span style={{ display: "inline-flex", alignItems: "center", gap: "4px", padding: "3px 10px", borderRadius: "12px", background: "rgba(239, 68, 68, 0.18)", color: "#f87171", border: "1px solid rgba(239, 68, 68, 0.35)", fontWeight: 600 }}>
              Need Attention: {weekStats.attention} ({weekStats.attPct}%)
            </span>
            <span style={{ display: "inline-flex", alignItems: "center", gap: "4px", padding: "3px 10px", borderRadius: "12px", background: "rgba(249, 115, 22, 0.18)", color: "#fb923c", border: "1px solid rgba(249, 115, 22, 0.35)", fontWeight: 600 }}>
              O&M / Callbacks: {weekStats.om} ({weekStats.omPct}%)
            </span>
          </div>
          <div style={{ fontSize: "0.78rem", opacity: 0.8, fontStyle: "italic" }}>
            Suggested Ratio: <strong>65% New · 15% Reschedule · 10% Pending · 5% Need Attention · 5% O&M</strong>
          </div>
        </div>
      )}

      {notice && (
        <div className="rti-notice" role="status">
          {notice}
          <button type="button" className="icon-button" aria-label="Dismiss" onClick={() => setNotice(null)}>
            <X size={14} />
          </button>
        </div>
      )}

      {displayedSchedules.flatMap((weekSchedule) => {
        const currentWeekStart = weekSchedule.weekStart;
        return weekSchedule.teams.map((team) => {
          const hasSearchQuery = Boolean(searchQuery && searchQuery.trim().length > 0);
          const searchTrimmed = searchQuery?.trim().toLowerCase() ?? "";
          const jobMatchesQuery = (job: InstallationJob) => {
            if (!hasSearchQuery) return true;
            return (
              job.customerName?.toLowerCase().includes(searchTrimmed) ||
              job.invoiceNumber?.toLowerCase().includes(searchTrimmed) ||
              job.address?.toLowerCase().includes(searchTrimmed) ||
              job.city?.toLowerCase().includes(searchTrimmed) ||
              job.state?.toLowerCase().includes(searchTrimmed) ||
              job.postcode?.toLowerCase().includes(searchTrimmed)
            );
          };

          const matchingCustomerEntries = team.days.flatMap((day) =>
            day.entries.filter((entry) => {
              if (!entry.jobId) return false;
              const job = jobById.get(entry.jobId);
              return job ? jobMatchesQuery(job) : false;
            }),
          );

          if (hasSearchQuery && matchingCustomerEntries.length === 0) {
            return null;
          }

          const filled = team.days.reduce(
            (total, day) =>
              total +
              day.entries.reduce((sum, entry) => sum + (entry.jobId ? (entry.slot === "full" ? 2 : 1) : 0), 0),
            0,
          );
          return (
            <div className={`table-wrap rti-team rti-team-${team.team}`} key={`${currentWeekStart}-${team.team}`}>
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
                  <col className="rti-col-sld" />
                  <col className="rti-col-remark" />
                </colgroup>
                <thead>
                  <tr className="rti-team-band rti-team-band-sub">
                    <th colSpan={COLUMN_COUNT}>
                      <span>Week {weekLabel(currentWeekStart)}</span>
                      <span>
                        Hard {team.hard} · far {team.far}
                      </span>
                      <span>{Math.min(filled, 12)} of 12 slots filled</span>
                    </th>
                  </tr>
                  <tr className="rti-team-band rti-team-band-main">
                    <th colSpan={COLUMN_COUNT}>
                      <div className="rti-team-header-main">
                        <div className="rti-team-title-wrap">
                          <span className="rti-team-name">Team {team.team}</span>
                          <span className="rti-team-base">{REGION_LABEL[TEAM_REGION[team.team]]}</span>
                        </div>
                        <div className="rti-crew-grid">
                          <div className="rti-crew-col">
                            <label className="rti-crew-label" htmlFor={`crew-inst-${currentWeekStart}-${team.team}`}>
                              Installation Team
                            </label>
                            <input
                              id={`crew-inst-${currentWeekStart}-${team.team}`}
                              type="text"
                              list={`install-teams-list-${team.team}`}
                              className="rti-crew-input"
                              value={scheduleDraft.teamCrews?.[team.team]?.installationTeam ?? ""}
                              placeholder="Assign installation team..."
                              onChange={(e) => updateCrewField(team.team, "installationTeam", e.target.value)}
                              onBlur={(e) => handleCrewBlur(team.team, "installationTeam", e.target.value)}
                              onKeyDown={(e) => {
                                if (e.key === "Enter") (e.target as HTMLInputElement).blur();
                              }}
                            />
                            <datalist id={`install-teams-list-${team.team}`}>
                              {availableInstallTeams.map((name) => (
                                <option key={name} value={name} />
                              ))}
                            </datalist>
                          </div>

                          <div className="rti-crew-col">
                            <label className="rti-crew-label" htmlFor={`crew-wir-${currentWeekStart}-${team.team}`}>
                              Wiring Team
                            </label>
                            <input
                              id={`crew-wir-${currentWeekStart}-${team.team}`}
                              type="text"
                              list={`wiring-teams-list-${team.team}`}
                              className="rti-crew-input"
                              value={scheduleDraft.teamCrews?.[team.team]?.wiringTeam ?? ""}
                              placeholder="Assign wiring team..."
                              onChange={(e) => updateCrewField(team.team, "wiringTeam", e.target.value)}
                              onBlur={(e) => handleCrewBlur(team.team, "wiringTeam", e.target.value)}
                              onKeyDown={(e) => {
                                if (e.key === "Enter") (e.target as HTMLInputElement).blur();
                              }}
                            />
                            <datalist id={`wiring-teams-list-${team.team}`}>
                              {availableWiringTeams.map((name) => (
                                <option key={name} value={name} />
                              ))}
                            </datalist>
                          </div>

                          <div className="rti-crew-col">
                            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                              <label className="rti-crew-label" htmlFor={`crew-sup-${currentWeekStart}-${team.team}`}>
                                Site Supervisor
                              </label>
                              <button
                                type="button"
                                className="icon-button"
                                title="Add another supervisor (+)"
                                style={{
                                  padding: "1px 4px",
                                  height: "18px",
                                  fontSize: "0.75rem",
                                  borderRadius: "3px",
                                  cursor: "pointer",
                                  display: "inline-flex",
                                  alignItems: "center",
                                  gap: 2,
                                  background: "rgba(255, 255, 255, 0.15)",
                                  color: "inherit",
                                  border: "none",
                                }}
                                 onClick={() => {
                                  const current = scheduleDraft.teamCrews?.[team.team]?.siteSupervisor ?? "";
                                  if (!current) {
                                    const el = document.getElementById(`crew-sup-${currentWeekStart}-${team.team}`) as HTMLInputElement;
                                    el?.focus();
                                  } else if (!current.endsWith(", ")) {
                                    updateCrewField(team.team, "siteSupervisor", `${current.trim()}, `);
                                  }
                                }}
                              >
                                <Plus size={11} />
                              </button>
                            </div>
                            <input
                              id={`crew-sup-${currentWeekStart}-${team.team}`}
                              type="text"
                              list={`supervisors-list-${team.team}`}
                              className="rti-crew-input"
                              value={scheduleDraft.teamCrews?.[team.team]?.siteSupervisor ?? ""}
                              placeholder="e.g. Kaijie, Martin Hing..."
                              onChange={(e) => updateCrewField(team.team, "siteSupervisor", e.target.value)}
                              onBlur={(e) => handleCrewBlur(team.team, "siteSupervisor", e.target.value)}
                              onKeyDown={(e) => {
                                if (e.key === "Enter") (e.target as HTMLInputElement).blur();
                              }}
                            />
                            <datalist id={`supervisors-list-${team.team}`}>
                              {availableSupervisors.map((name) => (
                                <option key={name} value={name} />
                              ))}
                            </datalist>
                          </div>

                          <div className="rti-crew-col">
                            <label className="rti-crew-label" htmlFor={`crew-mem-${currentWeekStart}-${team.team}`}>
                              Team member
                            </label>
                            <input
                              id={`crew-mem-${currentWeekStart}-${team.team}`}
                              type="text"
                              className="rti-crew-input"
                              value={scheduleDraft.teamCrews?.[team.team]?.membersText ?? ""}
                              placeholder="e.g. Ali, Ah Hock, Kumar..."
                              onChange={(e) => updateCrewField(team.team, "membersText", e.target.value)}
                              onBlur={(e) => handleCrewBlur(team.team, "membersText", e.target.value)}
                              onKeyDown={(e) => {
                                if (e.key === "Enter") (e.target as HTMLInputElement).blur();
                              }}
                            />
                          </div>

                          <div className="rti-crew-col">
                            <label className="rti-crew-label" htmlFor={`crew-car-${currentWeekStart}-${team.team}`}>
                              Car
                            </label>
                            <input
                              id={`crew-car-${currentWeekStart}-${team.team}`}
                              type="text"
                              list={`cars-list-${team.team}`}
                              className="rti-crew-input"
                              value={scheduleDraft.teamCrews?.[team.team]?.car ?? ""}
                              placeholder="e.g. Van, Hilux..."
                              onChange={(e) => updateCrewField(team.team, "car", e.target.value)}
                              onBlur={(e) => handleCrewBlur(team.team, "car", e.target.value)}
                              onKeyDown={(e) => {
                                if (e.key === "Enter") (e.target as HTMLInputElement).blur();
                              }}
                            />
                            <datalist id={`cars-list-${team.team}`}>
                              {availableCars.map((name) => (
                                <option key={name} value={name} />
                              ))}
                            </datalist>
                          </div>
                        </div>
                      </div>
                    </th>
                  </tr>
                  <tr>
                    <th>Slot</th>
                    <th>Customer</th>
                    <th>Address</th>
                    <th>Phone</th>
                    <th>Email</th>
                    <th>Agent</th>
                    <th>Phase</th>
                    <th>Panel</th>
                    <th>Inverter</th>
                    <th>SLD</th>
                    <th>Remark</th>
                  </tr>
                </thead>
                <tbody>
                  {team.days.flatMap((day) =>
                    day.entries.map((entry, index) => {
                      const ref: SlotRef = { weekStart: currentWeekStart, team: team.team, date: day.date, slot: entry.slot };
                    const key = `${day.date}-${entry.slot}-${index}`;
                    const renderSlotCell = (job?: InstallationJob | null) => {
                      const defaultTime = entry.slot === "am" ? "09:00" : entry.slot === "pm" ? "14:00" : "Full day";
                      const currentTime = job?.preferredInstallationTime || defaultTime;
                      const fieldKey = job ? job.id : key;
                      return (
                        <td className="rti-date">
                          <strong>{dayLabel(day.date)}</strong>
                          <input
                            type="text"
                            list="rti-slot-time-presets"
                            className="rti-slot-select"
                            style={{ width: "100%", marginTop: "4px", padding: "2px 4px", fontSize: "0.8rem" }}
                            value={timeDraft[fieldKey] ?? currentTime}
                            placeholder="e.g. 09:00, 14:00, 16:00..."
                            aria-label={`Time for ${job ? displayName(job.customerName) : `Team ${team.team}`} on ${dayLabel(day.date)}`}
                            onChange={(e) => {
                              const val = e.target.value;
                              setTimeDraft((prev) => ({ ...prev, [fieldKey]: val }));
                              const valLower = val.toLowerCase().trim();
                              let targetSlot: Slot = entry.slot;
                              if (valLower.includes("full")) {
                                targetSlot = "full";
                              } else {
                                const hourMatch = val.match(/(\d{1,2}):\d{2}/);
                                if (hourMatch) {
                                  const hour = parseInt(hourMatch[1], 10);
                                  targetSlot = hour >= 12 ? "pm" : "am";
                                }
                              }
                              if (targetSlot !== entry.slot) {
                                if (job) {
                                  changeSlot(job.id, ref, targetSlot);
                                } else {
                                  changeOpenSlot(ref, targetSlot);
                                }
                              }
                            }}
                            onBlur={() => {
                              const val = timeDraft[fieldKey];
                              if (job && val !== undefined && val !== job.preferredInstallationTime) {
                                onSaveJob?.({ ...job, preferredInstallationTime: val.trim() || null });
                              }
                            }}
                            onKeyDown={(e) => {
                              if (e.key === "Enter") (e.target as HTMLInputElement).blur();
                            }}
                          />
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
                          {renderSlotRain(team.team, day.date)}
                        </td>
                      );
                    };
                    if (!entry.jobId) {
                      if (hasSearchQuery) return null;
                      return (
                        <tr key={key} className="rti-open-row">
                          {renderSlotCell(null)}
                          <td colSpan={COLUMN_COUNT - 1}>
                            <span className="rti-muted">
                              Open{entry.openReason ? ` · ${entry.openReason}` : ""}
                            </span>
                            {entry.openReason !== "Rain day on hold" && queue.length > 0 && (
                              <OpenSlotCustomerSearch
                                queue={queue}
                                bookedJobIds={bookedJobIds}
                                positions={positions}
                                onSelectCustomer={(jobId) => addToSlot(jobId, ref)}
                              />
                            )}
                          </td>
                        </tr>
                      );
                    }
                    const job = jobById.get(entry.jobId);
                    if (!job || job.customerAvailabilityStatus === "complete") return null;
                    if (hasSearchQuery && !jobMatchesQuery(job)) return null;
                    const candidate = candidateById.get(job.id);
                    const isBooked = entry.source === "booked";
                    const dropHere = panel?.kind === "drop" && panel.jobId === job.id ? panel : null;
                    const focused = focusJobId === job.id;
                    return (
                      <Fragment key={key}>
                        <tr
                          id={`rti-row-${job.id}`}
                          className={`rti-row is-${entry.source}${focused ? " is-focused" : ""}`}
                        >
                          {renderSlotCell(job)}
                          <td>
                            <div className="rti-customer-wrap">
                              <button
                                type="button"
                                className="rti-row-remove-btn"
                                title="Remove customer from list (-)"
                                aria-label={`Remove ${displayName(job.customerName)} from schedule`}
                                onClick={(e) => {
                                  e.stopPropagation();
                                  removeCustomerFromSlot(job.id, ref);
                                }}
                              >
                                <Minus size={11} strokeWidth={2.8} />
                              </button>
                              <button
                                type="button"
                                className="rti-name-link"
                                title={`SEDA approved: ${job.sedaApprovedDate ? shortDate(job.sedaApprovedDate) : isSedaApproved(job.sedaStatus) ? "Approved" : (job.sedaStatus || "Pending")} · 2nd payment: ${shortDate(job.secondPaymentDate) || "–"}\nClick to see in queue`}
                                onClick={() => onOpenInQueue(job.id)}
                              >
                                {displayName(job.customerName)}
                              </button>
                              <div className="rti-customer-popover" role="tooltip">
                                <div className="rti-customer-popover-row">
                                  <span className="rti-customer-popover-label">SEDA approved:</span>
                                  <span className="rti-customer-popover-val">{sedaCell(job)}</span>
                                </div>
                                <div className="rti-customer-popover-row">
                                  <span className="rti-customer-popover-label">2nd payment:</span>
                                  <span className="rti-customer-popover-val">{shortDate(job.secondPaymentDate) || "–"}</span>
                                </div>
                                <div className="rti-customer-popover-row">
                                  <span className="rti-customer-popover-label">Payment status:</span>
                                  <span className="rti-customer-popover-val">
                                    {(job.paymentPercent ?? 0).toFixed(2)}% paid
                                  </span>
                                </div>
                              </div>
                            </div>
                            <span className="rti-muted rti-invoice">{job.invoiceNumber}</span>
                            {tags(job, isBooked ? undefined : candidate, entry)}
                          </td>
                          <td>
                            <button
                              type="button"
                              className={`rti-link rti-address${mapJobId === job.id ? " is-active" : ""}`}
                              onClick={() => onShowOnMap(job.id)}
                              title="Show on the map"
                            >
                              <MapPin size={13} />
                              {titleCase(job.address) || "Address not available"}
                            </button>
                            {entry.pairDistanceKm !== undefined && (
                              <span className="rti-muted">
                                {entry.pairDistanceKm < 1
                                  ? "Same area as the other house"
                                  : `${entry.pairDistanceKm.toFixed(1)} km from the other house`}
                              </span>
                            )}
                          </td>
                          <td>{formatPhone(job.customerPhone) || "–"}</td>
                          <td className="rti-email">{job.customerEmail || "–"}</td>
                          <td className="rti-agent">{job.agentName?.trim().toUpperCase() || "–"}</td>
                          <td>{phaseText(job)}</td>
                          <td className="rti-edit-cell">
                            <textarea
                              className="rti-cell-textarea"
                              rows={2}
                              value={panelDraft[job.id] ?? panelText(job)}
                              placeholder="e.g. 16 Jinko 650W"
                              aria-label={`Panel for ${displayName(job.customerName)}`}
                              onChange={(e) => handlePanelChange(job.id, e.target.value)}
                              onBlur={() => handlePanelBlur(job)}
                            />
                          </td>
                          <td className="rti-edit-cell">
                            <textarea
                              className="rti-cell-textarea"
                              rows={2}
                              value={inverterDraft[job.id] ?? inverterText(job)}
                              placeholder="e.g. 10kW Hybrid"
                              aria-label={`Inverter for ${displayName(job.customerName)}`}
                              onChange={(e) => handleInverterChange(job.id, e.target.value)}
                              onBlur={() => handleInverterBlur(job)}
                            />
                          </td>
                          <td>
                            {filesButton(job)}
                            {assessments[job.id]?.difficulty && (
                              <span
                                className={`rti-tag is-${assessments[job.id].difficulty}`}
                                style={{ marginTop: 4, display: "block", width: "fit-content" }}
                                title={
                                  assessments[job.id]?.note?.trim()
                                    ? `Remarks: ${assessments[job.id].note.trim()}`
                                    : `Difficulty: ${assessments[job.id].difficulty}`
                                }
                              >
                                {assessments[job.id].difficulty}
                              </span>
                            )}
                          </td>
                          <td className="rti-edit-cell rti-remark-cell">
                            <textarea
                              className="rti-cell-textarea"
                              rows={2}
                              value={remarkDraft[job.id] ?? (job.installationRemarks || "")}
                              placeholder="Add remark…"
                              aria-label={`Remark for ${displayName(job.customerName)}`}
                              onChange={(e) => handleRemarkChange(job.id, e.target.value)}
                              onBlur={() => handleRemarkBlur(job)}
                            />
                          </td>
                        </tr>
                        {dropHere && (
                          <tr className="rti-panel-row">
                            <td colSpan={COLUMN_COUNT}>{dropPanel(job.id, dropHere.ref)}</td>
                          </tr>
                        )}
                        {filesJobId === job.id && (
                          <tr className="rti-panel-row">
                            <td colSpan={COLUMN_COUNT}>{filesPanel(job)}</td>
                          </tr>
                        )}
                      </Fragment>
                    );
                  }),
                )}
              </tbody>
            </table>
          </div>
        );
      })})}
      {queueNumber.size === 0 && (
        <p className="rti-muted">Nobody is in the queue right now.</p>
      )}
    </div>
  );
}
