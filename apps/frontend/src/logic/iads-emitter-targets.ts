import { schemas } from '@dcc/contracts'
import {
  campaignIadsEra,
  iadsOwnersFromObjectives,
  getSamSitePosition,
  hasAuthoredIads,
  livingAuthoredIadsSite,
  isSamFullyDestroyed,
  isSamOperational,
  selectAuthoredIadsBattleSites
} from '@dcc/data'
import * as z from 'zod'

type Campaign = z.infer<typeof schemas.campaign.campaign>
type Coalition = z.infer<typeof schemas.coalition>
type Theatre = z.infer<typeof schemas.theatre>

export const EWR_ATTACK_RANGE_METERS = 100_000

export type IadsEmitterTarget = {
  target: {
    id: string
    type: string
    objectiveId: string
  }
  position: z.infer<typeof schemas.position>
  operational: boolean
}

export function getIadsEmitterTargets(
  campaign: Campaign,
  coalition: Coalition,
  theatre: Theatre,
  task: 'SEAD' | 'DEAD'
): IadsEmitterTarget[] {
  const coalitionData = campaign.coalitions[coalition]
  if (hasAuthoredIads(theatre.name)) {
    return selectAuthoredIadsBattleSites(
      theatre.name,
      coalition,
      theatre.objectives
        .filter((objective) => objective.type === 'Airport')
        .map((objective) => objective.position),
      campaignIadsEra(campaign),
      iadsOwnersFromObjectives(
        theatre.objectives,
        campaign.coalitions.player.objectiveIds,
        campaign.coalitions.opponent.objectiveIds
      )
    )
      .filter((site) => livingAuthoredIadsSite(site, campaign.iadsDeadUnits))
      .map((site) => ({
        target: {
          id: site.id,
          type: site.campaignType ?? site.units[0]?.type ?? site.id,
          objectiveId: site.objectiveId
        },
        position: { x: site.x, y: site.y },
        operational: true
      }))
  }
  const samTargets = coalitionData.samGroups.flatMap((sam) => {
    const eligible = task === 'DEAD' ? !isSamFullyDestroyed(sam) : isSamOperational(sam)
    if (!eligible) return []
    const position = getSamSitePosition(theatre, sam.objectiveId)
    if (!position) return []
    return [
      {
        target: { id: sam.id, type: sam.type, objectiveId: sam.objectiveId },
        position,
        operational: isSamOperational(sam)
      }
    ]
  })
  const ewrTargets = (coalitionData.ewrGroups ?? []).flatMap((ewr) => {
    const operational = !ewr.destroyed && !ewr.suppressed && !ewr.jammed
    const eligible = task === 'DEAD' ? !ewr.destroyed : operational
    if (!eligible) return []
    return [
      {
        target: { id: ewr.id, type: ewr.type, objectiveId: ewr.objectiveId },
        position: ewr.position,
        operational
      }
    ]
  })

  return [...samTargets, ...ewrTargets]
}
