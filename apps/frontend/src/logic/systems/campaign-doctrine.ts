import type { schemas } from '@dcc/contracts'
import type * as z from 'zod'

type Campaign = z.infer<typeof schemas.campaign.campaign>

/** BMS ActionPrepTime: the army holds while the air war starts. */
export const GROUND_OFFENSIVE_DELAY_MS = 2 * 60 * 60 * 1000
/** Later shift onto factories and power plants. */
export const STRATEGIC_SHIFT_MS = 8 * 60 * 60 * 1000

const STRATEGIC_STRUCTURES = new Set(['Factory', 'Factory 2', 'Power Plant', 'Oil Platform'])

function doctrinePhase(draft: Campaign) {
  const now = draft.time.getTime()
  if (draft.groundOffensiveAt != null && now < draft.groundOffensiveAt) return 'air' as const
  if (draft.strategicStrikeAt != null && now < draft.strategicStrikeAt) return 'ground' as const
  if (draft.strategicStrikeAt != null) return 'strategic' as const
  return 'open' as const
}

export function groundOffensiveOpen(draft: Campaign) {
  return doctrinePhase(draft) !== 'air'
}

export function strategicTargetsOpen(draft: Campaign) {
  return doctrinePhase(draft) === 'strategic'
}

export function strikeStructuresForDoctrine<T extends { type: string }>(
  draft: Campaign,
  structures: T[]
) {
  const phase = doctrinePhase(draft)
  if (phase === 'air') {
    return structures.filter((structure) => structure.type === 'Command Center')
  }
  if (phase === 'ground') {
    return structures.filter((structure) => !STRATEGIC_STRUCTURES.has(structure.type))
  }
  if (phase === 'strategic') {
    const strategic = structures.filter((structure) => STRATEGIC_STRUCTURES.has(structure.type))
    return strategic.length > 0 ? strategic : structures
  }
  return structures
}

export function doctrineStrikePriorityBoost(draft: Campaign, structureType: string) {
  if (!groundOffensiveOpen(draft) && structureType === 'Command Center') return 20
  if (strategicTargetsOpen(draft) && STRATEGIC_STRUCTURES.has(structureType)) return 12
  return 0
}
