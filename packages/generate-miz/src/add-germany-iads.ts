import { schemas } from '@dcc/contracts'
import {
  campaignIadsEra,
  germanyIadsControllingCoalition,
  germanyIadsOwnersFromObjectives,
  germanyIadsSamGroupName,
  type GermanyIadsSite,
  getGermanyIadsSites,
  isGermanyIadsTheatre,
  livingGermanyIadsSite
} from '@dcc/data'
import * as z from 'zod'

import { gciPictureAnchors } from './add-gci'
import { resolveAiSkill } from './ai-skill'
import type { MissionCullingPlan } from './mission-culling'

type Mission = z.infer<typeof schemas.dcs.mission>
type Campaign = z.infer<typeof schemas.campaign.campaign>
type Theatre = z.infer<typeof schemas.theatre>

export function addGermanyIads(
  mission: Mission,
  campaign: Campaign,
  theatre: Theatre,
  cullingPlan?: MissionCullingPlan
): { commandCenters: string[] } | null {
  if (!isGermanyIadsTheatre(theatre.name)) return null

  // SAM batteries carry their range: long-range ones use the SAM band, everything else
  // (short-range air defence, radars, command posts) the ground band.
  const liveBubble = campaign.campaignParams?.worldMode === 'bubble'
  const residentRadars = gciPictureAnchors(campaign, theatre).sites
  const sites = getGermanyIadsSites(campaignIadsEra(campaign)).filter((site) => {
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
  const owners = germanyIadsOwnersFromObjectives(
    theatre.objectives,
    campaign.coalitions.player.objectiveIds,
    campaign.coalitions.opponent.objectiveIds
  )
  const commandCenters: string[] = []

  for (const authored of sites) {
    const site = livingGermanyIadsSite(authored, campaign.germanyIadsDeadUnits)
    if (!site) continue
    const coalition = germanyIadsControllingCoalition(site, owners)
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
  }

  return { commandCenters }
}

function countryFor(mission: Mission, coalition: GermanyIadsSite['coalition']) {
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
  site: GermanyIadsSite,
  skill: string
) {
  if (!country.vehicle) country.vehicle = { group: [] }
  const groupId = nextId(mission)
  const groupName =
    site.kind === 'ewr' && site.coalition === 'opponent'
      ? `IADS-EWR-${site.id}`
      : site.kind === 'sam'
        ? germanyIadsSamGroupName(site, site.coalition)
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
  site: GermanyIadsSite
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
