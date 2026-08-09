import { describe, expect, it } from "vitest";
import { cityBackgroundPeriod, temperatureLabel, weatherVisual } from "../ui/src/timezone-weather.js";

describe("Overview timezone presentation", () => {
  it("converts temperatures without changing the stored Celsius value", () => {
    expect(temperatureLabel(28, "celsius")).toBe("28°C");
    expect(temperatureLabel(28, "fahrenheit")).toBe("82°F");
  });

  it("maps WMO codes to calm weather labels", () => {
    expect(weatherVisual(2)).toEqual({ condition: "Partly cloudy", kind: "partly-cloudy" });
    expect(weatherVisual(61)).toEqual({ condition: "Rain", kind: "rain" });
    expect(weatherVisual(95)).toEqual({ condition: "Thunderstorms", kind: "storm" });
  });

  it("selects city art from the city's local hour", () => {
    const instant = new Date("2026-08-09T09:00:00Z");
    expect(cityBackgroundPeriod(instant, "America/New_York")).toBe("morning");
    expect(cityBackgroundPeriod(instant, "Asia/Jerusalem")).toBe("afternoon");
    expect(cityBackgroundPeriod(instant, "Asia/Tokyo")).toBe("night");
  });
});
