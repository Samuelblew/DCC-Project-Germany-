import { schemas } from '@dcc/contracts'
import {
  FULCRUM_AIRCRAFT_NAME,
  GCI_CHANNEL,
  GCI_RANGE_METERS,
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
  const spawned: PlayerGciStation[] = []
  for (const station of stations) {
    if (cullingPlan?.getSamMode(station.id, station.position, GCI_RANGE_METERS) === 'omit') {
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
