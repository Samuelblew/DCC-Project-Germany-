import { caucasusIadsNetwork } from '../theatres/caucasus-cold-war/iads'
import { germanyIadsNetwork } from '../theatres/germany-cold-war/iads'
import { resolveAuthoredIadsSiteForEra } from './eras'
import type {
  AuthoredIadsKind,
  AuthoredIadsNetwork,
  AuthoredIadsOwner,
  AuthoredIadsSite
} from './types'

export const AUTHORED_IADS_DEFENSE_RADIUS_METERS = 100_000
export const AUTHORED_IADS_AIRBASE_RADIUS_METERS = 6_000
export const AUTHORED_IADS_BATTLE_RADIUS_METERS = 120_000

const networks: readonly AuthoredIadsNetwork[] = [germanyIadsNetwork, caucasusIadsNetwork]

const defenseKinds = new Set<AuthoredIadsKind>(['sam', 'ewr', 'hq', 'aaa', 'support'])

function networkFor(theatreName: string) {
  return networks.find((network) => network.theatreName === theatreName)
}

/** True when the theatre carries an imported IADS template instead of generated SAM groups. */
export function hasAuthoredIads(theatreName: string) {
  return networkFor(theatreName) != null
}

/** Authored sites of one theatre as imported, before any era is applied. */
export function authoredIadsSitesForTheatre(theatreName: string): readonly AuthoredIadsSite[] {
  return networkFor(theatreName)?.sites ?? []
}

/**
 * The Sentry import kept DCS clone groups (`Static Mi-8MTV2-1` and `Static Mi-8MTV2-1-1`) on the
 * same parking spot. Keep the first, drop the rest, so Vietnam-on missions do not stack aircraft.
 */
function coincidentAirbaseKey(site: AuthoredIadsSite) {
  const unit = site.units[0]
  const type = unit?.type ?? site.id
  const x = Math.round((unit?.x ?? site.x) * 1000)
  const y = Math.round((unit?.y ?? site.y) * 1000)
  return `${type}:${x}:${y}`
}

function dropCoincidentAirbaseClones(sites: AuthoredIadsSite[]) {
  const occupied = new Set<string>()
  return sites.filter((site) => {
    if (site.kind !== 'airbase') return true
    const key = coincidentAirbaseKey(site)
    if (occupied.has(key)) return false
    occupied.add(key)
    return true
  })
}

export function getAuthoredIadsSites(theatreName: string, era?: string) {
  const resolved = authoredIadsSitesForTheatre(theatreName).flatMap((site) => {
    const resolvedSite = resolveAuthoredIadsSiteForEra(site, era)
    return resolvedSite ? [resolvedSite] : []
  })
  return dropCoincidentAirbaseClones(resolved)
}

/** Site ids are unique across every network, so a target id alone finds its site. */
export function findAuthoredIadsSite(id: string) {
  for (const network of networks) {
    const site = network.sites.find((candidate) => candidate.id === id)
    if (site) return site
  }
  return undefined
}

const SKYNET_SAM_PREFIX = 'SAM-'

export function authoredIadsSamGroupName(
  site: Pick<AuthoredIadsSite, 'id'>,
  controllingCoalition: 'player' | 'opponent'
) {
  const hasSkynetPrefix = site.id.startsWith(SKYNET_SAM_PREFIX)
  if (controllingCoalition === 'opponent') {
    return hasSkynetPrefix ? site.id : `${SKYNET_SAM_PREFIX}${site.id}`
  }
  return hasSkynetPrefix ? `PLAYER-${site.id}` : site.id
}

export function isAuthoredIadsSamDestroyed(
  site: Pick<AuthoredIadsSite, 'id' | 'kind' | 'units'>,
  deadUnits: Readonly<Record<string, readonly string[]>> | undefined
) {
  if (site.kind !== 'sam' || site.units.length === 0) return false
  const dead = new Set(deadUnits?.[site.id] ?? [])
  return site.units.every((unit) => dead.has(unit.name))
}

export function livingAuthoredIadsSite<T extends AuthoredIadsSite>(
  site: T,
  deadUnits: Readonly<Record<string, readonly string[]>> | undefined
): T | null {
  if (site.kind !== 'sam' && site.kind !== 'ewr') return site
  const dead = new Set(deadUnits?.[site.id] ?? [])
  if (dead.size === 0) return site
  const units = site.units.filter((unit) => !dead.has(unit.name))
  if (units.length === 0) return null
  if (units.length === site.units.length) return site
  return { ...site, units }
}

export function iadsOwnersFromObjectives(
  objectives: Array<{ name: string; position: { x: number; y: number } }>,
  playerObjectiveIds: readonly string[],
  opponentObjectiveIds: readonly string[]
): AuthoredIadsOwner[] {
  const positions = new Map(objectives.map((objective) => [objective.name, objective.position]))
  const owners: AuthoredIadsOwner[] = []

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

export function iadsControllingCoalition(
  site: { x: number; y: number; coalition: 'player' | 'opponent' },
  owners: readonly AuthoredIadsOwner[]
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

/**
 * Parked aircraft belong to the side that based them there. A captured field loses them; it does
 * not hand Soviet MiGs to NATO. Air defence sites do follow the objective owner.
 */
export function authoredSiteFieldedBy(
  site: Pick<AuthoredIadsSite, 'kind' | 'coalition'>,
  controllingCoalition: 'player' | 'opponent'
) {
  return site.kind !== 'airbase' || site.coalition === controllingCoalition
}

function withinRadius(
  site: AuthoredIadsSite,
  anchors: Array<{ x: number; y: number }>,
  radius: number
) {
  return anchors.some((anchor) => Math.hypot(anchor.x - site.x, anchor.y - site.y) <= radius)
}

export function selectAuthoredIadsForMission(
  theatreName: string,
  defenseAnchors: Array<{ x: number; y: number }>,
  airbaseAnchors: Array<{ x: number; y: number }>,
  era?: string,
  defenseRadiusMeters = AUTHORED_IADS_DEFENSE_RADIUS_METERS
) {
  if (defenseAnchors.length === 0 && airbaseAnchors.length === 0) return []

  return getAuthoredIadsSites(theatreName, era).filter((site) => {
    if (site.kind === 'airbase') {
      return withinRadius(site, airbaseAnchors, AUTHORED_IADS_AIRBASE_RADIUS_METERS)
    }
    if (!defenseKinds.has(site.kind)) return false
    return withinRadius(site, defenseAnchors, defenseRadiusMeters)
  })
}

export function selectAuthoredIadsBattleSites(
  theatreName: string,
  coalition: 'player' | 'opponent',
  objectives: Array<{ x: number; y: number }>,
  era?: string,
  owners: readonly AuthoredIadsOwner[] = []
) {
  return getAuthoredIadsSites(theatreName, era).filter((site) => {
    if (iadsControllingCoalition(site, owners) !== coalition) return false
    if (site.kind !== 'sam' && site.kind !== 'ewr') return false
    return withinRadius(site, objectives, AUTHORED_IADS_BATTLE_RADIUS_METERS)
  })
}
