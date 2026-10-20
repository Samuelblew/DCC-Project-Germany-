import { schemas } from '@dcc/contracts'
import { scenarios } from '@dcc/data'
import type * as z from 'zod'

import { logCampaignAction } from '@/logic/simulation-log'

type Campaign = z.infer<typeof schemas.campaign.campaign>
type Coalition = z.infer<typeof schemas.coalition>
type MissionState = z.infer<typeof schemas.missionState>
type FlightGroup = Campaign['coalitions']['player']['flightGroups'][number]
type MissionRating = NonNullable<Campaign['missionRatings']>[number]

export const NEUTRAL_MORALE = 50
/** Falcon4.aii InitiativeLeakPerHour: the edge a side earned fades this fast without new results. */
const MORALE_LEAK_PER_HOUR = 2
/** Morale points one rating step above or below average is worth. */
const MORALE_PER_RATING_STEP = 4
const MORALE_PER_CAPTURE = 2
const MAX_STORED_RATINGS = 50
const HOUR_MS = 3_600_000

const AIR_TO_AIR_TASKS = new Set(['CAP', 'Escort', 'Intercept', 'Fighter Sweep'])

export const RATING_LABELS = ['', 'Poor', 'Marginal', 'Average', 'Good', 'Excellent'] as const

export function coalitionMorale(campaign: Pick<Campaign, 'morale'>, coalition: Coalition) {
  return campaign.morale?.[coalition] ?? NEUTRAL_MORALE
}

/** Ground combat power multiplier: 0.85 at rock bottom, 1.0 at neutral, 1.15 at full morale. */
export function moraleCombatMultiplier(campaign: Pick<Campaign, 'morale'>, coalition: Coalition) {
  return 0.85 + (0.3 * coalitionMorale(campaign, coalition)) / 100
}

function clampMorale(value: number) {
  return Math.min(100, Math.max(0, value))
}

export function shiftMorale(draft: Campaign, coalition: Coalition, delta: number) {
  draft.morale ??= { player: NEUTRAL_MORALE, opponent: NEUTRAL_MORALE }
  draft.morale[coalition] = clampMorale(draft.morale[coalition] + delta)
}

/** Both sides drift back towards neutral by `seconds` of campaign time. */
export function updateMorale(draft: Campaign, seconds: number) {
  if (!draft.morale || seconds <= 0) return
  const leak = (MORALE_LEAK_PER_HOUR * seconds * 1000) / HOUR_MS
  for (const coalition of ['player', 'opponent'] as const) {
    const value = draft.morale[coalition]
    const distance = value - NEUTRAL_MORALE
    draft.morale[coalition] =
      Math.abs(distance) <= leak ? NEUTRAL_MORALE : value - Math.sign(distance) * leak
  }
}

/** A captured town lifts the capturer and costs the side that lost it. */
export function recordCaptureMorale(draft: Campaign, capturer: Coalition) {
  shiftMorale(draft, capturer, MORALE_PER_CAPTURE)
  shiftMorale(draft, capturer === 'player' ? 'opponent' : 'player', -MORALE_PER_CAPTURE)
}

/**
 * Rates one player-flown flight the way the Falcon debrief does: the task done, everyone home.
 * Air-to-air tasks count as done with at least one kill by the flight; the others when the
 * debrief marked the target complete.
 */
export function rateClientFlight(params: {
  group: FlightGroup
  missionState: MissionState
  taskCompleted: boolean
  at: Date
}): MissionRating {
  const { group, missionState } = params
  const unitNames = new Set(
    group.aircrafts.map((aircraft, index) => aircraft.unitName || `${group.callsign}-${index + 1}`)
  )
  const lost = (missionState.lostUnits ?? []).filter((unit) => unitNames.has(unit.name)).length
  const kills = (missionState.lostUnits ?? []).filter(
    (unit) =>
      !unitNames.has(unit.name) &&
      (unit.killerGroupName === group.callsign ||
        (unit.killerUnitName != null && unitNames.has(unit.killerUnitName)))
  ).length
  const airToAir = AIR_TO_AIR_TASKS.has(group.task)
  const done = airToAir ? kills > 0 : params.taskCompleted

  const reasons: string[] = []
  let rating = 3
  if (done) {
    rating += 1
    reasons.push(airToAir ? `${kills} kill${kills === 1 ? '' : 's'}` : 'target destroyed')
  } else {
    reasons.push(airToAir ? 'no kills' : 'target not destroyed')
  }
  if (airToAir && kills >= 3) {
    rating += 1
    reasons.push('ace-level sortie')
  }
  if (lost === 0) {
    if (done) rating += 1
    reasons.push('everyone home')
  } else {
    rating -= lost
    reasons.push(`${lost} aircraft lost`)
  }

  return {
    at: params.at,
    flightGroupId: group.id,
    callsign: group.callsign,
    task: group.task,
    rating: Math.min(5, Math.max(1, rating)),
    reasons
  }
}

/** Ratings feed morale, Falcon style: good sorties lift your side and wear the enemy down. */
export function applyMissionRatings(draft: Campaign, ratings: MissionRating[]) {
  if (ratings.length === 0) return
  for (const rating of ratings) {
    const steps = rating.rating - 3
    shiftMorale(draft, 'player', steps * MORALE_PER_RATING_STEP)
    shiftMorale(draft, 'opponent', (-steps * MORALE_PER_RATING_STEP) / 2)
    logCampaignAction(
      draft,
      'player',
      `Mission rating ${rating.callsign} (${rating.task}): ${RATING_LABELS[rating.rating]} — ${rating.reasons.join(', ')}`
    )
  }
  draft.missionRatings = [...(draft.missionRatings ?? []), ...ratings].slice(-MAX_STORED_RATINGS)
}

/**
 * Sets the deadline from the scenario on first use (a campaign saved before deadlines starts its
 * clock now) and ends the war in a stalemate once it passes. Escalation campaigns have no deadline.
 */
export function updateCampaignDeadline(draft: Campaign) {
  if ((draft.status ?? 'active') !== 'active') return
  if (draft.escalation?.enabled) return
  if (!draft.deadline) {
    const days = scenarios.find((entry) => entry.id === draft.scenarioId)?.durationDays
    if (!days) return
    draft.deadline = new Date(draft.time.getTime() + days * 24 * HOUR_MS)
    return
  }
  if (draft.time.getTime() < new Date(draft.deadline).getTime()) return
  draft.status = 'stalemate'
  logCampaignAction(draft, 'player', 'Campaign ended in a stalemate: the deadline passed')
}
