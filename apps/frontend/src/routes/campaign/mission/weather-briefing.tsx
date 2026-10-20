import { schemas } from '@dcc/contracts'
import { dcsMissionWeather, isLowCeiling, WEATHER_LABELS, type CampaignWeather } from '@dcc/data'
import { Cloud, Gauge, Sun, Wind } from 'lucide-react'
import type * as z from 'zod'

type Theatre = z.infer<typeof schemas.theatre>

const KNOTS_PER_MS = 1.943_844
const FEET_PER_METRE = 3.280_84
/** Standard lapse rate and the temperature below which jet exhaust leaves a trail. */
const LAPSE_PER_METRE = 0.0065
const CONTRAIL_TEMPERATURE = -40

function feet(metres: number) {
  return Math.round((metres * FEET_PER_METRE) / 100) * 100
}

function Row({ label, value, icon }: { label: string; value: string; icon?: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <span className="flex items-center gap-2 text-sm text-white/50">
        {icon}
        {label}
      </span>
      <span className="text-right text-sm text-white">{value}</span>
    </div>
  )
}

function windText(wind: { speed: number; dir: number }) {
  return `${String(Math.round(wind.dir)).padStart(3, '0')}° / ${Math.round(wind.speed * KNOTS_PER_MS)} kt`
}

/** Falcon BMS style weather brief: sky, ceiling, winds aloft, pressure, contrails, forecast. */
export function WeatherBriefing({
  theatre,
  weather,
  time
}: {
  theatre: Theatre
  weather: CampaignWeather | undefined
  time: Date
}) {
  const mission = dcsMissionWeather(theatre, weather, time)
  const contrails = Math.max(0, (mission.temperature - CONTRAIL_TEMPERATURE) / LAPSE_PER_METRE)
  const sky = weather ? WEATHER_LABELS[weather.pattern] : 'Light scattered (fixed)'
  const qnhHpa = Math.round(mission.qnh * 1.333_22)
  const qnhInHg = (mission.qnh / 25.4).toFixed(2)

  return (
    <div className="space-y-2.5">
      <Row label="Sky" value={sky} icon={<Cloud className="h-4 w-4" />} />
      {weather?.pattern !== 'clear' ? (
        <Row
          label="Cloud base"
          value={`${feet(mission.clouds.base).toLocaleString('en-US')} ft (${mission.clouds.base} m)`}
        />
      ) : null}
      <Row label="Visibility" value={`${Math.round(mission.visibility / 1000)} km`} />
      <Row label="Temp" value={`${mission.temperature}°C`} icon={<Sun className="h-4 w-4" />} />
      <Row
        label="Wind sfc"
        value={windText(mission.wind.atGround)}
        icon={<Wind className="h-4 w-4" />}
      />
      <Row label="Wind 2000 m" value={windText(mission.wind.at2000)} />
      <Row label="Wind 8000 m" value={windText(mission.wind.at8000)} />
      <Row
        label="QNH"
        value={`${mission.qnh} mmHg · ${qnhHpa} hPa · ${qnhInHg}`}
        icon={<Gauge className="h-4 w-4" />}
      />
      <Row label="Contrails" value={`above ${feet(contrails).toLocaleString('en-US')} ft`} />
      {weather ? (
        <Row
          label="Forecast"
          value={`${WEATHER_LABELS[weather.forecast]} from ${new Date(weather.nextChangeAt)
            .toISOString()
            .slice(11, 16)}Z`}
        />
      ) : null}
      {isLowCeiling(weather) ? (
        <div className="rounded border border-amber-300/30 bg-amber-300/5 px-2 py-1.5 text-xs text-amber-200">
          Low ceiling: the planners are holding back strike, CAS and SEAD packages until it lifts.
        </div>
      ) : null}
    </div>
  )
}
