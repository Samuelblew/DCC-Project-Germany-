import { schemas } from '@dcc/contracts'
import type * as z from 'zod'

import { resolveSpawnContext } from './spawn/packages/common'
import { airDefenseRadars } from './intel'
import { coalitionMorale } from './morale'

type Campaign = z.infer<typeof schemas.campaign.campaign>
type Coalition = z.infer<typeof schemas.coalition>
type Theatre = z.infer<typeof schemas.theatre>
export type ForceSnapshot = NonNullable<Campaign['forceHistory']>[number]
export type SideStrength = ForceSnapshot['player']

/** One sample every six campaign hours; sixty days of war fit in the record. */
export const FORCE_SAMPLE_MS = 6 * 3_600_000
const MAX_SAMPLES = 240

export function sideStrength(
  campaign: Campaign,
  coalition: Coalition,
  theatre: Theatre
): SideStrength {
  const side = campaign.coalitions[coalition]
  return {
    ground: side.groundGroups.reduce(
      (sum, group) => sum + group.units.reduce((units, unit) => units + Math.max(0, unit.count), 0),
      0
    ),
    air: Object.values(side.airframes ?? {}).reduce((sum, stock) => sum + stock.total, 0),
    territory: side.objectiveIds.length + side.airdromeNames.length,
    airDefense: airDefenseRadars(campaign, coalition, theatre).filter((site) => site.kind === 'sam')
      .length,
    morale: Math.round(coalitionMorale(campaign, coalition))
  }
}

/** Records both sides' strength when the last sample is FORCE_SAMPLE_MS old (or missing). */
export function updateForceHistory(draft: Campaign) {
  const history = draft.forceHistory ?? []
  const last = history.at(-1)
  if (last && draft.time.getTime() - last.at.getTime() < FORCE_SAMPLE_MS) return
  const context = resolveSpawnContext(draft, 'player')
  if (!context) return

  history.push({
    at: draft.time,
    player: sideStrength(draft, 'player', context.theatre),
    opponent: sideStrength(draft, 'opponent', context.theatre)
  })
  if (history.length > MAX_SAMPLES) history.splice(0, history.length - MAX_SAMPLES)
  draft.forceHistory = history
}
