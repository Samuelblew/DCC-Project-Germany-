import { schemas } from '@dcc/contracts'
import * as z from 'zod'

type Campaign = z.infer<typeof schemas.campaign.campaign>
type Theatre = z.infer<typeof schemas.theatre>
type Coalition = z.infer<typeof schemas.coalition>

/** DCS type name of the MiG-29A Fulcrum module. */
export const FULCRUM_AIRCRAFT_NAME = 'MiG-29 Fulcrum'
/** Kneeboard / cockpit WAVE 1 is the player's home station. */
export const GCI_CHANNEL = 1
/** ED Mission Editor default GCI RANGE (metres). */
export const GCI_RANGE_METERS = 200_000
/**
 * How far apart stations are placed. The radar still covers GCI_RANGE_METERS;
 * using that same distance as the placement step left West Germany with two
 * vans and the Pact with a single van in West Berlin.
 */
export const GCI_STATION_SPACING_METERS = 95_000
/** DCS Activate GCI channels are 1–20; each side gets half. */
export const GCI_MAX_CHANNELS = 20
export const GCI_CHANNELS_PER_SIDE = 10
export const GCI_OPPONENT_CHANNEL_OFFSET = 10
/** Offset east of the airfield so the van is not on the runway. */
export const GCI_AIRFIELD_STANDOFF_METERS = 400
export const GCI_STATION_GROUP_NAME = 'GCI-KRU-1'

export type PlannedGciStation = {
  id: string
  channel: number
  coalition: Coalition
  airdromeName: string
  position: { x: number; y: number }
}

type AirdromeSite = { name: string; x: number; y: number }

export function gciStationId(coalition: Coalition, channel: number) {
  return coalition === 'player' ? `GCI-KRU-${channel}` : `GCI-KRU-OPP-${channel}`
}

export function campaignGciEnabled(campaign: Campaign) {
  return campaign.campaignParams?.ewr !== false
}

export function campaignHasFulcrum(campaign: Campaign) {
  const hasClient = campaign.coalitions.player.flightGroups.some((flightGroup) =>
    flightGroup.aircrafts.some(
      (aircraft) => aircraft.client && aircraft.aircraftName === FULCRUM_AIRCRAFT_NAME
    )
  )
  if (hasClient) return true
  return (
    campaign.career?.airframes.some(
      (airframe) =>
        airframe.aircraftName === FULCRUM_AIRCRAFT_NAME && airframe.status !== 'destroyed'
    ) === true
  )
}

/** Friendly KRU when GCI is on and the player has a Fulcrum. */
export function campaignShowsPlayerGci(campaign: Campaign) {
  return campaignGciEnabled(campaign) && campaignHasFulcrum(campaign)
}

/** Enemy GCI when the toggle is on: NATO if the player is red, Warsaw Pact if blue. */
export function campaignShowsOpponentGci(campaign: Campaign) {
  return campaignGciEnabled(campaign)
}

export function playerGciHomeBase(campaign: Campaign): string | undefined {
  const fulcrum = campaign.coalitions.player.flightGroups.find((flightGroup) =>
    flightGroup.aircrafts.some(
      (aircraft) => aircraft.client && aircraft.aircraftName === FULCRUM_AIRCRAFT_NAME
    )
  )
  if (fulcrum) return fulcrum.homeBase
  return campaign.career?.airframes.find(
    (airframe) => airframe.aircraftName === FULCRUM_AIRCRAFT_NAME && airframe.status !== 'destroyed'
  )?.location
}

export function playerGciStationPosition(
  campaign: Campaign,
  theatre: Theatre
): { x: number; y: number } | null {
  return planCampaignGciStations(campaign, theatre).player[0]?.position ?? null
}

export function planCampaignGciStations(
  campaign: Campaign,
  theatre: Theatre
): { player: PlannedGciStation[]; opponent: PlannedGciStation[] } {
  return {
    player: planGciStationsForAirdromes(theatre, campaign.coalitions.player.airdromeNames, {
      coalition: 'player',
      preferredAirdrome: playerGciHomeBase(campaign),
      channelOffset: 0
    }),
    opponent: planGciStationsForAirdromes(theatre, campaign.coalitions.opponent.airdromeNames, {
      coalition: 'opponent',
      channelOffset: GCI_OPPONENT_CHANNEL_OFFSET
    })
  }
}

/** @deprecated Use planCampaignGciStations. Friendly network over the named fields. */
export function planPlayerGciStations(
  theatre: Theatre,
  options: { preferredAirdrome?: string; airdromeNames?: string[] } = {}
): PlannedGciStation[] {
  const names = options.airdromeNames ?? Object.keys(theatre.airdromeDetails)
  return planGciStationsForAirdromes(theatre, names, {
    coalition: 'player',
    preferredAirdrome: options.preferredAirdrome,
    channelOffset: 0
  })
}

/**
 * One KRU about every 95 km on a coalition's airfields, up to ten a side.
 * WAVE 1–10 friendly, 11–20 enemy. Each station's radar range stays 200 km.
 * Mission generation still culls stations off the route corridor.
 */
export function planGciStationsForAirdromes(
  theatre: Theatre,
  airdromeNames: string[],
  options: {
    coalition: Coalition
    preferredAirdrome?: string
    channelOffset?: number
    maxStations?: number
  }
): PlannedGciStation[] {
  const names = new Set(airdromeNames)
  if (options.preferredAirdrome) names.add(options.preferredAirdrome)

  const airdromes = [...names].flatMap((name) => {
    const airdrome = theatre.airdromeDetails[name]
    return airdrome ? [{ name: airdrome.name, x: airdrome.x, y: airdrome.y }] : []
  })
  if (airdromes.length === 0) return []

  const selected: AirdromeSite[] = []
  const uncovered = new Set(airdromes)
  const maxStations = options.maxStations ?? GCI_CHANNELS_PER_SIDE
  const channelOffset = options.channelOffset ?? 0

  const pick = (site: AirdromeSite) => {
    selected.push(site)
    for (const candidate of [...uncovered]) {
      if (distance(site, candidate) <= GCI_STATION_SPACING_METERS) uncovered.delete(candidate)
    }
  }

  const home = options.preferredAirdrome
    ? airdromes.find((airdrome) => airdrome.name === options.preferredAirdrome)
    : undefined
  if (home) pick(home)

  while (uncovered.size > 0 && selected.length < maxStations) {
    let best: AirdromeSite | undefined
    let bestCount = -1
    for (const candidate of uncovered) {
      const count = countCovered(candidate, uncovered)
      if (
        count > bestCount ||
        (count === bestCount && best != null && candidate.name < best.name) ||
        (count === bestCount && best == null)
      ) {
        best = candidate
        bestCount = count
      }
    }
    if (best == null) break
    pick(best)
  }

  return selected.map((site, index) => {
    const channel = channelOffset + index + 1
    return {
      id: gciStationId(options.coalition, channel),
      channel,
      coalition: options.coalition,
      airdromeName: site.name,
      position: { x: site.x + GCI_AIRFIELD_STANDOFF_METERS, y: site.y }
    }
  })
}

function countCovered(site: AirdromeSite, uncovered: Set<AirdromeSite>) {
  let count = 0
  for (const candidate of uncovered) {
    if (distance(site, candidate) <= GCI_STATION_SPACING_METERS) count += 1
  }
  return count
}

function distance(left: { x: number; y: number }, right: { x: number; y: number }) {
  return Math.hypot(left.x - right.x, left.y - right.y)
}
