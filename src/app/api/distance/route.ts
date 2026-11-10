import { NextResponse, type NextRequest } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { fullAddress } from "@/lib/format";
import { drivingMiles } from "@/lib/google-maps";
import { getLocationById } from "@/lib/queries/locations";

/** GET /api/distance?from=<locationId>&to=<locationId> -> { miles: number | null } */
export async function GET(request: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const fromId = request.nextUrl.searchParams.get("from")?.trim() ?? "";
  const toId = request.nextUrl.searchParams.get("to")?.trim() ?? "";
  if (!/^\d+$/.test(fromId) || !/^\d+$/.test(toId)) {
    return NextResponse.json({ error: "bad_request" }, { status: 400 });
  }

  const [from, to] = await Promise.all([getLocationById(fromId), getLocationById(toId)]);
  const origin = from ? fullAddress(from) : "";
  const destination = to ? fullAddress(to) : "";
  if (!origin || !destination) {
    return NextResponse.json({ error: "missing_address" }, { status: 422 });
  }

  const miles = await drivingMiles(origin, destination);
  return NextResponse.json({ miles });
}
