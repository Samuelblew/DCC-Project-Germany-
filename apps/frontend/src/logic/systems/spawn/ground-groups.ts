import { schemas } from '@dcc/contracts'
import {
  assignDeploymentSite,
  dissolveGroundGroupIntoReplacementPool,
  expandGroundGroupUnits,
  getGroundGroupUnitCount
} from '@dcc/campaign'
import { scenarios, theatres } from '@dcc/data'
import * as z from 'zod'
import { GroundGroup } from '../../entities/ground-group'
import { calculateDistance } from '@/logic/utils/calculate-distance'
import { INFANTRY_COST, VEHICLE_COST } from './ground-group-costs'
import { logSpawnAction } from '@/logic/simulation-log'
import { getAirdromePosition, isAirdromeVulnerable } from '../airport-capture'
import { BATTLE_RADIUS, hasOtherGarrison } from '../ground-garrison'

const MAX_SPAWNS_PER_TICK = 3
const NM_TO_METERS = 1852
const INFANTRY_MAX_TARGET_RANGE_METERS = 40 * NM_TO_METERS
const VEHICLE_MAX_TARGET_RANGE_METERS = 60 * NM_TO_METERS
const DEFAULT_GROUND_GROUP_SPAWN_MULTIPLIER = 1
/** Live formations a side may keep on the map. Barracks wait once this is full. */
export const MAX_LIVE_GROUND_GROUPS = 12
/** Idle stacks at one town. Columns already on the road do not count. */
export const MAX_LIVE_GROUND_GROUPS_PER_OBJECTIVE = 2
/** DCS units after expansion. Ten infantry squads of ten would be 100; this keeps the .miz loadable. */
export const MAX_LIVE_GROUND_UNITS = 80
/** Leave room for attacking columns instead of filling the cap with rear garrisons. */
export const MAX_IDLE_GARRISONS = 6

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
    // Barrack production enters the local pool before the authorized formation consumes it.
    pool.readyPersonnel += Math.max(0, params.count - pool.readyPersonnel)
    pool.readyPersonnel -= params.count
    return
  }

  const matching = pool.equipment.filter((equipment) => equipment.name === params.unitName)
  for (let index = matching.length; index < params.count; index += 1) {
    pool.equipment.push({
      id: crypto.randomUUID(),
      name: params.unitName,
      condition: 'operational'
    })
  }
  const selected = pool.equipment
    .filter((equipment) => equipment.name === params.unitName)
    .slice(0, params.count)
  const selectedIds = new Set(selected.map((equipment) => equipment.id))
  pool.equipment = pool.equipment.filter((equipment) => !selectedIds.has(equipment.id))
  params.group.units.forEach((unit, index) => {
    const equipment = selected[index]
    if (!equipment) return
    unit.id = equipment.id
    unit.condition = equipment.condition
  })
}

type Campaign = z.infer<typeof schemas.campaign.campaign>
type Coalition = z.infer<typeof schemas.coalition>
type Theatre = z.infer<typeof schemas.theatre>
type GroundGroupData = z.infer<typeof schemas.groundGroup>

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
  const groups = coalitionGroundGroups(draft, coalition)
  if (groups.length >= MAX_LIVE_GROUND_GROUPS) return false
  if (coalitionGroundUnitCount(draft, coalition) + extraUnits > MAX_LIVE_GROUND_UNITS) return false
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
    const crowdedObjective = [...new Set(groups.map((group) => group.objectiveId).filter(Boolean))]
      .map((objectiveId) => ({
        objectiveId: objectiveId!,
        groups: groupsHoldingObjective(draft, coalition, theatre, objectiveId!)
      }))
      .find((entry) => entry.groups.length > MAX_LIVE_GROUND_GROUPS_PER_OBJECTIVE)

    const overCoalition =
      groups.length > MAX_LIVE_GROUND_GROUPS || units > MAX_LIVE_GROUND_UNITS
    const tooManyIdle = idle > MAX_IDLE_GARRISONS
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
  const maxSpawnsThisTick = Math.max(
    0,
    Math.floor(
      MAX_SPAWNS_PER_TICK *
        (scenario.start[coalition].groundGroupSpawnMultiplier ??
          DEFAULT_GROUND_GROUP_SPAWN_MULTIPLIER)
    )
  )

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

  for (const structure of structures) {
    if (spawnsThisTick >= maxSpawnsThisTick) break

    // Only Barrack and Depot structures can spawn ground groups
    if (structure.type !== 'Barrack' && structure.type !== 'Depot') continue
    if (!canRaiseGroundGroup(draft, coalition, theatre, structure.objectiveId, 10)) continue

    const aliveBuildings = structure.buildings.filter((building) => building.alive)
    if (aliveBuildings.length === 0) continue

    for (let i = 0; i < aliveBuildings.length; i++) {
      if (spawnsThisTick >= maxSpawnsThisTick) break

      if (structure.type === 'Barrack' && (structure.resources || 0) >= INFANTRY_COST) {
        if (!canRaiseGroundGroup(draft, coalition, theatre, structure.objectiveId, 10)) break
        const infantryTypes = coalitionData.groundUnitTypes['Infantry']
        const unitName =
          infantryTypes && infantryTypes.length > 0
            ? infantryTypes[Math.floor(Math.random() * infantryTypes.length)]!
            : 'Infantry AK'

        const target = findNearestEnemyGroundTarget(
          draft,
          coalition,
          structure.position,
          enemyObjectiveIds,
          draft.coalitions[enemyCoalition].airdromeNames,
          theatre,
          reservedTargetObjectives,
          reservedTargetAirdromes,
          INFANTRY_MAX_TARGET_RANGE_METERS
        )
        const holding = hasOtherGarrison(draft, coalition, theatre, structure.objectiveId)
        if (!target && holding) continue
        if (
          !target &&
          idleGarrisonCount(draft, coalition, theatre) >= MAX_IDLE_GARRISONS
        ) {
          continue
        }

        const groundGroupId = GroundGroup.create(draft, coalition, {
          position: structure.position,
          objectiveId: structure.objectiveId,
          units: [{ name: unitName, count: 10 }],
          state: target ? 'moving' : 'idle',
          targetObjectiveId: target?.type === 'objective' ? target.name : undefined,
          targetAirdromeName: target?.type === 'airdrome' ? target.name : undefined
        })
        const groundGroup = draft.coalitions[coalition].groundGroups.find(
          (group) => group.id === groundGroupId
        )
        const site = groundGroup
          ? assignDeploymentSite({
              campaign: draft,
              coalition,
              theatre,
              group: groundGroup,
              objectiveId: structure.objectiveId,
              roles: ['infantry', 'staging'],
              reason: 'creation'
            })
          : null
        // A formation marching straight out does not need a free site; a garrison does.
        if (!groundGroup || (!site && !target)) {
          draft.coalitions[coalition].groundGroups = draft.coalitions[
            coalition
          ].groundGroups.filter((group) => group.id !== groundGroupId)
          continue
        }
        if (!site) expandGroundGroupUnits(groundGroup)
        consumeFormationAssets({
          draft,
          coalition,
          objectiveId: structure.objectiveId,
          group: groundGroup,
          kind: 'infantry',
          unitName,
          count: 10
        })
        // A formation that marches out frees its site for the next one.
        if (target) groundGroup.deployment = undefined
        if (target?.type === 'objective') reservedTargetObjectives.add(target.name)
        else if (target?.type === 'airdrome') reservedTargetAirdromes.add(target.name)
        const targetLabel =
          target?.type === 'objective'
            ? ` moving to ${target.name}`
            : target?.type === 'airdrome'
              ? ` moving to airport ${target.name}`
              : ''
        logSpawnAction(
          draft,
          coalition,
          `Ground group spawned at ${structure.objectiveId}: 10x ${unitName}${targetLabel}`,
          undefined,
          {
            entityType: 'groundGroup',
            entityId: groundGroupId
          }
        )
        structure.resources = (structure.resources || 0) - INFANTRY_COST
        spawnsThisTick++
      } else if (structure.type === 'Depot' && (structure.resources || 0) >= VEHICLE_COST) {
        if (!canRaiseGroundGroup(draft, coalition, theatre, structure.objectiveId, 6)) break
        const vehicleTypes = coalitionData.groundUnitTypes['Vehicle']
        const unitName =
          vehicleTypes && vehicleTypes.length > 0
            ? vehicleTypes[Math.floor(Math.random() * vehicleTypes.length)]!
            : 'BMP-2'

        const target = findNearestEnemyGroundTarget(
          draft,
          coalition,
          structure.position,
          enemyObjectiveIds,
          draft.coalitions[enemyCoalition].airdromeNames,
          theatre,
          reservedTargetObjectives,
          reservedTargetAirdromes,
          VEHICLE_MAX_TARGET_RANGE_METERS
        )
        const holding = hasOtherGarrison(draft, coalition, theatre, structure.objectiveId)
        if (!target && holding) continue
        if (
          !target &&
          idleGarrisonCount(draft, coalition, theatre) >= MAX_IDLE_GARRISONS
        ) {
          continue
        }

        const groundGroupId = GroundGroup.create(draft, coalition, {
          position: structure.position,
          objectiveId: structure.objectiveId,
          units: [{ name: unitName, count: 6 }],
          state: target ? 'moving' : 'idle',
          targetObjectiveId: target?.type === 'objective' ? target.name : undefined,
          targetAirdromeName: target?.type === 'airdrome' ? target.name : undefined
        })
        const groundGroup = draft.coalitions[coalition].groundGroups.find(
          (group) => group.id === groundGroupId
        )
        const site = groundGroup
          ? assignDeploymentSite({
              campaign: draft,
              coalition,
              theatre,
              group: groundGroup,
              objectiveId: structure.objectiveId,
              roles: ['vehicle', 'staging'],
              reason: 'creation'
            })
          : null
        // A formation marching straight out does not need a free site; a garrison does.
        if (!groundGroup || (!site && !target)) {
          draft.coalitions[coalition].groundGroups = draft.coalitions[
            coalition
          ].groundGroups.filter((group) => group.id !== groundGroupId)
          continue
        }
        if (!site) expandGroundGroupUnits(groundGroup)
        consumeFormationAssets({
          draft,
          coalition,
          objectiveId: structure.objectiveId,
          group: groundGroup,
          kind: 'vehicle',
          unitName,
          count: 6
        })
        // A formation that marches out frees its site for the next one.
        if (target) groundGroup.deployment = undefined
        if (target?.type === 'objective') reservedTargetObjectives.add(target.name)
        else if (target?.type === 'airdrome') reservedTargetAirdromes.add(target.name)
        const targetLabel =
          target?.type === 'objective'
            ? ` moving to ${target.name}`
            : target?.type === 'airdrome'
              ? ` moving to airport ${target.name}`
              : ''
        logSpawnAction(
          draft,
          coalition,
          `Ground group spawned at ${structure.objectiveId}: 6x ${unitName}${targetLabel}`,
          undefined,
          {
            entityType: 'groundGroup',
            entityId: groundGroupId
          }
        )
        structure.resources = (structure.resources || 0) - VEHICLE_COST
        spawnsThisTick++
      }
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
  enemyObjectiveIds: string[],
  enemyAirdromeNames: string[],
  theatre: z.infer<typeof schemas.theatre>,
  reservedTargetObjectives: ReadonlySet<string>,
  reservedTargetAirdromes: ReadonlySet<string>,
  maxTargetRangeMeters: number
): GroundTarget | undefined {
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
