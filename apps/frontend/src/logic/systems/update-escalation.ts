import { schemas } from '@dcc/contracts'
import { classifyGroundUnit } from '@dcc/campaign'
import {
  applyEscalationAircraftTypes,
  getCareerAircraft,
  MS_PER_ESCALATION_DAY,
  nextEscalationStage,
  pruneGermanyIadsDeadUnitsForEraChange,
  type EscalationStage
} from '@dcc/data'
import type * as z from 'zod'

import { addCareerAircraftToTasks } from '@/logic/career/career'
import { logCampaignAction } from '@/logic/simulation-log'

type Campaign = z.infer<typeof schemas.campaign.campaign>
type CoalitionData = Campaign['coalitions']['player']

function restoreCareerAircraft(draft: Campaign) {
  if (!draft.career) return
  const names = new Set(draft.career.airframes.map((airframe) => airframe.aircraftName))
  names.add(draft.career.preferredAircraft)
  for (const name of names) {
    const aircraft = getCareerAircraft(name)
    if (aircraft) addCareerAircraftToTasks(draft.coalitions.player.aircraftTypes, aircraft)
  }
}

function allowedAircraft(coalition: CoalitionData) {
  return new Set(Object.values(coalition.aircraftTypes).flat())
}

/** AI sorties from the previous generation free their slots so the new roster can launch. */
function retirePreviousGenerationFlights(draft: Campaign) {
  for (const side of ['player', 'opponent'] as const) {
    const coalition = draft.coalitions[side]
    const allowed = allowedAircraft(coalition)
    const removed = new Set<string>()
    coalition.flightGroups = coalition.flightGroups.filter((group) => {
      const crewed = group.aircrafts.some((aircraft) => aircraft.client)
      const current = group.aircrafts.every((aircraft) => allowed.has(aircraft.aircraftName))
      if (crewed || current) return true
      removed.add(group.id)
      return false
    })
    coalition.packages = coalition.packages.filter(
      (missionPackage) =>
        missionPackage.members.length > 0 &&
        missionPackage.members.every((member) => !removed.has(member.flightGroupId))
    )
  }
}

function replacementGroundUnit(coalition: CoalitionData, name: string) {
  const kind = classifyGroundUnit(name)
  const types = coalition.groundUnitTypes
  if (kind === 'infantry') return types.Infantry?.[0]
  if (kind === 'air-defense') return types['Shorad Vehicle']?.[0] ?? types['Shorad Infantry']?.[0]
  return types.Vehicle?.[0]
}

function refreshGroundGenerations(draft: Campaign) {
  for (const side of ['player', 'opponent'] as const) {
    const coalition = draft.coalitions[side]
    const allowed = new Set(
      Object.values(coalition.groundUnitTypes)
        .flat()
        .filter((name): name is string => typeof name === 'string')
    )
    for (const group of coalition.groundGroups) {
      for (const unit of group.units) {
        if (allowed.has(unit.name)) continue
        const next = replacementGroundUnit(coalition, unit.name)
        if (next) unit.name = next
      }
    }
  }
}

export function updateEscalation(draft: Campaign) {
  const escalation = draft.escalation
  if (!escalation?.enabled) return
  if (escalation.stage === 'Modern') return

  let stage: EscalationStage = escalation.stage
  let stageStartedAt = escalation.stageStartedAt
  const durationMs = escalation.eraDurationDays * MS_PER_ESCALATION_DAY
  if (durationMs <= 0) return

  while (stage !== 'Modern') {
    if (draft.time.getTime() - stageStartedAt.getTime() < durationMs) break
    const next = nextEscalationStage(stage)
    if (!next) break

    draft.germanyIadsDeadUnits = pruneGermanyIadsDeadUnitsForEraChange(
      draft.germanyIadsDeadUnits,
      stage,
      next
    )
    applyEscalationAircraftTypes(draft, next)
    stage = next
    stageStartedAt = new Date(draft.time)
    escalation.history.push({ stage: next, startedAt: stageStartedAt })
    logCampaignAction(draft, 'player', `IADS and fleet advanced to ${next}`)
  }

  if (stage === escalation.stage) return

  restoreCareerAircraft(draft)
  retirePreviousGenerationFlights(draft)
  refreshGroundGenerations(draft)
  escalation.stage = stage
  escalation.stageStartedAt = stageStartedAt
  draft.era = stage
}
