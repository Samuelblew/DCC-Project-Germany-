import { CONVOY_GROUP_PREFIX, resolveAirActivity, resolveImmersion, schemas } from '@dcc/contracts'
import { callsigns } from '@dcc/data'
import * as z from 'zod'

import { resolveAiSkill } from './ai-skill'
import type { MissionCullingPlan } from './mission-culling'
import { type RampProp, rampScene } from './ramp-scene'

type Campaign = z.infer<typeof schemas.campaign.campaign>
type Theatre = z.infer<typeof schemas.theatre>
type Mission = z.infer<typeof schemas.dcs.mission>
type Coalition = z.infer<typeof schemas.coalition>
type Position = { x: number; y: number }
type AircraftGroup = NonNullable<
  NonNullable<NonNullable<Mission['coalition']['blue']['country']>[number]['plane']>
>['group'][number]

/** Every immersion group is prefixed so state sync, culling and a future runtime bubble can find it. */
export const AMBIENT_PREFIX = 'DCC-AMB-'
/** Supply convoy groups; their losses disrupt the route (see the frontend convoy losses). */
export const CONVOY_PREFIX = CONVOY_GROUP_PREFIX

export type ImmersionKit = 'eastern' | 'western'

/** Convoys inside the culling bands are all real units; this only guards frame rate. */
const MAX_CONVOYS_PER_SIDE = 8
const CONVOY_SPEED_MS = 12
const CIVIL_COUNTRY = { id: 82, name: 'UN Peacekeepers' }
const AMBIENT_FREQUENCY_MHZ = 127.5
/** Ambient flights are released over this window after mission start. */
const AMBIENT_RELEASE_WINDOW_SECONDS = 90 * 60

type AmbientAircraft = {
  type: string
  helicopter: boolean
  fuel: number
  /** Cruise speed in m/s. */
  speed: number
  altitude: number
}

const AN_26: AmbientAircraft = {
  type: 'An-26B',
  helicopter: false,
  fuel: 5_500,
  speed: 120,
  altitude: 5_000
}
const IL_76: AmbientAircraft = {
  type: 'IL-76MD',
  helicopter: false,
  fuel: 80_000,
  speed: 200,
  altitude: 8_500
}
const MI_8: AmbientAircraft = {
  type: 'Mi-8MT',
  helicopter: true,
  fuel: 1_929,
  speed: 55,
  altitude: 150
}
const C_130: AmbientAircraft = {
  type: 'C-130',
  helicopter: false,
  fuel: 20_830,
  speed: 150,
  altitude: 7_000
}
const UH_1: AmbientAircraft = {
  type: 'UH-1H',
  helicopter: true,
  fuel: 631,
  speed: 50,
  altitude: 150
}
const CH_47: AmbientAircraft = {
  type: 'CH-47D',
  helicopter: true,
  fuel: 3_600,
  speed: 65,
  altitude: 200
}
const YAK_40: AmbientAircraft = {
  type: 'Yak-40',
  helicopter: false,
  fuel: 3_080,
  speed: 140,
  altitude: 7_500
}

/** What a faction has on the ground and in the air in one period. */
type EraKit = {
  convoy: string[]
  transport: AmbientAircraft[]
  helicopter: AmbientAircraft[]
}

type EraBand = 'early' | 'vietnam' | 'lateCw' | 'modern'

/**
 * Period equipment per escalation stage. DCS has no 1950s trucks without the WWII asset pack, so the
 * early band uses the oldest stock vehicles (as DCC's Korea templates do) and leaves out anything
 * clearly later, such as helicopters and jet airliners.
 */
const ERA_KITS: Record<ImmersionKit, Record<EraBand, EraKit>> = {
  eastern: {
    early: {
      convoy: ['Ural-375', 'Ural-375', 'Ural-375'],
      transport: [],
      helicopter: []
    },
    vietnam: {
      convoy: ['Ural-375', 'GAZ-66', 'ATZ-5'],
      transport: [AN_26],
      helicopter: [MI_8]
    },
    lateCw: {
      convoy: ['Ural-375', 'KAMAZ Truck', 'ATZ-5'],
      transport: [AN_26, IL_76],
      helicopter: [MI_8]
    },
    modern: {
      convoy: ['Ural-4320T', 'KAMAZ Truck', 'ATZ-10'],
      transport: [AN_26, IL_76],
      helicopter: [MI_8]
    }
  },
  western: {
    early: {
      convoy: ['M 818', 'M 818', 'M 818'],
      transport: [C_130],
      helicopter: []
    },
    vietnam: {
      convoy: ['M 818', 'M 818', 'M 818'],
      transport: [C_130],
      helicopter: [UH_1, CH_47]
    },
    lateCw: {
      convoy: ['M 818', 'M 818', 'M978 HEMTT Tanker'],
      transport: [C_130],
      helicopter: [UH_1, CH_47]
    },
    modern: {
      convoy: ['M 818', 'M 818', 'M978 HEMTT Tanker'],
      transport: [C_130],
      helicopter: [UH_1, CH_47]
    }
  }
}

const CIVIL_AIRCRAFT: Record<EraBand, AmbientAircraft[]> = {
  early: [],
  vietnam: [YAK_40],
  lateCw: [YAK_40],
  modern: [YAK_40]
}

export function eraBand(era: Campaign['era'] | undefined): EraBand {
  if (era === 'WW2' || era === 'Korea') return 'early'
  if (era === 'Vietnam') return 'vietnam'
  if (era === 'Modern') return 'modern'
  return 'lateCw'
}

/** The period equipment for a coalition, following the escalation stage the campaign is in. */
export function eraKit(campaign: Pick<Campaign, 'playerSide' | 'era'>, coalition: Coalition) {
  return ERA_KITS[coalitionKit(campaign, coalition)][eraBand(campaign.era)]
}

export type AmbientFlightSchedule = {
  group: string
  /** Seconds after mission start the late-activated group is released. */
  delay: number
  /** Seconds after release the group is removed; only for flights that do not land. */
  lifetime?: number
}

export type ImmersionScriptConfig = {
  groundCrew: boolean
  /** Hot starts skip the fuel bowser; the jet is already fuelled and running. */
  hotStart: boolean
  baseLife: boolean
  /** The scene the script lays out around the player's parked aircraft, for the current period. */
  ramp: RampProp[]
  clientUnits: string[]
  ambient: AmbientFlightSchedule[]
}

/** Which equipment set a coalition's faction uses: Warsaw Pact style or NATO style. */
export function coalitionKit(campaign: Pick<Campaign, 'playerSide'>, coalition: Coalition) {
  const playerSide = campaign.playerSide ?? 'blue'
  const factionSide = coalition === 'player' ? playerSide : playerSide === 'red' ? 'blue' : 'red'
  return factionSide === 'red' ? 'eastern' : 'western'
}

/** Deterministic per mission, so regenerating the same campaign state gives the same ambient life. */
export function createSeededRandom(seed: string) {
  let state = 2166136261
  for (let index = 0; index < seed.length; index += 1) {
    state = Math.imul(state ^ seed.charCodeAt(index), 16777619)
  }
  return () => {
    state = (state + 0x6d2b79f5) | 0
    let value = Math.imul(state ^ (state >>> 15), 1 | state)
    value = (value + Math.imul(value ^ (value >>> 7), 61 | value)) ^ value
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296
  }
}

function lerp(from: Position, to: Position, fraction: number): Position {
  return { x: from.x + (to.x - from.x) * fraction, y: from.y + (to.y - from.y) * fraction }
}

function headingBetween(from: Position, to: Position) {
  return Math.atan2(to.y - from.y, to.x - from.x)
}

/** The point `meters` along a polyline, and the points still ahead of it. */
function walkAlong(points: Position[], meters: number) {
  let position = points[0]!
  let remaining = meters
  for (let index = 1; index < points.length; index += 1) {
    const next = points[index]!
    const length = Math.hypot(next.x - position.x, next.y - position.y)
    if (length >= remaining) {
      const fraction = length === 0 ? 0 : remaining / length
      position = lerp(position, next, fraction)
      return [position, ...points.slice(index)]
    }
    remaining -= length
    position = next
  }
  return [position]
}

function spacedAlong(remaining: Position[], taken: Position[], spacing: number) {
  const total = remaining
    .slice(1)
    .reduce(
      (sum, point, index) =>
        sum + Math.hypot(point.x - remaining[index]!.x, point.y - remaining[index]!.y),
      0
    )
  const blocked = (point: Position) =>
    taken.some((other) => Math.hypot(other.x - point.x, other.y - point.y) < spacing / 2)
  let path = remaining
  for (let moved = 0; moved < total / 2 && blocked(path[0]!); moved += spacing) {
    path = walkAlong(remaining, moved + spacing)
  }
  return path.length >= 1 ? path : remaining
}

const AIRFIELD_CLEARANCE_METERS = 2_500
const CONVOY_SPACING_METERS = 300

/**
 * Where a road convoy is put in the mission: off any airfield (the hub's centre is on the runway)
 * and not on top of another convoy, moving down its own road when needed.
 */
function convoySpawnPath(remaining: Position[], theatre: Theatre, taken: Position[]): Position[] {
  const total = remaining
    .slice(1)
    .reduce(
      (sum, point, index) =>
        sum + Math.hypot(point.x - remaining[index]!.x, point.y - remaining[index]!.y),
      0
    )
  const airfields = Object.values(theatre.airdromeDetails)
  const blocked = (point: Position) =>
    airfields.some(
      (airfield) =>
        Math.hypot(airfield.x - point.x, airfield.y - point.y) < AIRFIELD_CLEARANCE_METERS
    ) ||
    taken.some(
      (other) => Math.hypot(other.x - point.x, other.y - point.y) < CONVOY_SPACING_METERS / 2
    )
  let path = remaining
  for (let moved = 0; moved < total / 2 && blocked(path[0]!); moved += CONVOY_SPACING_METERS) {
    path = walkAlong(remaining, moved + CONVOY_SPACING_METERS)
  }
  return path.length >= 2 ? path : remaining
}

function missionCountry(mission: Mission, coalition: Coalition) {
  return mission.coalition[coalition === 'player' ? 'blue' : 'red'].country?.[0]
}

/**
 * Puts the campaign's supply convoys into the mission where they are: trucks on the roads still
 * ahead of them, helicopter lifts flying to the node they feed. Only convoys the culling plan keeps
 * are emitted. Their group names let the mission state report positions and losses back.
 */
export function addSupplyConvoys(
  mission: Mission,
  campaign: Campaign,
  theatre: Theatre,
  cullingPlan: MissionCullingPlan | undefined,
  nextId: () => number
) {
  if (!resolveImmersion(campaign.campaignParams?.immersion).convoys) return []
  if (campaign.campaignParams?.worldMode === 'bubble') return []
  const added: string[] = []

  for (const coalition of ['player', 'opponent'] as const) {
    const country = missionCountry(mission, coalition)
    if (!country) continue
    const kit = eraKit(campaign, coalition)
    const convoys = campaign.coalitions[coalition].supplyConvoys ?? []

    let emitted = 0
    const taken: Position[] = []
    for (const convoy of convoys) {
      if (emitted >= MAX_CONVOYS_PER_SIDE) break
      const remaining = [convoy.position, ...convoy.path.slice(convoy.nextPoint)]
      if (remaining.length < 2) continue
      const groupName = `${CONVOY_PREFIX}${coalition}-${convoy.id}`

      if (convoy.kind === 'air') {
        const helicopter = kit.helicopter[0]
        if (!helicopter) continue
        if (cullingPlan && !cullingPlan.includesAircraftPath(remaining)) continue
        const liftPath = spacedAlong(remaining, taken, 80)
        const start = liftPath[0]!
        taken.push(start)
        country.helicopter ??= { group: [] }
        country.helicopter.group.push(
          ambientFlight({
            name: groupName,
            aircraft: helicopter,
            start,
            end: remaining.at(-1)!,
            landing: { airdromeId: theatre.airdromeDetails[convoy.to]?.id },
            lateActivation: false,
            skill: resolveAiSkill(campaign, coalition, 'Average'),
            callsignIndex: added.length,
            nextId
          })
        )
        added.push(groupName)
        emitted += 1
        continue
      }

      if (cullingPlan && !cullingPlan.includesGroundPath(remaining)) continue
      const road = convoySpawnPath(remaining, theatre, taken)
      const start = road[0]!
      taken.push(start)
      const heading = headingBetween(start, road[1] ?? start)
      const units = Array.from({ length: convoy.vehicles }, (_, index) => ({
        unitId: nextId(),
        name: `${groupName}-${index + 1}`,
        type: kit.convoy[index % kit.convoy.length]!,
        // Line astern along the road, 25 m apart.
        x: start.x - Math.cos(heading) * index * 25,
        y: start.y - Math.sin(heading) * index * 25,
        heading,
        skill: resolveAiSkill(campaign, coalition, 'Average'),
        playerCanDrive: false
      }))
      // DCS requires the first waypoint of every group to have a locked time.
      const point = (position: Position, index: number) => ({
        alt: 0,
        alt_type: 'BARO',
        type: 'Turning Point',
        x: position.x,
        y: position.y,
        speed: CONVOY_SPEED_MS,
        action: 'On Road',
        ETA: 0,
        ETA_locked: index === 0,
        speed_locked: true,
        formation_template: ''
      })
      country.vehicle ??= { group: [] }
      country.vehicle.group.push({
        groupId: nextId(),
        name: groupName,
        units,
        x: start.x,
        y: start.y,
        hidden: false,
        start_time: 0,
        route: { points: road.map(point) }
      })
      added.push(groupName)
      emitted += 1
    }
  }

  return added
}

function ambientCallsign(index: number) {
  const callsignIndex = (index % Math.max(1, callsigns.length)) + 1
  const flightNumber = (Math.floor(index / Math.max(1, callsigns.length)) % 9) + 1
  return {
    '1': callsignIndex,
    '2': flightNumber,
    '3': 1,
    name: `${callsigns[callsignIndex - 1] ?? 'Enfield'}${flightNumber}1`
  }
}

function ambientFlight(params: {
  name: string
  aircraft: AmbientAircraft
  start: Position
  end: Position
  /** Land at the end: at the airfield when there is one, otherwise in the field. */
  landing?: { airdromeId?: number }
  lateActivation?: boolean
  skill: string
  callsignIndex: number
  nextId: () => number
}): AircraftGroup {
  const { aircraft, start, end } = params
  const altType = aircraft.helicopter ? 'RADIO' : 'BARO'
  // DCS requires the first waypoint to have a locked time, late-activated groups included.
  const routePoint = (position: Position, name: string, first = false) => ({
    alt: aircraft.altitude,
    alt_type: altType,
    type: 'Turning Point',
    action: 'Turning Point',
    x: position.x,
    y: position.y,
    speed: aircraft.speed,
    ETA: 0,
    ETA_locked: first,
    speed_locked: true,
    formation_template: '',
    name,
    task: { id: 'ComboTask', params: { tasks: [] } }
  })
  const finalPoint = params.landing
    ? {
        ...routePoint(end, 'Destination'),
        type: 'Land',
        action: 'Landing',
        alt: 0,
        ...(params.landing.airdromeId != null ? { airdromeId: params.landing.airdromeId } : {})
      }
    : routePoint(end, 'Exit')

  return {
    groupId: params.nextId(),
    name: params.name,
    task: 'Transport',
    units: [
      {
        unitId: params.nextId(),
        name: `${params.name}-1`,
        type: aircraft.type,
        x: start.x,
        y: start.y,
        alt: aircraft.altitude,
        alt_type: altType,
        speed: aircraft.speed,
        heading: headingBetween(start, end),
        skill: params.skill,
        livery_id: 'default',
        psi: 0,
        onboard_num: String(100 + params.callsignIndex),
        callsign: ambientCallsign(params.callsignIndex),
        payload: { pylons: {}, fuel: aircraft.fuel, flare: 0, chaff: 0, gun: 100 }
      }
    ],
    x: start.x,
    y: start.y,
    hidden: false,
    lateActivation: params.lateActivation ?? true,
    uncontrolled: false,
    start_time: 0,
    communication: true,
    frequency: AMBIENT_FREQUENCY_MHZ,
    modulation: 0,
    route: { points: [routePoint(start, 'Entry', true), finalPoint] }
  }
}

function pickPair(
  names: string[],
  theatre: Theatre,
  random: () => number,
  min: number,
  max: number
) {
  for (let attempt = 0; attempt < 12; attempt += 1) {
    const from = names[Math.floor(random() * names.length)]
    const to = names[Math.floor(random() * names.length)]
    if (!from || !to || from === to) continue
    const a = theatre.airdromeDetails[from]
    const b = theatre.airdromeDetails[to]
    if (!a || !b) continue
    const distance = Math.hypot(b.x - a.x, b.y - a.y)
    if (distance >= min && distance <= max) return { from: a, to: b, distance }
  }
  return null
}

/**
 * Background air traffic with no tasking: each side's transports and helicopters flying between its
 * own airfields, plus neutral airliners crossing the map. Groups are late-activated and released by
 * the immersion script over the first part of the mission, the way the stock DCS missions do it.
 */
export type PlannedAmbientFlight = {
  name: string
  side: 'player' | 'opponent' | 'neutral'
  helicopter: boolean
  type: string
  x: number
  y: number
  endX: number
  endY: number
  altitude: number
  speed: number
}

/** The same ambient flights the mission would bake, so the live bubble can spawn them instead. */
export function planAmbientFlights(
  campaign: Campaign,
  theatre: Theatre,
  random: () => number
): PlannedAmbientFlight[] {
  if (!resolveImmersion(campaign.campaignParams?.immersion).ambientAir) return []
  const activity = resolveAirActivity(campaign.campaignParams?.airActivity)
  const perKind = Math.max(1, Math.round(1 + activity))
  const planned: PlannedAmbientFlight[] = []

  for (const coalition of ['player', 'opponent'] as const) {
    const airdromes = campaign.coalitions[coalition].airdromeNames ?? []
    if (airdromes.length < 2) continue
    const kit = eraKit(campaign, coalition)
    for (let index = 0; index < perKind; index += 1) {
      const pair = pickPair(airdromes, theatre, random, 60_000, 900_000)
      const aircraft = kit.transport[Math.floor(random() * kit.transport.length)]
      if (!pair || !aircraft) continue
      const start = lerp(pair.from, pair.to, 0.1 + random() * 0.4)
      planned.push({
        name: `${AMBIENT_PREFIX}${coalition}-transport-${index + 1}`,
        side: coalition,
        helicopter: aircraft.helicopter,
        type: aircraft.type,
        x: start.x,
        y: start.y,
        endX: pair.to.x,
        endY: pair.to.y,
        altitude: aircraft.altitude,
        speed: aircraft.speed
      })
    }
  }

  const allAirdromes = Object.keys(theatre.airdromeDetails)
  if (allAirdromes.length >= 2) {
    for (let index = 0; index < perKind; index += 1) {
      const pair = pickPair(allAirdromes, theatre, random, 150_000, 2_000_000)
      const civil = CIVIL_AIRCRAFT[eraBand(campaign.era)]
      const aircraft = civil[Math.floor(random() * civil.length)]
      if (!pair || !aircraft) continue
      planned.push({
        name: `${AMBIENT_PREFIX}civil-${index + 1}`,
        side: 'neutral',
        helicopter: aircraft.helicopter,
        type: aircraft.type,
        x: pair.from.x,
        y: pair.from.y,
        endX: pair.to.x,
        endY: pair.to.y,
        altitude: aircraft.altitude,
        speed: aircraft.speed
      })
    }
  }

  return planned
}

export function addAmbientAirTraffic(
  mission: Mission,
  campaign: Campaign,
  theatre: Theatre,
  cullingPlan: MissionCullingPlan | undefined,
  nextId: () => number,
  random: () => number
): AmbientFlightSchedule[] {
  if (!resolveImmersion(campaign.campaignParams?.immersion).ambientAir) return []
  if (campaign.campaignParams?.worldMode === 'bubble') return []
  const activity = resolveAirActivity(campaign.campaignParams?.airActivity)
  // Two of each kind per side at x1, growing gently: x3 gives four, not six.
  const perKind = Math.max(1, Math.round(1 + activity))
  const schedule: AmbientFlightSchedule[] = []
  let callsignIndex = 0

  const release = () => Math.round(60 + random() * AMBIENT_RELEASE_WINDOW_SECONDS)

  for (const coalition of ['player', 'opponent'] as const) {
    const country = missionCountry(mission, coalition)
    const airdromes = campaign.coalitions[coalition].airdromeNames ?? []
    if (!country || airdromes.length < 2) continue
    const kit = eraKit(campaign, coalition)

    // Helicopters fly the supply lifts (see addSupplyConvoys); ambient traffic is fixed-wing.
    for (const [kind, options, min, max] of [
      ['transport', kit.transport, 60_000, 900_000]
    ] as const) {
      for (let index = 0; index < perKind; index += 1) {
        const pair = pickPair(airdromes, theatre, random, min, max)
        const aircraft = options[Math.floor(random() * options.length)]
        if (!pair || !aircraft) continue
        const start = lerp(pair.from, pair.to, 0.1 + random() * 0.4)
        if (cullingPlan && !cullingPlan.includesAircraftPath([start, pair.to])) continue
        const name = `${AMBIENT_PREFIX}${coalition}-${kind}-${index + 1}`
        const group = ambientFlight({
          name,
          aircraft,
          start,
          end: pair.to,
          landing: { airdromeId: pair.to.id },
          skill: resolveAiSkill(campaign, coalition, 'Average'),
          callsignIndex: callsignIndex++,
          nextId
        })
        if (aircraft.helicopter) {
          country.helicopter ??= { group: [] }
          country.helicopter.group.push(group)
        } else {
          country.plane ??= { group: [] }
          country.plane.group.push(group)
        }
        schedule.push({ group: name, delay: release() })
      }
    }
  }

  // Neutral airliners cross the theatre between two airfields far apart and are removed at the end.
  const allAirdromes = Object.keys(theatre.airdromeDetails)
  if (allAirdromes.length >= 2) {
    const neutrals = mission.coalition.neutrals
    neutrals.country ??= []
    let civilCountry = neutrals.country.find((entry) => entry.id === CIVIL_COUNTRY.id)
    for (let index = 0; index < perKind; index += 1) {
      const pair = pickPair(allAirdromes, theatre, random, 150_000, 2_000_000)
      const civil = CIVIL_AIRCRAFT[eraBand(campaign.era)]
      const aircraft = civil[Math.floor(random() * civil.length)]
      if (!pair || !aircraft) continue
      if (cullingPlan && !cullingPlan.includesAircraftPath([pair.from, pair.to])) continue
      if (!civilCountry) {
        civilCountry = { id: CIVIL_COUNTRY.id, name: CIVIL_COUNTRY.name }
        neutrals.country.push(civilCountry)
      }
      const name = `${AMBIENT_PREFIX}civil-${index + 1}`
      civilCountry.plane ??= { group: [] }
      civilCountry.plane.group.push(
        ambientFlight({
          name,
          aircraft,
          start: pair.from,
          end: pair.to,
          skill: 'Average',
          callsignIndex: callsignIndex++,
          nextId
        })
      )
      schedule.push({
        group: name,
        delay: release(),
        lifetime: Math.round(pair.distance / aircraft.speed) + 120
      })
    }
  }

  return schedule
}

/** Names of the player-flown aircraft, so the script can dress their parking spots. */
export function findClientUnitNames(mission: Mission) {
  const names: string[] = []
  for (const side of ['blue', 'red'] as const) {
    for (const country of mission.coalition[side].country ?? []) {
      for (const group of [...(country.plane?.group ?? []), ...(country.helicopter?.group ?? [])]) {
        for (const unit of group.units) {
          if (unit.skill === 'Client' || unit.skill === 'Player') names.push(unit.name)
        }
      }
    }
  }
  return names
}

export function createImmersionScriptConfig(
  campaign: Campaign,
  mission: Mission,
  ambient: AmbientFlightSchedule[]
): ImmersionScriptConfig {
  const immersion = resolveImmersion(campaign.campaignParams?.immersion)
  return {
    groundCrew: immersion.groundCrew,
    hotStart: campaign.campaignParams?.hotStart === true,
    baseLife: immersion.baseLife,
    ramp: rampScene(coalitionKit(campaign, 'player'), eraBand(campaign.era)),
    clientUnits: findClientUnitNames(mission),
    ambient
  }
}
