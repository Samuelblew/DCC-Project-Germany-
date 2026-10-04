import { config, schemas } from '@dcc/contracts'
import { evaluateCombatViability } from '@dcc/campaign'
import { aircrafts } from '@dcc/data'
import * as z from 'zod'

import {
  buildAttackMissionWaypoints,
  buildCasMissionWaypoints,
  buildCapMissionWaypoints,
  buildDeadMissionWaypoints,
  buildFighterSweepMissionWaypoints,
  buildSeadMissionWaypoints,
  buildStrikeMissionWaypoints,
  buildTrainingMissionWaypoints,
  buildTransportMissionWaypoints,
  spawnPlannedFlightGroup
} from '../../entities/flight-group-spawn'
import { getObjectivePosition } from '@/logic/utils/get-objective-position'
import { calculateDistance } from '@/logic/utils/calculate-distance'
import { getIadsEmitterTargets } from '@/logic/iads-emitter-targets'
import {
  getCoalitionAirdromes,
  getCoalitionCasHomeBases,
  pickRandomAircraftType as pickRandomAircraftTypeFrom,
  resolveSpawnContext,
  selectCapPatrolAssignment,
  selectHomeBaseAndTarget,
  type AirdromeSelection
} from './packages/common'

type Campaign = z.infer<typeof schemas.campaign.campaign>
type Coalition = z.infer<typeof schemas.coalition>
type FlightTask = z.infer<typeof schemas.flightGroup>['task']
type AircraftName = z.infer<typeof schemas.dcs.aircraftName>
type Position = z.infer<typeof schemas.position>
type Supply = z.infer<typeof schemas.supply>

type ManualSpawnPlan =
  | {
      task: 'CAP'
      aircraftType: AircraftName
      homeBase: string
      homeBasePosition: Position
      runwayAngle?: number
      patrolCenter: Position
    }
  | {
      task: 'Pinpoint Strike' | 'DEAD' | 'CAS' | 'SEAD'
      aircraftType: AircraftName
      homeBase: string
      homeBasePosition: Position
      runwayAngle?: number
      target: {
        id: string
        type: string
        objectiveId: string
        position?: Position
        buildings?: z.infer<typeof schemas.structureBuilding>[]
      }
      targetPosition: Position
    }
  | {
      task: 'Transport'
      aircraftType: AircraftName
      homeBase: string
      homeBasePosition: Position
      runwayAngle?: number
      destinationPosition: Position
      sourceNode: string
      destinationNode: string
      cargoAmount: number
    }
  | {
      task: 'Fighter Sweep'
      aircraftType: AircraftName
      homeBase: string
      homeBasePosition: Position
      runwayAngle?: number
      conflictPosition: Position
      objectiveId: string
    }
  | {
      task: 'Training'
      aircraftType: AircraftName
      homeBase: string
      homeBasePosition: Position
      runwayAngle?: number
      awayFromEnemy: { x: number; y: number }
    }

type GroundConflict = { id: string; objectiveId: string; position: Position }

type SupplyNode = {
  id: string
  type: 'airdrome' | 'objective'
  position: Position
  supply: Supply
  runwayAngle?: number
  urgency?: number
}

function getAvailableDeadAircraftTypes(draft: Campaign, coalition: Coalition) {
  const configuredDeadAircraftTypes = draft.coalitions[coalition].aircraftTypes.DEAD
  if (configuredDeadAircraftTypes.length > 0) {
    return configuredDeadAircraftTypes
  }

  const aircraftDefinitions = Object.values(aircrafts)
  const coalitionAircraftTypes = new Set(
    Object.values(draft.coalitions[coalition].aircraftTypes).flat()
  )

  return [...coalitionAircraftTypes].filter((aircraftType) =>
    aircraftDefinitions.some(
      (aircraft) => aircraft.name === aircraftType && aircraft.availableTasks.includes('DEAD')
    )
  )
}

function getNodesNeedingResupply(
  draft: Campaign,
  coalition: Coalition,
  theatre: z.infer<typeof schemas.theatre>
): SupplyNode[] {
  const nodes: SupplyNode[] = []
  const supplyNodes = draft.coalitions[coalition].supplyNodes
  if (!supplyNodes) return nodes

  for (const objectiveId of draft.coalitions[coalition].objectiveIds) {
    const supply = supplyNodes[objectiveId]
    const objective = theatre.objectives.find((o) => o.name === objectiveId)
    if (!supply || !objective || supply.status === 'abundant') continue

    nodes.push({
      id: objectiveId,
      type: 'objective',
      position: objective.position,
      supply,
      urgency: 1 - supply.current / supply.max
    })
  }

  for (const airdromeName of draft.coalitions[coalition].airdromeNames) {
    const supply = supplyNodes[airdromeName]
    const airdrome = theatre.airdromeDetails[airdromeName]
    if (!supply || !airdrome || supply.status === 'abundant') continue

    nodes.push({
      id: airdromeName,
      type: 'airdrome',
      position: { x: airdrome.x, y: airdrome.y },
      supply,
      runwayAngle: airdrome.runwayAngle,
      urgency: 1 - supply.current / supply.max
    })
  }

  return nodes.sort((a, b) => (b.urgency ?? 0) - (a.urgency ?? 0))
}

function getNearestSupplySource(
  draft: Campaign,
  coalition: Coalition,
  theatre: z.infer<typeof schemas.theatre>,
  targetPosition: Position
): SupplyNode | null {
  let nearest: SupplyNode | null = null
  let nearestDistance = Number.POSITIVE_INFINITY
  const supplyNodes = draft.coalitions[coalition].supplyNodes
  if (!supplyNodes) return null

  for (const airdromeName of draft.coalitions[coalition].airdromeNames) {
    const supply = supplyNodes[airdromeName]
    const airdrome = theatre.airdromeDetails[airdromeName]
    if (!supply || !airdrome || supply.current <= supply.max * 0.5) continue

    const position = { x: airdrome.x, y: airdrome.y }
    const distance = calculateDistance(position, targetPosition)
    if (distance < nearestDistance && distance < config.packages.Transport.maxDistance) {
      nearestDistance = distance
      nearest = {
        id: airdromeName,
        type: 'airdrome',
        position,
        supply,
        runwayAngle: airdrome.runwayAngle
      }
    }
  }

  return nearest
}

/**
 * Ground fights to cover, most urgent first: groups in combat, then advancing groups, then the
 * enemy groups closest to friendly objectives.
 */
function getGroundConflicts(
  draft: Campaign,
  coalition: Coalition,
  enemyCoalition: Coalition,
  theatre: z.infer<typeof schemas.theatre>
): GroundConflict[] {
  const allGroups = [
    ...draft.coalitions[coalition].groundGroups,
    ...draft.coalitions[enemyCoalition].groundGroups
  ]
  const toConflict = (group: (typeof allGroups)[number]): GroundConflict | null => {
    const objectiveId = group.targetObjectiveId ?? group.objectiveId
    return objectiveId ? { id: group.id, objectiveId, position: group.position } : null
  }
  const isConflict = (conflict: GroundConflict | null): conflict is GroundConflict =>
    conflict != null

  const fighting = allGroups
    .filter((group) => group.state === 'combat')
    .map(toConflict)
    .filter(isConflict)
  if (fighting.length > 0) return fighting

  const advancing = allGroups
    .filter((group) => group.state === 'moving' && group.targetObjectiveId != null)
    .map(toConflict)
    .filter(isConflict)
  if (advancing.length > 0) return advancing

  const friendlyObjectivePositions = draft.coalitions[coalition].objectiveIds
    .map((objectiveId) => getObjectivePosition(theatre, objectiveId))
    .filter((position): position is Position => position != null)
  if (friendlyObjectivePositions.length === 0) return []

  return draft.coalitions[enemyCoalition].groundGroups
    .map((group) => ({
      conflict: toConflict(group),
      distance: Math.min(
        ...friendlyObjectivePositions.map((position) => calculateDistance(position, group.position))
      )
    }))
    .filter(
      (entry): entry is { conflict: GroundConflict; distance: number } => entry.conflict != null
    )
    .sort((left, right) => left.distance - right.distance)
    .slice(0, 5)
    .map((entry) => entry.conflict)
}

function getSweepPosition(flightGroup: z.infer<typeof schemas.flightGroup>): Position | null {
  return (
    flightGroup.flightplan.waypoints.find((waypoint) => waypoint.name === 'Sweep')?.position ?? null
  )
}

function pickControllableAircraftTypeFrom(aircraftTypes: string[]): AircraftName | null {
  const controllable = aircraftTypes.filter((aircraftType) =>
    Object.values(aircrafts).some(
      (aircraft) => aircraft.name === aircraftType && aircraft.controllable
    )
  )
  return pickRandomAircraftTypeFrom(controllable.length > 0 ? controllable : aircraftTypes)
}

function createManualSpawnPlan(
  draft: Campaign,
  coalition: Coalition,
  task: FlightTask,
  constraints: ManualFlightConstraints = {}
): ManualSpawnPlan | null {
  // Career flights take the owned aircraft type from the airfields it is parked at.
  const pickRandomAircraftType = (types: string[]) =>
    constraints.aircraftType ?? pickRandomAircraftTypeFrom(types)
  const pickControllableAircraftType = (types: string[]) =>
    constraints.aircraftType ?? pickControllableAircraftTypeFrom(types)
  const allowBase = (base: { name: string }) =>
    !constraints.homeBases || constraints.homeBases.has(base.name)
  const context = resolveSpawnContext(draft, coalition)
  if (!context) return null

  const { theatre, enemyCoalition } = context
  const homeBases = getCoalitionAirdromes(draft, theatre, coalition).filter(allowBase)
  const flightGroups = draft.coalitions[coalition].flightGroups

  if (task === 'CAP') {
    const capGroups = flightGroups.filter((g) => g.task === 'CAP')
    const aircraftType = pickRandomAircraftType(draft.coalitions[coalition].aircraftTypes.CAP)
    if (!aircraftType) return null

    const capPatrolCountByHomeBase = new Map<string, number>()
    for (const group of capGroups) {
      capPatrolCountByHomeBase.set(
        group.homeBase,
        (capPatrolCountByHomeBase.get(group.homeBase) ?? 0) + 1
      )
    }

    const assignment = selectCapPatrolAssignment({
      homeBases,
      enemyAirdromes: getCoalitionAirdromes(draft, theatre, enemyCoalition),
      coveredHomeBases: new Set(capGroups.map((g) => g.homeBase)),
      maxHomeToEnemyDistance: config.packages.CAP.maxDistance * 2,
      allowCoveredHomeBases: true,
      capPatrolCountByHomeBase
    })
    if (!assignment) return null

    return {
      task,
      aircraftType,
      homeBase: assignment.homeBase.name,
      homeBasePosition: assignment.homeBase.position,
      runwayAngle: assignment.homeBase.runwayAngle,
      patrolCenter: assignment.patrolCenter
    }
  }

  if (task === 'Pinpoint Strike') {
    const aircraftType = pickRandomAircraftType(
      draft.coalitions[coalition].aircraftTypes['Pinpoint Strike']
    )
    if (!aircraftType) return null

    const targetedObjectiveIds = new Set(
      flightGroups
        .filter((g) => g.task === 'Pinpoint Strike')
        .map((g) => g.target?.objectiveId)
        .filter((id): id is string => id != null)
    )
    const targets = draft.coalitions[enemyCoalition].structures
      .filter((structure) => !targetedObjectiveIds.has(structure.objectiveId))
      .map((structure) => {
        const position = getObjectivePosition(theatre, structure.objectiveId)
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

    const assignment = selectHomeBaseAndTarget({
      homeBases,
      targets,
      maxDistance: config.packages['Pinpoint Strike'].maxDistance
    })
    if (!assignment) return null

    return {
      task,
      aircraftType,
      homeBase: assignment.homeBase.name,
      homeBasePosition: assignment.homeBase.position,
      runwayAngle: assignment.homeBase.runwayAngle,
      target: assignment.target,
      targetPosition: assignment.targetPosition
    }
  }

  if (task === 'DEAD' || task === 'SEAD') {
    const aircraftTypes =
      task === 'DEAD'
        ? getAvailableDeadAircraftTypes(draft, coalition)
        : draft.coalitions[coalition].aircraftTypes.SEAD
    const aircraftType = pickRandomAircraftType(aircraftTypes)
    if (!aircraftType) return null

    const targetedEmitterIds = new Set(
      flightGroups
        .filter((g) => g.task === task)
        .map((g) => g.target?.id)
        .filter((id): id is string => id != null)
    )
    const targets = getIadsEmitterTargets(draft, enemyCoalition, theatre, task).filter(
      (emitter) => !targetedEmitterIds.has(emitter.target.id)
    )

    const assignment = selectHomeBaseAndTarget({
      homeBases,
      targets,
      maxDistance: config.packages[task].maxDistance
    })
    if (!assignment) return null

    return {
      task,
      aircraftType,
      homeBase: assignment.homeBase.name,
      homeBasePosition: assignment.homeBase.position,
      runwayAngle: assignment.homeBase.runwayAngle,
      target: assignment.target,
      targetPosition: assignment.targetPosition
    }
  }

  if (task === 'CAS') {
    const aircraftType = pickRandomAircraftType(draft.coalitions[coalition].aircraftTypes.CAS)
    if (!aircraftType) return null
    const casHomeBases = getCoalitionCasHomeBases(draft, theatre, coalition, aircraftType).filter(
      allowBase
    )

    const targetedGroundGroupIds = new Set(
      flightGroups
        .filter((g) => g.task === 'CAS')
        .map((g) => g.target?.id)
        .filter((id): id is string => id != null)
    )
    const targets = draft.coalitions[enemyCoalition].groundGroups
      .filter(
        (group) =>
          evaluateCombatViability(group).casEligible &&
          group.state === 'idle' &&
          group.objectiveId != null &&
          !targetedGroundGroupIds.has(group.id)
      )
      .map((group) => {
        const objectiveId = group.objectiveId
        const position = objectiveId ? group.position : null
        return objectiveId && position
          ? {
              target: {
                id: group.id,
                type: 'Ground Group',
                objectiveId
              },
              position
            }
          : null
      })
      .filter((target): target is NonNullable<typeof target> => target != null)

    const assignment = selectHomeBaseAndTarget({
      homeBases: casHomeBases,
      targets,
      maxDistance: config.packages.CAS.maxDistance
    })
    if (!assignment) return null

    return {
      task,
      aircraftType,
      homeBase: assignment.homeBase.name,
      homeBasePosition: assignment.homeBase.position,
      runwayAngle: assignment.homeBase.runwayAngle,
      target: assignment.target,
      targetPosition: assignment.targetPosition
    }
  }

  if (task === 'Fighter Sweep') {
    const aircraftType = pickRandomAircraftType(
      schemas.resolveTaskAircraftTypes(draft.coalitions[coalition].aircraftTypes, 'Fighter Sweep')
    )
    if (!aircraftType) return null

    const sweepConfig = config.packages['Fighter Sweep']
    const coveredPositions = flightGroups
      .filter((g) => g.task === 'Fighter Sweep')
      .map(getSweepPosition)
      .filter((position): position is Position => position != null)
    const targets = getGroundConflicts(draft, coalition, enemyCoalition, theatre)
      .filter(
        (conflict) =>
          !coveredPositions.some(
            (position) =>
              calculateDistance(position, conflict.position) < sweepConfig.conflictSeparation
          )
      )
      .map((conflict) => ({ target: conflict, position: conflict.position }))

    const assignment = selectHomeBaseAndTarget({
      homeBases,
      targets,
      maxDistance: sweepConfig.maxDistance,
      preference: 'nearest'
    })
    if (!assignment) return null

    return {
      task,
      aircraftType,
      homeBase: assignment.homeBase.name,
      homeBasePosition: assignment.homeBase.position,
      runwayAngle: assignment.homeBase.runwayAngle,
      conflictPosition: assignment.targetPosition,
      objectiveId: assignment.target.objectiveId
    }
  }

  if (task === 'Training') {
    const aircraftType = pickControllableAircraftType(
      schemas.resolveTaskAircraftTypes(draft.coalitions[coalition].aircraftTypes, 'Training')
    )
    const homeBase = homeBases[Math.floor(Math.random() * homeBases.length)]
    if (!aircraftType || !homeBase) return null

    const enemyAirdromes = getCoalitionAirdromes(draft, theatre, enemyCoalition)
    const nearestEnemy = enemyAirdromes.reduce<AirdromeSelection | null>(
      (nearest, airdrome) =>
        nearest == null ||
        calculateDistance(homeBase.position, airdrome.position) <
          calculateDistance(homeBase.position, nearest.position)
          ? airdrome
          : nearest,
      null
    )
    const randomAngle = Math.random() * Math.PI * 2
    const awayFromEnemy = nearestEnemy
      ? {
          x: homeBase.position.x - nearestEnemy.position.x,
          y: homeBase.position.y - nearestEnemy.position.y
        }
      : { x: Math.cos(randomAngle), y: Math.sin(randomAngle) }

    return {
      task,
      aircraftType,
      homeBase: homeBase.name,
      homeBasePosition: homeBase.position,
      runwayAngle: homeBase.runwayAngle,
      awayFromEnemy
    }
  }

  if (task === 'Transport') {
    const transportAircraft = draft.coalitions[coalition].aircraftTypes.Transport
    const targetNode = getNodesNeedingResupply(draft, coalition, theatre)[0]
    if (!targetNode) return null

    const source = getNearestSupplySource(draft, coalition, theatre, targetNode.position)
    if (!source) return null

    const preferredType = targetNode.supply.status === 'critical' ? 'CH-47D' : 'C-130'
    const aircraftType = transportAircraft.includes(preferredType)
      ? (preferredType as AircraftName)
      : pickRandomAircraftType(transportAircraft)
    if (!aircraftType) return null

    const cargoCapacity =
      aircraftType === 'C-130'
        ? config.packages.Transport.c130CargoCapacity
        : config.packages.Transport.ch47CargoCapacity
    const cargoAmount = Math.min(
      cargoCapacity,
      Math.max(0, targetNode.supply.max - targetNode.supply.current)
    )
    if (cargoAmount <= 0) return null

    return {
      task,
      aircraftType,
      homeBase: source.id,
      homeBasePosition: source.position,
      runwayAngle: source.runwayAngle,
      destinationPosition: targetNode.position,
      sourceNode: source.id,
      destinationNode: targetNode.id,
      cargoAmount
    }
  }

  return null
}

export type ManualFlightConstraints = {
  homeBases?: ReadonlySet<string>
  aircraftType?: AircraftName
}

export function canCreateManualFlightGroup(
  draft: Campaign,
  coalition: Coalition,
  task: FlightTask,
  constraints?: ManualFlightConstraints
) {
  return createManualSpawnPlan(draft, coalition, task, constraints) != null
}

export function createManualFlightGroup(
  draft: Campaign,
  coalition: Coalition,
  task: FlightTask,
  constraints?: ManualFlightConstraints
): string | null {
  const plan = createManualSpawnPlan(draft, coalition, task, constraints)
  if (!plan) return null

  const startTime = new Date(draft.time)

  if (plan.task === 'CAP') {
    const missionWaypoints = buildCapMissionWaypoints(plan.homeBasePosition, plan.patrolCenter)
    return spawnPlannedFlightGroup({
      draft,
      coalition,
      task: plan.task,
      aircraftType: plan.aircraftType,
      aircraftCount: config.packages.CAP.aircraftsPerGroup,
      homeBase: plan.homeBase,
      homeBasePosition: plan.homeBasePosition,
      destination: plan.patrolCenter,
      missionWaypoints,
      startTime,
      runwayAngle: plan.runwayAngle,
      spawnSource: 'manual'
    }).flightGroupId
  }

  if (plan.task === 'Fighter Sweep') {
    const missionWaypoints = buildFighterSweepMissionWaypoints(
      plan.homeBasePosition,
      plan.conflictPosition
    )
    return spawnPlannedFlightGroup({
      draft,
      coalition,
      task: plan.task,
      aircraftType: plan.aircraftType,
      aircraftCount: config.packages['Fighter Sweep'].aircraftsPerGroup,
      homeBase: plan.homeBase,
      homeBasePosition: plan.homeBasePosition,
      destination: plan.conflictPosition,
      missionWaypoints,
      startTime,
      runwayAngle: plan.runwayAngle,
      spawnSource: 'manual'
    }).flightGroupId
  }

  if (plan.task === 'Training') {
    const isHelicopter =
      Object.values(aircrafts).find((aircraft) => aircraft.name === plan.aircraftType)
        ?.isHelicopter ?? false
    const missionWaypoints = buildTrainingMissionWaypoints(
      plan.homeBasePosition,
      plan.awayFromEnemy,
      config.packages.Training.routeRadius,
      isHelicopter
    )
    return spawnPlannedFlightGroup({
      draft,
      coalition,
      task: plan.task,
      aircraftType: plan.aircraftType,
      aircraftCount: config.packages.Training.aircraftsPerGroup,
      homeBase: plan.homeBase,
      homeBasePosition: plan.homeBasePosition,
      destination: missionWaypoints[0]?.position ?? plan.homeBasePosition,
      missionWaypoints,
      startTime,
      runwayAngle: plan.runwayAngle,
      spawnSource: 'manual'
    }).flightGroupId
  }

  if (plan.task === 'Transport') {
    const missionWaypoints = buildTransportMissionWaypoints(
      plan.homeBasePosition,
      plan.destinationPosition
    )
    return spawnPlannedFlightGroup({
      draft,
      coalition,
      task: plan.task,
      aircraftType: plan.aircraftType,
      aircraftCount: config.packages.Transport.aircraftsPerGroup,
      homeBase: plan.homeBase,
      homeBasePosition: plan.homeBasePosition,
      destination: plan.destinationPosition,
      missionWaypoints,
      startTime,
      runwayAngle: plan.runwayAngle,
      target: {
        id: plan.destinationNode,
        type: 'Supply Node',
        objectiveId: plan.destinationNode
      }
    }).flightGroupId
  }

  const missionWaypoints =
    plan.task === 'Pinpoint Strike'
      ? buildStrikeMissionWaypoints(
          plan.homeBasePosition,
          plan.targetPosition,
          draft.campaignParams?.exactTarget === true &&
            plan.target.position &&
            plan.target.buildings?.[0]
            ? {
                x: plan.target.position.x + plan.target.buildings[0].offset.x,
                y: plan.target.position.y + plan.target.buildings[0].offset.y
              }
            : plan.targetPosition
        )
      : plan.task === 'SEAD'
        ? buildSeadMissionWaypoints(plan.homeBasePosition, plan.targetPosition)
        : plan.task === 'DEAD'
          ? buildDeadMissionWaypoints(plan.homeBasePosition, plan.targetPosition)
          : plan.task === 'CAS'
            ? buildCasMissionWaypoints(plan.homeBasePosition, plan.targetPosition)
            : buildAttackMissionWaypoints(plan.homeBasePosition, plan.targetPosition)
  return spawnPlannedFlightGroup({
    draft,
    coalition,
    task: plan.task,
    aircraftType: plan.aircraftType,
    aircraftCount: config.packages[plan.task].aircraftsPerGroup,
    homeBase: plan.homeBase,
    homeBasePosition: plan.homeBasePosition,
    destination: plan.targetPosition,
    missionWaypoints,
    startTime,
    runwayAngle: plan.runwayAngle,
    target: plan.target
  }).flightGroupId
}
