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
export type CalendarDayDetail = {
  // Only crews booked for this exact day. A crew committed to another date is
  // not listed at all, so the card never implies a booking that isn't there.
  teams: string[];
  customers: Array<{
    id: string;
    name: string;
    stockDelivery: string | null;
    installTime: string | null;
  }>;
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
  customerAvailabilityStatus:
    | "not_set"
    | "pending"
    | "available"
    | "unavailable"
    | "cancelled";
  preferredInstallationDate: string | null;
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
  sourceUpdatedAt?: string;
};

export type JobUpdate = Pick<
  InstallationJob,
  | "installationDate"
  | "customerAvailabilityStatus"
  | "preferredInstallationDate"
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
>;
