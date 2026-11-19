// Keeps a page's copy of the Delivery Schedule current with the Scheduling system.
//
// Both systems read the same saved schedule (installation_ops_state in NUrul_DB), and
// /api/warehouse/delivery reads it fresh on every call. So a page only goes stale by not asking
// again: this loads the runs now, again whenever the tab comes back into view or regains focus,
// and every minute while the tab is visible. Returns a function that stops it.

const REFRESH_MS = 60_000;
// A focus event right after a load does not load again.
const MIN_GAP_MS = 10_000;
// Every part of the page that shows the schedule (list, job page, Delivery Order, Project Team)
// shares one request: a call within this window reuses the last answer or the one in flight.
const SHARE_MS = 5_000;

let shared: { at: number; promise: Promise<unknown[] | null> } | null = null;

function fetchRuns<T>(): Promise<T[] | null> {
  if (!shared || Date.now() - shared.at > SHARE_MS) {
    shared = {
      at: Date.now(),
      promise: fetch("/api/warehouse/delivery", { credentials: "same-origin", cache: "no-store" })
        .then(async (res) => (res.ok ? (((await res.json()) as { runs?: unknown[] }).runs ?? null) : null))
        .catch(() => null),
    };
    // Measured from when the answer came back, so a slow request is not asked again at once.
    void shared.promise.then(() => {
      if (shared) shared.at = Date.now();
    });
  }
  return shared.promise as Promise<T[] | null>;
}

export function watchDeliveryRuns<T>(
  onRuns: (runs: T[]) => void,
  onSettled?: () => void,
): () => void {
  let stopped = false;
  let inFlight = false;
  let lastLoad = 0;

  const load = (force = false) => {
    if (stopped || inFlight) return;
    if (!force && Date.now() - lastLoad < MIN_GAP_MS) return;
    inFlight = true;
    lastLoad = Date.now();
    fetchRuns<T>()
      .then((runs) => {
        if (!stopped && runs) onRuns(runs);
      })
      .finally(() => {
        inFlight = false;
        if (!stopped) onSettled?.();
      });
  };

  const onVisible = () => {
    if (document.visibilityState === "visible") load();
  };
  const onFocus = () => load();

  load(true);
  const timer = window.setInterval(() => {
    if (document.visibilityState === "visible") load(true);
  }, REFRESH_MS);
  document.addEventListener("visibilitychange", onVisible);
  window.addEventListener("focus", onFocus);

  return () => {
    stopped = true;
    window.clearInterval(timer);
    document.removeEventListener("visibilitychange", onVisible);
    window.removeEventListener("focus", onFocus);
  };
}
