import { config, resolveAirActivity, schemas } from '@dcc/contracts'
import {
  evaluateCombatViability,
  findFlotStations,
  flotPatrolPosition,
  flotTouchesObjective,
  getGroundGroupUnitCount,
  theatreHasLandGraph
} from '@dcc/campaign'
import {
  aircrafts,
  coalitionOperationProfile,
  flotAmbushDepth,
  flotAwacsDepth,
  flotCapDepth,
  flotEcmDepth,
  flotSweepDepth,
  isLowCeiling
} from '@dcc/data'
import * as z from 'zod'

import { hasAirframes } from '../../air-order-of-battle'
import { CapFlightGroup } from '../../../entities/cap-flight-group'
import { DeadFlightGroup } from '../../../entities/dead-flight-group'
import { SeadFlightGroup } from '../../../entities/sead-flight-group'
import { StrikeFlightGroup } from '../../../entities/strike-flight-group'
import { TransportFlightGroup } from '../../../entities/transport-flight-group'
import {
  buildAttackMissionWaypoints,
  buildAwacsMissionWaypoints,
  buildCasMissionWaypoints,
  buildFighterSweepMissionWaypoints,
  buildInterceptMissionWaypoints,
  spawnPlannedFlightGroup
} from '../../../entities/flight-group-spawn'
import { getObjectivePosition } from '@/logic/utils/get-objective-position'
import { getClosestThreateningSam } from '@/logic/utils/threat-analyzer'
import { calculateDistance } from '@/logic/utils/calculate-distance'
import { logSpawnAction } from '@/logic/simulation-log'
import { getIadsEmitterTargets } from '@/logic/iads-emitter-targets'
import {
  getCoalitionAirdromes,
  getCoalitionCasHomeBases,
  resolveSpawnContext,
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
import { isLogisticsStructure } from '../../logistics-interdiction'
import {
  doctrineStrikePriorityBoost,
  groundOffensiveOpen,
  strategicTargetsOpen,
  strikeStructuresForDoctrine
} from '../../campaign-doctrine'
import { activeRoadCutKeys, roadTargetId } from '../../road-cuts'
import { isAirdromeRecovering } from '../../airport-capture'
import { isPlanSuppressed, priorityScore } from '../../commander-priorities'
import { isEnemyKnown, INTEL_RETENTION_MS } from '../../intel'

type Campaign = z.infer<typeof schemas.campaign.campaign>
type Coalition = z.infer<typeof schemas.coalition>
type Position = z.infer<typeof schemas.position>
type AircraftName = z.infer<typeof schemas.dcs.aircraftName>
type FlightTask = z.infer<typeof schemas.flightGroup>['task']
type MissionPackage = z.infer<typeof schemas.missionPackage>
type PackageMemberRole = z.infer<typeof schemas.packageMemberRole>
type OperationProfile = NonNullable<Campaign['operationProfile']>
type GroundBattleLock = NonNullable<Campaign['groundBattleLocks']>[number]
type CasVariantId = 'defensive-cas' | 'troops-in-contact' | 'on-call-cas' | 'armed-recon' | 'bai'
type CapVariantId = 'point-defense-cap' | 'barrier-cap' | 'forward-sweep' | 'havcap' | 'ambush-cap'
type StrikeVariantId = 'frontline-raid' | 'logistics-strike' | 'deep-interdiction' | 'road-cut'
type DeadVariantId = 'escort-dead' | 'standalone-dead'
type AtoVariantId = CasVariantId | CapVariantId | StrikeVariantId | DeadVariantId

export type AtoPackageKind =
  | 'cap'
  | 'strike'
  | 'strategicStrike'
  | 'dead'
  | 'cas'
  | 'transport'
  | 'oca'
  | 'awacs'
  | 'intercept'
  | 'sweep'
  | 'relocate'
  | 'ecm'

export type AtoRejectionReason =
  | 'budget exhausted'
  | 'cooldown active'
  | 'duplicate target'
  | 'no aircraft'
  | 'no source'
  | 'no target'
  | 'out of range'
  | 'supply blocked'
  | 'threat too high'
  /** Strategic targets wait for the doctrine's later phase. */
  | 'strategic shift'
  /** The player set this mission or target family to "never". */
  | 'commander priority'

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
  patrolAltitude?: number
  patrolDurationMs?: number
  tot?: Date
  /** Ferry size. The task default is used when this is absent. */
  aircraftCount?: number
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

function turnaroundKey(homeBase: string, aircraftType: string) {
  return `${homeBase}:${aircraftType}`
}

function aircraftIsTurning(
  draft: Campaign,
  coalition: Coalition,
  homeBase: string,
  aircraftType: string
) {
  const until =
    draft.coalitions[coalition].aircraftTurnaroundUntil?.[turnaroundKey(homeBase, aircraftType)]
  return until != null && until > draft.time.getTime()
}

function readyAircraftTypes(
  draft: Campaign,
  coalition: Coalition,
  task: FlightTask,
  homeBase?: string
) {
  const types = getAvailableAircraftTypes(draft, coalition, task)
  if (!homeBase) return types
  return types.filter((type) => !aircraftIsTurning(draft, coalition, homeBase, type))
}

function hasAircraft(draft: Campaign, coalition: Coalition, task: FlightTask) {
  return getAvailableAircraftTypes(draft, coalition, task).length > 0
}

function pickAircraft(draft: Campaign, coalition: Coalition, task: FlightTask, homeBase?: string) {
  return pickRandomAircraftType(readyAircraftTypes(draft, coalition, task, homeBase))
}

/** Types the coalition flies for the task and still has enough airframes of on the ground. */
function getAvailableAircraftTypes(draft: Campaign, coalition: Coalition, task: FlightTask) {
  const needed = getTaskAircraftCount(task)
  return getConfiguredAircraftTypes(draft, coalition, task).filter((type) =>
    hasAirframes(draft, coalition, type, needed)
  )
}

function getConfiguredAircraftTypes(draft: Campaign, coalition: Coalition, task: FlightTask) {
  if (task === 'Intercept' || task === 'Fighter Sweep') {
    return schemas.resolveTaskAircraftTypes(draft.coalitions[coalition].aircraftTypes, task)
  }

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
  return flight.aircraftCount ?? getTaskAircraftCount(flight.task)
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

const FLOT_CAP_COVER_METERS = 40_000

function capPatrolPosition(
  group: Campaign['coalitions']['player']['flightGroups'][number]
): Position {
  const start = group.flightplan.waypoints.find((waypoint) => waypoint.name === 'Racetrack Start')
  const end = group.flightplan.waypoints.find((waypoint) => waypoint.name === 'Racetrack End')
  if (start && end) {
    return {
      x: (start.position.x + end.position.x) / 2,
      y: (start.position.y + end.position.y) / 2
    }
  }
  return group.position
}

function selectFlotOrbitAssignment(params: {
  draft: Campaign
  coalition: Coalition
  context: SpawnContext
  homeBases: AirdromeSelection[]
  maxDistance: number
  depth: number
  occupiedTask: FlightTask
  coverMeters?: number
}): { homeBase: AirdromeSelection; patrolCenter: Position; stationId: string } | null {
  if (!theatreHasLandGraph(params.context.theatre)) return null

  const enemy = params.draft.coalitions[params.context.enemyCoalition]
  const friendly = params.draft.coalitions[params.coalition]
  const stations = findFlotStations({
    theatre: params.context.theatre,
    friendlyObjectiveIds: friendly.objectiveIds,
    friendlyAirdromeNames: friendly.airdromeNames,
    enemyObjectiveIds: enemy.objectiveIds,
    enemyAirdromeNames: enemy.airdromeNames
  })
  if (stations.length === 0) return null

  const occupied = friendly.flightGroups
    .filter((group) => group.task === params.occupiedTask)
    .map((group) => capPatrolPosition(group))

  const ranked: Array<{
    homeBase: AirdromeSelection
    patrolCenter: Position
    stationId: string
    range: number
  }> = []

  for (const station of stations) {
    const patrolCenter = flotPatrolPosition(station, params.depth)
    if (
      occupied.some(
        (position) =>
          calculateDistance(position, patrolCenter) < (params.coverMeters ?? FLOT_CAP_COVER_METERS)
      )
    ) {
      continue
    }

    let nearest: AirdromeSelection | null = null
    let nearestRange = Number.POSITIVE_INFINITY
    for (const homeBase of params.homeBases) {
      const range = calculateDistance(homeBase.position, patrolCenter)
      if (range > params.maxDistance || range >= nearestRange) continue
      nearest = homeBase
      nearestRange = range
    }
    if (!nearest) continue
    ranked.push({
      homeBase: nearest,
      patrolCenter,
      stationId: station.id,
      range: nearestRange
    })
  }

  ranked.sort((left, right) => left.range - right.range)
  const selected = ranked[0]
  return selected
    ? {
        homeBase: selected.homeBase,
        patrolCenter: selected.patrolCenter,
        stationId: selected.stationId
      }
    : null
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

function getDefaultOperationProfile(draft: Campaign, coalition: Coalition): OperationProfile {
  return coalitionOperationProfile(draft, coalition)
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
  return (
    getSupplySpawnModifier(draft, coalition, airbaseName) <= 0 ||
    isAirdromeRecovering(draft, coalition, airbaseName)
  )
}

function canHomeBaseSupportTask(
  draft: Campaign,
  coalition: Coalition,
  homeBase: AirdromeSelection,
  task: FlightTask
) {
  return (
    !isAirbaseSupplyBlocked(draft, coalition, homeBase.name) &&
    readyAircraftTypes(draft, coalition, task, homeBase.name).length > 0 &&
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
  const flotAssignment = selectFlotOrbitAssignment({
    draft,
    coalition,
    context,
    homeBases,
    maxDistance: config.packages.CAP.maxDistance,
    depth: flotCapDepth(coalitionOperationProfile(draft, coalition)),
    occupiedTask: 'CAP'
  })
  const assignment =
    flotAssignment ??
    selectCapPatrolAssignment({
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

  const aircraftType = pickAircraft(draft, coalition, 'CAP', assignment.homeBase.name)
  if (!aircraftType) {
    pushRejection(rejected, 'cap', 'no aircraft')
    return null
  }

  const targetId = flotAssignment?.stationId ?? assignment.homeBase.name
  const tot = addMinutes(draft.time, 20)
  return {
    id: createPlanId('cap', targetId),
    kind: 'cap',
    type: 'CAP Package',
    coalition,
    priority: 70,
    reason: flotAssignment ? 'BARCAP on the FLOT' : 'Uncovered CAP lane',
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

const HAVCAP_RANGE_METERS = 45 * 1852
const AMBUSH_PATROL_MS = 15 * 60 * 1000
const AMBUSH_ALTITUDE_METERS = 450

function makeHavcapPlan(
  draft: Campaign,
  coalition: Coalition,
  context: SpawnContext,
  rejected: RejectedAtoPackage[]
): AtoPackagePlan | null {
  const pilots = draft.coalitions[coalition].downedPilots ?? []
  if (pilots.length === 0) return null
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

  const covered = new Set(
    draft.coalitions[coalition].flightGroups.map((group) => group.target?.id).filter(Boolean)
  )
  const homeBases = getSupportedHomeBases(
    draft,
    coalition,
    getCoalitionAirdromes(draft, context.theatre, coalition),
    'CAP'
  )
  let chosen: {
    pilot: (typeof pilots)[number]
    homeBase: (typeof homeBases)[number]
    range: number
  } | null = null
  for (const pilot of pilots) {
    if (covered.has(pilot.id)) continue
    for (const homeBase of homeBases) {
      const range = calculateDistance(homeBase.position, pilot.position)
      if (range > HAVCAP_RANGE_METERS) continue
      if (!chosen || range < chosen.range) chosen = { pilot, homeBase, range }
    }
  }
  if (!chosen) {
    pushRejection(rejected, 'cap', 'no target')
    return null
  }

  const aircraftType = pickAircraft(draft, coalition, 'CAP', chosen.homeBase.name)
  if (!aircraftType) {
    pushRejection(rejected, 'cap', 'no aircraft')
    return null
  }

  const tot = addMinutes(draft.time, 10)
  return {
    id: createPlanId('cap', chosen.pilot.id),
    kind: 'cap',
    type: 'CAP Package',
    coalition,
    variantId: 'havcap',
    variantLabel: 'HAVCAP',
    priority: 86,
    reason: `HAVCAP over ${chosen.pilot.name}`,
    targetId: chosen.pilot.id,
    targetObjectiveId: chosen.pilot.id,
    targetType: 'Downed Pilot',
    tot,
    flights: [
      {
        role: 'cap',
        task: 'CAP',
        aircraftType,
        homeBase: chosen.homeBase,
        targetPosition: chosen.pilot.position,
        patrolCenter: chosen.pilot.position,
        tot,
        target: {
          id: chosen.pilot.id,
          type: 'Downed Pilot',
          objectiveId: chosen.pilot.id
        }
      }
    ]
  }
}

function makeAmbushPlan(
  draft: Campaign,
  coalition: Coalition,
  context: SpawnContext,
  rejected: RejectedAtoPackage[]
): AtoPackagePlan | null {
  if (!theatreHasLandGraph(context.theatre)) return null
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
  if (
    draft.coalitions[coalition].packages.some(
      (pkg) => pkg.status === 'active' && pkg.variantId === 'ambush-cap'
    )
  ) {
    pushRejection(rejected, 'cap', 'duplicate target')
    return null
  }

  const homeBases = getSupportedHomeBases(
    draft,
    coalition,
    getCoalitionAirdromes(draft, context.theatre, coalition),
    'CAP'
  )
  const assignment = selectFlotOrbitAssignment({
    draft,
    coalition,
    context,
    homeBases,
    maxDistance: config.packages.CAP.maxDistance,
    depth: flotAmbushDepth(coalitionOperationProfile(draft, coalition)),
    occupiedTask: 'CAP',
    coverMeters: 4_000
  })
  if (!assignment) {
    pushRejection(rejected, 'cap', 'no target')
    return null
  }

  const aircraftType = pickAircraft(draft, coalition, 'CAP', assignment.homeBase.name)
  if (!aircraftType) {
    pushRejection(rejected, 'cap', 'no aircraft')
    return null
  }

  const tot = addMinutes(draft.time, 30)
  return {
    id: createPlanId('cap', `ambush-${assignment.stationId}`),
    kind: 'cap',
    type: 'CAP Package',
    coalition,
    variantId: 'ambush-cap',
    variantLabel: 'Ambush CAP',
    priority: 64,
    reason: 'Ambush CAP forward of the FLOT',
    targetId: `ambush-${assignment.stationId}`,
    targetObjectiveId: assignment.stationId,
    targetType: 'airspace',
    tot,
    flights: [
      {
        role: 'cap',
        task: 'CAP',
        aircraftType,
        homeBase: assignment.homeBase,
        targetPosition: assignment.patrolCenter,
        patrolCenter: assignment.patrolCenter,
        patrolAltitude: AMBUSH_ALTITUDE_METERS,
        patrolDurationMs: AMBUSH_PATROL_MS,
        tot
      }
    ]
  }
}

function escortPatrolCenter(home: Position, target: Position): Position {
  return {
    x: home.x + (target.x - home.x) * 0.65,
    y: home.y + (target.y - home.y) * 0.65
  }
}

function strikeWaitsForSuppression(
  draft: Campaign,
  coalition: Coalition,
  context: SpawnContext,
  targetPosition: Position,
  flights: FlightPlanDescriptor[]
) {
  if (ecmOrbitIsUp(draft, coalition)) return false
  const covered = getClosestThreateningSam(
    targetPosition,
    draft.coalitions[context.enemyCoalition].samGroups,
    context.theatre,
    draft,
    context.enemyCoalition
  )
  if (!covered) return false
  const canSuppress = hasAircraft(draft, coalition, 'SEAD') || hasAircraft(draft, coalition, 'DEAD')
  if (!canSuppress) return false
  return !flights.some((flight) => flight.task === 'SEAD' || flight.task === 'DEAD')
}

const RELOCATE_AIRCRAFT = 4
const RELOCATE_PLAN_MINUTES = 20

function makeRelocatePlan(
  draft: Campaign,
  coalition: Coalition,
  context: SpawnContext,
  rejected: RejectedAtoPackage[]
): AtoPackagePlan | null {
  const owned = getCoalitionAirdromes(draft, context.theatre, coalition)
  const recovering = owned.filter((field) => isAirdromeRecovering(draft, coalition, field.name))
  const open = owned.filter((field) => !isAirdromeRecovering(draft, coalition, field.name))
  if (recovering.length === 0 || open.length === 0) return null

  const busy = collectExistingPackageTargetIds(draft, coalition)
  const source = recovering.find((field) => !busy.has(field.name))
  if (!source) return null

  let destination = open[0]!
  let nearest = Number.POSITIVE_INFINITY
  for (const field of open) {
    const range = calculateDistance(source.position, field.position)
    if (range >= nearest) continue
    destination = field
    nearest = range
  }

  const aircraftType =
    pickAircraft(draft, coalition, 'CAP', source.name) ??
    pickAircraft(draft, coalition, 'Transport', source.name)
  if (!aircraftType) {
    pushRejection(rejected, 'relocate', 'no aircraft', source.name)
    return null
  }

  const tot = addMinutes(draft.time, RELOCATE_PLAN_MINUTES)
  return {
    id: createPlanId('relocate', source.name),
    kind: 'relocate',
    type: 'Relocate Package',
    coalition,
    priority: 100,
    reason: `Squadron leaves ${source.name} for ${destination.name}`,
    targetId: source.name,
    targetObjectiveId: destination.name,
    targetType: 'Airbase',
    tot,
    flights: [
      {
        role: 'relocate',
        task: 'CAP',
        aircraftType,
        aircraftCount: RELOCATE_AIRCRAFT,
        homeBase: source,
        target: {
          id: source.name,
          type: 'Airbase',
          objectiveId: destination.name
        },
        targetPosition: destination.position,
        tot
      }
    ]
  }
}

function attachStrikePackageEscorts(params: {
  draft: Campaign
  coalition: Coalition
  context: SpawnContext
  homeBase: AirdromeSelection
  targetPosition: Position
  tot: Date
  flights: FlightPlanDescriptor[]
}) {
  const threateningSam = getClosestThreateningSam(
    params.targetPosition,
    params.draft.coalitions[params.context.enemyCoalition].samGroups,
    params.context.theatre,
    params.draft,
    params.context.enemyCoalition
  )

  const canAddSead =
    threateningSam != null &&
    hasAircraft(params.draft, params.coalition, 'SEAD') &&
    activeTaskCount(params.draft, params.coalition, 'SEAD') <
      scaledMaxActive(params.draft, config.packages.SEAD.maxActive[params.coalition])
  if (threateningSam && canAddSead) {
    const seadAircraftType = pickAircraft(
      params.draft,
      params.coalition,
      'SEAD',
      params.homeBase.name
    )
    if (seadAircraftType) {
      params.flights.push({
        role: 'sead',
        task: 'SEAD',
        aircraftType: seadAircraftType,
        homeBase: params.homeBase,
        target: {
          id: threateningSam.samGroup.id,
          type: threateningSam.samGroup.type,
          objectiveId: threateningSam.samGroup.objectiveId
        },
        targetPosition: threateningSam.position,
        tot: new Date(params.tot.getTime() - config.packages.SEAD.leadTime)
      })
    }
  }

  const canAddDead =
    threateningSam != null &&
    hasAircraft(params.draft, params.coalition, 'DEAD') &&
    activeTaskCount(params.draft, params.coalition, 'DEAD') <
      scaledMaxActive(params.draft, config.packages.DEAD.maxActive[params.coalition])
  if (threateningSam && canAddDead) {
    const deadAircraftType = pickAircraft(
      params.draft,
      params.coalition,
      'DEAD',
      params.homeBase.name
    )
    if (deadAircraftType) {
      params.flights.push({
        role: 'dead',
        task: 'DEAD',
        aircraftType: deadAircraftType,
        homeBase: params.homeBase,
        target: {
          id: threateningSam.samGroup.id,
          type: threateningSam.samGroup.type,
          objectiveId: threateningSam.samGroup.objectiveId
        },
        targetPosition: threateningSam.position,
        tot: new Date(params.tot.getTime() - config.packages.DEAD.leadTime)
      })
    }
  }

  const canAddEscortCap =
    hasAircraft(params.draft, params.coalition, 'CAP') &&
    activeTaskCount(params.draft, params.coalition, 'CAP') <
      scaledMaxActive(params.draft, config.packages.CAP.maxActive[params.coalition])
  if (canAddEscortCap) {
    const capAircraftType = pickAircraft(
      params.draft,
      params.coalition,
      'CAP',
      params.homeBase.name
    )
    if (capAircraftType) {
      const patrolCenter = escortPatrolCenter(params.homeBase.position, params.targetPosition)
      params.flights.push({
        role: 'cap',
        task: 'CAP',
        aircraftType: capAircraftType,
        homeBase: params.homeBase,
        targetPosition: patrolCenter,
        patrolCenter,
        tot: new Date(params.tot.getTime() - config.packages.CAP.escortLeadTime)
      })
    }
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
  if (task === 'Strategic Strike' && !strategicTargetsOpen(draft)) {
    if (draft.strategicStrikeAt != null) {
      pushRejection(rejected, kind, 'strategic shift')
      return null
    }
    if (coalition !== 'opponent') return null
  }
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

  const profile = coalitionOperationProfile(draft, coalition)
  const liveStructures = strikeStructuresForDoctrine(
    draft,
    draft.coalitions[context.enemyCoalition].structures.filter(
      (structure) =>
        !isTargetAlreadyAssigned(draft, coalition, structure.id) &&
        structure.buildings.some((building) => building.alive)
    )
  )
  const logisticsStructures = liveStructures.filter((structure) =>
    isLogisticsStructure(structure.type)
  )
  const selectedStructures =
    profile.archetype === 'attrition' && logisticsStructures.length > 0
      ? logisticsStructures
      : liveStructures

  const targets = selectedStructures
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

  const aircraftType = pickAircraft(draft, coalition, task, assignment.homeBase.name)
  if (!aircraftType) {
    pushRejection(rejected, kind, 'no aircraft')
    return null
  }

  const tot = addMinutes(draft.time, task === 'Strategic Strike' ? 50 : 40)
  const flights: FlightPlanDescriptor[] = [
    {
      role: 'primary',
      task,
      aircraftType,
      homeBase: assignment.homeBase,
      target: assignment.target,
      targetPosition: assignment.targetPosition,
      tot
    }
  ]

  attachStrikePackageEscorts({
    draft,
    coalition,
    context,
    homeBase: assignment.homeBase,
    targetPosition: assignment.targetPosition,
    tot,
    flights
  })

  if (strikeWaitsForSuppression(draft, coalition, context, assignment.targetPosition, flights)) {
    pushRejection(rejected, kind, 'threat too high', assignment.target.id)
    return null
  }

  const hasSead = flights.some((flight) => flight.task === 'SEAD')
  const hasDead = flights.some((flight) => flight.task === 'DEAD')
  const hasEscortCap = flights.some((flight) => flight.task === 'CAP')
  const suppressionLabel =
    hasSead && hasDead ? 'SEAD/DEAD' : hasSead ? 'SEAD' : hasDead ? 'DEAD' : null
  return {
    id: createPlanId(kind, assignment.target.id),
    kind,
    type:
      hasSead && task === 'Strategic Strike'
        ? 'SEAD Strategic Strike Package'
        : hasSead
          ? 'SEAD Strike Package'
          : 'Strike Package',
    coalition,
    priority:
      (task === 'Strategic Strike' ? 55 : 65) +
      (flights.length - 1) * 6 +
      doctrineStrikePriorityBoost(draft, assignment.target.type),
    reason: suppressionLabel
      ? `Strike package with ${suppressionLabel} timed to ToT`
      : hasEscortCap
        ? 'Strike package with escort CAP timed to ToT'
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

  const aircraftType = pickAircraft(draft, coalition, 'DEAD', assignment.homeBase.name)
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

function makeOcaPlan(
  draft: Campaign,
  coalition: Coalition,
  context: SpawnContext,
  rejected: RejectedAtoPackage[]
): AtoPackagePlan | null {
  if (
    activeTaskCount(draft, coalition, 'Runway Attack') >=
    scaledMaxActive(draft, config.packages['Runway Attack'].maxActive[coalition])
  ) {
    pushRejection(rejected, 'oca', 'budget exhausted')
    return null
  }
  if (!hasAircraft(draft, coalition, 'Runway Attack')) {
    pushRejection(rejected, 'oca', 'no aircraft')
    return null
  }

  const allHomeBases = getCoalitionAirdromes(draft, context.theatre, coalition)
  const homeBases = getSupportedHomeBases(draft, coalition, allHomeBases, 'Runway Attack')
  if (allHomeBases.length > 0 && homeBases.length === 0) {
    pushRejection(rejected, 'oca', 'supply blocked')
    return null
  }

  const existingTargets = collectExistingPackageTargetIds(draft, coalition)
  const enemyAirdromes = getCoalitionAirdromes(draft, context.theatre, context.enemyCoalition)
    .filter(
      (airdrome) =>
        !existingTargets.has(airdrome.name) &&
        !isTargetAlreadyAssigned(draft, coalition, airdrome.name) &&
        !isAirdromeRecovering(draft, context.enemyCoalition, airdrome.name)
    )
    .map((airdrome) => ({
      target: {
        id: airdrome.name,
        type: 'Airbase',
        objectiveId: airdrome.name
      },
      position: airdrome.position
    }))

  if (enemyAirdromes.length === 0) {
    pushRejection(rejected, 'oca', 'no target')
    return null
  }

  const assignment = selectHomeBaseAndTarget({
    homeBases,
    targets: enemyAirdromes,
    maxDistance: config.packages['Runway Attack'].maxDistance,
    preference: 'nearest'
  })
  if (!assignment) {
    pushRejection(rejected, 'oca', 'out of range')
    return null
  }
  if (isAirbaseSupplyBlocked(draft, coalition, assignment.homeBase.name)) {
    pushRejection(rejected, 'oca', 'supply blocked', assignment.homeBase.name)
    return null
  }

  const aircraftType = pickAircraft(draft, coalition, 'Runway Attack', assignment.homeBase.name)
  if (!aircraftType) {
    pushRejection(rejected, 'oca', 'no aircraft')
    return null
  }

  const tot = addMinutes(draft.time, 40)
  const flights: FlightPlanDescriptor[] = [
    {
      role: 'primary',
      task: 'Runway Attack',
      aircraftType,
      homeBase: assignment.homeBase,
      target: assignment.target,
      targetPosition: assignment.targetPosition,
      tot
    }
  ]

  attachStrikePackageEscorts({
    draft,
    coalition,
    context,
    homeBase: assignment.homeBase,
    targetPosition: assignment.targetPosition,
    tot,
    flights
  })

  if (strikeWaitsForSuppression(draft, coalition, context, assignment.targetPosition, flights)) {
    pushRejection(rejected, 'oca', 'threat too high', assignment.target.id)
    return null
  }

  const hasSead = flights.some((flight) => flight.task === 'SEAD')
  const profile = coalitionOperationProfile(draft, coalition)
  const priority =
    profile.archetype === 'breakthrough' || profile.archetype === 'air-superiority'
      ? 80
      : profile.archetype === 'defense-crisis'
        ? 58
        : 70

  return {
    id: createPlanId('oca', assignment.target.id),
    kind: 'oca',
    type: hasSead ? 'SEAD OCA Package' : 'OCA Package',
    coalition,
    priority: priority + (flights.length - 1) * 6,
    reason: hasSead
      ? 'OCA against an enemy airfield with SEAD timed to ToT'
      : 'OCA against an enemy airfield',
    targetId: assignment.target.id,
    targetObjectiveId: assignment.target.objectiveId,
    targetType: assignment.target.type,
    tot,
    flights
  }
}

function pullOrbitTowardHome(home: Position, patrolCenter: Position, factor: number): Position {
  return {
    x: home.x + (patrolCenter.x - home.x) * factor,
    y: home.y + (patrolCenter.y - home.y) * factor
  }
}

function ecmOrbitIsUp(draft: Campaign, coalition: Coalition) {
  return draft.coalitions[coalition].flightGroups.some((group) => {
    if (group.task !== 'ECM') return false
    const start = group.flightplan.startTime
    return new Date(start).getTime() <= draft.time.getTime()
  })
}

function makeAwacsPlan(
  draft: Campaign,
  coalition: Coalition,
  context: SpawnContext,
  rejected: RejectedAtoPackage[]
): AtoPackagePlan | null {
  if (
    activeTaskCount(draft, coalition, 'AWACS') >=
    scaledMaxActive(draft, config.packages.AWACS.maxActive[coalition])
  ) {
    pushRejection(rejected, 'awacs', 'budget exhausted')
    return null
  }
  if (!hasAircraft(draft, coalition, 'AWACS')) {
    pushRejection(rejected, 'awacs', 'no aircraft')
    return null
  }

  const allHomeBases = getCoalitionAirdromes(draft, context.theatre, coalition)
  const homeBases = getSupportedHomeBases(draft, coalition, allHomeBases, 'AWACS')
  if (allHomeBases.length > 0 && homeBases.length === 0) {
    pushRejection(rejected, 'awacs', 'supply blocked')
    return null
  }

  const profile = coalitionOperationProfile(draft, coalition)
  const enemyAirdromes = getCoalitionAirdromes(draft, context.theatre, context.enemyCoalition)
  const flotAssignment = selectFlotOrbitAssignment({
    draft,
    coalition,
    context,
    homeBases,
    maxDistance: config.packages.AWACS.maxDistance,
    depth: flotAwacsDepth(profile),
    occupiedTask: 'AWACS'
  })
  const laneAssignment = flotAssignment
    ? null
    : selectCapPatrolAssignment({
        homeBases,
        enemyAirdromes,
        coveredHomeBases: new Set(),
        maxHomeToEnemyDistance: config.packages.AWACS.maxDistance
      })
  const assignment = flotAssignment
    ? flotAssignment
    : laneAssignment
      ? {
          homeBase: laneAssignment.homeBase,
          patrolCenter: pullOrbitTowardHome(
            laneAssignment.homeBase.position,
            laneAssignment.patrolCenter,
            0.5
          )
        }
      : null
  if (!assignment) {
    pushRejection(rejected, 'awacs', 'no target')
    return null
  }
  if (isAirbaseSupplyBlocked(draft, coalition, assignment.homeBase.name)) {
    pushRejection(rejected, 'awacs', 'supply blocked', assignment.homeBase.name)
    return null
  }

  const aircraftType = pickAircraft(draft, coalition, 'AWACS', assignment.homeBase.name)
  if (!aircraftType) {
    pushRejection(rejected, 'awacs', 'no aircraft')
    return null
  }

  const targetId = flotAssignment
    ? `awacs-${flotAssignment.stationId}`
    : `awacs-${assignment.homeBase.name}`
  const tot = addMinutes(draft.time, 15)
  return {
    id: createPlanId('awacs', targetId),
    kind: 'awacs',
    type: 'AWACS Package',
    coalition,
    priority:
      profile.archetype === 'air-superiority'
        ? 84
        : profile.archetype === 'defense-crisis'
          ? 76
          : 78,
    reason: flotAssignment ? 'AWACS orbit behind the FLOT' : 'AWACS orbit behind own lines',
    targetId,
    targetObjectiveId: targetId,
    targetType: 'airspace',
    tot,
    flights: [
      {
        role: 'awacs',
        task: 'AWACS',
        aircraftType,
        homeBase: assignment.homeBase,
        targetPosition: assignment.patrolCenter,
        patrolCenter: assignment.patrolCenter,
        tot
      }
    ]
  }
}

function makeEcmPlan(
  draft: Campaign,
  coalition: Coalition,
  context: SpawnContext,
  rejected: RejectedAtoPackage[]
): AtoPackagePlan | null {
  if (
    activeTaskCount(draft, coalition, 'ECM') >=
    scaledMaxActive(draft, config.packages.ECM.maxActive[coalition])
  ) {
    pushRejection(rejected, 'ecm', 'budget exhausted')
    return null
  }
  if (!hasAircraft(draft, coalition, 'ECM')) {
    pushRejection(rejected, 'ecm', 'no aircraft')
    return null
  }

  const allHomeBases = getCoalitionAirdromes(draft, context.theatre, coalition)
  const homeBases = getSupportedHomeBases(draft, coalition, allHomeBases, 'ECM')
  if (allHomeBases.length > 0 && homeBases.length === 0) {
    pushRejection(rejected, 'ecm', 'supply blocked')
    return null
  }

  const profile = coalitionOperationProfile(draft, coalition)
  const enemyAirdromes = getCoalitionAirdromes(draft, context.theatre, context.enemyCoalition)
  const flotAssignment = selectFlotOrbitAssignment({
    draft,
    coalition,
    context,
    homeBases,
    maxDistance: config.packages.ECM.maxDistance,
    depth: flotEcmDepth(profile),
    occupiedTask: 'ECM'
  })
  const laneAssignment = flotAssignment
    ? null
    : selectCapPatrolAssignment({
        homeBases,
        enemyAirdromes,
        coveredHomeBases: new Set(),
        maxHomeToEnemyDistance: config.packages.ECM.maxDistance
      })
  const assignment = flotAssignment
    ? flotAssignment
    : laneAssignment
      ? {
          homeBase: laneAssignment.homeBase,
          patrolCenter: pullOrbitTowardHome(
            laneAssignment.homeBase.position,
            laneAssignment.patrolCenter,
            0.35
          )
        }
      : null
  if (!assignment) {
    pushRejection(rejected, 'ecm', 'no target')
    return null
  }
  if (isAirbaseSupplyBlocked(draft, coalition, assignment.homeBase.name)) {
    pushRejection(rejected, 'ecm', 'supply blocked', assignment.homeBase.name)
    return null
  }

  const aircraftType = pickAircraft(draft, coalition, 'ECM', assignment.homeBase.name)
  if (!aircraftType) {
    pushRejection(rejected, 'ecm', 'no aircraft')
    return null
  }

  const targetId = flotAssignment
    ? `ecm-${flotAssignment.stationId}`
    : `ecm-${assignment.homeBase.name}`
  const tot = addMinutes(draft.time, 20)
  return {
    id: createPlanId('ecm', targetId),
    kind: 'ecm',
    type: 'ECM Package',
    coalition,
    priority: profile.archetype === 'defense-crisis' ? 70 : 80,
    reason: flotAssignment
      ? 'ECM orbit between the FLOT and the AWACS'
      : 'ECM orbit behind own lines',
    targetId,
    targetObjectiveId: targetId,
    targetType: 'airspace',
    tot,
    flights: [
      {
        role: 'ecm',
        task: 'ECM',
        aircraftType,
        homeBase: assignment.homeBase,
        targetPosition: assignment.patrolCenter,
        patrolCenter: assignment.patrolCenter,
        tot
      }
    ]
  }
}

const INBOUND_ATTACK_PACKAGE_TYPES = new Set<MissionPackage['type']>([
  'Strike Package',
  'SEAD Strike Package',
  'SEAD Strategic Strike Package',
  'OCA Package',
  'SEAD OCA Package',
  'CAS Package',
  'DEAD Package',
  'Antiship Package'
])

function resolveThreatenedPosition(
  theatre: SpawnContext['theatre'],
  objectiveId: string
): Position | null {
  const airdrome = theatre.airdromeDetails[objectiveId]
  if (airdrome) return { x: airdrome.x, y: airdrome.y }
  return getObjectivePosition(theatre, objectiveId)
}

function inboundInterceptPoint(raider: Position, target: Position): Position {
  const dx = target.x - raider.x
  const dy = target.y - raider.y
  const distance = Math.hypot(dx, dy)
  if (distance === 0) return target
  const standoff = Math.min(25_000, Math.max(8_000, distance * 0.25))
  return {
    x: target.x - (dx / distance) * standoff,
    y: target.y - (dy / distance) * standoff
  }
}

function isAirspaceCoveredByCap(draft: Campaign, coalition: Coalition, position: Position) {
  return draft.coalitions[coalition].flightGroups
    .filter((group) => group.task === 'CAP')
    .some((group) => calculateDistance(capPatrolPosition(group), position) < FLOT_CAP_COVER_METERS)
}

function findInboundRaid(
  draft: Campaign,
  coalition: Coalition,
  context: SpawnContext
): {
  packageId: string
  targetObjectiveId: string
  tot: Date
  interceptPoint: Position
} | null {
  const friendly = draft.coalitions[coalition]
  const enemy = draft.coalitions[context.enemyCoalition]
  const friendlyIds = new Set([...friendly.objectiveIds, ...friendly.airdromeNames])
  const assigned = collectExistingPackageTargetIds(draft, coalition)
  const ranked: Array<{
    packageId: string
    targetObjectiveId: string
    tot: Date
    interceptPoint: Position
  }> = []

  for (const inbound of enemy.packages) {
    if (inbound.status !== 'active') continue
    if (!INBOUND_ATTACK_PACKAGE_TYPES.has(inbound.type)) continue
    if (!friendlyIds.has(inbound.targetObjectiveId)) continue
    if (assigned.has(inbound.id)) continue

    const threatened = resolveThreatenedPosition(context.theatre, inbound.targetObjectiveId)
    if (!threatened) continue

    // Under fog of war a raid is only known once radar or a fighter has one of its flights.
    const raider = inbound.members
      .map((member) => enemy.flightGroups.find((group) => group.id === member.flightGroupId))
      .find(
        (group) => group != null && isEnemyKnown(draft, coalition, group.id, INTEL_RETENTION_MS)
      )
    if (!raider && !isEnemyKnown(draft, coalition, inbound.id)) continue
    const interceptPoint = raider ? inboundInterceptPoint(raider.position, threatened) : threatened
    if (isAirspaceCoveredByCap(draft, coalition, interceptPoint)) continue

    ranked.push({
      packageId: inbound.id,
      targetObjectiveId: inbound.targetObjectiveId,
      tot: inbound.tot,
      interceptPoint
    })
  }

  ranked.sort((left, right) => left.tot.getTime() - right.tot.getTime())
  return ranked[0] ?? null
}

function makeInterceptPlan(
  draft: Campaign,
  coalition: Coalition,
  context: SpawnContext,
  rejected: RejectedAtoPackage[]
): AtoPackagePlan | null {
  if (
    activeTaskCount(draft, coalition, 'Intercept') >=
    scaledMaxActive(draft, config.packages.Intercept.maxActive[coalition])
  ) {
    pushRejection(rejected, 'intercept', 'budget exhausted')
    return null
  }
  if (!hasAircraft(draft, coalition, 'Intercept')) {
    pushRejection(rejected, 'intercept', 'no aircraft')
    return null
  }

  const inbound = findInboundRaid(draft, coalition, context)
  if (!inbound) {
    pushRejection(rejected, 'intercept', 'no target')
    return null
  }

  const allHomeBases = getCoalitionAirdromes(draft, context.theatre, coalition)
  const homeBases = getSupportedHomeBases(draft, coalition, allHomeBases, 'Intercept')
  if (allHomeBases.length > 0 && homeBases.length === 0) {
    pushRejection(rejected, 'intercept', 'supply blocked')
    return null
  }

  let nearest: AirdromeSelection | null = null
  let nearestRange = Number.POSITIVE_INFINITY
  for (const homeBase of homeBases) {
    const range = calculateDistance(homeBase.position, inbound.interceptPoint)
    if (range > config.packages.Intercept.maxDistance || range >= nearestRange) continue
    nearest = homeBase
    nearestRange = range
  }
  if (!nearest) {
    pushRejection(rejected, 'intercept', 'out of range', inbound.packageId)
    return null
  }
  if (isAirbaseSupplyBlocked(draft, coalition, nearest.name)) {
    pushRejection(rejected, 'intercept', 'supply blocked', nearest.name)
    return null
  }

  const aircraftType = pickAircraft(draft, coalition, 'Intercept', nearest.name)
  if (!aircraftType) {
    pushRejection(rejected, 'intercept', 'no aircraft')
    return null
  }

  const cruiseSpeed = 220
  const travelMs = nearestRange > 0 ? (nearestRange / cruiseSpeed) * 1000 : 0
  const startupMs = 10 * 60 * 1000
  const arriveEarlyMs = 5 * 60 * 1000
  const startTime = new Date(
    Math.max(
      draft.time.getTime() + startupMs,
      inbound.tot.getTime() - arriveEarlyMs - travelMs - startupMs
    )
  )

  const profile = coalitionOperationProfile(draft, coalition)
  return {
    id: createPlanId('intercept', inbound.packageId),
    kind: 'intercept',
    type: 'Intercept Package',
    coalition,
    priority: profile.archetype === 'defense-crisis' ? 94 : 88,
    reason: 'Scramble against an inbound raid',
    targetId: inbound.packageId,
    targetObjectiveId: inbound.targetObjectiveId,
    targetType: 'raid',
    tot: inbound.tot,
    flights: [
      {
        role: 'intercept',
        task: 'Intercept',
        aircraftType,
        homeBase: nearest,
        target: {
          id: inbound.packageId,
          type: 'Package',
          objectiveId: inbound.targetObjectiveId
        },
        targetPosition: inbound.interceptPoint,
        tot: startTime
      }
    ]
  }
}

function makeSweepPlan(
  draft: Campaign,
  coalition: Coalition,
  context: SpawnContext,
  rejected: RejectedAtoPackage[]
): AtoPackagePlan | null {
  const profile = coalitionOperationProfile(draft, coalition)
  if (profile.tempo === 'cautious' || profile.archetype === 'defense-crisis') {
    pushRejection(rejected, 'sweep', 'no target')
    return null
  }
  if (
    activeTaskCount(draft, coalition, 'Fighter Sweep') >=
    scaledMaxActive(draft, config.packages['Fighter Sweep'].maxActive[coalition])
  ) {
    pushRejection(rejected, 'sweep', 'budget exhausted')
    return null
  }
  if (!hasAircraft(draft, coalition, 'Fighter Sweep')) {
    pushRejection(rejected, 'sweep', 'no aircraft')
    return null
  }

  const allHomeBases = getCoalitionAirdromes(draft, context.theatre, coalition)
  const homeBases = getSupportedHomeBases(draft, coalition, allHomeBases, 'Fighter Sweep')
  if (allHomeBases.length > 0 && homeBases.length === 0) {
    pushRejection(rejected, 'sweep', 'supply blocked')
    return null
  }

  const enemyAirdromes = getCoalitionAirdromes(draft, context.theatre, context.enemyCoalition)
  const flotAssignment = selectFlotOrbitAssignment({
    draft,
    coalition,
    context,
    homeBases,
    maxDistance: config.packages['Fighter Sweep'].maxDistance,
    depth: flotSweepDepth(profile),
    occupiedTask: 'Fighter Sweep'
  })
  const laneAssignment = flotAssignment
    ? null
    : selectCapPatrolAssignment({
        homeBases,
        enemyAirdromes,
        coveredHomeBases: new Set(),
        maxHomeToEnemyDistance: config.packages['Fighter Sweep'].maxDistance
      })
  const assignment = flotAssignment
    ? flotAssignment
    : laneAssignment
      ? {
          homeBase: laneAssignment.homeBase,
          patrolCenter: {
            x:
              laneAssignment.homeBase.position.x +
              (laneAssignment.patrolCenter.x - laneAssignment.homeBase.position.x) * 2,
            y:
              laneAssignment.homeBase.position.y +
              (laneAssignment.patrolCenter.y - laneAssignment.homeBase.position.y) * 2
          }
        }
      : null
  if (!assignment) {
    pushRejection(rejected, 'sweep', 'no target')
    return null
  }
  if (isAirbaseSupplyBlocked(draft, coalition, assignment.homeBase.name)) {
    pushRejection(rejected, 'sweep', 'supply blocked', assignment.homeBase.name)
    return null
  }

  const aircraftType = pickAircraft(draft, coalition, 'Fighter Sweep', assignment.homeBase.name)
  if (!aircraftType) {
    pushRejection(rejected, 'sweep', 'no aircraft')
    return null
  }

  const targetId = flotAssignment
    ? `sweep-${flotAssignment.stationId}`
    : `sweep-${assignment.homeBase.name}`
  const tot = addMinutes(draft.time, 25)
  return {
    id: createPlanId('sweep', targetId),
    kind: 'sweep',
    type: 'Sweep Package',
    coalition,
    priority: profile.archetype === 'air-superiority' ? 82 : 74,
    reason: flotAssignment ? 'Fighter sweep past the FLOT' : 'Fighter sweep toward enemy airspace',
    targetId,
    targetObjectiveId: targetId,
    targetType: 'airspace',
    tot,
    flights: [
      {
        role: 'sweep',
        task: 'Fighter Sweep',
        aircraftType,
        homeBase: assignment.homeBase,
        targetPosition: assignment.patrolCenter,
        patrolCenter: assignment.patrolCenter,
        tot
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
  if (!groundOffensiveOpen(draft)) {
    return []
  }
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
  const eligibleGroundGroups = draft.coalitions[context.enemyCoalition].groundGroups.filter(
    (group) => evaluateCombatViability(group).casEligible && !existingTargets.has(group.id)
  )
  // CAS and BAI go after units someone has seen; armed recon goes looking for the rest.
  const enemyGroundGroups = eligibleGroundGroups.filter((group) =>
    isEnemyKnown(draft, coalition, group.id)
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
      params.variantId === 'defensive-cas' ||
      params.variantId === 'troops-in-contact' ||
      params.variantId === 'on-call-cas'
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
      tot: addMinutes(
        draft.time,
        params.variantId === 'on-call-cas' ? 10 : params.variantId === 'armed-recon' ? 38 : 25
      ),
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

    const assault = group.captureStartedAt != null
    const plan = createCasPlan({
      variantId: assault
        ? 'on-call-cas'
        : group.state === 'combat'
          ? 'troops-in-contact'
          : 'defensive-cas',
      variantLabel: assault
        ? 'On-call CAS'
        : group.state === 'combat'
          ? 'Troops In Contact'
          : 'Defensive CAS',
      reason: assault
        ? `On-call CAS for the assault on ${group.targetObjectiveId}`
        : group.state === 'combat'
          ? `Friendly troops in contact at ${group.targetObjectiveId}`
          : `Enemy ground attack threatening ${group.targetObjectiveId}`,
      priority: assault ? 90 : group.state === 'combat' ? 76 : 72,
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

    const assault = group.captureStartedAt != null
    const plan = createCasPlan({
      variantId: assault
        ? 'on-call-cas'
        : group.state === 'combat'
          ? 'troops-in-contact'
          : 'defensive-cas',
      variantLabel: assault
        ? 'On-call CAS'
        : group.state === 'combat'
          ? 'Troops In Contact'
          : 'Defensive CAS',
      reason: assault
        ? `On-call CAS for the assault on ${group.targetAirdromeName}`
        : group.state === 'combat'
          ? `Friendly troops in contact at ${group.targetAirdromeName}`
          : `Enemy ground attack threatening ${group.targetAirdromeName}`,
      priority: assault ? 90 : group.state === 'combat' ? 76 : 72,
      group,
      targetObjectiveId: group.targetAirdromeName,
      targetPosition: group.position,
      threatenedPosition
    })
    if (plan) plans.push(plan)
  }

  const flotStations = theatreHasLandGraph(context.theatre)
    ? findFlotStations({
        theatre: context.theatre,
        friendlyObjectiveIds: draft.coalitions[coalition].objectiveIds,
        friendlyAirdromeNames: draft.coalitions[coalition].airdromeNames,
        enemyObjectiveIds: draft.coalitions[context.enemyCoalition].objectiveIds,
        enemyAirdromeNames: draft.coalitions[context.enemyCoalition].airdromeNames
      })
    : []
  const taskedCasTargets = new Set(plans.map((plan) => plan.targetId))

  for (const group of enemyGroundGroups) {
    if (taskedCasTargets.has(group.id)) continue
    const onFlot =
      flotTouchesObjective(flotStations, group.objectiveId) ||
      flotTouchesObjective(flotStations, group.targetObjectiveId) ||
      flotTouchesObjective(flotStations, group.targetAirdromeName)
    if (!onFlot) continue

    const plan = createCasPlan({
      variantId: 'bai',
      variantLabel: 'BAI',
      reason: `BAI against enemy forces on the FLOT near ${group.objectiveId ?? group.targetObjectiveId}`,
      priority: 68,
      group,
      targetObjectiveId: group.objectiveId ?? group.targetObjectiveId ?? group.id,
      targetPosition: group.position
    })
    if (plan) {
      plans.push(plan)
      taskedCasTargets.add(group.id)
    }
  }

  const armedReconTargets = eligibleGroundGroups
    .filter((group) => group.state !== 'combat' && group.objectiveId != null)
    .filter((group) => !taskedCasTargets.has(group.id))
    .filter((group) => {
      if (flotStations.length === 0) return true
      return (
        flotTouchesObjective(flotStations, group.objectiveId) ||
        flotTouchesObjective(flotStations, group.targetObjectiveId)
      )
    })
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
    if (isLogisticsStructure(plan.targetType) || profile.archetype === 'attrition') {
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

const LOW_CEILING_KINDS = new Set<AtoPackageKind>([
  'cas',
  'strike',
  'strategicStrike',
  'oca',
  'dead'
])

function scoreCandidate(
  draft: Campaign,
  coalition: Coalition,
  plan: AtoPackagePlan,
  profile: OperationProfile
) {
  let score = plan.priority + priorityScore(draft, coalition, plan)

  // Under a low cloud deck visual and laser attacks need to dive under it: hold them back.
  if (isLowCeiling(draft.weather) && LOW_CEILING_KINDS.has(plan.kind)) {
    score -= draft.weather?.pattern === 'rain' ? 30 : 20
  }

  if (profile.archetype === 'defense-crisis') {
    if (
      plan.variantId === 'defensive-cas' ||
      plan.variantId === 'troops-in-contact' ||
      plan.variantId === 'on-call-cas'
    )
      score += 18
    if (plan.kind === 'intercept') score += 22
    if (plan.variantId === 'point-defense-cap') score += 8
    if (plan.variantId === 'havcap') score += 8
    if (plan.variantId === 'ambush-cap') score += 12
    if (plan.variantId === 'deep-interdiction' || plan.kind === 'strategicStrike') score -= 20
  }
  if (profile.archetype === 'breakthrough') {
    if (plan.kind === 'cas' || plan.variantId === 'frontline-raid') score += 10
    if (plan.variantId === 'bai') score += 6
    if (plan.kind === 'oca') score += 12
    if (plan.kind === 'sweep') score += 10
    if (plan.kind === 'dead') score += 5
  }
  if (profile.archetype === 'attrition') {
    if (plan.variantId === 'logistics-strike' || plan.kind === 'dead') score += 12
    if (plan.variantId === 'road-cut') score += 10
    if (plan.variantId === 'bai' || plan.variantId === 'armed-recon') score += 5
  }
  if (profile.archetype === 'air-superiority') {
    if (plan.kind === 'cap' || plan.kind === 'dead' || plan.kind === 'oca') score += 14
    if (plan.kind === 'awacs') score += 16
    if (plan.kind === 'intercept') score += 8
    if (plan.kind === 'sweep') score += 14
    if (plan.kind === 'cas') score -= 6
  }
  if (profile.archetype === 'defense-crisis' && plan.kind === 'awacs') score += 6
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
  let capPairsLeft = Math.max(
    0,
    scaledMaxActive(draft, config.packages.CAP.maxActive[coalition]) -
      activeTaskCount(draft, coalition, 'CAP')
  )

  for (const candidate of candidates) {
    if (admitted.length >= policy.maxNewPackagesPerLogicTick || packageBudget <= 0) {
      pushRejection(rejected, candidate.kind, 'budget exhausted', candidate.targetId)
      continue
    }
    if (admittedTargets.has(candidate.targetId)) {
      pushRejection(rejected, candidate.kind, 'duplicate target', candidate.targetId)
      continue
    }

    const capPairs =
      candidate.kind === 'cap'
        ? candidate.flights.filter((flight) => flight.task === 'CAP').length
        : 0
    if (capPairs > capPairsLeft) {
      pushRejection(rejected, candidate.kind, 'budget exhausted', candidate.targetId)
      continue
    }

    const aircraftCount = getPlanAircraftCount(candidate)
    if (aircraftCount > aircraftBudget) {
      pushRejection(rejected, candidate.kind, 'budget exhausted', candidate.targetId)
      continue
    }
    if (
      candidate.kind !== 'relocate' &&
      !reservePlanLogistics(draft, coalition, candidate, remainingLogisticsByAirbase)
    ) {
      pushRejection(rejected, candidate.kind, 'supply blocked', candidate.targetId)
      continue
    }

    admitted.push(candidate)
    admittedTargets.add(candidate.targetId)
    aircraftBudget -= aircraftCount
    packageBudget -= 1
    capPairsLeft -= capPairs
  }

  return admitted
}

function dropDeadCoveredByStrike(plans: AtoPackagePlan[]) {
  const covered = new Set<string>()
  for (const plan of plans) {
    if (plan.kind !== 'strike' && plan.kind !== 'strategicStrike' && plan.kind !== 'oca') continue
    for (const flight of plan.flights) {
      if ((flight.task === 'SEAD' || flight.task === 'DEAD') && flight.target?.id) {
        covered.add(flight.target.id)
      }
    }
  }

  return plans.filter((plan) => plan.kind !== 'dead' || !covered.has(plan.targetId))
}

function namedTheatrePosition(context: SpawnContext, name: string): Position | undefined {
  return (
    getObjectivePosition(context.theatre, name) ??
    (context.theatre.airdromeDetails[name]
      ? { x: context.theatre.airdromeDetails[name].x, y: context.theatre.airdromeDetails[name].y }
      : undefined)
  )
}

function makeRoadCutPlan(
  draft: Campaign,
  coalition: Coalition,
  context: SpawnContext,
  rejected: RejectedAtoPackage[]
): AtoPackagePlan | null {
  if (!groundOffensiveOpen(draft)) return null
  if (!hasAircraft(draft, coalition, 'Pinpoint Strike')) {
    return null
  }
  const closed = activeRoadCutKeys(draft)
  const enemy = draft.coalitions[context.enemyCoalition]
  const seen = new Set<string>()
  let hop: { from: string; to: string; position: Position } | null = null
  for (const group of enemy.groundGroups) {
    if (group.state !== 'moving' && group.state !== 'combat') continue
    if (!isEnemyKnown(draft, coalition, group.id)) continue
    const from = group.objectiveId
    const to = group.targetObjectiveId ?? group.targetAirdromeName
    if (!from || !to || from === to) continue
    const id = roadTargetId(from, to)
    if (seen.has(id) || closed.has(id.slice('road|'.length))) continue
    if (isTargetAlreadyAssigned(draft, coalition, id)) continue
    const fromPosition = namedTheatrePosition(context, from)
    const toPosition = namedTheatrePosition(context, to)
    if (!fromPosition || !toPosition) continue
    seen.add(id)
    hop = {
      from,
      to,
      position: {
        x: (fromPosition.x + toPosition.x) / 2,
        y: (fromPosition.y + toPosition.y) / 2
      }
    }
    break
  }
  if (!hop) return null

  const homeBases = getSupportedHomeBases(
    draft,
    coalition,
    getCoalitionAirdromes(draft, context.theatre, coalition),
    'Pinpoint Strike'
  )
  const homeBase = [...homeBases].sort(
    (left, right) =>
      calculateDistance(left.position, hop.position) -
      calculateDistance(right.position, hop.position)
  )[0]
  if (!homeBase) {
    pushRejection(rejected, 'strike', 'supply blocked')
    return null
  }
  const aircraftType = pickAircraft(draft, coalition, 'Pinpoint Strike', homeBase.name)
  if (!aircraftType) {
    pushRejection(rejected, 'strike', 'no aircraft')
    return null
  }

  const targetId = roadTargetId(hop.from, hop.to)
  const tot = addMinutes(draft.time, 25)
  const flights: FlightPlanDescriptor[] = [
    {
      role: 'primary',
      task: 'Pinpoint Strike',
      aircraftType,
      homeBase,
      targetPosition: hop.position,
      tot,
      target: {
        id: targetId,
        type: 'Road',
        objectiveId: hop.to
      }
    }
  ]
  if (strikeWaitsForSuppression(draft, coalition, context, hop.position, flights)) {
    pushRejection(rejected, 'strike', 'threat too high', targetId)
    return null
  }

  return {
    id: createPlanId('strike', targetId),
    kind: 'strike',
    type: 'Strike Package',
    coalition,
    variantId: 'road-cut',
    variantLabel: 'Road Cut',
    priority: 78,
    reason: `Cut the road from ${hop.from} to ${hop.to}`,
    targetId,
    targetObjectiveId: hop.to,
    targetType: 'Road',
    tot,
    flights
  }
}

export function planAtoPackages(
  draft: Campaign,
  coalition: Coalition,
  context: SpawnContext,
  policy: AtoPlannerPolicy = defaultAtoPlannerPolicy
): AtoPlannerResult {
  const rejected: RejectedAtoPackage[] = []
  const profile = getDefaultOperationProfile(draft, coalition)
  const candidates = dropDeadCoveredByStrike(
    [
      makeCapPlan(draft, coalition, context, rejected),
      makeHavcapPlan(draft, coalition, context, rejected),
      makeAmbushPlan(draft, coalition, context, rejected),
      makeInterceptPlan(draft, coalition, context, rejected),
      makeRelocatePlan(draft, coalition, context, rejected),
      makeSweepPlan(draft, coalition, context, rejected),
      makeAwacsPlan(draft, coalition, context, rejected),
      makeEcmPlan(draft, coalition, context, rejected),
      makeStrikePlan(draft, coalition, context, 'Pinpoint Strike', rejected),
      makeRoadCutPlan(draft, coalition, context, rejected),
      makeStrikePlan(draft, coalition, context, 'Strategic Strike', rejected),
      makeDeadPlan(draft, coalition, context, rejected),
      makeOcaPlan(draft, coalition, context, rejected),
      ...makeCasPlans(draft, coalition, context, rejected),
      makeTransportPlan(draft, coalition, context, rejected, policy)
    ].filter((plan): plan is AtoPackagePlan => {
      if (plan == null) return false
      if (!isPlanSuppressed(draft, coalition, plan)) return true
      pushRejection(rejected, plan.kind, 'commander priority', plan.targetId)
      return false
    })
  )
    .map((plan) => applyVariantDefaults(plan, profile))
    .sort(
      (a, b) =>
        scoreCandidate(draft, coalition, b, profile) - scoreCandidate(draft, coalition, a, profile)
    )

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

  if (plan.kind === 'relocate' && flight.target) {
    const destination = flight.target.objectiveId
    const flightGroupId = spawnPlannedFlightGroup({
      draft,
      coalition,
      task: 'CAP',
      aircraftType: flight.aircraftType,
      aircraftCount: getFlightAircraftCount(flight),
      homeBase: destination,
      homeBasePosition: flight.homeBase.position,
      destination: flight.targetPosition,
      missionWaypoints: [
        {
          name: 'Departure',
          position: flight.homeBase.position,
          altitude: 3000,
          speed: 200,
          type: 'Nav'
        },
        {
          name: destination,
          position: flight.targetPosition,
          altitude: 0,
          speed: 150,
          type: 'Landing'
        }
      ],
      startTime: flight.tot ?? plan.tot,
      runwayAngle: flight.homeBase.runwayAngle,
      packageId: plan.id,
      tot: flight.tot ?? plan.tot,
      target: flight.target
    }).flightGroupId
    return flightGroupId
  }

  if (flight.task === 'CAP' && flight.patrolCenter) {
    const flightGroupId = CapFlightGroup.spawn(draft, coalition, {
      homeBase: flight.homeBase.name,
      homeBasePosition: flight.homeBase.position,
      patrolCenter: flight.patrolCenter,
      runwayAngle: flight.homeBase.runwayAngle,
      aircraftType: flight.aircraftType,
      packageId: plan.id,
      startTime: flight.tot,
      patrolAltitude: flight.patrolAltitude,
      patrolDurationMs: flight.patrolDurationMs,
      target: flight.target
    }).flightGroupId
    spendHomeBaseLogistics()
    return flightGroupId
  }

  if (flight.task === 'ECM' && flight.patrolCenter) {
    const flightGroupId = spawnPlannedFlightGroup({
      draft,
      coalition,
      task: 'ECM',
      aircraftType: flight.aircraftType,
      aircraftCount: config.packages.ECM.aircraftsPerGroup,
      homeBase: flight.homeBase.name,
      homeBasePosition: flight.homeBase.position,
      destination: flight.patrolCenter,
      missionWaypoints: buildAwacsMissionWaypoints(flight.homeBase.position, flight.patrolCenter),
      startTime: flight.tot ?? addMinutes(draft.time, 20),
      runwayAngle: flight.homeBase.runwayAngle,
      packageId: plan.id,
      tot: flight.tot ?? plan.tot
    }).flightGroupId
    spendHomeBaseLogistics()
    return flightGroupId
  }

  if (flight.task === 'AWACS' && flight.patrolCenter) {
    const flightGroupId = spawnPlannedFlightGroup({
      draft,
      coalition,
      task: 'AWACS',
      aircraftType: flight.aircraftType,
      aircraftCount: config.packages.AWACS.aircraftsPerGroup,
      homeBase: flight.homeBase.name,
      homeBasePosition: flight.homeBase.position,
      destination: flight.patrolCenter,
      missionWaypoints: buildAwacsMissionWaypoints(flight.homeBase.position, flight.patrolCenter),
      startTime: flight.tot ?? addMinutes(draft.time, 15),
      runwayAngle: flight.homeBase.runwayAngle,
      packageId: plan.id,
      tot: flight.tot ?? plan.tot
    }).flightGroupId
    spendHomeBaseLogistics()
    return flightGroupId
  }

  if (flight.task === 'Intercept' && flight.target) {
    const flightGroupId = spawnPlannedFlightGroup({
      draft,
      coalition,
      task: 'Intercept',
      aircraftType: flight.aircraftType,
      aircraftCount: config.packages.Intercept.aircraftsPerGroup,
      homeBase: flight.homeBase.name,
      homeBasePosition: flight.homeBase.position,
      destination: flight.targetPosition,
      missionWaypoints: buildInterceptMissionWaypoints(
        flight.homeBase.position,
        flight.targetPosition
      ),
      startTime: flight.tot ?? addMinutes(draft.time, 8),
      runwayAngle: flight.homeBase.runwayAngle,
      target: {
        id: flight.target.id,
        type: flight.target.type,
        objectiveId: flight.target.objectiveId
      },
      packageId: plan.id,
      tot: flight.tot ?? plan.tot
    }).flightGroupId
    spendHomeBaseLogistics()
    return flightGroupId
  }

  if (flight.task === 'Fighter Sweep' && flight.patrolCenter) {
    const flightGroupId = spawnPlannedFlightGroup({
      draft,
      coalition,
      task: 'Fighter Sweep',
      aircraftType: flight.aircraftType,
      aircraftCount: config.packages['Fighter Sweep'].aircraftsPerGroup,
      homeBase: flight.homeBase.name,
      homeBasePosition: flight.homeBase.position,
      destination: flight.patrolCenter,
      missionWaypoints: buildFighterSweepMissionWaypoints(
        flight.homeBase.position,
        flight.patrolCenter
      ),
      startTime: flight.tot ?? addMinutes(draft.time, 25),
      runwayAngle: flight.homeBase.runwayAngle,
      packageId: plan.id,
      tot: flight.tot ?? plan.tot
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

  if (flight.task === 'Runway Attack' && flight.target) {
    const flightGroupId = spawnPlannedFlightGroup({
      draft,
      coalition,
      task: 'Runway Attack',
      aircraftType: flight.aircraftType,
      aircraftCount: config.packages['Runway Attack'].aircraftsPerGroup,
      homeBase: flight.homeBase.name,
      homeBasePosition: flight.homeBase.position,
      destination: flight.targetPosition,
      missionWaypoints: buildAttackMissionWaypoints(
        flight.homeBase.position,
        flight.targetPosition
      ),
      startTime: flight.tot ?? addMinutes(draft.time, 35),
      runwayAngle: flight.homeBase.runwayAngle,
      target: {
        id: flight.target.id,
        type: flight.target.type,
        objectiveId: flight.target.objectiveId
      },
      packageId: plan.id,
      tot: flight.tot ?? plan.tot
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
      tot: flight.tot ?? new Date(plan.tot.getTime() - config.packages.SEAD.leadTime),
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
      tot: flight.tot ?? plan.tot,
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
      const totOffset = flight.tot
        ? flight.tot.getTime() - plan.tot.getTime()
        : flight.task === 'SEAD'
          ? -config.packages.SEAD.leadTime
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

export type SupportRequest = 'escort' | 'sead' | 'sweep'

const SUPPORT_TASKS: Record<
  SupportRequest,
  { task: FlightTask; role: PackageMemberRole; label: string }
> = {
  escort: { task: 'CAP', role: 'cap', label: 'escort' },
  sead: { task: 'SEAD', role: 'sead', label: 'SEAD' },
  sweep: { task: 'Fighter Sweep', role: 'sweep', label: 'sweep' }
}

const PACKAGE_TYPE_BY_TASK: Partial<Record<FlightTask, MissionPackage['type']>> = {
  CAS: 'CAS Package',
  DEAD: 'DEAD Package',
  'Antiship Strike': 'Antiship Package',
  'Pinpoint Strike': 'Strike Package',
  'Strategic Strike': 'Strike Package',
  'Runway Attack': 'OCA Package'
}

/** Support flights must not be asked to take off in the past. */
const SUPPORT_MIN_LEAD_MS = 5 * 60_000

/**
 * Falcon BMS "add flight to package": the player asks for an AI escort, SEAD or sweep to go with
 * a flight they fly. The support comes out of the coalition's squadrons like any ATO flight and
 * joins the flight's package (one is made if the flight had none).
 */
export function requestPackageSupport(
  draft: Campaign,
  coalition: Coalition,
  flightGroupId: string,
  request: SupportRequest,
  spawnContext?: SpawnContext
): { ok: true; callsign: string } | { ok: false; reason: string } {
  const context = spawnContext ?? resolveSpawnContext(draft, coalition)
  if (!context) return { ok: false, reason: 'no theatre' }
  const side = draft.coalitions[coalition]
  const group = side.flightGroups.find((entry) => entry.id === flightGroupId)
  if (!group) return { ok: false, reason: 'flight not found' }
  const support = SUPPORT_TASKS[request]

  const existingPackage = group.packageId
    ? side.packages.find((entry) => entry.id === group.packageId)
    : undefined
  if (existingPackage?.members.some((member) => member.role === support.role)) {
    return { ok: false, reason: `the package already has ${support.label}` }
  }

  const airdromes = getCoalitionAirdromes(draft, context.theatre, coalition)
  const homeBase =
    airdromes.find((base) => base.name === group.homeBase) ??
    [...airdromes].sort(
      (a, b) =>
        calculateDistance(a.position, group.position) -
        calculateDistance(b.position, group.position)
    )[0]
  if (!homeBase) return { ok: false, reason: 'no friendly airfield' }

  // The far end of the route is the target area.
  const targetPosition =
    [...group.flightplan.waypoints]
      .map((waypoint) => waypoint.position)
      .sort(
        (a, b) => calculateDistance(b, homeBase.position) - calculateDistance(a, homeBase.position)
      )[0] ?? group.position
  const tot =
    group.tot ??
    existingPackage?.tot ??
    new Date(new Date(group.flightplan.startTime).getTime() + 30 * 60_000)
  const lead = (ms: number) =>
    new Date(Math.max(tot.getTime() - ms, draft.time.getTime() + SUPPORT_MIN_LEAD_MS))

  const aircraftType =
    pickAircraft(draft, coalition, support.task, homeBase.name) ??
    pickAircraft(draft, coalition, support.task)
  if (!aircraftType) return { ok: false, reason: `no aircraft ready for ${support.label}` }

  let flight: FlightPlanDescriptor
  if (request === 'sead') {
    const threat = getClosestThreateningSam(
      targetPosition,
      draft.coalitions[context.enemyCoalition].samGroups,
      context.theatre,
      draft,
      context.enemyCoalition
    )
    if (!threat) return { ok: false, reason: 'no SAM threatens the target' }
    flight = {
      role: 'sead',
      task: 'SEAD',
      aircraftType,
      homeBase,
      target: {
        id: threat.samGroup.id,
        type: threat.samGroup.type,
        objectiveId: threat.samGroup.objectiveId
      },
      targetPosition: threat.position,
      tot: lead(config.packages.SEAD.leadTime)
    }
  } else {
    const patrolCenter =
      request === 'escort'
        ? escortPatrolCenter(homeBase.position, targetPosition)
        : {
            x: homeBase.position.x + (targetPosition.x - homeBase.position.x) * 0.9,
            y: homeBase.position.y + (targetPosition.y - homeBase.position.y) * 0.9
          }
    flight = {
      role: support.role,
      task: support.task,
      aircraftType,
      homeBase,
      targetPosition: patrolCenter,
      patrolCenter,
      tot: lead(request === 'escort' ? config.packages.CAP.escortLeadTime : 10 * 60_000)
    }
  }

  const packageId = existingPackage?.id ?? `player-package-${group.id}`
  const plan: AtoPackagePlan = {
    id: packageId,
    kind: request === 'sead' ? 'dead' : request === 'sweep' ? 'sweep' : 'cap',
    type: existingPackage?.type ?? PACKAGE_TYPE_BY_TASK[group.task] ?? 'CAP Package',
    coalition,
    priority: existingPackage?.priority ?? 80,
    reason: `Support requested for ${group.callsign}`,
    targetId: group.target?.id ?? group.id,
    targetObjectiveId: existingPackage?.targetObjectiveId ?? group.target?.objectiveId ?? group.id,
    targetType: existingPackage?.targetType ?? group.target?.type ?? 'airspace',
    tot,
    flights: [flight]
  }
  const supportId = commitFlight(draft, coalition, plan, flight)
  if (!supportId) return { ok: false, reason: `could not launch the ${support.label}` }
  const member = {
    flightGroupId: supportId,
    role: flight.role,
    totOffset: (flight.tot ?? tot).getTime() - tot.getTime()
  }
  if (existingPackage) {
    existingPackage.members.push(member)
  } else {
    createMissionPackage(draft, coalition, plan, [
      { flightGroupId: group.id, role: 'primary', totOffset: 0 },
      member
    ])
    group.packageId = packageId
  }
  const callsign =
    side.flightGroups.find((entry) => entry.id === supportId)?.callsign ?? support.label
  logSpawnAction(
    draft,
    coalition,
    `${callsign} (${aircraftType}) assigned as ${support.label} for ${group.callsign}`
  )
  return { ok: true, callsign }
}
