"use client";

import L from "leaflet";
import { useEffect, useMemo } from "react";
import { Circle, MapContainer, Marker, Popup, TileLayer, useMap } from "react-leaflet";

export type ResultLead = {
  id: string;
  name: string;
  address: string;
  latitude?: number;
  longitude?: number;
};

type ResultsMapProps = {
  leads: ResultLead[];
  center?: { lat: number; lng: number } | null;
  radiusKm?: number;
};

function createResultIcon() {
  return L.divIcon({
    className: "map-result-point",
    html: "<span class=\"map-result-pin\"></span>",
    iconSize: [18, 18],
    iconAnchor: [9, 18],
  });
}

function MapFitter({
  points,
  center,
  radiusKm,
}: {
  points: ResultLead[];
  center?: { lat: number; lng: number } | null;
  radiusKm?: number;
}) {
  const map = useMap();

  useEffect(() => {
    if (!points.length && !center) return;

    // Se acumulan los puntos y se calculan los bounds al final: mutar
    // `bounds` dentro del forEach hacia que TS lo estreche a `never`.
    const latLngs: L.LatLng[] = [];
    points.forEach((lead) => {
      if (lead.latitude === undefined || lead.longitude === undefined) return;
      latLngs.push(L.latLng(lead.latitude, lead.longitude));
    });

    if (center && radiusKm) {
      const centerBounds = L.latLng(center.lat, center.lng).toBounds(radiusKm * 1000);
      latLngs.push(centerBounds.getNorthWest(), centerBounds.getSouthEast());
    } else if (center) {
      latLngs.push(L.latLng(center.lat, center.lng));
    }

    if (!latLngs.length) return;
    map.fitBounds(L.latLngBounds(latLngs), { padding: [24, 24] });
  }, [map, points, center, radiusKm]);

  return null;
}

function MapSizer() {
  const map = useMap();
  useEffect(() => {
    map.invalidateSize();
  }, [map]);
  return null;
}

export default function ResultsMap({ leads, center, radiusKm }: ResultsMapProps) {
  const points = useMemo(
    () =>
      leads.filter(
        (lead) => lead.latitude !== undefined && lead.longitude !== undefined
      ),
    [leads]
  );
  const fallbackCenter: [number, number] = [-34.5883, -58.4293];
  const mapCenter = center
    ? ([center.lat, center.lng] as [number, number])
    : points.length
      ? ([points[0].latitude as number, points[0].longitude as number] as [number, number])
      : fallbackCenter;

  if (!points.length && !center) {
    return (
      <div className="panel-subtle">
        No hay coordenadas disponibles para mostrar en el mapa.
      </div>
    );
  }

  return (
    <div className="map-shell h-[580px] w-full">
      <MapContainer center={mapCenter} zoom={13} className="h-full w-full">
        <TileLayer
          attribution="&copy; OpenStreetMap contributors"
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        />
        <MapSizer />
        <MapFitter points={points} center={center} radiusKm={radiusKm} />
        {center && radiusKm ? (
          <Circle
            center={[center.lat, center.lng]}
            radius={radiusKm * 1000}
            pathOptions={{ color: "#2f80ed", fillColor: "#2f80ed", fillOpacity: 0.35 }}
          />
        ) : null}
        {points.map((lead, index) => (
          <Marker
            key={`${lead.id}-${index}`}
            position={[lead.latitude as number, lead.longitude as number]}
            icon={createResultIcon()}
          >
            <Popup>
              <div className="text-xs font-semibold">{lead.name}</div>
              <div className="text-[10px] text-[color:var(--muted)]">{lead.address}</div>
            </Popup>
          </Marker>
        ))}
      </MapContainer>
    </div>
  );
}
