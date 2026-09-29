// Approximate locations for the postcodes this business installs in, for
// Customer Scheduling's distance-based suggestions. Town-centre accuracy is all
// the suggestions need — they decide which customers are close enough to share
// a crew's day — and a static table keeps that working with no geocoding
// service reachable and no rate limit to wait out while hundreds of customers
// are placed.
//
// Looked up by the full postcode first, then by its first three digits, which
// in Johor narrows a postcode to one town or district.

export type Coordinates = { lat: number; lng: number };

const BY_POSTCODE: Record<string, Coordinates> = {
  "43300": { lat: 3.026, lng: 101.706 }, // Seri Kembangan
  "79100": { lat: 1.423, lng: 103.635 }, // Iskandar Puteri
  "79200": { lat: 1.432, lng: 103.615 }, // Nusajaya
  "79250": { lat: 1.428, lng: 103.63 }, // Iskandar Puteri
  "81000": { lat: 1.656, lng: 103.603 }, // Kulai
  "81100": { lat: 1.56, lng: 103.75 }, // Johor Bahru (Tebrau)
  "81200": { lat: 1.5, lng: 103.7 }, // Johor Bahru (Tampoi)
  "81300": { lat: 1.537, lng: 103.657 }, // Skudai
  "81310": { lat: 1.533, lng: 103.66 }, // Skudai
  "81400": { lat: 1.6, lng: 103.645 }, // Senai
  "81440": { lat: 1.81, lng: 103.715 }, // Bandar Tenggara
  "81450": { lat: 1.705, lng: 103.54 }, // Gunung Pulai
  "81500": { lat: 1.51, lng: 103.51 }, // Pekan Nanas
  "81550": { lat: 1.445, lng: 103.59 }, // Gelang Patah
  "81560": { lat: 1.44, lng: 103.585 }, // Gelang Patah
  "81600": { lat: 1.37, lng: 104.12 }, // Pengerang
  "81620": { lat: 1.37, lng: 104.12 }, // Pengerang
  "81700": { lat: 1.461, lng: 103.899 }, // Pasir Gudang
  "81750": { lat: 1.485, lng: 103.886 }, // Masai
  "81800": { lat: 1.599, lng: 103.817 }, // Ulu Tiram
  "81850": { lat: 1.82, lng: 103.47 }, // Layang-Layang
  "81900": { lat: 1.73, lng: 103.9 }, // Kota Tinggi
  "81920": { lat: 1.73, lng: 103.9 }, // Kota Tinggi
  "81930": { lat: 1.555, lng: 104.235 }, // Bandar Penawar / Desaru
  "82000": { lat: 1.487, lng: 103.39 }, // Pontian
  "82100": { lat: 1.56, lng: 103.34 }, // Ayer Baloi
  "82200": { lat: 1.64, lng: 103.27 }, // Benut
  "82300": { lat: 1.33, lng: 103.44 }, // Kukup
  "83000": { lat: 1.855, lng: 102.933 }, // Batu Pahat
  "83010": { lat: 1.84, lng: 102.94 }, // Batu Pahat
  "83100": { lat: 1.68, lng: 103.16 }, // Rengit
  "83200": { lat: 1.72, lng: 102.99 }, // Senggarang
  "83300": { lat: 1.89, lng: 103.0 }, // Sri Gading
  "83400": { lat: 1.96, lng: 102.94 }, // Seri Medan
  "83500": { lat: 1.98, lng: 102.87 }, // Parit Sulong
  "83600": { lat: 1.86, lng: 102.8 }, // Semerah
  "83700": { lat: 2.014, lng: 103.065 }, // Yong Peng
  "84000": { lat: 2.044, lng: 102.568 }, // Muar
  "84150": { lat: 1.95, lng: 102.64 }, // Parit Jawa
  "84300": { lat: 2.07, lng: 102.66 }, // Bukit Pasir
  "84600": { lat: 2.15, lng: 102.77 }, // Pagoh
  "84800": { lat: 2.2, lng: 102.67 }, // Bukit Gambir
  "84900": { lat: 2.27, lng: 102.54 }, // Tangkak
  "85000": { lat: 2.51, lng: 102.82 }, // Segamat
  "85300": { lat: 2.38, lng: 103.02 }, // Labis
  "86000": { lat: 2.031, lng: 103.318 }, // Kluang
  "86100": { lat: 1.92, lng: 103.18 }, // Ayer Hitam
  "86200": { lat: 1.83, lng: 103.31 }, // Simpang Renggam
  "86300": { lat: 1.88, lng: 103.39 }, // Rengam
  "86400": { lat: 1.87, lng: 103.11 }, // Parit Raja
  "86500": { lat: 2.32, lng: 103.14 }, // Bekok
  "86600": { lat: 2.18, lng: 103.19 }, // Paloh
  "86800": { lat: 2.43, lng: 103.84 }, // Mersing
  "86900": { lat: 2.65, lng: 103.62 }, // Endau
};

const BY_PREFIX: Record<string, Coordinates> = {
  "433": { lat: 3.026, lng: 101.706 },
  "790": { lat: 1.423, lng: 103.635 },
  "791": { lat: 1.423, lng: 103.635 },
  "792": { lat: 1.432, lng: 103.615 },
  "795": { lat: 1.43, lng: 103.62 },
  "800": { lat: 1.492, lng: 103.741 },
  "801": { lat: 1.492, lng: 103.741 },
  "802": { lat: 1.492, lng: 103.741 },
  "803": { lat: 1.492, lng: 103.741 },
  "804": { lat: 1.492, lng: 103.741 },
  "805": { lat: 1.492, lng: 103.741 },
  "806": { lat: 1.492, lng: 103.741 },
  "807": { lat: 1.492, lng: 103.741 },
  "808": { lat: 1.492, lng: 103.741 },
  "809": { lat: 1.492, lng: 103.741 },
  "810": { lat: 1.656, lng: 103.603 },
  "811": { lat: 1.56, lng: 103.75 },
  "812": { lat: 1.5, lng: 103.7 },
  "813": { lat: 1.537, lng: 103.657 },
  "814": { lat: 1.6, lng: 103.645 },
  "815": { lat: 1.445, lng: 103.59 },
  "816": { lat: 1.37, lng: 104.12 },
  "817": { lat: 1.47, lng: 103.895 },
  "818": { lat: 1.599, lng: 103.817 },
  "819": { lat: 1.73, lng: 103.9 },
  "820": { lat: 1.487, lng: 103.39 },
  "821": { lat: 1.56, lng: 103.34 },
  "822": { lat: 1.64, lng: 103.27 },
  "823": { lat: 1.33, lng: 103.44 },
  "830": { lat: 1.855, lng: 102.933 },
  "831": { lat: 1.68, lng: 103.16 },
  "832": { lat: 1.72, lng: 102.99 },
  "833": { lat: 1.89, lng: 103.0 },
  "834": { lat: 1.96, lng: 102.94 },
  "835": { lat: 1.98, lng: 102.87 },
  "836": { lat: 1.86, lng: 102.8 },
  "837": { lat: 2.014, lng: 103.065 },
  "840": { lat: 2.044, lng: 102.568 },
  "841": { lat: 1.95, lng: 102.64 },
  "842": { lat: 2.05, lng: 102.6 },
  "843": { lat: 2.07, lng: 102.66 },
  "844": { lat: 2.13, lng: 102.62 },
  "845": { lat: 2.1, lng: 102.7 },
  "846": { lat: 2.15, lng: 102.77 },
  "847": { lat: 2.2, lng: 102.7 },
  "848": { lat: 2.2, lng: 102.67 },
  "849": { lat: 2.27, lng: 102.54 },
  "850": { lat: 2.51, lng: 102.82 },
  "851": { lat: 2.51, lng: 102.82 },
  "852": { lat: 2.51, lng: 102.82 },
  "853": { lat: 2.38, lng: 103.02 },
  "860": { lat: 2.031, lng: 103.318 },
  "861": { lat: 1.92, lng: 103.18 },
  "862": { lat: 1.83, lng: 103.31 },
  "863": { lat: 1.88, lng: 103.39 },
  "864": { lat: 1.87, lng: 103.11 },
  "865": { lat: 2.32, lng: 103.14 },
  "866": { lat: 2.18, lng: 103.19 },
  "868": { lat: 2.43, lng: 103.84 },
  "869": { lat: 2.65, lng: 103.62 },
};

export function postcodeCoordinates(postcode: string): Coordinates | null {
  if (!/^\d{5}$/.test(postcode)) return null;
  return BY_POSTCODE[postcode] ?? BY_PREFIX[postcode.slice(0, 3)] ?? null;
}

// Straight-line distance in kilometres.
export function distanceKm(a: Coordinates, b: Coordinates): number {
  const toRad = (degrees: number) => (degrees * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * 6371 * Math.asin(Math.sqrt(h));
}
