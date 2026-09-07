import type { OpsState } from '@/lib/ops-store';

// Mirrors lib/jobs-cache.ts. The ops-state row has grown large (hundreds of
// groups, runs and per-job overrides in one JSONB blob), and unlike /api/jobs
// this endpoint had no cache at all — every load, and every tab regaining
// focus, paid a full round trip to the remote database for the whole blob.
//
// A save updates the cache directly (see setCached in the PUT handler)
// rather than just invalidating it, since writeOpsState already hands back
// the merged result — there is no reason to make the next reader pay for a
// row this same request just wrote.
export const CACHE_TTL_MS = 30_000;

type CachedState = { exists: boolean; state: OpsState };

let cachedResponse: { body: CachedState; expiresAt: number } | null = null;
let inflightRequest: Promise<CachedState> | null = null;

export function getCached(): CachedState | null {
  if (cachedResponse && cachedResponse.expiresAt > Date.now()) {
    return cachedResponse.body;
  }
  return null;
}

export function getInflight(): Promise<CachedState> | null {
  return inflightRequest;
}

export function setInflight(promise: Promise<CachedState> | null) {
  inflightRequest = promise;
}

export function setCached(body: CachedState) {
  cachedResponse = { body, expiresAt: Date.now() + CACHE_TTL_MS };
}

export function invalidateOpsStateCache() {
  cachedResponse = null;
}
