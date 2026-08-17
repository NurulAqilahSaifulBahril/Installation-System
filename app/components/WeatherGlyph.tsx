import { CloudLightning, CloudRain, CloudSun, Sun } from "lucide-react";

// WMO weather codes. Drawn with lucide icons rather than emoji: the sun and
// cloud characters have no emoji presentation by default, so they rendered as
// near-invisible monochrome glyphs.
//
// Lives in its own file because both the month grids on the dashboard page and
// the sidebar calendar's hover card draw it, and importing a component out of
// a page module to reach the calendar would make the two import each other.
export default function WeatherGlyph({
  code,
  size = 15,
}: {
  code: number;
  size?: number;
}) {
  if (code >= 95) {
    return (
      <CloudLightning
        size={size}
        className="weather-glyph storm"
        aria-label="Thunderstorm"
      />
    );
  }
  if (code >= 51) {
    return (
      <CloudRain size={size} className="weather-glyph rain" aria-label="Rain" />
    );
  }
  if (code >= 1) {
    return (
      <CloudSun
        size={size}
        className="weather-glyph cloudy"
        aria-label="Partly cloudy"
      />
    );
  }
  return <Sun size={size} className="weather-glyph sunny" aria-label="Clear" />;
}
