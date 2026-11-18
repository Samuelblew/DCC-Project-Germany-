import { schemas } from '@dcc/contracts'
import * as z from 'zod'

import { HMS_INVINCIBLE_UNIT_TYPE, LHA_TARAWA_UNIT_TYPE } from './carrier-operations'
import {
  assignDeploymentSite,
  expandGroundGroupUnits,
  getDeploymentSites
} from './ground-deployment'

type Campaign = z.infer<typeof schemas.campaign.campaign>
type Theatre = z.infer<typeof schemas.theatre>
type GroundGroup = z.infer<typeof schemas.groundGroup>

export type FalklandsReadiness = {
  ready: boolean
  reasons: string[]
  reservedSiteIds: string[]
  goals: Array<{
    id: 'carrier' | 'transport' | 'escort' | 'surface-threats' | 'sam-network' | 'radars'
    label: string
    complete: boolean
  }>
}

export type FalklandsCampaignEvent = {
  kind: 'phase' | 'landing' | 'victory' | 'defeat'
  message: string
}

const LANDING_DURATION_MS = 30 * 60 * 1_000
export const SAN_CARLOS_AMPHIBIOUS_ANCHORAGE = { x: 104_255, y: 4_299 } as const
export const SAN_CARLOS_FARP_ID = 'uk-san-carlos-farp'
const SAN_CARLOS_APPROACH_HEADING = Math.PI / 4
const ARGENTINE_SURFACE_GROUP_UNIT_TYPES = [
  'leander-gun-achilles',
  'leander-gun-andromeda',
  'leander-gun-ariadne'
] as const
const ARGENTINE_SURFACE_GROUP_PATROL = {
  pattern: 'circle',
  radius: 2_500,
  speed: 3
} as const
const BEACHHEAD_OBJECTIVES = new Set(['San Carlos', 'Port San Carlos'])
const LEGACY_NAVAL_STARTS = [
  {
    coalition: 'player',
    id: 'uk-carrier-group',
    from: { x: 104_408, y: 133_773 },
    to: { x: 87_610, y: 184_267 },
    heading: (270 * Math.PI) / 180
  },
  {
    coalition: 'player',
    id: 'uk-carrier-group',
    from: { x: 80_000, y: 185_000 },
    to: { x: 87_610, y: 184_267 },
    heading: (270 * Math.PI) / 180
  },
  {
    coalition: 'player',
    id: 'uk-carrier-group',
    from: { x: 87_402, y: 206_382 },
    to: { x: 87_610, y: 184_267 },
    heading: (270 * Math.PI) / 180
  },
  {
    coalition: 'player',
    id: 'uk-carrier-group',
    from: { x: 87_513, y: 196_016 },
    to: { x: 87_610, y: 184_267 },
    heading: (270 * Math.PI) / 180
  },
  {
    coalition: 'player',
    id: 'uk-escort-group',
    from: { x: 98_824, y: 126_862 },
    to: { x: 82_610, y: 190_267 },
    heading: (270 * Math.PI) / 180
  },
  {
    coalition: 'player',
    id: 'uk-escort-group',
    from: { x: 74_416, y: 178_089 },
    to: { x: 82_610, y: 190_267 },
    heading: (270 * Math.PI) / 180
  },
  {
    coalition: 'player',
    id: 'uk-escort-group',
    from: { x: 70_830, y: 195_856 },
    to: { x: 82_610, y: 190_267 },
    heading: (270 * Math.PI) / 180
  },
  {
    coalition: 'player',
    id: 'uk-amphibious-group',
    from: { x: 105_469, y: -4_993 },
    to: { x: 332_376, y: 147_640 },
    heading: (210 * Math.PI) / 180
  },
  {
    coalition: 'player',
    id: 'uk-amphibious-group',
    from: { x: 387_841, y: 184_211 },
    to: { x: 332_376, y: 147_640 },
    heading: (210 * Math.PI) / 180
  },
  {
    coalition: 'opponent',
    id: 'arg-surface-group',
    from: { x: 10_000, y: -150_000 },
    to: { x: 331_295, y: 39_031 },
    heading: (135 * Math.PI) / 180
  }
] as const
const FALKLANDS_SAM_NETWORK = [
  { id: 'arg-goose-green-roland', type: 'Roland', objectiveId: 'Goose Green' },
  { id: 'arg-stanley-airport-hawk', type: 'Hawk', objectiveId: 'Stanley Airport' },
  {
    id: 'arg-evelyn-station-farm-hawk',
    type: 'Hawk',
    objectiveId: 'Evelyn Station Farm'
  },
  { id: 'arg-fox-bay-hawk', type: 'Hawk', objectiveId: 'Fox Bay' }
] as const
const FALKLANDS_SAM_OBJECTIVES = new Set<string>(
  FALKLANDS_SAM_NETWORK.map((battery) => battery.objectiveId)
)

function isNavalRoleOperational(campaign: Campaign, role: 'carrier' | 'escort' | 'transport') {
  return (campaign.coalitions.player.navalGroups ?? []).some(
    (group) => group.role === role && group.state !== 'sunk' && group.damage < 0.75
  )
}

function hostileWarshipProgress(campaign: Campaign) {
  const groups = (campaign.coalitions.opponent.navalGroups ?? []).filter(
    (group) => group.role === 'surface-combatant' || group.role === 'carrier'
  )
  const ships = groups.flatMap((group) =>
    group.units?.length
      ? group.units.map((unit) => unit.state === 'sunk' || unit.damage >= 1)
      : group.unitTypes.map(() => group.state === 'sunk' || group.damage >= 0.75)
  )
  const destroyed = ships.filter(Boolean).length

  return { complete: destroyed === ships.length, destroyed, total: ships.length }
}

function falklandsSamBatteries(campaign: Campaign) {
  return campaign.coalitions.opponent.samGroups.filter((group) =>
    FALKLANDS_SAM_OBJECTIVES.has(group.objectiveId)
  )
}

function ewrProgress(campaign: Campaign) {
  const ewrs = campaign.coalitions.opponent.ewrGroups ?? []
  const destroyed = ewrs.filter((ewr) => ewr.destroyed).length

  return { complete: destroyed === ewrs.length, destroyed, total: ewrs.length }
}

export function getSanCarlosLandingReadiness(
  campaign: Campaign,
  theatre: Theatre
): FalklandsReadiness {
  const reasons: string[] = []
  const carrierOperational = isNavalRoleOperational(campaign, 'carrier')
  const transportOperational = isNavalRoleOperational(campaign, 'transport')
  const escortOperational = isNavalRoleOperational(campaign, 'escort')
  const warships = hostileWarshipProgress(campaign)
  const surfaceThreatsSuppressed = warships.complete
  const ewrs = ewrProgress(campaign)
  const localRadarsSuppressed = ewrs.complete

  if (!carrierOperational) reasons.push('Carrier capability is unavailable')
  if (!transportOperational) reasons.push('Amphibious lift is unavailable')
  if (!escortOperational) reasons.push('Escort screen is unavailable')
  if (!surfaceThreatsSuppressed) reasons.push('Hostile surface forces remain operational')
  const samBatteries = falklandsSamBatteries(campaign)
  const remainingSamBatteries = samBatteries.filter((group) => !group.destroyed)
  const destroyedSamBatteries = samBatteries.length - remainingSamBatteries.length
  if (remainingSamBatteries.length > 0) {
    reasons.push(
      `The Falklands SAM network has not been destroyed (${remainingSamBatteries.length} ${remainingSamBatteries.length === 1 ? 'battery' : 'batteries'} remaining)`
    )
  }
  if (!localRadarsSuppressed) reasons.push('Local EWR remain operational')

  const occupiedSiteIds = new Set(
    Object.values(campaign.coalitions).flatMap((coalition) =>
      coalition.groundGroups.flatMap((group) => (group.deployment ? [group.deployment.siteId] : []))
    )
  )
  const sites = getDeploymentSites(theatre)
    .filter(
      (site) =>
        BEACHHEAD_OBJECTIVES.has(site.objectiveId) &&
        site.validationStatus !== 'candidate' &&
        !occupiedSiteIds.has(site.id) &&
        site.slots.length >= 4
    )
    .sort((left, right) => left.id.localeCompare(right.id))
  const supports = (
    site: (typeof sites)[number],
    kind: 'vehicle' | 'artillery' | 'air-defense' | 'infantry',
    count: number
  ) =>
    site.slots.length >= count &&
    site.slots.slice(0, count).every((slot) => slot.allowedUnitKinds.includes(kind))
  const infantry = sites.find(
    (site) =>
      site.objectiveId === 'Port San Carlos' &&
      !site.id.startsWith('recovery-') &&
      site.roles.includes('infantry') &&
      supports(site, 'infantry', 8)
  )
  const vehicle = sites.find(
    (site) =>
      site.objectiveId === 'San Carlos' &&
      !site.id.startsWith('recovery-') &&
      site.id !== infantry?.id &&
      site.roles.includes('vehicle') &&
      supports(site, 'vehicle', 4)
  )
  const airDefense = sites.find(
    (site) =>
      site.objectiveId === 'San Carlos' &&
      site.id !== infantry?.id &&
      site.id !== vehicle?.id &&
      site.roles.includes('air-defense') &&
      supports(site, 'air-defense', 4)
  )
  const farp = sites.find(
    (site) =>
      site.objectiveId === 'San Carlos' &&
      site.id.startsWith('recovery-') &&
      site.roles.includes('recovery')
  )
  const reservedSiteIds = [infantry?.id, vehicle?.id, airDefense?.id, farp?.id].filter(
    (siteId): siteId is string => siteId != null
  )
  const sitesReady = reservedSiteIds.length === 4
  if (!sitesReady)
    reasons.push('Four approved San Carlos beachhead sites are required, including a FARP site')

  return {
    ready: reasons.length === 0,
    reasons,
    reservedSiteIds,
    goals: [
      { id: 'carrier', label: 'Keep carrier capability operational', complete: carrierOperational },
      {
        id: 'transport',
        label: 'Keep amphibious lift operational',
        complete: transportOperational
      },
      { id: 'escort', label: 'Keep the escort screen operational', complete: escortOperational },
      {
        id: 'surface-threats',
        label: `Destroy enemy warships (${warships.destroyed}/${warships.total})`,
        complete: surfaceThreatsSuppressed
      },
      {
        id: 'sam-network',
        label: `Destroy the Falklands SAM network (${destroyedSamBatteries}/${samBatteries.length})`,
        complete: remainingSamBatteries.length === 0
      },
      {
        id: 'radars',
        label: `Destroy all local EWR (${ewrs.destroyed}/${ewrs.total})`,
        complete: localRadarsSuppressed
      }
    ]
  }
}

function landingFormation(
  id: string,
  objectiveId: string,
  unitName: string,
  count: number,
  authorizedTemplateId: string
): GroundGroup {
  return {
    id,
    objectiveId,
    position: { x: 0, y: 0 },
    state: 'idle',
    authorizedTemplateId,
    units: [{ name: unitName, count }]
  }
}

function deployArgentineLandingDefenders(campaign: Campaign, theatre: Theatre) {
  const opponent = campaign.coalitions.opponent
  const reservedSiteIds = new Set(campaign.landingOperation?.reservedSiteIds ?? [])
  const availableSiteIds = (
    objectiveId: string,
    roles: Array<'air-defense' | 'reserve'>,
    kind: 'air-defense' | 'infantry',
    count: number
  ) =>
    new Set(
      getDeploymentSites(theatre)
        .filter(
          (site) =>
            site.objectiveId === objectiveId &&
            site.validationStatus !== 'candidate' &&
            !reservedSiteIds.has(site.id) &&
            roles.some((role) => site.roles.includes(role)) &&
            site.slots.length >= count &&
            site.slots.slice(0, count).every((slot) => slot.allowedUnitKinds.includes(kind))
        )
        .map((site) => site.id)
    )

  const formations = [
    {
      group: landingFormation(
        'arg-port-san-carlos-infantry',
        'Port San Carlos',
        'Infantry AK',
        8,
        'arg-landing-infantry'
      ),
      roles: ['reserve'] as const,
      siteIds: availableSiteIds('Port San Carlos', ['reserve'], 'infantry', 8)
    },
    {
      group: landingFormation(
        'arg-port-san-carlos-aaa',
        'Port San Carlos',
        'Ural-375 ZU-23',
        4,
        'arg-landing-air-defense'
      ),
      roles: ['air-defense'] as const,
      siteIds: availableSiteIds('Port San Carlos', ['air-defense'], 'air-defense', 4)
    }
  ]

  for (const { group, roles, siteIds } of formations) {
    if (opponent.groundGroups.some((existing) => existing.id === group.id)) continue
    expandGroundGroupUnits(group)
    const assignment = assignDeploymentSite({
      campaign,
      coalition: 'opponent',
      theatre,
      group,
      objectiveId: group.objectiveId ?? 'Port San Carlos',
      roles: [...roles],
      reason: 'landing',
      siteIds,
      now: campaign.time
    })
    if (assignment) opponent.groundGroups.push(group)
  }
}

function removePrematureBeachhead(campaign: Campaign) {
  if (campaign.landingOperation?.completed || campaign.campaignPhase === 'land-campaign') return

  const player = campaign.coalitions.player
  player.objectiveIds = player.objectiveIds.filter(
    (objectiveId) => !BEACHHEAD_OBJECTIVES.has(objectiveId)
  )
  player.structures = player.structures.filter(
    (structure) =>
      !BEACHHEAD_OBJECTIVES.has(structure.objectiveId) ||
      (campaign.campaignPhase === 'san-carlos-landing' && structure.id === SAN_CARLOS_FARP_ID)
  )
  player.samGroups = player.samGroups.filter(
    (group) => !BEACHHEAD_OBJECTIVES.has(group.objectiveId)
  )
  player.groundGroups = player.groundGroups.filter(
    (group) => !group.objectiveId || !BEACHHEAD_OBJECTIVES.has(group.objectiveId)
  )
  for (const objectiveId of BEACHHEAD_OBJECTIVES) {
    delete player.supplyNodes?.[objectiveId]
    delete player.replacementPools?.[objectiveId]
  }
}

export function migrateLegacyFalklandsNavalStarts(campaign: Campaign) {
  if (campaign.scenarioId !== 'falklands-1982') return

  const carrier = campaign.coalitions.player.navalGroups?.find(
    (group) => group.id === 'uk-carrier-group'
  )
  const escort = campaign.coalitions.player.navalGroups?.find(
    (group) => group.id === 'uk-escort-group'
  )
  if (escort) escort.missionGroupId = 'uk-carrier-group'

  if (carrier?.unitTypes.includes(HMS_INVINCIBLE_UNIT_TYPE)) {
    carrier.unitTypes = [
      LHA_TARAWA_UNIT_TYPE,
      ...carrier.unitTypes.filter(
        (unitType) => unitType !== HMS_INVINCIBLE_UNIT_TYPE && unitType !== LHA_TARAWA_UNIT_TYPE
      )
    ]

    if (carrier.units) {
      const legacyUnit = carrier.units
        .filter((unit) => unit.type === HMS_INVINCIBLE_UNIT_TYPE)
        .sort((left, right) => left.damage - right.damage)[0]
      const existingTarawa = carrier.units.find((unit) => unit.type === LHA_TARAWA_UNIT_TYPE)
      carrier.units = [
        existingTarawa ?? {
          id: `${carrier.id}-ship-1`,
          type: LHA_TARAWA_UNIT_TYPE,
          damage: legacyUnit?.damage ?? carrier.damage,
          ammunition: legacyUnit?.ammunition ?? carrier.ammunition,
          fuel: legacyUnit?.fuel ?? carrier.fuel,
          state:
            legacyUnit?.state ?? (carrier.state === 'unloading' ? 'operational' : carrier.state)
        },
        ...carrier.units.filter(
          (unit) => unit.type !== HMS_INVINCIBLE_UNIT_TYPE && unit.type !== LHA_TARAWA_UNIT_TYPE
        )
      ]
    }
  }

  const argentineSurfaceGroup = campaign.coalitions.opponent.navalGroups?.find(
    (group) => group.id === 'arg-surface-group'
  )
  if (argentineSurfaceGroup) {
    argentineSurfaceGroup.missionPatrol = { ...ARGENTINE_SURFACE_GROUP_PATROL }
    argentineSurfaceGroup.persistPosition = false
  }
  if (
    argentineSurfaceGroup &&
    (argentineSurfaceGroup.unitTypes.length !== ARGENTINE_SURFACE_GROUP_UNIT_TYPES.length ||
      argentineSurfaceGroup.unitTypes.some(
        (unitType, index) => unitType !== ARGENTINE_SURFACE_GROUP_UNIT_TYPES[index]
      ))
  ) {
    const wasDefeated =
      argentineSurfaceGroup.state === 'sunk' || argentineSurfaceGroup.damage >= 0.5
    argentineSurfaceGroup.name = 'Argentine Surface Group'
    argentineSurfaceGroup.unitTypes = [...ARGENTINE_SURFACE_GROUP_UNIT_TYPES]
    argentineSurfaceGroup.units = ARGENTINE_SURFACE_GROUP_UNIT_TYPES.map((type, index) => ({
      id: `${argentineSurfaceGroup.id}-ship-${index + 1}`,
      type,
      damage: wasDefeated ? 1 : 0,
      ammunition: argentineSurfaceGroup.ammunition,
      fuel: argentineSurfaceGroup.fuel,
      state: wasDefeated ? 'sunk' : 'operational'
    }))
    argentineSurfaceGroup.damage = wasDefeated ? 1 : 0
    argentineSurfaceGroup.state = wasDefeated ? 'sunk' : 'operational'
  }

  for (const placement of LEGACY_NAVAL_STARTS) {
    const group = campaign.coalitions[placement.coalition].navalGroups?.find(
      (candidate) => candidate.id === placement.id
    )
    if (!group) continue
    if (Math.hypot(group.position.x - placement.from.x, group.position.y - placement.from.y) > 1) {
      continue
    }
    group.position = { ...placement.to }
    group.heading = placement.heading
  }
}

function ensureFalklandsLandingSam(campaign: Campaign) {
  if (
    campaign.campaignPhase === 'san-carlos-landing' ||
    campaign.campaignPhase === 'land-campaign' ||
    campaign.landingOperation?.completed
  ) {
    return
  }

  const opponent = campaign.coalitions.opponent
  for (const battery of FALKLANDS_SAM_NETWORK) {
    if (opponent.samGroups.some((group) => group.objectiveId === battery.objectiveId)) continue
    opponent.samGroups.push({ ...battery })
  }
}

function createSanCarlosFarp(
  campaign: Campaign,
  theatre: Theatre,
  reservedSiteId: string | undefined
) {
  const player = campaign.coalitions.player
  if (player.structures.some((structure) => structure.id === SAN_CARLOS_FARP_ID)) return
  const site = getDeploymentSites(theatre).find(
    (candidate) =>
      candidate.id === reservedSiteId &&
      candidate.objectiveId === 'San Carlos' &&
      candidate.roles.includes('recovery')
  )
  if (!site) return

  player.structures.push({
    id: SAN_CARLOS_FARP_ID,
    type: 'Farp',
    objectiveId: 'San Carlos',
    position: { ...site.position },
    name: 'San Carlos FARP',
    resources: 0,
    buildings: [
      { offset: { x: 0, y: 0 }, type: 'FARP', alive: true },
      { offset: { x: 75, y: -75 }, type: 'FARP Ammo Dump Coating', alive: true },
      { offset: { x: -60, y: -75 }, type: 'FARP CP Blindage', alive: true },
      { offset: { x: 10, y: -75 }, type: 'FARP Fuel Depot', alive: true },
      { offset: { x: 50, y: -75 }, type: 'FARP Tent', alive: true },
      { offset: { x: -20, y: -75 }, type: 'FARP Tent', alive: true }
    ]
  })
}

export function migrateFalklandsSanCarlosFarp(campaign: Campaign, theatre: Theatre) {
  if (campaign.scenarioId !== 'falklands-1982') return

  const reservedSiteIds = new Set(campaign.landingOperation?.reservedSiteIds ?? [])
  const sites = getDeploymentSites(theatre).filter(
    (candidate) =>
      candidate.objectiveId === 'San Carlos' &&
      candidate.id.startsWith('recovery-') &&
      candidate.validationStatus !== 'candidate' &&
      candidate.roles.includes('recovery')
  )
  const site = sites.find((candidate) => reservedSiteIds.has(candidate.id)) ?? sites[0]
  if (!site) return

  if (
    campaign.campaignPhase === 'san-carlos-landing' ||
    campaign.campaignPhase === 'land-campaign' ||
    campaign.landingOperation?.completed
  ) {
    createSanCarlosFarp(campaign, theatre, site.id)
  }
  const farp = campaign.coalitions.player.structures.find(
    (structure) => structure.id === SAN_CARLOS_FARP_ID
  )
  if (!farp) return

  const previousPosition = farp.position
  if (previousPosition.x === site.position.x && previousPosition.y === site.position.y) return

  farp.position = { ...site.position }
  for (const flightGroup of campaign.coalitions.player.flightGroups) {
    if (flightGroup.homeBase !== SAN_CARLOS_FARP_ID) continue

    flightGroup.position = { ...site.position }
    for (const waypoint of flightGroup.flightplan.waypoints) {
      if (waypoint.type === 'TakeOff' || waypoint.type === 'Landing') {
        waypoint.position = { ...site.position }
      }
    }
  }
}

function completeSanCarlosLanding(
  campaign: Campaign,
  theatre: Theatre,
  events: FalklandsCampaignEvent[]
) {
  const formations = [
    {
      group: landingFormation(
        'uk-san-carlos-infantry',
        'Port San Carlos',
        'Soldier M4',
        8,
        'uk-landing-infantry'
      ),
      roles: ['infantry', 'defensive'] as const
    },
    {
      group: landingFormation(
        'uk-san-carlos-vehicles',
        'San Carlos',
        'M-113',
        4,
        'uk-landing-vehicles'
      ),
      roles: ['vehicle', 'staging'] as const
    },
    {
      group: landingFormation(
        'uk-san-carlos-rapier',
        'San Carlos',
        'Vulcan',
        4,
        'uk-landing-air-defense'
      ),
      roles: ['air-defense', 'defensive'] as const
    }
  ]

  for (const [index, { group, roles }] of formations.entries()) {
    if (campaign.coalitions.player.groundGroups.some((existing) => existing.id === group.id))
      continue
    expandGroundGroupUnits(group)
    const assignment = assignDeploymentSite({
      campaign,
      coalition: 'player',
      theatre,
      group,
      objectiveId: group.objectiveId ?? 'San Carlos',
      roles: [...roles],
      reason: 'landing',
      siteIds: new Set([campaign.landingOperation?.reservedSiteIds[index] ?? '']),
      now: campaign.time
    })
    if (!assignment) continue
    campaign.coalitions.player.groundGroups.push(group)
  }

  for (const objectiveId of BEACHHEAD_OBJECTIVES) {
    campaign.coalitions.opponent.objectiveIds = campaign.coalitions.opponent.objectiveIds.filter(
      (ownedObjectiveId) => ownedObjectiveId !== objectiveId
    )
    if (!campaign.coalitions.player.objectiveIds.includes(objectiveId)) {
      campaign.coalitions.player.objectiveIds.push(objectiveId)
    }
    delete campaign.coalitions.opponent.supplyNodes?.[objectiveId]
    delete campaign.coalitions.opponent.replacementPools?.[objectiveId]
  }
  const playerSupplyNodes = (campaign.coalitions.player.supplyNodes ??= {})
  const supply = (playerSupplyNodes['San Carlos'] ??= {
    current: 0,
    max: 2_000,
    productionRate: 0,
    consumptionRate: 0,
    status: 'low'
  })
  const transport = (campaign.coalitions.player.navalGroups ?? []).find(
    (group) => group.role === 'transport' && group.state !== 'sunk'
  )
  const unloadedSupply = transport?.cargo ?? 0
  supply.current = Math.min(supply.max, supply.current + unloadedSupply)
  supply.status = supply.current >= supply.max * 0.5 ? 'adequate' : 'low'
  if (transport) {
    transport.cargo = 0
    transport.state = 'operational'
  }
  const replacementPools = (campaign.coalitions.player.replacementPools ??= {})
  replacementPools['San Carlos'] ??= {
    readyPersonnel: 0,
    recoveringPersonnel: [],
    equipment: []
  }
  createSanCarlosFarp(campaign, theatre, campaign.landingOperation?.reservedSiteIds[3])
  campaign.landingOperation = {
    ...campaign.landingOperation,
    reservedSiteIds: campaign.landingOperation?.reservedSiteIds ?? [],
    completed: true
  }
  campaign.campaignPhase = 'land-campaign'
  events.push({ kind: 'landing', message: 'San Carlos unloading completed; land campaign opened' })
}

export function advanceFalklandsCampaign(
  campaign: Campaign,
  theatre: Theatre
): FalklandsCampaignEvent[] {
  if (campaign.scenarioId !== 'falklands-1982' || (campaign.status ?? 'active') !== 'active')
    return []
  const events: FalklandsCampaignEvent[] = []
  migrateLegacyFalklandsNavalStarts(campaign)
  migrateFalklandsSanCarlosFarp(campaign, theatre)
  removePrematureBeachhead(campaign)
  ensureFalklandsLandingSam(campaign)

  // `landing-preparation` is retained in the save schema for compatibility, but is now folded
  // into the opening sea-control phase.
  if (campaign.campaignPhase === 'landing-preparation') campaign.campaignPhase = 'sea-control'

  if (!isNavalRoleOperational(campaign, 'carrier')) {
    campaign.status = 'lost'
    campaign.timeMultiplier = 0
    return [{ kind: 'defeat', message: 'Campaign lost: carrier capability destroyed' }]
  }
  if (!campaign.landingOperation?.completed && !isNavalRoleOperational(campaign, 'transport')) {
    campaign.status = 'lost'
    campaign.timeMultiplier = 0
    return [{ kind: 'defeat', message: 'Campaign lost: amphibious lift destroyed before landing' }]
  }
  const landSupply = Object.values(campaign.coalitions.player.supplyNodes ?? {}).reduce(
    (sum, supply) => sum + supply.current,
    0
  )
  const embarkedSupply = campaign.landingOperation?.completed
    ? 0
    : (campaign.coalitions.player.navalGroups ?? [])
        .filter((group) => group.role === 'transport' && group.state !== 'sunk')
        .reduce((sum, group) => sum + group.cargo, 0)
  if (landSupply + embarkedSupply <= 0) {
    campaign.status = 'lost'
    campaign.timeMultiplier = 0
    return [{ kind: 'defeat', message: 'Campaign lost: expeditionary supply collapsed' }]
  }

  const readiness = getSanCarlosLandingReadiness(campaign, theatre)
  if (campaign.campaignPhase === 'sea-control' && readiness.ready) {
    const startedAt = new Date(campaign.time)
    campaign.campaignPhase = 'san-carlos-landing'
    campaign.landingOperation = {
      startedAt,
      completesAt: new Date(startedAt.getTime() + LANDING_DURATION_MS),
      reservedSiteIds: readiness.reservedSiteIds,
      completed: false
    }
    migrateFalklandsSanCarlosFarp(campaign, theatre)
    deployArgentineLandingDefenders(campaign, theatre)
    const transport = (campaign.coalitions.player.navalGroups ?? []).find(
      (group) => group.role === 'transport' && group.state !== 'sunk'
    )
    if (transport) {
      transport.position = { ...SAN_CARLOS_AMPHIBIOUS_ANCHORAGE }
      transport.heading = SAN_CARLOS_APPROACH_HEADING
      transport.state = 'unloading'
    }
    events.push({
      kind: 'phase',
      message: 'San Carlos landing started; unloading requires 30 campaign minutes'
    })
  }
  if (
    campaign.campaignPhase === 'san-carlos-landing' &&
    campaign.landingOperation?.completesAt &&
    campaign.time >= campaign.landingOperation.completesAt
  ) {
    completeSanCarlosLanding(campaign, theatre, events)
  }

  return events
}
