"use client";

import L from "leaflet";
import { X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import {
  MapContainer,
  Marker,
  TileLayer,
  useMap,
} from "react-leaflet";
import "leaflet/dist/leaflet.css";

type MapCustomer = {
  id: string;
  name: string;
  address: string;
  paymentPercent: number;
};

type MapGroup = {
  id: string;
  town: string;
  postcode: string;
  state: string;
  customers: MapCustomer[];
};

type Coordinates = { lat: number; lng: number };

const CACHE_KEY = "installation-ops-postcode-coordinates-v2";

// Immediate planning fallbacks for common operating areas. Online postcode
// lookup still replaces these when available, but a failed lookup must not
// exclude an entire town from the filtered map bounds.
const POSTCODE_FALLBACKS: Record<string, Coordinates> = {
  "43300": { lat: 3.026, lng: 101.706 }, // Seri Kembangan
  "79100": { lat: 1.423, lng: 103.635 }, // Iskandar Puteri
  "81000": { lat: 1.656, lng: 103.603 }, // Kulai
  "81100": { lat: 1.56, lng: 103.75 }, // Johor Bahru
  "81200": { lat: 1.5, lng: 103.7 }, // Johor Bahru
  "81300": { lat: 1.537, lng: 103.657 }, // Skudai
  "81700": { lat: 1.461, lng: 103.899 }, // Pasir Gudang
  "81750": { lat: 1.485, lng: 103.886 }, // Masai
  "81800": { lat: 1.599, lng: 103.817 }, // Ulu Tiram
  "83000": { lat: 1.855, lng: 102.933 }, // Batu Pahat
  "83700": { lat: 2.014, lng: 103.065 }, // Yong Peng
  "86000": { lat: 2.031, lng: 103.318 }, // Kluang
};

const TOWN_FALLBACKS: Record<string, Coordinates> = {
  "batu pahat": { lat: 1.855, lng: 102.933 },
  "bandar cemerlang": { lat: 1.59, lng: 103.82 },
  "iskandar puteri": { lat: 1.423, lng: 103.635 },
  "johor bahru": { lat: 1.492, lng: 103.741 },
  "johor bharu": { lat: 1.492, lng: 103.741 },
  kluang: { lat: 2.031, lng: 103.318 },
  kulai: { lat: 1.656, lng: 103.603 },
  masai: { lat: 1.485, lng: 103.886 },
  "pasir gudang": { lat: 1.461, lng: 103.899 },
  "seri kembangan": { lat: 3.026, lng: 101.706 },
  skudai: { lat: 1.537, lng: 103.657 },
  "ulu tiram": { lat: 1.599, lng: 103.817 },
  "yong peng": { lat: 2.014, lng: 103.065 },
};

const POSTCODE_PREFIX_FALLBACKS: Record<string, Coordinates> = {
  "433": { lat: 3.026, lng: 101.706 },
  "791": { lat: 1.423, lng: 103.635 },
  "810": { lat: 1.656, lng: 103.603 },
  "811": { lat: 1.56, lng: 103.75 },
  "812": { lat: 1.5, lng: 103.7 },
  "813": { lat: 1.537, lng: 103.657 },
  "817": { lat: 1.47, lng: 103.895 },
  "818": { lat: 1.599, lng: 103.817 },
  "830": { lat: 1.855, lng: 102.933 },
  "831": { lat: 1.855, lng: 102.933 },
  "832": { lat: 1.855, lng: 102.933 },
  "837": { lat: 2.014, lng: 103.065 },
  "860": { lat: 2.031, lng: 103.318 },
};

function fallbackCoordinates(group: MapGroup) {
  return (
    POSTCODE_FALLBACKS[group.postcode] ??
    TOWN_FALLBACKS[group.town.trim().toLowerCase()] ??
    POSTCODE_PREFIX_FALLBACKS[group.postcode.slice(0, 3)]
  );
}

function markerIcon(
  emphasis: "normal" | "highlighted" | "muted",
) {
  return L.divIcon({
    className: `planning-map-marker-shell ${emphasis}`,
    html: '<span class="planning-map-marker"></span>',
    iconSize: [26, 26],
    iconAnchor: [13, 13],
  });
}

function offsetCoordinates(coordinates: Coordinates, index: number) {
  if (index === 0) return coordinates;
  const angle = index * 2.39996;
  const distance = 0.0025 * Math.ceil(index / 6);
  return {
    lat: coordinates.lat + Math.sin(angle) * distance,
    lng: coordinates.lng + Math.cos(angle) * distance,
  };
}

function FitVisibleMarkers({
  positions,
  focusPositions,
}: {
  positions: [number, number][];
  focusPositions: [number, number][];
}) {
  const map = useMap();

  useEffect(() => {
    const target = focusPositions.length ? focusPositions : positions;
    if (!target.length) return;
    if (target.length === 1) {
      map.setView(target[0], 13, { animate: true });
      return;
    }
    map.fitBounds(L.latLngBounds(target), {
      padding: [34, 34],
      maxZoom: 13,
      animate: true,
    });
  }, [focusPositions, map, positions]);

  return null;
}

export default function PlanningMap({
  groups,
  focusGroupId,
  highlightedGroupId,
  highlightedCustomerId,
  onClose,
}: {
  groups: MapGroup[];
  focusGroupId: string | null;
  highlightedGroupId: string | null;
  highlightedCustomerId?: string | null;
  onClose?: () => void;
}) {
  const [coordinates, setCoordinates] = useState<Record<string, Coordinates>>(
    {},
  );
  const [locating, setLocating] = useState(false);
  const postcodeKey = groups
    .map((group) => group.postcode)
    .filter(Boolean)
    .sort()
    .join("|");

  useEffect(() => {
    let cancelled = false;
    const cached = JSON.parse(
      window.localStorage.getItem(CACHE_KEY) || "{}",
    ) as Record<string, Coordinates>;
    setCoordinates(cached);

    const missing = groups.filter(
      (group, index, all) =>
        group.postcode &&
        !cached[group.postcode] &&
        all.findIndex((item) => item.postcode === group.postcode) === index,
    );
    if (!missing.length) return;

    async function locatePostcodes() {
      setLocating(true);
      const updates = await Promise.all(
        missing.map(async (group) => {
          if (cancelled) return null;
          try {
            const query = new URLSearchParams({
              postalcode: group.postcode,
              country: "Malaysia",
              format: "jsonv2",
              limit: "1",
            });
            const response = await fetch(
              `https://nominatim.openstreetmap.org/search?${query}`,
              { headers: { "Accept-Language": "en-MY,en" } },
            );
            const results = (await response.json()) as Array<{
              lat: string;
              lon: string;
            }>;
            if (results[0]) {
              return {
                postcode: group.postcode,
                coordinates: {
                  lat: Number(results[0].lat),
                  lng: Number(results[0].lon),
                },
              };
            }
          } catch {
            // Keep the map usable while an approximate location is unavailable.
          }
          return null;
        }),
      );

      if (cancelled) return;
      const next = { ...cached };
      updates.forEach((update) => {
        if (update) {
          next[update.postcode] = update.coordinates;
        }
      });
      setCoordinates(next);
      window.localStorage.setItem(CACHE_KEY, JSON.stringify(next));
      if (!cancelled) setLocating(false);
    }

    void locatePostcodes();
    return () => {
      cancelled = true;
    };
  }, [postcodeKey]);

  const markers = useMemo(
    () =>
      groups.flatMap((group) => {
        // Verified local fallbacks take precedence because postcode-only online
        // results can resolve to the wrong Malaysian town.
        const centre = fallbackCoordinates(group) ?? coordinates[group.postcode];
        if (!centre) return [];
        return group.customers.map((customer, index) => ({
          groupId: group.id,
          group,
          customer,
          position: offsetCoordinates(centre, index),
        }));
      }),
    [coordinates, groups],
  );

  const positions = markers.map(
    (marker) => [marker.position.lat, marker.position.lng] as [number, number],
  );
  const activeZoomGroupId = highlightedGroupId ?? focusGroupId;
  const customerFocusPositions = highlightedCustomerId
    ? markers
        .filter((marker) => marker.customer.id === highlightedCustomerId)
        .map(
          (marker) =>
            [marker.position.lat, marker.position.lng] as [number, number],
        )
    : [];
  const focusPositions = customerFocusPositions.length
    ? customerFocusPositions
    : markers
        .filter((marker) => marker.groupId === activeZoomGroupId)
        .map(
          (marker) =>
            [marker.position.lat, marker.position.lng] as [number, number],
        );

  return (
    <aside className="planning-map-panel" aria-label="Customer planning map">
      <div className="planning-map-heading">
        <div>
          <strong>Customer map</strong>
          <span>Approximate postcode locations</span>
        </div>
        <div className="planning-map-heading-actions">
          <small>{locating ? "Locating…" : `${markers.length} markers`}</small>
          {onClose && (
            <button
              type="button"
              className="icon-button"
              aria-label="Hide map"
              title="Hide map"
              onClick={onClose}
            >
              <X size={16} />
            </button>
          )}
        </div>
      </div>
      <MapContainer
        center={[4.2105, 101.9758]}
        zoom={6}
        scrollWheelZoom
        className="planning-map"
      >
        <TileLayer
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
          url="https://tile.openstreetmap.org/{z}/{x}/{y}.png"
        />
        <FitVisibleMarkers
          positions={positions}
          focusPositions={focusPositions}
        />
        {markers.map((marker) => (
          <Marker
            key={`${marker.groupId}-${marker.customer.id}`}
            position={[marker.position.lat, marker.position.lng]}
            icon={markerIcon(
              highlightedCustomerId
                ? marker.customer.id === highlightedCustomerId
                  ? "highlighted"
                  : "muted"
                : !highlightedGroupId
                  ? "normal"
                  : marker.groupId === highlightedGroupId
                    ? "highlighted"
                    : "muted",
            )}
            interactive={false}
          />
        ))}
      </MapContainer>
      {!markers.length && !locating && (
        <div className="planning-map-empty">
          No postcode locations are available for this filter.
        </div>
      )}
      <div className="planning-map-legend">
        <span>Hover a group or customer name to highlight · Click an address to zoom to it</span>
      </div>
    </aside>
  );
}

