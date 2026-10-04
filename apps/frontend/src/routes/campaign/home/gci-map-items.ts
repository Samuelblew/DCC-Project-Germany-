import { schemas } from '@dcc/contracts'
import { campaignGciEnabled, GCI_RANGE_METERS, planCampaignGciStations } from '@dcc/data'
import * as z from 'zod'

import { tryDcsPositionToLngLat } from '@/logic/dcs-coordinates'

type Campaign = z.infer<typeof schemas.campaign.campaign>
type Theatre = z.infer<typeof schemas.theatre>

export function createGciMapItems(
  campaign: Campaign,
  theatre: Theatre
): z.infer<typeof schemas.GciMapItem>[] {
  if (!campaignGciEnabled(campaign)) return []
  const planned = planCampaignGciStations(campaign, theatre)
  const stations = [...planned.player, ...planned.opponent]

  return stations.flatMap((station) => {
    const position = tryDcsPositionToLngLat(theatre.name, station.position.x, station.position.y)
    if (!position) return []
    return [
      {
        id: station.id,
        type: 'GCI' as const,
        name: `GCI ${station.airdromeName}`,
        coalition: station.coalition,
        objectiveId: station.airdromeName,
        channel: station.channel,
        range: GCI_RANGE_METERS,
        active: true,
        position
      }
    ]
  })
}
