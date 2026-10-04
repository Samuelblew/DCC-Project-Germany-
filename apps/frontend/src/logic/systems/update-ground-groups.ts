import { schemas } from '@dcc/contracts'
import {
  assignDeploymentSite,
  beginGroundGroupRetreat,
  classifyGroundUnit,
  dissolveGroundGroupIntoReplacementPool,
  getGroundGroupCombatPower,
  getGroundGroupUnitCount,
  recordInfantryCasualties,
  updateReplacementPools
} from '@dcc/campaign'
import { scenarios, theatres } from '@dcc/data'
import * as z from 'zod'
import { calculateDistance } from '@/logic/utils/calculate-distance'
import { logCombatAction } from '@/logic/simulation-log'
import { updateCampaignGoal } from './campaign-goal'
import {
  getAirdromePosition,
  isAirdromeVulnerable,
  transferAirdromeOwnership
} from './airport-capture'
import { BATTLE_RADIUS, hasOtherGarrison } from './ground-garrison'
import { INFANTRY_COST, VEHICLE_COST } from './spawn/ground-group-costs'

type Campaign = z.infer<typeof schemas.campaign.campaign>
type Coalition = z.infer<typeof schemas.coalition>
type GroundGroup = z.infer<typeof schemas.groundGroup>
type SupplyStatus = z.infer<typeof schemas.supplyStatus>

const INFANTRY_SPEED = 8 // m/s (~29 km/h, motor march — 4 m/s left hops taking a campaign afternoon)
const VEHICLE_SPEED = 16 // m/s (~58 km/h)
const NM_TO_METERS = 1852
const INFANTRY_MAX_TARGET_RANGE_METERS = 40 * NM_TO_METERS
const VEHICLE_MAX_TARGET_RANGE_METERS = 60 * NM_TO_METERS
const CAPTURE_DISTANCE = 2000 // meters
/** Opposing columns this close stop and fight where they meet instead of passing each other. */
const ENGAGEMENT_RADIUS = 3000 // meters
/**
 * Losses per campaign second per 10 points of enemy power. Two comparable formations take roughly
 * 30-60 campaign minutes to break one another, which leaves room for CAS and interdiction.
 */
const BASE_ATTRITION_PER_SECOND = 0.003
const DEFENDER_BONUS = 1.2
const MIN_TACTICAL_ADVANTAGE = 1.2
const MAX_TACTICAL_ADVANTAGE = 1.4

type BattleSide = 'attacker' | 'defender'

function getRandomTacticalAdvantage(): { side: BattleSide; multiplier: number } {
  return {
    side: Math.random() < 0.5 ? 'attacker' : 'defender',
    multiplier:
      MIN_TACTICAL_ADVANTAGE + Math.random() * (MAX_TACTICAL_ADVANTAGE - MIN_TACTICAL_ADVANTAGE)
  }
}

function isInfantryGroup(units: { name: string; count: number }[]): boolean {
  return units.every((u) => /infantry|soldier/i.test(u.name))
}

function getUnitCount(group: GroundGroup): number {
  return getGroundGroupUnitCount(group)
}

function getTotalUnitCount(groups: GroundGroup[]): number {
  return groups.reduce((sum, group) => sum + getUnitCount(group), 0)
}

function getGroupPower(group: GroundGroup): number {
  return getGroundGroupCombatPower(group)
}

function getInfantryCount(groups: GroundGroup[]): number {
  return groups.reduce(
    (sum, group) =>
      sum +
      group.units.reduce(
        (groupSum, unit) =>
          groupSum + (classifyGroundUnit(unit.name) === 'infantry' ? unit.count : 0),
        0
      ),
    0
  )
}

function getSupplyCombatMultiplier(status: SupplyStatus | undefined): number {
  switch (status) {
    case 'abundant':
      return 1.1
    case 'adequate':
      return 1.0
    case 'low':
      return 0.8
    case 'critical':
      return 0.6
    case 'depleted':
      return 0.35
    default:
      return 1.0
  }
}

function clearCombatState(group: GroundGroup): void {
  if (group.state === 'combat') {
    group.state = 'moving'
  }
  group.combatStartedAt = undefined
  group.initialStrength = undefined
}

function clearCaptureState(group: GroundGroup): void {
  group.captureStartedAt = undefined
}

function clearTargetState(group: GroundGroup): void {
  group.targetObjectiveId = undefined
  group.targetAirdromeName = undefined
}

function setCombatState(group: GroundGroup, nowIso: string): void {
  group.state = 'combat'
  group.combatStartedAt = group.combatStartedAt ?? nowIso
  group.initialStrength = group.initialStrength ?? getUnitCount(group)
}

const APPROACH_MIN_OFFSET = 300 // meters
const APPROACH_OFFSET_SPREAD = 600 // meters

function hashGroupId(id: string): number {
  let hash = 2166136261
  for (let index = 0; index < id.length; index++) {
    hash ^= id.charCodeAt(index)
    hash = Math.imul(hash, 16777619)
  }
  return hash >>> 0
}

/**
 * Each group converges on its own point around the target (well inside CAPTURE_DISTANCE),
 * otherwise groups sharing a formation layout end up stacked on the exact same spot.
 */
function getApproachPosition(
  group: GroundGroup,
  targetPosition: z.infer<typeof schemas.position>
): z.infer<typeof schemas.position> {
  const hash = hashGroupId(group.id)
  const angle = ((hash & 0xffff) / 0x10000) * Math.PI * 2
  const radius = APPROACH_MIN_OFFSET + ((hash >>> 16) / 0x10000) * APPROACH_OFFSET_SPREAD
  return {
    x: targetPosition.x + Math.cos(angle) * radius,
    y: targetPosition.y + Math.sin(angle) * radius
  }
}

function translateGroup(group: GroundGroup, position: z.infer<typeof schemas.position>): void {
  const moveX = position.x - group.position.x
  const moveY = position.y - group.position.y
  group.position = { x: position.x, y: position.y }
  for (const unit of group.units) {
    if (!unit.position) continue
    unit.position.x += moveX
    unit.position.y += moveY
  }
}

function redeployCapturingGroup(
  draft: Campaign,
  coalition: Coalition,
  theatre: z.infer<typeof schemas.theatre>,
  group: GroundGroup,
  objectiveId: string
): void {
  assignDeploymentSite({
    campaign: draft,
    coalition,
    theatre,
    group,
    objectiveId,
    roles: isInfantryGroup(group.units)
      ? ['infantry', 'defensive', 'staging']
      : ['vehicle', 'defensive', 'staging'],
    reason: 'capture'
  })
}

function moveGroupTowardsObjective(
  group: GroundGroup,
  targetPosition: z.infer<typeof schemas.position>,
  delta: number,
  timeMultiplier: number
): void {
  const distance = calculateDistance(group.position, targetPosition)
  if (distance === 0) return

  const campaignDeltaS = (delta * timeMultiplier) / 1000
  const speed = isInfantryGroup(group.units) ? INFANTRY_SPEED : VEHICLE_SPEED
  const ratio = Math.min((speed * campaignDeltaS) / distance, 1)
  const dx = targetPosition.x - group.position.x
  const dy = targetPosition.y - group.position.y

  const moveX = dx * ratio
  const moveY = dy * ratio
  group.position.x += moveX
  group.position.y += moveY
  for (const unit of group.units) {
    if (!unit.position) continue
    unit.position.x += moveX
    unit.position.y += moveY
  }
}

function recordBattleWounded(params: {
  draft: Campaign
  coalition: Coalition
  groups: GroundGroup[]
  infantryBefore: number
  objectiveId: string
  position: z.infer<typeof schemas.position>
  seed: string
}) {
  const infantryLosses = Math.max(0, params.infantryBefore - getInfantryCount(params.groups))
  if (infantryLosses <= 0) return
  const siteId = params.groups.find((group) => group.deployment?.siteId)?.deployment?.siteId
  recordInfantryCasualties({
    campaign: params.draft,
    coalition: params.coalition,
    objectiveId: params.objectiveId,
    siteId,
    position: params.position,
    count: infantryLosses,
    seed: params.seed
  })
}

function triggerDepletedRetreats(
  draft: Campaign,
  coalition: Coalition,
  theatre: z.infer<typeof schemas.theatre>,
  groups: GroundGroup[]
) {
  for (const group of groups) {
    if (!draft.coalitions[coalition].groundGroups.some((entry) => entry.id === group.id)) continue
    const state = beginGroundGroupRetreat({ campaign: draft, coalition, theatre, group })
    if (!state) continue
    logCombatAction(draft, coalition, `${group.id} is ${state.replace('-', ' ')}`, undefined, {
      entityType: 'groundGroup',
      entityId: group.id
    })
  }
}

function applyCasualties(
  group: GroundGroup,
  expectedLosses: number,
  maxCasualties = Infinity
): number {
  if (expectedLosses <= 0 || group.units.length === 0) return 0

  let casualties = Math.floor(expectedLosses)
  if (Math.random() < expectedLosses - casualties) {
    casualties += 1
  }
  casualties = Math.min(casualties, maxCasualties)
  if (casualties <= 0) return 0

  let applied = 0
  while (casualties > 0 && group.units.length > 0) {
    let maxIdx = 0
    for (let i = 1; i < group.units.length; i++) {
      if (group.units[i]!.count > group.units[maxIdx]!.count) {
        maxIdx = i
      }
    }

    const unit = group.units[maxIdx]
    if (!unit || unit.count <= 0) break

    unit.count -= 1
    casualties -= 1
    applied += 1

    if (unit.count <= 0) {
      group.units.splice(maxIdx, 1)
    }
  }

  return applied
}

function distributeCasualties(
  groups: GroundGroup[],
  expectedLosses: number,
  preserveOneUnit = false
): number {
  if (expectedLosses <= 0 || groups.length === 0) return 0

  const powers = groups.map((group) => Math.max(getGroupPower(group), 1))
  const totalPower = powers.reduce((sum, power) => sum + power, 0)
  if (totalPower <= 0) return 0

  let remainingCasualtyLimit = preserveOneUnit
    ? Math.max(0, groups.reduce((sum, group) => sum + getUnitCount(group), 0) - 1)
    : Number.POSITIVE_INFINITY

  let totalApplied = 0
  groups.forEach((group, idx) => {
    if (remainingCasualtyLimit <= 0) return

    const groupExpectedLosses = expectedLosses * (powers[idx]! / totalPower)
    const applied = applyCasualties(group, groupExpectedLosses, remainingCasualtyLimit)
    totalApplied += applied
    remainingCasualtyLimit -= applied
  })
  return totalApplied
}

function cleanupDestroyedGroups(draft: Campaign, coalition: Coalition): void {
  draft.coalitions[coalition].groundGroups = draft.coalitions[coalition].groundGroups.filter(
    (group) => getUnitCount(group) > 0
  )
}

function getCombatPower(
  draft: Campaign,
  coalition: Coalition,
  groups: GroundGroup[],
  fallbackObjectiveId: string,
  defenderSide: boolean
): number {
  const supplyNodes = draft.coalitions[coalition].supplyNodes

  return groups.reduce((sum, group) => {
    const supplyObjectiveId = group.objectiveId ?? fallbackObjectiveId
    const supplyStatus = supplyNodes?.[supplyObjectiveId]?.status
    const supplyMultiplier = getSupplyCombatMultiplier(supplyStatus)
    const defenderMultiplier = defenderSide ? DEFENDER_BONUS : 1
    return sum + getGroupPower(group) * supplyMultiplier * defenderMultiplier
  }, 0)
}

function fightBattle(params: {
  draft: Campaign
  theatre: z.infer<typeof schemas.theatre>
  delta: number
  /** Where the fight happens, as it reads in the log: "at Vacha", "at airport Fulda". */
  label: string
  position: z.infer<typeof schemas.position>
  attackerCoalition: Coalition
  attackers: GroundGroup[]
  /** Supply node and casualty destination for the attackers; field fights may have none. */
  attackerObjectiveId?: string
  defenderCoalition: Coalition
  defenders: GroundGroup[]
  defenderObjectiveId?: string
  /** Defenders dug in at an objective fight with DEFENDER_BONUS; columns meeting in the field do not. */
  defenderHoldsGround: boolean
}): void {
  const { draft, attackers, defenders, attackerCoalition, defenderCoalition } = params
  const nowIso = draft.time.toISOString()
  const enteringCombatCount =
    attackers.filter((attacker) => attacker.combatStartedAt == null).length +
    defenders.filter((defender) => defender.combatStartedAt == null).length

  attackers.forEach((attacker) => {
    setCombatState(attacker, nowIso)
    clearCaptureState(attacker)
  })
  defenders.forEach((defender) => setCombatState(defender, nowIso))

  const primaryAttacker = attackers[0]
  const primaryAttackerRef = primaryAttacker
    ? { entityType: 'groundGroup' as const, entityId: primaryAttacker.id }
    : undefined
  if (enteringCombatCount > 0) {
    logCombatAction(
      draft,
      attackerCoalition,
      `Ground battle started ${params.label} (${attackers.length} attackers vs ${defenders.length} defenders)`,
      undefined,
      primaryAttackerRef
    )
  }

  const deltaS = (params.delta * draft.timeMultiplier) / 1000
  const tacticalAdvantage = getRandomTacticalAdvantage()
  const attackerPower =
    getCombatPower(draft, attackerCoalition, attackers, params.attackerObjectiveId ?? '', false) *
    (tacticalAdvantage.side === 'attacker' ? tacticalAdvantage.multiplier : 1)
  const defenderPower =
    getCombatPower(
      draft,
      defenderCoalition,
      defenders,
      params.defenderObjectiveId ?? '',
      params.defenderHoldsGround
    ) * (tacticalAdvantage.side === 'defender' ? tacticalAdvantage.multiplier : 1)

  const expectedAttackerLosses = BASE_ATTRITION_PER_SECOND * deltaS * (defenderPower / 10)
  const expectedDefenderLosses = BASE_ATTRITION_PER_SECOND * deltaS * (attackerPower / 10)
  const mutualDestructionPossible =
    Math.ceil(expectedAttackerLosses) >= getTotalUnitCount(attackers) &&
    Math.ceil(expectedDefenderLosses) >= getTotalUnitCount(defenders)

  const attackerInfantryBefore = getInfantryCount(attackers)
  const defenderInfantryBefore = getInfantryCount(defenders)
  const attackerCasualties = distributeCasualties(
    attackers,
    expectedAttackerLosses,
    mutualDestructionPossible && tacticalAdvantage.side === 'attacker'
  )
  const defenderCasualties = distributeCasualties(
    defenders,
    expectedDefenderLosses,
    mutualDestructionPossible && tacticalAdvantage.side === 'defender'
  )

  if (attackerCasualties > 0 || defenderCasualties > 0) {
    logCombatAction(
      draft,
      attackerCoalition,
      `Ground combat ${params.label}: losses ${attackerCoalition}=${attackerCasualties}, ${defenderCoalition}=${defenderCasualties}`,
      undefined,
      primaryAttackerRef
    )
  }

  cleanupDestroyedGroups(draft, attackerCoalition)
  cleanupDestroyedGroups(draft, defenderCoalition)
  for (const side of [
    {
      coalition: attackerCoalition,
      groups: attackers,
      infantryBefore: attackerInfantryBefore,
      objectiveId: params.attackerObjectiveId
    },
    {
      coalition: defenderCoalition,
      groups: defenders,
      infantryBefore: defenderInfantryBefore,
      objectiveId: params.defenderObjectiveId
    }
  ]) {
    if (!side.objectiveId) continue
    recordBattleWounded({
      draft,
      coalition: side.coalition,
      groups: side.groups,
      infantryBefore: side.infantryBefore,
      objectiveId: side.objectiveId,
      position: params.position,
      seed: `${side.objectiveId}:${nowIso}:${side.coalition}`
    })
  }
  triggerDepletedRetreats(draft, attackerCoalition, params.theatre, attackers)
  triggerDepletedRetreats(draft, defenderCoalition, params.theatre, defenders)
}

function isWithinBattleRadius(group: GroundGroup, position: z.infer<typeof schemas.position>) {
  return calculateDistance(group.position, position) <= BATTLE_RADIUS
}

function groupsHoldingPosition(
  groups: GroundGroup[],
  position: z.infer<typeof schemas.position>,
  radius: number
) {
  return groups.filter(
    (group) => getUnitCount(group) > 0 && calculateDistance(group.position, position) <= radius
  )
}

/** Town falls when the assaulting force inside capture range outweighs whoever is still fighting. */
function canOccupyObjective(
  draft: Campaign,
  coalition: Coalition,
  enemyCoalition: Coalition,
  position: z.infer<typeof schemas.position>
) {
  const occupying = groupsHoldingPosition(
    draft.coalitions[coalition].groundGroups,
    position,
    CAPTURE_DISTANCE
  )
  if (occupying.length === 0) return false
  const defenders = groupsHoldingPosition(
    draft.coalitions[enemyCoalition].groundGroups,
    position,
    BATTLE_RADIUS
  )
  if (defenders.length === 0) return true
  const attackerPower = occupying.reduce((sum, group) => sum + getGroupPower(group), 0)
  const defenderPower =
    defenders.reduce((sum, group) => sum + getGroupPower(group), 0) * DEFENDER_BONUS
  return attackerPower >= defenderPower
}

function forceRemainingDefendersToRetreat(
  draft: Campaign,
  coalition: Coalition,
  theatre: z.infer<typeof schemas.theatre>,
  position: z.infer<typeof schemas.position>
) {
  for (const group of groupsHoldingPosition(
    draft.coalitions[coalition].groundGroups,
    position,
    BATTLE_RADIUS
  )) {
    beginGroundGroupRetreat({ campaign: draft, coalition, theatre, group })
  }
}

function resolveObjectiveBattle(
  draft: Campaign,
  coalition: Coalition,
  enemyCoalition: Coalition,
  theatre: z.infer<typeof schemas.theatre>,
  targetObjectiveId: string,
  delta: number
): void {
  const targetObjective = theatre.objectives.find(
    (objective) => objective.name === targetObjectiveId
  )
  if (!targetObjective) return

  const enemyObjectiveIds = draft.coalitions[enemyCoalition].objectiveIds
  const ownGroundGroups = draft.coalitions[coalition].groundGroups

  const attackers = ownGroundGroups.filter(
    (group) => group.targetObjectiveId === targetObjectiveId && group.state !== 'idle'
  )
  if (attackers.length === 0) return

  if (!enemyObjectiveIds.includes(targetObjectiveId)) {
    for (const attacker of attackers) {
      clearCombatState(attacker)
      clearCaptureState(attacker)
      attacker.state = 'idle'
      clearTargetState(attacker)
    }
    return
  }

  const nearestAttackerDistance = Math.min(
    ...attackers.map((attacker) => calculateDistance(attacker.position, targetObjective.position))
  )
  // Only formations that reached the objective fight for it; columns still en route keep moving.
  const engagedAttackers = attackers.filter((attacker) =>
    isWithinBattleRadius(attacker, targetObjective.position)
  )

  const defendersInRange = draft.coalitions[enemyCoalition].groundGroups.filter(
    (group) => getUnitCount(group) > 0 && isWithinBattleRadius(group, targetObjective.position)
  )

  if (defendersInRange.length > 0 && engagedAttackers.length > 0) {
    fightBattle({
      draft,
      theatre,
      delta,
      label: `at ${targetObjectiveId}`,
      position: targetObjective.position,
      attackerCoalition: coalition,
      attackers: engagedAttackers,
      attackerObjectiveId: targetObjectiveId,
      defenderCoalition: enemyCoalition,
      defenders: defendersInRange,
      defenderObjectiveId: targetObjectiveId,
      defenderHoldsGround: true
    })
    if (!canOccupyObjective(draft, coalition, enemyCoalition, targetObjective.position)) return
    forceRemainingDefendersToRetreat(
      draft,
      enemyCoalition,
      theatre,
      targetObjective.position
    )
  }

  for (const attacker of engagedAttackers) {
    clearCombatState(attacker)
  }

  if (nearestAttackerDistance > CAPTURE_DISTANCE) {
    for (const attacker of attackers) {
      clearCaptureState(attacker)
    }
    return
  }

  let nearestAttacker: GroundGroup | undefined
  let nearestDistance = Number.POSITIVE_INFINITY
  for (const attacker of attackers) {
    const distance = calculateDistance(attacker.position, targetObjective.position)
    if (distance < nearestDistance) {
      nearestDistance = distance
      nearestAttacker = attacker
    }
  }
  if (!nearestAttacker) return

  for (const attacker of attackers) {
    if (attacker.id !== nearestAttacker.id) {
      clearCaptureState(attacker)
    }
  }

  const enemyObjectiveIndex = enemyObjectiveIds.indexOf(targetObjectiveId)
  if (enemyObjectiveIndex !== -1) {
    enemyObjectiveIds.splice(enemyObjectiveIndex, 1)
  }
  draft.coalitions[coalition].objectiveIds.push(targetObjectiveId)
  logCombatAction(draft, coalition, `Objective captured: ${targetObjectiveId}`)
  updateCampaignGoal(draft)

  const capturedStructures = draft.coalitions[enemyCoalition].structures.filter(
    (structure) => structure.objectiveId === targetObjectiveId
  )
  draft.coalitions[enemyCoalition].structures = draft.coalitions[enemyCoalition].structures.filter(
    (structure) => structure.objectiveId !== targetObjectiveId
  )
  // The enemy stockpile is lost, but the town keeps enough to raise one follow-on column.
  // Zeroing it left the capturers idle as last garrison and the next town out of range of the
  // original barrack, so the ground war died after the first belt.
  for (const structure of capturedStructures) {
    structure.resources =
      structure.type === 'Barrack'
        ? INFANTRY_COST
        : structure.type === 'Depot'
          ? VEHICLE_COST
          : 0
  }
  draft.coalitions[coalition].structures.push(...capturedStructures)

  const enemySupplyNodes = draft.coalitions[enemyCoalition].supplyNodes
  const capturedSupply = enemySupplyNodes?.[targetObjectiveId]
  if (enemySupplyNodes && capturedSupply) {
    const ownSupplyNodes = (draft.coalitions[coalition].supplyNodes ??= {})
    ownSupplyNodes[targetObjectiveId] = capturedSupply
    delete enemySupplyNodes[targetObjectiveId]
  }

  const enemyPools = draft.coalitions[enemyCoalition].replacementPools
  const capturedPool = enemyPools?.[targetObjectiveId]
  if (enemyPools && capturedPool) {
    const ownPools = (draft.coalitions[coalition].replacementPools ??= {})
    ownPools[targetObjectiveId] = capturedPool
    delete enemyPools[targetObjectiveId]
  }

  draft.coalitions[enemyCoalition].samGroups = draft.coalitions[enemyCoalition].samGroups.filter(
    (samGroup) => samGroup.objectiveId !== targetObjectiveId
  )

  draft.coalitions[enemyCoalition].groundGroups = draft.coalitions[
    enemyCoalition
  ].groundGroups.filter(
    (group) => !(group.objectiveId === targetObjectiveId && group.state === 'idle')
  )

  // Attackers at the objective become its defenders. Columns still en route pick a new target
  // once they notice the objective is friendly.
  for (const attacker of draft.coalitions[coalition].groundGroups) {
    if (attacker.targetObjectiveId !== targetObjectiveId) continue
    if (!isWithinBattleRadius(attacker, targetObjective.position)) continue
    clearCombatState(attacker)
    clearCaptureState(attacker)
    attacker.state = 'idle'
    attacker.objectiveId = targetObjectiveId
    clearTargetState(attacker)
    redeployCapturingGroup(draft, coalition, theatre, attacker, targetObjectiveId)
  }
}

function resolveAirdromeBattle(
  draft: Campaign,
  coalition: Coalition,
  enemyCoalition: Coalition,
  theatre: z.infer<typeof schemas.theatre>,
  targetAirdromeName: string,
  delta: number
): void {
  const targetPosition = getAirdromePosition(theatre, targetAirdromeName)
  if (!targetPosition) return

  const enemyAirdromeNames = draft.coalitions[enemyCoalition].airdromeNames
  const ownGroundGroups = draft.coalitions[coalition].groundGroups

  const attackers = ownGroundGroups.filter(
    (group) => group.targetAirdromeName === targetAirdromeName && group.state !== 'idle'
  )
  if (attackers.length === 0) return

  if (!enemyAirdromeNames.includes(targetAirdromeName)) {
    for (const attacker of attackers) {
      clearCombatState(attacker)
      clearCaptureState(attacker)
      attacker.state = 'idle'
      clearTargetState(attacker)
    }
    return
  }

  if (!isAirdromeVulnerable(draft, theatre, coalition, targetAirdromeName)) {
    for (const attacker of attackers) {
      clearCombatState(attacker)
      clearCaptureState(attacker)
    }
    return
  }

  const nearestAttackerDistance = Math.min(
    ...attackers.map((attacker) => calculateDistance(attacker.position, targetPosition))
  )
  const engagedAttackers = attackers.filter((attacker) =>
    isWithinBattleRadius(attacker, targetPosition)
  )

  const defendersInRange = draft.coalitions[enemyCoalition].groundGroups.filter(
    (group) => getUnitCount(group) > 0 && isWithinBattleRadius(group, targetPosition)
  )

  if (defendersInRange.length > 0 && engagedAttackers.length > 0) {
    fightBattle({
      draft,
      theatre,
      delta,
      label: `at airport ${targetAirdromeName}`,
      position: targetPosition,
      attackerCoalition: coalition,
      attackers: engagedAttackers,
      attackerObjectiveId: targetAirdromeName,
      defenderCoalition: enemyCoalition,
      defenders: defendersInRange,
      defenderObjectiveId: targetAirdromeName,
      defenderHoldsGround: true
    })
    if (!canOccupyObjective(draft, coalition, enemyCoalition, targetPosition)) return
    forceRemainingDefendersToRetreat(draft, enemyCoalition, theatre, targetPosition)
  }

  for (const attacker of engagedAttackers) {
    clearCombatState(attacker)
  }

  if (nearestAttackerDistance > CAPTURE_DISTANCE) {
    for (const attacker of attackers) {
      clearCaptureState(attacker)
    }
    return
  }

  transferAirdromeOwnership(draft, coalition, enemyCoalition, targetAirdromeName)
  logCombatAction(draft, coalition, `Airport captured: ${targetAirdromeName}`)

  draft.coalitions[enemyCoalition].groundGroups = draft.coalitions[
    enemyCoalition
  ].groundGroups.filter(
    (group) =>
      !(group.objectiveId === targetAirdromeName && isWithinBattleRadius(group, targetPosition))
  )

  for (const attacker of draft.coalitions[coalition].groundGroups) {
    if (attacker.targetAirdromeName !== targetAirdromeName) continue
    if (!isWithinBattleRadius(attacker, targetPosition)) continue
    clearCombatState(attacker)
    clearCaptureState(attacker)
    attacker.state = 'idle'
    attacker.objectiveId = targetAirdromeName
    translateGroup(attacker, getApproachPosition(attacker, targetPosition))
    clearTargetState(attacker)
    redeployCapturingGroup(draft, coalition, theatre, attacker, targetAirdromeName)
  }
}

function processObjectiveBattlesAndCaptures(
  draft: Campaign,
  coalition: Coalition,
  enemyCoalition: Coalition,
  theatre: z.infer<typeof schemas.theatre>,
  delta: number
): void {
  const targetObjectiveIds = Array.from(
    new Set(
      draft.coalitions[coalition].groundGroups
        .map((group) => {
          if (group.state === 'idle') return undefined
          return group.targetObjectiveId
        })
        .filter((targetObjectiveId): targetObjectiveId is string => targetObjectiveId != null)
    )
  )

  for (const targetObjectiveId of targetObjectiveIds) {
    if (isObjectiveBattleLocked(draft, coalition, targetObjectiveId)) continue
    resolveObjectiveBattle(draft, coalition, enemyCoalition, theatre, targetObjectiveId, delta)
  }

  const targetAirdromeNames = Array.from(
    new Set(
      draft.coalitions[coalition].groundGroups
        .map((group) => {
          if (group.state === 'idle') return undefined
          return group.targetAirdromeName
        })
        .filter((targetAirdromeName): targetAirdromeName is string => targetAirdromeName != null)
    )
  )

  for (const targetAirdromeName of targetAirdromeNames) {
    if (isAirdromeBattleLocked(draft, coalition, targetAirdromeName)) continue
    resolveAirdromeBattle(draft, coalition, enemyCoalition, theatre, targetAirdromeName, delta)
  }
}

type UpdateGroundGroupsOptions = {
  capture?: boolean
  move?: boolean
}

function isActiveGroundBattleLock(
  lock: NonNullable<Campaign['groundBattleLocks']>[number],
  now: Date
) {
  return lock.expiresAt > now
}

function isObjectiveBattleLocked(draft: Campaign, coalition: Coalition, objectiveId: string) {
  return (draft.groundBattleLocks ?? []).some(
    (lock) =>
      isActiveGroundBattleLock(lock, draft.time) &&
      lock.attackerCoalition === coalition &&
      lock.targetObjectiveId === objectiveId
  )
}

function isAirdromeBattleLocked(draft: Campaign, coalition: Coalition, airdromeName: string) {
  return (draft.groundBattleLocks ?? []).some(
    (lock) =>
      isActiveGroundBattleLock(lock, draft.time) &&
      lock.attackerCoalition === coalition &&
      lock.targetAirdromeName === airdromeName
  )
}

function isGroundGroupLocked(draft: Campaign, coalition: Coalition, groupId: string) {
  return (draft.groundBattleLocks ?? []).some(
    (lock) =>
      isActiveGroundBattleLock(lock, draft.time) &&
      ((lock.attackerCoalition === coalition && lock.attackerGroupIds.includes(groupId)) ||
        (lock.defenderCoalition === coalition && lock.defenderGroupIds.includes(groupId)))
  )
}

function assignNextGroundTarget(
  draft: Campaign,
  coalition: Coalition,
  theatre: z.infer<typeof schemas.theatre>,
  group: GroundGroup,
  enemyObjectiveIds: string[],
  enemyAirdromeNames: string[]
): void {
  if (group.targetObjectiveId || group.targetAirdromeName) return
  if (isLastGarrison(draft, coalition, theatre, group)) {
    if (canObjectiveRaiseTroops(draft, coalition, group.objectiveId)) return
    if (coalitionHasAttackingColumn(draft, coalition, group.id)) return
  }

  const maxRange = isInfantryGroup(group.units)
    ? INFANTRY_MAX_TARGET_RANGE_METERS
    : VEHICLE_MAX_TARGET_RANGE_METERS
  let nearestDistance = Infinity
  let targetObjectiveId: string | undefined
  let targetAirdromeName: string | undefined

  for (const objectiveId of enemyObjectiveIds) {
    const objective = theatre.objectives.find((entry) => entry.name === objectiveId)
    if (!objective) continue
    const distance = calculateDistance(group.position, objective.position)
    if (distance > maxRange || distance >= nearestDistance) continue
    nearestDistance = distance
    targetObjectiveId = objectiveId
    targetAirdromeName = undefined
  }

  for (const airdromeName of enemyAirdromeNames) {
    if (!isAirdromeVulnerable(draft, theatre, coalition, airdromeName)) continue
    const position = getAirdromePosition(theatre, airdromeName)
    if (!position) continue
    const distance = calculateDistance(group.position, position)
    if (distance > maxRange || distance >= nearestDistance) continue
    nearestDistance = distance
    targetObjectiveId = undefined
    targetAirdromeName = airdromeName
  }

  if (!targetObjectiveId && !targetAirdromeName) {
    returnStrandedGroup(draft, coalition, theatre, group)
    return
  }
  group.state = 'moving'
  group.targetObjectiveId = targetObjectiveId
  group.targetAirdromeName = targetAirdromeName
  // The formation left its site; free it so the objective can raise a replacement.
  group.deployment = undefined
}

function getObjectiveOrAirdromePosition(
  theatre: z.infer<typeof schemas.theatre>,
  objectiveId: string
) {
  return (
    theatre.objectives.find((objective) => objective.name === objectiveId)?.position ??
    getAirdromePosition(theatre, objectiveId)
  )
}

/**
 * A formation left idle in the open (its target fell to someone else and nothing is in reach) marches
 * to the nearest owned objective and joins its replacement pool, instead of idling in the field.
 */
function returnStrandedGroup(
  draft: Campaign,
  coalition: Coalition,
  theatre: z.infer<typeof schemas.theatre>,
  group: GroundGroup
) {
  let nearest: { id: string; position: z.infer<typeof schemas.position> } | undefined
  let nearestDistance = Number.POSITIVE_INFINITY
  const owned = draft.coalitions[coalition]
  for (const objectiveId of [...owned.objectiveIds, ...owned.airdromeNames]) {
    const position = getObjectiveOrAirdromePosition(theatre, objectiveId)
    if (!position) continue
    const distance = calculateDistance(group.position, position)
    if (distance <= BATTLE_RADIUS) return // already holding an owned objective
    if (distance < nearestDistance) {
      nearestDistance = distance
      nearest = { id: objectiveId, position }
    }
  }
  if (!nearest) return
  group.state = 'withdrawing'
  group.deployment = undefined
  group.retreat = {
    destinationObjectiveId: nearest.id,
    route: [{ ...nearest.position }],
    startedAt: draft.time.toISOString()
  }
}

/** A formation holding its own objective stays there unless another idle formation takes over. */
function isLastGarrison(
  draft: Campaign,
  coalition: Coalition,
  theatre: z.infer<typeof schemas.theatre>,
  group: GroundGroup
) {
  if (!group.objectiveId) return false
  const home = getObjectiveOrAirdromePosition(theatre, group.objectiveId)
  if (!home || !isWithinBattleRadius(group, home)) return false
  if (!draft.coalitions[coalition].objectiveIds.includes(group.objectiveId)) {
    const airdromes = draft.coalitions[coalition].airdromeNames
    if (!airdromes.includes(group.objectiveId)) return false
  }
  return !hasOtherGarrison(draft, coalition, theatre, group.objectiveId, group.id)
}

function canObjectiveRaiseTroops(
  draft: Campaign,
  coalition: Coalition,
  objectiveId: string | undefined
) {
  if (!objectiveId) return false
  return draft.coalitions[coalition].structures.some(
    (structure) =>
      structure.objectiveId === objectiveId &&
      (structure.type === 'Barrack' || structure.type === 'Depot') &&
      structure.buildings.some((building) => building.alive)
  )
}

function coalitionHasAttackingColumn(draft: Campaign, coalition: Coalition, excludedGroupId: string) {
  return draft.coalitions[coalition].groundGroups.some(
    (group) =>
      group.id !== excludedGroupId &&
      getUnitCount(group) > 0 &&
      (group.state === 'moving' || group.state === 'combat') &&
      (group.targetObjectiveId != null || group.targetAirdromeName != null)
  )
}

function isFieldCombatant(group: GroundGroup, theatre: z.infer<typeof schemas.theatre>) {
  if (group.state !== 'moving' && group.state !== 'combat') return false
  if (getUnitCount(group) === 0) return false
  const targetId = group.targetObjectiveId ?? group.targetAirdromeName
  if (!targetId) return false
  // A formation already at its target is fighting for the objective, not in the field.
  const target = getObjectiveOrAirdromePosition(theatre, targetId)
  return !target || !isWithinBattleRadius(group, target)
}

function findFieldContact(
  draft: Campaign,
  enemyCoalition: Coalition,
  theatre: z.infer<typeof schemas.theatre>,
  group: GroundGroup
) {
  return draft.coalitions[enemyCoalition].groundGroups.find(
    (enemy) =>
      isFieldCombatant(enemy, theatre) &&
      !isGroundGroupLocked(draft, enemyCoalition, enemy.id) &&
      calculateDistance(enemy.position, group.position) <= ENGAGEMENT_RADIUS
  )
}

/**
 * Opposing columns that meet on the road fight there. Runs once per logic tick, after both
 * coalitions resolved their objective battles. Each cluster of formations in contact is one fight;
 * formations no longer in contact resume their march.
 */
export function resolveFieldEngagements(draft: Campaign, delta: number): void {
  const scenario = scenarios.find((s) => s.id === draft.scenarioId)
  const theatre = scenario && theatres.find((t) => t.name === scenario.theatreName)
  if (!theatre) return

  // Formations locked to a flown mission are fought in DCS, not here.
  const candidates = (coalition: Coalition) =>
    draft.coalitions[coalition].groundGroups.filter(
      (group) =>
        isFieldCombatant(group, theatre) && !isGroundGroupLocked(draft, coalition, group.id)
    )
  const player = candidates('player')
  const opponent = candidates('opponent')

  // Union-find over contacts so a column meeting two enemy columns fights both at once.
  const parent = new Map<string, string>()
  const find = (id: string): string => {
    const next = parent.get(id) ?? id
    if (next === id) return id
    const root = find(next)
    parent.set(id, root)
    return root
  }
  const inContact = new Set<string>()
  for (const own of player) {
    for (const enemy of opponent) {
      if (calculateDistance(own.position, enemy.position) > ENGAGEMENT_RADIUS) continue
      parent.set(find(`player:${own.id}`), find(`opponent:${enemy.id}`))
      inContact.add(`player:${own.id}`)
      inContact.add(`opponent:${enemy.id}`)
    }
  }

  for (const [coalition, groups] of [
    ['player', player],
    ['opponent', opponent]
  ] as const) {
    for (const group of groups) {
      if (group.state === 'combat' && !inContact.has(`${coalition}:${group.id}`)) {
        clearCombatState(group)
      }
    }
  }

  const engagements = new Map<string, { player: GroundGroup[]; opponent: GroundGroup[] }>()
  for (const [coalition, groups] of [
    ['player', player],
    ['opponent', opponent]
  ] as const) {
    for (const group of groups) {
      const key = `${coalition}:${group.id}`
      if (!inContact.has(key)) continue
      const root = find(key)
      const engagement = engagements.get(root) ?? { player: [], opponent: [] }
      engagement[coalition].push(group)
      engagements.set(root, engagement)
    }
  }

  for (const engagement of engagements.values()) {
    const all = [...engagement.player, ...engagement.opponent]
    const position = {
      x: all.reduce((sum, group) => sum + group.position.x, 0) / all.length,
      y: all.reduce((sum, group) => sum + group.position.y, 0) / all.length
    }
    const near = engagement.player[0]?.targetObjectiveId ?? engagement.player[0]?.targetAirdromeName
    fightBattle({
      draft,
      theatre,
      delta,
      label: near ? `on the road to ${near}` : 'in the field',
      position,
      attackerCoalition: 'player',
      attackers: engagement.player,
      attackerObjectiveId: engagement.player[0]?.objectiveId,
      defenderCoalition: 'opponent',
      defenders: engagement.opponent,
      defenderObjectiveId: engagement.opponent[0]?.objectiveId,
      defenderHoldsGround: false
    })
  }
}

export function updateGroundGroups(
  draft: Campaign,
  coalition: Coalition,
  delta: number,
  options: UpdateGroundGroupsOptions = {}
): void {
  const scenario = scenarios.find((s) => s.id === draft.scenarioId)
  if (!scenario) return

  const theatre = theatres.find((t) => t.name === scenario.theatreName)
  if (!theatre) return

  const captureEnabled = options.capture ?? true
  const moveEnabled = options.move ?? true
  const enemyCoalition: Coalition = coalition === 'player' ? 'opponent' : 'player'
  updateReplacementPools(draft, coalition)
  if (captureEnabled && !moveEnabled) {
    processObjectiveBattlesAndCaptures(draft, coalition, enemyCoalition, theatre, delta)
  }

  const groundGroups = draft.coalitions[coalition].groundGroups
  const enemyObjectiveIds = draft.coalitions[enemyCoalition].objectiveIds
  const enemyAirdromeNames = draft.coalitions[enemyCoalition].airdromeNames
  const recoveredGroups: Array<{ group: GroundGroup; objectiveId: string }> = []
  const surrenderedGroupIds = new Set<string>()

  for (const group of groundGroups) {
    if (group.state === 'withdrawing') {
      const waypoint = group.retreat?.route[0]
      if (waypoint && moveEnabled) {
        moveGroupTowardsObjective(group, waypoint, delta, draft.timeMultiplier)
        if (calculateDistance(group.position, waypoint) < 1) {
          group.retreat?.route.shift()
        }
      }
      if (
        group.retreat?.destinationObjectiveId &&
        (group.retreat.route.length === 0 || !waypoint)
      ) {
        recoveredGroups.push({
          group,
          objectiveId: group.retreat.destinationObjectiveId
        })
      }
      continue
    }

    if (group.state === 'awaiting-extraction' || group.state === 'trapped') {
      const surrenderAt = group.retreat?.surrenderAt
      if (surrenderAt && new Date(surrenderAt) <= draft.time) {
        surrenderedGroupIds.add(group.id)
        const captor = draft.coalitions[enemyCoalition]
        captor.capturedEquipment ??= []
        for (const unit of group.units) {
          if (classifyGroundUnit(unit.name) === 'infantry') {
            captor.capturedPersonnel = (captor.capturedPersonnel ?? 0) + unit.count
          } else {
            captor.capturedEquipment.push({
              id: unit.id ?? `${group.id}-${unit.name}`,
              name: unit.name,
              condition: unit.condition ?? 'operational'
            })
          }
        }
        const request = draft.coalitions[coalition].extractionRequests?.find(
          (entry) => entry.id === group.retreat?.extractionRequestId
        )
        if (request && request.status !== 'delivered') request.status = 'failed'
        logCombatAction(draft, coalition, `${group.id} surrendered`, undefined, {
          entityType: 'groundGroup',
          entityId: group.id
        })
      }
      continue
    }

    if (group.state === 'idle') {
      if (moveEnabled) {
        assignNextGroundTarget(
          draft,
          coalition,
          theatre,
          group,
          enemyObjectiveIds,
          enemyAirdromeNames
        )
      }
      if (group.state === 'idle') continue
    }
    if (isGroundGroupLocked(draft, coalition, group.id)) continue
    if (group.targetObjectiveId && group.targetAirdromeName) {
      group.targetAirdromeName = undefined
    }
    if (!group.targetObjectiveId && !group.targetAirdromeName) continue

    const targetPosition = group.targetObjectiveId
      ? theatre.objectives.find((objective) => objective.name === group.targetObjectiveId)?.position
      : group.targetAirdromeName
        ? getAirdromePosition(theatre, group.targetAirdromeName)
        : undefined

    if (!targetPosition) {
      clearCombatState(group)
      clearCaptureState(group)
      group.state = 'idle'
      clearTargetState(group)
      continue
    }

    if (group.targetObjectiveId && !enemyObjectiveIds.includes(group.targetObjectiveId)) {
      clearCombatState(group)
      clearCaptureState(group)
      group.state = 'idle'
      clearTargetState(group)
      continue
    }

    if (
      group.targetAirdromeName &&
      (!enemyAirdromeNames.includes(group.targetAirdromeName) ||
        !isAirdromeVulnerable(draft, theatre, coalition, group.targetAirdromeName))
    ) {
      clearCombatState(group)
      clearCaptureState(group)
      continue
    }

    if (group.state === 'combat') {
      // Road fights stay put. An assault that has already contacted the garrison keeps closing
      // to capture range — combat used to freeze them 5 km out, short of the 2 km occupy line.
      if (
        moveEnabled &&
        targetPosition &&
        !findFieldContact(draft, enemyCoalition, theatre, group) &&
        calculateDistance(group.position, targetPosition) > CAPTURE_DISTANCE
      ) {
        moveGroupTowardsObjective(
          group,
          getApproachPosition(group, targetPosition),
          delta,
          draft.timeMultiplier
        )
      }
      continue
    }

    if (moveEnabled && isFieldCombatant(group, theatre)) {
      // Halt both columns on contact; resolveFieldEngagements fights it out on the logic tick.
      const contact = findFieldContact(draft, enemyCoalition, theatre, group)
      if (contact) {
        group.state = 'combat'
        contact.state = 'combat'
        continue
      }
    }

    if (moveEnabled) {
      moveGroupTowardsObjective(
        group,
        getApproachPosition(group, targetPosition),
        delta,
        draft.timeMultiplier
      )
    }
  }

  for (const recovered of recoveredGroups) {
    assignDeploymentSite({
      campaign: draft,
      coalition,
      theatre,
      group: recovered.group,
      objectiveId: recovered.objectiveId,
      roles: ['recovery', 'reserve'],
      reason: 'retreat'
    })
    dissolveGroundGroupIntoReplacementPool({
      campaign: draft,
      coalition,
      group: recovered.group,
      objectiveId: recovered.objectiveId
    })
    logCombatAction(
      draft,
      coalition,
      `${recovered.group.id} reached ${recovered.objectiveId} and entered the replacement pool`
    )
  }

  if (surrenderedGroupIds.size > 0) {
    draft.coalitions[coalition].groundGroups = draft.coalitions[coalition].groundGroups.filter(
      (group) => !surrenderedGroupIds.has(group.id)
    )
  }
}
