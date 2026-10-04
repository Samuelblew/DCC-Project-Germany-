import 'maplibre-gl/dist/maplibre-gl.css'

import { useSelector } from '@xstate/store/react'
import { activeStore } from '@/stores/active'
import { uiStore } from '@/stores/ui'
import { useQuery } from '@tanstack/react-query'
import { orpc } from '@/lib/orpc'
import { memo, useMemo, useState, useEffect, useRef, useCallback } from 'react'
import * as z from 'zod'
import { schemas } from '@dcc/contracts'
import { getCareerAircraft } from '@dcc/data'
import MaplibreMap, {
  Marker as MaplibreMarker,
  Source,
  Layer,
  useMap,
  type MapLayerMouseEvent,
  type MapRef
} from 'react-map-gl/maplibre'
import maplibregl from 'maplibre-gl'
import { Protocol } from 'pmtiles'
import { Plane, RotateCcw, Star } from 'lucide-react'
import MilSymbol from 'milsymbol'
import * as turf from '@turf/turf'
import { getMilSymbolCode } from './unit-code'
import { type ObjectiveMarker as ObjectiveMarkerType, useMapItems } from './use-map-items'
import { cn } from '@/lib/utils'
import { DetailsCard } from './details-card'
import { CAUCASUS_DETAIL_MAX_ZOOM, offlineCaucasusMapStyle } from './offline-map-style'
import {
  longRangeSamMinRangeMeters,
  resolveAircraftCullingRadiusMeters,
  resolveCullingRadiusMeters,
  resolveSamCullingRadiusMeters
} from '@dcc/contracts'
import { tryDcsPositionToLngLat, tryLngLatToDcsPosition } from '@/logic/dcs-coordinates'
import { isEditableWaypoint, isFlightRouteEditable } from '@/stores/active'

const globalWithPmtiles = globalThis as typeof globalThis & {
  __dccPmtilesProtocol?: Protocol
}
if (!globalWithPmtiles.__dccPmtilesProtocol) {
  globalWithPmtiles.__dccPmtilesProtocol = new Protocol()
  maplibregl.addProtocol('pmtiles', globalWithPmtiles.__dccPmtilesProtocol.tile)
}

const Marker = memo(function Marker({
  item,
  onClick,
  isSelected
}: {
  item: z.infer<typeof schemas.MapItem>
  onClick: () => void
  isSelected: boolean
}) {
  const symbol = useMemo(() => {
    const symbol = new MilSymbol.Symbol(getMilSymbolCode(item), {
      size: 20
    })
    return symbol.asSVG()
  }, [item])

  const isPersistentCommandAsset =
    item.type === 'Airdrome' || item.type === 'Naval Group' || item.type === 'GCI'
  const showTitleCard = isPersistentCommandAsset || isSelected
  const isInactive = 'active' in item && item.active === false
  const coalitionColor = item.coalition === 'player' ? 'var(--friendly-blue)' : 'var(--enemy-red)'

  return (
    <MaplibreMarker
      longitude={item.position.lng}
      latitude={item.position.lat}
      anchor="center"
      style={{ zIndex: showTitleCard ? 40 : 20 }}
      onClick={(e) => {
        e.originalEvent.stopPropagation()
        onClick()
      }}
    >
      <div
        className={cn('pointer-events-auto', isInactive && 'opacity-40 grayscale')}
        onPointerDown={(e) => {
          e.stopPropagation()
          onClick()
        }}
      >
        {showTitleCard ? (
          <div
            className={cn(
              'tactical-panel flex translate-x-12 items-center gap-2 rounded-md py-1 pr-3 pl-1.5 backdrop-blur-sm transition-all',
              isSelected && 'ring-2 ring-synthwave-pink drop-shadow-md scale-110'
            )}
            style={{
              borderColor: coalitionColor,
              boxShadow: `0 0 0 1px color-mix(in srgb, ${coalitionColor} 35%, transparent), 0 0 16px color-mix(in srgb, ${coalitionColor} 22%, transparent), 0 0 14px rgba(0, 0, 0, 0.65)`
            }}
            title={item.name}
          >
            <div
              className="tactical-inset flex h-8 w-8 shrink-0 items-center justify-center rounded-sm"
              dangerouslySetInnerHTML={{ __html: symbol }}
            />
            <span className="max-w-32 truncate text-xs font-semibold leading-tight text-synthwave-light drop-shadow-[0_1px_2px_rgba(0,0,0,0.9)]">
              {item.name}
            </span>
          </div>
        ) : (
          <div
            className={cn(
              'transition-all',
              isSelected && 'ring-2 ring-synthwave-pink rounded-full drop-shadow-md scale-110'
            )}
            dangerouslySetInnerHTML={{ __html: symbol }}
          />
        )}
      </div>
    </MaplibreMarker>
  )
})

/** Yellow pin over each airfield where the career aircraft are parked, labelled by type and tail. */
const CareerBaseMarker = memo(function CareerBaseMarker({
  base
}: {
  base: { name: string; lng: number; lat: number; tails: string[]; flying: boolean }
}) {
  return (
    <MaplibreMarker longitude={base.lng} latitude={base.lat} anchor="bottom" style={{ zIndex: 50 }}>
      <div
        className="pointer-events-none flex -translate-y-4 flex-col items-center"
        title={base.name}
      >
        <div className="flex items-center gap-1 rounded-full border-2 border-[#f5d020] bg-black/80 px-2 py-0.5 text-[11px] font-bold text-[#f5d020] shadow-[0_0_12px_rgba(245,208,32,0.55)]">
          <Plane className="h-3.5 w-3.5" fill="#f5d020" />
          {base.tails.join(' · ')}
          {base.flying ? (
            <span className="text-[9px] font-semibold opacity-80">· SORTIE</span>
          ) : null}
        </div>
        <div className="h-2.5 w-0.5 bg-[#f5d020]" />
      </div>
    </MaplibreMarker>
  )
})

const ObjectiveCircleMarker = memo(function ObjectiveCircleMarker({
  marker,
  onClick,
  isSelected
}: {
  marker: ObjectiveMarkerType
  onClick: () => void
  isSelected: boolean
}) {
  const color = marker.coalition === 'player' ? 'var(--friendly-blue)' : 'var(--enemy-red)'
  const showTitleCard = marker.isGoal || marker.labeled || isSelected

  return (
    <MaplibreMarker
      longitude={marker.position.lng}
      latitude={marker.position.lat}
      anchor="center"
      style={{ zIndex: showTitleCard ? 45 : 25 }}
      onClick={(e) => {
        e.originalEvent.stopPropagation()
        onClick()
      }}
    >
      <div
        className="pointer-events-auto"
        onPointerDown={(e) => {
          e.stopPropagation()
          onClick()
        }}
      >
        {showTitleCard ? (
          <div
            className={cn(
              'tactical-panel flex translate-x-12 items-center gap-2 rounded-md py-1 pr-3 pl-1.5 backdrop-blur-sm transition-all',
              isSelected && 'ring-2 ring-synthwave-pink drop-shadow-md scale-110'
            )}
            style={{
              borderColor: color,
              boxShadow: `0 0 0 1px color-mix(in srgb, ${color} 35%, transparent), 0 0 16px color-mix(in srgb, ${color} 22%, transparent), 0 0 14px rgba(0, 0, 0, 0.65)`
            }}
            title={marker.name}
          >
            <div className="tactical-inset flex h-8 w-8 shrink-0 items-center justify-center rounded-sm">
              {marker.isGoal ? (
                <Star
                  className="h-5 w-5"
                  fill={color}
                  stroke={color}
                  strokeWidth={1.75}
                  aria-hidden="true"
                />
              ) : (
                <span
                  className="block h-3 w-3 rounded-full border-2"
                  style={{ borderColor: color }}
                >
                  <span
                    className="m-0.5 block h-1.5 w-1.5 rounded-full"
                    style={{ backgroundColor: color }}
                  />
                </span>
              )}
            </div>
            <span className="max-w-32 truncate text-xs font-semibold leading-tight text-synthwave-light drop-shadow-[0_1px_2px_rgba(0,0,0,0.9)]">
              {marker.name}
            </span>
          </div>
        ) : (
          <div
            className={cn(
              'flex h-4 w-4 items-center justify-center rounded-full border-2 bg-black/70 transition-all',
              isSelected && 'ring-2 ring-white scale-125'
            )}
            style={{ borderColor: color }}
            title={marker.name}
          >
            <span className="block h-1.5 w-1.5 rounded-full" style={{ backgroundColor: color }} />
          </div>
        )}
      </div>
    </MaplibreMarker>
  )
})

export type SelectedItem =
  | z.infer<typeof schemas.MapItem>
  | ObjectiveMarkerType
  | z.infer<typeof schemas.flightGroup>
  | z.infer<typeof schemas.groundGroup>
  | null

type MeasurePoint = {
  id: string
  lng: number
  lat: number
}

type MeasureState = {
  mode: boolean
  points: MeasurePoint[]
}

type MeasureSegment = {
  id: string
  from: MeasurePoint
  to: MeasurePoint
  distanceNm: number
}

const KILOMETERS_PER_NAUTICAL_MILE = 1.852

function getDistanceNm(from: MeasurePoint, to: MeasurePoint) {
  return (
    turf.distance([from.lng, from.lat], [to.lng, to.lat], {
      units: 'kilometers'
    }) / KILOMETERS_PER_NAUTICAL_MILE
  )
}

function formatNauticalMiles(value: number) {
  if (value < 10) return `${value.toFixed(1)} NM`
  return `${Math.round(value)} NM`
}

const FlightPlanOverlay = memo(function FlightPlanOverlay({
  flightplan,
  theatreName
}: {
  flightplan: z.infer<typeof schemas.flightplan>
  theatreName: string
}) {
  const { current: map } = useMap()
  const [path, setPath] = useState('')

  useEffect(() => {
    if (!map) return

    const updatePath = () => {
      const points = flightplan.waypoints.flatMap((wp) => {
        const latLng = tryDcsPositionToLngLat(theatreName, wp.position.x, wp.position.y)
        if (!latLng) return []
        const p = map.project([latLng.lng, latLng.lat])
        return [`${p.x},${p.y}`]
      })
      setPath(points.length > 1 ? `M ${points.join(' L ')}` : '')
    }

    updatePath()
    map.on('move', updatePath)
    map.on('zoom', updatePath)
    map.on('rotate', updatePath)
    map.on('resize', updatePath)

    return () => {
      map.off('move', updatePath)
      map.off('zoom', updatePath)
      map.off('rotate', updatePath)
      map.off('resize', updatePath)
    }
  }, [map, flightplan, theatreName])

  return (
    <svg className="absolute inset-0 w-full h-full pointer-events-none" style={{ zIndex: 5 }}>
      <path
        d={path}
        stroke="var(--synthwave-pink)"
        strokeWidth="3"
        fill="none"
        strokeLinecap="round"
        strokeLinejoin="round"
        className="drop-shadow-[0_0_5px_var(--synthwave-pink)]"
      />
    </svg>
  )
})

const WaypointLabelMarker = memo(function WaypointLabelMarker({
  waypoint,
  theatreName
}: {
  waypoint: z.infer<typeof schemas.waypoint>
  theatreName: string
}) {
  const latLng = useMemo(
    () => tryDcsPositionToLngLat(theatreName, waypoint.position.x, waypoint.position.y),
    [theatreName, waypoint.position.x, waypoint.position.y]
  )

  if (!latLng) return null

  return (
    <MaplibreMarker
      longitude={latLng.lng}
      latitude={latLng.lat}
      anchor="top"
      style={{ zIndex: 30 }}
    >
      <div
        className="pointer-events-none relative z-30 rounded-full bg-synthwave-dark/80 px-2 py-0.5 text-xs text-synthwave-light ring-1 ring-synthwave-pink/40 shadow-[0_0_8px_rgba(217,68,58,0.35)]"
        style={{ transform: 'translateY(5px)' }}
      >
        {waypoint.name}
      </div>
    </MaplibreMarker>
  )
})

type RouteDragPreview = {
  kind: 'move' | 'insert'
  index: number
  lng: number
  lat: number
}

const EditableWaypointMarker = memo(function EditableWaypointMarker({
  waypoint,
  index,
  lngLat,
  onDrag,
  onDragEnd,
  onRemove
}: {
  waypoint: z.infer<typeof schemas.waypoint>
  index: number
  lngLat: { lng: number; lat: number }
  onDrag: (preview: RouteDragPreview) => void
  onDragEnd: (preview: RouteDragPreview) => void
  onRemove: (index: number) => void
}) {
  const removable = waypoint.type === 'Nav'
  return (
    <MaplibreMarker
      longitude={lngLat.lng}
      latitude={lngLat.lat}
      anchor="center"
      draggable
      style={{ zIndex: 50 }}
      onDrag={(event) =>
        onDrag({ kind: 'move', index, lng: event.lngLat.lng, lat: event.lngLat.lat })
      }
      onDragEnd={(event) =>
        onDragEnd({ kind: 'move', index, lng: event.lngLat.lng, lat: event.lngLat.lat })
      }
    >
      <div
        className="group relative flex cursor-move flex-col items-center"
        title={
          removable
            ? `${waypoint.name}: drag to move, right-click to delete`
            : `${waypoint.name}: drag to move`
        }
        onContextMenu={(event) => {
          event.preventDefault()
          event.stopPropagation()
          if (removable) onRemove(index)
        }}
      >
        <span className="block h-3.5 w-3.5 rounded-full border-2 border-synthwave-pink bg-synthwave-dark shadow-[0_0_8px_rgba(217,68,58,0.6)] transition-transform group-hover:scale-125" />
        <span className="pointer-events-none absolute top-4 whitespace-nowrap rounded-full bg-synthwave-dark/80 px-2 py-0.5 text-xs text-synthwave-light ring-1 ring-synthwave-pink/40">
          {waypoint.name}
        </span>
      </div>
    </MaplibreMarker>
  )
})

const RouteInsertHandle = memo(function RouteInsertHandle({
  afterIndex,
  lngLat,
  onDrag,
  onDragEnd
}: {
  afterIndex: number
  lngLat: { lng: number; lat: number }
  onDrag: (preview: RouteDragPreview) => void
  onDragEnd: (preview: RouteDragPreview) => void
}) {
  return (
    <MaplibreMarker
      longitude={lngLat.lng}
      latitude={lngLat.lat}
      anchor="center"
      draggable
      style={{ zIndex: 45 }}
      onDrag={(event) =>
        onDrag({
          kind: 'insert',
          index: afterIndex,
          lng: event.lngLat.lng,
          lat: event.lngLat.lat
        })
      }
      onDragEnd={(event) =>
        onDragEnd({
          kind: 'insert',
          index: afterIndex,
          lng: event.lngLat.lng,
          lat: event.lngLat.lat
        })
      }
    >
      <span
        className="block h-2.5 w-2.5 cursor-copy rounded-full border border-synthwave-pink/80 bg-synthwave-pink/30 opacity-70 hover:opacity-100"
        title="Drag to add a waypoint here"
      />
    </MaplibreMarker>
  )
})

const GroundGroupPathOverlay = memo(function GroundGroupPathOverlay({
  groupPosition,
  targetPosition,
  theatreName
}: {
  groupPosition: { x: number; y: number }
  targetPosition: { x: number; y: number }
  theatreName: string
}) {
  const { current: map } = useMap()
  const [path, setPath] = useState('')

  useEffect(() => {
    if (!map) return

    const updatePath = () => {
      const from = tryDcsPositionToLngLat(theatreName, groupPosition.x, groupPosition.y)
      const to = tryDcsPositionToLngLat(theatreName, targetPosition.x, targetPosition.y)
      if (!from || !to) {
        setPath('')
        return
      }
      const p1 = map.project([from.lng, from.lat])
      const p2 = map.project([to.lng, to.lat])
      setPath(`M ${p1.x},${p1.y} L ${p2.x},${p2.y}`)
    }

    updatePath()
    map.on('move', updatePath)
    map.on('zoom', updatePath)
    map.on('rotate', updatePath)
    map.on('resize', updatePath)

    return () => {
      map.off('move', updatePath)
      map.off('zoom', updatePath)
      map.off('rotate', updatePath)
      map.off('resize', updatePath)
    }
  }, [map, groupPosition, targetPosition, theatreName])

  return (
    <svg className="absolute inset-0 w-full h-full pointer-events-none" style={{ zIndex: 5 }}>
      <path
        d={path}
        stroke="var(--synthwave-pink)"
        strokeWidth="3"
        fill="none"
        strokeDasharray="6 4"
        strokeLinecap="round"
        className="drop-shadow-[0_0_5px_var(--synthwave-pink)]"
      />
    </svg>
  )
})

/**
 * Buffers a route area into a culling corridor. turf's buffer can leave interior rings at large
 * radii; a corridor never has holes, so they are dropped.
 */
function bufferCorridor(
  area:
    | ReturnType<typeof turf.point>
    | ReturnType<typeof turf.lineString>
    | ReturnType<typeof turf.polygon>,
  radiusKm: number
) {
  const corridor = turf.buffer(area, radiusKm, { units: 'kilometers', steps: 24 })
  if (!corridor) return null
  const geometry = corridor.geometry
  // A route area is convex, so its buffer is one polygon; keep only that polygon's outer ring.
  const outerRing =
    geometry.type === 'Polygon' ? geometry.coordinates[0] : geometry.coordinates[0]?.[0]
  return outerRing ? turf.polygon([outerRing]) : null
}

export function Map({
  selectedItem,
  previewItem,
  onSelect,
  zoom,
  measureMode,
  overlaySafeLeft = 0,
  showGoalMarkers = false
}: {
  selectedItem: SelectedItem
  previewItem?: SelectedItem
  onSelect: (item: SelectedItem) => void
  zoom: number
  measureMode: boolean
  overlaySafeLeft?: number
  showGoalMarkers?: boolean
}) {
  const scenarioId = useSelector(activeStore, (state) => state.context.scenarioId)
  const mapRef = useRef<MapRef | null>(null)
  const lastCenteredSelectionIdRef = useRef<string | null>(null)
  const [measureState, setMeasureState] = useState<MeasureState>({
    mode: measureMode,
    points: []
  })
  const measurePoints = useMemo(
    () => (measureState.mode === measureMode && measureMode ? measureState.points : []),
    [measureMode, measureState]
  )

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
  const initialViewState = useMemo(() => {
    if (theatreQuery.data == null) return null
    const latLng = tryDcsPositionToLngLat(
      theatreQuery.data.name,
      theatreQuery.data.info.center.x,
      theatreQuery.data.info.center.y
    )
    if (!latLng) return null
    return {
      longitude: latLng.lng,
      latitude: latLng.lat,
      zoom
    }
  }, [theatreQuery.data, zoom])
  const { mapItems, objectiveMarkers, frontline, flightGroups } = useMapItems({
    showGoalMarkers
  })
  const mapLayers = useSelector(uiStore, (state) => state.context.mapLayers)
  const careerAirframes = useSelector(activeStore, (state) => state.context.career?.airframes)
  const careerBases = useMemo(() => {
    const theatre = theatreQuery.data
    if (!careerAirframes || !theatre) return []
    const byBase = new globalThis.Map<string, { tails: string[]; flying: boolean }>()
    for (const airframe of careerAirframes) {
      if (airframe.status === 'destroyed') continue
      const entry = byBase.get(airframe.location) ?? { tails: [], flying: false }
      const type = getCareerAircraft(airframe.aircraftName)?.shortName ?? airframe.aircraftName
      entry.tails.push(
        `${type} #${airframe.tailNumber}${airframe.status === 'delivering' ? ' (delivery)' : ''}`
      )
      entry.flying ||= airframe.status === 'flying'
      byBase.set(airframe.location, entry)
    }
    return [...byBase].flatMap(([name, info]) => {
      const airdrome = theatre.airdromeDetails[name]
      const lngLat = airdrome ? tryDcsPositionToLngLat(theatre.name, airdrome.x, airdrome.y) : null
      return lngLat ? [{ name, lng: lngLat.lng, lat: lngLat.lat, ...info }] : []
    })
  }, [careerAirframes, theatreQuery.data])
  const campaign = useSelector(activeStore, (state) => state.context)
  const selectedPlayerFlight = useMemo(() => {
    if (!selectedItem || !('id' in selectedItem)) return null
    return (
      campaign.coalitions.player.flightGroups.find((group) => group.id === selectedItem.id) ?? null
    )
  }, [campaign, selectedItem])
  const routeArea = useMemo(() => {
    if (!selectedPlayerFlight || theatreQuery.data == null) return null
    const coordinates: Array<[number, number]> = []
    for (const waypoint of selectedPlayerFlight.flightplan.waypoints) {
      const latLng = tryDcsPositionToLngLat(
        theatreQuery.data!.name,
        waypoint.position.x,
        waypoint.position.y
      )
      if (!latLng) continue
      const point: [number, number] = [latLng.lng, latLng.lat]
      const previous = coordinates[coordinates.length - 1]
      if (previous && previous[0] === point[0] && previous[1] === point[1]) continue
      coordinates.push(point)
    }
    if (coordinates.length === 0) return null
    if (coordinates.length === 1) return turf.point(coordinates[0]!)
    // Mirrors mission culling: the route covers its convex hull, so a loop out and back to the base
    // includes everything inside it rather than only a band along its legs.
    return (
      turf.convex(turf.featureCollection(coordinates.map((point) => turf.point(point)))) ??
      turf.lineString(coordinates)
    )
  }, [selectedPlayerFlight, theatreQuery.data])
  const routeCorridor = useMemo(() => {
    if (!routeArea) return null
    const radiusKm = resolveCullingRadiusMeters(campaign.campaignParams?.cullingRadius) / 1000
    return bufferCorridor(routeArea, radiusKm)
  }, [campaign.campaignParams?.cullingRadius, routeArea])
  const aircraftCorridor = useMemo(() => {
    if (!routeArea) return null
    const radiusKm =
      resolveAircraftCullingRadiusMeters(campaign.campaignParams?.cullingAircraftRadius) / 1000
    return bufferCorridor(routeArea, radiusKm)
  }, [campaign.campaignParams?.cullingAircraftRadius, routeArea])
  const samCorridor = useMemo(() => {
    if (!routeArea) return null
    const radiusKm = resolveSamCullingRadiusMeters(campaign.campaignParams?.cullingSamRadius) / 1000
    return bufferCorridor(routeArea, radiusKm)
  }, [campaign.campaignParams?.cullingSamRadius, routeArea])
  const insideSamCorridor = useCallback(
    (lng: number, lat: number) => {
      if (!samCorridor) return true
      return turf.booleanPointInPolygon(turf.point([lng, lat]), samCorridor)
    },
    [samCorridor]
  )
  const insideRouteCorridor = useCallback(
    (lng: number, lat: number) => {
      if (!routeCorridor) return true
      return turf.booleanPointInPolygon(turf.point([lng, lat]), routeCorridor)
    },
    [routeCorridor]
  )
  const insideAircraftCorridor = useCallback(
    (lng: number, lat: number) => {
      if (!aircraftCorridor) return true
      return turf.booleanPointInPolygon(turf.point([lng, lat]), aircraftCorridor)
    },
    [aircraftCorridor]
  )
  const visibleMapItems = useMemo(
    () =>
      mapItems.filter((item) => {
        if (routeCorridor && item.id !== selectedPlayerFlight?.id) {
          // Mirrors mission culling: aircraft, long-range SAMs and everything else each have a band.
          const inside =
            item.type === 'Flight Group'
              ? insideAircraftCorridor(item.position.lng, item.position.lat)
              : item.type === 'SAM' && item.range >= longRangeSamMinRangeMeters
                ? insideSamCorridor(item.position.lng, item.position.lat)
                : insideRouteCorridor(item.position.lng, item.position.lat)
          if (!inside) return false
        }
        switch (item.type) {
          case 'Airdrome':
            return mapLayers.airdromes
          case 'Flight Group':
            return mapLayers.flights
          case 'Ground Group':
            return mapLayers.ground
          case 'Structure':
            return mapLayers.structures
          case 'SAM':
            return mapLayers.sam
          case 'EWR':
            return mapLayers.ewr
          case 'GCI':
            return mapLayers.gci !== false
          default:
            return true
        }
      }),
    [
      insideAircraftCorridor,
      insideRouteCorridor,
      insideSamCorridor,
      mapItems,
      mapLayers,
      routeCorridor,
      selectedPlayerFlight?.id
    ]
  )
  const visibleObjectiveMarkers = useMemo(
    () =>
      objectiveMarkers.filter(
        (marker) =>
          (marker.isGoal || mapLayers.towns) &&
          insideRouteCorridor(marker.position.lng, marker.position.lat)
      ),
    [insideRouteCorridor, mapLayers.towns, objectiveMarkers]
  )
  const showSamRange = mapLayers.sam && mapLayers.samRange

  const measureSegments = useMemo<MeasureSegment[]>(() => {
    const segments: MeasureSegment[] = []
    for (let i = 1; i < measurePoints.length; i++) {
      const from = measurePoints[i - 1]
      const to = measurePoints[i]
      if (!from || !to) continue
      segments.push({
        id: `${from.id}-${to.id}`,
        from,
        to,
        distanceNm: getDistanceNm(from, to)
      })
    }
    return segments
  }, [measurePoints])

  const measureTotalNm = useMemo(
    () => measureSegments.reduce((total, segment) => total + segment.distanceNm, 0),
    [measureSegments]
  )

  const measureLineGeoJson = useMemo<GeoJSON.FeatureCollection<GeoJSON.LineString>>(() => {
    if (measurePoints.length < 2) {
      return turf.featureCollection<GeoJSON.LineString>([])
    }

    return turf.featureCollection([
      turf.lineString(measurePoints.map((point) => [point.lng, point.lat]))
    ])
  }, [measurePoints])

  const handleMapClick = useCallback(
    (event: MapLayerMouseEvent) => {
      if (!measureMode) return
      event.originalEvent.stopPropagation()
      const { lng, lat } = event.lngLat
      setMeasureState((state) => {
        const points = state.mode === measureMode ? state.points : []
        return {
          mode: measureMode,
          points: [
            ...points,
            {
              id: `${Date.now()}-${points.length}`,
              lng,
              lat
            }
          ]
        }
      })
    },
    [measureMode]
  )

  const handleResetMeasurement = useCallback(() => {
    setMeasureState({
      mode: measureMode,
      points: []
    })
  }, [measureMode])

  const liveSelectedItem = useMemo(() => {
    if (!selectedItem) return null
    if ('flightplan' in selectedItem) {
      return flightGroups.find((fg) => fg.id === selectedItem.id) ?? selectedItem
    }
    return mapItems.find((item) => item.id === selectedItem.id) ?? selectedItem
  }, [selectedItem, flightGroups, mapItems])

  const livePreviewItem = useMemo(() => {
    if (!previewItem) return null
    if ('flightplan' in previewItem) {
      return flightGroups.find((fg) => fg.id === previewItem.id) ?? previewItem
    }
    return mapItems.find((item) => item.id === previewItem.id) ?? previewItem
  }, [previewItem, flightGroups, mapItems])

  const flightPlanDisplayItem = useMemo(() => {
    if (livePreviewItem && 'flightplan' in livePreviewItem) {
      return livePreviewItem
    }
    if (liveSelectedItem && 'flightplan' in liveSelectedItem) {
      return liveSelectedItem
    }
    return null
  }, [livePreviewItem, liveSelectedItem])

  const [routeDragPreview, setRouteDragPreview] = useState<RouteDragPreview | null>(null)
  const [routeRevision, setRouteRevision] = useState(0)
  const editableFlight = useMemo(() => {
    if (!flightPlanDisplayItem || !selectedPlayerFlight) return null
    if (flightPlanDisplayItem.id !== selectedPlayerFlight.id) return null
    return isFlightRouteEditable(selectedPlayerFlight, campaign.time) ? selectedPlayerFlight : null
  }, [campaign.time, flightPlanDisplayItem, selectedPlayerFlight])
  const displayedFlightplan = useMemo(() => {
    if (!flightPlanDisplayItem) return null
    const flightplan = flightPlanDisplayItem.flightplan
    if (!routeDragPreview || !editableFlight || !theatreQuery.data) return flightplan
    const position = tryLngLatToDcsPosition(
      theatreQuery.data.name,
      routeDragPreview.lng,
      routeDragPreview.lat
    )
    if (!position) return flightplan
    const waypoints = [...flightplan.waypoints]
    if (routeDragPreview.kind === 'move') {
      const waypoint = waypoints[routeDragPreview.index]
      if (!waypoint) return flightplan
      waypoints[routeDragPreview.index] = { ...waypoint, position }
    } else {
      const previous = waypoints[routeDragPreview.index]
      if (!previous) return flightplan
      waypoints.splice(routeDragPreview.index + 1, 0, {
        ...previous,
        name: 'Nav',
        type: 'Nav',
        position
      })
    }
    return { ...flightplan, waypoints }
  }, [editableFlight, flightPlanDisplayItem, routeDragPreview, theatreQuery.data])
  const handleRouteDragEnd = useCallback(
    (preview: RouteDragPreview) => {
      setRouteDragPreview(null)
      setRouteRevision((revision) => revision + 1)
      if (!editableFlight || !theatreQuery.data) return
      const position = tryLngLatToDcsPosition(theatreQuery.data.name, preview.lng, preview.lat)
      if (!position) return
      if (preview.kind === 'move') {
        activeStore.send({
          type: 'moveWaypoint',
          flightGroupId: editableFlight.id,
          index: preview.index,
          position
        })
      } else {
        activeStore.send({
          type: 'insertWaypoint',
          flightGroupId: editableFlight.id,
          afterIndex: preview.index,
          position
        })
      }
    },
    [editableFlight, theatreQuery.data]
  )
  const handleRemoveWaypoint = useCallback(
    (index: number) => {
      if (!editableFlight) return
      activeStore.send({ type: 'removeWaypoint', flightGroupId: editableFlight.id, index })
    },
    [editableFlight]
  )
  const editableWaypointPositions = useMemo(() => {
    if (!editableFlight || !theatreQuery.data) return []
    const theatreName = theatreQuery.data.name
    return editableFlight.flightplan.waypoints.map((waypoint) =>
      tryDcsPositionToLngLat(theatreName, waypoint.position.x, waypoint.position.y)
    )
  }, [editableFlight, theatreQuery.data])

  const showDeploymentOverlay =
    import.meta.env.DEV && new URLSearchParams(window.location.search).has('deployment-overlay')
  const deploymentOverlay = useMemo(() => {
    const theatre = theatreQuery.data
    if (!showDeploymentOverlay || !theatre?.deploymentSites) return null
    const occupied = new Set(
      Object.values(campaign.coalitions).flatMap((coalition) =>
        coalition.groundGroups.flatMap((group) =>
          group.deployment ? [group.deployment.siteId] : []
        )
      )
    )
    const reserved = new Set(campaign.landingOperation?.reservedSiteIds ?? [])
    const points: GeoJSON.Feature<GeoJSON.Point>[] = []
    const approaches: GeoJSON.Feature<GeoJSON.LineString>[] = []
    for (const site of theatre.deploymentSites) {
      const center = tryDcsPositionToLngLat(theatre.name, site.position.x, site.position.y)
      if (!center) continue
      points.push(
        turf.point([center.lng, center.lat], {
          id: site.id,
          kind: 'site',
          status: site.validationStatus ?? 'approved',
          occupied: occupied.has(site.id),
          reserved: reserved.has(site.id)
        })
      )
      for (const slot of site.slots) {
        const position = tryDcsPositionToLngLat(theatre.name, slot.x, slot.y)
        if (!position) continue
        points.push(
          turf.point([position.lng, position.lat], {
            id: slot.id,
            siteId: site.id,
            kind: 'slot',
            status: site.validationStatus ?? 'approved'
          })
        )
      }
      for (const [kind, route] of [
        ['ingress', site.ingress],
        ['egress', site.egress]
      ] as const) {
        if (!route || route.length === 0) continue
        const coordinates = [site.position, ...route].flatMap((position) => {
          const converted = tryDcsPositionToLngLat(theatre.name, position.x, position.y)
          return converted ? ([[converted.lng, converted.lat]] as [number, number][]) : []
        })
        if (coordinates.length > 1) {
          approaches.push(turf.lineString(coordinates, { siteId: site.id, kind }))
        }
      }
    }
    return {
      points: turf.featureCollection(points),
      approaches: turf.featureCollection(approaches)
    }
  }, [campaign, showDeploymentOverlay, theatreQuery.data])
  const groundGroupPath = useMemo(() => {
    if (!liveSelectedItem || !theatreQuery.data) return null
    const id = liveSelectedItem.id
    const group =
      campaign.coalitions.player.groundGroups.find((g) => g.id === id) ??
      campaign.coalitions.opponent.groundGroups.find((g) => g.id === id)
    if (!group) return null
    if (group.targetObjectiveId) {
      const targetObjective = theatreQuery.data.objectives.find(
        (o) => o.name === group.targetObjectiveId
      )
      if (!targetObjective) return null
      return { groupPosition: group.position, targetPosition: targetObjective.position }
    }
    if (group.targetAirdromeName) {
      const targetAirdrome = theatreQuery.data.airdromeDetails[group.targetAirdromeName]
      if (!targetAirdrome) return null
      return {
        groupPosition: group.position,
        targetPosition: { x: targetAirdrome.x, y: targetAirdrome.y }
      }
    }
    return null
  }, [liveSelectedItem, campaign, theatreQuery.data])

  const selectedCoordinates = useMemo(() => {
    if (!liveSelectedItem || !theatreQuery.data) return null

    const position = liveSelectedItem.position
    if ('lat' in position && 'lng' in position) {
      return position
    }

    if ('x' in position && 'y' in position) {
      return tryDcsPositionToLngLat(theatreQuery.data.name, position.x, position.y) ?? null
    }

    return null
  }, [liveSelectedItem, theatreQuery.data])

  useEffect(() => {
    const selectedId = liveSelectedItem?.id ?? null
    if (selectedId == null) {
      lastCenteredSelectionIdRef.current = null
      return
    }
    if (!selectedCoordinates || !mapRef.current) return
    if (lastCenteredSelectionIdRef.current === selectedId) return

    lastCenteredSelectionIdRef.current = selectedId
    mapRef.current.flyTo({
      center: [selectedCoordinates.lng, selectedCoordinates.lat],
      duration: 700,
      essential: true
    })
  }, [liveSelectedItem?.id, selectedCoordinates])

  useEffect(() => {
    if (!mapRef.current) return
    mapRef.current.flyTo({
      zoom,
      duration: 250,
      essential: true
    })
  }, [zoom])

  // Generate GeoJSON for SAM range circles
  const samRangeGeoJson = useMemo(() => {
    const features: GeoJSON.Feature<GeoJSON.Polygon>[] = []

    if (!showSamRange) return turf.featureCollection(features)

    for (const item of visibleMapItems) {
      if (item.type !== 'SAM') continue
      if (!item.active) continue

      // Create a circle with the SAM's range (range is in meters, turf expects km)
      const circle = turf.circle(
        [item.position.lng, item.position.lat],
        item.range / 1000, // Convert meters to km
        { steps: 64, units: 'kilometers' }
      )

      circle.properties = {
        id: item.id,
        coalition: item.coalition,
        name: item.name
      }

      features.push(circle)
    }

    return turf.featureCollection(features)
  }, [showSamRange, visibleMapItems])

  // Only show the map if the view state is available
  if (initialViewState == null) return null
  return (
    <div
      className={cn(
        'dcc-campaign-map tactical-map-glass h-full w-full relative shadow-[inset_10px_0_24px_rgba(0,0,0,0.38),inset_0_1px_0_rgba(255,255,255,0.05)]',
        measureMode && 'cursor-crosshair'
      )}
    >
      <MaplibreMap
        ref={mapRef}
        initialViewState={initialViewState}
        mapStyle={offlineCaucasusMapStyle}
        minZoom={3}
        maxZoom={CAUCASUS_DETAIL_MAX_ZOOM}
        onClick={handleMapClick}
      >
        {displayedFlightplan && theatreQuery.data && (
          <FlightPlanOverlay
            flightplan={displayedFlightplan}
            theatreName={theatreQuery.data.name}
          />
        )}
        {groundGroupPath && theatreQuery.data && (
          <GroundGroupPathOverlay
            groupPosition={groundGroupPath.groupPosition}
            targetPosition={groundGroupPath.targetPosition}
            theatreName={theatreQuery.data.name}
          />
        )}
        {flightPlanDisplayItem && theatreQuery.data && (
          <>
            {flightPlanDisplayItem.flightplan.waypoints.map((waypoint, index) => {
              const lngLat = editableWaypointPositions[index]
              if (editableFlight && lngLat && isEditableWaypoint(waypoint)) {
                return (
                  <EditableWaypointMarker
                    key={`edit-${routeRevision}-${index}`}
                    waypoint={waypoint}
                    index={index}
                    lngLat={lngLat}
                    onDrag={setRouteDragPreview}
                    onDragEnd={handleRouteDragEnd}
                    onRemove={handleRemoveWaypoint}
                  />
                )
              }
              return (
                <WaypointLabelMarker
                  key={`${waypoint.name}-${index}`}
                  waypoint={waypoint}
                  theatreName={theatreQuery.data.name}
                />
              )
            })}
            {editableFlight &&
              !routeDragPreview &&
              editableWaypointPositions.slice(0, -1).map((from, index) => {
                const to = editableWaypointPositions[index + 1]
                if (!from || !to) return null
                return (
                  <RouteInsertHandle
                    key={`insert-${routeRevision}-${index}`}
                    afterIndex={index}
                    lngLat={{ lng: (from.lng + to.lng) / 2, lat: (from.lat + to.lat) / 2 }}
                    onDrag={setRouteDragPreview}
                    onDragEnd={handleRouteDragEnd}
                  />
                )
              })}
          </>
        )}
        {/* SAM Range Circles - rendered first so they appear below other markers */}
        {samRangeGeoJson.features.length > 0 && (
          <Source id="sam-ranges-source" type="geojson" data={samRangeGeoJson}>
            {/* Player SAM range fill */}
            <Layer
              id="sam-range-fill-player"
              type="fill"
              filter={['==', ['get', 'coalition'], 'player']}
              paint={{
                'fill-color': '#00d4ff',
                'fill-opacity': 0.1
              }}
            />
            {/* Player SAM range outline */}
            <Layer
              id="sam-range-line-player"
              type="line"
              filter={['==', ['get', 'coalition'], 'player']}
              paint={{
                'line-color': '#00d4ff',
                'line-width': 2,
                'line-opacity': 0.6,
                'line-dasharray': [4, 2]
              }}
            />
            {/* Opponent SAM range fill */}
            <Layer
              id="sam-range-fill-opponent"
              type="fill"
              filter={['==', ['get', 'coalition'], 'opponent']}
              paint={{
                'fill-color': '#ff4444',
                'fill-opacity': 0.1
              }}
            />
            {/* Opponent SAM range outline */}
            <Layer
              id="sam-range-line-opponent"
              type="line"
              filter={['==', ['get', 'coalition'], 'opponent']}
              paint={{
                'line-color': '#ff4444',
                'line-width': 2,
                'line-opacity': 0.6,
                'line-dasharray': [4, 2]
              }}
            />
          </Source>
        )}
        {samCorridor && (
          <Source id="culling-sam-source" type="geojson" data={samCorridor}>
            <Layer
              id="culling-sam-fill"
              type="fill"
              paint={{ 'fill-color': '#d9443a', 'fill-opacity': 0.04 }}
            />
            <Layer
              id="culling-sam-line"
              type="line"
              paint={{
                'line-color': '#d9443a',
                'line-width': 1.5,
                'line-opacity': 0.75,
                'line-dasharray': [1, 2]
              }}
            />
          </Source>
        )}
        {aircraftCorridor && (
          <Source id="culling-aircraft-source" type="geojson" data={aircraftCorridor}>
            <Layer
              id="culling-aircraft-fill"
              type="fill"
              paint={{ 'fill-color': '#ffb000', 'fill-opacity': 0.05 }}
            />
            <Layer
              id="culling-aircraft-line"
              type="line"
              paint={{
                'line-color': '#ffb000',
                'line-width': 1.5,
                'line-opacity': 0.7,
                'line-dasharray': [3, 2]
              }}
            />
          </Source>
        )}
        {routeCorridor && (
          <Source id="culling-radius-source" type="geojson" data={routeCorridor}>
            <Layer
              id="culling-radius-fill"
              type="fill"
              paint={{ 'fill-color': '#e8b730', 'fill-opacity': 0.12 }}
            />
            <Layer
              id="culling-radius-line"
              type="line"
              paint={{ 'line-color': '#e8b730', 'line-width': 1.5, 'line-opacity': 0.7 }}
            />
          </Source>
        )}
        {mapLayers.frontline && !routeCorridor && frontline && (
          <Source id="frontline-source" type="geojson" data={frontline}>
            <Layer
              id="frontline-player"
              type="line"
              paint={{
                'line-color': '#00ddff',
                'line-width': 2,
                'line-opacity': 0.85,
                'line-offset': -4,
                'line-dasharray': [3, 2]
              }}
            />
            <Layer
              id="frontline-opponent"
              type="line"
              paint={{
                'line-color': '#ff4d4f',
                'line-width': 2,
                'line-opacity': 0.85,
                'line-offset': 4,
                'line-dasharray': [3, 2]
              }}
            />
          </Source>
        )}
        {deploymentOverlay && (
          <>
            <Source id="deployment-sites-source" type="geojson" data={deploymentOverlay.points}>
              <Layer
                id="deployment-site-centers"
                type="circle"
                filter={['==', ['get', 'kind'], 'site']}
                paint={{
                  'circle-radius': 7,
                  'circle-color': [
                    'case',
                    ['==', ['get', 'status'], 'candidate'],
                    '#ffb020',
                    ['==', ['get', 'occupied'], true],
                    '#ff3b68',
                    ['==', ['get', 'reserved'], true],
                    '#00ddff',
                    '#78ff9c'
                  ],
                  'circle-opacity': 0.85,
                  'circle-stroke-width': 2,
                  'circle-stroke-color': '#0b0a09'
                }}
              />
              <Layer
                id="deployment-site-slots"
                type="circle"
                filter={['==', ['get', 'kind'], 'slot']}
                paint={{
                  'circle-radius': 2.5,
                  'circle-color': [
                    'case',
                    ['==', ['get', 'status'], 'candidate'],
                    '#ffb020',
                    '#00ddff'
                  ],
                  'circle-opacity': 0.75
                }}
              />
            </Source>
            <Source
              id="deployment-approaches-source"
              type="geojson"
              data={deploymentOverlay.approaches}
            >
              <Layer
                id="deployment-approaches"
                type="line"
                paint={{
                  'line-color': ['case', ['==', ['get', 'kind'], 'ingress'], '#78ff9c', '#ff3b68'],
                  'line-width': 2,
                  'line-dasharray': [2, 2]
                }}
              />
            </Source>
          </>
        )}
        {measurePoints.length > 1 && (
          <Source id="measure-line-source" type="geojson" data={measureLineGeoJson}>
            <Layer
              id="measure-line-glow"
              type="line"
              paint={{
                'line-color': '#0f0e0d',
                'line-width': 7,
                'line-opacity': 0.75
              }}
            />
            <Layer
              id="measure-line"
              type="line"
              paint={{
                'line-color': '#e8b730',
                'line-width': 3,
                'line-dasharray': [1.5, 1.2]
              }}
            />
          </Source>
        )}
        {measureMode &&
          measurePoints.map((point, index) => (
            <MaplibreMarker
              key={point.id}
              longitude={point.lng}
              latitude={point.lat}
              anchor="center"
              style={{ zIndex: 35 }}
            >
              <div className="pointer-events-none flex h-5 w-5 items-center justify-center rounded-full bg-synthwave-dark/90 ring-2 ring-synthwave-cyan shadow-[0_0_12px_rgba(0,221,255,0.55)]">
                <span className="h-1.5 w-1.5 rounded-full bg-synthwave-cyan" />
                {index === 0 ? null : (
                  <span className="absolute translate-x-4 -translate-y-3 rounded bg-synthwave-dark/90 px-1.5 py-0.5 text-[10px] font-semibold text-synthwave-light ring-1 ring-synthwave-cyan/35">
                    {index + 1}
                  </span>
                )}
              </div>
            </MaplibreMarker>
          ))}
        {measureMode &&
          measureSegments.map((segment) => (
            <MaplibreMarker
              key={segment.id}
              longitude={(segment.from.lng + segment.to.lng) / 2}
              latitude={(segment.from.lat + segment.to.lat) / 2}
              anchor="center"
              style={{ zIndex: 34 }}
            >
              <div className="pointer-events-none rounded bg-synthwave-dark/90 px-2 py-0.5 text-[11px] font-semibold text-synthwave-cyan shadow-[0_0_10px_rgba(0,0,0,0.5)] ring-1 ring-synthwave-cyan/35">
                {formatNauticalMiles(segment.distanceNm)}
              </div>
            </MaplibreMarker>
          ))}
        {visibleMapItems.map((item) => (
          <Marker
            key={item.id}
            item={item}
            onClick={() => onSelect(item)}
            isSelected={liveSelectedItem?.id === item.id}
          />
        ))}
        {visibleObjectiveMarkers.map((marker) => (
          <ObjectiveCircleMarker
            key={marker.id}
            marker={marker}
            onClick={() => onSelect(marker)}
            isSelected={liveSelectedItem?.id === marker.id}
          />
        ))}
        {careerBases.map((base) => (
          <CareerBaseMarker key={`career-${base.name}`} base={base} />
        ))}
      </MaplibreMap>
      <DetailsCard
        selectedItem={liveSelectedItem}
        onClose={() => onSelect(null)}
        onSelectObjective={(name) => {
          const marker = objectiveMarkers.find((m) => m.name === name)
          if (marker) onSelect(marker)
        }}
      />
      {deploymentOverlay && (
        <div className="tactical-panel pointer-events-none absolute top-4 right-4 z-20 rounded px-2 py-1 text-[9px] uppercase tracking-[0.18em] text-amber-200">
          Deployment overlay · candidate / approved / occupied / reserved
        </div>
      )}
      {measureMode && (
        <div
          className="tactical-panel pointer-events-auto absolute top-4 z-20 flex -translate-x-1/2 items-center gap-3 rounded-md px-3 py-2 text-synthwave-light backdrop-blur-md"
          style={{
            left: `max(50%, calc((100% + ${overlaySafeLeft}px) / 2))`,
            maxWidth: `calc(100% - ${overlaySafeLeft}px - 2rem)`
          }}
        >
          <div className="flex items-baseline gap-2">
            <span className="retro-font text-[10px] uppercase text-synthwave-cyan">Measure</span>
            <span className="text-sm font-semibold tabular-nums">
              {formatNauticalMiles(measureTotalNm)}
            </span>
          </div>
          <button
            type="button"
            className="tactical-button flex h-6 items-center gap-1.5 rounded px-2 text-[10px] font-semibold uppercase text-secondary"
            onClick={handleResetMeasurement}
            title="Reset measurement"
            aria-label="Reset measurement"
          >
            <RotateCcw className="h-3.5 w-3.5" />
            Reset
          </button>
        </div>
      )}
    </div>
  )
}
