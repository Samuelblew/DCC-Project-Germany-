import { schemas } from '@dcc/contracts'
import { scenarios, theatres } from '@dcc/data'
import { produce } from 'immer'
import type * as z from 'zod'

import { settleCareerSortie } from './career'

type Campaign = z.infer<typeof schemas.campaign.campaign>
type MissionState = z.infer<typeof schemas.missionState>

/** Settles the career sortie of a flown mission, returning the campaign and the debrief lines. */
export function applyCareerMission(
  campaign: Campaign,
  missionState: MissionState,
  options: { taskCompleted: boolean }
): { campaign: Campaign; lines: string[] } {
  if (!campaign.career?.sortie) return { campaign, lines: [] }
  const scenario = scenarios.find((entry) => entry.id === campaign.scenarioId)
  const theatre = theatres.find((entry) => entry.name === scenario?.theatreName)
  if (!theatre) return { campaign, lines: [] }

  let lines: string[] = []
  const next = produce(campaign, (draft) => {
    lines = settleCareerSortie(draft, missionState, theatre, options)
  })
  return { campaign: next, lines }
}
