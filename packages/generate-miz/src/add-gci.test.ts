import { schemas } from '@dcc/contracts'
import { planCampaignGciStations, playerGciStationPosition, theatres } from '@dcc/data'
import { describe, expect, test } from 'vitest'
import * as z from 'zod'

import {
  addPlayerGciStation,
  addPlayerGciStations,
  FULCRUM_AIRCRAFT_NAME,
  GCI_CHANNEL,
  GCI_RANGE_METERS,
  GCI_STATION_TYPE
} from './add-gci'
import { buildMissionCullingPlan } from './mission-culling'

type Campaign = z.infer<typeof schemas.campaign.campaign>
type Mission = z.infer<typeof schemas.dcs.mission>
type Theatre = z.infer<typeof schemas.theatre>

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
    coalitions: { neutrals: [], blue: [0], red: [2] },
    coalition: {
      neutrals: { bullseye: { x: 0, y: 0 }, nav_points: [], name: 'neutrals', country: [] },
      blue: {
        bullseye: { x: 0, y: 0 },
        nav_points: [],
        name: 'blue',
        country: [{ id: 0, name: 'Russia', vehicle: { group: [] } }]
      },
      red: {
        bullseye: { x: 0, y: 0 },
        nav_points: [],
        name: 'red',
        country: [{ id: 2, name: 'USA', vehicle: { group: [] } }]
      }
    },
    result: { total: 0, offline: {}, blue: {}, red: {} }
  }
}

function createTheatre(): Theatre {
  return {
    name: 'Caucasus',
    objectives: [],
    targets: {},
    airdromeDetails: {
      'Test Base': {
        id: 1,
        name: 'Test Base',
        x: 4000,
        y: 5000,
        runwayAngle: 0,
        standlist: {}
      }
    },
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
}

function createCampaign(): Campaign {
  const createAircraftTypes = (): Campaign['coalitions']['player']['aircraftTypes'] =>
    Object.fromEntries(
      schemas.task.options.map((task) => [task, [] as string[]])
    ) as unknown as Campaign['coalitions']['player']['aircraftTypes']

  const createGroundUnitTypes = (): Campaign['coalitions']['player']['groundUnitTypes'] =>
    Object.fromEntries(
      schemas.groundUnitType.options.map((type) => [type, [] as string[]])
    ) as unknown as Campaign['coalitions']['player']['groundUnitTypes']

  const emptyCoalition = {
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

  const startTime = new Date('2026-01-01T00:00:00Z')
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
        airdromeNames: ['Test Base'],
        flightGroups: [
          {
            id: 'fulcrum-1',
            aircrafts: [
              {
                id: 'fulcrum-1-1',
                unitName: 'Enfield-1-1',
                aircraftName: FULCRUM_AIRCRAFT_NAME,
                client: true
              }
            ],
            task: 'CAP',
            position: { x: 1000, y: 1000 },
            homeBase: 'Test Base',
            callsign: 'Enfield-1',
            flightplan: {
              id: 'fulcrum-1-plan',
              startTime,
              waypoints: [
                {
                  name: 'Take Off',
                  position: { x: 1000, y: 1000 },
                  altitude: 0,
                  speed: 150,
                  type: 'TakeOff'
                }
              ]
            }
          }
        ]
      },
      opponent: { ...emptyCoalition, id: 'opponent' }
    }
  }
}

function addRadar(mission: Mission, type: string, x: number, y: number) {
  mission.currentKey += 1
  const groupId = mission.currentKey
  mission.currentKey += 1
  const unitId = mission.currentKey
  mission.coalition.blue.country![0]!.vehicle!.group.push({
    groupId,
    name: `Radar-${groupId}`,
    units: [{ unitId, name: `Radar-${groupId}-1`, x, y, type, heading: 0, skill: 'High' }],
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
          formation_template: ''
        }
      ]
    }
  })
}

function activateGciAction(mission: Mission) {
  const group = mission.coalition.blue.country?.[0]?.vehicle?.group.find(
    (candidate) => candidate.name === 'GCI-KRU-1'
  )
  const task = group?.route?.points[0]?.task as
    | {
        params?: {
          tasks?: Array<{ params?: { action?: { id?: string; params?: Record<string, unknown> } } }>
        }
      }
    | undefined
  return task?.params?.tasks?.[0]?.params?.action
}

describe('addPlayerGciStation', () => {
  test('places a KRU van with Activate GCI on channel 1 for a Fulcrum client', () => {
    const mission = createMission()
    addRadar(mission, '55G6 EWR', 4100, 5100)

    const result = addPlayerGciStation(mission, createCampaign(), createTheatre())

    expect(result).toMatchObject({
      groupName: 'GCI-KRU-1',
      unitName: 'GCI-KRU-1-1',
      channel: GCI_CHANNEL,
      radius: GCI_RANGE_METERS
    })
    const group = mission.coalition.blue.country?.[0]?.vehicle?.group.find(
      (candidate) => candidate.name === 'GCI-KRU-1'
    )
    expect(group?.units[0]?.type).toBe(GCI_STATION_TYPE)
    expect(group?.x).toBe(4400)
    expect(group?.y).toBe(5000)
    expect(activateGciAction(mission)).toEqual({
      id: 'ActivateGCI',
      params: {
        channel: 1,
        radius: 200_000,
        x: 0,
        y: 0,
        unitId: group?.units[0]?.unitId
      }
    })
  })

  test('does not place a station without a Fulcrum client', () => {
    const mission = createMission()
    const campaign = createCampaign()
    campaign.coalitions.player.flightGroups[0]!.aircrafts[0]!.aircraftName = 'F-16C_50'

    expect(addPlayerGciStation(mission, campaign, createTheatre())).toBeNull()
    expect(mission.coalition.blue.country?.[0]?.vehicle?.group).toEqual([])
  })

  test('does not place a station when the GCI toggle is off', () => {
    const mission = createMission()

    expect(
      addPlayerGciStation(mission, createCampaign(), createTheatre(), { enabled: false })
    ).toBeNull()
  })

  test('spawns three fallback EWRs when the player has no compatible radar', () => {
    const mission = createMission()

    addPlayerGciStation(mission, createCampaign(), createTheatre())

    const types = mission.coalition.blue.country?.[0]?.vehicle?.group.map(
      (group) => group.units[0]?.type
    )
    expect(types).toEqual([GCI_STATION_TYPE, '55G6 EWR', '55G6 EWR', '55G6 EWR'])
  })

  test('does not spawn fallback radars when a linked EWR is already in the mission', () => {
    const mission = createMission()
    addRadar(mission, '1L13 EWR', 4200, 5000)

    addPlayerGciStation(mission, createCampaign(), createTheatre())

    const types = mission.coalition.blue.country?.[0]?.vehicle?.group.map(
      (group) => group.units[0]?.type
    )
    expect(types).toEqual(['1L13 EWR', GCI_STATION_TYPE])
  })

  test('still plants fallback dishes when the only radar in range is a P-19', () => {
    const mission = createMission()
    addRadar(mission, 'p-19 s-125 sr', 4200, 5000)

    addPlayerGciStation(mission, createCampaign(), createTheatre())

    const types = mission.coalition.blue.country?.[0]?.vehicle?.group.map(
      (group) => group.units[0]?.type
    )
    expect(types).toEqual(['p-19 s-125 sr', GCI_STATION_TYPE, '55G6 EWR', '55G6 EWR', '55G6 EWR'])
  })

  test('keeps the home station when a radar is out of link range and spawns fallbacks', () => {
    const mission = createMission()
    addRadar(mission, 'p-19 s-125 sr', 400_000, 500_000)

    const result = addPlayerGciStation(mission, createCampaign(), createTheatre())

    expect(result?.position).toEqual({ x: 4400, y: 5000 })
    const types = mission.coalition.blue.country?.[0]?.vehicle?.group.map(
      (group) => group.units[0]?.type
    )
    expect(types).toEqual(['p-19 s-125 sr', GCI_STATION_TYPE, '55G6 EWR', '55G6 EWR', '55G6 EWR'])
  })
})

describe('playerGciStationPosition', () => {
  test('uses a career Fulcrum parking field when no client flight exists', () => {
    const campaign = createCampaign()
    campaign.coalitions.player.flightGroups = []
    campaign.career = {
      preferredAircraft: FULCRUM_AIRCRAFT_NAME,
      acquisitionRule: 'fidelity',
      money: 100,
      airframes: [
        {
          id: 'af-1',
          tailNumber: '01',
          aircraftName: FULCRUM_AIRCRAFT_NAME,
          condition: 'new',
          integrity: 1,
          hiddenDefects: [],
          location: 'Test Base',
          status: 'ready',
          acquiredAt: campaign.time
        }
      ],
      pilots: [],
      inventory: {},
      presets: [],
      radios: {},
      ledger: [],
      nextTailNumber: 2
    }

    expect(playerGciStationPosition(campaign, createTheatre())).toEqual({ x: 4400, y: 5000 })
  })
})

describe('theatre GCI network', () => {
  const germany = theatres.find((theatre) => theatre.name === 'Cold War Germany')!

  test('puts WAVE 1 on the Fulcrum home field and an enemy network on opponent airfields', () => {
    const campaign = createCampaign()
    campaign.coalitions.player.flightGroups[0]!.homeBase = 'Cochstedt'
    campaign.coalitions.player.airdromeNames = [
      'Laage',
      'Schonefeld',
      'Leipzig Mockau',
      'Cochstedt',
      'Tempelhof',
      'Tegel',
      'Gatow'
    ]
    campaign.coalitions.opponent.airdromeNames = [
      'Ramstein',
      'Frankfurt',
      'Fulda',
      'Fritzlar',
      'Hamburg',
      'Kiel'
    ]

    const planned = planCampaignGciStations(campaign, germany)

    expect(planned.player[0]).toMatchObject({
      channel: 1,
      airdromeName: 'Cochstedt',
      id: 'GCI-KRU-1',
      coalition: 'player'
    })
    expect(planned.opponent.length).toBeGreaterThan(0)
    expect(planned.opponent[0]?.channel).toBeGreaterThanOrEqual(11)
    expect(planned.opponent.every((station) => station.coalition === 'opponent')).toBe(true)

    for (const name of campaign.coalitions.player.airdromeNames) {
      const airdrome = germany.airdromeDetails[name]
      expect(airdrome).toBeDefined()
      const covered = planned.player.some(
        (station) =>
          Math.hypot(station.position.x - airdrome!.x, station.position.y - airdrome!.y) <=
          GCI_RANGE_METERS
      )
      expect(covered, `${name} left uncovered`).toBe(true)
    }
  })

  test('the live bubble keeps every GCI station in the mission', () => {
    const theatre = createTheatre()
    theatre.airdromeDetails['Far Base'] = {
      id: 2,
      name: 'Far Base',
      x: 400_000,
      y: 500_000,
      runwayAngle: 0,
      standlist: {}
    }
    const campaign = createCampaign()
    campaign.coalitions.player.airdromeNames = ['Test Base', 'Far Base']
    campaign.campaignParams = { culling: true, worldMode: 'bubble' }
    const mission = createMission()
    const cullingPlan = buildMissionCullingPlan(campaign, theatre)

    const spawned = addPlayerGciStations(mission, campaign, theatre, cullingPlan)

    expect(spawned.map((station) => station.airdromeName).sort()).toEqual(['Far Base', 'Test Base'])
  })

  test('culling keeps the home KRU and omits a station beyond the SAM corridor', () => {
    const theatre = createTheatre()
    theatre.airdromeDetails['Far Base'] = {
      id: 2,
      name: 'Far Base',
      x: 400_000,
      y: 500_000,
      runwayAngle: 0,
      standlist: {}
    }
    const campaign = createCampaign()
    campaign.coalitions.player.airdromeNames = ['Test Base', 'Far Base']
    campaign.campaignParams = { culling: true }
    const mission = createMission()
    const cullingPlan = buildMissionCullingPlan(campaign, theatre)

    const spawned = addPlayerGciStations(mission, campaign, theatre, cullingPlan)

    expect(spawned.map((station) => station.airdromeName)).toEqual(['Test Base'])
    expect(
      mission.coalition.blue.country?.[0]?.vehicle?.group.filter(
        (group) => group.units[0]?.type === GCI_STATION_TYPE
      )
    ).toHaveLength(1)
  })

  test('loads the whole friendly network when culling is off', () => {
    const theatre = createTheatre()
    theatre.airdromeDetails['Far Base'] = {
      id: 2,
      name: 'Far Base',
      x: 400_000,
      y: 500_000,
      runwayAngle: 0,
      standlist: {}
    }
    const campaign = createCampaign()
    campaign.coalitions.player.airdromeNames = ['Test Base', 'Far Base']
    campaign.campaignParams = { culling: false }
    const mission = createMission()
    const cullingPlan = buildMissionCullingPlan(campaign, theatre)

    const spawned = addPlayerGciStations(mission, campaign, theatre, cullingPlan)

    expect(spawned.map((station) => station.channel)).toEqual([1, 2])
  })

  test('places enemy GCI on the opponent coalition', () => {
    const theatre = createTheatre()
    theatre.airdromeDetails['Far Base'] = {
      id: 2,
      name: 'Far Base',
      x: 400_000,
      y: 500_000,
      runwayAngle: 0,
      standlist: {}
    }
    const campaign = createCampaign()
    campaign.coalitions.opponent.airdromeNames = ['Far Base']
    const mission = createMission()

    const spawned = addPlayerGciStations(mission, campaign, theatre)

    expect(spawned.some((station) => station.coalition === 'opponent')).toBe(true)
    expect(
      mission.coalition.red.country?.[0]?.vehicle?.group.some(
        (group) => group.units[0]?.type === GCI_STATION_TYPE
      )
    ).toBe(true)
  })
})
