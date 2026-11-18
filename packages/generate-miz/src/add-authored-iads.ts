import { schemas } from '@dcc/contracts'
import {
  authoredIadsSamGroupName,
  type AuthoredIadsSite,
  authoredSiteFieldedBy,
  campaignIadsEra,
  getAuthoredIadsSites,
  hasAuthoredIads,
  iadsControllingCoalition,
  iadsOwnersFromObjectives,
  livingAuthoredIadsSite
} from '@dcc/data'
import * as z from 'zod'

import { gciPictureAnchors } from './add-gci'
import { resolveAiSkill } from './ai-skill'
import type { MissionCullingPlan } from './mission-culling'

type Mission = z.infer<typeof schemas.dcs.mission>
type Campaign = z.infer<typeof schemas.campaign.campaign>
type Theatre = z.infer<typeof schemas.theatre>

/** What the opponent's Skynet network needs from the authored sites placed in this mission. */
export type AuthoredIadsMissionResult = {
  commandCenters: string[]
  /** Opponent SAM groups placed; Skynet finds them by their `SAM-` group prefix. */
  opponentSamGroups: number
  /** Opponent search radars keep their template unit names, so Skynet adds them by name. */
  opponentEwrUnitNames: string[]
}

export function addAuthoredIads(
  mission: Mission,
  campaign: Campaign,
  theatre: Theatre,
  cullingPlan?: MissionCullingPlan
): AuthoredIadsMissionResult | null {
  if (!hasAuthoredIads(theatre.name)) return null

  // SAM batteries carry their range: long-range ones use the SAM band, everything else
  // (short-range air defence, radars, command posts) the ground band.
  const liveBubble = campaign.campaignParams?.worldMode === 'bubble'
  const residentRadars = gciPictureAnchors(campaign, theatre).sites
  const sites = getAuthoredIadsSites(theatre.name, campaignIadsEra(campaign)).filter((site) => {
    // Command posts stay in the mission. A GCI van keeps its nearest search radar.
    // The rest of the radars join the live bubble.
    if (liveBubble && (site.kind === 'hq' || residentRadars.has(site.id))) return true
    return (
      !cullingPlan ||
      cullingPlan.getSamMode(
        site.id,
        { x: site.x, y: site.y },
        site.kind === 'sam' ? site.range : undefined
      ) === 'full'
    )
  })
  const owners = iadsOwnersFromObjectives(
    theatre.objectives,
    campaign.coalitions.player.objectiveIds,
    campaign.coalitions.opponent.objectiveIds
  )
  const commandCenters: string[] = []
  const opponentEwrUnitNames: string[] = []
  let opponentSamGroups = 0

  for (const authored of sites) {
    const site = livingAuthoredIadsSite(authored, campaign.iadsDeadUnits)
    if (!site) continue
    const coalition = iadsControllingCoalition(site, owners)
    if (!authoredSiteFieldedBy(site, coalition)) continue
    const controlled = coalition === site.coalition ? site : { ...site, coalition }
    const country = countryFor(mission, controlled.coalition)
    if (!country) continue
    if (controlled.kind === 'hq' || controlled.kind === 'airbase') {
      addStaticSite(mission, country, controlled)
      if (controlled.kind === 'hq' && controlled.coalition === 'opponent') {
        commandCenters.push(...controlled.units.map((unit) => unit.name))
      }
      continue
    }
    addVehicleSite(
      mission,
      country,
      controlled,
      resolveAiSkill(campaign, controlled.coalition, 'High')
    )
    if (controlled.coalition !== 'opponent') continue
    if (controlled.kind === 'sam') opponentSamGroups += 1
    if (controlled.kind === 'ewr') {
      opponentEwrUnitNames.push(...controlled.units.map((unit) => unit.name))
    }
  }

  return { commandCenters, opponentSamGroups, opponentEwrUnitNames }
}

function countryFor(mission: Mission, coalition: AuthoredIadsSite['coalition']) {
  const key = coalition === 'player' ? 'blue' : 'red'
  return mission.coalition[key].country?.[0]
}

function nextId(mission: Mission) {
  mission.currentKey += 1
  return mission.currentKey
}

function addVehicleSite(
  mission: Mission,
  country: NonNullable<ReturnType<typeof countryFor>>,
  site: AuthoredIadsSite,
  skill: string
) {
  if (!country.vehicle) country.vehicle = { group: [] }
  const groupId = nextId(mission)
  const groupName =
    site.kind === 'ewr' && site.coalition === 'opponent'
      ? `IADS-EWR-${site.id}`
      : site.kind === 'sam'
        ? authoredIadsSamGroupName(site, site.coalition)
        : site.id
  const units = site.units.map((unit, index) => ({
    unitId: nextId(mission),
    name: unit.name || `${groupName}-${index + 1}`,
    x: unit.x,
    y: unit.y,
    type: unit.type,
    heading: unit.heading,
    skill
  }))
  const first = units[0]
  if (!first) return

  country.vehicle.group.push({
    groupId,
    name: groupName,
    units,
    x: first.x,
    y: first.y,
    hidden: false,
    start_time: 0,
    route: {
      points: [
        {
          alt: 0,
          alt_type: 'BARO',
          type: 'Turning Point',
          y: first.y,
          x: first.x,
          speed: 0,
          action: 'Off Road',
          ETA: 0,
          ETA_locked: true,
          speed_locked: true,
          formation_template: ''
        }
      ]
    }
  })
}

function addStaticSite(
  mission: Mission,
  country: NonNullable<ReturnType<typeof countryFor>>,
  site: AuthoredIadsSite
) {
  if (!country.static) country.static = { group: [] }
  const units = site.units.map((unit, index) => ({
    unitId: nextId(mission),
    name: unit.name || `${site.id}-${index + 1}`,
    x: unit.x,
    y: unit.y,
    type: unit.type,
    heading: unit.heading,
    category: unit.category ?? (site.kind === 'hq' ? 'Fortifications' : undefined)
  }))
  const first = units[0]
  if (!first) return

  country.static.group.push({
    groupId: nextId(mission),
    name: site.id,
    units,
    x: first.x,
    y: first.y,
    heading: first.heading,
    dead: false,
    hidden: false,
    route: {
      points: [
        {
          alt: 0,
          type: '',
          name: '',
          y: first.y,
          x: first.x,
          speed: 0,
          action: '',
          formation_template: ''
        }
      ]
    }
  })
}
