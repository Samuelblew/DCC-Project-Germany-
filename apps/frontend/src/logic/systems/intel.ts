import { schemas } from '@dcc/contracts'
import {
  campaignGciEnabled,
  GCI_RANGE_METERS,
  iadsControllingCoalition,
  iadsOwnersFromObjectives,
  getAuthoredIadsSites,
  getSamSitePosition,
  isAuthoredIadsSamDestroyed,
  hasAuthoredIads,
  isSamOperational,
  livingAuthoredIadsSite,
  planCampaignGciStations,
  samTemplates
} from '@dcc/data'
import type * as z from 'zod'

import { hasFlightGroupTakenOff } from '@/logic/entities/flight-status'
import { calculateDistance } from '@/logic/utils/calculate-distance'

import { resolveSpawnContext } from './spawn/packages/common'

type Campaign = z.infer<typeof schemas.campaign.campaign>
type Coalition = z.infer<typeof schemas.coalition>
type Position = z.infer<typeof schemas.position>
type Theatre = z.infer<typeof schemas.theatre>
type Contact = NonNullable<Campaign['coalitions']['player']['intel']>[string]
type ContactKind = Contact['kind']
type Source = Contact['source']

/** How far each kind of sensor sees each kind of target, in metres. Zero means it cannot. */
type Sensor = { position: Position; ground: number; naval: number; air: number; source: Source }

/** Troops spot what is in front of them; a town's garrison and observers cover its outskirts. */
const GROUND_OBSERVER = 8_000
const GARRISON_OBSERVER = 5_000
/** Approach radar at a held airfield. */
const AIRFIELD_RADAR = 60_000
const EWR_RADAR = 200_000
const AWACS_RADAR = 350_000
/** Air-to-air radar or eyes on the way to a target. */
const AIRCRAFT_AIR = 40_000
const AIRCRAFT_GROUND = 10_000
/** Low and slow on purpose: CAS, armed recon and FAC look for things on the ground. */
const LOOKOUT_GROUND = 20_000
const AIRCRAFT_NAVAL = 60_000
const SHIP_AIR = 120_000
const SHIP_NAVAL = 60_000

const LOOKOUT_TASKS = new Set(['CAS', 'AFAC', 'Ground Attack', 'Antiship Strike'])

/** A sighting of something that moves goes stale; after this long it is dropped from the map. */
export const INTEL_RETENTION_MS = 12 * 3_600_000
/** Planners strike ground and naval units seen within this window. */
export const TARGET_INTEL_MAX_AGE_MS = 3 * 3_600_000

export function isFogOfWarEnabled(campaign: Pick<Campaign, 'campaignParams'>) {
  return campaign.campaignParams?.fogOfWar !== false
}

function era(campaign: Campaign) {
  return campaign.escalation?.enabled ? (campaign.escalation.stage ?? campaign.era) : campaign.era
}

function groundGroupAlive(group: { units: Array<{ count: number }> }) {
  return group.units.some((unit) => unit.count > 0)
}

/** The coalition's SAM sites able to fire and, in Germany, its IADS early-warning radars. */
export function airDefenseRadars(campaign: Campaign, coalition: Coalition, theatre: Theatre) {
  const sites: Array<{ kind: 'sam' | 'ewr'; position: Position; range: number }> = []
  if (hasAuthoredIads(theatre.name)) {
    const owners = iadsOwnersFromObjectives(
      theatre.objectives,
      campaign.coalitions.player.objectiveIds,
      campaign.coalitions.opponent.objectiveIds
    )
    for (const site of getAuthoredIadsSites(theatre.name, era(campaign))) {
      if (site.kind !== 'sam' && site.kind !== 'ewr') continue
      if (iadsControllingCoalition(site, owners) !== coalition) continue
      if (site.kind === 'sam' && isAuthoredIadsSamDestroyed(site, campaign.iadsDeadUnits)) {
        continue
      }
      if (!livingAuthoredIadsSite(site, campaign.iadsDeadUnits)) continue
      sites.push({ kind: site.kind, position: { x: site.x, y: site.y }, range: site.range ?? 0 })
    }
    return sites
  }
  for (const sam of campaign.coalitions[coalition].samGroups) {
    if (!isSamOperational(sam)) continue
    const position = getSamSitePosition(theatre, sam.objectiveId)
    if (position) sites.push({ kind: 'sam', position, range: samTemplates[sam.type]?.range ?? 0 })
  }
  return sites
}

function sensorsFor(campaign: Campaign, coalition: Coalition, theatre: Theatre): Sensor[] {
  const side = campaign.coalitions[coalition]
  const sensors: Sensor[] = []
  const add = (position: Position, source: Source, ranges: Partial<Omit<Sensor, 'position'>>) =>
    sensors.push({ position, source, ground: 0, naval: 0, air: 0, ...ranges })

  for (const group of side.groundGroups) {
    if (groundGroupAlive(group)) add(group.position, 'ground', { ground: GROUND_OBSERVER })
  }
  const objectives = new Map(theatre.objectives.map((entry) => [entry.name, entry.position]))
  for (const objectiveId of side.objectiveIds) {
    const position = objectives.get(objectiveId)
    if (position) add(position, 'ground', { ground: GARRISON_OBSERVER })
  }
  for (const name of side.airdromeNames) {
    const airdrome = theatre.airdromeDetails[name]
    if (airdrome) {
      add({ x: airdrome.x, y: airdrome.y }, 'radar', {
        ground: GARRISON_OBSERVER,
        air: AIRFIELD_RADAR
      })
    }
  }

  for (const ewr of side.ewrGroups ?? []) {
    if (!ewr.destroyed && !ewr.jammed) add(ewr.position, 'radar', { air: EWR_RADAR })
  }
  for (const site of airDefenseRadars(campaign, coalition, theatre)) {
    add(site.position, 'radar', {
      air: site.kind === 'ewr' ? EWR_RADAR : Math.max(site.range, 20_000)
    })
  }
  if (campaignGciEnabled(campaign)) {
    for (const station of planCampaignGciStations(campaign, theatre)[coalition]) {
      add(station.position, 'radar', { air: GCI_RANGE_METERS })
    }
  }

  for (const group of side.flightGroups) {
    if (!hasFlightGroupTakenOff(group, campaign.time)) continue
    if (group.task === 'AWACS') {
      add(group.position, 'radar', { air: AWACS_RADAR, naval: AIRCRAFT_NAVAL })
      continue
    }
    add(group.position, 'aircraft', {
      air: AIRCRAFT_AIR,
      ground: LOOKOUT_TASKS.has(group.task) ? LOOKOUT_GROUND : AIRCRAFT_GROUND,
      naval: AIRCRAFT_NAVAL
    })
  }
  for (const ship of side.navalGroups ?? []) {
    if (ship.state !== 'sunk') {
      add(ship.position, 'naval', { air: SHIP_AIR, naval: SHIP_NAVAL })
    }
  }
  return sensors
}

function detect(sensors: Sensor[], position: Position, range: 'ground' | 'naval' | 'air') {
  for (const sensor of sensors) {
    const reach = sensor[range]
    if (reach > 0 && calculateDistance(sensor.position, position) <= reach) return sensor.source
  }
  return undefined
}

/** Enemy units that can be seen, with the sensor range that applies to each. */
function enemyUnits(campaign: Campaign, enemy: Coalition) {
  const side = campaign.coalitions[enemy]
  const units: Array<{
    id: string
    kind: ContactKind
    position: Position
    range: 'ground' | 'naval' | 'air'
  }> = []
  for (const group of side.groundGroups) {
    if (groundGroupAlive(group)) {
      units.push({ id: group.id, kind: 'ground', position: group.position, range: 'ground' })
    }
  }
  for (const ship of side.navalGroups ?? []) {
    if (ship.state !== 'sunk') {
      units.push({ id: ship.id, kind: 'naval', position: ship.position, range: 'naval' })
    }
  }
  for (const convoy of side.supplyConvoys ?? []) {
    units.push({
      id: convoy.id,
      kind: 'convoy',
      position: convoy.position,
      range: convoy.kind === 'air' ? 'air' : 'ground'
    })
  }
  for (const group of side.flightGroups) {
    if (hasFlightGroupTakenOff(group, campaign.time)) {
      units.push({ id: group.id, kind: 'air', position: group.position, range: 'air' })
    }
  }
  return units
}

/**
 * Refreshes what `coalition` knows about the enemy. Sightings of ground units, ships and convoys
 * keep their last position and fade out after INTEL_RETENTION_MS; aircraft are radar tracks and
 * only exist while something is watching them.
 */
export function updateIntel(draft: Campaign, coalition: Coalition) {
  if (!isFogOfWarEnabled(draft)) {
    delete draft.coalitions[coalition].intel
    return
  }
  const context = resolveSpawnContext(draft, coalition)
  if (!context) return

  const sensors = sensorsFor(draft, coalition, context.theatre)
  const previous = draft.coalitions[coalition].intel ?? {}
  const next: Record<string, Contact> = {}
  const now = draft.time

  for (const unit of enemyUnits(draft, context.enemyCoalition)) {
    const source = detect(sensors, unit.position, unit.range)
    if (source) {
      next[unit.id] = { kind: unit.kind, position: { ...unit.position }, seenAt: now, source }
      continue
    }
    const known = previous[unit.id]
    if (!known || unit.kind === 'air') continue
    if (now.getTime() - known.seenAt.getTime() > INTEL_RETENTION_MS) continue
    next[unit.id] = known
  }
  draft.coalitions[coalition].intel = next
}

/** The enemy unit's sighting, or undefined when it has not been seen recently enough. */
export function enemyContact(
  campaign: Pick<Campaign, 'coalitions' | 'campaignParams' | 'time'>,
  coalition: Coalition,
  enemyId: string,
  maxAgeMs = INTEL_RETENTION_MS
) {
  const contact = campaign.coalitions[coalition].intel?.[enemyId]
  if (!contact) return undefined
  if (campaign.time.getTime() - contact.seenAt.getTime() > maxAgeMs) return undefined
  return contact
}

/** Whether the planners of `coalition` may task against this enemy unit. Always true without fog. */
export function isEnemyKnown(
  campaign: Pick<Campaign, 'coalitions' | 'campaignParams' | 'time'>,
  coalition: Coalition,
  enemyId: string,
  maxAgeMs = TARGET_INTEL_MAX_AGE_MS
) {
  if (!isFogOfWarEnabled(campaign)) return true
  return enemyContact(campaign, coalition, enemyId, maxAgeMs) != null
}
