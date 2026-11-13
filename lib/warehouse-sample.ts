// Figures taken from the ESAJ inverter stock book (current stock, pending
// install, outstanding order). To-order quantity is
// pending install − current stock − outstanding order, when that is above zero.
// Panel and battery have no matching on-hand total in the sample sheets.

export type WarehouseNoticeKind = "order" | "stockIn" | "faulty" | "install";

export type WarehouseNotice = {
  id: string;
  kind: WarehouseNoticeKind;
  warehouse: "JB" | "KL";
  // "now", "2h", or the install date for install notices.
  time: string;
  // Quantity × model, or the customer and kit for install notices.
  title: string;
  // Panel, Inverter, Battery or Other. Left out when the title already lists the kit.
  category?: string;
  // What is happening and what to do next.
  detail: string;
};

export type WarehouseCustomer = {
  name: string;
  qty: number;
  cover: "On hand" | "Short";
};

export type WarehouseModel = {
  id: string;
  code: string;
  inverterType: "string" | "hybrid" | "micro";
  onHand: number;
  pending: number;
  onOrder: number;
  orderQty: number;
  customers: WarehouseCustomer[];
};

export type StockCard = {
  id: "inverter" | "panel" | "battery";
  label: string;
  onHand: number | null;
  toInstall: number | null;
  toBuy: number | null;
};

export type SystemTrend = {
  month: string;
  sales: number;
  install: number;
  target: number;
};

// Sample notices for the sign-in screen. All dummy: one of each kind per warehouse.
export const WAREHOUSE_NOTICES: WarehouseNotice[] = [
  {
    id: "order-r5-7",
    kind: "order",
    warehouse: "JB",
    time: "now",
    title: "20 × R5-7K-S2",
    category: "Inverter",
    detail: "2 left, 22 to install. Order by 30 Sep.",
  },
  {
    id: "stockin-jkm650",
    kind: "stockIn",
    warehouse: "KL",
    time: "1h",
    title: "300 × Jinko 650W",
    category: "Panel",
    detail: "Received from supplier. KL now has 355.",
  },
  {
    id: "faulty-h2-8k",
    kind: "faulty",
    warehouse: "JB",
    time: "3h",
    title: "2 × H2-8K-LT2",
    category: "Inverter",
    detail: "Won't power on. Return to supplier (RMA).",
  },
  {
    id: "install-tan",
    kind: "install",
    warehouse: "KL",
    time: "29 Sep",
    title: "Tan Residence: 14 panels, 1 inverter",
    detail: "Jinko 620W + H2-10K-LT2. All in stock ✓",
  },
  {
    id: "order-jkm620",
    kind: "order",
    warehouse: "KL",
    time: "2h",
    title: "120 × Jinko 620W",
    category: "Panel",
    detail: "40 left, 160 booked for October.",
  },
  {
    id: "stockin-b3-16",
    kind: "stockIn",
    warehouse: "JB",
    time: "today",
    title: "10 × B3-16.0-LV",
    category: "Battery",
    detail: "Delivery DO-2291 checked and shelved.",
  },
  {
    id: "faulty-astr625",
    kind: "faulty",
    warehouse: "KL",
    time: "yesterday",
    title: "4 × Astronergy 625W",
    category: "Panel",
    detail: "Cracked glass found on unloading.",
  },
  {
    id: "install-lim",
    kind: "install",
    warehouse: "JB",
    time: "1 Oct",
    title: "Lim Enterprise: 1 × ATS Three Phase",
    category: "Other",
    detail: "Short 1. Transfer from KL.",
  },
];

// Dummy totals: the sum of the inverter types below, Hybrid included.
export const INVERTER_ON_HAND = 442;
export const INVERTER_PENDING = 365;
export const INVERTER_TO_BUY = 48;

export type InverterTypeId = "string" | "hybrid" | "micro";

export const INVERTER_TYPES: Array<{
  id: InverterTypeId;
  label: string;
  onHand: number | null;
  toInstall: number | null;
  toBuy: number | null;
}> = [
  { id: "string", label: "String", onHand: 245, toInstall: 288, toBuy: 39 },
  { id: "hybrid", label: "Hybrid", onHand: 60, toInstall: 45, toBuy: 0 }, // dummy
  { id: "micro", label: "Micro", onHand: 137, toInstall: 32, toBuy: 9 },
];

export const STOCK_CARDS: StockCard[] = [
  { id: "inverter", label: "Inverter", onHand: INVERTER_ON_HAND, toInstall: INVERTER_PENDING, toBuy: INVERTER_TO_BUY },
  { id: "panel", label: "Panel", onHand: 1850, toInstall: 1420, toBuy: 120 }, // dummy
  { id: "battery", label: "Battery", onHand: 143, toInstall: 118, toBuy: 15 }, // dummy; on hand matches the battery table (95 JB + 48 KL)
];

// Draft monthly counts for the landing chart. Systems, not ringgit.
// Replace with a full count from Post Sales once that sheet is totaled.
export const SYSTEM_TREND: SystemTrend[] = [
  { month: "May", sales: 22, install: 14, target: 25 },
  { month: "Jun", sales: 26, install: 18, target: 25 },
  { month: "Jul", sales: 19, install: 21, target: 25 },
  { month: "Aug", sales: 31, install: 17, target: 30 },
  { month: "Sep", sales: 28, install: 12, target: 30 },
];

// Customer names are the first rows on the R5-7K-S2 column. The sheet's
// pending total is 22, so this is not the full list.
export const ORDER_MODELS: WarehouseModel[] = [
  {
    id: "r5-7",
    code: "R5-7K-S2",
    inverterType: "string",
    onHand: 2,
    pending: 22,
    onOrder: 0,
    orderQty: 20,
    customers: [
      { name: "Lok Suet Lee", qty: 1, cover: "On hand" },
      { name: "Lim Kok Siang", qty: 1, cover: "On hand" },
      { name: "Chee Chin Fou", qty: 1, cover: "Short" },
      { name: "Woo Pek Lai", qty: 1, cover: "Short" },
    ],
  },
  {
    id: "m2",
    code: "M2-1.8K-S4",
    inverterType: "micro",
    onHand: 14,
    pending: 23,
    onOrder: 0,
    orderQty: 9,
    customers: [],
  },
  {
    id: "r5-6",
    code: "R5-6K-S2",
    inverterType: "string",
    onHand: 4,
    pending: 12,
    onOrder: 0,
    orderQty: 8,
    customers: [],
  },
  {
    id: "r6-8",
    code: "R6-8K-T2",
    inverterType: "string",
    onHand: 3,
    pending: 41,
    onOrder: 30,
    orderQty: 8,
    customers: [],
  },
  {
    id: "c6",
    code: "C6-100K-T9",
    inverterType: "string",
    onHand: 2,
    pending: 6,
    onOrder: 2,
    orderQty: 2,
    customers: [],
  },
  {
    id: "r6-20",
    code: "R6-20K-T2-32",
    inverterType: "string",
    onHand: 3,
    pending: 9,
    onOrder: 5,
    orderQty: 1,
    customers: [],
  },
];

// ── Stock Details page data ────────────────────────────────────────────

export type StockDetailItem = {
  id: string;
  category: "panel" | "inverter" | "battery" | "other";
  // Sub-heading inside a table, e.g. "ATS" or "EV Charger".
  group?: string;
  model: string;
  serialCode: string;
  warehouse: "JB" | "KL";
  qty: number;
  highlight?: boolean;
};

// ── Stock Balance & Transaction Log ────────────────────────────────────

export type CategoryStockBalance = {
  id: "inverter" | "panel" | "battery" | "mounting" | "electrical" | "special";
  label: string;
  // null = no real count yet (shown as "—").
  onHand: number | null;
  toInstall: number;
  available: number;
  toBuy: number;
};

export const WAREHOUSE_BALANCES: Record<"all" | "JB" | "KL", CategoryStockBalance[]> = {
  all: [
    { id: "panel", label: "Panel", onHand: 770, toInstall: 620, available: 150, toBuy: 0 },
    { id: "inverter", label: "Inverter", onHand: 442, toInstall: 365, available: 77, toBuy: 48 },
    { id: "battery", label: "Battery", onHand: 143, toInstall: 118, available: 25, toBuy: 15 },
    { id: "mounting", label: "Mounting Structure", onHand: null, toInstall: 0, available: 0, toBuy: 0 },
    { id: "electrical", label: "Electrical Item", onHand: null, toInstall: 0, available: 0, toBuy: 0 },
    // Commercial jobs' special materials (trunking, jointers, cable gland, metal DB box).
    { id: "special", label: "Special Material", onHand: null, toInstall: 0, available: 0, toBuy: 0 },
  ],
  JB: [
    { id: "panel", label: "Panel", onHand: 450, toInstall: 380, available: 70, toBuy: 0 },
    { id: "inverter", label: "Inverter", onHand: 245, toInstall: 210, available: 35, toBuy: 30 },
    { id: "battery", label: "Battery", onHand: 95, toInstall: 80, available: 15, toBuy: 10 },
    { id: "mounting", label: "Mounting Structure", onHand: null, toInstall: 0, available: 0, toBuy: 0 },
    { id: "electrical", label: "Electrical Item", onHand: null, toInstall: 0, available: 0, toBuy: 0 },
    // Commercial jobs' special materials (trunking, jointers, cable gland, metal DB box).
    { id: "special", label: "Special Material", onHand: null, toInstall: 0, available: 0, toBuy: 0 },
  ],
  KL: [
    { id: "panel", label: "Panel", onHand: 320, toInstall: 240, available: 80, toBuy: 0 },
    { id: "inverter", label: "Inverter", onHand: 197, toInstall: 155, available: 42, toBuy: 18 },
    { id: "battery", label: "Battery", onHand: 48, toInstall: 38, available: 10, toBuy: 5 },
    { id: "mounting", label: "Mounting Structure", onHand: null, toInstall: 0, available: 0, toBuy: 0 },
    { id: "electrical", label: "Electrical Item", onHand: null, toInstall: 0, available: 0, toBuy: 0 },
    // Commercial jobs' special materials (trunking, jointers, cable gland, metal DB box).
    { id: "special", label: "Special Material", onHand: null, toInstall: 0, available: 0, toBuy: 0 },
  ],
};

export type StockTransactionType = "in" | "out" | "transfer";

export type StockTransactionStatus = "To Verify" | "Inspected" | "Verified";

export type StockInInvoiceItem = {
  skuId: string;
  model: string;
  description: string;
  category: "panel" | "inverter" | "battery" | "other";
  invoicedQty: number;
  unit: string;
  barcode: string;
  palletBarcode?: string;
  palletQty?: number;
  sampleSerials?: string[];
  unitPrice?: string;
};

export type StockInInvoiceData = {
  invoiceNo: string;
  invoiceDate: string;
  expectedDelivery: string;
  poNumber: string;
  supplierName: string;
  items: StockInInvoiceItem[];
  palletCount?: number;
  unitPrice?: string;
  notes?: string;
  invoicedQty?: number;
  receivedQty?: number;
};

export type SupplierSerialUnit = {
  serialNo: string;
  palletNo: number;
  palletBarcode: string;
  skuId: string;
  model: string;
  flashPowerWatts?: number;
  vmp?: number;
  imp?: number;
};

export type StockOutScheduleData = {
  // True when copied from the real scheduling system (not sample data).
  live?: boolean;
  jobId: string;
  customerName: string;
  customerPhone?: string;
  customerAddress?: string;
  scheduledDate: string;
  installerTeam: string;
  systemPackage?: string;
  allocatedQty: number;
  dispatchedQty: number;
  notes?: string;
  systemSizeKwp?: string;
  dcAcRatio?: string;
  systemPrice?: string;
  panelBrand?: string;
  noOfPanel?: number;
  panelPowerWatts?: number;
  inverterBrand?: string;
  inverterNo?: string;
  inverterSize?: string;
  totalInverterPower?: string;
  payment?: string;
  sedaStatus?: string;
  insuranceAppliedDate?: string;
  agentName?: string;
  // NEM (net energy metering) application. The scheduling system does not carry
  // these yet, so they stay empty and show as "—" until a source exists.
  // Source invoice id, used to load the job's drawings on demand.
  jobSourceId?: string;
  // Commercial job (Tariff B package or a Selco customer): stock out adds the
  // commercial special materials list.
  commercial?: boolean;
  // TNB meter type (Single phase / Three phase) and the inverter model, shown under Customer Details.
  tnbMeter?: string;
  inverterModel?: string;
  nemApplicationNo?: string;
  nemStatus?: string;
  nemApplicationDate?: string;
  nemApprovalDate?: string;
  tnbAccountNo?: string;
};

export type StockTransferData = {
  transferNo: string;
  fromWarehouse: "JB" | "KL";
  toWarehouse: "JB" | "KL";
  requestedBy: string;
  driverName?: string;
  vehiclePlate?: string;
  dispatchedDate?: string;
  receivedDate?: string;
  dispatchedQty: number;
  receivedQty: number;
  notes?: string;
};

// One material line inside a customer's dispatch. Panels, inverters and batteries
// carry serial numbers and are verified by scanning; mounting structure and
// electrical accessories are bulk items, verified by checking them off.
export type StockOutLine = {
  category: "panel" | "inverter" | "battery" | "mounting" | "electrical";
  model: string;
  // null = quantity not known (bulk items have no bill of materials yet).
  qty: number | null;
  serialised: boolean;
  serialCode?: string;
};

export type StockTransaction = {
  id: string;
  time: string;
  type: StockTransactionType;
  category: "panel" | "inverter" | "battery" | "mounting" | "electrical" | "other";
  model: string;
  serialCode: string;
  qty: number;
  warehouse: "JB" | "KL";
  reference: string;
  party: string;
  status: StockTransactionStatus;
  issueRemark?: string;
  invoice?: StockInInvoiceData;
  schedule?: StockOutScheduleData;
  transfer?: StockTransferData;
  // A stock out is one customer's job; its materials are listed here.
  lines?: StockOutLine[];
};

export const STOCK_TRANSACTIONS: StockTransaction[] = [];

// Individual stock items — each row is one model in one warehouse.
// Inverter qty totals match INVERTER_ON_HAND (442).
export const STOCK_DETAIL_ITEMS: StockDetailItem[] = [];

// ── Stock by Customer page data ────────────────────────────────────────



export function generateSupplierSerialList(tx: StockTransaction): SupplierSerialUnit[] {
  const invoice = tx.invoice;
  const items = invoice?.items ?? [];
  const list: SupplierSerialUnit[] = [];

  if (tx.id === "tx-1" || (items.length > 0 && items[0].invoicedQty === 300)) {
    const item = items[0] || {
      skuId: "JKM-620N-72HL4-BDV",
      model: "Jinko Tiger Neo 620W N-Type",
    };
    for (let p = 1; p <= 10; p++) {
      const palletCode = `PAL-JKM-${String(p).padStart(3, "0")}`;
      for (let u = 1; u <= 30; u++) {
        const unitIndex = (p - 1) * 30 + u;
        const serialNo = `E4FXJ425G21750719612${String(unitIndex).padStart(4, "0")}`;
        const flashWatts = +(620.0 + ((unitIndex * 7) % 38) * 0.1).toFixed(1);
        list.push({
          serialNo,
          palletNo: p,
          palletBarcode: palletCode,
          skuId: item.skuId,
          model: item.model,
          flashPowerWatts: flashWatts,
          vmp: +(41.8 + ((unitIndex * 3) % 15) * 0.05).toFixed(2),
          imp: +(14.7 + ((unitIndex * 5) % 12) * 0.02).toFixed(2),
        });
      }
    }
    return list;
  }

  // Generic fallback for other transactions
  items.forEach((item) => {
    const palletSize = item.palletQty || 5;
    for (let i = 1; i <= item.invoicedQty; i++) {
      const pNum = Math.ceil(i / palletSize);
      const palletCode = item.palletBarcode
        ? `${item.palletBarcode.replace(/\d+$/, "")}${String(pNum).padStart(2, "0")}`
        : `PLT-${item.skuId.slice(-4)}-${pNum}`;
      const prefix =
        item.barcode && item.barcode.length >= 10
          ? item.barcode.slice(0, 14)
          : `${item.skuId.replace(/[^A-Z0-9]/g, "")}`;
      list.push({
        serialNo: `${prefix}${String(i).padStart(4, "0")}`,
        palletNo: pNum,
        palletBarcode: palletCode,
        skuId: item.skuId,
        model: item.model,
      });
    }
  });

  return list;
}

// ── Stock Out Dispatch Unit Serial Generation ─────────────────────────

export interface StockOutUnit {
  serialNo: string;
  model: string;
  unitIndex: number;
  category: "panel" | "inverter" | "battery" | "mounting" | "electrical" | "other";
  powerRating: string;
  powerWatts: number;
}

export function generateStockOutSerialList(tx: StockTransaction): StockOutUnit[] {
  const list: StockOutUnit[] = [];
  const qty = tx.qty || 1;
  const baseSerial = tx.serialCode || "SN-OUT-001";
  const cat = tx.category;

  let powerWatts = 620;
  let powerRating = "620W";
  if (cat === "panel") {
    if (tx.model.includes("625")) {
      powerWatts = 625;
      powerRating = "625W";
    } else {
      powerWatts = 620;
      powerRating = "620W";
    }
  } else if (cat === "inverter") {
    if (tx.model.includes("7")) {
      powerWatts = 7000;
      powerRating = "7.0 kW";
    } else if (tx.model.includes("8")) {
      powerWatts = 8000;
      powerRating = "8.0 kW";
    } else if (tx.model.includes("1.8") || tx.model.includes("M2")) {
      powerWatts = 1800;
      powerRating = "1.8 kW";
    } else {
      powerWatts = 5000;
      powerRating = "5.0 kW";
    }
  } else if (cat === "battery") {
    if (tx.model.includes("16")) {
      powerWatts = 16000;
      powerRating = "16.0 kWh";
    } else {
      powerWatts = 5000;
      powerRating = "5.0 kWh";
    }
  }

  for (let i = 1; i <= qty; i++) {
    let serialNo = baseSerial;
    if (qty > 1) {
      if (baseSerial.length > 6 && !isNaN(Number(baseSerial.slice(-3)))) {
        const numPart = parseInt(baseSerial.slice(-3), 10);
        const prefix = baseSerial.slice(0, -3);
        serialNo = `${prefix}${String(numPart + i - 1).padStart(3, "0")}`;
      } else {
        serialNo = `${baseSerial}-${String(i).padStart(2, "0")}`;
      }
    }
    list.push({
      serialNo,
      model: tx.model,
      unitIndex: i,
      category: cat,
      powerRating,
      powerWatts,
    });
  }

  return list;
}

export type StockTransferUnit = {
  serialNo: string;
  model: string;
  unitIndex: number;
  category: "panel" | "inverter" | "battery" | "mounting" | "electrical" | "other";
  powerRating: string;
  powerWatts: number;
  palletNo: number;
  palletBarcode: string;
  fromWarehouse: "JB" | "KL";
  toWarehouse: "JB" | "KL";
};

export function generateStockTransferSerialList(tx: StockTransaction): StockTransferUnit[] {
  const list: StockTransferUnit[] = [];
  const qty = tx.qty || 1;
  const baseSerial = tx.serialCode || "SN-TRF-001";
  const cat = tx.category;
  const fromWh = tx.transfer?.fromWarehouse ?? (tx.warehouse || "JB");
  const toWh = tx.transfer?.toWarehouse ?? (fromWh === "JB" ? "KL" : "JB");

  let powerWatts = 620;
  let powerRating = "620W";
  if (cat === "panel") {
    if (tx.model.includes("625")) {
      powerWatts = 625;
      powerRating = "625W";
    } else {
      powerWatts = 620;
      powerRating = "620W";
    }
  } else if (cat === "inverter") {
    if (tx.model.includes("7")) {
      powerWatts = 7000;
      powerRating = "7.0 kW";
    } else if (tx.model.includes("8")) {
      powerWatts = 8000;
      powerRating = "8.0 kW";
    } else if (tx.model.includes("1.8") || tx.model.includes("M2")) {
      powerWatts = 1800;
      powerRating = "1.8 kW";
    } else {
      powerWatts = 5000;
      powerRating = "5.0 kW";
    }
  } else if (cat === "battery") {
    powerWatts = 16000;
    powerRating = "16.0 kWh";
  }

  for (let i = 1; i <= qty; i++) {
    const palletNo = Math.ceil(i / 5);
    const palletBarcode = `TRF-CTN-${fromWh}-${String(palletNo).padStart(2, "0")}`;
    let serialNo = "";
    if (baseSerial.length >= 10 && !isNaN(Number(baseSerial.slice(-4)))) {
      const numPart = parseInt(baseSerial.slice(-4), 10);
      const prefix = baseSerial.slice(0, -4);
      serialNo = `${prefix}${String(numPart + i - 1).padStart(4, "0")}`;
    } else if (baseSerial.length >= 7 && !isNaN(Number(baseSerial.slice(-3)))) {
      const numPart = parseInt(baseSerial.slice(-3), 10);
      const prefix = baseSerial.slice(0, -3);
      serialNo = `${prefix}${String(numPart + i - 1).padStart(3, "0")}`;
    } else {
      serialNo = `${baseSerial}-${String(i).padStart(2, "0")}`;
    }

    list.push({
      serialNo,
      model: tx.model,
      unitIndex: i,
      category: cat,
      powerRating,
      powerWatts,
      palletNo,
      palletBarcode,
      fromWarehouse: fromWh,
      toWarehouse: toWh,
    });
  }

  return list;
}

// ── Mounting structure: the two systems in use ─────────────────────────
// Part lists copied from the ops team's "Mounting Structure Record" sheets
// (MIBET and WINSTAR). The sheets' stock quantities have not been loaded yet,
// so every part carries no quantity (null) rather than an invented number.

export type MountingPart = {
  name: string;
  // Stock on hand per warehouse; null until the real figures are loaded.
  jb: number | null;
  kl: number | null;
};

export type MountingPartGroup = {
  label: string;
  parts: MountingPart[];
};

export type MountingSystem = {
  id: "mibet" | "winstar";
  label: string;
  groups: MountingPartGroup[];
};

function mountingParts(names: string[]): MountingPart[] {
  return names.map((name) => ({ name, jb: null, kl: null }));
}

// The electrical accessories the warehouse loads, from the staff's electric item sheet.
export const ELECTRICAL_GROUPS: { label: string; parts: string[] }[] = [
  { label: "Breaker", parts: ["2P 32A", "2P 40A", "2P 63A", "3P 32A", "3P 40A", "3P 63A"] },
  { label: "PV Meter", parts: ["2P PV METER", "4P PV METER"] },
  { label: "DB Box", parts: ["8.5 WAY", "10.5 WAY", "15~19 WAY"] },
  { label: "SPD", parts: ["2P SPD", "4P SPD"] },
  { label: "Ballast", parts: ["1*2 Landscape", "1*3 Landscape", "1*2 Portrait", "1*3 Portrait"] },
  { label: "EV Charger", parts: ["EV Wallbox 11kW", "EV Wallbox 7kW"] },
  { label: "Battery", parts: ["SAJ EK60-B3-16LV Battery", "ATS"] },
  { label: "Selco Meter", parts: ["SINGLE PHASE 80A", "THREE PHASE 100A", "THREE PHASE 250A"] },
  { label: "EV Charger Breaker", parts: ["SINGLE PHASE 40A RCBO", "THREE PHASE 40A RCBO"] },
];

// Commercial jobs only: extra materials entered on stock out (from the staff sheet).
// Part names carry their group so each one is its own saved quantity.
export const COMMERCIAL_GROUPS: { label: string; parts: string[] }[] = [
  {
    label: "Metal Trunking (Orange)",
    parts: ["Metal Trunking (Orange) 2x2", "Metal Trunking (Orange) 2x3", "Metal Trunking (Orange) 2x4"],
  },
  {
    label: "Trunking Jointer (Orange)",
    parts: ["Trunking Jointer (Orange) 2x2", "Trunking Jointer (Orange) 2x3", "Trunking Jointer (Orange) 2x4"],
  },
  { label: "HDG", parts: ["HDG 2x2", "HDG 2x3", "HDG 2x4"] },
  {
    label: "Trunking Jointer (HDG)",
    parts: ["Trunking Jointer (HDG) 2x2", "Trunking Jointer (HDG) 2x3", "Trunking Jointer (HDG) 2x4"],
  },
  { label: "Cable Gland (HDG)", parts: ["Cable Gland (HDG)"] },
  { label: "DB Box (Metal for Selco)", parts: ["DB Box (Metal for Selco) 15~19"] },
];

export const MOUNTING_SYSTEMS: MountingSystem[] = [
  {
    id: "mibet",
    label: "MIBET",
    groups: [
      { label: "Rail", parts: mountingParts(["Rail splice", "3.6M", "2.4M"]) },
      {
        label: "Hook & Bracket",
        parts: mountingParts([
          "Tile hook",
          "Tile hook (130mm)",
          "Tile hook (landscape)",
          "Tile hook landscape (130mm)",
          "L-feet",
          "Kliplock",
          "Standing seam base grip",
          "Trapezoidal roof support",
          "Hanger bolt kit",
          "L-feet c/w screw",
        ]),
      },
      { label: "Clamp", parts: mountingParts(["Mid clamp", "Earthing clip", "End clamp", "Bolt & nut"]) },
    ],
  },
  {
    id: "winstar",
    label: "WINSTAR",
    groups: [
      { label: "Rail", parts: mountingParts(["3.6M", "2.4M", "Rail splice"]) },
      {
        label: "Hook & Bracket",
        parts: mountingParts([
          "Tile hook",
          "Tile hook (landscape)",
          "L-bracket",
          "Kliplock",
          "Standing seam base grip",
          "L-bracket c/w screw",
        ]),
      },
      { label: "Clamp", parts: mountingParts(["Mid clamp", "Earthing clip", "End clamp", "Bolt & nut"]) },
    ],
  },
];
