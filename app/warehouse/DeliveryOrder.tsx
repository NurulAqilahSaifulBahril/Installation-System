"use client";

// Delivery Order (DO) for one Stock Out job, laid out like the company's DO form:
// A. Client information, B. Delivery details, the 23-line Deliver Items List (Packer / Driver /
// Recipient tick boxes), Material Planner / Warehouse Manager, and the acknowledgement boxes.
// Quantities come from the Stock Out page (panels, inverters, mounting and electrical items);
// the driver and delivery times come from the job's run on the Delivery Schedule.

import { useEffect, useState } from "react";
import { watchDeliveryRuns } from "./delivery-feed";
import type { StockOutLine, StockOutScheduleData } from "@/lib/warehouse-sample";
import { DownloadReportButton, reportFileName } from "./ReportDownload";
import styles from "./warehouse.module.css";

type DeliveryCustomer = { invoice: string; jobId: string; etaDate: string; etaTime: string; remark: string; address: string };
type DeliveryRun = {
  deliveryDate: string;
  departureTime: string;
  deliveryPic: string;
  contactNumber: string;
  customers: DeliveryCustomer[];
};

const NAVY = "#1f3a5f";
const GREY = "#6b7280";
const BLUE = "#2b6cb0";
const LINE = "#d1d5db";

// "2026-11-14" -> "14/11/2026"
function dmy(iso: string): string {
  const m = iso.match(/^(\d{4})-(\d{2})-(\d{2})/);
  return m ? `${m[3]}/${m[2]}/${m[1]}` : iso;
}

// "15:00" -> "3PM", "12:30" -> "12.30PM"
function clock(value: string): string {
  const m = value.match(/^(\d{1,2}):(\d{2})/);
  if (!m) return value;
  const h = Number(m[1]);
  const suffix = h >= 12 ? "PM" : "AM";
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return m[2] === "00" ? `${h12}${suffix}` : `${h12}.${m[2]}${suffix}`;
}

const digits = (value: string) => value.replace(/\D/g, "");

function todayIso(): string {
  return new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Kuala_Lumpur" });
}

export function DeliveryOrderDialog({
  schedule,
  reference,
  lines,
  partQty,
  elecQty,
  onClose,
}: {
  schedule: StockOutScheduleData | undefined;
  reference: string;
  lines: StockOutLine[];
  partQty: Record<string, string>;
  elecQty: Record<string, string>;
  onClose: () => void;
}) {
  const invoice = schedule?.jobId ?? reference;

  // The job's delivery run (matched by invoice number), read from the Delivery Schedule.
  const [run, setRun] = useState<{ run: DeliveryRun; customer: DeliveryCustomer } | null>(null);
  useEffect(() => {
    const want = digits(invoice);
    if (!want) return;
    // Kept current with the Scheduling system while the page is open.
    return watchDeliveryRuns<DeliveryRun>((runs) => {
      // The latest run that carries this customer.
      const found = [...runs]
        .reverse()
        .map((r) => ({ run: r, customer: r.customers.find((c) => digits(c.invoice) === want) }))
        .find((x) => x.customer);
      setRun(found?.customer ? { run: found.run, customer: found.customer } : null);
    });
  }, [invoice]);

  // Quantities ("-" when none).
  const num = (value: string | undefined) => {
    const n = Number((value ?? "").trim());
    return Number.isFinite(n) && n > 0 ? n : 0;
  };
  const partSum = (...names: string[]) => names.reduce((sum, name) => sum + num(partQty[name]), 0);
  const show = (n: number) => (n > 0 ? String(n) : "-");
  // An electrical group: the part(s) with a quantity, e.g. Breaker -> "3P 32A", 1.
  const elec = (parts: string[], label: (part: string) => string = (p) => p) => {
    const used = parts.filter((part) => num(elecQty[part]) > 0);
    return {
      model: used.length ? used.map(label).join(", ") : "-",
      qty: show(used.reduce((sum, part) => sum + num(elecQty[part]), 0)),
    };
  };

  const panelQty = lines.filter((l) => l.category === "panel").reduce((sum, l) => sum + (l.qty ?? 0), 0);
  const inverterQty = lines.filter((l) => l.category === "inverter").reduce((sum, l) => sum + (l.qty ?? 0), 0);
  const phase = schedule?.tnbMeter === "Single phase" ? "Single Phase" : schedule?.tnbMeter === "Three phase" ? "Three Phase" : "";
  const inverterModel = schedule?.inverterModel && schedule.inverterModel !== "—" ? schedule.inverterModel : "-";

  const breaker = elec(["2P 32A", "2P 40A", "2P 63A", "3P 32A", "3P 40A", "3P 63A"]);
  const pvMeter = elec(["2P PV METER", "4P PV METER"], (p) => p.replace(/\s*PV METER/i, ""));
  const dbBox = elec(["8.5 WAY", "10.5 WAY", "15~19 WAY"]);
  const spd = elec(["2P SPD", "4P SPD"], (p) => p.replace(/\s*SPD/i, ""));
  const selco = elec(["SINGLE PHASE 80A", "THREE PHASE 100A", "THREE PHASE 250A"]);
  // Anything else entered (battery, ATS, ballast, EV charger, …) goes under Others.
  const otherNames = [
    "1*2 Landscape",
    "1*3 Landscape",
    "1*2 Portrait",
    "1*3 Portrait",
    "EV Wallbox 11kW",
    "EV Wallbox 7kW",
    "SAJ EK60-B3-16LV Battery",
    "ATS",
    "SINGLE PHASE 40A RCBO",
    "THREE PHASE 40A RCBO",
  ];
  const others = elec(otherNames);
  const trapezoid = partSum("Trapezoidal roof support");

  const items: { name: string; model: string; qty: string }[] = [
    { name: "Solar Panel", model: schedule?.panelPowerWatts ? `${schedule.panelPowerWatts}W` : "-", qty: show(panelQty) },
    { name: `Inverter${phase ? ` (${phase})` : ""}`, model: inverterModel, qty: show(inverterQty) },
    { name: "Tile Hook", model: "-", qty: show(partSum("Tile hook", "Tile hook (130mm)")) },
    { name: "Tile Hook (Landscape)", model: "-", qty: show(partSum("Tile hook (landscape)", "Tile hook landscape (130mm)")) },
    { name: "L-Bracket (Bolt & Nut)", model: "-", qty: show(partSum("L-feet", "L-bracket")) },
    { name: "Klip-Lok", model: "-", qty: show(partSum("Kliplock")) },
    { name: "L-Bracket (c/w screw)", model: "-", qty: show(partSum("L-feet c/w screw", "L-bracket c/w screw")) },
    { name: "Standing Seam Base Grip", model: "-", qty: show(partSum("Standing seam base grip")) },
    { name: "Hanger Bolt Kit", model: "-", qty: show(partSum("Hanger bolt kit")) },
    { name: "Earthing clip", model: "-", qty: show(partSum("Earthing clip")) },
    { name: "MID Clamp", model: "-", qty: show(partSum("Mid clamp")) },
    { name: "End Clamp", model: "-", qty: show(partSum("End clamp")) },
    { name: "Bolt & Nut", model: "-", qty: show(partSum("Bolt & nut")) },
    { name: "Rail Splice", model: "-", qty: show(partSum("Rail splice")) },
    { name: "Rail 3.6M", model: "-", qty: show(partSum("3.6M")) },
    { name: "Rail 2.4M", model: "-", qty: show(partSum("2.4M")) },
    { name: "Rail 1.2M", model: "-", qty: show(partSum("1.2M")) },
    { name: "Breaker", ...breaker },
    { name: "PV meter", ...pvMeter },
    { name: "DB Box", ...dbBox },
    { name: "SPD", ...spd },
    { name: "Smart Meter", ...selco },
    {
      name: "Others",
      model: [others.model !== "-" ? others.model : "", trapezoid ? "Trapezoidal roof support" : ""].filter(Boolean).join(", ") || "-",
      qty: show(num(others.qty) + trapezoid),
    },
  ];

  const name = (schedule?.customerName ?? "").replace(/\s*\(ATAP\)\s*/i, " ").trim();
  const atap = /\(ATAP\)/i.test(schedule?.customerName ?? "");
  const address = schedule?.customerAddress ?? "";
  const deliveryAddress = run?.customer.address || address;
  const today = dmy(todayIso());
  const doNo = `DO-${digits(invoice) || invoice}`;

  const label: React.CSSProperties = { color: GREY, padding: "3px 0", verticalAlign: "top", width: "110px" };
  const value: React.CSSProperties = { color: "#111", padding: "3px 0", verticalAlign: "top" };
  const big: React.CSSProperties = { ...value, fontWeight: 700, fontSize: "14px" };
  const section: React.CSSProperties = { fontWeight: 700, color: NAVY, fontSize: "14px", margin: "16px 0 6px" };
  const cell: React.CSSProperties = { border: `1px solid ${LINE}`, padding: "4px 8px" };
  const head: React.CSSProperties = { ...cell, fontWeight: 700, textAlign: "center", background: "#f9fafb" };
  const box = <span style={{ fontSize: "14px" }}>☐</span>;
  const input: React.CSSProperties = { border: "none", borderBottom: `1px dashed ${LINE}`, font: "inherit", color: "#111", width: "100%", background: "transparent", padding: 0 };

  return (
    <div className={styles.bankingReceiptBackdrop} onClick={onClose}>
      <div
        className={`${styles.transferReportCard} ${styles.a4Report}`}
        role="dialog"
        aria-modal="true"
        aria-label="Delivery order"
        onClick={(e) => e.stopPropagation()}
        style={{ fontFamily: "Arial, Helvetica, sans-serif", fontSize: "12px", color: "#111" }}
      >
        <div className={styles.transferReportHead}>
          <div style={{ display: "flex", gap: "8px", marginLeft: "auto" }}>
            <DownloadReportButton fileName={reportFileName(doNo, name)} onePage />
            <button type="button" className={styles.btnActionGhost} onClick={onClose}>
              Close
            </button>
          </div>
        </div>

        {/* Company and DO number */}
        <div style={{ display: "flex", justifyContent: "space-between", gap: "16px", borderBottom: `2px solid ${NAVY}`, paddingBottom: "10px" }}>
          <div>
            <div style={{ fontWeight: 700, color: NAVY, fontSize: "17px" }}>ETERNALGY SDN. BHD.</div>
            <div style={{ color: GREY, fontSize: "10.5px", marginTop: "2px" }}>
              23-01 JALAN MUTIARA EMAS 10/19 TAMAN MOUNT AUSTIN
              <br />
              81100 JOHOR BAHRU JOHOR MALAYSIA
            </div>
          </div>
          <div style={{ textAlign: "right" }}>
            <div style={{ color: GREY }}>Delivery Order</div>
            <div style={{ fontWeight: 700, color: NAVY, fontSize: "14px" }}>
              No. <span style={{ color: "#c53030" }}>{doNo}</span>
            </div>
          </div>
        </div>

        {/* A. Client information */}
        <div style={section}>A. CLIENT INFORMATION</div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1.4fr", gap: "16px" }}>
          <table style={{ borderCollapse: "collapse", width: "100%" }}>
            <tbody>
              <tr><td style={label}>Customer Name</td><td style={{ ...value, fontWeight: 700 }}>{name || "-"}</td></tr>
              <tr><td style={label}>Service Agent</td><td style={value}>{schedule?.agentName && schedule.agentName !== "—" ? schedule.agentName : "-"}</td></tr>
              <tr><td style={label}>Contact number</td><td style={big}>{schedule?.customerPhone || "-"}</td></tr>
              <tr><td style={label}>Property Type</td><td style={value}>{schedule?.commercial ? "Commercial" : "Residential"}</td></tr>
              <tr><td style={label}>Phase Type</td><td style={value}>{phase || "-"}</td></tr>
              <tr><td style={label}>System Type</td><td style={value}>{atap ? "ATAP" : "-"}</td></tr>
            </tbody>
          </table>
          <table style={{ borderCollapse: "collapse", width: "100%", borderLeft: `1px solid ${LINE}`, paddingLeft: "12px" }}>
            <tbody>
              <tr>
                <td style={{ ...label, paddingLeft: "12px", width: "130px" }}>Installation Date</td>
                <td style={{ ...value, fontWeight: 700 }}>{schedule?.scheduledDate ? dmy(schedule.scheduledDate) : "-"}</td>
              </tr>
              <tr>
                <td style={{ ...label, paddingLeft: "12px" }}>Installation Address</td>
                <td style={big}>{address ? address.toUpperCase() : "-"}</td>
              </tr>
              <tr>
                <td style={{ ...label, paddingLeft: "12px" }}>Delivery Address</td>
                <td style={big}>{deliveryAddress || "-"}</td>
              </tr>
              <tr>
                <td style={{ ...label, paddingLeft: "12px" }}>Remarks</td>
                <td style={{ ...value, whiteSpace: "pre-line" }}>
                  {/* Left empty to type in (not prefilled from the delivery run for now) */}
                  <input style={input} aria-label="Remarks" />
                </td>
              </tr>
            </tbody>
          </table>
        </div>

        {/* B. Delivery details */}
        <div style={section}>B. Delivery Details</div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "16px" }}>
          <table style={{ borderCollapse: "collapse", width: "100%" }}>
            <tbody>
              <tr>
                <td style={{ ...label, width: "140px" }}>Delivery Pick up</td>
                <td style={value}>{run ? `${dmy(run.run.deliveryDate)} @${clock(run.run.departureTime)}` : "-"}</td>
              </tr>
              <tr>
                <td style={label}>Delivery Date</td>
                <td style={value}>{run ? dmy(run.customer.etaDate || run.run.deliveryDate) : "-"}</td>
              </tr>
              <tr>
                <td style={label}>Delivery Time</td>
                <td style={value}>{run ? clock(run.customer.etaTime) : "-"}</td>
              </tr>
            </tbody>
          </table>
          <table style={{ borderCollapse: "collapse", width: "100%" }}>
            <tbody>
              <tr><td style={label}>Driver name</td><td style={value}>{run?.run.deliveryPic || "-"}</td></tr>
              <tr><td style={label}>Driver Phone</td><td style={value}>{run?.run.contactNumber || "-"}</td></tr>
              <tr>
                <td style={label}>Lorry no.</td>
                <td style={value}><input style={input} placeholder="Type lorry no." aria-label="Lorry no." /></td>
              </tr>
            </tbody>
          </table>
        </div>

        {/* Deliver items list */}
        <div style={{ ...section, color: "#111", fontSize: "13px" }}>Deliver Items List</div>
        <table style={{ borderCollapse: "collapse", width: "100%" }}>
          <thead>
            <tr>
              <th style={{ ...head, textAlign: "left" }}>Product Name</th>
              <th style={head}>Model / Spec</th>
              <th style={head}>Quantity</th>
              <th style={head}>Packer</th>
              <th style={head}>Driver</th>
              <th style={head}>Recipient</th>
            </tr>
          </thead>
          <tbody>
            {items.map((item, i) => (
              <tr key={item.name}>
                <td style={cell}>{i + 1}. {item.name}</td>
                <td style={{ ...cell, textAlign: "center", color: BLUE }}>{item.model}</td>
                <td style={{ ...cell, textAlign: "center", color: BLUE, fontWeight: 700 }}>{item.qty}</td>
                <td style={{ ...cell, textAlign: "center" }}>{box}</td>
                <td style={{ ...cell, textAlign: "center" }}>{box}</td>
                <td style={{ ...cell, textAlign: "center" }}>{box}</td>
              </tr>
            ))}
          </tbody>
        </table>

        {/* Material Planner / Warehouse Manager */}
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "16px", marginTop: "10px" }}>
          <table style={{ borderCollapse: "collapse", width: "100%" }}>
            <tbody>
              <tr>
                <td style={{ ...label, width: "140px" }}>Material Planner</td>
                <td style={{ ...value, fontWeight: 700 }}><input style={{ ...input, fontWeight: 700 }} aria-label="Material Planner" /></td>
              </tr>
              <tr><td style={label}>Date</td><td style={value}>{today}</td></tr>
            </tbody>
          </table>
          <table style={{ borderCollapse: "collapse", width: "100%" }}>
            <tbody>
              <tr>
                <td style={{ ...label, width: "140px" }}>Warehouse Manager</td>
                <td style={{ ...value, fontWeight: 700 }}><input style={{ ...input, fontWeight: 700 }} aria-label="Warehouse Manager" /></td>
              </tr>
              <tr><td style={label}>Date</td><td style={value}>{today}</td></tr>
            </tbody>
          </table>
        </div>

        {/* Acknowledgement */}
        <div style={{ ...section, color: "#111", fontSize: "13px" }}>Acknowledgement</div>
        <table style={{ borderCollapse: "collapse", width: "100%", tableLayout: "fixed" }}>
          <thead>
            <tr>
              <th style={head}>Packer</th>
              <th style={head}>Checker</th>
              <th style={head}>Deliver</th>
              <th style={head}>
                Recipient
                {/* On its own line, smaller, so it stays inside the column */}
                <span style={{ display: "block", fontWeight: 400, fontSize: "9px", lineHeight: 1.2, whiteSpace: "normal", overflowWrap: "anywhere" }}>
                  (Company Stamp if applicable)
                </span>
              </th>
            </tr>
          </thead>
          <tbody>
            {["Sign:", "Name:", "Date:"].map((row) => (
              <tr key={row}>
                {[0, 1, 2, 3].map((n) => (
                  <td key={n} style={{ ...cell, height: row === "Sign:" ? "34px" : undefined, verticalAlign: "top" }}>
                    {row}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
        <p style={{ color: GREY, fontSize: "10.5px", marginTop: "10px" }}>
          This delivery note serves as proof of delivery. Please check and sign upon receipt.
        </p>
      </div>
    </div>
  );
}
