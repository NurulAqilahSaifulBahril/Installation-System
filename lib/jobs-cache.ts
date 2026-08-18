// Shared with app/api/jobs/[id]/route.ts so a single-job save can invalidate
// the list cache immediately, instead of leaving the dashboard showing a
// pre-edit snapshot for up to CACHE_TTL_MS after a save succeeds.
export const CACHE_TTL_MS = 30_000;

let cachedResponse: { body: unknown; expiresAt: number } | null = null;
let inflightRequest: Promise<unknown> | null = null;

export function getCached(): unknown | null {
  if (cachedResponse && cachedResponse.expiresAt > Date.now()) {
    return cachedResponse.body;
  }
  return null;
}

export function getInflight(): Promise<unknown> | null {
  return inflightRequest;
}

export function setInflight(promise: Promise<unknown> | null) {
  inflightRequest = promise;
}

export function setCached(body: unknown) {
  cachedResponse = { body, expiresAt: Date.now() + CACHE_TTL_MS };
}

export function invalidateJobsCache() {
  cachedResponse = null;
}
