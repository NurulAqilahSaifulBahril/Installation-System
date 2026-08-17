// Address -> coordinates -> driving durations, with a fallback at every step
// so a missing API key or an unreachable service degrades the estimate instead
// of failing the whole calculation.
//
//   geocoding : OpenRouteService (key) -> Nominatim (free) -> postcode table
//   durations : OpenRouteService (key) -> OSRM demo (free) -> straight-line
//
// Every result carries the method that produced it, because the difference
// between "real road route" and "straight line times a fudge factor" matters
// to whoever is scheduling a lorry and must not be invisible in the UI.
//
// ORS and OSRM both speak GeoJSON coordinate order — [longitude, latitude],
// NOT [lat, lng]. Reversing it silently returns durations for a point in the
// wrong hemisphere rather than erroring, so the conversion lives in exactly
// one place and is never inlined at a call site.

export type Coordinates = { lat: number; lng: number };

export type GeocodeMethod = "openrouteservice" | "nominatim" | "postcode";
export type RouteMethod = "openrouteservice" | "osrm" | "straight-line";

export class RoutingError extends Error {}

const ORS_BASE = "https://api.openrouteservice.org";
const OSRM_BASE = "https://router.project-osrm.org";
const NOMINATIM_BASE = "https://nominatim.openstreetmap.org";

// Nominatim's usage policy asks for a real identifying User-Agent and no more
// than one request a second. Both are honoured below.
const USER_AGENT = "EternalgyInstallationOps/1.0 (delivery ETA planning)";
const NOMINATIM_MIN_GAP_MS = 1100;

// Straight-line distance under-reports road distance; this scales it up to a
// plausible driving distance. 1.4 with 40 km/h reproduced a known Johor route
// (Ulu Tiram -> Taman Desa Tebrau) at 18 min against Google's 17.
const ROAD_WINDING_FACTOR = 1.4;
const ASSUMED_KMH = 40;

// Last-resort coordinates for the postcodes this business actually operates
// in, mirroring the table PlanningMap already relies on. Lets an estimate be
// produced even with no geocoding service reachable at all.
const POSTCODE_FALLBACKS: Record<string, Coordinates> = {
  "43300": { lat: 3.026, lng: 101.706 }, // Seri Kembangan
  "79100": { lat: 1.423, lng: 103.635 }, // Iskandar Puteri
  "81000": { lat: 1.656, lng: 103.603 }, // Kulai
  "81100": { lat: 1.56, lng: 103.75 }, // Johor Bahru
  "81200": { lat: 1.5, lng: 103.7 }, // Johor Bahru
  "81300": { lat: 1.537, lng: 103.657 }, // Skudai
  "81700": { lat: 1.461, lng: 103.899 }, // Pasir Gudang
  "81750": { lat: 1.485, lng: 103.886 }, // Masai
  "81800": { lat: 1.599, lng: 103.817 }, // Ulu Tiram
  "83000": { lat: 1.855, lng: 102.933 }, // Batu Pahat
  "83700": { lat: 2.014, lng: 103.065 }, // Yong Peng
  "86000": { lat: 2.031, lng: 103.318 }, // Kluang
};

function orsKey() {
  return process.env.ORS_API_KEY?.trim() || null;
}

function toPair(point: Coordinates): [number, number] {
  return [point.lng, point.lat];
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/* ------------------------------- geocoding ------------------------------- */

// Addresses change rarely but are resubmitted on every recalculation, so
// caching by exact text keeps repeat clicks off the rate limits entirely.
// Process-local on purpose: a restart re-geocodes, which stops a stale
// coordinate outliving a corrected address.
const geocodeCache = new Map<string, { point: Coordinates; method: GeocodeMethod }>();
let lastNominatimCall = 0;

async function geocodeViaOrs(address: string, key: string) {
  const query = new URLSearchParams({
    api_key: key,
    text: address,
    "boundary.country": "MY",
    size: "1",
  });
  const response = await fetch(`${ORS_BASE}/geocode/search?${query}`, {
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) return null;
  const payload = (await response.json()) as {
    features?: Array<{ geometry?: { coordinates?: [number, number] } }>;
  };
  const pair = payload.features?.[0]?.geometry?.coordinates;
  return pair ? { lat: pair[1], lng: pair[0] } : null;
}

async function geocodeViaNominatim(address: string) {
  // Serialised, not parallel: the policy is one request per second and a burst
  // gets the whole dashboard temporarily blocked rather than just throttled.
  const waitFor = lastNominatimCall + NOMINATIM_MIN_GAP_MS - Date.now();
  if (waitFor > 0) await sleep(waitFor);
  lastNominatimCall = Date.now();

  const query = new URLSearchParams({
    q: address,
    format: "jsonv2",
    limit: "1",
    countrycodes: "my",
  });
  const response = await fetch(`${NOMINATIM_BASE}/search?${query}`, {
    headers: { "User-Agent": USER_AGENT, "Accept-Language": "en-MY,en" },
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) return null;
  const results = (await response.json()) as Array<{ lat: string; lon: string }>;
  return results[0]
    ? { lat: Number(results[0].lat), lng: Number(results[0].lon) }
    : null;
}

function geocodeViaPostcode(address: string) {
  // Any 5-digit run in the address is a Malaysian postcode.
  const matches = address.match(/\b\d{5}\b/g);
  for (const code of matches ?? []) {
    const hit = POSTCODE_FALLBACKS[code];
    if (hit) return hit;
  }
  return null;
}

export async function geocodeAddress(
  address: string,
): Promise<{ point: Coordinates; method: GeocodeMethod }> {
  const cacheKey = address.trim().toLowerCase();
  if (!cacheKey) throw new RoutingError("Cannot look up an empty address.");

  const cached = geocodeCache.get(cacheKey);
  if (cached) return cached;

  const key = orsKey();
  const attempts: Array<[GeocodeMethod, () => Promise<Coordinates | null>]> = [
    ...(key
      ? ([["openrouteservice", () => geocodeViaOrs(address, key)]] as Array<
          [GeocodeMethod, () => Promise<Coordinates | null>]
        >)
      : []),
    ["nominatim", () => geocodeViaNominatim(address)],
    ["postcode", async () => geocodeViaPostcode(address)],
  ];

  for (const [method, run] of attempts) {
    try {
      const point = await run();
      if (point) {
        const result = { point, method };
        geocodeCache.set(cacheKey, result);
        return result;
      }
    } catch {
      // Try the next source rather than failing the whole run on one outage.
    }
  }

  throw new RoutingError(
    `Could not find "${address}". Check the address — a missing postcode or ` +
      "a typo is the usual cause.",
  );
}

/* ------------------------------- durations ------------------------------- */

function haversineKm(from: Coordinates, to: Coordinates) {
  const radius = 6371;
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = toRad(to.lat - from.lat);
  const dLng = toRad(to.lng - from.lng);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(from.lat)) *
      Math.cos(toRad(to.lat)) *
      Math.sin(dLng / 2) ** 2;
  return 2 * radius * Math.asin(Math.sqrt(h));
}

function straightLineSeconds(points: Coordinates[]) {
  const legs: number[] = [];
  for (let i = 0; i < points.length - 1; i += 1) {
    const km = haversineKm(points[i], points[i + 1]) * ROAD_WINDING_FACTOR;
    legs.push((km / ASSUMED_KMH) * 3600);
  }
  return legs;
}

// Pulls the consecutive hops out of a full N x N duration matrix:
// points[0]->points[1], points[1]->points[2], ...
function consecutiveFromMatrix(matrix: Array<Array<number | null>>, count: number) {
  const legs: number[] = [];
  for (let i = 0; i < count - 1; i += 1) {
    const seconds = matrix[i]?.[i + 1];
    // null means the two points could not be connected by road — an address
    // geocoded onto an island, a pedestrian-only lane, and so on.
    if (seconds === null || seconds === undefined) return null;
    legs.push(seconds);
  }
  return legs;
}

async function durationsViaOrs(points: Coordinates[], key: string) {
  const response = await fetch(`${ORS_BASE}/v2/matrix/driving-car`, {
    method: "POST",
    headers: { Authorization: key, "Content-Type": "application/json" },
    body: JSON.stringify({
      locations: points.map(toPair),
      metrics: ["duration"],
    }),
    signal: AbortSignal.timeout(20_000),
  });
  if (!response.ok) return null;
  const payload = (await response.json()) as {
    durations?: Array<Array<number | null>>;
  };
  return payload.durations
    ? consecutiveFromMatrix(payload.durations, points.length)
    : null;
}

async function durationsViaOsrm(points: Coordinates[]) {
  const path = points.map((point) => toPair(point).join(",")).join(";");
  const response = await fetch(
    `${OSRM_BASE}/table/v1/driving/${path}?annotations=duration`,
    { headers: { "User-Agent": USER_AGENT }, signal: AbortSignal.timeout(20_000) },
  );
  if (!response.ok) return null;
  const payload = (await response.json()) as {
    code?: string;
    durations?: Array<Array<number | null>>;
  };
  if (payload.code !== "Ok" || !payload.durations) return null;
  return consecutiveFromMatrix(payload.durations, points.length);
}

export async function drivingLegSeconds(
  points: Coordinates[],
): Promise<{ seconds: number[]; method: RouteMethod }> {
  if (points.length < 2) return { seconds: [], method: "straight-line" };

  const key = orsKey();
  const attempts: Array<[RouteMethod, () => Promise<number[] | null>]> = [
    ...(key
      ? ([["openrouteservice", () => durationsViaOrs(points, key)]] as Array<
          [RouteMethod, () => Promise<number[] | null>]
        >)
      : []),
    ["osrm", () => durationsViaOsrm(points)],
  ];

  for (const [method, run] of attempts) {
    try {
      const seconds = await run();
      if (seconds) return { seconds, method };
    } catch {
      // Fall through to the next provider.
    }
  }

  // Nothing reachable — an approximation beats no schedule at all, and the
  // method is reported so it is never mistaken for a real route.
  return { seconds: straightLineSeconds(points), method: "straight-line" };
}

export const ROUTE_METHOD_LABELS: Record<RouteMethod, string> = {
  openrouteservice: "road routing",
  osrm: "road routing (OSRM)",
  "straight-line": "rough estimate — straight-line distance, not road routing",
};
