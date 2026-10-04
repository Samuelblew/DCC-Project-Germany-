import { schemas } from '@dcc/contracts'
import { aircrafts } from '@dcc/data'
import * as z from 'zod'

import { FlightGroup } from './flight-group'
import { logSpawnAction } from '../simulation-log'

const aircraftMap = new Map(Object.values(aircrafts).map((def) => [def.name, def]))

type Campaign = z.infer<typeof schemas.campaign.campaign>
type Coalition = z.infer<typeof schemas.coalition>
type Position = z.infer<typeof schemas.position>
type Waypoint = z.infer<typeof schemas.waypoint>
type FlightTask = z.infer<typeof schemas.flightGroup>['task']
type AircraftName = z.infer<typeof schemas.dcs.aircraftName>
type Aircraft = z.infer<typeof schemas.aircraft>
type FlightTarget = NonNullable<z.infer<typeof schemas.flightGroup>['target']>

export function buildAttackMissionWaypoints(
  homeBasePosition: Position,
  targetPosition: Position
): Waypoint[] {
  const dx = targetPosition.x - homeBasePosition.x
  const dy = targetPosition.y - homeBasePosition.y
  const distance = Math.sqrt(dx * dx + dy * dy)
  const ux = distance > 0 ? dx / distance : 1
  const uy = distance > 0 ? dy / distance : 0
  const ipDistance = Math.max(20000, distance - 20000)

  return [
    {
      name: 'IP',
      position: {
        x: homeBasePosition.x + ux * ipDistance,
        y: homeBasePosition.y + uy * ipDistance
      },
      altitude: 6000,
      speed: 250,
      type: 'Nav'
    },
    {
      name: 'Target',
      position: targetPosition,
      speed: 275,
      type: 'Task',
      altitude: 0,
      altitudeType: 'RADIO'
    },
    {
      name: 'Egress',
      position: {
        x: homeBasePosition.x + ux * ipDistance,
        y: homeBasePosition.y + uy * ipDistance
      },
      altitude: 6000,
      speed: 250,
      type: 'Nav'
    }
  ]
}

export function buildStrikeMissionWaypoints(
  homeBasePosition: Position,
  targetPosition: Position,
  aimpointPosition = targetPosition
): Waypoint[] {
  const dx = aimpointPosition.x - homeBasePosition.x
  const dy = aimpointPosition.y - homeBasePosition.y
  const distance = Math.sqrt(dx * dx + dy * dy)
  const ux = distance > 0 ? dx / distance : 1
  const uy = distance > 0 ? dy / distance : 0
  const px = -uy
  const py = ux

  const ipDistanceFromTarget = Math.min(25_000, Math.max(12_000, distance * 0.25))
  const attackDistanceFromTarget = Math.min(12_000, Math.max(6_000, distance * 0.12))
  const egressDistance = 18_000
  const egressOffset = 10_000

  return [
    {
      name: 'IP',
      position: {
        x: targetPosition.x - ux * ipDistanceFromTarget,
        y: targetPosition.y - uy * ipDistanceFromTarget
      },
      altitude: 6000,
      speed: 250,
      type: 'Nav'
    },
    {
      name: 'Attack',
      position: {
        x: targetPosition.x - ux * attackDistanceFromTarget,
        y: targetPosition.y - uy * attackDistanceFromTarget
      },
      altitude: 6000,
      altitudeType: 'BARO',
      speed: 275,
      type: 'Task'
    },
    {
      name: 'Target',
      position: aimpointPosition,
      altitude: 0,
      altitudeType: 'RADIO',
      speed: 250,
      type: 'Nav'
    },
    {
      name: 'Egress',
      position: {
        x: targetPosition.x + ux * egressDistance + px * egressOffset,
        y: targetPosition.y + uy * egressDistance + py * egressOffset
      },
      altitude: 6000,
      speed: 250,
      type: 'Nav'
    }
  ]
}

export function buildSeadMissionWaypoints(
  homeBasePosition: Position,
  targetPosition: Position
): Waypoint[] {
  const dx = targetPosition.x - homeBasePosition.x
  const dy = targetPosition.y - homeBasePosition.y
  const distance = Math.sqrt(dx * dx + dy * dy)
  const ux = distance > 0 ? dx / distance : 1
  const uy = distance > 0 ? dy / distance : 0
  const px = -uy
  const py = ux

  const ingressDistance = Math.min(40_000, Math.max(25_000, distance * 0.35))
  const stationDistance = Math.min(25_000, Math.max(15_000, distance * 0.2))

  return [
    {
      name: 'Ingress',
      position: {
        x: targetPosition.x - ux * ingressDistance,
        y: targetPosition.y - uy * ingressDistance
      },
      altitude: 7000,
      speed: 240,
      type: 'Nav'
    },
    {
      name: 'Suppress',
      position: {
        x: targetPosition.x - ux * stationDistance,
        y: targetPosition.y - uy * stationDistance
      },
      altitude: 7500,
      altitudeType: 'BARO',
      speed: 230,
      type: 'Task'
    },
    {
      name: 'Emitter',
      position: targetPosition,
      altitude: 0,
      altitudeType: 'RADIO',
      speed: 230,
      type: 'Nav'
    },
    {
      name: 'Egress',
      position: {
        x: targetPosition.x - ux * ingressDistance + px * 12_000,
        y: targetPosition.y - uy * ingressDistance + py * 12_000
      },
      altitude: 7000,
      speed: 250,
      type: 'Nav'
    }
  ]
}

export function buildDeadMissionWaypoints(
  homeBasePosition: Position,
  targetPosition: Position
): Waypoint[] {
  const dx = targetPosition.x - homeBasePosition.x
  const dy = targetPosition.y - homeBasePosition.y
  const distance = Math.sqrt(dx * dx + dy * dy)
  const ux = distance > 0 ? dx / distance : 1
  const uy = distance > 0 ? dy / distance : 0
  const px = -uy
  const py = ux

  const ipDistanceFromTarget = Math.min(30_000, Math.max(18_000, distance * 0.3))

  return [
    {
      name: 'IP',
      position: {
        x: targetPosition.x - ux * ipDistanceFromTarget,
        y: targetPosition.y - uy * ipDistanceFromTarget
      },
      altitude: 6500,
      speed: 250,
      type: 'Nav'
    },
    {
      name: 'Emitter',
      position: targetPosition,
      altitude: 0,
      altitudeType: 'RADIO',
      speed: 250,
      type: 'Task'
    },
    {
      name: 'Egress',
      position: {
        x: targetPosition.x + ux * 18_000 + px * 10_000,
        y: targetPosition.y + uy * 18_000 + py * 10_000
      },
      altitude: 6500,
      speed: 250,
      type: 'Nav'
    }
  ]
}

export function buildCasMissionWaypoints(
  homeBasePosition: Position,
  targetPosition: Position
): Waypoint[] {
  const dx = targetPosition.x - homeBasePosition.x
  const dy = targetPosition.y - homeBasePosition.y
  const distance = Math.sqrt(dx * dx + dy * dy)
  const ux = distance > 0 ? dx / distance : 1
  const uy = distance > 0 ? dy / distance : 0
  const px = -uy
  const py = ux

  const contactDistance = Math.min(20_000, Math.max(10_000, distance * 0.2))
  const holdOffset = 12_000

  return [
    {
      name: 'Contact',
      position: {
        x: targetPosition.x - ux * contactDistance,
        y: targetPosition.y - uy * contactDistance
      },
      altitude: 3500,
      altitudeType: 'BARO',
      speed: 200,
      type: 'Task'
    },
    {
      name: 'Target',
      position: targetPosition,
      altitude: 0,
      altitudeType: 'RADIO',
      speed: 180,
      type: 'Nav'
    },
    {
      name: 'Hold',
      position: {
        x: targetPosition.x - ux * contactDistance + px * holdOffset,
        y: targetPosition.y - uy * contactDistance + py * holdOffset
      },
      altitude: 3500,
      altitudeType: 'BARO',
      speed: 190,
      type: 'Hold'
    },
    {
      name: 'Egress',
      position: {
        x: targetPosition.x - ux * contactDistance - px * holdOffset,
        y: targetPosition.y - uy * contactDistance - py * holdOffset
      },
      altitude: 3500,
      speed: 220,
      type: 'Nav'
    }
  ]
}

export function buildCapMissionWaypoints(
  homeBasePosition: Position,
  patrolCenter: Position
): Waypoint[] {
  const dx = patrolCenter.x - homeBasePosition.x
  const dy = patrolCenter.y - homeBasePosition.y
  const distance = Math.sqrt(dx * dx + dy * dy)
  const ux = distance > 0 ? dx / distance : 1
  const uy = distance > 0 ? dy / distance : 0

  const px = -uy
  const py = ux
  const racetrackHalfLength = 20000
  const entryDistance = 12_000

  return [
    {
      name: 'Patrol Entry',
      position: {
        x: patrolCenter.x - ux * entryDistance,
        y: patrolCenter.y - uy * entryDistance
      },
      altitude: 7000,
      speed: 220,
      type: 'Nav'
    },
    {
      name: 'Racetrack Start',
      position: {
        x: patrolCenter.x + px * racetrackHalfLength,
        y: patrolCenter.y + py * racetrackHalfLength
      },
      altitude: 7000,
      speed: 200,
      type: 'Task'
    },
    {
      name: 'Racetrack End',
      position: {
        x: patrolCenter.x - px * racetrackHalfLength,
        y: patrolCenter.y - py * racetrackHalfLength
      },
      altitude: 7000,
      speed: 200,
      type: 'RaceTrack End'
    }
  ]
}

export function buildFighterSweepMissionWaypoints(
  homeBasePosition: Position,
  conflictPosition: Position
): Waypoint[] {
  const dx = conflictPosition.x - homeBasePosition.x
  const dy = conflictPosition.y - homeBasePosition.y
  const distance = Math.sqrt(dx * dx + dy * dy)
  const ux = distance > 0 ? dx / distance : 1
  const uy = distance > 0 ? dy / distance : 0
  const px = -uy
  const py = ux
  const pushDistance = Math.min(40_000, Math.max(15_000, distance * 0.4))

  return [
    {
      name: 'Push',
      position: {
        x: conflictPosition.x - ux * pushDistance,
        y: conflictPosition.y - uy * pushDistance
      },
      altitude: 7500,
      speed: 240,
      type: 'Nav'
    },
    {
      name: 'Sweep',
      position: conflictPosition,
      altitude: 8000,
      altitudeType: 'BARO',
      speed: 250,
      type: 'Task'
    },
    {
      name: 'Sweep Turn',
      position: {
        x: conflictPosition.x + ux * 20_000 + px * 20_000,
        y: conflictPosition.y + uy * 20_000 + py * 20_000
      },
      altitude: 8000,
      speed: 250,
      type: 'Nav'
    },
    {
      name: 'Egress',
      position: {
        x: conflictPosition.x - ux * pushDistance - px * 15_000,
        y: conflictPosition.y - uy * pushDistance - py * 15_000
      },
      altitude: 7500,
      speed: 240,
      type: 'Nav'
    }
  ]
}

/**
 * A loop of practice legs on the friendly side of the home base, with varied altitudes.
 */
export function buildTrainingMissionWaypoints(
  homeBasePosition: Position,
  awayFromEnemy: { x: number; y: number },
  routeRadius: number,
  isHelicopter = false,
  rotation = Math.random() * Math.PI * 2
): Waypoint[] {
  const length = Math.hypot(awayFromEnemy.x, awayFromEnemy.y)
  const ux = length > 0 ? awayFromEnemy.x / length : 1
  const uy = length > 0 ? awayFromEnemy.y / length : 0
  const radius = isHelicopter ? routeRadius * 0.4 : routeRadius
  const center = {
    x: homeBasePosition.x + ux * radius,
    y: homeBasePosition.y + uy * radius
  }
  const legs = isHelicopter
    ? [
        { name: 'Training 1', altitude: 300, speed: 60 },
        { name: 'Training 2', altitude: 600, speed: 70 },
        { name: 'Training 3', altitude: 450, speed: 65 },
        { name: 'Training 4', altitude: 150, speed: 55 }
      ]
    : [
        { name: 'Training 1', altitude: 3000, speed: 220 },
        { name: 'Training 2', altitude: 6000, speed: 240 },
        { name: 'Training 3', altitude: 4500, speed: 230 },
        { name: 'Training 4', altitude: 1500, speed: 200 }
      ]

  return legs.map((leg, index) => {
    const angle = rotation + (index / legs.length) * Math.PI * 2
    return {
      name: leg.name,
      position: {
        x: center.x + Math.cos(angle) * radius * 0.8,
        y: center.y + Math.sin(angle) * radius * 0.8
      },
      altitude: leg.altitude,
      speed: leg.speed,
      type: 'Nav' as const
    }
  })
}

export function buildTransportMissionWaypoints(
  homeBasePosition: Position,
  destinationPosition: Position
): Waypoint[] {
  // Helicopters fly direct at low altitude - no climb/descent phases needed
  return [
    {
      name: 'Direct',
      position: destinationPosition,
      altitude: 300, // Low cruise altitude
      speed: 100, // Helicopter cruise speed
      type: 'Nav'
    }
  ]
}

export function buildCsarMissionWaypoints(
  pilotPosition: Position,
  dropOffPosition: Position
): Waypoint[] {
  return [
    {
      name: 'Pick Up',
      position: pilotPosition,
      altitude: 30,
      altitudeType: 'RADIO',
      speed: 70,
      type: 'Task'
    },
    {
      name: 'Drop Off',
      position: dropOffPosition,
      altitude: 30,
      altitudeType: 'RADIO',
      speed: 70,
      type: 'Nav'
    }
  ]
}

export function createAircrafts(aircraftType: AircraftName, count: number): Aircraft[] {
  const aircrafts: Aircraft[] = []
  for (let i = 0; i < count; i++) {
    aircrafts.push({
      id: crypto.randomUUID(),
      unitName: `${aircraftType} ${i + 1}`,
      aircraftName: aircraftType
    })
  }
  return aircrafts
}

export function spawnPlannedFlightGroup({
  draft,
  coalition,
  task,
  aircraftType,
  aircraftCount,
  homeBase,
  homeBasePosition,
  destination,
  missionWaypoints,
  startTime,
  runwayAngle,
  target,
  packageId,
  tot,
  spawnSource
}: {
  draft: Campaign
  coalition: Coalition
  task: FlightTask
  aircraftType: AircraftName
  aircraftCount: number
  homeBase: string
  homeBasePosition: Position
  destination: Position
  missionWaypoints: Waypoint[]
  startTime: Date
  runwayAngle?: number
  target?: FlightTarget
  packageId?: string
  tot?: Date
  spawnSource?: z.infer<typeof schemas.flightGroup>['spawnSource']
}): { flightGroupId: string; tot: Date; flightplan: z.infer<typeof schemas.flightplan> } {
  const isHelicopter = aircraftMap.get(aircraftType)?.isHelicopter ?? false
  const acList = createAircrafts(aircraftType, aircraftCount)

  const flightplan = FlightGroup.createFlightPlan(
    homeBasePosition,
    destination,
    missionWaypoints,
    startTime,
    runwayAngle,
    isHelicopter
  )

  const flightGroupId = FlightGroup.create(draft, coalition, {
    aircrafts: acList,
    task,
    position: homeBasePosition,
    homeBase,
    target,
    flightplan,
    packageId,
    tot,
    spawnSource
  })

  const calculatedTot = FlightGroup.calculateTot(flightplan)
  const effectiveTot = tot ?? calculatedTot ?? startTime
  const targetLabel = target?.objectiveId ? ` -> ${target.objectiveId}` : ''
  const spawnedFlightGroup = draft.coalitions[coalition].flightGroups.find(
    (group) => group.id === flightGroupId
  )
  const callsign = spawnedFlightGroup?.callsign
  logSpawnAction(
    draft,
    coalition,
    `${task} from ${homeBase} (${aircraftCount}x ${aircraftType})${targetLabel}`,
    callsign,
    {
      entityType: 'flightGroup',
      entityId: flightGroupId
    }
  )

  return {
    flightGroupId,
    tot: effectiveTot,
    flightplan
  }
}
