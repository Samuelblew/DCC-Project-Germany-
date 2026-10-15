import { schemas, config } from '@dcc/contracts'
import * as z from 'zod'
import { FlightGroup } from './flight-group'
import { buildStrikeMissionWaypoints, spawnPlannedFlightGroup } from './flight-group-spawn'
import { logCombatAction } from '../simulation-log'
import { cutRoad, ROAD_CUT_MS } from '../systems/road-cuts'
import { debugLog } from '@/lib/debug'

function resolveStrikeAircraftCount(task: 'Pinpoint Strike' | 'Strategic Strike') {
  if (task === 'Strategic Strike') {
    const min = config.packages['Strategic Strike'].minAircraftsPerGroup
    const max = config.packages['Strategic Strike'].maxAircraftsPerGroup
    return Math.floor(Math.random() * (max - min + 1)) + min
  }

  return config.packages['Pinpoint Strike'].aircraftsPerGroup
}

export class StrikeFlightGroup extends FlightGroup {
  static spawn(
    draft: z.infer<typeof schemas.campaign.campaign>,
    coalition: z.infer<typeof schemas.coalition>,
    params: {
      homeBase: string
      homeBasePosition: z.infer<typeof schemas.position>
      target: {
        id: string
        type: string
        objectiveId: string
        position?: z.infer<typeof schemas.position>
        buildings?: z.infer<typeof schemas.structureBuilding>[]
      }
      targetPosition: z.infer<typeof schemas.position>
      runwayAngle?: number
      aircraftType: z.infer<typeof schemas.dcs.aircraftName>
      packageId?: string
      exactTarget?: boolean
      task?: 'Pinpoint Strike' | 'Strategic Strike'
    }
  ): { flightGroupId: string; tot: Date } {
    const task = params.task ?? 'Pinpoint Strike'
    const numAircraft = resolveStrikeAircraftCount(task)
    const firstBuilding = params.target.buildings?.[0]
    const aimpointPosition =
      params.exactTarget === true && params.target.position && firstBuilding
        ? {
            x: params.target.position.x + firstBuilding.offset.x,
            y: params.target.position.y + firstBuilding.offset.y
          }
        : params.targetPosition
    const missionWaypoints = buildStrikeMissionWaypoints(
      params.homeBasePosition,
      params.targetPosition,
      aimpointPosition
    )

    const startTime = new Date(
      draft.time.getTime() + Math.floor(Math.random() * (50 - 30 + 1) + 30) * 60 * 1000
    )

    const { flightGroupId, tot } = spawnPlannedFlightGroup({
      draft,
      coalition,
      task,
      aircraftType: params.aircraftType,
      aircraftCount: numAircraft,
      homeBase: params.homeBase,
      homeBasePosition: params.homeBasePosition,
      destination: params.targetPosition,
      missionWaypoints,
      startTime,
      runwayAngle: params.runwayAngle,
      target: {
        id: params.target.id,
        type: params.target.type,
        objectiveId: params.target.objectiveId
      },
      packageId: params.packageId
    })

    debugLog(
      `Spawned strike group from ${params.homeBase} targeting ${params.target.type} at ${params.target.objectiveId}`
    )

    return { flightGroupId, tot: tot ?? startTime }
  }

  strikeStructure(
    draft: z.infer<typeof schemas.campaign.campaign>,
    coalition: z.infer<typeof schemas.coalition>
  ) {
    if (!this._data.target || !this._data.tot || this._data.targetDestroyed) {
      debugLog(this._data.tot)
      return
    }

    if (draft.time < this._data.tot) {
      debugLog(draft.time, this._data.tot)
      return
    }

    if (this._data.target.type === 'Road') {
      const parts = this._data.target.id.split('|')
      const from = parts[1]
      const to = parts[2]
      if (from && to) {
        cutRoad(draft, from, to, draft.time.getTime() + ROAD_CUT_MS)
        logCombatAction(
          draft,
          coalition,
          `Strike cut the road from ${from} to ${to}`,
          this._data.callsign,
          {
            entityType: 'flightGroup',
            entityId: this._data.id
          }
        )
      }
      this._data.targetDestroyed = true
      return
    }

    const enemyCoalition = coalition === 'player' ? 'opponent' : 'player'
    const structure = draft.coalitions[enemyCoalition].structures.find(
      (s) => s.id === this._data.target?.id
    )

    debugLog('Striking structure', structure?.name)

    if (structure && structure.buildings.some((b) => b.alive)) {
      let destroyedCount = 0
      structure.buildings.forEach((b) => {
        if (Math.random() <= 0.7) {
          b.alive = false
          destroyedCount++
        }
      })
      logCombatAction(
        draft,
        coalition,
        `Strike hit ${structure.name} at ${structure.objectiveId}: destroyed ${destroyedCount}/${structure.buildings.length} buildings`,
        this._data.callsign,
        {
          entityType: 'flightGroup',
          entityId: this._data.id
        }
      )
    }

    this._data.targetDestroyed = true
  }
}

export const isStrikeFlightGroup = (flightGroup: FlightGroup): flightGroup is StrikeFlightGroup => {
  return flightGroup.task === 'Pinpoint Strike' || flightGroup.task === 'Strategic Strike'
}
