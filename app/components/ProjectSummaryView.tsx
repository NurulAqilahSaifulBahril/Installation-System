"use client";

import type { CSSProperties } from "react";
import { useEffect, useMemo, useRef, useState } from "react";
import { ChevronDown, Plus, Search, Trash2, Upload, X } from "lucide-react";
import type { InstallationJob } from "@/lib/types";
import { extractPanelBrand, formatPanelDisplay } from "@/lib/panel-utils";

type SummaryGroup = {
  id: string;
  name: string;
  installationDate: string;
  installationEndDate: string;
  jobIds: string[];
  installationTeam?: string;
  wiringTeam?: string;
  wiringMembers?: string[];
  supervisors?: string[];
  supervisor?: string;
};

export type ProjectSummaryInfo = {
  jobId: string;
  invoiceNumber: string;
  customer: string;
  installationDate: string;
  siteSupervisor: string;
  installerTeamMembers: string;
  salesAgent: string;
  location: string;
  inverterModel: string;
  solarPanelBrand: string;
  panelWattage: string;
  panelQuantity: string;
  projectSize: string;
  battery: string;
  ats: string;
  ballast: string;
  evCharger: string;
};

export type AttendanceTeamLog = {
  attendanceMembers: string;
  departure: string;
  arrival: string;
  photoName: string;
  photoDataUrl: string;
};

export type SiteAttendanceVisit = {
  id: string;
  date: string;
  workDone: "Installation Complete" | "Installation Pending";
  visitRemarks: string;
  siteSupervisor: AttendanceTeamLog;
  installerTeam: AttendanceTeamLog;
};

export type ChecklistStatus =
  | "Completed"
  | "Unable to Complete"
  | "Not Applicable";

export type ChecklistItemState = {
  status: ChecklistStatus;
  remarks: string;
};

const CHECKLIST_STATUS_OPTIONS: ChecklistStatus[] = [
  "Completed",
  "Unable to Complete",
  "Not Applicable",
];

function createEmptyVisit(overrides?: Partial<SiteAttendanceVisit>): SiteAttendanceVisit {
  return {
    id: `visit-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    date: "",
    workDone: "Installation Complete",
    visitRemarks: "",
    siteSupervisor: {
      attendanceMembers: "",
      departure: "",
      arrival: "",
      photoName: "",
      photoDataUrl: "",
    },
    installerTeam: {
      attendanceMembers: "",
      departure: "",
      arrival: "",
      photoName: "",
      photoDataUrl: "",
    },
    ...overrides,
  };
}

const FIELD_LABEL_STYLE: CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: "6px",
  minWidth: 0,
  margin: 0,
};

const FIELD_CAPTION_STYLE: CSSProperties = {
  fontSize: "12px",
  fontWeight: 600,
  color: "var(--muted)",
  lineHeight: 1.2,
};

const FIELD_INPUT_STYLE: CSSProperties = {
  width: "100%",
  height: "38px",
  padding: "0 12px",
  boxSizing: "border-box",
  fontSize: "13px",
  fontWeight: 500,
  color: "var(--ink)",
  background: "var(--surface)",
  border: "1px solid var(--line)",
  borderRadius: "9px",
};

const FIELD_TEXTAREA_STYLE: CSSProperties = {
  width: "100%",
  minHeight: "76px",
  padding: "10px 12px",
  boxSizing: "border-box",
  fontSize: "13px",
  fontWeight: 500,
  color: "var(--ink)",
  background: "var(--surface)",
  border: "1px solid var(--line)",
  borderRadius: "9px",
  resize: "vertical",
  fontFamily: "inherit",
};

const SUBCARD_STYLE: CSSProperties = {
  display: "grid",
  gap: "12px",
  padding: "14px",
  borderRadius: "10px",
  background: "var(--surface-soft)",
  border: "1px solid var(--line)",
};

function parsePanelQtyAndWattage(job: InstallationJob): {
  qty: number | null;
  wattage: number | null;
  brand: string;
} {
  const panelText = [
    formatPanelDisplay(job),
    job.powerOutput,
    job.panelDetails,
    job.packageName,
  ]
    .filter(Boolean)
    .join("\n");

  const brand = extractPanelBrand(panelText) || "—";

  let qty = job.panelQuantity && job.panelQuantity > 0 ? job.panelQuantity : null;
  let wattage =
    job.panelRating && job.panelRating > 0 ? job.panelRating : null;

  if (!qty) {
    const qtyMatch =
      panelText.match(/^\s*\(?(\d+)\)?\s*[xX×]/m) ||
      panelText.match(/\b(\d+)\s*(?:pcs|panels?)\b/i) ||
      panelText.match(/\b(\d+)\s+(?:Jinko|Astronergy|JA\s*Solar|Longi|Trina|Canadian)/i);
    if (qtyMatch) {
      const parsed = Number.parseInt(qtyMatch[1], 10);
      if (Number.isFinite(parsed) && parsed > 0) qty = parsed;
    }
  }

  if (!wattage) {
    const wattMatch = panelText.match(/\b([3-8]\d{2})\s*W\b/i);
    if (wattMatch) {
      const parsed = Number.parseInt(wattMatch[1], 10);
      if (Number.isFinite(parsed) && parsed > 0) wattage = parsed;
    }
  }

  return { qty, wattage, brand };
}

function extractInverterModel(job: InstallationJob): string {
  const raw =
    job.inverterBattery?.trim() ||
    job.derivedInverterModel?.trim() ||
    job.inverter?.trim() ||
    "";
  if (!raw || /^not\s+available$/i.test(raw)) return "—";
  const parts = raw
    .split(/\s*\+\s*(?=ADD\s*ON|(?:\d+\s*[xX×]\s*)?ATS\b|BALLAST\b|FOC\b)/i)[0]
    ?.trim();
  return parts || raw;
}

function extractBattery(job: InstallationJob): string {
  if (
    job.battery &&
    !/^(none|not\s+included|not\s+available|-|—)$/i.test(job.battery.trim())
  ) {
    return job.battery.trim();
  }
  if (
    job.batteryDetails &&
    !/^(none|not\s+included|not\s+available|-|—)$/i.test(
      job.batteryDetails.trim(),
    )
  ) {
    return job.batteryDetails.trim();
  }
  const combined = `${job.inverterBattery || ""}\n${job.packageName || ""}`;
  const battMatch = combined.match(
    /([^\n+]*\b(?:battery|bess|kwh|hs3|b2-|lfp)\b[^\n+]*)/i,
  );
  if (battMatch?.[1]?.trim()) return battMatch[1].trim();
  return "None";
}

function extractAts(job: InstallationJob): string {
  const combined = [
    job.inverterBattery,
    job.focDetails,
    job.wiringDetails,
    job.packageName,
    job.remarks,
    job.installationRemarks,
  ]
    .filter(Boolean)
    .join("\n");

  const match = combined.match(
    /(?:ADD\s*ON\s*)?(\d+\s*[xX×]\s*ATS\b|\bATS\b(?:\s*[-:]?\s*[A-Za-z0-9]+)?)/i,
  );
  if (match?.[1]?.trim()) return match[1].trim();
  return "None";
}

function extractBallast(job: InstallationJob): string {
  if (job.ballastDetails?.trim()) return job.ballastDetails.trim();
  const combined = [
    job.inverterBattery,
    job.focDetails,
    job.packageName,
    job.installationRemarks,
  ]
    .filter(Boolean)
    .join("\n");
  const match = combined.match(/([^\n+]*\bballast\b[^\n+]*)/i);
  if (match?.[1]?.trim()) return match[1].trim();
  return "None";
}

function extractEvCharger(job: InstallationJob): string {
  if (job.evDetails?.trim()) return job.evDetails.trim();
  const combined = [job.packageName, job.inverterBattery, job.focDetails]
    .filter(Boolean)
    .join("\n");
  const match = combined.match(
    /([^\n+]*\b(?:ev\s*charger|wallbox|ac\s*charger)\b[^\n+]*)/i,
  );
  if (match?.[1]?.trim()) return match[1].trim();
  return "None";
}

export function buildProjectSummaryFromJob(
  job: InstallationJob,
  groups: SummaryGroup[],
): ProjectSummaryInfo {
  const matchedGroups = groups.filter((g) => g.jobIds.includes(job.id));
  const supervisorsFromGroups = Array.from(
    new Set(
      matchedGroups.flatMap((g) =>
        g.supervisors && g.supervisors.length > 0
          ? g.supervisors
          : g.supervisor
          ? [g.supervisor]
          : [],
      ),
    ),
  ).filter(Boolean);

  const supervisorsFromJob = (job.teams ?? [])
    .filter((t) => t.role === "supervisor" && t.teamName?.trim())
    .map((t) => t.teamName.trim());

  const siteSupervisor =
    supervisorsFromGroups.join(", ") ||
    supervisorsFromJob.join(", ") ||
    "—";

  const installerParts = Array.from(
    new Set(
      matchedGroups.flatMap((g) => [
        g.installationTeam?.trim() || "",
        g.wiringTeam?.trim() || "",
        ...(g.wiringMembers ?? []).map((m) => m.trim()),
      ]),
    ),
  ).filter((v) => v && !/^unassigned$/i.test(v));

  const installerTeamMembers = installerParts.join(", ");

  const installationDate =
    job.installationDate ||
    job.preferredInstallationDate ||
    matchedGroups[0]?.installationDate ||
    "—";

  const location =
    [job.address, job.city, job.state, job.postcode]
      .map((s) => s?.trim())
      .filter(Boolean)
      .join(", ") || "—";

  const { qty, wattage, brand } = parsePanelQtyAndWattage(job);
  const projectSizeKwp =
    qty && wattage ? `${((qty * wattage) / 1000).toFixed(2)} kWp` : "—";

  return {
    jobId: job.id,
    invoiceNumber: job.invoiceNumber || "",
    customer: job.customerName || "—",
    installationDate,
    siteSupervisor,
    installerTeamMembers,
    salesAgent: job.agentName || "—",
    location,
    inverterModel: extractInverterModel(job),
    solarPanelBrand: brand,
    panelWattage: wattage ? `${wattage}W` : "—",
    panelQuantity: qty ? String(qty) : "—",
    projectSize: projectSizeKwp,
    battery: extractBattery(job),
    ats: extractAts(job),
    ballast: extractBallast(job),
    evCharger: extractEvCharger(job),
  };
}

function AttendanceTeamBlock({
  title,
  value,
  onChange,
}: {
  title: string;
  value: AttendanceTeamLog;
  onChange: (next: AttendanceTeamLog) => void;
}) {
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      onChange({
        ...value,
        photoName: file.name,
        photoDataUrl: typeof reader.result === "string" ? reader.result : "",
      });
    };
    reader.readAsDataURL(file);
  }

  return (
    <div style={SUBCARD_STYLE}>
      <h4
        style={{
          margin: 0,
          fontSize: "0.88rem",
          fontWeight: 700,
          color: "var(--ink)",
        }}
      >
        {title}
      </h4>

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(2, minmax(0, 1fr))",
          columnGap: "14px",
          rowGap: "12px",
          alignItems: "start",
        }}
      >
        <label style={{ ...FIELD_LABEL_STYLE, gridColumn: "1 / -1" }}>
          <span style={FIELD_CAPTION_STYLE}>Attendance Members</span>
          <input
            type="text"
            placeholder={`Enter ${title.toLowerCase()} attendance members...`}
            value={value.attendanceMembers}
            onChange={(e) =>
              onChange({ ...value, attendanceMembers: e.target.value })
            }
            style={FIELD_INPUT_STYLE}
          />
        </label>

        <label style={FIELD_LABEL_STYLE}>
          <span style={FIELD_CAPTION_STYLE}>Departure Arrival</span>
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "1fr 1fr",
              gap: "8px",
            }}
          >
            <input
              type="time"
              aria-label={`${title} Departure`}
              title="Departure time"
              value={value.departure}
              onChange={(e) => onChange({ ...value, departure: e.target.value })}
              style={FIELD_INPUT_STYLE}
            />
            <input
              type="time"
              aria-label={`${title} Arrival`}
              title="Arrival time"
              value={value.arrival}
              onChange={(e) => onChange({ ...value, arrival: e.target.value })}
              style={FIELD_INPUT_STYLE}
            />
          </div>
        </label>

        <div style={FIELD_LABEL_STYLE}>
          <span style={FIELD_CAPTION_STYLE}>
            Check-in / Arrival time-stamp photo
          </span>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: "8px",
              height: "38px",
            }}
          >
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              onChange={handleFileChange}
              style={{ display: "none" }}
            />
            <button
              type="button"
              className="button secondary"
              onClick={() => fileInputRef.current?.click()}
              style={{
                height: "38px",
                padding: "0 12px",
                fontSize: "12.5px",
                display: "inline-flex",
                alignItems: "center",
                gap: "6px",
                whiteSpace: "nowrap",
              }}
            >
              <Upload size={14} />
              {value.photoName ? "Change Photo" : "Upload Photo"}
            </button>
            <div
              style={{
                flex: 1,
                minWidth: 0,
                height: "38px",
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                gap: "6px",
                padding: "0 10px",
                borderRadius: "9px",
                border: "1px solid var(--line)",
                background: "var(--surface)",
                fontSize: "12px",
                color: value.photoName ? "var(--ink)" : "var(--muted)",
              }}
            >
              <span
                style={{
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                }}
                title={value.photoName || "No photo uploaded"}
              >
                {value.photoName || "No photo chosen"}
              </span>
              {value.photoName && (
                <button
                  type="button"
                  aria-label="Remove photo"
                  onClick={() =>
                    onChange({ ...value, photoName: "", photoDataUrl: "" })
                  }
                  style={{
                    border: 0,
                    background: "transparent",
                    color: "var(--muted)",
                    padding: "2px",
                    cursor: "pointer",
                    display: "inline-flex",
                    alignItems: "center",
                  }}
                >
                  <X size={13} />
                </button>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

export default function ProjectSummaryView({
  jobs,
  groups,
  readOnly = false,
}: {
  jobs: InstallationJob[];
  groups: SummaryGroup[];
  readOnly?: boolean;
}) {
  const [showAddModal, setShowAddModal] = useState(false);
  const [activeModalTab, setActiveModalTab] = useState<1 | 2 | 3 | 4 | 5>(1);
  const [customerQuery, setCustomerQuery] = useState("");
  const [customerDropdownOpen, setCustomerDropdownOpen] = useState(false);
  const [selectedJobId, setSelectedJobId] = useState<string>("");
  const [extraCharges, setExtraCharges] = useState<"No" | "Yes">("No");
  const [tnbApplicationStatus, setTnbApplicationStatus] = useState<
    "Ready/Proceed" | "Not Ready/ On Hold"
  >("Ready/Proceed");
  const [adminRemarks, setAdminRemarks] = useState<string>("");
  const [visits, setVisits] = useState<SiteAttendanceVisit[]>(() => [
    createEmptyVisit(),
  ]);
  const [siteCompletedToday, setSiteCompletedToday] = useState<
    "Completed" | "Incompleted"
  >("Completed");
  const [roofStructureCheck, setRoofStructureCheck] =
    useState<ChecklistItemState>({
      status: "Completed",
      remarks: "",
    });
  const [solarPanelInstallationWork, setSolarPanelInstallationWork] =
    useState<ChecklistStatus>("Completed");
  const [solarPanelAligned, setSolarPanelAligned] =
    useState<ChecklistStatus>("Completed");
  const [solarPanelApprovedDesign, setSolarPanelApprovedDesign] =
    useState<ChecklistStatus>("Completed");
  const [solarPanelRemarks, setSolarPanelRemarks] = useState<string>("");
  const [wiringTrunkingWorks, setWiringTrunkingWorks] =
    useState<ChecklistStatus>("Completed");
  const [wiringEarthingCable, setWiringEarthingCable] =
    useState<ChecklistStatus>("Completed");
  const [wiringAcConnected, setWiringAcConnected] =
    useState<ChecklistStatus>("Completed");
  const [wiringProtectedConduit, setWiringProtectedConduit] =
    useState<ChecklistStatus>("Completed");
  const [wiringCasingRestored, setWiringCasingRestored] =
    useState<ChecklistStatus>("Completed");
  const [wiringRemarks, setWiringRemarks] = useState<string>("");
  const customerDropdownRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!customerDropdownOpen) return;
    function handleOutsideClick(e: MouseEvent) {
      if (
        customerDropdownRef.current &&
        !customerDropdownRef.current.contains(e.target as Node)
      ) {
        setCustomerDropdownOpen(false);
      }
    }
    document.addEventListener("mousedown", handleOutsideClick);
    return () => document.removeEventListener("mousedown", handleOutsideClick);
  }, [customerDropdownOpen]);

  const filteredJobs = useMemo(() => {
    const q = customerQuery.trim().toLowerCase();
    if (!q) return jobs.slice(0, 80);
    return jobs
      .filter(
        (j) =>
          j.customerName?.toLowerCase().includes(q) ||
          j.invoiceNumber?.toLowerCase().includes(q) ||
          j.city?.toLowerCase().includes(q) ||
          j.state?.toLowerCase().includes(q) ||
          j.agentName?.toLowerCase().includes(q),
      )
      .slice(0, 80);
  }, [jobs, customerQuery]);

  const selectedJob = useMemo(
    () => jobs.find((j) => j.id === selectedJobId) ?? null,
    [jobs, selectedJobId],
  );

  const projectInfo = useMemo(
    () =>
      selectedJob ? buildProjectSummaryFromJob(selectedJob, groups) : null,
    [selectedJob, groups],
  );

  function handleSelectCustomerJob(job: InstallationJob) {
    setSelectedJobId(job.id);
    setCustomerQuery("");
    setCustomerDropdownOpen(false);
    const info = buildProjectSummaryFromJob(job, groups);
    setVisits((prev) =>
      prev.map((v, idx) =>
        idx === 0
          ? {
              ...v,
              date:
                v.date ||
                (info.installationDate !== "—" ? info.installationDate : ""),
              siteSupervisor: {
                ...v.siteSupervisor,
                attendanceMembers:
                  v.siteSupervisor.attendanceMembers ||
                  (info.siteSupervisor !== "—" ? info.siteSupervisor : ""),
              },
              installerTeam: {
                ...v.installerTeam,
                attendanceMembers:
                  v.installerTeam.attendanceMembers || info.installerTeamMembers,
              },
            }
          : v,
      ),
    );
  }

  const otherProjectFields: { label: string; value: string }[] = [
    { label: "Installation Date", value: projectInfo?.installationDate ?? "" },
    { label: "Site Supervisor", value: projectInfo?.siteSupervisor ?? "" },
    { label: "Sales Agent", value: projectInfo?.salesAgent ?? "" },
    { label: "Location", value: projectInfo?.location ?? "" },
    { label: "Inverter Model", value: projectInfo?.inverterModel ?? "" },
    { label: "Solar Panel Brand", value: projectInfo?.solarPanelBrand ?? "" },
    { label: "Panel Wattage", value: projectInfo?.panelWattage ?? "" },
    { label: "Panel Quantity", value: projectInfo?.panelQuantity ?? "" },
    { label: "Project Size", value: projectInfo?.projectSize ?? "" },
    { label: "Battery", value: projectInfo?.battery ?? "" },
    { label: "ATS", value: projectInfo?.ats ?? "" },
    { label: "Ballast", value: projectInfo?.ballast ?? "" },
    { label: "EV Charger", value: projectInfo?.evCharger ?? "" },
  ];

  const customerInputDisplay = customerDropdownOpen
    ? customerQuery
    : selectedJob
    ? `${selectedJob.customerName}${
        selectedJob.invoiceNumber ? ` (${selectedJob.invoiceNumber})` : ""
      }`
    : customerQuery;

  return (
    <div className="project-summary-page" style={{ padding: "16px 0" }}>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          marginBottom: "20px",
        }}
      >
        <div>
          <h2 style={{ margin: 0, fontSize: "1.25rem", fontWeight: 700 }}>
            Project Summary
          </h2>
        </div>
        {!readOnly && (
          <button
            type="button"
            className="button primary"
            onClick={() => {
              setCustomerQuery("");
              setSelectedJobId("");
              setExtraCharges("No");
              setTnbApplicationStatus("Ready/Proceed");
              setAdminRemarks("");
              setVisits([createEmptyVisit()]);
              setSiteCompletedToday("Completed");
              setRoofStructureCheck({ status: "Completed", remarks: "" });
              setSolarPanelInstallationWork("Completed");
              setSolarPanelAligned("Completed");
              setSolarPanelApprovedDesign("Completed");
              setSolarPanelRemarks("");
              setWiringTrunkingWorks("Completed");
              setWiringEarthingCable("Completed");
              setWiringAcConnected("Completed");
              setWiringProtectedConduit("Completed");
              setWiringCasingRestored("Completed");
              setWiringRemarks("");
              setCustomerDropdownOpen(false);
              setActiveModalTab(1);
              setShowAddModal(true);
            }}
          >
            <Plus size={16} />
            Add Project Summary
          </button>
        )}
      </div>

      {showAddModal && (
        <div
          className="modal-backdrop"
          role="presentation"
          onClick={() => setShowAddModal(false)}
        >
          <div
            className="composer-modal"
            role="dialog"
            aria-modal="true"
            aria-label="Add Project Summary"
            style={{
              width: "min(1140px, calc(100vw - 48px))",
              maxWidth: "1140px",
              height: "min(780px, calc(100vh - 48px))",
              maxHeight: "calc(100vh - 48px)",
              display: "flex",
              flexDirection: "column",
              overflow: "hidden",
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="detail-header" style={{ flexShrink: 0 }}>
              <div>
                <p className="eyebrow">Project Summary</p>
                <h2>Add Project Summary</h2>
              </div>
              <button
                type="button"
                className="icon-button"
                aria-label="Close modal"
                onClick={() => setShowAddModal(false)}
              >
                <X size={18} />
              </button>
            </div>

            {/* Section Tabs */}
            <div
              role="tablist"
              aria-label="Project Summary Sections"
              style={{
                display: "flex",
                flexWrap: "wrap",
                gap: "8px",
                paddingBottom: "12px",
                marginBottom: "16px",
                borderBottom: "1px solid var(--line)",
                flexShrink: 0,
              }}
            >
              {(
                [
                  [1, "1. Project Information"],
                  [2, "2. Commercial & Admin Status"],
                  [3, "3. Site Attendance Log"],
                  [4, "4. Incomplete Work Follow-up"],
                  [5, "5. Installation & Completion Checklist"],
                ] as const
              ).map(([tabNum, tabLabel]) => {
                const isActive = activeModalTab === tabNum;
                return (
                  <button
                    key={tabNum}
                    type="button"
                    role="tab"
                    aria-selected={isActive}
                    onClick={() => setActiveModalTab(tabNum)}
                    style={{
                      height: "36px",
                      padding: "0 14px",
                      borderRadius: "8px",
                      border: isActive
                        ? "1px solid var(--primary)"
                        : "1px solid var(--line)",
                      background: isActive
                        ? "var(--primary)"
                        : "var(--surface-soft)",
                      color: isActive ? "#ffffff" : "var(--ink)",
                      fontSize: "12.5px",
                      fontWeight: 600,
                      cursor: "pointer",
                      whiteSpace: "nowrap",
                    }}
                  >
                    {tabLabel}
                  </button>
                );
              })}
            </div>

            <div
              style={{
                flex: 1,
                minHeight: 0,
                overflowY: "auto",
                paddingRight: "4px",
                display: "grid",
                alignContent: "start",
                gap: "22px",
              }}
            >
              {/* 1. Project Information */}
              {activeModalTab === 1 && (
              <div>
                <h3
                  style={{
                    margin: "0 0 12px 0",
                    fontSize: "0.95rem",
                    fontWeight: 700,
                    letterSpacing: "0.01em",
                  }}
                >
                  1. Project Information
                </h3>

                <div
                  style={{
                    display: "grid",
                    gridTemplateColumns: "repeat(2, minmax(0, 1fr))",
                    columnGap: "14px",
                    rowGap: "12px",
                    alignItems: "start",
                  }}
                >
                  {/* Customer box with built-in search & invoice dropdown */}
                  <div ref={customerDropdownRef} style={FIELD_LABEL_STYLE}>
                    <span style={FIELD_CAPTION_STYLE}>Customer</span>
                    <div style={{ position: "relative", width: "100%" }}>
                      <Search
                        size={14}
                        style={{
                          position: "absolute",
                          left: "11px",
                          top: "50%",
                          transform: "translateY(-50%)",
                          opacity: 0.55,
                          pointerEvents: "none",
                        }}
                      />
                      <input
                        type="text"
                        placeholder="Search customer or invoice (INV-...)..."
                        value={customerInputDisplay}
                        onFocus={() => {
                          setCustomerQuery("");
                          setCustomerDropdownOpen(true);
                        }}
                        onChange={(e) => {
                          setCustomerQuery(e.target.value);
                          setCustomerDropdownOpen(true);
                        }}
                        style={{
                          ...FIELD_INPUT_STYLE,
                          paddingLeft: "32px",
                          paddingRight: "54px",
                        }}
                      />
                      <div
                        style={{
                          position: "absolute",
                          right: "6px",
                          top: "50%",
                          transform: "translateY(-50%)",
                          display: "inline-flex",
                          alignItems: "center",
                          gap: "2px",
                        }}
                      >
                        {(selectedJobId || customerQuery) && (
                          <button
                            type="button"
                            aria-label="Clear customer"
                            onClick={() => {
                              setSelectedJobId("");
                              setCustomerQuery("");
                              setCustomerDropdownOpen(true);
                            }}
                            style={{
                              border: 0,
                              background: "transparent",
                              color: "var(--muted)",
                              padding: "4px",
                              cursor: "pointer",
                              display: "inline-flex",
                              alignItems: "center",
                            }}
                          >
                            <X size={13} />
                          </button>
                        )}
                        <button
                          type="button"
                          aria-label="Toggle customer dropdown"
                          onClick={() =>
                            setCustomerDropdownOpen((prev) => !prev)
                          }
                          style={{
                            border: 0,
                            background: "transparent",
                            color: "var(--muted)",
                            padding: "4px",
                            cursor: "pointer",
                            display: "inline-flex",
                            alignItems: "center",
                          }}
                        >
                          <ChevronDown size={14} />
                        </button>
                      </div>

                      {customerDropdownOpen && (
                        <div
                          style={{
                            position: "absolute",
                            top: "calc(100% + 4px)",
                            left: 0,
                            right: 0,
                            zIndex: 50,
                            maxHeight: "260px",
                            overflowY: "auto",
                            background: "var(--surface)",
                            border: "1px solid var(--line)",
                            borderRadius: "9px",
                            boxShadow: "0 12px 28px rgba(0, 0, 0, 0.16)",
                            padding: "4px",
                          }}
                        >
                          {filteredJobs.length === 0 ? (
                            <div
                              style={{
                                padding: "10px 12px",
                                fontSize: "12px",
                                color: "var(--muted)",
                              }}
                            >
                              No matching customer or invoice found.
                            </div>
                          ) : (
                            filteredJobs.map((job) => {
                              const isSelected = job.id === selectedJobId;
                              return (
                                <button
                                  key={job.id}
                                  type="button"
                                  onClick={() => handleSelectCustomerJob(job)}
                                  style={{
                                    width: "100%",
                                    display: "flex",
                                    alignItems: "center",
                                    justifyContent: "space-between",
                                    gap: "8px",
                                    padding: "8px 10px",
                                    border: 0,
                                    borderRadius: "6px",
                                    background: isSelected
                                      ? "var(--surface-soft)"
                                      : "transparent",
                                    color: "var(--ink)",
                                    fontSize: "12.5px",
                                    textAlign: "left",
                                    cursor: "pointer",
                                  }}
                                >
                                  <span
                                    style={{
                                      fontWeight: 600,
                                      overflow: "hidden",
                                      textOverflow: "ellipsis",
                                      whiteSpace: "nowrap",
                                    }}
                                  >
                                    {job.customerName}
                                  </span>
                                  <span
                                    style={{
                                      fontSize: "11.5px",
                                      color: "var(--muted)",
                                      fontWeight: 600,
                                      flexShrink: 0,
                                    }}
                                  >
                                    {job.invoiceNumber}
                                  </span>
                                </button>
                              );
                            })
                          )}
                        </div>
                      )}
                    </div>
                  </div>

                  {otherProjectFields.map((field) => (
                    <label key={field.label} style={FIELD_LABEL_STYLE}>
                      <span style={FIELD_CAPTION_STYLE}>{field.label}</span>
                      <input
                        type="text"
                        readOnly
                        value={field.value}
                        title={field.value}
                        style={FIELD_INPUT_STYLE}
                      />
                    </label>
                  ))}
                </div>
              </div>
              )}

              {/* 2. Commercial & Admin Status */}
              {activeModalTab === 2 && (
              <div>
                <h3
                  style={{
                    margin: "0 0 4px 0",
                    fontSize: "0.95rem",
                    fontWeight: 700,
                    letterSpacing: "0.01em",
                  }}
                >
                  2. Commercial &amp; Admin Status
                </h3>
                <p
                  style={{
                    margin: "0 0 12px 0",
                    fontSize: "12px",
                    color: "var(--muted)",
                  }}
                >
                  For extra charges, payment arrangement and TNB meter application status
                </p>

                <div
                  style={{
                    display: "grid",
                    gridTemplateColumns: "repeat(2, minmax(0, 1fr))",
                    columnGap: "14px",
                    rowGap: "12px",
                    alignItems: "start",
                  }}
                >
                  <label style={FIELD_LABEL_STYLE}>
                    <span style={FIELD_CAPTION_STYLE}>Extra Charges</span>
                    <select
                      value={extraCharges}
                      onChange={(e) =>
                        setExtraCharges(e.target.value as "No" | "Yes")
                      }
                      style={FIELD_INPUT_STYLE}
                    >
                      <option value="No">No</option>
                      <option value="Yes">Yes</option>
                    </select>
                  </label>

                  <label style={FIELD_LABEL_STYLE}>
                    <span style={FIELD_CAPTION_STYLE}>
                      TNB Application Status
                    </span>
                    <select
                      value={tnbApplicationStatus}
                      onChange={(e) =>
                        setTnbApplicationStatus(
                          e.target.value as
                            | "Ready/Proceed"
                            | "Not Ready/ On Hold",
                        )
                      }
                      style={FIELD_INPUT_STYLE}
                    >
                      <option value="Ready/Proceed">Ready/Proceed</option>
                      <option value="Not Ready/ On Hold">
                        Not Ready/ On Hold
                      </option>
                    </select>
                  </label>

                  <label
                    style={{
                      ...FIELD_LABEL_STYLE,
                      gridColumn: "1 / -1",
                    }}
                  >
                    <span style={FIELD_CAPTION_STYLE}>Admin Remarks</span>
                    <textarea
                      placeholder="Enter admin remarks..."
                      value={adminRemarks}
                      onChange={(e) => setAdminRemarks(e.target.value)}
                      style={FIELD_TEXTAREA_STYLE}
                    />
                  </label>
                </div>
              </div>
              )}

              {/* 3. Site Attendance Log */}
              {activeModalTab === 3 && (
              <div>
                <div
                  style={{
                    display: "flex",
                    alignItems: "flex-start",
                    justifyContent: "space-between",
                    gap: "12px",
                    marginBottom: "12px",
                  }}
                >
                  <div>
                    <h3
                      style={{
                        margin: "0 0 4px 0",
                        fontSize: "0.95rem",
                        fontWeight: 700,
                        letterSpacing: "0.01em",
                      }}
                    >
                      3. Site Attendance Log
                    </h3>
                    <p
                      style={{
                        margin: 0,
                        fontSize: "12px",
                        color: "var(--muted)",
                      }}
                    >
                      Every visit must include the actual attendance list and at least one check-in / Timemark photo
                    </p>
                  </div>
                  <button
                    type="button"
                    className="button secondary"
                    onClick={() =>
                      setVisits((prev) => [
                        ...prev,
                        createEmptyVisit({
                          siteSupervisor: {
                            attendanceMembers:
                              projectInfo && projectInfo.siteSupervisor !== "—"
                                ? projectInfo.siteSupervisor
                                : "",
                            departure: "",
                            arrival: "",
                            photoName: "",
                            photoDataUrl: "",
                          },
                          installerTeam: {
                            attendanceMembers:
                              projectInfo?.installerTeamMembers ?? "",
                            departure: "",
                            arrival: "",
                            photoName: "",
                            photoDataUrl: "",
                          },
                        }),
                      ])
                    }
                    style={{
                      height: "32px",
                      padding: "0 10px",
                      fontSize: "12px",
                      flexShrink: 0,
                    }}
                  >
                    <Plus size={14} />
                    Add Visit
                  </button>
                </div>

                <div style={{ display: "grid", gap: "16px" }}>
                  {visits.map((visit, index) => (
                    <div
                      key={visit.id}
                      style={{
                        display: "grid",
                        gap: "12px",
                        padding: visits.length > 1 ? "14px" : 0,
                        borderRadius: visits.length > 1 ? "10px" : 0,
                        border:
                          visits.length > 1 ? "1px solid var(--line)" : "none",
                      }}
                    >
                      {visits.length > 1 && (
                        <div
                          style={{
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "space-between",
                          }}
                        >
                          <strong style={{ fontSize: "12.5px" }}>
                            Visit #{index + 1}
                          </strong>
                          <button
                            type="button"
                            className="icon-button"
                            aria-label={`Remove Visit ${index + 1}`}
                            onClick={() =>
                              setVisits((prev) =>
                                prev.filter((item) => item.id !== visit.id),
                              )
                            }
                          >
                            <Trash2 size={14} />
                          </button>
                        </div>
                      )}

                      <div
                        style={{
                          display: "grid",
                          gridTemplateColumns: "repeat(2, minmax(0, 1fr))",
                          columnGap: "14px",
                          rowGap: "12px",
                          alignItems: "start",
                        }}
                      >
                        <label style={FIELD_LABEL_STYLE}>
                          <span style={FIELD_CAPTION_STYLE}>Date</span>
                          <input
                            type="date"
                            value={visit.date}
                            onChange={(e) =>
                              setVisits((prev) =>
                                prev.map((item) =>
                                  item.id === visit.id
                                    ? { ...item, date: e.target.value }
                                    : item,
                                ),
                              )
                            }
                            style={FIELD_INPUT_STYLE}
                          />
                        </label>

                        <label style={FIELD_LABEL_STYLE}>
                          <span style={FIELD_CAPTION_STYLE}>
                            Work Done This Visit
                          </span>
                          <select
                            value={visit.workDone}
                            onChange={(e) =>
                              setVisits((prev) =>
                                prev.map((item) =>
                                  item.id === visit.id
                                    ? {
                                        ...item,
                                        workDone: e.target.value as
                                          | "Installation Complete"
                                          | "Installation Pending",
                                      }
                                    : item,
                                ),
                              )
                            }
                            style={FIELD_INPUT_STYLE}
                          >
                            <option value="Installation Complete">
                              Installation Complete
                            </option>
                            <option value="Installation Pending">
                              Installation Pending
                            </option>
                          </select>
                        </label>

                        <label
                          style={{
                            ...FIELD_LABEL_STYLE,
                            gridColumn: "1 / -1",
                          }}
                        >
                          <span style={FIELD_CAPTION_STYLE}>Visit Remarks</span>
                          <textarea
                            placeholder="Enter visit remarks..."
                            value={visit.visitRemarks}
                            onChange={(e) =>
                              setVisits((prev) =>
                                prev.map((item) =>
                                  item.id === visit.id
                                    ? { ...item, visitRemarks: e.target.value }
                                    : item,
                                ),
                              )
                            }
                            style={FIELD_TEXTAREA_STYLE}
                          />
                        </label>
                      </div>

                      {/* Site Supervisor sub-block */}
                      <AttendanceTeamBlock
                        title="Site Supervisor"
                        value={visit.siteSupervisor}
                        onChange={(nextSupervisor) =>
                          setVisits((prev) =>
                            prev.map((item) =>
                              item.id === visit.id
                                ? { ...item, siteSupervisor: nextSupervisor }
                                : item,
                            ),
                          )
                        }
                      />

                      {/* Installer Team sub-block */}
                      <AttendanceTeamBlock
                        title="Installer Team"
                        value={visit.installerTeam}
                        onChange={(nextInstaller) =>
                          setVisits((prev) =>
                            prev.map((item) =>
                              item.id === visit.id
                                ? { ...item, installerTeam: nextInstaller }
                                : item,
                            ),
                          )
                        }
                      />
                    </div>
                  ))}
                </div>
              </div>
              )}

              {/* 4. Incomplete Work Follow-up */}
              {activeModalTab === 4 && (
              <div>
                <h3
                  style={{
                    margin: "0 0 4px 0",
                    fontSize: "0.95rem",
                    fontWeight: 700,
                    letterSpacing: "0.01em",
                  }}
                >
                  4. Incomplete Work Follow-up
                </h3>
                <p
                  style={{
                    margin: "0 0 12px 0",
                    fontSize: "12px",
                    color: "var(--muted)",
                  }}
                >
                  Complete this section only when the site cannot be completed on the same day
                </p>

                <div
                  style={{
                    display: "grid",
                    gridTemplateColumns: "repeat(2, minmax(0, 1fr))",
                    columnGap: "14px",
                    rowGap: "12px",
                    alignItems: "start",
                  }}
                >
                  <label style={FIELD_LABEL_STYLE}>
                    <span style={FIELD_CAPTION_STYLE}>
                      Was the Site Completed Today?
                    </span>
                    <select
                      value={siteCompletedToday}
                      onChange={(e) =>
                        setSiteCompletedToday(
                          e.target.value as "Completed" | "Incompleted",
                        )
                      }
                      style={FIELD_INPUT_STYLE}
                    >
                      <option value="Completed">Completed</option>
                      <option value="Incompleted">Incompleted</option>
                    </select>
                  </label>
                </div>
              </div>
              )}

              {/* 5. Installation & Completion Checklist */}
              {activeModalTab === 5 && (
              <div>
                <h3
                  style={{
                    margin: "0 0 4px 0",
                    fontSize: "0.95rem",
                    fontWeight: 700,
                    letterSpacing: "0.01em",
                  }}
                >
                  5. Installation &amp; Completion Checklist
                </h3>
                <p
                  style={{
                    margin: "0 0 12px 0",
                    fontSize: "12px",
                    color: "var(--muted)",
                  }}
                >
                  Select a status for every item; state a reason when unable to complete
                </p>

                <div style={{ display: "grid", gap: "14px" }}>
                  {/* Roof Structure */}
                  <div style={SUBCARD_STYLE}>
                    <div>
                      <h4
                        style={{
                          margin: "0 0 2px 0",
                          fontSize: "0.88rem",
                          fontWeight: 700,
                          color: "var(--ink)",
                        }}
                      >
                        Roof Structure
                      </h4>
                      <p
                        style={{
                          margin: 0,
                          fontSize: "12px",
                          color: "var(--muted)",
                        }}
                      >
                        Hooks and rails structure work at roof
                      </p>
                    </div>

                    <div
                      style={{
                        display: "grid",
                        gridTemplateColumns: "repeat(2, minmax(0, 1fr))",
                        columnGap: "14px",
                        rowGap: "12px",
                        alignItems: "start",
                      }}
                    >
                      <label style={FIELD_LABEL_STYLE}>
                        <span style={FIELD_CAPTION_STYLE}>Status</span>
                        <select
                          value={roofStructureCheck.status}
                          onChange={(e) =>
                            setRoofStructureCheck((prev) => ({
                              ...prev,
                              status: e.target.value as ChecklistStatus,
                            }))
                          }
                          style={FIELD_INPUT_STYLE}
                        >
                          {CHECKLIST_STATUS_OPTIONS.map((opt) => (
                            <option key={opt} value={opt}>
                              {opt}
                            </option>
                          ))}
                        </select>
                      </label>

                      <label style={FIELD_LABEL_STYLE}>
                        <span style={FIELD_CAPTION_STYLE}>Remarks</span>
                        <input
                          type="text"
                          placeholder="State reason if unable to complete..."
                          value={roofStructureCheck.remarks}
                          onChange={(e) =>
                            setRoofStructureCheck((prev) => ({
                              ...prev,
                              remarks: e.target.value,
                            }))
                          }
                          style={FIELD_INPUT_STYLE}
                        />
                      </label>
                    </div>
                  </div>

                  {/* Solar Panel */}
                  <div style={SUBCARD_STYLE}>
                    <h4
                      style={{
                        margin: 0,
                        fontSize: "0.88rem",
                        fontWeight: 700,
                        color: "var(--ink)",
                      }}
                    >
                      Solar Panel
                    </h4>

                    <div
                      style={{
                        display: "grid",
                        gridTemplateColumns: "repeat(2, minmax(0, 1fr))",
                        columnGap: "14px",
                        rowGap: "12px",
                        alignItems: "start",
                      }}
                    >
                      <label style={FIELD_LABEL_STYLE}>
                        <span style={FIELD_CAPTION_STYLE}>
                          PV panel installation work
                        </span>
                        <select
                          value={solarPanelInstallationWork}
                          onChange={(e) =>
                            setSolarPanelInstallationWork(
                              e.target.value as ChecklistStatus,
                            )
                          }
                          style={FIELD_INPUT_STYLE}
                        >
                          {CHECKLIST_STATUS_OPTIONS.map((opt) => (
                            <option key={opt} value={opt}>
                              {opt}
                            </option>
                          ))}
                        </select>
                      </label>

                      <label style={FIELD_LABEL_STYLE}>
                        <span style={FIELD_CAPTION_STYLE}>
                          Panels properly aligned, with no looseness or tilting
                        </span>
                        <select
                          value={solarPanelAligned}
                          onChange={(e) =>
                            setSolarPanelAligned(
                              e.target.value as ChecklistStatus,
                            )
                          }
                          style={FIELD_INPUT_STYLE}
                        >
                          {CHECKLIST_STATUS_OPTIONS.map((opt) => (
                            <option key={opt} value={opt}>
                              {opt}
                            </option>
                          ))}
                        </select>
                      </label>

                      <label style={FIELD_LABEL_STYLE}>
                        <span style={FIELD_CAPTION_STYLE}>
                          Installation position follows the approved design
                        </span>
                        <select
                          value={solarPanelApprovedDesign}
                          onChange={(e) =>
                            setSolarPanelApprovedDesign(
                              e.target.value as ChecklistStatus,
                            )
                          }
                          style={FIELD_INPUT_STYLE}
                        >
                          {CHECKLIST_STATUS_OPTIONS.map((opt) => (
                            <option key={opt} value={opt}>
                              {opt}
                            </option>
                          ))}
                        </select>
                      </label>

                      <label style={FIELD_LABEL_STYLE}>
                        <span style={FIELD_CAPTION_STYLE}>Remarks</span>
                        <input
                          type="text"
                          placeholder="State reason if unable to complete..."
                          value={solarPanelRemarks}
                          onChange={(e) => setSolarPanelRemarks(e.target.value)}
                          style={FIELD_INPUT_STYLE}
                        />
                      </label>
                    </div>
                  </div>

                  {/* Wiring & Cabling */}
                  <div style={SUBCARD_STYLE}>
                    <h4
                      style={{
                        margin: 0,
                        fontSize: "0.88rem",
                        fontWeight: 700,
                        color: "var(--ink)",
                      }}
                    >
                      Wiring &amp; Cabling
                    </h4>

                    <div
                      style={{
                        display: "grid",
                        gridTemplateColumns: "repeat(2, minmax(0, 1fr))",
                        columnGap: "14px",
                        rowGap: "12px",
                        alignItems: "start",
                      }}
                    >
                      <label style={FIELD_LABEL_STYLE}>
                        <span style={FIELD_CAPTION_STYLE}>
                          DC &amp; AC cable trunking/casing/conduit works
                        </span>
                        <select
                          value={wiringTrunkingWorks}
                          onChange={(e) =>
                            setWiringTrunkingWorks(
                              e.target.value as ChecklistStatus,
                            )
                          }
                          style={FIELD_INPUT_STYLE}
                        >
                          {CHECKLIST_STATUS_OPTIONS.map((opt) => (
                            <option key={opt} value={opt}>
                              {opt}
                            </option>
                          ))}
                        </select>
                      </label>

                      <label style={FIELD_LABEL_STYLE}>
                        <span style={FIELD_CAPTION_STYLE}>
                          Earthing cable mount to PV structure
                        </span>
                        <select
                          value={wiringEarthingCable}
                          onChange={(e) =>
                            setWiringEarthingCable(
                              e.target.value as ChecklistStatus,
                            )
                          }
                          style={FIELD_INPUT_STYLE}
                        >
                          {CHECKLIST_STATUS_OPTIONS.map((opt) => (
                            <option key={opt} value={opt}>
                              {opt}
                            </option>
                          ))}
                        </select>
                      </label>

                      <label style={FIELD_LABEL_STYLE}>
                        <span style={FIELD_CAPTION_STYLE}>
                          AC cable is safely connected to distribution board
                        </span>
                        <select
                          value={wiringAcConnected}
                          onChange={(e) =>
                            setWiringAcConnected(
                              e.target.value as ChecklistStatus,
                            )
                          }
                          style={FIELD_INPUT_STYLE}
                        >
                          {CHECKLIST_STATUS_OPTIONS.map((opt) => (
                            <option key={opt} value={opt}>
                              {opt}
                            </option>
                          ))}
                        </select>
                      </label>

                      <label style={FIELD_LABEL_STYLE}>
                        <span style={FIELD_CAPTION_STYLE}>
                          All wiring is properly protected with conduit and trunking
                        </span>
                        <select
                          value={wiringProtectedConduit}
                          onChange={(e) =>
                            setWiringProtectedConduit(
                              e.target.value as ChecklistStatus,
                            )
                          }
                          style={FIELD_INPUT_STYLE}
                        >
                          {CHECKLIST_STATUS_OPTIONS.map((opt) => (
                            <option key={opt} value={opt}>
                              {opt}
                            </option>
                          ))}
                        </select>
                      </label>

                      <label style={FIELD_LABEL_STYLE}>
                        <span style={FIELD_CAPTION_STYLE}>
                          All casing and trunking has been properly restored
                        </span>
                        <select
                          value={wiringCasingRestored}
                          onChange={(e) =>
                            setWiringCasingRestored(
                              e.target.value as ChecklistStatus,
                            )
                          }
                          style={FIELD_INPUT_STYLE}
                        >
                          {CHECKLIST_STATUS_OPTIONS.map((opt) => (
                            <option key={opt} value={opt}>
                              {opt}
                            </option>
                          ))}
                        </select>
                      </label>

                      <label style={FIELD_LABEL_STYLE}>
                        <span style={FIELD_CAPTION_STYLE}>Remarks</span>
                        <input
                          type="text"
                          placeholder="State reason if unable to complete..."
                          value={wiringRemarks}
                          onChange={(e) => setWiringRemarks(e.target.value)}
                          style={FIELD_INPUT_STYLE}
                        />
                      </label>
                    </div>
                  </div>
                </div>
              </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
