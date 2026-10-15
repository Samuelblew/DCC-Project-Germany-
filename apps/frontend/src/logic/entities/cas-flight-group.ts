import { schemas } from '@dcc/contracts'
import {
  classifyGroundUnit,
  getGroundGroupUnitCount,
  recordInfantryCasualties
} from '@dcc/campaign'
import * as z from 'zod'
import { FlightGroup } from './flight-group'
import { logCombatAction } from '../simulation-log'
import { debugLog } from '@/lib/debug'
import { calculateDistance } from '@/logic/utils/calculate-distance'

const AIR_DEFENSE_COVER_METERS = 5_000

type Campaign = z.infer<typeof schemas.campaign.campaign>
type Coalition = z.infer<typeof schemas.coalition>
type GroundGroup = z.infer<typeof schemas.groundGroup>

function infantryCount(group: GroundGroup): number {
  return group.units.reduce((sum, unit) => {
    if (classifyGroundUnit(unit.name) !== 'infantry') return sum
    return sum + Math.max(0, unit.count)
  }, 0)
}

function coveringAirDefense(draft: Campaign, coalition: Coalition, group: GroundGroup) {
  let guns = 0
  for (const candidate of draft.coalitions[coalition].groundGroups) {
    if (calculateDistance(candidate.position, group.position) > AIR_DEFENSE_COVER_METERS) continue
    for (const unit of candidate.units) {
      if (classifyGroundUnit(unit.name) !== 'air-defense') continue
      guns += Math.max(0, unit.count)
    }
  }
  return guns
}

function applyCasCasualties(group: GroundGroup, expectedLosses: number): number {
  if (expectedLosses <= 0 || group.units.length === 0) return 0

  let remaining = Math.floor(expectedLosses)
  if (Math.random() < expectedLosses - remaining) remaining += 1
  if (remaining <= 0) return 0

  let applied = 0
  while (remaining > 0 && group.units.length > 0) {
    let maxIdx = 0
    for (let i = 1; i < group.units.length; i++) {
      if (group.units[i]!.count > group.units[maxIdx]!.count) maxIdx = i
    }

    const unit = group.units[maxIdx]
    if (!unit || unit.count <= 0) break

    unit.count -= 1
    remaining -= 1
    applied += 1
    if (unit.count <= 0) group.units.splice(maxIdx, 1)
  }

  return applied
}

export class CasFlightGroup extends FlightGroup {
  attackGroundGroup(draft: Campaign, coalition: Coalition) {
    if (!this._data.target || !this._data.tot || this._data.targetDestroyed) return
    if (draft.time < this._data.tot) return

    const enemyCoalition = coalition === 'player' ? 'opponent' : 'player'
    const groundGroups = draft.coalitions[enemyCoalition].groundGroups
    const group = groundGroups.find((entry) => entry.id === this._data.target?.id)

    this._data.targetDestroyed = true

    if (!group) {
      logCombatAction(
        draft,
        coalition,
        `CAS over ${this._data.target.objectiveId}: target formation no longer present`,
        this._data.callsign,
        { entityType: 'flightGroup', entityId: this._data.id }
      )
      return
    }

    const unitCount = getGroundGroupUnitCount(group)
    if (unitCount <= 0) return

    const aircraftCount = Math.max(this._data.aircrafts.length, 1)
    const guns = coveringAirDefense(draft, enemyCoalition, group)
    if (guns >= aircraftCount) {
      logCombatAction(
        draft,
        coalition,
        `CAS driven off by air defense at ${group.objectiveId ?? group.targetObjectiveId ?? 'the FLOT'}`,
        this._data.callsign,
        { entityType: 'flightGroup', entityId: this._data.id }
      )
      return
    }
    let expectedLosses = Math.min(
      Math.max(1, aircraftCount * (2 + Math.random() * 2)),
      Math.max(1, Math.ceil(unitCount * 0.4))
    )
    if (guns > 0) {
      expectedLosses = Math.max(1, expectedLosses * (aircraftCount / (aircraftCount + guns)))
    }
    const infantryBefore = infantryCount(group)
    const destroyedCount = applyCasCasualties(group, expectedLosses)
    const remaining = getGroundGroupUnitCount(group)
    const infantryLost = Math.max(0, infantryBefore - infantryCount(group))

    if (infantryLost > 0 && group.objectiveId) {
      recordInfantryCasualties({
        campaign: draft,
        coalition: enemyCoalition,
        objectiveId: group.objectiveId,
        position: group.position,
        count: infantryLost,
        seed: `cas:${this._data.id}:${group.id}`,
        now: draft.time
      })
    }

    if (remaining <= 0) {
      draft.coalitions[enemyCoalition].groundGroups = groundGroups.filter(
        (entry) => entry.id !== group.id
      )
    }

    logCombatAction(
      draft,
      coalition,
      `CAS hit ground group at ${group.objectiveId ?? group.targetObjectiveId ?? 'the FLOT'}: destroyed ${destroyedCount} units (${remaining} remaining)`,
      this._data.callsign,
      { entityType: 'flightGroup', entityId: this._data.id }
    )
    debugLog('CAS attacked ground group', group.id, destroyedCount, remaining)
  }
}

export const isCasFlightGroup = (flightGroup: FlightGroup): flightGroup is CasFlightGroup => {
  return flightGroup.task === 'CAS'
}
