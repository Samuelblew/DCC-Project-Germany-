import { config, resolveAirActivity, schemas } from '@dcc/contracts'
import { evaluateCombatViability, getGroundGroupUnitCount } from '@dcc/campaign'
import { aircrafts } from '@dcc/data'
import * as z from 'zod'

import { CapFlightGroup } from '../../../entities/cap-flight-group'
import { DeadFlightGroup } from '../../../entities/dead-flight-group'
import { SeadFlightGroup } from '../../../entities/sead-flight-group'
import { StrikeFlightGroup } from '../../../entities/strike-flight-group'
import { TransportFlightGroup } from '../../../entities/transport-flight-group'
import {
  buildCasMissionWaypoints,
  spawnPlannedFlightGroup
} from '../../../entities/flight-group-spawn'
import { getObjectivePosition } from '@/logic/utils/get-objective-position'
import { getClosestThreateningSam } from '@/logic/utils/threat-analyzer'
import { calculateDistance } from '@/logic/utils/calculate-distance'
import { getIadsEmitterTargets } from '@/logic/iads-emitter-targets'
import {
  getCoalitionAirdromes,
  getCoalitionCasHomeBases,
  pickRandomAircraftType,
  selectCapPatrolAssignment,
  selectHomeBaseAndTarget,
  type AirdromeSelection,
  type SpawnContext
} from './common'
import {
  canSupportFlightLogistics,
  ensureVirtualSupply,
  getFlightLogisticsCost,
  getNodeSupply,
  spendFlightLogistics
} from '../../update-supply'

type Campaign = z.infer<typeof schemas.campaign.campaign>
type Coalition = z.infer<typeof schemas.coalition>
type Position = z.infer<typeof schemas.position>
type AircraftName = z.infer<typeof schemas.dcs.aircraftName>
type FlightTask = z.infer<typeof schemas.flightGroup>['task']
type MissionPackage = z.infer<typeof schemas.missionPackage>
type PackageMemberRole = z.infer<typeof schemas.packageMemberRole>
type OperationProfile = NonNullable<Campaign['operationProfile']>
type GroundBattleLock = NonNullable<Campaign['groundBattleLocks']>[number]
type CasVariantId = 'defensive-cas' | 'troops-in-contact' | 'armed-recon'
type CapVariantId = 'point-defense-cap' | 'barrier-cap' | 'forward-sweep'
type StrikeVariantId = 'frontline-raid' | 'logistics-strike' | 'deep-interdiction'
type DeadVariantId = 'escort-dead' | 'standalone-dead'
type AtoVariantId = CasVariantId | CapVariantId | StrikeVariantId | DeadVariantId

export type AtoPackageKind = 'cap' | 'strike' | 'strategicStrike' | 'dead' | 'cas' | 'transport'

export type AtoRejectionReason =
  | 'budget exhausted'
  | 'cooldown active'
  | 'duplicate target'
  | 'no aircraft'
  | 'no source'
  | 'no target'
  | 'out of range'
  | 'supply blocked'

type FlightPlanDescriptor = {
  role: PackageMemberRole
  task: FlightTask
  aircraftType: AircraftName
  homeBase: AirdromeSelection
  targetPosition: Position
  target?: NonNullable<z.infer<typeof schemas.flightGroup>['target']> & {
    position?: Position
    buildings?: z.infer<typeof schemas.structureBuilding>[]
  }
  patrolCenter?: Position
  tot?: Date
  transport?: {
    sourceNode: string
    destinationNode: string
    destinationPosition: Position
    cargoAmount: number
    transportType: 'strategic' | 'tactical' | 'emergency'
  }
}

export type AtoPackagePlan = {
  id: string
  kind: AtoPackageKind
  type: MissionPackage['type']
  coalition: Coalition
  priority: number
  reason: string
  targetId: string
  targetObjectiveId: string
  targetType: string
  variantId?: AtoVariantId
  variantLabel?: string
  battleLock?: Omit<GroundBattleLock, 'id' | 'packageId'>
  tot: Date
  flights: FlightPlanDescriptor[]
}

export type RejectedAtoPackage = {
  kind: AtoPackageKind
  reason: AtoRejectionReason
  targetId?: string
  detail?: string
}

export type AtoPlannerPolicy = {
  maxNewPackagesPerLogicTick: number
  maxActivePackages: number
  maxActiveAircraft: number
  packageLookaheadMs: number
  enableTransport: boolean
}

export type AtoPlannerResult = {
  admitted: AtoPackagePlan[]
  candidates: AtoPackagePlan[]
  rejected: RejectedAtoPackage[]
}

export const defaultAtoPlannerPolicy: AtoPlannerPolicy = {
  maxNewPackagesPerLogicTick: 2,
  maxActivePackages: 8,
  maxActiveAircraft: 28,
  packageLookaheadMs: 90 * 60 * 1000,
  enableTransport: false
}

/** Per-task active limits follow the campaign's air activity multiplier. */
function scaledMaxActive(draft: Campaign, base: number) {
  return Math.max(1, Math.round(base * resolveAirActivity(draft.campaignParams?.airActivity)))
}

function hasAircraft(draft: Campaign, coalition: Coalition, task: FlightTask) {
  return getAvailableAircraftTypes(draft, coalition, task).length > 0
}

function pickAircraft(draft: Campaign, coalition: Coalition, task: FlightTask) {
  return pickRandomAircraftType(getAvailableAircraftTypes(draft, coalition, task))
}

function getAvailableAircraftTypes(draft: Campaign, coalition: Coalition, task: FlightTask) {
  const configuredAircraftTypes = draft.coalitions[coalition].aircraftTypes[task] ?? []
  if (configuredAircraftTypes.length > 0 || task !== 'DEAD') {
    return configuredAircraftTypes
  }

  const coalitionAircraftTypes = new Set(
    Object.values(draft.coalitions[coalition].aircraftTypes).flat()
  )

  return [...coalitionAircraftTypes].filter((aircraftType) =>
    Object.values(aircrafts).some(
      (aircraft) => aircraft.name === aircraftType && aircraft.availableTasks.includes(task)
    )
  )
}

function activeTaskCount(draft: Campaign, coalition: Coalition, task: FlightTask) {
  return draft.coalitions[coalition].flightGroups.filter((group) => group.task === task).length
}

function activeAircraftCount(draft: Campaign, coalition: Coalition) {
  return draft.coalitions[coalition].flightGroups.reduce(
    (sum, group) => sum + group.aircrafts.length,
    0
  )
}

function getFlightAircraftCount(flight: FlightPlanDescriptor) {
  return getTaskAircraftCount(flight.task)
}

function getTaskAircraftCount(task: FlightTask) {
  if (task === 'Strategic Strike') {
    return config.packages['Strategic Strike'].maxAircraftsPerGroup
  }
  const packageConfig = config.packages[task as keyof typeof config.packages]
  return packageConfig && 'aircraftsPerGroup' in packageConfig ? packageConfig.aircraftsPerGroup : 1
}

function getPlanAircraftCount(plan: AtoPackagePlan) {
  return plan.flights.reduce((sum, flight) => sum + getFlightAircraftCount(flight), 0)
}

function isTargetAlreadyAssigned(draft: Campaign, coalition: Coalition, targetId: string) {
  return draft.coalitions[coalition].flightGroups.some((group) => group.target?.id === targetId)
}

function collectExistingPackageTargetIds(draft: Campaign, coalition: Coalition) {
  return new Set(
    draft.coalitions[coalition].flightGroups
      .map((group) => group.target?.id)
      .filter((id): id is string => id != null)
  )
}

function activeAutomaticCapHomeBases(draft: Campaign, coalition: Coalition) {
  return new Set(
    draft.coalitions[coalition].flightGroups
      .filter((group) => group.task === 'CAP' && group.spawnSource !== 'manual')
      .map((group) => group.homeBase)
  )
}

function createPlanId(kind: AtoPackageKind, targetId: string) {
  return `planned-${kind}-${targetId}`
}

function addMinutes(date: Date, minutes: number) {
  return new Date(date.getTime() + minutes * 60 * 1000)
}

function getGroundUnitCount(group: Campaign['coalitions']['player']['groundGroups'][number]) {
  return getGroundGroupUnitCount(group)
}

function getDefaultOperationProfile(draft: Campaign): OperationProfile {
  return (
    draft.operationProfile ?? {
      archetype: 'balanced',
      frontlineShape: 'linear',
      tempo: 'standard',
      initiativeCoalition: undefined
    }
  )
}

function findNearbyDefenderGroupIds(
  draft: Campaign,
  defenderCoalition: Coalition,
  targetPosition: Position,
  radiusMeters = 7000
) {
  return draft.coalitions[defenderCoalition].groundGroups
    .filter(
      (group) =>
        getGroundUnitCount(group) > 0 &&
        calculateDistance(group.position, targetPosition) <= radiusMeters
    )
    .map((group) => group.id)
}

function createBattleLockPlan(params: {
  draft: Campaign
  coalition: Coalition
  attackerCoalition: Coalition
  defenderCoalition: Coalition
  attackerGroupId: string
  defenderGroupIds: string[]
  targetObjectiveId?: string
  targetAirdromeName?: string
}): AtoPackagePlan['battleLock'] {
  return {
    coalition: params.coalition,
    attackerCoalition: params.attackerCoalition,
    defenderCoalition: params.defenderCoalition,
    attackerGroupIds: [params.attackerGroupId],
    defenderGroupIds: params.defenderGroupIds,
    targetObjectiveId: params.targetObjectiveId,
    targetAirdromeName: params.targetAirdromeName,
    expiresAt: addMinutes(params.draft.time, 120)
  }
}

function getSupplySpawnModifier(draft: Campaign, coalition: Coalition, airbaseName: string) {
  const supply = getNodeSupply(draft, coalition, airbaseName)
  if (!supply) return 1

  switch (supply.status) {
    case 'abundant':
    case 'adequate':
    case 'low':
      return 1
    case 'critical':
      return 0.5
    case 'depleted':
      return 0
  }
}

function isAirbaseSupplyBlocked(draft: Campaign, coalition: Coalition, airbaseName: string) {
  return getSupplySpawnModifier(draft, coalition, airbaseName) <= 0
}

function canHomeBaseSupportTask(
  draft: Campaign,
  coalition: Coalition,
  homeBase: AirdromeSelection,
  task: FlightTask
) {
  return (
    !isAirbaseSupplyBlocked(draft, coalition, homeBase.name) &&
    canSupportFlightLogistics(
      getNodeSupply(draft, coalition, homeBase.name),
      task,
      getTaskAircraftCount(task)
    )
  )
}

function getSupportedHomeBases(
  draft: Campaign,
  coalition: Coalition,
  homeBases: AirdromeSelection[],
  task: FlightTask
) {
  return homeBases.filter((homeBase) => canHomeBaseSupportTask(draft, coalition, homeBase, task))
}

type LogisticsBudget = {
  supply: number
  fuel: number
  munitions: number
  repair: number
}

function getFlightLogisticsBudget(flight: FlightPlanDescriptor): LogisticsBudget {
  const aircraftCount = getFlightAircraftCount(flight)
  return getFlightLogisticsCost(flight.task, aircraftCount)
}

function getAirbaseLogisticsBudget(
  draft: Campaign,
  coalition: Coalition,
  airbaseName: string,
  remainingByAirbase: Map<string, LogisticsBudget>
): LogisticsBudget | null {
  const cached = remainingByAirbase.get(airbaseName)
  if (cached) return cached

  const supply = getNodeSupply(draft, coalition, airbaseName)
  if (!supply) return null

  ensureVirtualSupply(supply, draft.coalitions[coalition].airdromeNames.includes(airbaseName))
  const budget = {
    supply: supply.current,
    fuel: supply.fuel?.current ?? 0,
    munitions: supply.munitions?.current ?? 0,
    repair: supply.repair?.current ?? 0
  }
  remainingByAirbase.set(airbaseName, budget)
  return budget
}

function reservePlanLogistics(
  draft: Campaign,
  coalition: Coalition,
  plan: AtoPackagePlan,
  remainingByAirbase: Map<string, LogisticsBudget>
): boolean {
  const reservations: Array<{ budget: LogisticsBudget; cost: LogisticsBudget }> = []

  for (const flight of plan.flights) {
    const budget = getAirbaseLogisticsBudget(
      draft,
      coalition,
      flight.homeBase.name,
      remainingByAirbase
    )
    if (!budget) continue

    const cost = getFlightLogisticsBudget(flight)
    if (
      budget.supply < cost.supply ||
      budget.fuel < cost.fuel ||
      budget.munitions < cost.munitions ||
      budget.repair < cost.repair
    ) {
      return false
    }
    reservations.push({ budget, cost })
  }

  for (const reservation of reservations) {
    reservation.budget.supply -= reservation.cost.supply
    reservation.budget.fuel -= reservation.cost.fuel
    reservation.budget.munitions -= reservation.cost.munitions
    reservation.budget.repair -= reservation.cost.repair
  }

  return true
}

function pushRejection(
  rejected: RejectedAtoPackage[],
  kind: AtoPackageKind,
  reason: AtoRejectionReason,
  targetId?: string,
  detail?: string
) {
  rejected.push({ kind, reason, targetId, detail })
}

function makeCapPlan(
  draft: Campaign,
  coalition: Coalition,
  context: SpawnContext,
  rejected: RejectedAtoPackage[]
): AtoPackagePlan | null {
  if (
    activeTaskCount(draft, coalition, 'CAP') >=
    scaledMaxActive(draft, config.packages.CAP.maxActive[coalition])
  ) {
    pushRejection(rejected, 'cap', 'budget exhausted')
    return null
  }
  if (!hasAircraft(draft, coalition, 'CAP')) {
    pushRejection(rejected, 'cap', 'no aircraft')
    return null
  }

  const allHomeBases = getCoalitionAirdromes(draft, context.theatre, coalition)
  const homeBases = getSupportedHomeBases(draft, coalition, allHomeBases, 'CAP')
  if (allHomeBases.length > 0 && homeBases.length === 0) {
    pushRejection(rejected, 'cap', 'supply blocked')
    return null
  }

  const enemyAirdromes = getCoalitionAirdromes(draft, context.theatre, context.enemyCoalition)
  const assignment = selectCapPatrolAssignment({
    homeBases,
    enemyAirdromes,
    coveredHomeBases: activeAutomaticCapHomeBases(draft, coalition),
    maxHomeToEnemyDistance: config.packages.CAP.maxDistance * 2
  })
  if (!assignment) {
    pushRejection(rejected, 'cap', 'no target')
    return null
  }
  if (isAirbaseSupplyBlocked(draft, coalition, assignment.homeBase.name)) {
    pushRejection(rejected, 'cap', 'supply blocked', assignment.homeBase.name)
    return null
  }

  const aircraftType = pickAircraft(draft, coalition, 'CAP')
  if (!aircraftType) {
    pushRejection(rejected, 'cap', 'no aircraft')
    return null
  }

  const targetId = assignment.homeBase.name
  const tot = addMinutes(draft.time, 20)
  return {
    id: createPlanId('cap', targetId),
    kind: 'cap',
    type: 'CAP Package',
    coalition,
    priority: 70,
    reason: 'Uncovered CAP lane',
    targetId,
    targetObjectiveId: targetId,
    targetType: 'airspace',
    tot,
    flights: [
      {
        role: 'cap',
        task: 'CAP',
        aircraftType,
        homeBase: assignment.homeBase,
        targetPosition: assignment.patrolCenter,
        patrolCenter: assignment.patrolCenter
      }
    ]
  }
}

function makeStrikePlan(
  draft: Campaign,
  coalition: Coalition,
  context: SpawnContext,
  task: 'Pinpoint Strike' | 'Strategic Strike',
  rejected: RejectedAtoPackage[]
): AtoPackagePlan | null {
  const kind: AtoPackageKind = task === 'Strategic Strike' ? 'strategicStrike' : 'strike'
  if (task === 'Strategic Strike' && coalition !== 'opponent') return null
  if (
    activeTaskCount(draft, coalition, task) >=
    scaledMaxActive(draft, config.packages[task].maxActive[coalition])
  ) {
    pushRejection(rejected, kind, 'budget exhausted')
    return null
  }
  if (!hasAircraft(draft, coalition, task)) {
    pushRejection(rejected, kind, 'no aircraft')
    return null
  }

  const cooldownUntil = draft.coalitions[coalition].strategicStrikeCooldownUntil
  if (task === 'Strategic Strike' && cooldownUntil && draft.time < cooldownUntil) {
    pushRejection(rejected, kind, 'cooldown active', undefined, cooldownUntil.toISOString())
    return null
  }

  const allHomeBases = getCoalitionAirdromes(draft, context.theatre, coalition)
  const homeBases = getSupportedHomeBases(draft, coalition, allHomeBases, task)
  if (allHomeBases.length > 0 && homeBases.length === 0) {
    pushRejection(rejected, kind, 'supply blocked')
    return null
  }

  const targets = draft.coalitions[context.enemyCoalition].structures
    .filter((structure) => !isTargetAlreadyAssigned(draft, coalition, structure.id))
    .map((structure) => {
      const position = getObjectivePosition(context.theatre, structure.objectiveId)
      return position
        ? {
            target: {
              id: structure.id,
              type: structure.type,
              objectiveId: structure.objectiveId,
              position: structure.position,
              buildings: structure.buildings
            },
            position
          }
        : null
    })
    .filter((target): target is NonNullable<typeof target> => target != null)

  if (targets.length === 0) {
    pushRejection(rejected, kind, 'no target')
    return null
  }

  const assignment = selectHomeBaseAndTarget({
    homeBases,
    targets,
    maxDistance: config.packages[task].maxDistance,
    preference: task === 'Strategic Strike' ? 'farthest' : 'random'
  })
  if (!assignment) {
    pushRejection(rejected, kind, 'out of range')
    return null
  }
  if (isAirbaseSupplyBlocked(draft, coalition, assignment.homeBase.name)) {
    pushRejection(rejected, kind, 'supply blocked', assignment.homeBase.name)
    return null
  }

  const aircraftType = pickAircraft(draft, coalition, task)
  if (!aircraftType) {
    pushRejection(rejected, kind, 'no aircraft')
    return null
  }

  const flights: FlightPlanDescriptor[] = [
    {
      role: 'primary',
      task,
      aircraftType,
      homeBase: assignment.homeBase,
      target: assignment.target,
      targetPosition: assignment.targetPosition
    }
  ]

  const threateningSam = getClosestThreateningSam(
    assignment.targetPosition,
    draft.coalitions[context.enemyCoalition].samGroups,
    context.theatre,
    draft,
    context.enemyCoalition
  )
  const canAddSead =
    threateningSam != null &&
    hasAircraft(draft, coalition, 'SEAD') &&
    activeTaskCount(draft, coalition, 'SEAD') <
      scaledMaxActive(draft, config.packages.SEAD.maxActive[coalition])

  if (threateningSam && canAddSead) {
    const seadAircraftType = pickAircraft(draft, coalition, 'SEAD')
    if (seadAircraftType) {
      flights.push({
        role: 'sead',
        task: 'SEAD',
        aircraftType: seadAircraftType,
        homeBase: assignment.homeBase,
        target: {
          id: threateningSam.samGroup.id,
          type: threateningSam.samGroup.type,
          objectiveId: threateningSam.samGroup.objectiveId
        },
        targetPosition: threateningSam.position
      })
    }
  }

  const tot = addMinutes(draft.time, task === 'Strategic Strike' ? 50 : 40)
  return {
    id: createPlanId(kind, assignment.target.id),
    kind,
    type:
      task === 'Strategic Strike' && flights.some((flight) => flight.task === 'SEAD')
        ? 'SEAD Strategic Strike Package'
        : flights.some((flight) => flight.task === 'SEAD')
          ? 'SEAD Strike Package'
          : 'Strike Package',
    coalition,
    priority:
      (task === 'Strategic Strike' ? 55 : 65) +
      (flights.some((flight) => flight.task === 'SEAD') ? 10 : 0),
    reason: flights.some((flight) => flight.task === 'SEAD')
      ? 'Strike target covered by SAM'
      : 'Reachable strike target',
    targetId: assignment.target.id,
    targetObjectiveId: assignment.target.objectiveId,
    targetType: assignment.target.type,
    tot,
    flights
  }
}

function makeDeadPlan(
  draft: Campaign,
  coalition: Coalition,
  context: SpawnContext,
  rejected: RejectedAtoPackage[]
): AtoPackagePlan | null {
  if (
    activeTaskCount(draft, coalition, 'DEAD') >=
    scaledMaxActive(draft, config.packages.DEAD.maxActive[coalition])
  ) {
    pushRejection(rejected, 'dead', 'budget exhausted')
    return null
  }
  if (!hasAircraft(draft, coalition, 'DEAD')) {
    pushRejection(rejected, 'dead', 'no aircraft')
    return null
  }

  const existingTargets = collectExistingPackageTargetIds(draft, coalition)
  const targets = getIadsEmitterTargets(draft, context.enemyCoalition, context.theatre, 'DEAD')
    .filter((emitter) => !existingTargets.has(emitter.target.id))
    .sort((a, b) => Number(b.operational) - Number(a.operational))

  if (targets.length === 0) {
    pushRejection(rejected, 'dead', 'no target')
    return null
  }

  const allHomeBases = getCoalitionAirdromes(draft, context.theatre, coalition)
  const homeBases = getSupportedHomeBases(draft, coalition, allHomeBases, 'DEAD')
  if (allHomeBases.length > 0 && homeBases.length === 0) {
    pushRejection(rejected, 'dead', 'supply blocked')
    return null
  }

  const assignment = selectHomeBaseAndTarget({
    homeBases,
    targets,
    maxDistance: config.packages.DEAD.maxDistance,
    preference: 'nearest'
  })
  if (!assignment) {
    pushRejection(rejected, 'dead', 'out of range')
    return null
  }
  if (isAirbaseSupplyBlocked(draft, coalition, assignment.homeBase.name)) {
    pushRejection(rejected, 'dead', 'supply blocked', assignment.homeBase.name)
    return null
  }

  const aircraftType = pickAircraft(draft, coalition, 'DEAD')
  if (!aircraftType) {
    pushRejection(rejected, 'dead', 'no aircraft')
    return null
  }

  return {
    id: createPlanId('dead', assignment.target.id),
    kind: 'dead',
    type: 'DEAD Package',
    coalition,
    priority: targets[0]?.operational ? 82 : 72,
    reason: 'Nearest untargeted radar emitter',
    targetId: assignment.target.id,
    targetObjectiveId: assignment.target.objectiveId,
    targetType: assignment.target.type,
    tot: addMinutes(draft.time, 40),
    flights: [
      {
        role: 'dead',
        task: 'DEAD',
        aircraftType,
        homeBase: assignment.homeBase,
        target: assignment.target,
        targetPosition: assignment.targetPosition
      }
    ]
  }
}

function makeCasPlans(
  draft: Campaign,
  coalition: Coalition,
  context: SpawnContext,
  rejected: RejectedAtoPackage[]
): AtoPackagePlan[] {
  if (
    activeTaskCount(draft, coalition, 'CAS') >=
    scaledMaxActive(draft, config.packages.CAS.maxActive[coalition])
  ) {
    pushRejection(rejected, 'cas', 'budget exhausted')
    return []
  }
  if (!hasAircraft(draft, coalition, 'CAS')) {
    pushRejection(rejected, 'cas', 'no aircraft')
    return []
  }

  const existingTargets = collectExistingPackageTargetIds(draft, coalition)
  const aircraftType = pickAircraft(draft, coalition, 'CAS')
  if (!aircraftType) {
    pushRejection(rejected, 'cas', 'no aircraft')
    return []
  }
  const allHomeBases = getCoalitionCasHomeBases(draft, context.theatre, coalition, aircraftType)
  const homeBases = getSupportedHomeBases(draft, coalition, allHomeBases, 'CAS')
  if (allHomeBases.length > 0 && homeBases.length === 0) {
    pushRejection(rejected, 'cas', 'supply blocked')
    return []
  }

  const friendlyObjectiveIds = new Set(draft.coalitions[coalition].objectiveIds)
  const friendlyAirdromeNames = new Set(draft.coalitions[coalition].airdromeNames)
  const enemyGroundGroups = draft.coalitions[context.enemyCoalition].groundGroups.filter(
    (group) => evaluateCombatViability(group).casEligible && !existingTargets.has(group.id)
  )
  const plans: AtoPackagePlan[] = []

  const createCasPlan = (params: {
    variantId: CasVariantId
    variantLabel: string
    reason: string
    priority: number
    group: (typeof enemyGroundGroups)[number]
    targetObjectiveId: string
    targetPosition: Position
    threatenedPosition?: Position
  }): AtoPackagePlan | null => {
    const assignment = selectHomeBaseAndTarget({
      homeBases,
      targets: [
        {
          target: {
            id: params.group.id,
            type: 'Ground Group',
            objectiveId: params.targetObjectiveId
          },
          position: params.targetPosition
        }
      ],
      maxDistance: config.packages.CAS.maxDistance
    })

    if (!assignment) {
      pushRejection(rejected, 'cas', 'out of range', params.group.id)
      return null
    }
    if (isAirbaseSupplyBlocked(draft, coalition, assignment.homeBase.name)) {
      pushRejection(rejected, 'cas', 'supply blocked', assignment.homeBase.name)
      return null
    }

    const defenderGroupIds =
      params.threatenedPosition != null
        ? findNearbyDefenderGroupIds(draft, coalition, params.threatenedPosition)
        : []
    const battleLock =
      params.variantId === 'defensive-cas' || params.variantId === 'troops-in-contact'
        ? createBattleLockPlan({
            draft,
            coalition,
            attackerCoalition: context.enemyCoalition,
            defenderCoalition: coalition,
            attackerGroupId: params.group.id,
            defenderGroupIds,
            targetObjectiveId: friendlyObjectiveIds.has(params.targetObjectiveId)
              ? params.targetObjectiveId
              : undefined,
            targetAirdromeName: friendlyAirdromeNames.has(params.targetObjectiveId)
              ? params.targetObjectiveId
              : undefined
          })
        : undefined

    return {
      id: createPlanId('cas', `${params.variantId}-${params.group.id}`),
      kind: 'cas',
      type: 'CAS Package',
      coalition,
      priority: params.priority,
      reason: params.reason,
      targetId: params.group.id,
      targetObjectiveId: params.targetObjectiveId,
      targetType: 'Ground Group',
      variantId: params.variantId,
      variantLabel: params.variantLabel,
      battleLock,
      tot: addMinutes(draft.time, params.variantId === 'armed-recon' ? 38 : 25),
      flights: [
        {
          role: 'cas',
          task: 'CAS',
          aircraftType,
          homeBase: assignment.homeBase,
          target: assignment.target,
          targetPosition: assignment.targetPosition
        }
      ]
    }
  }

  for (const group of enemyGroundGroups) {
    if (!group.targetObjectiveId || !friendlyObjectiveIds.has(group.targetObjectiveId)) continue
    const threatenedPosition = getObjectivePosition(context.theatre, group.targetObjectiveId)
    if (!threatenedPosition) continue
    const distanceToThreatenedObjective = calculateDistance(group.position, threatenedPosition)
    if (distanceToThreatenedObjective > 18_000) continue

    const plan = createCasPlan({
      variantId: group.state === 'combat' ? 'troops-in-contact' : 'defensive-cas',
      variantLabel: group.state === 'combat' ? 'Troops In Contact' : 'Defensive CAS',
      reason:
        group.state === 'combat'
          ? `Friendly troops in contact at ${group.targetObjectiveId}`
          : `Enemy ground attack threatening ${group.targetObjectiveId}`,
      priority: group.state === 'combat' ? 76 : 72,
      group,
      targetObjectiveId: group.targetObjectiveId,
      targetPosition: group.position,
      threatenedPosition
    })
    if (plan) plans.push(plan)
  }

  for (const group of enemyGroundGroups) {
    if (!group.targetAirdromeName || !friendlyAirdromeNames.has(group.targetAirdromeName)) continue
    const airdrome = context.theatre.airdromeDetails[group.targetAirdromeName]
    if (!airdrome) continue
    const threatenedPosition = { x: airdrome.x, y: airdrome.y }
    if (calculateDistance(group.position, threatenedPosition) > 22_000) continue

    const plan = createCasPlan({
      variantId: group.state === 'combat' ? 'troops-in-contact' : 'defensive-cas',
      variantLabel: group.state === 'combat' ? 'Troops In Contact' : 'Defensive CAS',
      reason:
        group.state === 'combat'
          ? `Friendly troops in contact at ${group.targetAirdromeName}`
          : `Enemy ground attack threatening ${group.targetAirdromeName}`,
      priority: group.state === 'combat' ? 76 : 72,
      group,
      targetObjectiveId: group.targetAirdromeName,
      targetPosition: group.position,
      threatenedPosition
    })
    if (plan) plans.push(plan)
  }

  const armedReconTargets = enemyGroundGroups
    .filter((group) => group.state !== 'combat' && group.objectiveId != null)
    .map((group) => ({
      target: {
        group,
        casTarget: {
          id: group.id,
          type: 'Ground Group',
          objectiveId: group.objectiveId!
        }
      },
      position: group.position
    }))

  const armedReconAssignment = selectHomeBaseAndTarget({
    homeBases,
    targets: armedReconTargets,
    maxDistance: config.packages.CAS.maxDistance
  })
  if (armedReconAssignment) {
    const plan = createCasPlan({
      variantId: 'armed-recon',
      variantLabel: 'Armed Recon',
      reason: `Armed recon against enemy movement near ${armedReconAssignment.target.casTarget.objectiveId}`,
      priority: 54,
      group: armedReconAssignment.target.group,
      targetObjectiveId: armedReconAssignment.target.casTarget.objectiveId,
      targetPosition: armedReconAssignment.targetPosition
    })
    if (plan) plans.push(plan)
  }

  if (plans.length === 0) {
    pushRejection(rejected, 'cas', 'no target')
  }

  return plans
}

type SupplyNode = {
  id: string
  type: 'airdrome' | 'objective'
  position: Position
  runwayAngle?: number
  urgency: number
  supply: z.infer<typeof schemas.supply>
}

function getSupplyNodesNeedingResupply(
  draft: Campaign,
  coalition: Coalition,
  context: SpawnContext
): SupplyNode[] {
  const supplyNodes = draft.coalitions[coalition].supplyNodes
  if (!supplyNodes) return []

  const nodes: SupplyNode[] = []
  for (const objectiveId of draft.coalitions[coalition].objectiveIds) {
    const supply = supplyNodes[objectiveId]
    const objective = context.theatre.objectives.find((entry) => entry.name === objectiveId)
    if (!supply || !objective || supply.status === 'abundant') continue
    nodes.push({
      id: objectiveId,
      type: 'objective',
      position: objective.position,
      urgency: 1 - supply.current / supply.max,
      supply
    })
  }

  for (const airdromeName of draft.coalitions[coalition].airdromeNames) {
    const supply = supplyNodes[airdromeName]
    const airdrome = context.theatre.airdromeDetails[airdromeName]
    if (!supply || !airdrome || supply.status === 'abundant') continue
    nodes.push({
      id: airdromeName,
      type: 'airdrome',
      position: { x: airdrome.x, y: airdrome.y },
      runwayAngle: airdrome.runwayAngle,
      urgency: 1 - supply.current / supply.max,
      supply
    })
  }

  return nodes.sort((a, b) => b.urgency - a.urgency)
}

function findSupplySource(
  draft: Campaign,
  coalition: Coalition,
  context: SpawnContext,
  destination: Position
): SupplyNode | null {
  const supplyNodes = draft.coalitions[coalition].supplyNodes
  if (!supplyNodes) return null

  let nearest: SupplyNode | null = null
  let nearestDistance = Number.POSITIVE_INFINITY

  for (const airdromeName of draft.coalitions[coalition].airdromeNames) {
    const supply = supplyNodes[airdromeName]
    const airdrome = context.theatre.airdromeDetails[airdromeName]
    if (!supply || !airdrome || supply.current <= supply.max * 0.5) continue

    const position = { x: airdrome.x, y: airdrome.y }
    const distance = calculateDistance(position, destination)
    if (distance < nearestDistance && distance <= config.packages.Transport.maxDistance) {
      nearestDistance = distance
      nearest = {
        id: airdromeName,
        type: 'airdrome',
        position,
        runwayAngle: airdrome.runwayAngle,
        urgency: 0,
        supply
      }
    }
  }

  return nearest
}

function makeTransportPlan(
  draft: Campaign,
  coalition: Coalition,
  context: SpawnContext,
  rejected: RejectedAtoPackage[],
  policy: AtoPlannerPolicy
): AtoPackagePlan | null {
  if (!policy.enableTransport) return null
  if (
    activeTaskCount(draft, coalition, 'Transport') >= config.packages.Transport.maxActive[coalition]
  ) {
    pushRejection(rejected, 'transport', 'budget exhausted')
    return null
  }
  if (!hasAircraft(draft, coalition, 'Transport')) {
    pushRejection(rejected, 'transport', 'no aircraft')
    return null
  }

  const targetNode = getSupplyNodesNeedingResupply(draft, coalition, context)[0]
  if (!targetNode) {
    pushRejection(rejected, 'transport', 'no target')
    return null
  }

  const source = findSupplySource(draft, coalition, context, targetNode.position)
  if (!source) {
    pushRejection(rejected, 'transport', 'no source', targetNode.id)
    return null
  }

  const transportAircraft = draft.coalitions[coalition].aircraftTypes.Transport
  const preferredType = targetNode.supply.status === 'critical' ? 'CH-47D' : 'C-130'
  const aircraftType = transportAircraft.includes(preferredType)
    ? (preferredType as AircraftName)
    : pickAircraft(draft, coalition, 'Transport')
  if (!aircraftType) {
    pushRejection(rejected, 'transport', 'no aircraft')
    return null
  }

  const cargoCapacity =
    aircraftType === 'C-130'
      ? config.packages.Transport.c130CargoCapacity
      : config.packages.Transport.ch47CargoCapacity
  const cargoAmount = Math.min(cargoCapacity, targetNode.supply.max - targetNode.supply.current)
  if (cargoAmount <= 0) {
    pushRejection(rejected, 'transport', 'no target', targetNode.id)
    return null
  }

  const transportType =
    targetNode.supply.status === 'critical'
      ? 'emergency'
      : source.type === 'airdrome' && targetNode.type === 'airdrome'
        ? 'strategic'
        : 'tactical'

  return {
    id: createPlanId('transport', targetNode.id),
    kind: 'transport',
    type: 'Transport Package',
    coalition,
    priority: 45 + Math.round(targetNode.urgency * 30),
    reason: 'Supply node needs resupply',
    targetId: targetNode.id,
    targetObjectiveId: targetNode.id,
    targetType: 'supply',
    tot: addMinutes(draft.time, 25),
    flights: [
      {
        role: 'transport',
        task: 'Transport',
        aircraftType,
        homeBase: {
          name: source.id,
          position: source.position,
          runwayAngle: source.runwayAngle
        },
        targetPosition: targetNode.position,
        transport: {
          sourceNode: source.id,
          destinationNode: targetNode.id,
          destinationPosition: targetNode.position,
          cargoAmount,
          transportType
        }
      }
    ]
  }
}

function applyVariantDefaults(plan: AtoPackagePlan, profile: OperationProfile): AtoPackagePlan {
  if (plan.variantId) return plan

  if (plan.kind === 'cap') {
    if (profile.archetype === 'defense-crisis') {
      return {
        ...plan,
        variantId: 'point-defense-cap',
        variantLabel: 'Point Defense CAP',
        reason: 'Protect vulnerable friendly airspace'
      }
    }
    if (profile.archetype === 'air-superiority') {
      return {
        ...plan,
        variantId: 'forward-sweep',
        variantLabel: 'Forward Sweep',
        reason: 'Contest forward enemy airspace'
      }
    }
    return {
      ...plan,
      variantId: 'barrier-cap',
      variantLabel: 'Barrier CAP',
      reason: plan.reason
    }
  }

  if (plan.kind === 'strike' || plan.kind === 'strategicStrike') {
    if (profile.archetype === 'attrition') {
      return {
        ...plan,
        variantId: 'logistics-strike',
        variantLabel: 'Logistics Strike',
        reason: 'Attack enemy logistics and repair capacity'
      }
    }
    if (plan.kind === 'strategicStrike' || profile.archetype === 'air-superiority') {
      return {
        ...plan,
        variantId: 'deep-interdiction',
        variantLabel: 'Deep Interdiction',
        reason: plan.reason
      }
    }
    return {
      ...plan,
      variantId: 'frontline-raid',
      variantLabel: 'Frontline Raid',
      reason: plan.reason
    }
  }

  if (plan.kind === 'dead') {
    return {
      ...plan,
      variantId: 'standalone-dead',
      variantLabel: 'Standalone DEAD',
      reason: plan.reason
    }
  }

  return plan
}

function scoreCandidate(plan: AtoPackagePlan, profile: OperationProfile) {
  let score = plan.priority

  if (profile.archetype === 'defense-crisis') {
    if (plan.variantId === 'defensive-cas' || plan.variantId === 'troops-in-contact') score += 18
    if (plan.variantId === 'point-defense-cap') score += 8
  }
  if (profile.archetype === 'breakthrough') {
    if (plan.kind === 'cas' || plan.variantId === 'frontline-raid') score += 10
    if (plan.kind === 'dead') score += 5
  }
  if (profile.archetype === 'attrition') {
    if (plan.variantId === 'logistics-strike' || plan.kind === 'dead') score += 12
    if (plan.variantId === 'armed-recon') score += 5
  }
  if (profile.archetype === 'air-superiority') {
    if (plan.kind === 'cap' || plan.kind === 'dead') score += 14
    if (plan.kind === 'cas') score -= 6
  }
  if (profile.tempo === 'cautious') score -= plan.flights.length * 3
  if (profile.tempo === 'surge') score += 4

  return score + Math.random() * 4
}

function admitCandidates(
  draft: Campaign,
  coalition: Coalition,
  candidates: AtoPackagePlan[],
  rejected: RejectedAtoPackage[],
  policy: AtoPlannerPolicy
) {
  const admitted: AtoPackagePlan[] = []
  const activePackages = draft.coalitions[coalition].packages.filter(
    (pkg) => pkg.status === 'active'
  )
  let packageBudget = Math.max(0, policy.maxActivePackages - activePackages.length)
  let aircraftBudget = Math.max(0, policy.maxActiveAircraft - activeAircraftCount(draft, coalition))
  const admittedTargets = new Set<string>()
  const remainingLogisticsByAirbase = new Map<string, LogisticsBudget>()

  for (const candidate of candidates) {
    if (admitted.length >= policy.maxNewPackagesPerLogicTick || packageBudget <= 0) {
      pushRejection(rejected, candidate.kind, 'budget exhausted', candidate.targetId)
      continue
    }
    if (admittedTargets.has(candidate.targetId)) {
      pushRejection(rejected, candidate.kind, 'duplicate target', candidate.targetId)
      continue
    }

    const aircraftCount = getPlanAircraftCount(candidate)
    if (aircraftCount > aircraftBudget) {
      pushRejection(rejected, candidate.kind, 'budget exhausted', candidate.targetId)
      continue
    }
    if (!reservePlanLogistics(draft, coalition, candidate, remainingLogisticsByAirbase)) {
      pushRejection(rejected, candidate.kind, 'supply blocked', candidate.targetId)
      continue
    }

    admitted.push(candidate)
    admittedTargets.add(candidate.targetId)
    aircraftBudget -= aircraftCount
    packageBudget -= 1
  }

  return admitted
}

export function planAtoPackages(
  draft: Campaign,
  coalition: Coalition,
  context: SpawnContext,
  policy: AtoPlannerPolicy = defaultAtoPlannerPolicy
): AtoPlannerResult {
  const rejected: RejectedAtoPackage[] = []
  const profile = getDefaultOperationProfile(draft)
  const candidates = [
    makeCapPlan(draft, coalition, context, rejected),
    makeStrikePlan(draft, coalition, context, 'Pinpoint Strike', rejected),
    makeStrikePlan(draft, coalition, context, 'Strategic Strike', rejected),
    makeDeadPlan(draft, coalition, context, rejected),
    ...makeCasPlans(draft, coalition, context, rejected),
    makeTransportPlan(draft, coalition, context, rejected, policy)
  ]
    .filter((plan): plan is AtoPackagePlan => plan != null)
    .map((plan) => applyVariantDefaults(plan, profile))
    .sort((a, b) => scoreCandidate(b, profile) - scoreCandidate(a, profile))

  return {
    candidates,
    admitted: admitCandidates(draft, coalition, candidates, rejected, policy),
    rejected
  }
}

function createMissionPackage(
  draft: Campaign,
  coalition: Coalition,
  plan: AtoPackagePlan,
  members: MissionPackage['members']
) {
  draft.coalitions[coalition].packages.push({
    id: plan.id,
    type: plan.type,
    targetObjectiveId: plan.targetObjectiveId,
    members,
    tot: plan.tot,
    originalTot: plan.tot,
    status: 'active',
    priority: plan.priority,
    reason: plan.reason,
    targetType: plan.targetType,
    variantId: plan.variantId,
    variantLabel: plan.variantLabel
  })
}

function commitFlight(
  draft: Campaign,
  coalition: Coalition,
  plan: AtoPackagePlan,
  flight: FlightPlanDescriptor
) {
  const spendHomeBaseLogistics = () => {
    const supply = getNodeSupply(draft, coalition, flight.homeBase.name)
    spendFlightLogistics(supply, flight.task, getFlightAircraftCount(flight))
  }

  if (flight.task === 'CAP' && flight.patrolCenter) {
    const flightGroupId = CapFlightGroup.spawn(draft, coalition, {
      homeBase: flight.homeBase.name,
      homeBasePosition: flight.homeBase.position,
      patrolCenter: flight.patrolCenter,
      runwayAngle: flight.homeBase.runwayAngle,
      aircraftType: flight.aircraftType,
      packageId: plan.id
    }).flightGroupId
    spendHomeBaseLogistics()
    return flightGroupId
  }

  if ((flight.task === 'Pinpoint Strike' || flight.task === 'Strategic Strike') && flight.target) {
    const flightGroupId = StrikeFlightGroup.spawn(draft, coalition, {
      homeBase: flight.homeBase.name,
      homeBasePosition: flight.homeBase.position,
      target: flight.target,
      targetPosition: flight.targetPosition,
      runwayAngle: flight.homeBase.runwayAngle,
      aircraftType: flight.aircraftType,
      packageId: plan.id,
      exactTarget: draft.campaignParams?.exactTarget === true,
      task: flight.task
    }).flightGroupId
    spendHomeBaseLogistics()
    return flightGroupId
  }

  if (flight.task === 'SEAD' && flight.target) {
    const flightGroupId = SeadFlightGroup.spawn(draft, coalition, {
      homeBase: flight.homeBase.name,
      homeBasePosition: flight.homeBase.position,
      target: flight.target,
      targetPosition: flight.targetPosition,
      runwayAngle: flight.homeBase.runwayAngle,
      aircraftType: flight.aircraftType,
      tot: new Date(plan.tot.getTime() - config.packages.SEAD.leadTime),
      packageId: plan.id
    })
    spendHomeBaseLogistics()
    return flightGroupId
  }

  if (flight.task === 'DEAD' && flight.target) {
    const flightGroupId = DeadFlightGroup.spawn(draft, coalition, {
      homeBase: flight.homeBase.name,
      homeBasePosition: flight.homeBase.position,
      target: flight.target,
      targetPosition: flight.targetPosition,
      runwayAngle: flight.homeBase.runwayAngle,
      aircraftType: flight.aircraftType,
      tot: plan.tot,
      packageId: plan.id
    }).flightGroupId
    spendHomeBaseLogistics()
    return flightGroupId
  }

  if (flight.task === 'CAS' && flight.target) {
    const flightGroupId = spawnPlannedFlightGroup({
      draft,
      coalition,
      task: 'CAS',
      aircraftType: flight.aircraftType,
      aircraftCount: config.packages.CAS.aircraftsPerGroup,
      homeBase: flight.homeBase.name,
      homeBasePosition: flight.homeBase.position,
      destination: flight.targetPosition,
      missionWaypoints: buildCasMissionWaypoints(flight.homeBase.position, flight.targetPosition),
      startTime: addMinutes(draft.time, 30),
      runwayAngle: flight.homeBase.runwayAngle,
      target: flight.target,
      packageId: plan.id
    }).flightGroupId
    spendHomeBaseLogistics()
    return flightGroupId
  }

  if (flight.task === 'Transport' && flight.transport) {
    const { flightGroupId } = TransportFlightGroup.spawn(draft, coalition, {
      homeBase: flight.homeBase.name,
      homeBasePosition: flight.homeBase.position,
      destinationPosition: flight.transport.destinationPosition,
      sourceNode: flight.transport.sourceNode,
      destinationNode: flight.transport.destinationNode,
      runwayAngle: flight.homeBase.runwayAngle,
      aircraftType: flight.aircraftType,
      cargoAmount: flight.transport.cargoAmount,
      transportType: flight.transport.transportType
    })

    const spawnedGroup = draft.coalitions[coalition].flightGroups.find(
      (group) => group.id === flightGroupId
    )
    if (spawnedGroup) {
      spawnedGroup.packageId = plan.id
    }

    spendHomeBaseLogistics()
    return flightGroupId
  }

  return null
}

export function commitAtoPackages(
  draft: Campaign,
  coalition: Coalition,
  plans: AtoPackagePlan[]
): void {
  for (const plan of plans) {
    const members: MissionPackage['members'] = []

    for (const flight of plan.flights) {
      const flightGroupId = commitFlight(draft, coalition, plan, flight)
      if (!flightGroupId) continue
      const totOffset =
        flight.task === 'SEAD'
          ? -config.packages.SEAD.leadTime
          : flight.tot
            ? flight.tot.getTime() - plan.tot.getTime()
            : 0
      members.push({
        flightGroupId,
        role: flight.role,
        totOffset
      })
    }

    if (members.length > 0) {
      createMissionPackage(draft, coalition, plan, members)
      if (plan.battleLock) {
        const groundBattleLocks = (draft.groundBattleLocks ??= [])
        groundBattleLocks.push({
          ...plan.battleLock,
          id: crypto.randomUUID(),
          packageId: plan.id
        })
      }
    }

    if (plan.kind === 'strategicStrike') {
      draft.coalitions[coalition].strategicStrikeCooldownUntil = undefined
    }
  }
}
