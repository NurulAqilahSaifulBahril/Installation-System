"use client";

// Loading page: a delivery-app style tracker for each lorry run of the day. The warehouse is the
// start, each customer is a stop in run order, and the lorry sits where the run has reached:
// - at the warehouse until 🚚 Loading is pressed on any of its jobs;
// - on the line to the next stop once it has left (Loading pressed);
// - past every stop whose panels were all scanned on site (arrived, ✓).

export type TimelineRun = {
  id: string;
  name: string;
  deliveryDate: string;
  departureTime: string;
  warehouse: string;
  deliveryPic: string;
  contactNumber: string;
  customers: {
    jobId: string;
    invoice: string;
    name: string;
    etaDate: string;
    etaTime: string;
    // Installation day and time from the schedule (the Loading table shows the time).
    installDate?: string;
    installTime?: string;
  }[];
};

const GREEN = "#16a34a";
const AMBER = "#bf9000";
const GREY = "#cbd5e1";

const digits = (value: string) => value.replace(/\D/g, "");

// "15:00" -> "3pm", "15:30" -> "3.30pm"
function clock(value: string): string {
  const m = value.match(/^(\d{1,2}):(\d{2})/);
  if (!m) return value;
  const h = Number(m[1]);
  return `${h % 12 === 0 ? 12 : h % 12}${m[2] === "00" ? "" : `.${m[2]}`}${h >= 12 ? "pm" : "am"}`;
}

// "WOON JONE SIANG (ATAP)" -> "Woon"
function shortName(name: string): string {
  const first = name.replace(/\(.*?\)/g, " ").trim().split(/\s+/)[0] ?? "";
  return first ? first[0].toUpperCase() + first.slice(1).toLowerCase() : "—";
}

// The same lorry as the Loading tab icon (it faces right, towards the next stop).
function Lorry() {
  return (
    <span
      aria-hidden="true"
      style={{
        position: "absolute",
        left: "50%",
        top: "50%",
        transform: "translate(-50%, -50%)",
        lineHeight: 0,
        padding: "1px 2px",
        background: "#fff",
        borderRadius: "4px",
        color: AMBER,
      }}
    >
      <svg width="18" height="17" viewBox="0 0 26 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M2 5h13v11H2z" />
        <path d="M15 9h5l4 4v3h-9z" />
        <circle cx="6.5" cy="18.5" r="2" />
        <circle cx="19" cy="18.5" r="2" />
      </svg>
    </span>
  );
}

export function LorryTimeline({
  runs,
  loaded,
  arrived,
}: {
  runs: TimelineRun[];
  // Invoice digits of jobs with Loading pressed / with every panel scanned on site.
  loaded: Set<string>;
  arrived: Set<string>;
}) {
  if (runs.length === 0) return null;
  return (
    <div style={{ display: "grid", gap: "4px", margin: "0 0 8px" }}>
      {runs.map((run) => {
        const stops = run.customers.map((c) => {
          const key = digits(c.invoice);
          return { ...c, isArrived: !!key && arrived.has(key), isLoaded: !!key && loaded.has(key) };
        });
        const left = stops.some((s) => s.isLoaded || s.isArrived);
        // Stops reached in a row from the start.
        let reached = 0;
        while (reached < stops.length && stops[reached].isArrived) reached += 1;
        const done = stops.length > 0 && reached === stops.length;
        // Where the lorry is drawn: -1 = at the warehouse; n = on the line after stop n (or the
        // warehouse when n is 0 and it has left); stops.length = finished.
        // No label before the lorry leaves.
        const status = !left ? "" : done ? "All delivered" : reached === 0 ? "On the way" : `On the way to stop ${reached + 1}`;
        const segment = (i: number) => {
          // Line i runs from point i (0 = warehouse) to stop i+1.
          const passed = i < reached;
          const current = left && !done && i === reached;
          return (
            <div
              key={`seg-${i}`}
              style={{ flex: "1 1 24px", minWidth: "24px", position: "relative", alignSelf: "flex-start", height: "16px" }}
            >
              <div
                style={{
                  position: "absolute",
                  left: 0,
                  right: 0,
                  top: "7px",
                  borderTop: `2px ${passed || current ? "solid" : "dashed"} ${passed ? GREEN : current ? AMBER : GREY}`,
                }}
              />
              {current && <Lorry />}
            </div>
          );
        };
        const point = (label: string, sub: string, state: "start" | "done" | "next" | "todo", key: string, title?: string) => (
          <div key={key} style={{ display: "flex", flexDirection: "column", alignItems: "center", flex: "none", width: "48px" }} title={title}>
            {state === "start" ? (
              <div
                style={{
                  width: "16px",
                  height: "16px",
                  borderRadius: "50%",
                  display: "grid",
                  placeItems: "center",
                  fontSize: "9px",
                  background: GREEN,
                  border: `2px solid ${GREEN}`,
                  boxSizing: "border-box",
                  position: "relative",
                }}
              >
                🏭
                {!left && <Lorry />}
              </div>
            ) : (
              // Customer stop: a house, green with a tick when arrived, amber when next, grey to come.
              <div style={{ position: "relative", width: "17px", height: "16px", color: state === "done" ? GREEN : state === "next" ? AMBER : GREY }}>
                <svg width="17" height="16" viewBox="0 0 24 22" aria-hidden="true">
                  <path
                    d="M12 2.5 21.5 10.5H19V20H5V10.5H2.5Z"
                    fill={state === "todo" ? "#fff" : "currentColor"}
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                  {state === "done" && (
                    <path d="m8.5 14.5 2.5 2.5 4.5-5" fill="none" stroke="#fff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                  )}
                </svg>
              </div>
            )}
            <span style={{ fontSize: "9.5px", fontWeight: 600, color: "#111", marginTop: "2px", textAlign: "center", lineHeight: 1.2 }}>{label}</span>
            <span style={{ fontSize: "9px", color: "#555", textAlign: "center" }}>{sub}</span>
          </div>
        );
        return (
          <div
            key={run.id}
            style={{ padding: "4px 0" }}
          >
            {status && (
              <div style={{ display: "flex", justifyContent: "flex-end", fontSize: "10.5px", marginBottom: "2px" }}>
                <span style={{ fontWeight: 700, color: done ? GREEN : AMBER }}>{status}</span>
              </div>
            )}
            <div style={{ display: "flex", alignItems: "flex-start", overflowX: "auto", paddingTop: "2px" }}>
              {point("Warehouse", clock(run.departureTime), "start", "wh")}
              {stops.flatMap((stop, i) => [
                segment(i),
                point(
                  shortName(stop.name),
                  stop.isArrived ? "✓ arrived" : clock(stop.etaTime),
                  stop.isArrived ? "done" : left && i === reached ? "next" : "todo",
                  `${stop.jobId}-${i}`,
                  `${stop.name} · ${stop.invoice}`,
                ),
              ])}
            </div>
          </div>
        );
      })}
    </div>
  );
}
