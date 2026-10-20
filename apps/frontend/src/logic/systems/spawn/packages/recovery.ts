import { config, schemas } from '@dcc/contracts'
import { getDeploymentSites } from '@dcc/campaign'
import { aircrafts } from '@dcc/data'
import * as z from 'zod'

import { hasAirframes } from '../../air-order-of-battle'
import {
  buildCsarMissionWaypoints,
  spawnPlannedFlightGroup
} from '../../../entities/flight-group-spawn'
import { calculateDistance } from '@/logic/utils/calculate-distance'

import { getCoalitionAirdromes, getCoalitionFarps, resolveSpawnContext } from './common'

type Campaign = z.infer<typeof schemas.campaign.campaign>
type Coalition = z.infer<typeof schemas.coalition>
type AircraftName = z.infer<typeof schemas.dcs.aircraftName>
type Task = 'CASEVAC' | 'Troop Extraction'

const aircraftMap = new Map(Object.values(aircrafts).map((aircraft) => [aircraft.name, aircraft]))

function selectRecoveryAircraft(campaign: Campaign, coalition: Coalition, task: Task) {
  return (campaign.coalitions[coalition].aircraftTypes[task] ?? []).find(
    (name) =>
      aircraftMap.get(name as AircraftName)?.isHelicopter &&
      hasAirframes(campaign, coalition, name, 1)
  ) as AircraftName | undefined
}

function nearestRecoveryBase(
  draft: Campaign,
  coalition: Coalition,
  position: z.infer<typeof schemas.position>,
  maxDistance: number
) {
  const context = resolveSpawnContext(draft, coalition)
  if (!context) return undefined
  return [
    ...getCoalitionAirdromes(draft, context.theatre, coalition),
    ...getCoalitionFarps(draft, coalition)
  ]
    .filter((base) => calculateDistance(base.position, position) <= maxDistance)
    .sort(
      (left, right) =>
        calculateDistance(left.position, position) - calculateDistance(right.position, position)
    )[0]
}

function spawnRecoveryFlight(params: {
  draft: Campaign
  coalition: Coalition
  task: Task
  targetId: string
  targetType: string
  objectiveId: string
  pickupPosition: z.infer<typeof schemas.position>
  aircraftType: AircraftName
  homeBase: NonNullable<ReturnType<typeof nearestRecoveryBase>>
}) {
  const packageId = crypto.randomUUID()
  const result = spawnPlannedFlightGroup({
    draft: params.draft,
    coalition: params.coalition,
    task: params.task,
    aircraftType: params.aircraftType,
    aircraftCount: 1,
    homeBase: params.homeBase.name,
    homeBasePosition: params.homeBase.position,
    destination: params.pickupPosition,
    missionWaypoints: buildCsarMissionWaypoints(params.pickupPosition, params.homeBase.position),
    startTime: new Date(params.draft.time.getTime() + 10 * 60 * 1000),
    runwayAngle: params.homeBase.runwayAngle,
    target: {
      id: params.targetId,
      type: params.targetType,
      objectiveId: params.objectiveId,
      kind: params.task === 'CASEVAC' ? 'casevac' : 'troop-extraction'
    },
    packageId
  })
  const flight = params.draft.coalitions[params.coalition].flightGroups.find(
    (entry) => entry.id === result.flightGroupId
  )
  if (flight) {
    flight.sourceNode = params.homeBase.name
    flight.destinationNode = params.homeBase.name
  }
  params.draft.coalitions[params.coalition].packages.push({
    id: packageId,
    type: params.task === 'CASEVAC' ? 'CASEVAC Package' : 'Troop Extraction Package',
    targetObjectiveId: params.objectiveId,
    members: [
      {
        flightGroupId: result.flightGroupId,
        role: params.task === 'CASEVAC' ? 'casevac' : 'troop-extraction',
        totOffset: 0
      }
    ],
    tot: result.tot,
    status: 'active',
    priority: params.task === 'CASEVAC' ? 85 : 95,
    reason:
      params.task === 'CASEVAC'
        ? `Evacuate wounded personnel at ${params.objectiveId}`
        : `Extract depleted infantry at ${params.objectiveId}`,
    targetType: params.targetType
  })
  return result.flightGroupId
}

export function spawnCasevac(draft: Campaign, coalition: Coalition) {
  const activeCount = draft.coalitions[coalition].flightGroups.filter(
    (group) => group.task === 'CASEVAC'
  ).length
  if (activeCount >= config.packages.CASEVAC.maxActive[coalition]) return

  const point = (draft.coalitions[coalition].casualtyPoints ?? []).find(
    (entry) => entry.status === 'awaiting-pickup' && entry.expiresAt > draft.time
  )
  if (!point) return
  const aircraftType = selectRecoveryAircraft(draft, coalition, 'CASEVAC')
  if (!aircraftType) return
  const homeBase = nearestRecoveryBase(
    draft,
    coalition,
    point.position,
    config.packages.CASEVAC.maxDistance
  )
  if (!homeBase) return

  const flightGroupId = spawnRecoveryFlight({
    draft,
    coalition,
    task: 'CASEVAC',
    targetId: point.id,
    targetType: 'Casualty Point',
    objectiveId: point.objectiveId,
    pickupPosition: point.position,
    aircraftType,
    homeBase
  })
  point.status = 'assigned'
  point.assignedFlightGroupId = flightGroupId
}

export function spawnTroopExtraction(draft: Campaign, coalition: Coalition) {
  const activeCount = draft.coalitions[coalition].flightGroups.filter(
    (group) => group.task === 'Troop Extraction'
  ).length
  if (activeCount >= config.packages['Troop Extraction'].maxActive[coalition]) return

  const request = (draft.coalitions[coalition].extractionRequests ?? []).find(
    (entry) =>
      entry.status === 'awaiting-aircraft' &&
      entry.expiresAt > draft.time &&
      (!entry.retryAfter || entry.retryAfter <= draft.time)
  )
  if (!request) return
  const context = resolveSpawnContext(draft, coalition)
  if (!context) return
  const pickupSite = getDeploymentSites(context.theatre).find(
    (site) => site.id === request.pickupSiteId
  )
  if (!pickupSite) return
  const aircraftType = selectRecoveryAircraft(draft, coalition, 'Troop Extraction')
  if (!aircraftType) return
  const homeBase = nearestRecoveryBase(
    draft,
    coalition,
    pickupSite.position,
    config.packages['Troop Extraction'].maxDistance
  )
  if (!homeBase) return

  request.destinationObjectiveId = homeBase.name
  const flightGroupId = spawnRecoveryFlight({
    draft,
    coalition,
    task: 'Troop Extraction',
    targetId: request.id,
    targetType: 'Troop Extraction',
    objectiveId: request.objectiveId,
    pickupPosition: pickupSite.position,
    aircraftType,
    homeBase
  })
  request.status = 'assigned'
  request.assignedFlightGroupId = flightGroupId
}
