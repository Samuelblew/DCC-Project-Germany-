import { schemas } from '@dcc/contracts'
import {
  ensurePersistentIadsEwrs,
  ensureSupercarrierForAircraft,
  migrateFalklandsSanCarlosFarp,
  migrateLegacyFalklandsNavalStarts
} from '@dcc/campaign'
import {
  aircrafts as aircraftDefinitions,
  getCareerAircraft,
  scenarios,
  theatres,
  type CareerAircraft,
  type CareerPilotSkill
} from '@dcc/data'
import { createStore } from '@xstate/store'
import { produce } from 'immer'
import * as z from 'zod'

import {
  createDirectedAttack,
  type DirectedAttackTarget
} from '@/logic/systems/spawn/directed-attack'
import { hasFlightGroupTakenOff } from '@/logic/entities/flight-status'
import {
  abortCareerSortie,
  buyAirframe,
  buyWeapon,
  claimCareerMission,
  deleteCareerMission,
  deleteCareerPreset,
  getCareerAircraftTypes,
  hirePilot,
  launchCareerSortie,
  overhaulAirframe,
  releaseBareCareerSlots,
  repairAirframe,
  saveCareerPreset,
  sellAirframe,
  setCareerRadioPlan,
  type SortiePlan
} from '@/logic/career/career'
import { createManualFlightGroup } from '@/logic/systems/spawn/manual-flight-group'
import { rehomeCasForAircraftChange } from '@/logic/systems/rehome-farp-cas'

const initialState: z.infer<typeof schemas.campaign.campaign> = {
  time: new Date(),
  timeMultiplier: 1,
  status: 'active',
  goal: {
    coalition: 'player',
    objectiveIds: ['Enguri Dam']
  },
  name: 'Active Campaign',
  createdAt: new Date(),
  updatedAt: new Date(),
  id: crypto.randomUUID(),
  version: '0.0.1',
  campaignParams: {
    hotStart: false,
    aiWingmanSpawn: 'landOnly',
    culling: false,
    ewr: true,
    iads: true,
    exactTarget: true,
    casJtac: true,
    navigationVectors: true,
    navigationTargetTacan: false
  },
  logs: [],
  scenarioId: 'red-bullet',
  coalitions: {
    player: {
      id: 'usa-2004',
      groundUnitTypes: {
        SAM: [],
        Vehicle: [],
        Infantry: [],
        'Shorad Vehicle': [],
        'Shorad Infantry': [],
        EWS: []
      },
      airdromeNames: [],
      objectiveIds: [],
      aircraftTypes: {
        DEAD: [],
        AWACS: [],
        CAP: [],
        Escort: [],
        'Pinpoint Strike': [],
        'Strategic Strike': [],
        CAS: [],
        CSAR: [],
        'Air Assault': [],
        SEAD: [],
        Intercept: [],
        'Fighter Sweep': [],
        'Ground Attack': [],
        'Runway Attack': [],
        Transport: [],
        Refueling: [],
        RescueHelo: [],
        AFAC: [],
        'Antiship Strike': [],
        CASEVAC: [],
        'Troop Extraction': [],
        Training: [],
        ECM: []
      },
      structures: [],
      samGroups: [],
      flightGroups: [],
      groundGroups: [],
      packages: [],
      downedPilots: [],
      supplyNodes: {}
    },
    opponent: {
      id: 'russia-1996',
      groundUnitTypes: {
        SAM: [],
        Vehicle: [],
        Infantry: [],
        'Shorad Vehicle': [],
        'Shorad Infantry': [],
        EWS: []
      },
      airdromeNames: [],
      objectiveIds: [],
      aircraftTypes: {
        DEAD: [],
        AWACS: [],
        CAP: [],
        Escort: [],
        'Pinpoint Strike': [],
        'Strategic Strike': [],
        CAS: [],
        CSAR: [],
        'Air Assault': [],
        SEAD: [],
        Intercept: [],
        'Fighter Sweep': [],
        'Ground Attack': [],
        'Runway Attack': [],
        Transport: [],
        Refueling: [],
        RescueHelo: [],
        AFAC: [],
        'Antiship Strike': [],
        CASEVAC: [],
        'Troop Extraction': [],
        Training: [],
        ECM: []
      },
      structures: [],
      samGroups: [],
      flightGroups: [],
      groundGroups: [],
      packages: [],
      downedPilots: [],
      supplyNodes: {}
    }
  }
}

type Campaign = z.infer<typeof schemas.campaign.campaign>
type CoalitionData = Campaign['coalitions']['player']
type FlightGroup = CoalitionData['flightGroups'][number]
type MissionPackage = CoalitionData['packages'][number]
type AircraftName = z.infer<typeof schemas.dcs.aircraftName>
type EnemySkill = NonNullable<NonNullable<Campaign['campaignParams']>['enemySkill']>

function isAircraftTaskCompatible(
  aircraftType: AircraftName,
  task: FlightGroup['task'],
  options: { includeAiOnly?: boolean } = {}
) {
  return Object.values(aircraftDefinitions).some(
    (aircraft) =>
      aircraft.name === aircraftType &&
      (options.includeAiOnly === true || aircraft.controllable) &&
      schemas.aircraftSupportsTask(aircraft.availableTasks, task)
  )
}

function getTaskCompatibleAircraftTypes(
  aircraftTypes: CoalitionData['aircraftTypes'],
  task: FlightGroup['task']
) {
  return [
    ...new Set(
      Object.values(aircraftTypes)
        .flat()
        .filter((aircraftType): aircraftType is AircraftName => {
          const parsedAircraftType = schemas.dcs.aircraftName.safeParse(aircraftType)
          return (
            parsedAircraftType.success &&
            isAircraftTaskCompatible(parsedAircraftType.data, task, { includeAiOnly: true })
          )
        })
    )
  ]
}

function repairMissingDeadAircraftTypes(campaign: Campaign): Campaign {
  return produce(campaign, (draft) => {
    for (const coalition of [draft.coalitions.player, draft.coalitions.opponent]) {
      if ((coalition.aircraftTypes.DEAD ?? []).length === 0) {
        const deadAircraftTypes = getTaskCompatibleAircraftTypes(coalition.aircraftTypes, 'DEAD')
        if (deadAircraftTypes.length > 0) {
          coalition.aircraftTypes.DEAD = deadAircraftTypes
        }
      }

      const existingTypes = new Set<string>([
        ...Object.values(coalition.aircraftTypes).flat(),
        ...coalition.flightGroups.flatMap((group) =>
          group.aircrafts.map((aircraft) => aircraft.aircraftName)
        ),
        ...(coalition === draft.coalitions.player && draft.career
          ? [
              draft.career.preferredAircraft,
              ...(draft.career.airframes ?? []).map((entry) => entry.aircraftName)
            ]
          : [])
      ])
      if (existingTypes.has('AH-64D_BLK_II')) {
        for (const task of ['CAS', 'Ground Attack', 'Pinpoint Strike', 'DEAD', 'CSAR'] as const) {
          const list = coalition.aircraftTypes[task] ?? []
          if (!list.includes('AH-64D_BLK_II')) {
            coalition.aircraftTypes[task] = [...list, 'AH-64D_BLK_II']
          }
        }
      }
      if (existingTypes.has('AH-6J')) {
        for (const task of ['CAS', 'Ground Attack', 'Pinpoint Strike', 'DEAD', 'CSAR'] as const) {
          const list = coalition.aircraftTypes[task] ?? []
          if (!list.includes('AH-6J')) {
            coalition.aircraftTypes[task] = [...list, 'AH-6J']
          }
        }
      }
      if (existingTypes.has('MH-6J')) {
        for (const task of ['Transport', 'Air Assault', 'CSAR', 'CAS'] as const) {
          const list = coalition.aircraftTypes[task] ?? []
          if (!list.includes('MH-6J')) {
            coalition.aircraftTypes[task] = [...list, 'MH-6J']
          }
        }
      }
    }
  })
}

function hasLiveGroundUnits(group: Campaign['coalitions']['player']['groundGroups'][number]) {
  return group.units.reduce((sum, unit) => sum + Math.max(0, unit.count), 0) > 0
}

function addMs(date: Date | string, ms: number) {
  return new Date(new Date(date).getTime() + ms)
}

function ensureOriginalFlightGroupTiming(group: FlightGroup) {
  group.flightplan.originalStartTime ??= group.flightplan.startTime
  if (group.tot && !group.originalTot) {
    group.originalTot = group.tot
  }
}

function ensureOriginalPackageTiming(missionPackage: MissionPackage | undefined) {
  if (missionPackage && !missionPackage.originalTot) {
    missionPackage.originalTot = missionPackage.tot
  }
}

function shiftFlightGroupTiming(group: FlightGroup, deltaMs: number) {
  group.flightplan.startTime = addMs(group.flightplan.startTime, deltaMs)
  if (group.tot) {
    group.tot = addMs(group.tot, deltaMs)
  }
}

function restoreFlightGroupTiming(group: FlightGroup) {
  if (group.flightplan.originalStartTime) {
    group.flightplan.startTime = group.flightplan.originalStartTime
    group.flightplan.originalStartTime = undefined
  }

  if (group.originalTot) {
    group.tot = group.originalTot
    group.originalTot = undefined
  }
}

function restorePackageTiming(missionPackage: MissionPackage) {
  if (missionPackage.originalTot) {
    missionPackage.tot = missionPackage.originalTot
    missionPackage.originalTot = undefined
  }
}

function getFlightGroupPackageMembers(coalition: CoalitionData, group: FlightGroup) {
  if (!group.packageId) {
    return [group]
  }

  const packageMembers = coalition.flightGroups.filter(
    (candidate) => candidate.packageId === group.packageId
  )
  return packageMembers.length > 0 ? packageMembers : [group]
}

export function isEditableWaypoint(waypoint: z.infer<typeof schemas.waypoint>) {
  return waypoint.type !== 'TakeOff' && waypoint.type !== 'Landing'
}

export function isFlightRouteEditable(
  group: z.infer<typeof schemas.flightGroup>,
  campaignTime: Date
) {
  return !hasFlightGroupTakenOff(group, campaignTime)
}

function editableFlightGroup(draft: Campaign, flightGroupId: string) {
  const group = draft.coalitions.player.flightGroups.find((entry) => entry.id === flightGroupId)
  if (!group || !isFlightRouteEditable(group, draft.time)) return undefined
  return group
}

function syncPackageTimingForClientGroups(draft: Campaign) {
  const coalitions = [draft.coalitions.player, draft.coalitions.opponent]
  const allFlightGroups = coalitions.flatMap((coalition) => coalition.flightGroups)
  const groupsWithClients = allFlightGroups.filter((group) =>
    group.aircrafts.some((aircraft) => aircraft.client)
  )

  if (groupsWithClients.length === 0) {
    for (const coalition of coalitions) {
      for (const group of coalition.flightGroups) {
        restoreFlightGroupTiming(group)
      }
      for (const missionPackage of coalition.packages) {
        restorePackageTiming(missionPackage)
      }
    }
    return
  }

  const clientPackageIds = new Set(
    groupsWithClients.map((group) => group.packageId).filter((id): id is string => id != null)
  )

  for (const coalition of coalitions) {
    for (const group of coalition.flightGroups) {
      if (
        !group.aircrafts.some((aircraft) => aircraft.client) &&
        !clientPackageIds.has(group.packageId ?? '')
      ) {
        restoreFlightGroupTiming(group)
      }
    }

    for (const missionPackage of coalition.packages) {
      if (!clientPackageIds.has(missionPackage.id)) {
        restorePackageTiming(missionPackage)
      }
    }
  }

  if (groupsWithClients.length <= 1) {
    return
  }

  const earliestStartTime = groupsWithClients.reduce((earliest, group) => {
    const originalTime = group.flightplan.originalStartTime ?? group.flightplan.startTime
    return originalTime < earliest ? originalTime : earliest
  }, groupsWithClients[0]!.flightplan.originalStartTime ?? groupsWithClients[0]!.flightplan.startTime)

  const shiftedKeys = new Set<string>()

  for (const coalition of coalitions) {
    for (const clientGroup of coalition.flightGroups.filter((group) =>
      group.aircrafts.some((aircraft) => aircraft.client)
    )) {
      const packageKey = clientGroup.packageId ?? clientGroup.id
      const shiftKey = `${coalition.id}:${packageKey}`
      if (shiftedKeys.has(shiftKey)) {
        continue
      }
      shiftedKeys.add(shiftKey)

      const originalClientStart =
        clientGroup.flightplan.originalStartTime ?? clientGroup.flightplan.startTime
      const deltaMs = earliestStartTime.getTime() - new Date(originalClientStart).getTime()
      const packageMembers = getFlightGroupPackageMembers(coalition, clientGroup)
      const missionPackage = clientGroup.packageId
        ? coalition.packages.find((candidate) => candidate.id === clientGroup.packageId)
        : undefined

      for (const group of packageMembers) {
        ensureOriginalFlightGroupTiming(group)
        const currentStart = new Date(group.flightplan.startTime)
        const originalStart = new Date(
          group.flightplan.originalStartTime ?? group.flightplan.startTime
        )
        const desiredStart = addMs(originalStart, deltaMs)
        shiftFlightGroupTiming(group, desiredStart.getTime() - currentStart.getTime())
      }

      ensureOriginalPackageTiming(missionPackage)
      if (missionPackage) {
        const currentTot = new Date(missionPackage.tot)
        const originalTot = new Date(missionPackage.originalTot ?? missionPackage.tot)
        const desiredTot = addMs(originalTot, deltaMs)
        missionPackage.tot = addMs(currentTot, desiredTot.getTime() - currentTot.getTime())
      }
    }
  }
}

export function removeEmptyGroundGroups(campaign: Campaign): Campaign {
  return produce(campaign, (draft) => {
    draft.coalitions.player.groundGroups =
      draft.coalitions.player.groundGroups.filter(hasLiveGroundUnits)
    draft.coalitions.opponent.groundGroups =
      draft.coalitions.opponent.groundGroups.filter(hasLiveGroundUnits)
  })
}

function campaignTheatre(campaign: Campaign) {
  const scenario = scenarios.find((entry) => entry.id === campaign.scenarioId)
  return scenario ? theatres.find((entry) => entry.name === scenario.theatreName) : undefined
}

function migrateLoadedCampaign(campaign: Campaign): Campaign {
  return produce(campaign, (draft) => {
    releaseBareCareerSlots(draft)
    migrateLegacyFalklandsNavalStarts(draft)
    const theatre = campaignTheatre(draft)
    if (theatre) {
      ensurePersistentIadsEwrs(draft, theatre)
      migrateFalklandsSanCarlosFarp(draft, theatre)
    }
  })
}

export function resetFlightGroupClientSelections(campaign: Campaign) {
  return produce(campaign, (draft) => {
    const coalitions = [draft.coalitions.player, draft.coalitions.opponent]

    for (const coalition of coalitions) {
      for (const group of coalition.flightGroups) {
        for (const aircraft of group.aircrafts) {
          aircraft.client = false
        }

        if (group.flightplan.originalStartTime) {
          restoreFlightGroupTiming(group)
        }
      }

      for (const missionPackage of coalition.packages) {
        restorePackageTiming(missionPackage)
      }
    }
  })
}

/**
 * In career mode new flights use an owned aircraft type, from airfields where one of that type is
 * ready. The type defaults to the one the career screens open on.
 */
export function getCareerFlightConstraints(campaign: Campaign, aircraftType?: string) {
  const career = campaign.career
  if (!career) return undefined
  const type = schemas.dcs.aircraftName.safeParse(aircraftType).data ?? career.preferredAircraft
  const homeBases = new Set(
    career.airframes
      .filter((airframe) => airframe.status === 'ready' && airframe.aircraftName === type)
      .map((airframe) => airframe.location)
  )
  return { homeBases, aircraftType: type }
}

function resetClientSlots(draft: Campaign) {
  for (const flightGroup of draft.coalitions.player.flightGroups) {
    for (const aircraft of flightGroup.aircrafts) aircraft.client = false
  }
}

/** Flights of the career's aircraft types are crewed only through a sortie, never a bare slot. */
export function isCareerCrewedOnly(campaign: Campaign, group: FlightGroup) {
  const career = campaign.career
  if (!career) return false
  const careerTypes = getCareerAircraftTypes(career)
  return (
    group.careerMission === true ||
    group.aircrafts.some((aircraft) => careerTypes.has(aircraft.aircraftName))
  )
}

function airframeType(campaign: Campaign, airframeId: string) {
  return campaign.career?.airframes.find((airframe) => airframe.id === airframeId)?.aircraftName
}

/**
 * Runs a career action inside an immer draft; actions that fail leave the campaign unchanged. The
 * action works on `aircraftName`, or on the type the career screens open on.
 */
function withCareer(
  context: Campaign,
  action: (draft: Campaign, aircraft: CareerAircraft) => { ok: boolean; reason?: string },
  aircraftName?: string
) {
  if (!context.career) return context
  const aircraft = getCareerAircraft(aircraftName ?? context.career.preferredAircraft)
  if (!aircraft) return context
  let succeeded = false
  const next = produce(context, (draft) => {
    const result = action(draft, aircraft)
    succeeded = result.ok
    if (!result.ok) console.warn('Career action refused:', result.reason)
  })
  return succeeded ? next : context
}

export const activeStore = createStore({
  context: initialState,
  on: {
    loadCampaign: (_, { campaign }: { campaign: Campaign }) =>
      migrateLoadedCampaign(repairMissingDeadAircraftTypes(removeEmptyGroundGroups(campaign))),

    updateTime: (context, { time }: { time: Date }) =>
      produce(context, (draft) => {
        draft.time = time
      }),
    updateTimeMultiplier: (context, { timeMultiplier }: { timeMultiplier: number }) =>
      produce(context, (draft) => {
        draft.timeMultiplier = timeMultiplier
      }),
    setTimeTarget: (context, { timeTarget }: { timeTarget: Date | undefined }) =>
      produce(context, (draft) => {
        draft.timeTarget = timeTarget
      }),
    setHotStart: (context, { hotStart }: { hotStart: boolean }) =>
      produce(context, (draft) => {
        if (!draft.campaignParams) {
          draft.campaignParams = {}
        }
        draft.campaignParams.hotStart = hotStart
      }),
    setAiWingmanSpawn: (
      context,
      {
        aiWingmanSpawn
      }: {
        aiWingmanSpawn: NonNullable<NonNullable<Campaign['campaignParams']>['aiWingmanSpawn']>
      }
    ) =>
      produce(context, (draft) => {
        if (!draft.campaignParams) {
          draft.campaignParams = {}
        }
        draft.campaignParams.aiWingmanSpawn = aiWingmanSpawn
      }),
    setWorldMode: (context, { worldMode }: { worldMode: 'corridor' | 'bubble' }) =>
      produce(context, (draft) => {
        if (!draft.campaignParams) {
          draft.campaignParams = {}
        }
        draft.campaignParams.worldMode = worldMode
      }),
    setCulling: (context, { culling }: { culling: boolean }) =>
      produce(context, (draft) => {
        if (!draft.campaignParams) {
          draft.campaignParams = {}
        }
        draft.campaignParams.culling = culling
      }),
    setCullingRadius: (context, { meters }: { meters: number }) =>
      produce(context, (draft) => {
        if (!draft.campaignParams) {
          draft.campaignParams = {}
        }
        draft.campaignParams.cullingRadius = meters
      }),
    setCullingAircraftRadius: (context, { meters }: { meters: number }) =>
      produce(context, (draft) => {
        if (!draft.campaignParams) {
          draft.campaignParams = {}
        }
        draft.campaignParams.cullingAircraftRadius = meters
      }),
    setCullingSamRadius: (context, { meters }: { meters: number }) =>
      produce(context, (draft) => {
        if (!draft.campaignParams) {
          draft.campaignParams = {}
        }
        draft.campaignParams.cullingSamRadius = meters
      }),
    moveWaypoint: (
      context,
      {
        flightGroupId,
        index,
        position
      }: { flightGroupId: string; index: number; position: { x: number; y: number } }
    ) =>
      produce(context, (draft) => {
        const group = editableFlightGroup(draft, flightGroupId)
        const waypoint = group?.flightplan.waypoints[index]
        if (!waypoint || !isEditableWaypoint(waypoint)) return
        waypoint.position = { x: position.x, y: position.y }
      }),
    insertWaypoint: (
      context,
      {
        flightGroupId,
        afterIndex,
        position
      }: { flightGroupId: string; afterIndex: number; position: { x: number; y: number } }
    ) =>
      produce(context, (draft) => {
        const group = editableFlightGroup(draft, flightGroupId)
        if (!group) return
        const waypoints = group.flightplan.waypoints
        const previous = waypoints[afterIndex]
        const next = waypoints[afterIndex + 1]
        if (!previous || !next) return
        waypoints.splice(afterIndex + 1, 0, {
          name: 'Nav',
          position: { x: position.x, y: position.y },
          altitude: Math.max(previous.altitude, next.altitude),
          altitudeType: previous.altitudeType ?? next.altitudeType,
          speed: Math.max(previous.speed, next.speed),
          type: 'Nav'
        })
      }),
    removeWaypoint: (context, { flightGroupId, index }: { flightGroupId: string; index: number }) =>
      produce(context, (draft) => {
        const group = editableFlightGroup(draft, flightGroupId)
        const waypoint = group?.flightplan.waypoints[index]
        if (!group || !waypoint || waypoint.type !== 'Nav') return
        group.flightplan.waypoints.splice(index, 1)
      }),
    setEwr: (context, { ewr }: { ewr: boolean }) =>
      produce(context, (draft) => {
        if (!draft.campaignParams) {
          draft.campaignParams = {}
        }
        draft.campaignParams.ewr = ewr
      }),
    setEnemySkill: (context, { enemySkill }: { enemySkill: EnemySkill | undefined }) =>
      produce(context, (draft) => {
        if (!draft.campaignParams) {
          draft.campaignParams = {}
        }
        draft.campaignParams.enemySkill = enemySkill
      }),
    setImmersion: (
      context,
      { settings }: { settings: NonNullable<NonNullable<Campaign['campaignParams']>['immersion']> }
    ) =>
      produce(context, (draft) => {
        draft.campaignParams ??= {}
        draft.campaignParams.immersion = { ...draft.campaignParams.immersion, ...settings }
      }),
    setPriorities: (context, { priorities }: { priorities: NonNullable<Campaign['priorities']> }) =>
      produce(context, (draft) => {
        draft.priorities = priorities
      }),
    /** A package support request, already applied to a copy of the campaign. */
    packageSupportAdded: (_, { campaign }: { campaign: Campaign }) => campaign,
    setFogOfWar: (context, { fogOfWar }: { fogOfWar: boolean }) =>
      produce(context, (draft) => {
        draft.campaignParams ??= {}
        draft.campaignParams.fogOfWar = fogOfWar
      }),
    setAirActivity: (context, { airActivity }: { airActivity: number }) =>
      produce(context, (draft) => {
        if (!draft.campaignParams) {
          draft.campaignParams = {}
        }
        draft.campaignParams.airActivity = airActivity
      }),
    setIads: (context, { iads }: { iads: boolean }) =>
      produce(context, (draft) => {
        if (!draft.campaignParams) {
          draft.campaignParams = {}
        }
        draft.campaignParams.iads = iads
      }),
    setExactTarget: (context, { exactTarget }: { exactTarget: boolean }) =>
      produce(context, (draft) => {
        if (!draft.campaignParams) {
          draft.campaignParams = {}
        }
        draft.campaignParams.exactTarget = exactTarget
      }),
    setCasJtac: (context, { casJtac }: { casJtac: boolean }) =>
      produce(context, (draft) => {
        if (!draft.campaignParams) {
          draft.campaignParams = {}
        }
        draft.campaignParams.casJtac = casJtac
      }),
    setNavigationVectors: (context, { enabled }: { enabled: boolean }) =>
      produce(context, (draft) => {
        if (!draft.campaignParams) {
          draft.campaignParams = {}
        }
        draft.campaignParams.navigationVectors = enabled
      }),
    setNavigationTargetTacan: (context, { enabled }: { enabled: boolean }) =>
      produce(context, (draft) => {
        if (!draft.campaignParams) {
          draft.campaignParams = {}
        }
        draft.campaignParams.navigationTargetTacan = enabled
      }),
    setDcsCheat: (
      context,
      {
        key,
        value
      }: {
        key: keyof NonNullable<NonNullable<Campaign['campaignParams']>['dcsCheats']>
        value: boolean | NonNullable<NonNullable<Campaign['campaignParams']>['dcsCheats']>['labels']
      }
    ) =>
      produce(context, (draft) => {
        if (!draft.campaignParams) {
          draft.campaignParams = {}
        }
        draft.campaignParams.dcsCheats ??= {}
        if (key === 'labels') {
          draft.campaignParams.dcsCheats.labels =
            value === 'full' || value === 'abbreviated' || value === 'dot' ? value : 'none'
          return
        }
        const flag = key
        draft.campaignParams.dcsCheats[flag] = value === true
      }),
    tick: (
      context,
      { delta: _delta, logic }: { delta: number; logic: (draft: typeof context) => void }
    ) =>
      produce(context, (draft) => {
        logic(draft)
        draft.coalitions.player.groundGroups =
          draft.coalitions.player.groundGroups.filter(hasLiveGroundUnits)
        draft.coalitions.opponent.groundGroups =
          draft.coalitions.opponent.groundGroups.filter(hasLiveGroundUnits)
      }),

    removeAllFlightGroups: (context) =>
      produce(context, (draft) => {
        draft.coalitions.player.flightGroups = []
        draft.coalitions.opponent.flightGroups = []
      }),
    clearLogs: (context) =>
      produce(context, (draft) => {
        draft.logs = []
      }),
    clearFlightGroupClientSelections: (context) =>
      resetFlightGroupClientSelections(
        context.career?.sortie ? produce(context, (draft) => abortCareerSortie(draft)) : context
      ),
    careerBuyAirframe: (
      context,
      { condition, aircraftName }: { condition: 'new' | 'used'; aircraftName?: string }
    ) =>
      withCareer(
        context,
        (draft, aircraft) => {
          const theatre = campaignTheatre(draft)
          if (!theatre) return { ok: false, reason: 'Unknown theatre' }
          return buyAirframe(draft, theatre, aircraft, condition)
        },
        aircraftName
      ),
    careerSellAirframe: (context, { airframeId }: { airframeId: string }) =>
      withCareer(
        context,
        (draft, aircraft) => sellAirframe(draft.career!, aircraft, airframeId, draft.time),
        airframeType(context, airframeId)
      ),
    careerRepair: (context, { airframeId }: { airframeId: string }) =>
      withCareer(
        context,
        (draft, aircraft) => repairAirframe(draft.career!, aircraft, airframeId, draft.time),
        airframeType(context, airframeId)
      ),
    careerOverhaul: (context, { airframeId }: { airframeId: string }) =>
      withCareer(
        context,
        (draft, aircraft) => overhaulAirframe(draft.career!, aircraft, airframeId, draft.time),
        airframeType(context, airframeId)
      ),
    careerHirePilot: (context, { skill }: { skill: CareerPilotSkill }) =>
      withCareer(context, (draft) => hirePilot(draft.career!, skill, draft.time)),
    careerBuyWeapon: (
      context,
      { weaponId, count, aircraftName }: { weaponId: string; count: number; aircraftName?: string }
    ) =>
      withCareer(
        context,
        (draft, aircraft) => buyWeapon(draft.career!, aircraft, weaponId, count, draft.time),
        aircraftName
      ),
    careerLaunchSortie: (context, { plan }: { plan: SortiePlan }) =>
      withCareer(context, (draft) => {
        const group = draft.coalitions.player.flightGroups.find((g) => g.id === plan.flightGroupId)
        // Crewing a new sortie stands the previous one down and returns its stores.
        if (draft.career?.sortie) {
          abortCareerSortie(draft)
          resetClientSlots(draft)
        }
        if (group && !group.flightplan.originalStartTime) {
          group.flightplan.originalStartTime = group.flightplan.startTime
        }
        const result = launchCareerSortie(draft, plan)
        if (result.ok) syncPackageTimingForClientGroups(draft)
        return result
      }),
    careerSavePreset: (
      context,
      {
        preset,
        aircraftName
      }: {
        preset: { id?: string; name: string; pylons: Array<{ num: number; CLSID: string }> }
        aircraftName?: string
      }
    ) =>
      withCareer(
        context,
        (draft, aircraft) => saveCareerPreset(draft.career!, aircraft, preset),
        aircraftName
      ),
    careerDeletePreset: (context, { presetId }: { presetId: string }) =>
      withCareer(context, (draft) => deleteCareerPreset(draft.career!, presetId)),
    careerSetRadio: (
      context,
      { plan, aircraftName }: { plan: z.infer<typeof schemas.radioPlan>; aircraftName?: string }
    ) =>
      withCareer(
        context,
        (draft, aircraft) => setCareerRadioPlan(draft.career!, aircraft, plan),
        aircraftName
      ),
    careerDeleteMission: (context, { flightGroupId }: { flightGroupId: string }) =>
      withCareer(context, (draft) => deleteCareerMission(draft, flightGroupId)),
    careerAbortSortie: (context) =>
      produce(context, (draft) => {
        abortCareerSortie(draft)
      }),
    createManualPlayerFlightGroup: (
      context,
      {
        task,
        homeBase,
        aircraftType
      }: { task: z.infer<typeof schemas.task>; homeBase?: string; aircraftType?: string }
    ) =>
      produce(context, (draft) => {
        const constraints = getCareerFlightConstraints(draft, aircraftType)
        const flightGroupId = createManualFlightGroup(
          draft,
          'player',
          task,
          constraints && homeBase ? { ...constraints, homeBases: new Set([homeBase]) } : constraints
        )
        if (flightGroupId && draft.career) claimCareerMission(draft, flightGroupId)
      }),

    createDirectedAttack: (context, { target }: { target: DirectedAttackTarget }) =>
      produce(context, (draft) => {
        const flightGroupId = createDirectedAttack(draft, target)
        if (flightGroupId && draft.career) claimCareerMission(draft, flightGroupId)
      }),

    setPlayerParkingStand: (
      context,
      { flightGroupId, parkingStandId }: { flightGroupId: string; parkingStandId?: string }
    ) =>
      produce(context, (draft) => {
        const group = draft.coalitions.player.flightGroups.find(
          (entry) => entry.id === flightGroupId
        )
        if (!group) return
        if (parkingStandId) group.parkingStandId = parkingStandId
        else delete group.parkingStandId
      }),

    setFlightGroupClientCount: (
      context,
      { flightGroupId, count }: { flightGroupId: string; count: number }
    ) => {
      // Career aircraft are only flown through a sortie (the Ops dialog), which arms them from stock.
      const target = context.coalitions.player.flightGroups.find((g) => g.id === flightGroupId)
      if (count > 0 && target && isCareerCrewedOnly(context, target)) return context
      return produce(context, (draft) => {
        // Career flights are crewed through a sortie; changing the slots cancels it.
        if (draft.career?.sortie) abortCareerSortie(draft)
        const coalitions = [draft.coalitions.player, draft.coalitions.opponent]

        for (const coalition of coalitions) {
          const group = coalition.flightGroups.find((g) => g.id === flightGroupId)
          if (group) {
            const hadClient = group.aircrafts.some((ac) => ac.client)
            const willHaveClient = count > 0

            // Store original start time before first client is added
            if (!hadClient && willHaveClient && !group.flightplan.originalStartTime) {
              group.flightplan.originalStartTime = group.flightplan.startTime
            }

            // Update client status
            group.aircrafts.forEach((aircraft, index) => {
              aircraft.client = index < count
            })

            break
          }
        }

        syncPackageTimingForClientGroups(draft)
      })
    },

    setFlightGroupAircraftType: (
      context,
      { flightGroupId, aircraftType }: { flightGroupId: string; aircraftType: string }
    ) => {
      // A player slot cannot be turned into a career aircraft type outside a sortie.
      const target = context.coalitions.player.flightGroups.find((g) => g.id === flightGroupId)
      if (
        context.career &&
        getCareerAircraftTypes(context.career).has(aircraftType) &&
        target?.aircrafts.some((aircraft) => aircraft.client)
      ) {
        return context
      }
      return produce(context, (draft) => {
        const coalitions = [
          { key: 'player' as const, data: draft.coalitions.player },
          { key: 'opponent' as const, data: draft.coalitions.opponent }
        ]

        for (const coalition of coalitions) {
          const group = coalition.data.flightGroups.find((g) => g.id === flightGroupId)
          if (!group) {
            continue
          }

          const parsedAircraftType = schemas.dcs.aircraftName.safeParse(aircraftType)
          if (
            !parsedAircraftType.success ||
            !isAircraftTaskCompatible(parsedAircraftType.data, group.task)
          ) {
            break
          }

          if (!rehomeCasForAircraftChange(draft, coalition.key, group, parsedAircraftType.data)) {
            break
          }

          group.aircrafts.forEach((aircraft) => {
            aircraft.aircraftName = parsedAircraftType.data
          })

          const aircraftDefinition = Object.values(aircraftDefinitions).find(
            (aircraft) => aircraft.name === parsedAircraftType.data
          )
          if (coalition.key === 'player' && aircraftDefinition) {
            ensureSupercarrierForAircraft(draft, coalition.key, aircraftDefinition)
          }

          break
        }
      })
    }
  }
})

type ActiveStoreEvent = Parameters<typeof activeStore.send>[0]
type ActiveCampaignSaveRequestListener = (event: ActiveStoreEvent) => void

const activeCampaignSaveRequestEventTypes = new Set<string>([
  'setHotStart',
  'setWorldMode',
  'setCulling',
  'setEwr',
  'setIads',
  'setEnemySkill',
  'setAirActivity',
  'setPriorities',
  'setFogOfWar',
  'packageSupportAdded',
  'setImmersion',
  'setExactTarget',
  'setCasJtac',
  'setNavigationVectors',
  'setNavigationTargetTacan',
  'setDcsCheat',
  'removeAllFlightGroups',
  'clearLogs',
  'clearFlightGroupClientSelections',
  'createManualPlayerFlightGroup',
  'createDirectedAttack',
  'setFlightGroupClientCount',
  'setPlayerParkingStand',
  'setFlightGroupAircraftType',
  'careerBuyAirframe',
  'careerSellAirframe',
  'careerRepair',
  'careerOverhaul',
  'careerHirePilot',
  'careerBuyWeapon',
  'careerLaunchSortie',
  'careerAbortSortie',
  'careerSavePreset',
  'careerDeletePreset',
  'careerDeleteMission',
  'careerSetRadio'
])

const activeCampaignSaveRequestListeners = new Set<ActiveCampaignSaveRequestListener>()
const sendActiveStoreEvent = activeStore.send.bind(activeStore)

activeStore.send = ((event: ActiveStoreEvent) => {
  sendActiveStoreEvent(event)

  if (activeCampaignSaveRequestEventTypes.has(event.type)) {
    activeCampaignSaveRequestListeners.forEach((listener) => listener(event))
  }
}) as typeof activeStore.send

export function onActiveCampaignSaveRequest(listener: ActiveCampaignSaveRequestListener) {
  activeCampaignSaveRequestListeners.add(listener)

  return () => {
    activeCampaignSaveRequestListeners.delete(listener)
  }
}
