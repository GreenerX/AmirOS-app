import { createHash } from "node:crypto";

export type TimeZoneCity = {
  id: number;
  name: string;
  country: string;
  admin1?: string;
  latitude: number;
  longitude: number;
  timezone: string;
};

export type CurrentWeather = {
  temperatureC: number;
  weatherCode: number;
  isDay: boolean;
  observedAt: string;
  timezone: string;
};

export const TIME_ZONE_BACKGROUND_PERIODS = ["morning", "afternoon", "night"] as const;
export type TimeZoneBackgroundPeriod = typeof TIME_ZONE_BACKGROUND_PERIODS[number];

type FetchImplementation = typeof fetch;

function validTimeZone(value: string): boolean {
  try {
    new Intl.DateTimeFormat("en", { timeZone: value }).format(0);
    return true;
  } catch {
    return false;
  }
}

function finiteCoordinate(value: unknown, minimum: number, maximum: number): number | undefined {
  const number = Number(value);
  return Number.isFinite(number) && number >= minimum && number <= maximum ? number : undefined;
}

export function normalizeTimeZoneCity(input: unknown): TimeZoneCity | undefined {
  if (!input || typeof input !== "object") return undefined;
  const value = input as Record<string, unknown>;
  const id = Number(value.id);
  const name = typeof value.name === "string" ? value.name.replace(/\s+/gu, " ").trim() : "";
  const country = typeof value.country === "string" ? value.country.replace(/\s+/gu, " ").trim() : "";
  const admin1 = typeof value.admin1 === "string" ? value.admin1.replace(/\s+/gu, " ").trim() : undefined;
  const latitude = finiteCoordinate(value.latitude, -90, 90);
  const longitude = finiteCoordinate(value.longitude, -180, 180);
  const timezone = typeof value.timezone === "string" ? value.timezone.trim() : "";
  if (!Number.isSafeInteger(id) || id <= 0 || !name || name.length > 100 || !country || country.length > 100
    || latitude === undefined || longitude === undefined || !timezone || timezone.length > 100 || !validTimeZone(timezone)) return undefined;
  return { id, name, country, admin1: admin1?.slice(0, 100), latitude, longitude, timezone };
}

export function timeZoneCityCacheKey(city: TimeZoneCity): string {
  const slug = city.name.normalize("NFKD").replace(/[^a-z0-9]+/giu, "-").replace(/^-+|-+$/gu, "").toLowerCase().slice(0, 42) || "city";
  const fingerprint = createHash("sha256")
    .update(`${city.id}|${city.latitude.toFixed(5)}|${city.longitude.toFixed(5)}|${city.timezone}`)
    .digest("hex")
    .slice(0, 12);
  return `${slug}-${fingerprint}`;
}

export function timeZoneBackgroundPrompt(city: TimeZoneCity, period: TimeZoneBackgroundPeriod): string {
  const lighting = period === "morning"
    ? "fresh early-morning light, gentle warm sunrise tones, long soft shadows"
    : period === "afternoon"
      ? "clear premium afternoon light, rich natural color, crisp dimensional shadows"
      : "realistic night lighting, elegant city glow, deep blue-black sky, refined highlights";
  return [
    `Create a premium cinematic travel photograph of ${city.name}, ${city.country}.`,
    city.admin1 && city.admin1 !== city.name ? `The location is in ${city.admin1}.` : "",
    `Show an unmistakable, beautiful city view with ${lighting}.`,
    "Horizontal 3:2 composition designed for a small timezone card, with important architecture and landmarks fully inside the frame and generous safe margins.",
    "Realistic photography, sophisticated editorial style, natural detail, consistent calm color grading.",
    "No text, typography, logos, borders, UI, overlays, watermarks, collages, or people posing. Do not crop the defining landmark.",
  ].filter(Boolean).join(" ");
}

async function checkedJson(response: Response, service: string): Promise<unknown> {
  if (!response.ok) throw new Error(`${service} returned ${response.status}`);
  return response.json() as Promise<unknown>;
}

export async function searchTimeZoneCities(query: string, fetchImpl: FetchImplementation = fetch): Promise<TimeZoneCity[]> {
  const normalized = query.replace(/\s+/gu, " ").trim();
  if (normalized.length < 2 || normalized.length > 80) return [];
  const url = new URL("https://geocoding-api.open-meteo.com/v1/search");
  url.searchParams.set("name", normalized);
  url.searchParams.set("count", "8");
  url.searchParams.set("language", "en");
  url.searchParams.set("format", "json");
  const payload = await checkedJson(await fetchImpl(url, { signal: AbortSignal.timeout(8_000) }), "City search") as {
    results?: unknown[];
  };
  return (payload.results || []).flatMap((result) => {
    const city = normalizeTimeZoneCity(result);
    return city ? [city] : [];
  });
}

export async function fetchCurrentWeather(
  latitude: number,
  longitude: number,
  timezone = "auto",
  fetchImpl: FetchImplementation = fetch,
): Promise<CurrentWeather> {
  const safeLatitude = finiteCoordinate(latitude, -90, 90);
  const safeLongitude = finiteCoordinate(longitude, -180, 180);
  const safeTimezone = timezone === "auto" || validTimeZone(timezone) ? timezone : undefined;
  if (safeLatitude === undefined || safeLongitude === undefined || !safeTimezone) throw new Error("Choose a valid location");
  const url = new URL("https://api.open-meteo.com/v1/forecast");
  url.searchParams.set("latitude", String(safeLatitude));
  url.searchParams.set("longitude", String(safeLongitude));
  url.searchParams.set("current", "temperature_2m,weather_code,is_day");
  url.searchParams.set("temperature_unit", "celsius");
  url.searchParams.set("timezone", safeTimezone);
  const payload = await checkedJson(await fetchImpl(url, { signal: AbortSignal.timeout(8_000) }), "Weather service") as {
    timezone?: unknown;
    current?: { temperature_2m?: unknown; weather_code?: unknown; is_day?: unknown; time?: unknown };
  };
  const temperatureC = Number(payload.current?.temperature_2m);
  const weatherCode = Number(payload.current?.weather_code);
  if (!Number.isFinite(temperatureC) || !Number.isFinite(weatherCode)) throw new Error("Weather service returned incomplete conditions");
  return {
    temperatureC,
    weatherCode,
    isDay: Number(payload.current?.is_day) === 1,
    observedAt: typeof payload.current?.time === "string" ? payload.current.time : new Date().toISOString(),
    timezone: typeof payload.timezone === "string" ? payload.timezone : safeTimezone,
  };
}
