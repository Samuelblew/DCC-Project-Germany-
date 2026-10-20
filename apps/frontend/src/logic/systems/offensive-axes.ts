import { landNeighbors } from '@dcc/campaign'
import { campaignIadsEra, coalitionOperationProfile, maxOffensiveAxes, scenarios } from '@dcc/data'
import type { schemas } from '@dcc/contracts'
import type * as z from 'zod'

import { calculateDistance } from '@/logic/utils/calculate-distance'
import { getAirdromePosition } from './airport-capture'
import { activeRoadCutKeys } from './road-cuts'
import { groundOffensiveOpen } from './campaign-doctrine'

type Campaign = z.infer<typeof schemas.campaign.campaign>
type Coalition = z.infer<typeof schemas.coalition>
type Theatre = z.infer<typeof schemas.theatre>
type Position = { x: number; y: number }

/** Towns this side is already marching on or fighting for. */
export function activeOffensiveAxes(draft: Campaign, coalition: Coalition) {
  const axes = new Set<string>()
  for (const group of draft.coalitions[coalition].groundGroups) {
    if (group.state !== 'moving' && group.state !== 'combat') continue
    const target = group.targetObjectiveId ?? group.targetAirdromeName
    if (target) axes.add(target)
  }
  return axes
}

function namedPosition(theatre: Theatre, name: string): Position | undefined {
  return (
    theatre.objectives.find((objective) => objective.name === name)?.position ??
    getAirdromePosition(theatre, name)
  )
}

/** Where this side is trying to arrive. The main attack is the border hop closest to that place. */
function goalPositions(draft: Campaign, theatre: Theatre, coalition: Coalition): Position[] {
  const scenario = scenarios.find((entry) => entry.id === draft.scenarioId)
  const ids =
    coalition === 'player'
      ? (draft.goal?.objectiveIds ?? scenario?.goal?.objectiveIds ?? [])
      : (scenario?.opponentGoal?.objectiveIds ?? [])
  return ids
    .map((id) => namedPosition(theatre, id))
    .filter((position): position is Position => position != null)
}

function nearestGoalDistance(position: Position, goals: Position[]) {
  if (goals.length === 0) return 0
  return Math.min(...goals.map((goal) => calculateDistance(position, goal)))
}

/**
 * Enemy towns this side should march on, best first.
 * Best means the enemy town closest to the objective that wins the campaign,
 * so both sides meet on that road instead of wandering off along the first garrison in the list.
 */
export function preferredAssaultTargets(draft: Campaign, coalition: Coalition, theatre: Theatre) {
  const enemy: Coalition = coalition === 'player' ? 'opponent' : 'player'
  const enemyObjectives = new Set(draft.coalitions[enemy].objectiveIds)
  const enemyAirdromes = new Set(draft.coalitions[enemy].airdromeNames)
  const owned = new Set([
    ...draft.coalitions[coalition].objectiveIds,
    ...draft.coalitions[coalition].airdromeNames
  ])
  const goals = goalPositions(draft, theatre, coalition)
  const closed = activeRoadCutKeys(draft)
  const hops: Array<{ name: string; score: number }> = []

  for (const from of owned) {
    for (const neighbor of landNeighbors(theatre, from, closed)) {
      const hostile =
        enemyAirdromes.has(neighbor.objectiveId) || enemyObjectives.has(neighbor.objectiveId)
      if (!hostile) continue
      const position = namedPosition(theatre, neighbor.objectiveId)
      if (!position) continue
      const score = nearestGoalDistance(position, goals)
      const existing = hops.find((hop) => hop.name === neighbor.objectiveId)
      if (!existing || score < existing.score) {
        if (existing) existing.score = score
        else hops.push({ name: neighbor.objectiveId, score })
      }
    }
  }

  hops.sort((left, right) => left.score - right.score)
  const profile = coalitionOperationProfile(draft, coalition)
  const max = maxOffensiveAxes(campaignIadsEra(draft), profile.archetype)
  return hops.slice(0, Math.max(1, max)).map((hop) => hop.name)
}

/** Reinforce an axis already open. A new one has to be one of the preferred hops, and under the cap. */
export function mayOpenOffensiveAxis(
  draft: Campaign,
  coalition: Coalition,
  targetName: string,
  theatre?: Theatre
) {
  const axes = activeOffensiveAxes(draft, coalition)
  if (axes.has(targetName)) return true
  if (!groundOffensiveOpen(draft)) return false
  const profile = coalitionOperationProfile(draft, coalition)
  const max = maxOffensiveAxes(campaignIadsEra(draft), profile.archetype)
  if (axes.size >= max) return false
  if (!theatre || !(theatre.connections ?? []).some((connection) => connection.mode !== 'sea')) {
    return true
  }
  const preferred = preferredAssaultTargets(draft, coalition, theatre)
  if (preferred.length === 0) return true
  if (preferred.includes(targetName)) return true
  // The preferred hops are a priority, not the only door. If no free formation of this side
  // borders one of them (their neighbours hold only their last garrison), the rest of the army
  // waited forever for an attack nobody could start, and the front never moved.
  return !canReachPreferredHop(draft, coalition, theatre, preferred)
}

/** Whether some idle formation sits next to one of the preferred hops and could march on it. */
function canReachPreferredHop(
  draft: Campaign,
  coalition: Coalition,
  theatre: Theatre,
  preferred: string[]
) {
  const closed = activeRoadCutKeys(draft)
  const wanted = new Set(preferred)
  const groups = draft.coalitions[coalition].groundGroups
  return groups.some((group) => {
    if (group.state !== 'idle' || !group.objectiveId) return false
    const sharesTown = groups.some(
      (other) =>
        other.id !== group.id && other.objectiveId === group.objectiveId && other.state === 'idle'
    )
    if (!sharesTown) return false
    return landNeighbors(theatre, group.objectiveId, closed).some((neighbor) =>
      wanted.has(neighbor.objectiveId)
    )
  })
}
