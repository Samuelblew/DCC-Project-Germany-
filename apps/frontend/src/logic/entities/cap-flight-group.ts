import { schemas, config } from '@dcc/contracts'
import * as z from 'zod'
import { recordAirframeLoss } from '../systems/air-order-of-battle'
import { FlightGroup } from './flight-group'
import { calculateDistance } from '../utils/calculate-distance'
import { buildCapMissionWaypoints, spawnPlannedFlightGroup } from './flight-group-spawn'
import { logCombatAction } from '../simulation-log'
import { maybeCreateDownedPilotFromAircraftLoss } from '../systems/downed-pilots'
import { debugLog } from '@/lib/debug'
import { hasFlightGroupTakenOff } from './flight-status'

export class CapFlightGroup extends FlightGroup {
  static spawn(
    draft: z.infer<typeof schemas.campaign.campaign>,
    coalition: z.infer<typeof schemas.coalition>,
    params: {
      homeBase: string
      homeBasePosition: z.infer<typeof schemas.position>
      patrolCenter: z.infer<typeof schemas.position>
      runwayAngle?: number
      aircraftType: z.infer<typeof schemas.dcs.aircraftName>
      packageId?: string
      startTime?: Date
      patrolAltitude?: number
      patrolDurationMs?: number
      target?: z.infer<typeof schemas.flightGroup>['target']
    }
  ): { flightGroupId: string; tot: Date } {
    const numAircraft = config.packages.CAP.aircraftsPerGroup
    const missionWaypoints = buildCapMissionWaypoints(
      params.homeBasePosition,
      params.patrolCenter,
      params.patrolAltitude
    )

    const startTime =
      params.startTime ??
      new Date(draft.time.getTime() + Math.floor(Math.random() * (20 - 10 + 1) + 10) * 60 * 1000)

    const { flightGroupId, tot } = spawnPlannedFlightGroup({
      draft,
      coalition,
      task: 'CAP',
      aircraftType: params.aircraftType,
      aircraftCount: numAircraft,
      homeBase: params.homeBase,
      homeBasePosition: params.homeBasePosition,
      destination: params.patrolCenter,
      missionWaypoints,
      startTime,
      runwayAngle: params.runwayAngle,
      packageId: params.packageId,
      target: params.target
    })
    const spawned = draft.coalitions[coalition].flightGroups.find(
      (group) => group.id === flightGroupId
    )
    if (spawned && params.patrolDurationMs) spawned.patrolDurationMs = params.patrolDurationMs

    debugLog(
      `Spawned CAP group from ${params.homeBase} patrolling near ${params.patrolCenter.x}, ${params.patrolCenter.y}`
    )

    return { flightGroupId, tot: tot ?? startTime }
  }

  /**
   * CAP engagement logic - engages enemy aircraft within detection/weapon range
   * Returns true if CAP engaged targets this tick
   */
  engageAirTargets(
    draft: z.infer<typeof schemas.campaign.campaign>,
    coalition: z.infer<typeof schemas.coalition>
  ): boolean {
    if (!hasFlightGroupTakenOff(this._data, draft.time)) {
      return false
    }

    const enemyCoalition = coalition === 'player' ? 'opponent' : 'player'
    const enemyFlightGroups = draft.coalitions[enemyCoalition].flightGroups

    // CAP engagement range (radar detection + missile range approximation)
    const engagementRange =
      this._data.task === 'Intercept'
        ? config.packages.Intercept.engagementRange
        : this._data.task === 'Fighter Sweep'
          ? config.packages['Fighter Sweep'].engagementZoneRadius
          : config.packages.CAP.engagementRange

    let engaged = false

    for (const enemyFg of enemyFlightGroups) {
      if (!hasFlightGroupTakenOff(enemyFg, draft.time)) {
        continue
      }

      const distance = calculateDistance(this._data.position, enemyFg.position)

      if (distance <= engagementRange) {
        // Engage enemy aircraft
        engaged = true

        // Each CAP aircraft has a chance to shoot down an enemy
        for (const capAircraft of this._data.aircrafts) {
          // Base hit probability decreases with distance
          const distanceFactor = 1 - distance / engagementRange
          const hitChance = 0.15 * distanceFactor // 15% max hit chance per tick

          if (Math.random() < hitChance && enemyFg.aircrafts.length > 0) {
            const shotDownAircraft = enemyFg.aircrafts.pop()
            debugLog(
              `CAP aircraft ${capAircraft.unitName} shot down enemy ${shotDownAircraft?.unitName}`
            )
            if (shotDownAircraft) {
              recordAirframeLoss(draft, enemyCoalition, shotDownAircraft)
              maybeCreateDownedPilotFromAircraftLoss(draft, enemyCoalition, {
                name: shotDownAircraft.unitName,
                position: enemyFg.position
              })
              logCombatAction(
                draft,
                coalition,
                `CAP ${capAircraft.unitName} shot down ${shotDownAircraft.unitName}`,
                this._data.callsign,
                {
                  entityType: 'flightGroup',
                  entityId: this._data.id
                }
              )
            }
          }
        }

        // Enemy can shoot back at CAP
        for (const enemyAircraft of enemyFg.aircrafts) {
          const enemyHitChance = 0.1 * (1 - distance / engagementRange)
          if (Math.random() < enemyHitChance && this._data.aircrafts.length > 0) {
            const lostAircraft = this._data.aircrafts.pop()
            debugLog(
              `CAP aircraft ${lostAircraft?.unitName} shot down by enemy ${enemyAircraft.unitName}`
            )
            if (lostAircraft) {
              recordAirframeLoss(draft, coalition, lostAircraft)
              maybeCreateDownedPilotFromAircraftLoss(draft, coalition, {
                name: lostAircraft.unitName,
                position: this._data.position
              })
              logCombatAction(
                draft,
                coalition,
                `CAP ${lostAircraft.unitName} shot down by ${enemyAircraft.unitName}`,
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

    return engaged
  }

  private getRacetrackIndices(waypoints: z.infer<typeof schemas.waypoint>[]) {
    const startIndex = waypoints.findIndex((wp, idx) => {
      const next = waypoints[idx + 1]
      return wp.type === 'Task' && next?.type === 'RaceTrack End'
    })
    if (startIndex === -1) return null
    return { startIndex, endIndex: startIndex + 1 }
  }

  private getLegTimeMs(
    from: z.infer<typeof schemas.position>,
    to: z.infer<typeof schemas.position>,
    speed: number
  ) {
    const dx = to.x - from.x
    const dy = to.y - from.y
    const distance = Math.sqrt(dx * dx + dy * dy)
    return speed > 0 ? (distance / speed) * 1000 : 0
  }

  private getPositionAlong(
    from: z.infer<typeof schemas.position>,
    to: z.infer<typeof schemas.position>,
    ratio: number
  ) {
    return {
      x: from.x + (to.x - from.x) * ratio,
      y: from.y + (to.y - from.y) * ratio
    }
  }

  private getPatrolPosition(
    racetrackStart: z.infer<typeof schemas.position>,
    racetrackEnd: z.infer<typeof schemas.position>,
    legTimeMs: number,
    timeInPatrolMs: number
  ) {
    if (legTimeMs <= 0) {
      return racetrackStart
    }

    const cycleTime = legTimeMs * 2
    const cyclePos = timeInPatrolMs % cycleTime

    if (cyclePos <= legTimeMs) {
      const ratio = cyclePos / legTimeMs
      return this.getPositionAlong(racetrackStart, racetrackEnd, ratio)
    }

    const ratio = (cyclePos - legTimeMs) / legTimeMs
    return this.getPositionAlong(racetrackEnd, racetrackStart, ratio)
  }

  override move(currentTime: Date) {
    const startTime = new Date(this._data.flightplan.startTime)
    if (currentTime < startTime) {
      return
    }

    const STARTUP_DELAY_MS = 10 * 60 * 1000
    let elapsed = currentTime.getTime() - startTime.getTime()

    if (elapsed < STARTUP_DELAY_MS) {
      if (this._data.flightplan.waypoints.length > 0) {
        this.setPosition(this._data.flightplan.waypoints[0]?.position ?? this._data.position)
      }
      return
    }

    elapsed -= STARTUP_DELAY_MS

    const waypoints = this._data.flightplan.waypoints
    const racetrack = this.getRacetrackIndices(waypoints)

    if (!racetrack) {
      super.move(currentTime)
      return
    }

    for (let i = 0; i < racetrack.startIndex; i++) {
      const startWp = waypoints[i]
      const endWp = waypoints[i + 1]
      if (!startWp || !endWp) continue

      const timeMs = this.getLegTimeMs(startWp.position, endWp.position, endWp.speed)
      if (elapsed < timeMs) {
        const ratio = timeMs > 0 ? elapsed / timeMs : 0
        this.setPosition(this.getPositionAlong(startWp.position, endWp.position, ratio))
        return
      }

      elapsed -= timeMs
    }

    const racetrackStart = waypoints[racetrack.startIndex]?.position
    const racetrackEnd = waypoints[racetrack.endIndex]?.position
    const racetrackEndSpeed = waypoints[racetrack.endIndex]?.speed ?? 0

    if (!racetrackStart || !racetrackEnd) {
      super.move(currentTime)
      return
    }

    const legTimeMs = this.getLegTimeMs(racetrackStart, racetrackEnd, racetrackEndSpeed)
    const patrolDurationMs = this.patrolDurationMs()

    if (elapsed < patrolDurationMs) {
      const patrolPos = this.getPatrolPosition(racetrackStart, racetrackEnd, legTimeMs, elapsed)
      this.setPosition(patrolPos)
      return
    }

    elapsed -= patrolDurationMs

    let currentPos = this.getPatrolPosition(
      racetrackStart,
      racetrackEnd,
      legTimeMs,
      patrolDurationMs
    )

    for (let i = racetrack.endIndex; i < waypoints.length - 1; i++) {
      const endWp = waypoints[i + 1]
      if (!endWp) continue

      const startPos = i === racetrack.endIndex ? currentPos : waypoints[i]?.position
      if (!startPos) continue

      const timeMs = this.getLegTimeMs(startPos, endWp.position, endWp.speed)
      if (elapsed < timeMs) {
        const ratio = timeMs > 0 ? elapsed / timeMs : 0
        this.setPosition(this.getPositionAlong(startPos, endWp.position, ratio))
        return
      }

      elapsed -= timeMs
      currentPos = endWp.position
    }

    if (waypoints.length > 0) {
      this.setPosition(waypoints[waypoints.length - 1]?.position ?? this._data.position)
    }
  }

  override isLanded(currentTime: Date): boolean {
    const startTime = new Date(this._data.flightplan.startTime)
    if (currentTime < startTime) {
      return false
    }

    const STARTUP_DELAY_MS = 10 * 60 * 1000
    let elapsed = currentTime.getTime() - startTime.getTime()

    if (elapsed < STARTUP_DELAY_MS) {
      return false
    }

    elapsed -= STARTUP_DELAY_MS

    const waypoints = this._data.flightplan.waypoints
    const racetrack = this.getRacetrackIndices(waypoints)

    if (!racetrack) {
      return super.isLanded(currentTime)
    }

    for (let i = 0; i < racetrack.startIndex; i++) {
      const startWp = waypoints[i]
      const endWp = waypoints[i + 1]
      if (!startWp || !endWp) continue

      const timeMs = this.getLegTimeMs(startWp.position, endWp.position, endWp.speed)
      if (elapsed < timeMs) {
        return false
      }

      elapsed -= timeMs
    }

    const racetrackStart = waypoints[racetrack.startIndex]?.position
    const racetrackEnd = waypoints[racetrack.endIndex]?.position
    const racetrackEndSpeed = waypoints[racetrack.endIndex]?.speed ?? 0

    if (!racetrackStart || !racetrackEnd) {
      return super.isLanded(currentTime)
    }

    const legTimeMs = this.getLegTimeMs(racetrackStart, racetrackEnd, racetrackEndSpeed)
    const patrolDurationMs = this.patrolDurationMs()

    if (elapsed < patrolDurationMs) {
      return false
    }

    elapsed -= patrolDurationMs

    let currentPos = this.getPatrolPosition(
      racetrackStart,
      racetrackEnd,
      legTimeMs,
      patrolDurationMs
    )

    for (let i = racetrack.endIndex; i < waypoints.length - 1; i++) {
      const endWp = waypoints[i + 1]
      if (!endWp) continue

      const startPos = i === racetrack.endIndex ? currentPos : waypoints[i]?.position
      if (!startPos) continue

      const timeMs = this.getLegTimeMs(startPos, endWp.position, endWp.speed)
      if (elapsed < timeMs) {
        return false
      }

      elapsed -= timeMs
      currentPos = endWp.position
    }

    return true
  }

  private patrolDurationMs() {
    if (this._data.patrolDurationMs) return this._data.patrolDurationMs
    return this._data.task === 'AWACS'
      ? config.packages.AWACS.patrolDuration
      : config.packages.CAP.patrolDuration
  }
}

export const isCapFlightGroup = (flightGroup: FlightGroup): flightGroup is CapFlightGroup => {
  return (
    flightGroup.task === 'CAP' ||
    flightGroup.task === 'Intercept' ||
    flightGroup.task === 'Fighter Sweep'
  )
}
