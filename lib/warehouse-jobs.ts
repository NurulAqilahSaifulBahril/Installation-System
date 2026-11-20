import { GET as getJobs } from "@/app/api/jobs/route";
import type { InstallationJob } from "@/lib/types";

// Installation jobs for the Inventory Management routes (schedule, delivery, arranged).
//
// A full load of /api/jobs takes 8–12 s (a join across two remote databases), and the inventory
// pages ask for it often (the delivery schedule refreshes every minute). So the inventory keeps
// its own copy: under 30 s old it is used as is; older than that (up to 6 hours) it is still
// answered at once, and a fresh load starts in the background for the next request. Only a copy
// older than 6 hours, or none at all (after a restart), makes a request wait. The Installation dashboard's own
// /api/jobs cache and behaviour are unchanged.
//
// Delivery runs, drivers and plates do not come from here: those routes read them fresh from
// the ops state on every request.

const FRESH_MS = 30_000;
const STALE_MS = 6 * 60 * 60_000;

let last: { jobs: InstallationJob[]; at: number } | null = null;
let inflight: Promise<InstallationJob[]> | null = null;

function load(requestUrl: string): Promise<InstallationJob[]> {
  if (!inflight) {
    inflight = (async () => {
      // fresh=1: read past /api/jobs' own cache (this copy is the cache).
      const response = await getJobs(new Request(new URL("/api/jobs?fresh=1", requestUrl)));
      if (!response.ok) throw new Error(`Could not load installation jobs (${response.status}).`);
      const { jobs = [] } = (await response.json()) as { jobs?: InstallationJob[] };
      last = { jobs, at: Date.now() };
      return jobs;
    })().finally(() => {
      inflight = null;
    });
  }
  return inflight;
}

export async function warehouseJobs(requestUrl: string): Promise<InstallationJob[]> {
  // "Sync from Scheduling Dashboard" (?fresh=1): wait for a fresh load instead of the copy.
  if (new URL(requestUrl).searchParams.get("fresh") === "1") return load(requestUrl);
  const age = last ? Date.now() - last.at : Infinity;
  if (last && age < FRESH_MS) return last.jobs;
  if (last && age < STALE_MS) {
    load(requestUrl).catch((error) => console.error("[warehouse-jobs] background refresh failed", error));
    return last.jobs;
  }
  return load(requestUrl);
}
