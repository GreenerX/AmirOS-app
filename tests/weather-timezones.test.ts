import { describe, expect, it, vi } from "vitest";
import {
  fetchCurrentWeather,
  normalizeTimeZoneCity,
  searchTimeZoneCities,
  timeZoneBackgroundPrompt,
  timeZoneCityCacheKey,
  type TimeZoneCity,
} from "../src/weather-timezones.js";

const telAviv: TimeZoneCity = {
  id: 293397,
  name: "Tel Aviv",
  country: "Israel",
  admin1: "Tel Aviv",
  latitude: 32.08088,
  longitude: 34.78057,
  timezone: "Asia/Jerusalem",
};

describe("timezone weather services", () => {
  it("validates cities and creates a stable local background cache key", () => {
    expect(normalizeTimeZoneCity(telAviv)).toEqual(telAviv);
    expect(normalizeTimeZoneCity({ ...telAviv, timezone: "Not/A_Timezone" })).toBeUndefined();
    expect(timeZoneCityCacheKey(telAviv)).toMatch(/^tel-aviv-[a-f0-9]{12}$/u);
    expect(timeZoneCityCacheKey(telAviv)).toBe(timeZoneCityCacheKey({ ...telAviv }));
  });

  it("uses a fixed geocoding endpoint and normalizes live search results", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ results: [telAviv] }), { status: 200 }));
    await expect(searchTimeZoneCities("Tel Aviv", fetchMock)).resolves.toEqual([telAviv]);
    expect(String(fetchMock.mock.calls[0]?.[0])).toContain("geocoding-api.open-meteo.com/v1/search");
    expect(String(fetchMock.mock.calls[0]?.[0])).toContain("name=Tel+Aviv");
  });

  it("normalizes current weather from the fixed forecast endpoint", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({
      timezone: "Asia/Jerusalem",
      current: { temperature_2m: 28.4, weather_code: 2, is_day: 1, time: "2026-08-09T16:00" },
    }), { status: 200 }));
    await expect(fetchCurrentWeather(telAviv.latitude, telAviv.longitude, telAviv.timezone, fetchMock)).resolves.toEqual({
      temperatureC: 28.4,
      weatherCode: 2,
      isDay: true,
      observedAt: "2026-08-09T16:00",
      timezone: "Asia/Jerusalem",
    });
    expect(String(fetchMock.mock.calls[0]?.[0])).toContain("api.open-meteo.com/v1/forecast");
  });

  it("builds consistent no-text city prompts for each time of day", () => {
    const prompt = timeZoneBackgroundPrompt(telAviv, "night");
    expect(prompt).toContain("premium cinematic travel photograph of Tel Aviv, Israel");
    expect(prompt).toContain("night lighting");
    expect(prompt).toContain("No text");
    expect(prompt).toContain("fully inside the frame");
  });
});
