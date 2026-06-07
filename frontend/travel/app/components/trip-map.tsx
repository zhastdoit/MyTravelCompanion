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
}

const MARKER_COLORS: Record<CalendarBlock["type"], string> = {
  [ACTIVITY_TYPES.OUTDOOR]: "var(--color-outdoor)",
  [ACTIVITY_TYPES.INDOOR]: "var(--color-indoor)",
  [ACTIVITY_TYPES.TRANSIT]: "var(--color-transit)",
};

const FALLBACK_VIEW = { longitude: 2.3522, latitude: 48.8566, zoom: 11 };

export const TripMap = ({ blocks, className }: TripMapProps) => {
  const token = process.env.NEXT_PUBLIC_MAPBOX_TOKEN;
  const mapRef = useRef<MapRef | null>(null);

  const initialViewState = useMemo(() => {
    if (blocks.length === 0) return FALLBACK_VIEW;
    const [lng, lat] = blocks[0].coordinates;
    return { longitude: lng, latitude: lat, zoom: 12 };
  }, [blocks]);

  useEffect(() => {
    if (!mapRef.current || blocks.length === 0) return;

    if (blocks.length === 1) {
      const [lng, lat] = blocks[0].coordinates;
      mapRef.current.easeTo({ center: [lng, lat], zoom: 13, duration: 600 });
      return;
    }

    const lngs = blocks.map((b) => b.coordinates[0]);
    const lats = blocks.map((b) => b.coordinates[1]);
    mapRef.current.fitBounds(
      [
        [Math.min(...lngs), Math.min(...lats)],
        [Math.max(...lngs), Math.max(...lats)],
      ],
      { padding: 64, duration: 600, maxZoom: 14 },
    );
  }, [blocks]);

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
        {blocks.map((block, index) => (
          <Marker
            key={block.id}
            longitude={block.coordinates[0]}
            latitude={block.coordinates[1]}
            anchor="bottom"
          >
            <div
              className="flex size-7 -translate-y-1 items-center justify-center rounded-full text-xs font-semibold text-white shadow-md ring-2 ring-white"
              style={{ backgroundColor: MARKER_COLORS[block.type] }}
              title={block.activity_name}
            >
              {index + 1}
            </div>
          </Marker>
        ))}
      </Map>
    </div>
  );
};
