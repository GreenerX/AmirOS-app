import { formatDateTime } from "./format";
import type { TimeFormat } from "./time-format";

export type TemperatureUnit = "celsius" | "fahrenheit";
export type TimeZoneBackgroundPeriod = "morning" | "afternoon" | "night";
export type TimeZoneBackgroundTone = "bright" | "dark";

export type TimeZoneCity = {
  id: number;
  name: string;
  country: string;
  admin1?: string;
  latitude: number;
  longitude: number;
  timezone: string;
};

export type TimeZoneBackgrounds = Partial<Record<TimeZoneBackgroundPeriod, string>>;
export type SavedTimeZoneCity = TimeZoneCity & { backgrounds?: TimeZoneBackgrounds };

export type CurrentWeather = {
  temperatureC: number;
  weatherCode: number;
  isDay: boolean;
  observedAt: string;
  timezone: string;
};

export type WeatherVisual = {
  condition: string;
  kind: "clear" | "partly-cloudy" | "cloudy" | "fog" | "rain" | "snow" | "storm";
};

const UNIT_STORAGE_KEY = "amiros.overview-temperature-unit.v1";
const CITIES_STORAGE_KEY = "amiros.overview-timezones.v1";
export const MAX_SAVED_TIMEZONE_CITIES = 4;

function validCity(value: unknown): value is SavedTimeZoneCity {
  if (!value || typeof value !== "object") return false;
  const city = value as Partial<SavedTimeZoneCity>;
  return Number.isSafeInteger(city.id) && Boolean(city.name && city.country && city.timezone)
    && Number.isFinite(city.latitude) && Number.isFinite(city.longitude);
}

export function readTemperatureUnit(): TemperatureUnit {
  try {
    return window.localStorage.getItem(UNIT_STORAGE_KEY) === "fahrenheit" ? "fahrenheit" : "celsius";
  } catch {
    return "celsius";
  }
}

export function saveTemperatureUnit(unit: TemperatureUnit): void {
  try {
    window.localStorage.setItem(UNIT_STORAGE_KEY, unit);
  } catch {
    // The selector still works for this session if storage is unavailable.
  }
}

export function readSavedTimeZoneCities(): SavedTimeZoneCity[] {
  try {
    const value: unknown = JSON.parse(window.localStorage.getItem(CITIES_STORAGE_KEY) || "[]");
    return Array.isArray(value) ? value.filter(validCity).slice(0, MAX_SAVED_TIMEZONE_CITIES) : [];
  } catch {
    return [];
  }
}

export function saveTimeZoneCities(cities: SavedTimeZoneCity[]): void {
  try {
    window.localStorage.setItem(CITIES_STORAGE_KEY, JSON.stringify(cities.slice(0, MAX_SAVED_TIMEZONE_CITIES)));
  } catch {
    // Cards remain usable for this session if storage is unavailable.
  }
}

export function temperatureLabel(temperatureC: number, unit: TemperatureUnit): string {
  const value = unit === "fahrenheit" ? (temperatureC * 9) / 5 + 32 : temperatureC;
  return `${Math.round(value)}°${unit === "fahrenheit" ? "F" : "C"}`;
}

export function weatherVisual(code: number): WeatherVisual {
  if (code === 0) return { condition: "Clear", kind: "clear" };
  if (code === 1 || code === 2) return { condition: code === 1 ? "Mostly clear" : "Partly cloudy", kind: "partly-cloudy" };
  if (code === 3) return { condition: "Cloudy", kind: "cloudy" };
  if (code === 45 || code === 48) return { condition: "Foggy", kind: "fog" };
  if ((code >= 51 && code <= 67) || (code >= 80 && code <= 82)) return { condition: "Rain", kind: "rain" };
  if ((code >= 71 && code <= 77) || (code >= 85 && code <= 86)) return { condition: "Snow", kind: "snow" };
  if (code >= 95) return { condition: "Thunderstorms", kind: "storm" };
  return { condition: "Current conditions", kind: "partly-cloudy" };
}

/**
 * Keep the text-area scrim responsive to the actual city artwork. The UI
 * samples the selected background and uses this stable threshold to choose a
 * stronger treatment only for brighter photos.
 */
export function timeZoneBackgroundTone(luminance: number): TimeZoneBackgroundTone {
  return Number.isFinite(luminance) && luminance >= 142 ? "bright" : "dark";
}

function cityHour(now: Date, timezone: string): number {
  const hour = new Intl.DateTimeFormat("en-US", { timeZone: timezone, hour: "numeric", hourCycle: "h23" })
    .formatToParts(now)
    .find((part) => part.type === "hour")?.value;
  return Number(hour || 0);
}

export function cityBackgroundPeriod(now: Date, timezone: string): TimeZoneBackgroundPeriod {
  const hour = cityHour(now, timezone);
  if (hour >= 5 && hour < 12) return "morning";
  if (hour >= 12 && hour < 18) return "afternoon";
  return "night";
}

export function cityTimeLabel(now: Date, timezone: string, timeFormat?: TimeFormat): string {
  return formatDateTime(now, {
    timeZone: timezone,
    hour: "numeric",
    minute: "2-digit",
  }, timeFormat);
}
