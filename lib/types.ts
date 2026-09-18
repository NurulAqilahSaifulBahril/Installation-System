// Where the customer stands on letting the crew in. Five values, and every job
// has one — a job nobody has touched reads "not_set" — so between them they
// place every customer in the pipeline:
//
//   not_set / propose / reschedule -> Ready to Install
//   pending_complete               -> Pending Complete
//   complete                       -> Complete Installation
//
// The stage still has to be paid for: reaching Ready to Install needs the
// invoice past READY_PAYMENT_PERCENT in the tracked era, so a Not Set customer
// who has only put a deposit down stays in Deposit. Availability decides which
// stage a job lands in among the ones its payments already qualify it for.
export type CustomerAvailabilityStatus =
  // Nobody has spoken to the customer yet. The default, and by far the
  // commonest value: it is what every job carries until someone sets one.
  | "not_set"
  // A date is on the table — proposed, agreed, or already on the calendar.
  // There is no separate "scheduled" value: booking a date does not move the
  // customer out of Propose, it just fills the date in beside it.
  | "propose"
  // The customer has moved off the date that was agreed. Still active work —
  // what they are missing is the replacement date, held in
  // secondPreferredInstallationDate.
  | "reschedule"
  // The crew has been, or the office has, and something is still outstanding.
  | "pending_complete"
  // Done. Also reached without anyone setting it, by a booked date falling far
  // enough behind us — see isCompleteInstallation.
  | "complete";

export const CUSTOMER_AVAILABILITY_STATUSES: CustomerAvailabilityStatus[] = [
  "not_set",
  "propose",
  "reschedule",
  "pending_complete",
  "complete",
];

// The seven-value scheme these five replaced, kept as a read-time translation
// rather than migrated in the database. Two stores hold this field — the
// installation_jobs column and the jobUpdates blob in installation_ops_state —
// and they are not perfectly in step with each other, so rewriting both in
// place risks losing the rows where they disagree. Translating on the way in
// costs nothing and stays reversible.
//
// "cancelled" lands on reschedule rather than on anything final: a cancelled
// date is a date that has to be agreed again, which is what reschedule is for.
// "others" was only ever chosen when something the named statuses did not
// cover was holding the job up, which is pending_complete.
const LEGACY_AVAILABILITY_STATUSES: Record<string, CustomerAvailabilityStatus> = {
  available: "propose",
  pending: "pending_complete",
  others: "pending_complete",
  unavailable: "pending_complete",
  cancelled: "reschedule",
};

// Anything unrecognised — a value from a future scheme, or a null out of the
// database — reads as not_set rather than throwing: an unfamiliar status must
// not be able to hide a customer from the dashboard.
export function normalizeAvailabilityStatus(
  value: string | null | undefined,
): CustomerAvailabilityStatus {
  if (!value) return "not_set";
  if ((CUSTOMER_AVAILABILITY_STATUSES as string[]).includes(value)) {
    return value as CustomerAvailabilityStatus;
  }
  return LEGACY_AVAILABILITY_STATUSES[value] ?? "not_set";
}

export type ReadinessState = "complete" | "pending" | "blocked";

export type TeamAssignment = {
  id: string;
  role: "roof" | "wiring" | "battery_inverter" | "supervisor";
  teamName: string;
  contact?: string;
  activity:
    | "hooks_rails"
    | "pv_panels"
    | "cable_trunking"
    | "earthing"
    | "inverter_installation"
    | "dc_cable_inverter"
    | "ac_cable_house_elc"
    | "pv_meter_termination"
    | "mobile_app_wifi_setup"
    | "saj_string_inverter"
    | "jinko_panels"
    | "skylift"
    | "follow_proposed_drawing"
    | "rubbish_clear"
    | "other";
  customActivity?: string;
};

// What the sidebar calendar shows when a day is hovered: the crews out that
// day, and every customer with their stock delivery ETA and installation time.
// Assembled on the dashboard page, where job -> group -> team assignment can
// be resolved; the calendar only reads a date off it.
export type CalendarDayCustomer = {
  id: string;
  name: string;
  stockDelivery: string | null;
  installTime: string | null;
  // Set only when this day is a return trip rather than the job's primary
  // installation date — "WIRING ONLY", "O&M". Null on a normal install day,
  // so the card stays unlabelled in the common case.
  visitKind?: string | null;
};

// The customers one crew is working on a given day, headed by who that crew
// is. Grouping here rather than in the calendar keeps the card a straight
// render of what it is handed.
export type CalendarDayCrew = {
  // The installation group the customers belong to; "" when they belong to
  // none, which is how the unassigned bucket is addressed.
  key: string;
  teamLabel: string;
  installationTeam: string;
  wiringTeam: string;
  customers: CalendarDayCustomer[];
};

export type CalendarDayDetail = {
  // Every customer on the day, flat. The card counts from this, so the count
  // cannot drift from the grouped lists below.
  customers: CalendarDayCustomer[];
  // The day's work, split by crew. Each crew heads its own list, so the card
  // has no separate roll-call of crews above it.
  crews: CalendarDayCrew[];
};

// One trip out to a site. Most jobs are a single day and carry none of these —
// `installationDate` alone says everything. A job needs visits when the crew
// goes back: wiring split over three days, a return trip for a CT clamp, an
// O&M callback months after handover. They are all the same job against the
// same invoice, so they stay one InstallationJob rather than becoming separate
// records; only the calendar needs to know the site is worked on more than one
// day. `installationDate` remains the primary day and is not repeated here.
export type JobVisit = {
  // Plain YYYY-MM-DD, same as every other calendar date in the app.
  date: string;
  // "HH:mm" start time, when the schedule pins one down.
  time?: string;
  // What the trip is for — "WIRING ONLY", "O&M", "PENDING JOB". Free text
  // because the sheet these came from has no fixed vocabulary.
  kind?: string;
  notes?: string;
};

export type InstallationJob = {
  id: string;
  invoiceNumber: string;
  customerName: string;
  customerPhone: string;
  address: string;
  city: string;
  state: string;
  postcode?: string;
  agentName: string;
  totalAmount: number;
  paymentPercent: number;
  paymentBalance: number;
  // The deposit — the customer's first payment against the invoice.
  firstPaymentDate?: string | null;
  secondPaymentDate?: string | null;
  panelQuantity: number | null;
  panelRating: number | null;
  inverter: string;
  battery: string;
  ballastDetails?: string;
  focDetails?: string;
  phase: "Single phase" | "Three phase" | "Unknown";
  // Which inverter types the invoice carries — "String Inverter", "Micro
  // Inverter", "String + Micro Inverter", etc. — read off every line item
  // that mentions "inverter" at all, package line and separately sold add-on
  // alike (see parseInverterTypesFromText in lib/source-api.ts). Blank when
  // nothing on the invoice says so.
  inverterType: string;
  // Best-effort model codes for the same inverters — "1 X R6-12K-T2 + 1 X
  // M2-1.0K-S2" — for Installation groups' Inverter / Battery Model column
  // to default to before anyone has typed over it (see
  // parseInverterModelsFromText in lib/source-api.ts). Never written back;
  // inverterBattery is what actually gets saved.
  derivedInverterModel: string;
  sedaStatus: string;
  sldUrl: string | null;
  packageName: string;
  // Invoice/package type from the source — "Residential", "Tariff B&D Low
  // Voltage", "EV Charger". Used to filter Residential/Shoplots, Commercial,
  // EV and O&M on every dashboard page.
  packageType: string;
  // Invoice lines that mention an EV charger / wallbox, including those sold
  // outside the solar package. Blank when the invoice has none.
  evDetails?: string;
  installationDate: string | null;
  // Additional days this site is worked on, beyond installationDate. Absent on
  // the great majority of jobs.
  visits?: JobVisit[];
  customerAvailabilityStatus: CustomerAvailabilityStatus;
  preferredInstallationDate: string | null;
  // "HH:mm" alongside the date above, so one column carries the whole slot
  // rather than a date here and a time somewhere else. Null when only a day
  // has been agreed, which is the common case early on.
  preferredInstallationTime: string | null;
  // The replacement date for a customer who is rescheduling. The date above it
  // stays put as the one that fell through, so the move is still legible after
  // the fact. Null until a new date has actually been agreed — which is what
  // Customer Scheduling highlights.
  secondPreferredInstallationDate: string | null;
  availabilityRemarks: string;
  scheduleStatus:
    | "ready_to_schedule"
    | "pending_approval"
    | "pending_installation"
    | "ready_to_install"
    | "installed"
    | "reschedule_required";
  installationApprovalStatus:
    | "date_approved"
    | "pending_approval_date"
    | "pending_seda_approval"
    | "other";
  deliveryStatus:
    | "not_planned"
    | "pending_stock"
    | "delivery_scheduled"
    | "delivered"
    | "partially_delivered";
  deliveryDate: string | null;
  arrivalDate: string | null;
  arrivalTime: string | null;
  stockDetails: string;
  deliveryContactNumber: string;
  warehouseLocation: string;
  deliveryRunName?: string;
  deliveryGroupLocation?: string;
  panelDetails: string;
  wiringDetails: string;
  batteryDetails: string;
  // Free text straight from ops' schedule sheet, e.g. "1 X H2-10K-LT2
  // Hybrid Inverter + ADD ON 1 X ATS". Deliberately not parsed into model/
  // quantity: the cell carries add-ons, ballast and FOC notes that only make
  // sense read together, and ops edit it as prose.
  inverterBattery: string;
  // Column F of ops' schedule sheet — the panel count, brand and rating as
  // one phrase, e.g. "16 Jinko 650W". Kept as written for the same reason as
  // [inverterBattery]: some cells prefix an install date the crew needs.
  powerOutput: string;
  paymentOverrideStatus: "none" | "pending" | "approved" | "rejected";
  paymentOverrideReason: string;
  teams: TeamAssignment[];
  remarks: string;
  // The site notes the schedule sheet writes under a customer's name — "Metal
  // db box, white colour metal trunking", "Pending batt", "Site Supervisor
  // must be Joshua". They belong to the customer, not to the crew, so they
  // follow the customer across every crew and day they are booked on.
  //
  // Distinct from the two remark fields above it: `availabilityRemarks` is why
  // a customer can or cannot take a date, and `remarks` is the free-text note
  // on the customer record. This is what the crew has to know on site.
  installationRemarks: string;
  sourceUpdatedAt?: string;
};

export type JobUpdate = Pick<
  InstallationJob,
  | "installationDate"
  | "visits"
  | "customerAvailabilityStatus"
  | "preferredInstallationDate"
  | "preferredInstallationTime"
  | "secondPreferredInstallationDate"
  | "availabilityRemarks"
  | "installationApprovalStatus"
  | "scheduleStatus"
  | "deliveryStatus"
  | "deliveryDate"
  | "arrivalDate"
  | "arrivalTime"
  | "stockDetails"
  | "deliveryContactNumber"
  | "warehouseLocation"
  | "panelDetails"
  | "wiringDetails"
  | "batteryDetails"
  | "inverterBattery"
  | "powerOutput"
  | "paymentOverrideStatus"
  | "paymentOverrideReason"
  | "teams"
  | "remarks"
  | "installationRemarks"
>;

// What an invoice has to be paid to before the customer is cleared to install.
// It lives here because two places have to agree on it and they are compiled
// separately: the pipeline stages in app/page.tsx (Ready to Install, and the
// ceiling on Deposit), and the SQL in lib/source-api.ts that dates the moment
// an invoice crossed it. A number that drifted between them would put a
// customer in a stage whose own date said they never qualified for it.
export const READY_PAYMENT_PERCENT = 60;

// Whether an invoice has reached that line.
//
// A function rather than a bare `>=` because the percentage is a division, and
// a customer who has paid exactly 65% does not reliably land on 65 once it has
// been through binary floating point. MONG YEE KEONG (INV-1009563) paid
// 24,356.67 of 37,471.80 — exactly 65% to the sen, the threshold at the
// time — and JavaScript makes that
// 64.99999999999999, which put them in Deposit while the 2nd payment column,
// dated by the database's exact numeric arithmetic, said they had crossed
// weeks earlier. The SQL in lib/source-api.ts and this test have to agree
// about the same customer, and only one of them has exact arithmetic.
//
// The tolerance is far below any real difference in money — a sen either way
// on a 37,000 invoice moves the percentage by ~3e-6 — and far above the
// rounding error, which runs at ~1e-14.
const PAYMENT_PERCENT_TOLERANCE = 1e-9;

export function hasReachedPaymentPercent(
  percent: number,
  threshold: number = READY_PAYMENT_PERCENT,
): boolean {
  return percent >= threshold - PAYMENT_PERCENT_TOLERANCE;
}

// The management-approval line. A job at or above it is financially free to be
// planned; below it needs an approved payment exception, and says so on the
// row and in the source remark. Not a display detail: hasPlanningEligibility
// reads it, so a customer sitting exactly on 59% could be kept out of planning
// altogether by the same rounding that misfiled MONG YEE KEONG.
export const APPROVAL_PAYMENT_PERCENT = 59;

