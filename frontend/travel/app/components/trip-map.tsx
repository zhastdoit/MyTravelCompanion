"use client";

import { useEffect, useMemo, useRef } from "react";
import Map, {
  Marker,
  NavigationControl,
  type MapRef,
} from "react-map-gl/mapbox";
import { MapPinned } from "lucide-react";
import "mapbox-gl/dist/mapbox-gl.css";
import { ACTIVITY_TYPES, type CalendarBlock } from "@/types/trip";
import { cn } from "@/lib/utils";

interface TripMapProps {
  blocks: CalendarBlock[];
  className?: string;
  /** Block id currently highlighted (synced with the itinerary list). */
  highlightedId?: string | null;
  /** Fired when a marker is clicked, to highlight its itinerary stop. */
  onSelectBlock?: (id: string) => void;
}

const MARKER_COLORS: Record<CalendarBlock["type"], string> = {
  [ACTIVITY_TYPES.OUTDOOR]: "var(--color-outdoor)",
  [ACTIVITY_TYPES.INDOOR]: "var(--color-indoor)",
  [ACTIVITY_TYPES.TRANSIT]: "var(--color-transit)",
};

const FALLBACK_VIEW = { longitude: 2.3522, latitude: 48.8566, zoom: 11 };

export const TripMap = ({
  blocks,
  className,
  highlightedId,
  onSelectBlock,
}: TripMapProps) => {
  const token = process.env.NEXT_PUBLIC_MAPBOX_TOKEN;
  const mapRef = useRef<MapRef | null>(null);

  // Number markers by chronological order — the same ordering the itinerary
  // uses — so marker "3" and itinerary stop "3" are the same place.
  const ordered = useMemo(
    () =>
      [...blocks].sort((a, b) =>
        a.timestamp_start.localeCompare(b.timestamp_start),
      ),
    [blocks],
  );

  const initialViewState = useMemo(() => {
    if (ordered.length === 0) return FALLBACK_VIEW;
    const [lng, lat] = ordered[0].coordinates;
    return { longitude: lng, latitude: lat, zoom: 12 };
  }, [ordered]);

  useEffect(() => {
    if (!mapRef.current || ordered.length === 0) return;

    if (ordered.length === 1) {
      const [lng, lat] = ordered[0].coordinates;
      mapRef.current.easeTo({ center: [lng, lat], zoom: 13, duration: 600 });
      return;
    }

    const lngs = ordered.map((b) => b.coordinates[0]);
    const lats = ordered.map((b) => b.coordinates[1]);
    mapRef.current.fitBounds(
      [
        [Math.min(...lngs), Math.min(...lats)],
        [Math.max(...lngs), Math.max(...lats)],
      ],
      { padding: 64, duration: 600, maxZoom: 14 },
    );
  }, [ordered]);

  // Recenter on the highlighted stop when it changes (e.g. clicked in the list).
  useEffect(() => {
    if (!mapRef.current || !highlightedId) return;
    const block = ordered.find((b) => b.id === highlightedId);
    if (!block) return;
    const [lng, lat] = block.coordinates;
    mapRef.current.easeTo({ center: [lng, lat], duration: 500 });
  }, [highlightedId, ordered]);

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
      <Map
        ref={mapRef}
        mapboxAccessToken={token}
        initialViewState={initialViewState}
        mapStyle="mapbox://styles/mapbox/light-v11"
        reuseMaps
      >
        <NavigationControl position="top-right" showCompass={false} />
        {ordered.map((block, index) => {
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
                title={block.activity_name}
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
                style={{ backgroundColor: MARKER_COLORS[block.type] }}
              >
                {index + 1}
              </button>
            </Marker>
          );
        })}
      </Map>
    </div>
  );
};
