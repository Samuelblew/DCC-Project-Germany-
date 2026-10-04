import { resolveGermanyIadsSiteForEra } from './iads-eras'
import { germanyIadsSites } from './iads-network'

export const GERMANY_IADS_THEATRE = 'Cold War Germany'
export const GERMANY_IADS_DEFENSE_RADIUS_METERS = 100_000
export const GERMANY_IADS_AIRBASE_RADIUS_METERS = 6_000
export const GERMANY_IADS_BATTLE_RADIUS_METERS = 120_000

export type GermanyIadsKind = 'sam' | 'ewr' | 'hq' | 'aaa' | 'support' | 'airbase'

export type GermanyIadsUnit = {
  name: string
  type: string
  x: number
  y: number
  heading: number
  category?: string
}

export type GermanyIadsSite = {
  id: string
  kind: GermanyIadsKind
  coalition: 'player' | 'opponent'
  objectiveId: string
  x: number
  y: number
  range?: number
  campaignType?: 'Hawk' | 'Roland' | 'SA-2' | 'SA-3' | 'SA-5' | 'SA-6' | 'SA-10-300'
  units: GermanyIadsUnit[]
}

const defenseKinds = new Set<GermanyIadsKind>(['sam', 'ewr', 'hq', 'aaa', 'support'])

export function isGermanyIadsTheatre(theatreName: string) {
  return theatreName === GERMANY_IADS_THEATRE
}

export function getGermanyIadsSites(era?: string) {
  return germanyIadsSites.flatMap((site) => {
    const resolved = resolveGermanyIadsSiteForEra(site, era)
    return resolved ? [resolved] : []
  })
}

export function findGermanyIadsSite(id: string) {
  return germanyIadsSites.find((site) => site.id === id)
}

const SKYNET_SAM_PREFIX = 'SAM-'

export function germanyIadsSamGroupName(
  site: Pick<GermanyIadsSite, 'id'>,
  controllingCoalition: 'player' | 'opponent'
) {
  const hasSkynetPrefix = site.id.startsWith(SKYNET_SAM_PREFIX)
  if (controllingCoalition === 'opponent') {
    return hasSkynetPrefix ? site.id : `${SKYNET_SAM_PREFIX}${site.id}`
  }
  return hasSkynetPrefix ? `PLAYER-${site.id}` : site.id
}

export function isGermanyIadsSamDestroyed(
  site: Pick<GermanyIadsSite, 'id' | 'kind' | 'units'>,
  deadUnits: Readonly<Record<string, readonly string[]>> | undefined
) {
  if (site.kind !== 'sam' || site.units.length === 0) return false
  const dead = new Set(deadUnits?.[site.id] ?? [])
  return site.units.every((unit) => dead.has(unit.name))
}

export function livingGermanyIadsSite<T extends GermanyIadsSite>(
  site: T,
  deadUnits: Readonly<Record<string, readonly string[]>> | undefined
): T | null {
  if (site.kind !== 'sam') return site
  const dead = new Set(deadUnits?.[site.id] ?? [])
  if (dead.size === 0) return site
  const units = site.units.filter((unit) => !dead.has(unit.name))
  if (units.length === 0) return null
  if (units.length === site.units.length) return site
  return { ...site, units }
}

export type GermanyIadsOwner = {
  x: number
  y: number
  coalition: 'player' | 'opponent'
}

export function germanyIadsOwnersFromObjectives(
  objectives: Array<{ name: string; position: { x: number; y: number } }>,
  playerObjectiveIds: readonly string[],
  opponentObjectiveIds: readonly string[]
): GermanyIadsOwner[] {
  const positions = new Map(objectives.map((objective) => [objective.name, objective.position]))
  const owners: GermanyIadsOwner[] = []

  for (const objectiveId of playerObjectiveIds) {
    const position = positions.get(objectiveId)
    if (position) owners.push({ x: position.x, y: position.y, coalition: 'player' })
  }
  for (const objectiveId of opponentObjectiveIds) {
    const position = positions.get(objectiveId)
    if (position) owners.push({ x: position.x, y: position.y, coalition: 'opponent' })
  }

  return owners
}

export function germanyIadsControllingCoalition(
  site: { x: number; y: number; coalition: 'player' | 'opponent' },
  owners: readonly GermanyIadsOwner[]
): 'player' | 'opponent' {
  let controlling = site.coalition
  let nearest = Number.POSITIVE_INFINITY

  for (const owner of owners) {
    const distance = Math.hypot(owner.x - site.x, owner.y - site.y)
    if (distance < nearest) {
      nearest = distance
      controlling = owner.coalition
    }
  }

  return controlling
}

function withinRadius(
  site: GermanyIadsSite,
  anchors: Array<{ x: number; y: number }>,
  radius: number
) {
  return anchors.some((anchor) => Math.hypot(anchor.x - site.x, anchor.y - site.y) <= radius)
}

export function selectGermanyIadsForMission(
  defenseAnchors: Array<{ x: number; y: number }>,
  airbaseAnchors: Array<{ x: number; y: number }>,
  era?: string,
  defenseRadiusMeters = GERMANY_IADS_DEFENSE_RADIUS_METERS
) {
  if (defenseAnchors.length === 0 && airbaseAnchors.length === 0) return []

  return getGermanyIadsSites(era).filter((site) => {
    if (site.kind === 'airbase') {
      return withinRadius(site, airbaseAnchors, GERMANY_IADS_AIRBASE_RADIUS_METERS)
    }
    if (!defenseKinds.has(site.kind)) return false
    return withinRadius(site, defenseAnchors, defenseRadiusMeters)
  })
}

export function selectGermanyIadsBattleSites(
  coalition: 'player' | 'opponent',
  objectives: Array<{ x: number; y: number }>,
  era?: string,
  owners: readonly GermanyIadsOwner[] = []
) {
  return getGermanyIadsSites(era).filter((site) => {
    if (germanyIadsControllingCoalition(site, owners) !== coalition) return false
    if (site.kind !== 'sam' && site.kind !== 'ewr') return false
    return withinRadius(site, objectives, GERMANY_IADS_BATTLE_RADIUS_METERS)
  })
}
