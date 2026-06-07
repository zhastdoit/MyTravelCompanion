"use client";

import { useEffect, useMemo, useRef } from "react";
import MapboxMap, {
  Layer,
  Marker,
  NavigationControl,
  Source,
  type MapRef,
} from "react-map-gl/mapbox";
import type { ExpressionSpecification } from "mapbox-gl";
import { MapPinned } from "lucide-react";
import "mapbox-gl/dist/mapbox-gl.css";
import { ACTIVITY_TYPES, type CalendarBlock } from "@/types/trip";
import { cn } from "@/lib/utils";
import { useTripRoutes } from "@/lib/use-trip-routes";

interface TripMapProps {
  blocks: CalendarBlock[];
  className?: string;
  /** When set, only this date's blocks are bounded/markered. Routes still
   *  belong to the same date (the routes hook groups by day internally). */
  selectedDate?: string;
  /** Block id currently highlighted (synced with the itinerary list). */
  highlightedId?: string | null;
  /** Fired when a marker is clicked, to highlight its itinerary stop. */
  onSelectBlock?: (id: string) => void;
}

const FALLBACK_VIEW = { longitude: 2.3522, latitude: 48.8566, zoom: 11 };

// Per-day route palette. Walking legs render dashed, driving legs solid; both
// share the same hue so the user reads color = day, dash-style = mode.
const DAY_PALETTE = ["#2563eb", "#db2777", "#16a34a", "#ea580c", "#7c3aed",
                     "#0891b2", "#dc2626"] as const;

interface BlockMarkerInfo {
  dayIndex: number;     // 0-based, unfiltered (so "Day 2" stays Day 2 when filtered)
  localIndex: number;   // 1-based per-day stop number
}

export const TripMap = ({
  blocks,
  className,
  selectedDate,
  highlightedId,
  onSelectBlock,
}: TripMapProps) => {
  const token = process.env.NEXT_PUBLIC_MAPBOX_TOKEN;
  const mapRef = useRef<MapRef | null>(null);
  const { geojson } = useTripRoutes(blocks);

  // Markers + bounding box are derived from non-TRANSIT blocks only — flight
  // pins live at far-away airports and would explode the fitBounds box.
  const visibleBlocks = useMemo(
    () =>
      blocks.filter((b) => {
        if (b.type === ACTIVITY_TYPES.TRANSIT) return false;
        if (selectedDate && b.timestamp_start.slice(0, 10) !== selectedDate) {
          return false;
        }
        return true;
      }),
    [blocks, selectedDate],
  );

  // Per-day metadata keyed by block id: stable across filter changes so day
  // colors and stop numbers don't shift when the user toggles the day chip.
  // Computed from ALL non-TRANSIT blocks (not just `visibleBlocks`) so a
  // single filtered day still shows the correct "Day 2" badge — and the
  // per-day stop number matches the itinerary list's per-day numbering.
  const markerInfo = useMemo(() => {
    const result = new Map<string, BlockMarkerInfo>();
    const sorted = [...blocks]
      .filter((b) => b.type !== ACTIVITY_TYPES.TRANSIT)
      .sort((a, b) => a.timestamp_start.localeCompare(b.timestamp_start));
    const dateOrder = new Map<string, number>();
    const dayCounters = new Map<string, number>();
    for (const block of sorted) {
      const date = block.timestamp_start.slice(0, 10);
      if (!dateOrder.has(date)) dateOrder.set(date, dateOrder.size);
      const localIndex = (dayCounters.get(date) ?? 0) + 1;
      dayCounters.set(date, localIndex);
      result.set(block.id, { dayIndex: dateOrder.get(date)!, localIndex });
    }
    return result;
  }, [blocks]);

  const initialViewState = useMemo(() => {
    if (visibleBlocks.length === 0) return FALLBACK_VIEW;
    const [lng, lat] = visibleBlocks[0].coordinates;
    return { longitude: lng, latitude: lat, zoom: 12 };
  }, [visibleBlocks]);

  // Filter the route GeoJSON to selectedDate too — otherwise the map would
  // keep drawing all routes underneath a single day's markers.
  const filteredGeoJson = useMemo(() => {
    if (!selectedDate) return geojson;
    const visibleIds = new Set(visibleBlocks.map((b) => b.id));
    return {
      type: "FeatureCollection" as const,
      features: geojson.features.filter(
        (f) =>
          visibleIds.has(f.properties.fromBlockId) &&
          visibleIds.has(f.properties.toBlockId),
      ),
    };
  }, [geojson, selectedDate, visibleBlocks]);

  // Mapbox GL `match` expression — cast through unknown since the runtime
  // accepts a dynamically-built variant fine but the typed spec is strict.
  const lineColorExpression = useMemo<ExpressionSpecification>(() => {
    const expr: unknown[] = ["match", ["get", "dayIndex"]];
    DAY_PALETTE.forEach((color, idx) => {
      expr.push(idx, color);
    });
    expr.push(DAY_PALETTE[0]);
    return expr as unknown as ExpressionSpecification;
  }, []);

  useEffect(() => {
    if (!mapRef.current || visibleBlocks.length === 0) return;

    if (visibleBlocks.length === 1) {
      const [lng, lat] = visibleBlocks[0].coordinates;
      mapRef.current.easeTo({ center: [lng, lat], zoom: 13, duration: 600 });
      return;
    }

    const lngs = visibleBlocks.map((b) => b.coordinates[0]);
    const lats = visibleBlocks.map((b) => b.coordinates[1]);
    mapRef.current.fitBounds(
      [
        [Math.min(...lngs), Math.min(...lats)],
        [Math.max(...lngs), Math.max(...lats)],
      ],
      { padding: 64, duration: 600, maxZoom: 14 },
    );
  }, [visibleBlocks]);

  // Recenter on the highlighted stop when it changes (e.g. clicked in the list).
  useEffect(() => {
    if (!mapRef.current || !highlightedId) return;
    const block = blocks.find((b) => b.id === highlightedId);
    if (!block) return;
    const [lng, lat] = block.coordinates;
    mapRef.current.easeTo({ center: [lng, lat], duration: 500 });
  }, [highlightedId, blocks]);

  if (!token) {
    return (
      <div
        className={cn(
          "flex h-full w-full flex-col items-center justify-center gap-3 rounded-md border border-dashed border-border bg-muted-surface p-8 text-center",
          className,
        )}
      >
        <MapPinned className="size-8 text-muted" aria-hidden />
        <div className="space-y-1">
          <p className="font-semibold">Mapbox token missing</p>
          <p className="max-w-xs text-sm text-muted">
            Set <code className="font-mono">NEXT_PUBLIC_MAPBOX_TOKEN</code> in
            <code className="font-mono"> .env.local</code> to render the live
            map. The itinerary still works without it.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div
      className={cn(
        "relative h-full w-full overflow-hidden rounded-md border border-border",
        className,
      )}
    >
      <MapboxMap
        ref={mapRef}
        mapboxAccessToken={token}
        initialViewState={initialViewState}
        mapStyle="mapbox://styles/mapbox/light-v11"
        reuseMaps
      >
        <NavigationControl position="top-right" showCompass={false} />
        {filteredGeoJson.features.length > 0 ? (
          <Source id="trip-routes" type="geojson" data={filteredGeoJson}>
            <Layer
              id="trip-routes-line"
              type="line"
              layout={{ "line-join": "round", "line-cap": "round" }}
              paint={{
                "line-color": lineColorExpression,
                "line-width": [
                  "interpolate",
                  ["linear"],
                  ["zoom"],
                  10, 2,
                  16, 5,
                ],
                "line-opacity": 0.85,
                "line-dasharray": [
                  "case",
                  ["==", ["get", "profile"], "walking"],
                  ["literal", [0.1, 1.6]],
                  ["literal", [1]],
                ],
              }}
            />
          </Source>
        ) : null}
        {visibleBlocks.map((block) => {
          const info = markerInfo.get(block.id);
          const dayIndex = info?.dayIndex ?? 0;
          const localIndex = info?.localIndex ?? 1;
          const dayColor = DAY_PALETTE[dayIndex % DAY_PALETTE.length];
          const highlighted = highlightedId === block.id;
          return (
            <Marker
              key={block.id}
              longitude={block.coordinates[0]}
              latitude={block.coordinates[1]}
              anchor="bottom"
              style={{ zIndex: highlighted ? 10 : 1 }}
            >
              <button
                type="button"
                title={`Day ${dayIndex + 1} · Stop ${localIndex} · ${block.activity_name}`}
                onClick={(e) => {
                  e.stopPropagation();
                  onSelectBlock?.(block.id);
                }}
                className={cn(
                  "flex -translate-y-1 cursor-pointer items-center justify-center rounded-full font-semibold text-white shadow-md transition-all",
                  highlighted
                    ? "size-9 text-sm ring-4 ring-primary"
                    : "size-7 text-xs ring-2 ring-white hover:scale-110",
                )}
                style={{ backgroundColor: dayColor }}
              >
                {localIndex}
              </button>
            </Marker>
          );
        })}
      </MapboxMap>
    </div>
  );
};
