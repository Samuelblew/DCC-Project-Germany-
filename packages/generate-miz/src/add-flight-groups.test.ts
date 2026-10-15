import { schemas } from '@dcc/contracts'
import { scenarios } from '@dcc/data'
import { describe, expect, test, vi } from 'vitest'
import * as z from 'zod'

import { addFlightGroups } from './add-flight-groups'
import { addNavalGroups } from './add-naval-groups'

type Campaign = z.infer<typeof schemas.campaign.campaign>
type CampaignCoalition = Campaign['coalitions']['player']
type FlightGroup = z.infer<typeof schemas.flightGroup>
type Mission = z.infer<typeof schemas.dcs.mission>
type Theatre = z.infer<typeof schemas.theatre>
type AircraftUnit = z.infer<typeof schemas.dcs.aircraftUnit>

function createMission(): Mission {
  return {
    version: 23,
    theatre: 'Caucasus',
    currentKey: 100,
    maxDictId: 1,
    start_time: 0,
    date: { Day: 1, Month: 1, Year: 2026 },
    weather: {
      atmosphere_type: 0,
      wind: {
        at8000: { speed: 0, dir: 0 },
        atGround: { speed: 0, dir: 0 },
        at2000: { speed: 0, dir: 0 }
      },
      enable_dust: false,
      dust_density: 0,
      qnh: 760,
      groundTurbulence: 0,
      type_weather: 0,
      season: { temperature: 20 },
      visibility: { distance: 80000 },
      clouds: { density: 0, thickness: 200, base: 2500, iprecptns: 0 }
    },
    map: { centerY: 0, zoom: 1, centerX: 0 },
    coalitions: { neutrals: [], blue: [2], red: [0] },
    coalition: {
      neutrals: { bullseye: { x: 0, y: 0 }, nav_points: [], name: 'neutrals', country: [] },
      blue: {
        bullseye: { x: 0, y: 0 },
        nav_points: [],
        name: 'blue',
        country: [{ id: 2, name: 'USA', plane: { group: [] } }]
      },
      red: {
        bullseye: { x: 0, y: 0 },
        nav_points: [],
        name: 'red',
        country: [{ id: 0, name: 'Russia', plane: { group: [] } }]
      }
    },
    result: { total: 0, offline: {}, blue: {}, red: {} }
  }
}

function createFlightGroup(id: string, callsign: string, startTime: Date): FlightGroup {
  return {
    id,
    aircrafts: [1, 2].map((unitNumber) => ({
      id: `${id}-${unitNumber}`,
      unitName: `${callsign}-${unitNumber}`,
      aircraftName: 'F-16C_50'
    })),
    task: 'CAP',
    position: { x: 1000, y: 1000 },
    homeBase: 'Test Base',
    callsign,
    flightplan: {
      id: `${id}-plan`,
      startTime,
      waypoints: [
        {
          name: 'Take Off',
          position: { x: 1000, y: 1000 },
          altitude: 0,
          speed: 150,
          type: 'TakeOff'
        },
        {
          name: 'CAP',
          position: { x: 2000, y: 2000 },
          altitude: 6000,
          speed: 220,
          type: 'Task'
        },
        {
          name: 'Landing',
          position: { x: 1000, y: 1000 },
          altitude: 0,
          speed: 150,
          type: 'Landing'
        }
      ]
    }
  }
}

function createClientCasFlightGroup(startTime: Date): FlightGroup {
  const group = createFlightGroup('blue-cas', 'Enfield-1', startTime)
  group.task = 'CAS'
  group.aircrafts[0]!.client = true
  group.target = {
    id: 'ground-1',
    type: 'Ground Group',
    objectiveId: 'objective-1'
  }
  return group
}

function createTaskFlightGroup(
  id: string,
  callsign: string,
  startTime: Date,
  task: FlightGroup['task']
): FlightGroup {
  const group = createFlightGroup(id, callsign, startTime)
  group.task = task
  group.flightplan.waypoints[1] = {
    ...group.flightplan.waypoints[1]!,
    name: task,
    type: 'Task'
  }
  return group
}

function createCampaign(startTime: Date): Campaign {
  const createAircraftTypes = (): CampaignCoalition['aircraftTypes'] =>
    Object.fromEntries(
      schemas.task.options.map((task) => [task, [] as string[]])
    ) as unknown as CampaignCoalition['aircraftTypes']

  const createGroundUnitTypes = (): CampaignCoalition['groundUnitTypes'] =>
    Object.fromEntries(
      schemas.groundUnitType.options.map((type) => [type, [] as string[]])
    ) as unknown as CampaignCoalition['groundUnitTypes']

  const emptyCoalition: CampaignCoalition = {
    id: 'empty',
    aircraftTypes: createAircraftTypes(),
    groundUnitTypes: createGroundUnitTypes(),
    airdromeNames: [],
    objectiveIds: [],
    structures: [],
    samGroups: [],
    groundGroups: [],
    flightGroups: [],
    packages: []
  }

  return {
    version: 'test',
    id: 'campaign',
    name: 'Campaign',
    createdAt: startTime,
    updatedAt: startTime,
    time: startTime,
    timeMultiplier: 1,
    logs: [],
    scenarioId: 'scenario',
    coalitions: {
      player: {
        ...emptyCoalition,
        id: 'player',
        flightGroups: ['Enfield-1', 'Chevy-2', 'Ford-3', 'Colt-4', 'Uzi-5'].map((callsign, index) =>
          createFlightGroup(`blue-${index + 1}`, callsign, startTime)
        )
      },
      opponent: {
        ...emptyCoalition,
        id: 'opponent',
        flightGroups: [createFlightGroup('red-1', 'Springfield-1', startTime)]
      }
    }
  }
}

const theatre: Theatre = {
  name: 'Caucasus',
  objectives: [],
  targets: {},
  airdromeDetails: {},
  info: {
    center: { x: 0, y: 0 },
    weather: {
      temperature: { amplitude: 0, mean: 20 },
      cloudCover: { baseCloudCover: 0, seasonEffect: 0 },
      wind: { speed: 0, direction: 0 }
    },
    night: { startHour: 20, endHour: 6 }
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function getStationNumber(unit: AircraftUnit): unknown {
  const addPropAircraft = unit.AddPropAircraft as unknown
  if (!isRecord(addPropAircraft)) return undefined

  return addPropAircraft.STN_L16
}

function getLink16Network(unit: AircraftUnit): { teamMembers: unknown; donors: unknown } {
  const datalinks = unit.datalinks as unknown
  expect(isRecord(datalinks)).toBe(true)
  if (!isRecord(datalinks)) throw new Error('expected datalinks record')

  const link16 = datalinks.Link16
  expect(isRecord(link16)).toBe(true)
  if (!isRecord(link16)) throw new Error('expected Link16 record')

  const network = link16.network
  expect(isRecord(network)).toBe(true)
  if (!isRecord(network)) throw new Error('expected Link16 network record')

  return {
    teamMembers: network.teamMembers,
    donors: network.donors
  }
}

function getMissionUnitIds(entries: unknown): number[] {
  expect(Array.isArray(entries)).toBe(true)
  if (!Array.isArray(entries)) throw new Error('expected mission unit id entries')

  return entries.map((entry) => {
    expect(isRecord(entry)).toBe(true)
    if (!isRecord(entry)) throw new Error('expected mission unit id entry')

    expect(typeof entry.missionUnitId).toBe('number')
    return entry.missionUnitId as number
  })
}

describe('addFlightGroups carrier compatibility', () => {
  test('spawns carriers facing into the surface wind used by their startup route', () => {
    const startTime = new Date('2026-01-01T00:00:00Z')
    const mission = createMission()
    const campaign = createCampaign(startTime)
    mission.weather.wind.atGround = { speed: 9, dir: 170 }
    campaign.coalitions.player.navalGroups = [
      {
        id: 'uk-carrier-group',
        name: 'UK Carrier Group',
        role: 'carrier',
        unitTypes: ['hms_invincible'],
        position: { x: 1_000, y: 1_000 },
        heading: (270 * Math.PI) / 180,
        damage: 0,
        fuel: 1,
        ammunition: 1,
        cargo: 0,
        state: 'operational'
      }
    ]

    const result = addNavalGroups(mission, campaign)

    expect(result.isOk()).toBe(true)
    expect(mission.coalition.blue.country?.[0]?.ship?.group[0]?.units[0]?.heading).toBeCloseTo(
      (350 * Math.PI) / 180
    )
  })

  test('emits the Falklands escort screen in the carrier DCS group', () => {
    const startTime = new Date('1982-05-01T09:00:00Z')
    const mission = createMission()
    const campaign = createCampaign(startTime)
    const scenario = scenarios.find((candidate) => candidate.id === 'falklands-1982')
    if (!scenario) throw new Error('Falklands scenario is missing')
    campaign.scenarioId = scenario.id
    campaign.coalitions.player.navalGroups = structuredClone(scenario.navalGroups?.player ?? [])
    campaign.coalitions.opponent.navalGroups = []

    const result = addNavalGroups(mission, campaign)

    expect(result.isOk()).toBe(true)
    const shipGroups = mission.coalition.blue.country?.[0]?.ship?.group ?? []
    expect(shipGroups.map((group) => group.name)).toEqual([
      'NavalGroup-uk-carrier-group',
      'NavalGroup-uk-amphibious-group'
    ])
    expect(shipGroups[0]?.units.map((unit) => unit.type)).toEqual([
      'LHA_Tarawa',
      'leander-gun-achilles',
      'leander-gun-andromeda',
      'leander-gun-ariadne'
    ])
    const carrierRouteTask = JSON.stringify(shipGroups[0]?.route?.points[0]?.task)
    expect(carrierRouteTask).toContain('"id":"ActivateBeacon"')
    expect(carrierRouteTask).toContain('"channel":11')
    expect(carrierRouteTask).toContain('"modeChannel":"X"')
    expect(carrierRouteTask).toContain('"callsign":"HMS"')
    expect(carrierRouteTask).toContain('"system":3')
    expect(carrierRouteTask).toContain('"frequency":972000000')
  })

  test('sends the Falklands surface group around a slow circular patrol', () => {
    const startTime = new Date('1982-05-01T09:00:00Z')
    const mission = createMission()
    const campaign = createCampaign(startTime)
    const scenario = scenarios.find((candidate) => candidate.id === 'falklands-1982')
    if (!scenario) throw new Error('Falklands scenario is missing')
    campaign.scenarioId = scenario.id
    campaign.coalitions.player.navalGroups = []
    campaign.coalitions.opponent.navalGroups = structuredClone(scenario.navalGroups?.opponent ?? [])

    const result = addNavalGroups(mission, campaign)

    expect(result.isOk()).toBe(true)
    const surfaceGroup = mission.coalition.red.country?.[0]?.ship?.group?.find(
      (group) => group.name === 'NavalGroup-arg-surface-group'
    )
    const points = surfaceGroup?.route?.points ?? []
    expect(surfaceGroup?.units.map((unit) => unit.type)).toEqual([
      'leander-gun-achilles',
      'leander-gun-andromeda',
      'leander-gun-ariadne'
    ])
    expect(points).toHaveLength(9)
    expect(points.every((point) => point.speed === 3)).toBe(true)
    expect(points.map((point) => point.ETA_locked)).toEqual([
      true,
      false,
      false,
      false,
      false,
      false,
      false,
      false,
      false
    ])
    expect(points[0]).toMatchObject({ x: -22_010, y: -8_141 })
    expect(points.at(-1)?.x).toBeCloseTo(points[0]!.x)
    expect(points.at(-1)?.y).toBeCloseTo(points[0]!.y)
    expect(points.at(-1)?.task).toMatchObject({
      params: {
        tasks: [
          {
            params: {
              action: {
                id: 'SwitchWaypoint',
                params: { fromWaypointIndex: 9, goToWaypointIndex: 2 }
              }
            }
          }
        ]
      }
    })
  })

  test.each([
    ['FA-18C_hornet', 'CVN_71', { channel: 12, band: 'X', callsign: 'CVN' }],
    ['AV8BNA', 'LHA_Tarawa', { channel: 11, band: 'X', callsign: 'LHA' }]
  ] as const)(
    'links %s to a compatible ship in a mixed carrier group',
    (aircraftType, shipType, expectedTacan) => {
      const startTime = new Date('2026-01-01T00:00:00Z')
      const mission = createMission()
      const campaign = createCampaign(startTime)
      const flightGroup = createFlightGroup('carrier-flight', 'Ford-1', startTime)
      flightGroup.homeBase = 'uk-carrier-group'
      flightGroup.aircrafts[0]!.client = true
      flightGroup.aircrafts.forEach((aircraft) => {
        aircraft.aircraftName = aircraftType
      })
      campaign.coalitions.player.flightGroups = [flightGroup]
      campaign.coalitions.opponent.flightGroups = []
      campaign.coalitions.player.navalGroups = [
        {
          id: 'uk-carrier-group',
          name: 'UK Carrier Group',
          role: 'carrier',
          unitTypes: ['LHA_Tarawa', 'CVN_71'],
          units: [
            {
              id: 'tarawa',
              type: 'LHA_Tarawa',
              damage: 0,
              ammunition: 1,
              fuel: 1,
              tacan: { channel: 11, band: 'X', callsign: 'LHA' },
              state: 'operational'
            },
            {
              id: 'supercarrier',
              type: 'CVN_71',
              damage: 0,
              ammunition: 1,
              fuel: 1,
              tacan: { channel: 12, band: 'X', callsign: 'CVN' },
              state: 'operational'
            }
          ],
          position: { x: 1_000, y: 1_000 },
          heading: 0,
          damage: 0,
          fuel: 1,
          ammunition: 1,
          cargo: 0,
          state: 'operational'
        }
      ]

      const navalResult = addNavalGroups(mission, campaign)
      expect(navalResult.isOk()).toBe(true)
      if (navalResult.isErr()) throw navalResult.error

      const carrierMissionGroup = mission.coalition.blue.country?.[0]?.ship?.group[0]
      expect(carrierMissionGroup).toMatchObject({
        communication: true,
        frequency: 250,
        modulation: 0
      })
      const expectedCarrier = carrierMissionGroup?.units.find((unit) => unit.type === shipType)
      expect(expectedCarrier).toBeDefined()
      const carrierRouteTask = JSON.stringify(carrierMissionGroup?.route?.points[0]?.task)
      expect(carrierRouteTask.match(/"id":"ActivateBeacon"/g)).toHaveLength(2)
      expect(carrierRouteTask).toContain('"channel":11')
      expect(carrierRouteTask).toContain('"callsign":"LHA"')
      expect(carrierRouteTask).toContain('"channel":12')
      expect(carrierRouteTask).toContain('"callsign":"CVN"')

      const flightResult = addFlightGroups(mission, campaign, theatre)
      expect(flightResult.isOk()).toBe(true)
      if (flightResult.isErr()) throw flightResult.error

      const emittedFlight = mission.coalition.blue.country?.[0]?.plane?.group[0]
      expect(emittedFlight?.route?.points[0]?.helipadId).toBe(expectedCarrier?.unitId)
      expect(emittedFlight?.route?.points.at(-1)).toMatchObject({
        helipadId: expectedCarrier?.unitId,
        x: expectedCarrier?.x,
        y: expectedCarrier?.y
      })
      expect(emittedFlight?.units[0]).toMatchObject({
        x: expectedCarrier?.x,
        y: expectedCarrier?.y
      })
      expect(flightResult.value[0]).toMatchObject({
        frequency: 251.05,
        navigation: {
          landingTacan: expectedTacan
        }
      })
    }
  )
})

describe('addFlightGroups Link-16 output', () => {
  test('assigns unique friendly F-16 STNs and shares friendly flights through team members and donors', () => {
    const startTime = new Date('2026-01-01T00:00:00Z')
    const mission = createMission()
    const result = addFlightGroups(mission, createCampaign(startTime), theatre)

    expect(result.isOk()).toBe(true)
    if (result.isErr()) throw result.error

    const blueGroups = mission.coalition.blue.country?.[0]?.plane?.group ?? []
    const redGroups = mission.coalition.red.country?.[0]?.plane?.group ?? []
    const blueUnits = blueGroups.flatMap((group) => group.units)
    const redUnitIds = new Set(redGroups.flatMap((group) => group.units.map((unit) => unit.unitId)))

    expect(blueGroups[0]).toMatchObject({
      hiddenOnMFD: false,
      hiddenOnPlanner: false,
      taskSelected: true
    })

    const stationNumbers = blueUnits.map(getStationNumber)
    expect(stationNumbers).toEqual([
      '00201',
      '00202',
      '00301',
      '00302',
      '00401',
      '00402',
      '00501',
      '00502',
      '00601',
      '00602'
    ])
    expect(new Set(stationNumbers).size).toBe(stationNumbers.length)

    const firstUnit = blueUnits[0]
    expect(firstUnit).toBeDefined()
    if (!firstUnit) throw new Error('expected first blue unit')

    const firstNetwork = getLink16Network(firstUnit)
    const teamMemberIds = getMissionUnitIds(firstNetwork.teamMembers)
    const donorIds = getMissionUnitIds(firstNetwork.donors)

    expect(teamMemberIds).toEqual(blueUnits.slice(0, 8).map((unit) => unit.unitId))
    expect(donorIds).toEqual(blueUnits.slice(8, 10).map((unit) => unit.unitId))

    const blueNetworkIds = new Set([...teamMemberIds, ...donorIds])
    redUnitIds.forEach((unitId) => expect(blueNetworkIds.has(unitId)).toBe(false))
  })
})

describe('addFlightGroups parking assignment', () => {
  test('skips blocked parking stands', () => {
    const startTime = new Date('2026-01-01T00:00:00Z')
    const mission = createMission()
    const campaign = createCampaign(startTime)
    campaign.coalitions.player.flightGroups = [createFlightGroup('blue-1', 'Enfield-1', startTime)]
    campaign.coalitions.opponent.flightGroups = []

    const theatreWithParking: Theatre = {
      ...theatre,
      airdromeDetails: {
        'Test Base': {
          id: 1,
          name: 'Test Base',
          x: 1000,
          y: 1000,
          runwayAngle: 90,
          standlist: {
            '01': {
              id: '01',
              crossroad_index: 1,
              helicopter: true,
              large: true,
              plane: true,
              shelter: false,
              x: 100,
              y: 100,
              blocked: true
            },
            '02': {
              id: '02',
              crossroad_index: 2,
              helicopter: true,
              large: true,
              plane: true,
              shelter: false,
              x: 200,
              y: 200
            },
            '03': {
              id: '03',
              crossroad_index: 3,
              helicopter: true,
              large: true,
              plane: true,
              shelter: false,
              x: 300,
              y: 300
            }
          }
        }
      }
    }

    const result = addFlightGroups(mission, campaign, theatreWithParking)

    expect(result.isOk()).toBe(true)
    if (result.isErr()) throw result.error

    const units = mission.coalition.blue.country?.[0]?.plane?.group?.[0]?.units ?? []

    expect(units.map((unit) => unit.parking_id)).toEqual(['02', '03'])
    expect(units.map((unit) => unit.parking)).toEqual(['2', '3'])
  })

  test('parks the player on the stand they chose and gives the wingman another spot', () => {
    const startTime = new Date('2026-01-01T00:00:00Z')
    const mission = createMission()
    const campaign = createCampaign(startTime)
    const group = createFlightGroup('blue-1', 'Enfield-1', startTime)
    group.aircrafts[0]!.client = true
    group.parkingStandId = '03'
    campaign.coalitions.player.flightGroups = [group]
    campaign.coalitions.opponent.flightGroups = []

    const theatreWithParking: Theatre = {
      ...theatre,
      airdromeDetails: {
        'Test Base': {
          id: 1,
          name: 'Test Base',
          x: 1000,
          y: 1000,
          runwayAngle: 90,
          standlist: {
            '01': {
              id: '01',
              crossroad_index: 1,
              helicopter: true,
              large: true,
              plane: true,
              shelter: false,
              x: 100,
              y: 100
            },
            '02': {
              id: '02',
              crossroad_index: 2,
              helicopter: true,
              large: true,
              plane: true,
              shelter: true,
              x: 200,
              y: 200
            },
            '03': {
              id: '03',
              crossroad_index: 3,
              helicopter: true,
              large: true,
              plane: true,
              shelter: false,
              x: 300,
              y: 300
            }
          }
        }
      }
    }

    const result = addFlightGroups(mission, campaign, theatreWithParking)

    expect(result.isOk()).toBe(true)
    if (result.isErr()) throw result.error

    const units = mission.coalition.blue.country?.[0]?.plane?.group?.[0]?.units ?? []
    expect(units.map((unit) => unit.parking_id)).toEqual(['03', '01'])
    expect(units.map((unit) => unit.parking)).toEqual(['3', '1'])
  })

  test('keeps live aircraft clear of a parked helicopter on the ramp', () => {
    const startTime = new Date('2026-01-01T00:00:00Z')
    const mission = createMission()
    const campaign = createCampaign(startTime)
    campaign.coalitions.player.flightGroups = [createFlightGroup('blue-1', 'Enfield-1', startTime)]
    campaign.coalitions.opponent.flightGroups = []
    mission.coalition.red.country![0]!.static = {
      group: [
        {
          groupId: 800,
          name: 'Static Mi-8MTV2-1',
          heading: 0,
          hidden: false,
          dead: false,
          x: 100,
          y: 100,
          units: [
            {
              unitId: 801,
              name: 'Static Mi-8MTV2-1',
              type: 'Mi-8MT',
              category: 'Helicopters',
              x: 100,
              y: 100,
              heading: 0
            }
          ],
          route: { points: [] }
        }
      ]
    }

    const theatreWithParking: Theatre = {
      ...theatre,
      airdromeDetails: {
        'Test Base': {
          id: 1,
          name: 'Test Base',
          x: 1000,
          y: 1000,
          runwayAngle: 90,
          standlist: {
            '01': {
              id: '01',
              crossroad_index: 1,
              helicopter: true,
              large: true,
              plane: true,
              shelter: false,
              x: 105,
              y: 100
            },
            '02': {
              id: '02',
              crossroad_index: 2,
              helicopter: true,
              large: true,
              plane: true,
              shelter: false,
              x: 118,
              y: 100
            },
            '03': {
              id: '03',
              crossroad_index: 3,
              helicopter: true,
              large: true,
              plane: true,
              shelter: false,
              x: 160,
              y: 100
            },
            '04': {
              id: '04',
              crossroad_index: 4,
              helicopter: true,
              large: true,
              plane: true,
              shelter: false,
              x: 190,
              y: 100
            }
          }
        }
      }
    }

    const result = addFlightGroups(mission, campaign, theatreWithParking)

    expect(result.isOk()).toBe(true)
    if (result.isErr()) throw result.error

    const units = mission.coalition.blue.country?.[0]?.plane?.group?.[0]?.units ?? []
    expect(units.map((unit) => unit.parking_id)).toEqual(['03', '04'])
  })

  test('honors a chosen stand that sits near a parked helicopter', () => {
    const startTime = new Date('2026-01-01T00:00:00Z')
    const mission = createMission()
    const campaign = createCampaign(startTime)
    const group = createFlightGroup('blue-1', 'Enfield-1', startTime)
    group.aircrafts[0]!.client = true
    group.parkingStandId = '02'
    campaign.coalitions.player.flightGroups = [group]
    campaign.coalitions.opponent.flightGroups = []
    mission.coalition.red.country![0]!.static = {
      group: [
        {
          groupId: 800,
          name: 'Static Mi-8MTV2-1',
          heading: 0,
          hidden: false,
          dead: false,
          x: 100,
          y: 100,
          units: [
            {
              unitId: 801,
              name: 'Static Mi-8MTV2-1',
              type: 'Mi-8MT',
              category: 'Helicopters',
              x: 100,
              y: 100,
              heading: 0
            }
          ],
          route: { points: [] }
        }
      ]
    }

    const theatreWithParking: Theatre = {
      ...theatre,
      airdromeDetails: {
        'Test Base': {
          id: 1,
          name: 'Test Base',
          x: 1000,
          y: 1000,
          runwayAngle: 90,
          standlist: {
            '02': {
              id: '02',
              crossroad_index: 2,
              helicopter: true,
              large: true,
              plane: true,
              shelter: false,
              x: 118,
              y: 100
            },
            '03': {
              id: '03',
              crossroad_index: 3,
              helicopter: true,
              large: true,
              plane: true,
              shelter: false,
              x: 160,
              y: 100
            }
          }
        }
      }
    }

    const result = addFlightGroups(mission, campaign, theatreWithParking)

    expect(result.isOk()).toBe(true)
    if (result.isErr()) throw result.error

    const units = mission.coalition.blue.country?.[0]?.plane?.group?.[0]?.units ?? []
    expect(units.map((unit) => unit.parking_id)).toEqual(['02', '03'])
  })

  test('assigns native FARP parking slots across client helicopter groups', () => {
    const startTime = new Date('2026-01-01T00:00:00Z')
    const mission = createMission()
    mission.coalition.blue.country![0]!.static = {
      group: [
        {
          groupId: 700,
          name: 'Static-farp-1-Farp-700',
          heading: 0,
          x: 1000,
          y: 1000,
          units: [
            {
              unitId: 701,
              name: 'Static-farp-1-Farp-700-1',
              x: 1000,
              y: 1000,
              type: 'FARP',
              heading: 0,
              category: 'Heliports'
            }
          ]
        }
      ]
    }
    const campaign = createCampaign(startTime)
    const firstGroup = createTaskFlightGroup('blue-csar-1', 'Enfield-1', startTime, 'CSAR')
    const secondGroup = createTaskFlightGroup('blue-csar-2', 'Springfield-1', startTime, 'CSAR')

    for (const [index, group] of [firstGroup, secondGroup].entries()) {
      group.aircrafts = [
        {
          id: `blue-csar-${index + 1}-1`,
          unitName: `${group.callsign}-1`,
          aircraftName: index === 0 ? 'CH-47Fbl1' : 'UH-1H',
          client: true
        }
      ]
      group.homeBase = 'farp-1'
      group.position = { x: 1000, y: 1000 }
      group.flightplan.waypoints[0]!.position = group.position
      group.flightplan.waypoints[2]!.position = group.position
    }

    campaign.coalitions.player.structures = [
      {
        id: 'farp-1',
        type: 'Farp',
        objectiveId: 'objective-1',
        position: { x: 1000, y: 1000 },
        name: 'Forward FARP',
        resources: 0,
        buildings: [{ type: 'FARP', offset: { x: 0, y: 0 }, alive: true }]
      }
    ]
    campaign.coalitions.player.flightGroups = [firstGroup, secondGroup]
    campaign.coalitions.opponent.flightGroups = []

    const result = addFlightGroups(mission, campaign, theatre)

    expect(result.isOk()).toBe(true)
    if (result.isErr()) throw result.error

    const groups = mission.coalition.blue.country?.[0]?.helicopter?.group ?? []
    expect(groups.map((group) => group.units[0]?.parking_id)).toEqual(['1', '2'])
    expect(groups.map((group) => group.units[0]?.parking)).toEqual(['1', '2'])
    expect(groups[0]?.units[0]?.AddPropAircraft).toEqual({
      DustProtectionDevices: false,
      NetCrewControlPriority: 0
    })
    expect(groups.map((group) => group.route?.points[0])).toEqual([
      expect.objectContaining({
        x: 1000,
        y: 1000,
        type: 'TakeOffParking',
        helipadId: 701,
        linkUnit: 701
      }),
      expect.objectContaining({
        x: 1000,
        y: 1000,
        type: 'TakeOffParking',
        helipadId: 701,
        linkUnit: 701
      })
    ])
    expect(groups.map((group) => group.route?.points.at(-1))).toEqual([
      expect.objectContaining({
        x: 1000,
        y: 1000,
        type: 'Land',
        helipadId: 701,
        linkUnit: 701
      }),
      expect.objectContaining({
        x: 1000,
        y: 1000,
        type: 'Land',
        helipadId: 701,
        linkUnit: 701
      })
    ])
  })
})

describe('addFlightGroups airborne client spawn altitude', () => {
  test('spawns airborne fixed-wing groups at least 10000 feet above ground-level interpolation', () => {
    const startTime = new Date('2026-01-01T00:00:00Z')
    const mission = createMission()
    const campaign = createCampaign(startTime)
    const group = createFlightGroup('blue-airborne', 'Enfield-1', startTime)
    group.aircrafts[0]!.client = true
    campaign.time = new Date(startTime.getTime() + 10 * 60 * 1000)
    campaign.coalitions.player.flightGroups = [group]
    campaign.coalitions.opponent.flightGroups = []

    const result = addFlightGroups(mission, campaign, theatre)

    expect(result.isOk()).toBe(true)
    if (result.isErr()) throw result.error

    const emittedGroup = mission.coalition.blue.country?.[0]?.plane?.group?.[0]
    const firstUnit = emittedGroup?.units[0]
    const currentRoutePoint = emittedGroup?.route?.points[0]

    expect(firstUnit?.alt).toBeCloseTo(3048)
    expect(firstUnit?.parking).toBeUndefined()
    expect(currentRoutePoint).toMatchObject({
      alt: 3048,
      type: 'Turning Point',
      action: 'Turning Point',
      name: 'Current'
    })
  })

  test('spawns airborne helicopter groups at least 200 feet above ground-level interpolation', () => {
    const startTime = new Date('2026-01-01T00:00:00Z')
    const mission = createMission()
    const campaign = createCampaign(startTime)
    const group = createFlightGroup('blue-heli-airborne', 'Enfield-1', startTime)
    group.task = 'Transport'
    group.aircrafts.forEach((aircraft) => {
      aircraft.aircraftName = 'UH-60L'
    })
    group.aircrafts[0]!.client = true
    campaign.time = new Date(startTime.getTime() + 10 * 60 * 1000)
    campaign.coalitions.player.flightGroups = [group]
    campaign.coalitions.opponent.flightGroups = []

    const result = addFlightGroups(mission, campaign, theatre)

    expect(result.isOk()).toBe(true)
    if (result.isErr()) throw result.error

    const emittedGroup = mission.coalition.blue.country?.[0]?.helicopter?.group?.[0]
    const firstUnit = emittedGroup?.units[0]
    const currentRoutePoint = emittedGroup?.route?.points[0]

    expect(firstUnit?.alt).toBeCloseTo(60.96)
    expect(firstUnit?.parking).toBeUndefined()
    expect(currentRoutePoint).toMatchObject({
      alt: 60.96,
      type: 'Turning Point',
      action: 'Turning Point',
      name: 'Current'
    })
  })
})

describe('addFlightGroups enemy traffic throttle', () => {
  test('randomly samples opponent non-CAP flights when no player client CAP is selected', () => {
    const startTime = new Date('2026-01-01T00:00:00Z')
    const mission = createMission()
    const campaign = createCampaign(startTime)
    campaign.coalitions.player.flightGroups = [
      createTaskFlightGroup('blue-cas', 'Enfield-1', startTime, 'CAS')
    ]
    campaign.coalitions.opponent.flightGroups = [
      createTaskFlightGroup('red-cap', 'Springfield-1', startTime, 'CAP'),
      ...Array.from({ length: 9 }, (_, index) =>
        createTaskFlightGroup(
          `red-strike-${index + 1}`,
          `Bandit-${index + 1}`,
          startTime,
          'Pinpoint Strike'
        )
      )
    ]

    const randomSpy = vi
      .spyOn(Math, 'random')
      .mockReturnValueOnce(0.9)
      .mockReturnValueOnce(0.1)
      .mockReturnValueOnce(0.9)
      .mockReturnValueOnce(0.1)
      .mockReturnValueOnce(0.9)
      .mockReturnValueOnce(0.1)
      .mockReturnValueOnce(0.9)
      .mockReturnValueOnce(0.9)
      .mockReturnValueOnce(0.9)

    const result = addFlightGroups(mission, campaign, theatre)
    randomSpy.mockRestore()

    expect(result.isOk()).toBe(true)
    if (result.isErr()) throw result.error

    const redGroups = mission.coalition.red.country?.[0]?.plane?.group ?? []
    expect(redGroups.map((group) => group.name)).toEqual([
      'Springfield-1',
      'Bandit-2',
      'Bandit-4',
      'Bandit-6'
    ])
  })

  test('always includes opponent strategic strike flights when enemy traffic is throttled', () => {
    const startTime = new Date('2026-01-01T00:00:00Z')
    const mission = createMission()
    const campaign = createCampaign(startTime)
    campaign.coalitions.player.flightGroups = [
      createTaskFlightGroup('blue-cas', 'Enfield-1', startTime, 'CAS')
    ]
    campaign.coalitions.opponent.flightGroups = [
      createTaskFlightGroup('red-strategic', 'Buff-1', startTime, 'Strategic Strike'),
      createTaskFlightGroup('red-strike', 'Bandit-1', startTime, 'Pinpoint Strike')
    ]

    const randomSpy = vi.spyOn(Math, 'random').mockReturnValue(0.9)

    const result = addFlightGroups(mission, campaign, theatre)
    randomSpy.mockRestore()

    expect(result.isOk()).toBe(true)
    if (result.isErr()) throw result.error

    const redGroups = mission.coalition.red.country?.[0]?.plane?.group ?? []
    expect(redGroups.map((group) => group.name)).toEqual(['Buff-1'])
  })

  test('includes all opponent flights when a player client CAP is selected', () => {
    const startTime = new Date('2026-01-01T00:00:00Z')
    const mission = createMission()
    const campaign = createCampaign(startTime)
    const clientCap = createTaskFlightGroup('blue-cap', 'Enfield-1', startTime, 'CAP')
    clientCap.aircrafts[0]!.client = true
    campaign.coalitions.player.flightGroups = [clientCap]
    campaign.coalitions.opponent.flightGroups = [
      createTaskFlightGroup('red-cap', 'Springfield-1', startTime, 'CAP'),
      ...Array.from({ length: 9 }, (_, index) =>
        createTaskFlightGroup(
          `red-strike-${index + 1}`,
          `Bandit-${index + 1}`,
          startTime,
          'Pinpoint Strike'
        )
      )
    ]

    const result = addFlightGroups(mission, campaign, theatre)

    expect(result.isOk()).toBe(true)
    if (result.isErr()) throw result.error

    const redGroups = mission.coalition.red.country?.[0]?.plane?.group ?? []
    expect(redGroups.map((group) => group.name)).toEqual([
      'Springfield-1',
      'Bandit-1',
      'Bandit-2',
      'Bandit-3',
      'Bandit-4',
      'Bandit-5',
      'Bandit-6',
      'Bandit-7',
      'Bandit-8',
      'Bandit-9'
    ])
  })
})

describe('addFlightGroups mission script config', () => {
  test('sets a single selected client aircraft to client skill', () => {
    const startTime = new Date('2026-01-01T00:00:00Z')
    const mission = createMission()
    const campaign = createCampaign(startTime)
    const clientGroup = createFlightGroup('blue-client', 'Enfield-1', startTime)
    clientGroup.aircrafts[0]!.client = true
    campaign.coalitions.player.flightGroups = [clientGroup]
    campaign.coalitions.opponent.flightGroups = []

    const result = addFlightGroups(mission, campaign, theatre)

    expect(result.isOk()).toBe(true)
    if (result.isErr()) throw result.error

    const units = mission.coalition.blue.country?.[0]?.plane?.group?.[0]?.units ?? []

    expect(units.map((unit) => unit.skill)).toEqual(['Client', 'High'])
  })

  test('omits AI wingmen when their spawn setting is never', () => {
    const startTime = new Date('2026-01-01T00:00:00Z')
    const mission = createMission()
    const campaign = createCampaign(startTime)
    const clientGroup = createFlightGroup('blue-client', 'Enfield-1', startTime)
    clientGroup.aircrafts[0]!.client = true
    campaign.campaignParams = { aiWingmanSpawn: 'never' }
    campaign.coalitions.player.flightGroups = [clientGroup]
    campaign.coalitions.opponent.flightGroups = []

    const result = addFlightGroups(mission, campaign, theatre)

    expect(result.isOk()).toBe(true)
    if (result.isErr()) throw result.error

    const units = mission.coalition.blue.country?.[0]?.plane?.group?.[0]?.units ?? []
    expect(units.map((unit) => unit.skill)).toEqual(['Client'])
  })

  test('omits AI wingmen from airborne client flights when set to land only', () => {
    const startTime = new Date('2026-01-01T00:00:00Z')
    const mission = createMission()
    const campaign = createCampaign(startTime)
    const clientGroup = createFlightGroup('blue-client', 'Enfield-1', startTime)
    clientGroup.aircrafts[0]!.client = true
    campaign.campaignParams = { aiWingmanSpawn: 'landOnly' }
    campaign.time = new Date(startTime.getTime() + 10 * 60 * 1000)
    campaign.coalitions.player.flightGroups = [clientGroup]
    campaign.coalitions.opponent.flightGroups = []

    const result = addFlightGroups(mission, campaign, theatre)

    expect(result.isOk()).toBe(true)
    if (result.isErr()) throw result.error

    const units = mission.coalition.blue.country?.[0]?.plane?.group?.[0]?.units ?? []
    expect(units.map((unit) => unit.skill)).toEqual(['Client'])
  })

  test('omits AI wingmen from carrier client flights when set to land only', () => {
    const startTime = new Date('2026-01-01T00:00:00Z')
    const mission = createMission()
    const campaign = createCampaign(startTime)
    const clientGroup = createFlightGroup('blue-client', 'Enfield-1', startTime)
    clientGroup.homeBase = 'carrier-group'
    clientGroup.aircrafts.forEach((aircraft) => {
      aircraft.aircraftName = 'AV8BNA'
    })
    clientGroup.aircrafts[0]!.client = true
    campaign.campaignParams = { aiWingmanSpawn: 'landOnly' }
    campaign.coalitions.player.flightGroups = [clientGroup]
    campaign.coalitions.player.navalGroups = [
      {
        id: 'carrier-group',
        name: 'Carrier Group',
        role: 'carrier',
        unitTypes: ['LHA_Tarawa'],
        position: { x: 1_000, y: 1_000 },
        heading: 0,
        damage: 0,
        fuel: 1,
        ammunition: 1,
        cargo: 0,
        state: 'operational'
      }
    ]
    campaign.coalitions.opponent.flightGroups = []

    const navalResult = addNavalGroups(mission, campaign)
    expect(navalResult.isOk()).toBe(true)
    if (navalResult.isErr()) throw navalResult.error

    const result = addFlightGroups(mission, campaign, theatre)

    expect(result.isOk()).toBe(true)
    if (result.isErr()) throw result.error

    const units = mission.coalition.blue.country?.[0]?.plane?.group?.[0]?.units ?? []
    expect(units.map((unit) => unit.skill)).toEqual(['Client'])
  })

  test('keeps AI wingmen in airborne client flights when set to always', () => {
    const startTime = new Date('2026-01-01T00:00:00Z')
    const mission = createMission()
    const campaign = createCampaign(startTime)
    const clientGroup = createFlightGroup('blue-client', 'Enfield-1', startTime)
    clientGroup.aircrafts[0]!.client = true
    campaign.campaignParams = { aiWingmanSpawn: 'always' }
    campaign.time = new Date(startTime.getTime() + 10 * 60 * 1000)
    campaign.coalitions.player.flightGroups = [clientGroup]
    campaign.coalitions.opponent.flightGroups = []

    const result = addFlightGroups(mission, campaign, theatre)

    expect(result.isOk()).toBe(true)
    if (result.isErr()) throw result.error

    const units = mission.coalition.blue.country?.[0]?.plane?.group?.[0]?.units ?? []
    expect(units.map((unit) => unit.skill)).toEqual(['Client', 'High'])
  })

  test('does not remove autonomous AI flights when wingmen are disabled', () => {
    const startTime = new Date('2026-01-01T00:00:00Z')
    const mission = createMission()
    const campaign = createCampaign(startTime)
    campaign.campaignParams = { aiWingmanSpawn: 'never' }
    campaign.coalitions.player.flightGroups = [createFlightGroup('blue-ai', 'Enfield-1', startTime)]
    campaign.coalitions.opponent.flightGroups = []

    const result = addFlightGroups(mission, campaign, theatre)

    expect(result.isOk()).toBe(true)
    if (result.isErr()) throw result.error

    const units = mission.coalition.blue.country?.[0]?.plane?.group?.[0]?.units ?? []
    expect(units.map((unit) => unit.skill)).toEqual(['High', 'High'])
  })

  test('keeps multiple selected client aircraft as client skill', () => {
    const startTime = new Date('2026-01-01T00:00:00Z')
    const mission = createMission()
    const campaign = createCampaign(startTime)
    const clientGroup = createFlightGroup('blue-client', 'Enfield-1', startTime)
    clientGroup.aircrafts[0]!.client = true
    clientGroup.aircrafts[1]!.client = true
    campaign.coalitions.player.flightGroups = [clientGroup]
    campaign.coalitions.opponent.flightGroups = []

    const result = addFlightGroups(mission, campaign, theatre)

    expect(result.isOk()).toBe(true)
    if (result.isErr()) throw result.error

    const units = mission.coalition.blue.country?.[0]?.plane?.group?.[0]?.units ?? []

    expect(units.map((unit) => unit.skill)).toEqual(['Client', 'Client'])
  })

  test('keeps separate selected client flight groups as client skill', () => {
    const startTime = new Date('2026-01-01T00:00:00Z')
    const mission = createMission()
    const campaign = createCampaign(startTime)
    const firstClientGroup = createFlightGroup('blue-client-1', 'Enfield-1', startTime)
    const secondClientGroup = createFlightGroup('blue-client-2', 'Springfield-1', startTime)
    firstClientGroup.aircrafts[0]!.client = true
    secondClientGroup.aircrafts[0]!.client = true
    campaign.coalitions.player.flightGroups = [firstClientGroup, secondClientGroup]
    campaign.coalitions.opponent.flightGroups = []

    const result = addFlightGroups(mission, campaign, theatre)

    expect(result.isOk()).toBe(true)
    if (result.isErr()) throw result.error

    const groups = mission.coalition.blue.country?.[0]?.plane?.group ?? []

    expect(groups.map((group) => group.units?.map((unit) => unit.skill))).toEqual([
      ['Client', 'High'],
      ['Client', 'High']
    ])
  })

  test('uses a UHF flight group frequency accepted by DCS aircraft radios', () => {
    const startTime = new Date('2026-01-01T00:00:00Z')
    const mission = createMission()
    const campaign = createCampaign(startTime)
    campaign.coalitions.player.flightGroups = [
      createFlightGroup('blue-client', 'Springfield-4', startTime)
    ]
    campaign.coalitions.opponent.flightGroups = []

    const result = addFlightGroups(mission, campaign, theatre)

    expect(result.isOk()).toBe(true)
    if (result.isErr()) throw result.error

    const group = mission.coalition.blue.country?.[0]?.plane?.group?.[0]

    expect(group?.frequency).toBe(251.05)
  })

  test.each([
    ['AV8BNA', 1],
    ['FA-18C_hornet', 1],
    ['A-10C_2', 2]
  ] as const)('writes the assigned frequency to %s radio %i channel 1', (aircraftType, radio) => {
    const startTime = new Date('2026-01-01T00:00:00Z')
    const mission = createMission()
    const campaign = createCampaign(startTime)
    const flightGroup = createFlightGroup('blue-radio', 'Springfield-4', startTime)
    flightGroup.aircrafts[0]!.client = true
    flightGroup.aircrafts.forEach((aircraft) => {
      aircraft.aircraftName = aircraftType
    })
    campaign.coalitions.player.flightGroups = [flightGroup]
    campaign.coalitions.opponent.flightGroups = []

    const result = addFlightGroups(mission, campaign, theatre)

    expect(result.isOk()).toBe(true)
    if (result.isErr()) throw result.error

    const group = mission.coalition.blue.country?.[0]?.plane?.group?.[0]
    const clientUnit = group?.units?.[0]
    const aiWingman = group?.units?.[1]

    expect(group?.radioSet).toBe(true)
    expect(clientUnit?.Radio).toHaveLength(radio)
    expect(clientUnit?.Radio?.[radio - 1]).toEqual({
      channels: { 1: 251.05, 2: 251, 3: 250, 4: 305 }
    })
    expect(aiWingman?.Radio).toBeUndefined()
    expect(result.value[0]?.radioPreset).toEqual({ radio, channel: 1 })
    expect(result.value[0]?.radioChannels).toEqual([
      { purpose: 'FLIGHT', radio, channel: 1, frequency: 251.05 },
      { purpose: 'AWACS', radio, channel: 2, frequency: 251 },
      { purpose: 'ATC', radio, channel: 3, frequency: 250 },
      { purpose: 'JTAC', radio, channel: 4, frequency: 305 }
    ])
  })

  test('uses the home airfield UHF ATC frequency on channel 3', () => {
    const startTime = new Date('2026-01-01T00:00:00Z')
    const mission = createMission()
    const campaign = createCampaign(startTime)
    const flightGroup = createFlightGroup('blue-radio', 'Springfield-4', startTime)
    flightGroup.aircrafts[0]!.client = true
    flightGroup.aircrafts.forEach((aircraft) => {
      aircraft.aircraftName = 'FA-18C_hornet'
    })
    campaign.coalitions.player.flightGroups = [flightGroup]
    campaign.coalitions.opponent.flightGroups = []

    const result = addFlightGroups(mission, campaign, {
      ...theatre,
      airdromeDetails: {
        'Test Base': {
          id: 1,
          name: 'Test Base',
          x: 1000,
          y: 1000,
          runwayAngle: 0,
          standlist: {},
          frequency: 264
        }
      }
    })

    expect(result.isOk()).toBe(true)
    if (result.isErr()) throw result.error

    const clientUnit = mission.coalition.blue.country?.[0]?.plane?.group?.[0]?.units?.[0]
    expect(clientUnit?.Radio?.[0]).toMatchObject({ channels: { 3: 264 } })
    expect(result.value[0]?.radioChannels).toContainEqual({
      purpose: 'ATC',
      radio: 1,
      channel: 3,
      frequency: 264
    })
  })

  test('uses the aircraft payload ammo type when generating units', () => {
    const startTime = new Date('2026-01-01T00:00:00Z')
    const mission = createMission()
    const campaign = createCampaign(startTime)
    const group = createFlightGroup('blue-f100', 'Enfield-1', startTime)
    group.aircrafts.forEach((aircraft) => {
      aircraft.aircraftName = 'F-100D'
    })
    campaign.coalitions.player.flightGroups = [group]
    campaign.coalitions.opponent.flightGroups = []

    const result = addFlightGroups(mission, campaign, theatre)

    expect(result.isOk()).toBe(true)
    if (result.isErr()) throw result.error

    const units = mission.coalition.blue.country?.[0]?.plane?.group?.[0]?.units ?? []
    expect(units.map((unit) => unit.payload?.ammo_type)).toEqual([2, 2])
  })

  test('equips Harrier CAP flights with the mission-derived payload', () => {
    const startTime = new Date('2026-01-01T00:00:00Z')
    const mission = createMission()
    const campaign = createCampaign(startTime)
    const group = createTaskFlightGroup('blue-harrier-cap', 'Enfield-1', startTime, 'CAP')
    group.aircrafts.forEach((aircraft) => {
      aircraft.aircraftName = 'AV8BNA'
    })
    campaign.coalitions.player.flightGroups = [group]
    campaign.coalitions.opponent.flightGroups = []

    const result = addFlightGroups(mission, campaign, theatre)

    expect(result.isOk()).toBe(true)
    if (result.isErr()) throw result.error

    const units = mission.coalition.blue.country?.[0]?.plane?.group?.[0]?.units ?? []
    expect(units).toHaveLength(2)
    expect(units[0]?.payload?.pylons).toEqual({
      1: { CLSID: '{AGM_122_SIDEARM}', num: 1 },
      2: { CLSID: '{LAU_7_AGM_122_SIDEARM}', num: 2 },
      3: { CLSID: 'LAU_117_AGM_65F', num: 3 },
      4: { CLSID: '{GAU_12_Equalizer}', num: 4 },
      5: { CLSID: '{ALQ_164_RF_Jammer}', num: 5 },
      6: { CLSID: 'LAU_117_AGM_65F', num: 6 },
      7: { CLSID: '{LAU_7_AGM_122_SIDEARM}', num: 7 },
      8: { CLSID: '{AGM_122_SIDEARM}', num: 8 }
    })
  })

  test('equips Harrier DEAD flights with anti-radiation and strike weapons', () => {
    const startTime = new Date('2026-01-01T00:00:00Z')
    const mission = createMission()
    const campaign = createCampaign(startTime)
    const group = createTaskFlightGroup('blue-harrier-dead', 'Enfield-1', startTime, 'DEAD')
    group.aircrafts.forEach((aircraft) => {
      aircraft.aircraftName = 'AV8BNA'
    })
    campaign.coalitions.player.flightGroups = [group]
    campaign.coalitions.opponent.flightGroups = []

    const result = addFlightGroups(mission, campaign, theatre)

    expect(result.isOk()).toBe(true)
    if (result.isErr()) throw result.error

    const units = mission.coalition.blue.country?.[0]?.plane?.group?.[0]?.units ?? []
    expect(units).toHaveLength(2)
    expect(units[0]?.payload?.pylons).toEqual({
      1: { CLSID: '{AGM_122_SIDEARM}', num: 1 },
      2: { CLSID: '{LAU_7_AGM_122_SIDEARM}', num: 2 },
      3: { CLSID: 'LAU_117_AGM_65F', num: 3 },
      4: { CLSID: '{GAU_12_Equalizer}', num: 4 },
      5: { CLSID: '{ALQ_164_RF_Jammer}', num: 5 },
      6: { CLSID: 'LAU_117_AGM_65F', num: 6 },
      7: { CLSID: '{LAU_7_AGM_122_SIDEARM}', num: 7 },
      8: { CLSID: '{AGM_122_SIDEARM}', num: 8 }
    })
  })

  test('assigns DEAD flights a DCS SEAD task and their persistent EWR target group', () => {
    const startTime = new Date('2026-01-01T00:00:00Z')
    const mission = createMission()
    const campaign = createCampaign(startTime)
    const group = createTaskFlightGroup('blue-ewr-dead', 'Enfield-1', startTime, 'DEAD')
    group.target = {
      id: 'ewr-1',
      type: '55G6 EWR',
      objectiveId: 'Target Objective'
    }
    campaign.coalitions.player.flightGroups = [group]
    campaign.coalitions.opponent.flightGroups = []
    mission.coalition.red.country![0]!.vehicle = {
      group: [
        {
          groupId: 900,
          name: 'IADS-EWR-ewr-1-900',
          units: [
            {
              unitId: 901,
              name: 'IADS-EWR-Unit-ewr-1',
              x: 2000,
              y: 2000,
              type: '55G6 EWR',
              heading: 0,
              skill: 'High'
            }
          ],
          x: 2000,
          y: 2000,
          hidden: false,
          start_time: 0,
          route: { points: [] }
        }
      ]
    }

    const result = addFlightGroups(mission, campaign, theatre)

    expect(result.isOk()).toBe(true)
    if (result.isErr()) throw result.error
    const dcsGroup = mission.coalition.blue.country?.[0]?.plane?.group?.[0]
    const taskWaypoint = dcsGroup?.route?.points.find((point) => point.name === 'DEAD')
    const tasks = taskWaypoint?.task?.params?.tasks

    expect(dcsGroup?.task).toBe('SEAD')
    expect(tasks).toContainEqual(
      expect.objectContaining({
        id: 'AttackGroup',
        params: expect.objectContaining({ groupId: 900 })
      })
    )
  })

  test('orders CAS flights to attack the targeted ground group at the task waypoint', () => {
    const startTime = new Date('2026-01-01T00:00:00Z')
    const mission = createMission()
    const campaign = createCampaign(startTime)
    const group = createTaskFlightGroup('blue-cas-attack', 'Enfield-1', startTime, 'CAS')
    group.target = {
      id: 'ground-1',
      type: 'Ground Group',
      objectiveId: 'Target Objective'
    }
    campaign.coalitions.player.flightGroups = [group]
    campaign.coalitions.opponent.flightGroups = []
    campaign.coalitions.opponent.groundGroups = [
      {
        id: 'ground-1',
        units: [{ name: 'T-55', count: 6 }],
        position: { x: 2000, y: 2000 },
        objectiveId: 'Target Objective',
        state: 'combat'
      }
    ]
    mission.coalition.red.country![0]!.vehicle = {
      group: [
        {
          groupId: 812,
          name: 'Ground-ground-1-812',
          units: [
            {
              unitId: 813,
              name: 'Ground-ground-1-812-1',
              x: 2000,
              y: 2000,
              type: 'T-55',
              heading: 0,
              skill: 'Average'
            }
          ],
          x: 2000,
          y: 2000,
          hidden: false,
          start_time: 0,
          route: { points: [] }
        }
      ]
    }

    const result = addFlightGroups(mission, campaign, theatre)

    expect(result.isOk()).toBe(true)
    if (result.isErr()) throw result.error
    const dcsGroup = mission.coalition.blue.country?.[0]?.plane?.group?.[0]
    const taskWaypoint = dcsGroup?.route?.points.find((point) => point.name === 'CAS')
    const tasks = taskWaypoint?.task?.params?.tasks

    expect(dcsGroup?.task).toBe('CAS')
    expect(tasks).toContainEqual(
      expect.objectContaining({
        id: 'AttackGroup',
        params: expect.objectContaining({ groupId: 812, groupAttack: true })
      })
    )
    expect(tasks).toContainEqual(
      expect.objectContaining({
        id: 'EngageTargetsInZone',
        params: expect.objectContaining({
          targetTypes: ['Ground Units'],
          zoneRadius: 8000
        })
      })
    )
  })

  test('orders Fighter Sweep flights to engage aircraft around the sweep point', () => {
    const startTime = new Date('2026-01-01T00:00:00Z')
    const mission = createMission()
    const campaign = createCampaign(startTime)
    campaign.coalitions.player.flightGroups = [
      createTaskFlightGroup('blue-sweep', 'Enfield-1', startTime, 'Fighter Sweep')
    ]
    campaign.coalitions.opponent.flightGroups = []

    const result = addFlightGroups(mission, campaign, theatre)

    expect(result.isOk()).toBe(true)
    const dcsGroup = mission.coalition.blue.country?.[0]?.plane?.group?.[0]
    const sweepWaypoint = dcsGroup?.route?.points.find((point) => point.name === 'Fighter Sweep')

    expect(dcsGroup?.task).toBe('Fighter Sweep')
    expect(sweepWaypoint?.task?.params?.tasks).toContainEqual(
      expect.objectContaining({
        id: 'EngageTargetsInZone',
        params: expect.objectContaining({ x: 2000, y: 2000, targetTypes: ['Air'] })
      })
    )
  })

  test('gives Training flights no DCS combat task', () => {
    const startTime = new Date('2026-01-01T00:00:00Z')
    const mission = createMission()
    const campaign = createCampaign(startTime)
    const group = createFlightGroup('blue-training', 'Enfield-1', startTime)
    group.task = 'Training'
    group.flightplan.waypoints[1] = {
      ...group.flightplan.waypoints[1]!,
      name: 'Training 1',
      type: 'Nav'
    }
    campaign.coalitions.player.flightGroups = [group]
    campaign.coalitions.opponent.flightGroups = []

    const result = addFlightGroups(mission, campaign, theatre)

    expect(result.isOk()).toBe(true)
    expect(mission.coalition.blue.country?.[0]?.plane?.group?.[0]?.task).toBe('Nothing')
  })

  test('equips Harrier CAS flights with air-to-ground weapons and a targeting pod', () => {
    const startTime = new Date('2026-01-01T00:00:00Z')
    const mission = createMission()
    const campaign = createCampaign(startTime)
    const group = createTaskFlightGroup('blue-harrier-cas', 'Enfield-1', startTime, 'CAS')
    group.aircrafts.forEach((aircraft) => {
      aircraft.aircraftName = 'AV8BNA'
    })
    campaign.coalitions.player.flightGroups = [group]
    campaign.coalitions.opponent.flightGroups = []

    const result = addFlightGroups(mission, campaign, theatre)

    expect(result.isOk()).toBe(true)
    if (result.isErr()) throw result.error

    const units = mission.coalition.blue.country?.[0]?.plane?.group?.[0]?.units ?? []
    expect(units).toHaveLength(2)
    expect(units[0]?.payload?.pylons).toEqual({
      1: { CLSID: '{6CEB49FC-DED8-4DED-B053-E1F033FF72D3}', num: 1 },
      2: { CLSID: '{DB769D48-67D7-42ED-A2BE-108D566C8B1E}', num: 2 },
      3: { CLSID: 'LAU_117_AGM_65F', num: 3 },
      4: { CLSID: '{GAU_12_Equalizer}', num: 4 },
      5: { CLSID: '{A111396E-D3E8-4b9c-8AC9-2432489304D5}', num: 5 },
      6: { CLSID: 'LAU_117_AGM_65F', num: 6 },
      7: { CLSID: '{DB769D48-67D7-42ED-A2BE-108D566C8B1E}', num: 7 },
      8: { CLSID: '{6CEB49FC-DED8-4DED-B053-E1F033FF72D3}', num: 8 }
    })
  })

  test('equips Harrier Pinpoint Strike flights with the mission-derived GBU-54 loadout', () => {
    const startTime = new Date('2026-01-01T00:00:00Z')
    const mission = createMission()
    const campaign = createCampaign(startTime)
    const group = createTaskFlightGroup(
      'blue-harrier-pinpoint-strike',
      'Enfield-1',
      startTime,
      'Pinpoint Strike'
    )
    group.aircrafts.forEach((aircraft) => {
      aircraft.aircraftName = 'AV8BNA'
    })
    campaign.coalitions.player.flightGroups = [group]
    campaign.coalitions.opponent.flightGroups = []

    const result = addFlightGroups(mission, campaign, theatre)

    expect(result.isOk()).toBe(true)
    if (result.isErr()) throw result.error

    const units = mission.coalition.blue.country?.[0]?.plane?.group?.[0]?.units ?? []
    expect(units).toHaveLength(2)
    expect(units[0]?.payload?.pylons).toEqual({
      1: { CLSID: '{6CEB49FC-DED8-4DED-B053-E1F033FF72D3}', num: 1 },
      2: { CLSID: '{BRU-70A_2*GBU-54_RIGHT}', num: 2 },
      3: { CLSID: '{BRU-70A_2*GBU-54_LEFT}', num: 3 },
      4: { CLSID: '{GAU_12_Equalizer}', num: 4 },
      5: { CLSID: '{ALQ_164_RF_Jammer}', num: 5 },
      6: { CLSID: '{A111396E-D3E8-4b9c-8AC9-2432489304D5}', num: 6 },
      7: { CLSID: '{BRU-70A_2*GBU-54_LEFT}', num: 7 },
      8: { CLSID: '{6CEB49FC-DED8-4DED-B053-E1F033FF72D3}', num: 8 }
    })
  })

  test('assigns a unique radio frequency to each generated flight group', () => {
    const startTime = new Date('2026-01-01T00:00:00Z')
    const mission = createMission()
    const campaign = createCampaign(startTime)
    campaign.coalitions.opponent.flightGroups = []

    const result = addFlightGroups(mission, campaign, theatre)

    expect(result.isOk()).toBe(true)
    if (result.isErr()) throw result.error

    const groups = mission.coalition.blue.country?.[0]?.plane?.group ?? []
    const frequencies = groups.map((group) => group.frequency)

    expect(frequencies).toEqual([251.05, 251.1, 251.15, 251.2, 251.25])
    expect(new Set(frequencies).size).toBe(frequencies.length)
  })

  test('assigns constrained aircraft frequencies inside their allowed range', () => {
    const startTime = new Date('2026-01-01T00:00:00Z')
    const mission = createMission()
    const campaign = createCampaign(startTime)
    const firstGroup = createFlightGroup('blue-mig-1', 'Enfield-1', startTime)
    const secondGroup = createFlightGroup('blue-mig-2', 'Springfield-1', startTime)
    firstGroup.aircrafts.forEach((aircraft) => {
      aircraft.aircraftName = 'MiG-21Bis'
    })
    secondGroup.aircrafts.forEach((aircraft) => {
      aircraft.aircraftName = 'MiG-21Bis'
    })
    campaign.coalitions.player.flightGroups = [firstGroup, secondGroup]
    campaign.coalitions.opponent.flightGroups = []

    const result = addFlightGroups(mission, campaign, theatre)

    expect(result.isOk()).toBe(true)
    if (result.isErr()) throw result.error

    const groups = mission.coalition.blue.country?.[0]?.plane?.group ?? []
    const frequencies = groups.map((group) => group.frequency)

    expect(frequencies).toEqual([118, 118.05])
    frequencies.forEach((frequency) => {
      expect(frequency).toBeGreaterThanOrEqual(118)
      expect(frequency).toBeLessThanOrEqual(140)
    })
    expect(new Set(frequencies).size).toBe(frequencies.length)
  })

  test('returns client flight unit names for mission scripts', () => {
    const startTime = new Date('2026-01-01T00:00:00Z')
    const mission = createMission()
    const campaign = createCampaign(startTime)
    const clientGroup = createFlightGroup('blue-client', 'Enfield-1', startTime)
    clientGroup.aircrafts[0]!.client = true
    campaign.coalitions.player.flightGroups = [clientGroup]
    campaign.coalitions.opponent.flightGroups = []

    const result = addFlightGroups(mission, campaign, theatre)

    expect(result.isOk()).toBe(true)
    if (result.isErr()) throw result.error

    expect(result.value[0]?.groupId).toEqual(expect.any(Number))
    expect(
      result.value.map(({ groupId: _groupId, radioChannels: _radioChannels, ...group }) => group)
    ).toEqual([
      {
        client: true,
        frequency: 251.05,
        gci: true,
        name: 'Enfield-1',
        radioPreset: { radio: 1, channel: 1 },
        task: 'CAP',
        unitNames: ['Enfield-1-1', 'Enfield-1-2'],
        units: 'imperial'
      }
    ])
  })

  test('returns downed pilot details for client CSAR mission commands', () => {
    const startTime = new Date('2026-01-01T00:00:00Z')
    const mission = createMission()
    const campaign = createCampaign(startTime)
    const clientGroup = createTaskFlightGroup('blue-csar', 'Enfield-1', startTime, 'CSAR')
    clientGroup.aircrafts = [
      {
        id: 'blue-csar-1',
        unitName: 'Enfield-1-1',
        aircraftName: 'UH-1H',
        client: true
      }
    ]
    clientGroup.target = {
      id: 'pilot-1',
      type: 'Downed Pilot',
      objectiveId: 'objective-1'
    }
    clientGroup.flightplan.waypoints.splice(-1, 0, {
      name: 'Drop Off',
      position: { x: 1500, y: 1600 },
      altitude: 30,
      speed: 70,
      type: 'Nav'
    })
    campaign.coalitions.player.downedPilots = [
      {
        id: 'pilot-1',
        name: 'Pilot 1',
        position: { x: 3000, y: 4000 },
        ejectedAt: startTime
      }
    ]
    campaign.coalitions.player.flightGroups = [clientGroup]
    campaign.coalitions.opponent.flightGroups = []

    const result = addFlightGroups(mission, campaign, theatre)

    expect(result.isOk()).toBe(true)
    if (result.isErr()) throw result.error
    expect(result.value[0]).toMatchObject({
      name: 'Enfield-1',
      task: 'CSAR',
      isHelicopter: true,
      csar: {
        pilotId: 'pilot-1',
        pilotName: 'Pilot 1',
        position: { x: 3000, y: 4000 },
        dropOffPosition: { x: 1500, y: 1600 },
        pickupRadius: 150
      }
    })
    const missionConfig = result.value[0]
    expect(
      missionConfig && 'csar' in missionConfig ? missionConfig.csar?.pilotObjectName : undefined
    ).toMatch(/^Downed Pilot-\d+-1$/)
    expect(
      mission.coalition.blue.country?.[0]?.helicopter?.group?.[0]?.route?.points[0]
    ).toMatchObject({
      action: 'From Ground Area',
      type: 'TakeOffGround'
    })
    expect(mission.coalition.blue.country?.[0]?.helicopter?.group?.[0]?.task).toBe('Transport')
    const pilotGroups = mission.coalition.blue.country?.[0]?.static?.group ?? []
    expect(pilotGroups).toHaveLength(1)
    expect(pilotGroups[0]).toMatchObject({
      dead: false,
      x: 3000,
      y: 4000
    })
    expect(pilotGroups[0]?.name).toMatch(/^Downed Pilot-\d+$/)
    expect(pilotGroups[0]?.units).toHaveLength(1)
    expect(pilotGroups[0]?.units[0]).toMatchObject({
      type: 'Pilot standing',
      category: 'Fortifications',
      shape_name: 'pilot_parashut',
      x: 3000,
      y: 4000
    })
  })

  test('skips CAS JTAC support when disabled in campaign params', () => {
    const startTime = new Date('2026-01-01T00:00:00Z')
    const mission = createMission()
    const campaign = createCampaign(startTime)
    campaign.campaignParams = { casJtac: false }
    campaign.coalitions.player.flightGroups = [createClientCasFlightGroup(startTime)]
    campaign.coalitions.opponent.flightGroups = []
    campaign.coalitions.opponent.groundGroups = [
      {
        id: 'ground-1',
        units: [],
        position: { x: 3000, y: 3000 },
        objectiveId: 'objective-1',
        state: 'idle'
      }
    ]

    const result = addFlightGroups(mission, campaign, {
      ...theatre,
      objectives: [{ name: 'objective-1', type: 'Frontline', position: { x: 3000, y: 3000 } }]
    })

    expect(result.isOk()).toBe(true)
    if (result.isErr()) throw result.error

    const blueGroups = mission.coalition.blue.country?.[0]?.plane?.group ?? []
    expect(blueGroups.map((group) => group.name)).toEqual(['Enfield-1'])
    expect(result.value[0]?.groupId).toEqual(expect.any(Number))
    expect(
      result.value.map(({ groupId: _groupId, radioChannels: _radioChannels, ...group }) => group)
    ).toEqual([
      {
        client: true,
        frequency: 251.05,
        name: 'Enfield-1',
        navigation: {
          mode: 'targetVector',
          targetLabel: 'Ground Group objective-1',
          targetPoint: {
            x: 3000,
            z: 3000
          }
        },
        radioPreset: { radio: 1, channel: 1 },
        task: 'CAS',
        unitNames: ['Enfield-1-1', 'Enfield-1-2'],
        units: 'imperial'
      }
    ])
  })

  test('adds target vector navigation config for client flights with assigned targets', () => {
    const startTime = new Date('2026-01-01T00:00:00Z')
    const mission = createMission()
    const campaign = createCampaign(startTime)
    campaign.campaignParams = { navigationAid: 'targetVector' }
    const clientGroup = createFlightGroup('blue-client', 'Enfield-1', startTime)
    clientGroup.aircrafts[0]!.client = true
    clientGroup.target = {
      id: 'objective-1',
      objectiveId: 'objective-1',
      type: 'Structure'
    }
    campaign.coalitions.player.flightGroups = [clientGroup]
    campaign.coalitions.opponent.flightGroups = []

    const result = addFlightGroups(mission, campaign, {
      ...theatre,
      objectives: [{ name: 'objective-1', type: 'Frontline', position: { x: 3000, y: 4000 } }]
    })

    expect(result.isOk()).toBe(true)
    if (result.isErr()) throw result.error

    expect(result.value[0]).toMatchObject({
      name: 'Enfield-1',
      navigation: {
        mode: 'targetVector',
        targetLabel: 'Structure objective-1',
        targetPoint: {
          x: 3000,
          z: 4000
        }
      }
    })
  })

  test('adds hidden target TACAN beacon and channel config for target TACAN mode', () => {
    const startTime = new Date('2026-01-01T00:00:00Z')
    const mission = createMission()
    const campaign = createCampaign(startTime)
    campaign.campaignParams = { navigationAid: 'targetTacan' }
    const clientGroup = createFlightGroup('blue-client', 'Enfield-1', startTime)
    clientGroup.aircrafts[0]!.client = true
    clientGroup.target = {
      id: 'objective-1',
      objectiveId: 'objective-1',
      type: 'Structure'
    }
    campaign.coalitions.player.flightGroups = [clientGroup]
    campaign.coalitions.opponent.flightGroups = []

    const result = addFlightGroups(mission, campaign, {
      ...theatre,
      objectives: [{ name: 'objective-1', type: 'Frontline', position: { x: 3000, y: 4000 } }]
    })

    expect(result.isOk()).toBe(true)
    if (result.isErr()) throw result.error

    expect(result.value[0]).toMatchObject({
      navigation: {
        mode: 'targetTacan',
        tacan: {
          channel: 31,
          band: 'X',
          callsign: 'DCC1'
        }
      }
    })

    const beaconGroup = mission.coalition.blue.country?.[0]?.vehicle?.group?.[0]
    expect(beaconGroup).toMatchObject({
      hidden: true,
      visible: false,
      x: 3500,
      y: 4500,
      units: [
        {
          type: 'TACAN_beacon',
          x: 3500,
          y: 4500
        }
      ]
    })

    const beaconRouteTask = JSON.stringify(beaconGroup?.route?.points[0]?.task)
    expect(beaconRouteTask).toContain('"id":"SetImmortal"')
    expect(beaconRouteTask).toContain('"id":"SetInvisible"')
    expect(beaconRouteTask).toContain('"id":"ActivateBeacon"')
    expect(beaconRouteTask).toContain('"channel":31')
    expect(beaconRouteTask).toContain('"callsign":"DCC1"')
    expect(beaconRouteTask).toContain('"unitId"')
    expect(beaconRouteTask).toContain('"system":18')
    expect(beaconRouteTask).toContain('"frequency":992000000')
  })

  test('can enable F10 vectors and target TACAN together', () => {
    const startTime = new Date('2026-01-01T00:00:00Z')
    const mission = createMission()
    const campaign = createCampaign(startTime)
    campaign.campaignParams = {
      navigationVectors: true,
      navigationTargetTacan: true
    }
    const clientGroup = createFlightGroup('blue-client', 'Enfield-1', startTime)
    clientGroup.aircrafts[0]!.client = true
    clientGroup.homeBase = 'Test Base'
    clientGroup.target = {
      id: 'objective-1',
      objectiveId: 'objective-1',
      type: 'Structure'
    }
    campaign.coalitions.player.flightGroups = [clientGroup]
    campaign.coalitions.opponent.flightGroups = []

    const result = addFlightGroups(mission, campaign, {
      ...theatre,
      airdromeDetails: {
        'Test Base': {
          id: 1,
          name: 'Test Base',
          x: 1200,
          y: 3400,
          runwayAngle: 0,
          standlist: {},
          tacan: { channel: 67, band: 'X', callsign: 'TST' }
        }
      },
      objectives: [{ name: 'objective-1', type: 'Frontline', position: { x: 3000, y: 4000 } }]
    })

    expect(result.isOk()).toBe(true)
    if (result.isErr()) throw result.error

    expect(result.value[0]).toMatchObject({
      navigation: {
        mode: 'targetTacan',
        targetLabel: 'Structure objective-1',
        targetPoint: {
          x: 3000,
          z: 4000
        },
        landingLabel: 'Test Base',
        landingPoint: {
          x: 1200,
          z: 3400
        },
        landingTacan: {
          channel: 67,
          band: 'X',
          callsign: 'TST'
        },
        tacan: {
          channel: 31,
          band: 'X',
          callsign: 'DCC1'
        }
      }
    })
    expect(mission.coalition.blue.country?.[0]?.vehicle?.group).toHaveLength(1)
  })

  test('adds landing airport navigation config for client flights', () => {
    const startTime = new Date('2026-01-01T00:00:00Z')
    const mission = createMission()
    const campaign = createCampaign(startTime)
    campaign.campaignParams = { navigationAid: 'landingAirport' }
    const clientGroup = createFlightGroup('blue-client', 'Enfield-1', startTime)
    clientGroup.aircrafts[0]!.client = true
    clientGroup.homeBase = 'Test Base'
    campaign.coalitions.player.flightGroups = [clientGroup]
    campaign.coalitions.opponent.flightGroups = []

    const result = addFlightGroups(mission, campaign, {
      ...theatre,
      airdromeDetails: {
        'Test Base': {
          id: 1,
          name: 'Test Base',
          x: 1200,
          y: 3400,
          runwayAngle: 0,
          standlist: {},
          tacan: { channel: 67, band: 'X', callsign: 'TST' }
        }
      }
    })

    expect(result.isOk()).toBe(true)
    if (result.isErr()) throw result.error

    expect(result.value[0]).toMatchObject({
      name: 'Enfield-1',
      navigation: {
        mode: 'landingAirport',
        landingLabel: 'Test Base',
        landingPoint: {
          x: 1200,
          z: 3400
        },
        landingTacan: {
          channel: 67,
          band: 'X',
          callsign: 'TST'
        }
      }
    })
  })

  test('marks a Fulcrum CAP client for native KRU GCI instead of F10 picture calls', () => {
    const startTime = new Date('2026-01-01T00:00:00Z')
    const mission = createMission()
    const campaign = createCampaign(startTime)
    const group = createFlightGroup('mig', 'Enfield-1', startTime)
    group.aircrafts = [
      { id: 'mig-1', unitName: 'Enfield-1-1', aircraftName: 'MiG-29 Fulcrum', client: true }
    ]
    campaign.coalitions.player.flightGroups = [group]
    campaign.coalitions.opponent.flightGroups = []

    const result = addFlightGroups(mission, campaign, theatre)
    if (result.isErr()) throw result.error

    expect(result.value[0]).toMatchObject({
      client: true,
      nativeGci: true,
      task: 'CAP',
      units: 'metric'
    })
    expect(result.value[0]?.gci).toBeUndefined()
  })
})

describe('addFlightGroups career flights', () => {
  test('flies owned stores, hired wingman skill, armed failures and MiG-29 radio presets', () => {
    const startTime = new Date('2026-01-01T00:00:00Z')
    const mission = createMission()
    const campaign = createCampaign(startTime)
    campaign.campaignParams = { aiWingmanSpawn: 'never' }
    const group = createFlightGroup('career', 'Enfield-1', startTime)
    const pylons = [
      { num: 1, CLSID: '{MISSILE_R-73_APU-73}' },
      { num: 4, CLSID: '{PTB_1500_MIG29A}' }
    ]
    group.aircrafts = [
      {
        id: 'career-1',
        unitName: 'Enfield-1-1',
        aircraftName: 'MiG-29 Fulcrum',
        client: true,
        pylons,
        failures: [{ id: 'RSBN_FAILURE_RECEIVER', label: 'RSBN receiver', afterMinutes: 75 }],
        careerAirframeId: 'airframe-1'
      },
      {
        id: 'career-2',
        unitName: 'Enfield-1-2',
        aircraftName: 'MiG-29 Fulcrum',
        skill: 'Excellent',
        pylons,
        careerAirframeId: 'airframe-2'
      }
    ]
    campaign.coalitions.player.flightGroups = [group]
    campaign.coalitions.opponent.flightGroups = []

    const result = addFlightGroups(mission, campaign, theatre)
    if (result.isErr()) throw result.error

    const units = mission.coalition.blue.country?.[0]?.plane?.group?.[0]?.units ?? []
    // The paid wingman flies even though AI wingmen are switched off.
    expect(units.map((unit) => unit.skill)).toEqual(['Client', 'Excellent'])
    expect(units[0]?.payload?.pylons).toEqual({
      1: { CLSID: '{MISSILE_R-73_APU-73}', num: 1 },
      4: { CLSID: '{PTB_1500_MIG29A}', num: 4 }
    })
    expect(units[0]?.Radio?.[0]?.channels).toMatchObject({ 2: 251, 4: 305 })
    expect(mission.failures?.['RSBN_FAILURE_RECEIVER']).toEqual({
      id: 'RSBN_FAILURE_RECEIVER',
      enable: true,
      prob: 100,
      hh: 1,
      mm: 15,
      mmint: 1
    })
  })

  test('gives a profiled aircraft without TACAN no TACAN beacon and its own channel numbers', () => {
    const startTime = new Date('2026-01-01T00:00:00Z')
    const mission = createMission()
    const campaign = createCampaign(startTime)
    campaign.campaignParams = { navigationAid: 'targetTacan' }
    const group = createFlightGroup('mig', 'Enfield-1', startTime)
    group.aircrafts = [
      { id: 'mig-1', unitName: 'Enfield-1-1', aircraftName: 'MiG-29 Fulcrum', client: true }
    ]
    group.target = { id: 'objective-1', objectiveId: 'objective-1', type: 'Structure' }
    campaign.coalitions.player.flightGroups = [group]
    campaign.coalitions.opponent.flightGroups = []

    const result = addFlightGroups(mission, campaign, {
      ...theatre,
      objectives: [{ name: 'objective-1', type: 'Frontline', position: { x: 3000, y: 4000 } }]
    })
    if (result.isErr()) throw result.error

    expect(result.value[0]?.navigation?.tacan).toBeUndefined()
    expect(result.value[0]?.navigation?.landingTacan).toBeUndefined()
    expect(mission.coalition.blue.country?.[0]?.vehicle?.group ?? []).toHaveLength(0)
    // The R-862 numbers its presets from "Channel 0".
    expect(result.value[0]?.radioPreset).toEqual({ radio: 1, channel: 1, cockpitChannel: 0 })
  })
})

describe('addFlightGroups career missions', () => {
  test('leaves an uncrewed career mission out of the mission', () => {
    const startTime = new Date('2026-01-01T00:00:00Z')
    const mission = createMission()
    const campaign = createCampaign(startTime)
    const own = createFlightGroup('own', 'Enfield-1', startTime)
    own.careerMission = true
    const ato = createFlightGroup('ato', 'Uzi-1', startTime)
    campaign.coalitions.player.flightGroups = [own, ato]
    campaign.coalitions.opponent.flightGroups = []

    const result = addFlightGroups(mission, campaign, theatre)
    if (result.isErr()) throw result.error

    const groups = mission.coalition.blue.country?.[0]?.plane?.group ?? []
    expect(groups.map((group) => group.name)).toEqual([expect.stringContaining('Uzi-1')])
  })
})
