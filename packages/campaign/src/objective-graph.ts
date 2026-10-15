import { schemas } from '@dcc/contracts'
import type * as z from 'zod'

type Position = z.infer<typeof schemas.position>
type Theatre = z.infer<typeof schemas.theatre>

export type AdjacentHostileTarget = {
  type: 'objective' | 'airdrome'
  name: string
}

export function theatreHasLandGraph(theatre: Theatre) {
  return (theatre.connections ?? []).some((connection) => connection.mode !== 'sea')
}

export function hopKey(left: string, right: string) {
  return left < right ? `${left}|${right}` : `${right}|${left}`
}

export function landNeighbors(
  theatre: Theatre,
  objectiveId: string,
  closedHops?: ReadonlySet<string>
) {
  const result: Array<{ objectiveId: string; waypoints: Position[] }> = []
  for (const connection of theatre.connections ?? []) {
    if (connection.mode === 'sea') continue
    if (connection.from === objectiveId) {
      if (closedHops?.has(hopKey(objectiveId, connection.to))) continue
      result.push({ objectiveId: connection.to, waypoints: connection.waypoints })
    }
    if (connection.bidirectional && connection.to === objectiveId) {
      if (closedHops?.has(hopKey(objectiveId, connection.from))) continue
      result.push({
        objectiveId: connection.from,
        waypoints: [...connection.waypoints].reverse()
      })
    }
  }
  return result
}

function classifyHostile(
  name: string,
  enemyObjectiveIds: ReadonlySet<string>,
  enemyAirdromeNames: ReadonlySet<string>
): AdjacentHostileTarget['type'] | undefined {
  if (enemyAirdromeNames.has(name)) return 'airdrome'
  if (enemyObjectiveIds.has(name)) return 'objective'
  return undefined
}

/** Next hop only. Columns do not skip owned towns or jump the graph. */
export function findAdjacentHostileTarget(params: {
  theatre: Theatre
  fromObjectiveId: string
  enemyObjectiveIds: Iterable<string>
  enemyAirdromeNames: Iterable<string>
  reservedNames?: ReadonlySet<string>
  /** Smashed hops stay legal if they are the only adjacent enemy; otherwise traffic goes around. */
  deprioritizedNames?: ReadonlySet<string>
  /** Cut roads are not a hop until the cut expires. */
  closedHops?: ReadonlySet<string>
}): AdjacentHostileTarget | undefined {
  const enemyObjectives = new Set(params.enemyObjectiveIds)
  const enemyAirdromes = new Set(params.enemyAirdromeNames)
  const reserved = params.reservedNames ?? new Set<string>()
  const deprioritized = params.deprioritizedNames ?? new Set<string>()
  const hops: AdjacentHostileTarget[] = []

  for (const neighbor of landNeighbors(params.theatre, params.fromObjectiveId, params.closedHops)) {
    if (reserved.has(neighbor.objectiveId)) continue
    const type = classifyHostile(neighbor.objectiveId, enemyObjectives, enemyAirdromes)
    if (!type) continue
    hops.push({ type, name: neighbor.objectiveId })
  }

  return hops.find((hop) => !deprioritized.has(hop.name)) ?? hops[0]
}

export type FlotStation = {
  id: string
  friendlyObjectiveId: string
  hostileObjectiveId: string
  friendlyPosition: Position
  hostilePosition: Position
  waypoints: Position[]
}

function namedPosition(theatre: Theatre, id: string): Position | undefined {
  const objective = theatre.objectives.find((entry) => entry.name === id)
  if (objective) return objective.position
  const airfield = theatre.airdromeDetails[id]
  if (airfield) return { x: airfield.x, y: airfield.y }
  return undefined
}

function lerpPosition(from: Position, to: Position, t: number): Position {
  return {
    x: from.x + (to.x - from.x) * t,
    y: from.y + (to.y - from.y) * t
  }
}

function interpolatePath(points: Position[], t: number): Position {
  const first = points[0]
  if (!first) return { x: 0, y: 0 }
  if (points.length === 1) return first

  const clamped = Math.min(1, Math.max(0, t))
  const lengths: number[] = []
  let total = 0
  for (let index = 0; index < points.length - 1; index += 1) {
    const start = points[index]!
    const end = points[index + 1]!
    const length = Math.hypot(end.x - start.x, end.y - start.y)
    lengths.push(length)
    total += length
  }
  if (total === 0) return first

  let remaining = clamped * total
  for (let index = 0; index < lengths.length; index += 1) {
    const length = lengths[index]!
    const start = points[index]!
    const end = points[index + 1]!
    if (remaining <= length) {
      return lerpPosition(start, end, length === 0 ? 0 : remaining / length)
    }
    remaining -= length
  }

  return points[points.length - 1] ?? first
}

function ownedBy(
  id: string,
  objectiveIds: ReadonlySet<string>,
  airdromeNames: ReadonlySet<string>
) {
  return objectiveIds.has(id) || airdromeNames.has(id)
}

/** Contact edges: one end friendly, the other hostile. BARCAP sits on these. */
export function findFlotStations(params: {
  theatre: Theatre
  friendlyObjectiveIds: Iterable<string>
  friendlyAirdromeNames: Iterable<string>
  enemyObjectiveIds: Iterable<string>
  enemyAirdromeNames: Iterable<string>
}): FlotStation[] {
  const friendlyObjectives = new Set(params.friendlyObjectiveIds)
  const friendlyAirdromes = new Set(params.friendlyAirdromeNames)
  const enemyObjectives = new Set(params.enemyObjectiveIds)
  const enemyAirdromes = new Set(params.enemyAirdromeNames)
  const stations: FlotStation[] = []

  const pushStation = (friendlyId: string, hostileId: string, waypoints: Position[]) => {
    const friendlyPosition = namedPosition(params.theatre, friendlyId)
    const hostilePosition = namedPosition(params.theatre, hostileId)
    if (!friendlyPosition || !hostilePosition) return
    stations.push({
      id: `${friendlyId}>${hostileId}`,
      friendlyObjectiveId: friendlyId,
      hostileObjectiveId: hostileId,
      friendlyPosition,
      hostilePosition,
      waypoints
    })
  }

  for (const connection of params.theatre.connections ?? []) {
    if (connection.mode === 'sea') continue
    const fromFriendly = ownedBy(connection.from, friendlyObjectives, friendlyAirdromes)
    const toFriendly = ownedBy(connection.to, friendlyObjectives, friendlyAirdromes)
    const fromHostile = ownedBy(connection.from, enemyObjectives, enemyAirdromes)
    const toHostile = ownedBy(connection.to, enemyObjectives, enemyAirdromes)

    if (fromFriendly && toHostile) {
      pushStation(connection.from, connection.to, connection.waypoints)
    } else if (toFriendly && fromHostile) {
      pushStation(connection.to, connection.from, [...connection.waypoints].reverse())
    }
  }

  return stations
}

/** 0 sits on the friendly town, 1 on the hostile town. */
export function flotPatrolPosition(station: FlotStation, depth: number): Position {
  return interpolatePath(
    [station.friendlyPosition, ...station.waypoints, station.hostilePosition],
    depth
  )
}

export function flotTouchesObjective(stations: FlotStation[], objectiveId: string | undefined) {
  if (!objectiveId) return false
  return stations.some(
    (station) =>
      station.friendlyObjectiveId === objectiveId || station.hostileObjectiveId === objectiveId
  )
}
