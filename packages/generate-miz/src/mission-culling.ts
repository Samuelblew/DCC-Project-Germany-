import {
  longRangeSamMinRangeMeters,
  resolveAircraftCullingRadiusMeters,
  resolveCullingRadiusMeters,
  resolveSamCullingRadiusMeters,
  schemas,
  shortRangeAirDefenseReachMeters
} from '@dcc/contracts'
import * as z from 'zod'

type Campaign = z.infer<typeof schemas.campaign.campaign>
type Theatre = z.infer<typeof schemas.theatre>
type Coalition = z.infer<typeof schemas.coalition>
type CampaignCoalition = Campaign['coalitions'][Coalition]
type GroundGroup = CampaignCoalition['groundGroups'][number]
type Structure = CampaignCoalition['structures'][number]
type Position = z.infer<typeof schemas.position>

export type EmittedGroundGroupCullingMode = 'full' | 'antiAirOnly'
export type GroundGroupCullingMode = EmittedGroundGroupCullingMode | 'omit'

export type MissionCullingManifest = {
  groundGroups: Record<Coalition, Record<string, EmittedGroundGroupCullingMode>>
  structures: Record<Coalition, Record<string, boolean>>
}

export type MissionCullingPlan = {
  enabled: boolean
  manifest: MissionCullingManifest
  getGroundGroupMode: (coalition: Coalition, group: GroundGroup) => GroundGroupCullingMode
  getStructureMode: (coalition: Coalition, structure: Structure) => 'full' | 'omit'
  /**
   * Long-range SAMs (range >= longRangeSamMinRangeMeters) use the SAM band, shorter-range air
   * defence the ground band; the player's direct target always stays.
   */
  getSamMode: (
    samId: string,
    position: Position,
    rangeMeters: number | undefined
  ) => 'full' | 'omit'
  recordGroundGroup: (
    coalition: Coalition,
    groupId: string,
    mode: EmittedGroundGroupCullingMode
  ) => void
  recordStructure: (coalition: Coalition, structureId: string) => void
}

export function isAirDefenseUnit(unitName: string, coalition: CampaignCoalition) {
  const airDefenseTypes = new Set([
    ...coalition.groundUnitTypes.SAM,
    ...coalition.groundUnitTypes['Shorad Vehicle'],
    ...coalition.groundUnitTypes['Shorad Infantry']
  ])

  return (
    airDefenseTypes.has(unitName) ||
    /\b(aaa|sam|shorad|stinger|igla|linebacker|shilka|osa|tunguska|tor)\b/i.test(unitName)
  )
}

function distance(a: Position, b: Position) {
  return Math.hypot(a.x - b.x, a.y - b.y)
}

function distanceToSegment(point: Position, start: Position, end: Position) {
  const dx = end.x - start.x
  const dy = end.y - start.y
  const lengthSquared = dx * dx + dy * dy
  if (lengthSquared === 0) return distance(point, start)
  const t = Math.max(
    0,
    Math.min(1, ((point.x - start.x) * dx + (point.y - start.y) * dy) / lengthSquared)
  )
  return distance(point, { x: start.x + t * dx, y: start.y + t * dy })
}

function cross(origin: Position, a: Position, b: Position) {
  return (a.x - origin.x) * (b.y - origin.y) - (a.y - origin.y) * (b.x - origin.x)
}

/**
 * The area a route covers: its convex hull, counter-clockwise. Player routes usually leave and return
 * to the same base, so a corridor along the line alone would leave the middle of the loop empty.
 */
function routeArea(route: Position[]): Position[] {
  const points = [...route]
    .sort((a, b) => a.x - b.x || a.y - b.y)
    .filter((point, index, sorted) => {
      const previous = sorted[index - 1]
      return !previous || previous.x !== point.x || previous.y !== point.y
    })
  if (points.length <= 2) return points
  const lower: Position[] = []
  for (const point of points) {
    while (lower.length >= 2 && cross(lower.at(-2)!, lower.at(-1)!, point) <= 0) lower.pop()
    lower.push(point)
  }
  const upper: Position[] = []
  for (const point of [...points].reverse()) {
    while (upper.length >= 2 && cross(upper.at(-2)!, upper.at(-1)!, point) <= 0) upper.pop()
    upper.push(point)
  }
  return [...lower.slice(0, -1), ...upper.slice(0, -1)]
}

function areaEdges(area: Position[]): Array<[Position, Position]> {
  if (area.length < 2) return []
  if (area.length === 2) return [[area[0]!, area[1]!]]
  return area.map((point, index) => [point, area[(index + 1) % area.length]!])
}

function isInsideArea(point: Position, area: Position[]) {
  return area.length >= 3 && areaEdges(area).every(([start, end]) => cross(start, end, point) >= 0)
}

function distanceToArea(point: Position, area: Position[]) {
  if (area.length === 0) return Number.POSITIVE_INFINITY
  if (area.length === 1) return distance(point, area[0]!)
  if (isInsideArea(point, area)) return 0
  return Math.min(...areaEdges(area).map(([start, end]) => distanceToSegment(point, start, end)))
}

function segmentsIntersect(a: Position, b: Position, c: Position, d: Position) {
  const d1 = cross(c, d, a)
  const d2 = cross(c, d, b)
  const d3 = cross(a, b, c)
  const d4 = cross(a, b, d)
  return ((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) && ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0))
}

function segmentDistanceToArea(start: Position, end: Position, area: Position[]) {
  const endpointDistance = Math.min(distanceToArea(start, area), distanceToArea(end, area))
  if (endpointDistance === 0) return 0
  // A leg can cross the area with both ends outside it.
  if (areaEdges(area).some(([a, b]) => segmentsIntersect(start, end, a, b))) return 0
  return Math.min(endpointDistance, ...area.map((point) => distanceToSegment(point, start, end)))
}

function routeDistanceToArea(route: Position[], area: Position[]) {
  if (route.length === 0) return Number.POSITIVE_INFINITY
  if (route.length === 1) return distanceToArea(route[0]!, area)
  let best = Number.POSITIVE_INFINITY
  for (let index = 0; index < route.length - 1; index += 1) {
    best = Math.min(best, segmentDistanceToArea(route[index]!, route[index + 1]!, area))
  }
  return best
}

/** Whether a position lies within `radius` of the area any player route covers. */
export function isNearAnyRoute(position: Position, routes: Position[][], radius: number) {
  return routes.some((route) => distanceToArea(position, routeArea(route)) <= radius)
}

function isRouteNearAnyRoute(route: Position[], routes: Position[][], radius: number) {
  return routes.some((playerRoute) => routeDistanceToArea(route, routeArea(playerRoute)) <= radius)
}

type CullableFlight = CampaignCoalition['flightGroups'][number]

function flightRoute(flight: CullableFlight, coalition: CampaignCoalition, theatre: Theatre) {
  const route: Position[] = [flight.position]
  const homeStructure = coalition.structures.find((structure) => structure.id === flight.homeBase)
  const home = homeStructure?.position ?? findAirdromePosition(theatre, flight.homeBase)
  if (home) route.push(home)
  for (const waypoint of flight.flightplan.waypoints) route.push(waypoint.position)
  return route
}

export function selectFlightIdsForMission(
  campaign: Campaign,
  theatre: Theatre
): Set<string> | null {
  if (campaign.campaignParams?.culling !== true) return null
  const routes = playerMissionRoutes(campaign, theatre)
  if (routes.length === 0) return null

  const radius = resolveAircraftCullingRadiusMeters(campaign.campaignParams?.cullingAircraftRadius)
  const selected = new Set<string>()

  for (const key of ['player', 'opponent'] as const) {
    const coalition = campaign.coalitions[key]
    for (const flight of coalition.flightGroups) {
      if (
        flight.aircrafts.some((aircraft) => aircraft.client) ||
        isRouteNearAnyRoute(flightRoute(flight, coalition, theatre), routes, radius)
      ) {
        selected.add(flight.id)
      }
    }

    for (const missionPackage of coalition.packages) {
      if (!missionPackage.members.some((member) => selected.has(member.flightGroupId))) continue
      for (const member of missionPackage.members) selected.add(member.flightGroupId)
    }
  }

  return selected
}

export function playerMissionRoutes(campaign: Campaign, theatre: Theatre) {
  const routes: Position[][] = []
  const coalition = campaign.coalitions.player
  for (const flight of coalition.flightGroups) {
    if (!flight.aircrafts.some((aircraft) => aircraft.client)) continue
    const route: Position[] = []
    const homeStructure = coalition.structures.find((structure) => structure.id === flight.homeBase)
    const home = homeStructure?.position ?? findAirdromePosition(theatre, flight.homeBase)
    if (home) route.push(home)
    for (const waypoint of flight.flightplan.waypoints) route.push(waypoint.position)
    if (route.length > 0) routes.push(route)
  }
  return routes
}

function findAirdromePosition(theatre: Theatre, airdromeName?: string): Position | undefined {
  if (!airdromeName) return undefined
  const airdrome = theatre.airdromeDetails[airdromeName]
  return airdrome ? { x: airdrome.x, y: airdrome.y } : undefined
}

function hasAirDefenseUnits(group: GroundGroup, coalition: CampaignCoalition) {
  return group.units.some((unit) => unit.count > 0 && isAirDefenseUnit(unit.name, coalition))
}

function createEmptyManifest(): MissionCullingManifest {
  return {
    groundGroups: { player: {}, opponent: {} },
    structures: { player: {}, opponent: {} }
  }
}

export function buildMissionCullingPlan(campaign: Campaign, theatre: Theatre): MissionCullingPlan {
  const enabled = campaign.campaignParams?.culling === true
  const radius = resolveCullingRadiusMeters(campaign.campaignParams?.cullingRadius)
  const samRadius = resolveSamCullingRadiusMeters(campaign.campaignParams?.cullingSamRadius)
  const routes = enabled ? playerMissionRoutes(campaign, theatre) : []
  const directTargetIds = new Set<string>()

  if (enabled) {
    // Every flight that makes it into the mission needs its target there too, or AI packages fly
    // off to attack something that was culled.
    const selectedFlightIds = selectFlightIdsForMission(campaign, theatre)
    for (const key of ['player', 'opponent'] as const) {
      for (const flight of campaign.coalitions[key].flightGroups) {
        if (!flight.target) continue
        const flown = flight.aircrafts.some((aircraft) => aircraft.client)
        if (flight.careerMission && !flown) continue
        if ((key === 'player' && flown) || selectedFlightIds?.has(flight.id)) {
          directTargetIds.add(flight.target.id)
        }
      }
    }
  }

  const includeAll = !enabled || routes.length === 0
  const manifest = createEmptyManifest()

  return {
    enabled,
    manifest,
    getGroundGroupMode: (coalition, group) => {
      if (includeAll) return 'full'
      if (directTargetIds.has(group.id)) return 'full'
      if (isNearAnyRoute(group.position, routes, radius)) return 'full'
      // Air defence just past the band can still reach the route; farther out it only costs frames.
      if (
        hasAirDefenseUnits(group, campaign.coalitions[coalition]) &&
        isNearAnyRoute(group.position, routes, radius + shortRangeAirDefenseReachMeters)
      ) {
        return 'antiAirOnly'
      }
      return 'omit'
    },
    getSamMode: (samId, position, rangeMeters) => {
      if (includeAll) return 'full'
      if (directTargetIds.has(samId)) return 'full'
      const band = (rangeMeters ?? 0) >= longRangeSamMinRangeMeters ? samRadius : radius
      return isNearAnyRoute(position, routes, band) ? 'full' : 'omit'
    },
    getStructureMode: (_coalition, structure) => {
      if (includeAll) return 'full'
      if (directTargetIds.has(structure.id)) return 'full'
      return isNearAnyRoute(structure.position, routes, radius) ? 'full' : 'omit'
    },
    recordGroundGroup: (coalition, groupId, mode) => {
      manifest.groundGroups[coalition][groupId] = mode
    },
    recordStructure: (coalition, structureId) => {
      manifest.structures[coalition][structureId] = true
    }
  }
}
