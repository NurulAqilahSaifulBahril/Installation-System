import type { CustomerAvailabilityStatus, InstallationJob } from "@/lib/types";

// How long an installation may sit past its booked day with nobody having
// confirmed it, one way or the other, before the dashboard starts asking
// about it. This used to be the margin before the system assumed Complete on
// its own and wrote that into the database — see needsCompletionVerification
// below for why that assumption was removed instead of just retuned.
export const DAYS_BEFORE_VERIFY_COMPLETION = 5;

// Only the date matters here, so this takes the narrowest shape that carries
// one. That lets the page pass its own InstallationGroup and the jobs API pass
// a group parsed straight out of the stored ops state, without either having
// to know about the other's type.
export type DatedGroup = { installationDate: string | null } | null | undefined;

// Plain "YYYY-MM-DD" plus n days, read back field by field. Not via
// toISOString, which would return UTC and slip a day at UTC+8 — the same trap
// lib/dates.ts documents.
export function addDays(dateStr: string, days: number): string | null {
  const date = new Date(`${dateStr.slice(0, 10)}T00:00:00`);
  if (Number.isNaN(date.getTime())) return null;
  date.setDate(date.getDate() + days);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(
    date.getDate(),
  ).padStart(2, "0")}`;
}

// The two statuses whose preferred date is a real, agreed date rather than a
// suggestion or a date that fell through. Complete is in the set as well as
// Propose: a finished job's agreed date is the day the work happened, and
// dropping it the moment the status flips to Complete would make every
// completed job read as though it had never been booked.
const STATUSES_WITH_AGREED_DATE: CustomerAvailabilityStatus[] = [
  "propose",
  "complete",
];

// The confirmed date: whichever is latest among the customer's own date, the
// group they were scheduled through, and — only for the statuses above — the
// date agreed on Customer Scheduling. Latest wins rather than the customer's
// own date always taking priority, because a reschedule commonly leaves a
// newer, later-dated group in place while the customer's own field (nothing in
// the app ever clears it) still carries the date that fell through; the most
// recent of the two is what actually reflects where things stand today.
export function confirmedInstallationDate(
  job: InstallationJob,
  group?: DatedGroup,
) {
  const candidates = [
    job.installationDate,
    group?.installationDate || null,
    STATUSES_WITH_AGREED_DATE.includes(job.customerAvailabilityStatus)
      ? job.preferredInstallationDate
      : null,
  ].filter((date): date is string => Boolean(date));
  if (candidates.length === 0) return null;
  return candidates.reduce((latest, date) => (date > latest ? date : latest));
}

// Whether anyone has put a date against this customer at all — their own, one
// their group carries, the date they proposed, or the replacement they are
// waiting on. Deliberately looser than confirmedInstallationDate, and it exists
// because the two questions are different.
//
// "Is this booked?" has to exclude a rescheduling customer's date: that is the
// one that fell through, and treating it as a booking would put work on the
// calendar that nobody is coming to. "Has anyone engaged with scheduling this
// customer?" must include it — a date that fell through is still evidence the
// office got to them, and Need Attention is a list of customers nobody has got
// to. KIMBERLY WONG YUIK LIN (INV-1008980) was being chased as unscheduled
// while carrying a 22 Jul date, purely because a reschedule had been recorded
// against her.
export function hasPlannedDate(
  job: InstallationJob,
  group?: DatedGroup,
): boolean {
  return Boolean(
    job.installationDate ||
      group?.installationDate ||
      job.preferredInstallationDate ||
      job.secondPreferredInstallationDate,
  );
}

// Every free-text remark box on the job, the per-visit note the crew leaves on
// the day included — that is where "Pending batt" and "[PENDING JOB] continue
// wiring" actually live.
export function remarkText(job: InstallationJob) {
  return [
    job.availabilityRemarks,
    job.remarks,
    job.installationRemarks,
    ...(job.visits ?? []).flatMap((visit) => [visit.kind, visit.notes]),
  ]
    .filter(Boolean)
    .join(" ");
}


// "Pending SEDA Approval" is written by the app itself (see rowToJob in
// lib/source-api.ts) off a seda_status that nobody maintained before the
// approval-email matcher started on 10 July 2026, so on an older invoice it
// records missing data rather than outstanding work. Stripped before the test
// rather than excluded after it, so a remark naming both — "pending seda,
// pending wiring" — still counts on the wiring.
const PENDING_SEDA_PHRASE = /pending\s*seda[a-z\s]*/gi;

// The status says so, or a remark does. Only the word "pending" is read out of
// remarks now: "reschedule" and "cancel" used to be read the same way, and
// that directly contradicts where Reschedule belongs — a rescheduling customer
// is Ready to Install, and a remark repeating what the status already says
// must not drag them out of it. "Pending" stays because it is the one that
// reports something the status cannot: "pending wiring", "Pending batt" — a
// specific thing being waited on. "Pending SEDA Approval" is stripped first;
// it is on almost every unapproved job and means only that the paperwork is
// with SEDA.
export function signalsPendingComplete(job: InstallationJob) {
  if (job.customerAvailabilityStatus === "pending_complete") return true;
  return /pending/i.test(remarkText(job).replace(PENDING_SEDA_PHRASE, " "));
}

// Done, by either of the two routes to it: the office marked the customer
// Complete, or the source system says installed. A booked date alone no
// longer counts, however long ago it was — that used to be a third route
// (the booked day being far enough behind us), and it closed jobs out on a
// guess instead of a confirmation. See needsCompletionVerification for what
// replaced it.
//
// Reschedule is exempt: a customer marked Reschedule is saying the booked
// date fell through, and reading a stale date as completion would make the
// status impossible to use, snapping the job back to Complete every time
// someone set it. They fall back to Ready to Install with the status they
// were given, which is where a customer waiting on a new date belongs.
export function isCompleteInstallation(
  job: InstallationJob,
  todayIso: string,
  group?: DatedGroup,
) {
  if (job.customerAvailabilityStatus === "complete") return true;
  if (job.customerAvailabilityStatus === "reschedule") return false;
  return job.scheduleStatus === "installed";
}

// A job whose booked day is DAYS_BEFORE_VERIFY_COMPLETION behind us with
// nobody having so much as looked at it. Unlike the old date-based assumption
// this replaces, it does not change what the job's status *is* — it is a flag
// read by the UI to highlight the row, so an admin goes and checks whether the
// crew actually turned up rather than the system deciding for them.
//
// Exempt whenever there is already a more specific signal that someone has:
// nothing to verify once it is Complete or the source system says installed;
// Reschedule's date is expected to be in the past, so it is not a sign anyone
// forgot to close the job out; and Pending Complete (or a remark reporting the
// same thing — see signalsPendingComplete) means the office has already found
// something outstanding, which is a stronger, more specific finding than this
// flag can offer. TAN HWEE NOI, sitting in Pending Complete, does not need a
// second, less informative badge telling her office what the status already
// says.
export function needsCompletionVerification(
  job: InstallationJob,
  todayIso: string,
  group?: DatedGroup,
): boolean {
  if (isCompleteInstallation(job, todayIso, group)) return false;
  if (job.customerAvailabilityStatus === "reschedule") return false;
  if (signalsPendingComplete(job)) return false;
  const date = confirmedInstallationDate(job, group);
  if (!date) return false;
  const overdue = addDays(date, DAYS_BEFORE_VERIFY_COMPLETION);
  return overdue !== null && todayIso >= overdue;
}

// What the Status field should read, given where the job actually stands. A
// job that has reached Complete Installation reads Complete whatever it was
// last set to, so the column can never say Propose about a job the pipeline is
// counting as finished.
//
// Pending Complete is left alone: something is still outstanding on that job,
// and it holds the customer out of Complete Installation in the first place.
export function resolvedAvailabilityStatus(
  job: InstallationJob,
  todayIso: string,
  group?: DatedGroup,
): CustomerAvailabilityStatus {
  // Anything still outstanding stays outstanding. This covers the status and
  // the remark alike, and it has to be checked first: a job whose date has
  // passed but whose remark says "pending wiring" is in Pending Complete, not
  // Complete Installation, so promoting it would put Complete in the column
  // of a job the pipeline is counting as unfinished.
  if (signalsPendingComplete(job)) return "pending_complete";
  return isCompleteInstallation(job, todayIso, group)
    ? "complete"
    : job.customerAvailabilityStatus;
}
