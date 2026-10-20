import 'maplibre-gl/dist/maplibre-gl.css'

import { Crosshair, Map as MapIcon, Plane, ShieldAlert, Table2 } from 'lucide-react'
import { schemas } from '@dcc/contracts'
import { useQuery } from '@tanstack/react-query'
import { useSelector } from '@xstate/store/react'
import maplibregl from 'maplibre-gl'
import { Protocol } from 'pmtiles'
import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react'
import MaplibreMap, { Marker as MaplibreMarker, type MapRef } from 'react-map-gl/maplibre'
import * as z from 'zod'

import { Button } from '@/components/ui/button'
import { tryDcsPositionToLngLat } from '@/logic/dcs-coordinates'
import { hasFlightGroupTakenOff } from '@/logic/entities/flight-status'
import { orpc } from '@/lib/orpc'
import { cn } from '@/lib/utils'
import { activeStore } from '@/stores/active'
import { FlightGroupCard } from '../components/flight-group-card'
import { CAUCASUS_DETAIL_MAX_ZOOM, offlineCaucasusMapStyle } from '../home/offline-map-style'

type MissionState = z.infer<typeof schemas.missionState>
type Campaign = z.infer<typeof schemas.campaign.campaign>
type FlightGroup = Campaign['coalitions']['player']['flightGroups'][number]
type LostUnit = MissionState['lostUnits'][number]
type DebriefSide = 'blue' | 'red' | 'unknown'
type DebriefView = 'table' | 'map'

export type TargetOutcome = {
  label: string
  detail?: string
  complete: boolean
}

const globalWithPmtiles = globalThis as typeof globalThis & {
  __dccPmtilesProtocol?: Protocol
}
if (!globalWithPmtiles.__dccPmtilesProtocol) {
  globalWithPmtiles.__dccPmtilesProtocol = new Protocol()
  maplibregl.addProtocol('pmtiles', globalWithPmtiles.__dccPmtilesProtocol.tile)
}

export type MissionDebrief = {
  submittedAt: Date
  missionState: MissionState
  clientFlightGroups: FlightGroup[]
  targetOutcomes: Record<string, TargetOutcome>
  /** Career money, losses and damage from this mission. */
  careerLines?: string[]
  /** Falcon-style rating of each player flight, and the morale it left both sides on. */
  ratings?: Array<{ callsign: string; task: string; rating: number; reasons: string[] }>
  morale?: { player: number; opponent: number }
  /** Logbook points, medals and promotions from this mission. */
  logbookLines?: string[]
}

const RATING_NAMES = ['', 'Poor', 'Marginal', 'Average', 'Good', 'Excellent']

function formatTime(date: Date | string) {
  const d = new Date(date)
  return new Intl.DateTimeFormat('en-GB', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
    timeZone: 'UTC'
  }).format(d)
}

function getLostUnitField(unit: LostUnit, key: string): unknown {
  return (unit as Record<string, unknown>)[key]
}

function normalizeCoalition(value: unknown): DebriefSide {
  if (value === 'blue' || value === 2) return 'blue'
  if (value === 'red' || value === 1) return 'red'
  return 'unknown'
}

function getLostUnitSide(unit: LostUnit): DebriefSide {
  return normalizeCoalition(getLostUnitField(unit, 'coalition'))
}

function getLostUnitText(unit: LostUnit, key: string): string | null {
  const value = getLostUnitField(unit, key)
  return typeof value === 'string' && value.length > 0 ? value : null
}

function formatLossType(unit: LostUnit): string {
  const lossType = getLostUnitText(unit, 'lossType') ?? getLostUnitText(unit, 'event')
  if (!lossType) return 'lost'
  return lossType.replace(/_/g, ' ')
}

function groupLostUnitsBySide(lostUnits: LostUnit[]) {
  const grouped = lostUnits.reduce<Record<DebriefSide, LostUnit[]>>(
    (groups, unit) => {
      const side = getLostUnitSide(unit)
      if (side !== 'unknown') {
        groups[side].push(unit)
      }
      return groups
    },
    { blue: [], red: [], unknown: [] }
  )

  for (const side of ['blue', 'red', 'unknown'] as const) {
    grouped[side].sort(
      (a, b) => (a.time ?? Number.POSITIVE_INFINITY) - (b.time ?? Number.POSITIVE_INFINITY)
    )
  }

  return grouped
}

function formatEventTime(unit: LostUnit): string | null {
  if (unit.time == null || !Number.isFinite(unit.time)) return null

  const totalSeconds = Math.floor(unit.time)
  const hours = Math.floor(totalSeconds / 3600) % 24
  const minutes = Math.floor((totalSeconds % 3600) / 60)
  const seconds = totalSeconds % 60
  return `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}:${seconds
    .toString()
    .padStart(2, '0')} UTC`
}

function DebriefViewToggle({
  view,
  onViewChange
}: {
  view: DebriefView
  onViewChange: (view: DebriefView) => void
}) {
  return (
    <div className="flex rounded border border-white/10 bg-black/35 p-1">
      {[
        { view: 'table' as const, label: 'Table', icon: Table2 },
        { view: 'map' as const, label: 'Map', icon: MapIcon }
      ].map(({ view: option, label, icon: Icon }) => (
        <button
          key={option}
          type="button"
          className={cn(
            'flex h-8 items-center gap-2 rounded px-3 text-xs font-semibold uppercase tracking-[0.12em] transition-colors',
            view === option
              ? 'bg-[#e8b730]/15 text-[#e8b730] ring-1 ring-[#e8b730]/35'
              : 'text-white/45 hover:bg-white/5 hover:text-white/75'
          )}
          onClick={() => onViewChange(option)}
          aria-pressed={view === option}
        >
          <Icon className="h-4 w-4" />
          {label}
        </button>
      ))}
    </div>
  )
}

function DebriefEventMarker({
  unit,
  theatreName,
  index
}: {
  unit: LostUnit
  theatreName: string
  index: number
}) {
  const [isHovered, setIsHovered] = useState(false)
  const side = getLostUnitSide(unit)
  const position = useMemo(
    () => tryDcsPositionToLngLat(theatreName, unit.x, unit.y),
    [theatreName, unit.x, unit.y]
  )
  const color = side === 'blue' ? '#00ddff' : side === 'red' ? '#ff3366' : 'rgba(255,255,255,0.72)'
  const time = formatEventTime(unit)

  if (!position) return null

  return (
    <MaplibreMarker
      longitude={position.lng}
      latitude={position.lat}
      anchor="center"
      style={{ zIndex: isHovered ? 1000 : 30 + index }}
    >
      <div
        className="group pointer-events-auto relative flex h-8 w-8 items-center justify-center"
        onMouseEnter={() => setIsHovered(true)}
        onMouseLeave={() => setIsHovered(false)}
      >
        <span
          className="absolute h-8 w-8 rounded-full border opacity-60"
          style={{ borderColor: color, boxShadow: `0 0 18px ${color}` }}
        />
        <ExplosionIcon
          className="relative h-6 w-6 drop-shadow-[0_0_7px_rgba(255,145,0,0.9)]"
          style={{ color }}
        />
        <div className="pointer-events-none absolute left-9 top-1/2 z-50 hidden w-52 -translate-y-1/2 rounded border border-white/15 bg-black/85 p-2 text-left shadow-2xl backdrop-blur-sm group-hover:block">
          <div className="truncate text-xs font-semibold text-white">{unit.name}</div>
          <div className="mt-0.5 truncate text-[11px] text-white/45">{unit.type}</div>
          <div className="mt-2 flex items-center justify-between gap-2 text-[11px] uppercase tracking-wider text-white/55">
            <span>{formatLossType(unit)}</span>
            <span>{time ?? 'time unknown'}</span>
          </div>
        </div>
      </div>
    </MaplibreMarker>
  )
}

function ExplosionIcon({ className, style }: { className?: string; style?: CSSProperties }) {
  return (
    <svg
      className={className}
      viewBox="0 0 64 64"
      aria-hidden="true"
      focusable="false"
      role="img"
      fill="currentColor"
      style={style}
    >
      <g transform="matrix(0.277 0 0 0.277 -10.1 -10.1)">
        <path
          d="m200.39 210.99 35.941-96.309-47.461 54.836 3.227-31.797-16.59 25.348-2.305-97.692-17.051 89.856-11.976-33.176-1.844 36.863-48.844-91.238 16.586 105.06-33.636-35.946 24.421 64.516-33.175-23.504 39.168 60.824 13.129-1.449-8.524-40.48 19.816 18.429-1.382-44.234 19.351 34.097 3.227-22.578 5.992 16.125 7.832-24.882 2.305 35.019 26.726-22.578-11.98 38.246 18.199-5.988-10.285 11.187 31.254 4.016-14.285-11.52 21.195-23.5-29.027 12.442"
          fillRule="evenodd"
        />
      </g>
    </svg>
  )
}

function countDestroyedTargetUnits(missionState: MissionState, targetId: string) {
  const namePrefix = `Ground-${targetId}-`
  return missionState.lostUnits.filter((unit) => {
    const groupName = unit.groupName ?? undefined
    return unit.name.startsWith(namePrefix) || groupName?.startsWith(namePrefix)
  }).length
}

function countRemainingTargetUnits(missionState: MissionState, targetId: string) {
  const namePrefix = `Ground-${targetId}-`
  const groundGroups = [
    ...(missionState.groupPositions?.blue?.ground ?? []),
    ...(missionState.groupPositions?.red?.ground ?? [])
  ]
  const targetGroup = groundGroups.find((group) => group.name.startsWith(namePrefix))
  return targetGroup?.units.length
}

function getTargetUnitTotal(group: FlightGroup) {
  const target = group.target as
    | (Record<string, unknown> & NonNullable<FlightGroup['target']>)
    | undefined
  if (!target) return undefined

  return (
    (typeof target.unitCount === 'number' ? target.unitCount : undefined) ??
    (typeof target.totalUnits === 'number' ? target.totalUnits : undefined) ??
    (typeof target.initialStrength === 'number' ? target.initialStrength : undefined)
  )
}

function getFallbackTargetOutcome(group: FlightGroup, missionState: MissionState): TargetOutcome {
  if (group.target) {
    const destroyedTargetUnits = countDestroyedTargetUnits(missionState, group.target.id)
    if (destroyedTargetUnits > 0) {
      const remainingTargetUnits = countRemainingTargetUnits(missionState, group.target.id)
      const targetUnitTotal =
        getTargetUnitTotal(group) ??
        (remainingTargetUnits != null ? destroyedTargetUnits + remainingTargetUnits : undefined)
      return {
        label: 'Target damaged',
        detail:
          targetUnitTotal != null && targetUnitTotal > 0
            ? `${destroyedTargetUnits}/${targetUnitTotal} destroyed`
            : `${destroyedTargetUnits} destroyed`,
        complete: false
      }
    }

    return {
      label: group.targetDestroyed ? 'Target achieved' : 'Target not destroyed',
      detail: group.target.type,
      complete: group.targetDestroyed === true
    }
  }

  return {
    label: 'No tracked target',
    detail: group.task,
    complete: false
  }
}

function MissionDebriefMap({ missionState }: { missionState: MissionState }) {
  const mapRef = useRef<MapRef | null>(null)
  const scenarioId = useSelector(activeStore, (state) => state.context.scenarioId)
  const scenarioQuery = useQuery(
    orpc.data.getScenario.queryOptions({
      input: scenarioId
    })
  )
  const theatreQuery = useQuery(
    orpc.data.getTheatre.queryOptions({
      input: scenarioQuery.data?.theatreName ?? '',
      enabled: scenarioQuery.data?.theatreName != null
    })
  )
  const eventUnits = useMemo(
    () =>
      (missionState.lostUnits ?? []).filter(
        (unit) =>
          getLostUnitSide(unit) !== 'unknown' && Number.isFinite(unit.x) && Number.isFinite(unit.y)
      ),
    [missionState.lostUnits]
  )
  const initialViewState = useMemo(() => {
    const theatre = theatreQuery.data
    if (!theatre) return null

    const center =
      eventUnits.length > 0
        ? {
            x: eventUnits.reduce((sum, unit) => sum + unit.x, 0) / eventUnits.length,
            y: eventUnits.reduce((sum, unit) => sum + unit.y, 0) / eventUnits.length
          }
        : theatre.info.center
    const latLng =
      tryDcsPositionToLngLat(theatre.name, center.x, center.y) ??
      tryDcsPositionToLngLat(theatre.name, theatre.info.center.x, theatre.info.center.y)
    if (!latLng) return null

    return {
      longitude: latLng.lng,
      latitude: latLng.lat,
      zoom: eventUnits.length > 0 ? 7 : 6
    }
  }, [eventUnits, theatreQuery.data])

  useEffect(() => {
    if (!mapRef.current) return

    const resize = () => {
      mapRef.current?.resize()
    }

    resize()
    const frame = window.requestAnimationFrame(resize)
    const timeout = window.setTimeout(resize, 150)

    return () => {
      window.cancelAnimationFrame(frame)
      window.clearTimeout(timeout)
    }
  }, [initialViewState])

  const theatre = theatreQuery.data

  if (theatreQuery.isLoading || initialViewState == null || theatre == null) {
    return (
      <div className="flex min-h-0 flex-1 items-center justify-center rounded border border-white/10 bg-black/35 text-sm text-white/45">
        Loading map
      </div>
    )
  }

  return (
    <section className="relative min-h-0 flex-1 overflow-hidden rounded-lg border border-white/10 bg-black/45">
      <MaplibreMap
        ref={mapRef}
        style={{ position: 'absolute', inset: 0, width: '100%', height: '100%' }}
        initialViewState={initialViewState}
        mapStyle={offlineCaucasusMapStyle}
        minZoom={3}
        maxZoom={CAUCASUS_DETAIL_MAX_ZOOM}
      >
        {eventUnits.map((unit, index) => (
          <DebriefEventMarker
            key={`${unit.name}-${index}`}
            unit={unit}
            theatreName={theatre.name}
            index={index}
          />
        ))}
      </MaplibreMap>
      <div className="pointer-events-none absolute left-4 top-4 rounded border border-white/10 bg-black/70 px-3 py-2 backdrop-blur-sm">
        <div className="text-[10px] font-semibold uppercase tracking-[0.28em] text-white/45">
          Event Map
        </div>
        <div className="mt-1 text-sm font-semibold text-white">{eventUnits.length} plotted</div>
      </div>
      {eventUnits.length === 0 && (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
          <div className="rounded border border-white/10 bg-black/75 px-4 py-3 text-sm text-white/45 backdrop-blur-sm">
            No events with coordinates
          </div>
        </div>
      )}
    </section>
  )
}

export function MissionDebriefScreen({
  debrief,
  onClose
}: {
  debrief: MissionDebrief
  onClose: () => void
}) {
  const [view, setView] = useState<DebriefView>('table')
  const campaignTime = useSelector(activeStore, (state) => state.context.time)
  const playerFlightGroups = useSelector(
    activeStore,
    (state) => state.context.coalitions.player.flightGroups
  )
  const activeClientFlightGroups = useMemo(
    () => playerFlightGroups.filter((group) => group.aircrafts.some((aircraft) => aircraft.client)),
    [playerFlightGroups]
  )
  const clientFlightGroups =
    debrief.clientFlightGroups.length > 0 ? debrief.clientFlightGroups : activeClientFlightGroups
  const lostBySide = groupLostUnitsBySide(debrief.missionState.lostUnits ?? [])
  const totalLost = lostBySide.blue.length + lostBySide.red.length
  const submittedTime = formatTime(debrief.submittedAt)
  const currentTime = campaignTime ? new Date(campaignTime) : new Date(debrief.submittedAt)

  const columns: Array<{
    side: DebriefSide
    label: string
    border: string
    accent: string
    icon: typeof ShieldAlert
  }> = [
    {
      side: 'blue',
      label: 'Blue Losses',
      border: 'border-[#00ddff]/35',
      accent: 'text-[#00ddff]',
      icon: ShieldAlert
    },
    {
      side: 'red',
      label: 'Red Losses',
      border: 'border-[#ff3366]/40',
      accent: 'text-[#ff3366]',
      icon: Crosshair
    }
  ]

  return (
    <div className="h-full overflow-hidden bg-[#0f0e0d] text-white">
      <div
        className="fixed inset-0"
        style={{
          backgroundImage:
            'linear-gradient(to right, rgba(232,183,48,0.08) 1px, transparent 1px), linear-gradient(to bottom, rgba(255,51,102,0.08) 1px, transparent 1px)',
          backgroundSize: '44px 44px'
        }}
      />
      <div className="fixed inset-x-0 bottom-0 h-[34vh] bg-gradient-to-t from-[#e8b730]/20 via-[#ff3366]/10 to-transparent" />

      <div className="relative z-10 flex h-full min-h-0 flex-col gap-5 p-6">
        <div className="flex items-start justify-between gap-4">
          <div>
            <div className="text-xs font-semibold uppercase tracking-[0.35em] text-white/45">
              Mission Debrief
            </div>
            <h1 className="mt-2 text-3xl font-black uppercase tracking-[0.16em] text-white">
              Submitted Results
            </h1>
            <div className="mt-2 flex flex-wrap gap-3 text-sm text-white/55">
              <span>{submittedTime} UTC</span>
              <span>{totalLost} total units lost</span>
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-3">
            <DebriefViewToggle view={view} onViewChange={setView} />
            <Button
              variant="tacticalAction"
              size="sm"
              className="h-10 rounded-md px-5 text-sm font-semibold"
              onClick={onClose}
            >
              Continue
            </Button>
          </div>
        </div>

        {view === 'table' ? (
          <div className="grid min-h-0 flex-1 grid-cols-1 gap-4 lg:grid-cols-3">
            <section className="flex min-h-[320px] flex-col rounded-lg border border-[#d9443a]/35 bg-black/35 p-4 backdrop-blur-sm">
              <div className="mb-4 flex items-center gap-2">
                <Plane className="h-5 w-5 text-[#d9443a]" />
                <span className="text-sm font-semibold uppercase tracking-[0.18em]">
                  Client Flights
                </span>
                <span className="ml-auto text-2xl font-black tabular-nums text-[#d9443a]">
                  {clientFlightGroups.length}
                </span>
              </div>

              <div className="min-h-0 flex-1 overflow-auto space-y-2">
                {clientFlightGroups.length === 0 ? (
                  <div className="flex h-full items-center justify-center rounded border border-white/10 bg-white/[0.03] text-sm text-white/35">
                    No client flights selected
                  </div>
                ) : (
                  clientFlightGroups.map((group) => (
                    <FlightGroupCard
                      key={group.id}
                      group={group}
                      isAirborne={hasFlightGroupTakenOff(group, currentTime)}
                      showAircraftType
                      targetOutcome={
                        debrief.targetOutcomes[group.id] ??
                        getFallbackTargetOutcome(group, debrief.missionState)
                      }
                    />
                  ))
                )}
                {debrief.ratings && debrief.ratings.length > 0 ? (
                  <div className="rounded border border-[#d9443a]/30 bg-[#d9443a]/5 p-3">
                    <div className="mb-1.5 text-xs font-semibold uppercase tracking-[0.18em] text-[#ef7f70]">
                      Mission rating
                    </div>
                    <ul className="space-y-1 text-sm text-white/80">
                      {debrief.ratings.map((rating) => (
                        <li key={rating.callsign}>
                          <span className="font-semibold text-white">{rating.callsign}</span> (
                          {rating.task}): {RATING_NAMES[rating.rating]}{' '}
                          <span className="text-white/45">· {rating.reasons.join(', ')}</span>
                        </li>
                      ))}
                    </ul>
                    {debrief.morale ? (
                      <div className="mt-2 text-xs text-white/50">
                        Morale: ours {Math.round(debrief.morale.player)} · theirs{' '}
                        {Math.round(debrief.morale.opponent)} (50 is even; higher fights harder)
                      </div>
                    ) : null}
                  </div>
                ) : null}
                {debrief.logbookLines && debrief.logbookLines.length > 0 ? (
                  <div className="rounded border border-amber-300/30 bg-amber-300/5 p-3">
                    <div className="mb-1.5 text-xs font-semibold uppercase tracking-[0.18em] text-amber-200">
                      Logbook
                    </div>
                    <ul className="space-y-1 text-sm text-white/80">
                      {debrief.logbookLines.map((line, index) => (
                        <li key={index}>{line}</li>
                      ))}
                    </ul>
                  </div>
                ) : null}
                {debrief.careerLines && debrief.careerLines.length > 0 ? (
                  <div className="rounded border border-synthwave-cyan/30 bg-synthwave-cyan/5 p-3">
                    <div className="mb-1.5 text-xs font-semibold uppercase tracking-[0.18em] text-synthwave-cyan">
                      Career
                    </div>
                    <ul className="space-y-1 text-sm text-white/80">
                      {debrief.careerLines.map((line, index) => (
                        <li key={index}>{line}</li>
                      ))}
                    </ul>
                  </div>
                ) : null}
              </div>
            </section>

            {columns.map(({ side, label, border, accent, icon: Icon }) => {
              const units = lostBySide[side]
              return (
                <section
                  key={side}
                  className={cn(
                    'flex min-h-[320px] flex-col rounded-lg border bg-black/35 p-4 backdrop-blur-sm',
                    border
                  )}
                >
                  <div className="mb-4 flex items-center gap-2">
                    <Icon className={cn('h-5 w-5', accent)} />
                    <span className="text-sm font-semibold uppercase tracking-[0.18em]">
                      {label}
                    </span>
                    <span className={cn('ml-auto text-2xl font-black tabular-nums', accent)}>
                      {units.length}
                    </span>
                  </div>

                  <div className="min-h-0 flex-1 overflow-auto space-y-2">
                    {units.length === 0 ? (
                      <div className="flex h-full items-center justify-center rounded border border-white/10 bg-white/[0.03] text-sm text-white/35">
                        No losses recorded
                      </div>
                    ) : (
                      units.map((unit, index) => (
                        <div
                          key={`${unit.name}-${index}`}
                          className="rounded border border-white/10 bg-white/[0.04] px-3 py-2.5"
                        >
                          <div className="flex items-start justify-between gap-3">
                            <div className="min-w-0">
                              <div className="truncate text-sm font-semibold text-white">
                                {unit.name}
                              </div>
                              <div className="truncate text-xs text-white/45">{unit.type}</div>
                            </div>
                            <div className="shrink-0 rounded border border-white/10 px-2 py-1 text-[11px] uppercase tracking-wider text-white/55">
                              {formatLossType(unit)}
                            </div>
                          </div>
                          <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-xs text-white/45">
                            <span>{formatEventTime(unit) ?? 'Time unknown'}</span>
                            <span>
                              {Math.round(unit.x)}, {Math.round(unit.y)}
                            </span>
                          </div>
                          {(getLostUnitText(unit, 'killerPlayerName') ||
                            getLostUnitText(unit, 'weaponName')) && (
                            <div className="mt-2 truncate text-xs text-white/45">
                              {getLostUnitText(unit, 'killerPlayerName') ?? 'Unknown'}{' '}
                              {getLostUnitText(unit, 'weaponName')
                                ? `with ${getLostUnitText(unit, 'weaponName')}`
                                : ''}
                            </div>
                          )}
                        </div>
                      ))
                    )}
                  </div>
                </section>
              )
            })}
          </div>
        ) : (
          <MissionDebriefMap missionState={debrief.missionState} />
        )}
      </div>
    </div>
  )
}
