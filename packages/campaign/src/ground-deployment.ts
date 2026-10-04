import { config, schemas } from '@dcc/contracts'
import * as z from 'zod'

type Campaign = z.infer<typeof schemas.campaign.campaign>
type Coalition = z.infer<typeof schemas.coalition>
type DeploymentSite = z.infer<typeof schemas.deploymentSite>
type DeploymentSiteRole = z.infer<typeof schemas.deploymentSiteRole>
type GroundGroup = z.infer<typeof schemas.groundGroup>
type GroundUnit = GroundGroup['units'][number]
type Position = z.infer<typeof schemas.position>
type Theatre = z.infer<typeof schemas.theatre>

export const RETREAT_POWER_RATIO = 0.3
export const RETREAT_UNIT_FLOOR = 3
export const DEPLOYMENT_POWER_RATIO = 0.7
export const DEPLOYMENT_UNIT_FLOOR = 4

const INFANTRY_PATTERN = /infantry|soldier|rifle|manpad|stinger|igla/i
const AIR_DEFENSE_PATTERN =
  /shorad|aaa|sam|stinger|igla|avenger|chaparral|osa|tunguska|tor|strela|roland|rapier|vulcan|hawk|zu-23|hq-7/i
const ARTILLERY_PATTERN = /artillery|howitzer|mortar|mlrs|grad|paladin|m109|l118/i

function stableHash(input: string): number {
  let value = 2166136261
  for (let index = 0; index < input.length; index += 1) {
    value ^= input.charCodeAt(index)
    value = Math.imul(value, 16777619)
  }
  return value >>> 0
}

function stableId(prefix: string, seed: string): string {
  return `${prefix}-${stableHash(seed).toString(16).padStart(8, '0')}`
}

function stableRandom(seed: string): number {
  let value = stableHash(seed)
  value ^= value << 13
  value ^= value >>> 17
  value ^= value << 5
  return (value >>> 0) / 0x1_0000_0000
}

export function classifyGroundUnit(name: string) {
  if (ARTILLERY_PATTERN.test(name)) return 'artillery' as const
  if (AIR_DEFENSE_PATTERN.test(name)) return 'air-defense' as const
  if (INFANTRY_PATTERN.test(name)) return 'infantry' as const
  return 'vehicle' as const
}

export function isInfantryGroundGroup(group: GroundGroup): boolean {
  return (
    group.units.length > 0 &&
    group.units.every((unit) => classifyGroundUnit(unit.name) === 'infantry')
  )
}

export function getGroundUnitWeight(name: string): number {
  switch (classifyGroundUnit(name)) {
    case 'infantry':
      return 1
    case 'air-defense':
      return 2
    case 'artillery':
    case 'vehicle':
      return 3
  }
}

export function getGroundGroupUnitCount(group: Pick<GroundGroup, 'units'>): number {
  return group.units.reduce((sum, unit) => sum + Math.max(0, unit.count), 0)
}

export function getGroundGroupCombatPower(group: Pick<GroundGroup, 'units'>): number {
  return group.units.reduce(
    (sum, unit) => sum + Math.max(0, unit.count) * getGroundUnitWeight(unit.name),
    0
  )
}

export function expandGroundGroupUnits(group: GroundGroup): GroundUnit[] {
  const expanded: GroundUnit[] = []
  let ordinal = 0

  for (const unit of group.units) {
    const count = Math.max(0, Math.floor(unit.count))
    for (let index = 0; index < count; index += 1) {
      ordinal += 1
      expanded.push({
        ...unit,
        id:
          unit.id && count === 1
            ? unit.id
            : stableId('ground-unit', `${group.id}:${ordinal}:${unit.name}`),
        count: 1,
        position: unit.position ? { ...unit.position } : undefined
      })
    }
  }

  group.units = expanded
  group.baselineCombatPower ??= getGroundGroupCombatPower(group)
  group.authorizedTemplateId ??= `formation-${stableHash(expanded.map((unit) => unit.name).join('|')).toString(16)}`
  return expanded
}

export type CombatViability = {
  unitCount: number
  combatPower: number
  baselineCombatPower: number
  powerRatio: number
  mustRetreat: boolean
  casEligible: boolean
  deployable: boolean
  reason?: 'depleted-power' | 'too-few-units' | 'withdrawing'
}

export function evaluateCombatViability(group: GroundGroup): CombatViability {
  const unitCount = getGroundGroupUnitCount(group)
  const combatPower = getGroundGroupCombatPower(group)
  const baselineCombatPower = Math.max(group.baselineCombatPower ?? combatPower, 1)
  const powerRatio = combatPower / baselineCombatPower
  const withdrawing = ['withdrawing', 'awaiting-extraction', 'trapped'].includes(group.state)
  const tooFewUnits = unitCount <= RETREAT_UNIT_FLOOR
  const depletedPower = powerRatio < RETREAT_POWER_RATIO
  const mustRetreat = !withdrawing && combatPower > 0 && (tooFewUnits || depletedPower)

  return {
    unitCount,
    combatPower,
    baselineCombatPower,
    powerRatio,
    mustRetreat,
    casEligible: !withdrawing && !tooFewUnits && !depletedPower && combatPower > 0,
    deployable:
      unitCount >= DEPLOYMENT_UNIT_FLOOR && powerRatio >= DEPLOYMENT_POWER_RATIO && combatPower > 0,
    reason: withdrawing
      ? 'withdrawing'
      : tooFewUnits
        ? 'too-few-units'
        : depletedPower
          ? 'depleted-power'
          : undefined
  }
}

function legacyTargetRoles(type: z.infer<typeof schemas.targetType>): DeploymentSiteRole[] | null {
  switch (type) {
    case 'Vehicle':
      return ['vehicle', 'defensive', 'staging']
    case 'AAA':
    case 'SAM':
      return ['air-defense', 'defensive']
    case 'Artillery':
      return ['artillery', 'reserve']
    default:
      return null
  }
}

function legacyPosture(type: z.infer<typeof schemas.targetType>): DeploymentSite['posture'] {
  if (type === 'AAA' || type === 'SAM') return 'air-defense-ring'
  if (type === 'Artillery') return 'artillery-battery'
  return 'dispersed-defense'
}

export function getDeploymentSites(theatre: Theatre): DeploymentSite[] {
  const explicit = theatre.deploymentSites ?? []
  const explicitIds = new Set(explicit.map((site) => site.id))
  const derived: DeploymentSite[] = []

  for (const [objectiveId, targets] of Object.entries(theatre.targets)) {
    for (const target of targets) {
      const roles = legacyTargetRoles(target.type)
      if (!roles || target.unitPositions.length === 0) continue
      const id = `legacy-${objectiveId}-${target.groupId}-${target.type}`
      if (explicitIds.has(id)) continue
      const allowedUnitKinds =
        target.type === 'Vehicle'
          ? (['vehicle', 'infantry', 'air-defense'] as const)
          : target.type === 'Artillery'
            ? (['artillery'] as const)
            : (['air-defense'] as const)
      derived.push({
        id,
        objectiveId,
        position: target.position,
        roles,
        posture: legacyPosture(target.type),
        slots: target.unitPositions.map((slot, index) => ({
          id: `${id}-slot-${index + 1}`,
          ...slot,
          allowedUnitKinds: [...allowedUnitKinds]
        })),
        source: 'legacy-target'
      })
    }
  }

  return [...explicit, ...derived]
}

function siteSupportsUnit(site: DeploymentSite, unit: GroundUnit, slotIndex: number): boolean {
  const slot = site.slots[slotIndex]
  return slot != null && slot.allowedUnitKinds.includes(classifyGroundUnit(unit.name))
}

export function assignDeploymentSite(params: {
  campaign: Campaign
  coalition: Coalition
  theatre: Theatre
  group: GroundGroup
  objectiveId: string
  roles: DeploymentSiteRole[]
  reason: NonNullable<GroundGroup['deployment']>['reason']
  siteIds?: ReadonlySet<string>
  now?: Date
}): DeploymentSite | null {
  expandGroundGroupUnits(params.group)
  const reserved = new Set(
    params.campaign.coalitions[params.coalition].groundGroups
      .filter((group) => group.id !== params.group.id)
      .map((group) => group.deployment?.siteId)
      .filter((id): id is string => id != null)
  )
  if (params.reason !== 'landing') {
    for (const siteId of params.campaign.landingOperation?.reservedSiteIds ?? []) {
      reserved.add(siteId)
    }
  }
  const sites = getDeploymentSites(params.theatre)
    .filter((site) => site.validationStatus !== 'candidate')
    .filter((site) => site.objectiveId === params.objectiveId)
    .filter((site) => params.roles.some((role) => site.roles.includes(role)))
    .filter((site) => !params.siteIds || params.siteIds.has(site.id))
    .filter((site) => !reserved.has(site.id))
    .filter((site) => site.slots.length >= params.group.units.length)
    .filter((site) =>
      params.group.units.every((unit, index) => siteSupportsUnit(site, unit, index))
    )
    .sort((left, right) => {
      const leftScore = stableHash(
        `${params.campaign.id}:${params.group.id}:${params.reason}:${left.id}`
      )
      const rightScore = stableHash(
        `${params.campaign.id}:${params.group.id}:${params.reason}:${right.id}`
      )
      return leftScore - rightScore
    })

  const selected = sites[0]
  if (!selected) {
    params.group.deploymentDeferredReason = `No approved, compatible, unreserved ${params.roles.join('/')} site with ${params.group.units.length} slots at ${params.objectiveId}`
    return null
  }

  params.group.units.forEach((unit, index) => {
    const slot = selected.slots[index]!
    unit.position = { x: slot.x, y: slot.y }
    unit.heading = slot.heading
    unit.slotId = slot.id
  })
  params.group.position = { ...selected.position }
  params.group.objectiveId = params.objectiveId
  params.group.deployment = {
    siteId: selected.id,
    assignedAt: (params.now ?? params.campaign.time).toISOString(),
    reason: params.reason
  }
  params.group.deploymentDeferredReason = undefined
  return selected
}

function getConnectionNeighbors(theatre: Theatre, objectiveId: string, mode: 'land' | 'any') {
  const result: Array<{ objectiveId: string; waypoints: Position[] }> = []
  for (const connection of theatre.connections ?? []) {
    if (mode === 'land' && connection.mode === 'sea') continue
    if (connection.from === objectiveId) {
      result.push({ objectiveId: connection.to, waypoints: connection.waypoints })
    }
    if (connection.bidirectional && connection.to === objectiveId) {
      result.push({ objectiveId: connection.from, waypoints: [...connection.waypoints].reverse() })
    }
  }
  return result
}

export function findOwnedObjectiveRoute(params: {
  theatre: Theatre
  ownedObjectiveIds: ReadonlySet<string>
  fromObjectiveId: string
  destinationObjectiveIds: ReadonlySet<string>
}): { destinationObjectiveId: string; waypoints: Position[] } | null {
  const queue: Array<{ objectiveId: string; waypoints: Position[] }> = [
    { objectiveId: params.fromObjectiveId, waypoints: [] }
  ]
  const visited = new Set([params.fromObjectiveId])

  while (queue.length > 0) {
    const current = queue.shift()!
    if (
      current.objectiveId !== params.fromObjectiveId &&
      params.destinationObjectiveIds.has(current.objectiveId)
    ) {
      return { destinationObjectiveId: current.objectiveId, waypoints: current.waypoints }
    }
    for (const neighbor of getConnectionNeighbors(params.theatre, current.objectiveId, 'land')) {
      if (
        visited.has(neighbor.objectiveId) ||
        !params.ownedObjectiveIds.has(neighbor.objectiveId)
      ) {
        continue
      }
      visited.add(neighbor.objectiveId)
      const objective = params.theatre.objectives.find(
        (entry) => entry.name === neighbor.objectiveId
      )
      queue.push({
        objectiveId: neighbor.objectiveId,
        waypoints: [
          ...current.waypoints,
          ...neighbor.waypoints,
          ...(objective ? [objective.position] : [])
        ]
      })
    }
  }

  return null
}

function removeCasAssignments(campaign: Campaign, coalition: Coalition, groundGroupId: string) {
  const enemyCoalition: Coalition = coalition === 'player' ? 'opponent' : 'player'
  const enemy = campaign.coalitions[enemyCoalition]
  const cancelledFlightIds = new Set(
    enemy.flightGroups
      .filter((flight) => flight.task === 'CAS' && flight.target?.id === groundGroupId)
      .map((flight) => flight.id)
  )
  enemy.flightGroups = enemy.flightGroups.filter((flight) => !cancelledFlightIds.has(flight.id))
  enemy.packages = enemy.packages.filter(
    (missionPackage) =>
      missionPackage.targetType !== 'Ground Group' ||
      !missionPackage.members.some((member) => cancelledFlightIds.has(member.flightGroupId))
  )
  campaign.groundBattleLocks = (campaign.groundBattleLocks ?? []).filter(
    (lock) =>
      !lock.attackerGroupIds.includes(groundGroupId) &&
      !lock.defenderGroupIds.includes(groundGroupId)
  )
}

function recoveryObjectiveIds(theatre: Theatre, coalitionObjectiveIds: string[]) {
  const owned = new Set(coalitionObjectiveIds)
  return new Set(
    getDeploymentSites(theatre)
      .filter(
        (site) =>
          site.validationStatus !== 'candidate' &&
          owned.has(site.objectiveId) &&
          site.roles.includes('recovery')
      )
      .map((site) => site.objectiveId)
  )
}

/** Objectives this close to a broken formation are where it is fighting, not a place to recover. */
const FALLBACK_EXCLUSION_RADIUS = 5_000

function findNearestFallbackObjective(
  theatre: Theatre,
  ownedObjectiveIds: ReadonlySet<string>,
  position: Position
) {
  let nearest: Theatre['objectives'][number] | undefined
  let nearestDistance = Number.POSITIVE_INFINITY
  for (const objective of theatre.objectives) {
    if (!ownedObjectiveIds.has(objective.name)) continue
    const distance = Math.hypot(
      objective.position.x - position.x,
      objective.position.y - position.y
    )
    if (distance <= FALLBACK_EXCLUSION_RADIUS || distance >= nearestDistance) continue
    nearest = objective
    nearestDistance = distance
  }
  return nearest
}

export function beginGroundGroupRetreat(params: {
  campaign: Campaign
  coalition: Coalition
  theatre: Theatre
  group: GroundGroup
  now?: Date
}): 'withdrawing' | 'awaiting-extraction' | 'trapped' | null {
  const viability = evaluateCombatViability(params.group)
  if (!viability.mustRetreat || !params.group.objectiveId) return null

  const now = params.now ?? params.campaign.time
  removeCasAssignments(params.campaign, params.coalition, params.group.id)
  params.group.targetObjectiveId = undefined
  params.group.targetAirdromeName = undefined
  params.group.captureStartedAt = undefined
  params.group.combatStartedAt = undefined

  const ownedObjectiveIds = new Set(params.campaign.coalitions[params.coalition].objectiveIds)
  const route = findOwnedObjectiveRoute({
    theatre: params.theatre,
    ownedObjectiveIds,
    fromObjectiveId: params.group.objectiveId,
    destinationObjectiveIds: recoveryObjectiveIds(params.theatre, [...ownedObjectiveIds])
  })

  if (route) {
    params.group.state = 'withdrawing'
    params.group.retreat = {
      destinationObjectiveId: route.destinationObjectiveId,
      route: route.waypoints,
      startedAt: now.toISOString()
    }
    return 'withdrawing'
  }

  // Only the South Atlantic has an authored road network. Elsewhere a broken formation falls back
  // in a straight line to the nearest owned objective away from the fight, instead of surrendering.
  if ((params.theatre.connections ?? []).length === 0) {
    const fallback = findNearestFallbackObjective(
      params.theatre,
      ownedObjectiveIds,
      params.group.position
    )
    if (fallback) {
      params.group.state = 'withdrawing'
      params.group.retreat = {
        destinationObjectiveId: fallback.name,
        route: [{ ...fallback.position }],
        startedAt: now.toISOString()
      }
      return 'withdrawing'
    }
  }

  const pickupSite = getDeploymentSites(params.theatre).find(
    (site) =>
      site.validationStatus !== 'candidate' &&
      site.objectiveId === params.group.objectiveId &&
      site.roles.includes('extraction') &&
      site.extractionRadius != null
  )
  const destination = [...recoveryObjectiveIds(params.theatre, [...ownedObjectiveIds])][0]
  if (isInfantryGroundGroup(params.group) && pickupSite && destination) {
    const requestId = stableId(
      'extraction',
      `${params.campaign.id}:${params.group.id}:${now.toISOString()}`
    )
    const expiresAt = new Date(now.getTime() + config.packages['Troop Extraction'].surrenderDelayMs)
    params.group.state = 'awaiting-extraction'
    params.group.retreat = {
      destinationObjectiveId: destination,
      route: [],
      startedAt: now.toISOString(),
      surrenderAt: expiresAt.toISOString(),
      extractionRequestId: requestId
    }
    const requests = (params.campaign.coalitions[params.coalition].extractionRequests ??= [])
    requests.push({
      id: requestId,
      groundGroupId: params.group.id,
      objectiveId: params.group.objectiveId,
      pickupSiteId: pickupSite.id,
      destinationObjectiveId: destination,
      createdAt: now,
      expiresAt,
      status: 'awaiting-aircraft'
    })
    return 'awaiting-extraction'
  }

  params.group.state = 'trapped'
  params.group.retreat = {
    route: [],
    startedAt: now.toISOString(),
    surrenderAt: new Date(
      now.getTime() + config.packages['Troop Extraction'].surrenderDelayMs
    ).toISOString()
  }
  return 'trapped'
}

function ensureReplacementPool(campaign: Campaign, coalition: Coalition, objectiveId: string) {
  const pools = (campaign.coalitions[coalition].replacementPools ??= {})
  return (pools[objectiveId] ??= { readyPersonnel: 0, recoveringPersonnel: [], equipment: [] })
}

export function dissolveGroundGroupIntoReplacementPool(params: {
  campaign: Campaign
  coalition: Coalition
  group: GroundGroup
  objectiveId: string
}) {
  const pool = ensureReplacementPool(params.campaign, params.coalition, params.objectiveId)
  expandGroundGroupUnits(params.group)
  for (const unit of params.group.units) {
    if (classifyGroundUnit(unit.name) === 'infantry') {
      pool.readyPersonnel += 1
    } else {
      pool.equipment.push({
        id: unit.id!,
        name: unit.name,
        condition: unit.condition ?? 'operational'
      })
    }
  }
  params.campaign.coalitions[params.coalition].groundGroups = params.campaign.coalitions[
    params.coalition
  ].groundGroups.filter((group) => group.id !== params.group.id)
}

export function recordInfantryCasualties(params: {
  campaign: Campaign
  coalition: Coalition
  objectiveId: string
  position: Position
  count: number
  siteId?: string
  seed: string
  now?: Date
}): number {
  const now = params.now ?? params.campaign.time
  let woundedCount = 0
  for (let index = 0; index < params.count; index += 1) {
    const roll = stableRandom(`${params.seed}:${index}`)
    if (roll < config.packages.CASEVAC.woundedChance) woundedCount += 1
  }
  if (woundedCount === 0) return 0

  const points = (params.campaign.coalitions[params.coalition].casualtyPoints ??= [])
  const existing = points.find(
    (point) =>
      point.status === 'awaiting-pickup' &&
      point.objectiveId === params.objectiveId &&
      point.siteId === params.siteId
  )
  if (existing) {
    existing.woundedCount += woundedCount
    existing.expiresAt = new Date(now.getTime() + config.packages.CASEVAC.casualtyLifetimeMs)
  } else {
    points.push({
      id: stableId(
        'casualty-point',
        `${params.coalition}:${params.objectiveId}:${params.siteId ?? 'none'}:${now.toISOString()}`
      ),
      objectiveId: params.objectiveId,
      siteId: params.siteId,
      position: params.position,
      woundedCount,
      createdAt: now,
      expiresAt: new Date(now.getTime() + config.packages.CASEVAC.casualtyLifetimeMs),
      status: 'awaiting-pickup'
    })
  }
  return woundedCount
}

export function updateReplacementPools(
  campaign: Campaign,
  coalition: Coalition,
  now = campaign.time
) {
  for (const pool of Object.values(campaign.coalitions[coalition].replacementPools ?? {})) {
    const ready = pool.recoveringPersonnel.filter((entry) => entry.availableAt <= now)
    pool.readyPersonnel += ready.reduce((sum, entry) => sum + entry.count, 0)
    pool.recoveringPersonnel = pool.recoveringPersonnel.filter((entry) => entry.availableAt > now)
  }
  for (const point of campaign.coalitions[coalition].casualtyPoints ?? []) {
    if (
      (point.status === 'awaiting-pickup' || point.status === 'assigned') &&
      point.expiresAt <= now
    ) {
      point.status = 'expired'
      point.assignedFlightGroupId = undefined
    }
  }
}

export function recoverCasualtyPoint(params: {
  campaign: Campaign
  coalition: Coalition
  casualtyPointId: string
  destinationObjectiveId: string
  now?: Date
}): boolean {
  const point = params.campaign.coalitions[params.coalition].casualtyPoints?.find(
    (entry) => entry.id === params.casualtyPointId
  )
  if (!point || point.status === 'recovered' || point.status === 'expired') return false
  const now = params.now ?? params.campaign.time
  point.status = 'recovered'
  const pool = ensureReplacementPool(
    params.campaign,
    params.coalition,
    params.destinationObjectiveId
  )
  pool.recoveringPersonnel.push({
    id: stableId('recovery', `${point.id}:${now.toISOString()}`),
    count: point.woundedCount,
    availableAt: new Date(now.getTime() + config.packages.CASEVAC.recoveryTimeMs)
  })
  return true
}
