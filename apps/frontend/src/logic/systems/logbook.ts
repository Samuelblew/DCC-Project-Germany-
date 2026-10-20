import { schemas } from '@dcc/contracts'
import type * as z from 'zod'

import { logCampaignAction } from '@/logic/simulation-log'

type Campaign = z.infer<typeof schemas.campaign.campaign>
type MissionState = z.infer<typeof schemas.missionState>
type FlightGroup = Campaign['coalitions']['player']['flightGroups'][number]
type MissionRating = NonNullable<Campaign['missionRatings']>[number]
export type Logbook = NonNullable<Campaign['logbook']>
type LogbookSortie = Logbook['sorties'][number]
type Kills = LogbookSortie['kills']

/** Falcon BMS style scoring: kills by what they were, the sortie by its rating. */
const POINTS = {
  air: 10,
  helicopter: 6,
  ground: 2,
  static: 3,
  naval: 15,
  friendly: -25,
  ejected: -10,
  killed: -50
}
const MAX_SORTIES = 100

type Side = 'eastern' | 'western'

/** Rank thresholds in logbook points; the names follow the player's air force. */
const RANKS: Array<{ points: number; western: string; eastern: string }> = [
  { points: 0, western: 'Second Lieutenant', eastern: 'Lieutenant' },
  { points: 150, western: 'First Lieutenant', eastern: 'Senior Lieutenant' },
  { points: 300, western: 'Captain', eastern: 'Captain' },
  { points: 800, western: 'Major', eastern: 'Major' },
  { points: 1600, western: 'Lieutenant Colonel', eastern: 'Lieutenant Colonel' },
  { points: 3000, western: 'Colonel', eastern: 'Colonel' }
]

export const MEDALS: Record<string, { western: string; eastern: string; reason: string }> = {
  excellent: {
    western: 'Air Medal',
    eastern: 'Medal "For Combat Merit"',
    reason: 'an Excellent mission rating'
  },
  triple: {
    western: 'Distinguished Flying Cross',
    eastern: 'Order of the Red Star',
    reason: 'three air kills in one sortie'
  },
  ace: {
    western: 'Silver Star',
    eastern: 'Order of the Red Banner',
    reason: 'five air kills: an ace'
  },
  survivor: {
    western: 'Purple Heart',
    eastern: 'Medal "For Courage"',
    reason: 'shot down and survived'
  },
  veteran: {
    western: 'Air Force Longevity Award',
    eastern: 'Medal "For Battle Merit"',
    reason: 'twenty-five sorties flown'
  },
  victory: {
    western: 'Air Force Cross',
    eastern: 'Order of Lenin',
    reason: 'the campaign won'
  }
}

/** Medals awarded once per campaign; the others can be won again. */
const ONCE = new Set(['ace', 'veteran', 'victory'])

export function logbookSide(campaign: Pick<Campaign, 'playerSide'>): Side {
  return (campaign.playerSide ?? 'blue') === 'red' ? 'eastern' : 'western'
}

export function emptyLogbook(): Logbook {
  return {
    points: 0,
    missions: 0,
    kills: { air: 0, ground: 0, static: 0, naval: 0, friendly: 0 },
    ejections: 0,
    deaths: 0,
    medals: [],
    sorties: []
  }
}

export function rankFor(points: number, side: Side) {
  let index = 0
  for (const [candidate, rank] of RANKS.entries()) if (points >= rank.points) index = candidate
  const next = RANKS[index + 1]
  return {
    index,
    name: RANKS[index]![side],
    next: next ? { name: next[side], points: next.points } : undefined
  }
}

export function medalName(id: string, side: Side) {
  return MEDALS[id]?.[side] ?? id
}

function dcsCoalition(value: string | number | undefined) {
  if (value === 'red' || value === 1) return 'red'
  if (value === 'blue' || value === 2) return 'blue'
  return undefined
}

/** What the player's own aircraft destroyed, by category, and how the sortie ended for them. */
export function scoreClientSortie(params: {
  group: FlightGroup
  missionState: MissionState
  playerColor: 'red' | 'blue'
}) {
  const { group, missionState } = params
  const index = Math.max(
    0,
    group.aircrafts.findIndex((aircraft) => aircraft.client)
  )
  const aircraft = group.aircrafts[index]
  const unitName = aircraft?.unitName || `${group.callsign}-${index + 1}`
  const kills: Kills = { air: 0, ground: 0, static: 0, naval: 0, friendly: 0 }
  let points = 0

  for (const unit of missionState.lostUnits ?? []) {
    if (unit.name === unitName || unit.killerUnitName !== unitName) continue
    if (dcsCoalition(unit.coalition) === params.playerColor) {
      kills.friendly += 1
      points += POINTS.friendly
      continue
    }
    switch (unit.categoryName) {
      case 'plane':
        kills.air += 1
        points += POINTS.air
        break
      case 'helicopter':
        kills.air += 1
        points += POINTS.helicopter
        break
      case 'ship':
        kills.naval += 1
        points += POINTS.naval
        break
      case 'vehicle':
        kills.ground += 1
        points += POINTS.ground
        break
      default:
        kills.static += 1
        points += POINTS.static
    }
  }

  const own = (missionState.lostUnits ?? []).find((unit) => unit.name === unitName)
  const outcome: LogbookSortie['outcome'] = !own
    ? 'returned'
    : own.pilotEjected
      ? 'ejected'
      : own.pilotSurvivedCrash
        ? 'lost'
        : 'killed'
  if (outcome === 'ejected') points += POINTS.ejected
  if (outcome === 'killed') points += POINTS.killed

  return { kills, outcome, points, aircraft: aircraft?.aircraftName ?? 'unknown' }
}

function award(book: Logbook, id: string, at: Date) {
  if (ONCE.has(id) && book.medals.some((medal) => medal.id === id)) return false
  book.medals.push({ id, at, reason: MEDALS[id]?.reason ?? '' })
  return true
}

/**
 * Adds the debriefed client sorties to the logbook: points (the rating counts, from -5 for Poor
 * to +15 for Excellent, plus kills), medals and promotions. Returns lines for the debrief.
 */
export function recordLogbookSorties(
  draft: Campaign,
  sorties: Array<{ group: FlightGroup; rating: MissionRating }>,
  missionState: MissionState
) {
  if (sorties.length === 0) return []
  const book = (draft.logbook ??= emptyLogbook())
  const side = logbookSide(draft)
  const playerColor = (draft.playerSide ?? 'blue') === 'red' ? 'red' : 'blue'
  const rankBefore = rankFor(book.points, side).index
  const lines: string[] = []

  for (const { group, rating } of sorties) {
    const score = scoreClientSortie({ group, missionState, playerColor })
    const points = score.points + (rating.rating - 3) * 5 + 5
    book.points = Math.max(0, book.points + points)
    book.missions += 1
    for (const key of Object.keys(score.kills) as Array<keyof Kills>) {
      book.kills[key] += score.kills[key]
    }
    if (score.outcome === 'ejected') book.ejections += 1
    if (score.outcome === 'killed') book.deaths += 1
    book.sorties.push({
      at: draft.time,
      callsign: group.callsign,
      task: group.task,
      aircraft: score.aircraft,
      rating: rating.rating,
      points,
      kills: score.kills,
      outcome: score.outcome
    })
    lines.push(`${group.callsign}: ${points >= 0 ? '+' : ''}${points} points`)

    const earned: string[] = []
    if (rating.rating === 5) earned.push('excellent')
    if (score.kills.air >= 3) earned.push('triple')
    if (book.kills.air >= 5) earned.push('ace')
    if (score.outcome === 'ejected' || score.outcome === 'lost') earned.push('survivor')
    if (book.missions >= 25) earned.push('veteran')
    for (const id of earned) {
      if (award(book, id, draft.time)) lines.push(`Awarded the ${medalName(id, side)}`)
    }
  }
  if (book.sorties.length > MAX_SORTIES) book.sorties.splice(0, book.sorties.length - MAX_SORTIES)

  const rank = rankFor(book.points, side)
  if (rank.index > rankBefore) {
    lines.push(`Promoted to ${rank.name}`)
    logCampaignAction(draft, 'player', `Promoted to ${rank.name}`)
  }
  return lines
}

/** The campaign medal, once the war is won. */
export function recordCampaignVictory(draft: Campaign) {
  if (draft.status !== 'won' || !draft.logbook) return
  if (award(draft.logbook, 'victory', draft.time)) {
    logCampaignAction(
      draft,
      'player',
      `Awarded the ${medalName('victory', logbookSide(draft))} for winning the campaign`
    )
  }
}
