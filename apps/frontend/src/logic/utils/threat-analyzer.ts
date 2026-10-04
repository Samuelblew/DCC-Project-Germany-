import { schemas } from '@dcc/contracts'
import {
  campaignIadsEra,
  germanyIadsControllingCoalition,
  germanyIadsOwnersFromObjectives,
  getGermanyIadsSites,
  getSamSitePosition,
  isGermanyIadsSamDestroyed,
  isGermanyIadsTheatre,
  isSamOperational,
  samTemplates
} from '@dcc/data'
import * as z from 'zod'
import { calculateDistance } from './calculate-distance'

type Campaign = z.infer<typeof schemas.campaign.campaign>
type Coalition = z.infer<typeof schemas.coalition>
type SupplyStatus = z.infer<typeof schemas.supplyStatus>

/**
 * Calculate SAM engagement range multiplier based on supply status
 */
function getSupplyRangeMultiplier(supplyStatus: SupplyStatus | undefined): number {
  if (!supplyStatus) return 1.0

  switch (supplyStatus) {
    case 'abundant':
    case 'adequate':
      return 1.0
    case 'low':
      return 0.75 // 25% reduction
    case 'critical':
      return 0.5 // 50% reduction
    case 'depleted':
      return 0 // SAMs offline
  }
}

export type ThreateningSam = {
  samGroup: z.infer<typeof schemas.campaign.campaignSamGroup>
  position: z.infer<typeof schemas.position>
  range: number
  distance: number
}

export function findThreateningSams(
  targetPosition: z.infer<typeof schemas.position>,
  enemySamGroups: z.infer<typeof schemas.campaign.campaignSamGroup>[],
  theatre: z.infer<typeof schemas.theatre>,
  campaign?: Campaign,
  coalition?: Coalition
): ThreateningSam[] {
  const threateningSams: ThreateningSam[] = []

  if (isGermanyIadsTheatre(theatre.name)) {
    const owners =
      campaign == null
        ? []
        : germanyIadsOwnersFromObjectives(
            theatre.objectives,
            campaign.coalitions.player.objectiveIds,
            campaign.coalitions.opponent.objectiveIds
          )
    for (const site of getGermanyIadsSites(campaignIadsEra(campaign ?? {}))) {
      if (site.kind !== 'sam' || site.range == null) continue
      if (isGermanyIadsSamDestroyed(site, campaign?.germanyIadsDeadUnits)) continue
      if (coalition && germanyIadsControllingCoalition(site, owners) !== coalition) continue
      const samPosition = { x: site.x, y: site.y }
      const distance = calculateDistance(targetPosition, samPosition)
      if (distance > site.range) continue
      threateningSams.push({
        samGroup: {
          id: site.id,
          type: site.campaignType ?? 'Hawk',
          objectiveId: site.objectiveId
        },
        position: samPosition,
        range: site.range,
        distance
      })
    }
  } else {
    for (const samGroup of enemySamGroups) {
      if (!isSamOperational(samGroup)) {
        continue
      }

      const samPosition = getSamSitePosition(theatre, samGroup.objectiveId)
      if (!samPosition) {
        continue
      }

      const samTemplate = samTemplates[samGroup.type]
      if (!samTemplate) {
        continue
      }

      let effectiveRange = samTemplate.range
      if (campaign && coalition) {
        const supplyNodes = campaign.coalitions[coalition].supplyNodes
        const supply = supplyNodes?.[samGroup.objectiveId]
        const multiplier = getSupplyRangeMultiplier(supply?.status)
        effectiveRange = samTemplate.range * multiplier
      }

      const distance = calculateDistance(targetPosition, samPosition)

      if (distance <= effectiveRange) {
        threateningSams.push({
          samGroup,
          position: samPosition,
          range: effectiveRange,
          distance
        })
      }
    }
  }

  // Sort by distance (closest first)
  threateningSams.sort((a, b) => a.distance - b.distance)

  return threateningSams
}

export function getClosestThreateningSam(
  targetPosition: z.infer<typeof schemas.position>,
  enemySamGroups: z.infer<typeof schemas.campaign.campaignSamGroup>[],
  theatre: z.infer<typeof schemas.theatre>,
  campaign?: Campaign,
  coalition?: Coalition
): ThreateningSam | null {
  const threateningSams = findThreateningSams(
    targetPosition,
    enemySamGroups,
    theatre,
    campaign,
    coalition
  )
  return threateningSams[0] ?? null
}
