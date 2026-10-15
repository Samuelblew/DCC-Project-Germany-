import { schemas } from '@dcc/contracts'
import { classifyGroundUnit } from '@dcc/campaign'
import {
  applyEscalationAircraftTypes,
  getCareerAircraft,
  MS_PER_ESCALATION_DAY,
  nextEscalationStage,
  pruneGermanyIadsDeadUnitsForEraChange,
  scenarios,
  theatres,
  type EscalationStage
} from '@dcc/data'
import type * as z from 'zod'

import { addCareerAircraftToTasks } from '@/logic/career/career'
import { logCampaignAction } from '@/logic/simulation-log'

type Campaign = z.infer<typeof schemas.campaign.campaign>
type CoalitionData = Campaign['coalitions']['player']
type FlightGroup = CoalitionData['flightGroups'][number]
type Theatre = z.infer<typeof schemas.theatre>
type Position = z.infer<typeof schemas.position>

const STARTUP_DELAY_MS = 10 * 60 * 1000
const RTB_SPEED = 220

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

function homePosition(theatre: Theatre, homeBase: string | undefined): Position | undefined {
  if (!homeBase) return undefined
  const airdrome = theatre.airdromeDetails[homeBase]
  if (airdrome) return { x: airdrome.x, y: airdrome.y }
  return theatre.objectives.find((objective) => objective.name === homeBase)?.position
}

function sendFlightHome(draft: Campaign, group: FlightGroup, theatre: Theatre) {
  const home = homePosition(theatre, group.homeBase) ?? group.position
  group.target = undefined
  group.tot = undefined
  group.packageId = undefined
  group.flightplan.startTime = new Date(draft.time.getTime() - STARTUP_DELAY_MS)
  group.flightplan.waypoints = [
    {
      name: 'RTB',
      type: 'Nav',
      altitude: 6_000,
      speed: RTB_SPEED,
      position: { ...group.position }
    },
    {
      name: 'Landing',
      type: 'Landing',
      altitude: 0,
      speed: RTB_SPEED,
      position: { ...home }
    }
  ]
}

/** Previous-generation AI recover to base instead of vanishing mid-sortie. */
function retirePreviousGenerationFlights(draft: Campaign, theatre: Theatre | undefined) {
  for (const side of ['player', 'opponent'] as const) {
    const coalition = draft.coalitions[side]
    const allowed = allowedAircraft(coalition)
    const recovering = new Set<string>()
    for (const group of coalition.flightGroups) {
      const crewed = group.aircrafts.some((aircraft) => aircraft.client)
      const current = group.aircrafts.every((aircraft) => allowed.has(aircraft.aircraftName))
      if (crewed || current) continue
      recovering.add(group.id)
      if (theatre) sendFlightHome(draft, group, theatre)
    }
    if (recovering.size === 0) continue
    coalition.packages = coalition.packages.filter(
      (missionPackage) =>
        missionPackage.members.length > 0 &&
        missionPackage.members.every((member) => !recovering.has(member.flightGroupId))
    )
    if (!theatre) {
      coalition.flightGroups = coalition.flightGroups.filter((group) => !recovering.has(group.id))
    }
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

  const previous = stage
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
  }

  if (stage === escalation.stage) return

  restoreCareerAircraft(draft)
  const scenario = scenarios.find((entry) => entry.id === draft.scenarioId)
  const theatre = theatres.find((entry) => entry.name === scenario?.theatreName)
  retirePreviousGenerationFlights(draft, theatre)
  refreshGroundGenerations(draft)
  escalation.stage = stage
  escalation.stageStartedAt = stageStartedAt
  draft.era = stage
  logCampaignAction(
    draft,
    'player',
    `Generation advanced to ${stage}. USAFE and GSFG re-equipped; ${previous} sorties are recovering to base.`
  )
}
