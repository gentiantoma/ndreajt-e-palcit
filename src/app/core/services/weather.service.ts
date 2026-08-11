import { Injectable } from '@angular/core';
import { Observable, from, of } from 'rxjs';
import { catchError, map } from 'rxjs/operators';

/**
 * Palçi village centre — Lekbibaj, Bashkia Tropojë, Qarku i Kukësit.
 * Taken from the OpenStreetMap village node, so our marker lands exactly on the
 * "Palçi" label the basemap itself draws. (An earlier value, 42.2707/19.9045,
 * was the neighbouring hamlet "Kapon (Palç)" ~1.4 km to the north-east.)
 */
export const PALC_COORDS = { lat: 42.2585186, lng: 19.898662 } as const;

export interface WeatherNow {
  temp: number;
  feelsLike: number;
  humidity: number;
  wind: number;          // km/h
  windDir: number;       // degrees
  precipitation: number; // mm
  code: number;          // WMO weather code
  isDay: boolean;
}

export interface WeatherDay {
  date: string;          // ISO date
  code: number;
  tMax: number;
  tMin: number;
  sunrise: string;
  sunset: string;
  rainChance: number;    // %
  windMax: number;       // km/h
}

export interface WeatherHour {
  time: string;          // ISO
  temp: number;
  code: number;
  rainChance: number;    // %
  isDay: boolean;        // for the correct sun/moon icon
}

export interface WeatherBundle {
  now: WeatherNow;
  days: WeatherDay[];
  hours: WeatherHour[];  // next ~24h
  updatedAt: number;
}

/**
 * Weather for Palç via Open-Meteo (open-meteo.com) — free, no API key, and
 * accurate for mountain villages because it interpolates from a high-resolution
 * model grid. All requests are client-side; nothing is stored.
 */
@Injectable({ providedIn: 'root' })
export class WeatherService {
  private readonly base = 'https://api.open-meteo.com/v1/forecast';

  fetch(lat = PALC_COORDS.lat, lng = PALC_COORDS.lng): Observable<WeatherBundle | null> {
    const params = new URLSearchParams({
      latitude: String(lat),
      longitude: String(lng),
      current:
        'temperature_2m,relative_humidity_2m,apparent_temperature,is_day,precipitation,weather_code,wind_speed_10m,wind_direction_10m',
      daily:
        'weather_code,temperature_2m_max,temperature_2m_min,sunrise,sunset,precipitation_probability_max,wind_speed_10m_max',
      hourly: 'temperature_2m,weather_code,precipitation_probability',
      timezone: 'auto',
      forecast_days: '7',
      wind_speed_unit: 'kmh',
    });

    const url = `${this.base}?${params.toString()}`;
    return from(fetch(url).then(r => {
      if (!r.ok) throw new Error('weather http ' + r.status);
      return r.json();
    })).pipe(
      map(raw => this.parse(raw)),
      catchError(() => of(null)),
    );
  }

  private parse(raw: any): WeatherBundle {
    const c = raw.current ?? {};
    const now: WeatherNow = {
      temp: Math.round(c.temperature_2m ?? 0),
      feelsLike: Math.round(c.apparent_temperature ?? c.temperature_2m ?? 0),
      humidity: Math.round(c.relative_humidity_2m ?? 0),
      wind: Math.round(c.wind_speed_10m ?? 0),
      windDir: Math.round(c.wind_direction_10m ?? 0),
      precipitation: c.precipitation ?? 0,
      code: c.weather_code ?? 0,
      isDay: this.computeIsDay(c, raw.daily),
    };

    const d = raw.daily ?? {};
    const days: WeatherDay[] = (d.time ?? []).map((t: string, i: number) => ({
      date: t,
      code: d.weather_code?.[i] ?? 0,
      tMax: Math.round(d.temperature_2m_max?.[i] ?? 0),
      tMin: Math.round(d.temperature_2m_min?.[i] ?? 0),
      sunrise: d.sunrise?.[i] ?? '',
      sunset: d.sunset?.[i] ?? '',
      rainChance: Math.round(d.precipitation_probability_max?.[i] ?? 0),
      windMax: Math.round(d.wind_speed_10m_max?.[i] ?? 0),
    }));

    // Next 24 hours starting from the current hour
    const h = raw.hourly ?? {};
    const times: string[] = h.time ?? [];
    const nowMs = Date.now();
    const startIdx = Math.max(0, times.findIndex(t => new Date(t).getTime() >= nowMs - 3600_000));
    // Sunrise/sunset per calendar day, so each hour gets the right sun/moon icon
    const sunByDate = new Map<string, { sr: number; ss: number }>();
    for (const d0 of days) {
      const sr = new Date(d0.sunrise).getTime();
      const ss = new Date(d0.sunset).getTime();
      if (!isNaN(sr) && !isNaN(ss)) sunByDate.set(d0.date, { sr, ss });
    }

    const hours: WeatherHour[] = times.slice(startIdx, startIdx + 24).map((t: string, i: number) => {
      const idx = startIdx + i;
      const ms  = new Date(t).getTime();
      const sun = sunByDate.get(t.slice(0, 10));
      return {
        time: t,
        temp: Math.round(h.temperature_2m?.[idx] ?? 0),
        code: h.weather_code?.[idx] ?? 0,
        rainChance: Math.round(h.precipitation_probability?.[idx] ?? 0),
        isDay: sun ? (ms >= sun.sr && ms < sun.ss) : true,
      };
    });

    return { now, days, hours, updatedAt: Date.now() };
  }

  /**
   * Day/night, computed from the location's own sunrise/sunset vs its current
   * time. All three come back as local-time strings with the SAME offset, so
   * comparing them as timestamps is correct regardless of the viewer's timezone.
   * Falls back to the API's `is_day` flag if the times are missing.
   */
  private computeIsDay(c: any, daily: any): boolean {
    const srStr = daily?.sunrise?.[0];
    const ssStr = daily?.sunset?.[0];
    if (c?.time && srStr && ssStr) {
      const t  = new Date(c.time).getTime();
      const sr = new Date(srStr).getTime();
      const ss = new Date(ssStr).getTime();
      if (!isNaN(t) && !isNaN(sr) && !isNaN(ss)) return t >= sr && t < ss;
    }
    return (c?.is_day ?? 1) === 1;
  }

  /**
   * WMO weather-code → emoji + i18n key. Day/night swaps the clear/partly icons.
   * Keys live under `weather.code.*` in the translation files.
   */
  describe(code: number, isDay = true): { emoji: string; key: string } {
    const map: Record<number, { emoji: string; nightEmoji?: string; key: string }> = {
      0:  { emoji: '☀️', nightEmoji: '🌙', key: 'clear' },
      1:  { emoji: '🌤️', nightEmoji: '🌙', key: 'mostly_clear' },
      2:  { emoji: '⛅', nightEmoji: '☁️', key: 'partly_cloudy' },
      3:  { emoji: '☁️', key: 'overcast' },
      45: { emoji: '🌫️', key: 'fog' },
      48: { emoji: '🌫️', key: 'rime_fog' },
      51: { emoji: '🌦️', key: 'drizzle_light' },
      53: { emoji: '🌦️', key: 'drizzle' },
      55: { emoji: '🌧️', key: 'drizzle_dense' },
      56: { emoji: '🌧️', key: 'freezing_drizzle' },
      57: { emoji: '🌧️', key: 'freezing_drizzle' },
      61: { emoji: '🌦️', key: 'rain_light' },
      63: { emoji: '🌧️', key: 'rain' },
      65: { emoji: '🌧️', key: 'rain_heavy' },
      66: { emoji: '🌧️', key: 'freezing_rain' },
      67: { emoji: '🌧️', key: 'freezing_rain' },
      71: { emoji: '🌨️', key: 'snow_light' },
      73: { emoji: '❄️', key: 'snow' },
      75: { emoji: '❄️', key: 'snow_heavy' },
      77: { emoji: '🌨️', key: 'snow_grains' },
      80: { emoji: '🌦️', key: 'showers_light' },
      81: { emoji: '🌧️', key: 'showers' },
      82: { emoji: '⛈️', key: 'showers_heavy' },
      85: { emoji: '🌨️', key: 'snow_showers' },
      86: { emoji: '❄️', key: 'snow_showers_heavy' },
      95: { emoji: '⛈️', key: 'thunderstorm' },
      96: { emoji: '⛈️', key: 'thunderstorm_hail' },
      99: { emoji: '⛈️', key: 'thunderstorm_hail' },
    };
    const entry = map[code] ?? { emoji: '☁️', key: 'overcast' };
    let emoji = !isDay && entry.nightEmoji ? entry.nightEmoji : entry.emoji;

    // Safety net: at night nothing may show a sun. Any remaining sun-bearing
    // icon falls back to its moon/neutral-cloud twin, so e.g. a rainy night
    // stays rainy — just without the sun. (Emoji has no "moon behind cloud",
    // so cloudy nights use the plain cloud over the dark sky background.)
    if (!isDay) {
      const nightSwap: Record<string, string> = {
        '☀️': '🌙', '🌤️': '🌙', '⛅': '☁️', '🌥️': '☁️', '🌦️': '🌧️',
      };
      emoji = nightSwap[emoji] ?? emoji;
    }
    return { emoji, key: `weather.code.${entry.key}` };
  }
}
