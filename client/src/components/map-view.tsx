import { useEffect, useMemo, useState } from "react";
import { divIcon, latLngBounds, type Map as LeafletMap } from "leaflet";
import { MapContainer, Marker, TileLayer, useMap } from "react-leaflet";
import { ExternalLink, Loader2, MapPin, RefreshCw, X } from "lucide-react";
import { EMBED_MESSAGE, isEmbedMessage, postToParent } from "@/lib/embed";
import { useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { getSalesPoints } from "@/lib/api";
import type { SalesPoint } from "@shared/schema";
import illusMark from "@assets/Illus_logo_1783008707544.png";

const markerIcon = (selected: boolean) =>
  divIcon({
    className: "custom-marker",
    html: `<div style="width:46px;height:46px;border-radius:50%;background:${selected ? "#2f2d29" : "#8d8880"};box-shadow:0 4px 10px rgba(45,42,38,.18);display:flex;align-items:center;justify-content:center;transition:background .2s ease">
      <img src="${illusMark}" alt="" style="height:18px;width:auto;filter:brightness(0) invert(1);opacity:.92" />
    </div>`,
    iconSize: [46, 46],
    iconAnchor: [23, 23],
  });

const hasMapPosition = (point: SalesPoint) =>
  Number.isFinite(point.latitude) && Number.isFinite(point.longitude)
  && Math.abs(point.latitude) <= 90 && Math.abs(point.longitude) <= 180
  && !(point.latitude === 0 && point.longitude === 0);

const normalizeWebsite = (website?: string) => {
  if (!website) return undefined;
  return /^https?:\/\//i.test(website) ? website : `https://${website}`;
};

function MapFitter({ points }: { points: SalesPoint[] }) {
  const map = useMap();

  useEffect(() => {
    if (!points.length) return;
    const bounds = latLngBounds(points.map((point) => [point.latitude, point.longitude]));
    map.fitBounds(bounds, { padding: [55, 55], maxZoom: 9 });
  }, [map, points]);

  return null;
}

/** Lets the host page (iframe parent) select a sales point, e.g. from the list iframe. */
function ExternalSelection({ points, onSelect }: { points: SalesPoint[]; onSelect: (point: SalesPoint) => void }) {
  const map = useMap();

  useEffect(() => {
    const handler = (event: MessageEvent) => {
      if (!isEmbedMessage(event.data, EMBED_MESSAGE.select)) return;
      const point = points.find((candidate) => candidate.id === Number(event.data.id));
      if (!point) return;
      onSelect(point);
      map.flyTo([point.latitude, point.longitude], Math.max(map.getZoom(), 13), { duration: 0.8 });
    };
    window.addEventListener("message", handler);
    return () => window.removeEventListener("message", handler);
  }, [map, points, onSelect]);

  return null;
}

function SalesPointCard({
  point,
  onClose,
  onShowOnMap,
  floating = false,
}: {
  point: SalesPoint;
  onClose?: () => void;
  onShowOnMap?: () => void;
  floating?: boolean;
}) {
  const website = normalizeWebsite(point.website);

  return (
    <article
      className={`relative bg-[#f1e9dc] p-8 text-[#37342f] ${floating ? "w-[min(340px,calc(100vw-3rem))] shadow-2xl" : "min-h-[270px]"}`}
      data-testid={`sales-point-card-${point.id}`}
    >
      {onClose && (
        <button
          type="button"
          onClick={onClose}
          className="absolute right-4 top-4 p-1 text-[#6f6a62] hover:text-[#37342f]"
          aria-label="Close sales point"
        >
          <X className="h-5 w-5" />
        </button>
      )}

      <h2 className="font-display text-3xl leading-tight">{point.name}</h2>
      <div className="mt-6 space-y-1 text-base leading-relaxed text-[#77736c]">
        <p>{point.street}</p>
        {point.street2 && <p>{point.street2}</p>}
        <p>{point.zip} {point.city}</p>
        {point.phone && <p><a href={`tel:${point.phone}`}>{point.phone}</a></p>}
        {point.email && <p><a href={`mailto:${point.email}`}>{point.email}</a></p>}
      </div>

      {website && (
        <a
          href={website}
          target="_blank"
          rel="noreferrer"
          className="mt-7 inline-flex items-center gap-1 border-b border-[#77736c] pb-0.5 text-base hover:border-[#37342f]"
        >
          Bezoek de website
          <ExternalLink className="h-3.5 w-3.5" />
        </a>
      )}

      {onShowOnMap && (
        <button
          type="button"
          onClick={onShowOnMap}
          className={`${website ? "ml-6" : ""} mt-7 inline-flex items-center gap-1 border-b border-[#77736c] pb-0.5 text-base hover:border-[#37342f]`}
          data-testid={`button-show-on-map-${point.id}`}
        >
          <MapPin className="h-3.5 w-3.5" />
          Toon op kaart
        </button>
      )}
    </article>
  );
}

export function MapView({ embedded = false }: { embedded?: boolean } = {}) {
  const { data, isLoading, isError, refetch, isFetching } = useQuery({
    queryKey: ["sales-points"],
    queryFn: getSalesPoints,
  });
  const points = data?.salesPoints ?? [];
  const mappedPoints = useMemo(
    () => points.filter(hasMapPosition),
    [points],
  );
  const [selected, setSelected] = useState<SalesPoint | null>(null);
  const icons = useMemo(
    () => new Map(mappedPoints.map((point) => [point.id, markerIcon(selected?.id === point.id)])),
    [mappedPoints, selected?.id],
  );

  if (isLoading) {
    return (
      <div className="flex h-full items-center justify-center bg-[#f7f5f1]">
        <Loader2 className="h-7 w-7 animate-spin text-[#77736c]" />
      </div>
    );
  }

  if (isError) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-4 bg-[#f7f5f1] text-center">
        <p>De verkooppunten konden niet uit Odoo worden geladen.</p>
        <Button variant="outline" onClick={() => refetch()}>
          <RefreshCw className={`mr-2 h-4 w-4 ${isFetching ? "animate-spin" : ""}`} />
          Opnieuw proberen
        </Button>
      </div>
    );
  }

  return (
    <div
      className={`relative h-full w-full overflow-hidden bg-[#eef0f1] ${embedded ? "" : "rounded-xl border border-border/50 shadow-2xl"}`}
    >
      <MapContainer
        center={[50.85, 4.35]}
        zoom={7}
        minZoom={3}
        maxZoom={15}
        // In an iframe, wheel-zoom would hijack scrolling of the host page; use the +/- buttons or pinch.
        scrollWheelZoom={!embedded}
        className="h-full w-full"
        zoomControl
      >
        <TileLayer
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors · Geocoding: <a href="https://photon.komoot.io">Photon</a>'
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        />
        <MapFitter points={mappedPoints} />
        <ExternalSelection points={mappedPoints} onSelect={setSelected} />
        {mappedPoints.map((point) => (
          <Marker
            key={point.id}
            position={[point.latitude, point.longitude]}
            icon={icons.get(point.id)}
            eventHandlers={{ click: () => setSelected(point) }}
          />
        ))}
      </MapContainer>

      {selected && (
        <div className="absolute left-6 top-6 z-[1000]">
          <SalesPointCard point={selected} onClose={() => setSelected(null)} floating />
        </div>
      )}

      {data?.source === "fallback" && (
        <div
          className="absolute bottom-6 left-6 z-[900] rounded-sm bg-white/90 px-3 py-2 text-xs text-[#77736c] shadow hover:text-[#37342f]"
        >
          PDF-verkooppunten · live Odoo-gegevens tijdelijk niet beschikbaar
        </div>
      )}

      {data?.source === "odoo" && mappedPoints.length < points.length && (
        <div className="absolute bottom-6 left-6 z-[900] rounded-sm bg-white/90 px-3 py-2 text-xs text-[#77736c] shadow">
          {data.warning || `${points.length - mappedPoints.length} verkooppunt(en) zonder coördinaten staan alleen in de lijst`}
        </div>
      )}
    </div>
  );
}

export function ProjectDirectory({ embedded = false }: { embedded?: boolean } = {}) {
  const { data } = useQuery({
    queryKey: ["sales-points"],
    queryFn: getSalesPoints,
  });
  const points = data?.salesPoints ?? [];

  if (!points.length) return null;

  return (
    <section className={embedded ? "" : "mt-8 pb-16 md:mt-12"} data-testid="section-sales-point-directory">
      <div className="grid grid-cols-1 gap-6 md:grid-cols-2 lg:grid-cols-3">
        {points.map((point) => (
          <SalesPointCard
            key={point.id}
            point={point}
            onShowOnMap={embedded && hasMapPosition(point)
              ? () => postToParent({ type: EMBED_MESSAGE.select, id: point.id })
              : undefined}
          />
        ))}
      </div>
    </section>
  );
}