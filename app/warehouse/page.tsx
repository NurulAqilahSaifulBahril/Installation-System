"use client";

import AdminTab from "./AdminTab";
import { PO_ITEM_TYPE_OPTIONS, UploadDoButton, poDay, useDoFiles, type DoFile } from "./DoFiles";
import { cameraErrorMessage, openCameraStream } from "./camera";
import PoVerificationPage from "./PoVerification";
import { DownloadReportButton, reportFileName } from "./ReportDownload";
import { DeliveryOrderDialog } from "./DeliveryOrder";
import { LorryTimeline, type TimelineRun } from "./LorryTimeline";
import { watchDeliveryRuns } from "./delivery-feed";
import { PhotoCamera } from "./PhotoCamera";

// The Loading page's lorry timeline (LorryTimeline) is hidden for now.
const SHOW_LORRY_TIMELINE = false;
import { PvDrawingImage } from "./PvDrawingImage";
import { DateNav } from "./DateNav";
import { classifyInvoiceLines, parseCountedItem } from "./invoice-lines";
import { estimateMounting, ROOF_OPTIONS, type MountingSystemId, type Orientation, type RoofType } from "./mounting-estimate";
import { FormEvent, Fragment, useEffect, useMemo, useRef, useState, type CSSProperties, type Dispatch, type SetStateAction } from "react";
import {
  INVERTER_TYPES,
  ORDER_MODELS,
  STOCK_CARDS,
  STOCK_DETAIL_ITEMS,
  MOUNTING_SYSTEMS,
  ELECTRICAL_GROUPS,
  COMMERCIAL_GROUPS,
  STOCK_TRANSACTIONS,
  WAREHOUSE_BALANCES,
  WAREHOUSE_NOTICES,
  generateSupplierSerialList,
  generateStockOutSerialList,
  generateStockTransferSerialList,
  type InverterTypeId,
  type WarehouseNoticeKind,
  type StockDetailItem,
  type StockOutLine,
  type StockOutScheduleData,
  type StockTransaction,
  type StockTransactionStatus,
  type StockTransactionType,
  type SupplierSerialUnit,
  type StockOutUnit,
  type StockTransferUnit,
  type StockTransferData,
  type WarehouseModel,
} from "@/lib/warehouse-sample";
import styles from "./warehouse.module.css";

const SESSION_KEY = "warehouse-phone";
const NAME_KEY = "warehouse-username";
const ACCESS_KEY = "warehouse-access";

// Cropped to the artwork (public/eternalgy-logo.png has wide transparent margins).
const LOGO_SRC = "/eternalgy-logo-tight.png";
// The symbol alone, without the ETERNALGY / ETERNAL ENERGY wording (sign-in headline).
const MARK_SRC = "/eternalgy-mark.png";

type View = "mobile" | "desktop";

export default function WarehousePage() {
  // Installable app (PWA): register the Inventory Management service worker, limited to
  // /warehouse. It keeps no data; it only shows an offline page when there is no connection.
  useEffect(() => {
    if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) return;
    navigator.serviceWorker.register("/warehouse-sw.js", { scope: "/warehouse" }).catch(() => {});
  }, []);
  const [phone, setPhone] = useState("");
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [signedInPhone, setSignedInPhone] = useState<string | null>(null);
  // The username of the Inventory Management user this phone number belongs to (for "Hi …!").
  const [signedInUsername, setSignedInUsername] = useState("");
  // "admin" or "staff" for a registered phone number; "" when it is not registered.
  const [signedInAccess, setSignedInAccess] = useState("");
  const [ready, setReady] = useState(false);
  const [model, setModel] = useState<WarehouseModel | null>(null);
  const [view, setView] = useState<View>("mobile");

  useEffect(() => {
    const storedPhone = window.sessionStorage.getItem(SESSION_KEY);
    setSignedInPhone(storedPhone);
    setSignedInUsername(window.sessionStorage.getItem(NAME_KEY) ?? "");
    setSignedInAccess(window.sessionStorage.getItem(ACCESS_KEY) ?? "");
    // Phone or desktop layout follows the screen width, and updates when it changes
    // (rotating a phone, resizing a window).
    const wide = window.matchMedia("(min-width: 900px)");
    const apply = () => setView(wide.matches ? "desktop" : "mobile");
    apply();
    wide.addEventListener("change", apply);

    // The tab's own memory of the sign-in is lost with a new tab or a closed browser, but the
    // 30-day sign-in cookie is not: ask the server, and if this browser is still signed in, go
    // straight in. This also picks up a change of access (e.g. made admin) since signing in.
    // The sign-in screen is held back (ready = false) only while a first-time check runs.
    let cancelled = false;
    if (storedPhone) setReady(true);
    const timeout = setTimeout(() => {
      if (!cancelled) setReady(true);
    }, 4000);
    fetch("/api/warehouse/me", { credentials: "same-origin", cache: "no-store" })
      .then(async (res) => {
        // Not signed in (or removed / deactivated in the Admin tab): forget this tab's sign-in
        // so the sign-in screen shows. Other failures (no connection) keep it.
        if (res.status === 401 || res.status === 403) {
          if (!cancelled) {
            window.sessionStorage.removeItem(SESSION_KEY);
            window.sessionStorage.removeItem(NAME_KEY);
            window.sessionStorage.removeItem(ACCESS_KEY);
            setSignedInPhone(null);
            setSignedInUsername("");
            setSignedInAccess("");
          }
          return null;
        }
        return res.ok ? ((await res.json()) as { signedIn?: boolean; username?: string; access?: string; phone?: string }) : null;
      })
      .then((me) => {
        if (cancelled || !me?.signedIn) return;
        const flag = storedPhone || me.phone || "signed-in";
        const username = me.username ?? "";
        const access = me.access ?? "";
        window.sessionStorage.setItem(SESSION_KEY, flag);
        window.sessionStorage.setItem(NAME_KEY, username);
        window.sessionStorage.setItem(ACCESS_KEY, access);
        setSignedInPhone(flag);
        setSignedInUsername(username);
        setSignedInAccess(access);
      })
      .catch(() => {})
      .finally(() => {
        clearTimeout(timeout);
        if (!cancelled) setReady(true);
      });
    return () => {
      cancelled = true;
      clearTimeout(timeout);
      wide.removeEventListener("change", apply);
    };
  }, []);

  async function signIn(event: FormEvent) {
    event.preventDefault();
    const trimmed = phone.trim();
    if (trimmed.length < 9) {
      setError("Enter the phone number.");
      return;
    }
    if (!/^\d{6}$/.test(code.trim())) {
      setError("Enter the 6-digit OTP.");
      return;
    }
    // Only a phone number added in the Admin tab (an active user) is let in: the server checks it
    // and gives a warehouse session, and the same answer tells us the username and access level.
    let username = "";
    let access = "";
    try {
      const response = await fetch("/api/public/warehouse-login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({ phone: trimmed, otp: code.trim() }),
      });
      const data = (await response.json().catch(() => ({}))) as { username?: string | null; access?: string | null; error?: string };
      if (!response.ok) {
        setError(data.error || "Could not sign in. Try again.");
        return;
      }
      username = data.username ?? "";
      access = data.access ?? "";
    } catch {
      setError("Could not reach the server. Check the connection and try again.");
      return;
    }
    window.sessionStorage.setItem(SESSION_KEY, trimmed);
    window.sessionStorage.setItem(NAME_KEY, username);
    window.sessionStorage.setItem(ACCESS_KEY, access);
    setSignedInUsername(username);
    setSignedInAccess(access);
    setSignedInPhone(trimmed);
    setError(null);
  }

  function signOut() {
    void fetch("/api/public/warehouse-logout", { method: "POST", credentials: "same-origin" }).catch(() => {});
    window.sessionStorage.removeItem(SESSION_KEY);
    window.sessionStorage.removeItem(NAME_KEY);
    window.sessionStorage.removeItem(ACCESS_KEY);
    setSignedInUsername("");
    setSignedInAccess("");
    setSignedInPhone(null);
    setModel(null);
    setCode("");
  }

  if (!ready) return null;

  return (
    <main
      className={`${signedInPhone ? styles.page : styles.lockPage} ${view === "desktop" ? styles.desktop : ""}`}
    >
      {signedInPhone ? (
        <>
          <header className={styles.brandBar}>
            <img className={styles.brandLogo} src={LOGO_SRC} alt="Eternalgy" width={1332} height={176} />
            <div className={styles.brandRight}>
              <span className={styles.brandUser}>{signedInUsername ? `Hi ${signedInUsername}!` : "Hi!"}</span>
              <button className={styles.brandSignOut} type="button" onClick={signOut}>
                Sign out
              </button>
            </div>
          </header>
          <Dashboard phone={signedInPhone} username={signedInUsername} access={signedInAccess} model={model} onSignOut={signOut} onSelect={setModel} />
        </>
      ) : (
        <SignIn
          phone={phone}
          code={code}
          error={error}
          onPhone={setPhone}
          onCode={setCode}
          onSubmit={signIn}
        />
      )}
    </main>
  );
}

function SignIn({
  phone,
  code,
  error,
  onPhone,
  onCode,
  onSubmit,
}: {
  phone: string;
  code: string;
  error: string | null;
  onPhone: (value: string) => void;
  onCode: (value: string) => void;
  onSubmit: (event: FormEvent) => void;
}) {
  const fields = (
    <>
      <label className={styles.field}>
        Phone number
        <input
          type="tel"
          name="phone"
          inputMode="tel"
          autoComplete="tel"
          value={phone}
          placeholder="012-345 6789"
          onChange={(event) => onPhone(event.target.value)}
        />
      </label>
      <label className={styles.field}>
        OTP
        <input
          type="text"
          name="code"
          inputMode="numeric"
          autoComplete="one-time-code"
          maxLength={6}
          value={code}
          placeholder="6-digit OTP"
          onChange={(event) => onCode(event.target.value)}
        />
      </label>
      {error ? <p className={styles.error}>{error}</p> : null}
      <button className={styles.primary} type="submit">
        Sign in
      </button>
    </>
  );

  return (
    <section className={styles.lock} aria-labelledby="warehouse-sign-in">
      <h1 id="warehouse-sign-in" className={styles.lockTitle}>
        <img className={styles.lockLogo} src={MARK_SRC} alt="Eternalgy" width={357} height={176} />
        <span>Inventory Management</span>
      </h1>
      <NoticeList />
      {/* Sign-in form sits below the notifications (same for both mobile and desktop) */}
      <form className={`${styles.form} ${styles.inlineForm}`} onSubmit={onSubmit} aria-label="Sign in">
        {fields}
      </form>
    </section>
  );
}

// The sign-in screen shows at most this many notices (the first ones in the list).
const MAX_SIGN_IN_NOTICES = 3;

// Notices closed with × are remembered on this device (the next ones move up).
const DISMISSED_NOTICES_KEY = "warehouse-dismissed-notices";

function NoticeList() {
  const [dismissed, setDismissed] = useState<string[]>([]);
  useEffect(() => {
    try {
      const saved = JSON.parse(window.localStorage.getItem(DISMISSED_NOTICES_KEY) ?? "[]");
      if (Array.isArray(saved)) setDismissed(saved.filter((id): id is string => typeof id === "string"));
    } catch {
      // No storage (private window, blocked): nothing was dismissed.
    }
  }, []);
  function dismiss(id: string) {
    setDismissed((prev) => {
      const next = [...prev, id];
      try {
        window.localStorage.setItem(DISMISSED_NOTICES_KEY, JSON.stringify(next));
      } catch {
        // Not saved; it is still hidden until the page reloads.
      }
      return next;
    });
  }
  const shown = WAREHOUSE_NOTICES.filter((notice) => !dismissed.includes(String(notice.id))).slice(0, MAX_SIGN_IN_NOTICES);
  if (shown.length === 0) return null;
  return (
    <div className={styles.shade}>
    <ul className={styles.noticeList} aria-label="Urgent notices">
      {shown.map((notice) => (
        <li key={notice.id} className={styles.noticeCard}>
          <button
            type="button"
            className={styles.noticeClose}
            aria-label={`Dismiss: ${notice.title}`}
            title="Dismiss"
            onClick={() => dismiss(String(notice.id))}
          >
            ×
          </button>
          <span className={styles.noticeTop}>
            <span className={styles.noticeName}>
              <span className={`${styles.noticeIcon} ${NOTICE_KIND[notice.kind].dot}`} aria-hidden="true">
                {NOTICE_KIND[notice.kind].icon}
              </span>
              {NOTICE_KIND[notice.kind].label} · {notice.warehouse}
            </span>
            <span>{notice.time}</span>
          </span>
          <strong>
            {notice.title}
            {notice.category ? <span className={styles.noticeCategory}> ({notice.category})</span> : null}
          </strong>
          <span className={styles.detail} title={notice.detail}>
            {notice.detail}
          </span>
        </li>
      ))}
    </ul>
    </div>
  );
}

const NOTICE_KIND: Record<WarehouseNoticeKind, { label: string; dot: string; icon: string }> = {
  order: { label: "Order", dot: styles.dotOrder, icon: "🛒" },
  stockIn: { label: "Stock in", dot: styles.dotStockIn, icon: "📥" },
  faulty: { label: "Faulty", dot: styles.dotFaulty, icon: "⚠️" },
  install: { label: "Install", dot: styles.dotInstall, icon: "🔧" },
};

function countLabel(value: number | null) {
  return value === null ? "—" : String(value);
}

// "loaded": a verified Stock Out's items were moved to the customer's house (Loading tab).
type VerificationMaterial =
  | "job"
  | "panel"
  | "inverter"
  | "battery"
  | "mounting"
  // Mounting Structure is packed in two parts, each with its own "Packed by".
  | "mounting_rail"
  | "mounting_hook"
  | "electrical"
  | "commercial"
  | "loaded"
  // All panels scanned on site by the driver (Loading tab).
  | "arrived";
type VerificationRecord = { jobRef: string; material: string; by: string };
// Transactions table tabs. Loading (Stock Out only): verified jobs already moved to the customer's house.
// "loading" / "siteCheck": the Loading page's two tabs, also on the Stock Out list.
type TxStatusTab = "toVerify" | "verified" | "loading" | "siteCheck";

type StockItemTab = "panel" | "inverter" | "battery" | "other" | "mounting" | "special";

type TabId = "home" | "transfer" | "stock" | "loading" | "siteCheck" | "customers" | "admin";

// The Home tab shows a house icon instead of the word (screen readers still hear "Home").
function HomeIcon() {
  return (
    <svg
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      style={{ display: "block", margin: "0 auto" }}
    >
      <path d="M3 10.5 12 3l9 7.5" />
      <path d="M5 9.5V21h5v-6h4v6h5V9.5" />
    </svg>
  );
}

// The Stock Details tab shows three small icons: a solar panel, an inverter and a battery
// (screen readers still hear "Stock Details").
function StockIcon() {
  return (
    <svg
      width="46"
      height="18"
      viewBox="0 0 46 18"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      style={{ display: "block", margin: "0 auto" }}
    >
      {/* Solar panel: a tilted frame with cells, on a stand */}
      <path d="M3 3h10l2 9H1z" />
      <path d="M2 7.5h12M6 3l-.5 9M10 3l.5 9" />
      <path d="M8 12v4M5.5 16h5" />
      {/* Inverter: a box with an AC wave */}
      <rect x="18" y="2.5" width="10" height="13" rx="1.5" />
      <path d="M20 9c1-2 2-2 3 0s2 2 3 0" />
      {/* Battery: body, terminal and charge level */}
      <rect x="32" y="4" width="11" height="10" rx="1.5" />
      <path d="M43 7.5h1.5v3H43" />
      <path d="M34.5 9h4M36.5 7v4" />
    </svg>
  );
}

// The Project Team tab shows an engineer in a safety helmet (screen readers still hear "Project Team").
function EngineerIcon() {
  return (
    <svg
      width="20"
      height="20"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      style={{ display: "block", margin: "0 auto" }}
    >
      {/* Safety helmet: dome, ridge and brim */}
      <path d="M6.5 9a5.5 5.5 0 0 1 11 0" />
      <path d="M12 3.5V6" />
      <path d="M5 9h14" />
      {/* Face */}
      <path d="M8 9.5a4 4 0 0 0 8 0" />
      {/* Shoulders */}
      <path d="M4.5 21a7.5 7.5 0 0 1 15 0" />
    </svg>
  );
}

// The Site Check tab shows a map pin with a tick (checked at the customer's site) instead of the
// word (screen readers still hear "Site Check"). Not a house, so it does not look like Home.
function SiteCheckIcon() {
  return (
    <svg
      width="20"
      height="18"
      viewBox="0 0 24 22"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      style={{ display: "block", margin: "0 auto" }}
    >
      {/* Map pin */}
      <path d="M12 21s-7-6.3-7-12a7 7 0 0 1 14 0c0 5.7-7 12-7 12z" />
      {/* Tick inside */}
      <path d="m9 9 2.2 2.2L15 7.4" />
    </svg>
  );
}

// The Loading tab shows a lorry icon instead of the word (screen readers still hear "Loading").
function LoadingIcon() {
  return (
    <svg
      width="20"
      height="18"
      viewBox="0 0 26 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      style={{ display: "block", margin: "0 auto" }}
    >
      <path d="M2 5h13v11H2z" />
      <path d="M15 9h5l4 4v3h-9z" />
      <circle cx="6.5" cy="18.5" r="2" />
      <circle cx="19" cy="18.5" r="2" />
    </svg>
  );
}

const TABS: { id: TabId; label: string; shortLabel: string }[] = [
  { id: "home", label: "Home", shortLabel: "Home" },
  // Loading page (shown as a lorry icon): the same page Loading-access users get.
  { id: "loading", label: "Loading", shortLabel: "Loading" },
  // Site Check page (shown as a house with a tick): empty for now.
  { id: "siteCheck", label: "Site Check", shortLabel: "Site Check" },
  { id: "stock", label: "Stock Details", shortLabel: "Stock" },
  { id: "customers", label: "Project Team", shortLabel: "Team" },
  // Shown (right-aligned, after Project Team) only when the session belongs to an admin.
  { id: "admin", label: "Admin", shortLabel: "Admin" },
];

// ---------------------------------------------------------------------------
// Real scheduled installations -> Stock Out rows (only when signed in to the dashboard)
// ---------------------------------------------------------------------------

type ScheduledJobPayload = {
  jobId: string;
  customerName: string;
  customerPhone: string;
  address: string;
  agentName: string;
  installationDate: string;
  teams: string[];
  packageName: string;
  totalAmount: number;
  paymentPercent: number;
  sedaStatus: string;
  panelQuantity: number | null;
  panelRating: number | null;
  powerOutput: string;
  inverterText: string;
  batteryText: string;
  itemLines?: string[];
  sourceId?: string;
  phase?: string;
  commercial?: boolean;
};

function txLines(tx: StockTransaction): StockOutLine[] {
  return (
    tx.lines ?? [
      {
        category: (tx.category === "other" ? "electrical" : tx.category) as StockOutLine["category"],
        model: tx.model,
        qty: tx.qty,
        serialised: true,
      },
    ]
  );
}

// Does this transaction involve the category? (a customer's stock out can hold several)
function txHasCategory(tx: StockTransaction, cat: string): boolean {
  return tx.lines ? tx.lines.some((line) => line.category === cat) : tx.category === cat;
}

// Quantity of one category inside a transaction (null quantities count as 0).
function txCategoryQty(tx: StockTransaction, cat: string): number {
  if (!tx.lines) return tx.category === cat ? tx.qty : 0;
  return tx.lines.filter((line) => line.category === cat).reduce((sum, line) => sum + (line.qty ?? 0), 0);
}

// Panel brand from the invoice wording ("650W JinkoSolar TIGER NEO …" -> "Jinko").
function detectPanelBrand(text: string): string {
  if (/jinko/i.test(text)) return "Jinko";
  if (/astronergy|astro\s*energy|chint/i.test(text)) return "Astronergy";
  if (/longi/i.test(text)) return "Longi";
  if (/trina/i.test(text)) return "Trina";
  if (/canadian/i.test(text)) return "Canadian Solar";
  if (/ja\s*solar/i.test(text)) return "JA Solar";
  return "—";
}

// Our current panel models (the staff model sheet): brand and wattage.
const PANEL_MODELS = [
  "Jinko 575W",
  "Jinko 585W",
  "Astronergy 580W",
  "Jinko 590W",
  "Jinko 620W",
  "Jinko 650W",
  "Astronergy 625W",
];

// Invoice panel wording -> a model on the list above, from the brand and the wattage in the text.
// A panel that is not on the list gives null.
function panelModelCode(name: string): string | null {
  const watts = name.match(/(\d{3})\s*W/i);
  if (!watts) return null;
  const code = `${detectPanelBrand(name)} ${watts[1]}W`;
  return PANEL_MODELS.includes(code) ? code : null;
}

// Our current inverter models (the staff model sheet), by series. The invoice only gives the
// series and the power ("R5 5KW String Inverter"), so the full code is looked up here.
const INVERTER_MODELS: Record<string, string[]> = {
  R5: ["R5-4K-S2", "R5-5K-S2", "R5-6K-S2", "R5-7K-S2", "R5-8K-S2", "R5-12K-T2"],
  R6: [
    "R6-5K-S2", "R6-5K-T2", "R6-6K-S3", "R6-6K-T2", "R6-7K-S2", "R6-7K-S3", "R6-8K-S2", "R6-8K-S3",
    "R6-8K-T2", "R6-10K-S3", "R6-10K-T2", "R6-12K-T2", "R6-12.5K-T2-32", "R6-15K-T2-32", "R6-17K-T2-32",
    "R6-20K-T2-32", "R6-25K-T2-32", "R6-30K-T3-32", "R6-40K-T4-32", "R6-50K-T4-32",
  ],
  C6: ["C6-75K-T6", "C6-100K-T9", "C6-110K-T12", "C6-125K-T12"],
  H2: [
    "H2-5K-LS2", "H2-6K-LS2", "H2-7.6K-LS2", "H2-8K-LS2", "H2-8K-LT2", "H2-10K-LT2", "H2-12K-LT2",
    "H2-15K-LT2", "H2-18K-LT2", "H2-20K-LT2", "H2-25K-T3", "H2-30K-T3",
  ],
  HS3: ["HS3-10K-T2", "HS3-12K-T2"],
  M2: ["M2-2.25K-S4", "M2-2.2K-S4", "M2-2.0K-S4", "M2-1.8K-S4", "M2-1.0K-S2"],
};

// Invoice inverter line -> model code: "[1P] SAJ R5 5KW String Inverter" -> "R5-5K-S2"
// (R5 -> R5, 5KW -> 5K, String -> S). Looked up in the model list above, preferring the
// phase letter (S single, T three) the invoice tag gives. A micro inverter already written as a
// code ("M2-1.0K S2") is just tidied. A line that does not follow this shape is shown as written.
function inverterModelCode(name: string): string {
  const micro = name.match(/\bM(\d+)[\s-]*(\d+(?:\.\d+)?)\s*K\s*-?\s*S(\d+)\b/i);
  if (micro) return `M${micro[1]}-${micro[2]}K-S${micro[3]}`;
  const match = name.match(/\b([A-Z]{1,2}\d+)\s+(\d+(?:\.\d+)?)\s*KW\b/i);
  if (!match) return name;
  const series = match[1].toUpperCase();
  const power = Number(match[2]);
  const candidates = (INVERTER_MODELS[series] ?? []).filter((code) => Number(code.split("-")[1].replace("K", "")) === power);
  const phase = phaseFromInvoiceText(name);
  const letter = phase === "Three phase" ? "T" : phase === "Single phase" ? "S" : "";
  const found = candidates.find((code) => code.split("-")[2].replace(/^L/, "").startsWith(letter)) ?? candidates[0];
  if (found) return found;
  const lower = name.toLowerCase();
  const kind = lower.includes("hybrid") ? "H" : lower.includes("micro") ? "M" : letter || "S";
  return `${series}-${match[2]}K-${kind}2`;
}

// Our current battery models (the staff model sheet): B series and BU series.
const BATTERY_MODELS = [
  "B3-5.0-LV",
  "B3-16.0-LV",
  "B2-5.0-LV1",
  "BU2-5.0-HV1",
  "BU3-5.0-TV2-PRO-BASE",
  "BU3-5.0-TV2-PRO",
];

// Invoice battery wording ("SAJ EK60-B3-16LV Battery", "B3-5.0-LV") -> the model on the list above,
// matched ignoring spaces, dots and hyphens and with a missing ".0" read as ".0" ("B3-16LV" = B3-16.0-LV).
// A battery that is not on the list gives null.
function batteryModelCode(name: string): string | null {
  const squash = (text: string) => text.toUpperCase().replace(/[^A-Z0-9]/g, "");
  const text = squash(name.replace(/(\d)\.0(?!\d)/g, "$1"));
  const ranked = BATTERY_MODELS.map((code) => ({ code, key: squash(code.replace(/(\d)\.0(?!\d)/g, "$1")) })).sort(
    (a, b) => b.key.length - a.key.length,
  );
  return ranked.find((item) => text.includes(item.key))?.code ?? null;
}

// "[1P] SAJ R5 5KW" or "1P SAJ …" -> "Single phase";"[3P] …" or "3P …" -> "Three phase".
// The tag has to stand on its own (not inside a longer word or number such as "13P").
function phaseFromInvoiceText(text: string): "Single phase" | "Three phase" | null {
  const upper = ` ${text.toUpperCase()} `;
  const found = (tag: string) => {
    let from = 0;
    for (;;) {
      const at = upper.indexOf(tag, from);
      if (at < 0) return false;
      const before = upper[at - 1];
      const after = upper[at + tag.length];
      const isEdge = (ch: string | undefined) => !ch || !/[0-9A-Z]/.test(ch);
      if (isEdge(before) && isEdge(after)) return true;
      from = at + 1;
    }
  };
  if (found("3P")) return "Three phase";
  if (found("1P")) return "Single phase";
  return null;
}

// Inverter brand from the invoice wording ("[3P] SAJ H2 12KW …" -> "SAJ").
function detectInverterBrand(text: string): string {
  if (/\bsaj\b/i.test(text)) return "SAJ";
  if (/deye/i.test(text)) return "Deye";
  if (/fox\s*ess|\bfox\b/i.test(text)) return "FoxESS";
  if (/sungrow/i.test(text)) return "Sungrow";
  if (/huawei/i.test(text)) return "Huawei";
  if (/growatt/i.test(text)) return "Growatt";
  if (/solis/i.test(text)) return "Solis";
  if (/good\s*we/i.test(text)) return "GoodWe";
  if (/sofar/i.test(text)) return "Sofar";
  if (/solax/i.test(text)) return "Solax";
  if (/sigen/i.test(text)) return "Sigenergy";
  return "—";
}

// TEST ONLY: every job installed on this day counts as Verified (with sample scans below), so the
// Verified, Loading and on-site scan steps can be tried. Remove once real verification is in use.
const TEST_VERIFIED_DATE = "2026-10-23";
const SAMPLE_BOX_SIZE = 36;
// Test-day jobs left in Preparing (to be verified for real): CHEW YOON MOI.
const TEST_PREPARING_JOBS = new Set(["INV-1010698"]);
// TEST ONLY: every Stock Out job on a delivery run of this slot day counts as Verified and loaded
// (shown on Loading › Verified), so that view can be tried. Nothing is saved: the "loaded" marks
// live in the page only. Remove once real loading is in use.
const TEST_LOADED_SLOT_DATE = "2026-10-20";
// The jobs found on those runs (filled in once the Delivery Schedule has loaded).
const TEST_LOADED_REFS = new Set<string>();
// TEST ONLY: jobs that count as Verified (not loaded) and sit on Loading › Preparing on the given
// slot day (their real run is moved to that day in the page only), so Preparing can be tried.
const TEST_LOADING_PREPARING: Record<string, string> = {
  "INV-1011113": "2026-10-20", // OOI IN HAN (KHAIRUL's 8am run): left out of the 20 Oct loaded jobs
};
// TEST ONLY: a test job (23 Oct installs, or a 20 Oct slot job) that gets sample scans and names.
function isTestVerifiedJob(tx: StockTransaction): boolean {
  return (
    tx.id.startsWith("live-") &&
    tx.status === "Verified" &&
    (tx.time === TEST_VERIFIED_DATE || TEST_LOADED_REFS.has(tx.reference) || tx.reference in TEST_LOADING_PREPARING)
  );
}

// TEST ONLY: sample warehouse scans for the test jobs (isTestVerifiedJob): panels by box (one box
// barcode per box of up to 36; the last box holds the remainder) with 2 loose panels on top, and
// one serial per inverter / battery. Used only while nothing has been saved for the job.
function sampleWarehouseScans(
  tx: StockTransaction,
  serialLines: StockOutLine[],
): { boxes: { code: string; qty: number }[]; scans: { serial: string; lineIdx: number }[] } | null {
  if (!isTestVerifiedJob(tx)) return null;
  const job = tx.reference;
  const boxes: { code: string; qty: number }[] = [];
  const scans: { serial: string; lineIdx: number }[] = [];
  const pad = (n: number, width: number) => String(n).padStart(width, "0");
  serialLines.forEach((line, lineIdx) => {
    const qty = line.qty ?? 0;
    if (line.category === "panel") {
      const loose = qty > 2 ? 2 : qty;
      let inBoxes = qty - loose;
      while (inBoxes > 0) {
        const boxQty = Math.min(SAMPLE_BOX_SIZE, inBoxes);
        boxes.push({ code: `BOX-${job}-${pad(boxes.length + 1, 2)}`, qty: boxQty });
        inBoxes -= boxQty;
      }
      for (let k = 1; k <= loose; k += 1) scans.push({ serial: `PNL-${job}-${pad(k, 3)}`, lineIdx });
    } else {
      const prefix = line.category === "battery" ? "BAT" : "INV";
      for (let k = 1; k <= qty; k += 1) scans.push({ serial: `${prefix}-${job}-${lineIdx + 1}${pad(k, 2)}`, lineIdx });
    }
  });
  return { boxes, scans };
}

// TEST ONLY: "Prepared by" / "Packed by" for the test jobs (isTestVerifiedJob), which have no saved
// records (the names on the company DO: Material Planner and Warehouse Manager).
function testPreparedBy(tx: StockTransaction): Record<string, string> {
  if (!isTestVerifiedJob(tx)) return {};
  const prepared = "Jia Keat";
  const packed = "Wei Hao";
  return {
    job: prepared,
    panel: prepared,
    inverter: prepared,
    battery: prepared,
    electrical: prepared,
    commercial: prepared,
    mounting: packed,
    mounting_rail: packed,
    mounting_hook: packed,
  };
}

// TEST ONLY: a dummy lorry plate for CHEOK GEOK LIAN's job (not saved).
const DUMMY_LORRY_PLATE = "JMG 8811";

function liveStockOutRows(jobs: ScheduledJobPayload[]): StockTransaction[] {
  const rows: StockTransaction[] = [];
  jobs.forEach((job) => {
    // Every invoice item line, sorted into panel / inverter / battery / mounting /
    // electrical. The count on a line ("26X …") wins over the separate quantity field
    // and is stripped from the description.
    const items = classifyInvoiceLines(job.itemLines ?? [job.powerOutput, job.inverterText, job.batteryText]);
    const ofGroup = (group: string) => items.filter((item) => item.group === group);
    const panelFallback = parseCountedItem(job.powerOutput);
    const panelItem = ofGroup("panel")[0];
    const panelQty = panelItem?.qty ?? panelFallback.qty ?? job.panelQuantity ?? 0;
    const panelName =
      panelItem?.name || panelFallback.name || (job.panelRating ? `${job.panelRating}W Panel` : "Panel");
    const notReal = (name: string) => !name || /^(n\/?a|none|-)$/i.test(name);
    const inverterItems = ofGroup("inverter");
    if (inverterItems.length === 0) {
      const fallback = parseCountedItem(job.inverterText);
      if (!notReal(fallback.name)) inverterItems.push({ group: "inverter", name: fallback.name, qty: fallback.qty });
    }
    const batteryItems = ofGroup("battery");
    if (batteryItems.length === 0) {
      const fallback = parseCountedItem(job.batteryText);
      if (!notReal(fallback.name)) batteryItems.push({ group: "battery", name: fallback.name, qty: fallback.qty });
    }
    const kwp = panelQty && job.panelRating ? ((panelQty * job.panelRating) / 1000).toFixed(2) : "—";
    const schedule: StockOutScheduleData = {
      live: true,
      jobId: job.jobId,
      customerName: job.customerName,
      customerPhone: job.customerPhone || undefined,
      customerAddress: job.address || undefined,
      scheduledDate: job.installationDate,
      installerTeam: job.teams.join(", ") || "—",
      systemPackage: job.packageName || undefined,
      commercial: job.commercial === true,
      allocatedQty: panelQty,
      dispatchedQty: 0,
      systemSizeKwp: kwp,
      dcAcRatio: "—",
      systemPrice: job.totalAmount ? `RM ${job.totalAmount.toLocaleString("en-MY", { minimumFractionDigits: 2 })}` : "—",
      panelBrand: detectPanelBrand(`${panelName} ${job.powerOutput}`),
      noOfPanel: panelQty,
      panelPowerWatts: job.panelRating ?? undefined,
      inverterBrand: detectInverterBrand(`${inverterItems[0]?.name ?? ""} ${job.inverterText}`),
      inverterNo: "—",
      inverterSize: inverterItems[0]?.name || "—",
      totalInverterPower: "—",
      payment: `${Math.round(job.paymentPercent)}% Paid`,
      sedaStatus: job.sedaStatus || "—",
      insuranceAppliedDate: "—",
      agentName: job.agentName || "—",
      // TNB meter: read from the invoice (prod_main) lines: 1P = single phase, 3P = three phase.
      // The inverter's own line is checked first, then the other invoice lines. Only when the
      // invoice has no tag does it fall back to the phase recorded on the job.
      tnbMeter:
        phaseFromInvoiceText(inverterItems.map((item) => item.name).join(" ")) ??
        phaseFromInvoiceText((job.itemLines ?? []).join(" ")) ??
        (job.phase === "Single phase" || job.phase === "Three phase" ? job.phase : "—"),
      inverterModel: inverterItems.map((item) => inverterModelCode(item.name)).join(" + ") || "—",
      jobSourceId: job.sourceId || undefined,
    };
    const lines: StockOutLine[] = [];
    if (panelQty > 0) {
      lines.push({
        category: "panel",
        model: panelName,
        qty: panelQty,
        serialised: true,
        serialCode: `SN-${job.jobId}-PNL`,
      });
    }
    inverterItems.forEach((item, n) => {
      lines.push({ category: "inverter", model: item.name, qty: item.qty ?? 1, serialised: true, serialCode: `SN-${job.jobId}-INV${n + 1}` });
    });
    batteryItems.forEach((item, n) => {
      lines.push({ category: "battery", model: item.name, qty: item.qty ?? 1, serialised: true, serialCode: `SN-${job.jobId}-BAT${n + 1}` });
    });
    // Bulk materials are listed as the invoice names them. The invoice does not set
    // their quantity, so the warehouse enters what it loads. When the invoice names
    // none, a generic line stands in because every install needs them.
    const mountingItems = ofGroup("mounting");
    if (mountingItems.length > 0) {
      mountingItems.forEach((item) => lines.push({ category: "mounting", model: item.name, qty: null, serialised: false }));
    } else {
      lines.push({ category: "mounting", model: "Mounting structure", qty: null, serialised: false });
    }
    // Electrical items as the invoice names them. When it names none, nothing stands in: the
    // Electrical Item tab's list is filled in instead.
    ofGroup("electrical").forEach((item) => lines.push({ category: "electrical", model: item.name, qty: null, serialised: false }));
    const first = lines[0];
    rows.push({
      id: `live-${job.jobId}`,
      time: job.installationDate,
      type: "out",
      category: first.category as StockTransaction["category"],
      model: lines.map((line) => line.model).join(" + "),
      serialCode: `SN-${job.jobId}`,
      qty: lines.filter((line) => line.serialised).reduce((sum, line) => sum + (line.qty ?? 0), 0),
      warehouse: "JB",
      reference: job.jobId,
      party: job.customerName,
      // TEST ONLY: jobs on TEST_VERIFIED_DATE count as Verified.
      status:
        (job.installationDate === TEST_VERIFIED_DATE && !TEST_PREPARING_JOBS.has(job.jobId)) || job.jobId in TEST_LOADING_PREPARING
          ? "Verified"
          : "To Verify",
      schedule,
      lines,
    });
  });
  return rows;
}

// ---------------------------------------------------------------------------
// Last-minute Stock Out: items the PIC took on top of a job (or for no job)
// ---------------------------------------------------------------------------

type ExtraStockOutRecord = {
  ref: string;
  linkedJob: string;
  customerName: string;
  takenBy: string;
  reason: string;
  note: string;
  warehouse: string;
  date: string;
  lines: { category: StockOutLine["category"]; model: string; qty: number; serials?: string[] }[];
  createdBy: string;
  hasPhoto?: boolean;
};

const EXTRA_REASONS: [string, string][] = [
  ["extra", "Extra for job"],
  ["replacement", "Replacement"],
  ["damaged", "Damaged swap"],
  ["other", "Other"],
];
const extraReasonLabel = (value: string) => EXTRA_REASONS.find(([id]) => id === value)?.[1] ?? value;

// One last-minute record -> a Stock Out row. It reuses the linked job's customer details (so the
// verification page and report show who it is for), under its own reference "XO-<n>": its
// verification, Loading and saved quantities are kept apart from the job's own.
function extraStockOutRow(record: ExtraStockOutRecord, jobRows: StockTransaction[]): StockTransaction {
  const job = record.linkedJob ? jobRows.find((t) => t.reference === record.linkedJob && !t.extra) : undefined;
  const serialised = (cat: string) => cat === "panel" || cat === "inverter" || cat === "battery";
  const lines: StockOutLine[] = record.lines.map((line, n) => ({
    category: line.category,
    model: line.model,
    qty: line.qty,
    serialised: serialised(line.category),
    serialCode: serialised(line.category) ? `SN-${record.ref}-${n + 1}` : undefined,
    // Scanned on the New Stock Out form: the verification page starts with these filled in.
    serials: serialised(line.category) && line.serials?.length ? line.serials : undefined,
  }));
  const customer = job?.party || record.customerName || (record.linkedJob ? `Job ${record.linkedJob}` : "No job");
  const schedule: StockOutScheduleData = job?.schedule
    ? { ...job.schedule, jobId: record.ref }
    : {
        live: true,
        jobId: record.ref,
        customerName: customer,
        scheduledDate: record.date,
        installerTeam: "—",
        allocatedQty: 0,
        dispatchedQty: 0,
      };
  const first = lines[0];
  return {
    id: `extra-${record.ref}`,
    time: record.date,
    type: "out",
    category: (first?.category ?? "electrical") as StockTransaction["category"],
    model: lines.map((line) => line.model).join(" + "),
    serialCode: `SN-${record.ref}`,
    qty: lines.filter((line) => line.serialised).reduce((sum, line) => sum + (line.qty ?? 0), 0),
    warehouse: record.warehouse === "KL" || record.warehouse === "KLG" ? record.warehouse : "JB",
    reference: record.ref,
    party: customer,
    status: "To Verify",
    schedule,
    lines,
    extra: {
      linkedJob: record.linkedJob,
      takenBy: record.takenBy,
      reason: record.reason,
      note: record.note,
      createdBy: record.createdBy,
      hasPhoto: record.hasPhoto === true,
    },
  };
}

// Panel, inverter and battery units are tracked by serial number.
const isSerialCategory = (cat: string) => cat === "panel" || cat === "inverter" || cat === "battery";

// A taken photo, made smaller (longest side 1280 px, JPEG) so it saves quickly.
function resizePhoto(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      const scale = Math.min(1, 1280 / Math.max(img.width, img.height));
      const canvas = document.createElement("canvas");
      canvas.width = Math.round(img.width * scale);
      canvas.height = Math.round(img.height * scale);
      canvas.getContext("2d")?.drawImage(img, 0, 0, canvas.width, canvas.height);
      URL.revokeObjectURL(url);
      resolve(canvas.toDataURL("image/jpeg", 0.75));
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("Could not read the photo."));
    };
    img.src = url;
  });
}

// The photo saved with a last-minute Stock Out, loaded only when shown.
function ExtraStockOutPhoto({ reference }: { reference: string }) {
  const [photo, setPhoto] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let cancelled = false;
    fetch(`/api/warehouse/extra-stock-out?photo=${encodeURIComponent(reference)}`, { credentials: "same-origin", cache: "no-store" })
      .then(async (res) => {
        const body = (await res.json().catch(() => ({}))) as { photo?: string | null };
        if (cancelled) return;
        if (res.ok && body.photo) setPhoto(body.photo);
        else setFailed(true);
      })
      .catch(() => {
        if (!cancelled) setFailed(true);
      });
    return () => {
      cancelled = true;
    };
  }, [reference]);
  if (failed) return <span className={styles.note}>Photo could not be loaded.</span>;
  if (!photo) return <span className={styles.note}>Loading photo…</span>;
  return (
    <a href={photo} target="_blank" rel="noreferrer" title="Open the photo">
      <img src={photo} alt="Items taken" style={{ display: "block", maxWidth: "220px", maxHeight: "220px", borderRadius: "8px", marginTop: "8px" }} />
    </a>
  );
}

// The "+ New Stock Out" form: a last-minute item taken by the PIC. Saving it creates the record
// and opens its Stock Out Verification page, where the items are scanned / counted as usual.
function NewStockOutPage({
  jobs,
  signedInName,
  onBack,
  onCreated,
}: {
  // Scheduled jobs (Stock Out rows) the item can be linked to.
  jobs: StockTransaction[];
  // The signed-in person: "Taken by (PIC)" starts with this name (it can be changed when
  // someone else, e.g. the installer, took the item).
  signedInName: string;
  onBack: () => void;
  // Called once the record is saved; it marks it Verified (awaited while "Saving…" shows).
  onCreated: (record: ExtraStockOutRecord) => Promise<void> | void;
}) {
  // serials: scanned on this form (panel / inverter / battery); when there are any, they set the quantity.
  type Line = { category: StockOutLine["category"]; model: string; qty: string; serials: string[] };
  const [noJob, setNoJob] = useState(false);
  const [jobSearch, setJobSearch] = useState("");
  const [jobRef, setJobRef] = useState("");
  // The matching jobs drop down under the search box while typing.
  const [jobListOpen, setJobListOpen] = useState(false);
  const [takenBy, setTakenBy] = useState(signedInName);
  const [reason, setReason] = useState("extra");
  const [note, setNote] = useState("");
  const [warehouse, setWarehouse] = useState<WarehouseCode>("JB");
  // The date is today's (Malaysia time), set automatically.
  const date = isoToday();
  const [lines, setLines] = useState<Line[]>([{ category: "panel", model: "", qty: "", serials: [] }]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Barcode scanning: which item row is being scanned (laser gun / typing, or the camera).
  const [scanRow, setScanRow] = useState<number | null>(null);
  const [scanInput, setScanInput] = useState("");
  const [scanMsg, setScanMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [cameraOn, setCameraOn] = useState(false);
  const [cameraError, setCameraError] = useState<string | null>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const scanInputRef = useRef<HTMLInputElement>(null);
  // Photo of the items taken (optional).
  const [photo, setPhoto] = useState<string | null>(null);
  const [photoBusy, setPhotoBusy] = useState(false);

  // Add one scanned serial to the row being scanned (not twice, on any row).
  const linesRef = useRef(lines);
  linesRef.current = lines;
  const scanRowRef = useRef<number | null>(null);
  scanRowRef.current = scanRow;
  const addSerial = (raw: string) => {
    const code = raw.trim();
    const row = scanRowRef.current;
    if (!code || row === null) return;
    if (linesRef.current.some((line) => line.serials.some((serial) => serial.toLowerCase() === code.toLowerCase()))) {
      setScanMsg({ ok: false, text: `⚠️ Duplicate Scan: S/N ${code} was already recorded!` });
      return;
    }
    const line = linesRef.current[row];
    setScanMsg({ ok: true, text: `✅ Recorded S/N ${code}${line?.model ? ` as ${line.model}` : ""} (${(line?.serials.length ?? 0) + 1})` });
    setLines((prev) => prev.map((line, i) => (i === row ? { ...line, serials: [...line.serials, code] } : line)));
  };

  // Camera scanning for the row being scanned; stopped when closed or another row is picked.
  useEffect(() => {
    if (!cameraOn || scanRow === null) return;
    let stream: MediaStream | null = null;
    let timer: ReturnType<typeof setInterval> | null = null;
    let cancelled = false;
    let lastCode = "";
    if (typeof navigator === "undefined" || typeof navigator.mediaDevices?.getUserMedia !== "function") {
      setCameraError(cameraErrorMessage(null));
      return;
    }
    openCameraStream()
      .then((s) => {
        if (cancelled) {
          s.getTracks().forEach((t) => t.stop());
          return;
        }
        stream = s;
        if (videoRef.current) {
          videoRef.current.srcObject = s;
          videoRef.current.play().catch(() => {});
        }
        setCameraError(null);
        if (!("BarcodeDetector" in window)) {
          setCameraError("This browser cannot read barcodes from the camera. Use the barcode gun or type the serial.");
          return;
        }
        // @ts-expect-error - standard browser BarcodeDetector API
        const detector = new window.BarcodeDetector({ formats: ["code_128", "qr_code", "ean_13", "data_matrix"] });
        timer = setInterval(async () => {
          if (!videoRef.current || videoRef.current.readyState < 2) return;
          try {
            const found = await detector.detect(videoRef.current);
            const code = found?.[0]?.rawValue as string | undefined;
            // The same barcode stays in view for a while: add it once.
            if (code && code !== lastCode) {
              lastCode = code;
              addSerial(code);
            }
          } catch {}
        }, 400);
      })
      .catch((err) => {
        if (!cancelled) setCameraError(cameraErrorMessage(err));
      });
    return () => {
      cancelled = true;
      if (timer) clearInterval(timer);
      stream?.getTracks().forEach((t) => t.stop());
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cameraOn, scanRow]);

  function openScan(index: number) {
    setScanRow(index);
    setScanMsg(null);
    setScanInput("");
    setCameraError(null);
    // Ready for the laser gun on a computer (not on phones: it pops up the keyboard).
    setTimeout(() => {
      if (window.matchMedia("(pointer: fine)").matches) scanInputRef.current?.focus();
    }, 50);
  }

  async function takePhoto(file: File | undefined) {
    if (!file) return;
    setPhotoBusy(true);
    try {
      setPhoto(await resizePhoto(file));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not read the photo.");
    } finally {
      setPhotoBusy(false);
    }
  }

  // One entry per job reference (newest install date first), searchable by customer or number.
  const jobOptions = useMemo(() => {
    const seen = new Set<string>();
    return jobs
      .filter((t) => t.type === "out" && !t.extra && t.schedule)
      .sort((a, b) => (b.schedule?.scheduledDate ?? "").localeCompare(a.schedule?.scheduledDate ?? ""))
      .filter((t) => (seen.has(t.id) ? false : (seen.add(t.id), true)));
  }, [jobs]);
  const q = jobSearch.trim().toLowerCase();
  const shownJobs = jobOptions
    .filter((t) => !q || t.party.toLowerCase().includes(q) || t.reference.toLowerCase().includes(q))
    .slice(0, 30);
  const pickedJob = jobOptions.find((t) => t.id === jobRef);

  const MODEL_SUGGESTIONS: Record<StockOutLine["category"], string[]> = {
    panel: PANEL_MODELS,
    inverter: Object.values(INVERTER_MODELS).flat(),
    battery: BATTERY_MODELS,
    mounting: MOUNTING_SYSTEMS.flatMap((system) => system.groups.flatMap((group) => group.parts.map((part) => part.name))),
    electrical: ELECTRICAL_GROUPS.flatMap((group) => group.parts),
  };

  const setLine = (index: number, patch: Partial<Line>) =>
    setLines((prev) => prev.map((line, i) => (i === index ? { ...line, ...patch } : line)));

  // Rows in use (a model, a quantity or a scan). Panels / inverters / batteries need every unit
  // scanned (the quantity, or the scans when no quantity is typed); other items need a quantity.
  const usedLines = lines.filter((line) => line.model.trim() || line.qty.trim() || line.serials.length > 0);
  const stillToDo = usedLines.reduce((sum, line) => {
    if (isSerialCategory(line.category)) {
      const target = Math.max(Number(line.qty) || 0, line.serials.length);
      return sum + (target === 0 ? 1 : Math.max(0, target - line.serials.length));
    }
    return sum + (Number(line.qty) >= 1 ? 0 : 1);
  }, 0);
  const allDone = usedLines.length > 0 && stillToDo === 0 && usedLines.every((line) => line.model.trim());

  async function save() {
    setError(null);
    if (!noJob && !pickedJob) return setError("Pick the job this item is for, or tick “No job”.");
    if (!takenBy.trim()) return setError("Enter who took the item (PIC).");
    const cleanLines = lines
      .map((line) => {
        const serials = isSerialCategory(line.category) ? line.serials : [];
        return {
          category: line.category,
          model: line.model.trim(),
          // Scanned units set the quantity.
          qty: serials.length > 0 ? Math.max(Number(line.qty) || 0, serials.length) : Number(line.qty),
          ...(serials.length > 0 ? { serials } : {}),
        };
      })
      .filter((line) => line.model || line.qty);
    if (cleanLines.length === 0) return setError("Add at least one item.");
    if (cleanLines.some((line) => !line.model || !Number.isInteger(line.qty) || line.qty < 1)) {
      return setError("Every item needs a model and a whole-number quantity of 1 or more.");
    }
    setSaving(true);
    try {
      const response = await fetch("/api/warehouse/extra-stock-out", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({
          linkedJob: noJob ? "" : pickedJob?.reference,
          customerName: noJob ? "" : pickedJob?.party,
          takenBy: takenBy.trim(),
          reason,
          note: note.trim(),
          warehouse,
          date,
          lines: cleanLines,
          ...(photo ? { photo } : {}),
        }),
      });
      const body = (await response.json().catch(() => ({}))) as { record?: ExtraStockOutRecord; error?: string };
      if (!response.ok || !body.record) throw new Error(body.error || "Could not save. Try again.");
      await onCreated(body.record);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save. Try again.");
    } finally {
      setSaving(false);
    }
  }

  const label: CSSProperties = { fontWeight: 700, fontSize: "13px", color: "#000", marginBottom: "4px", display: "block" };
  const input: CSSProperties = {
    width: "100%",
    padding: "8px 10px",
    border: "1px solid #cbd5e1",
    borderRadius: "8px",
    fontSize: "14px",
    background: "#fff",
    color: "#000",
    boxSizing: "border-box",
  };
  const field: CSSProperties = { marginBottom: "14px" };

  return (
    <section className={`${styles.screen} ${styles.soPage}`} aria-labelledby="new-stock-out-title">
      <div className={styles.inspectTopBar}>
        <button className={styles.back} type="button" onClick={onBack} style={{ marginBottom: 0 }}>
          Back
        </button>
      </div>
      <h1 id="new-stock-out-title" className={styles.inspectHeroTitle} style={{ margin: "0 0 4px" }}>
        New Stock Out
      </h1>
      <p className={styles.note} style={{ margin: "0 0 16px" }}>
        Last-minute item taken by the PIC. After saving, scan or count the items and press Verified as usual.
      </p>

      <div className={styles.inspectCard} style={{ marginBottom: "16px" }}>
        <div style={field}>
          <span style={label}>Job / customer</span>
          <label style={{ display: "flex", alignItems: "center", gap: "6px", fontSize: "13px", marginBottom: "8px" }}>
            <input type="checkbox" checked={noJob} onChange={(e) => setNoJob(e.target.checked)} />
            No job (other reason)
          </label>
          {!noJob &&
            (pickedJob ? (
              <div style={{ display: "flex", alignItems: "center", gap: "8px", flexWrap: "wrap" }}>
                <strong style={{ fontSize: "14px" }}>
                  {pickedJob.party} · #{pickedJob.reference}
                  {pickedJob.schedule?.scheduledDate ? ` · ${isoDateLabel(pickedJob.schedule.scheduledDate)}` : ""}
                </strong>
                <button type="button" className={styles.btnActionGhost} onClick={() => setJobRef("")}>
                  Change
                </button>
              </div>
            ) : (
              <div style={{ position: "relative" }}>
                <input
                  style={input}
                  type="search"
                  role="combobox"
                  aria-expanded={jobListOpen && jobSearch.trim() !== ""}
                  aria-controls="xo-job-list"
                  autoComplete="off"
                  placeholder="Type customer name or invoice number"
                  value={jobSearch}
                  onChange={(e) => {
                    setJobSearch(e.target.value);
                    setJobListOpen(true);
                  }}
                  onFocus={() => setJobListOpen(true)}
                  onBlur={() => setJobListOpen(false)}
                  onKeyDown={(e) => {
                    if (e.key === "Escape") setJobListOpen(false);
                    // Enter picks the first match.
                    if (e.key === "Enter" && shownJobs[0]) {
                      e.preventDefault();
                      setJobRef(shownJobs[0].id);
                      setJobListOpen(false);
                    }
                  }}
                />
                {jobListOpen && jobSearch.trim() !== "" && (
                  <div
                    id="xo-job-list"
                    role="listbox"
                    style={{
                      position: "absolute",
                      top: "calc(100% + 4px)",
                      left: 0,
                      right: 0,
                      zIndex: 20,
                      maxHeight: "260px",
                      overflowY: "auto",
                      border: "1px solid #cbd5e1",
                      borderRadius: "8px",
                      background: "#fff",
                      boxShadow: "0 8px 24px rgba(15, 23, 42, 0.15)",
                    }}
                  >
                    {shownJobs.length === 0 ? (
                      <p className={styles.note} style={{ margin: "8px 10px" }}>
                        No scheduled job matches.
                      </p>
                    ) : (
                      shownJobs.map((t) => (
                        <button
                          key={t.id}
                          type="button"
                          role="option"
                          aria-selected={false}
                          // Keep the search box focused until the click lands.
                          onMouseDown={(e) => e.preventDefault()}
                          onClick={() => {
                            setJobRef(t.id);
                            setJobListOpen(false);
                          }}
                          style={{
                            display: "block",
                            width: "100%",
                            textAlign: "left",
                            padding: "8px 10px",
                            border: "none",
                            borderBottom: "1px solid #f1f5f9",
                            background: "#fff",
                            cursor: "pointer",
                            fontSize: "13px",
                            color: "#000",
                          }}
                        >
                          <strong>{t.party}</strong> · #{t.reference}
                          {t.schedule?.scheduledDate ? ` · ${isoDateLabel(t.schedule.scheduledDate)}` : ""}
                        </button>
                      ))
                    )}
                  </div>
                )}
              </div>
            ))}
        </div>

        <div style={field}>
          <label style={label} htmlFor="xo-taken-by">
            Taken by (PIC)
          </label>
          <input id="xo-taken-by" style={input} value={takenBy} onChange={(e) => setTakenBy(e.target.value)} placeholder="Name" />
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))", gap: "12px" }}>
          <div style={field}>
            <label style={label} htmlFor="xo-reason">
              Reason
            </label>
            <select id="xo-reason" style={input} value={reason} onChange={(e) => setReason(e.target.value)}>
              {EXTRA_REASONS.map(([id, text]) => (
                <option key={id} value={id}>
                  {text}
                </option>
              ))}
            </select>
          </div>
          <div style={field}>
            <span style={label}>Warehouse</span>
            <div className={styles.filterRow} role="group" aria-label="Warehouse">
              {(["JB", "KL", "KLG"] as WarehouseCode[]).map((wh) => (
                <button
                  key={wh}
                  type="button"
                  className={`${styles.filterBtn} ${warehouse === wh ? styles.filterActive : ""}`}
                  onClick={() => setWarehouse(wh)}
                >
                  {WH_BUTTON_LABEL[wh]}
                </button>
              ))}
            </div>
          </div>
          <div style={field}>
            <span style={label}>Date</span>
            <span style={{ display: "block", padding: "8px 0", fontSize: "14px", color: "#000" }}>{isoDateLabel(date)} (today)</span>
          </div>
        </div>

        <div style={field}>
          <label style={label} htmlFor="xo-note">
            Note (optional)
          </label>
          <input id="xo-note" style={input} value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. roof needed 2 more panels" />
        </div>
      </div>

      <div className={styles.inspectCard} style={{ marginBottom: "16px" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "10px" }}>
          <h2 className={styles.inspectCardTitle} style={{ margin: 0 }}>
            Items
          </h2>
          <button
            type="button"
            className={styles.btnActionGhost}
            onClick={() => setLines((prev) => [...prev, { category: "electrical", model: "", qty: "", serials: [] }])}
          >
            + Add item
          </button>
        </div>
        <datalist id="xo-models-panel">{MODEL_SUGGESTIONS.panel.map((m) => <option key={m} value={m} />)}</datalist>
        <datalist id="xo-models-inverter">{MODEL_SUGGESTIONS.inverter.map((m) => <option key={m} value={m} />)}</datalist>
        <datalist id="xo-models-battery">{MODEL_SUGGESTIONS.battery.map((m) => <option key={m} value={m} />)}</datalist>
        <datalist id="xo-models-mounting">{Array.from(new Set(MODEL_SUGGESTIONS.mounting)).map((m) => <option key={m} value={m} />)}</datalist>
        <datalist id="xo-models-electrical">{Array.from(new Set(MODEL_SUGGESTIONS.electrical)).map((m) => <option key={m} value={m} />)}</datalist>
        {lines.map((line, index) => (
          <div key={index} style={{ marginBottom: "10px", paddingBottom: "10px", borderBottom: "1px solid #f1f5f9" }}>
          <div
            style={{ display: "grid", gridTemplateColumns: "minmax(110px, 0.8fr) minmax(140px, 2fr) 80px auto", gap: "8px", alignItems: "center" }}
          >
            <select
              aria-label="Item type"
              style={input}
              value={line.category}
              onChange={(e) => {
                const category = e.target.value as StockOutLine["category"];
                // Only panels, inverters and batteries keep scanned serials.
                setLine(index, { category, serials: isSerialCategory(category) ? line.serials : [] });
                if (!isSerialCategory(category) && scanRow === index) {
                  setScanRow(null);
                  setCameraOn(false);
                }
              }}
            >
              <option value="panel">Panel</option>
              <option value="inverter">Inverter</option>
              <option value="battery">Battery</option>
              <option value="mounting">Mounting Structure</option>
              <option value="electrical">Electrical Item</option>
            </select>
            <input
              aria-label="Model"
              style={input}
              list={`xo-models-${line.category}`}
              placeholder="Model / item"
              value={line.model}
              onChange={(e) => setLine(index, { model: e.target.value })}
            />
            <input
              aria-label="Quantity"
              style={input}
              type="number"
              min={Math.max(1, line.serials.length)}
              step={1}
              inputMode="numeric"
              placeholder="Qty"
              value={line.qty === "" && line.serials.length > 0 ? String(line.serials.length) : line.qty}
              title={line.serials.length > 0 ? `${line.serials.length} scanned` : undefined}
              onChange={(e) => setLine(index, { qty: e.target.value })}
            />
            <button
              type="button"
              className={styles.btnActionGhost}
              aria-label="Remove item"
              disabled={lines.length === 1}
              onClick={() => {
                setLines((prev) => prev.filter((_, i) => i !== index));
                setScanRow(null);
                setCameraOn(false);
              }}
            >
              ✕
            </button>
          </div>
          {/* Panel / inverter / battery: the same scanner as Stock Out Verification */}
          {isSerialCategory(line.category) &&
            (() => {
              // One row per unit to take (the quantity, or more if more were scanned).
              const target = Math.max(Number(line.qty) || 0, line.serials.length);
              const progress = target > 0 ? Math.min(100, Math.round((line.serials.length / target) * 100)) : 0;
              const open = scanRow === index;
              return (
                <div style={{ marginTop: "8px" }}>
                  {!open ? (
                    <button type="button" className={styles.scannerBtnScan} onClick={() => openScan(index)}>
                      <span>🔍</span> Scan barcode{line.serials.length > 0 ? ` (${line.serials.length}/${target} scanned)` : ""}
                    </button>
                  ) : (
                    <div className={styles.scannerCard} style={{ margin: 0 }}>
                      <div className={styles.scannerHeader}>
                        <div>
                          <h2 className={styles.scannerTitle}>
                            <span>🔍</span> Barcode &amp; Serial Scanner
                          </h2>
                          <p className={styles.scannerHelpText}>
                            Scan each {line.model || "unit"} with the mobile camera or handheld laser gun.
                          </p>
                        </div>
                        <button
                          type="button"
                          className={styles.btnActionGhost}
                          onClick={() => {
                            setScanRow(null);
                            setCameraOn(false);
                          }}
                        >
                          Done
                        </button>
                      </div>

                      {/* Camera viewfinder */}
                      {cameraOn && (
                        <div className={styles.cameraViewfinder}>
                          <button
                            type="button"
                            className={styles.cameraCloseBtn}
                            onClick={() => setCameraOn(false)}
                            aria-label="Close camera"
                            title="Close camera"
                          >
                            ✕
                          </button>
                          <div className={styles.cameraScanLine} />
                          <video ref={videoRef} className={styles.videoCameraActive} playsInline autoPlay muted />
                          {cameraError && (
                            <div style={{ padding: "12px 14px", background: "rgba(0,0,0,0.65)", borderRadius: "6px", margin: "8px" }}>
                              <div style={{ fontSize: "22px", marginBottom: "2px" }}>📸</div>
                              <strong style={{ color: "#f87171", fontSize: "12px" }}>Camera Notice:</strong>
                              <div style={{ fontSize: "11px", color: "#e2e8f0", marginTop: "2px" }}>{cameraError}</div>
                            </div>
                          )}
                          <div style={{ padding: "8px 12px", background: "rgba(0,0,0,0.55)", borderRadius: "6px", marginTop: "6px" }}>
                            <span style={{ fontSize: "11px", color: "#e2e8f0" }}>🎯 Camera auto-detects the barcode.</span>
                          </div>
                        </div>
                      )}

                      {/* Barcode input: an empty box opens the camera */}
                      <form
                        className={styles.scannerInputRow}
                        onSubmit={(e) => {
                          e.preventDefault();
                          addSerial(scanInput);
                          setScanInput("");
                        }}
                      >
                        <input
                          ref={scanInputRef}
                          type="text"
                          className={styles.scannerInput}
                          placeholder="Scan barcode or type unit serial number..."
                          value={scanInput}
                          onChange={(e) => setScanInput(e.target.value)}
                        />
                        <button
                          type="button"
                          className={styles.scannerBtnScan}
                          title="Records the typed serial; with an empty box it opens the camera scanner"
                          onClick={() => {
                            if (scanInput.trim()) {
                              addSerial(scanInput);
                              setScanInput("");
                            } else setCameraOn(true);
                          }}
                        >
                          <span>⚡</span> Scan / Match
                        </button>
                      </form>

                      {/* Scan feedback */}
                      {scanMsg && (
                        <div
                          className={`${styles.scanFeedback} ${scanMsg.ok ? styles.scanFeedbackSuccess : styles.scanFeedbackWarning}`}
                        >
                          <span>{scanMsg.text}</span>
                          <button
                            type="button"
                            style={{ border: 0, background: "transparent", cursor: "pointer", color: "inherit", fontWeight: 700 }}
                            onClick={() => setScanMsg(null)}
                          >
                            &times;
                          </button>
                        </div>
                      )}

                      <hr style={{ border: 0, borderTop: "1px solid var(--line)", margin: "18px 0" }} />
                      <div className={styles.skuProgressHeader}>
                        <div>
                          <p className={styles.itemDesc}>Serial codes are recorded as each unit is scanned.</p>
                        </div>
                        <div className={styles.skuOverallStats}>
                          Scanned: <strong>{line.serials.length}</strong> / {target} ({progress}%)
                        </div>
                      </div>
                      <div className={styles.progressBarContainer}>
                        <div
                          className={`${styles.progressBarFill} ${progress < 100 ? styles.progressBarFillWarning : ""}`}
                          style={{ width: `${progress}%` }}
                        />
                      </div>

                      {/* Units table */}
                      <div className={styles.unitScrollTableWrap}>
                        <table>
                          <thead>
                            <tr>
                              <th scope="col" style={{ width: "50px" }}>No.</th>
                              <th scope="col" style={{ minWidth: "180px" }}>Serial Code</th>
                              <th scope="col">Description / Model</th>
                              <th scope="col" style={{ width: "150px" }}>Match Status</th>
                              <th scope="col" style={{ width: "40px" }} aria-label="Remove" />
                            </tr>
                          </thead>
                          <tbody>
                            {Array.from({ length: target }, (_, n) => {
                              const serial = line.serials[n] ?? null;
                              return (
                                <tr key={n} className={serial ? styles.unitRowVerified : undefined}>
                                  <td style={{ color: "var(--muted)", fontSize: "11px", fontWeight: 600 }}>
                                    #{String(n + 1).padStart(2, "0")}
                                  </td>
                                  <td>
                                    <div style={{ fontFamily: "monospace", fontWeight: 700, fontSize: "13px", letterSpacing: "0.03em" }}>
                                      {serial ?? "—"}
                                    </div>
                                  </td>
                                  <td>
                                    <strong style={{ fontSize: "13px" }}>{line.model || "—"}</strong>
                                  </td>
                                  <td>
                                    {serial ? (
                                      <span className={`${styles.matchPill} ${styles.matchPillComplete}`}>✅ Scanned</span>
                                    ) : (
                                      <span className={`${styles.matchPill} ${styles.matchPillPending}`}>⏳ Pending Scan</span>
                                    )}
                                  </td>
                                  <td>
                                    {serial && (
                                      <button
                                        type="button"
                                        aria-label={`Remove ${serial}`}
                                        title="Remove this scan"
                                        style={{ border: "none", background: "none", cursor: "pointer", color: "#64748b" }}
                                        onClick={() => setLine(index, { serials: line.serials.filter((x) => x !== serial) })}
                                      >
                                        ✕
                                      </button>
                                    )}
                                  </td>
                                </tr>
                              );
                            })}
                            {target === 0 && (
                              <tr>
                                <td colSpan={5} style={{ color: "var(--muted)", fontSize: "12px" }}>
                                  Enter the quantity, or just scan: each scan adds a unit.
                                </td>
                              </tr>
                            )}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  )}
                </div>
              );
            })()}
          </div>
        ))}
        <p className={styles.note} style={{ margin: "6px 0 0" }}>
          Scan panels, inverters and batteries here (or on the next page). Other items are counted on the next page.
        </p>

        {/* Photo of the items taken (optional) */}
        <div style={{ marginTop: "14px", paddingTop: "12px", borderTop: "1px solid #f1f5f9" }}>
        <span style={{ fontWeight: 700, fontSize: "13px", color: "#000", display: "block", marginBottom: "8px" }}>
          Photo (optional)
        </span>
        <div style={{ display: "flex", gap: "12px", alignItems: "flex-start", flexWrap: "wrap" }}>
          <label className={styles.btnActionGhost} style={{ cursor: "pointer" }}>
            {photoBusy ? "Reading…" : photo ? "📷 Retake photo" : "📷 Take photo"}
            <input
              type="file"
              accept="image/*"
              capture="environment"
              style={{ display: "none" }}
              onChange={(e) => {
                void takePhoto(e.target.files?.[0]);
                e.target.value = "";
              }}
            />
          </label>
          {photo && (
            <div>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={photo} alt="Items taken" style={{ display: "block", maxWidth: "220px", maxHeight: "220px", borderRadius: "8px" }} />
              <button type="button" className={styles.btnActionGhost} style={{ marginTop: "6px" }} onClick={() => setPhoto(null)}>
                Remove photo
              </button>
            </div>
          )}
        </div>
        </div>
      </div>

      {error && (
        <p className={styles.note} style={{ color: "#b91c1c", margin: "0 0 12px" }}>
          {error}
        </p>
      )}
      <div className={styles.inspectActionGroup} style={{ display: "flex", justifyContent: "flex-end" }}>
        <button
          type="button"
          className={`${styles.btnActionPrimary} ${allDone ? styles.btnVerifiedGlow : styles.btnVerifiedLocked}`}
          disabled={!allDone || saving}
          onClick={() => void save()}
          title="All items scanned and verified for dispatch"
        >
          {saving
            ? "Saving…"
            : allDone
              ? "✓ Verified (Ready for Installation Dispatch)"
              : `🔒 Verified (${stillToDo} more to scan or enter)`}
        </button>
      </div>
    </section>
  );
}

function Dashboard({
  phone,
  username,
  access,
  model,
  onSignOut,
  onSelect,
}: {
  phone: string;
  username: string;
  access: string;
  model: WarehouseModel | null;
  onSignOut: () => void;
  onSelect: (model: WarehouseModel | null) => void;
}) {
  const [tab, setTab] = useState<TabId>("home");
  const [homeShowsTx, setHomeShowsTx] = useState(false);
  // Which Home transaction list is open (Stock In / Stock Out / all), its category,
  // status tab and day. Kept here so Back from a verification page returns to that same list.
  const [homeTxType, setHomeTxType] = useState<HomeTxType>("all");
  const [homeTxCat, setHomeTxCat] = useState<string>("all");
  const [homeTxStatusTab, setHomeTxStatusTab] = useState<TxStatusTab>("toVerify");
  const [homeDay, setHomeDay] = useState(() => isoToday());
  const [dashboardAdmin, setDashboardAdmin] = useState(false);
  // Admin: every page. Staff: every page except Admin. A phone number that is not
  // registered falls back to the dashboard session (an admin there can open Admin).
  const isAdmin = access === "admin" || (access === "" && dashboardAdmin);
  useEffect(() => {
    let cancelled = false;
    fetch("/api/auth/me", { credentials: "same-origin", cache: "no-store" })
      .then(async (res) => (res.ok ? ((await res.json()) as { user?: { role?: string } }) : null))
      .then((data) => {
        if (!cancelled) setDashboardAdmin(data?.user?.role === "admin");
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);
  // Set when a home card is clicked: which Stock Details tab and warehouse to open on.
  const [stockFocus, setStockFocus] = useState<{ item: StockItemTab; wh: WhFilter } | null>(null);
  const [inverterOpen, setInverterOpen] = useState(false);
  const [inverterType, setInverterType] = useState<InverterTypeId | null>(null);
  const [inspectTxId, setInspectTxId] = useState<string | null>(null);
  // Loading page: the lorry (driver group) whose page is open.
  const [lorryView, setLorryView] = useState<{ driver: string; plate: string; txIds: string[]; stage?: "preparing" | "verified"; day?: string } | null>(null);
  // Opening a customer's verification page starts at its header, not at the list's scroll position.
  useEffect(() => {
    if (inspectTxId) window.scrollTo({ top: 0, left: 0, behavior: "auto" });
  }, [inspectTxId]);
  const [transactions, setTransactions] = useState<StockTransaction[]>(STOCK_TRANSACTIONS);
  // Saved verification records: which job and material, and who completed it.
  const [verifications, setVerifications] = useState<VerificationRecord[]>([]);
  // TEST ONLY: TEST_LOADED_SLOT_DATE jobs count as Verified and loaded (in the page, not saved).
  const [testRuns, setTestRuns] = useState<TimelineRun[]>([]);
  useEffect(() => watchDeliveryRuns<TimelineRun>(setTestRuns), []);
  useEffect(() => {
    const lookup = buildEtaLookup(testRuns);
    const refs = new Set(
      transactions
        .filter(
          (t) =>
            t.type === "out" &&
            lookupEta(lookup, t)?.slotDate === TEST_LOADED_SLOT_DATE &&
            !(t.reference in TEST_LOADING_PREPARING),
        )
        .map((t) => t.reference),
    );
    if (refs.size === 0) return;
    refs.forEach((ref) => TEST_LOADED_REFS.add(ref));
    setTransactions((prev) =>
      prev.some((t) => refs.has(t.reference) && t.status !== "Verified")
        ? prev.map((t) => (refs.has(t.reference) ? { ...t, status: "Verified" as const } : t))
        : prev,
    );
    setVerifications((prev) => {
      const missing = Array.from(refs).filter((ref) => !prev.some((r) => r.jobRef === ref && r.material === "loaded"));
      return missing.length > 0 ? [...prev, ...missing.map((jobRef) => ({ jobRef, material: "loaded", by: "Wei Hao" }))] : prev;
    });
  }, [testRuns, transactions, verifications]);
  // "+ New Stock Out" form (last-minute item taken by the PIC) is open.
  const [newStockOutOpen, setNewStockOutOpen] = useState(false);

  // Record that a material was completed (or the whole job verified) by the signed-in person.
  // It is saved on the server (survives a reload) and written to the Inventory Management
  // audit log with that person's name.
  async function recordVerification(jobRef: string, material: VerificationMaterial): Promise<boolean> {
    try {
      const response = await fetch("/api/warehouse/verifications", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({ jobRef, material, phone }),
      });
      if (!response.ok) return false;
      const body = (await response.json()) as { by?: string };
      setVerifications((prev) =>
        prev.some((r) => r.jobRef === jobRef && r.material === material)
          ? prev
          : [...prev, { jobRef, material, by: body.by ?? "" }],
      );
      return true;
    } catch {
      // Not saved (for example not signed in to the dashboard); the screen still works.
      return false;
    }
  }

  // Copy the booked installations from the scheduling system. Needs the dashboard
  // session; without it (401, public site) the sample Stock Out rows stay.
  useEffect(() => {
    let cancelled = false;
    fetch("/api/warehouse/schedule", { credentials: "same-origin", cache: "no-store" })
      .then(async (res) => {
        // 401 = not signed in to the dashboard: no real jobs are loaded.
        if (res.status === 401) return;
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = (await res.json()) as { jobs?: ScheduledJobPayload[] };
        if (cancelled) return;
        const jobs = data.jobs ?? [];
        const live = liveStockOutRows(jobs);
        // Jobs already verified (saved on the server) come back as Verified.
        let records: VerificationRecord[] = [];
        try {
          const saved = await fetch("/api/warehouse/verifications", { credentials: "same-origin", cache: "no-store" });
          if (saved.ok) records = ((await saved.json()) as { records?: VerificationRecord[] }).records ?? [];
        } catch {
          // Verification records unavailable: jobs show as To Verify.
        }
        if (cancelled) return;
        // Last-minute Stock Outs (each under its own XO- reference), shown with the jobs.
        let extras: StockTransaction[] = [];
        try {
          const saved = await fetch("/api/warehouse/extra-stock-out", { credentials: "same-origin", cache: "no-store" });
          if (saved.ok) {
            const list = ((await saved.json()) as { records?: ExtraStockOutRecord[] }).records ?? [];
            extras = list.map((record) => extraStockOutRow(record, live));
          }
        } catch {
          // Not available: only the scheduled jobs show.
        }
        if (cancelled) return;
        const verifiedJobs = new Set(records.filter((r) => r.material === "job").map((r) => r.jobRef));
        setVerifications(records);
        setTransactions((prev) => [
          ...[...extras, ...live].map((tx) => (verifiedJobs.has(tx.reference) ? { ...tx, status: "Verified" as const } : tx)),
          ...prev.filter((t) => t.type !== "out"),
        ]);
      })
      .catch((err) => {
        console.error("Live schedule failed", err);
      });
    return () => {
      cancelled = true;
    };
  }, []);
  const typeModels = ORDER_MODELS.filter((item) => item.inverterType === inverterType);

  // If viewing transaction inspection page
  if (inspectTxId) {
    const activeTx = transactions.find((t) => t.id === inspectTxId);
    if (activeTx) {
      return (
        <TransactionInspectionPage
          tx={activeTx}
          viewOnly={access === "loading"}
          onRecord={(material) => recordVerification(activeTx.reference, material)}
          loaded={verifications.some((r) => r.jobRef === activeTx.reference && r.material === "loaded")}
          preparedBy={{
            // TEST ONLY: dummy names for the test-day jobs; saved names win.
            ...testPreparedBy(activeTx),
            ...Object.fromEntries(
              verifications.filter((r) => r.jobRef === activeTx.reference).map((r) => [r.material, r.by]),
            ),
          }}
          onBack={() => setInspectTxId(null)}
          onUpdateStatus={(newStatus, remark) => {
            setTransactions((prev) =>
              prev.map((t) =>
                t.id === activeTx.id
                  ? {
                      ...t,
                      status: newStatus,
                      issueRemark: remark ?? (newStatus === "Verified" ? undefined : t.issueRemark),
                    }
                  : t
              )
            );
          }}
        />
      );
    }
  }

  // Loading page › a driver row: one page for that lorry's customers.
  if (lorryView) {
    return (
      <LorryLoadingPage
        driver={lorryView.driver}
        plate={lorryView.plate}
        stage={lorryView.stage ?? "preparing"}
        day={lorryView.day ?? ""}
        txs={lorryView.txIds
          .map((id) => transactions.find((t) => t.id === id))
          .filter((t): t is StockTransaction => Boolean(t))}
        loadedRefs={new Set(verifications.filter((r) => r.material === "loaded").map((r) => r.jobRef))}
        loadedBy={Object.fromEntries(
          verifications.filter((r) => r.material === "loaded" && r.by).map((r) => [r.jobRef, r.by]),
        )}
        onSubmitAll={async (lorryTxs) => {
          // Every customer on the lorry is marked loaded (as the job page's Submit did).
          const results = await Promise.all(lorryTxs.map((tx) => recordVerification(tx.reference, "loaded")));
          return results.every(Boolean);
        }}
        onBack={() => setLorryView(null)}
      />
    );
  }

  // "+ New Stock Out": pressing Verified saves it and marks it Verified straight away, with the same
  // records as the Stock Out Verification page (who prepared each item, the job verified, and
  // the quantities of the counted items). Then the Stock Out list opens on Verified.
  if (newStockOutOpen) {
    return (
      <NewStockOutPage
        jobs={transactions}
        signedInName={username}
        onBack={() => setNewStockOutOpen(false)}
        onCreated={async (record) => {
          const row = { ...extraStockOutRow(record, transactions), status: "Verified" as const };
          // Counted items (mounting, electrical): their quantities, as the verification page saves them.
          const bulk = (row.lines ?? []).filter((line) => !line.serialised && (line.qty ?? 0) > 0);
          if (bulk.length > 0) {
            await fetch("/api/warehouse/entries", {
              method: "PUT",
              headers: { "Content-Type": "application/json" },
              credentials: "same-origin",
              body: JSON.stringify({
                job: record.ref,
                kinds: ["bulk_line"],
                entries: bulk.map((line) => ({ kind: "bulk_line", key: line.model, value: String(line.qty) })),
              }),
            }).catch(() => {});
          }
          const materials = Array.from(new Set((row.lines ?? []).map((line) => line.category))) as VerificationMaterial[];
          await Promise.all(materials.map((material) => recordVerification(record.ref, material)));
          await recordVerification(record.ref, "job");
          setTransactions((prev) => [row, ...prev]);
          setHomeTxType("out");
          setHomeShowsTx(true);
          setHomeTxStatusTab("loading");
          setHomeDay(record.date);
          setTab("home");
          setNewStockOutOpen(false);
        }}
      />
    );
  }

  // ----- Inverter drill-down screens (rendered without tab bar) -----

  if (model) {
    return (
      <section className={styles.screen} aria-labelledby="warehouse-customers">
        <button className={styles.back} type="button" onClick={() => onSelect(null)}>
          Back
        </button>
        <h1 id="warehouse-customers">{model.code}</h1>
        <p className={styles.line}>
          Order {model.orderQty}. {model.onHand} left. {model.pending} still to install.
          {model.onOrder > 0 ? ` ${model.onOrder} already ordered.` : ""}
        </p>
        {model.customers.length > 0 ? (
          <table className={styles.customers}>
            <caption>First names on this model. Pending install on the sheet is {model.pending}.</caption>
            <thead>
              <tr>
                <th scope="col">Customer</th>
                <th scope="col" className={styles.num}>
                  Qty
                </th>
                <th scope="col">Cover</th>
              </tr>
            </thead>
            <tbody>
              {model.customers.map((customer) => (
                <tr key={customer.name}>
                  <td>{customer.name}</td>
                  <td className={styles.num}>{customer.qty}</td>
                  <td>
                    <span className={`${styles.tag} ${customer.cover === "On hand" ? styles.ok : styles.order}`}>
                      {customer.cover}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <p className={styles.note}>Customer names for this model are not on the sample rows loaded.</p>
        )}
      </section>
    );
  }

  if (inverterType) {
    const typeLabel = INVERTER_TYPES.find((item) => item.id === inverterType)?.label ?? "Inverter";
    return (
      <section className={styles.screen} aria-labelledby="warehouse-type">
        <button className={styles.back} type="button" onClick={() => setInverterType(null)}>
          Back
        </button>
        <h1 id="warehouse-type">{typeLabel}</h1>
        {typeModels.length > 0 ? (
          <ul className={styles.models}>
            {typeModels.map((item) => (
              <li key={item.id}>
                <button className={styles.modelButton} type="button" onClick={() => onSelect(item)}>
                  <span>
                    {item.code}
                    <small>
                      {item.onHand} on hand · {item.pending} to install
                      {item.onOrder > 0 ? ` · ${item.onOrder} ordered` : ""}
                    </small>
                  </span>
                  <span className={`${styles.tag} ${styles.order}`}>Buy {item.orderQty}</span>
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <p className={styles.note}>No short hybrid model in this sample.</p>
        )}
      </section>
    );
  }

  if (inverterOpen) {
    return (
      <section className={styles.screen} aria-labelledby="warehouse-types">
        <button className={styles.back} type="button" onClick={() => setInverterOpen(false)}>
          Back
        </button>
        <h1 id="warehouse-types">Inverter</h1>
        <p className={styles.line}>String, hybrid, and micro.</p>
        <div className={styles.typeGrid}>
          {INVERTER_TYPES.map((card) => (
            <button
              key={card.id}
              className={`${styles.typeCard} ${(card.toBuy ?? 0) > 0 ? styles.short : ""}`}
              type="button"
              onClick={() => setInverterType(card.id)}
            >
              <span className={styles.typeName}>{card.label}</span>
              <span className={styles.typeStats}>
                <span>
                  <small>On hand</small>
                  <strong>{countLabel(card.onHand)}</strong>
                </span>
                <span>
                  <small>To install</small>
                  <strong>{countLabel(card.toInstall)}</strong>
                </span>
                <span>
                  <small>To buy</small>
                  <strong>{countLabel(card.toBuy)}</strong>
                </span>
              </span>
            </button>
          ))}
        </div>
      </section>
    );
  }

  // "Loading" access: only the Loading tab of Stock Out and Stock Transfer, view only.
  if (access === "loading") {
    return (
      <>
        <div className={`${styles.screen} ${styles.head}`}>
          <div>
            <h1 id="warehouse-home">Inventory Management</h1>
          </div>
        </div>
        {/* Same tab bar as Admin / Staff, with Home only */}
        <nav className={styles.tabBar} aria-label="Warehouse sections">
          <button type="button" className={`${styles.tab} ${styles.tabActive}`} aria-current="page" aria-label="Home" title="Home">
            <HomeIcon />
          </button>
        </nav>
        <HomeTab
          transactions={transactions}
          onInspectTx={(id) => setInspectTxId(id)}
          onSignOut={onSignOut}
          onInverterOpen={() => {}}
          showTx
          onShowTx={() => {}}
          txType="all"
          setTxType={setHomeTxType}
          txCat={homeTxCat}
          setTxCat={setHomeTxCat}
          txStatusTab="loading"
          setTxStatusTab={setHomeTxStatusTab}
          selectedDay={homeDay}
          setSelectedDay={setHomeDay}
          onOpenTransfer={() => {}}
          onNewStockOut={() => {}}
          onOpenStock={() => {}}
          canUpload={false}
          verifications={verifications}
          loadingOnly
        />
      </>
    );
  }

  // ----- Tab bar + active tab content -----

  return (
    <>
      <div className={`${styles.screen} ${styles.head}`}>
        <div>
          <h1 id="warehouse-home">Inventory Management</h1>
        </div>
      </div>

      <nav className={styles.tabBar} aria-label="Warehouse sections">
        {/* Every page, the Loading page included (Loading-access users get it as their whole view, above). */}
        {TABS.filter((t) => t.id !== "admin" || isAdmin).map((t) => (
          <button
            key={t.id}
            type="button"
            style={t.id === "customers" ? { marginLeft: "auto" } : undefined}
            className={`${styles.tab} ${tab === t.id ? styles.tabActive : ""}`}
            onClick={() => {
              setStockFocus(null);
              // The Home tab always opens the Home page (cards and Stock In / Out / Transfer
              // buttons), not the Stock In or Stock Out list that was open before.
              if (t.id === "home") {
                setHomeShowsTx(false);
                setHomeTxType("all");
              }
              setTab(t.id);
            }}
            aria-current={tab === t.id ? "page" : undefined}
            aria-label={t.id === "admin" ? undefined : t.label}
            title={t.id === "admin" ? undefined : t.label}
          >
            {t.id === "home" ? (
              <HomeIcon />
            ) : t.id === "customers" ? (
              <EngineerIcon />
            ) : t.id === "stock" ? (
              <StockIcon />
            ) : t.id === "loading" ? (
              <LoadingIcon />
            ) : t.id === "siteCheck" ? (
              <SiteCheckIcon />
            ) : (
              <>
                <span className={styles.tabLabelFull}>{t.label}</span>
                <span className={styles.tabLabelShort}>{t.shortLabel}</span>
              </>
            )}
          </button>
        ))}
      </nav>

      {tab === "home" && (
        <HomeTab
          transactions={transactions}
          onInspectTx={(id) => setInspectTxId(id)}
          onSignOut={onSignOut}
          onInverterOpen={() => setInverterOpen(true)}
          showTx={homeShowsTx}
          onShowTx={setHomeShowsTx}
          txType={homeTxType}
          setTxType={setHomeTxType}
          txCat={homeTxCat}
          setTxCat={setHomeTxCat}
          txStatusTab={homeTxStatusTab}
          setTxStatusTab={setHomeTxStatusTab}
          selectedDay={homeDay}
          setSelectedDay={setHomeDay}
          onOpenTransfer={() => setTab("transfer")}
          onNewStockOut={() => setNewStockOutOpen(true)}
          onOpenStock={(item, wh) => {
            setStockFocus({ item, wh });
            setTab("stock");
          }}
          canUpload={isAdmin}
          verifications={verifications}
        />
      )}
      {tab === "transfer" && (
        <StockTransferTab
          transactions={transactions}
          onInspectTx={(id) => setInspectTxId(id)}
          onSignOut={onSignOut}
          onBack={() => {
            // Back to the Stock Transfer list the form was opened from.
            setHomeTxType("transfer");
            setHomeShowsTx(true);
            setTab("home");
          }}
          onNewTransfer={(newTx) => setTransactions((prev) => [newTx, ...prev])}
          preparedByName={username}
          onGoToTransactions={() => {
            setHomeTxType("transfer");
            setHomeShowsTx(true);
            setTab("home");
          }}
        />
      )}
      {tab === "stock" && <StockDetailsTab
          transactions={transactions}
          verifications={verifications}
          initialItem={stockFocus?.item}
          initialWarehouse={stockFocus?.wh}
        />}
      {/* Loading page: the jobs to load (Stock Out and Stock Transfer in one table). Rows open the
          job with this user's normal buttons. Loaded jobs are on the Site Check page. */}
      {tab === "loading" && (
        <HomeTab
          transactions={transactions}
          onInspectTx={(id) => setInspectTxId(id)}
          onSignOut={onSignOut}
          onInverterOpen={() => {}}
          showTx
          onShowTx={() => {}}
          txType="all"
          setTxType={setHomeTxType}
          txCat={homeTxCat}
          setTxCat={setHomeTxCat}
          txStatusTab="loading"
          setTxStatusTab={setHomeTxStatusTab}
          selectedDay={homeDay}
          setSelectedDay={setHomeDay}
          onOpenTransfer={() => {}}
          onNewStockOut={() => {}}
          onOpenStock={() => {}}
          canUpload={false}
          verifications={verifications}
          loadingOnly
          loadingMode="ready"
          onOpenLorry={setLorryView}
        />
      )}
      {/* Site Check page: the loaded jobs (scan each panel on site), as the Loading page's Site
          Check tab was. */}
      {tab === "siteCheck" && (
        <HomeTab
          transactions={transactions}
          onInspectTx={(id) => setInspectTxId(id)}
          onSignOut={onSignOut}
          onInverterOpen={() => {}}
          showTx
          onShowTx={() => {}}
          txType="all"
          setTxType={setHomeTxType}
          txCat={homeTxCat}
          setTxCat={setHomeTxCat}
          txStatusTab="loading"
          setTxStatusTab={setHomeTxStatusTab}
          selectedDay={homeDay}
          setSelectedDay={setHomeDay}
          onOpenTransfer={() => {}}
          onNewStockOut={() => {}}
          onOpenStock={() => {}}
          canUpload={false}
          verifications={verifications}
          loadingOnly
          loadingMode="loaded"
        />
      )}
      {tab === "customers" && <StockByCustomerTab />}
      {tab === "admin" && isAdmin && <AdminTab />}
    </>
  );
}

// ---------------------------------------------------------------------------
// Shared category display helpers
// ---------------------------------------------------------------------------

const CAT_LABEL: Record<string, string> = {
  panel: "Panel",
  inverter: "Inv.",
  battery: "Batt.",
  mounting: "Mounting",
  electrical: "Electrical",
  other: "Other",
};

function catClass(cat: string): string {
  if (cat === "panel") return styles.catPanel;
  if (cat === "inverter") return styles.catInverter;
  if (cat === "battery") return styles.catBattery;
  return styles.tag;
}

// Warehouse filter buttons on every page: JB, KL and Kluang (code KLG). There is no "All"
// button: clicking the active warehouse again turns it off and shows all warehouses. Kluang has no
// stock counts yet, so it shows "—" / 0 until real figures are added.
type WarehouseCode = "JB" | "KL" | "KLG";
type WhFilter = "all" | WarehouseCode;
const WH_FILTERS: WarehouseCode[] = ["JB", "KL", "KLG"];
const WH_BUTTON_LABEL: Record<WhFilter, string> = { all: "All", JB: "JB", KL: "KL", KLG: "Kluang" };

const WH_SPLIT: Record<string, { JB: number; KL: number; KLG?: number }> = {
  inverter: { JB: 245, KL: 197 },
  panel: { JB: 450, KL: 320 },
  battery: { JB: 95, KL: 48 },
};

const WEEK_MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

type HomeTxType = "all" | "in" | "out" | "transfer";

function isoToday(): string {
  return new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Kuala_Lumpur" });
}

function shiftIso(iso: string, days: number): string {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
}

function mondayOfIso(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  const back = (new Date(Date.UTC(y, m - 1, d)).getUTCDay() + 6) % 7;
  return shiftIso(iso, -back);
}

// A transaction's real date. Real jobs carry an ISO date; the sample rows carry
// text like "Today, 10:30 AM", "Yesterday, 4:20 PM" or "14 Oct, 03:50 PM".
// Search box match for a Stock In / Out / Transfer row (customer, reference, model, serial, …).
function txMatchesSearch(tx: StockTransaction, search: string): boolean {
  const q = search.trim().toLowerCase();
  if (!q) return true;
  return (
    tx.model.toLowerCase().includes(q) ||
    tx.reference.toLowerCase().includes(q) ||
    tx.party.toLowerCase().includes(q) ||
    tx.serialCode.toLowerCase().includes(q) ||
    tx.status.toLowerCase().includes(q) ||
    (tx.transfer?.transferNo ?? "").toLowerCase().includes(q) ||
    (tx.transfer?.driverName ?? "").toLowerCase().includes(q)
  );
}

function txDate(tx: StockTransaction): string | null {
  const text = tx.time.trim();
  if (/^\d{4}-\d{2}-\d{2}/.test(text)) return text.slice(0, 10);
  const today = isoToday();
  if (/^today/i.test(text)) return today;
  if (/^yesterday/i.test(text)) return shiftIso(today, -1);
  const m = text.match(/^(\d{1,2})\s+([A-Za-z]{3})/);
  if (m) {
    const month = WEEK_MONTHS.findIndex((name) => name.toLowerCase() === m[2].toLowerCase());
    if (month >= 0) {
      const year = Number(today.slice(0, 4));
      return `${year}-${String(month + 1).padStart(2, "0")}-${m[1].padStart(2, "0")}`;
    }
  }
  return null;
}

// "2026-11-12" -> "12 Nov 2026"; any other text (e.g. "Today, 10:30 AM") is shown as written.
function txInWarehouse(tx: StockTransaction, wh: WhFilter): boolean {
  if (wh === "all") return true;
  if (tx.type === "transfer" && tx.transfer) {
    return tx.transfer.fromWarehouse === wh || tx.transfer.toWarehouse === wh || tx.warehouse === wh;
  }
  return tx.warehouse === wh;
}

// Stock In "Item Type": Panel, Inverter, Battery, Mounting Structure, Electrical Item, ...
function itemTypeLabel(category: string): string {
  if (!category) return "—";
  return PO_ITEM_TYPE_OPTIONS.find(([value]) => value === category)?.[1] ?? category.charAt(0).toUpperCase() + category.slice(1);
}

// Customer name for matching across invoices: upper case, tags in brackets such as "(ATAP)"
// dropped, spaces collapsed. "HEAH KEE THIN (ATAP)" and "Heah Kee Thin" give the same key.
function customerNameKey(name: string | undefined | null): string {
  return (name ?? "").toUpperCase().replace(/\([^)]*\)/g, " ").replace(/\s+/g, " ").trim();
}

// Delivery Schedule details for a Stock Out job: its run's slot (date + departure time), the
// ETA at the customer's house, and the schedule's install date / time. Looked up by invoice
// number, and by customer name as a fallback: the same customer can be on the run under another
// of their invoices (e.g. "HEAH KEE THIN (ATAP)" is installed under one invoice but delivered
// under another).
type EtaInfo = { date: string; time: string; installDate: string; installTime: string; slotDate: string; slotTime: string; driver: string; lorry: string };
type EtaLookup = { byInvoice: Record<string, EtaInfo>; byName: Record<string, EtaInfo> };
function buildEtaLookup(runs: TimelineRun[]): EtaLookup {
  const byInvoice: Record<string, EtaInfo> = {};
  const byName: Record<string, EtaInfo> = {};
  // Runs come oldest first, so a later run overwrites an earlier one.
  runs.forEach((run) =>
    run.customers.forEach((c) => {
      const info: EtaInfo = {
        date: c.etaDate,
        time: c.etaTime,
        installDate: c.installDate ?? "",
        installTime: c.installTime ?? "",
        slotDate: run.deliveryDate,
        slotTime: run.departureTime,
        // The run's driver and lorry plate on the Delivery Schedule.
        driver: run.deliveryPic,
        lorry: run.plateNumber ?? "",
      };
      const key = c.invoice.replace(/\D/g, "");
      if (key) byInvoice[key] = info;
      const name = customerNameKey(c.name);
      if (name) byName[name] = info;
    }),
  );
  return { byInvoice, byName };
}
function lookupEta(lookup: EtaLookup, tx: StockTransaction): EtaInfo | undefined {
  if (tx.type !== "out") return undefined;
  const info: EtaInfo | undefined =
    lookup.byInvoice[(tx.extra?.linkedJob ?? tx.reference).replace(/\D/g, "")] ??
    lookup.byName[customerNameKey(tx.schedule?.customerName ?? tx.party)];
  // TEST ONLY: a TEST_LOADING_PREPARING job's slot is moved to its test day.
  const testDay = TEST_LOADING_PREPARING[tx.reference];
  if (testDay) {
    return info
      ? { ...info, slotDate: testDay }
      : { date: "", time: "", installDate: "", installTime: "", slotDate: testDay, slotTime: "", driver: "", lorry: "" };
  }
  return info;
}
// "14:30" -> "2.30pm", "09:00" -> "9am" (the ETA column's style).
function etaClock(time: string): string {
  const m = time.match(/^(\d{1,2}):(\d{2})/);
  if (!m) return time;
  const h = Number(m[1]);
  return `${h % 12 === 0 ? 12 : h % 12}${m[2] === "00" ? "" : `.${m[2]}`}${h >= 12 ? "pm" : "am"}`;
}

function isoDateLabel(text: string): string {
  const match = text.trim().match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!match) return text;
  return `${Number(match[3])} ${WEEK_MONTHS[Number(match[2]) - 1]} ${match[1]}`;
}

function getDayLabel(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  const weekday = new Date(Date.UTC(y, m - 1, d)).toLocaleDateString("en-GB", { weekday: "short", timeZone: "UTC" });
  return `${weekday}, ${d} ${WEEK_MONTHS[m - 1]} ${y}`;
}

function getWeekRangeLabel(mondayIso: string): string {
  const sundayIso = shiftIso(mondayIso, 6);
  const [, mm, md] = mondayIso.split("-").map(Number);
  const [sy, sm, sd] = sundayIso.split("-").map(Number);
  const mMonth = WEEK_MONTHS[mm - 1];
  const sMonth = WEEK_MONTHS[sm - 1];
  if (mMonth === sMonth) return `${md} – ${sd} ${sMonth} ${sy}`;
  return `${md} ${mMonth} – ${sd} ${sMonth} ${sy}`;
}

// ---------------------------------------------------------------------------
// Stock In Verification Page — Barcode & SKU Matching Flow
// ---------------------------------------------------------------------------

function StockInVerificationPage({
  tx,
  onBack,
  onUpdateStatus,
}: {
  tx: StockTransaction;
  onBack: () => void;
  onUpdateStatus: (newStatus: StockTransactionStatus, remark?: string) => void;
}) {
  const invoice = tx.invoice;
  const items = invoice?.items ?? [];

  // 1. Pre-loaded Supplier Serial Registry (from Supplier DO Packing List / Flash Test Data)
  const supplierSerialList = useMemo(() => generateSupplierSerialList(tx), [tx]);

  // 2. Set of verified unique serial numbers
  const [verifiedSerials, setVerifiedSerials] = useState<Set<string>>(() => {
    const initial = new Set<string>();
    if (tx.status === "Verified") {
      supplierSerialList.forEach((u) => initial.add(u.serialNo));
    }
    return initial;
  });

  // 3. Derived count per SKU directly from verified serials
  const scannedCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    items.forEach((it) => {
      counts[it.skuId] = 0;
    });
    supplierSerialList.forEach((unit) => {
      if (verifiedSerials.has(unit.serialNo)) {
        counts[unit.skuId] = (counts[unit.skuId] || 0) + 1;
      }
    });
    return counts;
  }, [items, supplierSerialList, verifiedSerials]);

  // 4. Grouped serial strings per SKU for tag display
  const scannedSerials = useMemo(() => {
    const res: Record<string, string[]> = {};
    items.forEach((it) => {
      res[it.skuId] = [];
    });
    supplierSerialList.forEach((unit) => {
      if (verifiedSerials.has(unit.serialNo)) {
        if (!res[unit.skuId]) res[unit.skuId] = [];
        res[unit.skuId].push(unit.serialNo);
      }
    });
    return res;
  }, [items, supplierSerialList, verifiedSerials]);

  const [barcodeInput, setBarcodeInput] = useState("");
  const [cameraActive, setCameraActive] = useState(false);
  const [cameraError, setCameraError] = useState<string | null>(null);
  const videoRef = useRef<HTMLVideoElement>(null);

  const [feedback, setFeedback] = useState<{
    type: "success" | "warning" | "error";
    message: string;
  } | null>(null);

  const [showInvoiceModal, setShowInvoiceModal] = useState(false);
  const [showSerialListModal, setShowSerialListModal] = useState(false);
  const [serialSearch, setSerialSearch] = useState("");
  const [serialFilter, setSerialFilter] = useState<"all" | "verified" | "pending">("all");
  const [selectedExcelCell, setSelectedExcelCell] = useState<{ coord: string; val: string }>({
    coord: "A1",
    val: "JINKO SOLAR CO., LTD. · MODULE FLASH TEST DATA & PACKING LIST REPORT",
  });
  const [activeExcelSheet, setActiveExcelSheet] = useState<"sheet1" | "sheet2">("sheet1");

  const filteredExcelUnits = useMemo(() => {
    return supplierSerialList.filter((u) => {
      const isVer = verifiedSerials.has(u.serialNo);
      const matchesFilter =
        serialFilter === "all" ||
        (serialFilter === "verified" && isVer) ||
        (serialFilter === "pending" && !isVer);
      const matchesSearch =
        !serialSearch.trim() ||
        u.serialNo.toLowerCase().includes(serialSearch.toLowerCase()) ||
        u.palletBarcode.toLowerCase().includes(serialSearch.toLowerCase()) ||
        u.model.toLowerCase().includes(serialSearch.toLowerCase()) ||
        `pallet ${u.palletNo}`.includes(serialSearch.toLowerCase());
      return matchesFilter && matchesSearch;
    });
  }, [supplierSerialList, verifiedSerials, serialFilter, serialSearch]);

  // Table filter states for Unit Serial Code table
  const [tableSearch, setTableSearch] = useState("");
  const [tableFilter, setTableFilter] = useState<"all" | "verified" | "pending">("all");
  const [tablePalletFilter, setTablePalletFilter] = useState<number | "all">("all");

  const displayedUnits = useMemo(() => {
    return supplierSerialList.filter((u) => {
      const isVer = verifiedSerials.has(u.serialNo);
      const matchesFilter =
        tableFilter === "all" ||
        (tableFilter === "verified" && isVer) ||
        (tableFilter === "pending" && !isVer);
      const matchesPallet =
        tablePalletFilter === "all" || u.palletNo === tablePalletFilter;
      const matchesSearch =
        !tableSearch.trim() ||
        u.serialNo.toLowerCase().includes(tableSearch.toLowerCase()) ||
        u.palletBarcode.toLowerCase().includes(tableSearch.toLowerCase()) ||
        u.model.toLowerCase().includes(tableSearch.toLowerCase()) ||
        String(u.palletNo).includes(tableSearch);
      return matchesFilter && matchesPallet && matchesSearch;
    });
  }, [supplierSerialList, verifiedSerials, tableFilter, tablePalletFilter, tableSearch]);


  // Physical Receiving Verification Issue Reporting state (Specific Invoice · Sample 1 or 2 Units Missing)
  const [sampleMissingCount, setSampleMissingCount] = useState<1 | 2>(1);
  const [issueReason, setIssueReason] = useState("Missing item / Short shipment (Supplier under-delivered by 1 unit)");
  const [issueCustomNotes, setIssueCustomNotes] = useState("");

  // Determine specific sample 1 or 2 missing units from the specific invoice
  const sampleMissingUnits = useMemo(() => {
    const unscanned = supplierSerialList.filter((u) => !verifiedSerials.has(u.serialNo));
    const pool = unscanned.length > 0 ? unscanned : supplierSerialList;
    if (pool.length > 0) {
      return pool.slice(0, sampleMissingCount);
    }
    const item = items[0];
    return Array.from({ length: sampleMissingCount }).map((_, idx) => ({
      serialNo: `${item?.barcode || tx.serialCode || "SN-2026"}-${String(idx + 1).padStart(3, "0")}`,
      palletNo: 1,
      palletBarcode: item?.palletBarcode || "PAL-001",
      skuId: item?.skuId || "SKU-001",
      model: item?.model || tx.model,
      flashPowerWatts: 620,
      vmp: 42.1,
      imp: 14.8,
    }));
  }, [supplierSerialList, verifiedSerials, sampleMissingCount, items, tx]);

  const barcodeInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    // Ready for the laser gun on a computer. Not on phones / tablets: focusing the box there
    // pops up the keyboard and makes iPhones zoom in on the page.
    if (window.matchMedia("(pointer: fine)").matches) barcodeInputRef.current?.focus();
  }, []);

  // Camera video stream & live BarcodeDetector hook
  useEffect(() => {
    let stream: MediaStream | null = null;
    let detectorTimer: NodeJS.Timeout | null = null;
    // Set when the camera is closed (or the page re-renders) before the camera has started,
    // so a stream that arrives late is stopped instead of keeping the camera busy.
    let cancelled = false;

    if (cameraActive) {
      if (typeof navigator !== "undefined" && typeof navigator.mediaDevices?.getUserMedia === "function") {
        openCameraStream()
          .then((s) => {
            if (cancelled) {
              s.getTracks().forEach((t) => t.stop());
              return;
            }
            stream = s;
            if (videoRef.current) {
              videoRef.current.srcObject = s;
              videoRef.current.play().catch(() => {});
            }
            setCameraError(null);

            if (typeof window !== "undefined" && "BarcodeDetector" in window) {
              try {
                // @ts-expect-error - standard browser BarcodeDetector API
                const detector = new window.BarcodeDetector({ formats: ["code_128", "qr_code", "ean_13", "data_matrix"] });
                detectorTimer = setInterval(async () => {
                  if (videoRef.current && videoRef.current.readyState >= 2) {
                    try {
                      const barcodes = await detector.detect(videoRef.current);
                      if (barcodes && barcodes.length > 0 && barcodes[0].rawValue) {
                        handleScan(barcodes[0].rawValue);
                      }
                    } catch {}
                  }
                }, 400);
              } catch {}
            }
          })
          .catch((err) => {
            if (!cancelled) setCameraError(cameraErrorMessage(err));
          });
      } else {
        setCameraError(cameraErrorMessage(null));
      }
    } else {
      if (videoRef.current && videoRef.current.srcObject) {
        const tracks = (videoRef.current.srcObject as MediaStream).getTracks();
        tracks.forEach((t) => t.stop());
        videoRef.current.srcObject = null;
      }
    }

    return () => {
      cancelled = true;
      if (detectorTimer) clearInterval(detectorTimer);
      if (stream) {
        stream.getTracks().forEach((t) => t.stop());
      }
    };
  }, [cameraActive]);

  const totalExpected = supplierSerialList.length > 0 ? supplierSerialList.length : items.reduce((sum, it) => sum + it.invoicedQty, 0);
  const totalScanned = verifiedSerials.size;
  const progressPercent = totalExpected > 0 ? Math.min(100, Math.round((totalScanned / totalExpected) * 100)) : 0;
  const isAllVerified = totalExpected > 0 && totalScanned >= totalExpected;

  // Real-time Barcode & Serial Matching Engine
  function handleScan(codeToTest?: string) {
    const code = (codeToTest ?? barcodeInput).trim();
    if (!code) return;

    // 1. Direct match with a Unit Serial Number in Supplier Serial List
    const matchedSerialUnit = supplierSerialList.find(
      (u) => u.serialNo.toLowerCase() === code.toLowerCase()
    );

    if (matchedSerialUnit) {
      if (verifiedSerials.has(matchedSerialUnit.serialNo)) {
        setFeedback({
          type: "warning",
          message: `⚠️ Duplicate Scan: Serial #${matchedSerialUnit.serialNo} was already verified earlier!`,
        });
        setBarcodeInput("");
        return;
      }

      setVerifiedSerials((prev) => {
        const next = new Set(prev);
        next.add(matchedSerialUnit.serialNo);
        return next;
      });

      const newTotal = verifiedSerials.size + 1;
      const powerStr = matchedSerialUnit.flashPowerWatts ? ` · Tested ${matchedSerialUnit.flashPowerWatts}W` : "";
      setFeedback({
        type: "success",
        message: `✅ Serial Matched: #${matchedSerialUnit.serialNo} (Pallet #${String(matchedSerialUnit.palletNo).padStart(2, "0")}${powerStr}) verified! Total: ${newTotal}/${totalExpected}`,
      });
      setBarcodeInput("");
      return;
    }

    // 2. Direct match with a Pallet Barcode (Bulk Pallet Scan)
    const palletUnits = supplierSerialList.filter(
      (u) => u.palletBarcode.toLowerCase() === code.toLowerCase()
    );

    if (palletUnits.length > 0) {
      let newlyVerified = 0;
      setVerifiedSerials((prev) => {
        const next = new Set(prev);
        palletUnits.forEach((u) => {
          if (!next.has(u.serialNo)) {
            next.add(u.serialNo);
            newlyVerified++;
          }
        });
        return next;
      });

      if (newlyVerified === 0) {
        setFeedback({
          type: "warning",
          message: `⚠️ Pallet ${palletUnits[0].palletBarcode} is already 100% verified (${palletUnits.length}/${palletUnits.length} units)!`,
        });
      } else {
        const newTotal = verifiedSerials.size + newlyVerified;
        setFeedback({
          type: "success",
          message: `📦 Pallet Matched: ${palletUnits[0].palletBarcode} verified! (+${newlyVerified} panels registered). Total: ${newTotal}/${totalExpected}`,
        });
      }
      setBarcodeInput("");
      return;
    }

    // 3. Fallback: match by SKU ID (picks the next unverified serial of this SKU)
    const matchedItem = items.find((it) => it.skuId.toLowerCase() === code.toLowerCase());
    if (matchedItem) {
      const nextUnverified = supplierSerialList.find(
        (u) => u.skuId.toLowerCase() === matchedItem.skuId.toLowerCase() && !verifiedSerials.has(u.serialNo)
      );
      if (!nextUnverified) {
        setFeedback({
          type: "warning",
          message: `⚠️ SKU ${matchedItem.skuId} is already fully received (${matchedItem.invoicedQty}/${matchedItem.invoicedQty} ${matchedItem.unit}).`,
        });
        setBarcodeInput("");
        return;
      }

      setVerifiedSerials((prev) => {
        const next = new Set(prev);
        next.add(nextUnverified.serialNo);
        return next;
      });

      const newTotal = verifiedSerials.size + 1;
      setFeedback({
        type: "success",
        message: `✅ Matched SKU ${matchedItem.skuId}! Registered serial #${nextUnverified.serialNo}. (${newTotal}/${totalExpected})`,
      });
      setBarcodeInput("");
      return;
    }

    // 4. Not in supplier list
    setFeedback({
      type: "error",
      message: `❌ Unrecognized Barcode: "${code}" is NOT in the Supplier Serial List for PO #${invoice?.poNumber ?? tx.reference}!`,
    });
    setBarcodeInput("");
  }

  // Pallet-level verification
  function handleVerifyPallet(palletNo: number) {
    const unitsInPallet = supplierSerialList.filter((u) => u.palletNo === palletNo);
    let added = 0;
    setVerifiedSerials((prev) => {
      const next = new Set(prev);
      unitsInPallet.forEach((u) => {
        if (!next.has(u.serialNo)) {
          next.add(u.serialNo);
          added++;
        }
      });
      return next;
    });

    setFeedback({
      type: "success",
      message: `📦 Pallet #${String(palletNo).padStart(2, "0")} verified! +${added} units marked received. Total: ${verifiedSerials.size + added}/${totalExpected}.`,
    });
  }

  // CSV Serial List Export
  function handleExportSerialCsv() {
    const headers = "Item,SKU ID,Model,Pallet No,Pallet Barcode,Serial Number,Flash Power (Watts),Vmp (V),Imp (A),Status\n";
    const rows = supplierSerialList
      .map((u, idx) => {
        const isVer = verifiedSerials.has(u.serialNo);
        return `${idx + 1},${u.skuId},"${u.model}",Pallet ${u.palletNo},${u.palletBarcode},${u.serialNo},${u.flashPowerWatts ?? "N/A"},${u.vmp ?? "N/A"},${u.imp ?? "N/A"},${isVer ? "VERIFIED" : "PENDING"}`;
      })
      .join("\n");
    const blob = new Blob([headers + rows], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `Supplier_Serial_List_${invoice?.invoiceNo ?? tx.reference}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }


  return (
    <section className={styles.screen} aria-labelledby="stockin-verify-title">
      {/* Top Navigation */}
      <div className={styles.inspectTopBar}>
        <button className={styles.back} type="button" onClick={onBack} style={{ marginBottom: 0 }}>
          Back
        </button>
        <span
          className={
            tx.status === "To Verify"
              ? styles.btnToVerify
              : tx.status === "Inspected"
              ? styles.btnInspected
              : styles.btnVerified
          }
        >
          Status: {tx.status}
        </span>
      </div>

      {/* Invoice Overview Hero Card */}
      <div className={styles.inspectHeroCard}>
        <div>
          <div style={{ display: "flex", gap: "8px", alignItems: "center", marginBottom: "6px", flexWrap: "wrap" }}>
            <span className={`${styles.txBadge} ${styles.txIn}`}>🟢 STOCK IN</span>
            <span className={catClass(tx.category)}>{CAT_LABEL[tx.category] ?? tx.category}</span>
            <span className={`${styles.tag} ${styles.check}`}>{tx.warehouse} Warehouse</span>
            {/* 1. When will receive */}
            <div className={styles.deliveryEtaBadge}>
              <span>📅</span>
              <span><strong>When Will Receive:</strong> {invoice?.expectedDelivery ?? tx.time}</span>
            </div>
          </div>

          <h1 id="stockin-verify-title" className={styles.inspectHeroTitle}>
            Stock In Verification &middot; Invoice #{invoice?.invoiceNo}
          </h1>
          <p className={styles.inspectHeroSub}>
            Supplier: <strong>{invoice?.supplierName}</strong> &middot; Invoice Date: {invoice?.invoiceDate}
          </p>
          <div style={{ marginTop: "10px", display: "flex", gap: "8px", alignItems: "center", flexWrap: "wrap" }}>
            <button
              type="button"
              className={styles.btnViewInvoice}
              onClick={() => setShowInvoiceModal(true)}
            >
              📄 View Invoice
            </button>
            <button
              type="button"
              className={styles.btnViewSerialList}
              onClick={() => setShowSerialListModal(true)}
            >
              📊 View Supplier Serial List ({totalExpected} Units &middot; Original Excel Sample)
            </button>
            <span style={{ fontSize: "12px", color: "var(--muted)" }}>
              DO Ref: <strong>{tx.reference}</strong> &middot; PO: <strong>{invoice?.poNumber}</strong>
            </span>
          </div>
        </div>

        <div style={{ textAlign: "right" }}>
          <span className={styles.inspectDataLabel}>Total Invoiced</span>
          <div className={`${styles.inspectQtyBig} ${styles.txQtyIn}`}>
            +{totalExpected} {items[0]?.unit ?? "units"}
          </div>
          <small style={{ color: "var(--muted)", fontSize: "11px" }}>
            Pallets: {invoice?.palletCount ?? 1} Pallet(s)
          </small>
        </div>
      </div>

      {/* Barcode Scanner Section */}
      <div className={styles.scannerCard}>
        <div className={styles.scannerHeader}>
          <div>
            <h2 className={styles.scannerTitle}>
              <span>🔍</span> Barcode &amp; SKU Scanner
            </h2>
            <p className={styles.scannerHelpText}>
              Scan barcode using handheld laser gun or mobile camera.
            </p>
          </div>
        </div>

        {/* Camera Viewfinder */}
        {cameraActive && (
          <div className={styles.cameraViewfinder}>
                <button
                  type="button"
                  className={styles.cameraCloseBtn}
                  onClick={() => setCameraActive(false)}
                  aria-label="Close camera"
                  title="Close camera"
                >
                  ✕
                </button>
            <div className={styles.cameraScanLine} />
            <video ref={videoRef} className={styles.videoCameraActive} playsInline autoPlay muted />
            {cameraError && (
              <div style={{ padding: "12px 14px", background: "rgba(0,0,0,0.65)", borderRadius: "6px", margin: "8px" }}>
                <div style={{ fontSize: "22px", marginBottom: "2px" }}>📸</div>
                <strong style={{ color: "#f87171", fontSize: "12px" }}>Camera Notice:</strong>
                <div style={{ fontSize: "11px", color: "#e2e8f0", marginTop: "2px" }}>
                  {cameraError}
                </div>
              </div>
            )}
            <div style={{ padding: "8px 12px", background: "rgba(0,0,0,0.55)", borderRadius: "6px", marginTop: "6px", display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: "6px" }}>
              <span style={{ fontSize: "11px", color: "#e2e8f0" }}>
                🎯 Camera auto-detects barcode &amp; matches against Supplier Serial List.
              </span>
              <button
                type="button"
                className={styles.palletVerifyBtn}
                style={{ fontSize: "11px", padding: "3px 8px" }}
                onClick={() => {
                  const nextToVerify = supplierSerialList.find((u) => !verifiedSerials.has(u.serialNo));
                  if (nextToVerify) {
                    handleScan(nextToVerify.serialNo);
                  }
                }}
              >
                ⚡ Test Camera Detect S/N
              </button>
            </div>
          </div>
        )}

        {/* Barcode Input Form */}
        <form
          className={styles.scannerInputRow}
          onSubmit={(e) => {
            e.preventDefault();
            handleScan();
          }}
        >
          <input
            ref={barcodeInputRef}
            type="text"
            className={styles.scannerInput}
            placeholder="Scan barcode or type SKU / Serial number..."
            value={barcodeInput}
            onChange={(e) => setBarcodeInput(e.target.value)}
          />
          <button
            type="button"
            className={styles.scannerBtnScan}
            title="Records the typed serial; with an empty box it opens the camera scanner"
            onClick={() => {
              if (barcodeInput.trim()) handleScan();
              else setCameraActive(true);
            }}
          >
            <span>⚡</span> Scan / Match
          </button>
        </form>


        {/* Real-time Scan Feedback */}
        {feedback && (
          <div
            className={`${styles.scanFeedback} ${
              feedback.type === "success"
                ? styles.scanFeedbackSuccess
                : feedback.type === "warning"
                ? styles.scanFeedbackWarning
                : styles.scanFeedbackError
            }`}
          >
            <span>{feedback.message}</span>
            <button
              type="button"
              style={{ border: 0, background: "transparent", cursor: "pointer", color: "inherit", fontWeight: 700 }}
              onClick={() => setFeedback(null)}
            >
              &times;
            </button>
          </div>
        )}
      </div>

      {/* 1. Product Details & Pallet Specifications (Out of Table) */}
      <div className={styles.productSummaryCard}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: "16px", flexWrap: "wrap" }}>
          <div>
            <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "6px" }}>
              <span style={{ fontSize: "11px", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.05em", color: "var(--muted)" }}>
                Product SKU ID
              </span>
              <span className={styles.skuBadge}>JKM-620N-72HL4-BDV</span>
            </div>
            <h3 style={{ margin: "0 0 6px 0", fontSize: "18px", fontWeight: 700, color: "var(--text)" }}>
              Jinko Tiger Neo 620W N-Type
            </h3>
            <p style={{ margin: 0, fontSize: "13px", color: "var(--muted)" }}>
              Bifacial Dual-Glass PV Modules (10 Pallets &times; 30 pcs per pallet)
            </p>
          </div>

          <div className={styles.palletizedInfoBox}>
            <div style={{ fontSize: "12px", fontWeight: 700, color: "#0284c7" }}>
              📦 Palletized:
            </div>
            <div style={{ fontSize: "16px", fontWeight: 700, color: "var(--text)" }}>
              10 Pallets &times; 30 pcs
            </div>
            <span style={{ fontSize: "11px", color: "var(--muted)" }}>
              JKM-620N-72HL4-BDV &middot; 300 Pcs Total
            </span>
          </div>
        </div>
      </div>

      {/* 2. Item List with SKU ID */}
      <div className={styles.skuTableCard}>
        <div className={styles.skuProgressHeader}>
          <div>
            <h2 className={styles.inspectCardTitle}>
              <span>📋</span> Item List with SKU ID (Order Invoice #{invoice?.invoiceNo})
            </h2>
            <p className={styles.itemDesc}>
              Expected vs physically scanned quantity per unit serial code
            </p>
          </div>
          <div className={styles.skuOverallStats}>
            Total Progress: <strong>{totalScanned}</strong> / {totalExpected} units ({progressPercent}%)
          </div>
        </div>

        {/* Visual Progress Bar */}
        <div className={styles.progressBarContainer}>
          <div
            className={`${styles.progressBarFill} ${
              progressPercent < 100 ? styles.progressBarFillWarning : ""
            }`}
            style={{ width: `${progressPercent}%` }}
          />
        </div>

        {/* Table Search & Filter Controls */}
        <div style={{ display: "flex", gap: "10px", alignItems: "center", justifyContent: "space-between", margin: "14px 0 10px", flexWrap: "wrap" }}>
          <div style={{ display: "flex", gap: "8px", alignItems: "center", flex: "1 1 260px" }}>
            <input
              type="text"
              className={styles.searchCompact}
              placeholder="Search serial code, pallet..."
              value={tableSearch}
              onChange={(e) => setTableSearch(e.target.value)}
              style={{ width: "100%", maxWidth: "280px" }}
            />
            {tableSearch && (
              <button
                type="button"
                onClick={() => setTableSearch("")}
                style={{ border: 0, background: "none", cursor: "pointer", fontSize: "14px", color: "var(--muted)" }}
              >
                &times;
              </button>
            )}
          </div>

          <div style={{ display: "flex", gap: "6px", alignItems: "center", flexWrap: "wrap" }}>
            {/* Filter by Pallet */}
            <select
              value={tablePalletFilter}
              onChange={(e) => setTablePalletFilter(e.target.value === "all" ? "all" : Number(e.target.value))}
              style={{
                padding: "6px 10px",
                border: "1px solid var(--line)",
                borderRadius: "6px",
                fontSize: "12px",
                background: "var(--surface)",
                color: "var(--text)",
              }}
            >
              <option value="all">All Pallets (10 Pallets)</option>
              {Array.from({ length: 10 }, (_, i) => i + 1).map((p) => (
                <option key={p} value={p}>
                  Pallet {p}
                </option>
              ))}
            </select>

            {/* Filter status buttons */}
            <button
              type="button"
              className={`${styles.filterPill} ${tableFilter === "all" ? styles.filterPillActive : ""}`}
              onClick={() => setTableFilter("all")}
            >
              All ({supplierSerialList.length})
            </button>
            <button
              type="button"
              className={`${styles.filterPill} ${tableFilter === "verified" ? styles.filterPillActive : ""}`}
              onClick={() => setTableFilter("verified")}
            >
              Verified ({verifiedSerials.size})
            </button>
            <button
              type="button"
              className={`${styles.filterPill} ${tableFilter === "pending" ? styles.filterPillActive : ""}`}
              onClick={() => setTableFilter("pending")}
            >
              Pending ({supplierSerialList.length - verifiedSerials.size})
            </button>
          </div>
        </div>

        {/* Scrollable Unit Serial Code Table */}
        <div className={styles.unitScrollTableWrap}>
          <table>
            <thead>
              <tr>
                <th scope="col" style={{ width: "50px" }}>No.</th>
                <th scope="col" style={{ minWidth: "220px" }}>Serial Code</th>
                <th scope="col">Description / Model</th>
                <th scope="col" style={{ width: "180px" }}>Match Status</th>
                <th scope="col" style={{ width: "120px", textAlign: "right" }}>Action</th>
              </tr>
            </thead>
            <tbody>
              {displayedUnits.length === 0 ? (
                <tr>
                  <td colSpan={5} style={{ textAlign: "center", padding: "28px", color: "var(--muted)" }}>
                    No unit serial codes found matching your search / filter.
                  </td>
                </tr>
              ) : (
                displayedUnits.map((u) => {
                  const isVerified = verifiedSerials.has(u.serialNo);
                  const originalIndex = supplierSerialList.findIndex((item) => item.serialNo === u.serialNo) + 1;

                  return (
                    <tr
                      key={u.serialNo}
                      className={isVerified ? styles.unitRowVerified : undefined}
                    >
                      <td style={{ color: "var(--muted)", fontSize: "11px", fontWeight: 600 }}>
                        #{String(originalIndex).padStart(3, "0")}
                      </td>
                      <td>
                        <div style={{ fontFamily: "monospace", fontWeight: 700, fontSize: "13px", letterSpacing: "0.03em" }}>
                          {u.serialNo}
                        </div>
                        <div style={{ display: "flex", gap: "6px", alignItems: "center", marginTop: "3px" }}>
                          <span style={{ fontSize: "10px", background: "rgba(2, 132, 199, 0.1)", color: "#0284c7", padding: "1px 6px", borderRadius: "4px", fontWeight: 600 }}>
                            Pallet {String(u.palletNo).padStart(2, "0")} &middot; {u.palletBarcode}
                          </span>
                        </div>
                      </td>
                      <td>
                        <strong style={{ fontSize: "13px" }}>{u.model}</strong>
                        <div style={{ fontSize: "11px", color: "var(--muted)", marginTop: "2px" }}>
                          SKU: <strong style={{ color: "var(--text)" }}>{u.skuId}</strong>
                          {u.flashPowerWatts && (
                            <> &middot; Factory Flash: <strong>{u.flashPowerWatts}W</strong> ({u.vmp}V / {u.imp}A)</>
                          )}
                        </div>
                      </td>
                      <td>
                        {isVerified ? (
                          <span className={`${styles.matchPill} ${styles.matchPillComplete}`}>
                            ✅ Verified (Matched)
                          </span>
                        ) : (
                          <span className={`${styles.matchPill} ${styles.matchPillPending}`}>
                            ⏳ Pending Scan
                          </span>
                        )}
                      </td>
                      <td style={{ textAlign: "right" }}>
                        {isVerified ? (
                          <button
                            type="button"
                            title="Undo this unit verification"
                            onClick={() => {
                              setVerifiedSerials((prev) => {
                                const next = new Set(prev);
                                next.delete(u.serialNo);
                                return next;
                              });
                            }}
                            style={{
                              border: "1px solid var(--line)",
                              background: "var(--surface)",
                              color: "var(--muted)",
                              borderRadius: "4px",
                              padding: "3px 8px",
                              fontSize: "11px",
                              cursor: "pointer",
                            }}
                          >
                            Undo
                          </button>
                        ) : (
                          <button
                            type="button"
                            className={styles.palletVerifyBtn}
                            style={{ fontSize: "11px", padding: "3px 9px" }}
                            onClick={() => handleScan(u.serialNo)}
                            title="Simulate scanning this barcode"
                          >
                            ⚡ Scan / Match
                          </button>
                        )}
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>

        {/* Footer summary bar */}
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: "10px", fontSize: "12px", color: "var(--muted)", flexWrap: "wrap", gap: "8px" }}>
          <span>
            Showing <strong>{displayedUnits.length}</strong> of <strong>{supplierSerialList.length}</strong> unit serial codes
          </span>
          <div style={{ display: "flex", gap: "12px", alignItems: "center" }}>
            <span>
              Verified: <strong style={{ color: "var(--green)" }}>{verifiedSerials.size}</strong>
            </span>
            <span>
              Pending: <strong style={{ color: "var(--amber)" }}>{supplierSerialList.length - verifiedSerials.size}</strong>
            </span>
            <button
              type="button"
              className={styles.palletVerifyBtn}
              style={{ fontSize: "11px", padding: "4px 10px" }}
              onClick={handleExportSerialCsv}
            >
              📥 Export CSV
            </button>
          </div>
        </div>
      </div>



      {/* Physical Receiving Verification for Unscanned Items (Specific Invoice · Sample 1 or 2 units missing) */}
      {totalScanned < totalExpected && (
        <div className={styles.issueReportingCard}>
          <div className={styles.issueHeaderRow}>
            <h3 className={styles.issueTitle}>
              <span>⚠️</span> Physical Receiving Verification &middot; Unscanned Item Issue Report
            </h3>
            <span className={styles.issueItemBadge}>
              Sample Discrepancy: {sampleMissingCount} Unit{sampleMissingCount > 1 ? "s" : ""} Missing
            </span>
          </div>

          <p style={{ margin: 0, fontSize: "12px", color: "var(--muted)" }}>
            Physical inspection against specific invoice receiving record. Report discrepancy for <strong>sample 1 or 2 missing unit(s)</strong> and update transaction status to <strong>Inspected</strong>.
          </p>

          {/* Specific Invoice Information Strip */}
          <div className={styles.issueInvoiceStrip}>
            <div className={styles.issueInvoiceField}>
              <span className={styles.issueInvoiceLabel}>Specific Invoice</span>
              <strong className={styles.issueInvoiceValue}>{invoice?.invoiceNo || tx.reference}</strong>
            </div>
            <div className={styles.issueInvoiceField}>
              <span className={styles.issueInvoiceLabel}>PO Number</span>
              <strong className={styles.issueInvoiceValue}>{invoice?.poNumber || "PO-MY-4412"}</strong>
            </div>
            <div className={styles.issueInvoiceField}>
              <span className={styles.issueInvoiceLabel}>Supplier</span>
              <strong className={styles.issueInvoiceValue}>{invoice?.supplierName || tx.party}</strong>
            </div>
            <div className={styles.issueInvoiceField}>
              <span className={styles.issueInvoiceLabel}>Item &amp; Model</span>
              <strong className={styles.issueInvoiceValue}>{items[0]?.model || tx.model}</strong>
              <span style={{ fontSize: "11px", color: "var(--muted)" }}>SKU: {items[0]?.skuId || tx.serialCode}</span>
            </div>
            <div className={styles.issueInvoiceField}>
              <span className={styles.issueInvoiceLabel}>Total Invoiced</span>
              <strong className={styles.issueInvoiceValue}>{totalExpected} units ({invoice?.palletCount ?? 1} Pallets)</strong>
            </div>
          </div>

          {/* Sample Missing Units Selection (1 or 2 units) */}
          <div>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "6px", flexWrap: "wrap", gap: "6px" }}>
              <label style={{ fontSize: "12px", fontWeight: 600 }}>
                Missing Units Sample Discrepancy:
              </label>
              <div className={styles.issueCountToggle}>
                <button
                  type="button"
                  className={`${styles.issueCountBtn} ${sampleMissingCount === 1 ? styles.issueCountBtnActive : ""}`}
                  onClick={() => setSampleMissingCount(1)}
                >
                  1 Unit Missing (Sample)
                </button>
                <button
                  type="button"
                  className={`${styles.issueCountBtn} ${sampleMissingCount === 2 ? styles.issueCountBtnActive : ""}`}
                  onClick={() => setSampleMissingCount(2)}
                >
                  2 Units Missing (Sample)
                </button>
              </div>
            </div>

            {/* List of the 1 or 2 specific missing serial numbers from this invoice */}
            <div className={styles.issueMissingUnitsBox}>
              <div style={{ fontSize: "12px", fontWeight: 700, color: "var(--red)", display: "flex", alignItems: "center", gap: "6px" }}>
                <span>📦</span> Specific Missing Unit Serial Code{sampleMissingCount > 1 ? "s" : ""} on Invoice:
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
                {sampleMissingUnits.map((u, idx) => (
                  <div key={u.serialNo} className={styles.issueMissingUnitRow}>
                    <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                      <span className={styles.issueUnitBadge}>Unit #{idx + 1}</span>
                      <code style={{ fontWeight: 700, color: "var(--ink)", fontSize: "13px" }}>{u.serialNo}</code>
                    </div>
                    <div style={{ display: "flex", alignItems: "center", gap: "10px", fontSize: "12px", color: "var(--muted)", flexWrap: "wrap" }}>
                      <span>Pallet #{String(u.palletNo).padStart(2, "0")} ({u.palletBarcode})</span>
                      <span>&middot;</span>
                      <span>{u.model}</span>
                      <span style={{ color: "var(--red)", fontWeight: 700, background: "var(--red-soft)", padding: "2px 7px", borderRadius: "4px" }}>
                        ❌ Physical Shortage / Unscanned
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* Choose Issue Remark */}
          <div>
            <label style={{ display: "block", fontSize: "12px", fontWeight: 600, marginBottom: "6px" }}>
              Choose Discrepancy Issue Remark:
            </label>
            <div className={styles.issueReasonsList}>
              {[
                `Missing item / Short shipment (Supplier under-delivered by ${sampleMissingCount} unit${sampleMissingCount > 1 ? "s" : ""})`,
                `Damaged in transit (Broken glass / cracked cell / packaging crushed on ${sampleMissingCount} unit${sampleMissingCount > 1 ? "s" : ""})`,
                `Barcode sticker damaged / unreadable on ${sampleMissingCount} unit${sampleMissingCount > 1 ? "s" : ""}`,
                `Wrong model / SKU mismatch delivered by supplier (${sampleMissingCount} unit${sampleMissingCount > 1 ? "s" : ""})`,
                "Other discrepancy (Specify in notes below)",
              ].map((reason) => (
                <label
                  key={reason}
                  className={`${styles.issueRadioLabel} ${
                    issueReason === reason || (issueReason.startsWith("Missing item") && reason.startsWith("Missing item")) ? styles.issueRadioLabelActive : ""
                  }`}
                >
                  <input
                    type="radio"
                    name="issueReason"
                    value={reason}
                    checked={issueReason === reason || (issueReason.startsWith("Missing item") && reason.startsWith("Missing item"))}
                    onChange={(e) => setIssueReason(e.target.value)}
                  />
                  <span>{reason}</span>
                </label>
              ))}
            </div>
          </div>

          {/* Additional remarks input */}
          <div>
            <label style={{ display: "block", fontSize: "12px", fontWeight: 600, marginBottom: "4px" }}>
              Additional Remarks / Notes for Supplier &amp; Operations:
            </label>
            <input
              type="text"
              className={styles.issueNotesInput}
              placeholder={`e.g., Driver acknowledged ${sampleMissingCount} unit(s) short on delivery docket; awaiting supplier credit note / replacement.`}
              value={issueCustomNotes}
              onChange={(e) => setIssueCustomNotes(e.target.value)}
            />
          </div>

          {/* Submit Issue Button */}
          <div style={{ display: "flex", justifyContent: "flex-end", marginTop: "4px" }}>
            <button
              type="button"
              className={styles.btnActionDanger}
              onClick={() => {
                const missingSerialsStr = sampleMissingUnits.map((u) => u.serialNo).join(", ");
                const finalRemark = `[Invoice ${invoice?.invoiceNo || tx.reference}] ${sampleMissingCount} unit(s) missing: ${missingSerialsStr} · ${issueReason}${
                  issueCustomNotes.trim() ? ` — ${issueCustomNotes.trim()}` : ""
                }`;
                onUpdateStatus("Inspected", finalRemark);
                onBack();
              }}
            >
              ⚠️ Submit Issue &amp; Mark Status as 'Inspected' ({sampleMissingCount} Unit{sampleMissingCount > 1 ? "s" : ""} Missing)
            </button>
          </div>
        </div>
      )}

      {/* 3. Verified Button & Action Footer */}
      <div className={styles.inspectFooterBar}>
        <p className={`${styles.note} ${styles.footerTip}`}>
          💡 <strong>Warehouse Tip:</strong> Scan physical barcodes or type serials to match against PO #{invoice?.poNumber ?? tx.reference}. When all invoiced items reach 100%, the <strong>Verified</strong> button unlocks to confirm stock entry into warehouse inventory.
        </p>
        <div className={styles.inspectActionGroup}>
          <button
            className={styles.btnActionDanger}
            type="button"
            onClick={() => {
              onUpdateStatus("Inspected");
              onBack();
            }}
            title="Flag issue: missing items, damage, carton torn"
          >
            ⚠️ Flag Issue / Mark Inspected (Missing / Damaged)
          </button>

          {/* Verified button */}
          <button
            className={`${styles.btnActionPrimary} ${
              isAllVerified ? styles.btnVerifiedGlow : styles.btnVerifiedLocked
            }`}
            type="button"
            disabled={!isAllVerified && tx.status !== "Verified"}
            onClick={() => {
              onUpdateStatus("Verified");
              onBack();
            }}
            title="All items received in good condition"
          >
            {isAllVerified
              ? "✓ Verified (All Items in Good Condition)"
              : `🔒 Verified (Scan ${totalExpected - totalScanned} more to unlock)`}
          </button>
        </div>
      </div>

      {/* View Invoice Modal */}
      {showInvoiceModal && invoice && (
        <div className={styles.invoiceBackdrop} onClick={() => setShowInvoiceModal(false)}>
          <div className={styles.invoiceModal} onClick={(e) => e.stopPropagation()}>
            <div className={styles.invoiceTopBar}>
              <h3 className={styles.invoiceTopBarTitle}>
                <span>📄</span> Official Supplier Tax Invoice &middot; #{invoice.invoiceNo}
              </h3>
              <button
                type="button"
                className={styles.invoiceCloseBtn}
                onClick={() => setShowInvoiceModal(false)}
                aria-label="Close invoice"
              >
                &times;
              </button>
            </div>

            <div className={styles.invoicePaper}>
              {/* Supplier Header */}
              <div className={styles.invoiceSupplierRow}>
                <div>
                  <h4 className={styles.invoiceSupplierTitle}>{invoice.supplierName}</h4>
                  <div style={{ color: "#64748b", fontSize: "12px", lineHeight: "1.5" }}>
                    Level 12, Tower B, The Pinnacle, Bandar Sunway, 47500 Subang Jaya, Selangor<br />
                    Tel: +60 3-5623 8888 &middot; SST No: <strong>W10-1808-32000041</strong> &middot; Reg: 201801044211 (1301242-P)
                  </div>
                </div>
                <div style={{ textAlign: "right" }}>
                  <span className={styles.deliveryEtaBadge}>
                    PAID &amp; DELIVERED
                  </span>
                  <div style={{ fontSize: "20px", fontWeight: 800, color: "#0f172a", marginTop: "6px", letterSpacing: "0.03em" }}>
                    TAX INVOICE
                  </div>
                  <div style={{ fontSize: "12px", color: "#64748b" }}>
                    Invoice #: <strong>{invoice.invoiceNo}</strong>
                  </div>
                </div>
              </div>

              {/* Invoice Meta Grid (Two Columns) */}
              <div className={styles.invoiceMetaGrid}>
                {/* Left: INVOICE TO */}
                <div style={{ borderRight: "1px solid #e2e8f0", paddingRight: "14px" }}>
                  <div style={{ fontSize: "11px", fontWeight: 700, color: "#64748b", textTransform: "uppercase", marginBottom: "6px", letterSpacing: "0.04em" }}>
                    Invoice To (Customer / Buyer):
                  </div>
                  <div style={{ fontWeight: 800, color: "#0f172a", fontSize: "14px" }}>Eternalgy Sdn Bhd</div>
                  <div style={{ color: "#475569", fontSize: "12px", lineHeight: "1.5", marginTop: "4px" }}>
                    No. 18, Jalan Industri 4, Taman Perindustrian Subang,<br />
                    47610 Subang Jaya, Selangor, Malaysia.<br />
                    Attn: <strong>Procurement / Warehouse Receiving Dept</strong><br />
                    Receiving Hub: <strong>Eternalgy {tx.warehouse} Warehouse</strong>
                  </div>
                </div>

                {/* Right: INVOICE DETAILS */}
                <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
                  <div style={{ fontSize: "11px", fontWeight: 700, color: "#64748b", textTransform: "uppercase", marginBottom: "2px", letterSpacing: "0.04em" }}>
                    Invoice &amp; Order Details:
                  </div>
                  <div style={{ display: "flex", justifyContent: "space-between", fontSize: "12px" }}>
                    <span style={{ color: "#64748b" }}>Invoice No:</span>
                    <strong style={{ color: "#0f172a" }}>{invoice.invoiceNo}</strong>
                  </div>
                  <div style={{ display: "flex", justifyContent: "space-between", fontSize: "12px" }}>
                    <span style={{ color: "#64748b" }}>Invoice Date:</span>
                    <strong style={{ color: "#0f172a" }}>{invoice.invoiceDate}</strong>
                  </div>
                  <div style={{ display: "flex", justifyContent: "space-between", fontSize: "12px", alignItems: "center" }}>
                    <span style={{ color: "#64748b" }}>Customer PO (Item Code Source):</span>
                    <span style={{ color: "#2563eb", background: "rgba(37,99,235,0.08)", border: "1px solid rgba(37,99,235,0.2)", padding: "1px 8px", borderRadius: "4px", fontWeight: 700, fontSize: "12px" }}>
                      {invoice.poNumber}
                    </span>
                  </div>
                  <div style={{ display: "flex", justifyContent: "space-between", fontSize: "12px" }}>
                    <span style={{ color: "#64748b" }}>Delivery Order (DO) Ref:</span>
                    <strong style={{ color: "#0f172a" }}>{tx.reference}</strong>
                  </div>
                  <div style={{ display: "flex", justifyContent: "space-between", fontSize: "12px" }}>
                    <span style={{ color: "#64748b" }}>Delivery ETA:</span>
                    <strong style={{ color: "#0f172a" }}>{invoice.expectedDelivery}</strong>
                  </div>
                  <div style={{ display: "flex", justifyContent: "space-between", fontSize: "12px" }}>
                    <span style={{ color: "#64748b" }}>Payment Terms:</span>
                    <strong style={{ color: "#0f172a" }}>30 Days Net</strong>
                  </div>
                </div>
              </div>

              {/* Items Table */}
              <div style={{ overflowX: "auto" }}>
                <table className={styles.invoiceTable}>
                  <thead>
                    <tr>
                      <th style={{ width: "42px", textAlign: "center" }}>Item</th>
                      <th>Item Code / SKU (PO Ref)</th>
                      <th>Description &amp; Specifications</th>
                      <th style={{ textAlign: "center" }}>Packaging</th>
                      <th style={{ textAlign: "center" }}>Qty</th>
                      <th style={{ textAlign: "right" }}>Unit Price</th>
                      <th style={{ textAlign: "right" }}>Total (MYR)</th>
                    </tr>
                  </thead>
                  <tbody>
                    {items.map((it, idx) => {
                      const priceNum = parseFloat(it.unitPrice?.replace(/[^0-9.]/g, "") || "395");
                      const lineTotal = (priceNum * it.invoicedQty).toLocaleString("en-MY", {
                        minimumFractionDigits: 2,
                        maximumFractionDigits: 2,
                      });
                      return (
                        <tr key={it.skuId}>
                          <td style={{ textAlign: "center", color: "#64748b", fontWeight: 600 }}>
                            {String(idx + 1).padStart(2, "0")}
                          </td>
                          <td>
                            <strong style={{ fontFamily: "monospace", color: "#0f172a", fontSize: "13px" }}>{it.skuId}</strong>
                            <div style={{ fontSize: "11px", color: "#2563eb", marginTop: "2px" }}>
                              PO Item: {invoice.poNumber}
                            </div>
                          </td>
                          <td>
                            <strong style={{ color: "#0f172a" }}>{it.model}</strong>
                            <div style={{ fontSize: "12px", color: "#64748b", marginTop: "2px" }}>{it.description}</div>
                          </td>
                          <td style={{ textAlign: "center", fontSize: "12px", color: "#475569" }}>
                            {it.palletQty ? (
                              <span>{invoice.palletCount ?? 10} Pallets &times; {it.palletQty} {it.unit}</span>
                            ) : (
                              <span>Direct Carton</span>
                            )}
                          </td>
                          <td style={{ textAlign: "center", fontWeight: 700, fontSize: "13px" }}>
                            {it.invoicedQty} {it.unit}
                          </td>
                          <td style={{ textAlign: "right", color: "#475569" }}>
                            {it.unitPrice ?? "RM 395.00"}
                          </td>
                          <td style={{ textAlign: "right", fontWeight: 700, color: "#0f172a" }}>
                            RM {lineTotal}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>

              {/* Invoice Totals */}
              <div className={styles.invoiceTotals}>
                <div className={styles.invoiceTotalRow}>
                  <span>Subtotal:</span>
                  <span>
                    RM{" "}
                    {items
                      .reduce(
                        (sum, it) =>
                          sum +
                          parseFloat(it.unitPrice?.replace(/[^0-9.]/g, "") || "395") *
                            it.invoicedQty,
                        0
                      )
                      .toLocaleString("en-MY", { minimumFractionDigits: 2 })}
                  </span>
                </div>
                <div className={styles.invoiceTotalRow}>
                  <span>SST (0% Solar &amp; Clean Energy Exemption):</span>
                  <span>RM 0.00</span>
                </div>
                <div className={`${styles.invoiceTotalRow} ${styles.invoiceTotalFinal}`}>
                  <span>Total Payable:</span>
                  <span>
                    RM{" "}
                    {items
                      .reduce(
                        (sum, it) =>
                          sum +
                          parseFloat(it.unitPrice?.replace(/[^0-9.]/g, "") || "395") *
                            it.invoicedQty,
                        0
                      )
                      .toLocaleString("en-MY", { minimumFractionDigits: 2 })}
                  </span>
                </div>
              </div>

              {/* Delivery & Barcode Receiving Remarks */}
              <div style={{
                background: "#f8fafc",
                border: "1px solid #e2e8f0",
                borderLeft: "4px solid #0284c7",
                borderRadius: "6px",
                padding: "12px 14px",
                fontSize: "12px",
                color: "#334155",
                lineHeight: "1.6",
              }}>
                <div style={{ fontWeight: 700, color: "#0369a1", marginBottom: "4px", display: "flex", alignItems: "center", gap: "6px" }}>
                  <span>📦</span> DELIVERY, BARCODE &amp; SERIAL NUMBER POLICY:
                </div>
                <div>&bull; <strong>Container / Seal No:</strong> KMTU-882194 / Seal #8812</div>
                <div>&bull; <strong>Master Pallet Barcodes:</strong> PAL-JKM-001 to PAL-JKM-010 ({invoice.palletCount ?? 10} full shrink-wrapped pallets).</div>
                <div>&bull; <strong>Item Code &amp; PO Origin:</strong> SKU <strong>{items[0]?.skuId ?? "JKM-620N-72HL4-BDV"}</strong> originates from Customer PO <strong>{invoice.poNumber}</strong>.</div>
                <div>&bull; <strong>Physical Barcodes:</strong> Affixed to each panel backsheet/frame. All 300 unit serial numbers are provided on the attached Delivery Order (DO) Packing Sheet for warehouse verification scanning.</div>
              </div>

              {/* Modal Footer Controls */}
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", paddingTop: "12px", borderTop: "1px solid #e2e8f0" }}>
                <button
                  type="button"
                  className={styles.btnViewInvoice}
                  style={{ background: "#f1f5f9", color: "#334155", border: "1px solid #cbd5e1" }}
                  onClick={() => window.print()}
                >
                  🖨️ Print / Save as PDF
                </button>
                <button
                  type="button"
                  className={styles.btnActionPrimary}
                  style={{ padding: "8px 20px", fontSize: "13px" }}
                  onClick={() => setShowInvoiceModal(false)}
                >
                  Close Invoice
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Original Supplier Excel Sample Modal */}
      {showSerialListModal && (
        <div className={styles.invoiceBackdrop} onClick={() => setShowSerialListModal(false)}>
          <div className={styles.excelModal} onClick={(e) => e.stopPropagation()}>
            {/* 1. Microsoft Excel Window Title Bar */}
            <div className={styles.excelWindowBar}>
              <div className={styles.excelWindowTitle}>
                <span className={styles.excelIconX}>X</span>
                <span>
                  <strong>Jinko_Solar_Factory_Flash_Test_Packing_List_{invoice?.invoiceNo ?? tx.reference}.xlsx</strong> - Excel
                </span>
                <span className={styles.excelAutoSavePill}>
                  <span style={{ color: "#4ade80", fontSize: "9px" }}>●</span> AutoSave On &middot; OneDrive
                </span>
              </div>
              <div className={styles.excelWindowControls}>
                <button
                  type="button"
                  className={styles.excelWindowBtn}
                  onClick={handleExportSerialCsv}
                  title="Download Original Excel (.xlsx / .csv)"
                >
                  📥
                </button>
                <button
                  type="button"
                  className={`${styles.excelWindowBtn} ${styles.excelWindowBtnClose}`}
                  onClick={() => setShowSerialListModal(false)}
                  title="Close Excel Viewer"
                  aria-label="Close"
                >
                  &times;
                </button>
              </div>
            </div>

            {/* 2. Excel Ribbon & Quick Actions */}
            <div className={styles.excelRibbon}>
              <div className={styles.excelRibbonTabs}>
                <button type="button" className={styles.excelRibbonTab}>File</button>
                <button type="button" className={`${styles.excelRibbonTab} ${styles.excelRibbonTabActive}`}>Home</button>
                <button type="button" className={styles.excelRibbonTab}>Insert</button>
                <button type="button" className={styles.excelRibbonTab}>Page Layout</button>
                <button type="button" className={styles.excelRibbonTab}>Formulas</button>
                <button type="button" className={styles.excelRibbonTab}>Data</button>
                <button type="button" className={styles.excelRibbonTab}>Review</button>
                <button type="button" className={styles.excelRibbonTab}>View</button>
              </div>
              <div className={styles.excelRibbonActions}>
                {/* Search Box inside Excel */}
                <input
                  type="text"
                  className={styles.serialSearchInput}
                  style={{ width: "220px", padding: "4px 8px", fontSize: "11px", height: "26px" }}
                  placeholder="🔍 Find Serial / Pallet in sheet..."
                  value={serialSearch}
                  onChange={(e) => setSerialSearch(e.target.value)}
                />
                {/* Filter Pills */}
                <div style={{ display: "flex", gap: "4px" }}>
                  <button
                    type="button"
                    className={`${styles.serialFilterPill} ${serialFilter === "all" ? styles.serialFilterPillActive : ""}`}
                    style={{ padding: "3px 8px", fontSize: "11px" }}
                    onClick={() => setSerialFilter("all")}
                  >
                    All ({totalExpected})
                  </button>
                  <button
                    type="button"
                    className={`${styles.serialFilterPill} ${serialFilter === "verified" ? styles.serialFilterPillActive : ""}`}
                    style={{ padding: "3px 8px", fontSize: "11px" }}
                    onClick={() => setSerialFilter("verified")}
                  >
                    Verified ({verifiedSerials.size})
                  </button>
                  <button
                    type="button"
                    className={`${styles.serialFilterPill} ${serialFilter === "pending" ? styles.serialFilterPillActive : ""}`}
                    style={{ padding: "3px 8px", fontSize: "11px" }}
                    onClick={() => setSerialFilter("pending")}
                  >
                    Pending ({totalExpected - verifiedSerials.size})
                  </button>
                </div>
                {/* Download Excel Button */}
                <button
                  type="button"
                  className={styles.excelDownloadBtn}
                  onClick={handleExportSerialCsv}
                >
                  <span>📥</span> Download .XLSX
                </button>
              </div>
            </div>

            {/* 3. Excel Formula Bar */}
            <div className={styles.excelFormulaBar}>
              <div className={styles.excelNameBox}>{selectedExcelCell.coord}</div>
              <span className={styles.excelFxLabel}>fx</span>
              <input
                type="text"
                readOnly
                className={styles.excelFormulaInput}
                value={selectedExcelCell.val}
              />
              <span style={{ fontSize: "11px", color: "#64748b", whiteSpace: "nowrap" }}>
                Live Matched: <strong style={{ color: "#16a34a" }}>{verifiedSerials.size}</strong>/{totalExpected} Units
              </span>
            </div>

            {/* 4. The Authentic Excel Spreadsheet Grid Canvas */}
            <div className={styles.excelSheetContainer}>
              <table className={styles.excelGridTable}>
                <thead>
                  <tr>
                    <th scope="col" className={styles.excelColHeader} style={{ width: "38px" }}>◢</th>
                    <th scope="col" className={styles.excelColHeader} style={{ width: "50px" }}>A</th>
                    <th scope="col" className={styles.excelColHeader} style={{ width: "90px" }}>B</th>
                    <th scope="col" className={styles.excelColHeader} style={{ width: "120px" }}>C</th>
                    <th scope="col" className={styles.excelColHeader} style={{ width: "230px" }}>D</th>
                    <th scope="col" className={styles.excelColHeader} style={{ width: "160px" }}>E</th>
                    <th scope="col" className={styles.excelColHeader} style={{ width: "95px" }}>F</th>
                    <th scope="col" className={styles.excelColHeader} style={{ width: "75px" }}>G</th>
                    <th scope="col" className={styles.excelColHeader} style={{ width: "75px" }}>H</th>
                    <th scope="col" className={styles.excelColHeader} style={{ width: "75px" }}>I</th>
                    <th scope="col" className={styles.excelColHeader} style={{ width: "75px" }}>J</th>
                    <th scope="col" className={styles.excelColHeader} style={{ width: "65px" }}>K</th>
                    <th scope="col" className={styles.excelColHeader} style={{ width: "160px" }}>L</th>
                  </tr>
                </thead>
                <tbody>
                  {activeExcelSheet === "sheet1" ? (
                    <>
                      {/* Rows 1-2: Document Header Banner */}
                      <tr>
                        <td className={styles.excelRowHeader}>1</td>
                        <td
                          colSpan={12}
                          className={styles.excelCell}
                          onClick={() =>
                            setSelectedExcelCell({
                              coord: "A1",
                              val: "JINKO SOLAR CO., LTD. · MODULE FLASH TEST DATA & PACKING LIST REPORT",
                            })
                          }
                          style={{
                            background: "#107c41",
                            color: "#ffffff",
                            fontWeight: 800,
                            fontSize: "14px",
                            padding: "8px 12px",
                            letterSpacing: "0.02em",
                          }}
                        >
                          JINKO SOLAR CO., LTD. &middot; MODULE FLASH TEST DATA &amp; PACKING LIST REPORT
                        </td>
                      </tr>
                      <tr>
                        <td className={styles.excelRowHeader}>2</td>
                        <td
                          colSpan={12}
                          className={styles.excelCell}
                          onClick={() =>
                            setSelectedExcelCell({
                              coord: "A2",
                              val: "Factory: Haining Automated Base · Document ID: JKM-MY-FT-20261014-9921 · IEC 61215 / IEC 61730 (STC: 1000W/m², 25°C, AM1.5)",
                            })
                          }
                          style={{
                            background: "#0d6334",
                            color: "#dcfce7",
                            fontSize: "11px",
                            padding: "4px 12px",
                          }}
                        >
                          Factory: Haining Automated Base &middot; Document ID: JKM-MY-FT-20261014-9921 &middot; Standard Test Condition: STC (1000W/m&sup2;, 25&deg;C, AM1.5)
                        </td>
                      </tr>

                      {/* Rows 3-7: Order & Shipment Specification (Key-Value Cells) */}
                      <tr>
                        <td className={styles.excelRowHeader}>3</td>
                        <td className={styles.excelCell} style={{ background: "#f8fafc", fontWeight: 700, color: "#334155" }}>
                          Consignee:
                        </td>
                        <td colSpan={3} className={styles.excelCell} style={{ fontWeight: 700, color: "#0f172a" }}>
                          Eternal Energy Sdn Bhd
                        </td>
                        <td className={styles.excelCell} style={{ background: "#f8fafc", fontWeight: 700, color: "#334155" }}>
                          Customer PO:
                        </td>
                        <td colSpan={2} className={styles.excelCell} style={{ fontWeight: 700, color: "#0f172a" }}>
                          {invoice?.poNumber ?? "PO-MY-4412"}
                        </td>
                        <td className={styles.excelCell} style={{ background: "#f8fafc", fontWeight: 700, color: "#334155" }}>
                          Invoice No:
                        </td>
                        <td colSpan={4} className={styles.excelCell} style={{ fontWeight: 700, color: "#0f172a" }}>
                          {invoice?.invoiceNo ?? "INV-2026-9921"}
                        </td>
                      </tr>

                      <tr>
                        <td className={styles.excelRowHeader}>4</td>
                        <td className={styles.excelCell} style={{ background: "#f8fafc", fontWeight: 700, color: "#334155" }}>
                          Destination:
                        </td>
                        <td colSpan={3} className={styles.excelCell}>
                          Kuala Lumpur Central Warehouse Hub (Lot 88, Jalan Subang 5)
                        </td>
                        <td className={styles.excelCell} style={{ background: "#f8fafc", fontWeight: 700, color: "#334155" }}>
                          DO Number:
                        </td>
                        <td colSpan={2} className={styles.excelCell} style={{ fontWeight: 700 }}>
                          DO-2026-9921
                        </td>
                        <td className={styles.excelCell} style={{ background: "#f8fafc", fontWeight: 700, color: "#334155" }}>
                          Invoice Date:
                        </td>
                        <td colSpan={4} className={styles.excelCell}>
                          16-Oct-2026
                        </td>
                      </tr>

                      <tr>
                        <td className={styles.excelRowHeader}>5</td>
                        <td className={styles.excelCell} style={{ background: "#f8fafc", fontWeight: 700, color: "#334155" }}>
                          Product Model:
                        </td>
                        <td colSpan={3} className={styles.excelCell} style={{ fontWeight: 700 }}>
                          JKM-620N-72HL4-BDV (Tiger Neo 620W N-Type Bifacial)
                        </td>
                        <td className={styles.excelCell} style={{ background: "#f8fafc", fontWeight: 700, color: "#334155" }}>
                          Inspection Date:
                        </td>
                        <td colSpan={2} className={styles.excelCell}>
                          14-Oct-2026
                        </td>
                        <td className={styles.excelCell} style={{ background: "#f8fafc", fontWeight: 700, color: "#334155" }}>
                          QC Grade:
                        </td>
                        <td colSpan={4} className={styles.excelCell} style={{ color: "#16a34a", fontWeight: 700 }}>
                          ✓ PASSED / GRADE A (Class AAA Sun Simulator)
                        </td>
                      </tr>

                      <tr>
                        <td className={styles.excelRowHeader}>6</td>
                        <td className={styles.excelCell} style={{ background: "#f8fafc", fontWeight: 700, color: "#334155" }}>
                          Packaging:
                        </td>
                        <td colSpan={3} className={styles.excelCell}>
                          10 Pallets &times; 30 PCS/Pallet (Total: 300 PCS)
                        </td>
                        <td className={styles.excelCell} style={{ background: "#f8fafc", fontWeight: 700, color: "#334155" }}>
                          Carrier / Seal:
                        </td>
                        <td colSpan={2} className={styles.excelCell}>
                          MAEU-982140 / Seal #8812
                        </td>
                        <td className={styles.excelCell} style={{ background: "#f8fafc", fontWeight: 700, color: "#334155" }}>
                          Pnom:
                        </td>
                        <td colSpan={4} className={styles.excelCell} style={{ fontWeight: 700 }}>
                          620.0 W (Positive Tolerance: 0 ~ +3%)
                        </td>
                      </tr>

                      {/* Row 7: Blank Spacer */}
                      <tr>
                        <td className={styles.excelRowHeader}>7</td>
                        <td colSpan={12} className={styles.excelCell} style={{ background: "#f8fafc", height: "8px" }} />
                      </tr>

                      {/* Row 8: Table Column Header Row */}
                      <tr>
                        <td className={styles.excelRowHeader}>8</td>
                        <th scope="col" className={styles.excelTableHeader}>Item # &blacktriangledown;</th>
                        <th scope="col" className={styles.excelTableHeader}>Pallet # &blacktriangledown;</th>
                        <th scope="col" className={styles.excelTableHeader}>Pallet Barcode &blacktriangledown;</th>
                        <th scope="col" className={styles.excelTableHeader}>Module Serial Number (Barcode) &blacktriangledown;</th>
                        <th scope="col" className={styles.excelTableHeader}>Model Name &blacktriangledown;</th>
                        <th scope="col" className={styles.excelTableHeader}>Flash Pm (W) &blacktriangledown;</th>
                        <th scope="col" className={styles.excelTableHeader}>Voc (V) &blacktriangledown;</th>
                        <th scope="col" className={styles.excelTableHeader}>Isc (A) &blacktriangledown;</th>
                        <th scope="col" className={styles.excelTableHeader}>Vmp (V) &blacktriangledown;</th>
                        <th scope="col" className={styles.excelTableHeader}>Imp (A) &blacktriangledown;</th>
                        <th scope="col" className={styles.excelTableHeader}>Grade &blacktriangledown;</th>
                        <th scope="col" className={styles.excelTableHeader}>Warehouse Scan Status &blacktriangledown;</th>
                      </tr>

                      {/* Rows 9+: 300 Serial Number Rows */}
                      {filteredExcelUnits.map((u, idx) => {
                        const isVer = verifiedSerials.has(u.serialNo);
                        const isSelected = selectedExcelCell.coord === `D${9 + idx}`;
                        return (
                          <tr
                            key={u.serialNo}
                            className={isVer ? styles.excelRowVerified : styles.excelRowPending}
                            onClick={() =>
                              setSelectedExcelCell({
                                coord: `D${9 + idx}`,
                                val: u.serialNo,
                              })
                            }
                          >
                            <td className={styles.excelRowHeader}>{9 + idx}</td>
                            <td className={styles.excelCell} style={{ textAlign: "center", color: "#64748b" }}>
                              #{idx + 1}
                            </td>
                            <td className={styles.excelCell} style={{ fontWeight: 600 }}>
                              Pallet #{String(u.palletNo).padStart(2, "0")}
                            </td>
                            <td className={styles.excelCell} style={{ fontFamily: "monospace", color: "#475569" }}>
                              {u.palletBarcode}
                            </td>
                            <td
                              className={`${styles.excelCell} ${isSelected ? styles.excelCellSelected : ""}`}
                              style={{
                                fontFamily: "monospace",
                                fontWeight: 700,
                                fontSize: "12px",
                                color: "#0f172a",
                                letterSpacing: "0.02em",
                              }}
                            >
                              {u.serialNo}
                            </td>
                            <td className={styles.excelCell} style={{ color: "#334155" }}>
                              {u.model}
                            </td>
                            <td className={styles.excelCell} style={{ textAlign: "right", fontWeight: 700, color: "#0f172a" }}>
                              {u.flashPowerWatts ? `${u.flashPowerWatts}W` : "620.0W"}
                            </td>
                            <td className={styles.excelCell} style={{ textAlign: "right", color: "#475569" }}>
                              51.32V
                            </td>
                            <td className={styles.excelCell} style={{ textAlign: "right", color: "#475569" }}>
                              15.28A
                            </td>
                            <td className={styles.excelCell} style={{ textAlign: "right", color: "#475569" }}>
                              {u.vmp ? `${u.vmp}V` : "42.15V"}
                            </td>
                            <td className={styles.excelCell} style={{ textAlign: "right", color: "#475569" }}>
                              {u.imp ? `${u.imp}A` : "14.74A"}
                            </td>
                            <td className={styles.excelCell} style={{ textAlign: "center", fontWeight: 700, color: "#16a34a" }}>
                              A
                            </td>
                            <td className={styles.excelCell} style={{ whiteSpace: "nowrap" }}>
                              {isVer ? (
                                <span style={{ color: "#16a34a", fontWeight: 700, fontSize: "11.5px" }}>
                                  ✅ Verified (Scanned)
                                </span>
                              ) : (
                                <span style={{ color: "#d97706", fontWeight: 500, fontSize: "11.5px" }}>
                                  ⏳ Pending Scan
                                </span>
                              )}
                            </td>
                          </tr>
                        );
                      })}
                    </>
                  ) : (
                    <>
                      {/* Sheet 2: Pallet Summary Manifest */}
                      <tr>
                        <td className={styles.excelRowHeader}>1</td>
                        <td
                          colSpan={12}
                          className={styles.excelCell}
                          style={{
                            background: "#107c41",
                            color: "#ffffff",
                            fontWeight: 800,
                            fontSize: "14px",
                            padding: "8px 12px",
                          }}
                        >
                          JINKO SOLAR CO., LTD. &middot; PALLET SUMMARY &amp; CONTAINER MANIFEST
                        </td>
                      </tr>
                      <tr>
                        <td className={styles.excelRowHeader}>2</td>
                        <th scope="col" className={styles.excelTableHeader}>Pallet # &blacktriangledown;</th>
                        <th scope="col" className={styles.excelTableHeader}>Pallet Barcode &blacktriangledown;</th>
                        <th scope="col" className={styles.excelTableHeader} colSpan={2}>Module SKU &blacktriangledown;</th>
                        <th scope="col" className={styles.excelTableHeader}>Package Qty &blacktriangledown;</th>
                        <th scope="col" className={styles.excelTableHeader}>Total Flash Power &blacktriangledown;</th>
                        <th scope="col" className={styles.excelTableHeader}>Quality Grade &blacktriangledown;</th>
                        <th scope="col" className={styles.excelTableHeader} colSpan={5}>Factory Packing Specification &blacktriangledown;</th>
                      </tr>

                      {Array.from(new Set(supplierSerialList.map((u) => u.palletNo))).map((pNum) => {
                        const inPallet = supplierSerialList.filter((u) => u.palletNo === pNum);
                        const palletPower = inPallet.reduce((sum, u) => sum + (u.flashPowerWatts || 620), 0) / 1000;
                        return (
                          <tr key={pNum}>
                            <td className={styles.excelRowHeader}>{2 + pNum}</td>
                            <td className={styles.excelCell} style={{ fontWeight: 700 }}>
                              Pallet #{String(pNum).padStart(2, "0")}
                            </td>
                            <td className={styles.excelCell} style={{ fontFamily: "monospace", fontWeight: 700 }}>
                              {inPallet[0]?.palletBarcode}
                            </td>
                            <td className={styles.excelCell} colSpan={2}>
                              JKM-620N-72HL4-BDV
                            </td>
                            <td className={styles.excelCell} style={{ textAlign: "center", fontWeight: 700 }}>
                              {inPallet.length} PCS
                            </td>
                            <td className={styles.excelCell} style={{ textAlign: "right", fontWeight: 700 }}>
                              {palletPower.toFixed(2)} kWp
                            </td>
                            <td className={styles.excelCell} style={{ textAlign: "center", fontWeight: 700, color: "#16a34a" }}>
                              Grade A
                            </td>
                            <td className={styles.excelCell} colSpan={5} style={{ color: "#334155" }}>
                              Pallet Strapped &middot; Corner Protectors &middot; QC Inspection Passed
                            </td>
                          </tr>
                        );
                      })}
                    </>
                  )}
                </tbody>
              </table>
            </div>

            {/* 5. Excel Bottom Tabs & Live Status Bar */}
            <div className={styles.excelBottomBar}>
              <div className={styles.excelSheetTabs}>
                <button
                  type="button"
                  className={`${styles.excelSheetTab} ${activeExcelSheet === "sheet1" ? styles.excelSheetTabActive : ""}`}
                  onClick={() => setActiveExcelSheet("sheet1")}
                >
                  Sheet1 - Flash Data &amp; Serials
                </button>
                <button
                  type="button"
                  className={`${styles.excelSheetTab} ${activeExcelSheet === "sheet2" ? styles.excelSheetTabActive : ""}`}
                  onClick={() => setActiveExcelSheet("sheet2")}
                >
                  Sheet2 - Pallet Summary
                </button>
              </div>

              <div style={{ display: "flex", gap: "16px", alignItems: "center", fontSize: "11.5px", flexWrap: "wrap" }}>
                <span>Ready</span>
                <span>&middot;</span>
                <span>Total Units: <strong>{supplierSerialList.length}</strong></span>
                <span>&middot;</span>
                <span>Scanned: <strong style={{ color: "#16a34a" }}>{verifiedSerials.size}</strong></span>
                <span>&middot;</span>
                <span>Pending: <strong style={{ color: "#d97706" }}>{supplierSerialList.length - verifiedSerials.size}</strong></span>
                <span>&middot;</span>
                <span>Avg Flash Power: <strong>621.7 W</strong></span>
                <span>&middot;</span>
                <span>Zoom: <strong>100%</strong></span>
              </div>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}

// ---------------------------------------------------------------------------
// Stock Out Verification Page — Camera Scanner & Scheduling System Match
// ---------------------------------------------------------------------------

const STOCK_OUT_TABS = [
  ["panel", "Panel"],
  ["inverter", "Inverter"],
  ["battery", "Battery"],
  ["mounting", "Mounting Structure"],
  ["electrical", "Electrical Item"],
  // Commercial jobs only (Tariff B or Selco): trunking, jointers, cable gland, metal DB box.
  ["commercial", "Special Material"],
] as const;
type StockOutTab = (typeof STOCK_OUT_TABS)[number][0];
const COMMERCIAL_PART_NAMES = new Set(COMMERCIAL_GROUPS.flatMap((group) => group.parts));

function StockOutVerificationPage({
  tx,
  onBack,
  onUpdateStatus,
  onRecord,
  loaded,
  preparedBy,
  viewOnly = false,
}: {
  tx: StockTransaction;
  onRecord: (material: VerificationMaterial) => void | Promise<boolean>;
  loaded: boolean;
  // Loading access: no Verified button; only Loading on a verified job.
  viewOnly?: boolean;
  // Who completed each item of this job (material -> name), shown under its table.
  preparedBy: Record<string, string>;
  onBack: () => void;
  onUpdateStatus: (newStatus: StockTransactionStatus, remark?: string) => void;
}) {
  const schedule = tx.schedule;
  // Drawings are read on demand (like the dashboard's "Check SLD"): the job list does not
  // carry them. The list is the SEDA engineering drawing first, then the invoice's PV
  // layout; links without a scheme ("//host/file.pdf") get https, and only http(s) is shown.
  const jobSourceId = schedule?.jobSourceId ?? "";
  const [drawings, setDrawings] = useState<{ label: string; url: string }[] | null>(null);
  const [drawingIdx, setDrawingIdx] = useState(0);
  const [drawingsLoading, setDrawingsLoading] = useState(false);
  const [drawingsError, setDrawingsError] = useState<string | null>(null);
  const [drawingsInfo, setDrawingsInfo] = useState<string | null>(null);
  function openDrawings() {
    setSldOpen(true);
    void loadDrawings();
  }
  async function loadDrawings() {
    if (drawings || drawingsLoading || !jobSourceId) return;
    setDrawingsLoading(true);
    setDrawingsError(null);
    try {
      const res = await fetch(`/api/jobs/${encodeURIComponent(jobSourceId)}/files`, {
        credentials: "same-origin",
        cache: "no-store",
      });
      if (res.status === 401) throw new Error("Sign in to the dashboard (same browser) to view drawings.");
      if (!res.ok) throw new Error(`Could not load drawings (HTTP ${res.status}).`);
      const data = (await res.json()) as { sld?: string[]; seda?: string[]; pv?: string[]; pvShape?: string };
      setDrawingsInfo(data.pvShape ?? null);
      const clean = (list: string[]) =>
        list
          .map((link) => (link.trim().startsWith("//") ? `https:${link.trim()}` : link.trim()))
          .filter((link) => link.toLowerCase().startsWith("http://") || link.toLowerCase().startsWith("https://"));
      const named = (list: string[], label: string) =>
        clean(list).map((url, i, all) => ({ label: all.length > 1 ? `${label} ${i + 1}` : label, url }));
      // The invoice's own "PV system drawing" files only (the SEDA engineering drawing is a
      // different field and is left out). Older servers send one merged list; use it as a fallback.
      const items =
        data.pv !== undefined
          ? named(data.pv, "PV system drawing")
          : clean(data.sld ?? []).map((url, i) => ({ label: `PV system drawing ${i + 1}`, url }));
      setDrawings(items);
      setDrawingIdx(0);
    } catch (error) {
      setDrawingsError(error instanceof Error ? error.message : "Could not load drawings.");
    } finally {
      setDrawingsLoading(false);
    }
  }
  const currentDrawing = drawings?.[drawingIdx]?.url ?? "";
  const currentIsPdf = currentDrawing.toLowerCase().includes(".pdf");
  const lines = useMemo(() => txLines(tx), [tx]);
  // The invoice only says how many of each item to install; serial numbers are not
  // known in advance. The warehouse scans whatever it loads, and each scan is
  // recorded against the first item that still needs units (or the item chosen).
  const serialLines = useMemo(
    () => lines.filter((line) => line.serialised && (line.qty ?? 0) > 0),
    [lines],
  );
  // Bulk lines (mounting structure, electrical accessories) have no quantity on the
  // invoice either, so the warehouse enters what it actually loads.
  const bulkLines = useMemo(() => lines.filter((line) => !line.serialised), [lines]);

  // Warehouse scans of single units (loose panels, inverters, batteries). They start with any
  // serials scanned on the New Stock Out form; the saved scans are added when the page opens.
  // TEST ONLY: sample box / loose scans for the TEST_VERIFIED_DATE jobs (see sampleWarehouseScans).
  const sample = useMemo(() => sampleWarehouseScans(tx, serialLines), [tx, serialLines]);
  const [scans, setScans] = useState<{ serial: string; lineIdx: number }[]>(() =>
    sample
      ? sample.scans
      : serialLines.flatMap((line, lineIdx) =>
          (line.serials ?? []).slice(0, line.qty ?? 0).map((serial) => ({ serial, lineIdx })),
        ),
  );
  // Panels leave the warehouse by box: each box barcode covers the panels inside (36 by default).
  const [boxes, setBoxes] = useState<{ code: string; qty: number }[]>(() => sample?.boxes ?? []);
  const [panelMode, setPanelMode] = useState<"box" | "loose">("box");
  // Panel boxes are often photographed instead of scanned: the photo is saved with the job as a
  // record (it does not count the panels; they are still scanned before Submit).
  const [panelPhoto, setPanelPhoto] = useState<string | null>(null);
  const [panelCamOpen, setPanelCamOpen] = useState(false);
  const [panelPhotoBusy, setPanelPhotoBusy] = useState(false);
  const [panelPhotoError, setPanelPhotoError] = useState<string | null>(null);
  const jobPhotoKey = `job:${tx.reference}`;
  useEffect(() => {
    let cancelled = false;
    fetch(`/api/warehouse/lorry-photos?lorry=${encodeURIComponent(jobPhotoKey)}`, { credentials: "same-origin", cache: "no-store" })
      .then(async (res) => (res.ok ? ((await res.json()) as { photos?: Record<string, string> }) : null))
      .then((data) => {
        if (!cancelled && data?.photos?.panel) setPanelPhoto((prev) => prev ?? data.photos!.panel);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [jobPhotoKey]);
  async function savePanelPhoto(photo: string) {
    setPanelPhotoBusy(true);
    setPanelPhotoError(null);
    try {
      const res = await fetch("/api/warehouse/lorry-photos", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({ lorry: jobPhotoKey, item: "panel", photo }),
      });
      if (!res.ok) throw new Error(((await res.json().catch(() => ({}))) as { error?: string }).error || "Could not save the photo.");
      setPanelPhoto(photo);
    } catch (err) {
      setPanelPhotoError(err instanceof Error ? err.message : "Could not save the photo.");
    } finally {
      setPanelPhotoBusy(false);
    }
  }
  const [boxSize, setBoxSize] = useState("36");
  // On site (Loading tab): each panel's own serial, scanned by the driver when the boxes are opened.
  const [siteScans, setSiteScans] = useState<string[]>([]);
  // Saved scans for this job, read once when the page opens.
  useEffect(() => {
    let cancelled = false;
    fetch(`/api/warehouse/job-scans?job=${encodeURIComponent(tx.reference)}`, { credentials: "same-origin", cache: "no-store" })
      .then(async (res) => {
        if (!res.ok) return;
        const data = (await res.json()) as {
          scans?: { stage: string; kind: string; lineIdx: number; code: string; qty: number }[];
        };
        if (cancelled) return;
        const saved = data.scans ?? [];
        const units = saved.filter((x) => x.stage === "warehouse" && x.kind === "serial" && serialLines[x.lineIdx]);
        setSiteScans(saved.filter((x) => x.stage === "site").map((x) => x.code));
        // Test job with nothing saved at the warehouse: keep the sample boxes and serials.
        if (sample && !saved.some((x) => x.stage === "warehouse")) return;
        if (sample) setScans([]);
        setScans((prev) => {
          const have = new Set(prev.map((x) => x.serial.toLowerCase()));
          return [...prev, ...units.filter((x) => !have.has(x.code.toLowerCase())).map((x) => ({ serial: x.code, lineIdx: x.lineIdx }))];
        });
        setBoxes(saved.filter((x) => x.stage === "warehouse" && x.kind === "box").map((x) => ({ code: x.code, qty: x.qty })));
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tx.reference]);
  // Save one scan; returns an error message, or null when saved.
  async function saveScan(scan: { stage: "warehouse" | "site"; kind: "box" | "serial"; category: string; lineIdx: number; code: string; qty: number }) {
    try {
      const res = await fetch("/api/warehouse/job-scans", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({ job: tx.reference, ...scan }),
      });
      if (res.ok) return null;
      const body = (await res.json().catch(() => ({}))) as { error?: string };
      return body.error || "Could not save the scan.";
    } catch {
      return "Could not save the scan. Check the connection.";
    }
  }
  function removeBox(code: string) {
    setBoxes((prev) => prev.filter((box) => box.code !== code));
    void fetch("/api/warehouse/job-scans", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      credentials: "same-origin",
      body: JSON.stringify({ job: tx.reference, stage: "warehouse", code }),
    }).catch(() => {});
  }
  const [tab, setTab] = useState<StockOutTab>(() => {
    const present = STOCK_OUT_TABS.find(([id]) => lines.some((line) => line.category === id));
    return present ? present[0] : "panel";
  });
  const [bulkQty, setBulkQty] = useState<Record<number, string>>({});

  // Mounting structure: suggested parts from the PV drawing's layout (entered by hand
  // from the drawing), and the quantity actually loaded per part.
  const [mountSystem, setMountSystem] = useState<MountingSystemId>(() =>
    lines.some((line) => line.category === "mounting" && /winstar/i.test(line.model)) ? "winstar" : "mibet",
  );
  const [mountRoof, setMountRoof] = useState<RoofType>("tile");
  const [mountOrientation, setMountOrientation] = useState<Orientation>("portrait");
  const [mountRows, setMountRows] = useState(() => {
    const total = lines.filter((line) => line.category === "panel").reduce((sum, line) => sum + (line.qty ?? 0), 0);
    return String(Math.max(1, Math.ceil(total / 3)));
  });
  const [partQty, setPartQty] = useState<Record<string, string>>({});
  // How many boxes the mounting structure is packed into for this job.
  const [mountBoxQty, setMountBoxQty] = useState("");
  // How many boxes the electrical items are packed into for this job.
  const [elecBoxQty, setElecBoxQty] = useState("");
  const [mountGroup, setMountGroup] = useState("Rail");
  // Mounting tabs: Rail, and one tab for Hook & Bracket together with Clamp. Each is packed
  // separately and records its own "Packed by" (material).
  const mountTabs = [
    { key: "Rail", label: "Rail", groups: ["Rail"], material: "mounting_rail" as const },
    { key: "Hook & Bracket", label: "Hook, Bracket & Clamp", groups: ["Hook & Bracket", "Clamp"], material: "mounting_hook" as const },
  ];
  const mountTabGroups = mountTabs.find((t) => t.key === mountGroup)?.groups ?? [mountGroup];
  const mountTabMaterial = mountTabs.find((t) => t.key === mountGroup)?.material;
  // Part names of each mounting tab, across both systems (MIBET, WINSTAR).
  const mountTabParts = (groups: string[]) =>
    new Set(
      MOUNTING_SYSTEMS.flatMap((system) => system.groups.filter((group) => groups.includes(group.label))).flatMap((group) =>
        group.parts.map((part) => part.name),
      ),
    );
  // Record who packed each mounting tab, once, when a quantity is first entered there.
  const recordedMountTabs = useRef<Set<string>>(new Set());
  useEffect(() => {
    if (tx.status === "Verified") return;
    mountTabs.forEach((mt) => {
      if (recordedMountTabs.current.has(mt.material) || preparedBy[mt.material]) return;
      const parts = mountTabParts(mt.groups);
      const entered = Object.entries(partQty).some(([name, value]) => parts.has(name) && value.trim() !== "");
      if (entered) {
        recordedMountTabs.current.add(mt.material);
        onRecord(mt.material);
      }
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [partQty, tx.status]);
  // PV drawings the user ticked to appear on the report (by link), saved per job.
  const [pvPicked, setPvPicked] = useState<Record<string, string>>({});
  const [elecGroup, setElecGroup] = useState(ELECTRICAL_GROUPS[0].label);
  const [elecQty, setElecQty] = useState<Record<string, string>>({});
  const [commGroup, setCommGroup] = useState(COMMERCIAL_GROUPS[0].label);
  const panelCount = lines.filter((line) => line.category === "panel").reduce((sum, line) => sum + (line.qty ?? 0), 0);
  const mountEstimate = useMemo(
    () =>
      estimateMounting({
        system: mountSystem,
        roof: mountRoof,
        orientation: mountOrientation,
        panels: panelCount,
        rows: Number(mountRows) || 1,
      }),
    [mountSystem, mountRoof, mountOrientation, panelCount, mountRows],
  );
  const hasMountingParts = Object.values(partQty).some((value) => value.trim() !== "");
  // Electrical items and special materials share one quantity list; tell them apart by name.
  const hasElectricalParts = Object.entries(elecQty).some(
    ([name, value]) => !COMMERCIAL_PART_NAMES.has(name) && value.trim() !== "",
  );
  const hasCommercialParts = Object.entries(elecQty).some(
    ([name, value]) => COMMERCIAL_PART_NAMES.has(name) && value.trim() !== "",
  );
  // A group that is filled in from its parts list counts as done without the per-invoice lines.
  const listFilled = (category: string) =>
    (category === "mounting" && hasMountingParts) ||
    (category === "electrical" && hasElectricalParts) ||
    (category === "commercial" && hasCommercialParts);

  const [barcodeInput, setBarcodeInput] = useState("");
  const [cameraActive, setCameraActive] = useState(false);
  const [cameraError, setCameraError] = useState<string | null>(null);
  const videoRef = useRef<HTMLVideoElement>(null);

  const [feedback, setFeedback] = useState<{
    type: "success" | "warning" | "error";
    message: string;
  } | null>(null);

  const [doOpen, setDoOpen] = useState(false);
  const [reportOpen, setReportOpen] = useState(false);
  // The report shows the drawing too, so load it when the report opens.
  useEffect(() => {
    if (reportOpen) void loadDrawings();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reportOpen, jobSourceId]);
  const [sldOpen, setSldOpen] = useState(false);
  // TEST ONLY: dummy lorry plate and photo for CHEOK GEOK LIAN.
  const dummyLorry = /cheok\s+geok\s+lian/i.test(schedule?.customerName ?? tx.party);
  const [vehiclePlate, setVehiclePlate] = useState(dummyLorry ? DUMMY_LORRY_PLATE : "");
  // Lorry driver for this job; saved with the plate (shown on the Loading page).
  const [driverName, setDriverName] = useState("");
  const [checklist, setChecklist] = useState({
    condition: false,
    serialMatch: false,
    qtyCounted: false,
    handoverSigned: false,
  });

  const barcodeInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    // Ready for the laser gun on a computer. Not on phones / tablets: focusing the box there
    // pops up the keyboard and makes iPhones zoom in on the page.
    if (window.matchMedia("(pointer: fine)").matches) barcodeInputRef.current?.focus();
  }, []);

  // Camera video stream & live BarcodeDetector hook
  useEffect(() => {
    let stream: MediaStream | null = null;
    let detectorTimer: NodeJS.Timeout | null = null;
    // Set when the camera is closed (or the page re-renders) before the camera has started,
    // so a stream that arrives late is stopped instead of keeping the camera busy.
    let cancelled = false;

    if (cameraActive) {
      if (typeof navigator !== "undefined" && typeof navigator.mediaDevices?.getUserMedia === "function") {
        openCameraStream()
          .then((s) => {
            if (cancelled) {
              s.getTracks().forEach((t) => t.stop());
              return;
            }
            stream = s;
            if (videoRef.current) {
              videoRef.current.srcObject = s;
              videoRef.current.play().catch(() => {});
            }
            setCameraError(null);

            if (typeof window !== "undefined" && "BarcodeDetector" in window) {
              try {
                // @ts-expect-error - standard browser BarcodeDetector API
                const detector = new window.BarcodeDetector({ formats: ["code_128", "qr_code", "ean_13", "data_matrix"] });
                detectorTimer = setInterval(async () => {
                  if (videoRef.current && videoRef.current.readyState >= 2) {
                    try {
                      const barcodes = await detector.detect(videoRef.current);
                      if (barcodes && barcodes.length > 0 && barcodes[0].rawValue) {
                        handleScanRef.current(barcodes[0].rawValue);
                      }
                    } catch {}
                  }
                }, 400);
              } catch {}
            }
          })
          .catch((err) => {
            if (!cancelled) setCameraError(cameraErrorMessage(err));
          });
      } else {
        setCameraError(cameraErrorMessage(null));
      }
    } else {
      if (videoRef.current && videoRef.current.srcObject) {
        const tracks = (videoRef.current.srcObject as MediaStream).getTracks();
        tracks.forEach((t) => t.stop());
        videoRef.current.srcObject = null;
      }
    }

    return () => {
      cancelled = true;
      if (detectorTimer) clearInterval(detectorTimer);
      if (stream) {
        stream.getTracks().forEach((t) => t.stop());
      }
    };
  }, [cameraActive]);

  // Box coverage: the boxes' panels are shared out over the panel lines (after the loose panels).
  const looseOf = (i: number) => scans.filter((scan) => scan.lineIdx === i).map((scan) => scan.serial);
  const boxPool = boxes.flatMap((box) => Array.from({ length: box.qty }, () => box.code));
  const boxAlloc: string[][] = serialLines.map((line, i) => {
    if (line.category !== "panel") return [];
    const need = Math.max(0, (line.qty ?? 0) - looseOf(i).length);
    return boxPool.splice(0, need);
  });
  const boxExtra = boxPool.length;
  const scannedPerLine = serialLines.map((_, i) => looseOf(i).length + boxAlloc[i].length);
  const totalRequired = serialLines.reduce((sum, line) => sum + (line.qty ?? 0), 0);
  const totalScanned = scannedPerLine.reduce((sum, n) => sum + n, 0);
  // On site: every panel scanned one by one.
  const panelTotal = serialLines.filter((line) => line.category === "panel").reduce((sum, line) => sum + (line.qty ?? 0), 0);
  const siteDone = panelTotal > 0 && siteScans.length >= panelTotal;
  const siteProgress = panelTotal > 0 ? Math.min(100, Math.round((siteScans.length / panelTotal) * 100)) : 0;
  const progressPercent = totalRequired > 0 ? Math.min(100, Math.round((totalScanned / totalRequired) * 100)) : 0;
  const bulkMissing = bulkLines.filter(
    (line, i) => !listFilled(line.category) && (bulkQty[i] ?? "").trim() === "",
  ).length;
  const bulkDone = tx.status === "Verified" || bulkMissing === 0;
  const serialDone = serialLines.every((line, i) => scannedPerLine[i] >= (line.qty ?? 0));
  const isAllVerified = (serialLines.length > 0 || bulkLines.length > 0) && serialDone && bulkDone;
  const stillToDo =
    serialLines.reduce((sum, line, i) => sum + Math.max(0, (line.qty ?? 0) - scannedPerLine[i]), 0) +
    (tx.status === "Verified" ? 0 : bulkMissing);
  // One row per unit the invoice calls for; the serial fills in as it is scanned.
  // Box-covered panels come first (serial = the box code, box = true), then the loose units.
  const slots = serialLines.flatMap((line, lineIdx) =>
    Array.from({ length: line.qty ?? 0 }, (_, k) => {
      const inBox = boxAlloc[lineIdx][k];
      return {
        key: `${lineIdx}-${k}`,
        line,
        lineIdx,
        box: inBox !== undefined,
        serial: inBox ?? looseOf(lineIdx)[k - boxAlloc[lineIdx].length] ?? null,
      };
    }),
  );
  const isSerialTab = tab === "panel" || tab === "inverter" || tab === "battery";
  // Loaded job, Panel tab: the scanner card is the on-site panel check (driver scans each panel).
  const onSitePanels = loaded && tab === "panel" && panelTotal > 0;
  // Loading stage: verified at the warehouse, not loaded on the lorry yet.
  const loadingJob = tx.status === "Verified" && !loaded;
  // Loading jobs: Slot, ETA and install time from the Delivery Schedule, for Customer Details.
  const [deliveryRuns, setDeliveryRuns] = useState<TimelineRun[]>([]);
  useEffect(() => {
    if (!loadingJob) return;
    return watchDeliveryRuns<TimelineRun>(setDeliveryRuns);
  }, [loadingJob]);
  const jobEta = useMemo(() => lookupEta(buildEtaLookup(deliveryRuns), tx), [deliveryRuns, tx]);
  const tabSlots = slots.filter((slot) => slot.line.category === tab);
  // On site, each panel row pairs the Stock Out scan with the on-site scan:
  // - a loose panel matches its own serial (the same code scanned at the warehouse);
  // - a boxed panel is matched by count: the box fills as many rows as panels it holds, and each
  //   row takes the next on-site serial that is not a loose panel's.
  // A scan that fits nowhere else goes into a loose row and is flagged as a different serial.
  const siteRows = (() => {
    if (!onSitePanels) return [];
    const remaining = [...siteScans];
    const take = (code: string) => {
      const i = remaining.findIndex((x) => x.toLowerCase() === code.toLowerCase());
      return i >= 0 ? remaining.splice(i, 1)[0] : null;
    };
    const rows = tabSlots.map((slot) => ({
      slot,
      boxNo: slot.box && slot.serial ? boxes.findIndex((b) => b.code === slot.serial) + 1 : 0,
      site: !slot.box && slot.serial ? take(slot.serial) : (null as string | null),
      mismatch: false,
    }));
    rows.forEach((row) => {
      if (row.slot.box && remaining.length) row.site = remaining.shift() ?? null;
    });
    rows.forEach((row) => {
      if (!row.slot.box && !row.site && remaining.length) {
        row.site = remaining.shift() ?? null;
        row.mismatch = !!row.slot.serial;
      }
    });
    return rows;
  })();
  const tabRequired = tabSlots.length;
  const tabScanned = tabSlots.filter((slot) => slot.serial !== null).length;
  const tabProgress = tabRequired > 0 ? Math.min(100, Math.round((tabScanned / tabRequired) * 100)) : 0;
  const tabLabel = (id: StockOutTab) => {
    const name = STOCK_OUT_TABS.find(([key]) => key === id)?.[1] ?? id;
    if (id === "mounting" || id === "electrical") {
      const total = bulkLines.filter((line) => line.category === id).length;
      if (total === 0) return name;
      const entered =
        listFilled(id)
          ? total
          : bulkLines.filter((line, i) => line.category === id && (bulkQty[i] ?? "").trim() !== "").length;
      return `${name} (${tx.status === "Verified" ? total : entered}/${total})`;
    }
    const required = slots.filter((slot) => slot.line.category === id).length;
    if (required === 0) return name;
    const done = slots.filter((slot) => slot.line.category === id && slot.serial !== null).length;
    return `${name} (${done}/${required})`;
  };
  // Saved quantities: the mounting parts loaded and the bulk items, kept per job so they are
  // still there after leaving the screen or reloading. Loaded when the job opens, saved
  // (after a short pause) whenever a quantity changes.
  const entriesLoaded = useRef(false);
  useEffect(() => {
    let cancelled = false;
    fetch(`/api/warehouse/entries?job=${encodeURIComponent(tx.reference)}`, { credentials: "same-origin", cache: "no-store" })
      .then(async (res) => {
        if (!res.ok) return;
        const data = (await res.json()) as { entries?: { kind: string; key: string; value: string }[] };
        if (cancelled) return;
        const parts: Record<string, string> = {};
        const elec: Record<string, string> = {};
        const pvp: Record<string, string> = {};
        const bulk: Record<number, string> = {};
        let box = "";
        let elecBox = "";
        let driver = "";
        let plate = "";
        (data.entries ?? []).forEach((entry) => {
          if (entry.kind === "mounting_part") parts[entry.key] = entry.value;
          if (entry.kind === "mounting_box") box = entry.value;
          if (entry.kind === "electrical_box") elecBox = entry.value;
          if (entry.kind === "lorry" && entry.key === "driver") driver = entry.value;
          if (entry.kind === "lorry" && entry.key === "plate") plate = entry.value;
          if (entry.kind === "electrical_part") elec[entry.key] = entry.value;
          if (entry.kind === "pv_drawing") pvp[entry.key] = entry.value;
          if (entry.kind === "bulk_line") {
            const index = bulkLines.findIndex((line) => line.model === entry.key);
            if (index >= 0) bulk[index] = entry.value;
          }
        });
        setPartQty((prev) => ({ ...parts, ...prev }));
        setMountBoxQty((prev) => prev || box);
        setElecBoxQty((prev) => prev || elecBox);
        setDriverName((prev) => prev || driver);
        if (plate) setVehiclePlate((prev) => (prev && prev !== DUMMY_LORRY_PLATE ? prev : plate));
        setElecQty((prev) => ({ ...elec, ...prev }));
        setPvPicked((prev) => ({ ...pvp, ...prev }));
        setBulkQty((prev) => ({ ...bulk, ...prev }));
        entriesLoaded.current = true;
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tx.reference]);
  useEffect(() => {
    // Only after the saved values were read, so an early keystroke cannot wipe them. A job
    // that is already Verified still saves what is typed.
    if (!entriesLoaded.current) return;
    const timer = setTimeout(() => {
      const entries = [
        ...Object.entries(partQty)
          .filter(([, value]) => value.trim() !== "")
          .map(([key, value]) => ({ kind: "mounting_part" as const, key, value: value.trim() })),
        ...(mountBoxQty.trim() !== "" ? [{ kind: "mounting_box" as const, key: "boxes", value: mountBoxQty.trim() }] : []),
        ...(elecBoxQty.trim() !== "" ? [{ kind: "electrical_box" as const, key: "boxes", value: elecBoxQty.trim() }] : []),
        ...(driverName.trim() !== "" ? [{ kind: "lorry" as const, key: "driver", value: driverName.trim() }] : []),
        // The test job's dummy plate is not saved.
        ...(vehiclePlate.trim() !== "" && !(dummyLorry && vehiclePlate === DUMMY_LORRY_PLATE)
          ? [{ kind: "lorry" as const, key: "plate", value: vehiclePlate.trim() }]
          : []),
        ...Object.entries(pvPicked)
          .filter(([, value]) => value === "1")
          .map(([key]) => ({ kind: "pv_drawing" as const, key, value: "1" })),
        ...Object.entries(elecQty)
          .filter(([, value]) => value.trim() !== "")
          .map(([key, value]) => ({ kind: "electrical_part" as const, key, value: value.trim() })),
        ...Object.entries(bulkQty)
          .filter(([index, value]) => value.trim() !== "" && bulkLines[Number(index)])
          .map(([index, value]) => ({ kind: "bulk_line" as const, key: bulkLines[Number(index)].model, value: value.trim() })),
      ];
      void fetch("/api/warehouse/entries", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({ job: tx.reference, kinds: ["mounting_part", "mounting_box", "electrical_box", "bulk_line", "electrical_part", "pv_drawing", "lorry"], entries }),
      }).catch(() => {});
    }, 600);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [partQty, mountBoxQty, elecBoxQty, driverName, vehiclePlate, elecQty, bulkQty, pvPicked]);

  // Record who completed each material (once): all units scanned, or all quantities entered.
  const recordedMaterials = useRef<Set<string>>(new Set());
  useEffect(() => {
    if (tx.status === "Verified") return;
    STOCK_OUT_TABS.forEach(([id]) => {
      if (recordedMaterials.current.has(id)) return;
      const serialRequired = slots.filter((slot) => slot.line.category === id).length;
      const bulkHere = bulkLines.filter((line) => line.category === id).length;
      let done = false;
      if (serialRequired > 0) {
        done = slots.filter((slot) => slot.line.category === id && slot.serial !== null).length >= serialRequired;
      } else if (bulkHere > 0) {
        done =
          listFilled(id)
            ? true
            : bulkLines.every((line, i) => line.category !== id || (bulkQty[i] ?? "").trim() !== "");
      } else {
        // Special Material has no invoice lines: done once its list is filled in.
        done = listFilled(id);
      }
      if (done) {
        recordedMaterials.current.add(id);
        onRecord(id as VerificationMaterial);
      }
    });
  });
  const systemSizeText =
    schedule?.systemSizeKwp && schedule.systemSizeKwp !== "—" ? `${schedule.systemSizeKwp} kWp` : "the schedule";

  // Scan handler. Loading tab (on site): each panel serial. To Verify: a panel box (box mode),
  // or one unit's serial. Every scan is saved.
  const handleScanRef = useRef<(code?: string) => void>(() => {});
  handleScanRef.current = (code?: string) => handleScan(code);
  function handleScan(codeToTest?: string) {
    const code = (codeToTest ?? barcodeInput).trim();
    if (!code) return;

    if (loaded) {
      setBarcodeInput("");
      if (panelTotal === 0) {
        setFeedback({ type: "warning", message: "⚠️ This job has no panels to check on site." });
        return;
      }
      if (siteScans.some((serial) => serial.toLowerCase() === code.toLowerCase())) {
        setFeedback({ type: "warning", message: `⚠️ Duplicate Scan: panel ${code} was already scanned on site.` });
        return;
      }
      if (siteScans.length >= panelTotal) {
        setFeedback({ type: "warning", message: `⚠️ All ${panelTotal} panels are already scanned on site.` });
        return;
      }
      const count = siteScans.length + 1;
      setSiteScans((prev) => [...prev, code]);
      setFeedback({ type: "success", message: `✅ Panel ${code} arrived (${count}/${panelTotal})` });
      void saveScan({ stage: "site", kind: "serial", category: "panel", lineIdx: 0, code, qty: 1 }).then((error) => {
        if (!error) return;
        setSiteScans((prev) => prev.filter((serial) => serial !== code));
        setFeedback({ type: "error", message: `❌ ${error}` });
      });
      return;
    }

    if (tx.status === "Verified") {
      setFeedback({ type: "warning", message: "⚠️ This job is already verified. Panels are scanned again on site after Loading." });
      setBarcodeInput("");
      return;
    }

    if (
      boxes.some((box) => box.code.toLowerCase() === code.toLowerCase()) ||
      scans.some((scan) => scan.serial.toLowerCase() === code.toLowerCase())
    ) {
      setFeedback({ type: "warning", message: `⚠️ Duplicate Scan: ${code} was already recorded for this dispatch!` });
      setBarcodeInput("");
      return;
    }

    // Panel box: covers the panels inside it.
    if (tab === "panel" && panelMode === "box") {
      setBarcodeInput("");
      const qty = Math.max(1, Math.min(1000, Math.round(Number(boxSize) || 36)));
      const panelNeed = serialLines.reduce(
        (sum, line, i) => (line.category === "panel" ? sum + Math.max(0, (line.qty ?? 0) - scannedPerLine[i]) : sum),
        0,
      );
      if (panelNeed === 0) {
        setFeedback({ type: "warning", message: "⚠️ All panels for this job are already covered." });
        return;
      }
      setBoxes((prev) => [...prev, { code, qty }]);
      setFeedback({
        type: qty > panelNeed ? "warning" : "success",
        message:
          qty > panelNeed
            ? `⚠️ Box ${code} recorded (${qty} panels), but only ${panelNeed} more needed: ${qty - panelNeed} panels go back.`
            : `✅ Box ${code} recorded (${qty} panels) for Job #${schedule?.jobId ?? tx.reference}`,
      });
      void saveScan({ stage: "warehouse", kind: "box", category: "panel", lineIdx: 0, code, qty }).then((error) => {
        if (!error) return;
        setBoxes((prev) => prev.filter((box) => box.code !== code));
        setFeedback({ type: "error", message: `❌ ${error}` });
      });
      return;
    }

    if (serialLines.length === 0) {
      setFeedback({ type: "error", message: "❌ This job has no panel, inverter or battery quantity to scan." });
      setBarcodeInput("");
      return;
    }

    if (scans.some((scan) => scan.serial.toLowerCase() === code.toLowerCase())) {
      setFeedback({
        type: "warning",
        message: `⚠️ Duplicate Scan: S/N ${code} was already recorded for this dispatch!`,
      });
      setBarcodeInput("");
      return;
    }

    const needsUnits = (i: number) => scannedPerLine[i] < (serialLines[i].qty ?? 0);
    const target = serialLines.findIndex((line, i) => line.category === tab && needsUnits(i));

    if (target < 0) {
      setFeedback({
        type: "warning",
        message: `⚠️ Nothing left to scan in the ${STOCK_OUT_TABS.find(([id]) => id === tab)?.[1] ?? "selected"} tab. Pick another tab, or the quantity is already recorded.`,
      });
      setBarcodeInput("");
      return;
    }

    const line = serialLines[target];
    setScans((prev) => [...prev, { serial: code, lineIdx: target }]);
    setFeedback({
      type: "success",
      message: `✅ Recorded S/N ${code} as ${line.model} (${scannedPerLine[target] + 1}/${line.qty}) for Job #${schedule?.jobId ?? tx.reference}`,
    });
    setBarcodeInput("");
    void saveScan({ stage: "warehouse", kind: "serial", category: line.category, lineIdx: target, code, qty: 1 }).then((error) => {
      if (!error) return;
      setScans((prev) => prev.filter((scan) => scan.serial !== code));
      setFeedback({ type: "error", message: `❌ ${error}` });
    });
  }

  // On site: "arrived" is saved when Verified is pressed (after every panel is scanned).
  const [arrivedNow, setArrivedNow] = useState(false);
  const siteVerified = arrivedNow || !!preparedBy.arrived;

  // The Scheduling System Record card: shown on the page and again in the report.
  const renderSchedulingRecord = (forReport: boolean) => (
        <div
          className={styles.inspectCard}
          // No box background or outline (on the page and in the report)
          style={{ marginBottom: "16px", border: "none", background: "none", boxShadow: "none", padding: forReport ? 0 : "0 0 4px" }}
        >
          <div
            className={styles.inspectCardHeader}
            style={{ alignItems: "flex-start", flexWrap: "wrap", gap: "10px", ...(forReport ? { borderBottom: "none", paddingBottom: 0 } : {}) }}
          >
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "8px", flexWrap: "wrap", gap: "8px" }}>
                <h2
                  className={styles.inspectCardTitle}
                  style={{
                    margin: 0,
                    color: "#000000",
                    fontWeight: 700,
                    // Preparing and Verified job pages: the title in a grey box, full width (to the
                    // end of the item cards row, the Special Material card)
                    ...(!forReport && !loaded
                      ? {
                          border: "1px solid var(--line)",
                          borderRadius: "10px",
                          background: "#e5e7eb",
                          padding: "8px 14px",
                          flex: "1 1 100%",
                          boxSizing: "border-box" as const,
                        }
                      : {}),
                  }}
                >
                  <span>📅</span> Customer Details &middot; #{schedule?.jobId ?? tx.reference}
                </h2>
              </div>

              {/* Customer with Address & Agent directly underneath, plus Phone */}
              <div style={{ fontSize: "13px", color: "#000000", marginTop: "6px", display: "flex", justifyContent: "space-between", alignItems: "flex-start", flexWrap: "wrap", gap: "12px" }}>
                <div
                  className={forReport ? undefined : styles.custDetailLines}
                  style={{ display: "grid", gridTemplateColumns: "max-content max-content 1fr", columnGap: "6px", rowGap: "4px", color: "#000000" }}
                >
                  <div style={{ display: "contents" }}>
                    <span style={{ color: "#000000", fontWeight: 700 }}>Customer</span>
                    <span style={{ color: "#000000", fontWeight: 700 }}>:</span>
                    <strong style={{ color: "#000000", fontWeight: 400, fontSize: "13.5px" }}>{schedule?.customerName}</strong>
                  </div>
                  {!forReport && schedule?.customerPhone && (
                    <div style={{ display: "contents" }}>
                      <span style={{ color: "#000000", fontWeight: 700 }}>Phone</span>
                    <span style={{ color: "#000000", fontWeight: 700 }}>:</span>
                      <strong style={{ color: "#000000", fontWeight: 400 }}>{schedule.customerPhone}</strong>
                    </div>
                  )}
                  {!forReport && (
                    <div style={{ display: "contents" }}>
                      <span style={{ color: "#000000", fontWeight: 700 }}>Address</span>
                      <span style={{ color: "#000000", fontWeight: 700 }}>:</span>
                      <strong style={{ color: "#000000", fontWeight: 400 }}>{schedule?.customerAddress}</strong>
                    </div>
                  )}
                  <div style={{ display: "contents" }}>
                    <span style={{ color: "#000000", fontWeight: 700 }}>Agent</span>
                    <span style={{ color: "#000000", fontWeight: 700 }}>:</span>
                    <strong style={{ color: "#000000", fontWeight: 400 }}>{schedule?.agentName ?? "OLIVIER KOH CONG LEE"}</strong>
                  </div>
                  {/* Loading: Slot, ETA and Installation Date, as in the Loading table */}
                  {!forReport && loadingJob && (
                    <>
                      <div style={{ display: "contents" }}>
                        <span style={{ color: "#000000", fontWeight: 700 }}>Slot</span>
                        <span style={{ color: "#000000", fontWeight: 700 }}>:</span>
                        <strong style={{ color: "#000000", fontWeight: 400 }}>
                          {jobEta?.slotDate
                            ? `${isoDateLabel(jobEta.slotDate)}${(sheetClock(jobEta.slotTime) || jobEta.slotTime) ? ` · ${sheetClock(jobEta.slotTime) || jobEta.slotTime}` : ""}`
                            : "—"}
                        </strong>
                      </div>
                      <div style={{ display: "contents" }}>
                        <span style={{ color: "#000000", fontWeight: 700 }}>ETA</span>
                        <span style={{ color: "#000000", fontWeight: 700 }}>:</span>
                        <strong style={{ color: "#000000", fontWeight: 400 }}>
                          {jobEta?.date ? `${isoDateLabel(jobEta.date)}${jobEta.time ? ` · ${etaClock(jobEta.time)}` : ""}` : "—"}
                        </strong>
                      </div>
                      <div style={{ display: "contents" }}>
                        <span style={{ color: "#000000", fontWeight: 700 }}>Installation Date</span>
                        <span style={{ color: "#000000", fontWeight: 700 }}>:</span>
                        <strong style={{ color: "#000000", fontWeight: 400 }}>
                          {isoDateLabel(tx.time)}
                          {jobEta?.installTime && (!jobEta.installDate || jobEta.installDate === tx.time.slice(0, 10)) && sheetClock(jobEta.installTime)
                            ? ` · ${sheetClock(jobEta.installTime)}`
                            : ""}
                        </strong>
                      </div>
                    </>
                  )}
                  {/* Loading (verified, not yet loaded): only Customer, Phone, Address and Agent */}
                  {!(!forReport && tx.status === "Verified" && !loaded) && (
                    <>
                    <div style={{ display: "contents" }}>
                      <span style={{ color: "#000000", fontWeight: 700 }}>TNB Meter</span>
                      <span style={{ color: "#000000", fontWeight: 700 }}>:</span>
                      <strong style={{ color: "#000000", fontWeight: 400 }}>{schedule?.tnbMeter ?? "—"}</strong>
                    </div>
                    <div style={{ display: "contents" }}>
                      <span style={{ color: "#000000", fontWeight: 700 }}>Inverter Model</span>
                      <span style={{ color: "#000000", fontWeight: 700 }}>:</span>
                      <strong style={{ color: "#000000", fontWeight: 400 }}>{schedule?.inverterModel ?? "—"}</strong>
                    </div>
                    <div style={{ display: "contents" }}>
                      <span style={{ color: "#000000", fontWeight: 700 }}>No of Panel (Pcs)</span>
                      <span style={{ color: "#000000", fontWeight: 700 }}>:</span>
                      <strong style={{ color: "#000000", fontWeight: 400 }}>{schedule?.noOfPanel ? `${schedule.noOfPanel} pcs` : "—"}</strong>
                    </div>
                    <div style={{ display: "contents" }}>
                      <span style={{ color: "#000000", fontWeight: 700 }}>Panel Brand</span>
                      <span style={{ color: "#000000", fontWeight: 700 }}>:</span>
                      <strong style={{ color: "#000000", fontWeight: 400 }}>{schedule?.panelBrand || "—"}</strong>
                    </div>
                    <div style={{ display: "contents" }}>
                      <span style={{ color: "#000000", fontWeight: 700 }}>Panel Power (W)</span>
                      <span style={{ color: "#000000", fontWeight: 700 }}>:</span>
                      <strong style={{ color: "#000000", fontWeight: 400 }}>{schedule?.panelPowerWatts ? `${schedule.panelPowerWatts}W` : "—"}</strong>
                    </div>
                    <div style={{ display: "contents" }}>
                      <span style={{ color: "#000000", fontWeight: 700 }}>Inverter Brand</span>
                      <span style={{ color: "#000000", fontWeight: 700 }}>:</span>
                      <strong style={{ color: "#000000", fontWeight: 400 }}>{schedule?.inverterBrand || "—"}</strong>
                    </div>
                    <div style={{ display: "contents" }}>
                      <span style={{ color: "#000000", fontWeight: 700 }}>Scheduled Date</span>
                      <span style={{ color: "#000000", fontWeight: 700 }}>:</span>
                      <strong style={{ color: "#000000", fontWeight: 400 }}>{schedule?.scheduledDate ?? tx.time}</strong>
                    </div>
                    </>
                  )}
                </div>
              </div>
            </div>
          </div>


        </div>
  );

  return (
    <section className={`${styles.screen} ${styles.soPage}`} aria-labelledby="stockout-verify-title">
      {/* Top Navigation */}
      <div className={styles.inspectTopBar}>
        <button className={styles.back} type="button" onClick={onBack} style={{ marginBottom: 0 }}>
          Back
        </button>
        <div style={{ display: "flex", gap: "8px", alignItems: "center", flexWrap: "wrap" }}>
          <button
            type="button"
            className={styles.btnActionGhost}
            onClick={openDrawings}
            disabled={!jobSourceId}
            title={jobSourceId ? "Open the PV drawing" : "No drawing available for this job"}
          >
            PV Drawing
          </button>
          {/* Delivery Order for this job, before Report */}
          <button type="button" className={styles.btnActionGhost} onClick={() => setDoOpen(true)} title="Delivery Order">
            DO
          </button>
          {/* A job on Preparing or Loading (not yet loaded) calls it "Item List"; Site Check keeps "Report" */}
          <button type="button" className={styles.btnActionGhost} onClick={() => setReportOpen(true)}>
            {!loaded ? "Item List" : "Report"}
          </button>
        </div>
      </div>

      {/* Titled by the Stock Out tab the job is in: Preparing -> Loading -> Site Check */}
      {!loaded ? (
        // Preparing and Verified (not yet loaded): "Stock Out", with "Item List - Preparing" or
        // "Item List - Verified" on the line below, as the Stock Out tabs are named
        <div style={{ margin: "0 0 12px" }}>
          <h1 id="stockout-verify-title" className={styles.inspectHeroTitle} style={{ margin: 0 }}>
            Stock Out
          </h1>
          <p style={{ margin: "12px 0 0", fontSize: "16px", fontWeight: 700, color: "#000" }}>
            {tx.status !== "Verified" ? "Item List - Preparing" : "Item List - Verified"}
          </p>
        </div>
      ) : (
        <h1 id="stockout-verify-title" className={styles.inspectHeroTitle} style={{ margin: "0 0 12px" }}>
          Stock Out - Site Check
        </h1>
      )}

      {/* Last-minute Stock Out: what it is for, who took it and why */}
      {tx.extra && (
        <div
          className={styles.inspectCard}
          style={{ marginBottom: "16px", borderColor: "#bf9000", background: "#fffbeb", fontSize: "13px", color: "#000" }}
        >
          <strong style={{ display: "block", marginBottom: "4px" }}>
            Last-minute item · #{tx.reference}
            {tx.extra.linkedJob ? ` · for Job #${tx.extra.linkedJob}` : " · No job"}
          </strong>
          <span>
            Taken by <strong>{tx.extra.takenBy}</strong> · {extraReasonLabel(tx.extra.reason)} · {WH_BUTTON_LABEL[tx.warehouse]} warehouse
            {tx.extra.note ? ` · ${tx.extra.note}` : ""}
            {tx.extra.createdBy ? ` · added by ${tx.extra.createdBy}` : ""}
          </span>
          {tx.extra.hasPhoto && <ExtraStockOutPhoto reference={tx.reference} />}
        </div>
      )}

      {/* 1. Scheduling System Record (also shown in the report) */}
      {renderSchedulingRecord(false)}

      {/* Item cards: how many of each item this customer needs. On Loading jobs they sit in
          one row as wide as the table below, with smaller text. */}
      <div className={`${styles.soCards} ${loadingJob ? styles.soCardsLoading : ""}`}>
        {STOCK_OUT_TABS.map(([id, label]) => {
          const serialQty = lines
            .filter((line) => line.serialised && line.category === id)
            .reduce((sum, line) => sum + (line.qty ?? 0), 0);
          const bulkCount = lines.filter((line) => !line.serialised && line.category === id).length;
          const isSpecial = id === "commercial";
          if (isSpecial ? !schedule?.commercial : serialQty === 0 && bulkCount === 0) return null;
          const scanned = slots.filter((slot) => slot.line.category === id && slot.serial !== null).length;
          // Mounting / electrical: total quantity entered so far (parts list plus the invoice-line boxes).
          const qtyOf = (value: string | undefined) => {
            const n = Number((value ?? "").trim());
            return Number.isFinite(n) && n > 0 ? n : 0;
          };
          const listQty =
            id === "mounting"
              ? Object.values(partQty).reduce((sum, value) => sum + qtyOf(value), 0)
              : id === "electrical" || id === "commercial"
                ? Object.entries(elecQty)
                    .filter(([name]) => COMMERCIAL_PART_NAMES.has(name) === (id === "commercial"))
                    .reduce((sum, [, value]) => sum + qtyOf(value), 0)
                : 0;
          const itemCount =
            listQty + bulkLines.reduce((sum, line, index) => (line.category === id ? sum + qtyOf(bulkQty[index]) : sum), 0);
          return (
            <button
              key={id}
              type="button"
              className={`${styles.soCard} ${tab === id ? styles.soCardActive : ""}`}
              onClick={() => setTab(id)}
              aria-pressed={tab === id}
            >
              <span className={styles.soCardLabel}>{label}</span>
              {serialQty > 0 ? (
                <>
                  <strong className={styles.soCardNumber}>{serialQty}</strong>
                  <span className={styles.soCardSub}>
                    {scanned} scanned
                  </span>
                </>
              ) : (
                <>
                  <strong className={styles.soCardNumber}>{isSpecial ? COMMERCIAL_PART_NAMES.size : bulkCount}</strong>
                  <span className={styles.soCardSub}>{itemCount} item count</span>
                </>
              )}
            </button>
          );
        })}
      </div>
      {loadingJob && (
        <p className={styles.note} style={{ margin: "6px 0 10px", color: "#000", fontSize: "10px" }}>
          Click on cards to view item list.
        </p>
      )}
      {/* 2. Barcode & Serial Camera Scanner (The Core User Request!) */}
      <div className={styles.scannerCard}>

        {isSerialTab && (
          <>
            <div className={styles.scannerHeader}>
              <div>
                <h2 className={styles.scannerTitle}>
                  {tx.status === "Verified" && !loaded ? (
                    "Item List"
                  ) : (
                    <>
                      <span>🔍</span> Barcode &amp; Serial Scanner for Verification
                    </>
                  )}
                </h2>
                {!(tx.status === "Verified" && !loaded) && (
                  <p className={styles.scannerHelpText}>
                    {onSitePanels
                      ? "📍 On-site Panel Check (at customer's house): open the boxes and scan each panel's serial to confirm everything arrived safely."
                      : "Scan physical barcode using live mobile camera or handheld laser gun to record each unit before installer pickup."}
                  </p>
                )}
              </div>
              {onSitePanels && siteDone && (
                <span className={`${styles.matchPill} ${styles.matchPillComplete}`}>✅ Arrived safely</span>
              )}
            </div>

            {/* Panels: by box (box barcode covers the panels inside) or one loose panel at a time */}
            {tab === "panel" && tx.status !== "Verified" && !loaded && (
              <div style={{ display: "flex", flexWrap: "wrap", gap: "10px", alignItems: "center", margin: "0 0 12px" }}>
                <div className={styles.txFilterPills} role="tablist" aria-label="Panel scan mode">
                  <button
                    type="button"
                    role="tab"
                    aria-selected={panelMode === "box"}
                    className={`${styles.txPill} ${panelMode === "box" ? styles.txPillActive : ""}`}
                    onClick={() => setPanelMode("box")}
                  >
                    📦 Box
                  </button>
                  <button
                    type="button"
                    role="tab"
                    aria-selected={panelMode === "loose"}
                    className={`${styles.txPill} ${panelMode === "loose" ? styles.txPillActive : ""}`}
                    onClick={() => setPanelMode("loose")}
                  >
                    Loose panel
                  </button>
                </div>
                {panelMode === "box" && (
                  <label style={{ display: "flex", alignItems: "center", gap: "6px", fontSize: "13px", color: "#000" }}>
                    Panels in box
                    <input
                      type="number"
                      min={1}
                      step={1}
                      inputMode="numeric"
                      value={boxSize}
                      onChange={(e) => setBoxSize(e.target.value)}
                      style={{ width: "70px", padding: "6px 8px", border: "1px solid #cbd5e1", borderRadius: "6px" }}
                    />
                  </label>
                )}
              </div>
            )}

            {/* Panel boxes: a photo of them (camera only, front or back), saved with the job as a
                record. Taken on Preparing in Box mode; shown on later stages when there is one. */}
            {tab === "panel" &&
              ((tx.status !== "Verified" && !loaded && panelMode === "box") || panelPhoto) && (
                <div style={{ margin: "0 0 12px" }}>
                  <div className={styles.bankingFieldLabel}>Panel boxes photo</div>
                  {panelCamOpen ? (
                    <PhotoCamera
                      title="Panel boxes photo"
                      onClose={() => setPanelCamOpen(false)}
                      onCapture={(photo) => {
                        setPanelCamOpen(false);
                        void savePanelPhoto(photo);
                      }}
                    />
                  ) : tx.status !== "Verified" && !loaded ? (
                    <button
                      type="button"
                      className={styles.lorryPhotoBox}
                      disabled={panelPhotoBusy}
                      onClick={() => setPanelCamOpen(true)}
                      aria-label="Take a picture of the panel boxes"
                    >
                      {panelPhoto ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={panelPhoto} alt="Panel boxes" className={styles.lorryPhotoImg} />
                      ) : (
                        <span className={styles.lorryPhotoEmpty}>
                          {panelPhotoBusy ? "Saving…" : "📷 Tap to take a picture of the panel boxes"}
                        </span>
                      )}
                    </button>
                  ) : (
                    panelPhoto && (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={panelPhoto} alt="Panel boxes" className={styles.lorryPhotoImg} />
                    )
                  )}
                  {panelPhoto && tx.status !== "Verified" && !loaded && !panelCamOpen && (
                    <p className={styles.note} style={{ margin: "4px 0 0" }}>
                      {panelPhotoBusy ? "Saving…" : "Tap the photo to take it again. The panels are still scanned below."}
                    </p>
                  )}
                  {panelPhotoError && (
                    <p className={styles.note} style={{ color: "#b91c1c", margin: "4px 0 0" }}>
                      {panelPhotoError}
                    </p>
                  )}
                </div>
              )}

            {/* Camera Viewfinder (warehouse scan, or the on-site panel check once loaded) */}
            {cameraActive && (!loaded || onSitePanels) && (
              <div className={styles.cameraViewfinder}>
                <button
                  type="button"
                  className={styles.cameraCloseBtn}
                  onClick={() => setCameraActive(false)}
                  aria-label="Close camera"
                  title="Close camera"
                >
                  ✕
                </button>
                <div className={styles.cameraScanLine} />
                <video ref={videoRef} className={styles.videoCameraActive} playsInline autoPlay muted />
                {cameraError && (
                  <div style={{ padding: "12px 14px", background: "rgba(0,0,0,0.65)", borderRadius: "6px", margin: "8px" }}>
                    <div style={{ fontSize: "22px", marginBottom: "2px" }}>📸</div>
                    <strong style={{ color: "#f87171", fontSize: "12px" }}>Camera Notice:</strong>
                    <div style={{ fontSize: "11px", color: "#e2e8f0", marginTop: "2px" }}>
                      {cameraError}
                    </div>
                  </div>
                )}
                <div style={{ padding: "8px 12px", background: "rgba(0,0,0,0.55)", borderRadius: "6px", marginTop: "6px", display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: "6px" }}>
                  <span style={{ fontSize: "11px", color: "#e2e8f0" }}>
                    🎯 Camera auto-detects barcode &amp; matches against Job #{schedule?.jobId ?? tx.reference} requirements.
                  </span>
                  <button
                    type="button"
                    className={styles.palletVerifyBtn}
                    style={{ fontSize: "11px", padding: "3px 8px" }}
                    onClick={() => handleScan(`SIM-${String(Date.now()).slice(-6)}`)}
                  >
                    ⚡ Test Camera Detect Barcode
                  </button>
                </div>
              </div>
            )}

        {/* Barcode Input Form (not once verified: panels are scanned again on site) */}
        <form
          className={styles.scannerInputRow}
          style={
            onSitePanels
              ? siteDone
                ? { display: "none" }
                : undefined
              : tx.status === "Verified" || loaded
                ? { display: "none" }
                : undefined
          }
          onSubmit={(e) => {
            e.preventDefault();
            handleScan();
          }}
        >
          <input
            ref={barcodeInputRef}
            type="text"
            className={styles.scannerInput}
            // Black outline so the scan box stands out
            style={{ border: "1.5px solid #000" }}
            placeholder={
              onSitePanels
                ? "Scan panel barcode or type its serial number..."
                : tab === "panel" && panelMode === "box"
                  ? "Scan the panel box barcode..."
                  : "Scan barcode or type unit serial number..."
            }
            value={barcodeInput}
            onChange={(e) => setBarcodeInput(e.target.value)}
          />
          <button
            type="button"
            className={styles.scannerBtnScan}
            title="Records the typed serial; with an empty box it opens the camera scanner"
            onClick={() => {
              if (barcodeInput.trim()) handleScan();
              else setCameraActive(true);
            }}
          >
            <span>⚡</span> Scan / Match
          </button>
        </form>

        {/* Real-time Scan Feedback */}
        {feedback && (
          <div
            className={`${styles.scanFeedback} ${
              feedback.type === "success"
                ? styles.scanFeedbackSuccess
                : feedback.type === "warning"
                ? styles.scanFeedbackWarning
                : styles.scanFeedbackError
            }`}
          >
            <span>{feedback.message}</span>
            <button
              type="button"
              style={{ border: 0, background: "transparent", cursor: "pointer", color: "inherit", fontWeight: 700 }}
              onClick={() => setFeedback(null)}
            >
              &times;
            </button>
          </div>
        )}

        {/* 3. Dispatch Units Item List Table (merged into the scanner box). Shown only once a
            unit (or panel box) has been scanned for this item; before that only the scan box shows. */}
        {(onSitePanels ? siteScans.length > 0 : tabScanned > 0 || (tab === "panel" && boxes.length > 0)) && (
          <>
          <hr style={{ border: 0, borderTop: "1px solid var(--line)", margin: "18px 0" }} />
          <div className={styles.skuProgressHeader}>
            <div>
              <p className={styles.itemDesc}>
                {onSitePanels
                  ? "Panels leave the warehouse by box; on site each panel is scanned one by one."
                  : "Quantities come from the invoice. Serial codes are recorded as each unit is scanned."}
              </p>
            </div>
            <div className={styles.skuOverallStats}>
              {onSitePanels ? (
                <>
                  Arrived on site: <strong>{siteScans.length}</strong> / {panelTotal} ({siteProgress}%)
                </>
              ) : (
                <>
                  Scanned: <strong>{tabScanned}</strong> / {tabRequired} ({tabProgress}%) &middot; All items: {totalScanned} / {totalRequired}
                </>
              )}
            </div>
          </div>

          {/* Visual Progress Bar (not on Loading jobs) */}
          {!(tx.status === "Verified" && !loaded) && (
          <div className={styles.progressBarContainer}>
            <div
              className={`${styles.progressBarFill} ${
                (onSitePanels ? siteProgress : tabProgress) < 100 ? styles.progressBarFillWarning : ""
              }`}
              style={{ width: `${onSitePanels ? siteProgress : tabProgress}%` }}
            />
          </div>
          )}

          {/* Scrollable Units Table */}
          <div className={styles.unitScrollTableWrap}>
            <table>
              <thead>
                <tr>
                  <th scope="col" style={{ width: "50px" }}>No.</th>
                  <th scope="col" style={{ minWidth: onSitePanels ? "170px" : "220px" }}>
                    {onSitePanels ? "Stock Out Scan" : "Serial Code"}
                  </th>
                  <th scope="col">Description / Model</th>
                  {onSitePanels && (
                    <th scope="col" style={{ minWidth: "170px" }}>
                      On-site Scan
                    </th>
                  )}
                  {!loadingJob && <th scope="col" style={{ width: "180px" }}>Match Status</th>}
                </tr>
              </thead>
              <tbody>
                {tab === "panel" &&
                  !onSitePanels &&
                  boxes.map((box, n) => (
                    <tr key={`box-${box.code}`} className={loadingJob ? undefined : styles.unitRowVerified}>
                      <td style={{ color: "var(--muted)", fontSize: "11px", fontWeight: 600 }}>📦 {n + 1}</td>
                      <td>
                        <div style={{ fontFamily: "monospace", fontWeight: 700, fontSize: "13px", letterSpacing: "0.03em" }}>
                          Box {box.code}
                        </div>
                      </td>
                      <td>
                        <strong style={{ fontSize: "13px" }}>{box.qty} panels</strong>
                      </td>
                      {!loadingJob && (
                      <td>
                        <span className={`${styles.matchPill} ${styles.matchPillComplete}`}>📦 Box scanned</span>
                        {tx.status !== "Verified" && !loaded && !viewOnly && (
                          <button
                            type="button"
                            aria-label={`Remove box ${box.code}`}
                            title="Remove this box"
                            style={{ border: "none", background: "none", cursor: "pointer", color: "#64748b", marginLeft: "6px" }}
                            onClick={() => removeBox(box.code)}
                          >
                            ✕
                          </button>
                        )}
                      </td>
                      )}
                    </tr>
                  ))}
                {tab === "panel" && boxExtra > 0 && !onSitePanels && (
                  <tr>
                    <td colSpan={loadingJob ? 3 : 4} style={{ fontSize: "12px", color: "#b45309" }}>
                      ⚠️ The boxes hold {boxExtra} more panel{boxExtra === 1 ? "" : "s"} than this job needs.
                    </td>
                  </tr>
                )}
                {siteRows.map((row, n) => (
                  <tr
                    key={`site-${row.slot.key}`}
                    className={row.site && !row.mismatch ? styles.unitRowVerified : undefined}
                  >
                    <td style={{ color: "var(--muted)", fontSize: "11px", fontWeight: 600 }}>
                      #{String(n + 1).padStart(2, "0")}
                    </td>
                    <td>
                      <div style={{ fontFamily: "monospace", fontWeight: 700, fontSize: "13px", letterSpacing: "0.03em" }}>
                        {row.slot.box ? `📦 ${row.slot.serial}` : (row.slot.serial ?? "—")}
                      </div>
                      {row.slot.box && (
                        <div style={{ fontSize: "11px", color: "var(--muted)" }}>
                          Box {row.boxNo || ""}
                          {row.boxNo ? ` · ${boxes[row.boxNo - 1]?.qty ?? ""} panels` : ""}
                        </div>
                      )}
                    </td>
                    <td>
                      <strong style={{ fontSize: "13px" }}>{row.slot.line.model}</strong>
                    </td>
                    <td>
                      <div style={{ fontFamily: "monospace", fontWeight: 700, fontSize: "13px", letterSpacing: "0.03em" }}>
                        {row.site ?? "—"}
                      </div>
                    </td>
                    <td>
                      {!row.site ? (
                        <span className={`${styles.matchPill} ${styles.matchPillPending}`}>⏳ To scan on site</span>
                      ) : row.mismatch ? (
                        <span
                          className={`${styles.matchPill} ${styles.matchPillPending}`}
                          style={{ color: "#b45309" }}
                          title="This loose panel was scanned with a different serial at the warehouse"
                        >
                          ⚠️ Different serial
                        </span>
                      ) : (
                        <span className={`${styles.matchPill} ${styles.matchPillComplete}`}>
                          {row.slot.box ? "✅ Arrived (qty matched)" : "✅ Matched"}
                        </span>
                      )}
                    </td>
                  </tr>
                ))}
                {!onSitePanels && tabSlots.filter((slot) => !slot.box).map((slot, n) => {
                  const isVerified = slot.serial !== null;
                  return (
                    <tr key={slot.key} className={isVerified && !loadingJob ? styles.unitRowVerified : undefined}>
                      <td style={{ color: "var(--muted)", fontSize: "11px", fontWeight: 600 }}>
                        {/* Numbered on from the panel boxes above, one sequence for the table */}
                        {(tab === "panel" ? boxes.length : 0) + n + 1}
                      </td>
                      <td>
                        <div style={{ fontFamily: "monospace", fontWeight: 700, fontSize: "13px", letterSpacing: "0.03em" }}>
                          {slot.serial ?? "—"}
                        </div>
                      </td>
                      <td>
                        <strong style={{ fontSize: "13px" }}>{slot.line.model}</strong>
                      </td>
                      {!loadingJob && (
                      <td>
                        {isVerified ? (
                          <span className={`${styles.matchPill} ${styles.matchPillComplete}`}>
                            ✅ Verified (Matched)
                          </span>
                        ) : (
                          <span className={`${styles.matchPill} ${styles.matchPillPending}`}>
                            ⏳ Pending Scan
                          </span>
                        )}
                      </td>
                      )}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          {/* Who prepared this item: saved when all its units were scanned */}
          <p style={{ textAlign: "right", margin: "28px 0 0", fontSize: "13px", color: "var(--green)", fontWeight: 700 }}>
            Prepared by: <strong>{preparedBy[tab] || "—"}</strong>
          </p>
          </>
        )}

          </>
        )}

        {/* Bulk materials: quantity loaded is entered, not scanned */}
        {!isSerialTab && (
          <>
            <h2 className={styles.inspectCardTitle}>
              {STOCK_OUT_TABS.find(([id]) => id === tab)?.[1]} for this customer
            </h2>
            {tab !== "mounting" && tab !== "commercial" && (
              <p className={styles.itemDesc}>
                The invoice does not set these quantities. Enter how many are loaded for each item (0 if none).
              </p>
            )}
            {tab === "mounting" && (
              <div className={styles.mountPanel}>
                <p className={styles.itemDesc}>
                  Count the runs of panels on the PV drawing (a run is a column or row of panels sharing one pair of rails).
                  Hover over (or tap) a Qty box to see the suggested quantity in grey, and press Enter to use it.
                  Suggestions come from the staff's MIBET record; the warehouse confirms each quantity.
                </p>
                <div className={styles.mountForm}>
                  <label className={styles.bankingFieldLabel}>
                    System
                    <select
                      className={styles.bankingAccountSelect}
                      value={mountSystem}
                      onChange={(e) => setMountSystem(e.target.value as MountingSystemId)}
                    >
                      <option value="mibet">MIBET</option>
                      <option value="winstar">WINSTAR</option>
                    </select>
                  </label>
                  <label className={styles.bankingFieldLabel}>
                    Roof
                    <select
                      className={styles.bankingAccountSelect}
                      value={mountRoof}
                      onChange={(e) => setMountRoof(e.target.value as RoofType)}
                    >
                      {ROOF_OPTIONS.map(([id, label]) => (
                        <option key={id} value={id}>
                          {label}
                        </option>
                      ))}
                    </select>
                  </label>
                  {mountRoof === "flat" && (
                    <label className={styles.bankingFieldLabel}>
                      Orientation
                      <select
                        className={styles.bankingAccountSelect}
                        value={mountOrientation}
                        onChange={(e) => setMountOrientation(e.target.value as Orientation)}
                      >
                        <option value="portrait">Portrait</option>
                        <option value="landscape">Landscape</option>
                      </select>
                    </label>
                  )}
                  <label className={styles.bankingFieldLabel}>
                    Runs of panels (each on its own pair of rails)
                    <input
                      type="number"
                      min="1"
                      inputMode="numeric"
                      value={mountRows}
                      onChange={(e) => setMountRows(e.target.value)}
                      className={`${styles.scannerInput} ${styles.transferField}`}
                      style={{ minWidth: 0, height: "42px" }}
                    />
                  </label>
                </div>
                <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: "8px", margin: "0 0 8px" }}>
                <p className={styles.itemDesc}>
                  Panels on this job: <strong>{panelCount}</strong>
                </p>
                </div>
                <div className={styles.txFilterPills} role="tablist" aria-label="Mounting group" style={{ marginBottom: "10px" }}>
                  {mountTabs.map((mt) => (
                    <button
                      key={mt.key}
                      type="button"
                      role="tab"
                      aria-selected={mountGroup === mt.key}
                      className={`${styles.txPill} ${mountGroup === mt.key ? styles.txPillActive : ""}`}
                      onClick={() => setMountGroup(mt.key)}
                    >
                      {mt.label}
                    </button>
                  ))}
                </div>
                <div className={styles.tableWrap}>
                  <table className={`${styles.detailTable} ${styles.mountTable}`}>
                    <thead>
                      <tr>
                        <th scope="col">Part</th>
                        <th scope="col" className={styles.qtyCenter}>Qty</th>
                      </tr>
                    </thead>
                    <tbody>
                      {(MOUNTING_SYSTEMS.find((system) => system.id === mountSystem)?.groups ?? [])
                        .filter((group) => mountTabGroups.includes(group.label))
                        .map((group) => (
                        <Fragment key={group.label}>
                          {/* Combined tab: a heading row for each group (Hook & Bracket, Clamp) */}
                          {mountTabGroups.length > 1 && (
                            <tr>
                              <th scope="colgroup" colSpan={2} style={{ textAlign: "left" }}>
                                {group.label}
                              </th>
                            </tr>
                          )}
                          {group.parts.map((part) => (
                            <tr key={part.name}>
                              <td>{part.name}</td>
                              <td className={styles.qtyCenter}>
                                <input
                                  type="number"
                                  min="0"
                                  inputMode="numeric"
                                  aria-label={`Quantity loaded for ${part.name}`}
                                  title={
                                    mountEstimate.parts[part.name] !== undefined
                                      ? `Suggested ${mountEstimate.parts[part.name]}. Press Enter to use it.`
                                      : undefined
                                  }
                                  placeholder={
                                    mountEstimate.parts[part.name] !== undefined ? String(mountEstimate.parts[part.name]) : ""
                                  }
                                  value={partQty[part.name] ?? ""}
                                  onChange={(e) => setPartQty((prev) => ({ ...prev, [part.name]: e.target.value }))}
                                  onKeyDown={(e) => {
                                    // Enter on an empty box accepts the grey suggestion.
                                    const suggested = mountEstimate.parts[part.name];
                                    if (e.key === "Enter" && suggested !== undefined && (partQty[part.name] ?? "").trim() === "") {
                                      e.preventDefault();
                                      setPartQty((prev) => ({ ...prev, [part.name]: String(suggested) }));
                                    }
                                  }}
                                  className={`${styles.scannerInput} ${styles.transferField} ${styles.mountQtyInput}`}
                                  style={{ width: "80px", minWidth: 0, height: "34px", flex: "none" }}
                                />
                              </td>
                            </tr>
                          ))}
                        </Fragment>
                      ))}
                    </tbody>
                  </table>
                </div>
                {/* How many boxes the mounting structure goes out in (one figure for the job) */}
                <div style={{ display: "flex", alignItems: "center", justifyContent: "flex-end", gap: "8px", marginTop: "14px" }}>
                  <label htmlFor="mount-box-qty" style={{ fontSize: "13px", fontWeight: 700, color: "#000" }}>
                    Box Qty
                  </label>
                  <input
                    id="mount-box-qty"
                    type="number"
                    min="0"
                    inputMode="numeric"
                    value={mountBoxQty}
                    onChange={(e) => setMountBoxQty(e.target.value)}
                    className={`${styles.scannerInput} ${styles.transferField} ${styles.mountQtyInput}`}
                    style={{ width: "80px", minWidth: 0, height: "34px", flex: "none" }}
                  />
                </div>
                {/* Who packed this mounting tab (Rail, or Hook, Bracket & Clamp) */}
                {mountTabMaterial && (
                  <p style={{ textAlign: "right", margin: "28px 0 0", fontSize: "13px", color: "var(--green)", fontWeight: 700 }}>
                    Packed by: <strong>{preparedBy[mountTabMaterial] || "—"}</strong>
                  </p>
                )}
              </div>
            )}
            {tab === "electrical" && (
              <div className={styles.mountPanel}>
                <p className={styles.itemDesc}>Enter the quantity of each electrical item loaded for this job.</p>
                <div className={styles.txFilterPills} role="tablist" aria-label="Electrical group" style={{ marginBottom: "10px" }}>
                  {ELECTRICAL_GROUPS.map((group) => (
                    <button
                      key={group.label}
                      type="button"
                      role="tab"
                      aria-selected={elecGroup === group.label}
                      className={`${styles.txPill} ${elecGroup === group.label ? styles.txPillActive : ""}`}
                      onClick={() => setElecGroup(group.label)}
                    >
                      {group.label}
                    </button>
                  ))}
                </div>
                <div className={styles.tableWrap}>
                  <table className={`${styles.detailTable} ${styles.mountTable}`}>
                    <thead>
                      <tr>
                        <th scope="col">Item</th>
                        <th scope="col" className={styles.qtyCenter}>Qty</th>
                      </tr>
                    </thead>
                    <tbody>
                      {ELECTRICAL_GROUPS.filter((group) => group.label === elecGroup).map((group) => (
                        <Fragment key={group.label}>
                          {group.parts.map((name) => (
                            <tr key={name}>
                              <td>{name}</td>
                              <td className={styles.qtyCenter}>
                                <input
                                  type="number"
                                  min="0"
                                  inputMode="numeric"
                                  aria-label={`Quantity loaded for ${name}`}
                                  value={elecQty[name] ?? ""}
                                  onChange={(e) => setElecQty((prev) => ({ ...prev, [name]: e.target.value }))}
                                  className={`${styles.scannerInput} ${styles.transferField} ${styles.mountQtyInput}`}
                                />
                              </td>
                            </tr>
                          ))}
                        </Fragment>
                      ))}
                    </tbody>
                  </table>
                </div>
                {/* How many boxes the electrical items go out in (one figure for the job) */}
                <div style={{ display: "flex", alignItems: "center", justifyContent: "flex-end", gap: "8px", marginTop: "14px" }}>
                  <label htmlFor="elec-box-qty" style={{ fontSize: "13px", fontWeight: 700, color: "#000" }}>
                    Box Qty
                  </label>
                  <input
                    id="elec-box-qty"
                    type="number"
                    min="0"
                    inputMode="numeric"
                    value={elecBoxQty}
                    onChange={(e) => setElecBoxQty(e.target.value)}
                    className={`${styles.scannerInput} ${styles.transferField} ${styles.mountQtyInput}`}
                    style={{ width: "80px", minWidth: 0, height: "34px", flex: "none" }}
                  />
                </div>
                {/* Who prepared the electrical items: saved when their quantities were entered */}
                <p style={{ textAlign: "right", margin: "28px 0 0", fontSize: "13px", color: "var(--green)", fontWeight: 700 }}>
                  Prepared by: <strong>{preparedBy.electrical || "—"}</strong>
                </p>
              </div>
            )}
            {tab === "commercial" && (
              <div className={styles.mountPanel}>
                <p className={styles.itemDesc}>Commercial job: enter the quantity of each special material loaded.</p>
                <div className={styles.txFilterPills} role="tablist" aria-label="Special material group" style={{ marginBottom: "10px" }}>
                  {COMMERCIAL_GROUPS.map((group) => (
                    <button
                      key={group.label}
                      type="button"
                      role="tab"
                      aria-selected={commGroup === group.label}
                      className={`${styles.txPill} ${commGroup === group.label ? styles.txPillActive : ""}`}
                      onClick={() => setCommGroup(group.label)}
                    >
                      {group.label}
                    </button>
                  ))}
                </div>
                <div className={styles.tableWrap}>
                  <table className={`${styles.detailTable} ${styles.mountTable}`}>
                    <thead>
                      <tr>
                        <th scope="col">Item</th>
                        <th scope="col" className={styles.qtyCenter}>Qty</th>
                      </tr>
                    </thead>
                    <tbody>
                      {COMMERCIAL_GROUPS.filter((group) => group.label === commGroup).map((group) => (
                        <Fragment key={group.label}>
                          {group.parts.map((name) => (
                            <tr key={name}>
                              <td>{name}</td>
                              <td className={styles.qtyCenter}>
                                <input
                                  type="number"
                                  min="0"
                                  inputMode="numeric"
                                  aria-label={`Quantity loaded for ${name}`}
                                  value={elecQty[name] ?? ""}
                                  onChange={(e) => setElecQty((prev) => ({ ...prev, [name]: e.target.value }))}
                                  className={`${styles.scannerInput} ${styles.transferField} ${styles.mountQtyInput}`}
                                />
                              </td>
                            </tr>
                          ))}
                        </Fragment>
                      ))}
                    </tbody>
                  </table>
                </div>
                {/* Who prepared the special materials: saved when their quantities were entered */}
                <p style={{ textAlign: "right", margin: "28px 0 0", fontSize: "13px", color: "var(--green)", fontWeight: 700 }}>
                  Prepared by: <strong>{preparedBy.commercial || "—"}</strong>
                </p>
              </div>
            )}
            {tab !== "mounting" && tab !== "commercial" && tab !== "electrical" && bulkLines.filter((line) => line.category === tab).length === 0 && (
              <p className={styles.note}>Nothing in this group on the invoice.</p>
            )}
            <div className={styles.inspectChecklist}>
              {bulkLines.map((line, i) =>
                line.category !== tab || tab === "mounting" ? null : (
                <div key={line.model} className={styles.inspectCheckItem}>
                  <span style={{ flex: 1 }}>{line.model}</span>
                  <input
                    type="number"
                    min="0"
                    inputMode="numeric"
                    placeholder="Qty"
                    aria-label={`Quantity loaded for ${line.model}`}
                    value={bulkQty[i] ?? ""}
                    onChange={(e) => setBulkQty((prev) => ({ ...prev, [i]: e.target.value }))}
                    className={`${styles.scannerInput} ${styles.transferField}`}
                    style={{ width: "90px", minWidth: 0, height: "36px", flex: "none" }}
                  />
                </div>
                ),
              )}
            </div>
          </>
        )}
      </div>

      {/* No Transport & Driver Details here: the driver and plate come from the Delivery
          Schedule (or the lorry), and the lorry photos are taken on the Loading page. */}

      {/* 5. Footer Action Bar */}
      <div className={styles.inspectFooterBar}>
        <p className={`${styles.note} ${styles.footerTip}`}>
          💡 <strong>Warehouse Tip:</strong> Scan physical barcodes of panels / inverters loaded onto installer lorry to register serial numbers for Job #{schedule?.jobId ?? tx.reference}. When all {totalRequired} units reach 100%, the <strong>Submit</strong> button unlocks.
        </p>
        {/* One button for the tab the job is on: To Verify → Verified; Verified → Loading
            (moves the job to the Loading tab, saved with who pressed it); Loading → a greyed
            "Loaded" label. */}
        <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: "8px" }}>
        {/* Site Check: who checked the panels on site, above Submit */}
        {tx.status === "Verified" && loaded && (
          <p style={{ margin: 0, fontSize: "13px", color: "var(--green)", fontWeight: 700 }}>
            Checked on site by: <strong>{preparedBy.arrived || "—"}</strong>
          </p>
        )}
        <div className={styles.inspectActionGroup}>
          {tx.status !== "Verified" ? (
            viewOnly ? null : (
            <button
              className={`${styles.btnActionPrimary} ${
                isAllVerified ? styles.btnVerifiedGlow : styles.btnVerifiedLocked
              }`}
              type="button"
              disabled={!isAllVerified}
              onClick={() => {
                // Submit on Preparing: the job is verified and moves to Loading.
                void onRecord("job");
                onUpdateStatus("Verified");
                onBack();
              }}
              title="All items scanned and verified: moves the job to Loading"
            >
              {isAllVerified
                ? "✓ Submit"
                : "🔒 Submit"}
            </button>
            )
          ) : !loaded ? (
            // Verified (not yet loaded): no Submit here. The job is on Loading › Preparing, and
            // is submitted there with its lorry (after the lorry photos).
            null
          ) : siteVerified ? (
            // Loading Verification, done: greyed.
            <button className={`${styles.btnActionPrimary} ${styles.btnVerifiedLocked}`} type="button" disabled title="Arrived safely">
              ✓ Submitted
            </button>
          ) : (
            // Loading Verification: Verified unlocks once every panel is scanned on site (jobs
            // without panels can be verified straight away); pressing it moves the job to Site Check.
            <button
              className={`${styles.btnActionPrimary} ${
                siteDone || panelTotal === 0 ? styles.btnVerifiedGlow : styles.btnVerifiedLocked
              }`}
              type="button"
              disabled={!(siteDone || panelTotal === 0)}
              onClick={() => {
                setArrivedNow(true);
                onRecord("arrived");
                onBack();
              }}
              title="All panels scanned on site: confirm the delivery arrived safely"
            >
              {siteDone || panelTotal === 0
                ? "✓ Submit"
                : "🔒 Submit"}
            </button>
          )}
        </div>
        </div>
      </div>

      {/* PV drawing viewer */}
      {sldOpen && (
        <div className={styles.bankingReceiptBackdrop} onClick={() => setSldOpen(false)}>
          <div
            className={styles.transferReportCard}
            style={{ maxWidth: "960px" }}
            role="dialog"
            aria-modal="true"
            aria-label="PV drawing"
            onClick={(e) => e.stopPropagation()}
          >
            <div className={styles.transferReportHead}>
              <h2 className={styles.bankingCardTitle}>PV Drawing</h2>
              <div style={{ display: "flex", gap: "8px" }}>
                {currentDrawing && (
                  <a className={styles.btnActionGhost} href={currentDrawing} target="_blank" rel="noopener noreferrer">
                    Open in new tab
                  </a>
                )}
                <button type="button" className={styles.btnActionGhost} onClick={() => setSldOpen(false)}>
                  Close
                </button>
              </div>
            </div>
            {drawingsLoading && <p className={styles.note}>Loading drawings…</p>}
            {drawingsError && <p className={styles.note}>{drawingsError}</p>}
            {drawings && drawings.length === 0 && (
              <p className={styles.note}>
                No drawing found for this job.{drawingsInfo ? ` (PV system drawing field: ${drawingsInfo}.)` : ""}
              </p>
            )}
            {drawings && drawings.length === 1 && <p className={styles.itemDesc}>{drawings[0].label}</p>}
            {drawings && drawings.length > 1 && (
              <div className={styles.txFilterPills} role="tablist" aria-label="Drawings" style={{ marginBottom: "10px" }}>
                {drawings.map((item, i) => (
                  <button
                    key={item.url}
                    type="button"
                    role="tab"
                    aria-selected={drawingIdx === i}
                    className={`${styles.txPill} ${drawingIdx === i ? styles.txPillActive : ""}`}
                    onClick={() => setDrawingIdx(i)}
                  >
                    {pvPicked[item.url] === "1" ? "✓ " : ""}
                    {item.label}
                  </button>
                ))}
              </div>
            )}
            {currentDrawing && (
              <label style={{ display: "flex", alignItems: "center", gap: "8px", margin: "0 0 10px", fontWeight: 600 }}>
                <input
                  type="checkbox"
                  checked={pvPicked[currentDrawing] === "1"}
                  onChange={(e) => setPvPicked((prev) => ({ ...prev, [currentDrawing]: e.target.checked ? "1" : "0" }))}
                />
                Use this drawing on the report
              </label>
            )}
            {currentDrawing &&
              (currentIsPdf ? (
                <iframe
                  title="PV drawing"
                  src={currentDrawing}
                  referrerPolicy="no-referrer"
                  style={{ width: "100%", height: "70vh", border: "1px solid var(--line)", borderRadius: "8px" }}
                />
              ) : (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={currentDrawing}
                  alt="PV drawing"
                  referrerPolicy="no-referrer"
                  style={{ width: "100%", height: "auto", borderRadius: "8px" }}
                />
              ))}
          </div>
        </div>
      )}

      {/* Dispatch Report (job summary and the Scheduling System Record) */}
      {doOpen && (
        <DeliveryOrderDialog
          schedule={schedule}
          reference={tx.reference}
          lines={lines}
          partQty={partQty}
          elecQty={elecQty}
          onClose={() => setDoOpen(false)}
        />
      )}
      {reportOpen && (
        <div className={styles.bankingReceiptBackdrop} onClick={() => setReportOpen(false)}>
          <div
            className={`${styles.transferReportCard} ${styles.a4Report}`}
            role="dialog"
            aria-modal="true"
            aria-label="Dispatch report"
            onClick={(e) => e.stopPropagation()}
          >
            <div className={styles.transferReportHead}>
              <div style={{ display: "flex", gap: "8px", marginLeft: "auto" }}>
                {/* Stock Out Verification report: always one A4 page */}
                <DownloadReportButton fileName={reportFileName("Dispatch-Report", schedule?.jobId ?? tx.reference)} onePage />
                <button type="button" className={styles.btnActionGhost} onClick={() => setReportOpen(false)}>
                  Close
                </button>
              </div>
            </div>
            {/* Logo on the left, "Report" on the right: same as the Stock Out report */}
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "40px", margin: "0 0 28px" }}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={`${typeof window !== "undefined" ? window.location.origin : ""}${LOGO_SRC}`}
                alt="Eternalgy"
                width={1332}
                height={176}
                style={{ display: "block", height: "24px", width: "auto", flex: "none" }}
              />
              <span style={{ fontSize: "20px", fontWeight: 700, color: "#000" }}>Report</span>
            </div>
            <div style={{ marginTop: "16px" }}>{renderSchedulingRecord(true)}</div>
            {/* PV drawing, attached below the customer details */}
            <div style={{ marginTop: "8px" }}>
              <div style={{ fontWeight: 700, color: "#000", marginBottom: "8px" }}>PV Drawing</div>
              {drawingsLoading && <p className={styles.note}>Loading drawing…</p>}
              {drawingsError && <p className={styles.note}>{drawingsError}</p>}
              {drawings && drawings.length === 0 && <p className={styles.note}>No PV drawing found for this job.</p>}
              {drawings && drawings.length > 0 && !drawings.some((item) => pvPicked[item.url] === "1") && (
                <p className={styles.note}>No drawing selected. Open PV Drawing and tick the one to use.</p>
              )}
              {/* Shown as a picture (PDF: its first page) so the downloaded report includes it */}
              {drawings?.filter((item) => pvPicked[item.url] === "1").map((item) => (
                <PvDrawingImage key={item.url} jobSourceId={jobSourceId} url={item.url} label={item.label} />
              ))}
            </div>
            {/* Mounting structure items, as a table */}
            <div style={{ marginTop: "8px" }}>
              <div style={{ fontWeight: 700, color: "#000", marginBottom: "8px" }}>Mounting Structure</div>
              {(() => {
                // Same two-block arrangement as the electrical table: Rail and Hook & Bracket on the
                // left, the remaining group (Clamp) on the right.
                type Cell = { text: string; head: boolean };
                const groups = MOUNTING_SYSTEMS.find((system) => system.id === mountSystem)?.groups ?? [];
                const flat = (list: typeof groups): Cell[] =>
                  list.flatMap((group) => [
                    { text: group.label, head: true },
                    ...group.parts.map((part) => ({ text: part.name, head: false })),
                  ]);
                const left = flat(groups.slice(0, 2));
                const right = flat(groups.slice(2));
                const rows = Math.max(left.length, right.length);
                const border = "1px solid #000";
                const cell = (c: Cell | undefined, key: string) => [
                  <td
                    key={`${key}t`}
                    style={{ border, fontWeight: c?.head ? 700 : 400, textTransform: c?.head ? "uppercase" : "none" }}
                  >
                    {c?.text ?? ""}
                  </td>,
                  <td key={`${key}q`} className={styles.num} style={{ border }}>
                    {c && !c.head ? (partQty[c.text] ?? "").trim() : ""}
                  </td>,
                ];
                return (
                  <table style={{ border: "1px solid #000" }}>
                    <tbody>
                      {Array.from({ length: rows }, (_, n) => (
                        <tr key={n}>
                          {cell(left[n], "l")}
                          {cell(right[n], "r")}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                );
              })()}
            </div>
            {/* Electrical accessories, as a table */}
            <div style={{ marginTop: "8px" }}>
              <div style={{ fontWeight: 700, color: "#000", marginBottom: "8px" }}>Electrical Item</div>
              {(() => {
                // Two side-by-side blocks, as on the staff sheet: Breaker / PV Meter / DB Box / SPD on the
                // left; Ballast / EV Charger / Battery / Selco Meter / EV Charger Breaker on the right.
                type Cell = { text: string; head: boolean; title?: boolean };
                const flat = (groups: typeof ELECTRICAL_GROUPS): Cell[] =>
                  groups.flatMap((group) => [
                    { text: group.label, head: true },
                    ...group.parts.map((name) => ({ text: name, head: false })),
                  ]);
                const left: Cell[] = [{ text: "Electric Item", head: true, title: true }, ...flat(ELECTRICAL_GROUPS.slice(0, 4))];
                const right: Cell[] = flat(ELECTRICAL_GROUPS.slice(4));
                const rows = Math.max(left.length, right.length);
                const border = "1px solid #000";
                const cell = (c: Cell | undefined, key: string) => [
                  <td
                    key={`${key}t`}
                    style={{
                      border,
                      fontWeight: c?.head ? 700 : 400,
                      textTransform: c?.head ? "uppercase" : "none",
                      textDecoration: c?.title ? "underline" : "none",
                    }}
                  >
                    {c?.text ?? ""}
                  </td>,
                  <td key={`${key}q`} className={styles.num} style={{ border }}>
                    {c && !c.head ? (elecQty[c.text] ?? "").trim() : ""}
                  </td>,
                ];
                return (
                  <table style={{ border: "1px solid #000" }}>
                    <tbody>
                      {Array.from({ length: rows }, (_, n) => (
                        <tr key={n}>
                          {cell(left[n], "l")}
                          {cell(right[n], "r")}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                );
              })()}
            </div>
            {/* Commercial jobs: the special materials, as a table */}
            {schedule?.commercial && (
              <div style={{ marginTop: "8px" }}>
                <div style={{ fontWeight: 700, color: "#000", marginBottom: "8px" }}>Commercial Special Materials</div>
                <table style={{ border: "1px solid #000" }}>
                  <tbody>
                    {COMMERCIAL_GROUPS.flatMap((group) => [
                      <tr key={`h-${group.label}`}>
                        <td colSpan={2} style={{ border: "1px solid #000", fontWeight: 700, textTransform: "uppercase" }}>
                          {group.label}
                        </td>
                      </tr>,
                      ...group.parts.map((name) => (
                        <tr key={name}>
                          <td style={{ border: "1px solid #000" }}>{name}</td>
                          <td className={styles.num} style={{ border: "1px solid #000" }}>
                            {(elecQty[name] ?? "").trim()}
                          </td>
                        </tr>
                      )),
                    ])}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      )}
    </section>
  );
}

// ---------------------------------------------------------------------------
// Stock Transfer Verification Page — Inter-Warehouse Dispatch & Receipt
// ---------------------------------------------------------------------------

function StockTransferVerificationPage({
  tx,
  onBack,
  onUpdateStatus,
  onRecord,
  loaded,
  viewOnly = false,
}: {
  tx: StockTransaction;
  onBack: () => void;
  onUpdateStatus: (newStatus: StockTransactionStatus, remark?: string) => void;
  // Loading: the transfer was moved to the other warehouse (Stock Transfer's Loading tab).
  onRecord: (material: VerificationMaterial) => void | Promise<boolean>;
  loaded: boolean;
  // Loading access: look only, no buttons.
  viewOnly?: boolean;
}) {
  const transfer = tx.transfer;

  // Interactive warehouse route state (defaulting to tx.transfer or tx.warehouse)
  const fromWh: "JB" | "KL" = (transfer?.fromWarehouse as "JB" | "KL") ?? (tx.warehouse === "KL" ? "KL" : "JB");
  const toWh: "JB" | "KL" = (transfer?.toWarehouse as "JB" | "KL") ?? (fromWh === "JB" ? "KL" : "JB");

  // Generate transfer units based on current route
  const transferUnits = useMemo(() => {
    return generateStockTransferSerialList({
      ...tx,
      warehouse: fromWh,
      transfer: {
        ...(tx.transfer ?? {
          transferNo: tx.reference,
          dispatchedQty: tx.qty,
          receivedQty: tx.qty,
          requestedBy: "Ops Admin",
        }),
        fromWarehouse: fromWh,
        toWarehouse: toWh,
      },
    });
  }, [tx, fromWh, toWh]);

  // Set of verified unique serial numbers
  const [verifiedSerials, setVerifiedSerials] = useState<Set<string>>(() => {
    const initial = new Set<string>();
    if (tx.status === "Verified") {
      transferUnits.forEach((u) => initial.add(u.serialNo));
    }
    return initial;
  });

  const [reportOpen, setReportOpen] = useState(false);
  const driverName = transfer?.driverName ?? "";
  const vehiclePlate = transfer?.vehiclePlate ?? "";
  const [lorryPhoto, setLorryPhoto] = useState<string | null>(null);
  const [barcodeInput, setBarcodeInput] = useState("");
  const [cameraActive, setCameraActive] = useState(false);
  const [cameraError, setCameraError] = useState<string | null>(null);
  const videoRef = useRef<HTMLVideoElement>(null);

  // Excel Transfer Manifest Modal state
  const [excelModalOpen, setExcelModalOpen] = useState(false);
  const [excelSearch, setExcelSearch] = useState("");
  const [selectedExcelCell, setSelectedExcelCell] = useState<{ coord: string; val: string }>({
    coord: "A1",
    val: transfer?.transferNo ?? tx.reference,
  });

  const [feedback, setFeedback] = useState<{
    type: "success" | "warning" | "error";
    message: string;
  } | null>(null);

  const [checklist, setChecklist] = useState({
    condition: false,
    serialMatch: false,
    lorryLoaded: false,
    handoverSigned: false,
  });

  const barcodeInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    // Ready for the laser gun on a computer. Not on phones / tablets: focusing the box there
    // pops up the keyboard and makes iPhones zoom in on the page.
    if (window.matchMedia("(pointer: fine)").matches) barcodeInputRef.current?.focus();
  }, []);

  // Camera video stream & live BarcodeDetector hook
  useEffect(() => {
    let stream: MediaStream | null = null;
    let detectorTimer: NodeJS.Timeout | null = null;
    // Set when the camera is closed (or the page re-renders) before the camera has started,
    // so a stream that arrives late is stopped instead of keeping the camera busy.
    let cancelled = false;

    if (cameraActive) {
      if (typeof navigator !== "undefined" && typeof navigator.mediaDevices?.getUserMedia === "function") {
        openCameraStream()
          .then((s) => {
            if (cancelled) {
              s.getTracks().forEach((t) => t.stop());
              return;
            }
            stream = s;
            if (videoRef.current) {
              videoRef.current.srcObject = s;
              videoRef.current.play().catch(() => {});
            }
            setCameraError(null);

            if (typeof window !== "undefined" && "BarcodeDetector" in window) {
              try {
                // @ts-expect-error - standard browser BarcodeDetector API
                const detector = new window.BarcodeDetector({ formats: ["code_128", "qr_code", "ean_13", "data_matrix"] });
                detectorTimer = setInterval(async () => {
                  if (videoRef.current && videoRef.current.readyState >= 2) {
                    try {
                      const barcodes = await detector.detect(videoRef.current);
                      if (barcodes && barcodes.length > 0 && barcodes[0].rawValue) {
                        handleScan(barcodes[0].rawValue);
                      }
                    } catch {}
                  }
                }, 400);
              } catch {}
            }
          })
          .catch((err) => {
            if (!cancelled) setCameraError(cameraErrorMessage(err));
          });
      } else {
        setCameraError(cameraErrorMessage(null));
      }
    } else {
      if (videoRef.current && videoRef.current.srcObject) {
        const tracks = (videoRef.current.srcObject as MediaStream).getTracks();
        tracks.forEach((t) => t.stop());
        videoRef.current.srcObject = null;
      }
    }

    return () => {
      cancelled = true;
      if (detectorTimer) clearInterval(detectorTimer);
      if (stream) {
        stream.getTracks().forEach((t) => t.stop());
      }
    };
  }, [cameraActive]);

  const totalRequired = transferUnits.length;
  const totalScanned = verifiedSerials.size;
  const progressPercent = totalRequired > 0 ? Math.min(100, Math.round((totalScanned / totalRequired) * 100)) : 0;
  const isAllVerified = totalRequired > 0 && totalScanned >= totalRequired;

  // Power metrics
  const targetTotalPowerWatts = transferUnits.reduce((sum, u) => sum + u.powerWatts, 0);

  // Scan handler
  function handleScan(codeToTest?: string) {
    const code = (codeToTest ?? barcodeInput).trim();
    if (!code) return;

    // Match against transfer units
    const matchedUnit = transferUnits.find(
      (u) => u.serialNo.toLowerCase() === code.toLowerCase()
    );

    if (matchedUnit) {
      if (verifiedSerials.has(matchedUnit.serialNo)) {
        setFeedback({
          type: "warning",
          message: `⚠️ Duplicate Scan: S/N ${matchedUnit.serialNo} was already recorded for this transfer!`,
        });
        setBarcodeInput("");
        return;
      }

      setVerifiedSerials((prev) => {
        const next = new Set(prev);
        next.add(matchedUnit.serialNo);
        return next;
      });

      const newTotal = verifiedSerials.size + 1;
      setFeedback({
        type: "success",
        message: `✅ Matched Transfer Unit #${matchedUnit.unitIndex}: ${matchedUnit.serialNo} (${matchedUnit.powerRating}) recorded for Transfer ${transfer?.transferNo ?? tx.reference}! (${newTotal}/${totalRequired})`,
      });
      setBarcodeInput("");
      return;
    }

    // Match by model code fallback: picks next unverified unit
    if (code.toLowerCase() === tx.model.toLowerCase()) {
      const nextUnverified = transferUnits.find((u) => !verifiedSerials.has(u.serialNo));
      if (!nextUnverified) {
        setFeedback({
          type: "warning",
          message: `⚠️ All ${totalRequired} units for ${tx.model} are already verified for transfer!`,
        });
        setBarcodeInput("");
        return;
      }

      setVerifiedSerials((prev) => {
        const next = new Set(prev);
        next.add(nextUnverified.serialNo);
        return next;
      });

      const newTotal = verifiedSerials.size + 1;
      setFeedback({
        type: "success",
        message: `✅ Model matched: Registered Unit #${nextUnverified.unitIndex} (${nextUnverified.serialNo}) for transfer. (${newTotal}/${totalRequired})`,
      });
      setBarcodeInput("");
      return;
    }

    // Unrecognized barcode
    setFeedback({
      type: "error",
      message: `❌ Unrecognized Barcode: "${code}" does not match allocated inventory on Transfer ${transfer?.transferNo ?? tx.reference}!`,
    });
    setBarcodeInput("");
  }

  // Filtered Excel units
  const filteredExcelUnits = useMemo(() => {
    if (!excelSearch.trim()) return transferUnits;
    const q = excelSearch.toLowerCase();
    return transferUnits.filter(
      (u) =>
        u.serialNo.toLowerCase().includes(q) ||
        u.model.toLowerCase().includes(q) ||
        u.palletBarcode.toLowerCase().includes(q)
    );
  }, [transferUnits, excelSearch]);

  const fromLabel = fromWh === "JB" ? "Johor Bahru (JB)" : "Kuala Lumpur (KL)";
  const toLabel = toWh === "JB" ? "Johor Bahru (JB)" : "Kuala Lumpur (KL)";

  return (
    <section className={styles.screen} aria-labelledby="stocktransfer-verify-title">
      {/* Top Navigation */}
      <div className={styles.inspectTopBar}>
        <button className={styles.back} type="button" onClick={onBack} style={{ marginBottom: 0 }}>
          Back
        </button>
        <button type="button" className={styles.btnActionGhost} onClick={() => setReportOpen(true)}>
          Report
        </button>
      </div>

      {/* Hero Overview Card */}
      <div className={styles.inspectHeroCard}>
        <div style={{ flex: 1 }}>
          <div style={{ display: "flex", gap: "8px", alignItems: "center", marginBottom: "8px", flexWrap: "wrap" }}>
            <span className={`${styles.txBadge} ${styles.txTransfer}`}>🔄 STOCK TRANSFER</span>
            <span className={catClass(tx.category)}>{CAT_LABEL[tx.category] ?? tx.category}</span>
            <span className={styles.txRouteBadge}>
              <span>{fromWh}</span>
              <span className={styles.txRouteArrow}>➔</span>
              <span>{toWh}</span>
            </span>
            <div className={styles.deliveryEtaBadge}>
              <span>📅</span>
              <span><strong>Dispatch / Arrival:</strong> {transfer?.dispatchedDate ?? tx.time}</span>
            </div>
          </div>

          <h1 id="stocktransfer-verify-title" className={styles.inspectHeroTitle}>
            Stock Transfer Verification &amp; Manifest &middot; Ref #{transfer?.transferNo ?? tx.reference}
          </h1>
        </div>

        <div style={{ textAlign: "right" }}>
          <span className={styles.inspectDataLabel}>Transfer Quantity</span>
          <div className={`${styles.inspectQtyBig} ${styles.txQtyTransfer}`}>
            🔄 {totalRequired} {tx.category === "panel" ? "panels" : "units"}
          </div>
          <small style={{ color: "var(--muted)", fontSize: "11px" }}>
            Model: {tx.model}
          </small>
        </div>
      </div>

      {/* 1. Inter-Warehouse Transfer Manifest Record (Full-Width Card) */}
      <div className={styles.inspectCard} style={{ marginBottom: "16px" }}>
        <div className={styles.inspectCardHeader} style={{ alignItems: "flex-start", flexWrap: "wrap", gap: "10px" }}>
          <div style={{ flex: 1, minWidth: "300px" }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "8px", flexWrap: "wrap", gap: "8px" }}>
              <h2 className={styles.inspectCardTitle} style={{ margin: 0, color: "#000000" }}>
                <span>🚚</span> Inter-Warehouse Transfer Manifest &middot; #{transfer?.transferNo ?? tx.reference}
              </h2>
              <span className={`${styles.tag} ${styles.ok}`}>Live Inter-Warehouse Network</span>
            </div>

            {/* Route & Transport Logistics Info */}
            <div style={{ fontSize: "13px", color: "#000000", padding: "12px 14px", background: "#f8fafc", borderRadius: "8px", border: "1px solid var(--line)", marginTop: "6px", display: "flex", justifyContent: "space-between", alignItems: "flex-start", flexWrap: "wrap", gap: "12px" }}>
              <div style={{ display: "grid", gridTemplateColumns: "max-content max-content 1fr", columnGap: "6px", rowGap: "4px", color: "#000000" }}>
                <div style={{ display: "contents" }}>
                  <span style={{ color: "#000000", fontWeight: 700 }}>Route</span>
                  <span style={{ color: "#000000", fontWeight: 700 }}>:</span>
                  <span>{fromLabel} ➔ {toLabel}</span>
                </div>
                <div style={{ display: "contents" }}>
                  <span style={{ color: "#000000", fontWeight: 700 }}>Transport Lorry</span>
                  <span style={{ color: "#000000", fontWeight: 700 }}>:</span>
                  <span>{[driverName, vehiclePlate].filter(Boolean).join(" · ") || "—"}</span>
                </div>
                <div style={{ display: "contents" }}>
                  <span style={{ color: "#000000", fontWeight: 700 }}>Requested By</span>
                  <span style={{ color: "#000000", fontWeight: 700 }}>:</span>
                  <span>{transfer?.requestedBy ?? "Wei Hao (Ops Admin)"}</span>
                </div>
              </div>

              <div style={{ textAlign: "right" }}>
                <button
                  type="button"
                  className={styles.supplierExcelBtn}
                  onClick={() => setExcelModalOpen(true)}
                  title="View authentic Excel transfer manifest sheet with serial checklist"
                  style={{ background: "#0284c7", borderColor: "#0284c7", color: "#ffffff" }}
                >
                  📊 View Original Transfer Manifest (Excel &middot; {totalRequired} Units)
                </button>
              </div>
            </div>
          </div>
        </div>

        {/* Transfer Specifications Table */}
        <div style={{ overflowX: "auto", marginTop: "12px" }}>
          <table className={styles.scheduleRecordTable}>
            <thead>
              <tr>
                <th scope="col">Transfer No</th>
                <th scope="col">Category</th>
                <th scope="col">Equipment Model</th>
                <th scope="col">Transfer Qty</th>
                <th scope="col">Power / Spec</th>
                <th scope="col">Origin WH</th>
                <th scope="col">Destination WH</th>
                <th scope="col">Lorry Plate</th>
                <th scope="col">Status</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td style={{ fontWeight: 700, fontFamily: "monospace" }}>{transfer?.transferNo ?? tx.reference}</td>
                <td>
                  <span className={catClass(tx.category)}>{CAT_LABEL[tx.category] ?? tx.category}</span>
                </td>
                <td><strong>{tx.model}</strong></td>
                <td style={{ fontWeight: 700, color: "#0284c7" }}>{totalRequired} units</td>
                <td>
                  {targetTotalPowerWatts >= 1000
                    ? `${(targetTotalPowerWatts / 1000).toFixed(1)} kW (${transferUnits[0]?.powerRating ?? "N/A"} each)`
                    : `${targetTotalPowerWatts}W`}
                </td>
                <td><span className={`${styles.tag} ${styles.check}`}>{fromWh}</span></td>
                <td><span className={`${styles.tag} ${styles.check}`}>{toWh}</span></td>
                <td><code>{transfer?.vehiclePlate ?? "JTP 4910"}</code></td>
                <td>
                  <span
                    className={
                      tx.status === "To Verify"
                        ? styles.btnToVerify
                        : tx.status === "Inspected"
                        ? styles.btnInspected
                        : styles.btnVerified
                    }
                    style={{ cursor: "default", padding: "1px 6px", fontSize: "10px" }}
                  >
                    {tx.status}
                  </span>
                </td>
              </tr>
            </tbody>
          </table>
        </div>

        {transfer?.notes && (
          <div style={{ marginTop: "10px", fontSize: "12px", color: "var(--muted)", background: "#f1f5f9", padding: "8px 12px", borderRadius: "6px" }}>
            <strong>Transfer Notes:</strong> {transfer.notes}
          </div>
        )}
      </div>

      {/* Transport & Driver Details */}
      <div className={styles.inspectCard} style={{ marginBottom: "16px" }}>
        <div className={styles.bankingFieldGroup}>
          <label className={styles.bankingFieldLabel}>Lorry Photo:</label>
          <label className={styles.lorryPhotoBox}>
            <input
              type="file"
              accept="image/*"
              capture="environment"
              className={styles.lorryPhotoInput}
              onChange={(e) => {
                const file = e.target.files?.[0];
                e.target.value = "";
                if (!file) return;
                const reader = new FileReader();
                reader.onload = () => setLorryPhoto(typeof reader.result === "string" ? reader.result : null);
                reader.readAsDataURL(file);
              }}
            />
            {lorryPhoto ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={lorryPhoto} alt="Lorry" className={styles.lorryPhotoImg} />
            ) : (
              <span className={styles.lorryPhotoEmpty}>📷 Tap to take a picture of the lorry</span>
            )}
          </label>
          {lorryPhoto && (
            <div style={{ display: "flex", gap: "8px", marginTop: "8px" }}>
              <button type="button" className={styles.btnActionGhost} onClick={() => setLorryPhoto(null)}>
                Remove photo
              </button>
            </div>
          )}
        </div>
      </div>

      {/* 2. Barcode & Serial Camera Scanner (Same as Stock Out) */}
      <div className={styles.scannerCard}>
        <div className={styles.scannerHeader}>
          <div>
            <h2 className={styles.scannerTitle}>
              <span>🔍</span> Barcode &amp; Serial Scanner (Transfer Verification)
            </h2>
            <p className={styles.scannerHelpText}>
              Scan physical barcodes using live mobile camera or handheld laser gun to record each unit loading from {fromWh} to {toWh}.
            </p>
          </div>
        </div>

        {/* Camera Viewfinder */}
        {cameraActive && (
          <div className={styles.cameraViewfinder}>
                <button
                  type="button"
                  className={styles.cameraCloseBtn}
                  onClick={() => setCameraActive(false)}
                  aria-label="Close camera"
                  title="Close camera"
                >
                  ✕
                </button>
            <div className={styles.cameraScanLine} />
            <video ref={videoRef} className={styles.videoCameraActive} playsInline autoPlay muted />
            {cameraError && (
              <div style={{ padding: "12px 14px", background: "rgba(0,0,0,0.65)", borderRadius: "6px", margin: "8px" }}>
                <div style={{ fontSize: "22px", marginBottom: "2px" }}>📸</div>
                <strong style={{ color: "#f87171", fontSize: "12px" }}>Camera Notice:</strong>
                <div style={{ fontSize: "11px", color: "#e2e8f0", marginTop: "2px" }}>
                  {cameraError}
                </div>
              </div>
            )}
            <div style={{ padding: "8px 12px", background: "rgba(0,0,0,0.55)", borderRadius: "6px", marginTop: "6px", display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: "6px" }}>
              <span style={{ fontSize: "11px", color: "#e2e8f0" }}>
                🎯 Camera auto-detects barcode &amp; matches against Transfer #{transfer?.transferNo ?? tx.reference}.
              </span>
              <button
                type="button"
                className={styles.palletVerifyBtn}
                style={{ fontSize: "11px", padding: "3px 8px" }}
                onClick={() => {
                  const nextToVerify = transferUnits.find((u) => !verifiedSerials.has(u.serialNo));
                  if (nextToVerify) {
                    handleScan(nextToVerify.serialNo);
                  }
                }}
              >
                ⚡ Test Camera Detect Barcode
              </button>
            </div>
          </div>
        )}

        {/* Barcode Input Form */}
        <form
          className={styles.scannerInputRow}
          onSubmit={(e) => {
            e.preventDefault();
            handleScan();
          }}
        >
          <input
            ref={barcodeInputRef}
            type="text"
            className={styles.scannerInput}
            placeholder="Scan barcode or type unit serial number..."
            value={barcodeInput}
            onChange={(e) => setBarcodeInput(e.target.value)}
          />
          <button
            type="button"
            className={styles.scannerBtnScan}
            title="Records the typed serial; with an empty box it opens the camera scanner"
            onClick={() => {
              if (barcodeInput.trim()) handleScan();
              else setCameraActive(true);
            }}
          >
            <span>⚡</span> Scan / Match
          </button>
        </form>

        {/* Real-time Scan Feedback */}
        {feedback && (
          <div
            className={`${styles.scanFeedback} ${
              feedback.type === "success"
                ? styles.scanFeedbackSuccess
                : feedback.type === "warning"
                ? styles.scanFeedbackWarning
                : styles.scanFeedbackError
            }`}
          >
            <span>{feedback.message}</span>
            <button
              type="button"
              style={{ border: 0, background: "transparent", cursor: "pointer", color: "inherit", fontWeight: 700 }}
              onClick={() => setFeedback(null)}
            >
              &times;
            </button>
          </div>
        )}

        {/* 3. Transfer Units Recording Table (merged into the scanner box) */}
        <hr style={{ border: 0, borderTop: "1px solid var(--line)", margin: "18px 0" }} />
        <div className={styles.skuProgressHeader}>
          <div>
            <h2 className={styles.inspectCardTitle}>
              <span>📋</span> Transfer Units Recording — {tx.model}
            </h2>
            <p className={styles.itemDesc}>
              Scanned unit serial codes allocated for transport from {fromLabel} to {toLabel}
            </p>
          </div>
          <div className={styles.skuOverallStats}>
            Total Scanned: <strong>{totalScanned}</strong> / {totalRequired} {tx.category === "panel" ? "panels" : "units"} ({progressPercent}%)
          </div>
        </div>

        {/* Visual Progress Bar */}
        <div className={styles.progressBarContainer}>
          <div
            className={`${styles.progressBarFill} ${
              progressPercent < 100 ? styles.progressBarFillWarning : ""
            }`}
            style={{ width: `${progressPercent}%` }}
          />
        </div>

        {/* Scrollable Units Table */}
        <div className={styles.unitScrollTableWrap}>
          <table>
            <thead>
              <tr>
                <th scope="col" style={{ width: "50px" }}>No.</th>
                <th scope="col" style={{ minWidth: "220px" }}>Serial Code</th>
                <th scope="col">Description / Model</th>
                <th scope="col" style={{ width: "140px" }}>Power / Spec</th>
                <th scope="col" style={{ width: "180px" }}>Match Status</th>
              </tr>
            </thead>
            <tbody>
              {transferUnits.map((u) => {
                const isVerified = verifiedSerials.has(u.serialNo);
                return (
                  <tr
                    key={u.serialNo}
                    className={isVerified ? styles.unitRowVerified : undefined}
                  >
                    <td style={{ color: "var(--muted)", fontSize: "11px", fontWeight: 600 }}>
                      #{String(u.unitIndex).padStart(2, "0")}
                    </td>
                    <td>
                      <div style={{ fontFamily: "monospace", fontWeight: 700, fontSize: "13px", letterSpacing: "0.03em" }}>
                        {u.serialNo}
                      </div>
                      <div style={{ fontSize: "10px", color: "var(--muted)", marginTop: "2px" }}>
                        Pallet/Carton: <strong>{u.palletBarcode}</strong>
                      </div>
                    </td>
                    <td>
                      <strong style={{ fontSize: "13px" }}>{u.model}</strong>
                      <div style={{ fontSize: "11px", color: "var(--muted)", marginTop: "2px" }}>
                        Route: {u.fromWarehouse} ➔ {u.toWarehouse} &middot; Category: {CAT_LABEL[u.category] ?? u.category}
                      </div>
                    </td>
                    <td>
                      <span style={{ fontSize: "12px", fontWeight: 700, color: "var(--text)" }}>
                        {u.powerRating}
                      </span>
                    </td>
                    <td>
                      {isVerified ? (
                        <span className={`${styles.matchPill} ${styles.matchPillComplete}`}>
                          ✅ Verified (Matched)
                        </span>
                      ) : (
                        <span className={`${styles.matchPill} ${styles.matchPillPending}`}>
                          ⏳ Pending Scan
                        </span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* 5. Footer Action Bar */}
      <div className={styles.inspectFooterBar}>
        <p className={`${styles.note} ${styles.footerTip}`}>
          💡 <strong>Warehouse Tip:</strong> Scan physical barcodes of units loaded onto transit lorry {vehiclePlate} moving between {fromWh} and {toWh}. When all {totalRequired} units reach 100%, the <strong>Verified</strong> button unlocks.
        </p>
        <div className={styles.inspectActionGroup} style={viewOnly ? { display: "none" } : undefined}>
          <button
            className={styles.btnActionDanger}
            type="button"
            onClick={() => {
              onUpdateStatus("Inspected", "Stock Transfer discrepancy: carton crushed or missing unit in transit");
              onBack();
            }}
            title="Flag issue: short stock, carton damaged, or serial mismatch"
          >
            ⚠️ Flag Issue / Mark Inspected
          </button>

          <button
            className={`${styles.btnActionPrimary} ${
              isAllVerified ? styles.btnVerifiedGlow : styles.btnVerifiedLocked
            }`}
            type="button"
            disabled={!isAllVerified && tx.status !== "Verified"}
            onClick={() => {
              onUpdateStatus("Verified");
              onBack();
            }}
            title="All items scanned and verified for inter-warehouse transit"
          >
            {isAllVerified
              ? "✓ Verified (Ready for Inter-Warehouse Dispatch / Receiving)"
              : `🔒 Verified (Scan ${totalRequired - totalScanned} more to unlock)`}
          </button>
          {/* Loading: the transfer is moved to the other warehouse; it moves to the Loading tab. */}
          <button
            className={`${styles.btnActionPrimary} ${
              tx.status === "Verified" && !loaded ? styles.btnVerifiedGlow : styles.btnVerifiedLocked
            }`}
            type="button"
            disabled={tx.status !== "Verified" || loaded}
            onClick={() => {
              onRecord("loaded");
              onBack();
            }}
            title="Transfer already moved to the other warehouse"
          >
            {loaded ? "🚚 Loaded (at the other warehouse)" : tx.status === "Verified" ? "🚚 Loading (moved to the other warehouse)" : "🔒 Loading (verify first)"}
          </button>
        </div>
      </div>

      {/* Transfer Report: laid out like the Stock Out report (one A4 page): logo and "Report",
          the transfer details, the items moved, and the transit checklist. */}
      {reportOpen && (
        <div className={styles.bankingReceiptBackdrop} onClick={() => setReportOpen(false)}>
          <div
            className={`${styles.transferReportCard} ${styles.a4Report}`}
            role="dialog"
            aria-modal="true"
            aria-label="Transfer report"
            onClick={(e) => e.stopPropagation()}
          >
            <div className={styles.transferReportHead}>
              <div style={{ display: "flex", gap: "8px", marginLeft: "auto" }}>
                <DownloadReportButton fileName={reportFileName("Transfer-Report", transfer?.transferNo ?? tx.reference)} onePage />
                <button type="button" className={styles.btnActionGhost} onClick={() => setReportOpen(false)}>
                  Close
                </button>
              </div>
            </div>
            {/* Logo on the left, "Report" on the right: same as the Stock Out report */}
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "40px", margin: "0 0 28px" }}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={`${typeof window !== "undefined" ? window.location.origin : ""}${LOGO_SRC}`}
                alt="Eternalgy"
                width={1332}
                height={176}
                style={{ display: "block", height: "24px", width: "auto", flex: "none" }}
              />
              <span style={{ fontSize: "20px", fontWeight: 700, color: "#000" }}>Report</span>
            </div>

            {/* Transfer details, as the Stock Out report's customer details */}
            <h2 className={styles.inspectCardTitle} style={{ margin: "0 0 8px", color: "#000", fontWeight: 700 }}>
              <span>🔄</span> Transfer Details &middot; #{transfer?.transferNo ?? tx.reference}
            </h2>
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "max-content max-content 1fr",
                columnGap: "6px",
                rowGap: "4px",
                fontSize: "13px",
                color: "#000",
                marginBottom: "16px",
              }}
            >
              {(
                [
                  ["Transfer No.", transfer?.transferNo ?? tx.reference],
                  ["From", fromLabel],
                  ["To", toLabel],
                  ["Date", isoDateLabel(tx.time)],
                  ["Driver", transfer?.driverName || "—"],
                  ["Lorry No.", transfer?.vehiclePlate || "—"],
                  ["Total Units", `${totalRequired}`],
                  ["Scanned", `${totalScanned} / ${totalRequired} (${progressPercent}%)`],
                ] as [string, string][]
              ).map(([label, value]) => (
                <div key={label} style={{ display: "contents" }}>
                  <span style={{ fontWeight: 700 }}>{label}</span>
                  <span style={{ fontWeight: 700 }}>:</span>
                  <span>{value}</span>
                </div>
              ))}
              {transfer?.notes && (
                <div style={{ display: "contents" }}>
                  <span style={{ fontWeight: 700 }}>Notes</span>
                  <span style={{ fontWeight: 700 }}>:</span>
                  <span>{transfer.notes}</span>
                </div>
              )}
            </div>

            {/* Items moved, as a table */}
            <div style={{ fontWeight: 700, color: "#000", marginBottom: "8px" }}>Items</div>
            <table style={{ border: "1px solid #000", borderCollapse: "collapse", width: "100%", fontSize: "12.5px", color: "#000" }}>
              <thead>
                <tr>
                  {["Item", "Model", "Qty", "Serial Number"].map((h) => (
                    <th key={h} style={{ border: "1px solid #000", padding: "4px 8px", textAlign: h === "Qty" ? "right" : "left", fontWeight: 700 }}>
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {txLines(tx).map((line, i) => (
                  <tr key={`${line.model}-${i}`}>
                    <td style={{ border: "1px solid #000", padding: "4px 8px", textTransform: "capitalize" }}>{line.category}</td>
                    <td style={{ border: "1px solid #000", padding: "4px 8px" }}>{line.model}</td>
                    <td style={{ border: "1px solid #000", padding: "4px 8px", textAlign: "right" }}>{line.qty ?? "—"}</td>
                    <td style={{ border: "1px solid #000", padding: "4px 8px", fontFamily: "monospace", fontSize: "11px", wordBreak: "break-all" }}>
                      {line.serialCode || "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>

            {/* Transit checklist */}
            <div style={{ fontWeight: 700, color: "#000", margin: "16px 0 8px" }}>Physical Inspection &amp; Inter-Warehouse Transit Checklist</div>
            <div style={{ display: "grid", gap: "6px", fontSize: "12.5px", color: "#000" }}>
              {(
                [
                  ["condition", "Physical packaging inspected (cartons intact, weather shrink-wrapped, pallets strapped)"],
                  ["serialMatch", `All ${totalRequired} unit barcodes physically scanned & verified against Transfer Manifest`],
                  ["lorryLoaded", `Loaded onto transfer vehicle (${vehiclePlate || "—"}) with driver endorsement`],
                  ["handoverSigned", `Digital Goods In-Transit Acknowledgment dispatched to ${toLabel}`],
                ] as [keyof typeof checklist, string][]
              ).map(([key, text]) => (
                <label key={key} style={{ display: "flex", gap: "8px", alignItems: "flex-start" }}>
                  <input
                    type="checkbox"
                    checked={checklist[key]}
                    onChange={(e) => setChecklist((prev) => ({ ...prev, [key]: e.target.checked }))}
                  />
                  <span>{text}</span>
                </label>
              ))}
            </div>

            {/* Prepared by: who made the transfer, as on the Stock Out report */}
            <p style={{ textAlign: "right", margin: "24px 0 0", fontSize: "13px", color: "#000", fontWeight: 700 }}>
              Prepared by: <strong>{transfer?.requestedBy || "—"}</strong>
            </p>
          </div>
        </div>
      )}

      {/* Original Transfer Manifest Excel Sample Modal */}
      {excelModalOpen && (
        <div className={styles.excelModalBackdrop} onClick={() => setExcelModalOpen(false)}>
          <div className={styles.excelModal} onClick={(e) => e.stopPropagation()}>
            {/* 1. Microsoft Excel Window Title Bar */}
            <div className={styles.excelWindowBar}>
              <div className={styles.excelWindowTitle}>
                <span className={styles.excelIconX}>X</span>
                <span>
                  <strong>Inter_Warehouse_Transfer_Manifest_{transfer?.transferNo ?? tx.reference}.xlsx</strong> - Excel
                </span>
                <span className={styles.excelAutoSavePill}>
                  <span>●</span> Saved
                </span>
              </div>
              <div className={styles.excelWindowControls}>
                <button
                  type="button"
                  className={styles.excelWindowBtn}
                  onClick={() => {
                    const csvContent =
                      "data:text/csv;charset=utf-8," +
                      "Item No,Serial Number,Model,Power,Pallet,Origin,Destination,Status\n" +
                      transferUnits
                        .map(
                          (u) =>
                            `${u.unitIndex},${u.serialNo},${u.model},${u.powerRating},${u.palletBarcode},${u.fromWarehouse},${u.toWarehouse},${verifiedSerials.has(u.serialNo) ? "Verified" : "Pending"}`
                        )
                        .join("\n");
                    const encodedUri = encodeURI(csvContent);
                    const link = document.createElement("a");
                    link.setAttribute("href", encodedUri);
                    link.setAttribute("download", `Transfer_Manifest_${transfer?.transferNo ?? tx.reference}.csv`);
                    document.body.appendChild(link);
                    link.click();
                    document.body.removeChild(link);
                  }}
                  title="Download Original Excel (.xlsx / .csv)"
                >
                  💾 Save As CSV
                </button>
                <button
                  type="button"
                  className={`${styles.excelWindowBtn} ${styles.excelWindowBtnClose}`}
                  onClick={() => setExcelModalOpen(false)}
                  title="Close Excel Viewer"
                >
                  ✕
                </button>
              </div>
            </div>

            {/* 2. Excel Ribbon & Quick Actions */}
            <div className={styles.excelRibbon}>
              <div className={styles.excelRibbonTabs}>
                <button type="button" className={styles.excelRibbonTab}>File</button>
                <button type="button" className={`${styles.excelRibbonTab} ${styles.excelRibbonTabActive}`}>Home</button>
                <button type="button" className={styles.excelRibbonTab}>Insert</button>
                <button type="button" className={styles.excelRibbonTab}>Page Layout</button>
                <button type="button" className={styles.excelRibbonTab}>Formulas</button>
                <button type="button" className={styles.excelRibbonTab}>Data</button>
                <button type="button" className={styles.excelRibbonTab}>Review</button>
                <button type="button" className={styles.excelRibbonTab}>View</button>
              </div>
              <div className={styles.excelRibbonActions}>
                <input
                  type="search"
                  className={styles.searchCompact}
                  placeholder="🔍 Search sheet..."
                  value={excelSearch}
                  onChange={(e) => setExcelSearch(e.target.value)}
                />
              </div>
            </div>

            {/* 3. Excel Formula Bar */}
            <div className={styles.excelFormulaBar}>
              <div className={styles.excelNameBox}>{selectedExcelCell.coord}</div>
              <span className={styles.excelFxLabel}>fx</span>
              <input
                type="text"
                readOnly
                className={styles.excelFormulaInput}
                value={selectedExcelCell.val}
              />
            </div>

            {/* 4. The Authentic Excel Spreadsheet Grid Canvas */}
            <div className={styles.excelSheetContainer}>
              <table className={styles.excelGridTable}>
                <thead>
                  <tr>
                    <th scope="col" className={styles.excelColHeader} style={{ width: "38px" }}>◢</th>
                    <th scope="col" className={styles.excelColHeader} style={{ width: "50px" }}>A</th>
                    <th scope="col" className={styles.excelColHeader} style={{ width: "220px" }}>B</th>
                    <th scope="col" className={styles.excelColHeader} style={{ width: "160px" }}>C</th>
                    <th scope="col" className={styles.excelColHeader} style={{ width: "120px" }}>D</th>
                    <th scope="col" className={styles.excelColHeader} style={{ width: "140px" }}>E</th>
                    <th scope="col" className={styles.excelColHeader} style={{ width: "100px" }}>F</th>
                    <th scope="col" className={styles.excelColHeader} style={{ width: "100px" }}>G</th>
                    <th scope="col" className={styles.excelColHeader} style={{ width: "130px" }}>H</th>
                  </tr>
                  <tr className={styles.excelHeaderRow}>
                    <td className={styles.excelRowHeader}>1</td>
                    <td><strong>Item #</strong></td>
                    <td><strong>Serial Number (S/N)</strong></td>
                    <td><strong>Model Code</strong></td>
                    <td><strong>Power / Spec</strong></td>
                    <td><strong>Pallet / Carton</strong></td>
                    <td><strong>Origin WH</strong></td>
                    <td><strong>Dest WH</strong></td>
                    <td><strong>Verification Status</strong></td>
                  </tr>
                </thead>
                <tbody>
                  {filteredExcelUnits.map((u, idx) => {
                    const rowNum = idx + 2;
                    const isVerified = verifiedSerials.has(u.serialNo);
                    return (
                      <tr key={u.serialNo}>
                        <td className={styles.excelRowHeader}>{rowNum}</td>
                        <td
                          className={styles.excelCell}
                          onClick={() => setSelectedExcelCell({ coord: `A${rowNum}`, val: String(u.unitIndex) })}
                        >
                          #{u.unitIndex}
                        </td>
                        <td
                          className={`${styles.excelCell} ${styles.excelCellMono}`}
                          onClick={() => setSelectedExcelCell({ coord: `B${rowNum}`, val: u.serialNo })}
                        >
                          {u.serialNo}
                        </td>
                        <td
                          className={styles.excelCell}
                          onClick={() => setSelectedExcelCell({ coord: `C${rowNum}`, val: u.model })}
                        >
                          {u.model}
                        </td>
                        <td
                          className={styles.excelCell}
                          onClick={() => setSelectedExcelCell({ coord: `D${rowNum}`, val: u.powerRating })}
                        >
                          {u.powerRating}
                        </td>
                        <td
                          className={styles.excelCell}
                          onClick={() => setSelectedExcelCell({ coord: `E${rowNum}`, val: u.palletBarcode })}
                        >
                          {u.palletBarcode}
                        </td>
                        <td
                          className={styles.excelCell}
                          onClick={() => setSelectedExcelCell({ coord: `F${rowNum}`, val: u.fromWarehouse })}
                        >
                          {u.fromWarehouse}
                        </td>
                        <td
                          className={styles.excelCell}
                          onClick={() => setSelectedExcelCell({ coord: `G${rowNum}`, val: u.toWarehouse })}
                        >
                          {u.toWarehouse}
                        </td>
                        <td
                          className={styles.excelCell}
                          onClick={() => setSelectedExcelCell({ coord: `H${rowNum}`, val: isVerified ? "Verified" : "Pending" })}
                          style={{ color: isVerified ? "#15803d" : "#b45309", fontWeight: 600 }}
                        >
                          {isVerified ? "✓ Verified" : "⏳ Pending"}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            {/* 5. Excel Sheet Tabs & Zoom Bar */}
            <div className={styles.excelFooter}>
              <div className={styles.excelSheetTabs}>
                <div className={`${styles.excelSheetTab} ${styles.excelSheetTabActive}`}>
                  Sheet1 (Transfer Manifest)
                </div>
              </div>
              <div className={styles.excelStatusBar}>
                <span>Ready &middot; Count: {filteredExcelUnits.length}</span>
                <span>100% ━●━━━</span>
              </div>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}

// ---------------------------------------------------------------------------
// Transaction Page — Inspection of Stock Movements
// ---------------------------------------------------------------------------

function TransactionInspectionPage({
  tx,
  onBack,
  onUpdateStatus,
  onRecord,
  loaded = false,
  preparedBy = {},
  viewOnly = false,
}: {
  tx: StockTransaction;
  onRecord: (material: VerificationMaterial) => void | Promise<boolean>;
  loaded?: boolean;
  // Loading access: look only; the one button left is Loading on a verified Stock Out job.
  viewOnly?: boolean;
  // Who completed each item of this job (material -> name), for "Prepared by".
  preparedBy?: Record<string, string>;
  onBack: () => void;
  onUpdateStatus: (newStatus: StockTransactionStatus, remark?: string) => void;
}) {
  // If Stock In case, route to dedicated Stock In Barcode & SKU Verification page
  if (tx.type === "in") {
    return (
      <StockInVerificationPage
        tx={tx}
        onBack={onBack}
        onUpdateStatus={onUpdateStatus}
      />
    );
  }

  // If Stock Out case, route to dedicated Stock Out Barcode & Camera Verification page
  if (tx.type === "out") {
    return (
      <StockOutVerificationPage
        tx={tx}
        onBack={onBack}
        onUpdateStatus={onUpdateStatus}
        onRecord={onRecord}
        loaded={loaded}
        preparedBy={preparedBy}
        viewOnly={viewOnly}
      />
    );
  }

  // If Stock Transfer case, route to dedicated Stock Transfer Verification page
  if (tx.type === "transfer") {
    return (
      <StockTransferVerificationPage
        tx={tx}
        onBack={onBack}
        onUpdateStatus={onUpdateStatus}
        onRecord={onRecord}
        loaded={loaded}
        viewOnly={viewOnly}
      />
    );
  }

  const txType = (tx as any).type as StockTransactionType;
  const [checklist, setChecklist] = useState({
    condition: false,
    serialMatch: false,
    qtyCounted: false,
    handoverSigned: false,
  });

  return (
    <section className={styles.screen} aria-labelledby="tx-inspection-title">
      <div className={styles.inspectTopBar}>
        <button className={styles.back} type="button" onClick={onBack} style={{ marginBottom: 0 }}>
          Back
        </button>
        <span
          className={
            tx.status === "To Verify"
              ? styles.btnToVerify
              : tx.status === "Inspected"
              ? styles.btnInspected
              : styles.btnVerified
          }
        >
          Status: {tx.status}
        </span>
      </div>

      <div className={styles.inspectHeroCard}>
        <div>
          <div style={{ display: "flex", gap: "8px", alignItems: "center", marginBottom: "6px" }}>
            <span
              className={`${styles.txBadge} ${
                txType === "in" ? styles.txIn : txType === "out" ? styles.txOut : styles.tag
              }`}
            >
              {txType === "in" ? "🟢 STOCK IN" : txType === "out" ? "🔴 STOCK OUT" : "🔄 TRANSFER"}
            </span>
            <span className={catClass(tx.category)}>{CAT_LABEL[tx.category] ?? tx.category}</span>
            <span className={`${styles.tag} ${styles.check}`}>{tx.warehouse} Warehouse</span>
          </div>
          <h1 id="tx-inspection-title" className={styles.inspectHeroTitle}>
            {txType === "in" && `Stock In Verification: ${tx.model}`}
            {txType === "out" && `Stock Out Verification: ${tx.model}`}
            {txType === "transfer" && `Transfer Verification: ${tx.model}`}
          </h1>
          <p className={styles.inspectHeroSub}>
            Reference: <strong>{tx.reference}</strong> &middot; Recorded {tx.time}
          </p>
        </div>
        <div style={{ textAlign: "right" }}>
          <span className={styles.inspectDataLabel}>Suggested Movement</span>
          <div
            className={`${styles.inspectQtyBig} ${
              txType === "in" ? styles.txQtyIn : txType === "out" ? styles.txQtyOut : ""
            }`}
          >
            {txType === "in" ? `+${tx.qty}` : txType === "out" ? `-${tx.qty}` : `${tx.qty}`} units
          </div>
        </div>
      </div>

      {/* Comparison Grid: Suggested Movement vs Source Record */}
      <div className={styles.inspectGrid}>
        {/* Left: Suggested Physical Movement */}
        <div className={styles.inspectCard}>
          <div className={styles.inspectCardHeader}>
            <h2 className={styles.inspectCardTitle}>
              <span>📦</span> Suggested Physical Movement
            </h2>
            <span className={`${styles.tag} ${styles.check}`}>Warehouse Log</span>
          </div>
          <ul className={styles.inspectDataList}>
            <li className={styles.inspectDataRow}>
              <span className={styles.inspectDataLabel}>Category:</span>
              <span className={styles.inspectDataValue}>{CAT_LABEL[tx.category] ?? tx.category}</span>
            </li>
            <li className={styles.inspectDataRow}>
              <span className={styles.inspectDataLabel}>Model:</span>
              <strong className={styles.inspectDataValue}>{tx.model}</strong>
            </li>
            <li className={styles.inspectDataRow}>
              <span className={styles.inspectDataLabel}>Serial / Lot:</span>
              <span className={`${styles.inspectDataValue} ${styles.code}`}>{tx.serialCode}</span>
            </li>
            <li className={styles.inspectDataRow}>
              <span className={styles.inspectDataLabel}>Quantity:</span>
              <strong className={styles.inspectDataValue}>{tx.qty} units</strong>
            </li>
            <li className={styles.inspectDataRow}>
              <span className={styles.inspectDataLabel}>Warehouse:</span>
              <span className={styles.inspectDataValue}>
                {tx.warehouse === "JB" ? "Johor Bahru (JB)" : "Kuala Lumpur (KL)"}
              </span>
            </li>
            <li className={styles.inspectDataRow}>
              <span className={styles.inspectDataLabel}>Party / Handled By:</span>
              <span className={styles.inspectDataValue}>{tx.party}</span>
            </li>
            <li className={styles.inspectDataRow}>
              <span className={styles.inspectDataLabel}>Reference:</span>
              <span className={styles.inspectDataValue}>{tx.reference}</span>
            </li>
          </ul>
        </div>

        {/* Right: Source System Record (Order Invoice for Stock In, Scheduling System for Stock Out) */}
        <div className={styles.inspectCard}>
          <div className={styles.inspectCardHeader}>
            <h2 className={styles.inspectCardTitle}>
              <span>{txType === "in" ? "📄" : txType === "out" ? "📅" : "🔁"}</span>
              {txType === "in" && "Order Invoice Record"}
              {txType === "out" && "Scheduling System Record"}
              {txType === "transfer" && "Transfer Order Record"}
            </h2>
            <span className={`${styles.tag} ${styles.ok}`}>
              {txType === "in" ? "Supplier Invoice" : txType === "out" ? "Installation Job" : "Inter-WH"}
            </span>
          </div>

          {txType === "in" && tx.invoice && (
            <>
              <ul className={styles.inspectDataList}>
                <li className={styles.inspectDataRow}>
                  <span className={styles.inspectDataLabel}>Invoice Number:</span>
                  <strong className={styles.inspectDataValue}>{tx.invoice.invoiceNo}</strong>
                </li>
                <li className={styles.inspectDataRow}>
                  <span className={styles.inspectDataLabel}>Invoice Date:</span>
                  <span className={styles.inspectDataValue}>{tx.invoice.invoiceDate}</span>
                </li>
                <li className={styles.inspectDataRow}>
                  <span className={styles.inspectDataLabel}>Purchase Order (PO):</span>
                  <span className={styles.inspectDataValue}>{tx.invoice.poNumber}</span>
                </li>
                <li className={styles.inspectDataRow}>
                  <span className={styles.inspectDataLabel}>Supplier Name:</span>
                  <span className={styles.inspectDataValue}>{tx.invoice.supplierName}</span>
                </li>
                <li className={styles.inspectDataRow}>
                  <span className={styles.inspectDataLabel}>Invoiced Quantity:</span>
                  <span className={styles.inspectDataValue}>{tx.invoice.invoicedQty} units</span>
                </li>
                <li className={styles.inspectDataRow}>
                  <span className={styles.inspectDataLabel}>Received Quantity:</span>
                  <strong className={styles.inspectDataValue}>{tx.invoice.receivedQty} units</strong>
                </li>
                {tx.invoice.palletCount && (
                  <li className={styles.inspectDataRow}>
                    <span className={styles.inspectDataLabel}>Pallet Count:</span>
                    <span className={styles.inspectDataValue}>{tx.invoice.palletCount} Pallets</span>
                  </li>
                )}
                {tx.invoice.unitPrice && (
                  <li className={styles.inspectDataRow}>
                    <span className={styles.inspectDataLabel}>Unit Price:</span>
                    <span className={styles.inspectDataValue}>{tx.invoice.unitPrice}</span>
                  </li>
                )}
                {tx.invoice.notes && (
                  <li className={styles.inspectDataRow}>
                    <span className={styles.inspectDataLabel}>Invoice Notes:</span>
                    <span className={styles.inspectDataValue}>{tx.invoice.notes}</span>
                  </li>
                )}
              </ul>
              <div className={styles.inspectMatchNotice}>
                <span>✓</span>
                <span>
                  Match verified: <strong>{tx.qty} units</strong> match Order Invoice #{tx.invoice.invoiceNo}.
                </span>
              </div>
            </>
          )}

          {txType === "out" && tx.schedule && (
            <>
              <ul className={styles.inspectDataList}>
                <li className={styles.inspectDataRow}>
                  <span className={styles.inspectDataLabel}>Job ID:</span>
                  <strong className={styles.inspectDataValue}>{tx.schedule.jobId}</strong>
                </li>
                <li className={styles.inspectDataRow}>
                  <span className={styles.inspectDataLabel}>Customer Name:</span>
                  <strong className={styles.inspectDataValue}>{tx.schedule.customerName}</strong>
                </li>
                {tx.schedule.customerPhone && (
                  <li className={styles.inspectDataRow}>
                    <span className={styles.inspectDataLabel}>Contact Phone:</span>
                    <span className={styles.inspectDataValue}>{tx.schedule.customerPhone}</span>
                  </li>
                )}
                {tx.schedule.customerAddress && (
                  <li className={styles.inspectDataRow}>
                    <span className={styles.inspectDataLabel}>Site Address:</span>
                    <span className={styles.inspectDataValue}>{tx.schedule.customerAddress}</span>
                  </li>
                )}
                <li className={styles.inspectDataRow}>
                  <span className={styles.inspectDataLabel}>Scheduled Date:</span>
                  <span className={styles.inspectDataValue}>{tx.schedule.scheduledDate}</span>
                </li>
                <li className={styles.inspectDataRow}>
                  <span className={styles.inspectDataLabel}>Assigned Installer:</span>
                  <span className={styles.inspectDataValue}>{tx.schedule.installerTeam}</span>
                </li>
                {tx.schedule.systemPackage && (
                  <li className={styles.inspectDataRow}>
                    <span className={styles.inspectDataLabel}>System Package:</span>
                    <span className={styles.inspectDataValue}>{tx.schedule.systemPackage}</span>
                  </li>
                )}
                <li className={styles.inspectDataRow}>
                  <span className={styles.inspectDataLabel}>Allocated Qty:</span>
                  <span className={styles.inspectDataValue}>{tx.schedule.allocatedQty} units</span>
                </li>
                <li className={styles.inspectDataRow}>
                  <span className={styles.inspectDataLabel}>Dispatched Qty:</span>
                  <strong className={styles.inspectDataValue}>{tx.schedule.dispatchedQty} units</strong>
                </li>
                {tx.schedule.notes && (
                  <li className={styles.inspectDataRow}>
                    <span className={styles.inspectDataLabel}>Job Notes:</span>
                    <span className={styles.inspectDataValue}>{tx.schedule.notes}</span>
                  </li>
                )}
              </ul>
              <div className={styles.inspectMatchNotice}>
                <span>✓</span>
                <span>
                  Match verified: <strong>{tx.qty} units</strong> match Installation Job #{tx.schedule.jobId} schedule.
                </span>
              </div>
            </>
          )}

          {tx.type === "transfer" && tx.transfer && (
            <>
              <ul className={styles.inspectDataList}>
                <li className={styles.inspectDataRow}>
                  <span className={styles.inspectDataLabel}>Transfer Order #:</span>
                  <strong className={styles.inspectDataValue}>{tx.transfer.transferNo}</strong>
                </li>
                <li className={styles.inspectDataRow}>
                  <span className={styles.inspectDataLabel}>From Warehouse:</span>
                  <span className={styles.inspectDataValue}>{tx.transfer.fromWarehouse} WH</span>
                </li>
                <li className={styles.inspectDataRow}>
                  <span className={styles.inspectDataLabel}>To Warehouse:</span>
                  <span className={styles.inspectDataValue}>{tx.transfer.toWarehouse} WH</span>
                </li>
                <li className={styles.inspectDataRow}>
                  <span className={styles.inspectDataLabel}>Requested By:</span>
                  <span className={styles.inspectDataValue}>{tx.transfer.requestedBy}</span>
                </li>
                <li className={styles.inspectDataRow}>
                  <span className={styles.inspectDataLabel}>Transfer Qty:</span>
                  <strong className={styles.inspectDataValue}>{tx.transfer.receivedQty} units</strong>
                </li>
                {tx.transfer.notes && (
                  <li className={styles.inspectDataRow}>
                    <span className={styles.inspectDataLabel}>Transfer Notes:</span>
                    <span className={styles.inspectDataValue}>{tx.transfer.notes}</span>
                  </li>
                )}
              </ul>
              <div className={styles.inspectMatchNotice}>
                <span>✓</span>
                <span>
                  Transfer order confirmed: <strong>{tx.qty} units</strong> dispatched from {tx.transfer.fromWarehouse} to {tx.transfer.toWarehouse}.
                </span>
              </div>
            </>
          )}
        </div>
      </div>

      {/* Checklist Card */}
      <div className={styles.inspectChecklistCard}>
        <h3 className={styles.inspectChecklistTitle}>Physical Inspection Checklist</h3>
        <div className={styles.inspectChecklist}>
          <label className={styles.inspectCheckItem}>
            <input
              type="checkbox"
              checked={checklist.condition}
              onChange={(e) => setChecklist((prev) => ({ ...prev, condition: e.target.checked }))}
            />
            <span>Physical equipment &amp; packaging inspected (no damage, seal intact)</span>
          </label>
          <label className={styles.inspectCheckItem}>
            <input
              type="checkbox"
              checked={checklist.serialMatch}
              onChange={(e) => setChecklist((prev) => ({ ...prev, serialMatch: e.target.checked }))}
            />
            <span>Barcode &amp; serial code verified against document ({tx.serialCode})</span>
          </label>
          <label className={styles.inspectCheckItem}>
            <input
              type="checkbox"
              checked={checklist.qtyCounted}
              onChange={(e) => setChecklist((prev) => ({ ...prev, qtyCounted: e.target.checked }))}
            />
            <span>Physical count confirmed ({tx.qty} units)</span>
          </label>
          <label className={styles.inspectCheckItem}>
            <input
              type="checkbox"
              checked={checklist.handoverSigned}
              onChange={(e) => setChecklist((prev) => ({ ...prev, handoverSigned: e.target.checked }))}
            />
            <span>Handover acknowledgement signed by driver / installer</span>
          </label>
        </div>
      </div>

      {/* Footer Action Bar */}
      <div className={styles.inspectFooterBar}>
        <div className={styles.inspectActionGroup}>
          {tx.status !== "Inspected" && (
            <button
              className={styles.btnActionDanger}
              type="button"
              onClick={() => onUpdateStatus("Inspected")}
              title="Flag issue: missing items, transit damage, etc."
            >
              ⚠️ Flag Issue / Mark Inspected
            </button>
          )}
          {tx.status !== "Verified" && (
            <button
              className={styles.btnActionPrimary}
              type="button"
              onClick={() => onUpdateStatus("Verified")}
              title="All items confirmed in good condition"
            >
              ✓ Verified (Good Condition)
            </button>
          )}
          {tx.status === "Verified" && (
            <button
              className={styles.btnActionGhost}
              type="button"
              onClick={() => onUpdateStatus("To Verify")}
            >
              ↺ Re-open (To Verify)
            </button>
          )}
        </div>
      </div>

      <p className={styles.note} style={{ marginTop: "4px" }}>
        💡 <strong>Note:</strong> Showing dummy data comparison (Stock In &rarr; Order Invoice, Stock Out &rarr; Scheduling System). We will replace this with your custom Transaction Page design once you share it!
      </p>
    </section>
  );
}

// ---------------------------------------------------------------------------
// Tab 1 — Home (Stock Balance & Movements)
// ---------------------------------------------------------------------------

// The Stock Balance cards, shared by Home and Stock Details so both always match.
function StockBalanceCards({
  whFilter,
  onCardClick,
  tooltip,
  activeItem,
  hideWhLabels = false,
}: {
  whFilter: WhFilter;
  onCardClick: (item: StockItemTab) => void;
  tooltip: (label: string) => string;
  activeItem?: StockItemTab;
  // Home: leave out the warehouse wording ("All WH" / "JB WH" tag and "JB Warehouse" line).
  hideWhLabels?: boolean;
}) {
  const balances = WAREHOUSE_BALANCES[whFilter];
  return (
    <div className={styles.balanceGrid}>
      {balances.map((card) => (
        <article
          key={card.id}
          className={`${styles.typeCard} ${styles.balanceCard} ${
            activeItem && (card.id === "electrical" ? "other" : card.id) === activeItem ? styles.balanceCardActive : ""
          }`}
        >
          <button
            type="button"
            className={styles.balanceCardButton}
            aria-pressed={activeItem ? (card.id === "electrical" ? "other" : card.id) === activeItem : undefined}
            title={tooltip(card.label)}
            onClick={() => onCardClick(card.id === "electrical" ? "other" : card.id)}
          >
            <div className={styles.balanceCardBody}>
              <div className={styles.balanceCardHeader}>
                <span className={styles.typeName}>{card.label}</span>
                {!hideWhLabels && (
                  <span className={`${styles.tag} ${styles.check}`}>
                    {whFilter === "all" ? "All WH" : `${WH_BUTTON_LABEL[whFilter]} WH`}
                  </span>
                )}
              </div>
              {/* No count yet: leave the On hand line out instead of showing "— On hand". */}
              {card.onHand != null && (
                <div className={styles.onHandMain}>
                  <strong className={styles.onHandNumber}>{card.onHand}</strong>
                  <span className={styles.onHandLabel}>On hand</span>
                </div>
              )}
              {whFilter === "all" ? (
                <div className={styles.onHandSplit}>
                  {/* A warehouse with no figure for this item is left out, not shown as "—". */}
                  {WH_SPLIT[card.id]?.JB != null && <span><strong>JB</strong> {WH_SPLIT[card.id]?.JB}</span>}
                  {WH_SPLIT[card.id]?.KL != null && <span><strong>KL</strong> {WH_SPLIT[card.id]?.KL}</span>}
                  {WH_SPLIT[card.id]?.KLG != null && <span><strong>Kluang</strong> {WH_SPLIT[card.id]?.KLG}</span>}
                </div>
              ) : hideWhLabels ? null : (
                <div className={styles.onHandSplit}>
                  <span>{WH_BUTTON_LABEL[whFilter]} Warehouse</span>
                </div>
              )}
            </div>
          </button>
          <div className={styles.balanceHintPlaceholder} aria-hidden="true" />
        </article>
      ))}
    </div>
  );
}

function HomeTab({
  transactions,
  onInspectTx,
  onSignOut,
  onInverterOpen,
  showTx,
  onShowTx,
  onOpenTransfer,
  onNewStockOut,
  loadingOnly = false,
  loadingMode,
  onOpenLorry,
  onOpenStock,
  canUpload,
  verifications,
  txType,
  setTxType,
  txCat,
  setTxCat,
  txStatusTab,
  setTxStatusTab,
  selectedDay,
  setSelectedDay,
}: {
  transactions: StockTransaction[];
  onInspectTx: (id: string) => void;
  txType: HomeTxType;
  setTxType: Dispatch<SetStateAction<HomeTxType>>;
  txCat: string;
  setTxCat: Dispatch<SetStateAction<string>>;
  txStatusTab: TxStatusTab;
  setTxStatusTab: Dispatch<SetStateAction<TxStatusTab>>;
  selectedDay: string;
  setSelectedDay: Dispatch<SetStateAction<string>>;
  peak?: number;
  onSignOut: () => void;
  onInverterOpen: () => void;
  showTx: boolean;
  onShowTx: (show: boolean) => void;
  onOpenTransfer: () => void;
  // Stock Out: open the "+ New Stock Out" form (last-minute item taken by the PIC).
  onNewStockOut: () => void;
  // "Loading" access: the Loading page only (Loading / Site Check), no Back, other tabs or
  // buttons. Rows open the verification page, view only except the Loading button.
  loadingOnly?: boolean;
  // With loadingOnly: lock the page to one view, without the Loading / Site Check buttons.
  // "ready" = the Loading page (jobs to load), "loaded" = the Site Check page.
  loadingMode?: "ready" | "loaded";
  // Loading page: a driver row opens that lorry's page; its customer rows do not open on their own.
  onOpenLorry?: (lorry: { driver: string; plate: string; txIds: string[]; stage?: "preparing" | "verified"; day?: string }) => void;
  onOpenStock: (item: StockItemTab, wh: WhFilter) => void;
  canUpload: boolean;
  verifications: VerificationRecord[];
}) {
  const [whFilter, setWhFilter] = useState<WhFilter>("all");
  const [txSearch, setTxSearch] = useState("");
  const [prepReportOpen, setPrepReportOpen] = useState(false);
  const doFiles = useDoFiles(showTx && txType === "in");
  const prepSheetRef = useRef<HTMLDivElement>(null);
  const [checkedBy, setCheckedBy] = useState<string | null>(null);
  const txSectionRef = useRef<HTMLDivElement>(null);
  const txTableRef = useRef<HTMLDivElement>(null);
  // Stock In: the PO whose Stock In Verification page is open (tapped on its row).
  const [openPoId, setOpenPoId] = useState<string | null>(null);
  const isToday = selectedDay === isoToday();
  const dayLabel = getDayLabel(selectedDay);
  // Loading page: each job's ETA at the customer's house, from its run on the Delivery Schedule
  // (matched by invoice number).
  const [deliveryRuns, setDeliveryRuns] = useState<TimelineRun[]>([]);
  useEffect(() => {
    // Loading page (ETA, install time) and Stock Out list (install time).
    if (!loadingOnly && txType !== "out") return;
    // Kept current with the Scheduling system while the page is open.
    return watchDeliveryRuns<TimelineRun>(setDeliveryRuns);
  }, [loadingOnly, txType]);
  // Delivery Schedule details (slot, ETA, install time), matched by invoice or customer name.
  const etaLookup = useMemo(() => buildEtaLookup(deliveryRuns), [deliveryRuns]);
  const etaOf = (tx: StockTransaction) => lookupEta(etaLookup, tx);
  // The day a row belongs to. The Loading page goes by slot date (the delivery run's date on the
  // Delivery Schedule); a job on no run, and every Stock Transfer, by its own date. Elsewhere
  // rows go by installation date.
  const rowDay = (tx: StockTransaction): string | null =>
    loadingOnly ? etaOf(tx)?.slotDate || txDate(tx) : txDate(tx);
  const inSelectedDay = (tx: StockTransaction) => rowDay(tx) === selectedDay;

  // Rows passing the warehouse / type / item filters (any day).
  const passesFilters = (tx: StockTransaction) => {
    if (whFilter !== "all") {
      if (tx.type === "transfer" && tx.transfer) {
        if (tx.transfer.fromWarehouse !== whFilter && tx.transfer.toWarehouse !== whFilter && tx.warehouse !== whFilter) {
          return false;
        }
      } else if (tx.warehouse !== whFilter) {
        return false;
      }
    }
    if (txType !== "all" && tx.type !== txType) return false;
    if (txCat !== "all" && !txHasCategory(tx, txCat)) return false;
    return true;
  };

  const STATUS_PRIORITY: Record<string, number> = {
    "To Verify": 1,
    "Inspected": 2,
    "Verified": 3,
  };

  const baseTx = transactions
    .filter((tx) => {
      if (!inSelectedDay(tx)) return false;
      if (whFilter !== "all") {
        if (tx.type === "transfer" && tx.transfer) {
          const isMatch =
            tx.transfer.fromWarehouse === whFilter ||
            tx.transfer.toWarehouse === whFilter ||
            tx.warehouse === whFilter;
          if (!isMatch) return false;
        } else if (tx.warehouse !== whFilter) {
          return false;
        }
      }
      if (txType !== "all" && tx.type !== txType) return false;
      if (txCat !== "all" && !txHasCategory(tx, txCat)) return false;
      if (txSearch.trim() && !txMatchesSearch(tx, txSearch)) return false;
      return true;
    })
    .sort((a, b) => {
      const pA = STATUS_PRIORITY[a.status] ?? 99;
      const pB = STATUS_PRIORITY[b.status] ?? 99;
      return pA - pB;
    });

  // "To Verify" tab also holds Inspected rows (issue still pending); "Verified" holds the rest
  const isVerifiedTx = (status: string) => status === "Verified";
  // Stock In: each uploaded PO is a row of the table (To Verify), on the day it was uploaded.
  const poRows =
    txType === "in"
      ? doFiles.files.filter((file) => {
          // Shown on the date written on the PO (older uploads: the upload day).
          if (poDay(file) !== selectedDay) return false;
          const q = txSearch.trim().toLowerCase();
          return (
            !q ||
            file.fileName.toLowerCase().includes(q) ||
            file.uploadedBy.toLowerCase().includes(q) ||
            (file.poLines ?? []).some(
              (line) => line.itemCode.toLowerCase().includes(q) || line.description.toLowerCase().includes(q),
            )
          );
        })
      : [];
  // A PO moves to Verified once all its units are scanned and Verified was pressed.
  const shownPoRows = poRows.filter((file) => (txStatusTab !== "toVerify" ? !!file.verifiedAt : !file.verifiedAt));
  // Stock Out: a verified job marked Loaded (moved to the customer's house) leaves Verified for
  // the Loading tab. Other views keep it under Verified.
  const loadedJobs = new Set(verifications.filter((r) => r.material === "loaded").map((r) => r.jobRef));
  // Stock Transfer: Verified and Loading only (a transfer is verified when it is made); a
  // transfer marked Loading has been moved to the other warehouse.
  const isTransferList = txType === "transfer";
  // Stock Out list: Preparing (to verify) -> Loading -> Site Check. Pressing Verified sends a job
  // to Loading; a verified job not yet sent (older ones, test data) also shows under Loading, with
  // its 🚚 Loading button.
  const outTabs = txType === "out" && !loadingOnly;
  const showLoading = loadingOnly || txType === "out" || isTransferList;
  const isLoadedTx = (t: StockTransaction) =>
    showLoading && (t.type === "out" ? isVerifiedTx(t.status) : t.type === "transfer") && loadedJobs.has(t.reference);
  const toVerifyCount = isTransferList
    ? 0
    : baseTx.filter((t) => !isVerifiedTx(t.status)).length + poRows.filter((file) => !file.verifiedAt).length;
  const loadingCount = baseTx.filter(isLoadedTx).length;
  // Stock Out's Verified tab holds every verified job, loaded ones included (Loading and Site
  // Check have their own pages); elsewhere loaded jobs are left to the Loading page.
  const verifiedCount = baseTx.length + poRows.length - toVerifyCount - (outTabs ? 0 : loadingCount);
  // Loading page:
  // - "Loading" tab: Stock Out jobs whose 🚚 Loading (moved to customer's house) was pressed on
  //   Stock Out › Verified, still waiting for every panel to be scanned on site. A job that is
  //   only verified stays on Stock Out › Verified and is not here.
  // - "Site Check" tab: Stock Out jobs whose panels were all scanned on site (arrived), and
  //   Stock Transfers marked Loading (moved to the other warehouse; no site scan).
  const arrivedJobs = new Set(verifications.filter((r) => r.material === "arrived").map((r) => r.jobRef));
  // Lorry timeline: the day's runs, and which of their jobs have left / arrived.
  const dayRuns = deliveryRuns.filter((run) => run.deliveryDate === selectedDay);
  const loadedInvoices = new Set(Array.from(loadedJobs).map((ref) => ref.replace(/\D/g, "")).filter(Boolean));
  const arrivedInvoices = new Set(Array.from(arrivedJobs).map((ref) => ref.replace(/\D/g, "")).filter(Boolean));
  const [loadingViewPicked, setLoadingView] = useState<"ready" | "loaded">("ready");
  const loadingView = loadingMode ?? loadingViewPicked;
  // Loading page and Site Check page: Preparing / Verified, each page's own progress.
  // - Loading: Preparing = verified, not yet loaded; Verified = loaded (Submit pressed).
  // - Site Check: Preparing = loaded, panels not yet checked on site; Verified = arrived safely
  //   (Stock Transfers have no site scan, so they count as Verified).
  const [pageStage, setPageStage] = useState<"preparing" | "verified">("preparing");
  const loadPreparing = (t: StockTransaction) => t.type === "out" && isVerifiedTx(t.status) && !isLoadedTx(t);
  const loadVerified = (t: StockTransaction) => t.type === "out" && isLoadedTx(t);
  const sitePreparing = (t: StockTransaction) => isLoadedTx(t) && t.type === "out" && !arrivedJobs.has(t.reference);
  const siteVerified = (t: StockTransaction) => isLoadedTx(t) && (t.type !== "out" || arrivedJobs.has(t.reference));
  const stagePreparing = loadingView === "ready" ? loadPreparing : sitePreparing;
  const stageVerified = loadingView === "ready" ? loadVerified : siteVerified;
  const stagePreparingCount = baseTx.filter(stagePreparing).length;
  const stageVerifiedCount = baseTx.filter(stageVerified).length;
  const isReadyToLoad = (t: StockTransaction) => t.type === "out" && isVerifiedTx(t.status) && !isLoadedTx(t);
  const isSiteCheckTx = (t: StockTransaction) => isLoadedTx(t);
  const readyCount = baseTx.filter(isReadyToLoad).length;
  const siteCheckCount = baseTx.filter(isSiteCheckTx).length;

  // Search: when the customer (or reference) is not on the day shown, go to the day it is on
  // (the one nearest today) and to the tab that holds it.
  const [searchJump, setSearchJump] = useState<string | null>(null);
  useEffect(() => {
    const q = txSearch.trim();
    if (q.length < 2) {
      setSearchJump(null);
      return;
    }
    const timer = window.setTimeout(() => {
      const hits = transactions.filter(
        (tx) =>
          passesFilters(tx) &&
          txMatchesSearch(tx, q) &&
          !!rowDay(tx) &&
          // Only rows this page lists: the Loading page has Loading / Site Check jobs; other
          // pages hide loaded jobs.
          (loadingOnly
            ? loadingMode === "ready"
              ? isReadyToLoad(tx)
              : loadingMode === "loaded"
                ? isLoadedTx(tx)
                : isReadyToLoad(tx) || isLoadedTx(tx)
            : outTabs || !isLoadedTx(tx)),
      );
      const poHits =
        txType === "in"
          ? doFiles.files.filter((file) => {
              const ql = q.toLowerCase();
              return (
                file.fileName.toLowerCase().includes(ql) ||
                file.uploadedBy.toLowerCase().includes(ql) ||
                (file.poLines ?? []).some(
                  (line) => line.itemCode.toLowerCase().includes(ql) || line.description.toLowerCase().includes(ql),
                )
              );
            })
          : [];
      const days = [...hits.map((tx) => rowDay(tx) as string), ...poHits.map((file) => poDay(file))].filter(Boolean);
      if (days.length === 0 || days.includes(selectedDay)) {
        setSearchJump(null);
        return;
      }
      const today = isoToday();
      const distance = (day: string) => Math.abs(new Date(`${day}T00:00:00Z`).getTime() - new Date(`${today}T00:00:00Z`).getTime());
      const day = [...days].sort((a, b) => distance(a) - distance(b) || b.localeCompare(a))[0];
      setSelectedDay(day);
      setSearchJump(day);
      // Open the tab that holds the first match on that day.
      const tx = hits.find((t) => rowDay(t) === day);
      if (loadingOnly) {
        if (tx) {
          setLoadingView(isReadyToLoad(tx) ? "ready" : "loaded");
          if (loadingMode) setPageStage(stageVerified(tx) ? "verified" : "preparing");
        }
      } else if (tx) {
        setTxStatusTab(isVerifiedTx(tx.status) || tx.type === "transfer" ? "verified" : "toVerify");
      } else {
        const file = poHits.find((f) => poDay(f) === day);
        if (file) setTxStatusTab(file.verifiedAt ? "verified" : "toVerify");
      }
    }, 400);
    return () => window.clearTimeout(timer);
    // Runs when the search text changes; the day / tab it sets must not re-run it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [txSearch, txType, whFilter, txCat]);
  const statusTab: TxStatusTab = loadingOnly
    ? loadingView === "ready"
      ? "verified"
      : "loading"
    : txStatusTab === "loading" || txStatusTab === "siteCheck"
      ? "verified" // lists here have no Loading / Site Check tab: those are their own pages
      : isTransferList && txStatusTab === "toVerify"
        ? "verified"
        : txStatusTab;
  // Is the row on the open tab (Loading page: Ready / Loaded; lists: To Verify or Preparing /
  // Verified)?
  const inStatusTab = (t: StockTransaction) =>
    loadingOnly && loadingMode
      ? pageStage === "verified"
        ? stageVerified(t)
        : stagePreparing(t)
      : loadingOnly && loadingView === "ready"
      ? isReadyToLoad(t)
      : statusTab === "loading"
      ? isSiteCheckTx(t)
      : statusTab === "verified"
        ? (isTransferList || isVerifiedTx(t.status)) && (outTabs || !isLoadedTx(t))
        : !isVerifiedTx(t.status);
  const filteredTx = baseTx.filter(inStatusTab);
  // Loading page: each Stock Out job's driver and lorry plate, as typed on its job page.
  const loadingJobRefs = loadingOnly
    ? filteredTx.filter((t) => t.type === "out").map((t) => t.reference).sort().join(",")
    : "";
  const [lorryByJob, setLorryByJob] = useState<Record<string, { driver?: string; plate?: string }>>({});
  useEffect(() => {
    if (!loadingJobRefs) return;
    let cancelled = false;
    fetch(`/api/warehouse/entries?jobs=${encodeURIComponent(loadingJobRefs)}`, { credentials: "same-origin", cache: "no-store" })
      .then(async (res) => (res.ok ? ((await res.json()) as { entries?: { job: string; kind: string; key: string; value: string }[] }) : null))
      .then((data) => {
        if (cancelled || !data?.entries) return;
        const map: Record<string, { driver?: string; plate?: string }> = {};
        data.entries.forEach((entry) => {
          if (entry.kind !== "lorry" || (entry.key !== "driver" && entry.key !== "plate")) return;
          map[entry.job] = { ...map[entry.job], [entry.key]: entry.value };
        });
        setLorryByJob(map);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [loadingJobRefs]);
  // Driver and plate of a Stock Out job: typed on the job page, otherwise the run's driver and
  // plate on the Delivery Schedule (read from the sheet's lorry header, e.g. "WJX 3918").
  const driverOf = (tx: StockTransaction) => lorryByJob[tx.reference]?.driver || etaOf(tx)?.driver || "";
  const lorryOf = (tx: StockTransaction) => lorryByJob[tx.reference]?.plate || etaOf(tx)?.lorry || "";
  const driverGroupKey = (tx: StockTransaction) =>
    tx.type === "out" ? `${driverOf(tx).trim().toUpperCase()}|${lorryOf(tx).trim().toUpperCase()}` : "";
  // Loading page: the table is split by driver. Each driver's customers sit together (drivers in
  // the order their first customer appears, rows keep their order inside); Stock Transfers last.
  const shownTx = (() => {
    if (!loadingOnly) return filteredTx;
    const order: string[] = [];
    const groups = new Map<string, StockTransaction[]>();
    const transfers: StockTransaction[] = [];
    filteredTx.forEach((tx) => {
      if (tx.type !== "out") {
        transfers.push(tx);
        return;
      }
      const key = driverGroupKey(tx);
      if (!groups.has(key)) {
        groups.set(key, []);
        order.push(key);
      }
      groups.get(key)!.push(tx);
    });
    return [...order.flatMap((key) => groups.get(key) ?? []), ...transfers];
  })();
  // Loading page: one row per lorry (driver group), no customer rows. Its slot is the earliest of
  // its customers' slots on the Delivery Schedule.
  const lorryRows = (() => {
    if (!onOpenLorry) return [];
    const rows: { key: string; driver: string; plate: string; txs: StockTransaction[] }[] = [];
    shownTx.forEach((tx) => {
      if (tx.type !== "out") return;
      const key = driverGroupKey(tx);
      const row = rows.find((r) => r.key === key);
      if (row) row.txs.push(tx);
      else rows.push({ key, driver: driverOf(tx), plate: lorryOf(tx), txs: [tx] });
    });
    return rows.map((row) => {
      const slots = row.txs
        .map((tx) => etaOf(tx))
        .filter((eta): eta is NonNullable<typeof eta> => Boolean(eta?.slotDate))
        .sort((a, b) => `${a.slotDate} ${a.slotTime}`.localeCompare(`${b.slotDate} ${b.slotTime}`));
      return { ...row, slot: slots[0] };
    });
  })();
  // The Loading page and Stock Out's Loading tab leave out the Model / Serial and Qty columns.
  const hideItemCols = loadingOnly;
  // The same table rows with any item (the item filter left off): the Stock Out item cards count
  // these, so each card shows what the table holds for that item, and tapping one card does not
  // empty the others.
  const tableRowsAnyItem = transactions.filter(
    (t) =>
      inSelectedDay(t) &&
      txInWarehouse(t, whFilter) &&
      (txType === "all" || t.type === txType) &&
      (!txSearch.trim() || txMatchesSearch(t, txSearch)) &&
      inStatusTab(t),
  );

  // Warehouse-filtered transactions for weekly summary
  const whTx = useMemo(() => {
    return transactions.filter((tx) => {
      const date = txDate(tx);
      if (date === null || date !== selectedDay) return false;
      return txInWarehouse(tx, whFilter);
    });
  }, [transactions, whFilter, selectedDay]);

  // Home buttons show how many VERIFIED of each there are today, for the warehouse chosen on Home.
  const homeCount = (type: "in" | "out" | "transfer") =>
    transactions.filter(
      (tx) => tx.type === type && tx.status === "Verified" && txDate(tx) === isoToday() && txInWarehouse(tx, whFilter),
    ).length;

  // Warehouse Preparation Record: verified Stock Out only, one row per customer + loading date
  // The Report covers the day's verified Stock Transfers on the Stock Transfer list, else Stock Out.
  const prepType: "out" | "transfer" = txType === "transfer" ? "transfer" : "out";
  const prepRows = useMemo(() => {
    const map = new Map<
      string,
      { customer: string; jobId: string; date: string; team: string; items: { model: string; qty: number | null }[] }
    >();
    whTx
      .filter((t) => t.type === prepType && t.status === "Verified")
      .forEach((t) => {
        const customer = t.schedule?.customerName ?? t.party;
        const date = (t.schedule?.scheduledDate ?? t.time).replace(/\s*\(.*?\)\s*$/, "");
        const key = `${customer}|${date}`;
        const row =
          map.get(key) ??
          { customer, jobId: t.schedule?.jobId ?? t.reference, date, team: t.schedule?.installerTeam ?? "", items: [] };
        txLines(t).forEach((line) => row.items.push({ model: line.model, qty: line.qty }));
        map.set(key, row);
      });
    return Array.from(map.values());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [whTx, prepType]);
  const prepCustomerCount = new Set(prepRows.map((r) => r.customer)).size;
  // The mounting parts loaded for the day's verified jobs (saved quantities), added up per part.
  const [prepEntries, setPrepEntries] = useState<{ job: string; kind: string; key: string; value: string }[]>([]);
  const prepJobList = Array.from(new Set(prepRows.map((r) => r.jobId))).join(",");
  useEffect(() => {
    if (!prepReportOpen || !prepJobList) {
      setPrepEntries([]);
      return;
    }
    let cancelled = false;
    fetch(`/api/warehouse/entries?jobs=${encodeURIComponent(prepJobList)}`, { credentials: "same-origin", cache: "no-store" })
      .then(async (res) => (res.ok ? ((await res.json()) as { entries?: typeof prepEntries }).entries ?? [] : []))
      .then((entries) => {
        if (!cancelled) setPrepEntries(entries);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [prepReportOpen, prepJobList]);
  const prepMountingGroups = (() => {
    const groupOf = new Map<string, string>();
    MOUNTING_SYSTEMS.forEach((system) =>
      system.groups.forEach((group) => group.parts.forEach((part) => !groupOf.has(part.name) && groupOf.set(part.name, group.label))),
    );
    const totals = new Map<string, number>();
    prepEntries
      .filter((entry) => entry.kind === "mounting_part")
      .forEach((entry) => totals.set(entry.key, (totals.get(entry.key) ?? 0) + (Number(entry.value) || 0)));
    const order = ["Rail", "Hook & Bracket", "Clamp"];
    return order
      .map((label) => ({
        label,
        parts: Array.from(totals.entries())
          .filter(([name, total]) => total > 0 && (groupOf.get(name) ?? "Hook & Bracket") === label)
          .map(([name, total]) => ({ name, total })),
      }))
      .filter((group) => group.parts.length > 0);
  })();

  // Who completed each material for the day's verified jobs (names from the saved records).
  const prepJobIds = new Set(prepRows.map((r) => r.jobId));
  // Saved records, plus the TEST_VERIFIED_DATE jobs' test names (the same ones their job page
  // shows), so the Item List matches the job page.
  const prepRecords = [
    ...verifications,
    ...whTx
      .filter((t) => t.type === "out" && t.status === "Verified")
      .flatMap((t) =>
        Object.entries(testPreparedBy(t)).map(([material, by]) => ({ jobRef: t.reference, material, by })),
      ),
  ];
  const namesFor = (materials: string[]) =>
    Array.from(
      new Set(
        prepRecords
          .filter((r) => prepJobIds.has(r.jobRef) && materials.includes(r.material) && r.by)
          .map((r) => r.by),
      ),
    ).join(", ");
  // Prepared By / Packed By: starts from who completed that item on Stock Out Verification
  // (mounting is packed in two parts: rail, and hook & bracket), else who verified the job; on the
  // Stock Transfer list, who made the transfers holding that item. Can be edited.
  const transferNamesFor = (item: string) =>
    Array.from(
      new Set(
        whTx
          .filter(
            (t) =>
              t.type === "transfer" &&
              t.status === "Verified" &&
              txLines(t).some((line) => line.category === item) &&
              !!t.transfer?.requestedBy,
          )
          .map((t) => t.transfer?.requestedBy as string),
      ),
    ).join(", ");
  const byValue = (id: string) =>
    prepType === "transfer"
      ? transferNamesFor(id)
      : namesFor(id === "mounting" ? ["mounting", "mounting_rail", "mounting_hook"] : [id]) || namesFor(["job"]);
  // Checked by: who pressed 🚚 Loading on the day's verified jobs (Stock Out) or transfers.
  const checkedByDefault = Array.from(
    new Set(
      verifications
        .filter(
          (r) =>
            r.material === "loaded" &&
            !!r.by &&
            (prepType === "transfer"
              ? whTx.some((t) => t.type === "transfer" && t.reference === r.jobRef && t.status === "Verified")
              : prepJobIds.has(r.jobRef)),
        )
        .map((r) => r.by),
    ),
  ).join(", ");
  // One section per item for the day's verified jobs. An item nobody has (for example no
  // battery) is left out. Panel, inverter and battery show the number of units; mounting
  // structure and electrical accessories have no quantity on the invoice, so they show how
  // many customers (sets) need them.
  const prepItems = (() => {
    const defs: { id: string; label: string; icon: string; bulk: boolean }[] = [
      { id: "panel", label: "Panel", icon: "☀️", bulk: false },
      { id: "inverter", label: "Inverter", icon: "⚡", bulk: false },
      { id: "battery", label: "Battery", icon: "🔋", bulk: false },
      { id: "mounting", label: "Mounting Structure", icon: "📦", bulk: true },
      { id: "electrical", label: "Electrical Item", icon: "🔌", bulk: true },
    ];
    const verifiedOut = whTx.filter((t) => t.type === prepType && t.status === "Verified");
    return defs
      .map((def) => {
        let units = 0;
        let jobs = 0;
        verifiedOut.forEach((t) => {
          const lines = txLines(t).filter((line) => line.category === def.id);
          // Every install needs electrical items, even when the invoice names none.
          if (lines.length === 0 && def.id !== "electrical") return;
          jobs += 1;
          units += lines.reduce((sum, line) => sum + (line.qty ?? 0), 0);
        });
        return { ...def, units, jobs };
      })
      .filter((item) => item.jobs > 0 && (item.bulk || item.units > 0));
  })();

  // The day's verified customers, in loading order (one line each in Mounting Structure).
  const prepCustomers = Array.from(new Set(prepRows.map((r) => r.customer)));

  // The Stock In / Stock Out / Stock Transfer cards count how many were done (verified) on the
  // selected day, not units. With an Inverter / Panel / ... card picked, only records holding
  // that item count. Stock In rows are uploaded POs (on their PO date, as in the table); POs
  // carry no warehouse, so they count whichever warehouse button is on (the table shows them too).
  const doneCount = (type: "in" | "out" | "transfer") =>
    whTx.filter((t) => t.type === type && t.status === "Verified" && (txCat === "all" || txHasCategory(t, txCat))).length +
    (type === "in"
      ? doFiles.files.filter(
          (file) => !!file.verifiedAt && poDay(file) === selectedDay && (txCat === "all" || file.itemType === txCat),
        ).length
      : 0);



  // Stock Out card: every verified Stock Out job, whatever day is picked (the warehouse and
  // item filters still apply).
  const totalOut = transactions.filter((t) => t.type === "out" && t.status === "Verified" && passesFilters(t)).length;

  // Item cards under Total Out: what the table below holds, split by item (the picked day,
  // warehouse, search and open tab all apply; the item filter does not, since each card is its
  // own item and tapping one sets it). Panel, inverter and battery count units; mounting
  // structure and electrical items have no quantity on the invoice, so they count jobs (sets).
  // Every install needs electrical items, even when the invoice names none.
  const outItems = (() => {
    const outRows = tableRowsAnyItem.filter((t) => t.type === "out");
    const defs: { id: string; label: string; short: string; bulk: boolean }[] = [
      { id: "panel", label: "Panel", short: "Panel", bulk: false },
      { id: "inverter", label: "Inverter", short: "Inv.", bulk: false },
      { id: "battery", label: "Battery", short: "Batt.", bulk: false },
      { id: "mounting", label: "Mounting Structure", short: "Mounting", bulk: true },
      { id: "electrical", label: "Electrical Item", short: "Electrical", bulk: true },
    ];
    return defs.map((def) => {
      let units = 0;
      let jobs = 0;
      outRows.forEach((t) => {
        const lines = txLines(t).filter((line) => line.category === def.id);
        if (lines.length === 0 && def.id !== "electrical") return;
        jobs += 1;
        units += lines.reduce((sum, line) => sum + (line.qty ?? 0), 0);
      });
      return { ...def, count: def.bulk ? jobs : units, unit: def.bulk ? (jobs === 1 ? "set" : "sets") : units === 1 ? "unit" : "units" };
    });
  })();

  const openPo = openPoId ? doFiles.files.find((file) => file.id === openPoId) : undefined;
  if (openPo) {
    return (
      <PoVerificationPage
        file={openPo}
        onBack={() => setOpenPoId(null)}
        onVerified={(verifiedAt, verifiedBy) => doFiles.markVerified(openPo.id, verifiedAt, verifiedBy)}
      />
    );
  }

  return (
    <section className={styles.screen} aria-labelledby="warehouse-home">
      <div className={styles.head}>
        <div>
          {showTx && !loadingOnly && (
            <button
            className={styles.back}
            type="button"
            onClick={() => {
              setTxType("all");
              onShowTx(false);
            }}
          >
              Back
            </button>
          )}
        </div>
        {showTx && !loadingOnly && (
          <div style={{ display: "flex", gap: "8px", alignItems: "center" }}>
            {txType === "in" && canUpload && (
              <UploadDoButton
                busy={doFiles.busy}
                onFile={(file) =>
                  void doFiles.upload(file).then((day) => {
                    if (!day) return;
                    // Show the new PO row: its PO date's To Verify list, scrolled into view.
                    setSelectedDay(day);
                    setTxStatusTab("toVerify");
                    setTxSearch("");
                    setTimeout(() => txTableRef.current?.scrollIntoView({ block: "start" }), 150);
                  })
                }
              />
            )}
            {/* Stock Transfer: start a new transfer (opens Stock Transfer Verification), beside
                Report like Upload PO on Stock In */}
            {txType === "transfer" && (
              <button
                type="button"
                className={styles.btnActionGhost}
                style={{ background: "#bf9000", borderColor: "#bf9000", color: "#fff", fontWeight: 700 }}
                onClick={onOpenTransfer}
              >
                + New Transfer
              </button>
            )}
            {/* Stock Out: a last-minute item taken by the PIC (any signed-in user), beside Report */}
            {txType === "out" && (
              <button
                type="button"
                className={styles.btnActionGhost}
                style={{ background: "#bf9000", borderColor: "#bf9000", color: "#fff", fontWeight: 700 }}
                onClick={onNewStockOut}
              >
                + New Stock Out
              </button>
            )}
            {/* Stock Out (Preparing and Verified) calls it "Item List" */}
            <button type="button" className={styles.btnActionGhost} onClick={() => setPrepReportOpen(true)}>
              {outTabs ? "Item List" : "Report"}
            </button>
          </div>
        )}
      </div>

      {!showTx && (
        <>
      {/* Warehouse filter selector for Home */}
      {/* Same JB / KL / Kluang buttons as Stock Details */}
      <div className={styles.filterRow} style={{ width: "50%", minWidth: "175px", marginLeft: "auto" }}>
        {WH_FILTERS.map((value) => (
          <button
            key={value}
            type="button"
            className={`${styles.filterBtn} ${whFilter === value ? styles.filterActive : ""}`}
            style={{ fontSize: "11px", padding: "3px 4px" }}
            onClick={() => setWhFilter((cur) => (cur === value ? "all" : value))}
          >
            {WH_BUTTON_LABEL[value]}
          </button>
        ))}
      </div>

          {/* 1. Stock Balance Cards for Inverter, Panel, Battery (On hand only) — Single row for desktop & phone */}
          <StockBalanceCards
            whFilter={whFilter}
            onCardClick={(item) => onOpenStock(item, whFilter)}
            tooltip={(label) => `Open ${label} in Stock Details`}
            hideWhLabels
          />

          {/* Entry buttons: Stock In, Stock Out, then Stock Transfer */}
          <div className={styles.homeButtons}>
            <button
              type="button"
              className={styles.homeButton}
              onClick={() => {
                setTxType("in");
                onShowTx(true);
              }}
            >
              <span>Stock In</span>
              <span className={styles.homeButtonCount}>{homeCount("in")}</span>
            </button>
            <button
              type="button"
              className={styles.homeButton}
              onClick={() => {
                setTxType("out");
                onShowTx(true);
              }}
            >
              <span>Stock Out</span>
              <span className={styles.homeButtonCount}>{homeCount("out")}</span>
            </button>
            <button
              type="button"
              className={styles.homeButton}
              onClick={() => {
                setTxType("transfer");
                onShowTx(true);
              }}
            >
              <span>Stock Transfer</span>
              <span className={styles.homeButtonCount}>{homeCount("transfer")}</span>
            </button>
          </div>

        </>
      )}

          {/* 2. Stock In and Stock Out Transaction Table at the bottom (This Week) */}
          <div
            className={styles.txSection}
            ref={txSectionRef}
            style={!showTx ? { display: "none" } : undefined}
          >
            {txType === "in" && (doFiles.message || (doFiles.error && doFiles.files.length === 0)) && (
              <p
                className={styles.note}
                style={{ margin: "0 0 12px", color: doFiles.message?.ok ? "var(--green)" : "#b91c1c" }}
              >
                {doFiles.message?.text ?? doFiles.error}
              </p>
            )}
            <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", justifyContent: "space-between", gap: "10px", marginBottom: "12px" }}>
        <h2 className={styles.sectionTitle} style={{ margin: 0, fontSize: "24px", fontWeight: 700, color: "#000" }}>
          {loadingOnly ? (loadingMode === "loaded" ? "Site Check" : "Loading") : txType === "in" ? "Stock In" : txType === "out" ? "Stock Out" : txType === "transfer" ? "Stock Transfer" : "Stock Transactions"}{txCat !== "all" ? ` · ${CAT_LABEL[txCat] === "Inv." ? "Inverter" : CAT_LABEL[txCat] === "Batt." ? "Battery" : CAT_LABEL[txCat] === "Mounting" ? "Mounting Structure" : CAT_LABEL[txCat] === "Electrical" ? "Electrical Item" : (CAT_LABEL[txCat] ?? txCat)}` : ""}
        </h2>
            </div>
            {/* Same JB / KL / Kluang buttons as the Home page */}
            <div className={styles.filterRow} role="group" aria-label="Warehouse filter" style={{ width: "50%", minWidth: "175px", marginLeft: "auto" }}>
              {WH_FILTERS.map((wh) => (
                <button
                  key={wh}
                  type="button"
                  className={`${styles.filterBtn} ${whFilter === wh ? styles.filterActive : ""}`}
                  style={{ fontSize: "11px", padding: "3px 4px" }}
                  onClick={() => setWhFilter((cur) => (cur === wh ? "all" : wh))}
                >
                  {WH_BUTTON_LABEL[wh]}
                </button>
              ))}
            </div>
            {/* In / Out KPI summary chips for This Week with Inverter, Panel, Battery Breakdown */}
            <div className={styles.txSummaryRow} style={{ marginBottom: "24px" }}>
              {/* Loading page: total moved out on the day (Stock Out + Stock Transfer) */}
              {loadingOnly && (
                <div className={styles.txKpiCard}>
                  <div className={styles.txKpiHeader}>
                    <div className={styles.txKpiTitles}>
                      <span className={styles.txKpiLabel}>{isToday ? "Today Loading" : "Day Loading"}</span>
                    </div>
                    <span className={`${styles.txKpiValue} ${styles.txKpiOut}`}>
                      {loadingCount} <span className={styles.txKpiUnit}>loaded</span>
                    </span>
                  </div>
                </div>
              )}
              {/* Stock Transfer: the day's verified transfers */}
              {txType === "transfer" && (
                <div className={styles.txKpiCard}>
                  <div className={styles.txKpiHeader}>
                    <div className={styles.txKpiTitles}>
                      <span className={styles.txKpiLabel}>{isToday ? "Today Transfer" : "Day Transfer"}</span>
                      <small className={styles.txKpiSub}>Inter-WH rebalance</small>
                    </div>
                    <span className={`${styles.txKpiValue} ${styles.txQtyTransfer}`}>
                      {doneCount("transfer")}{" "}
                      <span className={styles.txKpiUnit}>{doneCount("transfer") === 1 ? "transfer" : "transfers"}</span>
                    </span>
                  </div>
                </div>
              )}
              {/* Today In: not shown on the Stock Out or Stock Transfer screen */}
              {!loadingOnly && txType !== "out" && txType !== "transfer" && (
                <div className={styles.txKpiCard}>
                  <div className={styles.txKpiHeader}>
                    <div className={styles.txKpiTitles}>
                      <span className={styles.txKpiLabel}>{isToday ? "Today In" : "Day In"}</span>
                      <small className={styles.txKpiSub}>
                        Supplier deliveries
                      </small>
                    </div>
                    <span className={`${styles.txKpiValue} ${styles.txKpiIn}`}>
                      {doneCount("in")} <span className={styles.txKpiUnit}>{doneCount("in") === 1 ? "PO" : "POs"}</span>
                    </span>
                  </div>
                </div>
              )}

              {/* Today Out: not shown on the Stock In or Stock Transfer screen */}
              {!loadingOnly && txType !== "in" && txType !== "transfer" && (
                <div className={styles.txKpiCard}>
                  <div className={styles.txKpiHeader}>
                    <div className={styles.txKpiTitles}>
                      <span className={styles.txKpiLabel}>Total Out</span>
                      <small className={styles.txKpiSub}>
                        Items Preparation Completed
                      </small>
                    </div>
                    <span className={`${styles.txKpiValue} ${styles.txKpiOut}`}>
                      {totalOut} <span className={styles.txKpiUnit}>{totalOut === 1 ? "job" : "jobs"}</span>
                    </span>
                  </div>
                </div>
              )}
            </div>


            {/* Loading page: a delivery-app style lorry tracker per run of the day, above the date.
                Hidden for now: set SHOW_LORRY_TIMELINE to true to bring it back. */}
            {SHOW_LORRY_TIMELINE && loadingOnly && (
              <LorryTimeline runs={dayRuns} loaded={loadedInvoices} arrived={arrivedInvoices} />
            )}

            <div className={styles.balanceHeaderRow}>
              <div>
                <p className={styles.kicker} style={{ margin: "2px 0 0", color: "#000" }}>
                  {dayLabel}
                </p>
              </div>
              {/* ‹ calendar › : previous day, pick a day, next day */}
              <DateNav
                value={selectedDay}
                onPick={setSelectedDay}
                onPrev={() => setSelectedDay((d) => shiftIso(d, -1))}
                onNext={() => setSelectedDay((d) => shiftIso(d, 1))}
              />
            </div>

            {/* Status tabs + search on one row */}
            <div className={styles.txTabsSearchRow}>
            {loadingOnly && loadingMode ? (
              // Loading page / Site Check page: Preparing and Verified (that page's own progress)
              <div className={styles.txFilterPills} role="tablist" aria-label={loadingMode === "ready" ? "Loading" : "Site Check"}>
                <button
                  type="button"
                  role="tab"
                  aria-selected={pageStage === "preparing"}
                  className={`${styles.txPill} ${pageStage === "preparing" ? styles.txPillActive : ""}`}
                  onClick={() => setPageStage("preparing")}
                  title={loadingMode === "ready" ? "Verified jobs not yet loaded onto the lorry" : "Loaded jobs whose panels are not yet checked on site"}
                >
                  Preparing ({stagePreparingCount})
                </button>
                <button
                  type="button"
                  role="tab"
                  aria-selected={pageStage === "verified"}
                  className={`${styles.txPill} ${pageStage === "verified" ? styles.txPillActive : ""}`}
                  onClick={() => setPageStage("verified")}
                  title={loadingMode === "ready" ? "Jobs loaded onto the lorry (Submit pressed)" : "Jobs checked on site: arrived safely"}
                >
                  Verified ({stageVerifiedCount})
                </button>
              </div>
            ) : loadingOnly ? (
            <div className={styles.txFilterPills} role="tablist" aria-label="Loading">
              <button
                type="button"
                role="tab"
                aria-selected={loadingView === "ready"}
                className={`${styles.txPill} ${loadingView === "ready" ? styles.txPillActive : ""}`}
                onClick={() => setLoadingView("ready")}
                title="Verified Stock Out jobs to load onto the lorry (Submit moves them to Site Check)"
              >
                Loading ({readyCount})
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={loadingView === "loaded"}
                className={`${styles.txPill} ${loadingView === "loaded" ? styles.txPillActive : ""}`}
                onClick={() => setLoadingView("loaded")}
                title="Loaded Stock Out jobs (scan each panel on site, then Submit), and Stock Transfers moved out"
              >
                Site Check ({siteCheckCount})
              </button>
            </div>
            ) : (
            <div className={styles.txFilterPills} role="tablist" aria-label="Transaction status">
              {!isTransferList && (
                <button
                  type="button"
                  role="tab"
                  aria-selected={txStatusTab === "toVerify"}
                  className={`${styles.txPill} ${txStatusTab === "toVerify" ? styles.txPillActive : ""}`}
                  onClick={() => setTxStatusTab("toVerify")}
                >
                  {outTabs ? "Preparing" : "To Verify"} ({toVerifyCount})
                </button>
              )}
              {/* Stock Out: Preparing and Verified (Loading and Site Check are their own pages) */}
              {(
                <button
                  type="button"
                  role="tab"
                  aria-selected={statusTab === "verified"}
                  className={`${styles.txPill} ${statusTab === "verified" ? styles.txPillActive : ""}`}
                  onClick={() => setTxStatusTab("verified")}
                >
                  Verified ({verifiedCount})
                </button>
              )}
            </div>
            )}

              <input
                type="search"
                className={`${styles.txSearchInput} ${styles.searchCompact}`}
                placeholder="Search reference, customer, model..."
                value={txSearch}
                onChange={(e) => setTxSearch(e.target.value)}
                aria-label="Search transactions"
              />
            </div>
            {searchJump && searchJump === selectedDay && txSearch.trim() && (
              <p className={styles.note} style={{ margin: "0 0 8px" }}>
                Found on {getDayLabel(searchJump)}: moved to that day.
              </p>
            )}

            {/* Stock Out and the Loading page: one card per item, above the table.
                Tap a card to show only jobs with that item; tap it again to show all. */}
            {(loadingOnly || txType === "out") && (
              <div className={styles.outItemGrid} role="group" aria-label="Stock Out by item">
                {outItems.map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    className={`${styles.txKpiCatChip} ${styles.outItemCard} ${txCat === item.id ? styles.balanceCardActive : ""}`}
                    aria-pressed={txCat === item.id}
                    title={txCat === item.id ? "Show all items" : `Show only jobs with ${item.label}`}
                    onClick={() => setTxCat((cur) => (cur === item.id ? "all" : item.id))}
                  >
                    <span className={styles.txKpiCatName}>
                      <span className={styles.catLabelFull}>{item.label}</span>
                      <span className={styles.catLabelShort}>{item.short}</span>
                    </span>
                    <span className={styles.txKpiCatValOut}>
                      {item.count} <span className={styles.txKpiUnit}>{item.unit}</span>
                    </span>
                  </button>
                ))}
              </div>
            )}

            {/* Stock Out › Preparing, Loading and Site Check: the list goes by installation date */}
            {outTabs && (
              <p className={styles.note} style={{ margin: "0 0 6px", color: "#000", fontSize: "10px" }}>
                Table follows installation date.
              </p>
            )}

            {/* Loading page only (not Stock Out's Loading tab): the list goes by slot date */}
            {loadingOnly && (
              // The note on the left; the Type column's marks explained on the right
              <div className={styles.loadingNoteRow}>
                <p className={styles.note} style={{ margin: 0, color: "#000", fontSize: "10px" }}>
                  Table follows slot/ loading date.
                </p>
                <p className={styles.note} style={{ margin: 0, color: "#000", fontSize: "10px" }} aria-label="Type legend">
                  <span style={{ color: "var(--green)" }}>▲</span> Stock In
                  <span style={{ marginLeft: "10px", color: "var(--red)" }}>▼</span> Stock Out
                  <span style={{ marginLeft: "10px", color: "#0284c7" }}>⇄</span> Stock Transfer
                </p>
              </div>
            )}

            {/* Transaction Ledger Table */}
            {onOpenLorry ? (
              // Loading page: one row per lorry; a row opens that lorry's page (its customers)
              lorryRows.length === 0 ? (
                <p className={styles.note}>No lorry to show for this day.</p>
              ) : (
                <div className={styles.tableWrap} ref={txTableRef}>
                  <table className={`${styles.detailTable} ${styles.txLedger} ${styles.txLedgerLoading} ${styles.lorryRowsTable}`}>
                    <thead>
                      <tr>
                        <th scope="col">Slot</th>
                        <th scope="col">Driver</th>
                        <th scope="col">Plate No</th>
                        <th scope="col">Customers</th>
                        <th scope="col">Type</th>
                      </tr>
                    </thead>
                    <tbody>
                      {lorryRows.map((row) => {
                        const open = () =>
                          onOpenLorry({ driver: row.driver, plate: row.plate, txIds: row.txs.map((t) => t.id), stage: pageStage, day: selectedDay });
                        const slotTime = row.slot ? sheetClock(row.slot.slotTime) || row.slot.slotTime : "";
                        return (
                          <tr
                            key={row.key}
                            className={`${styles.loadingPicRow} ${styles.loadingPicRowClickable}`}
                            tabIndex={0}
                            role="button"
                            title="Open this lorry's loading page"
                            onClick={open}
                            onKeyDown={(e) => {
                              if (e.key === "Enter" || e.key === " ") {
                                e.preventDefault();
                                open();
                              }
                            }}
                          >
                            <td style={{ whiteSpace: "nowrap" }}>
                              {row.slot ? (
                                <>
                                  {isoDateLabel(row.slot.slotDate)}
                                  {slotTime && <div>{slotTime}</div>}
                                </>
                              ) : (
                                "—"
                              )}
                            </td>
                            <td>
                              <span className={styles.loadingPicValue}>{row.driver || "—"}</span>
                            </td>
                            <td style={{ whiteSpace: "nowrap" }}>
                              <span className={styles.loadingPicValue}>{row.plate || "—"}</span>
                            </td>
                            <td>
                              {row.txs.map((tx) => (
                                <div key={tx.id}>{tx.schedule?.customerName ?? tx.party}</div>
                              ))}
                            </td>
                            <td>
                              {/* A lorry carries Stock Out jobs: the same ▼ mark as Stock Details */}
                              <span
                                role="img"
                                aria-label="Stock Out"
                                title="Stock Out"
                                className={`${styles.txTypeText} ${styles.txTypeOut}`}
                                style={{ fontSize: "13px", color: "var(--red)" }}
                              >
                                ▼
                              </span>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )
            ) : filteredTx.length === 0 && shownPoRows.length === 0 ? (
              <p className={styles.note}>No stock transactions match your filter criteria.</p>
            ) : (
              <div className={styles.tableWrap} ref={txTableRef}>
                <table className={`${styles.detailTable} ${styles.txLedger} ${txType === "out" && !hideItemCols ? styles.txLedgerOut : ""} ${hideItemCols ? styles.txLedgerLoading : ""} ${txType === "in" ? styles.txLedgerIn : ""}`}>
                  <thead>
                    <tr>
                      {/* Loading page: Slot first, before the customer */}
                      {hideItemCols && <th scope="col">Slot</th>}
                      <th scope="col">{loadingOnly ? "Customer / Transfer No." : txType === "in" ? "PO Number" : txType === "transfer" ? "Transfer No." : "Customer Name"}</th>
                      {txType === "in" && <th scope="col">Item Type</th>}
                      {/* No Model / Serial or Qty columns on the Loading page or Stock Out's Loading tab */}
                      {!hideItemCols && <th scope="col">{txType === "in" ? "Item Code" : "Model / Serial"}</th>}
                      {!hideItemCols && <th scope="col" className={styles.num}>Qty</th>}
                      {txType === "all" && <th scope="col">Type</th>}
                      {/* Loading page and Stock Out's Loading tab: Slot and ETA (from the Delivery
                          Schedule), then Installation Date */}
                      {hideItemCols && <th scope="col">ETA</th>}
                      <th scope="col" className={hideItemCols ? styles.instDateCol : undefined}>Installation Date</th>
                    </tr>
                  </thead>
                  <tbody>
                    {shownPoRows.map((file) => {
                      // One table row per PO line, so each item code and its qty share a row (and
                      // stay level however the description wraps). PO number, item type and date
                      // span all of the PO's rows.
                      const poLines = file.poLines?.length ? file.poLines : null;
                      const span = poLines ? poLines.length : 1;
                      const open = () => setOpenPoId(file.id);
                      const rowProps = {
                        className: styles.txRowClickable,
                        tabIndex: 0,
                        title: file.verifiedAt ? "Verified — tap to view" : "To Verify — tap to scan the units received",
                        onClick: open,
                        onKeyDown: (e: React.KeyboardEvent) => {
                          if (e.key === "Enter" || e.key === " ") {
                            e.preventDefault();
                            open();
                          }
                        },
                      };
                      const codeCell = (line: { itemCode: string; description: string } | null) => (
                        <td>
                          {line ? (
                            <>
                              <strong>{line.itemCode}</strong>
                              <span className={styles.txInvoiceNo} style={{ display: "block", color: "var(--muted)" }}>
                                {line.description}
                              </span>
                            </>
                          ) : (
                            <strong>Purchase Order (PO)</strong>
                          )}
                        </td>
                      );
                      const qtyCell = (qty: number | null) => (
                        <td className={`${styles.num} ${styles.txQtyIn}`}>{qty === null ? "—" : qty.toLocaleString("en-MY")}</td>
                      );
                      return (
                        <Fragment key={`po-${file.id}`}>
                          <tr {...rowProps}>
                            <td className={styles.txRefCell} rowSpan={span}>
                              <span className={styles.txCustName}>{file.fileName}</span>
                              <span className={`${styles.txParty} ${styles.txInvoiceNo}`}>
                                {file.uploadedBy ? `uploaded by ${file.uploadedBy}` : ""}
                              </span>
                            </td>
                            <td rowSpan={span}>
                              {canUpload ? (
                                <select
                                  className={styles.poItemTypeSelect}
                                  value={file.itemType}
                                  aria-label={`Item type for ${file.fileName}`}
                                  onClick={(e) => e.stopPropagation()}
                                  onKeyDown={(e) => e.stopPropagation()}
                                  onChange={(e) => void doFiles.setItemType(file.id, e.target.value)}
                                >
                                  {!file.itemType && <option value="">Choose…</option>}
                                  {PO_ITEM_TYPE_OPTIONS.map(([value, label]) => (
                                    <option key={value} value={value}>
                                      {label}
                                    </option>
                                  ))}
                                </select>
                              ) : (
                                itemTypeLabel(file.itemType)
                              )}
                            </td>
                            {codeCell(poLines ? poLines[0] : null)}
                            {qtyCell(poLines ? poLines[0].qty : null)}
                            <td className={styles.poDateCell} rowSpan={span} style={{ whiteSpace: "nowrap", fontSize: "12px", color: "#000" }}>
                              {isoDateLabel(poDay(file))}
                            </td>
                          </tr>
                          {(poLines ?? []).slice(1).map((line, n) => (
                            <tr key={n} {...rowProps} className={`${styles.txRowClickable} ${styles.poLineRow}`}>
                              {codeCell(line)}
                              {qtyCell(line.qty)}
                            </tr>
                          ))}
                        </Fragment>
                      );
                    })}
                    {shownTx.map((tx, i) => (
                      <Fragment key={tx.id}>
                      {/* Site Check page: one band per driver, above that driver's customers */}
                      {loadingOnly && tx.type === "out" && (i === 0 || driverGroupKey(shownTx[i - 1]) !== driverGroupKey(tx)) && (
                        <tr className={styles.loadingPicRow}>
                          <td colSpan={2 + 2 + (txType === "in" ? 1 : 0) + (txType === "all" ? 1 : 0)}>
                            {/* Like the Delivery Schedule band: a small label above each value */}
                            <div className={styles.loadingPicFields}>
                              <div className={styles.loadingPicField}>
                                <span className={styles.loadingPicLabel}>Driver</span>
                                <span className={styles.loadingPicValue}>{driverOf(tx) || "—"}</span>
                              </div>
                              <div className={styles.loadingPicField}>
                                <span className={styles.loadingPicLabel}>Plate No</span>
                                <span className={styles.loadingPicValue}>{lorryOf(tx) || "—"}</span>
                              </div>
                            </div>
                          </td>
                        </tr>
                      )}
                      <tr
                        className={styles.txRowClickable}
                        tabIndex={0}
                        onClick={() => onInspectTx(tx.id)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter" || e.key === " ") {
                            e.preventDefault();
                            onInspectTx(tx.id);
                          }
                        }}
                        title={
                          tx.status === "To Verify"
                            ? "To Verify — tap to inspect"
                            : tx.status === "Inspected"
                            ? "Inspected (issue) — tap to open"
                            : "Verified — tap to view"
                        }
                      >
                        {hideItemCols && (
                          <td style={{ whiteSpace: "nowrap", fontSize: "12px", color: "#000" }}>
                            {(() => {
                              const eta = etaOf(tx);
                              if (!eta?.slotDate) return "—";
                              const time = sheetClock(eta.slotTime) || eta.slotTime;
                              return (
                                <>
                                  {isoDateLabel(eta.slotDate)}
                                  {time && <div style={{ color: "#555" }}>{time}</div>}
                                </>
                              );
                            })()}
                          </td>
                        )}
                        <td className={styles.txRefCell}>
                          {tx.type === "transfer" ? (
                            <>
                              <span className={styles.txCustName}>{tx.transfer?.transferNo ?? tx.reference}</span>
                              <span className={`${styles.txParty} ${styles.txInvoiceNo}`}>
                                {tx.transfer ? `${tx.transfer.fromWarehouse} → ${tx.transfer.toWarehouse}` : tx.party}
                              </span>
                            </>
                          ) : (
                            <>
                              <span className={styles.txCustName}>
                                {tx.party}
                                {tx.extra && (
                                  <span
                                    className={`${styles.tag} ${styles.order}`}
                                    style={{ marginLeft: "6px", fontSize: "10px", padding: "1px 6px", verticalAlign: "middle" }}
                                    title={`Last-minute item taken by ${tx.extra.takenBy}`}
                                  >
                                    Extra
                                  </span>
                                )}
                              </span>
                              <span className={`${styles.txParty} ${styles.txInvoiceNo}`}>
                                {tx.reference}
                                {tx.extra?.linkedJob ? ` · for #${tx.extra.linkedJob}` : ""}
                              </span>
                            </>
                          )}
                          {tx.status === "Inspected" && tx.issueRemark && (
                            <div className={styles.issueRemarkTag}>
                              ⚠️ {tx.issueRemark}
                            </div>
                          )}
                        </td>
                        {txType === "in" && (
                          <td>{Array.from(new Set(txLines(tx).map((line) => itemTypeLabel(line.category)))).join(", ")}</td>
                        )}
                        {!hideItemCols && (
                          <>
                          <td>
                            {tx.lines ? (
                              tx.lines.map((line) => (
                                <div key={line.model} className={styles.txItem}>
                                  <strong className={styles.txItemText} title={line.model}>
                                    {line.model}
                                  </strong>
                                </div>
                              ))
                            ) : (
                              <strong>{tx.model}</strong>
                            )}
                            {/* Phone only; not on the Stock Out list (its "SN-INV-…" code is not a real serial) */}
                            {txType !== "out" && (
                              <span className={`${styles.code} ${styles.serialUnder} ${styles.mobileOnly}`}>
                                {tx.serialCode}
                              </span>
                            )}
                          </td>
                          <td
                            className={`${styles.num} ${
                              tx.type === "in"
                                ? styles.txQtyIn
                                : tx.type === "out"
                                ? styles.txQtyOut
                                : styles.txQtyTransfer
                            }`}
                          >
                            {tx.type === "out" && tx.lines
                              ? tx.lines.map((line) => (
                                  <div key={line.model} className={`${styles.txItem} ${styles.txItemEnd}`}>
                                    {line.qty === null ? "—" : line.qty}
                                  </div>
                                ))
                              : tx.type === "in"
                              ? `${tx.qty}`
                              : tx.type === "out"
                              ? `${tx.qty}`
                              : `${tx.qty}`}
                          </td>
                          </>
                        )}
                        {txType === "all" && (
                        <td>
                          <span
                            className={`${styles.txTypeText} ${
                              tx.type === "in"
                                ? styles.txTypeIn
                                : tx.type === "out"
                                ? styles.txTypeOut
                                : styles.txTypeTransfer
                            }`}
                          >
                            {loadingOnly ? (
                              // Loading page: a mark instead of the word (name on hover / for screen readers)
                              <span
                                role="img"
                                aria-label={tx.type === "in" ? "Stock In" : tx.type === "out" ? "Stock Out" : "Stock Transfer"}
                                title={tx.type === "in" ? "Stock In" : tx.type === "out" ? "Stock Out" : "Stock Transfer"}
                                style={{
                                  fontSize: "13px",
                                  color: tx.type === "in" ? "var(--green)" : tx.type === "out" ? "var(--red)" : "#0284c7",
                                }}
                              >
                                {/* Same marks as Stock Details: ▲ stock in, ▼ stock out; ⇄ transfer */}
                                {tx.type === "in" ? "▲" : tx.type === "out" ? "▼" : "⇄"}
                              </span>
                            ) : tx.type === "in" ? (
                              "IN"
                            ) : tx.type === "out" ? (
                              "OUT"
                            ) : (
                              "TRANSFER"
                            )}
                          </span>
                        </td>
                        )}
                        {hideItemCols && (
                          <td style={{ whiteSpace: "nowrap", fontSize: "12px", color: "#000" }}>
                            {(() => {
                              const eta = etaOf(tx);
                              if (!eta?.date) return "—";
                              const time = etaClock(eta.time);
                              return (
                                <>
                                  {isoDateLabel(eta.date)}
                                  {time && <div style={{ color: "#555" }}>{time}</div>}
                                </>
                              );
                            })()}
                          </td>
                        )}
                        <td
                          className={hideItemCols ? styles.instDateCol : undefined}
                          style={{ whiteSpace: "nowrap", fontSize: "12px", color: "#000" }}
                        >
                          {isoDateLabel(tx.time)}
                          {/* Loading page and Stock Out list: the install time from the schedule,
                              under the date (only when the schedule's install day is this row's day). */}
                          {(loadingOnly || txType === "out") &&
                            (() => {
                              const eta = etaOf(tx);
                              const time =
                                eta && eta.installTime && (!eta.installDate || eta.installDate === tx.time.slice(0, 10))
                                  ? sheetClock(eta.installTime)
                                  : "";
                              return time ? <div style={{ color: "#555" }}>{time}</div> : null;
                            })()}
                        </td>
                      </tr>
                      </Fragment>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

      {prepReportOpen && (
        <div className={styles.bankingReceiptBackdrop} onClick={() => setPrepReportOpen(false)}>
          <div
            className={`${styles.transferReportCard} ${styles.prepReportCard}`}
            role="dialog"
            aria-modal="true"
            aria-label="Warehouse Preparation Record"
            onClick={(e) => e.stopPropagation()}
          >
            <div className={styles.transferReportHead}>
              <div style={{ display: "flex", gap: "8px", marginLeft: "auto" }}>
                <button
                  type="button"
                  className={styles.btnActionGhost}
                  onClick={() => {
                    const sheet = prepSheetRef.current?.cloneNode(true) as HTMLElement | undefined;
                    if (!sheet) return;
                    sheet.querySelectorAll("input").forEach((inp) => {
                      const span = document.createElement("span");
                      span.setAttribute("data-sign", "1");
                      span.textContent = (inp as HTMLInputElement).value;
                      inp.replaceWith(span);
                    });
                    const w = window.open("", "_blank", "width=900,height=700");
                    if (!w) return;
                    w.document.write(
                      `<!doctype html><html><head><meta charset="utf-8"><title>Warehouse Preparation Record</title>` +
                        `<style>body{font-family:Arial,Helvetica,sans-serif;color:#000;margin:24px;font-size:13px}` +
                        `h1{font-size:20px;text-align:center;margin:0 0 40px}h2{font-size:14px;margin:18px 0 8px}` +
                        `table{width:100%;border-collapse:collapse}th,td{border:1px solid #999;padding:6px 8px;text-align:left;vertical-align:top}` +
                        `th:last-child,td:last-child{white-space:nowrap}ul{margin:0;padding-left:20px;line-height:1.6}` +
                        `strong{font-weight:700}span[data-sign]{display:inline-block;min-width:180px;border-bottom:1px solid #000;height:20px}` +
                        `.chk{display:flex;gap:10px;align-items:flex-end;margin-top:28px;flex-wrap:wrap}.pb{margin:14px 0;font-size:14px;line-height:1.9}.sum{display:flex;flex-direction:column;gap:6px;margin-bottom:16px}</style>` +
                        `</head><body>${sheet.innerHTML}</body></html>`
                    );
                    w.document.close();
                    w.focus();
                    w.print();
                  }}
                >
                  Print
                </button>
                <DownloadReportButton fileName={reportFileName("Warehouse-Preparation-Record", selectedDay)} />
                <button type="button" className={styles.btnActionGhost} onClick={() => setPrepReportOpen(false)}>
                  Close
                </button>
              </div>
            </div>

            <div className={styles.prepSheet} ref={prepSheetRef}>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "40px", margin: "0 0 48px" }}>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                src={`${typeof window !== "undefined" ? window.location.origin : ""}${LOGO_SRC}`}
                alt="Eternalgy"
                width={1332}
                height={176}
                style={{ display: "block", height: "24px", width: "auto", flex: "none" }}
              />
                <span style={{ fontSize: "20px", fontWeight: 700, color: "#000" }}>Report</span>
              </div>
              <h1 className={styles.prepTitle}>Warehouse Preparation Record &middot; {dayLabel}</h1>

              <div className={`${styles.prepSummary} sum`}>
                <div>
                  <strong>Total Customers:</strong> {prepCustomerCount}
                </div>
                <div>
                  <strong>Loading Date:</strong> {isoDateLabel(selectedDay)}
                </div>
              </div>

              <hr style={{ border: 0, borderTop: "1px solid #bdbdbd", margin: "20px 0 0" }} />
              <h2 className={styles.prepHeading}>1. MATERIAL PREPARATION &amp; RESPONSIBILITY</h2>
              {/* One block per item the day's verified jobs have: Qty and who prepared or packed it */}
              {prepItems.length === 0 && (
                <p className={styles.note}>
                  {prepType === "transfer" ? "No verified stock transfer on this day." : "No verified stock out on this day."}
                </p>
              )}
              {prepItems.map((item) => (
                <div key={item.id} className={`${styles.prepBlock} pb`}>
                  <strong>
                    {item.icon} {item.label}
                  </strong>
                  <div>
                    Qty: {item.bulk ? `${item.jobs} ${item.jobs === 1 ? "set" : "sets"}` : item.units}
                  </div>
                  <div>
                    {item.id === "mounting" ? "Packed By" : "Prepared By"}: <strong>{byValue(item.id) || "—"}</strong>
                  </div>
                  {item.id === "mounting" && (
                    <>
                      {prepMountingGroups.map((group) => (
                        <div key={group.label} style={{ marginTop: "6px" }}>
                          <strong>{group.label}</strong>
                          {group.parts.map((part) => (
                            <div key={part.name} style={{ marginLeft: "14px" }}>
                              {part.name}: {part.total}
                            </div>
                          ))}
                        </div>
                      ))}
                      <div style={{ marginTop: "6px" }}>
                        <strong>Total box for each customer</strong>
                      </div>
                      {prepCustomers.map((customer, i) => (
                        <div key={customer}>
                          Customer {i + 1}：{customer}{" "}
                          <span className={styles.prepSignLine} data-sign="1" style={{ minWidth: "70px" }} /> box
                        </div>
                      ))}
                    </>
                  )}
                </div>
              ))}

              <hr style={{ border: 0, borderTop: "1px solid #bdbdbd", margin: "20px 0 0" }} />
              <h2 className={styles.prepHeading}>2. FINAL CHECKING</h2>
              {/* Content to be added */}

              <div className={`${styles.prepChecked} chk`}>
                <strong>Checked by:</strong>
                <input
                  type="text"
                  className={styles.prepCheckedInput}
                  value={checkedBy ?? checkedByDefault}
                  onChange={(e) => setCheckedBy(e.target.value)}
                  placeholder="Type name"
                  aria-label="Checked by"
                />
                <strong>Date:</strong>
                <span className={styles.prepSignLine} data-sign="1" />
              </div>

              <h2 className={styles.prepHeading}>⚠️ IMPORTANT NOTES</h2>
              <ul className={styles.prepNotes}>
                <li>Only verified (fully scanned) stock out is listed in this record.</li>
                <li>Check every item against the schedule before loading.</li>
                <li>Report any shortage or damaged unit to the warehouse admin before the lorry leaves.</li>
              </ul>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}

// ---------------------------------------------------------------------------
// Online Banking Style Stock Transfer Available Models Database
// ---------------------------------------------------------------------------

const TRANSFER_AVAILABLE_MODELS = [
  // Panels
  { category: "panel", model: "Jinko 620W", powerRating: "620W", powerWatts: 620, baseSerial: "E4FXJ425G217507196111636", jbStock: 90, klStock: 65 },
  { category: "panel", model: "Jinko 650W", powerRating: "650W", powerWatts: 650, baseSerial: "E4FXJ425G217507196124815", jbStock: 80, klStock: 55 },
  { category: "panel", model: "Astronergy 625W", powerRating: "625W", powerWatts: 625, baseSerial: "E4FXJ425G217507196137402", jbStock: 70, klStock: 50 },
  { category: "panel", model: "Jinko 575W", powerRating: "575W", powerWatts: 575, baseSerial: "E4FXJ425G217507196140958", jbStock: 60, klStock: 45 },
  // Inverters
  { category: "inverter", model: "M2-1.8K-S4", powerRating: "1.8 kW", powerWatts: 1800, baseSerial: "HDT2103J2613ESA07407", jbStock: 14, klStock: 9 },
  { category: "inverter", model: "R5-7K-S2", powerRating: "7.0 kW", powerWatts: 7000, baseSerial: "HDT2103J2613ESA06996", jbStock: 2, klStock: 6 },
  { category: "inverter", model: "R5-6K-S2", powerRating: "6.0 kW", powerWatts: 6000, baseSerial: "HDT2103J2613ESA07133", jbStock: 4, klStock: 8 },
  { category: "inverter", model: "R6-8K-T2", powerRating: "8.0 kW", powerWatts: 8000, baseSerial: "HDT2103J2613ESA07270", jbStock: 3, klStock: 12 },
  { category: "inverter", model: "C6-100K-T9", powerRating: "100 kW", powerWatts: 100000, baseSerial: "HDT2103J2613ESA07550", jbStock: 2, klStock: 4 },
  // Batteries
  { category: "battery", model: "B3-16.0-LV", powerRating: "16.0 kWh", powerWatts: 16000, baseSerial: "ESB3-160LV-SN01", jbStock: 10, klStock: 6 },
  { category: "battery", model: "B3-5.0-LV", powerRating: "5.0 kWh", powerWatts: 5000, baseSerial: "ESB3-50LV-SN01", jbStock: 8, klStock: 12 },
];

// ---------------------------------------------------------------------------
// Tab — Stock Transfer (Online Banking Style Transfer Portal)
// ---------------------------------------------------------------------------

function StockTransferTab({
  transactions,
  onInspectTx,
  onSignOut,
  onNewTransfer,
  onGoToTransactions,
  onBack,
  preparedByName = "",
}: {
  transactions: StockTransaction[];
  onInspectTx: (id: string) => void;
  onSignOut: () => void;
  onBack: () => void;
  onNewTransfer: (newTx: StockTransaction) => void;
  onGoToTransactions?: () => void;
  // Signed-in user: saved as who prepared the transfer (shown on the Stock Transfer report).
  preparedByName?: string;
}) {
  // 1. Warehouse Route (From Warehouse A -> To Warehouse B)
  const [fromWh, setFromWh] = useState<"JB" | "KL">("JB");
  const [toWh, setToWh] = useState<"JB" | "KL">("KL");

  // 2. Equipment & Quantity
  const [cat, setCat] = useState<"panel" | "inverter" | "battery">("inverter");
  const [modelCode, setModelCode] = useState("M2-1.8K-S4");

  // 3. Transport Details
  const [driverName, setDriverName] = useState("Inter-Warehouse Transit Lorry (Driver: Muthu)");
  const [vehiclePlate, setVehiclePlate] = useState("JTP 4910");
  const [notes, setNotes] = useState("Stock rebalancing for upcoming regional installations");

  // 4. Scanning & Verification States (same like Stock Out page)
  const [cameraActive, setCameraActive] = useState(false);
  const [cameraError, setCameraError] = useState<string | null>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const [barcodeInput, setBarcodeInput] = useState("");
  const barcodeInputRef = useRef<HTMLInputElement>(null);
  // Every serial scanned for this transfer, with the item it was scanned as. Nothing is pre-filled:
  // the serials are whatever gets scanned, and the quantity of each item is the number scanned.
  const [scanned, setScanned] = useState<{ serial: string; cat: "panel" | "inverter" | "battery"; model: string }[]>([]);

  const [feedback, setFeedback] = useState<{
    type: "success" | "warning" | "error";
    message: string;
  } | null>(null);

  const [reportOpen, setReportOpen] = useState(false);
  const [lorryPhoto, setLorryPhoto] = useState<string | null>(null);
  const [checklist, setChecklist] = useState({
    condition: false,
    serialMatch: false,
    lorryLoaded: false,
    handoverSigned: false,
  });

  // 5. Transfer Success Receipt (Online Banking style)
  const [successReceipt, setSuccessReceipt] = useState<{
    transferNo: string;
    from: string;
    to: string;
    model: string;
    qty: number;
    date: string;
    plate: string;
    driver: string;
  } | null>(null);

  // Find currently selected model spec
  const currentModelSpec = useMemo(() => {
    return (
      TRANSFER_AVAILABLE_MODELS.find((m) => m.model === modelCode) ??
      TRANSFER_AVAILABLE_MODELS.find((m) => m.category === cat) ??
      TRANSFER_AVAILABLE_MODELS[0]
    );
  }, [modelCode, cat]);

  // Available models for current category
  const categoryModels = useMemo(() => {
    return TRANSFER_AVAILABLE_MODELS.filter((m) => m.category === cat);
  }, [cat]);

  // Live stock balance available at Source Warehouse (From Warehouse)
  const availableAtSource = fromWh === "JB" ? currentModelSpec.jbStock : currentModelSpec.klStock;
  const availableAtDest = toWh === "JB" ? currentModelSpec.jbStock : currentModelSpec.klStock;

  // Swap From ⇄ To Warehouses (like online banking swap)
  function handleSwapRoute() {
    setFromWh(toWh);
    setToWh(fromWh);
    setScanned([]);
  }

  // Quantity of each item = how many serials were scanned for it.
  const scannedByItem = useMemo(() => {
    const map = new Map<string, { cat: "panel" | "inverter" | "battery"; model: string; serials: string[] }>();
    scanned.forEach((entry) => {
      const key = `${entry.cat}|${entry.model}`;
      const row = map.get(key) ?? { cat: entry.cat, model: entry.model, serials: [] };
      row.serials.push(entry.serial);
      map.set(key, row);
    });
    return Array.from(map.values());
  }, [scanned]);
  const totalScanned = scanned.length;
  const isAllVerified = totalScanned > 0;
  const itemSummary = scannedByItem.map((row) => `${row.serials.length} × ${row.model}`).join(", ") || "Nothing scanned yet";

  // Camera video stream & live BarcodeDetector hook (same as Stock Out)
  useEffect(() => {
    let stream: MediaStream | null = null;
    let detectorTimer: NodeJS.Timeout | null = null;
    // Set when the camera is closed (or the page re-renders) before the camera has started,
    // so a stream that arrives late is stopped instead of keeping the camera busy.
    let cancelled = false;

    if (cameraActive) {
      if (typeof navigator !== "undefined" && typeof navigator.mediaDevices?.getUserMedia === "function") {
        openCameraStream()
          .then((s) => {
            if (cancelled) {
              s.getTracks().forEach((t) => t.stop());
              return;
            }
            stream = s;
            if (videoRef.current) {
              videoRef.current.srcObject = s;
              videoRef.current.play().catch(() => {});
            }
            setCameraError(null);

            if (typeof window !== "undefined" && "BarcodeDetector" in window) {
              try {
                // @ts-expect-error - standard browser BarcodeDetector API
                const detector = new window.BarcodeDetector({ formats: ["code_128", "qr_code", "ean_13", "data_matrix"] });
                detectorTimer = setInterval(async () => {
                  if (videoRef.current && videoRef.current.readyState >= 2) {
                    try {
                      const barcodes = await detector.detect(videoRef.current);
                      if (barcodes && barcodes.length > 0 && barcodes[0].rawValue) {
                        handleScan(barcodes[0].rawValue);
                      }
                    } catch {}
                  }
                }, 400);
              } catch {}
            }
          })
          .catch((err) => {
            if (!cancelled) setCameraError(cameraErrorMessage(err));
          });
      } else {
        setCameraError(cameraErrorMessage(null));
      }
    } else {
      if (videoRef.current && videoRef.current.srcObject) {
        const tracks = (videoRef.current.srcObject as MediaStream).getTracks();
        tracks.forEach((t) => t.stop());
        videoRef.current.srcObject = null;
      }
    }

    return () => {
      cancelled = true;
      if (detectorTimer) clearInterval(detectorTimer);
      if (stream) {
        stream.getTracks().forEach((t) => t.stop());
      }
    };
  }, [cameraActive]);

  // Scan handler: records the serial as the selected item. Duplicates are refused.
  function handleScan(codeToTest?: string) {
    const code = (codeToTest ?? barcodeInput).trim();
    if (!code) return;
    const existing = scanned.find((entry) => entry.serial.toLowerCase() === code.toLowerCase());
    if (existing) {
      setFeedback({ type: "warning", message: `⚠️ Duplicate Scan: ${existing.serial} was already recorded as ${existing.model}.` });
      setBarcodeInput("");
      return;
    }
    const nowCount = scanned.filter((entry) => entry.cat === cat && entry.model === currentModelSpec.model).length + 1;
    setScanned((prev) => [...prev, { serial: code, cat, model: currentModelSpec.model }]);
    setFeedback({ type: "success", message: `✅ Recorded ${code} as ${currentModelSpec.model} (${nowCount} of this item).` });
    setBarcodeInput("");
  }

  function removeScan(serial: string) {
    setScanned((prev) => prev.filter((entry) => entry.serial !== serial));
  }

  // Once user clicks on 'Verified', that transfer data sits on stock transactions!
  // No data sits on stock transfer.
  function handleAuthorizeVerifiedTransfer() {
    const trNum = `TR-2026-${String(Math.floor(1000 + Math.random() * 9000))}`;
    const fromLabel = fromWh === "JB" ? "Johor Bahru (JB)" : "Kuala Lumpur (KL)";
    const toLabel = toWh === "JB" ? "Johor Bahru (JB)" : "Kuala Lumpur (KL)";

    const verifiedTx: StockTransaction = {
      id: `tx-trf-${Date.now()}`,
      time: "Today, Just now",
      type: "transfer",
      category: scannedByItem[0].cat,
      model: scannedByItem.map((row) => row.model).join(" + "),
      serialCode: scanned[0].serial,
      qty: totalScanned,
      warehouse: fromWh,
      lines: scannedByItem.map((row) => ({
        category: row.cat,
        model: row.model,
        qty: row.serials.length,
        serialised: true,
        serialCode: row.serials.join(", "),
      })),
      reference: `${trNum} · ${fromWh} ➔ ${toWh}`,
      party: "Warehouse Transfer",
      status: "Verified",
      transfer: {
        transferNo: trNum,
        fromWarehouse: fromWh,
        toWarehouse: toWh,
        requestedBy: preparedByName || "Ops Admin",
        driverName,
        vehiclePlate,
        dispatchedDate: "Today (Just now)",
        receivedDate: "In Transit",
        dispatchedQty: totalScanned,
        receivedQty: totalScanned,
        notes,
      },
    };

    // 1. Commit transfer to stock transactions (on Home tab)
    onNewTransfer(verifiedTx);

    // 2. Show banking transfer receipt modal
    setSuccessReceipt({
      transferNo: trNum,
      from: fromLabel,
      to: toLabel,
      model: scannedByItem.map((row) => row.model).join(" + "),
      qty: totalScanned,
      date: "Today, Just now",
      plate: vehiclePlate,
      driver: driverName,
    });

    // 3. Reset form so no data sits on stock transfer tab
    setScanned([]);
    setChecklist({ condition: false, serialMatch: false, lorryLoaded: false, handoverSigned: false });
    setFeedback(null);
    setLorryPhoto(null);
  }

  const fromLabel = fromWh === "JB" ? "Johor Bahru (JB) Warehouse" : "Kuala Lumpur (KL) Warehouse";
  const toLabel = toWh === "JB" ? "Johor Bahru (JB) Warehouse" : "Kuala Lumpur (KL) Warehouse";

  return (
    <section className={`${styles.screen} ${styles.arialPage} ${styles.transferPage}`} aria-labelledby="stock-transfer-title">
      {/* Back (left) and Report (right) on one row */}
      <div className={styles.head}>
        <button className={styles.back} type="button" onClick={onBack}>
          Back
        </button>
        <button type="button" className={styles.btnActionGhost} onClick={() => setReportOpen(true)}>
          Report
        </button>
      </div>

      {/* Top Header */}
      <div className={styles.head}>
        <div>
          <h1 id="stock-transfer-title" className={styles.sectionTitle} style={{ margin: "0 0 4px", fontSize: "24px", fontWeight: 700, color: "#000" }}>
            Stock Transfer Verification
          </h1>
        </div>
      </div>

      {/* Today's transfers (moved here from Stock Transactions) */}
      <div className={styles.txSummaryRow} style={{ marginBottom: "16px" }}>
        <div className={styles.txKpiCard}>
          <div className={styles.txKpiHeader}>
            <div className={styles.txKpiTitles}>
              <span className={styles.txKpiLabel}>Today Transfer</span>
              <small className={styles.txKpiSub}>Inter-WH rebalance</small>
            </div>
            <span className={`${styles.txKpiValue} ${styles.txQtyTransfer}`}>
              {transactions
                .filter((t) => t.type === "transfer" && t.status === "Verified" && txDate(t) === isoToday()).length}{" "}
              <span className={styles.txKpiUnit}>transfers</span>
            </span>
          </div>
        </div>
      </div>

      <div className={styles.bankingTransferContainer}>
        {/* Step 1: The Online Banking Transfer Card */}
        <div className={styles.bankingTransferCard}>
          <div className={styles.bankingCardHeader}>
            <div>
              <h2 className={styles.bankingCardTitle}>
                <span>🏦</span> Transfer Between Warehouses
              </h2>
            </div>
            <span className={`${styles.tag} ${styles.check}`}>Live Inventory Network</span>
          </div>

          {/* From ➔ To Warehouse Cards with Swap Button in Center */}
          <div className={styles.bankingRouteRow}>
            {/* Source Warehouse (From Account) */}
            <div className={styles.bankingAccountCard}>
              <div className={styles.bankingAccountLabel}>
                <span>From (Source Warehouse)</span>
                <span>📤 OUTGOING</span>
              </div>
              <select
                className={styles.bankingAccountSelect}
                value={fromWh}
                onChange={(e) => {
                  const newFrom = e.target.value as "JB" | "KL";
                  setFromWh(newFrom);
                  if (newFrom === toWh) setToWh(newFrom === "JB" ? "KL" : "JB");
                  setScanned([]);
                }}
                aria-label="From Warehouse"
              >
                <option value="JB">Johor Bahru (JB) Warehouse</option>
                <option value="KL">Kuala Lumpur (KL) Warehouse</option>
              </select>
              <div className={styles.bankingAccountBalance}>
                <span>📦 Available on Hand:</span>
                <strong>{availableAtSource} units</strong>
              </div>
            </div>

            {/* Swap Button (Like Banking Currency/Account Swap) */}
            <div>
              <button
                type="button"
                className={styles.bankingSwapCircle}
                onClick={handleSwapRoute}
                title="Swap Source and Destination Warehouses"
                aria-label="Swap Warehouses"
              >
                ⇄
              </button>
            </div>

            {/* Destination Warehouse (To Account) */}
            <div className={styles.bankingAccountCard}>
              <div className={styles.bankingAccountLabel}>
                <span>To (Destination Warehouse)</span>
                <span>📥 INCOMING</span>
              </div>
              <select
                className={styles.bankingAccountSelect}
                value={toWh}
                onChange={(e) => {
                  const newTo = e.target.value as "JB" | "KL";
                  setToWh(newTo);
                  if (newTo === fromWh) setFromWh(newTo === "JB" ? "KL" : "JB");
                  setScanned([]);
                }}
                aria-label="To Warehouse"
              >
                <option value="KL">Kuala Lumpur (KL) Warehouse</option>
                <option value="JB">Johor Bahru (JB) Warehouse</option>
              </select>
              <div className={styles.bankingAccountBalance}>
                <span>📦 Available on Hand:</span>
                <strong>{availableAtDest} units</strong>
              </div>
            </div>
          </div>

          {/* Equipment Category & Model Selection */}
          <div style={{ marginBottom: "16px" }}>
            <label
              htmlFor="transfer-equipment-category"
              className={styles.bankingFieldLabel}
              style={{ display: "block", marginBottom: "8px" }}
            >
              Equipment Category:
            </label>
            <select
              id="transfer-equipment-category"
              className={styles.bankingAccountSelect}
              value={cat}
              onChange={(e) => {
                const c = e.target.value as "panel" | "inverter" | "battery";
                setCat(c);
                const first = TRANSFER_AVAILABLE_MODELS.find((m) => m.category === c);
                if (first) setModelCode(first.model);
              }}
            >
              <option value="panel">Solar Panels</option>
              <option value="inverter">Inverters</option>
              <option value="battery">Battery Storage</option>
            </select>
          </div>

          <div className={styles.bankingAmountGrid}>
            {/* Model Selector */}
            <div className={styles.bankingFieldGroup}>
              <label className={styles.bankingFieldLabel}>Equipment Model:</label>
              <select
                className={styles.bankingAccountSelect}
                value={modelCode}
                onChange={(e) => {
                  setModelCode(e.target.value);
                }}
              >
                {categoryModels.map((m) => (
                  <option key={m.model} value={m.model}>
                    {m.model}
                  </option>
                ))}
              </select>
              <small style={{ color: "var(--muted)", fontSize: "11px" }}>
                Spec: <strong>{currentModelSpec.powerRating}</strong> &middot; Rating: {currentModelSpec.powerWatts}W
              </small>
            </div>

            {/* Quantity is counted from the scans */}
            <div className={styles.bankingFieldGroup}>
              <label className={styles.bankingFieldLabel}>Quantity:</label>
              <div style={{ fontSize: "13px", color: "#000" }}>{itemSummary}</div>
            </div>
          </div>

          {/* Transport & Driver Details, separated from the item fields by a line */}
          <hr style={{ border: 0, borderTop: "1px solid var(--line)", margin: "4px 0 16px" }} />
          <div className={styles.bankingAmountGrid} style={{ marginBottom: "0" }}>
            <div className={styles.bankingFieldGroup}>
              <label className={styles.bankingFieldLabel}>Driver &amp; Logistics Team:</label>
              <input
                type="text"
                className={styles.bankingAccountSelect}
                style={{ cursor: "text", lineHeight: 1.25 }}
                value={driverName}
                onChange={(e) => setDriverName(e.target.value)}
                placeholder="Driver Name / Transport Team..."
              />
            </div>

            <div className={styles.bankingFieldGroup}>
              <label className={styles.bankingFieldLabel}>Lorry / Transport Plate Number:</label>
              <input
                type="text"
                className={styles.bankingAccountSelect}
                style={{ cursor: "text", lineHeight: 1.25 }}
                value={vehiclePlate}
                onChange={(e) => setVehiclePlate(e.target.value)}
                placeholder="e.g. JTP 4910"
              />
            </div>
          </div>

          {/* Lorry photo */}
          <div className={styles.bankingFieldGroup} style={{ marginTop: "16px" }}>
            <label className={styles.bankingFieldLabel}>Lorry Photo:</label>
            <label className={styles.lorryPhotoBox}>
              <input
                type="file"
                accept="image/*"
                capture="environment"
                className={styles.lorryPhotoInput}
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  e.target.value = "";
                  if (!file) return;
                  const reader = new FileReader();
                  reader.onload = () => setLorryPhoto(typeof reader.result === "string" ? reader.result : null);
                  reader.readAsDataURL(file);
                }}
              />
              {lorryPhoto ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={lorryPhoto} alt="Lorry" className={styles.lorryPhotoImg} />
              ) : (
                <span className={styles.lorryPhotoEmpty}>📷 Tap to take a picture of the lorry</span>
              )}
            </label>
            {lorryPhoto && (
              <div style={{ display: "flex", gap: "8px", marginTop: "8px" }}>
                <button type="button" className={styles.btnActionGhost} onClick={() => setLorryPhoto(null)}>
                  Remove photo
                </button>
              </div>
            )}
          </div>
        </div>

        {/* Step 2: Barcode & Serial Camera Scanner (Same like Stock Out Transaction Page) */}
        <div className={styles.scannerCard}>
          <div className={styles.scannerHeader}>
            <div>
              <h2 className={styles.scannerTitle}>
                <span>🔍</span> Barcode &amp; Serial Scanner (Transfer Verification)
              </h2>
              <p className={styles.scannerHelpText}>
                Scan physical barcodes using live mobile camera or handheld laser gun to record each unit loading from {fromWh} to {toWh}.
              </p>
            </div>
          </div>

          {/* Camera Viewfinder */}
          {cameraActive && (
            <div className={styles.cameraViewfinder}>
                <button
                  type="button"
                  className={styles.cameraCloseBtn}
                  onClick={() => setCameraActive(false)}
                  aria-label="Close camera"
                  title="Close camera"
                >
                  ✕
                </button>
              <div className={styles.cameraScanLine} />
              <video ref={videoRef} className={styles.videoCameraActive} playsInline autoPlay muted />
              {cameraError && (
                <div style={{ padding: "12px 14px", background: "rgba(0,0,0,0.65)", borderRadius: "6px", margin: "8px" }}>
                  <div style={{ fontSize: "22px", marginBottom: "2px" }}>📸</div>
                  <strong style={{ color: "#f87171", fontSize: "12px" }}>Camera Notice:</strong>
                  <div style={{ fontSize: "11px", color: "#e2e8f0", marginTop: "2px" }}>
                    {cameraError}
                  </div>
                </div>
              )}
              <div style={{ padding: "8px 12px", background: "rgba(0,0,0,0.55)", borderRadius: "6px", marginTop: "6px", display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: "6px" }}>
                <span style={{ fontSize: "11px", color: "#e2e8f0" }}>
                  🎯 Camera auto-detects the barcode and records it as {currentModelSpec.model} ({fromWh} ➔ {toWh}).
                </span>
              </div>
            </div>
          )}

          {/* Barcode Input Form */}
          <form
            className={styles.scannerInputRow}
            onSubmit={(e) => {
              e.preventDefault();
              handleScan();
            }}
          >
            <input
              ref={barcodeInputRef}
              type="text"
              className={styles.scannerInput}
              placeholder="Scan barcode or type the serial number..."
              value={barcodeInput}
              onChange={(e) => setBarcodeInput(e.target.value)}
            />
            <button
            type="button"
            className={styles.scannerBtnScan}
            title="Records the typed serial; with an empty box it opens the camera scanner"
            onClick={() => {
              if (barcodeInput.trim()) handleScan();
              else setCameraActive(true);
            }}
          >
              <span>⚡</span> Scan / Record
            </button>
          </form>

          {/* Real-time Scan Feedback */}
          {feedback && (
            <div
              className={`${styles.scanFeedback} ${
                feedback.type === "success"
                  ? styles.scanFeedbackSuccess
                  : feedback.type === "warning"
                  ? styles.scanFeedbackWarning
                  : styles.scanFeedbackError
              }`}
            >
              <span>{feedback.message}</span>
              <button
                type="button"
                style={{ border: 0, background: "transparent", cursor: "pointer", color: "inherit", fontWeight: 700 }}
                onClick={() => setFeedback(null)}
              >
                &times;
              </button>
            </div>
          )}

          {/* Step 3: Transfer Units Recording Table (merged into the scanner box) */}
          <hr style={{ border: 0, borderTop: "1px solid var(--line)", margin: "18px 0" }} />
          <div className={styles.skuProgressHeader}>
            <div>
              <h2 className={styles.inspectCardTitle}>
                <span>📋</span> Scanned Serials
              </h2>
              <p className={styles.itemDesc}>
                Serial codes scanned for transport from {fromLabel} to {toLabel}. Tap Remove to take a code off the list.
              </p>
            </div>
            <div className={styles.skuOverallStats}>
              Total Scanned: <strong>{totalScanned}</strong>
            </div>
          </div>

          {/* Quantity of each item, counted from the scans */}
          {scannedByItem.length > 0 && (
            <div className={styles.txFilterPills} style={{ margin: "0 0 10px" }}>
              {scannedByItem.map((row) => (
                <span key={`${row.cat}|${row.model}`} className={styles.txPill}>
                  {CAT_LABEL[row.cat] ?? row.cat}: {row.model} × {row.serials.length}
                </span>
              ))}
            </div>
          )}

          <div className={styles.unitScrollTableWrap}>
            <table>
              <thead>
                <tr>
                  <th scope="col" style={{ width: "50px" }}>No.</th>
                  <th scope="col" style={{ minWidth: "220px" }}>Serial Code</th>
                  <th scope="col">Item</th>
                  <th scope="col" style={{ width: "110px" }}>Remove</th>
                </tr>
              </thead>
              <tbody>
                {scanned.length === 0 ? (
                  <tr>
                    <td colSpan={4}>Nothing scanned yet. Pick the item above, then scan its serial codes.</td>
                  </tr>
                ) : (
                  scanned.map((entry, n) => (
                    <tr key={entry.serial} className={styles.unitRowVerified}>
                      <td style={{ color: "var(--muted)", fontSize: "11px", fontWeight: 600 }}>#{String(n + 1).padStart(2, "0")}</td>
                      <td>
                        <div style={{ fontFamily: "monospace", fontWeight: 700, fontSize: "13px", letterSpacing: "0.03em" }}>
                          {entry.serial}
                        </div>
                      </td>
                      <td>
                        <strong style={{ fontSize: "13px" }}>{entry.model}</strong>
                        <div style={{ fontSize: "11px", color: "var(--muted)", marginTop: "2px" }}>
                          {CAT_LABEL[entry.cat] ?? entry.cat}
                        </div>
                      </td>
                      <td>
                        <button type="button" className={styles.btnActionGhost} onClick={() => removeScan(entry.serial)}>
                          Remove
                        </button>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>

        {/* Step 5: Authorization & Verified Button (Online Banking Style) */}
        <div className={styles.inspectFooterBar}>
          <button
            className={styles.btnActionGhost}
            type="button"
            onClick={() => {
              setScanned([]);
              setChecklist({ condition: false, serialMatch: false, lorryLoaded: false, handoverSigned: false });
              setFeedback(null);
              setLorryPhoto(null);
            }}
          >
            Clear / Reset Form
          </button>

          <button
            className={`${styles.btnActionPrimary} ${
              isAllVerified ? styles.btnVerifiedGlow : styles.btnVerifiedLocked
            }`}
            type="button"
            disabled={!isAllVerified}
            onClick={handleAuthorizeVerifiedTransfer}
            title="Scan at least one unit to unlock verification"
          >
            {isAllVerified
              ? "✓ Verified (Authorize & Complete Transfer)"
              : "🔒 Verified (scan at least one unit to unlock)"}
          </button>
        </div>
      </div>

      {/* Transfer Report (includes the Physical Inspection & Transit Checklist) */}
      {reportOpen && (
        <div className={styles.bankingReceiptBackdrop} onClick={() => setReportOpen(false)}>
          <div
            className={styles.transferReportCard}
            role="dialog"
            aria-modal="true"
            aria-label="Transfer report"
            onClick={(e) => e.stopPropagation()}
          >
            <div className={styles.transferReportHead}>
              <h2 className={styles.bankingCardTitle}>Transfer Report</h2>
              <div style={{ display: "flex", gap: "8px" }}>
                <DownloadReportButton fileName={reportFileName("Transfer-Report", `${fromWh}-to-${toWh}`)} />
                <button type="button" className={styles.btnActionGhost} onClick={() => setReportOpen(false)}>
                  Close
                </button>
              </div>
            </div>
            <div className={styles.bankingReceiptDetails}>
              <div className={styles.bankingReceiptRow}>
                <span className={styles.bankingReceiptRowLabel}>Route</span>
                <span className={styles.bankingReceiptRowVal}>{fromLabel} ➔ {toLabel}</span>
              </div>
              <div className={styles.bankingReceiptRow}>
                <span className={styles.bankingReceiptRowLabel}>Equipment</span>
                <span className={styles.bankingReceiptRowVal}>{itemSummary}</span>
              </div>
              <div className={styles.bankingReceiptRow}>
                <span className={styles.bankingReceiptRowLabel}>Driver &amp; Lorry</span>
                <span className={styles.bankingReceiptRowVal}>{driverName} &middot; {vehiclePlate}</span>
              </div>
              <div className={styles.bankingReceiptRow}>
                <span className={styles.bankingReceiptRowLabel}>Scanned</span>
                <span className={styles.bankingReceiptRowVal}>{totalScanned}</span>
              </div>
            </div>
        <div className={styles.inspectChecklistCard}>
          <h3 className={styles.inspectChecklistTitle}>Physical Inspection &amp; Inter-Warehouse Transit Checklist</h3>
          <div className={styles.inspectChecklist}>
            <label className={styles.inspectCheckItem}>
              <input
                type="checkbox"
                checked={checklist.condition}
                onChange={(e) => setChecklist((prev) => ({ ...prev, condition: e.target.checked }))}
              />
              <span>Physical packaging inspected (cartons intact, weather shrink-wrapped, pallets strapped)</span>
            </label>
            <label className={styles.inspectCheckItem}>
              <input
                type="checkbox"
                checked={checklist.serialMatch}
                onChange={(e) => setChecklist((prev) => ({ ...prev, serialMatch: e.target.checked }))}
              />
              <span>All {totalScanned} scanned unit barcodes recorded against the Transfer Manifest</span>
            </label>
            <label className={styles.inspectCheckItem}>
              <input
                type="checkbox"
                checked={checklist.lorryLoaded}
                onChange={(e) => setChecklist((prev) => ({ ...prev, lorryLoaded: e.target.checked }))}
              />
              <span>Loaded onto transfer vehicle ({vehiclePlate}) with driver endorsement</span>
            </label>
            <label className={styles.inspectCheckItem}>
              <input
                type="checkbox"
                checked={checklist.handoverSigned}
                onChange={(e) => setChecklist((prev) => ({ ...prev, handoverSigned: e.target.checked }))}
              />
              <span>Digital Goods In-Transit Acknowledgment dispatched to {toLabel}</span>
            </label>
          </div>
        </div>
          </div>
        </div>
      )}

      {/* Online Banking Style Transfer Receipt Modal */}
      {successReceipt && (
        <div className={styles.bankingReceiptBackdrop} onClick={() => setSuccessReceipt(null)}>
          <div className={styles.bankingReceiptCard} onClick={(e) => e.stopPropagation()}>
            <div className={styles.bankingReceiptCheck}>✓</div>
            <h2 className={styles.bankingReceiptTitle}>Transfer Authorized &amp; Verified!</h2>
            <p className={styles.bankingReceiptSub}>
              Your stock transfer has been verified and committed into <strong>Stock Transactions</strong>.
            </p>

            <div className={styles.bankingReceiptDetails}>
              <div className={styles.bankingReceiptRow}>
                <span className={styles.bankingReceiptRowLabel}>Transfer Reference</span>
                <span className={styles.bankingReceiptRowVal} style={{ fontFamily: "monospace", color: "#0284c7" }}>
                  {successReceipt.transferNo}
                </span>
              </div>
              <div className={styles.bankingReceiptRow}>
                <span className={styles.bankingReceiptRowLabel}>Route</span>
                <span className={styles.bankingReceiptRowVal}>
                  {successReceipt.from} ➔ {successReceipt.to}
                </span>
              </div>
              <div className={styles.bankingReceiptRow}>
                <span className={styles.bankingReceiptRowLabel}>Transferred Equipment</span>
                <span className={styles.bankingReceiptRowVal}>
                  {successReceipt.qty} units &middot; {successReceipt.model}
                </span>
              </div>
              <div className={styles.bankingReceiptRow}>
                <span className={styles.bankingReceiptRowLabel}>Lorry &amp; Driver</span>
                <span className={styles.bankingReceiptRowVal}>
                  {successReceipt.plate} ({successReceipt.driver})
                </span>
              </div>
              <div className={styles.bankingReceiptRow}>
                <span className={styles.bankingReceiptRowLabel}>Status</span>
                <span className={`${styles.tag} ${styles.check}`}>✓ Verified</span>
              </div>
            </div>

            <div className={styles.bankingReceiptActions}>
              <button
                type="button"
                className={styles.btnActionGhost}
                style={{ flex: 1 }}
                onClick={() => setSuccessReceipt(null)}
              >
                ➕ Make Another Transfer
              </button>
              <button
                type="button"
                className={styles.btnNewTransfer}
                style={{ flex: 1, justifyContent: "center" }}
                onClick={() => {
                  setSuccessReceipt(null);
                  if (onGoToTransactions) onGoToTransactions();
                }}
              >
                📋 View in Stock Transfer ➔
              </button>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}

// ---------------------------------------------------------------------------
// Tab 2 — Stock Details
// ---------------------------------------------------------------------------

function StockDetailsTab({
  transactions,
  verifications,
  initialItem,
  initialWarehouse,
}: {
  transactions: StockTransaction[];
  verifications: VerificationRecord[];
  initialItem?: StockItemTab;
  initialWarehouse?: WhFilter;
}) {
  const [whFilter, setWhFilter] = useState<WhFilter>(initialWarehouse ?? "all");
  const [query, setQuery] = useState("");
  const [stockTab, setStockTab] = useState<StockItemTab>(initialItem ?? "panel");
  // The day whose stock in (▲) and stock out (▼) the Panel / Inverter / Battery tables show.
  const [selectedDay, setSelectedDay] = useState(isoToday());
  const dayLabel = getDayLabel(selectedDay);
  const [reportOpen, setReportOpen] = useState(false);

  const filteredItems =
    whFilter === "all"
      ? STOCK_DETAIL_ITEMS
      : STOCK_DETAIL_ITEMS.filter((item) => item.warehouse === whFilter);

  const panels = filteredItems.filter((item) => item.category === "panel");
  const inverters = filteredItems.filter((item) => item.category === "inverter");
  const batteries = filteredItems.filter((item) => item.category === "battery");
  const others = filteredItems.filter((item) => item.category === "other");

  const tableWarehouses: WarehouseCode[] = whFilter === "all" ? ["JB", "KL", "KLG"] : [whFilter];

  return (
    <section className={styles.screen} aria-labelledby="warehouse-stock-details">
      {/* Title on the left, Report on the right (same as the other pages) */}
      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: "10px" }}>
        <div style={{ minWidth: 0 }}>
          <h1 id="warehouse-stock-details">Stock Details</h1>
          <p className={styles.kicker}>Current inventory across JB, KL and Kluang warehouses.</p>
        </div>
        <button type="button" className={styles.btnActionGhost} style={{ flex: "none" }} onClick={() => setReportOpen(true)}>
          Report
        </button>
      </div>

      {/* Warehouse filter: same size as the Home page buttons */}
      <div className={styles.filterRow} style={{ width: "50%", minWidth: "175px", marginLeft: "auto" }}>
        {WH_FILTERS.map((value) => (
          <button
            key={value}
            type="button"
            className={`${styles.filterBtn} ${whFilter === value ? styles.filterActive : ""}`}
            style={{ fontSize: "11px", padding: "3px 4px" }}
            onClick={() => setWhFilter((cur) => (cur === value ? "all" : value))}
          >
            {WH_BUTTON_LABEL[value]}
          </button>
        ))}
      </div>

      {/* Stock balance cards (same as Home); clicking one opens its tab below */}
      <StockBalanceCards
        whFilter={whFilter}
        onCardClick={setStockTab}
        activeItem={stockTab}
        tooltip={(label) => `Show ${label} below`}
      />

      {/* Day picker, same as Home: the day's stock in / out in the tables below. A row of
          space separates it from the cards. */}
      <div className={styles.balanceHeaderRow} style={{ marginTop: "28px" }}>
        <div>
          <p className={styles.kicker} style={{ margin: "2px 0 0", color: "#000" }}>
            {dayLabel}
          </p>
        </div>
        {/* ‹ calendar › : previous day, pick a day, next day */}
        <DateNav
          value={selectedDay}
          onPick={setSelectedDay}
          onPrev={() => setSelectedDay((d) => shiftIso(d, -1))}
          onNext={() => setSelectedDay((d) => shiftIso(d, 1))}
        />
      </div>

      {/* Detail tables, all filtered by the one search box */}
      <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", justifyContent: "flex-end", gap: "10px", marginTop: "18px", marginBottom: "12px" }}>
        <input
          className={styles.searchCompact}
          style={{ marginLeft: "auto" }}
          type="search"
          placeholder="Search this tab by model or code"
          aria-label="Search stock by model or code"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
      </div>

      {/* Panel / Inverter / Battery: a row opens the customers for that model */}
      {(stockTab === "panel" || stockTab === "inverter" || stockTab === "battery") && (
        // The note on the left; the ▲ / ▼ marks in the table explained on the right
        <div className={styles.loadingNoteRow}>
          <p className={styles.note} style={{ margin: 0, color: "#000", fontSize: "10px" }}>
            Click on a row to view customer details.
          </p>
          <p className={styles.note} style={{ margin: 0, color: "#000", fontSize: "10px" }} aria-label="Legend">
            <span style={{ color: "var(--green)" }}>▲</span> Stock In
            <span style={{ marginLeft: "10px", color: "var(--red)" }}>▼</span> Stock Out
            <span style={{ marginLeft: "10px", color: "#0284c7" }}>⇄</span> Stock Transfer
          </p>
        </div>
      )}
      {stockTab === "panel" && (
        <StockOutModelTable title="Panel" category="panel" transactions={transactions} verifications={verifications} query={query} day={selectedDay} />
      )}
      {stockTab === "inverter" && (
        <StockOutModelTable title="Inverter" category="inverter" transactions={transactions} verifications={verifications} query={query} day={selectedDay} />
      )}
      {stockTab === "battery" && (
        <StockOutModelTable title="Battery" category="battery" transactions={transactions} verifications={verifications} query={query} day={selectedDay} />
      )}
      {stockTab === "other" && (
        <StockTable
          title="Electrical Item"
          items={others}
          warehouses={tableWarehouses}
          query={query}
        />
      )}
      {stockTab === "mounting" && <MountingStructureSection warehouses={tableWarehouses} />}
      {stockTab === "special" && <SpecialMaterialSection warehouses={tableWarehouses} />}

      {reportOpen && (
        <StockDetailsReport
          transactions={transactions}
          verifications={verifications}
          whFilter={whFilter}
          day={selectedDay}
          onClose={() => setReportOpen(false)}
        />
      )}
    </section>
  );
}

// Stock Details report: the picked day and warehouse on one A4 page. Stock on hand (the cards),
// each Panel / Inverter / Battery model that moved that day (in, out, balance) and the day's
// stock out by customer with who prepared it. Downloads as a one-page PDF.
function StockDetailsReport({
  transactions,
  verifications,
  whFilter,
  day,
  onClose,
}: {
  transactions: StockTransaction[];
  verifications: VerificationRecord[];
  whFilter: WhFilter;
  day: string;
  onClose: () => void;
}) {
  const categories = [
    { id: "panel", title: "Panel" },
    { id: "inverter", title: "Inverter" },
    { id: "battery", title: "Battery" },
  ] as const;
  const sections = categories.map((cat) => ({
    ...cat,
    rows: buildModelRows(transactions, verifications, cat.id, day).filter((row) => row.inQty > 0 || row.qty > 0),
  }));
  // Stock out by customer: one line per customer and model.
  const outLines = sections.flatMap((section) =>
    section.rows.flatMap((row) =>
      row.uses
        .filter((use) => use.kind === "out")
        .map((use) => ({
          customer: use.party || "—",
          item: section.title,
          model: row.model,
          serials: use.serials.join(", ") || "—",
          qty: use.qty,
          preparedBy: use.preparedBy || "—",
        })),
    ),
  );
  outLines.sort((a, b) => a.customer.localeCompare(b.customer));
  const balances = WAREHOUSE_BALANCES[whFilter];
  const whName = whFilter === "all" ? "All warehouses (JB, KL, Kluang)" : `${WH_BUTTON_LABEL[whFilter]} Warehouse`;
  const cell = { border: "1px solid #999", padding: "4px 6px", textAlign: "left" as const, fontSize: "11px", color: "#000" };
  const num = { ...cell, textAlign: "right" as const, whiteSpace: "nowrap" as const };
  const head = { ...cell, background: "#f3f4f6", fontWeight: 700 };
  const headNum = { ...head, textAlign: "right" as const };
  const sectionTitle = { fontSize: "13px", fontWeight: 700, margin: "16px 0 6px", color: "#000" };
  const table = { width: "100%", borderCollapse: "collapse" as const, tableLayout: "auto" as const };

  return (
    <div className={styles.bankingReceiptBackdrop} onClick={onClose}>
      <div
        className={`${styles.transferReportCard} ${styles.a4Report}`}
        role="dialog"
        aria-modal="true"
        aria-label="Stock Details report"
        onClick={(e) => e.stopPropagation()}
      >
        <div className={styles.transferReportHead}>
          <div style={{ display: "flex", gap: "8px", marginLeft: "auto" }}>
            <DownloadReportButton
              fileName={reportFileName("Stock-Details-Report", whFilter === "all" ? "All" : WH_BUTTON_LABEL[whFilter], day)}
              onePage
            />
            <button type="button" className={styles.btnActionGhost} onClick={onClose}>
              Close
            </button>
          </div>
        </div>
        {/* Logo on the left, "Report" on the right: same as the other reports */}
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "40px", margin: "0 0 20px" }}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={`${typeof window !== "undefined" ? window.location.origin : ""}${LOGO_SRC}`}
            alt="Eternalgy"
            width={1332}
            height={176}
            style={{ display: "block", height: "24px", width: "auto", flex: "none" }}
          />
          <span style={{ fontSize: "20px", fontWeight: 700, color: "#000" }}>Report</span>
        </div>
        <h2 style={{ fontSize: "18px", fontWeight: 700, textAlign: "center", margin: "0 0 14px", color: "#000" }}>
          Stock Details &middot; {getDayLabel(day)}
        </h2>
        <p style={{ margin: "0 0 4px", fontSize: "12px", color: "#000" }}>
          <strong>Warehouse:</strong> {whName}
        </p>

        <h3 style={sectionTitle}>1. Stock on hand</h3>
        <table style={table}>
          <thead>
            <tr>
              <th style={head}>Item</th>
              <th style={headNum}>On hand</th>
            </tr>
          </thead>
          <tbody>
            {balances.map((card) => (
              <tr key={card.id}>
                <td style={cell}>{card.label}</td>
                <td style={num}>{card.onHand ?? "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>

        <h3 style={sectionTitle}>2. Stock in and out</h3>
        {sections.map((section) => {
          const totalIn = section.rows.reduce((sum, row) => sum + row.inQty, 0);
          const totalOut = section.rows.reduce((sum, row) => sum + row.qty, 0);
          return (
            <div key={section.id} style={{ marginBottom: "10px" }}>
              <p style={{ margin: "0 0 4px", fontSize: "12px", fontWeight: 700, color: "#000" }}>{section.title}</p>
              {section.rows.length === 0 ? (
                <p style={{ margin: 0, fontSize: "11px", color: "#555" }}>No stock in or out on this day.</p>
              ) : (
                <table style={table}>
                  <thead>
                    <tr>
                      <th style={head}>Type</th>
                      <th style={head}>Model</th>
                      <th style={headNum}>In</th>
                      <th style={headNum}>Out</th>
                      <th style={headNum}>Balance</th>
                    </tr>
                  </thead>
                  <tbody>
                    {section.rows.map((row) => (
                      <tr key={row.model}>
                        <td style={cell}>{row.type}</td>
                        <td style={cell}>{row.model}</td>
                        <td style={num}>{row.inQty}</td>
                        <td style={num}>{row.qty}</td>
                        <td style={num}>{row.inQty - row.qty}</td>
                      </tr>
                    ))}
                    <tr>
                      <td style={{ ...cell, fontWeight: 700 }} colSpan={2}>
                        Total
                      </td>
                      <td style={{ ...num, fontWeight: 700 }}>{totalIn}</td>
                      <td style={{ ...num, fontWeight: 700 }}>{totalOut}</td>
                      <td style={{ ...num, fontWeight: 700 }}>{totalIn - totalOut}</td>
                    </tr>
                  </tbody>
                </table>
              )}
            </div>
          );
        })}

        <h3 style={sectionTitle}>3. Stock out by customer</h3>
        {outLines.length === 0 ? (
          <p style={{ margin: 0, fontSize: "11px", color: "#555" }}>No stock out on this day.</p>
        ) : (
          <table style={table}>
            <thead>
              <tr>
                <th style={head}>Customer</th>
                <th style={head}>Item</th>
                <th style={head}>Model</th>
                <th style={head}>Serial Code / Number</th>
                <th style={headNum}>Qty</th>
                <th style={head}>Prepared by</th>
              </tr>
            </thead>
            <tbody>
              {outLines.map((line, index) => (
                <tr key={`${line.customer}-${line.model}-${index}`}>
                  <td style={cell}>{line.customer}</td>
                  <td style={cell}>{line.item}</td>
                  <td style={cell}>{line.model}</td>
                  <td style={{ ...cell, fontFamily: "monospace" }}>{line.serials}</td>
                  <td style={num}>{line.qty}</td>
                  <td style={cell}>{line.preparedBy}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

// Special materials for commercial jobs (the stock out "Special Material" list). No stock
// counts are loaded for them yet, so every quantity shows as —.
function SpecialMaterialSection({ warehouses }: { warehouses: WarehouseCode[] }) {
  return (
    <>
      <h2 className={styles.sectionTitle}>Special Material</h2>
      <p className={styles.kicker}>
        Used on commercial jobs (Tariff B or Selco). Quantities are not loaded yet and show as —.
      </p>
      <div className={styles.tableWrap}>
        <table className={`${styles.detailTable} ${styles.mountTable}`}>
          <thead>
            <tr>
              <th scope="col">Item</th>
              {warehouses.map((wh) => (
                <th key={wh} scope="col" className={styles.num}>
                  {WH_BUTTON_LABEL[wh]}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {COMMERCIAL_GROUPS.map((group) => (
              <Fragment key={group.label}>
                <tr>
                  <th scope="colgroup" colSpan={warehouses.length + 1} style={{ textAlign: "left" }}>
                    {group.label}
                  </th>
                </tr>
                {group.parts.map((name) => (
                  <tr key={name}>
                    <td>{name}</td>
                    {warehouses.map((wh) => (
                      <td key={wh} className={styles.num}>
                        —
                      </td>
                    ))}
                  </tr>
                ))}
              </Fragment>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}

function MountingStructureSection({ warehouses }: { warehouses: WarehouseCode[] }) {
  const show = (value: number | null) => (value === null ? "—" : value);
  return (
    <>
      <h2 className={styles.sectionTitle}>Mounting Structure</h2>
      <p className={styles.kicker}>
        Two systems in use: MIBET and WINSTAR. Quantities are not loaded yet and show as —.
      </p>
      <div className={styles.tableGrid}>
        {MOUNTING_SYSTEMS.map((system) => (
          <div key={system.id} className={styles.tableWrap}>
            <table className={`${styles.detailTable} ${styles.mountTable}`}>
              <caption style={{ textAlign: "left", fontWeight: 700, padding: "8px 0" }}>{system.label}</caption>
              <thead>
                <tr>
                  <th scope="col">Part</th>
                  {warehouses.map((wh) => (
                    <th key={wh} scope="col" className={styles.num}>
                      {WH_BUTTON_LABEL[wh]}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {system.groups.map((group) => (
                  <Fragment key={group.label}>
                    <tr>
                      <th scope="colgroup" colSpan={warehouses.length + 1} style={{ textAlign: "left" }}>
                        {group.label}
                      </th>
                    </tr>
                    {group.parts.map((part) => (
                      <tr key={part.name}>
                        <td>{part.name}</td>
                        {warehouses.map((wh) => (
                          <td key={wh} className={styles.num}>
                            {show(wh === "JB" ? part.jb : wh === "KL" ? part.kl : null)}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </Fragment>
                ))}
              </tbody>
            </table>
          </div>
        ))}
      </div>
    </>
  );
}

type StockTableRow = {
  group: string | undefined;
  model: string;
  serialCode: string;
  highlight: boolean;
  qty: Record<WarehouseCode, number>;
};

// One row per model, with each warehouse's count in its own column side by side.
function groupByModel(items: StockDetailItem[]): StockTableRow[] {
  const rows = new Map<string, StockTableRow>();
  for (const item of items) {
    const key = `${item.group ?? ""}|${item.model}`;
    const row = rows.get(key) ?? {
      group: item.group,
      model: item.model,
      serialCode: item.serialCode,
      highlight: false,
      qty: { JB: 0, KL: 0, KLG: 0 },
    };
    row.qty[item.warehouse] += item.qty;
    row.highlight ||= Boolean(item.highlight);
    rows.set(key, row);
  }
  return [...rows.values()];
}

// The type and model of each panel, inverter or battery that appears in stock out,
// with how many the jobs need and across how many jobs. Models come straight from the
// invoice lines of the booked jobs.
function modelTypeOf(category: "panel" | "inverter" | "battery", model: string): string {
  if (category === "panel") return detectPanelBrand(model);
  if (category === "inverter") {
    if (/hybri?d/i.test(model)) return "Hybrid";
    if (/micro/i.test(model)) return "Micro";
    if (/string/i.test(model)) return "String";
    return "—";
  }
  return "—";
}

// One customer (stock out) or supplier (stock in) of a model on the picked day.
type ModelUse = { txId: string; kind: "in" | "out"; party: string; serials: string[]; qty: number; preparedBy: string };

// Panel / Inverter / Battery models with that day's stock in (▲), stock out (▼) and who each
// unit is for. Used by the Stock Details tables and the Stock Details report.
type ModelRow = { model: string; type: string; qty: number; inQty: number; jobs: number; uses: ModelUse[] };
function buildModelRows(
  transactions: StockTransaction[],
  verifications: VerificationRecord[],
  category: "panel" | "inverter" | "battery",
  day: string,
): ModelRow[] {
  type Entry = { qty: number; inQty: number; jobs: Set<string>; type: string; uses: ModelUse[] };
  const byModel = new Map<string, Entry>();
  // Inverters: every model on the staff list is shown, with 0 when nothing needs it.
  if (category === "panel") {
    PANEL_MODELS.forEach((code) => byModel.set(code, { qty: 0, inQty: 0, jobs: new Set<string>(), type: detectPanelBrand(code), uses: [] }));
  }
  if (category === "battery") {
    BATTERY_MODELS.forEach((code) => byModel.set(code, { qty: 0, inQty: 0, jobs: new Set<string>(), type: "—", uses: [] }));
  }
  if (category === "inverter") {
    Object.values(INVERTER_MODELS).flat().forEach((code) =>
      byModel.set(code, { qty: 0, inQty: 0, jobs: new Set<string>(), type: code.startsWith("M") ? "Micro" : code.startsWith("H") ? "Hybrid" : "String", uses: [] }),
    );
  }
  transactions
    // Stock out (▼) and stock in (▲) on the day picked above the table.
    .filter((tx) => (tx.type === "out" || tx.type === "in") && txDate(tx) === day)
    .forEach((tx) => {
      txLines(tx)
        .filter((line) => line.category === category)
        .forEach((line) => {
          // Inverters are listed by model code (R5-5K-S2), not the long invoice wording.
          const key =
            category === "inverter"
              ? inverterModelCode(line.model)
              : category === "battery"
                ? (batteryModelCode(line.model) ?? "")
                : category === "panel"
                  ? (panelModelCode(line.model) ?? "")
                  : line.model;
          // Panels: only the models on the staff model list.
          if (category === "panel" && !key) return;
          // Batteries: only the models on the staff model list.
          if (category === "battery" && !key) return;
          // Inverters: only the models on the staff model list; anything else is left out.
          if (category === "inverter" && !Object.values(INVERTER_MODELS).some((list) => list.includes(key))) return;
          const entry = byModel.get(key) ?? { qty: 0, inQty: 0, jobs: new Set<string>(), type: modelTypeOf(category, line.model), uses: [] };
          // Who it is for (stock out: the customer) or from (stock in), shown when the row is clicked.
          const kind = tx.type === "in" ? "in" : "out";
          const same = entry.uses.find((use) => use.txId === tx.id && use.kind === kind);
          const serial = line.serialCode || tx.serialCode;
          if (same) {
            same.qty += line.qty ?? 0;
            if (serial && !same.serials.includes(serial)) same.serials.push(serial);
          } else {
            // Prepared by: who completed this item for the job, else who verified the whole job.
            const preparedBy =
              kind === "out"
                ? verifications.find((r) => r.jobRef === tx.reference && r.material === category)?.by ||
                  verifications.find((r) => r.jobRef === tx.reference && r.material === "job")?.by ||
                  ""
                : "";
            entry.uses.push({ txId: tx.id, kind, party: tx.party, serials: serial ? [serial] : [], qty: line.qty ?? 0, preparedBy });
          }
          if (tx.type === "in") {
            entry.inQty += line.qty ?? 0;
          } else {
            entry.qty += line.qty ?? 0;
            entry.jobs.add(tx.id);
          }
          byModel.set(key, entry);
        });
    });
  return Array.from(byModel.entries())
    .map(([model, entry]) => ({ model, type: entry.type, qty: entry.qty, inQty: entry.inQty, jobs: entry.jobs.size, uses: entry.uses }))
    .sort((a, b) => b.qty - a.qty); // stable: equal quantities keep the model-list order
}

function StockOutModelTable({
  title,
  category,
  transactions,
  verifications,
  query,
  day,
}: {
  title: string;
  category: "panel" | "inverter" | "battery";
  transactions: StockTransaction[];
  // Who completed each item on Stock Out Verification (the Prepared by column).
  verifications: VerificationRecord[];
  query: string;
  // Only this day's stock in / out (YYYY-MM-DD), picked on Stock Details.
  day: string;
}) {
  const rows = useMemo(() => buildModelRows(transactions, verifications, category, day), [transactions, verifications, category, day]);

  // Inverters are split into String, Micro and Hybrid tabs.
  const [inverterType, setInverterType] = useState("String");
  const needle = query.trim().toLowerCase();
  const matching = needle
    ? rows.filter((row) => row.model.toLowerCase().includes(needle) || row.type.toLowerCase().includes(needle))
    : rows;
  const shown = category === "inverter" ? matching.filter((row) => row.type === inverterType) : matching;
  const total = shown.reduce((sum, row) => sum + row.qty, 0);
  const totalIn = shown.reduce((sum, row) => sum + row.inQty, 0);
  // The model whose customers are shown in a pop-up (tap a row to open it).
  const [openModel, setOpenModel] = useState<string | null>(null);
  const openRow = openModel ? rows.find((row) => row.model === openModel && row.uses.length > 0) ?? null : null;

  return (
    <div className={styles.tableWrap}>
      {category === "inverter" && (
        <div className={styles.txFilterPills} role="tablist" aria-label="Inverter type" style={{ margin: "8px 0" }}>
          {["String", "Micro", "Hybrid"].map((type) => (
            <button
              key={type}
              type="button"
              role="tab"
              aria-selected={inverterType === type}
              className={`${styles.txPill} ${inverterType === type ? styles.txPillActive : ""}`}
              onClick={() => setInverterType(type)}
            >
              {type} ({matching.filter((row) => row.type === type).length})
            </button>
          ))}
        </div>
      )}
      <table className={`${styles.detailTable} ${styles.mountTable}`}>
        <caption style={{ textAlign: "left", fontWeight: 700, padding: "8px 0" }}>{title}</caption>
        <thead>
          <tr>
            <th scope="col">Type</th>
            <th scope="col">Model</th>
            <th scope="col" className={styles.num} title="Qty (stock in)" aria-label="Qty (stock in)">
              <span aria-hidden="true" style={{ color: "var(--green)", fontSize: "13px" }}>&#9650;</span>
            </th>
            <th scope="col" className={styles.num} title="Qty (stock out)" aria-label="Qty (stock out)">
              <span aria-hidden="true" style={{ color: "var(--red)", fontSize: "13px" }}>&#9660;</span>
            </th>
            <th scope="col" className={styles.num} title="Balance = stock in (▲) minus stock out (▼)">Balance</th>
          </tr>
        </thead>
        <tbody>
          {shown.length === 0 ? (
            <tr>
              <td colSpan={5}>
                No {title.toLowerCase()} models from stock out yet. Sign in to the dashboard (same browser) to load the
                booked jobs.
              </td>
            </tr>
          ) : (
            shown.map((row) => (
              <tr
                key={row.model}
                // Only a model with customers on this day opens the pop-up.
                className={row.uses.length > 0 ? styles.txRowClickable : undefined}
                onClick={row.uses.length > 0 ? () => setOpenModel(row.model) : undefined}
                title={row.uses.length > 0 ? "Show which customers" : undefined}
                style={row.uses.length > 0 ? undefined : { cursor: "default" }}
              >
                <td>{row.type}</td>
                <td>{row.model}</td>
                <td className={styles.num}>{row.inQty}</td>
                <td className={styles.num}>{row.qty}</td>
                <td className={styles.num}>{row.inQty - row.qty}</td>
              </tr>
            ))
          )}
        </tbody>
        {shown.length > 0 && (
          <tfoot>
            <tr>
              <th scope="row" colSpan={2} style={{ textAlign: "left" }}>
                Total
              </th>
              <td className={styles.num}>
                <strong>{totalIn}</strong>
              </td>
              <td className={styles.num}>
                <strong>{total}</strong>
              </td>
              <td className={styles.num}>
                <strong>{totalIn - total}</strong>
              </td>
            </tr>
          </tfoot>
        )}
      </table>

      {/* Pop-up: which customers this model is for on the picked day */}
      {openRow && (
        <div className={styles.bankingReceiptBackdrop} onClick={() => setOpenModel(null)}>
          <div
            className={`${styles.transferReportCard} ${styles.modelUsesCard}`}
            role="dialog"
            aria-modal="true"
            aria-label={`${openRow.model} customers`}
            onClick={(e) => e.stopPropagation()}
          >
            <div className={styles.transferReportHead}>
              <div>
                <h2 className={styles.bankingCardTitle}>{openRow.model}</h2>
                <p className={styles.kicker} style={{ margin: "2px 0 0" }}>
                  {title} · {getDayLabel(day)}
                </p>
              </div>
              <button type="button" className={styles.btnActionGhost} onClick={() => setOpenModel(null)}>
                Close
              </button>
            </div>
            {openRow.uses.length === 0 ? (
              <p className={styles.note} style={{ margin: "8px 0 0" }}>No customers for {openRow.model} on this day.</p>
            ) : (
              <table className={styles.modelUsesTable}>
                <thead>
                  <tr>
                    <th scope="col">Customer</th>
                    <th scope="col">Serial Code / Number</th>
                    <th scope="col" className={styles.num}>Qty</th>
                    <th scope="col">Prepared by</th>
                  </tr>
                </thead>
                <tbody>
                  {openRow.uses.map((use) => (
                    <tr key={`${use.txId}-${use.kind}`}>
                      <td>{use.party || "—"}</td>
                      <td className={styles.modelUsesSerial}>{use.serials.length ? use.serials.join(", ") : "—"}</td>
                      <td className={styles.num}>
                        <span
                          aria-label={use.kind === "in" ? "stock in" : "stock out"}
                          style={{ color: use.kind === "in" ? "var(--green)" : "var(--red)", marginRight: "4px" }}
                        >
                          {use.kind === "in" ? "▲" : "▼"}
                        </span>
                        {use.qty}
                      </td>
                      <td>{use.preparedBy || "—"}</td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr>
                    <td colSpan={2}>
                      <strong>Total</strong>
                    </td>
                    <td className={styles.num}>
                      <strong>
                        {openRow.inQty > 0 && <span style={{ color: "var(--green)", marginRight: "6px" }}>▲{openRow.inQty}</span>}
                        <span style={{ color: "var(--red)" }}>▼{openRow.qty}</span>
                      </strong>
                    </td>
                    <td />
                  </tr>
                </tfoot>
              </table>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function StockTable({
  title,
  items,
  warehouses,
  query,
}: {
  title: string;
  items: StockDetailItem[];
  warehouses: WarehouseCode[];
  query: string;
}) {
  const needle = query.trim().toLowerCase();
  const allRows = groupByModel(items);
  const rows = needle
    ? allRows.filter((row) =>
        [row.group ?? "", row.model, row.serialCode].some((text) => text.toLowerCase().includes(needle)),
      )
    : allRows;
  const rowTotal = (row: StockTableRow) => warehouses.reduce((sum, wh) => sum + row.qty[wh], 0);
  const whTotal = (wh: WarehouseCode) => rows.reduce((sum, row) => sum + row.qty[wh], 0);
  const total = rows.reduce((sum, row) => sum + rowTotal(row), 0);
  const showTotal = warehouses.length > 1;
  const columns = 2 + warehouses.length + (showTotal ? 1 : 0);

  if (allRows.length === 0) {
    return (
      <div className={styles.tableBlock}>
        <h2 className={styles.sectionTitle}>{title}</h2>
        <p className={styles.note}>No items match the current filter.</p>
      </div>
    );
  }

  return (
    <div className={styles.tableBlock}>
      <h2 className={styles.sectionTitle}>
        {title}
        <span className={styles.sectionCount}>{total}</span>
      </h2>
      {rows.length === 0 ? (
        <p className={styles.note}>Nothing matches &ldquo;{query.trim()}&rdquo;.</p>
      ) : (
        <div className={styles.tableWrap}>
          <table className={styles.detailTable}>
            <thead>
              <tr>
                <th scope="col">Model</th>
                <th scope="col">Code</th>
                {warehouses.map((wh) => (
                  <th key={wh} scope="col" className={styles.num}>{WH_BUTTON_LABEL[wh]}</th>
                ))}
                {showTotal && <th scope="col" className={styles.num}>Total</th>}
              </tr>
            </thead>
            <tbody>
              {rows.map((row, index) => (
                <Fragment key={`${row.group ?? ""}|${row.model}`}>
                  {row.group && row.group !== rows[index - 1]?.group && (
                    <tr className={styles.groupRow}>
                      <th scope="colgroup" colSpan={columns}>{row.group}</th>
                    </tr>
                  )}
                  <tr
                    className={
                      [rowTotal(row) === 0 && styles.rowZero, row.highlight && styles.rowHighlight]
                        .filter(Boolean)
                        .join(" ") || undefined
                    }
                  >
                    <td>{row.model}</td>
                    <td className={styles.code}>{row.serialCode}</td>
                    {warehouses.map((wh) => (
                      <td key={wh} className={`${styles.num} ${row.qty[wh] === 0 ? styles.cellZero : ""}`}>
                        {row.qty[wh]}
                      </td>
                    ))}
                    {showTotal && <td className={styles.num}>{rowTotal(row)}</td>}
                  </tr>
                </Fragment>
              ))}
            </tbody>
            <tfoot>
              <tr>
                <td colSpan={2}>Total</td>
                {warehouses.map((wh) => (
                  <td key={wh} className={styles.num}>{showTotal ? whTotal(wh) : <strong>{whTotal(wh)}</strong>}</td>
                ))}
                {showTotal && <td className={styles.num}><strong>{total}</strong></td>}
              </tr>
            </tfoot>
          </table>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Tab 3 — Project Team
// ---------------------------------------------------------------------------



// ---------------------------------------------------------------------------
// Project Team: read-only copy of the dashboard's Arranged Installation
// (only when signed in to the dashboard; otherwise the sample page below shows)
// ---------------------------------------------------------------------------

type ArrangedCustomerPayload = {
  jobId: string;
  invoice: string;
  name: string;
  address: string;
  phone: string;
  email: string;
  agent: string;
  phase: string;
  panel: string;
  inverter: string;
  remark: string;
  date: string;
  time: string;
  hasBattery: boolean;
};

type ArrangedGroupPayload = {
  id: string;
  teamLabel: string;
  baseLocation: string;
  installationTeam: string;
  wiringTeam: string;
  supervisors: string[];
  members: string[];
  cars: string[];
  installationDate: string;
  installationEndDate: string;
  customers: ArrangedCustomerPayload[];
};

const ARR_MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const ARR_BAND_COLOURS = ["#2563eb", "#ea580c", "#16a34a", "#9333ea", "#0891b2", "#be123c"];

function arrParts(iso: string) {
  const [y, m, d] = iso.slice(0, 10).split("-").map(Number);
  return { y, m, d };
}

function arrShort(iso: string) {
  const { m, d } = arrParts(iso);
  return `${d} ${ARR_MONTHS[m - 1]}`;
}

function arrLong(iso: string) {
  return `${arrShort(iso)} ${arrParts(iso).y}`;
}

function arrMonday(iso: string): string {
  const { y, m, d } = arrParts(iso);
  const date = new Date(Date.UTC(y, m - 1, d));
  const back = (date.getUTCDay() + 6) % 7;
  date.setUTCDate(date.getUTCDate() - back);
  return date.toISOString().slice(0, 10);
}

function arrWeekLabel(mondayIso: string) {
  const { y, m, d } = arrParts(mondayIso);
  const sat = new Date(Date.UTC(y, m - 1, d + 5)).toISOString().slice(0, 10);
  return `${arrShort(mondayIso)} – ${arrShort(sat)} ${arrParts(sat).y}`;
}

function ArrangedInstallationView({ groups, tabs }: { groups: ArrangedGroupPayload[]; tabs?: React.ReactNode }) {
  const weeks = useMemo(
    () => Array.from(new Set(groups.map((g) => arrMonday(g.installationDate)))).sort(),
    [groups],
  );
  const todayWeek = arrMonday(new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Kuala_Lumpur" }));
  const [weekIndex, setWeekIndex] = useState<number | null>(null);
  const index =
    weekIndex ?? Math.max(0, weeks.includes(todayWeek) ? weeks.indexOf(todayWeek) : weeks.length - 1);
  const week = weeks[index];
  // Bookings are grouped by team (the "Group by" picker was removed).
  const groupBy = "team" as "team" | "installation" | "wiring";
  const [nameQuery, setNameQuery] = useState("");
  const query = nameQuery.trim().toLowerCase();

  // Combine a week's bookings that share the chosen key into one section. Crew fields
  // that differ between the combined bookings are listed together.
  const mergeWeek = (rawGroups: ArrangedGroupPayload[]): ArrangedGroupPayload[] => {
    const keyOf = (g: ArrangedGroupPayload) =>
      groupBy === "team"
        ? g.teamLabel || "No team"
        : groupBy === "installation"
        ? g.installationTeam || "No installation team"
        : g.wiringTeam || "No wiring team";
    const merged = new Map<string, ArrangedGroupPayload>();
    rawGroups.forEach((g) => {
      const key = keyOf(g);
      const join = (a: string, b: string) => (b && !a.split(" / ").includes(b) ? (a ? `${a} / ${b}` : b) : a);
      const union = (a: string[], b: string[]) => Array.from(new Set([...a, ...b]));
      const existing = merged.get(key);
      if (!existing) {
        merged.set(key, { ...g, id: key, teamLabel: key, customers: [...g.customers] });
        return;
      }
      existing.baseLocation = join(existing.baseLocation, g.baseLocation);
      existing.installationTeam = join(existing.installationTeam, g.installationTeam);
      existing.wiringTeam = join(existing.wiringTeam, g.wiringTeam);
      existing.supervisors = union(existing.supervisors, g.supervisors);
      existing.members = union(existing.members, g.members);
      existing.cars = union(existing.cars, g.cars);
      existing.customers = [...existing.customers, ...g.customers];
    });
    return Array.from(merged.values()).map((g) => ({
      ...g,
      customers: [...g.customers].sort((a, b) => (a.date + (a.time || "")).localeCompare(b.date + (b.time || ""))),
    }));
  };

  // No search: the chosen week. Searching: every week with a customer whose name (or
  // invoice number) matches, showing only the matching customers.
  const matches = (c: ArrangedCustomerPayload) =>
    c.name.toLowerCase().includes(query) || c.invoice.toLowerCase().includes(query);
  const sections: { week: string; groups: ArrangedGroupPayload[] }[] = query
    ? weeks
        .map((w) => ({
          week: w,
          groups: mergeWeek(groups.filter((g) => arrMonday(g.installationDate) === w))
            .map((g) => ({ ...g, customers: g.customers.filter(matches) }))
            .filter((g) => g.customers.length > 0),
        }))
        .filter((section) => section.groups.length > 0)
    : [{ week, groups: mergeWeek(groups.filter((g) => arrMonday(g.installationDate) === week)) }];
  const matchCount = sections.reduce((sum, sec) => sum + sec.groups.reduce((n, g) => n + g.customers.length, 0), 0);

  return (
    <section className={styles.screen} aria-labelledby="warehouse-arranged">
      <div className={styles.arrHeader}>
        <div>
          <h1 id="warehouse-arranged">Project Team</h1>
          <p className={styles.kicker}>Details are from Project Team</p>
        </div>
        <div className={styles.arrNav}>
          {/* ‹ calendar › : previous week, the week of a picked day, next week */}
          <DateNav
            value={weeks[index] ?? ""}
            onPick={(day) => {
              // The latest listed week that starts on or before the picked day.
              const monday = arrMonday(day);
              let pick = 0;
              weeks.forEach((w, i) => {
                if (w <= monday) pick = i;
              });
              setWeekIndex(pick);
            }}
            onPrev={() => setWeekIndex(index - 1)}
            onNext={() => setWeekIndex(index + 1)}
            prevDisabled={index <= 0}
            nextDisabled={index >= weeks.length - 1}
            prevLabel="Previous week"
            nextLabel="Next week"
            pickLabel={weeks[index] ? `Week ${arrWeekLabel(weeks[index])} · pick a day` : "Pick a day"}
          />
        </div>
      </div>
      {/* Tabs on the left, Sync on the right, across the full width */}
      <div style={{ margin: "-4px 0 12px" }}>{tabs}</div>

      {/* Customer search, below the week buttons */}
      <div style={{ display: "flex", justifyContent: "flex-end", margin: "0 0 12px" }}>
        <input
          type="search"
          className={styles.searchCompact}
          placeholder="Search customer name"
          aria-label="Search customer name"
          value={nameQuery}
          onChange={(e) => setNameQuery(e.target.value)}
        />
      </div>

      {query && (
        <p className={styles.note} style={{ margin: "0 0 10px" }}>
          {matchCount === 0
            ? `No customer matches "${nameQuery.trim()}" in any week.`
            : `${matchCount} customer${matchCount === 1 ? "" : "s"} matching "${nameQuery.trim()}", across all weeks.`}
        </p>
      )}
      {!query && sections[0].groups.length === 0 ? (
        <p className={styles.note}>
          No arranged installation in this period{weeks[index] ? ` (week ${arrWeekLabel(weeks[index])})` : ""}.
        </p>
      ) : (
        sections.flatMap((section) => section.groups.map((group, gi) => (
          <div key={`${section.week}-${group.id}`} className={styles.arrGroup}>
            <div className={styles.arrWeekBar}>Week {arrWeekLabel(section.week)}</div>
            <div className={styles.arrTeamBand} style={{ background: ARR_BAND_COLOURS[gi % ARR_BAND_COLOURS.length] }}>
              <div className={styles.arrTeamName}>
                <strong>{group.teamLabel || "Team"}</strong>
              </div>
              <div className={styles.arrCrew}>
                <div>
                  <small>INSTALLATION TEAM</small>
                  <span>{group.installationTeam || "—"}</span>
                </div>
                <div>
                  <small>WIRING TEAM</small>
                  <span>{group.wiringTeam || "—"}</span>
                </div>
                <div>
                  <small>SITE SUPERVISOR</small>
                  <span>{group.supervisors.join(", ") || "—"}</span>
                </div>
                <div>
                  <small>TEAM MEMBER</small>
                  <span>{group.members.join(", ") || "—"}</span>
                </div>
                <div>
                  <small>CAR</small>
                  <span>{group.cars.join(", ") || "—"}</span>
                </div>
              </div>
            </div>

            <div className={styles.arrTableWrap}>
            <table className={styles.arrTable}>
              <thead>
                <tr>
                  <th>SLOT</th>
                  <th>CUSTOMER</th>
                  <th>ADDRESS</th>
                  <th>PHONE</th>
                  <th>EMAIL</th>
                  <th>AGENT</th>
                  <th>PHASE</th>
                  <th>PANEL</th>
                  <th>INVERTER</th>
                  <th>REMARK</th>
                </tr>
              </thead>
              <tbody>
                {group.customers.map((c) => (
                  <tr key={c.jobId}>
                    <td data-label="Slot" className={styles.arrSlot}>
                      <strong>{c.date ? arrLong(c.date) : "—"}</strong>
                      {c.time && <span>{c.time}</span>}
                    </td>
                    <td data-label="Customer">
                      <strong>{c.name || "—"}</strong>
                      {c.invoice && <span className={styles.arrInvoice}>{c.invoice}</span>}
                      {c.hasBattery && <span className={styles.arrBatteryTag}>Battery</span>}
                    </td>
                    <td data-label="Address">{c.address || "—"}</td>
                    <td data-label="Phone">{c.phone || "—"}</td>
                    <td data-label="Email">{c.email || "—"}</td>
                    <td data-label="Agent">{c.agent || "—"}</td>
                    <td data-label="Phase">{c.phase || "—"}</td>
                    <td data-label="Panel">{c.panel || "—"}</td>
                    <td data-label="Inverter">{c.inverter || "—"}</td>
                    <td data-label="Remark">{c.remark || "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            </div>
          </div>
        )))
      )}
    </section>
  );
}

// ---------------------------------------------------------------------------
// Delivery Schedule: read-only copy of the dashboard's Delivery Schedule
// (/api/warehouse/delivery; only when signed in)
// ---------------------------------------------------------------------------

type DeliveryCustomerPayload = {
  jobId: string;
  invoice: string;
  name: string;
  phone: string;
  address: string;
  agent: string;
  phase: string;
  panel: string;
  inverter: string;
  etaDate: string;
  etaTime: string;
  installDate: string;
  installTime: string;
  team: string;
  teamClass: string;
  remark: string;
  atap: boolean;
  battery: boolean;
  ev: boolean;
  om: boolean;
  kohKengKiat: boolean;
  isWarehouse: boolean;
};

type DeliveryRunPayload = {
  id: string;
  name: string;
  deliveryDate: string;
  departureTime: string;
  weekLabel: string;
  warehouse: string;
  deliveryPic: string;
  contactNumber: string;
  // Lorry plate from the run header on the sheet ("JMG 8811").
  plateNumber?: string;
  isWarehouse: boolean;
  teamClass: string;
  order: number | null;
  totalPanels: number;
  customers: DeliveryCustomerPayload[];
};

// Same wording as the dashboard's delivery week bar: the run's own date decides the Mon–Sat
// week (the sheet's label, e.g. "1311 - 21/11/2026", is only used for a run with no date).
function deliveryWeekLabel(weekLabel: string, deliveryDate: string): string {
  if (/^\d{4}-\d{2}-\d{2}$/.test(deliveryDate)) return `DELIVERY~ Week : ${arrWeekLabel(arrMonday(deliveryDate))}`;
  const raw = weekLabel.trim();
  if (raw) {
    if (/^delivery\s*~/i.test(raw)) return raw;
    if (/^week\b/i.test(raw)) return `DELIVERY~ ${raw}`;
    return `DELIVERY~ Week : ${raw}`;
  }
  return deliveryDate ? `DELIVERY~ Week : ${arrWeekLabel(arrMonday(deliveryDate))}` : "DELIVERY~ Unscheduled";
}

// "09:00" -> "9am", "14:30" -> "2.30pm" (as the dashboard writes installation times).
function sheetClock(value: string): string {
  const m = value.match(/^(\d{1,2}):(\d{2})/);
  if (!m) return "";
  const hours = Number(m[1]);
  if (hours > 23) return "";
  const suffix = hours >= 12 ? "pm" : "am";
  const h12 = hours % 12 === 0 ? 12 : hours % 12;
  return m[2] === "00" ? `${h12}${suffix}` : `${h12}.${m[2]}${suffix}`;
}

function titleWords(value: string): string {
  return value
    .trim()
    .toLocaleLowerCase("en-MY")
    .replace(/(^|[\s(/'-])\p{L}/gu, (letter) => letter.toLocaleUpperCase("en-MY"));
}

function DeliveryScheduleView({ runs, tabs }: { runs: DeliveryRunPayload[]; tabs?: React.ReactNode }) {
  const weeks = useMemo(() => Array.from(new Set(runs.map((r) => arrMonday(r.deliveryDate)))).sort(), [runs]);
  const todayWeek = arrMonday(new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Kuala_Lumpur" }));
  const [weekIndex, setWeekIndex] = useState<number | null>(null);
  const index =
    weekIndex ?? Math.max(0, weeks.includes(todayWeek) ? weeks.indexOf(todayWeek) : weeks.length - 1);
  const week = weeks[index];
  const [nameQuery, setNameQuery] = useState("");
  const query = nameQuery.trim().toLowerCase();

  // No search: the chosen week. Searching: every week, only the matching customers.
  const matches = (c: DeliveryCustomerPayload) =>
    c.name.toLowerCase().includes(query) || c.invoice.toLowerCase().includes(query);
  const shown = query
    ? runs
        .map((r) => ({ ...r, customers: r.customers.filter(matches) }))
        .filter((r) => r.customers.length > 0)
    : runs.filter((r) => arrMonday(r.deliveryDate) === week);
  const matchCount = shown.reduce((n, r) => n + r.customers.length, 0);

  return (
    <section className={styles.screen} aria-labelledby="warehouse-delivery">
      <div className={styles.arrHeader}>
        <div>
          <h1 id="warehouse-delivery">Project Team</h1>
          <p className={styles.kicker}>Details are from Project Team</p>
        </div>
        <div className={styles.arrNav}>
          <DateNav
            value={weeks[index] ?? ""}
            onPick={(day) => {
              const monday = arrMonday(day);
              let pick = 0;
              weeks.forEach((w, i) => {
                if (w <= monday) pick = i;
              });
              setWeekIndex(pick);
            }}
            onPrev={() => setWeekIndex(index - 1)}
            onNext={() => setWeekIndex(index + 1)}
            prevDisabled={index <= 0}
            nextDisabled={index >= weeks.length - 1}
            prevLabel="Previous week"
            nextLabel="Next week"
            pickLabel={weeks[index] ? `Week ${arrWeekLabel(weeks[index])} · pick a day` : "Pick a day"}
          />
        </div>
      </div>
      {/* Tabs on the left, Sync on the right, across the full width */}
      <div style={{ margin: "-4px 0 12px" }}>{tabs}</div>

      <div style={{ display: "flex", justifyContent: "flex-end", margin: "0 0 12px" }}>
        <input
          type="search"
          className={styles.searchCompact}
          placeholder="Search customer name"
          aria-label="Search customer name"
          value={nameQuery}
          onChange={(e) => setNameQuery(e.target.value)}
        />
      </div>

      {query && (
        <p className={styles.note} style={{ margin: "0 0 10px" }}>
          {matchCount === 0
            ? `No customer matches "${nameQuery.trim()}" in any week.`
            : `${matchCount} customer${matchCount === 1 ? "" : "s"} matching "${nameQuery.trim()}", across all weeks.`}
        </p>
      )}
      {!query && shown.length === 0 ? (
        <p className={styles.note}>
          No delivery run in this period{weeks[index] ? ` (week ${arrWeekLabel(weeks[index])})` : ""}.
        </p>
      ) : (
        // The dashboard's own Delivery Schedule table classes (globals.css), so the colours match
        // exactly. Fields are read-only here.
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
              <col className="rti-col-scheduling-team" />
              <col className="rti-col-remark" />
            </colgroup>
            <tbody>
              {shown.map((run) => (
                <Fragment key={run.id}>
                  <tr
                    className={`schedule-band rti-team-band rti-team-band-sub ${run.teamClass}${
                      run.isWarehouse ? " is-warehouse-sub" : ""
                    }`}
                  >
                    <th colSpan={11} scope="colgroup">
                      <div className="schedule-band-sub-content">
                        <span className="schedule-band-week">{deliveryWeekLabel(run.weekLabel, run.deliveryDate)}</span>
                      </div>
                    </th>
                  </tr>
                  <tr
                    className={`schedule-band rti-team-band rti-team-band-main delivery-run-band ${run.teamClass}${
                      run.isWarehouse ? " is-warehouse-main" : ""
                    }`}
                  >
                    <th colSpan={11} scope="colgroup">
                      <div className="rti-team-header-main">
                        <div className="rti-crew-grid">
                          <div className="rti-crew-col">
                            <span className="rti-crew-label">Delivery PIC</span>
                            <input type="text" readOnly className="rti-crew-input rti-crew-input-borderless" value={run.deliveryPic} aria-label="Delivery PIC" />
                          </div>
                          {/* After Delivery PIC, as on the Scheduling system's Delivery Schedule */}
                          <div className="rti-crew-col">
                            <span className="rti-crew-label">Plate No.</span>
                            <input type="text" readOnly className="rti-crew-input rti-crew-input-borderless" value={run.plateNumber ?? ""} aria-label="Plate No." />
                          </div>
                          <div className="rti-crew-col">
                            <span className="rti-crew-label">Contact Number</span>
                            <input type="text" readOnly className="rti-crew-input rti-crew-input-borderless" value={run.contactNumber} aria-label="Contact Number" />
                          </div>
                          <div className="rti-crew-col">
                            <span className="rti-crew-label">Warehouse</span>
                            <input type="text" readOnly className="rti-crew-input rti-crew-input-borderless" value={run.warehouse} aria-label="Warehouse" />
                          </div>
                        </div>
                        <div className="rti-run-actions">
                          <div className="rti-total-pcs-tag" title={`Total panels for this run: ${run.totalPanels} PCS`}>
                            {run.totalPanels} PCS
                          </div>
                        </div>
                      </div>
                    </th>
                  </tr>
                  <tr className={`schedule-column-headers${run.isWarehouse ? " is-warehouse-headers" : ""}`}>
                    <th>Slot</th>
                    <th>Customer</th>
                    <th>Address</th>
                    <th>Agent</th>
                    <th>Phase</th>
                    <th>Panel</th>
                    <th>Inverter</th>
                    <th className="rti-th-darker">ETA</th>
                    <th className="rti-th-darker">Installation Date</th>
                    <th>Scheduling Team</th>
                    <th>Remark</th>
                  </tr>
                  {run.customers.length === 0 && (
                    <tr>
                      <td colSpan={11} style={{ padding: "12px", textAlign: "center", color: "var(--muted, #64748b)", fontStyle: "italic", fontSize: "12px" }}>
                        No customers in this run yet.
                      </td>
                    </tr>
                  )}
                  {run.customers.map((c, ci) => {
                    const warehouseRow = run.isWarehouse || c.isWarehouse;
                    const instTime = sheetClock(c.installTime);
                    return (
                      <tr
                        key={`${run.id}-${c.jobId}-${ci}`}
                        className={["rti-row", warehouseRow ? "is-warehouse-row" : "", c.kohKengKiat ? "is-koh-keng-kiat" : "", c.om ? "is-om" : ""]
                          .filter(Boolean)
                          .join(" ")}
                      >
                        <td className="rti-date">
                          <strong>{run.deliveryDate ? arrLong(run.deliveryDate) : "—"}</strong>
                          <div className="rti-slot-time-wrap">
                            <span className="rti-slot-time-icon" aria-hidden="true">🕒</span>
                            <input type="text" readOnly className="rti-slot-time-input" value={run.departureTime} aria-label="Run departure time" />
                          </div>
                        </td>
                        <td>
                          <div className="rti-customer-wrap">
                            <span className={`rti-name${warehouseRow ? " rti-warehouse-name" : ""}`} title={c.phone ? `Phone: ${c.phone}` : undefined}>
                              {warehouseRow ? c.name : titleWords(c.name.replace(/\(ATAP\)/gi, "").replace(/\s+/g, " "))}
                            </span>
                            {c.invoice && <span className="rti-muted rti-invoice">{c.invoice}</span>}
                            {c.atap && <span className="rti-tag is-roof">ATAP</span>}
                            {c.battery && <span className="rti-tag is-battery">Battery</span>}
                            {c.ev && <span className="rti-tag is-ev">EV</span>}
                          </div>
                        </td>
                        <td>
                          {c.address ? (
                            <a
                              className={`rti-link rti-address${warehouseRow ? " rti-warehouse-address" : ""}`}
                              href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(c.address)}`}
                              target="_blank"
                              rel="noreferrer"
                              title="Open address in Google Maps"
                            >
                              📍 {warehouseRow ? c.address : titleWords(c.address)}
                            </a>
                          ) : (
                            <span className="run-field-readout is-empty">—</span>
                          )}
                        </td>
                        <td className="rti-agent">{c.agent || "–"}</td>
                        <td>{c.phase || "–"}</td>
                        <td className="rti-edit-cell">
                          <textarea className="rti-cell-textarea" rows={2} readOnly value={c.panel} aria-label={`Panel for ${c.name}`} />
                        </td>
                        <td className="rti-edit-cell">
                          <textarea className="rti-cell-textarea" rows={2} readOnly value={c.inverter} aria-label={`Inverter for ${c.name}`} />
                        </td>
                        <td className="rti-date rti-eta-cell">
                          <div className="rti-eta-container">
                            <div className="rti-eta-box">
                              <input type="date" readOnly className="rti-eta-input is-set" value={c.etaDate} aria-label="Estimated arrival date" />
                            </div>
                            <div className="rti-eta-box">
                              <input type="text" readOnly className="rti-eta-input is-set" value={c.etaTime} aria-label="Estimated arrival time" />
                            </div>
                          </div>
                        </td>
                        <td className="rti-installation-date-cell">
                          <div className="rti-inst-date-wrap">
                            <div className={`rti-inst-date-tag ${c.installDate ? "" : "is-unassigned"}`}>
                              <span className="rti-inst-date-text">
                                {c.installDate
                                  ? `${arrLong(c.installDate)}${instTime ? ` @ ${instTime}` : ""}`
                                  : warehouseRow
                                    ? "N/A"
                                    : "Unassigned"}
                              </span>
                            </div>
                          </div>
                        </td>
                        <td className={`rti-scheduling-team-cell ${c.teamClass}`}>{c.team || "–"}</td>
                        <td className="rti-edit-cell rti-remark-cell">
                          <textarea className="rti-cell-textarea" rows={2} readOnly value={c.remark} placeholder="Remarks" aria-label={`Remarks for ${c.name}`} />
                        </td>
                      </tr>
                    );
                  })}
                </Fragment>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

// Project Team page tabs: Installation Schedule (the arranged installations) and Delivery
// Schedule (the dashboard's delivery runs, read-only).
type ProjectTeamView = "installation" | "delivery";

function ProjectTeamTabs({
  view,
  onView,
  onSync,
  syncing,
  syncNote,
}: {
  view: ProjectTeamView;
  onView: (view: ProjectTeamView) => void;
  // "Sync from Scheduling Dashboard": reads the latest saved schedule now.
  onSync: () => void;
  syncing: boolean;
  syncNote: string | null;
}) {
  return (
    <div className={styles.projectTeamBar}>
    <div className={styles.txFilterPills} role="tablist" aria-label="Project Team" style={{ marginTop: "10px" }}>
      {(
        [
          ["installation", "Installation Schedule"],
          ["delivery", "Delivery Schedule"],
        ] as const
      ).map(([id, label]) => (
        <button
          key={id}
          type="button"
          role="tab"
          aria-selected={view === id}
          className={`${styles.txPill} ${view === id ? styles.txPillActive : ""}`}
          onClick={() => onView(id)}
        >
          {label}
        </button>
      ))}
    </div>
      <div className={styles.projectTeamSync}>
        {syncNote && <span className={styles.note} style={{ margin: 0 }}>{syncNote}</span>}
        <button
          type="button"
          className={styles.btnActionGhost}
          onClick={onSync}
          disabled={syncing}
          title="Read the latest Installation and Delivery Schedule from the Scheduling dashboard now"
        >
          {/* Grey circular-arrows icon (spins while syncing) */}
          <svg
            width="14"
            height="14"
            viewBox="0 0 24 24"
            fill="none"
            stroke="#6b7280"
            strokeWidth="2.2"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
            className={syncing ? styles.syncSpin : undefined}
            style={{ marginRight: "6px", verticalAlign: "-2px" }}
          >
            <path d="M21 12a9 9 0 0 1-15.5 6.2L3 16" />
            <path d="M3 21v-5h5" />
            <path d="M3 12a9 9 0 0 1 15.5-6.2L21 8" />
            <path d="M21 3v5h-5" />
          </svg>
          {syncing ? "Syncing…" : "Sync from Scheduling Dashboard"}
        </button>
      </div>
    </div>
  );
}

function StockByCustomerTab() {
  const [view, setView] = useState<ProjectTeamView>("installation");
  const [arranged, setArranged] = useState<ArrangedGroupPayload[] | null>(null);
  const [loaded, setLoaded] = useState(false);
  useEffect(() => {
    let cancelled = false;
    fetch("/api/warehouse/arranged", { credentials: "same-origin", cache: "no-store" })
      .then(async (res) => (res.ok ? ((await res.json()) as { groups?: ArrangedGroupPayload[] }) : null))
      .then((data) => {
        if (!cancelled && data?.groups && data.groups.length > 0) setArranged(data.groups);
      })
      .catch((err) => console.error("Arranged installation failed", err))
      .finally(() => {
        if (!cancelled) setLoaded(true);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // Delivery runs: read when the Delivery Schedule tab is opened, then kept current with the
  // Scheduling system while it stays open.
  const [delivery, setDelivery] = useState<DeliveryRunPayload[] | null>(null);
  const [deliveryLoaded, setDeliveryLoaded] = useState(false);
  const wantDelivery = view === "delivery";
  useEffect(() => {
    if (!wantDelivery) return;
    return watchDeliveryRuns<DeliveryRunPayload>(
      (runs) => {
        if (runs.length > 0) setDelivery(runs);
      },
      () => setDeliveryLoaded(true),
    );
  }, [wantDelivery]);

  // Sync from Scheduling Dashboard: both schedules read fresh (past the inventory's job copy).
  const [syncing, setSyncing] = useState(false);
  const [syncNote, setSyncNote] = useState<string | null>(null);
  async function syncFromScheduling() {
    setSyncing(true);
    setSyncNote(null);
    try {
      const [arrangedRes, deliveryRes] = await Promise.all([
        fetch("/api/warehouse/arranged?fresh=1", { credentials: "same-origin", cache: "no-store" }),
        fetch("/api/warehouse/delivery?fresh=1", { credentials: "same-origin", cache: "no-store" }),
      ]);
      if (!arrangedRes.ok || !deliveryRes.ok) throw new Error("not ok");
      const arrangedData = (await arrangedRes.json()) as { groups?: ArrangedGroupPayload[]; savedAt?: string | null };
      const deliveryData = (await deliveryRes.json()) as { runs?: DeliveryRunPayload[] };
      if (arrangedData.groups) setArranged(arrangedData.groups);
      if (deliveryData.runs) setDelivery(deliveryData.runs);
      setLoaded(true);
      setDeliveryLoaded(true);
      const clock = (value: string | Date) =>
        new Date(value).toLocaleString("en-GB", { timeZone: "Asia/Kuala_Lumpur", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
      // Also say when the Scheduling system itself last saved, so it is clear the inventory now
      // shows exactly that version.
      setSyncNote(
        `Synced ${clock(new Date())}${arrangedData.savedAt ? ` · Scheduling data saved ${clock(arrangedData.savedAt)}` : ""}`,
      );
    } catch {
      setSyncNote("Sync failed. Check the connection and try again.");
    } finally {
      setSyncing(false);
    }
  }

  const tabs = (
    <ProjectTeamTabs view={view} onView={setView} onSync={() => void syncFromScheduling()} syncing={syncing} syncNote={syncNote} />
  );

  if (view === "installation" && arranged) return <ArrangedInstallationView groups={arranged} tabs={tabs} />;
  if (view === "delivery" && delivery) return <DeliveryScheduleView runs={delivery} tabs={tabs} />;

  return (
    <section className={styles.screen} aria-labelledby="warehouse-stock-customer">
      <h1 id="warehouse-stock-customer">Project Team</h1>
      {tabs}
      {view === "installation" ? (
        <p className={styles.note}>
          {loaded
            ? "No arranged installations to show. Sign in to the dashboard (same browser) to see them."
            : "Loading…"}
        </p>
      ) : (
        <p className={styles.note}>
          {deliveryLoaded
            ? "No delivery runs to show. Sign in to the dashboard (same browser) to see them."
            : "Loading…"}
        </p>
      )}
    </section>
  );
}

// Loading page › a lorry row: that lorry's details, its item totals and a table of its customers
// with what to load (from the invoice). View only; Back returns to the Loading page.
function LorryLoadingPage({
  driver,
  plate,
  stage,
  day,
  txs,
  loadedRefs,
  loadedBy,
  onSubmitAll,
  onBack,
}: {
  driver: string;
  plate: string;
  // The Loading page tab it was opened from (for the subtitle).
  stage: "preparing" | "verified";
  // The Loading page's day (the lorry's slot day): with driver and plate, it names the lorry.
  day: string;
  txs: StockTransaction[];
  loadedRefs: Set<string>;
  // Who pressed Submit for each loaded job (from the saved "loaded" records).
  loadedBy: Record<string, string>;
  // Marks every customer on the lorry loaded; false if any save failed.
  onSubmitAll: (txs: StockTransaction[]) => Promise<boolean>;
  onBack: () => void;
}) {
  // Slot and ETA from the Delivery Schedule (matched by invoice, then customer name).
  const [deliveryRuns, setDeliveryRuns] = useState<TimelineRun[]>([]);
  useEffect(() => watchDeliveryRuns<TimelineRun>(setDeliveryRuns), []);
  const etaLookup = useMemo(() => buildEtaLookup(deliveryRuns), [deliveryRuns]);
  // Item cards: what this lorry carries, by item, as on Stock Out. Panel, inverter and battery
  // count units; mounting and electrical have no invoice quantity, so they count customers (sets).
  // Every install needs electrical items. Tap a card to show only the customers with that item
  // (and only that item in Items to Load); tap again for all.
  const [itemPick, setItemPick] = useState<string>("all");
  const itemCards = [
    { id: "panel", label: "Panel", short: "Panel", bulk: false },
    { id: "inverter", label: "Inverter", short: "Inv.", bulk: false },
    { id: "battery", label: "Battery", short: "Batt.", bulk: false },
    { id: "mounting", label: "Mounting Structure", short: "Mounting", bulk: true },
    { id: "electrical", label: "Electrical Item", short: "Electrical", bulk: true },
  ].map((def) => {
    let units = 0;
    let jobs = 0;
    txs.forEach((tx) => {
      const lines = txLines(tx).filter((line) => line.category === def.id);
      if (lines.length === 0 && def.id !== "electrical") return;
      jobs += 1;
      units += lines.reduce((sum, line) => sum + (line.qty ?? 0), 0);
    });
    return { ...def, count: def.bulk ? jobs : units, unit: def.bulk ? (jobs === 1 ? "set" : "sets") : units === 1 ? "unit" : "units" };
  });
  const hasItem = (tx: StockTransaction, id: string) =>
    id === "electrical" || txLines(tx).some((line) => line.category === id);
  const shownTxs = itemPick === "all" ? txs : txs.filter((tx) => hasItem(tx, itemPick));

  // Lorry photos: one per item card, saved for this lorry (day, driver, plate). Tapping a card
  // shows "Take lorry photo" for it; once every card with something on it has a photo, Submit
  // unlocks and marks every customer on the lorry loaded.
  const lorryKey = `${day}|${driver.trim().toUpperCase()}|${plate.trim().toUpperCase()}`;
  const [photos, setPhotos] = useState<Record<string, string>>({});
  const [photoBusy, setPhotoBusy] = useState(false);
  const [photoError, setPhotoError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    fetch(`/api/warehouse/lorry-photos?lorry=${encodeURIComponent(lorryKey)}`, { credentials: "same-origin", cache: "no-store" })
      .then(async (res) => (res.ok ? ((await res.json()) as { photos?: Record<string, string> }) : null))
      .then((data) => {
        if (!cancelled && data?.photos) setPhotos((prev) => ({ ...data.photos, ...prev }));
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [lorryKey]);
  const photoCards = itemCards.filter((item) => item.count > 0);
  const allPhotos = photoCards.length > 0 && photoCards.every((item) => photos[item.id]);
  const allLoaded = txs.length > 0 && txs.every((tx) => loadedRefs.has(tx.reference));
  const pickedCard = itemCards.find((item) => item.id === itemPick);
  // Loading › Verified (or a lorry already submitted): photos are shown, not taken. They are the
  // ones taken on Loading › Preparing.
  const photosReadOnly = stage === "verified" || allLoaded;
  // Mounting Structure / Electrical Item cards: each customer's Box Qty (entered under that
  // table on the job page), shown in a Box column.
  const jobRefs = txs.map((tx) => tx.reference).sort().join(",");
  const [mountBoxes, setMountBoxes] = useState<Record<string, string>>({});
  const [elecBoxes, setElecBoxes] = useState<Record<string, string>>({});
  useEffect(() => {
    if (!jobRefs) return;
    let cancelled = false;
    fetch(`/api/warehouse/entries?jobs=${encodeURIComponent(jobRefs)}`, { credentials: "same-origin", cache: "no-store" })
      .then(async (res) => (res.ok ? ((await res.json()) as { entries?: { job: string; kind: string; key: string; value: string }[] }) : null))
      .then((data) => {
        if (cancelled || !data?.entries) return;
        const mount: Record<string, string> = {};
        const elec: Record<string, string> = {};
        data.entries.forEach((entry) => {
          if (entry.kind === "mounting_box") mount[entry.job] = entry.value;
          if (entry.kind === "electrical_box") elec[entry.job] = entry.value;
        });
        setMountBoxes(mount);
        setElecBoxes(elec);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [jobRefs]);
  const showBoxCol = itemPick === "mounting" || itemPick === "electrical";
  // Panel / Inverter / Battery cards: each customer's units of that item (from the invoice).
  const showUnitCol = itemPick === "panel" || itemPick === "inverter" || itemPick === "battery";
  const unitsOf = (tx: StockTransaction) =>
    txLines(tx)
      .filter((line) => line.category === itemPick)
      .reduce((sum, line) => sum + (line.qty ?? 0), 0);
  // The in-page camera (camera only, front or back) is open for the picked card.
  const [cameraOpen, setCameraOpen] = useState(false);
  async function saveLorryPhoto(item: string, photo: string) {
    setPhotoBusy(true);
    setPhotoError(null);
    try {
      const res = await fetch("/api/warehouse/lorry-photos", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({ lorry: lorryKey, item, photo }),
      });
      if (!res.ok) throw new Error(((await res.json().catch(() => ({}))) as { error?: string }).error || "Could not save the photo.");
      setPhotos((prev) => ({ ...prev, [item]: photo }));
    } catch (err) {
      setPhotoError(err instanceof Error ? err.message : "Could not save the photo.");
    } finally {
      setPhotoBusy(false);
    }
  }

  return (
    <section className={`${styles.screen} ${styles.soPage}`} aria-labelledby="lorry-loading-title">
      <div className={styles.inspectTopBar}>
        <button className={styles.back} type="button" onClick={onBack} style={{ marginBottom: 0 }}>
          Back
        </button>
      </div>
      {/* "Loading", with "Item List - Preparing" (or "- Verified") below, as on Stock Out */}
      <div style={{ margin: "0 0 12px" }}>
        <h1 id="lorry-loading-title" className={styles.inspectHeroTitle} style={{ margin: 0 }}>
          Loading
        </h1>
        <p style={{ margin: "12px 0 0", fontSize: "16px", fontWeight: 700, color: "#000" }}>
          {stage === "verified" ? "Item List - Verified" : "Item List - Preparing"}
        </p>
      </div>

      {/* Loading Details: laid out like a job's Customer Details (grey title box, then lines) */}
      <div style={{ marginBottom: "16px" }}>
        <h2
          className={styles.inspectCardTitle}
          style={{
            margin: "0 0 10px",
            color: "#000",
            fontWeight: 700,
            border: "1px solid var(--line)",
            borderRadius: "10px",
            background: "#e5e7eb",
            padding: "8px 14px",
          }}
        >
          <span>🚚</span> Loading Details
        </h2>
        <div
          className={styles.custDetailLines}
          style={{ display: "grid", gridTemplateColumns: "max-content max-content 1fr", columnGap: "6px", rowGap: "4px", fontSize: "13px", color: "#000" }}
        >
          <span style={{ fontWeight: 700 }}>Driver</span>
          <span style={{ fontWeight: 700 }}>:</span>
          <span style={{ paddingLeft: "8px" }}>{driver || "—"}</span>
          <span style={{ fontWeight: 700 }}>Plate No</span>
          <span style={{ fontWeight: 700 }}>:</span>
          <span style={{ paddingLeft: "8px" }}>{plate || "—"}</span>
          <span style={{ fontWeight: 700 }}>No of Customer</span>
          <span style={{ fontWeight: 700 }}>:</span>
          <span style={{ paddingLeft: "8px" }}>{txs.length}</span>
        </div>
      </div>

      {txs.length === 0 && <p className={styles.note}>No customers on this lorry.</p>}

      {txs.length > 0 && (
        <div className={styles.outItemGrid} role="group" aria-label="This lorry by item" style={{ marginBottom: "12px" }}>
          {itemCards.map((item) => (
            <button
              key={item.id}
              type="button"
              className={`${styles.txKpiCatChip} ${styles.outItemCard} ${itemPick === item.id ? styles.balanceCardActive : ""}`}
              aria-pressed={itemPick === item.id}
              title={itemPick === item.id ? "Show all items" : `Show only customers with ${item.label}`}
              onClick={() => setItemPick((cur) => (cur === item.id ? "all" : item.id))}
            >
              <span className={styles.txKpiCatName}>
                <span className={styles.catLabelFull}>{item.label}</span>
                <span className={styles.catLabelShort}>{item.short}</span>
              </span>
              <span className={styles.txKpiCatValOut}>
                {item.count} <span className={styles.txKpiUnit}>{item.unit}</span>
              </span>
            </button>
          ))}
        </div>
      )}

      {txs.length > 0 && (
        <p className={styles.note} style={{ margin: "0 0 10px", color: "#000", fontSize: "10px" }}>
          {photosReadOnly ? "Click on cards to view item photo." : "Click on cards to take item photo."}
        </p>
      )}

      {/* The picked card: its photo, shown only on Verified (taken on Preparing) */}
      {pickedCard && pickedCard.count > 0 && photosReadOnly && (
        <div className={styles.inspectCard} style={{ marginBottom: "14px" }}>
          <div className={styles.bankingFieldLabel}>Lorry photo – {pickedCard.label}</div>
          {photos[pickedCard.id] ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={photos[pickedCard.id]} alt={`Lorry – ${pickedCard.label}`} className={styles.lorryPhotoImg} />
          ) : (
            <p className={styles.note} style={{ margin: 0 }}>
              No photo was taken for {pickedCard.label.toLowerCase()} on Loading › Preparing.
            </p>
          )}
        </div>
      )}

      {/* The picked card on Preparing: take (or retake) its lorry photo */}
      {pickedCard && pickedCard.count > 0 && !photosReadOnly && (
        <div className={styles.inspectCard} style={{ marginBottom: "14px" }}>
          <div className={styles.bankingFieldLabel}>Take lorry photo – {pickedCard.label}</div>
          {/* Taken with the in-page camera only (front or back), not picked from the phone. The
              camera opens inside this box, in place of the photo. */}
          {cameraOpen ? (
            <PhotoCamera
              title={`Lorry photo – ${pickedCard.label}`}
              onClose={() => setCameraOpen(false)}
              onCapture={(photo) => {
                setCameraOpen(false);
                void saveLorryPhoto(pickedCard.id, photo);
              }}
            />
          ) : (
            <button
              type="button"
              className={styles.lorryPhotoBox}
              disabled={photoBusy}
              onClick={() => setCameraOpen(true)}
              aria-label={`Take a picture of the ${pickedCard.label.toLowerCase()} on the lorry`}
            >
              {photos[pickedCard.id] ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={photos[pickedCard.id]} alt={`Lorry – ${pickedCard.label}`} className={styles.lorryPhotoImg} />
              ) : (
                <span className={styles.lorryPhotoEmpty}>
                  {photoBusy ? "Saving…" : `📷 Tap to take a picture of the ${pickedCard.label.toLowerCase()} on the lorry`}
                </span>
              )}
            </button>
          )}
          {photos[pickedCard.id] && (
            <p className={styles.note} style={{ margin: 0 }}>
              {photoBusy ? "Saving…" : "Tap the photo to take it again."}
            </p>
          )}
          {photoError && (
            <p className={styles.note} style={{ color: "#b91c1c", margin: 0 }}>
              {photoError}
            </p>
          )}
        </div>
      )}

      {/* One row per customer on this lorry */}
      {txs.length > 0 && (
        <div className={styles.tableWrap}>
          <table className={`${styles.detailTable} ${styles.lorryTable}`}>
            <thead>
              <tr>
                <th scope="col">Slot</th>
                <th scope="col">Customer</th>
                <th scope="col">Agent</th>
                <th scope="col">Phone</th>
                <th scope="col">Address</th>
                <th scope="col">ETA</th>
                <th scope="col" className={styles.instDateCol}>Installation Date</th>
                {showUnitCol && <th scope="col">Unit</th>}
                {showBoxCol && <th scope="col">Box</th>}
              </tr>
            </thead>
            <tbody>
              {shownTxs.map((tx) => {
                const schedule = tx.schedule;
                const eta = lookupEta(etaLookup, tx);
                const slotTime = eta ? sheetClock(eta.slotTime) || eta.slotTime : "";
                return (
                  <tr key={tx.id}>
                    <td style={{ whiteSpace: "nowrap" }}>
                      {eta?.slotDate ? (
                        <>
                          {isoDateLabel(eta.slotDate)}
                          {slotTime && <div style={{ color: "#555" }}>{slotTime}</div>}
                        </>
                      ) : (
                        "—"
                      )}
                    </td>
                    <td>
                      <div className={styles.lorryCustName}>{schedule?.customerName ?? tx.party}</div>
                      <div className={styles.lorryInvoice}>{schedule?.jobId ?? tx.reference}</div>
                    </td>
                    <td>{schedule?.agentName || "—"}</td>
                    <td style={{ whiteSpace: "nowrap" }}>{schedule?.customerPhone || "—"}</td>
                    <td className={styles.lorryAddress}>{schedule?.customerAddress || "—"}</td>
                    <td style={{ whiteSpace: "nowrap" }}>
                      {eta?.date ? (
                        <>
                          {isoDateLabel(eta.date)}
                          {eta.time && <div style={{ color: "#555" }}>{etaClock(eta.time)}</div>}
                        </>
                      ) : (
                        "—"
                      )}
                    </td>
                    <td className={styles.instDateCol} style={{ whiteSpace: "nowrap" }}>
                      {isoDateLabel(tx.time)}
                      {eta?.installTime && (!eta.installDate || eta.installDate === tx.time.slice(0, 10)) && sheetClock(eta.installTime) && (
                        <div style={{ color: "#555" }}>{sheetClock(eta.installTime)}</div>
                      )}
                    </td>
                    {showUnitCol && <td style={{ whiteSpace: "nowrap" }}>{unitsOf(tx) || "—"}</td>}
                    {showBoxCol && (
                      <td style={{ whiteSpace: "nowrap" }}>
                        {(itemPick === "electrical" ? elecBoxes : mountBoxes)[tx.reference] || "—"}
                      </td>
                    )}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* Checked by: whoever pressed Submit for this lorry ("—" until it is submitted) */}
      {txs.length > 0 && (
        <p className={styles.lorryCheckedBy}>
          <strong>Checked by:</strong>{" "}
          {Array.from(new Set(txs.map((tx) => loadedBy[tx.reference]).filter(Boolean))).join(", ") || "—"}
        </p>
      )}

      {/* Submit: unlocks once every card has its lorry photo; marks every customer loaded */}
      {txs.length > 0 && (
        <div className={styles.lorrySubmitRow}>
          {!allLoaded && !allPhotos && (
            <span className={styles.note} style={{ margin: 0 }}>
              Photos: {photoCards.filter((item) => photos[item.id]).length} / {photoCards.length}. Tap each card to take its lorry photo.
            </span>
          )}
          {submitError && (
            <span className={styles.note} style={{ color: "#b91c1c", margin: 0 }}>
              {submitError}
            </span>
          )}
          {allLoaded ? (
            <button className={`${styles.btnActionPrimary} ${styles.btnVerifiedLocked}`} type="button" disabled>
              ✓ Submitted
            </button>
          ) : (
            <button
              type="button"
              className={`${styles.btnActionPrimary} ${allPhotos ? styles.btnVerifiedGlow : styles.btnVerifiedLocked}`}
              disabled={!allPhotos || submitting}
              title={allPhotos ? "Loaded onto the lorry: moves these jobs to Site Check" : "Take a lorry photo for every card first"}
              onClick={async () => {
                setSubmitting(true);
                setSubmitError(null);
                const ok = await onSubmitAll(txs.filter((tx) => !loadedRefs.has(tx.reference)));
                setSubmitting(false);
                if (!ok) setSubmitError("Not all saved. Check the connection and press Submit again.");
              }}
            >
              {submitting ? "Saving…" : allPhotos ? "✓ Submit" : "🔒 Submit"}
            </button>
          )}
        </div>
      )}
    </section>
  );
}
