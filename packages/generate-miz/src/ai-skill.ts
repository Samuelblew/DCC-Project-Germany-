import { schemas } from '@dcc/contracts'
import * as z from 'zod'

type Campaign = z.infer<typeof schemas.campaign.campaign>
type Coalition = z.infer<typeof schemas.coalition>

/**
 * The DCS skill for an AI unit: the campaign's enemy skill override for opponent units, otherwise
 * the unit's own default. `Random` is native to DCS, which rolls each unit at mission start.
 */
export function resolveAiSkill(campaign: Campaign, coalition: Coalition, fallback: string) {
  const enemySkill = campaign.campaignParams?.enemySkill
  return coalition === 'opponent' && enemySkill ? enemySkill : fallback
}
