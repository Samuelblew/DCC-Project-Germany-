import { schemas } from '@dcc/contracts'
import { isSamOperational, scenarios, theatres } from '@dcc/data'
import type * as z from 'zod'

import { calculateDistance } from '../utils/calculate-distance'
import { logisticsInterdictionAt } from './logistics-interdiction'

type Campaign = z.infer<typeof schemas.campaign.campaign>
type Coalition = z.infer<typeof schemas.coalition>
type Supply = z.infer<typeof schemas.supply>
type SupplyPool = NonNullable<Supply['fuel']>
type LogisticsRoute = NonNullable<Supply['logistics']>['routes'][number]
type Position = z.infer<typeof schemas.position>
type FlightTask = z.infer<typeof schemas.flightGroup>['task']
type Theatre = z.infer<typeof schemas.theatre>

const DEFAULT_ROUTE_CAPACITY = 35
const ROUTE_INTERDICTION_RADIUS = 20_000
const ROUTE_REPAIR_PER_TICK = 0.015
const RECOVERING_BASE_OUTPUT_MULTIPLIER = 0.25
const AIRDROME_SUPPLY_MAX = 10_000
const AIRDROME_PRODUCTION_RATE = 20
/**
 * A depot has to keep launching after the first era. One CAP 2-ship spends about
 * 280 fuel and 70 supply; the old pool only made 9 fuel an hour, so every
 * airfield was depleted before Vietnam and only supply-exempt helicopters flew.
 */
const AIRDROME_SUSTAINED_PRODUCTION = 700
const AIRDROME_LAUNCH_FLOOR = 0.2
const OBJECTIVE_SUPPLY_MAX = 1_000
const CAMPAIGN_HOUR_SECONDS = 3_600
const CAMPAIGN_MINUTE_SECONDS = 60

const DEFAULT_FLIGHT_LOGISTICS_COST = { fuel: 120, munitions: 80, repair: 30, supply: 60 }

const FLIGHT_LOGISTICS_COST: Partial<
  Record<FlightTask, { fuel: number; munitions: number; repair: number; supply: number }>
> = {
  CAP: { fuel: 140, munitions: 20, repair: 20, supply: 35 },
  Intercept: { fuel: 150, munitions: 25, repair: 20, supply: 35 },
  'Fighter Sweep': { fuel: 160, munitions: 30, repair: 25, supply: 40 },
  Training: { fuel: 80, munitions: 0, repair: 15, supply: 20 },
  'Pinpoint Strike': { fuel: 190, munitions: 140, repair: 35, supply: 75 },
  'Strategic Strike': { fuel: 520, munitions: 360, repair: 80, supply: 190 },
  SEAD: { fuel: 210, munitions: 170, repair: 40, supply: 85 },
  DEAD: { fuel: 220, munitions: 210, repair: 50, supply: 100 },
  CAS: { fuel: 185, munitions: 185, repair: 45, supply: 95 },
  Transport: { fuel: 160, munitions: 10, repair: 30, supply: 45 },
  Refueling: { fuel: 240, munitions: 0, repair: 35, supply: 55 },
  AWACS: { fuel: 220, munitions: 0, repair: 35, supply: 50 },
  'Ground Attack': { fuel: 180, munitions: 160, repair: 40, supply: 85 },
  'Runway Attack': { fuel: 200, munitions: 180, repair: 45, supply: 90 }
}

/**
 * Updates supply levels for all nodes (objectives + airdromes).
 * Runs every logic tick (1 second intervals).
 * Production rate and route capacity are per campaign hour, so a sortie
 * stays spent longer than one tick. Route repair is per campaign minute.
 */
export function updateSupply(draft: Campaign, coalition: Coalition, delta = 1000): void {
  const timeFactor = Math.max(0, (delta * draft.timeMultiplier) / 1000)
  const productionFactor = timeFactor / CAMPAIGN_HOUR_SECONDS
  const routeRepairFactor = timeFactor / CAMPAIGN_MINUTE_SECONDS
  const theatre = getCampaignTheatre(draft)
  const supplyNodes = ensureSupplyNodes(draft, coalition)
  if (!supplyNodes) return
  const nodePositions = theatre ? getSupplyNodePositions(draft, coalition, theatre) : new Map()
  const enemyCoalition: Coalition = coalition === 'player' ? 'opponent' : 'player'

  for (const [nodeId, supply] of Object.entries(supplyNodes)) {
    ensureVirtualSupply(supply, isAirdromeNode(draft, coalition, nodeId))
    applyInfrastructurePressure(draft, coalition, nodeId, supply)
    updateNodeSupply(supply, draft.time, productionFactor)
  }

  if (!theatre) return

  for (const [nodeId, supply] of Object.entries(supplyNodes)) {
    if (supply.logistics?.hub === true) continue

    const destinationPosition = nodePositions.get(nodeId)
    if (!destinationPosition) continue

    const source = findNearestLogisticsHub(supplyNodes, nodePositions, nodeId, destinationPosition)
    if (!source) continue

    const route = upsertRoute(supply, source.id, nodeId)
    route.disruption = Math.min(
      0.9,
      Math.max(
        getRouteDisruption(
          draft,
          enemyCoalition,
          source.position,
          destinationPosition,
          route,
          routeRepairFactor
        ),
        supply.logistics?.interdiction ?? 0
      )
    )

    transferAlongRoute(source.supply, supply, route, productionFactor)
  }
}

function createBaselineSupply(isAirdrome: boolean): Supply {
  const max = isAirdrome ? AIRDROME_SUPPLY_MAX : OBJECTIVE_SUPPLY_MAX
  const current = isAirdrome ? max * 0.75 : max * 0.5

  return {
    current,
    max,
    productionRate: isAirdrome ? AIRDROME_PRODUCTION_RATE : 0,
    consumptionRate: 0,
    status: getSupplyStatus(current / max)
  }
}

function scalePoolCapacity(
  pool: SupplyPool | undefined,
  max: number,
  productionRate: number
): void {
  if (!pool) return

  const ratio = pool.max > 0 ? pool.current / pool.max : 0
  pool.max = Math.max(pool.max, max)
  pool.current = Math.min(pool.max, Math.max(pool.current, pool.max * ratio))
  pool.productionRate = Math.max(pool.productionRate, productionRate)
}

function ensureAirdromeSupplyCapacity(supply: Supply): void {
  if (supply.max >= AIRDROME_SUPPLY_MAX) {
    supply.productionRate = Math.max(supply.productionRate, AIRDROME_SUSTAINED_PRODUCTION)
    return
  }

  const ratio = supply.max > 0 ? supply.current / supply.max : 0
  supply.max = AIRDROME_SUPPLY_MAX
  supply.current = Math.min(supply.max, Math.max(supply.current, supply.max * ratio))
  supply.productionRate = Math.max(supply.productionRate, AIRDROME_SUSTAINED_PRODUCTION)

  scalePoolCapacity(supply.fuel, supply.max * 0.45, supply.productionRate * 0.45)
  scalePoolCapacity(supply.munitions, supply.max * 0.35, supply.productionRate * 0.35)
  scalePoolCapacity(supply.repair, supply.max * 0.2, supply.productionRate * 0.2)

  if (supply.logistics) {
    supply.logistics.hub = true
    supply.logistics.hubLevel = Math.max(supply.logistics.hubLevel ?? 1, 2)
    supply.logistics.routeCapacity = Math.max(
      supply.logistics.routeCapacity ?? 0,
      DEFAULT_ROUTE_CAPACITY * 1.5
    )
  }

  updateSupplyStatus(supply)
}

function ensureSupplyNodes(draft: Campaign, coalition: Coalition): Record<string, Supply> {
  const coalitionData = draft.coalitions[coalition]
  const supplyNodes = (coalitionData.supplyNodes ??= {})

  for (const airdromeName of coalitionData.airdromeNames) {
    supplyNodes[airdromeName] ??= createBaselineSupply(true)
    ensureAirdromeSupplyCapacity(supplyNodes[airdromeName])
  }

  for (const objectiveId of coalitionData.objectiveIds) {
    supplyNodes[objectiveId] ??= createBaselineSupply(false)
  }

  return supplyNodes
}

function getCampaignTheatre(draft: Campaign): Theatre | undefined {
  const scenario = scenarios.find((entry) => entry.id === draft.scenarioId)
  if (!scenario) return undefined
  return theatres.find((entry) => entry.name === scenario.theatreName)
}

function isAirdromeNode(draft: Campaign, coalition: Coalition, nodeId: string): boolean {
  return draft.coalitions[coalition].airdromeNames.includes(nodeId)
}

function getSupplyNodePositions(draft: Campaign, coalition: Coalition, theatre: Theatre) {
  const positions = new Map<string, Position>()

  for (const objectiveId of draft.coalitions[coalition].objectiveIds) {
    const objective = theatre.objectives.find((entry) => entry.name === objectiveId)
    if (objective) positions.set(objectiveId, objective.position)
  }

  for (const airdromeName of draft.coalitions[coalition].airdromeNames) {
    const airdrome = theatre.airdromeDetails[airdromeName]
    if (airdrome) positions.set(airdromeName, { x: airdrome.x, y: airdrome.y })
  }

  return positions
}

function createPool(max: number, currentRatio: number, productionRate: number): SupplyPool {
  return {
    current: Math.max(0, max * currentRatio),
    max,
    productionRate,
    consumptionRate: 0
  }
}

function ensurePoolBounds(pool: SupplyPool, timeFactor: number): void {
  pool.current += pool.productionRate * timeFactor
  pool.current -= pool.consumptionRate * timeFactor
  pool.current = Math.max(0, Math.min(pool.max, pool.current))
}

export function ensureVirtualSupply(supply: Supply, isAirdrome = false): void {
  const currentRatio = supply.max > 0 ? supply.current / supply.max : 0
  const productionRate = supply.productionRate

  supply.fuel ??= createPool(supply.max * 0.45, currentRatio, productionRate * 0.45)
  supply.munitions ??= createPool(supply.max * 0.35, currentRatio, productionRate * 0.35)
  supply.repair ??= createPool(supply.max * 0.2, currentRatio, productionRate * 0.2)
  supply.logistics ??= {
    hub: isAirdrome || supply.productionRate > supply.consumptionRate,
    hubLevel: isAirdrome ? 2 : 1,
    routeCapacity: isAirdrome ? DEFAULT_ROUTE_CAPACITY * 1.5 : DEFAULT_ROUTE_CAPACITY,
    routes: [],
    interdiction: 0,
    repairRate: ROUTE_REPAIR_PER_TICK
  }

  supply.logistics.routes ??= []
  supply.logistics.hubLevel ??= isAirdrome ? 2 : 1
  supply.logistics.routeCapacity ??= isAirdrome
    ? DEFAULT_ROUTE_CAPACITY * 1.5
    : DEFAULT_ROUTE_CAPACITY
  supply.logistics.repairRate ??= ROUTE_REPAIR_PER_TICK
  supply.logistics.interdiction ??= 0

  if (!isAirdrome) return

  supply.productionRate = Math.max(supply.productionRate, AIRDROME_SUSTAINED_PRODUCTION)
  scalePoolCapacity(supply.fuel, supply.max * 0.45, supply.productionRate * 0.45)
  scalePoolCapacity(supply.munitions, supply.max * 0.35, supply.productionRate * 0.35)
  scalePoolCapacity(supply.repair, supply.max * 0.2, supply.productionRate * 0.2)
  raiseLaunchFloor(supply)
}

function raiseLaunchFloor(supply: Supply) {
  const raise = (current: number, max: number) =>
    max > 0 ? Math.max(current, max * AIRDROME_LAUNCH_FLOOR) : current
  supply.current = raise(supply.current, supply.max)
  if (supply.fuel) supply.fuel.current = raise(supply.fuel.current, supply.fuel.max)
  if (supply.munitions) {
    supply.munitions.current = raise(supply.munitions.current, supply.munitions.max)
  }
  if (supply.repair) supply.repair.current = raise(supply.repair.current, supply.repair.max)
  updateSupplyStatus(supply)
}

function updateNodeSupply(supply: Supply, now: Date, timeFactor: number): void {
  const recoveryMultiplier =
    supply.logistics?.recoveryUntil && now < supply.logistics.recoveryUntil
      ? RECOVERING_BASE_OUTPUT_MULTIPLIER
      : 1
  const interdictionMultiplier = 1 - (supply.logistics?.interdiction ?? 0)

  supply.current +=
    supply.productionRate * recoveryMultiplier * interdictionMultiplier * timeFactor
  supply.current -= supply.consumptionRate * timeFactor

  supply.current = Math.max(0, Math.min(supply.max, supply.current))
  if (supply.fuel) ensurePoolBounds(supply.fuel, timeFactor)
  if (supply.munitions) ensurePoolBounds(supply.munitions, timeFactor)
  if (supply.repair) ensurePoolBounds(supply.repair, timeFactor)
  updateSupplyStatus(supply)
}

function applyInfrastructurePressure(
  draft: Campaign,
  coalition: Coalition,
  nodeId: string,
  supply: Supply
): void {
  const relevantStructures = draft.coalitions[coalition].structures.filter(
    (structure) => structure.objectiveId === nodeId
  )
  if (relevantStructures.length === 0) return

  const aliveBuildings = relevantStructures.reduce(
    (sum, structure) => sum + structure.buildings.filter((building) => building.alive).length,
    0
  )
  const totalBuildings = relevantStructures.reduce(
    (sum, structure) => sum + structure.buildings.length,
    0
  )
  const health = totalBuildings > 0 ? aliveBuildings / totalBuildings : 1
  if (supply.logistics) {
    supply.logistics.interdiction = logisticsInterdictionAt(draft, coalition, nodeId)
  }
  const hasFuel = relevantStructures.some((structure) => /fuel/i.test(structure.type))
  const hasMunitions = relevantStructures.some((structure) => /ammo|munition/i.test(structure.type))
  const hasRepair = relevantStructures.some((structure) =>
    /factory|workshop|depot|warehouse/i.test(structure.type)
  )

  if (supply.fuel && hasFuel) {
    supply.fuel.productionRate = supply.productionRate * 0.45 * health
  }
  if (supply.munitions && hasMunitions) {
    supply.munitions.productionRate = supply.productionRate * 0.35 * health
  }
  if (supply.repair && hasRepair) {
    supply.repair.productionRate = supply.productionRate * 0.2 * health
  }
}

export function updateSupplyStatus(supply: Supply): void {
  const ratios = [supply.max > 0 ? supply.current / supply.max : 0]
  if (supply.fuel && supply.fuel.max > 0) ratios.push(supply.fuel.current / supply.fuel.max)
  if (supply.munitions && supply.munitions.max > 0) {
    ratios.push(supply.munitions.current / supply.munitions.max)
  }
  if (supply.repair && supply.repair.max > 0) ratios.push(supply.repair.current / supply.repair.max)

  supply.status = getSupplyStatus(Math.min(...ratios))
}

export function getSupplyStatus(percentage: number): Supply['status'] {
  if (percentage > 0.75) return 'abundant'
  if (percentage > 0.5) return 'adequate'
  if (percentage > 0.25) return 'low'
  if (percentage > 0.05) return 'critical'
  return 'depleted'
}

function findNearestLogisticsHub(
  supplyNodes: Record<string, Supply>,
  positions: Map<string, Position>,
  destinationId: string,
  destinationPosition: Position
) {
  let nearest: {
    id: string
    supply: Supply
    position: Position
  } | null = null
  let nearestDistance = Number.POSITIVE_INFINITY

  for (const [nodeId, supply] of Object.entries(supplyNodes)) {
    if (nodeId === destinationId || supply.logistics?.hub !== true) continue
    if (supply.current <= supply.max * 0.25) continue

    const position = positions.get(nodeId)
    if (!position) continue

    const distance = calculateDistance(position, destinationPosition)
    if (distance < nearestDistance) {
      nearestDistance = distance
      nearest = { id: nodeId, supply, position }
    }
  }

  return nearest
}

function upsertRoute(supply: Supply, from: string, to: string): LogisticsRoute {
  ensureVirtualSupply(supply)
  const routes = supply.logistics!.routes
  let route = routes.find((entry) => entry.from === from && entry.to === to)
  if (!route) {
    route = {
      id: `${from}->${to}`,
      from,
      to,
      capacity: supply.logistics?.routeCapacity ?? DEFAULT_ROUTE_CAPACITY,
      disruption: 0,
      repairProgress: 1
    }
    routes.push(route)
  }
  return route
}

function distanceToSegment(position: Position, start: Position, end: Position): number {
  const dx = end.x - start.x
  const dy = end.y - start.y
  if (dx === 0 && dy === 0) return calculateDistance(position, start)

  const t = Math.max(
    0,
    Math.min(1, ((position.x - start.x) * dx + (position.y - start.y) * dy) / (dx * dx + dy * dy))
  )
  return calculateDistance(position, { x: start.x + dx * t, y: start.y + dy * t })
}

function getRouteDisruption(
  draft: Campaign,
  enemyCoalition: Coalition,
  from: Position,
  to: Position,
  route: LogisticsRoute,
  timeFactor: number
): number {
  const enemyInterdiction = draft.coalitions[enemyCoalition].groundGroups.some(
    (group) => distanceToSegment(group.position, from, to) <= ROUTE_INTERDICTION_RADIUS
  )
  const current =
    route.interdictedUntil && draft.time < route.interdictedUntil ? route.disruption : 0
  const repaired = Math.max(0, current - ROUTE_REPAIR_PER_TICK * timeFactor)
  return Math.min(0.85, Math.max(repaired, enemyInterdiction ? 0.65 : 0))
}

function transferPool(
  sourcePool: SupplyPool | undefined,
  destinationPool: SupplyPool | undefined,
  amount: number
) {
  if (!sourcePool || !destinationPool || amount <= 0) return
  const transferred = Math.min(
    amount,
    sourcePool.current,
    destinationPool.max - destinationPool.current
  )
  sourcePool.current -= transferred
  destinationPool.current += transferred
}

function transferAlongRoute(
  source: Supply,
  destination: Supply,
  route: LogisticsRoute,
  timeFactor: number
): void {
  const effectiveCapacity = route.capacity * (1 - route.disruption) * timeFactor
  if (effectiveCapacity <= 0) return

  const supplyTransfer = Math.min(
    effectiveCapacity,
    source.current,
    destination.max - destination.current
  )
  source.current -= supplyTransfer
  destination.current += supplyTransfer
  transferPool(source.fuel, destination.fuel, effectiveCapacity * 0.45)
  transferPool(source.munitions, destination.munitions, effectiveCapacity * 0.35)
  transferPool(source.repair, destination.repair, effectiveCapacity * 0.2)
  updateSupplyStatus(source)
  updateSupplyStatus(destination)
}

/**
 * Calculate consumption rate based on hosted units
 */
export function calculateConsumptionRate(
  draft: Campaign,
  nodeId: string,
  coalition: Coalition
): number {
  let rate = 0

  // Ground units: 2 points per unit per tick
  const groundGroups = draft.coalitions[coalition].groundGroups.filter(
    (g) => g.objectiveId === nodeId
  )
  for (const group of groundGroups) {
    rate += group.units.reduce((sum, unit) => sum + unit.count * 2, 0)
  }

  // SAM sites: 5 points per tick when active
  const samGroups = draft.coalitions[coalition].samGroups.filter(
    (sam) => sam.objectiveId === nodeId && isSamOperational(sam)
  )
  rate += samGroups.length * 5

  return rate
}

/**
 * Get supply for a node (objective or airdrome)
 */
export function getNodeSupply(
  draft: Campaign,
  coalition: Coalition,
  nodeId: string
): Supply | undefined {
  return draft.coalitions[coalition].supplyNodes?.[nodeId]
}

export function getFlightLogisticsCost(task: FlightTask, aircraftCount: number) {
  const cost = FLIGHT_LOGISTICS_COST[task] ?? DEFAULT_FLIGHT_LOGISTICS_COST
  return {
    fuel: cost.fuel * aircraftCount,
    munitions: cost.munitions * aircraftCount,
    repair: cost.repair * aircraftCount,
    supply: cost.supply * aircraftCount
  }
}

export function canSupportFlightLogistics(
  supply: Supply | undefined,
  task: FlightTask,
  aircraftCount: number
): boolean {
  if (!supply) return true
  ensureVirtualSupply(supply)
  const cost = getFlightLogisticsCost(task, aircraftCount)
  return (
    supply.current >= cost.supply &&
    (supply.fuel?.current ?? 0) >= cost.fuel &&
    (supply.munitions?.current ?? 0) >= cost.munitions &&
    (supply.repair?.current ?? 0) >= cost.repair
  )
}

export function spendFlightLogistics(
  supply: Supply | undefined,
  task: FlightTask,
  aircraftCount: number
): void {
  if (!supply) return
  ensureVirtualSupply(supply)
  const cost = getFlightLogisticsCost(task, aircraftCount)

  supply.current = Math.max(0, supply.current - cost.supply)
  if (supply.fuel) supply.fuel.current = Math.max(0, supply.fuel.current - cost.fuel)
  if (supply.munitions) {
    supply.munitions.current = Math.max(0, supply.munitions.current - cost.munitions)
  }
  if (supply.repair) supply.repair.current = Math.max(0, supply.repair.current - cost.repair)
  updateSupplyStatus(supply)
}
