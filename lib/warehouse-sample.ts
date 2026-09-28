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

export type WarehouseStockSummary = {
  warehouse: string;
  panels: number;
  inverters: number;
  batteries: number;
};

export type StockModelTrendPoint = {
  month: string;
  panels: number;
  inverters: number;
  batteries: number;
};

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

// Current stock totals by warehouse. Panel and battery totals are
// estimates — the source sheet only has a full count for inverters.
export const WAREHOUSE_STOCK_SUMMARY: WarehouseStockSummary[] = [
  { warehouse: "JB", panels: 450, inverters: 245, batteries: 95 },
  { warehouse: "KL", panels: 320, inverters: 197, batteries: 48 },
];

// End-of-month stock levels across all warehouses. Gives a sense
// of whether inventory is building or depleting.
export const STOCK_MODEL_TREND: StockModelTrendPoint[] = [
  { month: "May", panels: 620, inverters: 340, batteries: 110 },
  { month: "Jun", panels: 580, inverters: 360, batteries: 125 },
  { month: "Jul", panels: 710, inverters: 390, batteries: 130 },
  { month: "Aug", panels: 800, inverters: 410, batteries: 150 },
  { month: "Sep", panels: 770, inverters: 442, batteries: 143 },
];

// Individual stock items — each row is one model in one warehouse.
// Inverter qty totals match INVERTER_ON_HAND (442).
export const STOCK_DETAIL_ITEMS: StockDetailItem[] = [
  // ── Panels ── (dummy; highlighted rows are the priority models. Serials follow
  // the format of a real panel serial, E4FXJ425G217507196111636.)
  { id: "p1", category: "panel", model: "Jinko 620W", serialCode: "E4FXJ425G217507196111636", warehouse: "JB", qty: 90, highlight: true },
  { id: "p2", category: "panel", model: "Jinko 620W", serialCode: "E4FXJ425G217507196111636", warehouse: "KL", qty: 65, highlight: true },
  { id: "p3", category: "panel", model: "Jinko 650W", serialCode: "E4FXJ425G217507196124815", warehouse: "JB", qty: 80, highlight: true },
  { id: "p4", category: "panel", model: "Jinko 650W", serialCode: "E4FXJ425G217507196124815", warehouse: "KL", qty: 55, highlight: true },
  { id: "p5", category: "panel", model: "Astronergy 625W", serialCode: "E4FXJ425G217507196137402", warehouse: "JB", qty: 70, highlight: true },
  { id: "p6", category: "panel", model: "Astronergy 625W", serialCode: "E4FXJ425G217507196137402", warehouse: "KL", qty: 50, highlight: true },
  { id: "p7", category: "panel", model: "Jinko 575W", serialCode: "E4FXJ425G217507196140958", warehouse: "JB", qty: 60 },
  { id: "p8", category: "panel", model: "Jinko 575W", serialCode: "E4FXJ425G217507196140958", warehouse: "KL", qty: 45 },
  { id: "p9", category: "panel", model: "Jinko 585W", serialCode: "E4FXJ425G217507196152371", warehouse: "JB", qty: 55 },
  { id: "p10", category: "panel", model: "Jinko 585W", serialCode: "E4FXJ425G217507196152371", warehouse: "KL", qty: 40 },
  { id: "p11", category: "panel", model: "Astronergy 580W", serialCode: "E4FXJ425G217507196168024", warehouse: "JB", qty: 50 },
  { id: "p12", category: "panel", model: "Astronergy 580W", serialCode: "E4FXJ425G217507196168024", warehouse: "KL", qty: 35 },
  { id: "p13", category: "panel", model: "Jinko 590W", serialCode: "E4FXJ425G217507196179563", warehouse: "JB", qty: 45 },
  { id: "p14", category: "panel", model: "Jinko 590W", serialCode: "E4FXJ425G217507196179563", warehouse: "KL", qty: 30 },
  // ── Inverters ── (serials are dummy, in the format of a real inverter serial,
  // HDT2103J2613ESA06996.)
  { id: "i1", category: "inverter", model: "R5-7K-S2", serialCode: "HDT2103J2613ESA06996", warehouse: "JB", qty: 2 },
  { id: "i2", category: "inverter", model: "R5-6K-S2", serialCode: "HDT2103J2613ESA07133", warehouse: "JB", qty: 4 },
  { id: "i3", category: "inverter", model: "R5-6K-S2", serialCode: "HDT2103J2613ESA07133", warehouse: "KL", qty: 8 },
  { id: "i4", category: "inverter", model: "R6-8K-T2", serialCode: "HDT2103J2613ESA07270", warehouse: "JB", qty: 3 },
  { id: "i5", category: "inverter", model: "R6-8K-T2", serialCode: "HDT2103J2613ESA07270", warehouse: "KL", qty: 6 },
  { id: "i6", category: "inverter", model: "M2-1.8K-S4", serialCode: "HDT2103J2613ESA07407", warehouse: "JB", qty: 80 },
  { id: "i7", category: "inverter", model: "M2-1.8K-S4", serialCode: "HDT2103J2613ESA07407", warehouse: "KL", qty: 57 },
  { id: "i8", category: "inverter", model: "C6-100K-T9", serialCode: "HDT2103J2613ESA07544", warehouse: "JB", qty: 2 },
  { id: "i9", category: "inverter", model: "R6-20K-T2-32", serialCode: "HDT2103J2613ESA07681", warehouse: "JB", qty: 3 },
  { id: "i10", category: "inverter", model: "R6-20K-T2-32", serialCode: "HDT2103J2613ESA07681", warehouse: "KL", qty: 2 },
  { id: "i11", category: "inverter", model: "R6-15K-T2-32", serialCode: "HDT2103J2613ESA07818", warehouse: "JB", qty: 15 },
  { id: "i12", category: "inverter", model: "R6-15K-T2-32", serialCode: "HDT2103J2613ESA07818", warehouse: "KL", qty: 18 },
  { id: "i13", category: "inverter", model: "R5-5K-S2", serialCode: "HDT2103J2613ESA07955", warehouse: "JB", qty: 45 },
  { id: "i14", category: "inverter", model: "R5-5K-S2", serialCode: "HDT2103J2613ESA07955", warehouse: "KL", qty: 38 },
  { id: "i15", category: "inverter", model: "R5-8K-S2", serialCode: "HDT2103J2613ESA08092", warehouse: "JB", qty: 38 },
  { id: "i16", category: "inverter", model: "R5-8K-S2", serialCode: "HDT2103J2613ESA08092", warehouse: "KL", qty: 30 },
  { id: "i17", category: "inverter", model: "R6-10K-T2", serialCode: "HDT2103J2613ESA08229", warehouse: "JB", qty: 18 },
  { id: "i18", category: "inverter", model: "R6-10K-T2", serialCode: "HDT2103J2613ESA08229", warehouse: "KL", qty: 13 },
  // Hybrid (H2) rows are dummy; they make up the 60 Hybrid units in INVERTER_TYPES.
  { id: "i19", category: "inverter", model: "H2-5K-LS2", serialCode: "HDT2103J2613ESA08366", warehouse: "JB", qty: 10 },
  { id: "i20", category: "inverter", model: "H2-5K-LS2", serialCode: "HDT2103J2613ESA08366", warehouse: "KL", qty: 8 },
  { id: "i21", category: "inverter", model: "H2-8K-LT2", serialCode: "HDT2103J2613ESA08503", warehouse: "JB", qty: 8 },
  { id: "i22", category: "inverter", model: "H2-8K-LT2", serialCode: "HDT2103J2613ESA08503", warehouse: "KL", qty: 6 },
  { id: "i23", category: "inverter", model: "H2-10K-LT2", serialCode: "HDT2103J2613ESA08640", warehouse: "JB", qty: 7 },
  { id: "i24", category: "inverter", model: "H2-10K-LT2", serialCode: "HDT2103J2613ESA08640", warehouse: "KL", qty: 5 },
  { id: "i25", category: "inverter", model: "H2-25K-T3", serialCode: "HDT2103J2613ESA08777", warehouse: "JB", qty: 5 },
  { id: "i26", category: "inverter", model: "H2-25K-T3", serialCode: "HDT2103J2613ESA08777", warehouse: "KL", qty: 3 },
  { id: "i27", category: "inverter", model: "H2-30K-T3", serialCode: "HDT2103J2613ESA08914", warehouse: "JB", qty: 5 },
  { id: "i28", category: "inverter", model: "H2-30K-T3", serialCode: "HDT2103J2613ESA08914", warehouse: "KL", qty: 3 },
  // ── Batteries ── (dummy; highlighted rows are the priority models)
  { id: "b1", category: "battery", model: "B3-16.0-LV", serialCode: "ESB3-160LV", warehouse: "JB", qty: 25, highlight: true },
  { id: "b2", category: "battery", model: "B3-16.0-LV", serialCode: "ESB3-160LV", warehouse: "KL", qty: 12, highlight: true },
  { id: "b3", category: "battery", model: "B3-5.0-LV", serialCode: "ESB3-50LV", warehouse: "JB", qty: 22 },
  { id: "b4", category: "battery", model: "B3-5.0-LV", serialCode: "ESB3-50LV", warehouse: "KL", qty: 11 },
  { id: "b5", category: "battery", model: "B2-5.0-LV1", serialCode: "ESB2-50LV1", warehouse: "JB", qty: 20 },
  { id: "b6", category: "battery", model: "B2-5.0-LV1", serialCode: "ESB2-50LV1", warehouse: "KL", qty: 10 },
  { id: "b7", category: "battery", model: "BU3-5.0-TV2-PRO-BASE", serialCode: "ESBU3-50TV2PB", warehouse: "JB", qty: 15 },
  { id: "b8", category: "battery", model: "BU3-5.0-TV2-PRO-BASE", serialCode: "ESBU3-50TV2PB", warehouse: "KL", qty: 8 },
  { id: "b9", category: "battery", model: "BU3-5.0-TV2-PRO", serialCode: "ESBU3-50TV2P", warehouse: "JB", qty: 13 },
  { id: "b10", category: "battery", model: "BU3-5.0-TV2-PRO", serialCode: "ESBU3-50TV2P", warehouse: "KL", qty: 7 },
  // ── Battery Controller and Other ── (dummy quantities and codes)
  { id: "o1", category: "other", group: "ATS", model: "Single Phase", serialCode: "ATS-1P", warehouse: "JB", qty: 20, highlight: true },
  { id: "o2", category: "other", group: "ATS", model: "Single Phase", serialCode: "ATS-1P", warehouse: "KL", qty: 12, highlight: true },
  { id: "o3", category: "other", group: "ATS", model: "Three Phase", serialCode: "ATS-3P", warehouse: "JB", qty: 14, highlight: true },
  { id: "o4", category: "other", group: "ATS", model: "Three Phase", serialCode: "ATS-3P", warehouse: "KL", qty: 8, highlight: true },
  { id: "o5", category: "other", group: "EV Charger", model: "AC7000-AE-35", serialCode: "EVAC7000AE35", warehouse: "JB", qty: 6 },
  { id: "o6", category: "other", group: "EV Charger", model: "AC7000-AE-35", serialCode: "EVAC7000AE35", warehouse: "KL", qty: 4 },
  { id: "o7", category: "other", group: "EV Charger", model: "AC011K-AE-35", serialCode: "EVAC011KAE35", warehouse: "JB", qty: 5 },
  { id: "o8", category: "other", group: "EV Charger", model: "AC011K-AE-35", serialCode: "EVAC011KAE35", warehouse: "KL", qty: 3 },
];

// ── Stock by Customer page data ────────────────────────────────────────

export type CustomerAllocation = {
  category: "panel" | "inverter" | "battery";
  model: string;
  serialCode: string;
  qty: number;
};

export type CustomerStock = {
  id: string;
  customerName: string;
  warehouse: "JB" | "KL";
  allocations: CustomerAllocation[];
};

// Equipment allocated (reserved or delivered) per customer order.
// Serial codes are per-unit identifiers assigned at dispatch.
// Allocations reuse the serial shown for the same model on the Stock Details page.
function serialFor(model: string): string {
  return STOCK_DETAIL_ITEMS.find((item) => item.model === model)?.serialCode ?? "";
}

export const CUSTOMER_STOCK_ALLOCATIONS: CustomerStock[] = [
  {
    id: "c1",
    customerName: "Lok Suet Lee",
    warehouse: "JB",
    allocations: [
      { category: "panel", model: "Jinko 620W", serialCode: serialFor("Jinko 620W"), qty: 12 },
      { category: "inverter", model: "R5-7K-S2", serialCode: serialFor("R5-7K-S2"), qty: 1 },
      { category: "battery", model: "B3-5.0-LV", serialCode: serialFor("B3-5.0-LV"), qty: 1 },
    ],
  },
  {
    id: "c2",
    customerName: "Lim Kok Siang",
    warehouse: "JB",
    allocations: [
      { category: "panel", model: "Jinko 650W", serialCode: serialFor("Jinko 650W"), qty: 16 },
      { category: "inverter", model: "R5-8K-S2", serialCode: serialFor("R5-8K-S2"), qty: 1 },
    ],
  },
  {
    id: "c3",
    customerName: "Chee Chin Fou",
    warehouse: "JB",
    allocations: [
      { category: "panel", model: "Astronergy 625W", serialCode: serialFor("Astronergy 625W"), qty: 10 },
      { category: "inverter", model: "R5-6K-S2", serialCode: serialFor("R5-6K-S2"), qty: 1 },
      { category: "battery", model: "B2-5.0-LV1", serialCode: serialFor("B2-5.0-LV1"), qty: 1 },
    ],
  },
  {
    id: "c4",
    customerName: "Woo Pek Lai",
    warehouse: "KL",
    allocations: [
      { category: "panel", model: "Jinko 620W", serialCode: serialFor("Jinko 620W"), qty: 14 },
      { category: "inverter", model: "R6-8K-T2", serialCode: serialFor("R6-8K-T2"), qty: 1 },
      { category: "battery", model: "B3-16.0-LV", serialCode: serialFor("B3-16.0-LV"), qty: 1 },
    ],
  },
  {
    id: "c5",
    customerName: "Ahmad Razali",
    warehouse: "KL",
    allocations: [
      { category: "panel", model: "Jinko 650W", serialCode: serialFor("Jinko 650W"), qty: 20 },
      { category: "inverter", model: "R5-5K-S2", serialCode: serialFor("R5-5K-S2"), qty: 1 },
    ],
  },
  {
    id: "c6",
    customerName: "Tan Wei Ming",
    warehouse: "JB",
    allocations: [
      { category: "panel", model: "Jinko 585W", serialCode: serialFor("Jinko 585W"), qty: 18 },
      { category: "inverter", model: "M2-1.8K-S4", serialCode: serialFor("M2-1.8K-S4"), qty: 4 },
      { category: "battery", model: "BU3-5.0-TV2-PRO", serialCode: serialFor("BU3-5.0-TV2-PRO"), qty: 1 },
    ],
  },
  {
    id: "c7",
    customerName: "Nurul Huda",
    warehouse: "KL",
    allocations: [
      { category: "panel", model: "Astronergy 625W", serialCode: serialFor("Astronergy 625W"), qty: 8 },
      { category: "inverter", model: "R5-6K-S2", serialCode: serialFor("R5-6K-S2"), qty: 1 },
    ],
  },
  {
    id: "c8",
    customerName: "Lee Chong Wei",
    warehouse: "JB",
    allocations: [
      { category: "panel", model: "Jinko 650W", serialCode: serialFor("Jinko 650W"), qty: 24 },
      { category: "inverter", model: "R6-10K-T2", serialCode: serialFor("R6-10K-T2"), qty: 1 },
      { category: "battery", model: "B3-16.0-LV", serialCode: serialFor("B3-16.0-LV"), qty: 2 },
    ],
  },
  {
    id: "c9",
    customerName: "Siti Aminah",
    warehouse: "KL",
    allocations: [
      { category: "panel", model: "Jinko 620W", serialCode: serialFor("Jinko 620W"), qty: 10 },
      { category: "inverter", model: "R5-5K-S2", serialCode: serialFor("R5-5K-S2"), qty: 1 },
      { category: "battery", model: "B2-5.0-LV1", serialCode: serialFor("B2-5.0-LV1"), qty: 1 },
    ],
  },
  {
    id: "c10",
    customerName: "Raj Kumar",
    warehouse: "JB",
    allocations: [
      { category: "panel", model: "Jinko 585W", serialCode: serialFor("Jinko 585W"), qty: 12 },
      { category: "inverter", model: "R6-20K-T2-32", serialCode: serialFor("R6-20K-T2-32"), qty: 1 },
      { category: "battery", model: "B3-5.0-LV", serialCode: serialFor("B3-5.0-LV"), qty: 1 },
    ],
  },
];
