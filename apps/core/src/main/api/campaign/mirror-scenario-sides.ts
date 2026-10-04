import { schemas } from '@dcc/contracts'
import * as z from 'zod'

type Scenario = z.infer<typeof schemas.scenario>

export function mirrorScenarioSides(scenario: Scenario): Scenario {
  const goal = scenario.opponentGoal
    ? { coalition: 'player' as const, objectiveIds: scenario.opponentGoal.objectiveIds }
    : scenario.goal
      ? {
          coalition:
            scenario.goal.coalition === 'player' ? ('opponent' as const) : ('player' as const),
          objectiveIds: scenario.goal.objectiveIds
        }
      : undefined

  return {
    ...scenario,
    briefing: scenario.opponentBriefing ?? scenario.briefing,
    defaultFactionIds: scenario.defaultFactionIds
      ? {
          player: scenario.defaultFactionIds.opponent,
          opponent: scenario.defaultFactionIds.player
        }
      : undefined,
    navalGroups: scenario.navalGroups
      ? {
          player: scenario.navalGroups.opponent ?? [],
          opponent: scenario.navalGroups.player ?? []
        }
      : undefined,
    goal,
    opponentGoal: undefined,
    start: {
      player: scenario.start.opponent,
      opponent: scenario.start.player
    }
  }
}
