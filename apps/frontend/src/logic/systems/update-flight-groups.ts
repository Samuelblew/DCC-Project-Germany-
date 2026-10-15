import { config, schemas } from '@dcc/contracts'
import { dissolveGroundGroupIntoReplacementPool, recoverCasualtyPoint } from '@dcc/campaign'
import * as z from 'zod'
import { scenarios, theatres } from '@dcc/data'
import { isStrikeFlightGroup } from '../entities/strike-flight-group'
import { isSeadFlightGroup } from '../entities/sead-flight-group'
import { isDeadFlightGroup } from '../entities/dead-flight-group'
import { isCapFlightGroup } from '../entities/cap-flight-group'
import { isCasFlightGroup } from '../entities/cas-flight-group'
import { FlightGroupFactory } from '../entities/flight-group-factory'
import { logCombatAction } from '../simulation-log'
import { debugLog } from '@/lib/debug'
import { craterAirdrome } from './airport-capture'

function createStrategicStrikeCooldown(currentTime: Date) {
  const min = config.packages['Strategic Strike'].cooldownMinMs
  const max = config.packages['Strategic Strike'].cooldownMaxMs
  const cooldownMs = Math.floor(Math.random() * (max - min + 1)) + min
  return new Date(currentTime.getTime() + cooldownMs)
}

function failRecoveryFlight(
  draft: z.infer<typeof schemas.campaign.campaign>,
  coalition: z.infer<typeof schemas.coalition>,
  group: ReturnType<typeof FlightGroupFactory.getCoalitionFlightGroups>[number]
) {
  if (!group.target) return
  if (group.task === 'CASEVAC') {
    const point = draft.coalitions[coalition].casualtyPoints?.find(
      (entry) => entry.id === group.target?.id && entry.status === 'assigned'
    )
    if (point) {
      point.status = 'awaiting-pickup'
      point.assignedFlightGroupId = undefined
    }
  } else if (group.task === 'Troop Extraction') {
    const request = draft.coalitions[coalition].extractionRequests?.find(
      (entry) => entry.id === group.target?.id && entry.status === 'assigned'
    )
    if (request) {
      request.status = 'awaiting-aircraft'
      request.assignedFlightGroupId = undefined
      request.retryAfter = new Date(
        draft.time.getTime() + config.packages['Troop Extraction'].retryCooldownMs
      )
    }
  }
}

function completeRecoveryFlight(
  draft: z.infer<typeof schemas.campaign.campaign>,
  coalition: z.infer<typeof schemas.coalition>,
  group: ReturnType<typeof FlightGroupFactory.getCoalitionFlightGroups>[number]
) {
  if (!group.target) return
  const rawGroup = draft.coalitions[coalition].flightGroups.find((entry) => entry.id === group.id)
  const destinationObjectiveId = rawGroup?.destinationNode ?? group.homeBase
  if (group.task === 'CASEVAC') {
    recoverCasualtyPoint({
      campaign: draft,
      coalition,
      casualtyPointId: group.target.id,
      destinationObjectiveId
    })
    return
  }
  if (group.task !== 'Troop Extraction') return
  const request = draft.coalitions[coalition].extractionRequests?.find(
    (entry) => entry.id === group.target?.id
  )
  if (!request) return
  const groundGroup = draft.coalitions[coalition].groundGroups.find(
    (entry) => entry.id === request.groundGroupId
  )
  if (!groundGroup) {
    request.status = 'failed'
    return
  }
  request.status = 'delivered'
  dissolveGroundGroupIntoReplacementPool({
    campaign: draft,
    coalition,
    group: groundGroup,
    objectiveId: destinationObjectiveId
  })
}

function resolveAntiShipStrike(
  draft: z.infer<typeof schemas.campaign.campaign>,
  coalition: z.infer<typeof schemas.coalition>,
  group: ReturnType<typeof FlightGroupFactory.getCoalitionFlightGroups>[number]
) {
  if (group.task !== 'Antiship Strike' || !group.target || !group.tot || group.targetDestroyed)
    return
  if (draft.time < group.tot) return
  const enemyCoalition = coalition === 'player' ? 'opponent' : 'player'
  const navalGroup = draft.coalitions[enemyCoalition].navalGroups?.find(
    (candidate) => candidate.id === group.target?.id
  )
  if (!navalGroup) {
    group.targetDestroyed = true
    return
  }
  if (navalGroup.role === 'carrier') {
    group.targetDestroyed = true
    return
  }
  const unit = navalGroup.units?.find((candidate) => candidate.state !== 'sunk')
  if (unit) {
    unit.damage = 1
    unit.state = 'sunk'
    navalGroup.damage =
      (navalGroup.units?.filter((candidate) => candidate.state === 'sunk').length ?? 0) /
      Math.max(1, navalGroup.units?.length ?? navalGroup.unitTypes.length)
    navalGroup.state = navalGroup.damage >= 1 ? 'sunk' : 'damaged'
    logCombatAction(
      draft,
      coalition,
      `${group.callsign} struck ${navalGroup.name}`,
      group.callsign,
      {
        entityType: 'flightGroup',
        entityId: group.id
      }
    )
  }
  group.targetDestroyed = true
}

function applyRunwayAttack(
  draft: z.infer<typeof schemas.campaign.campaign>,
  coalition: z.infer<typeof schemas.coalition>,
  group: ReturnType<typeof FlightGroupFactory.getCoalitionFlightGroups>[number]
) {
  if (group.task !== 'Runway Attack' || !group.target || group.targetDestroyed) return
  if (!group.tot || draft.time < group.tot) return

  const enemyCoalition = coalition === 'player' ? 'opponent' : 'player'
  craterAirdrome(draft, enemyCoalition, group.target.id, draft.time)
  group.targetDestroyed = true
  logCombatAction(
    draft,
    coalition,
    `OCA cratered ${group.target.id}; field recovering`,
    group.callsign,
    {
      entityType: 'flightGroup',
      entityId: group.id
    }
  )
}

export function updateFlightGroups(
  draft: z.infer<typeof schemas.campaign.campaign>,
  coalition: z.infer<typeof schemas.coalition>,
  frozenFlightIds?: ReadonlySet<string>
) {
  const groups = FlightGroupFactory.getCoalitionFlightGroups(draft, coalition)
  const finishedIds = new Set<string>()

  // Get theatre for SEAD operations
  const scenario = scenarios.find((s) => s.id === draft.scenarioId)
  const theatre = scenario ? theatres.find((t) => t.name === scenario.theatreName) : undefined

  debugLog('Updating flight groups', groups.length)

  for (const group of groups) {
    // Inside the running mission, DCS owns the flight. The debrief applies its losses.
    if (frozenFlightIds?.has(group.id)) continue
    if (group.aircrafts.length === 0) {
      failRecoveryFlight(draft, coalition, group)
      finishedIds.add(group.id)
      continue
    }

    group.move(draft.time)
    resolveAntiShipStrike(draft, coalition, group)
    if (group.isLanded(draft.time)) {
      const turnaround = (draft.coalitions[coalition].aircraftTurnaroundUntil ??= {})
      const readyAt = draft.time.getTime() + 60 * 60 * 1000
      for (const aircraft of group.aircrafts) {
        const key = `${group.homeBase}:${aircraft.aircraftName}`
        turnaround[key] = Math.max(turnaround[key] ?? 0, readyAt)
      }
      completeRecoveryFlight(draft, coalition, group)
      finishedIds.add(group.id)
      if (
        group.task === 'CAP' ||
        group.task === 'Intercept' ||
        group.task === 'Fighter Sweep' ||
        group.task === 'AWACS' ||
        group.task === 'SEAD' ||
        group.task === 'DEAD' ||
        group.task === 'Pinpoint Strike' ||
        group.task === 'Strategic Strike' ||
        group.task === 'Runway Attack' ||
        group.task === 'CAS' ||
        group.task === 'ECM'
      ) {
        logCombatAction(draft, coalition, `${group.task} landed`, group.callsign, {
          entityType: 'flightGroup',
          entityId: group.id
        })
      }
    }

    if (isStrikeFlightGroup(group)) {
      debugLog('Striking structure', group)
      group.strikeStructure(draft, coalition)
    } else if (group.task === 'Runway Attack') {
      applyRunwayAttack(draft, coalition, group)
    } else if (isSeadFlightGroup(group) && theatre) {
      debugLog('SEAD suppressing radar emitter', group)
      group.suppressSam(draft, coalition, theatre)
    } else if (isDeadFlightGroup(group) && theatre) {
      debugLog('DEAD attacking radar emitter', group)
      group.destroySam(draft, coalition, theatre)
    } else if (isCapFlightGroup(group)) {
      debugLog('CAP patrolling', group)
      group.engageAirTargets(draft, coalition)
    } else if (isCasFlightGroup(group)) {
      debugLog('CAS attacking ground group', group)
      group.attackGroundGroup(draft, coalition)
    } else {
      debugLog('Not a strike/strategic strike/SEAD/DEAD/CAP/CAS group', group.task)
    }
  }

  // Clear suppression for radar emitters targeted by finished SEAD flights.
  if (finishedIds.size > 0) {
    const enemyCoalition = coalition === 'player' ? 'opponent' : 'player'
    const finishedSeadGroups = groups.filter((g) => finishedIds.has(g.id) && isSeadFlightGroup(g))
    const finishedStrategicStrikeGroups = groups.filter(
      (g) => finishedIds.has(g.id) && g.task === 'Strategic Strike'
    )

    if (finishedStrategicStrikeGroups.length > 0) {
      draft.coalitions[coalition].strategicStrikeCooldownUntil = createStrategicStrikeCooldown(
        draft.time
      )
    }

    for (const seadGroup of finishedSeadGroups) {
      if (seadGroup.target) {
        const samGroup = draft.coalitions[enemyCoalition].samGroups.find(
          (s) => s.id === seadGroup.target?.id
        )
        if (samGroup) {
          samGroup.suppressed = false
          debugLog(`SAM ${samGroup.type} no longer suppressed - SEAD landed`)
          logCombatAction(
            draft,
            coalition,
            `SEAD completed, suppression lifted on ${samGroup.type} at ${samGroup.objectiveId}`,
            seadGroup.callsign,
            {
              entityType: 'flightGroup',
              entityId: seadGroup.id
            }
          )
          continue
        }

        const ewrGroup = draft.coalitions[enemyCoalition].ewrGroups?.find(
          (ewr) => ewr.id === seadGroup.target?.id
        )
        if (ewrGroup) {
          ewrGroup.suppressed = false
          debugLog(`EWR ${ewrGroup.type} no longer suppressed - SEAD landed`)
          logCombatAction(
            draft,
            coalition,
            `SEAD completed, suppression lifted on ${ewrGroup.type} at ${ewrGroup.objectiveId}`,
            seadGroup.callsign,
            {
              entityType: 'flightGroup',
              entityId: seadGroup.id
            }
          )
        }
      }
    }

    draft.coalitions[coalition].flightGroups = draft.coalitions[coalition].flightGroups.filter(
      (g) => !finishedIds.has(g.id)
    )
  }

  const pictureCoalition = coalition === 'player' ? 'opponent' : 'player'
  const ecmUp = draft.coalitions[coalition].flightGroups.some(
    (flight) =>
      flight.task === 'ECM' && new Date(flight.flightplan.startTime).getTime() <= draft.time.getTime()
  )
  for (const ewr of draft.coalitions[pictureCoalition].ewrGroups ?? []) {
    ewr.jammed = ecmUp
  }
}
