import { NextResponse, type NextRequest } from "next/server";
import { forbidApi } from "@/lib/permissions";
import { fullAddress } from "@/lib/format";
import { drivingMiles } from "@/lib/google-maps";
import { getLocationById } from "@/lib/queries/locations";

/**
 * GET /api/distance?from=<endpoint>&to=<endpoint> -> { miles: number | null }
 * Endpoint protocol: "loc:<locationId>" for saved locations (geocoded via the
 * stored address) or "txt:<free text>" (typed as-is - a zip or address that
 * Google resolves directly). Map-picked text carries a "|geo:…" payload
 * suffix which is stripped before geocoding.
 */
async function resolveEndpoint(value: string): Promise<string> {
  if (value.startsWith("loc:")) {
    const id = value.slice(4);
    if (!/^\d+$/.test(id)) return "";
    const location = await getLocationById(id);
    return location ? fullAddress(location) : "";
  }
  if (value.startsWith("txt:")) {
    const text = value.slice(4);
    const at = text.indexOf("|geo:");
    return (at >= 0 ? text.slice(0, at) : text).trim();
  }
  return "";
}

export async function GET(request: NextRequest) {
  // Entry-time helper: only accounts that may enter trips
  const denied = await forbidApi("trip.write");
  if (denied) return denied;

  const fromParam = request.nextUrl.searchParams.get("from")?.trim() ?? "";
  const toParam = request.nextUrl.searchParams.get("to")?.trim() ?? "";
  if (!fromParam || !toParam) {
    return NextResponse.json({ error: "bad_request" }, { status: 400 });
  }

  const [origin, destination] = await Promise.all([resolveEndpoint(fromParam), resolveEndpoint(toParam)]);
  if (!origin || !destination) {
    return NextResponse.json({ error: "missing_address" }, { status: 422 });
  }

  // Miles are ledgered as integers: round the measured distance so both the
  // entry sheet and the detail editor display exactly what gets stored
  const rawMiles = await drivingMiles(origin, destination);
  const miles = rawMiles === null ? null : Math.round(rawMiles);
  return NextResponse.json({ miles });
}
