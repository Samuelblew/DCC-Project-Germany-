import { config, CONVOY_GROUP_PREFIX, resolveImmersion, schemas } from '@dcc/contracts'
import {
  aircrafts,
  buildings,
  campaignIadsEra,
  factions,
  germanyIadsControllingCoalition,
  germanyIadsOwnersFromObjectives,
  germanyIadsSamGroupName,
  getAircraftProfile,
  getGermanyIadsSites,
  isGermanyIadsTheatre,
  isSamFullyDestroyed,
  livingGermanyIadsSite,
  samTemplates
} from '@dcc/data'
import * as luaTable from '@dcc/lua-table'
import { ok, type Result } from 'neverthrow'
import * as z from 'zod'

import { gciPictureAnchors } from './add-gci'
import { createSeededRandom, eraKit, planAmbientFlights } from './immersion'
import { buildMissionCullingPlan, type MissionCullingPlan } from './mission-culling'
import { AWACS_FREQUENCY, DEFAULT_ATC_FREQUENCY, JTAC_FREQUENCY } from './radio-plan'
import { findTargetPlacement } from './target-placement'

type Campaign = z.infer<typeof schemas.campaign.campaign>
type Theatre = z.infer<typeof schemas.theatre>
type Coalition = 'player' | 'opponent'

const GROUND_ENTER_METERS = 12_000
const SAM_ENTER_CAP_METERS = 35_000
const LEAVE_RATIO = 1.2
const TAXI_LEAD_MS = 10 * 60 * 1000
/** Search radars around the live player. A campaign option replaces this later. */
const RADAR_ENTER_METERS = 150_000

const DCS_COUNTRY_IDS: Record<string, number> = {
  Russia: 0,
  USA: 2,
  UK: 4,
  France: 5,
  Germany: 6,
  Israel: 15,
  GDR: 78,
  Argentina: 83
}

const JOINT_TASK_FORCE_COUNTRY_IDS = {
  player: 80,
  opponent: 81
} as const

export type BubbleUnit = {
  name: string
  type: string
  x: number
  y: number
  heading: number
  category?: string
  shape?: string
  payload?: {
    fuel: number
    flare: number
    chaff: number
    gun: number
    pylons: Record<number, { CLSID: string; num: number }>
  }
  /** Preset channels on the flight radio: 1 flight, 2 AWACS, 3 tower, 4 JTAC. */
  radio?: { channels: Record<number, number> }[]
}

export type BubbleRoutePoint = {
  x: number
  y: number
  alt: number
  speed: number
  action: 'Turning Point' | 'Landing' | 'TakeOffParkingHot' | 'On Road'
}

export type BubbleEngage = {
  kind: 'air' | 'ground' | 'orbit'
  x: number
  y: number
  radius?: number
  x2?: number
  y2?: number
  alt?: number
  speed?: number
  duration?: number
  /** DCS group name. The script attacks it when that group is already alive. */
  groupName?: string
}

/** A campaign entity omitted from the .miz that the mission script may spawn beside the player. */
export type BubbleEntry = {
  id: string
  kind: 'ground' | 'sam' | 'aircraft' | 'ship' | 'static'
  groupName: string
  countryId: number
  x: number
  y: number
  enter: number
  leave: number
  units: BubbleUnit[]
  category?: 'airplane' | 'helicopter'
  altitude?: number
  speed?: number
  task?: string
  route?: BubbleRoutePoint[]
  engage?: BubbleEngage
  /** On the ramp, inside the taxi window. The script parks it and starts from the hot spot. */
  ramp?: boolean
  airdrome?: string
  /** Flight frequency in MHz. Stable for the callsign, so a respawn keeps the same channel. */
  frequency?: number
  /** Blue is the player. A GCI van spawns aircraft of the other side only. */
  side?: 'blue' | 'red'
}

const AIR_TO_AIR_TASKS = new Set(['CAP', 'Escort', 'Intercept', 'Fighter Sweep'])
const SUPPORT_TASKS = new Set(['AWACS', 'Refueling'])
const STRIKE_TASKS = new Set([
  'CAS',
  'SEAD',
  'DEAD',
  'Pinpoint Strike',
  'Strategic Strike',
  'Ground Attack',
  'Runway Attack',
  'Antiship Strike',
  'AFAC'
])

const DCS_TASK_BY_CAMPAIGN_TASK: Record<string, string> = {
  CAP: 'CAP',
  Escort: 'Escort',
  Intercept: 'Intercept',
  'Fighter Sweep': 'Fighter Sweep',
  AWACS: 'AWACS',
  Refueling: 'Refueling',
  CAS: 'CAS',
  SEAD: 'SEAD',
  DEAD: 'SEAD',
  'Pinpoint Strike': 'Pinpoint Strike',
  'Strategic Strike': 'Ground Attack',
  'Ground Attack': 'Ground Attack',
  'Runway Attack': 'Runway Attack',
  'Antiship Strike': 'Antiship Strike',
  AFAC: 'AFAC',
  Transport: 'Transport',
  CSAR: 'Transport',
  CASEVAC: 'Transport',
  'Troop Extraction': 'Transport',
  'Air Assault': 'Transport',
  RescueHelo: 'Transport',
  Training: 'Nothing'
}

type AircraftDefinition = {
  name: string
  isHelicopter?: boolean
  cruiseAltitude?: number
  cruiseSpeed?: number
  max_fuel?: number
  flare?: number
  chaff?: number
  allowedFrequency?: [number, number]
  loadouts?: { name?: string; task?: string; pylons?: { num?: number; CLSID: string }[] }[]
}

const aircraftByName = new Map<string, AircraftDefinition>()
for (const definition of Object.values(aircrafts)) {
  if (definition && typeof definition === 'object' && 'name' in definition) {
    aircraftByName.set(definition.name, definition)
  }
}

function flightFrequencyMhz(callsign: string, type: string, task: string) {
  if (task === 'AWACS') return AWACS_FREQUENCY
  const range = aircraftByName.get(type)?.allowedFrequency ?? [225, 399.975]
  const [min, max] = range
  const steps = Math.max(1, Math.floor((max - min) / 0.05))
  let hash = 0
  for (const char of callsign) hash = (hash * 33 + char.charCodeAt(0)) >>> 0
  return Math.round((min + (hash % steps) * 0.05) * 100) / 100
}

function towerFrequency(field?: { frequency?: number; frequencyList?: [number, number, number, number] }) {
  const candidates = [field?.frequency, ...(field?.frequencyList ?? [])]
  return (
    candidates.find((frequency) => frequency != null && frequency >= 225 && frequency <= 399.975) ??
    DEFAULT_ATC_FREQUENCY
  )
}

function flightRadio(type: string, frequency: number, atc: number) {
  const slot = getAircraftProfile(type)?.radios?.comms[0]?.missionRadio ?? 1
  const radios = Array.from({ length: slot }, () => ({ channels: {} as Record<number, number> }))
  const tuned = radios[slot - 1]
  if (!tuned) return undefined
  tuned.channels = {
    1: frequency,
    2: AWACS_FREQUENCY,
    3: atc,
    4: JTAC_FREQUENCY
  }
  return radios
}

function aircraftPayload(
  type: string,
  task?: string,
  explicit?: { num: number; CLSID: string }[]
) {
  const definition = aircraftByName.get(type)
  const loadout =
    definition?.loadouts?.find((candidate) => candidate.task === task) ??
    definition?.loadouts?.find((candidate) => candidate.task === 'CAP') ??
    definition?.loadouts?.find(
      (candidate) => candidate.name === 'default' || candidate.task === 'default'
    ) ??
    definition?.loadouts?.[0]
  const pylons: Record<number, { CLSID: string; num: number }> = {}
  const chosen = explicit?.length ? explicit : loadout?.pylons
  for (const pylon of chosen ?? []) {
    if (!pylon.num) continue
    pylons[pylon.num] = { CLSID: pylon.CLSID, num: pylon.num }
  }
  return {
    fuel: definition?.max_fuel ?? 1_000,
    flare: definition?.flare ?? 0,
    chaff: definition?.chaff ?? 0,
    gun: 100,
    pylons
  }
}

function aircraftEnterMeters(task: string) {
  if (AIR_TO_AIR_TASKS.has(task)) return 80_000
  if (SUPPORT_TASKS.has(task)) return 120_000
  if (STRIKE_TASKS.has(task)) return 40_000
  return 25_000
}

function flightIsAirborne(start: Date | undefined, now: Date) {
  if (!start) return true
  return new Date(start).getTime() <= now.getTime()
}

function flightOnRamp(start: Date | undefined, now: Date) {
  if (!start) return false
  const untilStart = new Date(start).getTime() - now.getTime()
  return untilStart > 0 && untilStart <= TAXI_LEAD_MS
}

function remainingRoute(
  flight: Campaign['coalitions']['player']['flightGroups'][number],
  altitude: number,
  speed: number
): BubbleRoutePoint[] {
  const waypoints = flight.flightplan.waypoints
  let start = 0
  let nearest = Number.POSITIVE_INFINITY
  waypoints.forEach((waypoint, index) => {
    const distance = Math.hypot(
      waypoint.position.x - flight.position.x,
      waypoint.position.y - flight.position.y
    )
    if (distance < nearest) {
      nearest = distance
      start = index
    }
  })
  if (nearest < 2_000 && start + 1 < waypoints.length) start += 1

  const ahead = waypoints.slice(start, start + 8).filter((waypoint) => waypoint.type !== 'TakeOff')
  return [
    {
      x: flight.position.x,
      y: flight.position.y,
      alt: altitude,
      speed,
      action: 'Turning Point'
    },
    ...ahead.map((waypoint) => ({
      x: waypoint.position.x,
      y: waypoint.position.y,
      alt: waypoint.altitude || altitude,
      speed: waypoint.speed || speed,
      action: waypoint.type === 'Landing' ? ('Landing' as const) : ('Turning Point' as const)
    }))
  ]
}

function targetGroupName(
  campaign: Campaign,
  flight: Campaign['coalitions']['player']['flightGroups'][number]
) {
  const target = flight.target
  if (!target || target.kind === 'structure' || target.kind === 'naval-group') return undefined
  for (const side of ['player', 'opponent'] as const) {
    const ground = campaign.coalitions[side].groundGroups.find((group) => group.id === target.id)
    if (ground) return `Ground-${ground.id}-1`
    const sam = campaign.coalitions[side].samGroups.find((group) => group.id === target.id)
    if (sam) return `SAM-${sam.id}-${sam.type}-1`
  }
  return undefined
}

function flightEngage(
  campaign: Campaign,
  flight: Campaign['coalitions']['player']['flightGroups'][number],
  theatre: Theatre,
  altitude: number,
  speed: number
): BubbleEngage | undefined {
  const waypoints = flight.flightplan.waypoints
  const taskIndex = waypoints.findIndex((waypoint) => waypoint.type === 'Task')
  const taskWaypoint = taskIndex >= 0 ? waypoints[taskIndex] : undefined
  const nextWaypoint = taskIndex >= 0 ? waypoints[taskIndex + 1] : undefined
  if (
    (flight.task === 'CAP' || flight.task === 'Escort') &&
    taskWaypoint &&
    nextWaypoint?.type === 'RaceTrack End'
  ) {
    return {
      kind: 'orbit',
      x: taskWaypoint.position.x,
      y: taskWaypoint.position.y,
      x2: nextWaypoint.position.x,
      y2: nextWaypoint.position.y,
      alt: taskWaypoint.altitude || altitude,
      speed: nextWaypoint.speed || speed,
      duration: Math.max(1, Math.round(config.packages.CAP.patrolDuration / 1000))
    }
  }

  const objective = flight.target
    ? theatre.objectives.find((candidate) => candidate.name === flight.target?.objectiveId)
    : undefined
  const aim = objective?.position ?? taskWaypoint?.position
  if (!aim) return undefined
  if (flight.task === 'Fighter Sweep' || flight.task === 'Intercept') {
    return {
      kind: 'air',
      x: aim.x,
      y: aim.y,
      radius: config.packages['Fighter Sweep'].engagementZoneRadius
    }
  }
  if (STRIKE_TASKS.has(flight.task)) {
    return {
      kind: 'ground',
      x: aim.x,
      y: aim.y,
      radius: 8_000,
      groupName: targetGroupName(campaign, flight)
    }
  }
  return undefined
}

function rampRoute(
  flight: Campaign['coalitions']['player']['flightGroups'][number],
  origin: { x: number; y: number },
  altitude: number,
  speed: number
): BubbleRoutePoint[] {
  const ahead = flight.flightplan.waypoints
    .filter((waypoint) => waypoint.type !== 'TakeOff')
    .slice(0, 7)
  return [
    { x: origin.x, y: origin.y, alt: 0, speed: 0, action: 'TakeOffParkingHot' },
    ...ahead.map((waypoint) => ({
      x: waypoint.position.x,
      y: waypoint.position.y,
      alt: waypoint.altitude || altitude,
      speed: waypoint.speed || speed,
      action: waypoint.type === 'Landing' ? ('Landing' as const) : ('Turning Point' as const)
    }))
  ]
}

function headingToward(from: { x: number; y: number }, to?: { x: number; y: number }) {
  if (!to) return 0
  const dx = to.x - from.x
  const dy = to.y - from.y
  if (dx * dx + dy * dy < 100 * 100) return 0
  return Math.atan2(dy, dx)
}

const NAVAL_ENTER_METERS = 40_000
const TRANSPORT_ENTER_METERS = 25_000

type NavalGroup = NonNullable<Campaign['coalitions']['player']['navalGroups']>[number]

export function omitNavalGroupFromMission(campaign: Campaign, members: NavalGroup[]) {
  if (campaign.campaignParams?.worldMode !== 'bubble') return false
  const carrierHomes = new Set<string>()
  const clientNavalTargets = new Set<string>()
  for (const side of ['player', 'opponent'] as const) {
    for (const flight of campaign.coalitions[side].flightGroups) {
      if (flight.homeBase) carrierHomes.add(flight.homeBase)
      if (
        flight.aircrafts.some((aircraft) => aircraft.client) &&
        flight.target?.kind === 'naval-group' &&
        flight.target.id
      ) {
        clientNavalTargets.add(flight.target.id)
      }
    }
  }
  return !members.some(
    (member) =>
      (member.role === 'carrier' && carrierHomes.has(member.id)) ||
      clientNavalTargets.has(member.id)
  )
}

function navalMissionGroups(groups: NavalGroup[]) {
  const ids = new Set(groups.map((group) => group.id))
  const missionGroups = new Map<string, NavalGroup[]>()
  for (const group of groups) {
    const missionGroupId =
      group.missionGroupId && ids.has(group.missionGroupId) ? group.missionGroupId : group.id
    const members = missionGroups.get(missionGroupId) ?? []
    members.push(group)
    missionGroups.set(missionGroupId, members)
  }
  return missionGroups
}

function liveNavalUnits(group: NavalGroup) {
  const units =
    group.units ??
    group.unitTypes.map((type, index) => ({
      id: `${group.id}-ship-${index + 1}`,
      type,
      state: 'operational' as const,
      damage: 0
    }))
  if (group.role === 'carrier') return units
  return units.filter((unit) => unit.state !== 'sunk' && unit.damage < 1)
}

function enterRadius(kind: BubbleEntry['kind'], weaponRange?: number) {
  if (kind === 'ground') return GROUND_ENTER_METERS
  const weapon = weaponRange && weaponRange > 0 ? weaponRange : GROUND_ENTER_METERS
  return Math.min(Math.max(weapon, GROUND_ENTER_METERS), SAM_ENTER_CAP_METERS)
}

function bubbleSide(coalition: Coalition): 'blue' | 'red' {
  return coalition === 'player' ? 'blue' : 'red'
}

function countryIdFor(campaign: Campaign, coalition: Coalition) {
  const campaignCoalition = campaign.coalitions[coalition]
  const faction = factions.find((candidate) => candidate.id === campaignCoalition.id)
  const countryName = campaignCoalition.countryName ?? faction?.countryName
  if (!countryName) return undefined
  const hasCustomClient = campaignCoalition.flightGroups.some((flightGroup) => {
    const factionAircraftTypes = schemas.resolveTaskAircraftTypes(
      campaignCoalition.aircraftTypes,
      flightGroup.task
    )
    return flightGroup.aircrafts.some(
      (aircraft) => aircraft.client && !factionAircraftTypes.includes(aircraft.aircraftName)
    )
  })
  return hasCustomClient ? JOINT_TASK_FORCE_COUNTRY_IDS[coalition] : DCS_COUNTRY_IDS[countryName]
}

function spread(x: number, y: number, index: number, count: number) {
  if (count <= 1) return { x, y }
  const angle = (Math.PI * 2 * index) / count
  return {
    x: Math.round(x + Math.cos(angle) * 18),
    y: Math.round(y + Math.sin(angle) * 18)
  }
}

/**
 * Names match the debrief parser: one copy keeps `unit.id`, extra copies get a suffix,
 * and entries without an id use `legacy-N` in expansion order.
 */
export function bubbleGroundUnitName(
  groupId: string,
  unit: { id?: string; count: number },
  copy: number,
  unitIndex: number
) {
  const id = unit.id ?? `legacy-${unitIndex + 1}`
  const suffix = unit.count > 1 && unit.id ? `${unit.id}-${copy + 1}` : id
  return `GroundUnit-${groupId}-${suffix}`
}

/**
 * Ground columns and SAM sites the static corridor left out. The mission script spawns these
 * beside the live player and destroys them again past 120% of the enter radius. Names stay on
 * the Ground-/SAM- prefixes so a real kill still parses in the debrief.
 */
/** Lua chunk the mission script can `loadstring`. Positions are whatever the campaign holds right now. */
export function formatBubbleCatalogueSource(
  missionId: string,
  entries: BubbleEntry[]
): Result<string, Error> {
  const table = luaTable.stringify({ missionId, entries }, { pretty: false, mixedKeyTypes: true })
  if (table.isErr()) return table
  return ok(`return ${table.value}\n`)
}

export function buildBubbleCatalogue(
  campaign: Campaign,
  theatre: Theatre,
  cullingPlan: MissionCullingPlan = buildMissionCullingPlan(campaign, theatre)
): BubbleEntry[] {
  if (campaign.campaignParams?.worldMode !== 'bubble') return []

  const pictureAnchors = gciPictureAnchors(campaign, theatre)
  const entries: BubbleEntry[] = []
  for (const coalition of ['player', 'opponent'] as const) {
    const countryId = countryIdFor(campaign, coalition)
    if (countryId == null) continue

    for (const group of campaign.coalitions[coalition].groundGroups) {
      if (cullingPlan.getGroundGroupMode(coalition, group) !== 'omit') continue
      const pending: { unit: (typeof group.units)[number]; copy: number; unitIndex: number }[] = []
      let unitIndex = 0
      for (const unit of group.units) {
        for (let copy = 0; copy < Math.max(0, unit.count); copy++) {
          pending.push({ unit, copy, unitIndex })
          unitIndex += 1
        }
      }
      if (pending.length === 0) continue
      const placed = pending.map(({ unit, copy, unitIndex: index }, order) => {
        const point =
          unit.position ?? spread(group.position.x, group.position.y, order, pending.length)
        return {
          name: bubbleGroundUnitName(group.id, unit, copy, index),
          type: unit.name,
          x: point.x,
          y: point.y,
          heading: unit.heading ?? 0
        }
      })
      const enter = enterRadius('ground')
      entries.push({
        id: group.id,
        kind: 'ground',
        groupName: `Ground-${group.id}-1`,
        countryId,
        x: group.position.x,
        y: group.position.y,
        enter,
        leave: Math.round(enter * LEAVE_RATIO),
        units: placed
      })
    }

    if (!isGermanyIadsTheatre(theatre.name)) {
      for (const sam of campaign.coalitions[coalition].samGroups) {
        if (isSamFullyDestroyed(sam)) continue
        const objective = theatre.objectives.find((candidate) => candidate.name === sam.objectiveId)
        if (!objective) continue
        const template = samTemplates[sam.type]
        const placement = findTargetPlacement(theatre, {
          objectiveName: sam.objectiveId,
          type: 'SAM'
        })
        const position = placement?.position ?? objective.position
        if (cullingPlan.getSamMode(sam.id, position, template.range) !== 'omit') continue
        const living = template.units
          .map((type, index) => ({ type, index }))
          .filter((unit) => !sam.deadUnitIndexes?.includes(unit.index))
        if (living.length === 0) continue
        const units = living.map(({ type, index }, order) => {
          const point = spread(position.x, position.y, order, living.length)
          return {
            name: `SAM-${sam.id}-${sam.type}-1-${index + 1}`,
            type,
            x: point.x,
            y: point.y,
            heading: 0
          }
        })
        const enter = enterRadius('sam', template.range)
        entries.push({
          id: sam.id,
          kind: 'sam',
          groupName: `SAM-${sam.id}-${sam.type}-1`,
          countryId,
          x: position.x,
          y: position.y,
          enter,
          leave: Math.round(enter * LEAVE_RATIO),
          units
        })
      }
    }

    for (const [missionGroupId, unsorted] of navalMissionGroups(
      campaign.coalitions[coalition].navalGroups ?? []
    )) {
      const leader = unsorted.find((group) => group.id === missionGroupId) ?? unsorted[0]
      if (!leader) continue
      const members = [leader, ...unsorted.filter((group) => group !== leader)]
      if (!omitNavalGroupFromMission(campaign, members)) continue
      const bearing = leader.heading + Math.PI / 2
      const units = members.flatMap((group) => {
        if (group.role !== 'carrier' && group.state === 'sunk') return []
        return liveNavalUnits(group).map((unit, index) => ({
          name: `NavalUnit-${group.id}-${unit.id}`,
          type: unit.type,
          x: group.position.x + Math.cos(bearing) * index * 700,
          y: group.position.y + Math.sin(bearing) * index * 700,
          heading: leader.heading
        }))
      })
      if (units.length === 0) continue
      const enter = members.every((group) => group.role === 'transport')
        ? TRANSPORT_ENTER_METERS
        : NAVAL_ENTER_METERS
      entries.push({
        id: missionGroupId,
        kind: 'ship',
        groupName: `NavalGroup-${missionGroupId}`,
        countryId,
        x: leader.position.x,
        y: leader.position.y,
        enter,
        leave: Math.round(enter * LEAVE_RATIO),
        speed: leader.state === 'unloading' ? 0 : (leader.missionPatrol?.speed ?? 8),
        units
      })
    }

    for (const structure of campaign.coalitions[coalition].structures) {
      if (cullingPlan.getStructureMode(coalition, structure) !== 'omit') continue
      const objective = theatre.objectives.find(
        (candidate) => candidate.name === structure.objectiveId
      )
      const origin = structure.position ?? objective?.position
      if (!origin) continue
      const units: BubbleUnit[] = []
      structure.buildings.forEach((building, index) => {
        if (building.alive === false) return
        const info = buildings[building.type]
        if (!info) return
        units.push({
          name: `Static-${structure.id}-${structure.type}-${index + 1}`,
          type: info.type,
          category: info.category,
          shape: info.shapeName,
          x: origin.x + building.offset.x,
          y: origin.y + building.offset.y,
          heading: 0
        })
      })
      if (units.length === 0) continue
      const enter = GROUND_ENTER_METERS
      entries.push({
        id: structure.id,
        kind: 'static',
        groupName: `Static-${structure.id}`,
        countryId,
        x: origin.x,
        y: origin.y,
        enter,
        leave: Math.round(enter * LEAVE_RATIO),
        units
      })
    }

    if (resolveImmersion(campaign.campaignParams?.immersion).convoys) {
      const kit = eraKit(campaign, coalition)
      for (const convoy of campaign.coalitions[coalition].supplyConvoys ?? []) {
        const ahead = [convoy.position, ...convoy.path.slice(convoy.nextPoint)]
        if (ahead.length < 2) continue
        const groupName = `${CONVOY_GROUP_PREFIX}${coalition}-${convoy.id}`
        const next = ahead[1]
        if (convoy.kind === 'air') {
          const helicopter = kit.helicopter[0]
          if (!helicopter || !next) continue
          const enter = TRANSPORT_ENTER_METERS
          entries.push({
            id: convoy.id,
            kind: 'aircraft',
            groupName,
            countryId,
            x: convoy.position.x,
            y: convoy.position.y,
            enter,
            leave: Math.round(enter * LEAVE_RATIO),
            category: 'helicopter',
            altitude: helicopter.altitude,
            speed: helicopter.speed,
            task: 'Transport',
            side: bubbleSide(coalition),
            route: ahead.slice(0, 8).map((point) => ({
              x: point.x,
              y: point.y,
              alt: helicopter.altitude,
              speed: helicopter.speed,
              action: 'Turning Point' as const
            })),
            units: Array.from({ length: convoy.vehicles }, (_, index) => ({
              name: `${groupName}-${index + 1}`,
              type: helicopter.type,
              x: convoy.position.x,
              y: convoy.position.y,
              heading: headingToward(convoy.position, next),
              payload: aircraftPayload(helicopter.type, 'Transport')
            }))
          })
          continue
        }
        if (!next || kit.convoy.length === 0) continue
        const heading = headingToward(convoy.position, next)
        const enter = GROUND_ENTER_METERS
        entries.push({
          id: convoy.id,
          kind: 'ground',
          groupName,
          countryId,
          x: convoy.position.x,
          y: convoy.position.y,
          enter,
          leave: Math.round(enter * LEAVE_RATIO),
          speed: 12,
          route: ahead.slice(0, 8).map((point) => ({
            x: point.x,
            y: point.y,
            alt: 0,
            speed: 12,
            action: 'On Road' as const
          })),
          units: Array.from({ length: convoy.vehicles }, (_, index) => ({
            name: `${groupName}-${index + 1}`,
            type: kit.convoy[index % kit.convoy.length] ?? 'Ural-375',
            x: convoy.position.x - Math.cos(heading) * index * 25,
            y: convoy.position.y - Math.sin(heading) * index * 25,
            heading
          }))
        })
      }
    }

    for (const ewr of campaign.coalitions[coalition].ewrGroups ?? []) {
      if (ewr.destroyed || pictureAnchors.ewrs.has(ewr.id)) continue
      entries.push({
        id: ewr.id,
        kind: 'ground',
        groupName: `IADS-EWR-${ewr.id}`,
        countryId,
        x: ewr.position.x,
        y: ewr.position.y,
        enter: RADAR_ENTER_METERS,
        leave: Math.round(RADAR_ENTER_METERS * LEAVE_RATIO),
        units: [
          {
            name: `IADS-EWR-Unit-${ewr.id}`,
            type: ewr.type,
            x: ewr.position.x,
            y: ewr.position.y,
            heading: 0
          }
        ]
      })
    }

    for (const flight of campaign.coalitions[coalition].flightGroups) {
      if (flight.task === 'AWACS') continue
      if (flight.aircrafts.some((aircraft) => aircraft.client)) continue
      if (flight.careerMission) continue
      if (flight.aircrafts.length === 0) continue
      const airborne = flightIsAirborne(flight.flightplan.startTime, campaign.time)
      const ramp = flightOnRamp(flight.flightplan.startTime, campaign.time)
      if (!airborne && !ramp) continue
      const lead = flight.aircrafts[0]
      if (!lead) continue
      const definition = aircraftByName.get(lead.aircraftName)
      const helicopter = definition?.isHelicopter === true
      const field = theatre.airdromeDetails[flight.homeBase]
      const origin = ramp && field ? field : flight.position
      const waypoint = flight.flightplan.waypoints.find(
        (point) => Math.hypot(point.position.x - origin.x, point.position.y - origin.y) > 100
      )
      const enter = ramp ? GROUND_ENTER_METERS : aircraftEnterMeters(flight.task)
      const heading = headingToward(origin, waypoint?.position)
      const altitude =
        waypoint?.altitude ?? definition?.cruiseAltitude ?? (helicopter ? 300 : 6_000)
      const speed = waypoint?.speed ?? definition?.cruiseSpeed ?? (helicopter ? 60 : 200)
      const frequency = flightFrequencyMhz(flight.callsign, lead.aircraftName, flight.task)
      const radio = flightRadio(lead.aircraftName, frequency, towerFrequency(field))
      entries.push({
        id: flight.id,
        kind: 'aircraft',
        groupName: flight.callsign,
        countryId,
        x: origin.x,
        y: origin.y,
        enter,
        leave: Math.round(enter * LEAVE_RATIO),
        category: helicopter ? 'helicopter' : 'airplane',
        altitude,
        speed,
        task: DCS_TASK_BY_CAMPAIGN_TASK[flight.task] ?? 'CAP',
        side: bubbleSide(coalition),
        route: ramp
          ? rampRoute(flight, origin, altitude, speed)
          : remainingRoute(flight, altitude, speed),
        engage: flightEngage(campaign, flight, theatre, altitude, speed),
        ramp: ramp || undefined,
        airdrome: ramp ? flight.homeBase : undefined,
        frequency,
        units: flight.aircrafts.map((aircraft, index) => {
          const point = spread(origin.x, origin.y, index, flight.aircrafts.length)
          return {
            name: aircraft.unitName || `${flight.callsign}-${index + 1}`,
            type: aircraft.aircraftName,
            x: point.x,
            y: point.y,
            heading,
            payload: aircraftPayload(aircraft.aircraftName, flight.task, aircraft.pylons),
            radio
          }
        })
      })
    }
  }

  if (isGermanyIadsTheatre(theatre.name)) {
    const owners = germanyIadsOwnersFromObjectives(
      theatre.objectives,
      campaign.coalitions.player.objectiveIds,
      campaign.coalitions.opponent.objectiveIds
    )
    for (const authored of getGermanyIadsSites(campaignIadsEra(campaign))) {
      if (authored.kind === 'hq') continue
      const site = livingGermanyIadsSite(authored, campaign.germanyIadsDeadUnits)
      if (!site || site.units.length === 0) continue
      const coalition = germanyIadsControllingCoalition(site, owners)
      const countryId = countryIdFor(campaign, coalition)
      if (countryId == null) continue
      const mode = cullingPlan.getSamMode(
        site.id,
        { x: site.x, y: site.y },
        site.kind === 'sam' ? site.range : undefined
      )
      if (mode !== 'omit' || pictureAnchors.sites.has(site.id)) continue
      const parked = site.kind === 'airbase'
      const radar = site.kind === 'ewr'
      const enter = parked
        ? GROUND_ENTER_METERS
        : radar
          ? RADAR_ENTER_METERS
          : enterRadius('sam', site.range)
      entries.push({
        id: site.id,
        kind: parked ? 'static' : radar || site.kind === 'support' ? 'ground' : 'sam',
        groupName: site.kind === 'sam' ? germanyIadsSamGroupName(site, coalition) : site.id,
        countryId,
        x: site.x,
        y: site.y,
        enter,
        leave: Math.round(enter * LEAVE_RATIO),
        units: site.units.map((unit) => ({
          name: unit.name,
          type: unit.type,
          category: unit.category,
          x: unit.x,
          y: unit.y,
          heading: unit.heading
        }))
      })
    }
  }

  if (resolveImmersion(campaign.campaignParams?.immersion).ambientAir) {
    for (const flight of planAmbientFlights(
      campaign,
      theatre,
      createSeededRandom(`${campaign.id}:ambient`)
    )) {
      const countryId = flight.side === 'neutral' ? 82 : countryIdFor(campaign, flight.side)
      if (countryId == null) continue
      const enter = TRANSPORT_ENTER_METERS
      entries.push({
        id: flight.name,
        kind: 'aircraft',
        groupName: flight.name,
        countryId,
        x: flight.x,
        y: flight.y,
        enter,
        leave: Math.round(enter * LEAVE_RATIO),
        category: flight.helicopter ? 'helicopter' : 'airplane',
        altitude: flight.altitude,
        speed: flight.speed,
        task: 'Transport',
        side: flight.side === 'neutral' ? undefined : bubbleSide(flight.side),
        route: [
          {
            x: flight.x,
            y: flight.y,
            alt: flight.altitude,
            speed: flight.speed,
            action: 'Turning Point'
          },
          {
            x: flight.endX,
            y: flight.endY,
            alt: flight.altitude,
            speed: flight.speed,
            action: 'Turning Point'
          }
        ],
        units: [
          {
            name: `${flight.name}-1`,
            type: flight.type,
            x: flight.x,
            y: flight.y,
            heading: headingToward(
              { x: flight.x, y: flight.y },
              { x: flight.endX, y: flight.endY }
            ),
            payload: aircraftPayload(flight.type, 'Transport')
          }
        ]
      })
    }
  }

  return entries
}
