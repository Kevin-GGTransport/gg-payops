import "server-only";

const METERS_PER_MILE = 1609.344;

type MatrixResponse = {
  status: string;
  rows?: Array<{
    elements?: Array<{
      status: string;
      distance?: { value?: number };
    }>;
  }>;
};

/**
 * Driving distance in miles between two free-form addresses, via the
 * Google Distance Matrix API. Returns null on any failure (missing key,
 * network error, unresolvable address) so callers fall back to manual entry.
 * The key is the one NEXT_PUBLIC var shared with the browser map (Distance
 * Matrix server-side + Maps JS client-side can be the same key).
 */
export async function drivingMiles(origin: string, destination: string): Promise<number | null> {
  const key = process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY;
  if (!key || !origin.trim() || !destination.trim()) return null;

  try {
    const params = new URLSearchParams({ origins: origin, destinations: destination, key });
    const res = await fetch(`https://maps.googleapis.com/maps/api/distancematrix/json?${params}`, {
      signal: AbortSignal.timeout(8000)
    });
    if (!res.ok) return null;

    const data: MatrixResponse = await res.json();
    const meters = data.rows?.[0]?.elements?.[0]?.distance?.value;
    if (data.status !== "OK" || typeof meters !== "number" || meters <= 0) return null;

    return Math.round((meters / METERS_PER_MILE) * 10) / 10;
  } catch {
    return null;
  }
}
