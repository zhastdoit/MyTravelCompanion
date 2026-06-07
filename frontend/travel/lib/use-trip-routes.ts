"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { Feature, FeatureCollection, LineString } from "geojson";
import { ACTIVITY_TYPES, type CalendarBlock } from "@/types/trip";

/**
 * Per-day routing built from `calendar_blocks`. We group same-day blocks,
 * call Mapbox Directions per consecutive pair, and surface both an aggregate
 * GeoJSON FeatureCollection (for the map layer) and a structured per-day
 * summary (for the timeline's distance/duration totals).
 *
 * Mapbox free tier covers 100k Directions calls/month; we keep usage low by
 * memoizing per (origin-id, destination-id, profile) key in sessionStorage so
 * day-to-day re-renders don't burn the quota.
 */
export type RouteProfile = "walking" | "driving-traffic";

export interface RouteLeg {
  fromBlockId: string;
  toBlockId: string;
  distanceM: number;
  durationS: number;
  profile: RouteProfile;
  geometry: LineString;
}

export interface DayRoute {
  date: string;          // ISO YYYY-MM-DD
  dayIndex: number;      // 0-based, ordered by date
  legs: RouteLeg[];
  totalDistanceM: number;
  totalDurationS: number;
}

export interface UseTripRoutesResult {
  routes: DayRoute[];
  geojson: FeatureCollection<LineString, RouteFeatureProps>;
  isLoading: boolean;
  error: string | null;
}

export interface RouteFeatureProps {
  dayIndex: number;
  profile: RouteProfile;
  fromBlockId: string;
  toBlockId: string;
  distanceM: number;
  durationS: number;
}

const EMPTY_COLLECTION: FeatureCollection<LineString, RouteFeatureProps> = {
  type: "FeatureCollection",
  features: [],
};

const WALKING_THRESHOLD_M = 2_000;          // ≤2 km on foot, otherwise drive
const SESSION_CACHE_KEY = "synctrip:routes:v1";
const EARTH_RADIUS_M = 6_371_000;
const TOKEN = process.env.NEXT_PUBLIC_MAPBOX_TOKEN;

const haversineMeters = (a: [number, number], b: [number, number]): number => {
  const [lng1, lat1] = a;
  const [lng2, lat2] = b;
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const sinDLat = Math.sin(dLat / 2);
  const sinDLng = Math.sin(dLng / 2);
  const aHarv =
    sinDLat * sinDLat +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * sinDLng * sinDLng;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(aHarv)));
};

const profileFor = (distanceM: number): RouteProfile =>
  distanceM <= WALKING_THRESHOLD_M ? "walking" : "driving-traffic";

const groupBlocksByDay = (
  blocks: CalendarBlock[],
): Array<{ date: string; blocks: CalendarBlock[] }> => {
  const groups = new Map<string, CalendarBlock[]>();
  for (const block of blocks) {
    if (block.type === ACTIVITY_TYPES.TRANSIT) continue;
    const date = block.timestamp_start.slice(0, 10);
    const list = groups.get(date);
    if (list) list.push(block);
    else groups.set(date, [block]);
  }
  return Array.from(groups.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, list]) => ({
      date,
      blocks: [...list].sort((a, b) =>
        a.timestamp_start.localeCompare(b.timestamp_start),
      ),
    }));
};

interface CachedLeg {
  geometry: LineString;
  distanceM: number;
  durationS: number;
  profile: RouteProfile;
}

const readSessionCache = (): Map<string, CachedLeg> => {
  if (typeof window === "undefined") return new Map();
  try {
    const raw = window.sessionStorage.getItem(SESSION_CACHE_KEY);
    if (!raw) return new Map();
    const parsed = JSON.parse(raw) as Record<string, CachedLeg>;
    return new Map(Object.entries(parsed));
  } catch {
    return new Map();
  }
};

const persistSessionCache = (cache: Map<string, CachedLeg>) => {
  if (typeof window === "undefined") return;
  try {
    const obj: Record<string, CachedLeg> = {};
    cache.forEach((value, key) => {
      obj[key] = value;
    });
    window.sessionStorage.setItem(SESSION_CACHE_KEY, JSON.stringify(obj));
  } catch {
    // Storage quota or disabled — silently degrade.
  }
};

const straightLineLeg = (
  from: CalendarBlock,
  to: CalendarBlock,
  profile: RouteProfile,
  distanceM: number,
): CachedLeg => ({
  profile,
  distanceM,
  // Rough estimate when Mapbox isn't reachable: 5 km/h walking, 30 km/h driving.
  durationS: distanceM / (profile === "walking" ? 1.4 : 8.3),
  geometry: {
    type: "LineString",
    coordinates: [from.coordinates, to.coordinates],
  },
});

const fetchDirections = async (
  from: CalendarBlock,
  to: CalendarBlock,
  profile: RouteProfile,
  signal: AbortSignal,
): Promise<CachedLeg> => {
  if (!TOKEN) {
    return straightLineLeg(from, to, profile, haversineMeters(from.coordinates, to.coordinates));
  }
  const coords = `${from.coordinates[0]},${from.coordinates[1]};${to.coordinates[0]},${to.coordinates[1]}`;
  const params = new URLSearchParams({
    geometries: "geojson",
    overview: "full",
    access_token: TOKEN,
  });
  const url = `https://api.mapbox.com/directions/v5/mapbox/${profile}/${coords}?${params}`;
  try {
    const res = await fetch(url, { signal });
    if (!res.ok) {
      throw new Error(`mapbox ${res.status}`);
    }
    const data = (await res.json()) as {
      routes?: Array<{
        geometry: LineString;
        distance: number;
        duration: number;
      }>;
    };
    const route = data.routes?.[0];
    if (!route) {
      throw new Error("no route returned");
    }
    return {
      geometry: route.geometry,
      distanceM: route.distance,
      durationS: route.duration,
      profile,
    };
  } catch (err) {
    if ((err as Error).name === "AbortError") throw err;
    return straightLineLeg(from, to, profile, haversineMeters(from.coordinates, to.coordinates));
  }
};

const cacheKey = (
  profile: RouteProfile,
  from: CalendarBlock,
  to: CalendarBlock,
): string => `${profile}|${from.id}|${to.id}`;

/**
 * React hook: routes between consecutive same-day blocks.
 *
 * Returns memoized `DayRoute[]` + an aggregate GeoJSON FeatureCollection with
 * `dayIndex` / `profile` / `distanceM` / `durationS` properties on each
 * feature so the Mapbox layer can style by day and the timeline can read
 * distances back without a second hook call.
 */
export const useTripRoutes = (blocks: CalendarBlock[]): UseTripRoutesResult => {
  const grouped = useMemo(() => groupBlocksByDay(blocks), [blocks]);
  const cacheRef = useRef<Map<string, CachedLeg> | null>(null);
  const [routes, setRoutes] = useState<DayRoute[]>([]);
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);

  if (cacheRef.current === null) {
    cacheRef.current = readSessionCache();
  }

  useEffect(() => {
    const cache = cacheRef.current!;
    const controller = new AbortController();
    let cancelled = false;

    if (grouped.length === 0) {
      setRoutes([]);
      setIsLoading(false);
      setError(null);
      return () => controller.abort();
    }

    const compute = async () => {
      setIsLoading(true);
      setError(null);
      try {
        const dayRoutes = await Promise.all(
          grouped.map(async ({ date, blocks: dayBlocks }, dayIndex) => {
            const legs: RouteLeg[] = [];
            for (let i = 0; i < dayBlocks.length - 1; i += 1) {
              const from = dayBlocks[i];
              const to = dayBlocks[i + 1];
              const distance = haversineMeters(from.coordinates, to.coordinates);
              const profile = profileFor(distance);
              const key = cacheKey(profile, from, to);
              let leg = cache.get(key);
              if (!leg) {
                leg = await fetchDirections(from, to, profile, controller.signal);
                cache.set(key, leg);
              }
              legs.push({
                fromBlockId: from.id,
                toBlockId: to.id,
                distanceM: leg.distanceM,
                durationS: leg.durationS,
                profile: leg.profile,
                geometry: leg.geometry,
              });
            }
            return {
              date,
              dayIndex,
              legs,
              totalDistanceM: legs.reduce((sum, l) => sum + l.distanceM, 0),
              totalDurationS: legs.reduce((sum, l) => sum + l.durationS, 0),
            } satisfies DayRoute;
          }),
        );
        if (cancelled) return;
        persistSessionCache(cache);
        setRoutes(dayRoutes);
      } catch (err) {
        if ((err as Error).name === "AbortError") return;
        if (!cancelled) {
          setError(err instanceof Error ? err.message : String(err));
          setRoutes([]);
        }
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    };

    void compute();

    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [grouped]);

  const geojson = useMemo<FeatureCollection<LineString, RouteFeatureProps>>(() => {
    if (routes.length === 0) return EMPTY_COLLECTION;
    const features: Feature<LineString, RouteFeatureProps>[] = [];
    for (const day of routes) {
      for (const leg of day.legs) {
        features.push({
          type: "Feature",
          geometry: leg.geometry,
          properties: {
            dayIndex: day.dayIndex,
            profile: leg.profile,
            fromBlockId: leg.fromBlockId,
            toBlockId: leg.toBlockId,
            distanceM: leg.distanceM,
            durationS: leg.durationS,
          },
        });
      }
    }
    return { type: "FeatureCollection", features };
  }, [routes]);

  return { routes, geojson, isLoading, error };
};
