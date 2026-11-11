import { NextResponse, type NextRequest } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { fullAddress } from "@/lib/format";
import { drivingMiles } from "@/lib/google-maps";
import { getLocationById } from "@/lib/queries/locations";

/**
 * GET /api/distance?from=<endpoint>&to=<endpoint> -> { miles: number | null }
 * Endpoint protocol: "loc:<locationId>" for saved locations (geocoded via the
 * stored address) or "txt:<free text>" (typed as-is - a zip or address that
 * Google resolves directly).
 */
async function resolveEndpoint(value: string): Promise<string> {
  if (value.startsWith("loc:")) {
    const id = value.slice(4);
    if (!/^\d+$/.test(id)) return "";
    const location = await getLocationById(id);
    return location ? fullAddress(location) : "";
  }
  if (value.startsWith("txt:")) return value.slice(4).trim();
  return "";
}

export async function GET(request: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const fromParam = request.nextUrl.searchParams.get("from")?.trim() ?? "";
  const toParam = request.nextUrl.searchParams.get("to")?.trim() ?? "";
  if (!fromParam || !toParam) {
    return NextResponse.json({ error: "bad_request" }, { status: 400 });
  }

  const [origin, destination] = await Promise.all([resolveEndpoint(fromParam), resolveEndpoint(toParam)]);
  if (!origin || !destination) {
    return NextResponse.json({ error: "missing_address" }, { status: 422 });
  }

  const miles = await drivingMiles(origin, destination);
  return NextResponse.json({ miles });
}
