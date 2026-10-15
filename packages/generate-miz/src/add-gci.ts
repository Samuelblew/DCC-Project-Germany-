import { schemas } from '@dcc/contracts'
import {
  campaignIadsEra,
  FULCRUM_AIRCRAFT_NAME,
  GCI_CHANNEL,
  GCI_RANGE_METERS,
  getGermanyIadsSites,
  isGermanyIadsTheatre,
  livingGermanyIadsSite,
  planCampaignGciStations,
  type PlannedGciStation
} from '@dcc/data'
import * as z from 'zod'

import { resolveAiSkill } from './ai-skill'
import type { MissionCullingPlan } from './mission-culling'

type Campaign = z.infer<typeof schemas.campaign.campaign>
type Mission = z.infer<typeof schemas.dcs.mission>
type Theatre = z.infer<typeof schemas.theatre>
type MissionCountry = NonNullable<Mission['coalition']['blue']['country']>[number]
type MissionVehicleGroup = NonNullable<NonNullable<MissionCountry['vehicle']>['group']>[number]

export { FULCRUM_AIRCRAFT_NAME, GCI_CHANNEL, GCI_RANGE_METERS }

/** DCS type of the Fulcrum KRU van (CoreMods/tech/TechWeaponPack GCI_station_MAZ.lua). */
export const GCI_STATION_TYPE = 'GCI_station_MiG29'
/** Station automatically links compatible radars inside this radius. */
export const GCI_RADAR_LINK_METERS = 250_000

/**
 * Search radars the KRU will pick up, using the DCS type names from the ED Fulcrum mini-update.
 * FPS-177 in that post is the FPS-117 family in DCS.
 *
 * P-14 and P-19 are on that list, but a van that only has one of them never gets a picture
 * the player can use. Vietnam escalation replaces 55G6, 1L13 and FPS-117 with the P-19, so
 * those early sets must not count as "the station already has a radar" or the fallback
 * dishes are never planted.
 */
export const GCI_COMPATIBLE_RADAR_TYPES = new Set([
  'P14_SR',
  'p-19 s-125 sr',
  'FPS-117',
  'FPS-117 Dome',
  '55G6 EWR',
  '1L13 EWR',
  'CHAP_IRISTSLM_STR',
  'Patriot str',
  'S-300PS 40B6MD sr',
  'S-300PS 40B6MD sr_19J6',
  'S-300PS 64H6E sr',
  'SA-11 Buk SR 9S18M1',
  'RLS_19J6'
])

const GCI_EARLY_SEARCH_RADAR_TYPES = new Set(['P14_SR', 'p-19 s-125 sr'])

function usefulGciRadar(type: string) {
  return GCI_COMPATIBLE_RADAR_TYPES.has(type) && !GCI_EARLY_SEARCH_RADAR_TYPES.has(type)
}

/**
 * In the live bubble the vans stay in the mission. Each one also keeps the nearest
 * search radar that can feed it, so the generator does not plant three reserve dishes
 * for a radar that still exists on the campaign map.
 */
export function gciPictureAnchors(campaign: Campaign, theatre: Theatre) {
  const sites = new Set<string>()
  const ewrs = new Set<string>()
  if (campaign.campaignParams?.worldMode !== 'bubble') return { sites, ewrs }
  if (campaign.campaignParams?.ewr === false) return { sites, ewrs }

  const planned = planCampaignGciStations(campaign, theatre)
  const stations = [
    ...(campaignHasFulcrumClient(campaign) ? planned.player : []),
    ...planned.opponent
  ]
  const germanySites = isGermanyIadsTheatre(theatre.name)
    ? getGermanyIadsSites(campaignIadsEra(campaign)).filter(
        (site) => site.kind === 'ewr' && livingGermanyIadsSite(site, campaign.germanyIadsDeadUnits)
      )
    : []

  for (const station of stations) {
    let bestSite: { id: string; distance: number } | undefined
    for (const site of germanySites) {
      if (site.coalition !== station.coalition) continue
      if (!site.units.some((unit) => usefulGciRadar(unit.type))) continue
      const distance = Math.hypot(site.x - station.position.x, site.y - station.position.y)
      if (distance > GCI_RADAR_LINK_METERS) continue
      if (!bestSite || distance < bestSite.distance) bestSite = { id: site.id, distance }
    }
    if (bestSite) {
      sites.add(bestSite.id)
      continue
    }

    let bestEwr: { id: string; distance: number } | undefined
    for (const ewr of campaign.coalitions[station.coalition].ewrGroups ?? []) {
      if (ewr.destroyed || !usefulGciRadar(ewr.type)) continue
      const distance = Math.hypot(
        ewr.position.x - station.position.x,
        ewr.position.y - station.position.y
      )
      if (distance > GCI_RADAR_LINK_METERS) continue
      if (!bestEwr || distance < bestEwr.distance) bestEwr = { id: ewr.id, distance }
    }
    if (bestEwr) ewrs.add(bestEwr.id)
  }

  return { sites, ewrs }
}

const NATO_COUNTRIES = new Set(['USA', 'UK', 'France', 'Germany', 'Israel', 'Argentina'])
const FALLBACK_RADAR_OFFSET_METERS = 25_000

export type PlayerGciStation = {
  groupName: string
  unitName: string
  unitId: number
  channel: number
  radius: number
  coalition: z.infer<typeof schemas.coalition>
  airdromeName: string
  position: { x: number; y: number }
}

type RadarContact = { x: number; y: number; type: string }

export function campaignHasFulcrumClient(campaign: Campaign) {
  return campaign.coalitions.player.flightGroups.some((flightGroup) =>
    flightGroup.aircrafts.some(
      (aircraft) => aircraft.client && aircraft.aircraftName === FULCRUM_AIRCRAFT_NAME
    )
  )
}

export function addPlayerGciStations(
  mission: Mission,
  campaign: Campaign,
  theatre: Theatre,
  cullingPlan?: MissionCullingPlan,
  options: { enabled?: boolean } = {}
): PlayerGciStation[] {
  if (options.enabled === false) return []

  const planned = planCampaignGciStations(campaign, theatre)
  const spawned: PlayerGciStation[] = []
  if (campaignHasFulcrumClient(campaign)) {
    spawned.push(...spawnNetwork(mission, campaign, 'player', planned.player, cullingPlan))
  }
  spawned.push(...spawnNetwork(mission, campaign, 'opponent', planned.opponent, cullingPlan))
  return spawned
}

function spawnNetwork(
  mission: Mission,
  campaign: Campaign,
  coalition: z.infer<typeof schemas.coalition>,
  stations: PlannedGciStation[],
  cullingPlan?: MissionCullingPlan
): PlayerGciStation[] {
  const country =
    coalition === 'player'
      ? mission.coalition.blue.country?.[0]
      : mission.coalition.red.country?.[0]
  if (!country || stations.length === 0) return []
  if (!country.vehicle) country.vehicle = { group: [] }

  const radars = collectCompatibleRadars(country)
  const liveBubble = campaign.campaignParams?.worldMode === 'bubble'
  const spawned: PlayerGciStation[] = []
  for (const station of stations) {
    if (
      !liveBubble &&
      cullingPlan?.getSamMode(station.id, station.position, GCI_RANGE_METERS) === 'omit'
    ) {
      continue
    }
    spawned.push(spawnGciStation(mission, country, campaign, station))
    if (countRadarsInRange(station.position, radars) === 0) {
      radars.push(...spawnFallbackRadars(mission, country, campaign, station))
    }
  }
  return spawned
}

/** @deprecated Use addPlayerGciStations. Kept for call sites that only need WAVE 1. */
export function addPlayerGciStation(
  mission: Mission,
  campaign: Campaign,
  theatre: Theatre,
  options: { enabled?: boolean } = {}
): PlayerGciStation | null {
  return addPlayerGciStations(mission, campaign, theatre, undefined, options)[0] ?? null
}

function collectCompatibleRadars(country: MissionCountry): RadarContact[] {
  const radars: RadarContact[] = []
  for (const group of country.vehicle?.group ?? []) {
    for (const unit of group.units ?? []) {
      if (!GCI_COMPATIBLE_RADAR_TYPES.has(unit.type)) continue
      if (GCI_EARLY_SEARCH_RADAR_TYPES.has(unit.type)) continue
      radars.push({ x: unit.x, y: unit.y, type: unit.type })
    }
  }
  return radars
}

function countRadarsInRange(position: { x: number; y: number }, radars: RadarContact[]) {
  return radars.filter((radar) => distance(position, radar) <= GCI_RADAR_LINK_METERS).length
}

function spawnGciStation(
  mission: Mission,
  country: MissionCountry,
  campaign: Campaign,
  station: PlannedGciStation
): PlayerGciStation {
  const groupId = nextId(mission)
  const unitId = nextId(mission)
  const groupName = station.id
  const unitName = `${station.id}-1`
  const skill = resolveAiSkill(campaign, station.coalition, 'High')

  country.vehicle!.group.push(
    gciVehicleGroup({
      groupId,
      groupName,
      unitId,
      unitName,
      type: GCI_STATION_TYPE,
      position: station.position,
      skill,
      task: activateGciTask(unitId, station.channel)
    })
  )

  return {
    groupName,
    unitName,
    unitId,
    channel: station.channel,
    radius: GCI_RANGE_METERS,
    coalition: station.coalition,
    airdromeName: station.airdromeName,
    position: station.position
  }
}

function spawnFallbackRadars(
  mission: Mission,
  country: MissionCountry,
  campaign: Campaign,
  station: PlannedGciStation
): RadarContact[] {
  const radarType = NATO_COUNTRIES.has(country.name) ? 'FPS-117' : '55G6 EWR'
  const skill = resolveAiSkill(campaign, station.coalition, 'High')
  const spawned: RadarContact[] = []
  for (let index = 0; index < 3; index++) {
    const heading = (index * 2 * Math.PI) / 3
    const position = {
      x: station.position.x + Math.cos(heading) * FALLBACK_RADAR_OFFSET_METERS,
      y: station.position.y + Math.sin(heading) * FALLBACK_RADAR_OFFSET_METERS
    }
    const groupId = nextId(mission)
    country.vehicle!.group.push(
      gciVehicleGroup({
        groupId,
        groupName: `GCI-EWR-${station.channel}-${index + 1}`,
        unitId: nextId(mission),
        unitName: `GCI-EWR-${station.channel}-${index + 1}-1`,
        type: radarType,
        position,
        skill
      })
    )
    spawned.push({ ...position, type: radarType })
  }
  return spawned
}

function gciVehicleGroup(params: {
  groupId: number
  groupName: string
  unitId: number
  unitName: string
  type: string
  position: { x: number; y: number }
  skill: string
  task?: ReturnType<typeof activateGciTask>
}): MissionVehicleGroup {
  const { x, y } = params.position
  return {
    groupId: params.groupId,
    name: params.groupName,
    units: [
      {
        unitId: params.unitId,
        name: params.unitName,
        x,
        y,
        type: params.type,
        heading: 0,
        skill: params.skill
      }
    ],
    x,
    y,
    hidden: false,
    start_time: 0,
    route: {
      points: [
        {
          alt: 0,
          alt_type: 'BARO',
          type: 'Turning Point',
          y,
          x,
          speed: 0,
          action: 'Off Road',
          ETA: 0,
          ETA_locked: true,
          speed_locked: true,
          formation_template: '',
          ...(params.task ? { task: params.task } : {})
        }
      ]
    }
  }
}

function activateGciTask(unitId: number, channel: number) {
  return {
    id: 'ComboTask',
    params: {
      tasks: [
        {
          enabled: true,
          auto: true,
          id: 'WrappedAction',
          number: 1,
          params: {
            action: {
              id: 'ActivateGCI',
              params: {
                channel,
                radius: GCI_RANGE_METERS,
                x: 0,
                y: 0,
                unitId
              }
            }
          }
        }
      ]
    }
  }
}

function nextId(mission: Mission) {
  mission.currentKey += 1
  return mission.currentKey
}

function distance(left: { x: number; y: number }, right: { x: number; y: number }) {
  return Math.hypot(left.x - right.x, left.y - right.y)
}
