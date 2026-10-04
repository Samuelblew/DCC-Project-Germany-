import { schemas } from '@dcc/contracts'
import {
  type AircraftProfile,
  getAircraftProfile,
  getTheatreAirdromeRadio,
  type InstrumentUnits
} from '@dcc/data'
import sharp from 'sharp'
import * as z from 'zod'

import type { MissionFlightConfig } from './add-flight-groups'
import { getKneeboardLogoPng, KNEEBOARD_LOGO_BOX } from './kneeboard-logo'
import {
  createRouteMapViewport,
  dcsPositionToLngLat,
  renderGeographicMapLayerFromPmtiles,
  resolveTheatrePmtilesPath
} from './kneeboard-map'

const warnedMissingKneeboardMap = new Set<string>()

type Campaign = z.infer<typeof schemas.campaign.campaign>
type Coalition = z.infer<typeof schemas.coalition>
type FlightGroup = z.infer<typeof schemas.flightGroup>
type Theatre = z.infer<typeof schemas.theatre>
type Waypoint = z.infer<typeof schemas.flightplan>['waypoints'][number]

export type KneeboardImage = {
  filename: string
  buffer: Buffer
}

export type KneeboardWaypointRow = {
  index: number | undefined
  name: string
  type: string
  eta: string
  altitude: string
  speed: string
  legDistance: string
  totalDistance: string
  bearing: string
  remarks: string
}

type ClientFlightGroup = {
  coalition: Coalition
  flightGroup: FlightGroup
}

const PAGE_WIDTH = 768
const PAGE_HEIGHT = 1024
const CONTENT_X = 64
const CONTENT_WIDTH = 640
const SECTION_TITLE_HEIGHT = 22
const SECTION_CONTENT_PADDING_TOP = 12
const SECTION_GAP = 12
const MAP_INSET = 0
const HEADER_RULE_Y = 126
const WAYPOINT_ROW_HEIGHT = 24
const MAX_VISIBLE_WAYPOINTS = 6
const FOOTER_HEIGHT = 34
const PAGE_INNER_BOTTOM = 990
const METERS_PER_NAUTICAL_MILE = 1852
const FEET_PER_METER = 3.28084
const KNOTS_PER_METER_PER_SECOND = 1.94384
const KMH_PER_METER_PER_SECOND = 3.6
const DEFAULT_RADIO_CHANNELS = { FLIGHT: 1, AWACS: 2, ATC: 3, JTAC: 4 } as const

export function getClientFlightGroups(campaign: Campaign): ClientFlightGroup[] {
  return schemas.coalition.options.flatMap((coalition) =>
    campaign.coalitions[coalition].flightGroups
      .filter((flightGroup) => flightGroup.aircrafts.some((aircraft) => aircraft.client))
      .map((flightGroup) => ({ coalition, flightGroup }))
  )
}

export function sanitizeKneeboardFilenamePart(value: string): string {
  const sanitized = value
    .trim()
    .replace(/[^A-Za-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')

  return sanitized || 'flight'
}

export function createKneeboardFilename(index: number, flightGroup: FlightGroup): string {
  const sequence = index.toString().padStart(3, '0')
  const callsign = sanitizeKneeboardFilenamePart(flightGroup.callsign)
  const task = sanitizeKneeboardFilenamePart(flightGroup.task)
  return `DCC_${sequence}_${callsign}_${task}.png`
}

function formatTime(date: Date): string {
  return date.toISOString().slice(11, 16) + 'Z'
}

function formatDate(date: Date): string {
  return date.toISOString().slice(0, 10)
}

function formatDistanceNm(meters: number): string {
  if (!Number.isFinite(meters)) return '---'
  return (meters / METERS_PER_NAUTICAL_MILE).toFixed(1)
}

function formatAltitudeFeet(meters: number): string {
  if (!Number.isFinite(meters)) return '---'
  return Math.round(meters * FEET_PER_METER).toLocaleString('en-US')
}

function formatSpeedKnots(metersPerSecond: number): string {
  if (!Number.isFinite(metersPerSecond)) return '---'
  return Math.round(metersPerSecond * KNOTS_PER_METER_PER_SECOND).toString()
}

function formatDistanceKm(meters: number): string {
  if (!Number.isFinite(meters)) return '---'
  return (meters / 1000).toFixed(1)
}

function formatAltitudeMeters(meters: number): string {
  if (!Number.isFinite(meters)) return '---'
  return Math.round(meters).toLocaleString('en-US')
}

function formatSpeedKmh(metersPerSecond: number): string {
  if (!Number.isFinite(metersPerSecond)) return '---'
  return Math.round(metersPerSecond * KMH_PER_METER_PER_SECOND).toString()
}

const UNIT_FORMATS = {
  imperial: {
    altitude: formatAltitudeFeet,
    speed: formatSpeedKnots,
    distance: formatDistanceNm,
    labels: { altitude: 'ALT FT', speed: 'KTS', leg: 'LEG', total: 'TOT' }
  },
  metric: {
    altitude: formatAltitudeMeters,
    speed: formatSpeedKmh,
    distance: formatDistanceKm,
    labels: { altitude: 'ALT M', speed: 'KM/H', leg: 'LEG KM', total: 'TOT KM' }
  }
} satisfies Record<InstrumentUnits, unknown>

/** The profile of the aircraft the flight's players sit in, when the DCC knows that module. */
export function getKneeboardAircraftProfile(flightGroup: FlightGroup): AircraftProfile | undefined {
  const aircraft =
    flightGroup.aircrafts.find((candidate) => candidate.client) ?? flightGroup.aircrafts[0]
  return aircraft ? getAircraftProfile(aircraft.aircraftName) : undefined
}

function formatBearingDegrees(from: Waypoint, to: Waypoint): string {
  // DCS uses x for north/south and z for east/west. Campaign positions store z as y.
  const northing = to.position.x - from.position.x
  const easting = to.position.y - from.position.y
  if (northing === 0 && easting === 0) return '---'

  const degrees = (Math.atan2(easting, northing) * 180) / Math.PI
  const normalized = Math.round((degrees + 360) % 360)
  return normalized.toString().padStart(3, '0')
}

function addSeconds(date: Date, seconds: number): Date {
  return new Date(date.getTime() + seconds * 1000)
}

function getWaypointRemark(waypoint: Waypoint, flightGroup: FlightGroup): string {
  if (waypoint.type === 'TakeOff') return 'DEPART'
  if (waypoint.type === 'Landing') return 'LAND'
  if (waypoint.type === 'RaceTrack End') return 'ORBIT'
  if (waypoint.name.toLowerCase().includes('target')) return 'TARGET'
  if (waypoint.type === 'Task') return flightGroup.task.toUpperCase()
  return ''
}

export function buildKneeboardWaypointRows(
  flightGroup: FlightGroup,
  units: InstrumentUnits = 'imperial'
): KneeboardWaypointRow[] {
  const format = UNIT_FORMATS[units]
  let totalMeters = 0
  let elapsedSeconds = 0
  let waypointNumber = 0

  return flightGroup.flightplan.waypoints.map((waypoint, index, waypoints) => {
    const previous = waypoints[index - 1]
    let legMeters = 0
    let bearing = '---'

    if (previous) {
      legMeters = Math.hypot(
        waypoint.position.x - previous.position.x,
        waypoint.position.y - previous.position.y
      )
      totalMeters += legMeters
      if (waypoint.speed > 0) {
        elapsedSeconds += legMeters / waypoint.speed
      }
      bearing = formatBearingDegrees(previous, waypoint)
    }

    const displayedIndex = waypoint.type === 'TakeOff' ? undefined : ++waypointNumber

    return {
      index: displayedIndex,
      name: waypoint.name || waypoint.type,
      type: waypoint.type,
      eta: formatTime(addSeconds(flightGroup.flightplan.startTime, elapsedSeconds)),
      altitude: format.altitude(waypoint.altitude),
      speed: format.speed(waypoint.speed),
      legDistance: index === 0 ? '---' : format.distance(legMeters),
      totalDistance: index === 0 ? '---' : format.distance(totalMeters),
      bearing,
      remarks: getWaypointRemark(waypoint, flightGroup)
    }
  })
}

function escapeXml(value: unknown): string {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&apos;')
}

function truncate(value: string, maxLength: number): string {
  if (maxLength <= 1) return value.slice(0, Math.max(0, maxLength))
  return value.length > maxLength ? value.slice(0, Math.max(0, maxLength - 1)) + '.' : value
}

function maxCharactersForWidth(width: number, averageCharacterWidth: number) {
  return Math.max(4, Math.floor(width / averageCharacterWidth))
}

function truncateToWidth(value: string, width: number, averageCharacterWidth: number) {
  return truncate(value, maxCharactersForWidth(width, averageCharacterWidth))
}

function wrapText(value: string, maxLineLength: number, maxLines: number): string[] {
  const words = value.trim().split(/\s+/).filter(Boolean)
  const lines: string[] = []
  let current = ''
  let truncated = false

  for (const word of words) {
    if (lines.length >= maxLines) {
      truncated = true
      break
    }

    if (word.length > maxLineLength) {
      if (current) {
        lines.push(current)
        current = ''
      }

      if (lines.length < maxLines) {
        lines.push(truncate(word, maxLineLength))
      }
      truncated = true
      continue
    }

    const next = current ? `${current} ${word}` : word
    if (next.length <= maxLineLength) {
      current = next
      continue
    }

    if (current) {
      lines.push(current)
    }

    if (lines.length >= maxLines) {
      truncated = true
      break
    }

    current = word
  }

  if (current && lines.length < maxLines) {
    lines.push(current)
  } else if (current) {
    truncated = true
  }

  if (truncated && lines.length > 0) {
    const lastIndex = lines.length - 1
    lines[lastIndex] = truncate(lines[lastIndex] ?? '', Math.max(4, maxLineLength - 2))
  }

  return lines.length > 0 ? lines : ['No mission details available.']
}

function renderField(label: string, value: string, x: number, y: number, width: number) {
  const valueXOffset = 104
  const valueWidth = width - valueXOffset

  return `
    <text x="${x}" y="${y}" class="label">${escapeXml(label)}</text>
    <text x="${x + valueXOffset}" y="${y}" class="value">${escapeXml(truncateToWidth(value, valueWidth, 7))}</text>
    <line x1="${x}" y1="${y + 8}" x2="${x + width}" y2="${y + 8}" class="rule" />
  `
}

function renderSectionHeader(title: string, x: number, y: number, _width: number) {
  const titleWidth = Math.max(SECTION_TITLE_HEIGHT, title.length * 10 + 22)

  return `
    <rect x="${x}" y="${y}" width="${titleWidth}" height="${SECTION_TITLE_HEIGHT}" fill="#1f2528" />
    <text x="${x + 12}" y="${y + 16}" class="section-title">${escapeXml(title)}</text>
  `
}

function findMissionConfig(
  missionFlightConfigs: MissionFlightConfig[],
  flightGroup: FlightGroup
): MissionFlightConfig | undefined {
  return missionFlightConfigs.find((config) => config.name === flightGroup.callsign)
}

function findMissionPackage(campaign: Campaign, flightGroup: FlightGroup) {
  if (!flightGroup.packageId) return undefined

  for (const coalition of schemas.coalition.options) {
    const missionPackage = campaign.coalitions[coalition].packages.find(
      (candidate) => candidate.id === flightGroup.packageId
    )
    if (missionPackage) return missionPackage
  }

  return undefined
}

function getAircraftSummary(flightGroup: FlightGroup): string {
  const aircraftCounts = new Map<string, number>()
  flightGroup.aircrafts.forEach((aircraft) => {
    aircraftCounts.set(aircraft.aircraftName, (aircraftCounts.get(aircraft.aircraftName) ?? 0) + 1)
  })

  return [...aircraftCounts.entries()]
    .map(([aircraftName, count]) => `${count}x ${aircraftName}`)
    .join(', ')
}

function getTargetSummary(flightGroup: FlightGroup, theatre: Theatre): string {
  if (!flightGroup.target) return 'NONE ASSIGNED'

  const objective = theatre.objectives.find(
    (candidate) => candidate.name === flightGroup.target?.objectiveId
  )
  const targetType = flightGroup.target.type || 'Target'
  const objectiveName = objective?.name ?? flightGroup.target.objectiveId
  return `${targetType} / ${objectiveName}`
}

export function buildKneeboardMissionDescription(params: {
  flightGroup: FlightGroup
  missionPackage: ReturnType<typeof findMissionPackage>
  theatre: Theatre
}) {
  const { flightGroup, missionPackage, theatre } = params
  const targetSummary = getTargetSummary(flightGroup, theatre).toLowerCase()
  const packageLabel = missionPackage?.variantLabel ?? missionPackage?.type
  const packageReason = missionPackage?.reason

  if (packageLabel && packageReason) {
    return `${packageLabel}: ${packageReason}. Target is ${targetSummary}.`
  }

  if (packageLabel) {
    return `${packageLabel}: execute ${flightGroup.task} tasking against ${targetSummary}.`
  }

  if (flightGroup.task === 'CAP') {
    return `Conduct combat air patrol from ${flightGroup.homeBase}. Protect assigned airspace and intercept hostile aircraft.`
  }

  if (flightGroup.task === 'Fighter Sweep') {
    return `Sweep the airspace over the ground fighting at the Sweep waypoint. Clear hostile aircraft so friendly ground forces keep air superiority, then recover to ${flightGroup.homeBase}.`
  }

  if (flightGroup.task === 'Training') {
    return `Training sortie from ${flightGroup.homeBase}. Fly the practice legs behind friendly lines and recover to ${flightGroup.homeBase}. No tasking.`
  }

  if (flightGroup.task === 'CAS') {
    return `Provide close air support against ${targetSummary}. Use JTAC calls, smoke, or laser marks when available.`
  }

  if (flightGroup.task === 'Pinpoint Strike' || flightGroup.task === 'Strategic Strike') {
    return `Strike ${targetSummary}. Navigate to the attack point, prosecute the target, then egress and recover.`
  }

  if (flightGroup.task === 'DEAD' || flightGroup.task === 'SEAD') {
    return `Suppress or destroy enemy air defenses at ${targetSummary}. Support friendly package access through the threat area.`
  }

  return `Execute ${flightGroup.task} tasking from ${flightGroup.homeBase} against ${targetSummary}.`
}

function getSpecialNotes(flightGroup: FlightGroup, missionConfig: MissionFlightConfig | undefined) {
  const notes: string[] = []

  if (flightGroup.task === 'Transport') {
    notes.push(`Cargo ${flightGroup.cargoAmount ?? 0}`)
    if (flightGroup.sourceNode || flightGroup.destinationNode) {
      notes.push(
        `${flightGroup.sourceNode ?? 'SOURCE'} -> ${flightGroup.destinationNode ?? 'DEST'}`
      )
    }
  }

  if (
    flightGroup.task === 'CSAR' &&
    missionConfig &&
    'csar' in missionConfig &&
    missionConfig.csar
  ) {
    notes.push(`Recover ${missionConfig.csar.pilotName}`)
    notes.push('F10 CSAR status / smoke / pickup; land at drop-off to unload')
  }

  if (missionConfig && missionConfig.task === 'CAS' && 'laserCode' in missionConfig) {
    notes.push(`JTAC ${missionConfig.jtacName}`)
    notes.push(`Laser ${missionConfig.laserCode}`)
  }

  if (missionConfig?.navigation?.tacan) {
    const tacan = missionConfig.navigation.tacan
    notes.push(`Target TACAN ${tacan.channel}${tacan.band} ${tacan.callsign}`)
  }

  if (missionConfig?.navigation?.landingPoint) {
    notes.push('F10 landing vector')
  }

  if (missionConfig?.navigation?.targetPoint) {
    notes.push('F10 target vector')
  }

  return notes.length > 0 ? notes.join(' / ') : 'SEE MISSION PLAN'
}

function formatTacanSummary(tacan: { channel: number | string; band?: string; callsign?: string }) {
  const band = tacan.band ?? 'X'
  const callsign = tacan.callsign ? ` ${tacan.callsign}` : ''
  return `${tacan.channel}${band}${callsign}`
}

export function getKneeboardTargetTacanSummary(
  missionConfig: MissionFlightConfig | undefined
): string {
  const tacan = missionConfig?.navigation?.tacan
  if (!tacan) return '---'
  return formatTacanSummary(tacan)
}

export function getKneeboardLandingTacanSummary(
  flightGroup: FlightGroup,
  theatre: Theatre,
  missionConfig?: MissionFlightConfig
): string {
  const missionTacan = missionConfig?.navigation?.landingTacan
  if (missionTacan) return formatTacanSummary(missionTacan)

  const airdrome = theatre.airdromeDetails[flightGroup.homeBase]
  const tacan = airdrome?.tacan
  if (!tacan) return '---'
  return formatTacanSummary(tacan)
}

export function getKneeboardFlightFrequencySummary(
  missionConfig: MissionFlightConfig | undefined
): string {
  if (missionConfig?.frequency == null) return '---'
  const preset = missionConfig.radioPreset
  const presetLabel = preset ? ` R${preset.radio} CH${preset.cockpitChannel ?? preset.channel}` : ''
  return `${missionConfig.frequency.toFixed(3)} MHz${presetLabel}`
}

export function getKneeboardRadioChannelSummary(
  missionConfig: MissionFlightConfig | undefined,
  purpose: 'FLIGHT' | 'AWACS' | 'ATC' | 'JTAC'
): string {
  const preset = missionConfig?.radioChannels?.find((channel) => channel.purpose === purpose)
  if (!preset) {
    return purpose === 'FLIGHT' ? getKneeboardFlightFrequencySummary(missionConfig) : '---'
  }

  const radio = preset.radio == null ? '' : `R${preset.radio} `
  return `${radio}${preset.frequency.toFixed(3)} MHz`
}

/** "CH0 FLIGHT": the preset as the cockpit numbers it, or the generic layout when unplanned. */
export function getKneeboardRadioChannelLabel(
  missionConfig: MissionFlightConfig | undefined,
  purpose: 'FLIGHT' | 'AWACS' | 'ATC' | 'JTAC'
): string {
  const preset = missionConfig?.radioChannels?.find((channel) => channel.purpose === purpose)
  const channel = preset
    ? (preset.cockpitChannel ?? preset.channel)
    : DEFAULT_RADIO_CHANNELS[purpose]
  return `CH${channel} ${purpose}`
}

/** The home base's first approach NDBs, for aircraft that home on beacons rather than TACAN. */
export function getKneeboardHomeNdbSummary(flightGroup: FlightGroup, theatre: Theatre): string {
  const approach = getTheatreAirdromeRadio(theatre.name)[flightGroup.homeBase]?.approaches[0]
  if (!approach) return '---'
  const inner = approach.inner ? ` / ${approach.inner.callsign} ${approach.inner.khz}` : ''
  return `${approach.outer.callsign} ${approach.outer.khz}${inner} kHz`
}

export function getKneeboardHomeTowerSummary(flightGroup: FlightGroup, theatre: Theatre): string {
  const radio = getTheatreAirdromeRadio(theatre.name)[flightGroup.homeBase]?.radio
  const frequencies = [radio?.uhf, radio?.vhf].filter((mhz): mhz is number => mhz != null)
  return frequencies.length > 0
    ? frequencies.map((mhz) => mhz.toFixed(3)).join(' / ') + ' MHz'
    : '---'
}

type SectionPanelLayout = {
  x: number
  width: number
  panelY: number
  height: number
  contentY: number
}

type KneeboardLayout = {
  missionSummary: SectionPanelLayout
  flightGroup: SectionPanelLayout
  targetIntel: SectionPanelLayout
  waypoints: {
    panelY: number
    height: number
  }
  routeSketch: SectionPanelLayout & {
    mapX: number
    mapY: number
    mapWidth: number
    mapHeight: number
  }
  footer: {
    panelY: number
    height: number
  }
}

function sectionPanel(
  x: number,
  width: number,
  panelY: number,
  contentHeight: number
): SectionPanelLayout {
  return {
    x,
    width,
    panelY,
    height: SECTION_TITLE_HEIGHT + SECTION_CONTENT_PADDING_TOP + contentHeight,
    contentY: panelY + SECTION_TITLE_HEIGHT + SECTION_CONTENT_PADDING_TOP
  }
}

function buildKneeboardLayout(waypointCount: number): KneeboardLayout {
  const visibleWaypointRows = Math.min(MAX_VISIBLE_WAYPOINTS, Math.max(waypointCount, 1))
  const missionPanelHeight = 220
  const targetPanelHeight = 104

  let cursorY = HEADER_RULE_Y + SECTION_GAP

  const missionSummary = sectionPanel(CONTENT_X, 324, cursorY, missionPanelHeight)
  const flightGroup = sectionPanel(408, 296, cursorY, missionPanelHeight)

  cursorY = missionSummary.panelY + missionSummary.height + SECTION_GAP

  const targetIntel = sectionPanel(CONTENT_X, CONTENT_WIDTH, cursorY, targetPanelHeight)
  cursorY = targetIntel.panelY + targetIntel.height + SECTION_GAP

  const waypointTableHeight = WAYPOINT_ROW_HEIGHT * (visibleWaypointRows + 1)
  const waypoints = {
    panelY: cursorY,
    height: waypointTableHeight
  }
  cursorY = waypoints.panelY + waypoints.height + SECTION_GAP

  const footerPanelY = PAGE_INNER_BOTTOM - FOOTER_HEIGHT
  const routeContentHeight = Math.max(
    120,
    footerPanelY - SECTION_GAP - cursorY - SECTION_TITLE_HEIGHT - SECTION_CONTENT_PADDING_TOP
  )
  const routeSketch = sectionPanel(CONTENT_X, CONTENT_WIDTH, cursorY, routeContentHeight)

  return {
    missionSummary,
    flightGroup,
    targetIntel,
    waypoints,
    routeSketch: {
      ...routeSketch,
      mapX: CONTENT_X + MAP_INSET,
      mapY: routeSketch.contentY + MAP_INSET,
      mapWidth: CONTENT_WIDTH - MAP_INSET * 2,
      mapHeight:
        routeSketch.height - SECTION_TITLE_HEIGHT - SECTION_CONTENT_PADDING_TOP - MAP_INSET * 2
    },
    footer: {
      panelY: footerPanelY,
      height: FOOTER_HEIGHT
    }
  }
}

async function renderRouteSketch(
  waypoints: Waypoint[],
  theatre: Theatre,
  map: KneeboardLayout['routeSketch']
) {
  const { mapX: x, mapY: y, mapWidth: width, mapHeight: height } = map

  if (waypoints.length === 0) {
    return `<text x="${x + 28}" y="${y + height / 2}" class="muted">NO ROUTE DATA</text>`
  }

  const lngLatPoints = waypoints
    .map((waypoint) => dcsPositionToLngLat(waypoint.position.x, waypoint.position.y, theatre.name))
    .filter((point): point is NonNullable<typeof point> => point != null)

  const viewport = createRouteMapViewport({
    lngLatPoints,
    box: { x, y, width, height, padding: 14 }
  })

  if (!viewport) {
    return `<text x="${x + 28}" y="${y + height / 2}" class="muted">NO ROUTE DATA</text>`
  }

  const routeLine = waypoints
    .map((waypoint) => {
      const lngLat = dcsPositionToLngLat(waypoint.position.x, waypoint.position.y, theatre.name)
      if (!lngLat) return null
      const pixel = viewport.projectLngLat(lngLat.lng, lngLat.lat)
      return `${pixel.x.toFixed(1)},${pixel.y.toFixed(1)}`
    })
    .filter((value): value is string => value != null)
    .join(' ')

  let routeWaypointNumber = 0
  const points = waypoints
    .map((waypoint) => {
      const lngLat = dcsPositionToLngLat(waypoint.position.x, waypoint.position.y, theatre.name)
      if (!lngLat) return ''
      const pixel = viewport.projectLngLat(lngLat.lng, lngLat.lat)
      const isTask = waypoint.type === 'Task'
      const isLanding = waypoint.type === 'Landing'
      const fill = isTask ? '#8f2d22' : isLanding ? '#173f66' : '#efe6d3'
      const textFill = isTask || isLanding ? '#ffffff' : '#16202a'
      const displayedIndex = waypoint.type === 'TakeOff' ? undefined : ++routeWaypointNumber
      return `
        <circle cx="${pixel.x}" cy="${pixel.y}" r="11" fill="${fill}" stroke="#16202a" stroke-width="2" />
        ${
          displayedIndex == null
            ? ''
            : `<text x="${pixel.x}" y="${pixel.y + 4}" class="map-index" fill="${textFill}">${displayedIndex}</text>`
        }
      `
    })
    .join('')

  const geographicMapLayer = await renderGeographicMapLayerFromPmtiles({
    theatreName: theatre.name,
    bounds: viewport.bounds,
    projectLngLat: viewport.projectLngLat
  })

  return `
    <clipPath id="routeMapClip">
      <rect x="${x}" y="${y}" width="${width}" height="${height}" />
    </clipPath>
    <g clip-path="url(#routeMapClip)">
      ${geographicMapLayer}
      <path d="M ${x + 60} ${y} V ${y + height} M ${x + 180} ${y} V ${y + height} M ${x + 300} ${y} V ${y + height} M ${x + 420} ${y} V ${y + height} M ${x + 540} ${y} V ${y + height}
               M ${x} ${y + 48} H ${x + width} M ${x} ${y + 96} H ${x + width} M ${x} ${y + 144} H ${x + width}" class="grid" />
      <polyline points="${routeLine}" fill="none" stroke="#16202a" stroke-width="4" stroke-linecap="round" stroke-linejoin="round" />
      ${points}
      <path d="M ${x + 24} ${y + height - 24} L ${x + 31} ${y + height - 58} L ${x + 38} ${y + height - 24} L ${x + 31} ${y + height - 36} Z" fill="#16202a" />
      <text x="${x + 22}" y="${y + height - 62}" class="small">N</text>
      <text x="${x + width - 116}" y="${y + height - 16}" class="small">SCALE AUTO</text>
    </g>
  `
}

function renderWaypointTable(
  rows: KneeboardWaypointRow[],
  layout: KneeboardLayout['waypoints'],
  units: InstrumentUnits
) {
  const unitLabels = UNIT_FORMATS[units].labels
  const x = CONTENT_X
  const y = layout.panelY
  const rowHeight = WAYPOINT_ROW_HEIGHT
  const visibleRows = rows.slice(0, MAX_VISIBLE_WAYPOINTS)
  const remarksColumnX = x + 574
  const remarksTextX = remarksColumnX + 8
  const remarksTextWidth = CONTENT_WIDTH - (remarksTextX - x) - 8
  const columns = [
    { label: 'WP', width: 42 },
    { label: 'DESCRIPTION', width: 180 },
    { label: 'ETA', width: 72 },
    { label: unitLabels.altitude, width: 74 },
    { label: unitLabels.speed, width: 54 },
    { label: unitLabels.leg, width: 52 },
    { label: unitLabels.total, width: 52 },
    { label: 'BRG', width: 48 },
    { label: 'REMARKS', width: 66 }
  ]

  let cursor = x
  const headerCells = columns
    .map((column) => {
      const cell = `<text x="${cursor + column.width / 2}" y="${y + 17}" class="table-head">${escapeXml(column.label)}</text>`
      cursor += column.width
      return cell
    })
    .join('')

  const verticals = columns
    .slice(0, -1)
    .reduce(
      (acc, column) => {
        acc.cursor += column.width
        acc.lines.push(
          `<line x1="${acc.cursor}" y1="${y}" x2="${acc.cursor}" y2="${y + rowHeight * (visibleRows.length + 1)}" class="table-line" />`
        )
        return acc
      },
      { cursor: x, lines: [] as string[] }
    )
    .lines.join('')

  const body = visibleRows
    .map((row, index) => {
      const rowY = y + rowHeight * (index + 1)
      return `
        <line x1="${x}" y1="${rowY}" x2="${x + 640}" y2="${rowY}" class="table-line" />
        <text x="${x + 21}" y="${rowY + 17}" class="table-text center">${row.index ?? ''}</text>
        <text x="${x + 52}" y="${rowY + 17}" class="table-text">${escapeXml(truncate(row.name, 20))}</text>
        <text x="${x + 258}" y="${rowY + 17}" class="table-text center">${escapeXml(row.eta)}</text>
        <text x="${x + 332}" y="${rowY + 17}" class="table-text center">${escapeXml(row.altitude)}</text>
        <text x="${x + 396}" y="${rowY + 17}" class="table-text center">${escapeXml(row.speed)}</text>
        <text x="${x + 449}" y="${rowY + 17}" class="table-text center">${escapeXml(row.legDistance)}</text>
        <text x="${x + 501}" y="${rowY + 17}" class="table-text center">${escapeXml(row.totalDistance)}</text>
        <text x="${x + 551}" y="${rowY + 17}" class="table-text center">${escapeXml(row.bearing)}</text>
        <text x="${remarksTextX}" y="${rowY + 17}" class="table-text">${escapeXml(truncateToWidth(row.remarks, remarksTextWidth, 6.7))}</text>
      `
    })
    .join('')

  return `
    <rect x="${x}" y="${y}" width="${CONTENT_WIDTH}" height="${layout.height}" class="panel" />
    <rect x="${x}" y="${y}" width="640" height="${rowHeight}" fill="#efe6d3" />
    ${headerCells}
    ${verticals}
    ${body}
    ${
      rows.length > visibleRows.length
        ? `<text x="${x + 618}" y="${y + rowHeight * (visibleRows.length + 1) - 7}" class="table-note">+${rows.length - visibleRows.length} WP</text>`
        : ''
    }
  `
}

export async function renderKneeboardSvg(params: {
  campaign: Campaign
  theatre: Theatre
  missionFlightConfigs: MissionFlightConfig[]
  coalition: Coalition
  flightGroup: FlightGroup
}) {
  const { campaign, theatre, missionFlightConfigs, coalition, flightGroup } = params
  const profile = getKneeboardAircraftProfile(flightGroup)
  const units = profile?.units ?? 'imperial'
  const hasTacan = profile ? profile.navigationAids.includes('tacan') : true
  const rows = buildKneeboardWaypointRows(flightGroup, units)
  const missionConfig = findMissionConfig(missionFlightConfigs, flightGroup)
  const missionPackage = findMissionPackage(campaign, flightGroup)
  const targetDescriptionX = 408
  const targetDescriptionWidth = 280
  const missionDescriptionLines = wrapText(
    buildKneeboardMissionDescription({ flightGroup, missionPackage, theatre }),
    maxCharactersForWidth(targetDescriptionWidth, 7),
    3
  )
  const clientCount = flightGroup.aircrafts.filter((aircraft) => aircraft.client).length
  const layout = buildKneeboardLayout(rows.length)
  const mission = layout.missionSummary
  const flight = layout.flightGroup
  const target = layout.targetIntel

  return `
<svg xmlns="http://www.w3.org/2000/svg" width="${PAGE_WIDTH}" height="${PAGE_HEIGHT}" viewBox="0 0 ${PAGE_WIDTH} ${PAGE_HEIGHT}">
  <style>
    .page { fill: #f1e6d2; }
    .paper-noise { opacity: 0.12; }
    .panel { fill: rgba(255,255,255,0.16); stroke: #1c2226; stroke-width: 1.4; }
    .rule, .table-line { stroke: #3b403f; stroke-width: 1; opacity: 0.78; }
    .label { font-family: Arial, sans-serif; font-size: 12px; font-weight: 700; fill: #1c2226; }
    .value { font-family: Arial, sans-serif; font-size: 13px; font-weight: 700; fill: #173f66; }
    .section-title { font-family: Arial, sans-serif; font-size: 15px; font-weight: 800; fill: #ffffff; letter-spacing: 0; }
    .title { font-family: Arial, sans-serif; font-size: 32px; font-weight: 900; fill: #f1e6d2; font-style: italic; }
    .subtitle { font-family: Arial, sans-serif; font-size: 17px; font-weight: 800; fill: #1c2226; }
    .headline { font-family: Arial, sans-serif; font-size: 28px; font-weight: 900; fill: #173f66; }
    .small { font-family: Arial, sans-serif; font-size: 11px; font-weight: 700; fill: #1c2226; }
    .muted { font-family: Arial, sans-serif; font-size: 13px; font-weight: 700; fill: #637077; }
    .table-head { font-family: Arial, sans-serif; font-size: 10px; font-weight: 900; fill: #1c2226; text-anchor: middle; }
    .table-text { font-family: Arial, sans-serif; font-size: 12px; font-weight: 700; fill: #173f66; }
    .table-note { font-family: Arial, sans-serif; font-size: 10px; font-weight: 900; fill: #637077; text-anchor: end; }
    .center { text-anchor: middle; }
    .grid { stroke: #8fa5ad; stroke-width: 0.8; opacity: 0.45; }
    .map-land { fill: #ddd5c4; }
    .map-sea { fill: #5f95ad; opacity: 0.82; }
    .map-river { fill: none; stroke: #3d7f99; stroke-width: 1.6; opacity: 0.9; }
    .map-index { font-family: Arial, sans-serif; font-size: 10px; font-weight: 900; text-anchor: middle; }
  </style>
  <filter id="paperNoise">
    <feTurbulence type="fractalNoise" baseFrequency="0.85" numOctaves="3" seed="7" />
    <feColorMatrix type="saturate" values="0" />
  </filter>

  <rect width="${PAGE_WIDTH}" height="${PAGE_HEIGHT}" class="page" />
  <rect width="${PAGE_WIDTH}" height="${PAGE_HEIGHT}" filter="url(#paperNoise)" class="paper-noise" />
  <rect x="34" y="32" width="700" height="958" fill="none" stroke="#1c2226" stroke-width="1.6" />

  <text x="${KNEEBOARD_LOGO_BOX.x + KNEEBOARD_LOGO_BOX.width + 24}" y="95" class="subtitle">MISSION KNEEBOARD</text>
  <text x="520" y="84" class="label">DATE</text>
  <text x="520" y="108" class="value">${formatDate(campaign.time)}</text>
  <text x="632" y="84" class="label">TIME</text>
  <text x="632" y="108" class="value">${formatTime(campaign.time)}</text>
  <line x1="64" y1="126" x2="704" y2="126" class="rule" />

  <rect x="${mission.x}" y="${mission.panelY}" width="${mission.width}" height="${mission.height}" class="panel" />
  ${renderSectionHeader('MISSION SUMMARY', mission.x, mission.panelY, mission.width)}
  ${renderField('MISSION', flightGroup.task, 78, mission.contentY + 14, 294)}
  ${renderField('THEATRE', theatre.name, 78, mission.contentY + 40, 294)}
  ${renderField('HOME BASE', flightGroup.homeBase, 78, mission.contentY + 66, 294)}
  ${renderField('TARGET', getTargetSummary(flightGroup, theatre), 78, mission.contentY + 92, 294)}
  ${renderField('NOTES', getSpecialNotes(flightGroup, missionConfig), 78, mission.contentY + 118, 294)}
  ${renderField('PACKAGE', flightGroup.packageId ?? '---', 78, mission.contentY + 144, 294)}

  <rect x="${flight.x}" y="${flight.panelY}" width="${flight.width}" height="${flight.height}" class="panel" />
  ${renderSectionHeader('FLIGHT GROUP', flight.x, flight.panelY, flight.width)}
  <text x="424" y="${flight.contentY + 22}" class="headline">${escapeXml(truncate(flightGroup.callsign, 16))}</text>
  ${renderField('COALITION', coalition.toUpperCase(), 424, flight.contentY + 50, 248)}
  ${renderField('AIRCRAFT', getAircraftSummary(flightGroup), 424, flight.contentY + 76, 248)}
  ${renderField('CLIENTS', `${clientCount} / ${flightGroup.aircrafts.length}`, 424, flight.contentY + 102, 248)}
  ${(['FLIGHT', 'AWACS', 'ATC', 'JTAC'] as const)
    .map((purpose, index) =>
      renderField(
        getKneeboardRadioChannelLabel(missionConfig, purpose),
        getKneeboardRadioChannelSummary(missionConfig, purpose),
        424,
        flight.contentY + 128 + index * 26,
        248
      )
    )
    .join('')}

  <rect x="${CONTENT_X}" y="${target.panelY}" width="${CONTENT_WIDTH}" height="${target.height}" class="panel" />
  ${renderSectionHeader('TARGET / INTEL', CONTENT_X, target.panelY, CONTENT_WIDTH)}
  <text x="82" y="${target.contentY + 26}" class="value">${escapeXml(truncate(flightGroup.target?.objectiveId ?? 'N/A', 28))}</text>
  <text x="82" y="${target.contentY + 54}" class="value">${escapeXml(truncate(flightGroup.target?.type ?? 'N/A', 28))}</text>
  <text x="${targetDescriptionX}" y="${target.contentY + 26}" class="label">DESCRIPTION</text>
  <clipPath id="targetDescriptionClip">
    <rect x="${targetDescriptionX}" y="${target.contentY + 37}" width="${targetDescriptionWidth}" height="58" />
  </clipPath>
  <g clip-path="url(#targetDescriptionClip)">
    ${missionDescriptionLines
      .map(
        (line, index) =>
          `<text x="${targetDescriptionX}" y="${target.contentY + 50 + index * 17}" class="value">${escapeXml(line)}</text>`
      )
      .join('')}
  </g>

  ${renderWaypointTable(rows, layout.waypoints, units)}

  <rect x="${CONTENT_X}" y="${layout.routeSketch.panelY}" width="${CONTENT_WIDTH}" height="${layout.routeSketch.height}" class="panel" />
  ${renderSectionHeader('ROUTE SKETCH', CONTENT_X, layout.routeSketch.panelY, CONTENT_WIDTH)}
  ${await renderRouteSketch(flightGroup.flightplan.waypoints, theatre, layout.routeSketch)}

  <rect x="${CONTENT_X}" y="${layout.footer.panelY}" width="${CONTENT_WIDTH}" height="${layout.footer.height}" class="panel" />
  ${
    hasTacan
      ? `<text x="82" y="${layout.footer.panelY + 22}" class="small">TARGET TACAN</text>
  <text x="212" y="${layout.footer.panelY + 22}" class="value">${escapeXml(getKneeboardTargetTacanSummary(missionConfig))}</text>
  <text x="376" y="${layout.footer.panelY + 22}" class="small">LANDING TACAN</text>
  <text x="520" y="${layout.footer.panelY + 22}" class="value">${escapeXml(getKneeboardLandingTacanSummary(flightGroup, theatre, missionConfig))}</text>`
      : `<text x="82" y="${layout.footer.panelY + 22}" class="small">HOME NDB</text>
  <text x="152" y="${layout.footer.panelY + 22}" class="value">${escapeXml(getKneeboardHomeNdbSummary(flightGroup, theatre))}</text>
  <text x="400" y="${layout.footer.panelY + 22}" class="small">TOWER</text>
  <text x="452" y="${layout.footer.panelY + 22}" class="value">${escapeXml(getKneeboardHomeTowerSummary(flightGroup, theatre))}</text>`
  }
</svg>`
}

export async function renderKneeboardPng(svg: string): Promise<Buffer> {
  const base = await sharp(Buffer.from(svg)).png().toBuffer()
  const logo = await getKneeboardLogoPng()
  if (!logo) return base

  return sharp(base)
    .composite([
      {
        input: logo,
        left: KNEEBOARD_LOGO_BOX.x,
        top: KNEEBOARD_LOGO_BOX.y
      }
    ])
    .png()
    .toBuffer()
}

export async function createKneeboardImages(params: {
  campaign: Campaign
  theatre: Theatre
  missionFlightConfigs: MissionFlightConfig[]
}): Promise<KneeboardImage[]> {
  const clientFlightGroups = getClientFlightGroups(params.campaign)

  if (clientFlightGroups.length > 0 && !resolveTheatrePmtilesPath(params.theatre.name)) {
    if (!warnedMissingKneeboardMap.has(params.theatre.name)) {
      warnedMissingKneeboardMap.add(params.theatre.name)
      console.warn(
        `[dcc] ${params.theatre.name} map tiles were not found. Kneeboard route maps will not show geographic detail. Run \`bun run cache:map\` in apps/frontend or set the theatre PMTiles environment variable.`
      )
    }
  }

  return Promise.all(
    clientFlightGroups.map(async ({ coalition, flightGroup }, index) => {
      const svg = await renderKneeboardSvg({
        campaign: params.campaign,
        theatre: params.theatre,
        missionFlightConfigs: params.missionFlightConfigs,
        coalition,
        flightGroup
      })

      return {
        filename: createKneeboardFilename(index + 1, flightGroup),
        buffer: await renderKneeboardPng(svg)
      }
    })
  )
}
