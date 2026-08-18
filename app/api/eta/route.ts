import { NextResponse } from "next/server";
import { z } from "zod";
import {
  drivingLegSeconds,
  geocodeAddress,
  RoutingError,
  type Coordinates,
  type GeocodeMethod,
  type RouteMethod,
} from "@/lib/routing";

export const dynamic = "force-dynamic";

// Minutes on site per stop — unloading, signatures, getting back on the road.
// Applied between stops, never after the last one. A rough figure by nature;
// change it here and every run's chain shifts with it.
const UNLOAD_MINUTES = 20;

const requestSchema = z.object({
  warehouseAddress: z.string().min(1),
  deliveryDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  departureTime: z.string().regex(/^\d{2}:\d{2}$/),
  // Delivery order — the lorry visits these in array order, which is what
  // makes the chain cumulative rather than each stop standing alone.
  stops: z
    .array(z.object({ jobId: z.string().min(1), address: z.string().min(1) }))
    .min(1),
});

// All clock maths is done in plain minutes and formatted by hand. Going
// through Date for the time-of-day would drag the server's timezone into a
// calculation that is entirely in Malaysia local time, which shifts every
// ETA by the offset between them.
function addDaysToDate(isoDate: string, dayOffset: number): string {
  const [year, month, day] = isoDate.split("-").map(Number);
  // UTC, so adding days can never land on a DST boundary and slip an hour.
  const shifted = new Date(Date.UTC(year, month - 1, day + dayOffset));
  return shifted.toISOString().slice(0, 10);
}

function formatClock(totalMinutes: number) {
  const minutesInDay = ((totalMinutes % 1440) + 1440) % 1440;
  const hours = Math.floor(minutesInDay / 60);
  const minutes = minutesInDay % 60;
  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}`;
}

export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const parsed = requestSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid request.", details: parsed.error.flatten() },
      { status: 400 },
    );
  }

  const { warehouseAddress, deliveryDate, departureTime, stops } = parsed.data;

  try {
    // Sequential, not parallel: the free geocoders rate-limit per second and a
    // burst trips the limit for the whole run. Repeat clicks are served from
    // cache, so this only costs on the first calculation for a set of addresses.
    const points: Coordinates[] = [];
    const geocodeMethods: GeocodeMethod[] = [];

    for (const address of [warehouseAddress, ...stops.map((s) => s.address)]) {
      const located = await geocodeAddress(address);
      points.push(located.point);
      geocodeMethods.push(located.method);
    }

    const { seconds: legSeconds, method } = await drivingLegSeconds(points);

    const [departHours, departMinutes] = departureTime.split(":").map(Number);
    let clock = departHours * 60 + departMinutes;

    const results = stops.map((stop, index) => {
      const driveMinutes = Math.round(legSeconds[index] / 60);
      // Arrive, and only then start the next leg's clock — so the unload sits
      // between this stop and the next, never after the final one.
      clock += driveMinutes;
      const arrival = clock;
      clock += UNLOAD_MINUTES;

      return {
        jobId: stop.jobId,
        arrivalDate: addDaysToDate(deliveryDate, Math.floor(arrival / 1440)),
        arrivalTime: formatClock(arrival),
        driveMinutes,
      };
    });

    return NextResponse.json({
      stops: results,
      unloadMinutes: UNLOAD_MINUTES,
      method,
      // Surfaced so a stop that only resolved to a postcode centroid — i.e. the
      // town, not the house — is visible rather than quietly inflating accuracy.
      approximateAddresses: stops
        .filter((_, index) => geocodeMethods[index + 1] === "postcode")
        .map((stop) => stop.address),
    });
  } catch (error) {
    if (error instanceof RoutingError) {
      // Address problems are the user's to fix and the message names the exact
      // address that failed — surface it rather than a generic 500.
      return NextResponse.json({ error: error.message }, { status: 422 });
    }
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? `ETA calculation failed: ${error.message}`
            : "ETA calculation failed.",
      },
      { status: 500 },
    );
  }
}
