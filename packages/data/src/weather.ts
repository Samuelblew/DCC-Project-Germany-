import { schemas } from '@dcc/contracts'
import * as z from 'zod'

type Campaign = z.infer<typeof schemas.campaign.campaign>
type Theatre = z.infer<typeof schemas.theatre>
export type CampaignWeather = NonNullable<Campaign['weather']>
export type WeatherPattern = CampaignWeather['pattern']

export const WEATHER_PATTERNS: WeatherPattern[] = [
  'clear',
  'scattered',
  'broken',
  'overcast',
  'rain'
]

export const WEATHER_LABELS: Record<WeatherPattern, string> = {
  clear: 'Clear',
  scattered: 'Scattered clouds',
  broken: 'Broken clouds',
  overcast: 'Overcast',
  rain: 'Overcast, rain'
}

/**
 * DCS cloud presets per pattern. Every preset here accepts a base between the pattern's `base`
 * bounds, so the mission editor never has to clamp it.
 */
const PATTERNS: Record<
  WeatherPattern,
  {
    presets: string[]
    base: [number, number]
    wind: number
    qnh: number
    visibility: number
    /** How much of the sun's daily warming gets through. */
    sun: number
  }
> = {
  clear: { presets: [], base: [2500, 2500], wind: 0.7, qnh: 766, visibility: 80_000, sun: 1 },
  scattered: {
    presets: ['Preset2', 'Preset5', 'Preset6', 'Preset9', 'Preset10'],
    base: [1700, 2500],
    wind: 0.9,
    qnh: 762,
    visibility: 60_000,
    sun: 0.85
  },
  broken: {
    presets: ['Preset13', 'Preset14', 'Preset15', 'Preset16'],
    base: [1700, 2500],
    wind: 1,
    qnh: 758,
    visibility: 40_000,
    sun: 0.6
  },
  overcast: {
    presets: ['Preset22', 'Preset24', 'Preset25', 'Preset26', 'Preset27'],
    base: [600, 1500],
    wind: 1.3,
    qnh: 753,
    visibility: 20_000,
    sun: 0.35
  },
  rain: {
    presets: ['RainyPreset1'],
    base: [500, 1200],
    wind: 1.6,
    qnh: 748,
    visibility: 8_000,
    sun: 0.2
  }
}

/** Minimum surface wind, m/s; a theatre with a calm climate still gets some breeze. */
const MIN_WIND = 1.5
const HOUR_MS = 3_600_000

/** 1 in mid-winter, -1 in mid-summer, for the theatre's hemisphere. */
export function winterFactor(theatre: Pick<Theatre, 'name'>, time: Date) {
  const start = Date.UTC(time.getUTCFullYear(), 0, 1)
  const day = (time.getTime() - start) / (24 * HOUR_MS)
  const northern = Math.cos((2 * Math.PI * (day - 15)) / 365)
  return theatre.name === 'SouthAtlantic' ? -northern : northern
}

/** The pattern the climate pulls towards at this time of year. */
function climateIndex(theatre: Theatre, time: Date) {
  const { baseCloudCover, seasonEffect } = theatre.info.weather.cloudCover
  const cover = Math.min(
    1,
    Math.max(0, baseCloudCover + seasonEffect * winterFactor(theatre, time))
  )
  return Math.round(cover * (WEATHER_PATTERNS.length - 1))
}

function pick<T>(items: readonly T[], random: () => number) {
  return items[Math.floor(random() * items.length)]!
}

function between([min, max]: [number, number], random: () => number) {
  return Math.round(min + (max - min) * random())
}

/** One step of the weather chain: usually stays or moves one pattern towards the climate. */
export function nextWeatherPattern(
  current: WeatherPattern,
  theatre: Theatre,
  time: Date,
  random: () => number = Math.random
): WeatherPattern {
  const index = WEATHER_PATTERNS.indexOf(current)
  const target = climateIndex(theatre, time)
  const roll = random()
  let step: number
  if (target > index) step = roll < 0.5 ? 1 : roll < 0.8 ? 0 : -1
  else if (target < index) step = roll < 0.5 ? -1 : roll < 0.8 ? 0 : 1
  else step = roll < 0.25 ? -1 : roll < 0.75 ? 0 : 1
  const next = Math.min(WEATHER_PATTERNS.length - 1, Math.max(0, index + step))
  return WEATHER_PATTERNS[next]!
}

/** Builds the full weather for a pattern: clouds, wind, pressure, and when it changes next. */
export function rollWeather(
  pattern: WeatherPattern,
  theatre: Theatre,
  time: Date,
  random: () => number = Math.random
): CampaignWeather {
  const spec = PATTERNS[pattern]
  const climate = theatre.info.weather.wind
  const windSpeed = Math.max(MIN_WIND, climate.speed * spec.wind + (random() - 0.5) * 3)
  return {
    pattern,
    preset: spec.presets.length > 0 ? pick(spec.presets, random) : undefined,
    cloudBase: between(spec.base, random),
    windSpeed: Math.round(windSpeed * 10) / 10,
    windDirection: Math.round((climate.direction + (random() - 0.5) * 80 + 360) % 360),
    qnh: Math.round(spec.qnh + (random() - 0.5) * 4),
    visibility: spec.visibility,
    forecast: nextWeatherPattern(pattern, theatre, time, random),
    nextChangeAt: new Date(time.getTime() + (6 + random() * 6) * HOUR_MS)
  }
}

export function initialWeather(theatre: Theatre, time: Date, random: () => number = Math.random) {
  return rollWeather(WEATHER_PATTERNS[climateIndex(theatre, time)]!, theatre, time, random)
}

/** Surface temperature: the season, then the daily cycle, damped by cloud. */
export function weatherTemperature(
  theatre: Theatre,
  weather: Pick<CampaignWeather, 'pattern'> | undefined,
  time: Date
) {
  const { mean, amplitude } = theatre.info.weather.temperature
  const seasonal = mean - Math.max(0, winterFactor(theatre, time)) * amplitude * 1.5
  const sun = PATTERNS[weather?.pattern ?? 'clear'].sun
  const hour = time.getUTCHours() + time.getUTCMinutes() / 60
  const daily = (amplitude / 2) * sun * Math.sin((2 * Math.PI * (hour - 9)) / 24)
  return Math.round(seasonal + daily)
}

/**
 * A cloud deck low enough that visual attacks need to go under it: the planner holds back
 * ground attack, as the Falcon BMS planner does with laser bombs under overcast.
 */
export function isLowCeiling(weather: Pick<CampaignWeather, 'pattern' | 'cloudBase'> | undefined) {
  if (!weather) return false
  return (weather.pattern === 'overcast' || weather.pattern === 'rain') && weather.cloudBase < 1500
}

/** The `weather` table of a DCS mission for this campaign weather. */
export function dcsMissionWeather(
  theatre: Theatre,
  weather: CampaignWeather | undefined,
  time: Date
) {
  const temperature = weatherTemperature(theatre, weather, time)
  const speed = weather?.windSpeed ?? theatre.info.weather.wind.speed
  const direction = weather?.windDirection ?? theatre.info.weather.wind.direction
  const clouds = weather?.preset
    ? {
        density: 0,
        thickness: 200,
        preset: weather.preset,
        base: weather.cloudBase,
        iprecptns: 0
      }
    : weather
      ? { density: 0, thickness: 200, base: 2500, iprecptns: 0 }
      : // Campaigns without weather keep the old fixed sky.
        { density: 0, thickness: 200, preset: 'Preset2', base: 2500, iprecptns: 0 }
  return {
    wind: {
      atGround: { speed, dir: direction },
      at2000: { speed: Math.round(speed * 1.8 * 10) / 10, dir: (direction + 15) % 360 },
      at8000: { speed: Math.round(speed * 3 * 10) / 10, dir: (direction + 30) % 360 }
    },
    qnh: weather?.qnh ?? 760,
    temperature,
    visibility: weather?.visibility ?? 80_000,
    clouds
  }
}
