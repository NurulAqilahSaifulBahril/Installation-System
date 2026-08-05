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
    | "other";
  customActivity?: string;
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
  customerAvailabilityStatus: "pending" | "available" | "unavailable";
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
