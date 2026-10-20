import { config, schemas } from '@dcc/contracts'
import * as z from 'zod'

import { hasAirframes } from '../../air-order-of-battle'
import { missionPriorityLevel, NEUTRAL_PRIORITY } from '../../commander-priorities'
import { isEnemyKnown } from '../../intel'
import {
  buildStrikeMissionWaypoints,
  spawnPlannedFlightGroup
} from '../../../entities/flight-group-spawn'
import {
  getCoalitionAirdromes,
  pickRandomAircraftType,
  resolveSpawnContext,
  selectHomeBaseAndTarget
} from './common'

type Campaign = z.infer<typeof schemas.campaign.campaign>
type Coalition = z.infer<typeof schemas.coalition>

/** The commander's anti-shipping priority adds or removes a package; "never" stops them. */
function antiShipLimit(draft: Campaign, coalition: Coalition) {
  const level = missionPriorityLevel(draft, coalition, 'antiship')
  if (level === 0) return 0
  const base = config.packages['Antiship Strike'].maxActive[coalition]
  return Math.max(1, base + Math.sign(level - NEUTRAL_PRIORITY))
}

export function spawnAntiShip(draft: Campaign, coalition: Coalition) {
  const context = resolveSpawnContext(draft, coalition)
  if (!context) return
  const availableAircraftTypes = (
    draft.coalitions[coalition].aircraftTypes['Antiship Strike'] ?? []
  ).filter((type) => hasAirframes(draft, coalition, type, 2))
  if (!availableAircraftTypes?.length) return
  const active = draft.coalitions[coalition].flightGroups.filter(
    (group) => group.task === 'Antiship Strike'
  )
  if (active.length >= antiShipLimit(draft, coalition)) return

  const targetedIds = new Set(active.map((group) => group.target?.id).filter(Boolean))
  const targets = (draft.coalitions[context.enemyCoalition].navalGroups ?? [])
    .filter(
      (group) =>
        group.role !== 'carrier' &&
        group.state !== 'sunk' &&
        group.damage < 1 &&
        !targetedIds.has(group.id) &&
        isEnemyKnown(draft, coalition, group.id)
    )
    .map((group) => ({ target: group, position: group.position }))
  const assignment = selectHomeBaseAndTarget({
    homeBases: getCoalitionAirdromes(draft, context.theatre, coalition),
    targets,
    maxDistance: config.packages['Antiship Strike'].maxDistance,
    preference: 'nearest'
  })
  if (!assignment) return
  const aircraftType = pickRandomAircraftType(availableAircraftTypes)
  if (!aircraftType) return

  const startTime = new Date(draft.time.getTime() + 10 * 60 * 1_000)
  const { flightGroupId, tot } = spawnPlannedFlightGroup({
    draft,
    coalition,
    task: 'Antiship Strike',
    aircraftType,
    aircraftCount: config.packages['Antiship Strike'].aircraftsPerGroup,
    homeBase: assignment.homeBase.name,
    homeBasePosition: assignment.homeBase.position,
    destination: assignment.targetPosition,
    missionWaypoints: buildStrikeMissionWaypoints(
      assignment.homeBase.position,
      assignment.targetPosition,
      assignment.targetPosition
    ),
    startTime,
    runwayAngle: assignment.homeBase.runwayAngle,
    target: {
      id: assignment.target.id,
      type: assignment.target.role,
      objectiveId: assignment.target.name,
      kind: 'naval-group'
    }
  })

  const packageId = crypto.randomUUID()
  const flight = draft.coalitions[coalition].flightGroups.find(
    (group) => group.id === flightGroupId
  )
  if (flight) flight.packageId = packageId
  draft.coalitions[coalition].packages.push({
    id: packageId,
    type: 'Antiship Package',
    targetObjectiveId: assignment.target.name,
    members: [{ flightGroupId, role: 'antiship', totOffset: 0 }],
    tot,
    status: 'active',
    targetType: assignment.target.role
  })
}
