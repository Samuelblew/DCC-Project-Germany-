import { schemas } from '@dcc/contracts'
import {
  assignDeploymentSite,
  dissolveGroundGroupIntoReplacementPool,
  findAdjacentHostileTarget,
  getGroundGroupUnitCount,
  groundMarchKind,
  theatreHasLandGraph
} from '@dcc/campaign'
import { scenarios, theatres, campaignIadsEra, eraGroundLimits, resolveGroundSpawnMultiplier } from '@dcc/data'
import * as z from 'zod'
import { GroundGroup } from '../../entities/ground-group'
import { calculateDistance } from '@/logic/utils/calculate-distance'
import { INFANTRY_COST, VEHICLE_COST } from './ground-group-costs'
import {
  detachmentVehicleNames,
  DETACHMENT_INFANTRY,
  DETACHMENT_MIN_INFANTRY,
  planDetachment
} from './detachment'
import { activeOffensiveAxes, mayOpenOffensiveAxis } from '../offensive-axes'
import { activeRoadCutKeys } from '../road-cuts'
import { groundReplacementBlocked } from '../update-ground-groups'
import { logSpawnAction } from '@/logic/simulation-log'
import { getAirdromePosition, isAirdromeVulnerable } from '../airport-capture'
import { BATTLE_RADIUS, hasOtherGarrison } from '../ground-garrison'
import {
  GROUND_SPAWN_INTERDICTION_CHOKE,
  chokedObjectiveIds,
  logisticsInterdictionAt
} from '../logistics-interdiction'

const NM_TO_METERS = 1852
const INFANTRY_MAX_TARGET_RANGE_METERS = 40 * NM_TO_METERS
const VEHICLE_MAX_TARGET_RANGE_METERS = 60 * NM_TO_METERS
const DEFAULT_GROUND_GROUP_SPAWN_MULTIPLIER = 1
/** Live formations a side may keep on the map. Barracks wait once this is full. */
export const MAX_LIVE_GROUND_GROUPS = 36
/** Idle stacks at one town. Columns already on the road do not count. */
export const MAX_LIVE_GROUND_GROUPS_PER_OBJECTIVE = 3
/** Expanded campaign units. Culling keeps the .miz corridor loadable; this cap is for tick and map cost. */
export const MAX_LIVE_GROUND_UNITS = 240
/** Leave room for attacking columns instead of filling the cap with rear garrisons. */
export const MAX_IDLE_GARRISONS = 12

type Campaign = z.infer<typeof schemas.campaign.campaign>
type Coalition = z.infer<typeof schemas.coalition>
type Theatre = z.infer<typeof schemas.theatre>
type GroundGroupData = z.infer<typeof schemas.groundGroup>

function liveGroundLimits(draft: Campaign) {
  return eraGroundLimits(campaignIadsEra(draft))
}

function getLocalReplacementPool(
  draft: z.infer<typeof schemas.campaign.campaign>,
  coalition: z.infer<typeof schemas.coalition>,
  objectiveId: string
) {
  const pools = (draft.coalitions[coalition].replacementPools ??= {})
  return (pools[objectiveId] ??= {
    readyPersonnel: 0,
    recoveringPersonnel: [],
    equipment: []
  })
}

function consumeFormationAssets(params: {
  draft: z.infer<typeof schemas.campaign.campaign>
  coalition: z.infer<typeof schemas.coalition>
  objectiveId: string
  group: z.infer<typeof schemas.groundGroup>
  kind: 'infantry' | 'vehicle'
  unitName: string
  count: number
}) {
  const pool = getLocalReplacementPool(params.draft, params.coalition, params.objectiveId)
  if (params.kind === 'infantry') {
    pool.readyPersonnel = Math.max(0, pool.readyPersonnel - params.count)
    return
  }

  const selected = pool.equipment
    .filter((equipment) => equipment.name === params.unitName)
    .slice(0, params.count)
  const selectedIds = new Set(selected.map((equipment) => equipment.id))
  pool.equipment = pool.equipment.filter((equipment) => !selectedIds.has(equipment.id))
  params.group.units
    .filter((unit) => unit.name === params.unitName)
    .forEach((unit, index) => {
      const equipment = selected[index]
      if (!equipment) return
      unit.id = equipment.id
      unit.condition = equipment.condition
    })
}

/** Pay for the men who are missing. Returned veterans stay in the pool and are not conjured again. */
function authorizeInfantry(
  structure: { resources?: number },
  pool: { readyPersonnel: number },
  wanted: number
) {
  const canPay = (structure.resources || 0) >= INFANTRY_COST
  const have = pool.readyPersonnel
  if (!canPay && have < DETACHMENT_MIN_INFANTRY) return 0
  const field = Math.min(wanted, canPay ? wanted : have)
  if (field < DETACHMENT_MIN_INFANTRY) return 0
  if (canPay) {
    pool.readyPersonnel += Math.max(0, field - have)
    structure.resources = (structure.resources || 0) - INFANTRY_COST
  }
  return field
}

/** One depot payment mints the hulls the pool does not already hold. Owned hulls still roll if the depot is dry. */
function authorizeVehicles(
  depot: { resources?: number } | undefined,
  pool: { equipment: { id: string; name: string; condition: 'operational' | 'damaged' }[] },
  names: string[]
) {
  if (names.length === 0) return []
  const owned = new Set(pool.equipment.map((equipment) => equipment.name))
  const missing = names.filter((name) => !owned.has(name))
  const canPay = depot != null && (depot.resources || 0) >= VEHICLE_COST
  if (missing.length > 0 && !canPay) return names.filter((name) => owned.has(name))
  if (canPay && depot) {
    depot.resources = (depot.resources || 0) - VEHICLE_COST
    for (const name of missing) {
      pool.equipment.push({
        id: crypto.randomUUID(),
        name,
        condition: 'operational'
      })
    }
  }
  return names
}

function coalitionGroundGroups(draft: Campaign, coalition: Coalition) {
  return draft.coalitions[coalition].groundGroups.filter(
    (group) => getGroundGroupUnitCount(group) > 0
  )
}

function coalitionGroundUnitCount(draft: Campaign, coalition: Coalition) {
  return coalitionGroundGroups(draft, coalition).reduce(
    (sum, group) => sum + getGroundGroupUnitCount(group),
    0
  )
}

function holdingPosition(theatre: Theatre, objectiveId: string) {
  return (
    theatre.objectives.find((objective) => objective.name === objectiveId)?.position ??
    getAirdromePosition(theatre, objectiveId)
  )
}

function isHoldingAtObjective(group: GroundGroupData, theatre: Theatre, objectiveId: string) {
  if (group.state !== 'idle' && group.state !== 'combat') return false
  if (group.objectiveId !== objectiveId) return false
  const home = holdingPosition(theatre, objectiveId)
  return !home || calculateDistance(group.position, home) <= BATTLE_RADIUS
}

function groupsHoldingObjective(
  draft: Campaign,
  coalition: Coalition,
  theatre: Theatre,
  objectiveId: string
) {
  return coalitionGroundGroups(draft, coalition).filter((group) =>
    isHoldingAtObjective(group, theatre, objectiveId)
  )
}

function isOwnedObjective(draft: Campaign, coalition: Coalition, objectiveId: string) {
  const owned = draft.coalitions[coalition]
  return owned.objectiveIds.includes(objectiveId) || owned.airdromeNames.includes(objectiveId)
}

function isIdleGarrison(
  draft: Campaign,
  coalition: Coalition,
  theatre: Theatre,
  group: GroundGroupData
) {
  if (group.state !== 'idle' || !group.objectiveId) return false
  if (!isOwnedObjective(draft, coalition, group.objectiveId)) return false
  return isHoldingAtObjective(group, theatre, group.objectiveId)
}

function idleGarrisonCount(draft: Campaign, coalition: Coalition, theatre: Theatre) {
  return coalitionGroundGroups(draft, coalition).filter((group) =>
    isIdleGarrison(draft, coalition, theatre, group)
  ).length
}

function nearestEnemyDistance(
  draft: Campaign,
  coalition: Coalition,
  theatre: Theatre,
  position: { x: number; y: number }
) {
  const enemy = draft.coalitions[coalition === 'player' ? 'opponent' : 'player']
  let nearest = Number.POSITIVE_INFINITY
  for (const objectiveId of [...enemy.objectiveIds, ...enemy.airdromeNames]) {
    const target = holdingPosition(theatre, objectiveId)
    if (!target) continue
    nearest = Math.min(nearest, calculateDistance(position, target))
  }
  return nearest
}

function isFightingGroup(group: GroundGroupData) {
  return (
    group.state === 'combat' ||
    group.state === 'awaiting-extraction' ||
    group.state === 'trapped' ||
    group.state === 'withdrawing'
  )
}

function canRaiseGroundGroup(
  draft: Campaign,
  coalition: Coalition,
  theatre: Theatre,
  objectiveId: string,
  extraUnits: number
) {
  const limits = liveGroundLimits(draft)
  const groups = coalitionGroundGroups(draft, coalition)
  if (groups.length >= limits.maxLiveGroups) return false
  if (coalitionGroundUnitCount(draft, coalition) + extraUnits > limits.maxLiveUnits) return false
  if (
    groupsHoldingObjective(draft, coalition, theatre, objectiveId).length >=
    MAX_LIVE_GROUND_GROUPS_PER_OBJECTIVE
  ) {
    return false
  }
  return true
}

function surplusScore(group: GroundGroupData, extraGarrison: boolean) {
  if (extraGarrison && group.state === 'idle') return 0
  if (group.state === 'idle') return 1
  if (group.state === 'moving') return 2
  return 3
}

/** Fold leftover columns back into the replacement pool so an already-bloated save recovers. */
function pruneExcessGroundGroups(draft: Campaign, coalition: Coalition, theatre: Theatre) {
  for (let guard = 0; guard < 80; guard += 1) {
    const groups = coalitionGroundGroups(draft, coalition)
    const units = groups.reduce((sum, group) => sum + getGroundGroupUnitCount(group), 0)
    const idle = idleGarrisonCount(draft, coalition, theatre)
    const limits = liveGroundLimits(draft)
    const crowdedObjective = [...new Set(groups.map((group) => group.objectiveId).filter(Boolean))]
      .map((objectiveId) => ({
        objectiveId: objectiveId!,
        groups: groupsHoldingObjective(draft, coalition, theatre, objectiveId!)
      }))
      .find((entry) => entry.groups.length > MAX_LIVE_GROUND_GROUPS_PER_OBJECTIVE)

    const overCoalition =
      groups.length > limits.maxLiveGroups || units > limits.maxLiveUnits
    const tooManyIdle = idle > limits.maxIdleGarrisons
    if (!overCoalition && !crowdedObjective && !tooManyIdle) return

    const pool = crowdedObjective?.groups ?? groups
    const candidate = pool
      .filter((group) => !isFightingGroup(group))
      .filter((group) => {
        if (group.state !== 'idle' || !group.objectiveId) return true
        if (hasOtherGarrison(draft, coalition, theatre, group.objectiveId, group.id)) return true
        return overCoalition || tooManyIdle
      })
      .sort((left, right) => {
        const extraLeft = Boolean(
          left.objectiveId &&
            hasOtherGarrison(draft, coalition, theatre, left.objectiveId, left.id)
        )
        const extraRight = Boolean(
          right.objectiveId &&
            hasOtherGarrison(draft, coalition, theatre, right.objectiveId, right.id)
        )
        const score = surplusScore(left, extraLeft) - surplusScore(right, extraRight)
        if (score !== 0) return score
        if (left.state === 'idle' && right.state === 'idle') {
          return (
            nearestEnemyDistance(draft, coalition, theatre, right.position) -
            nearestEnemyDistance(draft, coalition, theatre, left.position)
          )
        }
        return getGroundGroupUnitCount(left) - getGroundGroupUnitCount(right)
      })[0]
    if (!candidate) return

    dissolveGroundGroupIntoReplacementPool({
      campaign: draft,
      coalition,
      group: candidate,
      objectiveId: candidate.objectiveId ?? crowdedObjective?.objectiveId ?? candidate.id
    })
  }
}

function hasLivingBarrack(
  draft: Campaign,
  coalition: Coalition,
  objectiveId: string
) {
  return draft.coalitions[coalition].structures.some(
    (structure) =>
      structure.type === 'Barrack' &&
      structure.objectiveId === objectiveId &&
      structure.buildings.some((building) => building.alive)
  )
}

function payingDepot(draft: Campaign, coalition: Coalition, objectiveId: string) {
  return draft.coalitions[coalition].structures.find(
    (structure) =>
      structure.type === 'Depot' &&
      structure.objectiveId === objectiveId &&
      (structure.resources || 0) >= VEHICLE_COST &&
      structure.buildings.some((building) => building.alive)
  )
}

function headingToward(
  theatre: Theatre,
  origin: { x: number; y: number },
  target: { type: 'objective' | 'airdrome'; name: string } | undefined
) {
  if (!target) return 0
  const position =
    target.type === 'airdrome'
      ? getAirdromePosition(theatre, target.name)
      : theatre.objectives.find((objective) => objective.name === target.name)?.position
  if (!position) return 0
  return Math.atan2(position.y - origin.y, position.x - origin.x)
}

function describeDetachment(units: { name: string; count: number }[]) {
  const counts = new Map<string, number>()
  for (const unit of units) counts.set(unit.name, (counts.get(unit.name) ?? 0) + unit.count)
  return [...counts].map(([name, count]) => `${count}x ${name}`).join(', ')
}

export function spawnGroundGroups(
  draft: z.infer<typeof schemas.campaign.campaign>,
  coalition: z.infer<typeof schemas.coalition>
): void {
  let spawnsThisTick = 0
  const scenario = scenarios.find((s) => s.id === draft.scenarioId)
  if (!scenario) return

  const theatre = theatres.find((t) => t.name === scenario.theatreName)
  if (!theatre) return

  pruneExcessGroundGroups(draft, coalition, theatre)

  const enemyCoalition = coalition === 'player' ? 'opponent' : 'player'
  const enemyObjectiveIds = draft.coalitions[enemyCoalition].objectiveIds
  const generation = campaignIadsEra(draft)
  const limits = eraGroundLimits(generation)
  const spawnMultiplier = resolveGroundSpawnMultiplier(
    scenario.start[coalition].groundGroupSpawnMultiplier ?? DEFAULT_GROUND_GROUP_SPAWN_MULTIPLIER,
    generation
  )
  const maxSpawnsThisTick = Math.max(0, limits.maxSpawnsPerTick * spawnMultiplier)

  const structures = [...draft.coalitions[coalition].structures].sort(
    (left, right) =>
      nearestEnemyDistance(draft, coalition, theatre, left.position) -
      nearestEnemyDistance(draft, coalition, theatre, right.position)
  )
  const coalitionData = draft.coalitions[coalition]
  const reservedTargetObjectives = new Set(
    draft.coalitions[coalition].groundGroups
      .map((group) => group.targetObjectiveId)
      .filter((targetObjectiveId): targetObjectiveId is string => targetObjectiveId != null)
  )
  const reservedTargetAirdromes = new Set(
    draft.coalitions[coalition].groundGroups
      .map((group) => group.targetAirdromeName)
      .filter((targetAirdromeName): targetAirdromeName is string => targetAirdromeName != null)
  )
  const deprioritizedNames = chokedObjectiveIds(draft, enemyCoalition)
  const closedHops = activeRoadCutKeys(draft)

  for (const structure of structures) {
    if (spawnsThisTick >= maxSpawnsThisTick) break

    // Only Barrack and Depot structures can spawn ground groups
    if (structure.type !== 'Barrack' && structure.type !== 'Depot') continue
    if (
      logisticsInterdictionAt(draft, coalition, structure.objectiveId) >=
      GROUND_SPAWN_INTERDICTION_CHOKE
    ) {
      continue
    }
    if (!canRaiseGroundGroup(draft, coalition, theatre, structure.objectiveId, 12)) continue
    if (groundReplacementBlocked(draft, coalition, structure.objectiveId)) continue

    const aliveBuildings = structure.buildings.filter((building) => building.alive)
    if (aliveBuildings.length === 0) continue

    for (let i = 0; i < aliveBuildings.length; i++) {
      if (spawnsThisTick >= maxSpawnsThisTick) break

      const fromBarrack = structure.type === 'Barrack'
      const pool = getLocalReplacementPool(draft, coalition, structure.objectiveId)
      if (
        fromBarrack &&
        (structure.resources || 0) < INFANTRY_COST &&
        pool.readyPersonnel < DETACHMENT_MIN_INFANTRY
      ) {
        continue
      }
      if (!fromBarrack && (structure.resources || 0) < VEHICLE_COST && pool.equipment.length === 0) {
        continue
      }
      // The company leaves from the barrack. A depot beside it does not raise a second group.
      if (!fromBarrack && hasLivingBarrack(draft, coalition, structure.objectiveId)) continue

      const depot = fromBarrack
        ? payingDepot(draft, coalition, structure.objectiveId)
        : structure
      const depotCanPay = depot != null && (depot.resources || 0) >= VEHICLE_COST
      const withVehicles = depotCanPay || pool.equipment.length > 0
      const composition = planDetachment({
        groundUnitTypes: coalitionData.groundUnitTypes,
        origin: structure.position,
        heading: 0,
        withVehicles,
        withInfantry: fromBarrack
      })
      if (composition.length === 0) continue
      const onFoot =
        groundMarchKind(composition) === 'foot' && detachmentVehicleNames(composition).length === 0
      const target = findNearestEnemyGroundTarget(
        draft,
        coalition,
        structure.position,
        structure.objectiveId,
        enemyObjectiveIds,
        draft.coalitions[enemyCoalition].airdromeNames,
        theatre,
        reservedTargetObjectives,
        reservedTargetAirdromes,
        onFoot ? INFANTRY_MAX_TARGET_RANGE_METERS : VEHICLE_MAX_TARGET_RANGE_METERS,
        deprioritizedNames,
        closedHops
      )
      const holding = hasOtherGarrison(draft, coalition, theatre, structure.objectiveId)
      let assault = target != null && mayOpenOffensiveAxis(draft, coalition, target.name, theatre)
      // The company already on the road is the attack. The next one raised here stays and holds the town.
      if (
        assault &&
        !holding &&
        target != null &&
        activeOffensiveAxes(draft, coalition).has(target.name)
      ) {
        assault = false
      }
      if (!assault && holding) continue
      if (!assault && idleGarrisonCount(draft, coalition, theatre) >= limits.maxIdleGarrisons) {
        continue
      }
      if (!canRaiseGroundGroup(draft, coalition, theatre, structure.objectiveId, composition.length)) {
        break
      }

      const resourcesBefore = structure.resources
      const depotResourcesBefore = depot?.resources
      const personnelBefore = pool.readyPersonnel
      const equipmentBefore = pool.equipment.length
      const infantryField = fromBarrack ? authorizeInfantry(structure, pool, DETACHMENT_INFANTRY) : 0
      if (fromBarrack && infantryField === 0) continue
      const vehicleNames = authorizeVehicles(
        depotCanPay ? depot : undefined,
        pool,
        detachmentVehicleNames(composition)
      )
      const laidOut = planDetachment({
        groundUnitTypes: coalitionData.groundUnitTypes,
        origin: structure.position,
        heading: headingToward(theatre, structure.position, assault ? target : undefined),
        withVehicles: vehicleNames.length > 0,
        withInfantry: fromBarrack
      })
      const paidVehicles = new Set(detachmentVehicleNames(laidOut))
      const units = [
        ...laidOut.filter((unit) => paidVehicles.has(unit.name) && vehicleNames.includes(unit.name)),
        ...laidOut.filter(
          (unit) => !paidVehicles.has(unit.name) && !/infantry|soldier/i.test(unit.name)
        ),
        ...laidOut.filter((unit) => /infantry|soldier/i.test(unit.name)).slice(0, infantryField)
      ]
      if (units.length === 0) {
        structure.resources = resourcesBefore
        if (depot && depotResourcesBefore != null) depot.resources = depotResourcesBefore
        pool.readyPersonnel = personnelBefore
        pool.equipment = pool.equipment.slice(0, equipmentBefore)
        continue
      }
      const groundGroupId = GroundGroup.create(draft, coalition, {
        position: structure.position,
        objectiveId: structure.objectiveId,
        units,
        state: assault ? 'moving' : 'idle',
        targetObjectiveId: assault && target?.type === 'objective' ? target.name : undefined,
        targetAirdromeName: assault && target?.type === 'airdrome' ? target.name : undefined
      })
      const groundGroup = draft.coalitions[coalition].groundGroups.find(
        (group) => group.id === groundGroupId
      )
      const site =
        groundGroup && !assault
          ? assignDeploymentSite({
              campaign: draft,
              coalition,
              theatre,
              group: groundGroup,
              objectiveId: structure.objectiveId,
              roles: fromBarrack ? ['infantry', 'staging'] : ['vehicle', 'staging'],
              reason: 'creation'
            })
          : null
      if (!groundGroup || (!assault && !site && !target)) {
        draft.coalitions[coalition].groundGroups = draft.coalitions[coalition].groundGroups.filter(
          (group) => group.id !== groundGroupId
        )
        structure.resources = resourcesBefore
        if (depot && depotResourcesBefore != null) depot.resources = depotResourcesBefore
        pool.readyPersonnel = personnelBefore
        pool.equipment = pool.equipment.slice(0, equipmentBefore)
        continue
      }
      if (fromBarrack) {
        const infantryName = units.find((unit) => /infantry|soldier/i.test(unit.name))?.name
        if (infantryName) {
          consumeFormationAssets({
            draft,
            coalition,
            objectiveId: structure.objectiveId,
            group: groundGroup,
            kind: 'infantry',
            unitName: infantryName,
            count: units.filter((unit) => unit.name === infantryName).length
          })
        }
      }
      for (const vehicleName of vehicleNames) {
        consumeFormationAssets({
          draft,
          coalition,
          objectiveId: structure.objectiveId,
          group: groundGroup,
          kind: 'vehicle',
          unitName: vehicleName,
          count: units.filter((unit) => unit.name === vehicleName).length
        })
      }
      if (assault && target?.type === 'objective') reservedTargetObjectives.add(target.name)
      else if (assault && target?.type === 'airdrome') reservedTargetAirdromes.add(target.name)
      const targetLabel =
        assault && target?.type === 'objective'
          ? ` moving to ${target.name}`
          : assault && target?.type === 'airdrome'
            ? ` moving to airport ${target.name}`
            : ' holding'
      logSpawnAction(
        draft,
        coalition,
        `Detachment at ${structure.objectiveId}: ${describeDetachment(units)}${targetLabel}`,
        undefined,
        {
          entityType: 'groundGroup',
          entityId: groundGroupId
        }
      )
      spawnsThisTick++
    }
  }
}

type GroundTarget = {
  type: 'objective' | 'airdrome'
  name: string
  distance: number
}

function findNearestEnemyGroundTarget(
  draft: z.infer<typeof schemas.campaign.campaign>,
  coalition: z.infer<typeof schemas.coalition>,
  position: z.infer<typeof schemas.position>,
  fromObjectiveId: string,
  enemyObjectiveIds: string[],
  enemyAirdromeNames: string[],
  theatre: z.infer<typeof schemas.theatre>,
  reservedTargetObjectives: ReadonlySet<string>,
  reservedTargetAirdromes: ReadonlySet<string>,
  maxTargetRangeMeters: number,
  deprioritizedNames: ReadonlySet<string>,
  closedHops: ReadonlySet<string>
): GroundTarget | undefined {
  if (theatreHasLandGraph(theatre)) {
    const reservedNames = new Set([...reservedTargetObjectives, ...reservedTargetAirdromes])
    const hop = findAdjacentHostileTarget({
      theatre,
      fromObjectiveId,
      enemyObjectiveIds,
      enemyAirdromeNames: enemyAirdromeNames.filter((name) =>
        isAirdromeVulnerable(draft, theatre, coalition, name)
      ),
      reservedNames,
      deprioritizedNames,
      closedHops
    })
    if (!hop) return undefined
    const hopPosition =
      hop.type === 'airdrome'
        ? getAirdromePosition(theatre, hop.name)
        : theatre.objectives.find((objective) => objective.name === hop.name)?.position
    return {
      type: hop.type,
      name: hop.name,
      distance: hopPosition ? calculateDistance(position, hopPosition) : 0
    }
  }

  const objectiveTarget = findNearestEnemyObjective(
    position,
    enemyObjectiveIds,
    theatre,
    reservedTargetObjectives,
    maxTargetRangeMeters
  )
  const airdromeTarget = findNearestEnemyAirdrome(
    draft,
    coalition,
    position,
    enemyAirdromeNames,
    theatre,
    reservedTargetAirdromes,
    maxTargetRangeMeters
  )

  if (!objectiveTarget) return airdromeTarget
  if (!airdromeTarget) return objectiveTarget
  return airdromeTarget.distance < objectiveTarget.distance ? airdromeTarget : objectiveTarget
}

function findNearestEnemyObjective(
  position: z.infer<typeof schemas.position>,
  enemyObjectiveIds: string[],
  theatre: z.infer<typeof schemas.theatre>,
  reservedTargetObjectives: ReadonlySet<string>,
  maxTargetRangeMeters: number
): GroundTarget | undefined {
  let nearestTarget: GroundTarget | undefined
  let nearestDist = Infinity

  for (const objId of enemyObjectiveIds) {
    if (reservedTargetObjectives.has(objId)) continue
    const objective = theatre.objectives.find((o) => o.name === objId)
    if (!objective) continue

    const dist = calculateDistance(position, objective.position)
    if (dist > maxTargetRangeMeters) continue

    if (dist < nearestDist) {
      nearestDist = dist
      nearestTarget = {
        type: 'objective',
        name: objId,
        distance: dist
      }
    }
  }

  return nearestTarget
}

function findNearestEnemyAirdrome(
  draft: z.infer<typeof schemas.campaign.campaign>,
  coalition: z.infer<typeof schemas.coalition>,
  position: z.infer<typeof schemas.position>,
  enemyAirdromeNames: string[],
  theatre: z.infer<typeof schemas.theatre>,
  reservedTargetAirdromes: ReadonlySet<string>,
  maxTargetRangeMeters: number
): GroundTarget | undefined {
  let nearestTarget: GroundTarget | undefined
  let nearestDist = Infinity

  for (const airdromeName of enemyAirdromeNames) {
    if (reservedTargetAirdromes.has(airdromeName)) continue
    if (!isAirdromeVulnerable(draft, theatre, coalition, airdromeName)) continue

    const airdromePosition = getAirdromePosition(theatre, airdromeName)
    if (!airdromePosition) continue

    const dist = calculateDistance(position, airdromePosition)
    if (dist > maxTargetRangeMeters) continue

    if (dist < nearestDist) {
      nearestDist = dist
      nearestTarget = {
        type: 'airdrome',
        name: airdromeName,
        distance: dist
      }
    }
  }

  return nearestTarget
}
