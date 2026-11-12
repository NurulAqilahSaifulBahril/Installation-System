"use client";

import { classifyInvoiceLines, parseCountedItem } from "./invoice-lines";
import { estimateMounting, ROOF_OPTIONS, type MountingSystemId, type Orientation, type RoofType } from "./mounting-estimate";
import { FormEvent, Fragment, useEffect, useMemo, useRef, useState } from "react";
import {
  CUSTOMER_STOCK_ALLOCATIONS,
  INVERTER_TYPES,
  ORDER_MODELS,
  STOCK_CARDS,
  STOCK_DETAIL_ITEMS,
  STOCK_MODEL_TREND,
  MOUNTING_SYSTEMS,
  STOCK_TRANSACTIONS,
  WAREHOUSE_BALANCES,
  WAREHOUSE_NOTICES,
  WAREHOUSE_STOCK_SUMMARY,
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
// Cropped to the artwork (public/eternalgy-logo.png has wide transparent margins).
const LOGO_SRC = "/eternalgy-logo-tight.png";
// The symbol alone, without the ETERNALGY / ETERNAL ENERGY wording (sign-in headline).
const MARK_SRC = "/eternalgy-mark.png";

type View = "mobile" | "desktop";

export default function WarehousePage() {
  const [phone, setPhone] = useState("");
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [signedInPhone, setSignedInPhone] = useState<string | null>(null);
  const [ready, setReady] = useState(false);
  const [model, setModel] = useState<WarehouseModel | null>(null);
  const [view, setView] = useState<View>("mobile");

  useEffect(() => {
    setSignedInPhone(window.sessionStorage.getItem(SESSION_KEY));
    // Phone or desktop layout follows the screen width, and updates when it changes
    // (rotating a phone, resizing a window).
    const wide = window.matchMedia("(min-width: 900px)");
    const apply = () => setView(wide.matches ? "desktop" : "mobile");
    apply();
    wide.addEventListener("change", apply);
    setReady(true);
    return () => wide.removeEventListener("change", apply);
  }, []);

  function signIn(event: FormEvent) {
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
    window.sessionStorage.setItem(SESSION_KEY, trimmed);
    setSignedInPhone(trimmed);
    setError(null);
  }

  function signOut() {
    window.sessionStorage.removeItem(SESSION_KEY);
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
              <span className={styles.brandUser}>Hi Wei Hao!</span>
              <button className={styles.brandSignOut} type="button" onClick={signOut}>
                Sign out
              </button>
            </div>
          </header>
          <Dashboard phone={signedInPhone} model={model} onSignOut={signOut} onSelect={setModel} />
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
      <div className={styles.shade}>
        <NoticeList />
      </div>
      {/* Sign-in form sits below the notifications (same for both mobile and desktop) */}
      <form className={`${styles.form} ${styles.inlineForm}`} onSubmit={onSubmit} aria-label="Sign in">
        {fields}
      </form>
    </section>
  );
}

function NoticeList() {
  return (
    <ul className={styles.noticeList} aria-label="Urgent notices">
      {WAREHOUSE_NOTICES.map((notice) => (
        <li key={notice.id} className={styles.noticeCard}>
          <span className={styles.noticeTop}>
            <span className={styles.noticeName}>
              <span className={`${styles.dot} ${NOTICE_KIND[notice.kind].dot}`} aria-hidden="true" />
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
  );
}

const NOTICE_KIND: Record<WarehouseNoticeKind, { label: string; dot: string }> = {
  order: { label: "Order", dot: styles.dotOrder },
  stockIn: { label: "Stock in", dot: styles.dotStockIn },
  faulty: { label: "Faulty", dot: styles.dotFaulty },
  install: { label: "Install", dot: styles.dotInstall },
};

function countLabel(value: number | null) {
  return value === null ? "—" : String(value);
}

type TabId = "home" | "transfer" | "stock" | "customers";

const TABS: { id: TabId; label: string; shortLabel: string }[] = [
  { id: "home", label: "Home", shortLabel: "Home" },
  { id: "stock", label: "Stock Details", shortLabel: "Stock" },
  { id: "customers", label: "Customer Details", shortLabel: "Customers" },
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
    const electricalItems = ofGroup("electrical");
    if (electricalItems.length > 0) {
      electricalItems.forEach((item) => lines.push({ category: "electrical", model: item.name, qty: null, serialised: false }));
    } else {
      lines.push({ category: "electrical", model: "Electrical accessories (cables, wiring, connectors, ballast)", qty: null, serialised: false });
    }
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
      status: "To Verify",
      schedule,
      lines,
    });
  });
  return rows;
}

function Dashboard({
  phone,
  model,
  onSignOut,
  onSelect,
}: {
  phone: string;
  model: WarehouseModel | null;
  onSignOut: () => void;
  onSelect: (model: WarehouseModel | null) => void;
}) {
  const [tab, setTab] = useState<TabId>("home");
  const [homeShowsTx, setHomeShowsTx] = useState(false);
  const [inverterOpen, setInverterOpen] = useState(false);
  const [inverterType, setInverterType] = useState<InverterTypeId | null>(null);
  const [inspectTxId, setInspectTxId] = useState<string | null>(null);
  const [transactions, setTransactions] = useState<StockTransaction[]>(STOCK_TRANSACTIONS);

  // Copy the booked installations from the scheduling system. Needs the dashboard
  // session; without it (401, public site) the sample Stock Out rows stay.
  const [liveInfo, setLiveInfo] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    setLiveInfo("Loading schedule from the scheduling system…");
    fetch("/api/warehouse/schedule", { credentials: "same-origin", cache: "no-store" })
      .then(async (res) => {
        if (res.status === 401) {
          if (!cancelled) setLiveInfo("Not signed in to the dashboard (same browser), so no real jobs are loaded.");
          return;
        }
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = (await res.json()) as { jobs?: ScheduledJobPayload[] };
        if (cancelled) return;
        const jobs = data.jobs ?? [];
        const live = liveStockOutRows(jobs);
        setTransactions((prev) => [...live, ...prev.filter((t) => t.type !== "out")]);
        setLiveInfo(`Live schedule: ${jobs.length} installation job${jobs.length === 1 ? "" : "s"} copied from the scheduling system.`);
      })
      .catch((err) => {
        console.error("Live schedule failed", err);
        if (!cancelled) setLiveInfo(`Could not copy the schedule (${err instanceof Error ? err.message : "error"}). No jobs are loaded.`);
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

  // ----- Tab bar + active tab content -----

  return (
    <>
      <div className={`${styles.screen} ${styles.head}`}>
        <div>
          <h1 id="warehouse-home">Inventory Management</h1>
          <p className={styles.kicker}>Hi Wei Hao! · Real-time stock balance &amp; transactions</p>
        </div>
      </div>

      <nav className={styles.tabBar} aria-label="Warehouse sections">
        {TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            className={`${styles.tab} ${tab === t.id ? styles.tabActive : ""}`}
            onClick={() => setTab(t.id)}
            aria-current={tab === t.id ? "page" : undefined}
          >
            <span className={styles.tabLabelFull}>{t.label}</span>
            <span className={styles.tabLabelShort}>{t.shortLabel}</span>
          </button>
        ))}
      </nav>

      {tab === "home" && liveInfo && <p className={styles.note}>{liveInfo}</p>}
      {tab === "home" && (
        <HomeTab
          transactions={transactions}
          onInspectTx={(id) => setInspectTxId(id)}
          onSignOut={onSignOut}
          onInverterOpen={() => setInverterOpen(true)}
          showTx={homeShowsTx}
          onShowTx={setHomeShowsTx}
          onOpenTransfer={() => setTab("transfer")}
        />
      )}
      {tab === "transfer" && (
        <StockTransferTab
          transactions={transactions}
          onInspectTx={(id) => setInspectTxId(id)}
          onSignOut={onSignOut}
          onBack={() => setTab("home")}
          onNewTransfer={(newTx) => setTransactions((prev) => [newTx, ...prev])}
          onGoToTransactions={() => {
            setHomeShowsTx(true);
            setTab("home");
          }}
        />
      )}
      {tab === "stock" && <StockDetailsTab />}
      {tab === "customers" && <StockByCustomerTab />}
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

const WH_SPLIT: Record<string, { JB: number; KL: number }> = {
  inverter: { JB: 245, KL: 197 },
  panel: { JB: 450, KL: 320 },
  battery: { JB: 95, KL: 48 },
};

const WEEK_MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

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
    barcodeInputRef.current?.focus();
  }, []);

  // Camera video stream & live BarcodeDetector hook
  useEffect(() => {
    let stream: MediaStream | null = null;
    let detectorTimer: NodeJS.Timeout | null = null;

    if (cameraActive) {
      if (typeof navigator !== "undefined" && navigator.mediaDevices && navigator.mediaDevices.getUserMedia) {
        navigator.mediaDevices
          .getUserMedia({ video: { facingMode: "environment" } })
          .then((s) => {
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
          .catch(() => {
            setCameraError("Camera unavailable or permission denied. You can test detection below or use a barcode gun.");
          });
      } else {
        setCameraError("Camera API not supported on this browser.");
      }
    } else {
      if (videoRef.current && videoRef.current.srcObject) {
        const tracks = (videoRef.current.srcObject as MediaStream).getTracks();
        tracks.forEach((t) => t.stop());
        videoRef.current.srcObject = null;
      }
    }

    return () => {
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
        <button className={styles.inspectBackBtn} type="button" onClick={onBack}>
          &larr; Back to Stock Transactions
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
          <button
            type="button"
            className={`${styles.scannerBtnCamera} ${cameraActive ? styles.scannerBtnCameraActive : ""}`}
            onClick={() => setCameraActive(!cameraActive)}
          >
            <span>📷</span> {cameraActive ? "Hide Camera" : "Use Camera Scanner"}
          </button>
        </div>

        {/* Camera Viewfinder */}
        {cameraActive && (
          <div className={styles.cameraViewfinder}>
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
          <button type="submit" className={styles.scannerBtnScan}>
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
              placeholder="Search serial code, pallet..."
              value={tableSearch}
              onChange={(e) => setTableSearch(e.target.value)}
              style={{
                padding: "7px 12px",
                border: "1px solid var(--line)",
                borderRadius: "6px",
                fontSize: "12px",
                background: "var(--surface)",
                color: "var(--text)",
                width: "100%",
                maxWidth: "280px",
              }}
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
        <button className={styles.btnActionGhost} type="button" onClick={onBack}>
          &larr; Back to Transactions
        </button>

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

      <p className={styles.note} style={{ marginTop: "4px" }}>
        💡 <strong>Warehouse Tip:</strong> Scan physical barcodes or type serials to match against PO #{invoice?.poNumber ?? tx.reference}. When all invoiced items reach 100%, the <strong>Verified</strong> button unlocks to confirm stock entry into warehouse inventory.
      </p>

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
  ["electrical", "Electrical Accessories"],
] as const;
type StockOutTab = (typeof STOCK_OUT_TABS)[number][0];

function StockOutVerificationPage({
  tx,
  onBack,
  onUpdateStatus,
}: {
  tx: StockTransaction;
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
  async function openDrawings() {
    setSldOpen(true);
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

  const [scans, setScans] = useState<{ serial: string; lineIdx: number }[]>(() => {
    if (tx.status !== "Verified") return [];
    // Already verified (sample data): show a full set so the page reads as complete.
    return serialLines.flatMap((line, lineIdx) =>
      generateStockOutSerialList({
        ...tx,
        category: line.category as StockTransaction["category"],
        model: line.model,
        qty: line.qty ?? 0,
        serialCode: line.serialCode ?? tx.serialCode,
      }).map((u) => ({ serial: u.serialNo, lineIdx })),
    );
  });
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

  const [barcodeInput, setBarcodeInput] = useState("");
  const [cameraActive, setCameraActive] = useState(false);
  const [cameraError, setCameraError] = useState<string | null>(null);
  const videoRef = useRef<HTMLVideoElement>(null);

  const [feedback, setFeedback] = useState<{
    type: "success" | "warning" | "error";
    message: string;
  } | null>(null);

  const [reportOpen, setReportOpen] = useState(false);
  const [sldOpen, setSldOpen] = useState(false);
  const [driverName, setDriverName] = useState("");
  const [vehiclePlate, setVehiclePlate] = useState("");
  const [lorryPhoto, setLorryPhoto] = useState<string | null>(null);
  const [checklist, setChecklist] = useState({
    condition: false,
    serialMatch: false,
    qtyCounted: false,
    handoverSigned: false,
  });

  const barcodeInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    barcodeInputRef.current?.focus();
  }, []);

  // Camera video stream & live BarcodeDetector hook
  useEffect(() => {
    let stream: MediaStream | null = null;
    let detectorTimer: NodeJS.Timeout | null = null;

    if (cameraActive) {
      if (typeof navigator !== "undefined" && navigator.mediaDevices && navigator.mediaDevices.getUserMedia) {
        navigator.mediaDevices
          .getUserMedia({ video: { facingMode: "environment" } })
          .then((s) => {
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
          .catch(() => {
            setCameraError("Camera unavailable or permission denied. You can test detection below or use a barcode gun.");
          });
      } else {
        setCameraError("Camera API not supported on this browser.");
      }
    } else {
      if (videoRef.current && videoRef.current.srcObject) {
        const tracks = (videoRef.current.srcObject as MediaStream).getTracks();
        tracks.forEach((t) => t.stop());
        videoRef.current.srcObject = null;
      }
    }

    return () => {
      if (detectorTimer) clearInterval(detectorTimer);
      if (stream) {
        stream.getTracks().forEach((t) => t.stop());
      }
    };
  }, [cameraActive]);

  const scannedPerLine = serialLines.map((_, i) => scans.filter((scan) => scan.lineIdx === i).length);
  const totalRequired = serialLines.reduce((sum, line) => sum + (line.qty ?? 0), 0);
  const totalScanned = scans.length;
  const progressPercent = totalRequired > 0 ? Math.min(100, Math.round((totalScanned / totalRequired) * 100)) : 0;
  const bulkMissing = bulkLines.filter(
    (line, i) => !(line.category === "mounting" && hasMountingParts) && (bulkQty[i] ?? "").trim() === "",
  ).length;
  const bulkDone = tx.status === "Verified" || bulkMissing === 0;
  const serialDone = serialLines.every((line, i) => scannedPerLine[i] >= (line.qty ?? 0));
  const isAllVerified = (serialLines.length > 0 || bulkLines.length > 0) && serialDone && bulkDone;
  const stillToDo =
    serialLines.reduce((sum, line, i) => sum + Math.max(0, (line.qty ?? 0) - scannedPerLine[i]), 0) +
    (tx.status === "Verified" ? 0 : bulkMissing);
  // One row per unit the invoice calls for; the serial fills in as it is scanned.
  const slots = serialLines.flatMap((line, lineIdx) =>
    Array.from({ length: line.qty ?? 0 }, (_, k) => ({
      key: `${lineIdx}-${k}`,
      line,
      lineIdx,
      serial: scans.filter((scan) => scan.lineIdx === lineIdx)[k]?.serial ?? null,
    })),
  );
  const isSerialTab = tab === "panel" || tab === "inverter" || tab === "battery";
  const tabSlots = slots.filter((slot) => slot.line.category === tab);
  const tabRequired = tabSlots.length;
  const tabScanned = tabSlots.filter((slot) => slot.serial !== null).length;
  const tabProgress = tabRequired > 0 ? Math.min(100, Math.round((tabScanned / tabRequired) * 100)) : 0;
  const tabLabel = (id: StockOutTab) => {
    const name = STOCK_OUT_TABS.find(([key]) => key === id)?.[1] ?? id;
    if (id === "mounting" || id === "electrical") {
      const total = bulkLines.filter((line) => line.category === id).length;
      if (total === 0) return name;
      const entered =
        id === "mounting" && hasMountingParts
          ? total
          : bulkLines.filter((line, i) => line.category === id && (bulkQty[i] ?? "").trim() !== "").length;
      return `${name} (${tx.status === "Verified" ? total : entered}/${total})`;
    }
    const required = slots.filter((slot) => slot.line.category === id).length;
    if (required === 0) return name;
    const done = slots.filter((slot) => slot.line.category === id && slot.serial !== null).length;
    return `${name} (${done}/${required})`;
  };
  const systemSizeText =
    schedule?.systemSizeKwp && schedule.systemSizeKwp !== "—" ? `${schedule.systemSizeKwp} kWp` : "the schedule";

  // Scan handler
  function handleScan(codeToTest?: string) {
    const code = (codeToTest ?? barcodeInput).trim();
    if (!code) return;

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
  }

  return (
    <section className={styles.screen} aria-labelledby="stockout-verify-title">
      {/* Top Navigation */}
      <div className={styles.inspectTopBar}>
        <button className={styles.inspectBackBtn} type="button" onClick={onBack}>
          &larr; Back to Stock Transactions
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
          <button type="button" className={styles.btnActionGhost} onClick={() => setReportOpen(true)}>
            Report
          </button>
        </div>
      </div>

      <h1 id="stockout-verify-title" className={styles.inspectHeroTitle} style={{ margin: "0 0 12px" }}>
        Stock Out Verification
      </h1>

      {/* Item cards: how many of each item this customer needs */}
      <div className={styles.soCards}>
        {STOCK_OUT_TABS.map(([id, label]) => {
          const serialQty = lines
            .filter((line) => line.serialised && line.category === id)
            .reduce((sum, line) => sum + (line.qty ?? 0), 0);
          const bulkCount = lines.filter((line) => !line.serialised && line.category === id).length;
          if (serialQty === 0 && bulkCount === 0) return null;
          const scanned = slots.filter((slot) => slot.line.category === id && slot.serial !== null).length;
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
                  <strong className={styles.soCardNumber}>{bulkCount}</strong>
                  <span className={styles.soCardSub}>{bulkCount === 1 ? "item" : "items"} &middot; enter qty</span>
                </>
              )}
            </button>
          );
        })}
      </div>
      {schedule?.systemPackage && (
        <p className={styles.itemDesc} style={{ margin: "0 0 12px" }}>
          Package: {schedule.systemPackage}
        </p>
      )}

      {/* 1. Scheduling System Record Table (Single Full-Width Card) */}
      <div className={styles.inspectCard} style={{ marginBottom: "16px" }}>
        <div className={styles.inspectCardHeader} style={{ alignItems: "flex-start", flexWrap: "wrap", gap: "10px" }}>
          <div style={{ flex: 1, minWidth: "300px" }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "8px", flexWrap: "wrap", gap: "8px" }}>
              <h2 className={styles.inspectCardTitle} style={{ margin: 0, color: "#000000" }}>
                <span>📅</span> Scheduling System Record &middot; #{schedule?.jobId ?? tx.reference}
              </h2>
              <span className={`${styles.tag} ${styles.ok}`}>Live Scheduling System</span>
            </div>

            {/* Customer with Address & Agent directly underneath, plus Phone */}
            <div style={{ fontSize: "13px", color: "#000000", padding: "10px 14px", background: "#f8fafc", borderRadius: "6px", border: "1px solid var(--line)", marginTop: "6px", display: "flex", justifyContent: "space-between", alignItems: "flex-start", flexWrap: "wrap", gap: "12px" }}>
              <div style={{ display: "grid", gridTemplateColumns: "max-content max-content 1fr", columnGap: "6px", rowGap: "4px", color: "#000000" }}>
                <div style={{ display: "contents" }}>
                  <span style={{ color: "#000000", fontWeight: 700 }}>Customer</span>
                  <span style={{ color: "#000000", fontWeight: 700 }}>:</span>
                  <strong style={{ color: "#000000", fontWeight: 400, fontSize: "13.5px" }}>{schedule?.customerName}</strong>
                </div>
                {schedule?.customerPhone && (
                  <div style={{ display: "contents" }}>
                    <span style={{ color: "#000000", fontWeight: 700 }}>Phone</span>
                  <span style={{ color: "#000000", fontWeight: 700 }}>:</span>
                    <strong style={{ color: "#000000", fontWeight: 400 }}>{schedule.customerPhone}</strong>
                  </div>
                )}
                <div style={{ display: "contents" }}>
                  <span style={{ color: "#000000", fontWeight: 700 }}>Address</span>
                  <span style={{ color: "#000000", fontWeight: 700 }}>:</span>
                  <strong style={{ color: "#000000", fontWeight: 400 }}>{schedule?.customerAddress}</strong>
                </div>
                <div style={{ display: "contents" }}>
                  <span style={{ color: "#000000", fontWeight: 700 }}>Agent</span>
                  <span style={{ color: "#000000", fontWeight: 700 }}>:</span>
                  <strong style={{ color: "#000000", fontWeight: 400 }}>{schedule?.agentName ?? "OLIVIER KOH CONG LEE"}</strong>
                </div>
                <div style={{ display: "contents" }}>
                  <span style={{ color: "#000000", fontWeight: 700 }}>Scheduled Date</span>
                  <span style={{ color: "#000000", fontWeight: 700 }}>:</span>
                  <strong style={{ color: "#000000", fontWeight: 400 }}>{schedule?.scheduledDate ?? tx.time}</strong>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* ATAP Details */}
        <h3 style={{ margin: "0 0 8px", fontSize: "14px", fontWeight: 700, color: "#000000" }}>ATAP Details</h3>

        {/* Technical Scheduling System Specification (wraps to fit, no sideways scroll) */}
        <div style={{ fontSize: "13px", color: "#000000", padding: "10px 14px", background: "#f8fafc", borderRadius: "6px", border: "1px solid var(--line)", display: "grid", gridTemplateColumns: "max-content max-content 1fr", columnGap: "6px", rowGap: "4px", alignItems: "baseline" }}>
          <div style={{ display: "contents" }}>
            <span style={{ color: "#000000", fontWeight: 700 }}>System Size (kWp)</span>
            <span style={{ color: "#000000", fontWeight: 700 }}>:</span>
            <div>
                  <span>
                    {schedule?.systemSizeKwp ?? (tx.category === "panel" ? `${((tx.qty * 620) / 1000).toFixed(2)}` : "8.68")} kWp
                  </span>
                
            </div>
          </div>
          <div style={{ display: "contents" }}>
            <span style={{ color: "#000000", fontWeight: 700 }}>DC/AC Ratio</span>
            <span style={{ color: "#000000", fontWeight: 700 }}>:</span>
            <div>
                  {schedule?.dcAcRatio ?? "1.24"}
                
            </div>
          </div>
          <div style={{ display: "contents" }}>
            <span style={{ color: "#000000", fontWeight: 700 }}>System Price</span>
            <span style={{ color: "#000000", fontWeight: 700 }}>:</span>
            <div>
                  {schedule?.systemPrice ?? "RM 26,900.00"}
                
            </div>
          </div>
          <div style={{ display: "contents" }}>
            <span style={{ color: "#000000", fontWeight: 700 }}>Panel Brand</span>
            <span style={{ color: "#000000", fontWeight: 700 }}>:</span>
            <div>
                  {schedule?.panelBrand ?? (tx.model.includes("Astronergy") ? "Astronergy" : "Jinko Solar")}
                
            </div>
          </div>
          <div style={{ display: "contents" }}>
            <span style={{ color: "#000000", fontWeight: 700 }}>No of Panel (Pcs)</span>
            <span style={{ color: "#000000", fontWeight: 700 }}>:</span>
            <div>
                  {schedule?.noOfPanel ?? (tx.category === "panel" ? tx.qty : 14)} pcs
                
            </div>
          </div>
          <div style={{ display: "contents" }}>
            <span style={{ color: "#000000", fontWeight: 700 }}>Panel Power (W)</span>
            <span style={{ color: "#000000", fontWeight: 700 }}>:</span>
            <div>
                  {schedule?.panelPowerWatts ? `${schedule.panelPowerWatts}W` : schedule?.live ? "—" : (tx.model.includes("625") ? "625W" : tx.model.includes("650") ? "650W" : "620W")}
                
            </div>
          </div>
          <div style={{ display: "contents" }}>
            <span style={{ color: "#000000", fontWeight: 700 }}>Inverter Brand</span>
            <span style={{ color: "#000000", fontWeight: 700 }}>:</span>
            <div>
                  {schedule?.inverterBrand ?? (tx.model.includes("Fox") || tx.model.includes("B3") ? "FoxESS" : tx.model.includes("Deye") || tx.model.includes("M2") ? "Deye" : "SAJ Electric")}
                
            </div>
          </div>
          <div style={{ display: "contents" }}>
            <span style={{ color: "#000000", fontWeight: 700 }}>Inverter No</span>
            <span style={{ color: "#000000", fontWeight: 700 }}>:</span>
            <div>
                  {schedule?.inverterNo ?? "1"}
                
            </div>
          </div>
          <div style={{ display: "contents" }}>
            <span style={{ color: "#000000", fontWeight: 700 }}>Inverter Size</span>
            <span style={{ color: "#000000", fontWeight: 700 }}>:</span>
            <div>
                  {schedule?.inverterSize ?? (tx.category === "inverter" ? tx.model : "7.0 kW")}
                
            </div>
          </div>
          <div style={{ display: "contents" }}>
            <span style={{ color: "#000000", fontWeight: 700 }}>Total Inverter Power</span>
            <span style={{ color: "#000000", fontWeight: 700 }}>:</span>
            <div>
                  {schedule?.totalInverterPower ?? (tx.category === "inverter" ? (tx.model.includes("7") ? "7.0 kW" : tx.model.includes("8") ? "8.0 kW" : "7.0 kW") : "7.0 kW")}
                
            </div>
          </div>
          <div style={{ display: "contents" }}>
            <span style={{ color: "#000000", fontWeight: 700 }}>Payment</span>
            <span style={{ color: "#000000", fontWeight: 700 }}>:</span>
            <div>
                  <span className={styles.greenText}>
                    {schedule?.payment ?? "100% Paid"}
                  </span>
                
            </div>
          </div>
          <div style={{ display: "contents" }}>
            <span style={{ color: "#000000", fontWeight: 700 }}>SEDA Status</span>
            <span style={{ color: "#000000", fontWeight: 700 }}>:</span>
            <div>
                  <span className={styles.greenText}>
                    ✓ {schedule?.sedaStatus ?? "Approved"}
                  </span>
                
            </div>
          </div>
          <div style={{ display: "contents" }}>
            <span style={{ color: "#000000", fontWeight: 700 }}>Insurance Applied Date</span>
            <span style={{ color: "#000000", fontWeight: 700 }}>:</span>
            <div>
                  {schedule?.insuranceAppliedDate ?? "08 Oct 2026"}
                
            </div>
          </div>
        </div>

      </div>

      {/* 2. Barcode & Serial Camera Scanner (The Core User Request!) */}
      <div className={styles.scannerCard}>
        {/* Item tabs */}
        <div className={styles.txFilterPills} role="tablist" aria-label="Item" style={{ marginBottom: "12px" }}>
          {STOCK_OUT_TABS.map(([id]) => (
            <button
              key={id}
              type="button"
              role="tab"
              aria-selected={tab === id}
              className={`${styles.txPill} ${tab === id ? styles.txPillActive : ""}`}
              onClick={() => setTab(id)}
            >
              {tabLabel(id)}
            </button>
          ))}
        </div>

        {isSerialTab && (
          <>
            <div className={styles.scannerHeader}>
              <div>
                <h2 className={styles.scannerTitle}>
                  <span>🔍</span> Barcode &amp; Serial Scanner for Verification
                </h2>
                <p className={styles.scannerHelpText}>
                  Scan physical barcode using live mobile camera or handheld laser gun to record each unit before installer pickup.
                </p>
              </div>
              <button
                type="button"
                className={`${styles.scannerBtnCamera} ${cameraActive ? styles.scannerBtnCameraActive : ""}`}
                onClick={() => setCameraActive(!cameraActive)}
              >
                <span>📷</span> {cameraActive ? "Hide Camera" : "Use Camera Scanner"}
              </button>
            </div>

            {/* Camera Viewfinder */}
            {cameraActive && (
              <div className={styles.cameraViewfinder}>
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
          <button type="submit" className={styles.scannerBtnScan}>
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

        {/* 3. Dispatch Units Item List Table (merged into the scanner box) */}
        <hr style={{ border: 0, borderTop: "1px solid var(--line)", margin: "18px 0" }} />
        <div className={styles.skuProgressHeader}>
          <div>
            <p className={styles.itemDesc}>
              Quantities come from the invoice. Serial codes are recorded as each unit is scanned.
            </p>
          </div>
          <div className={styles.skuOverallStats}>
            Scanned: <strong>{tabScanned}</strong> / {tabRequired} ({tabProgress}%) &middot; All items: {totalScanned} / {totalRequired}
          </div>
        </div>

        {/* Visual Progress Bar */}
        <div className={styles.progressBarContainer}>
          <div
            className={`${styles.progressBarFill} ${
              tabProgress < 100 ? styles.progressBarFillWarning : ""
            }`}
            style={{ width: `${tabProgress}%` }}
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
                <th scope="col" style={{ width: "180px" }}>Match Status</th>
              </tr>
            </thead>
            <tbody>
              {tabSlots.map((slot, n) => {
                const isVerified = slot.serial !== null;
                return (
                  <tr key={slot.key} className={isVerified ? styles.unitRowVerified : undefined}>
                    <td style={{ color: "var(--muted)", fontSize: "11px", fontWeight: 600 }}>
                      #{String(n + 1).padStart(2, "0")}
                    </td>
                    <td>
                      <div style={{ fontFamily: "monospace", fontWeight: 700, fontSize: "13px", letterSpacing: "0.03em" }}>
                        {slot.serial ?? "—"}
                      </div>
                    </td>
                    <td>
                      <strong style={{ fontSize: "13px" }}>{slot.line.model}</strong>
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

          </>
        )}

        {/* Bulk materials: quantity loaded is entered, not scanned */}
        {!isSerialTab && (
          <>
            <h2 className={styles.inspectCardTitle}>
              {STOCK_OUT_TABS.find(([id]) => id === tab)?.[1]} for this customer
            </h2>
            <p className={styles.itemDesc}>
              The invoice does not set these quantities. Enter how many are loaded for each item (0 if none).
            </p>
            {tab === "mounting" && (
              <div className={styles.mountPanel}>
                <p className={styles.itemDesc}>
                  Count the runs of panels on the PV drawing (a run is a column or row of panels sharing one pair of rails).
                  Hover over (or tap) a Loaded box to see the suggested quantity in grey, and press Enter to use it.
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
                  {jobSourceId && (
                    <>
                      {" "}
                      &middot;{" "}
                      <button
                        type="button"
                        className={styles.btnActionGhost}
                        style={{ padding: "2px 10px" }}
                        onClick={openDrawings}
                      >
                        View PV drawing
                      </button>
                    </>
                  )}
                </p>
                <div style={{ display: "flex", flexWrap: "wrap", gap: "8px", marginLeft: "auto" }}>
                  <button
                    type="button"
                    className={styles.btnActionGhost}
                    style={{ padding: "2px 10px" }}
                    onClick={() =>
                      setPartQty(
                        Object.fromEntries(Object.entries(mountEstimate.parts).map(([name, qty]) => [name, String(qty)])),
                      )
                    }
                  >
                    Use suggestion as loaded
                  </button>
                  <button type="button" className={styles.btnActionGhost}
                    style={{ padding: "2px 10px" }} onClick={() => setPartQty({})}>
                    Clear
                  </button>
                </div>
                </div>
                <div className={styles.tableWrap}>
                  <table className={`${styles.detailTable} ${styles.mountTable}`}>
                    <thead>
                      <tr>
                        <th scope="col">Part</th>
                        <th scope="col" className={styles.num}>Loaded</th>
                      </tr>
                    </thead>
                    <tbody>
                      {(MOUNTING_SYSTEMS.find((system) => system.id === mountSystem)?.groups ?? []).map((group) => (
                        <Fragment key={group.label}>
                          <tr>
                            <th scope="colgroup" colSpan={2} style={{ textAlign: "left" }}>
                              {group.label}
                            </th>
                          </tr>
                          {group.parts.map((part) => (
                            <tr key={part.name}>
                              <td>{part.name}</td>
                              <td className={styles.num}>
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
                {mountEstimate.notes.map((note) => (
                  <p key={note} className={styles.itemDesc}>
                    {note}
                  </p>
                ))}
              </div>
            )}
            {bulkLines.filter((line) => line.category === tab).length === 0 && (
              <p className={styles.note}>Nothing in this group on the invoice.</p>
            )}
            <div className={styles.inspectChecklist}>
              {bulkLines.map((line, i) =>
                line.category !== tab ? null : (
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

      {/* Transport & Driver Details */}
      <div className={styles.inspectCard} style={{ marginTop: "16px", marginBottom: "16px" }}>
        <div className={styles.bankingAmountGrid} style={{ marginBottom: "0" }}>
          <div className={styles.bankingFieldGroup}>
            <label className={styles.bankingFieldLabel}>Driver &amp; Logistics Team:</label>
            <input
              type="text"
              className={`${styles.scannerInput} ${styles.transferField}`}
              style={{ height: "52px", fontSize: "16px", width: "100%", minWidth: 0 }}
              value={driverName}
              onChange={(e) => setDriverName(e.target.value)}
              placeholder="Driver Name / Transport Team..."
            />
          </div>

          <div className={styles.bankingFieldGroup}>
            <label className={styles.bankingFieldLabel}>Lorry / Transport Plate Number:</label>
            <input
              type="text"
              className={`${styles.scannerInput} ${styles.transferField}`}
              style={{ height: "52px", fontSize: "16px", width: "100%", minWidth: 0 }}
              value={vehiclePlate}
              onChange={(e) => setVehiclePlate(e.target.value)}
              placeholder="e.g. JTP 4910"
            />
          </div>
        </div>

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

      {/* 5. Footer Action Bar */}
      <div className={styles.inspectFooterBar}>
        <button className={styles.btnActionGhost} type="button" onClick={onBack}>
          &larr; Back to Transactions
        </button>

        <div className={styles.inspectActionGroup}>
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
            title="All items scanned and verified for dispatch"
          >
            {isAllVerified
              ? "✓ Verified (Ready for Installation Dispatch)"
              : `🔒 Verified (${stillToDo} more to scan or enter)`}
          </button>
        </div>
      </div>

      <p className={styles.note} style={{ marginTop: "4px" }}>
        💡 <strong>Warehouse Tip:</strong> Scan physical barcodes of panels / inverters loaded onto installer lorry to register serial numbers for Job #{schedule?.jobId ?? tx.reference}. When all {totalRequired} units reach 100%, the <strong>Verified</strong> button unlocks.
      </p>

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
                    {item.label}
                  </button>
                ))}
              </div>
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

      {/* Dispatch Report (includes the Physical Inspection & Dispatch Checklist) */}
      {reportOpen && (
        <div className={styles.bankingReceiptBackdrop} onClick={() => setReportOpen(false)}>
          <div
            className={styles.transferReportCard}
            role="dialog"
            aria-modal="true"
            aria-label="Dispatch report"
            onClick={(e) => e.stopPropagation()}
          >
            <div className={styles.transferReportHead}>
              <h2 className={styles.bankingCardTitle}>Dispatch Report</h2>
              <button type="button" className={styles.btnActionGhost} onClick={() => setReportOpen(false)}>
                Close
              </button>
            </div>
            <div className={styles.bankingReceiptDetails}>
              <div className={styles.bankingReceiptRow}>
                <span className={styles.bankingReceiptRowLabel}>Job</span>
                <span className={styles.bankingReceiptRowVal}>#{schedule?.jobId ?? tx.reference}</span>
              </div>
              <div className={styles.bankingReceiptRow}>
                <span className={styles.bankingReceiptRowLabel}>Equipment</span>
                <span className={styles.bankingReceiptRowVal}>{tx.model} &middot; {totalRequired} {tx.category === "panel" ? "panels" : "units"}</span>
              </div>
              <div className={styles.bankingReceiptRow}>
                <span className={styles.bankingReceiptRowLabel}>Scanned</span>
                <span className={styles.bankingReceiptRowVal}>{totalScanned} / {totalRequired} ({progressPercent}%)</span>
              </div>
            </div>
        <div className={styles.inspectChecklistCard}>
          <h3 className={styles.inspectChecklistTitle}>Physical Inspection &amp; Dispatch Checklist</h3>
          <div className={styles.inspectChecklist}>
            <label className={styles.inspectCheckItem}>
              <input
                type="checkbox"
                checked={checklist.condition}
                onChange={(e) => setChecklist((prev) => ({ ...prev, condition: e.target.checked }))}
              />
              <span>Physical equipment inspected (no visible transit cracks, scratches, glass intact)</span>
            </label>
            <label className={styles.inspectCheckItem}>
              <input
                type="checkbox"
                checked={checklist.serialMatch}
                onChange={(e) => setChecklist((prev) => ({ ...prev, serialMatch: e.target.checked }))}
              />
              <span>All {totalRequired} unit barcodes physically scanned &amp; logged for warranty registration</span>
            </label>
            <label className={styles.inspectCheckItem}>
              <input
                type="checkbox"
                checked={checklist.qtyCounted}
                onChange={(e) => setChecklist((prev) => ({ ...prev, qtyCounted: e.target.checked }))}
              />
              <span>System size checked against the invoice ({systemSizeText})</span>
            </label>
            <label className={styles.inspectCheckItem}>
              <input
                type="checkbox"
                checked={checklist.handoverSigned}
                onChange={(e) => setChecklist((prev) => ({ ...prev, handoverSigned: e.target.checked }))}
              />
              <span>Equipment handover endorsed &amp; dispatch acknowledged</span>
            </label>
          </div>
        </div>
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
}: {
  tx: StockTransaction;
  onBack: () => void;
  onUpdateStatus: (newStatus: StockTransactionStatus, remark?: string) => void;
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
    barcodeInputRef.current?.focus();
  }, []);

  // Camera video stream & live BarcodeDetector hook
  useEffect(() => {
    let stream: MediaStream | null = null;
    let detectorTimer: NodeJS.Timeout | null = null;

    if (cameraActive) {
      if (typeof navigator !== "undefined" && navigator.mediaDevices && navigator.mediaDevices.getUserMedia) {
        navigator.mediaDevices
          .getUserMedia({ video: { facingMode: "environment" } })
          .then((s) => {
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
          .catch(() => {
            setCameraError("Camera unavailable or permission denied. You can test detection below or use a handheld barcode scanner.");
          });
      } else {
        setCameraError("Camera API not supported on this browser.");
      }
    } else {
      if (videoRef.current && videoRef.current.srcObject) {
        const tracks = (videoRef.current.srcObject as MediaStream).getTracks();
        tracks.forEach((t) => t.stop());
        videoRef.current.srcObject = null;
      }
    }

    return () => {
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
        <button className={styles.inspectBackBtn} type="button" onClick={onBack}>
          &larr; Back to Stock Transactions
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
          <button
            type="button"
            className={`${styles.scannerBtnCamera} ${cameraActive ? styles.scannerBtnCameraActive : ""}`}
            onClick={() => setCameraActive(!cameraActive)}
          >
            <span>📷</span> {cameraActive ? "Hide Camera" : "Use Camera Scanner"}
          </button>
        </div>

        {/* Camera Viewfinder */}
        {cameraActive && (
          <div className={styles.cameraViewfinder}>
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
          <button type="submit" className={styles.scannerBtnScan}>
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
        <button className={styles.btnActionGhost} type="button" onClick={onBack}>
          &larr; Back to Transactions
        </button>

        <div className={styles.inspectActionGroup}>
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
        </div>
      </div>

      <p className={styles.note} style={{ marginTop: "4px" }}>
        💡 <strong>Warehouse Tip:</strong> Scan physical barcodes of units loaded onto transit lorry {vehiclePlate} moving between {fromWh} and {toWh}. When all {totalRequired} units reach 100%, the <strong>Verified</strong> button unlocks.
      </p>

      {/* Transfer Report (includes the Physical Inspection & Inter-Warehouse Transit Checklist) */}
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
              <button type="button" className={styles.btnActionGhost} onClick={() => setReportOpen(false)}>
                Close
              </button>
            </div>
            <div className={styles.bankingReceiptDetails}>
              <div className={styles.bankingReceiptRow}>
                <span className={styles.bankingReceiptRowLabel}>Reference</span>
                <span className={styles.bankingReceiptRowVal}>#{transfer?.transferNo ?? tx.reference}</span>
              </div>
              <div className={styles.bankingReceiptRow}>
                <span className={styles.bankingReceiptRowLabel}>Route</span>
                <span className={styles.bankingReceiptRowVal}>{fromLabel} ➔ {toLabel}</span>
              </div>
              <div className={styles.bankingReceiptRow}>
                <span className={styles.bankingReceiptRowLabel}>Equipment</span>
                <span className={styles.bankingReceiptRowVal}>{tx.model} &middot; {totalRequired} {tx.category === "panel" ? "panels" : "units"}</span>
              </div>
              <div className={styles.bankingReceiptRow}>
                <span className={styles.bankingReceiptRowLabel}>Scanned</span>
                <span className={styles.bankingReceiptRowVal}>{totalScanned} / {totalRequired} ({progressPercent}%)</span>
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
              <span>All {totalRequired} unit barcodes physically scanned &amp; verified against Transfer Manifest</span>
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
                  className={styles.excelRibbonSearch}
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
}: {
  tx: StockTransaction;
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
        <button className={styles.inspectBackBtn} type="button" onClick={onBack}>
          &larr; Back to Stock Transactions
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
        <button className={styles.btnActionGhost} type="button" onClick={onBack}>
          &larr; Back to Transactions
        </button>

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

function HomeTab({
  transactions,
  onInspectTx,
  onSignOut,
  onInverterOpen,
  showTx,
  onShowTx,
  onOpenTransfer,
}: {
  transactions: StockTransaction[];
  onInspectTx: (id: string) => void;
  peak?: number;
  onSignOut: () => void;
  onInverterOpen: () => void;
  showTx: boolean;
  onShowTx: (show: boolean) => void;
  onOpenTransfer: () => void;
}) {
  const [whFilter, setWhFilter] = useState<"all" | "JB" | "KL">("all");
  const [txType, setTxType] = useState<"all" | "in" | "out" | "transfer">("all");
  const [txCat, setTxCat] = useState<string>("all");
  const [txSearch, setTxSearch] = useState("");
  const [prepReportOpen, setPrepReportOpen] = useState(false);
  const prepSheetRef = useRef<HTMLDivElement>(null);
  const [checkedBy, setCheckedBy] = useState("");
  const [txStatusTab, setTxStatusTab] = useState<"toVerify" | "verified">("toVerify");
  const txSectionRef = useRef<HTMLDivElement>(null);
  const [selectedDay, setSelectedDay] = useState(() => isoToday());
  const isToday = selectedDay === isoToday();
  const dayLabel = getDayLabel(selectedDay);
  const inSelectedDay = (tx: StockTransaction) => txDate(tx) === selectedDay;
  // Week totals follow the selected Inverter / Panel / Battery card
  const kpiQty = (b: { total: number; inverter: number; panel: number; battery: number; mounting: number; electrical: number }) =>
    txCat === "inverter" || txCat === "panel" || txCat === "battery" || txCat === "mounting" || txCat === "electrical"
      ? b[txCat]
      : b.total;

  const balances = WAREHOUSE_BALANCES[whFilter];

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
      if (txSearch.trim()) {
        const q = txSearch.trim().toLowerCase();
        const match =
          tx.model.toLowerCase().includes(q) ||
          tx.reference.toLowerCase().includes(q) ||
          tx.party.toLowerCase().includes(q) ||
          tx.serialCode.toLowerCase().includes(q) ||
          tx.status.toLowerCase().includes(q) ||
          (tx.transfer?.transferNo ?? "").toLowerCase().includes(q) ||
          (tx.transfer?.driverName ?? "").toLowerCase().includes(q);
        if (!match) return false;
      }
      return true;
    })
    .sort((a, b) => {
      const pA = STATUS_PRIORITY[a.status] ?? 99;
      const pB = STATUS_PRIORITY[b.status] ?? 99;
      return pA - pB;
    });

  // "To Verify" tab also holds Inspected rows (issue still pending); "Verified" holds the rest
  const isVerifiedTx = (status: string) => status === "Verified";
  const toVerifyCount = baseTx.filter((t) => !isVerifiedTx(t.status)).length;
  const verifiedCount = baseTx.length - toVerifyCount;
  const filteredTx = baseTx.filter((t) =>
    txStatusTab === "verified" ? isVerifiedTx(t.status) : !isVerifiedTx(t.status)
  );

  // Warehouse-filtered transactions for weekly summary
  const whTx = useMemo(() => {
    return transactions.filter((tx) => {
      const date = txDate(tx);
      if (date === null || date !== selectedDay) return false;
      if (whFilter === "all") return true;
      if (tx.type === "transfer" && tx.transfer) {
        return (
          tx.transfer.fromWarehouse === whFilter ||
          tx.transfer.toWarehouse === whFilter ||
          tx.warehouse === whFilter
        );
      }
      return tx.warehouse === whFilter;
    });
  }, [transactions, whFilter, selectedDay]);

  // Warehouse Preparation Record: verified Stock Out only, one row per customer + loading date
  const prepRows = useMemo(() => {
    const map = new Map<
      string,
      { customer: string; jobId: string; date: string; team: string; items: { model: string; qty: number | null }[] }
    >();
    whTx
      .filter((t) => t.type === "out" && t.status === "Verified")
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
  }, [whTx]);
  const prepCustomerCount = new Set(prepRows.map((r) => r.customer)).size;
  const prepStockIn = whTx.filter((t) => t.type === "in" && t.status === "Verified");
  const prepTransfers = whTx.filter((t) => t.type === "transfer" && t.status === "Verified");
  const prepLoadingDates = Array.from(new Set(prepRows.map((r) => r.date)));

  // Category breakdown for This Week In
  const inBreakdown = useMemo(() => {
    const inTx = whTx.filter((t) => t.type === "in");
    return {
      total: inTx.reduce((sum, t) => sum + t.qty, 0),
      inverter: inTx.reduce((sum, t) => sum + txCategoryQty(t, "inverter"), 0),
      panel: inTx.reduce((sum, t) => sum + txCategoryQty(t, "panel"), 0),
      battery: inTx.reduce((sum, t) => sum + txCategoryQty(t, "battery"), 0),
      mounting: inTx.reduce((sum, t) => sum + txCategoryQty(t, "mounting"), 0),
      electrical: inTx.reduce((sum, t) => sum + txCategoryQty(t, "electrical"), 0),
    };
  }, [whTx]);

  // Category breakdown for This Week Out
  const outBreakdown = useMemo(() => {
    const outTx = whTx.filter((t) => t.type === "out");
    return {
      total: outTx.reduce((sum, t) => sum + t.qty, 0),
      inverter: outTx.reduce((sum, t) => sum + txCategoryQty(t, "inverter"), 0),
      panel: outTx.reduce((sum, t) => sum + txCategoryQty(t, "panel"), 0),
      battery: outTx.reduce((sum, t) => sum + txCategoryQty(t, "battery"), 0),
      mounting: outTx.reduce((sum, t) => sum + txCategoryQty(t, "mounting"), 0),
      electrical: outTx.reduce((sum, t) => sum + txCategoryQty(t, "electrical"), 0),
    };
  }, [whTx]);

  // Category breakdown for This Week Transfers
  const transferBreakdown = useMemo(() => {
    const trfTx = whTx.filter((t) => t.type === "transfer");
    return {
      total: trfTx.reduce((sum, t) => sum + t.qty, 0),
      inverter: trfTx.reduce((sum, t) => sum + txCategoryQty(t, "inverter"), 0),
      panel: trfTx.reduce((sum, t) => sum + txCategoryQty(t, "panel"), 0),
      battery: trfTx.reduce((sum, t) => sum + txCategoryQty(t, "battery"), 0),
      mounting: trfTx.reduce((sum, t) => sum + txCategoryQty(t, "mounting"), 0),
      electrical: trfTx.reduce((sum, t) => sum + txCategoryQty(t, "electrical"), 0),
    };
  }, [whTx]);


  return (
    <section className={styles.screen} aria-labelledby="warehouse-home">
      <div className={styles.head}>
        <div>
          {showTx && (
            <button className={styles.back} type="button" onClick={() => onShowTx(false)}>
              Back
            </button>
          )}
        </div>
        <button type="button" className={styles.btnActionGhost} onClick={() => setPrepReportOpen(true)}>
          Report
        </button>
      </div>

      {!showTx && (
        <>
      {/* Warehouse filter selector for Home */}
      <div className={styles.balanceHeaderRow}>
            <div>
              <h2 className={styles.sectionTitle} style={{ margin: 0 }}>Stock Balance</h2>
              <p className={styles.kicker} style={{ margin: "2px 0 0" }}>
                Physical on-hand vs installation commitments
              </p>
            </div>
            <div className={styles.balanceWhSelector} role="group" aria-label="Warehouse filter">
              {(["all", "JB", "KL"] as const).map((wh) => (
                <button
                  key={wh}
                  type="button"
                  className={`${styles.balanceWhBtn} ${whFilter === wh ? styles.balanceWhActive : ""}`}
                  onClick={() => setWhFilter(wh)}
                >
                  {wh === "all" ? "All WH" : `${wh} WH`}
                </button>
              ))}
            </div>
          </div>

          {/* 1. Stock Balance Cards for Inverter, Panel, Battery (On hand only) — Single row for desktop & phone */}
          <div className={styles.balanceGrid}>
            {balances.map((card) => {
              const cardContent = (
                <>
                  <div className={styles.balanceCardBody}>
                    <div className={styles.balanceCardHeader}>
                      <span className={styles.typeName}>{card.label}</span>
                      <span className={`${styles.tag} ${styles.check}`}>
                        {whFilter === "all" ? "JB & KL" : `${whFilter} WH`}
                      </span>
                    </div>
                    <div className={styles.onHandMain}>
                      <strong className={styles.onHandNumber}>{card.onHand ?? "—"}</strong>
                      <span className={styles.onHandLabel}>On hand</span>
                    </div>
                    {whFilter === "all" ? (
                      <div className={styles.onHandSplit}>
                        <span><strong>JB:</strong> {WH_SPLIT[card.id]?.JB ?? "—"}</span>
                        <span><strong>KL:</strong> {WH_SPLIT[card.id]?.KL ?? "—"}</span>
                      </div>
                    ) : (
                      <div className={styles.onHandSplit}>
                        <span>{whFilter === "JB" ? "JB Warehouse" : "KL Warehouse"}</span>
                      </div>
                    )}
                  </div>
                </>
              );

              return (
                <article key={card.id} className={`${styles.typeCard} ${styles.balanceCard}`}>
                  {cardContent}
                  <div className={styles.balanceHintPlaceholder} aria-hidden="true" />
                </article>
              );
            })}
          </div>

          {/* Entry buttons: Stock Transaction, then Stock Transfer below it */}
          <div className={styles.homeButtons}>
            <button type="button" className={styles.homeButton} onClick={() => onShowTx(true)}>
              Stock Transaction
            </button>
            <button type="button" className={styles.homeButton} onClick={onOpenTransfer}>
              Stock Transfer
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
            <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", justifyContent: "space-between", gap: "10px", marginBottom: "12px" }}>
        <h2 className={styles.sectionTitle} style={{ margin: 0, fontSize: "24px", fontWeight: 700, color: "#000" }}>
          Stock Transactions{txCat !== "all" ? ` · ${CAT_LABEL[txCat] === "Inv." ? "Inverter" : CAT_LABEL[txCat] === "Batt." ? "Battery" : CAT_LABEL[txCat] === "Mounting" ? "Mounting Structure" : CAT_LABEL[txCat] === "Electrical" ? "Electrical Accessories" : (CAT_LABEL[txCat] ?? txCat)}` : ""}
          <span className={styles.sectionCount}>{filteredTx.length}</span>
        </h2>
            <div className={styles.balanceWhSelector} role="group" aria-label="Warehouse filter" style={{ marginLeft: "auto" }}>
              {(["all", "JB", "KL"] as const).map((wh) => (
                <button
                  key={wh}
                  type="button"
                  className={`${styles.balanceWhBtn} ${whFilter === wh ? styles.balanceWhActive : ""}`}
                  onClick={() => setWhFilter(wh)}
                >
                  {wh === "all" ? "All WH" : `${wh} WH`}
                </button>
              ))}
            </div>
            </div>
            <div className={styles.balanceHeaderRow}>
              <div>
                <p className={styles.kicker} style={{ margin: "2px 0 0" }}>
                  Day: {dayLabel}
                </p>
              </div>
              <div className={styles.txWeekNav}>
                <button
                  type="button"
                  className={`${styles.btnActionGhost} ${styles.txNavBtn}`}
                  onClick={() => setSelectedDay((d) => shiftIso(d, -1))}
                  aria-label="Previous day"
                >
                  &lsaquo; Previous
                </button>
                <div className={styles.txWeekBadge}>
                  <span className={styles.txWeekDot} />
                  <span>Day: {dayLabel}</span>
                </div>
                <input
                  type="date"
                  className={`${styles.scannerInput} ${styles.transferField}`}
                  style={{ width: "auto", minWidth: 0, height: "36px", flex: "none" }}
                  value={selectedDay}
                  onChange={(e) => {
                    if (e.target.value) setSelectedDay(e.target.value);
                  }}
                  aria-label="Pick a day"
                />
                <button
                  type="button"
                  className={`${styles.btnActionGhost} ${styles.txNavBtn}`}
                  onClick={() => setSelectedDay((d) => shiftIso(d, 1))}
                  aria-label="Next day"
                >
                  Next &rsaquo;
                </button>
                {!isToday && (
                  <button
                    type="button"
                    className={styles.btnActionGhost}
                    onClick={() => setSelectedDay(isoToday())}
                  >
                    Today
                  </button>
                )}
              </div>
            </div>

            {/* In / Out KPI summary chips for This Week with Inverter, Panel, Battery Breakdown */}
            <div className={styles.txSummaryRow}>
              {/* This Week In */}
              <div className={styles.txKpiCard}>
                <div className={styles.txKpiHeader}>
                  <div className={styles.txKpiTitles}>
                    <span className={styles.txKpiLabel}>{isToday ? "Today In" : "Day In"}</span>
                    <small className={styles.txKpiSub}>
                      Supplier deliveries
                    </small>
                  </div>
                  <span className={`${styles.txKpiValue} ${styles.txKpiIn}`}>
                    +{kpiQty(inBreakdown)} <span className={styles.txKpiUnit}>units</span>
                  </span>
                </div>
              </div>

              {/* This Week Out */}
              <div className={styles.txKpiCard}>
                <div className={styles.txKpiHeader}>
                  <div className={styles.txKpiTitles}>
                    <span className={styles.txKpiLabel}>{isToday ? "Today Out" : "Day Out"}</span>
                    <small className={styles.txKpiSub}>
                      Dispatched for installs
                    </small>
                  </div>
                  <span className={`${styles.txKpiValue} ${styles.txKpiOut}`}>
                    -{kpiQty(outBreakdown)} <span className={styles.txKpiUnit}>units</span>
                  </span>
                </div>
              </div>

              {/* This Week Inter-Warehouse Transfers */}
              <div className={styles.txKpiCard}>
                <div className={styles.txKpiHeader}>
                  <div className={styles.txKpiTitles}>
                    <span className={styles.txKpiLabel}>{isToday ? "Today Transfer" : "Day Transfer"}</span>
                    <small className={styles.txKpiSub}>
                      Inter-WH rebalance
                    </small>
                  </div>
                  <span className={`${styles.txKpiValue} ${styles.txQtyTransfer}`}>
                    {kpiQty(transferBreakdown)} <span className={styles.txKpiUnit}>units</span>
                  </span>
                </div>
              </div>
            </div>


            {/* Status tabs + search on one row */}
            <div className={styles.txTabsSearchRow}>
            <div className={styles.txFilterPills} role="tablist" aria-label="Transaction status">
              <button
                type="button"
                role="tab"
                aria-selected={txStatusTab === "toVerify"}
                className={`${styles.txPill} ${txStatusTab === "toVerify" ? styles.txPillActive : ""}`}
                onClick={() => setTxStatusTab("toVerify")}
              >
                To Verify ({toVerifyCount})
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={txStatusTab === "verified"}
                className={`${styles.txPill} ${txStatusTab === "verified" ? styles.txPillActive : ""}`}
                onClick={() => setTxStatusTab("verified")}
              >
                Verified ({verifiedCount})
              </button>
            </div>

              <input
                type="search"
                className={styles.txSearchInput}
                placeholder="Search reference, customer, model..."
                value={txSearch}
                onChange={(e) => setTxSearch(e.target.value)}
                aria-label="Search transactions"
              />
            </div>

            {/* Transaction Ledger Table */}
            {filteredTx.length === 0 ? (
              <p className={styles.note}>No stock transactions match your filter criteria.</p>
            ) : (
              <div className={styles.tableWrap}>
                <table className={`${styles.detailTable} ${styles.txLedger}`}>
                  <thead>
                    <tr>
                      <th scope="col">Customer Name</th>
                      <th scope="col">Model / Serial</th>
                      <th scope="col" className={styles.num}>Qty</th>
                      <th scope="col">Type</th>
                      <th scope="col">Installation Date</th>
                      <th scope="col">WH</th>
                      <th scope="col">Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredTx.map((tx) => (
                      <tr key={tx.id}>
                        <td className={styles.txRefCell}>
                          <span className={styles.txCustName}>{tx.party}</span>
                          <span className={`${styles.txParty} ${styles.txInvoiceNo}`}>{tx.reference}</span>
                          {tx.status === "Inspected" && tx.issueRemark && (
                            <div className={styles.issueRemarkTag}>
                              ⚠️ {tx.issueRemark}
                            </div>
                          )}
                        </td>
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
                          <span className={`${styles.code} ${styles.serialUnder} ${styles.mobileOnly}`}>
                            {tx.serialCode}
                          </span>
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
                            ? `+${tx.qty}`
                            : tx.type === "out"
                            ? `${tx.qty}`
                            : `${tx.qty}`}
                        </td>
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
                            {tx.type === "in" ? "IN" : tx.type === "out" ? "OUT" : "TRANSFER"}
                          </span>
                        </td>
                        <td style={{ whiteSpace: "nowrap", fontSize: "12px", color: "#000" }}>
                          {isoDateLabel(tx.time)}
                        </td>
                        <td>
                          {tx.type === "transfer" && tx.transfer ? (
                            <span
                              className={styles.txWhText}
                              title={`Transfer from ${tx.transfer.fromWarehouse} to ${tx.transfer.toWarehouse}`}
                            >
                              {tx.transfer.fromWarehouse} ➔ {tx.transfer.toWarehouse}
                            </span>
                          ) : (
                            <span className={styles.txWhText}>{tx.warehouse}</span>
                          )}
                        </td>
                        <td>
                          <button
                            type="button"
                            className={
                              tx.status === "To Verify"
                                ? styles.btnToVerify
                                : tx.status === "Inspected"
                                ? styles.btnInspected
                                : styles.btnVerified
                            }
                            onClick={() => onInspectTx(tx.id)}
                            title={
                              tx.status === "To Verify"
                                ? "To Verify — Click to inspect transaction"
                                : tx.status === "Inspected"
                                ? "Inspected (Issue) — Pending issue like missing item or damage"
                                : "Verified — All items received in good condition"
                            }
                          >
                            {tx.status === "To Verify" && "To Verify ➔"}
                            {tx.status === "Inspected" && "⚠️ Inspected"}
                            {tx.status === "Verified" && "Verified ✓"}
                          </button>
                        </td>
                      </tr>
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
              <h2 className={styles.bankingCardTitle}>Report</h2>
              <div style={{ display: "flex", gap: "8px" }}>
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
                        `h1{font-size:20px;text-align:center;margin:0 0 12px}h2{font-size:14px;margin:18px 0 8px}` +
                        `table{width:100%;border-collapse:collapse}th,td{border:1px solid #999;padding:6px 8px;text-align:left;vertical-align:top}` +
                        `th:last-child,td:last-child{white-space:nowrap}ul{margin:0;padding-left:20px;line-height:1.6}` +
                        `strong{font-weight:700}span[data-sign]{display:inline-block;min-width:180px;border-bottom:1px solid #000;height:20px}` +
                        `.chk{display:flex;gap:10px;align-items:flex-end;margin-top:28px;flex-wrap:wrap}.sum{display:flex;gap:28px;margin-bottom:16px;flex-wrap:wrap}</style>` +
                        `</head><body>${sheet.innerHTML}</body></html>`
                    );
                    w.document.close();
                    w.focus();
                    w.print();
                  }}
                >
                  Print
                </button>
                <button type="button" className={styles.btnActionGhost} onClick={() => setPrepReportOpen(false)}>
                  Close
                </button>
              </div>
            </div>

            <div className={styles.prepSheet} ref={prepSheetRef}>
              <h1 className={styles.prepTitle}>Warehouse Preparation Record &middot; {dayLabel}</h1>

              <div className={`${styles.prepSummary} sum`}>
                <div>
                  <strong>Total Customers:</strong> {prepCustomerCount}
                </div>
                <div>
                  <strong>Loading Date:</strong> {isoDateLabel(selectedDay)}
                </div>
              </div>

              <h2 className={styles.prepHeading}>MATERIAL PREPARATION &amp; RESPONSIBILITY (STOCK OUT)</h2>
              {prepRows.length === 0 ? (
                <p className={styles.note}>No verified stock out on this day.</p>
              ) : (
                <div className={styles.tableWrap}>
                  <table className={styles.detailTable}>
                    <thead>
                      <tr>
                        <th scope="col">No.</th>
                        <th scope="col">Customer</th>
                        <th scope="col">Loading Date</th>
                        <th scope="col">Material</th>
                        <th scope="col" className={styles.num}>Qty</th>
                        <th scope="col">Responsible</th>
                      </tr>
                    </thead>
                    <tbody>
                      {prepRows.map((r, i) => (
                        <tr key={`${r.customer}|${r.date}`}>
                          <td>{i + 1}</td>
                          <td>
                            {r.customer}
                            <span className={styles.txParty}>{r.jobId}</span>
                          </td>
                          <td style={{ whiteSpace: "nowrap" }}>{isoDateLabel(r.date)}</td>
                          <td>
                            {r.items.map((it, n) => (
                              <div key={n}>{it.model}</div>
                            ))}
                          </td>
                          <td className={styles.num}>
                            {r.items.map((it, n) => (
                              <div key={n}>{it.qty ?? "—"}</div>
                            ))}
                          </td>
                          <td>{r.team || "—"}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}

              <h2 className={styles.prepHeading}>STOCK IN (VERIFIED)</h2>
              {prepStockIn.length === 0 ? (
                <p className={styles.note}>No verified stock in on this day.</p>
              ) : (
                <div className={styles.tableWrap}>
                  <table className={styles.detailTable}>
                    <thead>
                      <tr>
                        <th scope="col">No.</th>
                        <th scope="col">Date</th>
                        <th scope="col">Reference / Supplier</th>
                        <th scope="col">Material</th>
                        <th scope="col" className={styles.num}>Qty</th>
                        <th scope="col">WH</th>
                      </tr>
                    </thead>
                    <tbody>
                      {prepStockIn.map((t, i) => (
                        <tr key={t.id}>
                          <td>{i + 1}</td>
                          <td style={{ whiteSpace: "nowrap" }}>{t.time}</td>
                          <td>
                            {t.reference}
                            <span className={styles.txParty}>{t.party}</span>
                          </td>
                          <td>{t.model}</td>
                          <td className={styles.num}>{t.qty}</td>
                          <td>{t.warehouse}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}

              <h2 className={styles.prepHeading}>TRANSFER (VERIFIED)</h2>
              {prepTransfers.length === 0 ? (
                <p className={styles.note}>No verified transfer on this day.</p>
              ) : (
                <div className={styles.tableWrap}>
                  <table className={styles.detailTable}>
                    <thead>
                      <tr>
                        <th scope="col">No.</th>
                        <th scope="col">Date</th>
                        <th scope="col">Reference</th>
                        <th scope="col">Route</th>
                        <th scope="col">Material</th>
                        <th scope="col" className={styles.num}>Qty</th>
                        <th scope="col">Lorry</th>
                      </tr>
                    </thead>
                    <tbody>
                      {prepTransfers.map((t, i) => (
                        <tr key={t.id}>
                          <td>{i + 1}</td>
                          <td style={{ whiteSpace: "nowrap" }}>{t.time}</td>
                          <td>{t.transfer?.transferNo ?? t.reference}</td>
                          <td style={{ whiteSpace: "nowrap" }}>
                            {t.transfer ? `${t.transfer.fromWarehouse} ➔ ${t.transfer.toWarehouse}` : t.warehouse}
                          </td>
                          <td>{t.model}</td>
                          <td className={styles.num}>{t.qty}</td>
                          <td>{[t.transfer?.driverName, t.transfer?.vehiclePlate].filter(Boolean).join(" · ") || "—"}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}

              <div className={`${styles.prepChecked} chk`}>
                <strong>Checked by:</strong>
                <input
                  type="text"
                  className={styles.prepCheckedInput}
                  value={checkedBy}
                  onChange={(e) => setCheckedBy(e.target.value)}
                  placeholder="Type name"
                  aria-label="Checked by"
                />
                <strong>Date:</strong>
                <span className={styles.prepSignLine} data-sign="1" />
              </div>

              <h2 className={styles.prepHeading}>⚠️ IMPORTANT NOTES</h2>
              <ul className={styles.prepNotes}>
                <li>Only verified (fully scanned) stock in, stock out and transfer are listed in this record.</li>
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
}: {
  transactions: StockTransaction[];
  onInspectTx: (id: string) => void;
  onSignOut: () => void;
  onBack: () => void;
  onNewTransfer: (newTx: StockTransaction) => void;
  onGoToTransactions?: () => void;
}) {
  // 1. Warehouse Route (From Warehouse A -> To Warehouse B)
  const [fromWh, setFromWh] = useState<"JB" | "KL">("JB");
  const [toWh, setToWh] = useState<"JB" | "KL">("KL");

  // 2. Equipment & Quantity
  const [cat, setCat] = useState<"panel" | "inverter" | "battery">("inverter");
  const [modelCode, setModelCode] = useState("M2-1.8K-S4");
  const [qty, setQty] = useState(5);

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
  const [verifiedSerials, setVerifiedSerials] = useState<Set<string>>(new Set());

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
    setVerifiedSerials(new Set());
  }

  // Generate transfer units based on current route and quantity
  const transferUnits = useMemo(() => {
    const mockTx: StockTransaction = {
      id: "draft-transfer",
      time: "Pending",
      type: "transfer",
      category: cat,
      model: currentModelSpec.model,
      serialCode: currentModelSpec.baseSerial,
      qty: Math.max(1, qty),
      warehouse: fromWh,
      reference: "TR-DRAFT",
      party: "Warehouse Transfer",
      status: "To Verify",
      transfer: {
        transferNo: "TR-DRAFT",
        fromWarehouse: fromWh,
        toWarehouse: toWh,
        requestedBy: "Wei Hao (Ops Admin)",
        dispatchedQty: Math.max(1, qty),
        receivedQty: Math.max(1, qty),
      },
    };
    return generateStockTransferSerialList(mockTx);
  }, [cat, currentModelSpec, qty, fromWh, toWh]);

  const totalRequired = transferUnits.length;
  const totalScanned = verifiedSerials.size;
  const progressPercent = totalRequired > 0 ? Math.min(100, Math.round((totalScanned / totalRequired) * 100)) : 0;
  const isAllVerified = totalRequired > 0 && totalScanned >= totalRequired;

  // Camera video stream & live BarcodeDetector hook (same as Stock Out)
  useEffect(() => {
    let stream: MediaStream | null = null;
    let detectorTimer: NodeJS.Timeout | null = null;

    if (cameraActive) {
      if (typeof navigator !== "undefined" && navigator.mediaDevices && navigator.mediaDevices.getUserMedia) {
        navigator.mediaDevices
          .getUserMedia({ video: { facingMode: "environment" } })
          .then((s) => {
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
          .catch(() => {
            setCameraError("Camera unavailable or permission denied. You can test detection below or use a handheld barcode scanner.");
          });
      } else {
        setCameraError("Camera API not supported on this browser.");
      }
    } else {
      if (videoRef.current && videoRef.current.srcObject) {
        const tracks = (videoRef.current.srcObject as MediaStream).getTracks();
        tracks.forEach((t) => t.stop());
        videoRef.current.srcObject = null;
      }
    }

    return () => {
      if (detectorTimer) clearInterval(detectorTimer);
      if (stream) {
        stream.getTracks().forEach((t) => t.stop());
      }
    };
  }, [cameraActive]);

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
          message: `⚠️ Duplicate Scan: S/N ${matchedUnit.serialNo} was already recorded!`,
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
        message: `✅ Matched Unit #${matchedUnit.unitIndex}: ${matchedUnit.serialNo} (${matchedUnit.powerRating}) recorded for transfer! (${newTotal}/${totalRequired})`,
      });
      setBarcodeInput("");
      return;
    }

    // Match by model code fallback: picks next unverified unit
    if (code.toLowerCase() === currentModelSpec.model.toLowerCase()) {
      const nextUnverified = transferUnits.find((u) => !verifiedSerials.has(u.serialNo));
      if (!nextUnverified) {
        setFeedback({
          type: "warning",
          message: `⚠️ All ${totalRequired} units for ${currentModelSpec.model} are already verified!`,
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
        message: `✅ Model matched: Registered Unit #${nextUnverified.unitIndex} (${nextUnverified.serialNo}). (${newTotal}/${totalRequired})`,
      });
      setBarcodeInput("");
      return;
    }

    // Unrecognized barcode
    setFeedback({
      type: "error",
      message: `❌ Unrecognized Barcode: "${code}" does not match allocated inventory for this transfer!`,
    });
    setBarcodeInput("");
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
      category: cat,
      model: currentModelSpec.model,
      serialCode: currentModelSpec.baseSerial,
      qty,
      warehouse: fromWh,
      reference: `${trNum} · ${fromWh} ➔ ${toWh}`,
      party: "Warehouse Transfer",
      status: "Verified",
      transfer: {
        transferNo: trNum,
        fromWarehouse: fromWh,
        toWarehouse: toWh,
        requestedBy: "Wei Hao (Ops Admin)",
        driverName,
        vehiclePlate,
        dispatchedDate: "Today (Just now)",
        receivedDate: "In Transit",
        dispatchedQty: qty,
        receivedQty: qty,
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
      model: currentModelSpec.model,
      qty,
      date: "Today, Just now",
      plate: vehiclePlate,
      driver: driverName,
    });

    // 3. Reset form so no data sits on stock transfer tab
    setVerifiedSerials(new Set());
    setChecklist({ condition: false, serialMatch: false, lorryLoaded: false, handoverSigned: false });
    setFeedback(null);
    setLorryPhoto(null);
  }

  const fromLabel = fromWh === "JB" ? "Johor Bahru (JB) Warehouse" : "Kuala Lumpur (KL) Warehouse";
  const toLabel = toWh === "JB" ? "Johor Bahru (JB) Warehouse" : "Kuala Lumpur (KL) Warehouse";

  return (
    <section className={`${styles.screen} ${styles.arialPage}`} aria-labelledby="stock-transfer-title">
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
          <h1 id="stock-transfer-title">Stock Transfer</h1>
          <p className={styles.kicker}>
            Online banking style stock transfer — select origin, destination, equipment, and verify barcodes before dispatch.
          </p>
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
                  setVerifiedSerials(new Set());
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
                  setVerifiedSerials(new Set());
                }}
                aria-label="To Warehouse"
              >
                <option value="KL">Kuala Lumpur (KL) Warehouse</option>
                <option value="JB">Johor Bahru (JB) Warehouse</option>
              </select>
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
                setVerifiedSerials(new Set());
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
                  setVerifiedSerials(new Set());
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

            {/* Quantity Stepper */}
            <div className={styles.bankingFieldGroup}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <label className={styles.bankingFieldLabel}>Transfer Quantity:</label>
                <span style={{ fontSize: "11px", color: "#0284c7", fontWeight: 600 }}>
                  Max: {availableAtSource}
                </span>
              </div>
              <div style={{ display: "flex", gap: "8px" }}>
                <input
                  type="number"
                  min="1"
                  max={availableAtSource}
                  className={`${styles.scannerInput} ${styles.transferField}`}
                  style={{ flex: 1, height: "42px", fontWeight: 700, fontSize: "15px" }}
                  value={qty}
                  onChange={(e) => {
                    const val = parseInt(e.target.value, 10) || 1;
                    setQty(Math.max(1, Math.min(val, availableAtSource)));
                    setVerifiedSerials(new Set());
                  }}
                />
              </div>
            </div>
          </div>

          {/* Transport & Driver Details */}
          <div className={styles.bankingAmountGrid} style={{ marginBottom: "0" }}>
            <div className={styles.bankingFieldGroup}>
              <label className={styles.bankingFieldLabel}>Driver &amp; Logistics Team:</label>
              <input
                type="text"
                className={`${styles.scannerInput} ${styles.transferField}`}
                style={{ height: "52px", fontSize: "16px", width: "100%", minWidth: 0 }}
                value={driverName}
                onChange={(e) => setDriverName(e.target.value)}
                placeholder="Driver Name / Transport Team..."
              />
            </div>

            <div className={styles.bankingFieldGroup}>
              <label className={styles.bankingFieldLabel}>Lorry / Transport Plate Number:</label>
              <input
                type="text"
                className={`${styles.scannerInput} ${styles.transferField}`}
                style={{ height: "52px", fontSize: "16px", width: "100%", minWidth: 0 }}
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
            <button
              type="button"
              className={`${styles.scannerBtnCamera} ${cameraActive ? styles.scannerBtnCameraActive : ""}`}
              onClick={() => setCameraActive(!cameraActive)}
            >
              <span>📷</span> {cameraActive ? "Hide Camera" : "Use Camera Scanner"}
            </button>
          </div>

          {/* Camera Viewfinder */}
          {cameraActive && (
            <div className={styles.cameraViewfinder}>
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
                  🎯 Camera auto-detects barcode &amp; matches against transfer inventory ({fromWh} ➔ {toWh}).
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
            <button type="submit" className={styles.scannerBtnScan}>
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

          {/* Step 3: Transfer Units Recording Table (merged into the scanner box) */}
          <hr style={{ border: 0, borderTop: "1px solid var(--line)", margin: "18px 0" }} />
          <div className={styles.skuProgressHeader}>
            <div>
              <h2 className={styles.inspectCardTitle}>
                <span>📋</span> Transfer Units Checklist — {currentModelSpec.model}
              </h2>
              <p className={styles.itemDesc}>
                Scanned unit serial codes allocated for transport from {fromLabel} to {toLabel}
              </p>
            </div>
            <div className={styles.skuOverallStats}>
              Total Scanned: <strong>{totalScanned}</strong> / {totalRequired} {cat === "panel" ? "panels" : "units"} ({progressPercent}%)
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

        {/* Step 5: Authorization & Verified Button (Online Banking Style) */}
        <div className={styles.inspectFooterBar}>
          <button
            className={styles.btnActionGhost}
            type="button"
            onClick={() => {
              setVerifiedSerials(new Set());
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
            title="Scan all units to unlock verification"
            style={{ padding: "10px 24px", fontSize: "14px" }}
          >
            {isAllVerified
              ? "✓ Verified (Authorize & Complete Transfer)"
              : `🔒 Verified (Scan ${totalRequired - totalScanned} more to unlock)`}
          </button>
        </div>

        <p className={styles.note} style={{ marginTop: "4px" }}>
          💡 <strong>Online Banking Model:</strong> Once you click <strong>Verified</strong>, this transfer data will sit on <strong>Stock Transactions</strong> (under Home tab). No persistent data sits on this transfer tab, keeping it clean for your next transfer!
        </p>
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
              <button type="button" className={styles.btnActionGhost} onClick={() => setReportOpen(false)}>
                Close
              </button>
            </div>
            <div className={styles.bankingReceiptDetails}>
              <div className={styles.bankingReceiptRow}>
                <span className={styles.bankingReceiptRowLabel}>Route</span>
                <span className={styles.bankingReceiptRowVal}>{fromLabel} ➔ {toLabel}</span>
              </div>
              <div className={styles.bankingReceiptRow}>
                <span className={styles.bankingReceiptRowLabel}>Equipment</span>
                <span className={styles.bankingReceiptRowVal}>{currentModelSpec.model} &middot; {qty} {cat === "panel" ? "panels" : "units"}</span>
              </div>
              <div className={styles.bankingReceiptRow}>
                <span className={styles.bankingReceiptRowLabel}>Driver &amp; Lorry</span>
                <span className={styles.bankingReceiptRowVal}>{driverName} &middot; {vehiclePlate}</span>
              </div>
              <div className={styles.bankingReceiptRow}>
                <span className={styles.bankingReceiptRowLabel}>Scanned</span>
                <span className={styles.bankingReceiptRowVal}>{totalScanned} / {totalRequired} ({progressPercent}%)</span>
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
              <span>All {totalRequired} unit barcodes physically scanned &amp; verified against Transfer Manifest</span>
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
                📋 View in Stock Transactions ➔
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

function StockDetailsTab() {
  const [whFilter, setWhFilter] = useState<"all" | "JB" | "KL">("all");
  const [query, setQuery] = useState("");
  const [stockTab, setStockTab] = useState<"panel" | "inverter" | "battery" | "other" | "mounting">("panel");

  const filteredItems =
    whFilter === "all"
      ? STOCK_DETAIL_ITEMS
      : STOCK_DETAIL_ITEMS.filter((item) => item.warehouse === whFilter);

  const panels = filteredItems.filter((item) => item.category === "panel");
  const inverters = filteredItems.filter((item) => item.category === "inverter");
  const batteries = filteredItems.filter((item) => item.category === "battery");
  const others = filteredItems.filter((item) => item.category === "other");

  const summaries =
    whFilter === "all"
      ? WAREHOUSE_STOCK_SUMMARY
      : WAREHOUSE_STOCK_SUMMARY.filter((s) => s.warehouse === whFilter);

  const tableWarehouses: Array<"JB" | "KL"> = whFilter === "all" ? ["JB", "KL"] : [whFilter];

  const trendPeak = Math.max(
    1,
    ...STOCK_MODEL_TREND.flatMap((row) => [row.panels, row.inverters, row.batteries]),
  );

  return (
    <section className={styles.screen} aria-labelledby="warehouse-stock-details">
      <h1 id="warehouse-stock-details">Stock Details</h1>
      <p className={styles.kicker}>Current inventory across JB and KL warehouses.</p>

      {/* Warehouse filter */}
      <div className={styles.filterRow}>
        {(["all", "JB", "KL"] as const).map((value) => (
          <button
            key={value}
            type="button"
            className={`${styles.filterBtn} ${whFilter === value ? styles.filterActive : ""}`}
            onClick={() => setWhFilter(value)}
          >
            {value === "all" ? "All" : value}
          </button>
        ))}
      </div>

      {/* Warehouse summary cards */}
      <div className={styles.summaryRow}>
        {summaries.map((s) => (
          <div key={s.warehouse} className={styles.summaryCard}>
            <span className={styles.summaryLabel}>{s.warehouse} Warehouse</span>
            <strong className={styles.summaryTotal}>
              {s.panels + s.inverters + s.batteries}
            </strong>
            <span className={styles.summaryBreakdown}>
              <span>{s.panels} panels</span>
              <span>{s.inverters} inverters</span>
              <span>{s.batteries} batteries</span>
            </span>
          </div>
        ))}
      </div>

      {/* Stock trend chart */}
      <h2 className={styles.sectionTitle}>Stock trend</h2>
      <p className={styles.kicker}>End-of-month levels across all warehouses.</p>
      <div className={styles.chart} aria-label="Stock levels by category over months">
        {STOCK_MODEL_TREND.map((row) => (
          <div key={row.month} className={styles.chartCol}>
            <div className={styles.bars}>
              <span
                className={styles.barStockPanel}
                style={{ height: `${Math.round((row.panels / trendPeak) * 100)}%` }}
                title={`${row.month} panels ${row.panels}`}
              >
                <span className={styles.barValue}>{row.panels}</span>
              </span>
              <span
                className={styles.barStockInverter}
                style={{ height: `${Math.round((row.inverters / trendPeak) * 100)}%` }}
                title={`${row.month} inverters ${row.inverters}`}
              >
                <span className={styles.barValue}>{row.inverters}</span>
              </span>
              <span
                className={styles.barStockBattery}
                style={{ height: `${Math.round((row.batteries / trendPeak) * 100)}%` }}
                title={`${row.month} batteries ${row.batteries}`}
              >
                <span className={styles.barValue}>{row.batteries}</span>
              </span>
            </div>
            <span className={styles.chartMonth}>{row.month}</span>
          </div>
        ))}
      </div>
      <p className={styles.legend}>
        <span className={styles.legendStockPanel}>Panel</span>
        <span className={styles.legendStockInverter}>Inverter</span>
        <span className={styles.legendStockBattery}>Battery</span>
      </p>

      {/* Detail tables, all filtered by the one search box */}
      <input
        className={styles.tableSearch}
        type="search"
        placeholder="Search this tab by model or code"
        aria-label="Search stock by model or code"
        value={query}
        onChange={(event) => setQuery(event.target.value)}
      />
      <div className={styles.txFilterPills} role="tablist" aria-label="Stock item" style={{ marginBottom: "12px" }}>
        {(
          [
            ["panel", "Panel"],
            ["inverter", "Inverter"],
            ["battery", "Battery"],
            ["other", "Electrical Accessories"],
            ["mounting", "Mounting Structure"],
          ] as const
        ).map(([id, label]) => (
          <button
            key={id}
            type="button"
            role="tab"
            aria-selected={stockTab === id}
            className={`${styles.txPill} ${stockTab === id ? styles.txPillActive : ""}`}
            onClick={() => setStockTab(id)}
          >
            {label}
          </button>
        ))}
      </div>

      {stockTab === "panel" && (
        <StockTable title="Panel" items={panels} warehouses={tableWarehouses} query={query} />
      )}
      {stockTab === "inverter" && (
        <StockTable title="Inverter" items={inverters} warehouses={tableWarehouses} query={query} />
      )}
      {stockTab === "battery" && (
        <StockTable title="Battery" items={batteries} warehouses={tableWarehouses} query={query} />
      )}
      {stockTab === "other" && (
        <StockTable
          title="Electrical Accessories"
          items={others}
          warehouses={tableWarehouses}
          query={query}
        />
      )}
      {stockTab === "mounting" && <MountingStructureSection warehouses={tableWarehouses} />}
    </section>
  );
}

function MountingStructureSection({ warehouses }: { warehouses: Array<"JB" | "KL"> }) {
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
                      {wh}
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
                            {show(wh === "JB" ? part.jb : part.kl)}
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
  qty: Record<"JB" | "KL", number>;
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
      qty: { JB: 0, KL: 0 },
    };
    row.qty[item.warehouse] += item.qty;
    row.highlight ||= Boolean(item.highlight);
    rows.set(key, row);
  }
  return [...rows.values()];
}

function StockTable({
  title,
  items,
  warehouses,
  query,
}: {
  title: string;
  items: StockDetailItem[];
  warehouses: Array<"JB" | "KL">;
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
  const whTotal = (wh: "JB" | "KL") => rows.reduce((sum, row) => sum + row.qty[wh], 0);
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
                  <th key={wh} scope="col" className={styles.num}>{wh}</th>
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
// Tab 3 — Customer Details
// ---------------------------------------------------------------------------



// ---------------------------------------------------------------------------
// Customer Details: read-only copy of the dashboard's Arranged Installation
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

function ArrangedInstallationView({ groups }: { groups: ArrangedGroupPayload[] }) {
  const weeks = useMemo(
    () => Array.from(new Set(groups.map((g) => arrMonday(g.installationDate)))).sort(),
    [groups],
  );
  const todayWeek = arrMonday(new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Kuala_Lumpur" }));
  const [weekIndex, setWeekIndex] = useState<number | null>(null);
  const index =
    weekIndex ?? Math.max(0, weeks.includes(todayWeek) ? weeks.indexOf(todayWeek) : weeks.length - 1);
  const week = weeks[index];
  const weekGroups = groups.filter((g) => arrMonday(g.installationDate) === week);

  return (
    <section className={styles.screen} aria-labelledby="warehouse-arranged">
      <div className={styles.arrHeader}>
        <div>
          <h1 id="warehouse-arranged">Customer Details</h1>
          <p className={styles.kicker}>Customers scheduled with installation dates and teams</p>
        </div>
        <div className={styles.arrNav}>
          <button
            type="button"
            className={styles.btnActionGhost}
            disabled={index <= 0}
            onClick={() => setWeekIndex(index - 1)}
          >
            &lsaquo; Previous
          </button>
          <select
            className={styles.bankingAccountSelect}
            style={{ width: "auto" }}
            value={index}
            onChange={(e) => setWeekIndex(Number(e.target.value))}
            aria-label="Week"
          >
            {weeks.map((w, i) => (
              <option key={w} value={i}>
                Week {arrWeekLabel(w)}
                {i === weeks.length - 1 ? " (Latest)" : ""}
              </option>
            ))}
          </select>
          <button
            type="button"
            className={styles.btnActionGhost}
            disabled={index >= weeks.length - 1}
            onClick={() => setWeekIndex(index + 1)}
          >
            Next &rsaquo;
          </button>
        </div>
      </div>

      {weekGroups.length === 0 ? (
        <p className={styles.note}>No arranged installation in this period.</p>
      ) : (
        weekGroups.map((group, gi) => (
          <div key={group.id} className={styles.arrGroup}>
            <div className={styles.arrWeekBar}>Week {arrWeekLabel(week)}</div>
            <div className={styles.arrTeamBand} style={{ background: ARR_BAND_COLOURS[gi % ARR_BAND_COLOURS.length] }}>
              <div className={styles.arrTeamName}>
                <strong>{group.teamLabel || "Team"}</strong>
                {group.baseLocation && <span className={styles.arrBase}>{group.baseLocation}</span>}
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
        ))
      )}
    </section>
  );
}

function StockByCustomerTab() {
  const [arranged, setArranged] = useState<ArrangedGroupPayload[] | null>(null);
  useEffect(() => {
    let cancelled = false;
    fetch("/api/warehouse/arranged", { credentials: "same-origin", cache: "no-store" })
      .then(async (res) => (res.ok ? ((await res.json()) as { groups?: ArrangedGroupPayload[] }) : null))
      .then((data) => {
        if (!cancelled && data?.groups && data.groups.length > 0) setArranged(data.groups);
      })
      .catch((err) => console.error("Arranged installation failed", err));
    return () => {
      cancelled = true;
    };
  }, []);
  const [whFilter, setWhFilter] = useState<"all" | "JB" | "KL">("all");
  const [search, setSearch] = useState("");

  const filtered = CUSTOMER_STOCK_ALLOCATIONS
    .filter((c) => whFilter === "all" || c.warehouse === whFilter)
    .filter((c) => {
      const needle = search.trim().toLowerCase();
      if (!needle) return true;
      return [c.customerName, ...c.allocations.flatMap((a) => [a.model, a.serialCode])].some((text) =>
        text.toLowerCase().includes(needle),
      );
    });

  const summaries =
    whFilter === "all"
      ? WAREHOUSE_STOCK_SUMMARY
      : WAREHOUSE_STOCK_SUMMARY.filter((s) => s.warehouse === whFilter);

  const trendPeak = Math.max(
    1,
    ...STOCK_MODEL_TREND.flatMap((row) => [row.panels, row.inverters, row.batteries]),
  );

  if (arranged) return <ArrangedInstallationView groups={arranged} />;

  return (
    <section className={styles.screen} aria-labelledby="warehouse-stock-customer">
      <h1 id="warehouse-stock-customer">Customer Details</h1>
      <p className={styles.kicker}>Material allocation per customer order.</p>

      {/* Warehouse filter */}
      <div className={styles.filterRow}>
        {(["all", "JB", "KL"] as const).map((value) => (
          <button
            key={value}
            type="button"
            className={`${styles.filterBtn} ${whFilter === value ? styles.filterActive : ""}`}
            onClick={() => setWhFilter(value)}
          >
            {value === "all" ? "All" : value}
          </button>
        ))}
      </div>

      {/* Warehouse summary cards */}
      <div className={styles.summaryRow}>
        {summaries.map((s) => (
          <div key={s.warehouse} className={styles.summaryCard}>
            <span className={styles.summaryLabel}>{s.warehouse} Warehouse</span>
            <strong className={styles.summaryTotal}>
              {s.panels + s.inverters + s.batteries}
            </strong>
            <span className={styles.summaryBreakdown}>
              <span>{s.panels} panels</span>
              <span>{s.inverters} inverters</span>
              <span>{s.batteries} batteries</span>
            </span>
          </div>
        ))}
      </div>

      {/* Stock trend chart */}
      <h2 className={styles.sectionTitle}>Stock trend</h2>
      <p className={styles.kicker}>End-of-month levels across all warehouses.</p>
      <div className={styles.chart} aria-label="Stock levels by category over months">
        {STOCK_MODEL_TREND.map((row) => (
          <div key={row.month} className={styles.chartCol}>
            <div className={styles.bars}>
              <span
                className={styles.barStockPanel}
                style={{ height: `${Math.round((row.panels / trendPeak) * 100)}%` }}
                title={`${row.month} panels ${row.panels}`}
              >
                <span className={styles.barValue}>{row.panels}</span>
              </span>
              <span
                className={styles.barStockInverter}
                style={{ height: `${Math.round((row.inverters / trendPeak) * 100)}%` }}
                title={`${row.month} inverters ${row.inverters}`}
              >
                <span className={styles.barValue}>{row.inverters}</span>
              </span>
              <span
                className={styles.barStockBattery}
                style={{ height: `${Math.round((row.batteries / trendPeak) * 100)}%` }}
                title={`${row.month} batteries ${row.batteries}`}
              >
                <span className={styles.barValue}>{row.batteries}</span>
              </span>
            </div>
            <span className={styles.chartMonth}>{row.month}</span>
          </div>
        ))}
      </div>
      <p className={styles.legend}>
        <span className={styles.legendStockPanel}>Panel</span>
        <span className={styles.legendStockInverter}>Inverter</span>
        <span className={styles.legendStockBattery}>Battery</span>
      </p>

      {/* Customer search */}
      <h2 className={styles.sectionTitle}>
        Customers
        <span className={styles.sectionCount}>{filtered.length}</span>
      </h2>
      <label className={styles.field}>
        Search customer
        <input
          type="search"
          value={search}
          placeholder="Customer name, model or serial"
          onChange={(e) => setSearch(e.target.value)}
        />
      </label>

      {/* All customers in one table; name and warehouse span each customer's rows.
          Mobile view folds WH under the name and the serial under the model, so it fits without scrolling. */}
      {filtered.length === 0 ? (
        <p className={styles.note}>No customers match the current filter.</p>
      ) : (
        <div className={`${styles.tableWrap} ${styles.customerAll}`}>
          <table className={styles.detailTable}>
            <thead>
              <tr>
                <th scope="col">Customer</th>
                <th scope="col" className={styles.desktopOnly}>WH</th>
                <th scope="col">Type</th>
                <th scope="col">Model</th>
                <th scope="col" className={styles.desktopOnly}>Serial</th>
                <th scope="col" className={styles.num}>Qty</th>
              </tr>
            </thead>
            {filtered.map((customer) => (
              <tbody key={customer.id} className={styles.customerGroup}>
                {customer.allocations.map((alloc, i) => (
                  <tr key={i}>
                    {i === 0 && (
                      <>
                        <th scope="rowgroup" rowSpan={customer.allocations.length} className={styles.customerName}>
                          {customer.customerName}
                          <span className={`${styles.tag} ${styles.check} ${styles.whUnder} ${styles.mobileOnly}`}>
                            {customer.warehouse}
                          </span>
                        </th>
                        <td rowSpan={customer.allocations.length} className={styles.desktopOnly}>
                          <span className={`${styles.tag} ${styles.check}`}>{customer.warehouse}</span>
                        </td>
                      </>
                    )}
                    <td>
                      <span className={catClass(alloc.category)}>{CAT_LABEL[alloc.category] ?? alloc.category}</span>
                    </td>
                    <td>
                      {alloc.model}
                      <span className={`${styles.code} ${styles.serialUnder} ${styles.mobileOnly}`}>
                        {alloc.serialCode}
                      </span>
                    </td>
                    <td className={`${styles.code} ${styles.desktopOnly}`}>{alloc.serialCode}</td>
                    <td className={styles.num}>{alloc.qty}</td>
                  </tr>
                ))}
              </tbody>
            ))}
          </table>
        </div>
      )}
    </section>
  );
}
