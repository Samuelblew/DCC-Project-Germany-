import { schemas } from '@dcc/contracts'
import { scenarios } from '@dcc/data'
import * as z from 'zod'

import { logCampaignAction } from '@/logic/simulation-log'

type Campaign = z.infer<typeof schemas.campaign.campaign>
type CampaignGoal = NonNullable<Campaign['goal']>

/**
 * The goal that makes the player lose, for scenarios written as a race (Fulda Gap: NATO takes
 * Leipzig, the Pact takes Frankfurt). Derived from the scenario so existing campaigns get it too;
 * on the red side the AI plays blue and races for the scenario's own goal.
 */
function getOpponentGoal(draft: Campaign): CampaignGoal | undefined {
  const scenario = scenarios.find((entry) => entry.id === draft.scenarioId)
  if (!scenario?.opponentGoal) return undefined
  const objectiveIds =
    draft.playerSide === 'red' ? scenario.goal?.objectiveIds : scenario.opponentGoal.objectiveIds
  return objectiveIds?.length ? { coalition: 'opponent', objectiveIds } : undefined
}

function hasReachedGoal(draft: Campaign, goal: CampaignGoal) {
  const controlledObjectiveIds = new Set(draft.coalitions[goal.coalition].objectiveIds)
  return goal.objectiveIds.every((objectiveId) => controlledObjectiveIds.has(objectiveId))
}

export function updateCampaignGoal(draft: Campaign): void {
  if ((draft.status ?? 'active') !== 'active') return

  const goals = [draft.goal, getOpponentGoal(draft)].filter(
    (goal): goal is CampaignGoal => goal != null
  )
  const reached = goals.find((goal) => hasReachedGoal(draft, goal))
  if (!reached) return

  draft.status = reached.coalition === 'player' ? 'won' : 'lost'
  logCampaignAction(
    draft,
    reached.coalition,
    `Campaign ${draft.status}: ${reached.coalition} controls ${reached.objectiveIds.join(', ')}`
  )
}
