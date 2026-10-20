import { schemas } from '@dcc/contracts'
import type * as z from 'zod'

import { calculateDistance } from '../utils/calculate-distance'
import { logCampaignAction } from '@/logic/simulation-log'

type Campaign = z.infer<typeof schemas.campaign.campaign>
type Coalition = z.infer<typeof schemas.coalition>
type Supply = z.infer<typeof schemas.supply>
type LogisticsRoute = NonNullable<Supply['logistics']>['routes'][number]
type SupplyConvoy = z.infer<typeof schemas.supplyConvoy>
type ConvoyCargo = SupplyConvoy['cargo']
type Theatre = z.infer<typeof schemas.theatre>
type Position = { x: number; y: number }

/** A hub sends one convoy per route this often; the cargo covers the whole interval. */
export const CONVOY_DISPATCH_INTERVAL_HOURS = 3
const MAX_CONVOYS_PER_ROUTE = 2
/** Average road speed including halts, in m/s (25 km/h). */
export const ROAD_CONVOY_SPEED_MS = 25_000 / 3_600
export const AIR_CONVOY_SPEED_MS = 55
/** A helicopter lift carries this share of a full road convoy. */
const AIR_CARGO_SHARE = 0.4
/** Routes disrupted at least this much go by air when the period has helicopters. */
const AIR_DISRUPTION_THRESHOLD = 0.6
const ROAD_CONVOY_VEHICLES = 3
/** How far from a town a hub or destination may be to join the road graph there. */
const ROAD_GRAPH_SNAP_METERS = 30_000
const ARRIVAL_METERS = 50
/** Road convoys form up this far down the road, outside the airfield, not on the runway. */
const HUB_CLEARANCE_METERS = 3_000
const HOUR_MS = 3_600_000

/** Helicopters only exist from the Vietnam stage on. */
export function hasSupplyHelicopters(era: Campaign['era'] | undefined) {
  return era !== 'WW2' && era !== 'Korea'
}

export function convoyCargoTotal(cargo: ConvoyCargo) {
  return cargo.supply + cargo.fuel + cargo.munitions + cargo.repair
}

function nearestOwnedNode(
  nodes: Map<string, Position>,
  position: Position,
  owned: ReadonlySet<string>
): string | null {
  let best: string | null = null
  let bestDistance = ROAD_GRAPH_SNAP_METERS
  for (const [name, nodePosition] of nodes) {
    if (!owned.has(name)) continue
    const distance = calculateDistance(nodePosition, position)
    if (distance <= bestDistance) {
      best = name
      bestDistance = distance
    }
  }
  return best
}

/**
 * The towns a road convoy drives through, over the theatre's road graph and only through towns its
 * own side holds. Falls back to a direct run (DCS still keeps the trucks on roads) when the theatre
 * has no graph or the endpoints are off it.
 */
export function buildRoadPath(
  theatre: Pick<Theatre, 'objectives' | 'connections'>,
  owned: ReadonlySet<string>,
  from: Position,
  to: Position,
  toId?: string
): Position[] {
  const direct = [from, to]
  const connections = theatre.connections ?? []
  if (connections.length === 0) return direct

  const nodes = new Map(theatre.objectives.map((objective) => [objective.name, objective.position]))
  const neighbours = new Map<string, string[]>()
  for (const connection of connections) {
    if (connection.mode !== 'road') continue
    if (!owned.has(connection.from) || !owned.has(connection.to)) continue
    neighbours.set(connection.from, [...(neighbours.get(connection.from) ?? []), connection.to])
    if (connection.bidirectional !== false) {
      neighbours.set(connection.to, [...(neighbours.get(connection.to) ?? []), connection.from])
    }
  }

  const start = nearestOwnedNode(nodes, from, owned)
  const end = toId && nodes.has(toId) && owned.has(toId) ? toId : nearestOwnedNode(nodes, to, owned)
  if (!start || !end) return direct

  // Dijkstra over a small graph.
  const distances = new Map<string, number>([[start, 0]])
  const previous = new Map<string, string>()
  const open = new Set([start])
  while (open.size > 0) {
    let current: string | null = null
    for (const name of open) {
      if (
        current == null ||
        (distances.get(name) ?? Infinity) < (distances.get(current) ?? Infinity)
      ) {
        current = name
      }
    }
    if (current == null || current === end) break
    open.delete(current)
    const currentPosition = nodes.get(current)
    if (!currentPosition) continue
    for (const next of neighbours.get(current) ?? []) {
      const nextPosition = nodes.get(next)
      if (!nextPosition) continue
      const candidate =
        (distances.get(current) ?? Infinity) + calculateDistance(currentPosition, nextPosition)
      if (candidate < (distances.get(next) ?? Infinity)) {
        distances.set(next, candidate)
        previous.set(next, current)
        open.add(next)
      }
    }
  }
  if (!distances.has(end)) return direct

  const towns: Position[] = []
  for (let name: string | undefined = end; name; name = previous.get(name)) {
    const position = nodes.get(name)
    if (position) towns.unshift(position)
  }
  const path = [from, ...towns, to].filter(
    (point, index, points) => index === 0 || calculateDistance(point, points[index - 1]!) > 1_000
  )
  return path.length >= 2 ? path : direct
}

function takeFromPool(pool: { current: number } | undefined, amount: number) {
  if (!pool || amount <= 0) return 0
  const taken = Math.min(amount, pool.current)
  pool.current -= taken
  return taken
}

function deliverToPool(pool: { current: number; max: number } | undefined, amount: number) {
  if (!pool || amount <= 0) return
  pool.current = Math.min(pool.max, pool.current + amount)
}

function cargoInTransitTo(draft: Campaign, coalition: Coalition, nodeId: string) {
  return (draft.coalitions[coalition].supplyConvoys ?? [])
    .filter((convoy) => convoy.to === nodeId)
    .reduce((sum, convoy) => sum + convoy.cargo.supply, 0)
}

/**
 * Loads a convoy at the hub for this route when one is due. The cargo leaves the hub at once and
 * reaches the destination only if the convoy arrives.
 */
export function dispatchConvoy(params: {
  draft: Campaign
  coalition: Coalition
  theatre: Pick<Theatre, 'objectives' | 'connections'>
  route: LogisticsRoute
  source: { id: string; supply: Supply; position: Position }
  destination: { id: string; supply: Supply; position: Position }
}) {
  const { draft, coalition, route, source, destination } = params
  if (route.nextDispatchAt && draft.time < route.nextDispatchAt) return null
  const convoys = (draft.coalitions[coalition].supplyConvoys ??= [])
  if (convoys.filter((convoy) => convoy.routeId === route.id).length >= MAX_CONVOYS_PER_ROUTE) {
    return null
  }
  route.nextDispatchAt = new Date(draft.time.getTime() + CONVOY_DISPATCH_INTERVAL_HOURS * HOUR_MS)

  const byAir = route.disruption >= AIR_DISRUPTION_THRESHOLD && hasSupplyHelicopters(draft.era)
  const load = byAir
    ? route.capacity * CONVOY_DISPATCH_INTERVAL_HOURS * AIR_CARGO_SHARE
    : route.capacity * (1 - route.disruption) * CONVOY_DISPATCH_INTERVAL_HOURS
  const room =
    destination.supply.max -
    destination.supply.current -
    cargoInTransitTo(draft, coalition, destination.id)
  const amount = Math.min(load, Math.max(0, room))
  if (amount < 1) return null

  // Same split the continuous transfer used: supply points plus fuel, munitions and repair pools.
  const cargo: ConvoyCargo = {
    supply: takeFromPool(source.supply, amount),
    fuel: takeFromPool(source.supply.fuel, amount * 0.45),
    munitions: takeFromPool(source.supply.munitions, amount * 0.35),
    repair: takeFromPool(source.supply.repair, amount * 0.2)
  }
  if (convoyCargoTotal(cargo) < 1) return null

  const owned = new Set([
    ...draft.coalitions[coalition].objectiveIds,
    ...draft.coalitions[coalition].airdromeNames
  ])
  const path = byAir
    ? [source.position, destination.position]
    : buildRoadPath(params.theatre, owned, source.position, destination.position, destination.id)
  const convoy: SupplyConvoy = {
    id: crypto.randomUUID(),
    kind: byAir ? 'air' : 'road',
    routeId: route.id,
    from: source.id,
    to: destination.id,
    path,
    nextPoint: 1,
    position: { ...path[0]! },
    cargo,
    vehicles: byAir ? 1 : ROAD_CONVOY_VEHICLES,
    departedAt: new Date(draft.time.getTime())
  }
  if (byAir) {
    // Lifts leaving the same hub together would start on the same spot in the air.
    const airborneFromHub = convoys.filter(
      (other) => other.kind === 'air' && other.from === source.id
    ).length
    advanceConvoy(convoy, 1_500 * (airborneFromHub + 1))
  } else {
    const length = path
      .slice(1)
      .reduce((sum, point, index) => sum + calculateDistance(path[index]!, point), 0)
    advanceConvoy(convoy, Math.min(HUB_CLEARANCE_METERS, length / 3))
  }
  convoys.push(convoy)
  return convoy
}

/** Moves a convoy along its path; returns true once it has reached the end. */
export function advanceConvoy(convoy: SupplyConvoy, meters: number) {
  let remaining = meters
  while (remaining > 0 && convoy.nextPoint < convoy.path.length) {
    const target = convoy.path[convoy.nextPoint]!
    const distance = calculateDistance(convoy.position, target)
    if (distance <= remaining) {
      convoy.position = { ...target }
      remaining -= distance
      convoy.nextPoint += 1
    } else {
      const fraction = remaining / distance
      convoy.position = {
        x: convoy.position.x + (target.x - convoy.position.x) * fraction,
        y: convoy.position.y + (target.y - convoy.position.y) * fraction
      }
      remaining = 0
    }
  }
  const end = convoy.path.at(-1)!
  return (
    convoy.nextPoint >= convoy.path.length ||
    calculateDistance(convoy.position, end) <= ARRIVAL_METERS
  )
}

export function convoySpeed(convoy: Pick<SupplyConvoy, 'kind'>) {
  return convoy.kind === 'air' ? AIR_CONVOY_SPEED_MS : ROAD_CONVOY_SPEED_MS
}

/** Remaining distance and time to the destination. */
export function convoyEta(convoy: SupplyConvoy) {
  let meters = 0
  let from = convoy.position
  for (let index = convoy.nextPoint; index < convoy.path.length; index += 1) {
    const point = convoy.path[index]!
    meters += calculateDistance(from, point)
    from = point
  }
  return { meters, seconds: meters / convoySpeed(convoy) }
}

function deliver(draft: Campaign, coalition: Coalition, convoy: SupplyConvoy) {
  const destination = draft.coalitions[coalition].supplyNodes?.[convoy.to]
  if (!destination) {
    logCampaignAction(
      draft,
      coalition,
      `Supply convoy for ${convoy.to} found the town lost and its cargo was abandoned`
    )
    return
  }
  destination.current = Math.min(destination.max, destination.current + convoy.cargo.supply)
  deliverToPool(destination.fuel, convoy.cargo.fuel)
  deliverToPool(destination.munitions, convoy.cargo.munitions)
  deliverToPool(destination.repair, convoy.cargo.repair)
}

/** Advances every convoy of a coalition by `seconds` of campaign time and unloads the arrivals. */
export function moveConvoys(
  draft: Campaign,
  coalition: Coalition,
  seconds: number,
  /** Convoys alive in a running DCS mission: DCS drives them, the campaign must not. */
  frozenConvoyIds?: ReadonlySet<string>
) {
  const convoys = draft.coalitions[coalition].supplyConvoys
  if (!convoys || convoys.length === 0 || seconds < 0) return
  const arrived = new Set<string>()
  for (const convoy of convoys) {
    if (frozenConvoyIds?.has(convoy.id)) continue
    if (advanceConvoy(convoy, convoySpeed(convoy) * seconds)) {
      deliver(draft, coalition, convoy)
      arrived.add(convoy.id)
    }
  }
  if (arrived.size > 0) {
    draft.coalitions[coalition].supplyConvoys = convoys.filter((convoy) => !arrived.has(convoy.id))
  }
}

/**
 * Puts a convoy reported by DCS back on its path: the reported position, and the next point after
 * the path segment it is closest to.
 */
export function placeConvoyAt(convoy: SupplyConvoy, position: Position) {
  let bestSegment = convoy.nextPoint - 1
  let bestDistance = Infinity
  for (let index = Math.max(0, convoy.nextPoint - 1); index < convoy.path.length - 1; index += 1) {
    const start = convoy.path[index]!
    const end = convoy.path[index + 1]!
    const dx = end.x - start.x
    const dy = end.y - start.y
    const lengthSquared = dx * dx + dy * dy
    const t =
      lengthSquared === 0
        ? 0
        : Math.max(
            0,
            Math.min(1, ((position.x - start.x) * dx + (position.y - start.y) * dy) / lengthSquared)
          )
    const distance = calculateDistance(position, { x: start.x + dx * t, y: start.y + dy * t })
    if (distance < bestDistance) {
      bestDistance = distance
      bestSegment = index
    }
  }
  convoy.position = { x: position.x, y: position.y }
  convoy.nextPoint = Math.max(1, bestSegment + 1)
}
