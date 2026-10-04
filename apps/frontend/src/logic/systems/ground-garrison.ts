import { schemas } from '@dcc/contracts'
import { getGroundGroupUnitCount } from '@dcc/campaign'
import * as z from 'zod'

import { calculateDistance } from '@/logic/utils/calculate-distance'
import { getAirdromePosition } from './airport-capture'

type Campaign = z.infer<typeof schemas.campaign.campaign>
type Coalition = z.infer<typeof schemas.coalition>
type Theatre = z.infer<typeof schemas.theatre>

/** Ground groups this close to an objective defend it (and fight attackers that reach it). */
export const BATTLE_RADIUS = 5000 // meters

function getHoldingPosition(theatre: Theatre, objectiveId: string) {
  return (
    theatre.objectives.find((objective) => objective.name === objectiveId)?.position ??
    getAirdromePosition(theatre, objectiveId)
  )
}

/**
 * Whether another idle formation already holds the objective. A formation only leaves to attack when
 * one stays behind, so captured towns are not emptied the moment their garrison marches out.
 */
export function hasOtherGarrison(
  draft: Campaign,
  coalition: Coalition,
  theatre: Theatre,
  objectiveId: string,
  excludedGroupId?: string
): boolean {
  const holdingPosition = getHoldingPosition(theatre, objectiveId)
  return draft.coalitions[coalition].groundGroups.some(
    (group) =>
      group.id !== excludedGroupId &&
      group.state === 'idle' &&
      group.objectiveId === objectiveId &&
      getGroundGroupUnitCount(group) > 0 &&
      (!holdingPosition || calculateDistance(group.position, holdingPosition) <= BATTLE_RADIUS)
  )
}
