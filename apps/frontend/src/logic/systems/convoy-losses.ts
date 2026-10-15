import { CONVOY_GROUP_PREFIX, schemas } from '@dcc/contracts'
import * as z from 'zod'

import { logCampaignAction } from '@/logic/simulation-log'
import { convoySpeed, moveConvoys, placeConvoyAt, advanceConvoy } from './supply-convoys'

type Campaign = z.infer<typeof schemas.campaign.campaign>
type MissionState = z.infer<typeof schemas.missionState>
type Coalition = z.infer<typeof schemas.coalition>

const INTERDICTION_MS = 6 * 60 * 60 * 1000

/** The DCS group name of a campaign convoy. */
export function convoyGroupName(coalition: Coalition, convoyId: string) {
  return `${CONVOY_GROUP_PREFIX}${coalition}-${convoyId}`
}

/**
 * Brings convoys back from a flown mission: those DCS simulated take their reported position and
 * lose the cargo of every truck destroyed; those culled out of the mission drive on for the time
 * the mission lasted. Losses also mark the route as interdicted for a few campaign hours.
 */
export function applyConvoyMissionState(
  draft: Campaign,
  missionState: Pick<MissionState, 'lostUnits' | 'groupPositions'>,
  elapsedSeconds: number
) {
  const lossesByGroup = new Map<string, number>()
  for (const unit of missionState.lostUnits ?? []) {
    const groupName = unit.groupName
    if (!groupName?.startsWith(CONVOY_GROUP_PREFIX)) continue
    lossesByGroup.set(groupName, (lossesByGroup.get(groupName) ?? 0) + 1)
  }

  for (const coalition of ['player', 'opponent'] as const) {
    const convoys = draft.coalitions[coalition].supplyConvoys
    if (!convoys || convoys.length === 0) continue
    const side = coalition === 'player' ? 'blue' : 'red'
    const reported = new Map(
      [
        ...(missionState.groupPositions?.[side]?.ground ?? []),
        ...(missionState.groupPositions?.[side]?.aircraft ?? [])
      ]
        .filter((group) => group.name.startsWith(CONVOY_GROUP_PREFIX))
        .map((group) => [group.name, group])
    )
    const destroyed = new Set<string>()

    for (const convoy of convoys) {
      const groupName = convoyGroupName(coalition, convoy.id)
      const losses = lossesByGroup.get(groupName) ?? 0
      const group = reported.get(groupName)

      if (losses > 0) {
        const remaining = Math.max(0, convoy.vehicles - losses)
        const share = convoy.vehicles > 0 ? remaining / convoy.vehicles : 0
        convoy.cargo = {
          supply: convoy.cargo.supply * share,
          fuel: convoy.cargo.fuel * share,
          munitions: convoy.cargo.munitions * share,
          repair: convoy.cargo.repair * share
        }
        const route = draft.coalitions[coalition].supplyNodes?.[convoy.to]?.logistics?.routes.find(
          (entry) => entry.id === convoy.routeId
        )
        if (route) {
          route.disruption = Math.min(0.85, Math.max(route.disruption, 0.25 + 0.15 * losses))
          route.interdictedUntil = new Date(draft.time.getTime() + INTERDICTION_MS)
        }
        if (remaining === 0) {
          destroyed.add(convoy.id)
          logCampaignAction(
            draft,
            coalition,
            `Supply convoy ${convoy.from} → ${convoy.to} destroyed; its cargo is lost`
          )
          continue
        }
        convoy.vehicles = remaining
        logCampaignAction(
          draft,
          coalition,
          `Supply convoy ${convoy.from} → ${convoy.to} hit (${losses} lost); it carries on with ${remaining}`
        )
      }

      if (group) {
        placeConvoyAt(convoy, group)
        convoy.vehicles = Math.max(1, Math.min(convoy.vehicles, group.units.length || 1))
      } else if (losses === 0) {
        // Not in the mission: it kept driving off-screen while the mission was flown.
        advanceConvoy(convoy, convoySpeed(convoy) * elapsedSeconds)
      }
    }

    if (destroyed.size > 0) {
      draft.coalitions[coalition].supplyConvoys = convoys.filter(
        (convoy) => !destroyed.has(convoy.id)
      )
    }
    // Unload anything that reached its destination during the mission.
    moveConvoys(draft, coalition, 0)
  }
}
