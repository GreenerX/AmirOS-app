import {
  ChevronDown,
  Cloud,
  CloudFog,
  CloudLightning,
  CloudRain,
  CloudSnow,
  LoaderCircle,
  MapPin,
  Moon,
  Plus,
  Search,
  Sun,
  X,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { ensureTimeZoneBackgrounds, getCurrentWeather, searchTimeZoneCities } from "../api";
import { formatDeviceClock } from "../format";
import { useTimeFormat } from "../TimeFormatProvider";
import {
  cityBackgroundPeriod,
  cityTimeLabel,
  readSavedTimeZoneCities,
  readTemperatureUnit,
  saveTemperatureUnit,
  saveTimeZoneCities,
  temperatureLabel,
  weatherVisual,
  type CurrentWeather,
  type SavedTimeZoneCity,
  type TemperatureUnit,
  type TimeZoneCity,
} from "../timezone-weather";

const WEATHER_REFRESH_MS = 10 * 60_000;

function WeatherIcon({ weather, size = 34 }: { weather?: CurrentWeather; size?: number }) {
  const visual = weather ? weatherVisual(weather.weatherCode) : { kind: "partly-cloudy" as const };
  const isDay = weather?.isDay ?? true;
  const iconSize = Math.round(size * .86);
  return <span className={`premium-weather-icon weather-${visual.kind} ${isDay ? "is-day" : "is-night"}`} style={{ width: size, height: size }} aria-hidden="true">
    {visual.kind === "clear"
      ? isDay ? <Sun className="weather-layer weather-sun" size={iconSize} /> : <Moon className="weather-layer weather-moon" size={iconSize} />
      : visual.kind === "partly-cloudy"
        ? <>{isDay ? <Sun className="weather-layer weather-sun" size={iconSize} /> : <Moon className="weather-layer weather-moon" size={iconSize} />}<Cloud className="weather-layer weather-cloud" size={iconSize} /></>
        : visual.kind === "cloudy"
          ? <Cloud className="weather-layer weather-cloud" size={iconSize} />
          : visual.kind === "fog"
            ? <CloudFog className="weather-layer weather-fog" size={iconSize} />
            : visual.kind === "rain"
              ? <CloudRain className="weather-layer weather-rain" size={iconSize} />
              : visual.kind === "snow"
                ? <CloudSnow className="weather-layer weather-snow" size={iconSize} />
                : <CloudLightning className="weather-layer weather-storm" size={iconSize} />}
  </span>;
}

function updateAndPersistCities(
  setter: React.Dispatch<React.SetStateAction<SavedTimeZoneCity[]>>,
  update: (current: SavedTimeZoneCity[]) => SavedTimeZoneCity[],
) {
  setter((current) => {
    const next = update(current).slice(0, 3);
    saveTimeZoneCities(next);
    return next;
  });
}

export function OverviewHeaderExperience({ now }: { now: Date }) {
  const { timeFormat, setTimeFormat } = useTimeFormat();
  const [unit, setUnit] = useState<TemperatureUnit>(readTemperatureUnit);
  const [cities, setCities] = useState<SavedTimeZoneCity[]>(readSavedTimeZoneCities);
  const [localWeather, setLocalWeather] = useState<CurrentWeather>();
  const [localWeatherUnavailable, setLocalWeatherUnavailable] = useState(false);
  const [cityWeather, setCityWeather] = useState<Record<number, CurrentWeather>>({});
  const [pickerOpen, setPickerOpen] = useState(false);
  const [timeMenuOpen, setTimeMenuOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<TimeZoneCity[]>([]);
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState("");
  const backgroundRequests = useRef(new Set<number>());

  const chooseUnit = (next: TemperatureUnit) => {
    setUnit(next);
    saveTemperatureUnit(next);
  };

  useEffect(() => {
    if (!navigator.geolocation) {
      setLocalWeatherUnavailable(true);
      return;
    }
    let active = true;
    let permission: PermissionStatus | undefined;
    const refresh = () => {
      navigator.geolocation.getCurrentPosition((position) => {
        void (async () => {
          try {
            const weather = await getCurrentWeather(position.coords.latitude, position.coords.longitude, "auto");
            if (active) {
              setLocalWeather(weather);
              setLocalWeatherUnavailable(false);
            }
          } catch {
            if (active) setLocalWeatherUnavailable(true);
          }
        })();
      }, () => {
        if (active) setLocalWeatherUnavailable(true);
      }, { enableHighAccuracy: false, maximumAge: WEATHER_REFRESH_MS, timeout: 8_000 });
    };
    refresh();
    const interval = window.setInterval(refresh, WEATHER_REFRESH_MS);
    if (navigator.permissions) {
      void navigator.permissions.query({ name: "geolocation" }).then((status) => {
        if (!active) return;
        permission = status;
        permission.addEventListener("change", refresh);
        if (permission.state === "granted") refresh();
      }).catch(() => undefined);
    }
    return () => {
      active = false;
      permission?.removeEventListener("change", refresh);
      window.clearInterval(interval);
    };
  }, []);

  useEffect(() => {
    if (cities.length === 0) {
      setCityWeather({});
      return;
    }
    let active = true;
    const refresh = async () => {
      const updates = await Promise.all(cities.map(async (city) => {
        try {
          return [city.id, await getCurrentWeather(city.latitude, city.longitude, city.timezone)] as const;
        } catch {
          return undefined;
        }
      }));
      if (!active) return;
      setCityWeather(Object.fromEntries(updates.filter((entry): entry is readonly [number, CurrentWeather] => Boolean(entry))));
    };
    void refresh();
    const interval = window.setInterval(() => void refresh(), WEATHER_REFRESH_MS);
    return () => {
      active = false;
      window.clearInterval(interval);
    };
  }, [cities]);

  useEffect(() => {
    for (const city of cities) {
      if (city.backgrounds?.morning && city.backgrounds.afternoon && city.backgrounds.night) continue;
      if (backgroundRequests.current.has(city.id)) continue;
      backgroundRequests.current.add(city.id);
      void ensureTimeZoneBackgrounds(city).then(({ backgrounds }) => {
        updateAndPersistCities(setCities, (current) => current.map((item) => (
          item.id === city.id ? { ...item, backgrounds: { ...item.backgrounds, ...backgrounds } } : item
        )));
      }).catch(() => {
        // Weather and time remain useful if image generation is unavailable.
      }).finally(() => backgroundRequests.current.delete(city.id));
    }
  }, [cities]);

  useEffect(() => {
    const normalized = query.replace(/\s+/gu, " ").trim();
    if (normalized.length < 2) {
      setResults([]);
      setSearching(false);
      setSearchError("");
      return;
    }
    let active = true;
    const timeout = window.setTimeout(() => {
      setSearching(true);
      setSearchError("");
      void searchTimeZoneCities(normalized).then((citiesFound) => {
        if (active) setResults(citiesFound);
      }).catch(() => {
        if (active) {
          setResults([]);
          setSearchError("City search is unavailable right now.");
        }
      }).finally(() => {
        if (active) setSearching(false);
      });
    }, 250);
    return () => {
      active = false;
      window.clearTimeout(timeout);
    };
  }, [query]);

  const addCity = (city: TimeZoneCity) => {
    updateAndPersistCities(setCities, (current) => current.some((item) => item.id === city.id) || current.length >= 3
      ? current
      : [...current, city]);
    setPickerOpen(false);
    setTimeMenuOpen(false);
    setQuery("");
    setResults([]);
  };

  const removeCity = (cityId: number) => {
    updateAndPersistCities(setCities, (current) => current.filter((city) => city.id !== cityId));
    setCityWeather((current) => Object.fromEntries(Object.entries(current).filter(([id]) => Number(id) !== cityId)));
  };

  const localVisual = localWeather ? weatherVisual(localWeather.weatherCode) : undefined;

  return <>
    <div className="overview-header-experience">
      <div className="overview-local-strip">
        <section className={`overview-local-weather ${localWeatherUnavailable ? "unavailable" : ""}`} aria-label="Local weather">
          <span className="overview-local-weather-icon"><WeatherIcon weather={localWeather} size={45} /></span>
          <span><strong>{localWeather ? temperatureLabel(localWeather.temperatureC, unit) : "--°"}</strong><small>{localWeatherUnavailable ? "Local weather unavailable" : localVisual?.condition || "Finding local weather…"}</small></span>
        </section>
        <section className="overview-clock-block" aria-label="Local clock">
          <time className="overview-current-time" dateTime={now.toISOString()} aria-label={`Current device time ${formatDeviceClock(now, timeFormat)}`}><strong>{formatDeviceClock(now, timeFormat)}</strong></time>
          <div className="overview-clock-controls">
            <span className="overview-unit-controls">
              <span className="temperature-unit-toggle" role="group" aria-label="Temperature unit">
                <button type="button" className={unit === "celsius" ? "active" : ""} aria-pressed={unit === "celsius"} onClick={() => chooseUnit("celsius")}>°C</button>
                <button type="button" className={unit === "fahrenheit" ? "active" : ""} aria-pressed={unit === "fahrenheit"} onClick={() => chooseUnit("fahrenheit")}>°F</button>
              </span>
              <span className="time-format-toggle" role="group" aria-label="Clock format">
                <button type="button" className={timeFormat === "12-hour" ? "active" : ""} aria-pressed={timeFormat === "12-hour"} onClick={() => setTimeFormat("12-hour")}>12h</button>
                <button type="button" className={timeFormat === "24-hour" ? "active" : ""} aria-pressed={timeFormat === "24-hour"} onClick={() => setTimeFormat("24-hour")}>24h</button>
              </span>
            </span>
            <span className={`local-time-menu-wrap ${timeMenuOpen ? "open" : ""}`} onMouseLeave={() => setTimeMenuOpen(false)}>
              <button className="local-time-menu-trigger" type="button" aria-haspopup="menu" aria-expanded={timeMenuOpen} onClick={() => setTimeMenuOpen((open) => !open)}>Local time <ChevronDown size={13} /></button>
              <span className="local-time-menu" role="menu">
                <button type="button" role="menuitem" disabled={cities.length >= 3} onClick={() => setPickerOpen(true)}><Plus size={14} />{cities.length >= 3 ? "Maximum 3 timezones" : "Add timezone"}</button>
              </span>
            </span>
          </div>
        </section>
      </div>
      {cities.length > 0 ? <section className="overview-timezone-cards" aria-label="Saved timezones">
        {cities.map((city) => {
          const weather = cityWeather[city.id];
          const period = cityBackgroundPeriod(now, city.timezone);
          const background = city.backgrounds?.[period];
          return <article className={`overview-timezone-card period-${period} ${background ? "has-background" : ""}`} key={city.id}>
            <span className="overview-timezone-art" aria-hidden="true">{(["morning", "afternoon", "night"] as const).map((time) => city.backgrounds?.[time] ? <span className={time === period ? "active" : ""} style={{ backgroundImage: `url(${JSON.stringify(city.backgrounds[time])})` }} key={time} /> : null)}</span>
            <button className="overview-timezone-remove" type="button" aria-label={`Remove ${city.name}`} title={`Remove ${city.name}`} onClick={() => removeCity(city.id)}><X size={14} /></button>
            <span className="overview-timezone-city">{city.name}</span>
            <time dateTime={now.toISOString()}>{cityTimeLabel(now, city.timezone, timeFormat)}</time>
            <span className="overview-timezone-weather"><WeatherIcon weather={weather} size={22} />{weather ? temperatureLabel(weather.temperatureC, unit) : "Updating…"}</span>
            {!background && backgroundRequests.current.has(city.id) ? <span className="overview-timezone-generating"><LoaderCircle className="spin" size={12} />Creating city art</span> : null}
          </article>;
        })}
      </section> : null}
    </div>

    {pickerOpen ? <div className="timezone-picker-backdrop" role="presentation" onClick={() => setPickerOpen(false)}>
      <section className="timezone-picker" role="dialog" aria-modal="true" aria-labelledby="timezone-picker-title" onClick={(event) => event.stopPropagation()}>
        <header><span><MapPin size={20} /><span><small>World clock</small><h2 id="timezone-picker-title">Add timezone</h2></span></span><button type="button" aria-label="Close timezone picker" onClick={() => setPickerOpen(false)}><X size={17} /></button></header>
        <label className="timezone-search"><Search size={18} /><input autoFocus value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search for a city" aria-label="Search for a city" />{searching ? <LoaderCircle className="spin" size={16} /> : null}</label>
        <div className="timezone-search-results" aria-live="polite">
          {results.map((city) => {
            const added = cities.some((item) => item.id === city.id);
            return <button type="button" key={city.id} disabled={added} onClick={() => addCity(city)}><span><strong>{city.name}</strong><small>{[city.admin1, city.country].filter(Boolean).join(", ")}</small></span><span>{added ? "Added" : "Select"}</span></button>;
          })}
          {!searching && query.trim().length < 2 ? <p>Type at least two letters to find a city.</p> : null}
          {!searching && query.trim().length >= 2 && results.length === 0 && !searchError ? <p>No matching cities found.</p> : null}
          {searchError ? <p className="timezone-search-error">{searchError}</p> : null}
        </div>
        <footer>Up to three cities · backgrounds are generated once and kept locally.</footer>
      </section>
    </div> : null}
  </>;
}
