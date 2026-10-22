"use client";

import L from "leaflet";
import { useEffect, useRef } from "react";
import { MapContainer, TileLayer, useMap, useMapEvents } from "react-leaflet";

export type MapCenter = {
  lat: number;
  lng: number;
};

type BoundsSelectorProps = {
  radiusKm: number;
  onCenterChange: (center: MapCenter) => void;
};

function createPointIcon() {
  return L.divIcon({
    className: "map-point",
  });
}

function MapSizer() {
  const map = useMap();

  useEffect(() => {
    map.invalidateSize();
  }, [map]);

  return null;
}

function BoundsSelector({ radiusKm, onCenterChange }: BoundsSelectorProps) {
  const map = useMap();
  const markerRef = useRef<L.Marker | null>(null);
  const circleRef = useRef<L.Circle | null>(null);

  const resetSelection = () => {
    if (markerRef.current) {
      markerRef.current.remove();
      markerRef.current = null;
    }
    if (circleRef.current) {
      circleRef.current.remove();
      circleRef.current = null;
    }
  };

  useMapEvents({
    click(event) {
      resetSelection();
      const marker = L.marker(event.latlng, {
        icon: createPointIcon(),
        keyboard: false,
      }).addTo(map);
      markerRef.current = marker;

      circleRef.current = L.circle(event.latlng, {
        radius: radiusKm * 1000,
        color: "#2f80ed",
        weight: 2,
        fillColor: "#2f80ed",
        fillOpacity: 0.5,
      }).addTo(map);

      onCenterChange({ lat: event.latlng.lat, lng: event.latlng.lng });
    },
  });

  useEffect(() => {
    resetSelection();
  }, [radiusKm]);

  useEffect(() => {
    return () => {
      resetSelection();
    };
  }, []);

  return null;
}

type MapAreaSelectorProps = {
  radiusKm: number;
  onCenterChange: (center: MapCenter) => void;
};

export default function MapAreaSelector({
  radiusKm,
  onCenterChange,
}: MapAreaSelectorProps) {
  return (
    <div className="map-shell h-[480px] w-full">
      <MapContainer
        center={[-34.5883, -58.4293]}
        zoom={13}
        scrollWheelZoom
        className="h-full w-full"
      >
        <MapSizer />
        <TileLayer
          attribution="&copy; OpenStreetMap contributors"
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        />
        <BoundsSelector radiusKm={radiusKm} onCenterChange={onCenterChange} />
      </MapContainer>
    </div>
  );
}