"use client";

import * as React from "react";
import { Input } from "@/components/ui/input";

/**
 * Map point-picking core shared by the locations form (MapPicker wrapper)
 * and the location-picker dialog: a search box (Geocoding text search), a
 * map canvas (click to pin, drag to fine-tune) and a status hint. Every
 * pick fires onPick with the rounded point and the geocoder's address
 * components (present for search picks, reverse-geocoded for clicks).
 * Consumers decide what a pick means (fill form fields / confirm a value).
 */

const API_KEY = process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY;

/** Bay Area yard as the neutral opening view */
export const DEFAULT_CENTER = { lat: 37.6688, lng: -122.0808 };

/** decimal(9,6) resolution */
export function round6(value: number): number {
  return Math.round(value * 1e6) / 1e6;
}

export type MapPoint = { lat: number; lng: number };

export type MapPick = MapPoint & {
  /** Geocoder components for the picked point (best-effort on click picks) */
  components: google.maps.GeocoderAddressComponent[];
  /** formatted_address of the resolved result, when one exists */
  label?: string;
};

type SearchHit = {
  lat: number;
  lng: number;
  label: string;
  components: google.maps.GeocoderAddressComponent[];
};

// One SDK load shared across mounts (dialogs open per row) and across HMR
// swaps (module state resets, the script tag / window.google stay)
let sdkPromise: Promise<void> | null = null;

// loading=async contract: readiness is announced through the callback param,
// NOT the script load event (maps.Map may still be undefined on load)
const READY_CALLBACK = "__ggMapsReady";

declare global {
  interface Window {
    [READY_CALLBACK]?: () => void;
  }
}

function loadMapsSdk(): Promise<void> {
  if (!sdkPromise) {
    sdkPromise = new Promise((resolve, reject) => {
      if (window.google?.maps) {
        resolve();
        return;
      }
      window[READY_CALLBACK] = () => resolve();
      // Reuse a script another module instance already injected (HMR); the
      // callback global above is re-registered before Google fires it
      const existing = document.getElementById("google-maps-js") as HTMLScriptElement | null;
      if (!existing) {
        const script = document.createElement("script");
        script.id = "google-maps-js";
        script.src = `https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(API_KEY ?? "")}&v=weekly&loading=async&callback=${READY_CALLBACK}`;
        script.async = true;
        script.onerror = () => {
          // Allow a later mount to retry after a transient failure
          sdkPromise = null;
          reject(new Error("Maps SDK failed to load"));
        };
        document.head.appendChild(script);
      }
    });
  }
  return sdkPromise;
}

/** Hint state the host renders into (or overrides via hintFor) */
export type MapHintState = {
  picked: boolean;
  resolving: boolean;
  point: MapPoint | null;
  /** formatted_address of the latest pick, when the geocoder returned one */
  label?: string;
};

export function MapPointPicker({
  initialLat,
  initialLng,
  heightClass = "h-72",
  hintFor,
  onPick
}: {
  /** Saved coordinates to open on; null opens on the default view */
  initialLat?: number | null;
  initialLng?: number | null;
  /** Canvas height; the in-form embed keeps h-72, dialogs can go slimmer */
  heightClass?: string;
  /** Override the default status hint (hosts with different pick semantics) */
  hintFor?: (state: MapHintState) => string;
  /** Fired on search picks, map clicks and marker drags */
  onPick: (pick: MapPick) => void;
}) {
  const hasInitial =
    typeof initialLat === "number" && typeof initialLng === "number";
  const mapDivRef = React.useRef<HTMLDivElement | null>(null);
  const mapRef = React.useRef<google.maps.Map | null>(null);
  const geocoderRef = React.useRef<google.maps.Geocoder | null>(null);
  const markerRef = React.useRef<google.maps.Marker | null>(null);
  // Missing key is render-time derived; only load failure needs state
  const [loadFailed, setLoadFailed] = React.useState(false);
  const unavailable = !API_KEY || loadFailed;
  const [point, setPoint] = React.useState<MapPoint | null>(
    hasInitial ? { lat: initialLat!, lng: initialLng! } : null
  );
  const [picked, setPicked] = React.useState(false);
  const [resolving, setResolving] = React.useState(false);
  const [label, setLabel] = React.useState<string | undefined>(undefined);
  const [query, setQuery] = React.useState("");
  const [hits, setHits] = React.useState<SearchHit[]>([]);
  const [searching, setSearching] = React.useState(false);

  // Latest-picker ref so map listeners (added once) always call a fresh fn;
  // assigned in an effect because the body only touches refs and setters
  const pickRef = React.useRef<(latLng: google.maps.LatLng, hit?: SearchHit) => void>(() => {});
  React.useEffect(() => {
    pickRef.current = (latLng, hit) => {
      const next = { lat: round6(latLng.lat()), lng: round6(latLng.lng()) };
      if (!markerRef.current) {
        markerRef.current = new google.maps.Marker({
          map: mapRef.current,
          draggable: true
        });
        markerRef.current.addListener("dragend", () => {
          const position = markerRef.current?.getPosition();
          // Drag only re-pins; dragend reuses the full pick (reverse geocode)
          if (position) pickRef.current(position);
        });
      }
      markerRef.current.setPosition(latLng);
      setPoint(next);
      setPicked(true);
      setLabel(hit?.label);

      if (hit) {
        // Search hit: components already in hand, no extra geocode round trip
        onPick({ ...next, components: hit.components, label: hit.label });
        return;
      }
      // Map click / marker drag: reverse geocode the point
      if (!geocoderRef.current) return;
      setResolving(true);
      geocoderRef.current
        .geocode({ location: latLng })
        .then(res => {
          const best = res.results[0];
          setLabel(best?.formatted_address);
          onPick({
            ...next,
            components: best?.address_components ?? [],
            label: best?.formatted_address
          });
        })
        .catch(() => {
          // Best-effort: the point still carries coordinates
          onPick({ ...next, components: [] });
        })
        .finally(() => setResolving(false));
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  React.useEffect(() => {
    if (!API_KEY) return;
    let cancelled = false;
    loadMapsSdk()
      .then(() => {
        if (cancelled || !mapDivRef.current) return;
        const map = new google.maps.Map(mapDivRef.current, {
          center: hasInitial ? { lat: initialLat!, lng: initialLng! } : DEFAULT_CENTER,
          zoom: hasInitial ? 14 : 10,
          mapTypeControl: false,
          streetViewControl: false,
          fullscreenControl: false,
          // Clicks pick the point itself, never the POI icon under it
          clickableIcons: false
        });
        mapRef.current = map;
        geocoderRef.current = new google.maps.Geocoder();
        map.addListener("click", (event: google.maps.MapMouseEvent) => {
          if (event.latLng) pickRef.current(event.latLng);
        });
        if (hasInitial) {
          markerRef.current = new google.maps.Marker({
            map,
            position: { lat: initialLat!, lng: initialLng! },
            draggable: true
          });
          markerRef.current.addListener("dragend", () => {
            const position = markerRef.current?.getPosition();
            if (position) pickRef.current(position);
          });
        }
      })
      .catch(() => {
        if (!cancelled) setLoadFailed(true);
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Debounced address search via the Geocoding text endpoint. Short queries
  // just stop the timer; the dropdown is derived off the trimmed query.
  React.useEffect(() => {
    if (query.trim().length < 3) return;
    const timer = window.setTimeout(() => {
      if (!geocoderRef.current) return;
      setSearching(true);
      setHits([]);
      geocoderRef.current
        .geocode({ address: query.trim() })
        .then(res => {
          setHits(
            res.results.slice(0, 5).map(r => ({
              lat: r.geometry.location.lat(),
              lng: r.geometry.location.lng(),
              label: r.formatted_address,
              components: r.address_components
            }))
          );
        })
        .catch(() => setHits([]))
        .finally(() => setSearching(false));
    }, 400);
    return () => window.clearTimeout(timer);
  }, [query]);

  function chooseHit(hit: SearchHit) {
    setQuery("");
    setHits([]);
    const latLng = new google.maps.LatLng(hit.lat, hit.lng);
    mapRef.current?.panTo(latLng);
    mapRef.current?.setZoom(15);
    pickRef.current(latLng, hit);
  }

  if (unavailable) {
    return (
      <p className="rounded-md border border-line bg-card px-3 py-2 text-xs text-muted-foreground">
        地图选点不可用（NEXT_PUBLIC_GOOGLE_MAPS_API_KEY 未配置，或 Maps JavaScript / Geocoding API 未开通）；地址可直接手填。
      </p>
    );
  }

  const defaultHint = resolving
    ? "解析地址中…"
    : point && picked
      ? `坐标 ${point.lat}, ${point.lng} · 已回填街道 / 城市 / 州 / 邮编（可手改）`
      : point
        ? `已保存坐标 ${point.lat}, ${point.lng} · 点击地图或搜索可重新选点`
        : "搜索地址或点击地图选点，选点后自动回填地址字段";
  const hint = hintFor
    ? hintFor({ picked, resolving, point, label })
    : defaultHint;

  return (
    <div className="grid gap-2">
      <div className="relative">
        <Input
          type="search"
          value={query}
          onChange={e => setQuery(e.target.value)}
          placeholder="搜索地址定位，或直接点地图选点"
          aria-label="搜索地址"
          className="h-9 bg-card text-[13px]"
        />
        {query.trim().length >= 3 && (searching || hits.length > 0) && (
          <ul className="absolute inset-x-0 top-full z-10 mt-1 overflow-hidden rounded-md border border-line bg-card shadow-sm">
            {searching && hits.length === 0 && (
              <li className="px-3 py-2 text-xs text-muted-foreground">搜索中…</li>
            )}
            {hits.map(hit => (
              <li key={`${hit.lat},${hit.lng}`}>
                <button
                  type="button"
                  className="block w-full px-3 py-2 text-left text-[13px] hover:bg-accent"
                  onClick={() => chooseHit(hit)}
                >
                  {hit.label}
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
      <div
        ref={mapDivRef}
        role="application"
        aria-label="地图选点"
        className={`${heightClass} rounded-md border border-line bg-muted`}
      />
      <p className="text-xs text-muted-foreground">{hint}</p>
    </div>
  );
}
