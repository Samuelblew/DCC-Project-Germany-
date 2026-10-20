import { schemas, config } from '@dcc/contracts'
import { findGermanyIadsSite, getSamSitePosition, samTemplates } from '@dcc/data'
import * as z from 'zod'
import { recordAirframeLoss } from '../systems/air-order-of-battle'
import { FlightGroup } from './flight-group'
import { calculateDistance } from '../utils/calculate-distance'
import { buildDeadMissionWaypoints, spawnPlannedFlightGroup } from './flight-group-spawn'
import { logCombatAction } from '../simulation-log'
import { maybeCreateDownedPilotFromAircraftLoss } from '../systems/downed-pilots'
import { debugLog } from '@/lib/debug'
import { EWR_ATTACK_RANGE_METERS } from '@/logic/iads-emitter-targets'

export class DeadFlightGroup extends FlightGroup {
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
      tot?: Date
      packageId?: string
    }
  ): { flightGroupId: string; tot: Date } {
    const numAircraft = config.packages.DEAD.aircraftsPerGroup
    const missionWaypoints = buildDeadMissionWaypoints(
      params.homeBasePosition,
      params.targetPosition
    )

    const startTime =
      params.tot != null
        ? FlightGroup.calculateStartTimeForTot(
            params.homeBasePosition,
            missionWaypoints,
            params.tot
          )
        : new Date(
            draft.time.getTime() + Math.floor(Math.random() * (50 - 30 + 1) + 30) * 60 * 1000
          )

    const { flightGroupId, tot } = spawnPlannedFlightGroup({
      draft,
      coalition,
      task: 'DEAD',
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
      `Spawned DEAD group from ${params.homeBase} targeting ${params.target.type} at ${params.target.objectiveId}`
    )

    return { flightGroupId, tot: tot ?? startTime }
  }

  /** DEAD attack logic permanently destroys an enemy radar emitter. */
  destroySam(
    draft: z.infer<typeof schemas.campaign.campaign>,
    coalition: z.infer<typeof schemas.coalition>,
    theatre: z.infer<typeof schemas.theatre>
  ) {
    if (!this._data.target || !this._data.tot || this._data.targetDestroyed) {
      return
    }

    // Only attack after ToT
    if (draft.time < this._data.tot) {
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

    const emitterType = samGroup?.type ?? ewrGroup?.type ?? site?.campaignType ?? site?.id ?? 'SAM'
    const emitterObjectiveId =
      samGroup?.objectiveId ?? ewrGroup?.objectiveId ?? site?.objectiveId ?? ''
    const distanceToEmitter = calculateDistance(this._data.position, emitterPosition)

    const attackRange = samTemplate
      ? samTemplate.range * 1.2
      : (site?.range ?? EWR_ATTACK_RANGE_METERS) * (site?.kind === 'sam' ? 1.2 : 1)
    const isInRange = distanceToEmitter <= attackRange

    if (isInRange) {
      // 50% chance per aircraft to destroy the emitter.
      // Each aircraft makes one attack attempt
      for (const aircraft of this._data.aircrafts) {
        if (Math.random() <= 0.5) {
          // Successful attack - mark every SAM component as destroyed.
          if (samGroup && samTemplate) {
            samGroup.deadUnitIndexes = samTemplate.units.map((_, index) => index)
            samGroup.destroyed = true
          } else if (ewrGroup) {
            ewrGroup.destroyed = true
            ewrGroup.suppressed = false
          }
          debugLog(`DEAD aircraft ${aircraft.unitName} destroyed ${emitterType}`)
          logCombatAction(
            draft,
            coalition,
            `DEAD ${aircraft.unitName} destroyed ${emitterType} at ${emitterObjectiveId}`,
            this._data.callsign,
            {
              entityType: 'flightGroup',
              entityId: this._data.id
            }
          )
          this._data.targetDestroyed = true
          return
        } else {
          debugLog(`DEAD aircraft ${aircraft.unitName} missed ${emitterType}`)
          logCombatAction(
            draft,
            coalition,
            `DEAD ${aircraft.unitName} missed ${emitterType} at ${emitterObjectiveId}`,
            this._data.callsign,
            {
              entityType: 'flightGroup',
              entityId: this._data.id
            }
          )
        }
      }

      // If all attacks missed, an armed SAM can shoot back.
      // Higher chance than SEAD since DEAD aircraft need to get closer
      const shootDownChance = samGroup ? 0.1 : 0
      if (Math.random() < shootDownChance) {
        if (this._data.aircrafts.length > 0) {
          const removedAircraft = this._data.aircrafts.pop()
          debugLog(`DEAD aircraft ${removedAircraft?.unitName} shot down by ${emitterType}`)
          if (removedAircraft) {
            recordAirframeLoss(draft, coalition, removedAircraft)
            maybeCreateDownedPilotFromAircraftLoss(draft, coalition, {
              name: removedAircraft.unitName,
              position: this._data.position
            })
            logCombatAction(
              draft,
              coalition,
              `DEAD ${removedAircraft.unitName} shot down by ${emitterType}`,
              this._data.callsign,
              {
                entityType: 'flightGroup',
                entityId: this._data.id
              }
            )
          }
        }
      }
    }
  }
}

export const isDeadFlightGroup = (flightGroup: FlightGroup): flightGroup is DeadFlightGroup => {
  return flightGroup.task === 'DEAD'
}
