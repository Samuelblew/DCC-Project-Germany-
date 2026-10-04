import { schemas, config } from '@dcc/contracts'
import {
  findGermanyIadsSite,
  getSamSitePosition,
  isSamHardwareCapable,
  samTemplates
} from '@dcc/data'
import * as z from 'zod'
import { FlightGroup } from './flight-group'
import { calculateDistance } from '../utils/calculate-distance'
import { buildSeadMissionWaypoints, spawnPlannedFlightGroup } from './flight-group-spawn'
import { logCombatAction } from '../simulation-log'
import { maybeCreateDownedPilotFromAircraftLoss } from '../systems/downed-pilots'
import { debugLog } from '@/lib/debug'
import { EWR_ATTACK_RANGE_METERS } from '@/logic/iads-emitter-targets'

export class SeadFlightGroup extends FlightGroup {
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
      }
      targetPosition: z.infer<typeof schemas.position>
      runwayAngle?: number
      aircraftType: z.infer<typeof schemas.dcs.aircraftName>
      tot: Date // Required - SEAD ToT is determined by strike package
      packageId?: string
    }
  ): string {
    const numAircraft = config.packages.SEAD.aircraftsPerGroup
    const missionWaypoints = buildSeadMissionWaypoints(
      params.homeBasePosition,
      params.targetPosition
    )

    // Calculate start time from desired ToT
    const startTime = FlightGroup.calculateStartTimeForTot(
      params.homeBasePosition,
      missionWaypoints,
      params.tot
    )

    const { flightGroupId } = spawnPlannedFlightGroup({
      draft,
      coalition,
      task: 'SEAD',
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
      packageId: params.packageId,
      tot: params.tot
    })

    debugLog(
      `Spawned SEAD group from ${params.homeBase} targeting ${params.target.type} at ${params.target.objectiveId}`
    )

    return flightGroupId
  }

  suppressSam(
    draft: z.infer<typeof schemas.campaign.campaign>,
    coalition: z.infer<typeof schemas.coalition>,
    theatre: z.infer<typeof schemas.theatre>
  ) {
    if (!this._data.target) {
      return
    }

    const enemyCoalition = coalition === 'player' ? 'opponent' : 'player'
    const enemy = draft.coalitions[enemyCoalition]
    const samGroup = enemy.samGroups.find((s) => s.id === this._data.target?.id)
    const ewrGroup = enemy.ewrGroups?.find((ewr) => ewr.id === this._data.target?.id)

    const site = this._data.target ? findGermanyIadsSite(this._data.target.id) : undefined

    if (!samGroup && !ewrGroup && !site) {
      return
    }

    const emitterPosition = samGroup
      ? getSamSitePosition(theatre, samGroup.objectiveId)
      : ewrGroup
        ? ewrGroup.position
        : site
          ? { x: site.x, y: site.y }
          : undefined
    if (!emitterPosition) {
      return
    }

    const samTemplate = samGroup ? samTemplates[samGroup.type] : undefined
    if (samGroup && !samTemplate) {
      return
    }

    if (samGroup && !isSamHardwareCapable(samGroup)) {
      samGroup.suppressed = false
      return
    }

    const emitterType = samGroup?.type ?? ewrGroup?.type ?? site?.campaignType ?? site?.id ?? 'SAM'
    const emitterObjectiveId =
      samGroup?.objectiveId ?? ewrGroup?.objectiveId ?? site?.objectiveId ?? ''
    const distanceToEmitter = calculateDistance(this._data.position, emitterPosition)

    const suppressionRange = samTemplate?.range ?? site?.range ?? EWR_ATTACK_RANGE_METERS
    const isInRange = distanceToEmitter <= suppressionRange

    if (isInRange) {
      const wasSuppressed = samGroup?.suppressed ?? ewrGroup?.suppressed

      if (samGroup) samGroup.suppressed = true
      if (ewrGroup) ewrGroup.suppressed = true
      if (!wasSuppressed) {
        logCombatAction(
          draft,
          coalition,
          `SEAD established suppression on ${emitterType} at ${emitterObjectiveId}`,
          this._data.callsign,
          {
            entityType: 'flightGroup',
            entityId: this._data.id
          }
        )
      }

      // SAM has small chance to shoot down SEAD while in range (5-10% per tick)
      const shootDownChance = samGroup || site?.kind === 'sam' ? 0.05 : 0
      if (Math.random() < shootDownChance) {
        // Remove one aircraft from the flight
        if (this._data.aircrafts.length > 0) {
          const removedAircraft = this._data.aircrafts.pop()
          debugLog(`SEAD aircraft ${removedAircraft?.unitName} shot down by ${emitterType}`)
          if (removedAircraft) {
            maybeCreateDownedPilotFromAircraftLoss(draft, coalition, {
              name: removedAircraft.unitName,
              position: this._data.position
            })
            logCombatAction(
              draft,
              coalition,
              `SEAD ${removedAircraft.unitName} shot down by ${emitterType}`,
              this._data.callsign,
              {
                entityType: 'flightGroup',
                entityId: this._data.id
              }
            )
          }
        }
      }
    } else {
      // If the flight is no longer in range, clear suppression. A more complex
      // simulation could track overlapping coverage from multiple SEAD flights.
      if (samGroup?.suppressed || ewrGroup?.suppressed) {
        logCombatAction(
          draft,
          coalition,
          `SEAD lost suppression on ${emitterType} at ${emitterObjectiveId}`,
          this._data.callsign,
          {
            entityType: 'flightGroup',
            entityId: this._data.id
          }
        )
      }
      if (samGroup) samGroup.suppressed = false
      if (ewrGroup) ewrGroup.suppressed = false
    }
  }
}

export const isSeadFlightGroup = (flightGroup: FlightGroup): flightGroup is SeadFlightGroup => {
  return flightGroup.task === 'SEAD'
}
