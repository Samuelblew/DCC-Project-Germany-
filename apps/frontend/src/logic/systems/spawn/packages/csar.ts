import { config, schemas } from '@dcc/contracts'
import { aircrafts } from '@dcc/data'
import * as z from 'zod'

import { hasAirframes } from '../../air-order-of-battle'
import { CsarFlightGroup } from '@/logic/entities/csar-flight-group'
import { calculateDistance } from '@/logic/utils/calculate-distance'

import { getCoalitionAirdromes, getCoalitionFarps, resolveSpawnContext } from './common'

type Campaign = z.infer<typeof schemas.campaign.campaign>
type Coalition = z.infer<typeof schemas.coalition>
type Position = z.infer<typeof schemas.position>
type AircraftName = z.infer<typeof schemas.dcs.aircraftName>
type DownedPilot = z.infer<typeof schemas.campaign.campaignDownedPilot>

const aircraftMap = new Map(Object.values(aircrafts).map((aircraft) => [aircraft.name, aircraft]))

function nearestObjectiveId(
  pilot: DownedPilot,
  objectiveIds: string[],
  objectives: Array<{ name: string; position: Position }>
) {
  const allowed = new Set(objectiveIds)
  return objectives
    .filter((objective) => allowed.has(objective.name))
    .sort(
      (left, right) =>
        calculateDistance(left.position, pilot.position) -
        calculateDistance(right.position, pilot.position)
    )[0]?.name
}

function nearestDropOff(
  draft: Campaign,
  coalition: Coalition,
  pilot: DownedPilot,
  fallback: Position
) {
  return (
    draft.coalitions[coalition].structures
      .filter((structure) => structure.type === 'Farp' || structure.type === 'Hospital')
      .sort(
        (left, right) =>
          calculateDistance(left.position, pilot.position) -
          calculateDistance(right.position, pilot.position)
      )[0]?.position ?? fallback
  )
}

function selectCsarAircraft(campaign: Campaign, coalition: Coalition): AircraftName | null {
  const available = campaign.coalitions[coalition].aircraftTypes.CSAR ?? []
  const selected = available.find(
    (name) =>
      aircraftMap.get(name as AircraftName)?.isHelicopter &&
      hasAirframes(campaign, coalition, name, 1)
  )
  return selected ? (selected as AircraftName) : null
}

export function spawnCsar(draft: Campaign, coalition: Coalition): void {
  const context = resolveSpawnContext(draft, coalition)
  if (!context) return

  const coalitionData = draft.coalitions[coalition]
  const activeGroups = coalitionData.flightGroups.filter((group) => group.task === 'CSAR')
  if (activeGroups.length >= config.packages.CSAR.maxActive[coalition]) return

  const assignedPilotIds = new Set(activeGroups.map((group) => group.target?.id).filter(Boolean))
  const pilot = (coalitionData.downedPilots ?? []).find(
    (candidate) => !assignedPilotIds.has(candidate.id)
  )
  if (!pilot) return

  const aircraftType = selectCsarAircraft(draft, coalition)
  if (!aircraftType) return

  const farps = getCoalitionFarps(draft, coalition)
  const homeBase = [...getCoalitionAirdromes(draft, context.theatre, coalition), ...farps]
    .filter(
      (candidate) =>
        calculateDistance(candidate.position, pilot.position) <= config.packages.CSAR.maxDistance
    )
    .sort(
      (left, right) =>
        calculateDistance(left.position, pilot.position) -
        calculateDistance(right.position, pilot.position)
    )[0]
  if (!homeBase) return

  const targetObjectiveId =
    nearestObjectiveId(
      pilot,
      draft.coalitions[context.enemyCoalition].objectiveIds,
      context.theatre.objectives
    ) ?? coalitionData.objectiveIds[0]
  if (!targetObjectiveId) return

  const packageId = crypto.randomUUID()
  const result = CsarFlightGroup.spawn(draft, coalition, {
    pilot,
    targetObjectiveId,
    homeBase: homeBase.name,
    homeBasePosition: homeBase.position,
    dropOffPosition: nearestDropOff(draft, coalition, pilot, homeBase.position),
    runwayAngle: homeBase.runwayAngle,
    aircraftType,
    packageId
  })

  draft.coalitions[coalition].packages.push({
    id: packageId,
    type: 'CSAR Package',
    targetObjectiveId,
    members: [{ flightGroupId: result.flightGroupId, role: 'csar', totOffset: 0 }],
    tot: result.tot,
    status: 'active',
    priority: 90,
    reason: `Recover ${pilot.name}`,
    targetType: 'Downed Pilot'
  })
}
