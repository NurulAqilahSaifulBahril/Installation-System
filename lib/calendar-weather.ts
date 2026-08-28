/**
 * Calendar facts that are true of a date itself rather than of any job:
 * public holidays, and the daily rain outlook.
 *
 * Lifted out of the dashboard so the sign-in screen can show the same
 * calendar. Nothing here touches the operational database — the sign-in page
 * is served to anyone who can reach the app, and must never be able to read
 * customer or schedule data.
 */

// Standard Malaysia federal public holidays. Islamic and Hindu calendar
// dates (Raya, Wesak, Awal Muharram, Maulidur Rasul, Deepavali) are
// estimates and should be checked against the official government
// gazette closer to the date. State-specific holidays are not included.
export const MALAYSIA_PUBLIC_HOLIDAYS: Record<string, string> = {
  "2026-01-01": "New Year's Day",
  "2026-02-17": "Chinese New Year",
  "2026-02-18": "Chinese New Year (2nd day)",
  "2026-03-21": "Hari Raya Puasa",
  "2026-03-22": "Hari Raya Puasa (2nd day)",
  "2026-05-01": "Labour Day",
  "2026-05-27": "Hari Raya Haji",
  "2026-05-31": "Wesak Day",
  "2026-06-01": "Agong's Birthday",
  "2026-06-16": "Awal Muharram",
  "2026-08-25": "Prophet Muhammad's Birthday",
  "2026-08-31": "National Day",
  "2026-09-16": "Malaysia Day",
  "2026-11-08": "Deepavali",
  "2026-12-25": "Christmas Day",
};

export type DailyWeather = { rainProbability: number; weatherCode: number };

export type WeatherCoordinates = { latitude: number; longitude: number };

// Johor Bahru. Used where there is no job data to derive a location from —
// the sign-in screen — because it is where most of the work is.
export const DEFAULT_WEATHER_COORDINATES: WeatherCoordinates = {
  latitude: 1.4927,
  longitude: 103.7414,
};

// Open-Meteo's own ceilings. 16 days is as far ahead as it forecasts at all,
// and 92 days is as far back as this endpoint will return observed weather.
const FORECAST_DAYS = 16;
const PAST_DAYS = 92;

/**
 * The worst rain outlook across the given locations, per date.
 *
 * Worst rather than average on purpose: the calendar is read to decide
 * whether a day is safe to be on a roof, and one site being wet is what
 * matters, not the mean across sites.
 *
 * Dates the API has no reading for are left out rather than defaulted to
 * zero — a day with no data is unknown, and "0% rain" would assert the
 * opposite. Callers show "no forecast" for a missing date.
 */
export async function fetchDailyWeather(
  locations: WeatherCoordinates[],
): Promise<Record<string, DailyWeather>> {
  const merged: Record<string, DailyWeather> = {};
  if (!locations.length) return merged;

  const forecasts = await Promise.all(
    locations.map(async ({ latitude, longitude }) => {
      try {
        const query = new URLSearchParams({
          latitude: String(latitude),
          longitude: String(longitude),
          daily: "weather_code,precipitation_probability_max",
          timezone: "Asia/Kuala_Lumpur",
          forecast_days: String(FORECAST_DAYS),
          past_days: String(PAST_DAYS),
        });
        const response = await fetch(
          `https://api.open-meteo.com/v1/forecast?${query}`,
        );
        if (!response.ok) return null;
        // Nullable on purpose: the oldest past days sit outside the
        // reanalysis window and come back as nulls rather than being omitted.
        return (await response.json()) as {
          daily?: {
            time?: string[];
            weather_code?: (number | null)[];
            precipitation_probability_max?: (number | null)[];
          };
        };
      } catch {
        // One location failing must not lose the others.
        return null;
      }
    }),
  );

  forecasts.forEach((forecast) => {
    forecast?.daily?.time?.forEach((date, index) => {
      const rainProbability =
        forecast.daily?.precipitation_probability_max?.[index];
      const weatherCode = forecast.daily?.weather_code?.[index];
      if (rainProbability == null || weatherCode == null) return;
      const current = merged[date];
      if (!current || rainProbability > current.rainProbability) {
        merged[date] = { rainProbability, weatherCode };
      }
    });
  });

  return merged;
}
