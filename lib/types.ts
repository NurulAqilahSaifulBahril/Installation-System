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
  sedaStatus: string;
  sldUrl: string | null;
  packageName: string;
  installationDate: string | null;
  // Additional days this site is worked on, beyond installationDate. Absent on
  // the great majority of jobs.
  visits?: JobVisit[];
  customerAvailabilityStatus:
    | "not_set"
    | "pending"
    | "available"
    // The customer has moved off the date that was agreed. Still active work,
    // so they stay in planning the way "pending" does — what they are missing
    // is the replacement date, held in secondPreferredInstallationDate.
    | "reschedule"
    | "unavailable"
    | "cancelled";
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
  | "paymentOverrideStatus"
  | "paymentOverrideReason"
  | "teams"
  | "remarks"
  | "installationRemarks"
>;
