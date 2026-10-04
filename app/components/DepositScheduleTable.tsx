"use client";

import {
  AlertCircle,
  Cpu,
  Droplets,
  ExternalLink,
  FileText,
  HelpCircle,
  Image as ImageIcon,
  Layers,
  MapPin,
  MessageSquare,
  SunMedium,
  X,
  Zap,
} from "lucide-react";
import { Fragment, useEffect, useMemo, useState } from "react";
import {
  isSedaApproved,
  type InstallationJob,
  type IssueCategory,
  type IssuePriority,
  type SiteAssessment,
  type SiteDifficulty,
} from "@/lib/types";
import {
  categorizeIssue,
  derivePriority,
  formatCategoryLabel,
  formatPriorityLabel,
} from "@/lib/support-tickets";

type JobFiles = { sld: string[]; roof: string[]; site: string[] };
type FilesState =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "ready"; files: JobFiles };

function titleCase(text: string) {
  return text.replace(/\w\S*/g, (w) => w.charAt(0).toUpperCase() + w.substr(1).toLowerCase());
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

function shortDate(iso: string | null | undefined) {
  if (!iso) return "";
  const [year, month, day] = iso.split("-").map(Number);
  if (!year || !month || !day) return iso;
  const monthNames = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  return `${day} ${monthNames[month - 1]} ${year}`;
}

function isImageUrl(url: string) {
  return /\.(jpe?g|png|webp|gif|bmp|heic)(\?|$)/i.test(url);
}

function isVideoUrl(url: string) {
  return /\.(mov|mp4|m4v|webm)(\?|$)/i.test(url);
}

// Keywords that signal a customer was returned from Propose to Install.
const HOLD_KEYWORDS = [
  "reschedule", "on hold", "hold", "renovation", "construction",
  "book date", "booked on", "to arrange", "arrange", "postpone",
  "delay", "pending", "cancel", "not ready", "unavailable", "overseas",
];

export function hasHoldRemark(job: InstallationJob): boolean {
  const text = (job.installationRemarks || "").toLowerCase();
  if (!text.trim()) return false;
  return HOLD_KEYWORDS.some((kw) => text.includes(kw));
}

export function isKohKengKiatCustomer(job: InstallationJob): boolean {
  const name = (job.customerName || "").toLowerCase().replace(/\s+/g, " ");
  return name.includes("koh keng kiat");
}

export type AwaitingReviewCategory = "new_ready" | "reschedule" | "pending" | "special_case" | "attention" | "om";

export function isJobOM(job: InstallationJob): boolean {
  if (job.issueCategory || job.supportTicket || job.packageType === "O&M") return true;
  if (job.visits?.some((v) => /o\s*&\s*m/i.test(v.kind ?? ""))) return true;
  const remarks = [
    job.installationRemarks,
    job.remarks,
    job.availabilityRemarks,
    job.packageType,
    job.packageName,
  ]
    .filter(Boolean)
    .join(" ");
  return /\b(o&m|om|o\s*&\s*m)\b/i.test(remarks);
}

export function isSpecialCaseApproval(job: InstallationJob): boolean {
  const remarks = [
    job.installationRemarks,
    job.remarks,
    job.availabilityRemarks,
    ...(job.visits ?? []).flatMap((v) => [v.kind, v.notes]),
  ]
    .filter(Boolean)
    .join(" ");
  return /special\s*case\s*approval/i.test(remarks);
}

export function isJobReschedule(job: InstallationJob): boolean {
  if (job.customerAvailabilityStatus === "reschedule") return true;
  if (job.scheduleStatus === "reschedule_required") return true;
  if (isKohKengKiatCustomer(job)) return true;
  const remarks = (job.installationRemarks || "").toLowerCase();
  if (!remarks) return false;
  return /(\breschedule\b|\bpostpone\b|\bcancel\b|\bdelay\b|\bon hold\b|\bhold\b|\brenovation\b|\bconstruction\b|\bnot ready\b|\bunavailable\b|\boverseas\b|\bto arrange\b)/i.test(
    remarks,
  );
}

export function isJobPending(job: InstallationJob): boolean {
  if (job.customerAvailabilityStatus === "pending_complete") return true;
  if (job.deliveryStatus && /pending/i.test(job.deliveryStatus)) return true;
  const availRemarks = (job.availabilityRemarks || "").toLowerCase();
  if (/pending/i.test(availRemarks)) return true;
  const remarks = (job.installationRemarks || "").toLowerCase();
  if (!remarks) return false;
  const stripped = remarks.replace(/pending\s+seda\s+approval/gi, " ");
  return /(\bpending\b|\bwait\b|\bwaiting\b)/i.test(stripped);
}

export function isJobNeedAttention(
  job: InstallationJob,
  todayIso?: string,
): boolean {
  const remarks = (job.installationRemarks || "").toLowerCase();
  if (/(\bneed\s*attention\b|\battention\b)/i.test(remarks)) return true;
  if (!todayIso || !job.secondPaymentDate) return false;
  if (job.installationDate) return false;
  const diffTime = Math.abs(new Date(todayIso).getTime() - new Date(job.secondPaymentDate).getTime());
  const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
  return diffDays >= 35;
}

export function isJobNewReady(job: InstallationJob, todayIso?: string): boolean {
  return !isJobOM(job) && !isSpecialCaseApproval(job) && !isJobReschedule(job) && !isJobPending(job) && !isJobNeedAttention(job, todayIso);
}

function getCategoryIcon(cat: IssueCategory) {
  switch (cat) {
    case "leaking":
      return <Droplets size={14} />;
    case "wiring":
      return <Zap size={14} />;
    case "inverter_equipment":
      return <Cpu size={14} />;
    case "generation":
      return <SunMedium size={14} />;
    case "other":
    default:
      return <HelpCircle size={14} />;
  }
}

export function getJobReviewColor(
  job: InstallationJob,
  todayIso?: string,
): AwaitingReviewCategory {
  if (isJobOM(job)) return "om";
  if (isSpecialCaseApproval(job)) return "special_case";
  if (isJobReschedule(job)) return "reschedule";
  if (isJobPending(job)) return "pending";
  if (isJobNeedAttention(job, todayIso)) return "attention";
  return "new_ready";
}

export default function DepositScheduleTable({
  jobs,
  assessments,
  onSaveJob,
  onShowOnMap,
  mapJobId,
  onOpenInQueue,
  emptyMessage = "No customers match the selected filters.",
  todayIso,
  showAwaitingReviewFilter = false,
  awaitingReviewFilter = "all",
  onAwaitingReviewChange,
  newReadyCount,
  specialCaseCount,
  rescheduleCount,
  pendingCount,
  attentionCount,
  omCount,
}: {
  jobs: InstallationJob[];
  assessments: Record<string, SiteAssessment>;
  onSaveJob?: (job: InstallationJob) => void;
  onShowOnMap: (jobId: string) => void;
  mapJobId: string | null;
  onOpenInQueue?: (jobId: string) => void;
  emptyMessage?: string;
  todayIso?: string;
  showAwaitingReviewFilter?: boolean;
  awaitingReviewFilter?: string;
  onAwaitingReviewChange?: (value: string) => void;
  newReadyCount?: number;
  specialCaseCount?: number;
  rescheduleCount?: number;
  pendingCount?: number;
  attentionCount?: number;
  omCount?: number;
}) {
  const [filesJobId, setFilesJobId] = useState<string | null>(null);
  const [filesByJob, setFilesByJob] = useState<Record<string, FilesState>>({});
  const [panelDraft, setPanelDraft] = useState<Record<string, string>>({});
  const [inverterDraft, setInverterDraft] = useState<Record<string, string>>({});
  const [remarkDraft, setRemarkDraft] = useState<Record<string, string>>({});

  const [selectedIssueCategory, setSelectedIssueCategory] = useState<IssueCategory>("all");
  const [selectedPriority, setSelectedPriority] = useState<IssuePriority>("all");
  const [ticketModalJob, setTicketModalJob] = useState<InstallationJob | null>(null);

  useEffect(() => {
    if (awaitingReviewFilter !== "om") {
      setSelectedIssueCategory("all");
      setSelectedPriority("all");
    }
  }, [awaitingReviewFilter]);

  const omJobs = useMemo(() => jobs.filter(isJobOM), [jobs]);
  const omCategoryCounts = useMemo(() => {
    const counts = { all: omJobs.length, leaking: 0, wiring: 0, inverter_equipment: 0, generation: 0, other: 0 };
    for (const job of omJobs) {
      const cat = job.issueCategory || categorizeIssue(job.packageName, job.installationRemarks || job.remarks);
      counts[cat] = (counts[cat] || 0) + 1;
    }
    return counts;
  }, [omJobs]);

  const omPriorityCounts = useMemo(() => {
    const counts: Record<IssuePriority, number> = {
      all: omJobs.length,
      critical: 0,
      high: 0,
      medium: 0,
      low: 0,
    };
    for (const job of omJobs) {
      const prio = job.priority || derivePriority(job.packageName, job.installationRemarks || job.remarks);
      if (prio in counts) {
        counts[prio]++;
      }
    }
    return counts;
  }, [omJobs]);

  const displayedJobs = useMemo(() => {
    if (awaitingReviewFilter === "om") {
      return jobs.filter((job) => {
        if (selectedIssueCategory !== "all") {
          const cat = job.issueCategory || categorizeIssue(job.packageName, job.installationRemarks || job.remarks);
          if (cat !== selectedIssueCategory) return false;
        }
        if (selectedPriority !== "all") {
          const prio = job.priority || derivePriority(job.packageName, job.installationRemarks || job.remarks);
          if (prio !== selectedPriority) return false;
        }
        return true;
      });
    }
    return jobs;
  }, [jobs, awaitingReviewFilter, selectedIssueCategory, selectedPriority]);

  useEffect(() => {
    if (!filesJobId || filesByJob[filesJobId]) return;
    const jobId = filesJobId;
    setFilesByJob((current) => ({ ...current, [jobId]: { status: "loading" } }));
    void (async () => {
      try {
        const response = await fetch(`/api/jobs/${encodeURIComponent(jobId)}/files`, {
          cache: "no-store",
        });
        if (!response.ok) throw new Error("Could not load the photos.");
        const body = (await response.json()) as JobFiles;
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
    if (draftVal !== undefined && draftVal !== job.installationRemarks) {
      onSaveJob?.({ ...job, installationRemarks: draftVal });
    }
  }

  function sedaCell(job: InstallationJob) {
    if (job.sedaApprovedDate) return shortDate(job.sedaApprovedDate);
    if (isSedaApproved(job.sedaStatus)) {
      return <span className="rti-muted">Approved, date not recorded</span>;
    }
    return <span className="rti-warning-text">{job.sedaStatus || "Pending"}</span>;
  }

  function filesButton(job: InstallationJob) {
    const isOM = isJobOM(job) || awaitingReviewFilter === "om";
    const counts = [
      job.sldUrl ? (isOM ? "Document" : "SLD") : null,
      job.roofPhotoCount ? `${job.roofPhotoCount} roof` : null,
      job.sitePhotoCount ? `${job.sitePhotoCount} site` : null,
    ].filter(Boolean);
    if (!counts.length) return <span className="rti-warning-text">{isOM ? "No Document" : "No SLD"}</span>;
    const open = filesJobId === job.id;
    return (
      <button
        type="button"
        className={`rti-link${open ? " is-active" : ""}`}
        onClick={() => setFilesJobId(open ? null : job.id)}
        title={isOM ? "Show documents and photos" : "Show the SLD, roof and site-assessment photos"}
      >
        <FileText size={13} />
        {job.sldUrl ? "View" : "Photos"}
        <span className="rti-muted">{counts.join(" · ")}</span>
      </button>
    );
  }

  function filesPanel(job: InstallationJob) {
    const state = filesByJob[job.id];
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
          <button
            type="button"
            className="icon-button"
            aria-label="Close photos"
            onClick={() => setFilesJobId(null)}
          >
            <X size={15} />
          </button>
        </div>
        {!state || state.status === "loading" ? (
          <p className="rti-muted">Loading…</p>
        ) : state.status === "error" ? (
          <p className="rti-warning-text">{state.message}</p>
        ) : (
          <div className="rti-files-body">
            <div>
              <h5>{isJobOM(job) || awaitingReviewFilter === "om" ? "Document" : "SLD"}</h5>
              {renderFiles(state.files.sld, isJobOM(job) || awaitingReviewFilter === "om" ? "Document" : "SLD")}
            </div>
            <div>
              <h5>Roof photos</h5>
              {renderFiles(state.files.roof, "Roof")}
            </div>
            <div>
              <h5>Site assessment photos</h5>
              {renderFiles(state.files.site, "Site")}
            </div>
          </div>
        )}
      </div>
    );
  }

  const COLUMN_COUNT = 10;

  return (
    <div className="rti">
      {showAwaitingReviewFilter && onAwaitingReviewChange && (
        <div className="awaiting-review-pills-bar">
          <span className="awaiting-review-pills-label">Awaiting Review:</span>
          <div className="awaiting-review-pills">
            <button
              type="button"
              className={`awaiting-pill is-all ${awaitingReviewFilter === "all" ? "is-active" : ""}`}
              onClick={() => onAwaitingReviewChange("all")}
            >
              All
            </button>
            <button
              type="button"
              className={`awaiting-pill is-new-ready ${awaitingReviewFilter === "new_ready" ? "is-active" : ""}`}
              onClick={() => onAwaitingReviewChange("new_ready")}
            >
              New Ready to Install {newReadyCount !== undefined ? `(${newReadyCount})` : ""}
            </button>
            <button
              type="button"
              className={`awaiting-pill is-special-case ${awaitingReviewFilter === "special_case" ? "is-active" : ""}`}
              onClick={() => onAwaitingReviewChange("special_case")}
            >
              Special Case {specialCaseCount !== undefined ? `(${specialCaseCount})` : ""}
            </button>
            <button
              type="button"
              className={`awaiting-pill is-reschedule ${awaitingReviewFilter === "reschedule" ? "is-active" : ""}`}
              onClick={() => onAwaitingReviewChange("reschedule")}
            >
              Reschedule {rescheduleCount !== undefined ? `(${rescheduleCount})` : ""}
            </button>
            <button
              type="button"
              className={`awaiting-pill is-pending ${awaitingReviewFilter === "pending" ? "is-active" : ""}`}
              onClick={() => onAwaitingReviewChange("pending")}
            >
              Pending {pendingCount !== undefined ? `(${pendingCount})` : ""}
            </button>
            <button
              type="button"
              className={`awaiting-pill is-attention ${awaitingReviewFilter === "attention" ? "is-active" : ""}`}
              onClick={() => onAwaitingReviewChange("attention")}
            >
              Need Attention {attentionCount !== undefined ? `(${attentionCount})` : ""}
            </button>
            <button
              type="button"
              className={`awaiting-pill is-om ${awaitingReviewFilter === "om" ? "is-active" : ""}`}
              onClick={() => onAwaitingReviewChange("om")}
            >
              O&M {omCount !== undefined ? `(${omCount})` : ""}
            </button>
          </div>
        </div>
      )}

      {showAwaitingReviewFilter && awaitingReviewFilter === "om" && (
        <div className="om-section-header">
          {/* Active Cards for O&M Counts */}
          <div className="om-active-cards-bar">
            <button
              type="button"
              className={`om-category-card is-leaking ${selectedIssueCategory === "leaking" ? "is-active" : ""}`}
              onClick={() => setSelectedIssueCategory((prev) => (prev === "leaking" ? "all" : "leaking"))}
              title={selectedIssueCategory === "leaking" ? "Click to clear filter" : "Filter by Leaking"}
            >
              <div className="om-card-header">
                <span className="om-card-icon"><Droplets size={17} /></span>
                <span className="om-card-title">Leaking</span>
              </div>
              <div className="om-card-count">{omCategoryCounts.leaking}</div>
              <div className="om-card-sub">Roof & water leaks</div>
            </button>

            <button
              type="button"
              className={`om-category-card is-wiring ${selectedIssueCategory === "wiring" ? "is-active" : ""}`}
              onClick={() => setSelectedIssueCategory((prev) => (prev === "wiring" ? "all" : "wiring"))}
              title={selectedIssueCategory === "wiring" ? "Click to clear filter" : "Filter by Wiring"}
            >
              <div className="om-card-header">
                <span className="om-card-icon"><Zap size={17} /></span>
                <span className="om-card-title">Wiring</span>
              </div>
              <div className="om-card-count">{omCategoryCounts.wiring}</div>
              <div className="om-card-sub">Electrical & DB trips</div>
            </button>

            <button
              type="button"
              className={`om-category-card is-inverter ${selectedIssueCategory === "inverter_equipment" ? "is-active" : ""}`}
              onClick={() => setSelectedIssueCategory((prev) => (prev === "inverter_equipment" ? "all" : "inverter_equipment"))}
              title={selectedIssueCategory === "inverter_equipment" ? "Click to clear filter" : "Filter by Inverter / Equipment"}
            >
              <div className="om-card-header">
                <span className="om-card-icon"><Cpu size={17} /></span>
                <span className="om-card-title">Inverter / Equipment</span>
              </div>
              <div className="om-card-count">{omCategoryCounts.inverter_equipment}</div>
              <div className="om-card-sub">Inverter, battery & panels</div>
            </button>

            <button
              type="button"
              className={`om-category-card is-generation ${selectedIssueCategory === "generation" ? "is-active" : ""}`}
              onClick={() => setSelectedIssueCategory((prev) => (prev === "generation" ? "all" : "generation"))}
              title={selectedIssueCategory === "generation" ? "Click to clear filter" : "Filter by Generation"}
            >
              <div className="om-card-header">
                <span className="om-card-icon"><SunMedium size={17} /></span>
                <span className="om-card-title">Generation</span>
              </div>
              <div className="om-card-count">{omCategoryCounts.generation}</div>
              <div className="om-card-sub">Low yield & TNB bills</div>
            </button>

            {omCategoryCounts.other > 0 && (
              <button
                type="button"
                className={`om-category-card is-other ${selectedIssueCategory === "other" ? "is-active" : ""}`}
                onClick={() => setSelectedIssueCategory((prev) => (prev === "other" ? "all" : "other"))}
                title={selectedIssueCategory === "other" ? "Click to clear filter" : "Filter by Other"}
              >
                <div className="om-card-header">
                  <span className="om-card-icon"><HelpCircle size={17} /></span>
                  <span className="om-card-title">Other</span>
                </div>
                <div className="om-card-count">{omCategoryCounts.other}</div>
                <div className="om-card-sub">Miscellaneous issues</div>
              </button>
            )}
          </div>

          {/* Issue Category & Priority Filter Dropdown Toolbar */}
          <div className="om-filter-toolbar">
            <div className="om-filter-toolbar-left">
              <div className="om-filter-field">
                <label className="om-filter-label" htmlFor="om-issue-category-select">
                  Issue Category:
                </label>
                <select
                  id="om-issue-category-select"
                  className="om-category-select"
                  value={selectedIssueCategory}
                  onChange={(e) => setSelectedIssueCategory(e.target.value as IssueCategory)}
                >
                  <option value="all">All Issues ({omCategoryCounts.all})</option>
                  <option value="leaking">Leaking ({omCategoryCounts.leaking})</option>
                  <option value="wiring">Wiring ({omCategoryCounts.wiring})</option>
                  <option value="inverter_equipment">Inverter / Equipment ({omCategoryCounts.inverter_equipment})</option>
                  <option value="generation">Generation ({omCategoryCounts.generation})</option>
                  {omCategoryCounts.other > 0 && (
                    <option value="other">Other ({omCategoryCounts.other})</option>
                  )}
                </select>
              </div>

              <div className="om-filter-field">
                <label className="om-filter-label" htmlFor="om-priority-select">
                  Priority:
                </label>
                <select
                  id="om-priority-select"
                  className="om-category-select om-priority-select"
                  value={selectedPriority}
                  onChange={(e) => setSelectedPriority(e.target.value as IssuePriority)}
                >
                  <option value="all">All Priorities ({omPriorityCounts.all})</option>
                  <option value="critical">🔴 Critical ({omPriorityCounts.critical})</option>
                  <option value="high">🟠 High ({omPriorityCounts.high})</option>
                  <option value="medium">🔵 Medium ({omPriorityCounts.medium})</option>
                  <option value="low">⚪ Low ({omPriorityCounts.low})</option>
                </select>
              </div>

              {(selectedIssueCategory !== "all" || selectedPriority !== "all") && (
                <button
                  type="button"
                  className="om-reset-filters-btn"
                  onClick={() => {
                    setSelectedIssueCategory("all");
                    setSelectedPriority("all");
                  }}
                  title="Clear all active filters"
                >
                  Reset filters
                </button>
              )}
            </div>
            <div className="om-filter-toolbar-right">
              <span className="om-results-badge">
                Showing {displayedJobs.length} of {omCategoryCounts.all} O&M issues
              </span>
            </div>
          </div>
        </div>
      )}

      <div className="table-wrap rti-team">
        <table>
          <colgroup>
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
            <tr>
              <th>Customer</th>
              <th>Address</th>
              <th>Phone</th>
              <th>Email</th>
              <th>Agent</th>
              <th>Phase</th>
              <th>Panel</th>
              <th>Inverter</th>
              <th>{awaitingReviewFilter === "om" ? "Document" : "SLD"}</th>
              <th>Remark</th>
            </tr>
          </thead>
          <tbody>
            {displayedJobs.length === 0 ? (
              <tr>
                <td colSpan={COLUMN_COUNT} style={{ textAlign: "center", padding: "32px", color: "var(--muted)" }}>
                  {awaitingReviewFilter === "om" && (selectedIssueCategory !== "all" || selectedPriority !== "all")
                    ? `No O&M support tickets found matching current filters (${selectedIssueCategory !== "all" ? formatCategoryLabel(selectedIssueCategory) : "All Categories"}, ${selectedPriority !== "all" ? formatPriorityLabel(selectedPriority) : "All Priorities"}).`
                    : emptyMessage}
                </td>
              </tr>
            ) : (
              [...displayedJobs].sort((a, b) => {
                const aType = getJobReviewColor(a, todayIso);
                const bType = getJobReviewColor(b, todayIso);
                const order: Record<string, number> = { new_ready: 0, special_case: 1, reschedule: 2, pending: 3, attention: 4, om: 5 };
                if (aType !== bType) {
                  return (order[aType] ?? 9) - (order[bType] ?? 9);
                }
                return 0;
              }).map((job) => {
                const paymentLabel = job.secondPaymentDate ? "2nd payment:" : "Deposit payment:";
                const paymentDateVal = job.secondPaymentDate || job.firstPaymentDate;
                const isKoh = isKohKengKiatCustomer(job);
                const reviewType =
                  showAwaitingReviewFilter && awaitingReviewFilter === "all"
                    ? getJobReviewColor(job, todayIso)
                    : null;
                const cat = job.issueCategory || categorizeIssue(job.packageName, job.installationRemarks || job.remarks);
                const prio = job.priority || derivePriority(job.packageName, job.installationRemarks || job.remarks);
                return (
                  <Fragment key={job.id}>
                    <tr
                      id={`deposit-row-${job.id}`}
                      className={[
                        "rti-row",
                        reviewType ? `is-${reviewType.replace(/_/g, "-")}` : "",
                        isKoh ? "is-koh-keng-kiat" : "",
                      ]
                        .filter(Boolean)
                        .join(" ")}
                    >
                      <td>
                        <div className="rti-customer-wrap">
                          <button
                            type="button"
                            className="rti-name-link"
                            title={`SEDA approved: ${job.sedaApprovedDate ? shortDate(job.sedaApprovedDate) : isSedaApproved(job.sedaStatus) ? "Approved" : (job.sedaStatus || "Pending")} · ${paymentLabel} ${shortDate(paymentDateVal) || "–"} · Payment: ${(job.paymentPercent ?? 0).toFixed(2)}%\nClick to see in queue`}
                            onClick={() => onOpenInQueue?.(job.id)}
                          >
                            {displayName(job.customerName)}
                          </button>
                          <div className="rti-customer-popover" role="tooltip">
                            <div className="rti-customer-popover-row">
                              <span className="rti-customer-popover-label">SEDA approved:</span>
                              <span className="rti-customer-popover-val">{sedaCell(job)}</span>
                            </div>
                            <div className="rti-customer-popover-row">
                              <span className="rti-customer-popover-label">{paymentLabel}</span>
                              <span className="rti-customer-popover-val">{shortDate(paymentDateVal) || "–"}</span>
                            </div>
                            <div className="rti-customer-popover-row">
                              <span className="rti-customer-popover-label">Payment status:</span>
                              <span className="rti-customer-popover-val">
                                {(job.paymentPercent ?? 0).toFixed(2)}% paid
                              </span>
                            </div>
                          </div>
                        </div>
                        <div className="rti-customer-meta">
                          <span className="rti-muted rti-invoice">{job.invoiceNumber}</span>
                          {job.supportTicket && (
                            <span className={`om-ticket-status-pill is-${(job.supportTicket.status || "unread").replace(/\s+/g, "-")}`}>
                              {job.supportTicket.status}
                            </span>
                          )}
                        </div>
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
                        {job.supportTicket?.images && job.supportTicket.images.length > 0 ? (
                          <button
                            type="button"
                            className="rti-files-btn is-active om-ticket-files-btn"
                            onClick={() => setTicketModalJob(job)}
                            title={`View ${job.supportTicket.images.length} ticket photo(s)`}
                          >
                            <ImageIcon size={13} />
                            <span>{job.supportTicket.images.length}</span>
                          </button>
                        ) : (
                          filesButton(job)
                        )}
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
                            {assessments[job.id].difficulty} roof
                          </span>
                        )}
                      </td>
                      <td className="rti-edit-cell">
                        {isJobOM(job) && (
                          <div className="om-row-header-badge">
                            <span className={`om-badge is-${cat}`}>
                              {getCategoryIcon(cat)} {formatCategoryLabel(cat)}
                            </span>
                            {prio && (
                              <span className={`om-priority-pill is-${prio}`} title={`Priority: ${formatPriorityLabel(prio)}`}>
                                <span className="om-priority-dot" />
                                {formatPriorityLabel(prio)}
                              </span>
                            )}
                            {job.supportTicket && (
                              <button
                                type="button"
                                className="om-details-trigger-btn"
                                onClick={() => setTicketModalJob(job)}
                                title="View ticket description & details"
                              >
                                <MessageSquare size={11} /> Details
                              </button>
                            )}
                          </div>
                        )}
                        <textarea
                          className="rti-cell-textarea"
                          rows={3}
                          value={remarkDraft[job.id] ?? job.installationRemarks ?? ""}
                          placeholder="Add remark…"
                          aria-label={`Remarks for ${displayName(job.customerName)}`}
                          onChange={(e) => handleRemarkChange(job.id, e.target.value)}
                          onBlur={() => handleRemarkBlur(job)}
                        />
                      </td>
                    </tr>
                    {filesJobId === job.id && (
                      <tr className="rti-panel-row">
                        <td colSpan={COLUMN_COUNT}>{filesPanel(job)}</td>
                      </tr>
                    )}
                  </Fragment>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      {/* Support Ticket Details & Photos Modal */}
      {ticketModalJob && ticketModalJob.supportTicket && (
        <div className="om-ticket-modal-overlay" onClick={() => setTicketModalJob(null)}>
          <div className="om-ticket-modal-card" onClick={(e) => e.stopPropagation()}>
            <div className="om-ticket-modal-header">
              <div>
                <div className="om-ticket-modal-meta">
                  <span className="om-ticket-badge">Ticket #{ticketModalJob.supportTicket.id}</span>
                  <span className={`om-ticket-status-pill is-${(ticketModalJob.supportTicket.status || "unread").replace(/\s+/g, "-")}`}>
                    {ticketModalJob.supportTicket.status}
                  </span>
                  {(() => {
                    const c = ticketModalJob.issueCategory || categorizeIssue(ticketModalJob.packageName, ticketModalJob.installationRemarks || ticketModalJob.remarks);
                    const p = ticketModalJob.priority || derivePriority(ticketModalJob.packageName, ticketModalJob.installationRemarks || ticketModalJob.remarks);
                    return (
                      <>
                        <span className={`om-badge is-${c}`}>
                          {getCategoryIcon(c)} {formatCategoryLabel(c)}
                        </span>
                        {p && (
                          <span className={`om-priority-pill is-${p}`} title={`Priority: ${formatPriorityLabel(p)}`}>
                            <span className="om-priority-dot" />
                            {formatPriorityLabel(p)} Priority
                          </span>
                        )}
                      </>
                    );
                  })()}
                </div>
                <h3>{ticketModalJob.customerName}</h3>
                <p className="om-ticket-modal-sub">{ticketModalJob.packageName || ticketModalJob.supportTicket.title}</p>
              </div>
              <button
                type="button"
                className="rti-files-close"
                onClick={() => setTicketModalJob(null)}
                aria-label="Close ticket details"
              >
                <X size={18} />
              </button>
            </div>
            
            <div className="om-ticket-modal-body">
              <div className="om-modal-field">
                <span className="om-modal-field-label">Problem Description:</span>
                <div className="om-modal-field-val">
                  {ticketModalJob.supportTicket.problemDescription || "No description provided."}
                </div>
              </div>

              {ticketModalJob.supportTicket.technicianRemark && (
                <div className="om-modal-field">
                  <span className="om-modal-field-label">Technician Remarks:</span>
                  <div className="om-modal-field-val technician-remark">
                    {ticketModalJob.supportTicket.technicianRemark}
                  </div>
                </div>
              )}

              <div className="om-modal-field">
                <span className="om-modal-field-label">Customer Information:</span>
                <p className="om-modal-field-val">
                  <strong>Phone:</strong> {ticketModalJob.customerPhone || "–"} &nbsp;·&nbsp;
                  <strong>Address:</strong> {ticketModalJob.address || "Address not provided"}
                  {ticketModalJob.agentName && (
                    <> &nbsp;·&nbsp; <strong>Submitted by:</strong> {ticketModalJob.agentName}</>
                  )}
                </p>
              </div>

              {ticketModalJob.supportTicket.images && ticketModalJob.supportTicket.images.length > 0 && (
                <div className="om-modal-field">
                  <span className="om-modal-field-label">
                    Attached Photos ({ticketModalJob.supportTicket.images.length}):
                  </span>
                  <div className="om-modal-images-grid">
                    {ticketModalJob.supportTicket.images.map((imgUrl, idx) => {
                      const fullUrl = imgUrl.startsWith("//") ? `https:${imgUrl}` : imgUrl;
                      return (
                        <a
                          key={idx}
                          href={fullUrl}
                          target="_blank"
                          rel="noreferrer"
                          className="om-modal-image-thumb"
                          title="Open full photo in new tab"
                        >
                          <img src={fullUrl} alt={`Ticket attachment ${idx + 1}`} />
                          <span className="om-modal-img-zoom"><ExternalLink size={13} /> View Full</span>
                        </a>
                      );
                    })}
                  </div>
                </div>
              )}

              {ticketModalJob.supportTicket.videoUrl && (
                <div className="om-modal-field">
                  <span className="om-modal-field-label">Attached Video:</span>
                  <a
                    href={ticketModalJob.supportTicket.videoUrl.startsWith("//") ? `https:${ticketModalJob.supportTicket.videoUrl}` : ticketModalJob.supportTicket.videoUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="om-modal-video-link"
                  >
                    <ExternalLink size={14} /> Open Video Link
                  </a>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
