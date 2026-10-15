import { produce } from 'immer'
import {
  beginGroundGroupRetreat,
  classifyGroundUnit,
  dissolveGroundGroupIntoReplacementPool,
  recordInfantryCasualties,
  recoverCasualtyPoint
} from '@dcc/campaign'
import { schemas } from '@dcc/contracts'
import {
  campaignIadsEra,
  germanyIadsControllingCoalition,
  germanyIadsOwnersFromObjectives,
  germanyIadsSamGroupName,
  getGermanyIadsSites,
  isGermanyIadsTheatre,
  samTemplates,
  scenarios,
  theatres
} from '@dcc/data'
import * as z from 'zod'

import { FlightGroup } from '@/logic/entities/flight-group'
import { logCombatAction } from '@/logic/simulation-log'
import { updatePackages } from '@/logic/systems/update-packages'
import { syncDownedPilotsFromMissionState } from '@/logic/systems/downed-pilots'
import { chokedObjectiveIds } from '@/logic/systems/logistics-interdiction'

type Campaign = z.infer<typeof schemas.campaign.campaign>
type MissionState = z.infer<typeof schemas.missionState>
type Coalition = 'player' | 'opponent'
type MissionAircraftGroup = NonNullable<MissionState['groupPositions']>['blue']['aircraft'][number]
type MissionAircraftUnit = MissionAircraftGroup['units'][number]
type MissionGroundGroup = NonNullable<MissionState['groupPositions']>['blue']['ground'][number]
type MissionShipGroup = NonNullable<MissionState['groupPositions']>['blue']['ships'][number]
type GroundCullingGroups = NonNullable<MissionState['cullingManifest']>['groundGroups'][Coalition]

export function campaignDateFromMissionTime(
  campaignTime: Date,
  missionTimeSeconds?: number
): Date | null {
  if (missionTimeSeconds == null || !Number.isFinite(missionTimeSeconds)) {
    return null
  }

  const campaignDate = new Date(campaignTime)
  const midnightUtc = Date.UTC(
    campaignDate.getUTCFullYear(),
    campaignDate.getUTCMonth(),
    campaignDate.getUTCDate()
  )
  const missionDate = new Date(midnightUtc + missionTimeSeconds * 1000)

  while (missionDate < campaignDate) {
    missionDate.setUTCDate(missionDate.getUTCDate() + 1)
  }

  return missionDate
}

function getGeneratedUnitIndex(unitName: string): number | null {
  const match = unitName.match(/-(\d+)$/)
  if (!match?.[1]) return null

  const index = Number.parseInt(match[1], 10)
  return Number.isFinite(index) ? index - 1 : null
}

function getGeneratedGroundGroupId(name: string): string | null {
  const match = name.match(/^Ground-(.+)-\d+(?:-\d+)?$/)
  return match?.[1] ?? null
}

function syncGermanySamLosses(
  draft: Campaign,
  theatre: z.infer<typeof schemas.theatre> | undefined,
  lostUnits: MissionState['lostUnits'],
  groupPositions: MissionState['groupPositions']
) {
  if (!theatre || !isGermanyIadsTheatre(theatre.name)) return

  const aliveUnitNames = new Set<string>()
  for (const side of [groupPositions?.blue?.ground, groupPositions?.red?.ground]) {
    for (const group of side ?? []) {
      for (const unit of group.units) aliveUnitNames.add(unit.name)
    }
  }

  const lostNames = new Set(lostUnits.map((unit) => unit.name))
  const lostGroups = new Set(lostUnits.flatMap((unit) => (unit.groupName ? [unit.groupName] : [])))
  const deadUnits = { ...(draft.germanyIadsDeadUnits ?? {}) }
  const owners = germanyIadsOwnersFromObjectives(
    theatre.objectives,
    draft.coalitions.player.objectiveIds,
    draft.coalitions.opponent.objectiveIds
  )
  let changed = false

  for (const site of getGermanyIadsSites(campaignIadsEra(draft))) {
    if ((site.kind !== 'sam' && site.kind !== 'ewr') || site.units.length === 0) continue

    const previous = new Set(deadUnits[site.id] ?? [])
    const next = new Set(previous)
    const living = site.units.filter((unit) => !previous.has(unit.name))
    const groupNames = [
      site.id,
      germanyIadsSamGroupName(site, 'player'),
      germanyIadsSamGroupName(site, 'opponent')
    ]

    for (const unit of living) {
      if (lostNames.has(unit.name)) next.add(unit.name)
    }
    if (living.some((unit) => aliveUnitNames.has(unit.name))) {
      for (const unit of living) {
        if (!aliveUnitNames.has(unit.name)) next.add(unit.name)
      }
    } else if (
      groupNames.some((name) => lostGroups.has(name)) ||
      living.some((unit) => lostNames.has(unit.name))
    ) {
      for (const unit of living) next.add(unit.name)
    }

    if (next.size === previous.size) continue

    changed = true
    deadUnits[site.id] = [...next]
    const destroyed = site.units.every((unit) => next.has(unit.name))
    const wasDestroyed = site.units.every((unit) => previous.has(unit.name))
    if (destroyed && !wasDestroyed) {
      logCombatAction(
        draft,
        germanyIadsControllingCoalition(site, owners),
        `${site.kind === 'ewr' ? 'EWR' : 'SAM'} ${site.id} destroyed`
      )
    }
  }

  if (changed) draft.germanyIadsDeadUnits = deadUnits
}

/** A destroyed search radar stays dead while the sortie is still running, so the bubble catalogue stops asking for it. */
export function applyLiveIadsDeaths(campaign: Campaign, missionState: MissionState): Campaign {
  if (missionState.missionId !== campaign.id) return campaign
  const scenario = scenarios.find((entry) => entry.id === campaign.scenarioId)
  const theatre = scenario ? theatres.find((entry) => entry.name === scenario.theatreName) : undefined
  if (!theatre) return campaign

  return produce(campaign, (draft) => {
    syncGermanySamLosses(
      draft,
      theatre,
      missionState.lostUnits ?? [],
      missionState.groupPositions
    )
  })
}

function addLostSamUnitIndex(
  sam: Campaign['coalitions']['player']['samGroups'][number],
  lostUnit: MissionState['lostUnits'][number],
  deadUnitIndexes: Set<number>
): boolean {
  const namePrefix = `SAM-${sam.id}-`
  const groupName = lostUnit.groupName ?? undefined

  if (!lostUnit.name.startsWith(namePrefix) && !groupName?.startsWith(namePrefix)) {
    return false
  }

  const generatedIndex = getGeneratedUnitIndex(lostUnit.name)
  if (generatedIndex != null) {
    deadUnitIndexes.add(generatedIndex)
    return true
  }

  const template = samTemplates[sam.type]
  const typeIndex = template?.units.findIndex(
    (unitType, index) => unitType === lostUnit.type && !deadUnitIndexes.has(index)
  )
  if (typeIndex != null && typeIndex >= 0) {
    deadUnitIndexes.add(typeIndex)
    return true
  }

  return true
}

function isAirDefenseUnit(unitName: string, coalitionData: Campaign['coalitions']['player']) {
  const airDefenseTypes = new Set([
    ...(coalitionData.groundUnitTypes.SAM ?? []),
    ...(coalitionData.groundUnitTypes['Shorad Vehicle'] ?? []),
    ...(coalitionData.groundUnitTypes['Shorad Infantry'] ?? [])
  ])

  return (
    airDefenseTypes.has(unitName) ||
    /\b(aaa|sam|shorad|stinger|igla|linebacker|shilka|osa|tunguska|tor)\b/i.test(unitName)
  )
}

function countMissionGroundUnits(group?: { units: Array<{ type: string }> }) {
  const countsByType = new Map<string, number>()
  for (const unit of group?.units ?? []) {
    countsByType.set(unit.type, (countsByType.get(unit.type) ?? 0) + 1)
  }
  return countsByType
}

function syncAntiAirOnlyGroundGroup(
  groundGroup: Campaign['coalitions']['player']['groundGroups'][number],
  coalitionData: Campaign['coalitions']['player'],
  missionGroup?: MissionGroundGroup
) {
  const stablePrefix = `GroundUnit-${groundGroup.id}-`
  const exactMissionUnits = new Map(
    (missionGroup?.units ?? [])
      .filter((unit) => unit.name.startsWith(stablePrefix))
      .map((unit) => [unit.name.slice(stablePrefix.length), unit])
  )
  if (exactMissionUnits.size > 0) {
    groundGroup.units = groundGroup.units.filter((unit) => {
      if (!isAirDefenseUnit(unit.name, coalitionData)) return true
      const missionUnit = unit.id ? exactMissionUnits.get(unit.id) : undefined
      if (!missionUnit) return false
      unit.position = { x: missionUnit.x, y: missionUnit.y }
      unit.heading = missionUnit.heading ?? unit.heading
      return true
    })
    return
  }

  const missionCountsByType = countMissionGroundUnits(missionGroup)
  const nextUnits: typeof groundGroup.units = []
  const seenAirDefenseTypes = new Set<string>()

  for (const unit of groundGroup.units) {
    if (!isAirDefenseUnit(unit.name, coalitionData)) {
      nextUnits.push(unit)
      continue
    }

    seenAirDefenseTypes.add(unit.name)
    const count = missionCountsByType.get(unit.name) ?? 0
    if (count > 0) {
      nextUnits.push({ name: unit.name, count })
    }
  }

  for (const [name, count] of missionCountsByType) {
    if (!seenAirDefenseTypes.has(name) && isAirDefenseUnit(name, coalitionData) && count > 0) {
      nextUnits.push({ name, count })
    }
  }

  groundGroup.units = nextUnits
}

function syncGroundGroupsFromMissionState(
  draft: Campaign,
  coalition: Coalition,
  groups?: MissionGroundGroup[],
  cullingGroups?: GroundCullingGroups,
  protectedGroundGroupIds: ReadonlySet<string> = new Set()
) {
  if (!groups) {
    return
  }

  const groupsById = new Map<string, NonNullable<typeof groups>[number]>()
  for (const group of groups) {
    const id = getGeneratedGroundGroupId(group.name)
    if (id) {
      groupsById.set(id, group)
    }
  }

  for (const groundGroup of draft.coalitions[coalition].groundGroups) {
    const cullingMode = cullingGroups?.[groundGroup.id]
    if (cullingGroups && !cullingMode) {
      continue
    }

    const missionGroup = groupsById.get(groundGroup.id)
    if (cullingMode === 'antiAirOnly') {
      syncAntiAirOnlyGroundGroup(groundGroup, draft.coalitions[coalition], missionGroup)
      continue
    }

    if (!missionGroup) {
      if (protectedGroundGroupIds.has(groundGroup.id)) continue
      groundGroup.units = []
      continue
    }

    groundGroup.position.x = missionGroup.x
    groundGroup.position.y = missionGroup.y

    const stablePrefix = `GroundUnit-${groundGroup.id}-`
    const exactMissionUnits = new Map(
      missionGroup.units
        .filter((unit) => unit.name.startsWith(stablePrefix))
        .map((unit) => [unit.name.slice(stablePrefix.length), unit])
    )
    if (exactMissionUnits.size > 0) {
      groundGroup.units = groundGroup.units.filter((unit) => {
        const missionUnit = unit.id ? exactMissionUnits.get(unit.id) : undefined
        if (!missionUnit) return false
        unit.position = { x: missionUnit.x, y: missionUnit.y }
        unit.heading = missionUnit.heading ?? unit.heading
        unit.count = 1
        return true
      })
      continue
    }

    groundGroup.units = Array.from(countMissionGroundUnits(missionGroup), ([name, count]) => ({
      name,
      count
    }))
  }

  draft.coalitions[coalition].groundGroups = draft.coalitions[coalition].groundGroups.filter(
    (groundGroup) => groundGroup.units.reduce((sum, unit) => sum + Math.max(0, unit.count), 0) > 0
  )
}

function syncNavalGroupsFromMissionState(
  draft: Campaign,
  coalition: Coalition,
  groups: MissionShipGroup[] | undefined,
  lostUnitNames: ReadonlySet<string>
) {
  const groupsByName = new Map((groups ?? []).map((group) => [group.name, group]))
  for (const navalGroup of draft.coalitions[coalition].navalGroups ?? []) {
    const missionGroupId = navalGroup.missionGroupId ?? navalGroup.id
    const missionGroup = groupsByName.get(`NavalGroup-${missionGroupId}`)
    if (navalGroup.persistPosition !== false && missionGroup) {
      const ownLeadUnit = missionGroup.units.find((unit) =>
        unit.name.startsWith(`NavalUnit-${navalGroup.id}-`)
      )
      navalGroup.position = ownLeadUnit
        ? { x: ownLeadUnit.x, y: ownLeadUnit.y }
        : { x: missionGroup.x, y: missionGroup.y }
    }

    navalGroup.units ??= navalGroup.unitTypes.map((type, index) => ({
      id: `${navalGroup.id}-ship-${index + 1}`,
      type,
      damage: 0,
      ammunition: navalGroup.ammunition,
      fuel: navalGroup.fuel,
      state: 'operational' as const
    }))
    if (navalGroup.role === 'carrier') {
      for (const unit of navalGroup.units) {
        unit.damage = 0
        unit.state = 'operational'
      }
      navalGroup.damage = 0
      navalGroup.state = 'operational'
      continue
    }
    const liveMissionUnitNames = new Set(missionGroup?.units.map((unit) => unit.name) ?? [])
    for (const unit of navalGroup.units) {
      const missionName = `NavalUnit-${navalGroup.id}-${unit.id}`
      if (lostUnitNames.has(missionName)) {
        unit.damage = 1
        unit.state = 'sunk'
      } else if (liveMissionUnitNames.has(missionName)) {
        unit.state = unit.damage > 0 ? 'damaged' : 'operational'
      }
    }
    const sunkCount = navalGroup.units.filter((unit) => unit.state === 'sunk').length
    navalGroup.damage = navalGroup.units.length > 0 ? sunkCount / navalGroup.units.length : 1
    if (sunkCount === navalGroup.units.length) navalGroup.state = 'sunk'
    else if (sunkCount > 0 && navalGroup.state !== 'unloading') navalGroup.state = 'damaged'
  }
}

function syncEwrGroupsFromMissionState(
  draft: Campaign,
  coalition: Coalition,
  groups: MissionGroundGroup[] | undefined,
  lostUnits: MissionState['lostUnits']
) {
  for (const ewr of draft.coalitions[coalition].ewrGroups ?? []) {
    const groupPrefix = `IADS-EWR-${ewr.id}-`
    const missionGroup = groups?.find((group) => group.name.startsWith(groupPrefix))
    if (missionGroup) {
      ewr.position = { x: missionGroup.x, y: missionGroup.y }
    }

    const unitName = `IADS-EWR-Unit-${ewr.id}`
    if (
      lostUnits.some(
        (unit) => unit.name === unitName || (unit.groupName?.startsWith(groupPrefix) ?? false)
      )
    ) {
      ewr.destroyed = true
      ewr.suppressed = false
    }
  }
}

function getAircraftStateNames(
  flightGroup: Campaign['coalitions']['player']['flightGroups'][number]
) {
  return flightGroup.aircrafts.map((aircraft, index) => ({
    aircraftId: aircraft.id,
    client: aircraft.client === true,
    names: [aircraft.unitName, `${flightGroup.callsign}-${index + 1}`]
  }))
}

function createMissionUnitLookup(group?: MissionAircraftGroup) {
  const unitsByName = new Map<string, MissionAircraftUnit>()
  for (const unit of group?.units ?? []) {
    unitsByName.set(unit.name, unit)
  }
  return unitsByName
}

function hasNameInSet(names: string[], set: Set<string>) {
  return names.some((name) => set.has(name))
}

function isAircraftCurrentlyAirborne(
  names: string[],
  unitsByName: Map<string, MissionAircraftUnit>
) {
  return names.some((name) => unitsByName.get(name)?.inAir === true)
}

function isAircraftTerminal(
  names: string[],
  lostUnitNames: Set<string>,
  landedUnitNames: Set<string>,
  missionUnitsByName: Map<string, MissionAircraftUnit>
) {
  if (hasNameInSet(names, lostUnitNames)) {
    return true
  }

  return (
    hasNameInSet(names, landedUnitNames) && !isAircraftCurrentlyAirborne(names, missionUnitsByName)
  )
}

function areAllClientAircraftTerminal(
  aircraftStates: ReturnType<typeof getAircraftStateNames>,
  lostUnitNames: Set<string>,
  landedUnitNames: Set<string>,
  missionUnitsByName: Map<string, MissionAircraftUnit>
) {
  const clientStates = aircraftStates.filter((state) => state.client)
  if (clientStates.length === 0) {
    return false
  }

  return clientStates.every((state) =>
    isAircraftTerminal(state.names, lostUnitNames, landedUnitNames, missionUnitsByName)
  )
}

function applyToCoalition(
  draft: Campaign,
  coalition: Coalition,
  groups: MissionAircraftGroup[] | undefined,
  lostUnitNames: Set<string>,
  landedUnitNames: Set<string>,
  cargoDeliveries: MissionState['cargoDeliveries']
) {
  const transportDeliveryRadiusMeters = 2000

  const isNearTransportDestination = (
    flightGroup: Campaign['coalitions']['player']['flightGroups'][number],
    delivery: { x: number; y: number }
  ) => {
    const directWaypoint = flightGroup.flightplan.waypoints.find(
      (waypoint) => waypoint.name === 'Direct'
    )
    const lastWaypoint =
      flightGroup.flightplan.waypoints.length > 0
        ? flightGroup.flightplan.waypoints[flightGroup.flightplan.waypoints.length - 1]
        : undefined
    const destination = directWaypoint?.position ?? lastWaypoint?.position
    if (!destination) return false

    const dx = destination.x - delivery.x
    const dy = destination.y - delivery.y
    return Math.hypot(dx, dy) <= transportDeliveryRadiusMeters
  }

  const groupByName = new Map((groups ?? []).map((group) => [group.name, group]))
  const finishedFlightGroupIds = new Set<string>()

  for (const flightGroup of draft.coalitions[coalition].flightGroups) {
    const missionGroup = groupByName.get(flightGroup.callsign)
    if (missionGroup) {
      flightGroup.position.x = missionGroup.x
      flightGroup.position.y = missionGroup.y
    }

    const missionUnitsByName = createMissionUnitLookup(missionGroup)
    const aircraftStateNames = getAircraftStateNames(flightGroup)
    const terminalAircraftIds = new Set<string>()

    for (const aircraftState of aircraftStateNames) {
      if (
        isAircraftTerminal(aircraftState.names, lostUnitNames, landedUnitNames, missionUnitsByName)
      ) {
        terminalAircraftIds.add(aircraftState.aircraftId)
      }
    }

    if (terminalAircraftIds.size > 0) {
      flightGroup.aircrafts = flightGroup.aircrafts.filter(
        (aircraft) => !terminalAircraftIds.has(aircraft.id)
      )
    }

    if (
      areAllClientAircraftTerminal(
        aircraftStateNames,
        lostUnitNames,
        landedUnitNames,
        missionUnitsByName
      )
    ) {
      flightGroup.aircrafts = []
    }

    if (new FlightGroup(flightGroup).isLanded(draft.time)) {
      flightGroup.aircrafts = []
    }

    if (flightGroup.task === 'Transport') {
      const delivery = cargoDeliveries[flightGroup.callsign]
      if (
        delivery &&
        flightGroup.cargoStatus !== 'delivered' &&
        flightGroup.cargoStatus !== 'lost' &&
        flightGroup.destinationNode &&
        flightGroup.cargoAmount &&
        isNearTransportDestination(flightGroup, delivery)
      ) {
        const destinationSupplyNode =
          draft.coalitions[coalition].supplyNodes?.[flightGroup.destinationNode]
        if (destinationSupplyNode) {
          destinationSupplyNode.current += flightGroup.cargoAmount
        }

        flightGroup.position.x = delivery.x
        flightGroup.position.y = delivery.y
        flightGroup.cargoStatus = 'delivered'
      }
    }

    if (flightGroup.aircrafts.length === 0) {
      finishedFlightGroupIds.add(flightGroup.id)
      continue
    }
  }

  if (finishedFlightGroupIds.size > 0) {
    draft.coalitions[coalition].flightGroups = draft.coalitions[coalition].flightGroups.filter(
      (flightGroup) => !finishedFlightGroupIds.has(flightGroup.id)
    )
  }
}

function bubbleGroundUnitName(
  groupId: string,
  unit: { id?: string; count: number },
  copy: number,
  unitIndex: number
) {
  const id = unit.id ?? `legacy-${unitIndex + 1}`
  const suffix = unit.count > 1 && unit.id ? `${unit.id}-${copy + 1}` : id
  return `GroundUnit-${groupId}-${suffix}`
}

/** Corridor culling skips omitted columns. A real kill of a bubble-spawned unit still arrives in lostUnits. */
function applyOmittedGroundDeaths(
  draft: Campaign,
  coalition: Coalition,
  cullingGroups: GroundCullingGroups | undefined,
  lostUnitNames: ReadonlySet<string>
) {
  if (!cullingGroups) return

  for (const group of draft.coalitions[coalition].groundGroups) {
    if (cullingGroups[group.id]) continue
    let unitIndex = 0
    const next: typeof group.units = []
    for (const unit of group.units) {
      const copies = Math.max(0, unit.count)
      let alive = 0
      for (let copy = 0; copy < copies; copy++) {
        if (!lostUnitNames.has(bubbleGroundUnitName(group.id, unit, copy, unitIndex))) alive += 1
        unitIndex += 1
      }
      if (alive > 0) next.push({ ...unit, count: alive })
    }
    group.units = next
  }

  draft.coalitions[coalition].groundGroups = draft.coalitions[coalition].groundGroups.filter(
    (group) =>
      Boolean(cullingGroups[group.id]) ||
      group.units.reduce((sum, unit) => sum + Math.max(0, unit.count), 0) > 0
  )
}

export function applyMissionStateUpdate(campaign: Campaign, missionState: MissionState): Campaign {
  const lostUnits = missionState.lostUnits ?? []
  const landedUnits = missionState.landedUnits ?? []
  const lostUnitNames = new Set(lostUnits.map((unit) => unit.name))
  const landedUnitNames = new Set(landedUnits.map((unit) => unit.name))
  const groupPositions = missionState.groupPositions
  const cargoDeliveries = missionState.cargoDeliveries ?? {}
  const cullingManifest = missionState.cullingManifest
  const troopExtractions = missionState.troopExtractions ?? []
  const casevacPickups = missionState.casevacPickups ?? []
  const protectedGroundGroupIds = new Set(troopExtractions.map((event) => event.groupId))

  return produce(campaign, (draft) => {
    const infantryBefore = new Map<string, number>()
    for (const coalition of ['player', 'opponent'] as const) {
      for (const group of draft.coalitions[coalition].groundGroups) {
        infantryBefore.set(
          `${coalition}:${group.id}`,
          group.units.reduce(
            (sum, unit) => sum + (classifyGroundUnit(unit.name) === 'infantry' ? unit.count : 0),
            0
          )
        )
      }
    }
    const missionDate = campaignDateFromMissionTime(draft.time, missionState.time)
    if (missionDate) {
      draft.time = missionDate
      draft.timeTarget = undefined
    }

    syncDownedPilotsFromMissionState(draft, missionState, campaign.time)

    applyToCoalition(
      draft,
      'player',
      groupPositions?.blue?.aircraft,
      lostUnitNames,
      landedUnitNames,
      cargoDeliveries
    )
    applyToCoalition(
      draft,
      'opponent',
      groupPositions?.red?.aircraft,
      lostUnitNames,
      landedUnitNames,
      cargoDeliveries
    )
    syncGroundGroupsFromMissionState(
      draft,
      'player',
      groupPositions?.blue?.ground,
      cullingManifest?.groundGroups.player,
      protectedGroundGroupIds
    )
    syncGroundGroupsFromMissionState(
      draft,
      'opponent',
      groupPositions?.red?.ground,
      cullingManifest?.groundGroups.opponent,
      protectedGroundGroupIds
    )
    applyOmittedGroundDeaths(
      draft,
      'player',
      cullingManifest?.groundGroups.player,
      lostUnitNames
    )
    applyOmittedGroundDeaths(
      draft,
      'opponent',
      cullingManifest?.groundGroups.opponent,
      lostUnitNames
    )
    syncEwrGroupsFromMissionState(draft, 'player', groupPositions?.blue?.ground, lostUnits)
    syncEwrGroupsFromMissionState(draft, 'opponent', groupPositions?.red?.ground, lostUnits)
    syncNavalGroupsFromMissionState(draft, 'player', groupPositions?.blue?.ships, lostUnitNames)
    syncNavalGroupsFromMissionState(draft, 'opponent', groupPositions?.red?.ships, lostUnitNames)

    const scenario = scenarios.find((entry) => entry.id === draft.scenarioId)
    const theatre = scenario
      ? theatres.find((entry) => entry.name === scenario.theatreName)
      : undefined
    syncGermanySamLosses(draft, theatre, lostUnits, groupPositions)
    for (const coalition of ['player', 'opponent'] as const) {
      for (const group of [...draft.coalitions[coalition].groundGroups]) {
        const previousInfantry = infantryBefore.get(`${coalition}:${group.id}`) ?? 0
        const currentInfantry = group.units.reduce(
          (sum, unit) => sum + (classifyGroundUnit(unit.name) === 'infantry' ? unit.count : 0),
          0
        )
        const infantryLosses = Math.max(0, previousInfantry - currentInfantry)
        if (infantryLosses > 0 && group.objectiveId) {
          recordInfantryCasualties({
            campaign: draft,
            coalition,
            objectiveId: group.objectiveId,
            siteId: group.deployment?.siteId,
            position: group.position,
            count: infantryLosses,
            seed: `${missionState.missionId}:${group.id}`
          })
        }
        if (theatre) {
          beginGroundGroupRetreat({
            campaign: draft,
            coalition,
            theatre,
            group,
            blockedTransitIds: chokedObjectiveIds(draft, coalition)
          })
        }
      }

      for (const event of troopExtractions) {
        const request = draft.coalitions[coalition].extractionRequests?.find(
          (entry) => entry.id === event.requestId && entry.groundGroupId === event.groupId
        )
        if (!request) continue
        const group = draft.coalitions[coalition].groundGroups.find(
          (entry) => entry.id === request.groundGroupId
        )
        request.status = event.status
        if (event.status === 'delivered' && group) {
          dissolveGroundGroupIntoReplacementPool({
            campaign: draft,
            coalition,
            group,
            objectiveId: request.destinationObjectiveId
          })
        }
      }

      for (const event of casevacPickups) {
        if (!event.delivered) continue
        const point = draft.coalitions[coalition].casualtyPoints?.find(
          (entry) => entry.id === event.casualtyPointId
        )
        if (!point) continue
        const flight = draft.coalitions[coalition].flightGroups.find(
          (entry) => entry.callsign === event.flightGroupName
        )
        recoverCasualtyPoint({
          campaign: draft,
          coalition,
          casualtyPointId: point.id,
          destinationObjectiveId: flight?.destinationNode ?? point.objectiveId
        })
      }
    }

    if (lostUnitNames.size > 0) {
      for (const coalition of ['player', 'opponent'] as const) {
        for (const sam of draft.coalitions[coalition].samGroups) {
          const deadUnitIndexes = new Set(sam.deadUnitIndexes ?? [])
          let sawLostSamUnit = false

          for (const lostUnit of lostUnits) {
            sawLostSamUnit = addLostSamUnitIndex(sam, lostUnit, deadUnitIndexes) || sawLostSamUnit
          }

          if (deadUnitIndexes.size > 0) {
            sam.deadUnitIndexes = [...deadUnitIndexes].sort((a, b) => a - b)
          }

          const template = samTemplates[sam.type]
          if (template && template.units.every((_, index) => deadUnitIndexes.has(index))) {
            sam.destroyed = true
          } else if (sawLostSamUnit) {
            sam.destroyed = false
          }
        }

        for (const structure of draft.coalitions[coalition].structures) {
          const emittedStructures = cullingManifest?.structures[coalition]
          const liveBubble = draft.campaignParams?.worldMode === 'bubble'
          if (!liveBubble && emittedStructures && !emittedStructures[structure.id]) continue

          const namePrefix = `Static-${structure.id}-`
          for (const lostUnitName of lostUnitNames) {
            if (!lostUnitName.startsWith(namePrefix)) continue

            const buildingIndex = getGeneratedUnitIndex(lostUnitName)
            const building = buildingIndex != null ? structure.buildings[buildingIndex] : undefined
            if (building) {
              building.alive = false
            }
          }
        }
      }
    }

    updatePackages(draft, 'player')
    updatePackages(draft, 'opponent')

    const activePackageIds = new Set(
      (['player', 'opponent'] as const).flatMap((coalition) =>
        draft.coalitions[coalition].packages
          .filter((missionPackage) => missionPackage.status === 'active')
          .map((missionPackage) => missionPackage.id)
      )
    )
    draft.groundBattleLocks = (draft.groundBattleLocks ?? []).filter(
      (lock) => lock.expiresAt > draft.time && activePackageIds.has(lock.packageId)
    )
  })
}
