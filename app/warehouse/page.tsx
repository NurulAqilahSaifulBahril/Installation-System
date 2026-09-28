"use client";

import { FormEvent, Fragment, TouchEvent, WheelEvent, useEffect, useRef, useState } from "react";
import {
  CUSTOMER_STOCK_ALLOCATIONS,
  INVERTER_TYPES,
  ORDER_MODELS,
  STOCK_CARDS,
  STOCK_DETAIL_ITEMS,
  STOCK_MODEL_TREND,
  SYSTEM_TREND,
  WAREHOUSE_NOTICES,
  WAREHOUSE_STOCK_SUMMARY,
  type InverterTypeId,
  type WarehouseNoticeKind,
  type StockDetailItem,
  type WarehouseModel,
} from "@/lib/warehouse-sample";
import styles from "./warehouse.module.css";

const SESSION_KEY = "warehouse-phone";
const VIEW_KEY = "warehouse-view";
// Cropped to the artwork (public/eternalgy-logo.png has wide transparent margins).
const LOGO_SRC = "/eternalgy-logo-tight.png";
// The symbol alone, without the ETERNALGY / ETERNAL ENERGY wording (sign-in headline).
const MARK_SRC = "/eternalgy-mark.png";

type View = "mobile" | "desktop";

function readSavedView(): View | null {
  try {
    const saved = window.localStorage.getItem(VIEW_KEY);
    return saved === "mobile" || saved === "desktop" ? saved : null;
  } catch {
    return null;
  }
}

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
    // A saved choice wins; otherwise pick from the screen width.
    setView(readSavedView() ?? (window.matchMedia("(min-width: 900px)").matches ? "desktop" : "mobile"));
    setReady(true);
  }, []);

  function chooseView(next: View) {
    setView(next);
    try {
      window.localStorage.setItem(VIEW_KEY, next);
    } catch {
      // Private windows can block storage; the choice still applies until reload.
    }
  }

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
          </header>
          <Dashboard phone={signedInPhone} model={model} onSignOut={signOut} onSelect={setModel} />
        </>
      ) : (
        <SignIn
          view={view}
          onView={chooseView}
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
  view,
  onView,
  phone,
  code,
  error,
  onPhone,
  onCode,
  onSubmit,
}: {
  view: View;
  onView: (view: View) => void;
  phone: string;
  code: string;
  error: string | null;
  onPhone: (value: string) => void;
  onCode: (value: string) => void;
  onSubmit: (event: FormEvent) => void;
}) {
  const [revealed, setRevealed] = useState(false);
  const touchStart = useRef<number | null>(null);
  const shadeRef = useRef<HTMLDivElement>(null);

  // Swipe up (or scroll down with a mouse) once the notices are at their end.
  function atEnd() {
    const el = shadeRef.current;
    return !el || el.scrollTop + el.clientHeight >= el.scrollHeight - 2;
  }

  function onTouchStart(event: TouchEvent<HTMLElement>) {
    touchStart.current = event.touches[0].clientY;
  }

  function onTouchEnd(event: TouchEvent<HTMLElement>, force = false) {
    if (touchStart.current === null) return;
    const moved = touchStart.current - event.changedTouches[0].clientY;
    touchStart.current = null;
    if (moved > 50 && (force || atEnd())) setRevealed(true);
  }

  function onWheel(event: WheelEvent<HTMLElement>) {
    if (view === "mobile" && !revealed && event.deltaY > 30 && atEnd()) setRevealed(true);
  }

  const fields = (
    <>
      <label className={styles.field}>
        Phone number
        <input
          type="tel"
          name="phone"
          inputMode="tel"
          autoComplete="tel"
          autoFocus={view === "mobile"}
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
    <section
      className={styles.lock}
      aria-labelledby="warehouse-sign-in"
      onTouchStart={onTouchStart}
      onTouchEnd={(event) => onTouchEnd(event)}
      onWheel={onWheel}
    >
      <div className={styles.viewToggle} role="group" aria-label="Page view">
        {(["mobile", "desktop"] as const).map((option) => (
          <button
            key={option}
            type="button"
            className={view === option ? styles.viewToggleActive : undefined}
            aria-pressed={view === option}
            onClick={() => onView(option)}
          >
            {option === "mobile" ? "Mobile" : "Desktop"}
          </button>
        ))}
      </div>
      <h1 id="warehouse-sign-in" className={styles.lockTitle}>
        <img className={styles.lockLogo} src={MARK_SRC} alt="Eternalgy" width={357} height={176} />
        <span>Inventory Management</span>
      </h1>
      <div className={styles.shade} ref={shadeRef}>
        <NoticeList />
      </div>
      {view === "desktop" ? (
        // Desktop: no swipe; the sign-in form sits right below the notices.
        <form className={`${styles.form} ${styles.inlineForm}`} onSubmit={onSubmit} aria-label="Sign in">
          {fields}
        </form>
      ) : revealed ? (
        <>
          <button
            className={styles.sheetBackdrop}
            type="button"
            aria-label="Hide sign in"
            onClick={() => setRevealed(false)}
          />
          <form className={`${styles.form} ${styles.sheet}`} onSubmit={onSubmit} aria-label="Sign in">
            <button
              className={styles.sheetHandle}
              type="button"
              aria-label="Hide sign in"
              onClick={() => setRevealed(false)}
            />
            {fields}
          </form>
        </>
      ) : (
        <button
          className={styles.swipeHint}
          type="button"
          onClick={() => setRevealed(true)}
          onTouchStart={onTouchStart}
          onTouchEnd={(event) => {
            event.stopPropagation();
            onTouchEnd(event, true);
          }}
        >
          <span className={styles.swipeBar} aria-hidden="true" />
          Swipe up to sign in
        </button>
      )}
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

type TabId = "home" | "stock" | "customers";

const TABS: { id: TabId; label: string }[] = [
  { id: "home", label: "Home" },
  { id: "stock", label: "Stock Details" },
  { id: "customers", label: "Customer Details" },
];

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
  const [inverterOpen, setInverterOpen] = useState(false);
  const [inverterType, setInverterType] = useState<InverterTypeId | null>(null);
  const typeModels = ORDER_MODELS.filter((item) => item.inverterType === inverterType);
  const peak = Math.max(...SYSTEM_TREND.flatMap((row) => [row.sales, row.install, row.target]));

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
      <nav className={styles.tabBar} aria-label="Warehouse sections">
        {TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            className={`${styles.tab} ${tab === t.id ? styles.tabActive : ""}`}
            onClick={() => setTab(t.id)}
            aria-current={tab === t.id ? "page" : undefined}
          >
            {t.label}
          </button>
        ))}
      </nav>

      {tab === "home" && (
        <HomeTab
          peak={peak}
          onSignOut={onSignOut}
          onInverterOpen={() => setInverterOpen(true)}
        />
      )}
      {tab === "stock" && <StockDetailsTab />}
      {tab === "customers" && <StockByCustomerTab />}
    </>
  );
}

// ---------------------------------------------------------------------------
// Tab 1 — Home (the original dashboard content)
// ---------------------------------------------------------------------------

function HomeTab({
  peak,
  onSignOut,
  onInverterOpen,
}: {
  peak: number;
  onSignOut: () => void;
  onInverterOpen: () => void;
}) {
  return (
    <section className={styles.screen} aria-labelledby="warehouse-home">
      <div className={styles.head}>
        <div>
          <h1 id="warehouse-home">Inventory Management</h1>
          <p className={styles.kicker}>Hi Wei Hao!</p>
        </div>
        <button className={styles.ghost} type="button" onClick={onSignOut}>
          Sign out
        </button>
      </div>
      <div className={styles.homeLayout}>
        <aside className={styles.noticePanel} aria-labelledby="warehouse-home-notices">
          <h2 id="warehouse-home-notices" className={styles.noticePanelTitle}>
            Notifications
            <span className={styles.sectionCount}>{WAREHOUSE_NOTICES.length}</span>
          </h2>
          <NoticeList />
        </aside>
        <div className={styles.homeMain}>
          <div className={styles.typeGrid}>
            {STOCK_CARDS.map((card) => {
              const short = (card.toBuy ?? 0) > 0;
              const body = (
                <>
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
                </>
              );
              if (card.id === "inverter") {
                return (
                  <button
                    key={card.id}
                    className={`${styles.typeCard} ${short ? styles.short : ""}`}
                    type="button"
                    onClick={onInverterOpen}
                  >
                    {body}
                  </button>
                );
              }
              return (
                <article key={card.id} className={styles.typeCard}>
                  {body}
                  {card.onHand === null && <small className={styles.typeNote}>No total on the sample sheet</small>}
                </article>
              );
            })}
          </div>
          <h2 className={styles.sectionTitle}>Sales vs installation</h2>
          <p className={styles.kicker}>Systems by month. Draft counts, not the full Post Sales total.</p>
          <div className={styles.chart} aria-label="Sales, sales target, and installations by month, in systems">
            {SYSTEM_TREND.map((row) => (
              <div key={row.month} className={styles.chartCol}>
                <div className={`${styles.bars} ${styles.barsWithTarget}`}>
                  {/* The target is a level to reach, so it is a dashed line across the month, not a bar. */}
                  <span className={styles.targetLayer}>
                    <span
                      className={styles.targetLine}
                      style={{ bottom: `${Math.round((row.target / peak) * 100)}%` }}
                      title={`${row.month} sales target ${row.target}`}
                    >
                      <span className={styles.targetValue}>{row.target}</span>
                    </span>
                  </span>
                  <span
                    className={styles.barSales}
                    style={{ height: `${Math.round((row.sales / peak) * 100)}%` }}
                    title={`${row.month} sales ${row.sales}`}
                  >
                    <span className={styles.barValue}>{row.sales}</span>
                  </span>
                  <span
                    className={styles.barInstall}
                    style={{ height: `${Math.round((row.install / peak) * 100)}%` }}
                    title={`${row.month} installation ${row.install}`}
                  >
                    <span className={styles.barValue}>{row.install}</span>
                  </span>
                </div>
                <span className={styles.chartMonth}>{row.month}</span>
              </div>
            ))}
          </div>
          <p className={styles.legend}>
            <span className={styles.legendTarget}>Sales target</span>
            <span className={styles.legendSales}>Sales</span>
            <span className={styles.legendInstall}>Installation</span>
          </p>
        </div>
      </div>
    </section>
  );
}

// ---------------------------------------------------------------------------
// Tab 2 — Stock Details
// ---------------------------------------------------------------------------

function StockDetailsTab() {
  const [whFilter, setWhFilter] = useState<"all" | "JB" | "KL">("all");
  const [query, setQuery] = useState("");

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
        placeholder="Search panel, inverter, battery or other by model or code"
        aria-label="Search stock by model or code"
        value={query}
        onChange={(event) => setQuery(event.target.value)}
      />
      <div className={styles.tableGrid}>
        <StockTable title="Panel" items={panels} warehouses={tableWarehouses} query={query} />
        <StockTable title="Inverter" items={inverters} warehouses={tableWarehouses} query={query} />
        <StockTable title="Battery" items={batteries} warehouses={tableWarehouses} query={query} />
        <StockTable
          title="Battery Controller and Other"
          items={others}
          warehouses={tableWarehouses}
          query={query}
        />
      </div>
    </section>
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

const CAT_LABEL: Record<string, string> = {
  panel: "Panel",
  inverter: "Inv.",
  battery: "Batt.",
};

function catClass(cat: string): string {
  if (cat === "panel") return styles.catPanel;
  if (cat === "inverter") return styles.catInverter;
  return styles.catBattery;
}

function StockByCustomerTab() {
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
    ...STOCK_MODEL_TREND.flatMap((row) => [row.panels, row.inverters, row.batteries]),
  );

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
