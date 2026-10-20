import { describe, expect, test, vi, afterEach } from 'vitest'
import { config, schemas } from '@dcc/contracts'
import { scenarios, theatres } from '@dcc/data'
import type * as z from 'zod'

import {
  commitAtoPackages,
  defaultAtoPlannerPolicy,
  planAtoPackages,
  requestPackageSupport,
  type AtoPlannerPolicy
} from './ato-planner'
import { craterAirdrome, isAirdromeRecovering } from '../../airport-capture'
import { updateFlightGroups } from '../../update-flight-groups'

type Campaign = z.infer<typeof schemas.campaign.campaign>
type CoalitionData = Campaign['coalitions']['player']
type SpawnContext = Parameters<typeof planAtoPackages>[2]

const campaignTime = new Date('2026-01-01T12:00:00.000Z')

afterEach(() => {
  vi.restoreAllMocks()
})

function createAircraftTypes(overrides: Partial<CoalitionData['aircraftTypes']> = {}) {
  return {
    ...Object.fromEntries(schemas.task.options.map((task) => [task, [] as string[]])),
    ...overrides
  } as CoalitionData['aircraftTypes']
}

function createGroundUnitTypes(): CoalitionData['groundUnitTypes'] {
  return Object.fromEntries(
    schemas.groundUnitType.options.map((type) => [type, [] as string[]])
  ) as CoalitionData['groundUnitTypes']
}

function createCoalition(
  id: 'player' | 'opponent',
  aircraftTypes: Partial<CoalitionData['aircraftTypes']> = {}
): CoalitionData {
  return {
    id,
    aircraftTypes: createAircraftTypes(aircraftTypes),
    groundUnitTypes: createGroundUnitTypes(),
    airdromeNames: id === 'player' ? ['Home'] : ['Enemy'],
    objectiveIds: id === 'player' ? ['Home Objective'] : ['Target Objective'],
    structures: [],
    samGroups: [],
    groundGroups: [],
    flightGroups: [],
    packages: [],
    supplyNodes: {
      Home: {
        current: 10_000,
        max: 10_000,
        productionRate: 0,
        consumptionRate: 0,
        status: 'abundant'
      },
      'Home Objective': {
        current: 800,
        max: 1000,
        productionRate: 0,
        consumptionRate: 0,
        status: 'abundant'
      },
      Enemy: {
        current: 10_000,
        max: 10_000,
        productionRate: 0,
        consumptionRate: 0,
        status: 'abundant'
      },
      'Target Objective': {
        current: 800,
        max: 1000,
        productionRate: 0,
        consumptionRate: 0,
        status: 'abundant'
      }
    }
  }
}

function createCampaign(
  params: {
    playerAircraft?: Partial<CoalitionData['aircraftTypes']>
    opponentAircraft?: Partial<CoalitionData['aircraftTypes']>
  } = {}
): Campaign {
  return {
    version: 'test',
    id: 'campaign-1',
    name: 'Test Campaign',
    createdAt: campaignTime,
    updatedAt: campaignTime,
    time: campaignTime,
    timeMultiplier: 1,
    logs: [],
    scenarioId: 'test-scenario',
    // Planner tests see everything; fog of war has its own cases below.
    campaignParams: { fogOfWar: false },
    coalitions: {
      player: createCoalition('player', params.playerAircraft),
      opponent: createCoalition('opponent', params.opponentAircraft)
    }
  }
}

function createContext(): SpawnContext {
  return {
    enemyCoalition: 'opponent',
    scenario: {
      id: 'test-scenario',
      name: 'Test Scenario',
      description: '',
      theatreName: 'Test',
      available: true,
      goal: { coalition: 'player', objectiveIds: ['Target Objective'] },
      start: {
        player: { objectiveIds: ['Home Objective'], airdromeNames: ['Home'] },
        opponent: { objectiveIds: ['Target Objective'], airdromeNames: ['Enemy'] }
      }
    } as unknown as SpawnContext['scenario'],
    theatre: {
      name: 'Test',
      info: { center: { x: 0, y: 0 } },
      objectives: [
        { name: 'Home Objective', type: 'Frontline', position: { x: 0, y: 0 } },
        { name: 'Target Objective', type: 'Frontline', position: { x: 50_000, y: 0 } }
      ],
      targets: {},
      airdromeDetails: {
        Home: { name: 'Home', x: 0, y: 0, runwayAngle: 90 },
        Enemy: { name: 'Enemy', x: 100_000, y: 0, runwayAngle: 270 }
      }
    } as unknown as SpawnContext['theatre']
  }
}

function createOpponentContext(): SpawnContext {
  return {
    ...createContext(),
    enemyCoalition: 'player',
    theatre: {
      ...createContext().theatre,
      airdromeDetails: {
        Home: { name: 'Home', x: 0, y: 0, runwayAngle: 90 },
        Enemy: { name: 'Enemy', x: 100_000, y: 0, runwayAngle: 270 },
        'Enemy Reserve': { name: 'Enemy Reserve', x: 150_000, y: 0, runwayAngle: 270 }
      }
    } as unknown as SpawnContext['theatre']
  }
}

function plannerPolicy(overrides: Partial<AtoPlannerPolicy> = {}): AtoPlannerPolicy {
  return {
    ...defaultAtoPlannerPolicy,
    maxNewPackagesPerLogicTick: 10,
    maxActivePackages: 10,
    maxActiveAircraft: 40,
    ...overrides
  }
}

describe('ATO package planner', () => {
  test('keeps the Falklands carrier clear of land while preserving Harrier mission reach', () => {
    const scenario = scenarios.find((entry) => entry.id === 'falklands-1982')
    const theatre = theatres.find((entry) => entry.name === scenario?.theatreName)
    const carrier = scenario?.navalGroups?.player.find((group) => group.role === 'carrier')
    const escort = scenario?.navalGroups?.player.find((group) => group.role === 'escort')
    const argentineSurfaceGroup = scenario?.navalGroups?.opponent.find(
      (group) => group.role === 'surface-combatant'
    )
    const stanley = theatre?.objectives.find((objective) => objective.name === 'Stanley Airport')
    const foxBay = theatre?.objectives.find((objective) => objective.name === 'Fox Bay')
    const distance = (left: { x: number; y: number }, right: { x: number; y: number }) =>
      Math.hypot(left.x - right.x, left.y - right.y)

    expect(carrier).toBeDefined()
    expect(escort).toBeDefined()
    expect(argentineSurfaceGroup).toBeDefined()
    expect(stanley).toBeDefined()
    expect(foxBay).toBeDefined()

    expect(distance(carrier!.position, stanley!.position)).toBeGreaterThan(
      config.packages.CAP.engagementRange
    )
    expect(distance(carrier!.position, foxBay!.position)).toBeLessThanOrEqual(
      config.packages.CAS.maxDistance
    )
    expect(distance(carrier!.position, argentineSurfaceGroup!.position)).toBeLessThanOrEqual(
      config.packages['Antiship Strike'].maxDistance
    )
    expect(distance(carrier!.position, escort!.position)).toBeLessThan(10_000)
  })

  test('emits CAP for an uncovered reachable airbase lane', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0)
    const campaign = createCampaign({ playerAircraft: { CAP: ['F-16C_50'] } })

    const result = planAtoPackages(campaign, 'player', createContext(), plannerPolicy())
    const cap = result.admitted.find((plan) => plan.kind === 'cap')

    expect(cap).toBeDefined()
    expect(cap?.reason).toBe('Uncovered CAP lane')
  })

  test('emits OCA against a reachable enemy airfield', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0)
    const campaign = createCampaign({ playerAircraft: { 'Runway Attack': ['F-86F Sabre'] } })

    const result = planAtoPackages(campaign, 'player', createContext(), plannerPolicy())
    const oca = result.admitted.find((plan) => plan.kind === 'oca')

    expect(oca?.targetId).toBe('Enemy')
    expect(oca?.targetType).toBe('Airbase')
    expect(oca?.flights[0]?.task).toBe('Runway Attack')
  })

  test('does not OCA a cratered airfield, and that field cannot launch', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0)
    const campaign = createCampaign({
      playerAircraft: { 'Runway Attack': ['F-4E-45MC'] },
      opponentAircraft: { CAP: ['MiG-21Bis'] }
    })
    craterAirdrome(campaign, 'opponent', 'Enemy', campaign.time)

    const playerResult = planAtoPackages(campaign, 'player', createContext(), plannerPolicy())
    const opponentResult = planAtoPackages(
      campaign,
      'opponent',
      createOpponentContext(),
      plannerPolicy()
    )

    expect(playerResult.admitted.some((plan) => plan.kind === 'oca')).toBe(false)
    expect(
      opponentResult.rejected.some(
        (entry) => entry.kind === 'cap' && entry.reason === 'supply blocked'
      )
    ).toBe(true)
  })

  test('OCA Time-on-Target craters the enemy airfield', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0)
    const campaign = createCampaign({ playerAircraft: { 'Runway Attack': ['F-4E-45MC'] } })
    const context = createContext()
    const planned = planAtoPackages(campaign, 'player', context, plannerPolicy())
    const oca = planned.admitted.find((plan) => plan.kind === 'oca')
    expect(oca).toBeDefined()
    commitAtoPackages(campaign, 'player', [oca!])

    campaign.time = oca!.tot
    updateFlightGroups(campaign, 'player')

    expect(isAirdromeRecovering(campaign, 'opponent', 'Enemy')).toBe(true)
  })

  test('places BARCAP on the land-graph FLOT instead of the home airfield', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0)
    const campaign = createCampaign({ playerAircraft: { CAP: ['F-16C_50'] } })
    campaign.operationProfile = {
      archetype: 'balanced',
      frontlineShape: 'linear',
      tempo: 'standard',
      initiativeCoalition: 'player'
    }
    const context = createContext()
    context.theatre = {
      ...context.theatre,
      connections: [
        {
          from: 'Home Objective',
          to: 'Target Objective',
          mode: 'road',
          bidirectional: true,
          waypoints: []
        }
      ]
    }

    const result = planAtoPackages(campaign, 'player', context, plannerPolicy())
    const patrol = result.admitted.find((plan) => plan.kind === 'cap')?.flights[0]?.patrolCenter

    expect(result.admitted.find((plan) => plan.kind === 'cap')?.reason).toBe('BARCAP on the FLOT')
    expect(patrol?.x).toBeCloseTo(27_500)
    expect(patrol?.y).toBeCloseTo(0)
  })

  test('Korea-era empty AWACS list does not plan an orbit', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0)
    const campaign = createCampaign({ playerAircraft: { CAP: ['F-86F Sabre'] } })

    const result = planAtoPackages(campaign, 'player', createContext(), plannerPolicy())

    expect(result.admitted.some((plan) => plan.kind === 'awacs')).toBe(false)
    expect(
      result.rejected.some((entry) => entry.kind === 'awacs' && entry.reason === 'no aircraft')
    ).toBe(true)
  })

  test('Late CW E-3A orbits behind the FLOT', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0)
    const campaign = createCampaign({ playerAircraft: { AWACS: ['E-3A'] } })
    campaign.operationProfile = {
      archetype: 'balanced',
      frontlineShape: 'linear',
      tempo: 'standard',
      initiativeCoalition: 'player'
    }
    const context = createContext()
    context.theatre = {
      ...context.theatre,
      connections: [
        {
          from: 'Home Objective',
          to: 'Target Objective',
          mode: 'road',
          bidirectional: true,
          waypoints: []
        }
      ]
    }

    const result = planAtoPackages(campaign, 'player', context, plannerPolicy())
    const awacs = result.admitted.find((plan) => plan.kind === 'awacs')

    expect(awacs?.reason).toBe('AWACS orbit behind the FLOT')
    expect(awacs?.flights[0]?.task).toBe('AWACS')
    expect(awacs?.flights[0]?.aircraftType).toBe('E-3A')
    expect(awacs?.flights[0]?.patrolCenter?.x).toBeCloseTo(14_000)
    expect(awacs?.flights[0]?.patrolCenter?.y).toBeCloseTo(0)
  })

  test('does not plan a second AWACS while one is on station', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0)
    const campaign = createCampaign({ playerAircraft: { AWACS: ['E-3A'] } })
    const context = createContext()
    const planned = planAtoPackages(campaign, 'player', context, plannerPolicy())
    const awacs = planned.admitted.find((plan) => plan.kind === 'awacs')
    expect(awacs).toBeDefined()
    commitAtoPackages(campaign, 'player', [awacs!])

    const again = planAtoPackages(campaign, 'player', context, plannerPolicy())

    expect(again.admitted.some((plan) => plan.kind === 'awacs')).toBe(false)
    expect(
      again.rejected.some((entry) => entry.kind === 'awacs' && entry.reason === 'budget exhausted')
    ).toBe(true)
  })

  function addInboundRaid(campaign: Campaign, packageId = 'enemy-strike-1') {
    const tot = new Date(campaignTime.getTime() + 40 * 60 * 1000)
    campaign.coalitions.opponent.packages.push({
      id: packageId,
      type: 'Strike Package',
      targetObjectiveId: 'Home Objective',
      members: [{ flightGroupId: 'raid-1', role: 'primary', totOffset: 0 }],
      tot,
      originalTot: tot,
      status: 'active'
    })
    campaign.coalitions.opponent.flightGroups.push({
      id: 'raid-1',
      aircrafts: [{ id: 'raid-ac-1', unitName: 'Uzi-1-1', aircraftName: 'MiG-21Bis' }],
      task: 'Pinpoint Strike',
      position: { x: 100_000, y: 0 },
      homeBase: 'Enemy',
      callsign: 'Uzi-1',
      target: { id: 'home-obj', type: 'Structure', objectiveId: 'Home Objective' },
      flightplan: { id: 'raid-plan', startTime: campaignTime, waypoints: [] },
      packageId
    })
  }

  test('does not scramble when no inbound raid exists', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0)
    const campaign = createCampaign({ playerAircraft: { Intercept: ['F-86F Sabre'] } })

    const result = planAtoPackages(campaign, 'player', createContext(), plannerPolicy())

    expect(result.admitted.some((plan) => plan.kind === 'intercept')).toBe(false)
    expect(
      result.rejected.some((entry) => entry.kind === 'intercept' && entry.reason === 'no target')
    ).toBe(true)
  })

  test('Korea F-86 scrambles against an inbound strike and beats a CAP', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0)
    const campaign = createCampaign({
      playerAircraft: { CAP: ['F-86F Sabre'], Intercept: ['F-86F Sabre'] }
    })
    campaign.operationProfile = {
      archetype: 'balanced',
      frontlineShape: 'linear',
      tempo: 'cautious',
      initiativeCoalition: 'opponent'
    }
    addInboundRaid(campaign)

    const result = planAtoPackages(
      campaign,
      'player',
      createContext(),
      plannerPolicy({ maxNewPackagesPerLogicTick: 1 })
    )
    const intercept = result.admitted.find((plan) => plan.kind === 'intercept')

    expect(result.admitted.map((plan) => plan.kind)).toEqual(['intercept'])
    expect(intercept?.flights[0]?.task).toBe('Intercept')
    expect(intercept?.flights[0]?.aircraftType).toBe('F-86F Sabre')
    expect(intercept?.targetId).toBe('enemy-strike-1')
    expect(intercept?.flights[0]?.targetPosition.x).toBeCloseTo(25_000)
  })

  test('Late CW F-14 scrambles against inbound OCA', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0)
    const campaign = createCampaign({ playerAircraft: { Intercept: ['F-14A-135-GR'] } })
    const tot = new Date(campaignTime.getTime() + 40 * 60 * 1000)
    campaign.coalitions.opponent.packages.push({
      id: 'enemy-oca-1',
      type: 'OCA Package',
      targetObjectiveId: 'Home',
      members: [{ flightGroupId: 'oca-1', role: 'primary', totOffset: 0 }],
      tot,
      originalTot: tot,
      status: 'active'
    })
    campaign.coalitions.opponent.flightGroups.push({
      id: 'oca-1',
      aircrafts: [{ id: 'oca-ac-1', unitName: 'Uzi-1-1', aircraftName: 'MiG-21Bis' }],
      task: 'Runway Attack',
      position: { x: 100_000, y: 0 },
      homeBase: 'Enemy',
      callsign: 'Uzi-1',
      target: { id: 'Home', type: 'Airbase', objectiveId: 'Home' },
      flightplan: { id: 'oca-plan', startTime: campaignTime, waypoints: [] },
      packageId: 'enemy-oca-1'
    })

    const result = planAtoPackages(campaign, 'player', createContext(), plannerPolicy())
    const intercept = result.admitted.find((plan) => plan.kind === 'intercept')

    expect(intercept?.flights[0]?.aircraftType).toBe('F-14A-135-GR')
    expect(intercept?.targetObjectiveId).toBe('Home')
    expect(intercept?.reason).toBe('Scramble against an inbound raid')
  })

  test('empty Intercept list still scrambles with CAP aircraft', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0)
    const campaign = createCampaign({ playerAircraft: { CAP: ['F-4E-45MC'] } })
    addInboundRaid(campaign)

    const result = planAtoPackages(campaign, 'player', createContext(), plannerPolicy())
    const intercept = result.admitted.find((plan) => plan.kind === 'intercept')

    expect(intercept?.flights[0]?.aircraftType).toBe('F-4E-45MC')
  })

  test('does not scramble when BARCAP already covers the inbound', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0)
    const campaign = createCampaign({
      playerAircraft: { CAP: ['F-86F Sabre'], Intercept: ['F-86F Sabre'] }
    })
    addInboundRaid(campaign)
    campaign.coalitions.player.flightGroups.push({
      id: 'cap-1',
      aircrafts: [{ id: 'cap-ac-1', unitName: 'Enfield-1-1', aircraftName: 'F-86F Sabre' }],
      task: 'CAP',
      position: { x: 25_000, y: 0 },
      homeBase: 'Home',
      callsign: 'Enfield-1',
      flightplan: {
        id: 'cap-plan',
        startTime: campaignTime,
        waypoints: [
          {
            name: 'Racetrack Start',
            position: { x: 20_000, y: 0 },
            altitude: 7000,
            speed: 200,
            type: 'Task'
          },
          {
            name: 'Racetrack End',
            position: { x: 30_000, y: 0 },
            altitude: 7000,
            speed: 200,
            type: 'RaceTrack End'
          }
        ]
      }
    })

    const result = planAtoPackages(campaign, 'player', createContext(), plannerPolicy())

    expect(result.admitted.some((plan) => plan.kind === 'intercept')).toBe(false)
    expect(
      result.rejected.some((entry) => entry.kind === 'intercept' && entry.reason === 'no target')
    ).toBe(true)
  })

  test('a recovering field cannot scramble', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0)
    const campaign = createCampaign({ playerAircraft: { Intercept: ['F-86F Sabre'] } })
    addInboundRaid(campaign)
    craterAirdrome(campaign, 'player', 'Home', campaign.time)

    const result = planAtoPackages(campaign, 'player', createContext(), plannerPolicy())

    expect(result.admitted.some((plan) => plan.kind === 'intercept')).toBe(false)
    expect(
      result.rejected.some(
        (entry) => entry.kind === 'intercept' && entry.reason === 'supply blocked'
      )
    ).toBe(true)
  })

  test('Korea-era cautious ATO does not push a fighter sweep past the FLOT', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0)
    const campaign = createCampaign({
      playerAircraft: { CAP: ['F-86F Sabre'], 'Fighter Sweep': ['F-86F Sabre'] }
    })
    campaign.operationProfile = {
      archetype: 'balanced',
      frontlineShape: 'linear',
      tempo: 'cautious',
      initiativeCoalition: 'player'
    }
    const context = createContext()
    context.theatre = {
      ...context.theatre,
      connections: [
        {
          from: 'Home Objective',
          to: 'Target Objective',
          mode: 'road',
          bidirectional: true,
          waypoints: []
        }
      ]
    }

    const result = planAtoPackages(campaign, 'player', context, plannerPolicy())

    expect(result.admitted.some((plan) => plan.kind === 'sweep')).toBe(false)
    expect(
      result.rejected.some((entry) => entry.kind === 'sweep' && entry.reason === 'no target')
    ).toBe(true)
  })

  test('Late CW fighter sweep pushes past BARCAP on the FLOT', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0)
    const campaign = createCampaign({ playerAircraft: { 'Fighter Sweep': ['F-5E-3'] } })
    campaign.operationProfile = {
      archetype: 'balanced',
      frontlineShape: 'linear',
      tempo: 'standard',
      initiativeCoalition: 'player'
    }
    const context = createContext()
    context.theatre = {
      ...context.theatre,
      connections: [
        {
          from: 'Home Objective',
          to: 'Target Objective',
          mode: 'road',
          bidirectional: true,
          waypoints: []
        }
      ]
    }

    const result = planAtoPackages(campaign, 'player', context, plannerPolicy())
    const sweep = result.admitted.find((plan) => plan.kind === 'sweep')

    expect(sweep?.reason).toBe('Fighter sweep past the FLOT')
    expect(sweep?.flights[0]?.task).toBe('Fighter Sweep')
    expect(sweep?.flights[0]?.aircraftType).toBe('F-5E-3')
    expect(sweep?.flights[0]?.patrolCenter?.x).toBeCloseTo(39_000)
    expect(sweep?.flights[0]?.patrolCenter?.y).toBeCloseTo(0)
  })

  test('empty Fighter Sweep list still sweeps with CAP aircraft', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0)
    const campaign = createCampaign({ playerAircraft: { CAP: ['F-14A-135-GR'] } })
    campaign.operationProfile = {
      archetype: 'air-superiority',
      frontlineShape: 'linear',
      tempo: 'standard'
    }

    const result = planAtoPackages(campaign, 'player', createContext(), plannerPolicy())
    const sweep = result.admitted.find((plan) => plan.kind === 'sweep')

    expect(sweep?.flights[0]?.aircraftType).toBe('F-14A-135-GR')
  })

  test('a defending cautious Korea CAP sits short of the FLOT and beats a deep strike', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0)
    const campaign = createCampaign({
      playerAircraft: { CAP: ['F-86F Sabre'], 'Pinpoint Strike': ['F-86F Sabre'] }
    })
    campaign.operationProfile = {
      archetype: 'balanced',
      frontlineShape: 'linear',
      tempo: 'cautious',
      initiativeCoalition: 'opponent'
    }
    campaign.coalitions.opponent.structures = [
      {
        id: 'structure-1',
        type: 'Ammo Depot',
        objectiveId: 'Target Objective',
        position: { x: 50_000, y: 0 },
        name: 'Ammo Depot',
        resources: 0,
        buildings: [{ offset: { x: 0, y: 0 }, type: 'Workshop A', alive: true }]
      }
    ]
    const context = createContext()
    context.theatre = {
      ...context.theatre,
      connections: [
        {
          from: 'Home Objective',
          to: 'Target Objective',
          mode: 'road',
          bidirectional: true,
          waypoints: []
        }
      ]
    }

    const result = planAtoPackages(
      campaign,
      'player',
      context,
      plannerPolicy({ maxNewPackagesPerLogicTick: 1 })
    )
    const cap = result.admitted.find((plan) => plan.kind === 'cap')

    expect(result.admitted.map((plan) => plan.kind)).toEqual(['cap'])
    expect(cap?.flights[0]?.patrolCenter?.x).toBeCloseTo(11_000)
    expect(cap?.flights[0]?.patrolCenter?.y).toBeCloseTo(0)
  })

  test('uses another reachable airbase when the nearest base cannot support combat flights', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0)
    const campaign = createCampaign({ opponentAircraft: { CAP: ['MiG-21Bis'] } })
    campaign.coalitions.opponent.airdromeNames = ['Enemy', 'Enemy Reserve']
    campaign.coalitions.opponent.supplyNodes = {
      Enemy: {
        current: 100,
        max: 1000,
        productionRate: 0,
        consumptionRate: 0,
        status: 'critical'
      },
      'Enemy Reserve': {
        current: 10_000,
        max: 10_000,
        productionRate: 20,
        consumptionRate: 0,
        status: 'abundant'
      }
    }

    const result = planAtoPackages(campaign, 'opponent', createOpponentContext(), plannerPolicy())
    const cap = result.admitted.find((plan) => plan.kind === 'cap')

    expect(cap?.flights[0]?.homeBase.name).toBe('Enemy Reserve')
  })

  test('randomly picks among viable reachable airbases for normal tasks', () => {
    const randomSpy = vi.spyOn(Math, 'random')
    randomSpy.mockReturnValueOnce(0.9).mockReturnValue(0)
    const campaign = createCampaign({ opponentAircraft: { 'Pinpoint Strike': ['MiG-21Bis'] } })
    campaign.coalitions.opponent.airdromeNames = ['Enemy', 'Enemy Reserve']
    campaign.coalitions.opponent.supplyNodes = {
      Enemy: {
        current: 10_000,
        max: 10_000,
        productionRate: 20,
        consumptionRate: 0,
        status: 'abundant'
      },
      'Enemy Reserve': {
        current: 10_000,
        max: 10_000,
        productionRate: 20,
        consumptionRate: 0,
        status: 'abundant'
      }
    }
    campaign.coalitions.player.structures = [
      {
        id: 'structure-1',
        type: 'Ammo Depot',
        objectiveId: 'Home Objective',
        position: { x: 0, y: 0 },
        name: 'Ammo Depot',
        resources: 0,
        buildings: [{ offset: { x: 0, y: 0 }, type: 'Workshop A', alive: true }]
      }
    ]

    const result = planAtoPackages(campaign, 'opponent', createOpponentContext(), plannerPolicy())
    const strike = result.admitted.find((plan) => plan.kind === 'strike')

    expect(strike?.flights[0]?.homeBase.name).toBe('Enemy Reserve')
  })

  test('emits strike plus SEAD when a reachable structure is covered by an operational SAM', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0)
    const campaign = createCampaign({
      playerAircraft: { 'Pinpoint Strike': ['F-16C_50'], SEAD: ['F-16C_50'] }
    })
    campaign.coalitions.opponent.structures = [
      {
        id: 'structure-1',
        type: 'Ammo Depot',
        objectiveId: 'Target Objective',
        position: { x: 50_000, y: 0 },
        name: 'Ammo Depot',
        resources: 0,
        buildings: [{ offset: { x: 0, y: 0 }, type: 'Workshop A', alive: true }]
      }
    ]
    campaign.coalitions.opponent.samGroups = [
      { id: 'sam-1', type: 'SA-6', objectiveId: 'Target Objective' }
    ]

    const result = planAtoPackages(campaign, 'player', createContext(), plannerPolicy())
    const strike = result.admitted.find((plan) => plan.kind === 'strike')

    expect(strike?.flights.map((flight) => flight.task)).toEqual([
      'Pinpoint Strike',
      'SEAD',
      'DEAD'
    ])
  })

  test('attrition ATO prefers a depot over a barrack and labels it a logistics strike', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0)
    const campaign = createCampaign({ playerAircraft: { 'Pinpoint Strike': ['F-16C_50'] } })
    campaign.operationProfile = {
      archetype: 'attrition',
      frontlineShape: 'linear',
      tempo: 'standard'
    }
    campaign.coalitions.opponent.structures = [
      {
        id: 'barrack-1',
        type: 'Barrack',
        objectiveId: 'Target Objective',
        position: { x: 50_000, y: 0 },
        name: 'Barrack',
        resources: 0,
        buildings: [{ offset: { x: 0, y: 0 }, type: 'Workshop A', alive: true }]
      },
      {
        id: 'depot-1',
        type: 'Ammo Depot',
        objectiveId: 'Target Objective',
        position: { x: 50_000, y: 0 },
        name: 'Ammo Depot',
        resources: 0,
        buildings: [{ offset: { x: 0, y: 0 }, type: 'Workshop A', alive: true }]
      }
    ]

    const result = planAtoPackages(campaign, 'player', createContext(), plannerPolicy())
    const strike = result.admitted.find((plan) => plan.kind === 'strike')

    expect(strike?.targetType).toBe('Ammo Depot')
    expect(strike?.variantId).toBe('logistics-strike')
  })

  test('attaches escort CAP to a Korea-era strike that has no SEAD or DEAD aircraft', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0)
    const campaign = createCampaign({
      playerAircraft: { 'Pinpoint Strike': ['F-86F Sabre'], CAP: ['F-86F Sabre'] }
    })
    campaign.coalitions.opponent.structures = [
      {
        id: 'structure-1',
        type: 'Ammo Depot',
        objectiveId: 'Target Objective',
        position: { x: 50_000, y: 0 },
        name: 'Ammo Depot',
        resources: 0,
        buildings: [{ offset: { x: 0, y: 0 }, type: 'Workshop A', alive: true }]
      }
    ]

    const result = planAtoPackages(campaign, 'player', createContext(), plannerPolicy())
    const strike = result.admitted.find((plan) => plan.kind === 'strike')
    const tot = strike?.tot.getTime() ?? 0
    const cap = strike?.flights.find((flight) => flight.task === 'CAP')

    expect(strike?.flights.map((flight) => flight.task)).toEqual(['Pinpoint Strike', 'CAP'])
    expect(cap?.tot?.getTime()).toBe(tot - config.packages.CAP.escortLeadTime)
  })

  test('times SEAD, DEAD, and escort CAP to the same Late CW strike ToT', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0)
    const campaign = createCampaign({
      playerAircraft: {
        'Pinpoint Strike': ['F-4E-45MC'],
        SEAD: ['F-4E-45MC'],
        DEAD: ['F-4E-45MC'],
        CAP: ['F-5E-3']
      }
    })
    campaign.coalitions.opponent.structures = [
      {
        id: 'structure-1',
        type: 'Ammo Depot',
        objectiveId: 'Target Objective',
        position: { x: 50_000, y: 0 },
        name: 'Ammo Depot',
        resources: 0,
        buildings: [{ offset: { x: 0, y: 0 }, type: 'Workshop A', alive: true }]
      }
    ]
    campaign.coalitions.opponent.samGroups = [
      { id: 'sam-1', type: 'SA-6', objectiveId: 'Target Objective' }
    ]

    const result = planAtoPackages(campaign, 'player', createContext(), plannerPolicy())
    const strike = result.admitted.find((plan) => plan.kind === 'strike')
    const tot = strike?.tot.getTime() ?? 0
    const byTask = Object.fromEntries(
      (strike?.flights ?? []).map((flight) => [flight.task, flight.tot?.getTime()])
    )

    expect(strike?.flights.map((flight) => flight.task)).toEqual([
      'Pinpoint Strike',
      'SEAD',
      'DEAD',
      'CAP'
    ])
    expect(byTask.SEAD).toBe(tot - config.packages.SEAD.leadTime)
    expect(byTask.DEAD).toBe(tot - config.packages.DEAD.leadTime)
    expect(byTask.CAP).toBe(tot - config.packages.CAP.escortLeadTime)
    expect(result.candidates.some((plan) => plan.kind === 'dead')).toBe(false)
  })

  test('emits standalone DEAD for an untargeted SAM', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0)
    const campaign = createCampaign({ playerAircraft: { DEAD: ['F-16C_50'] } })
    campaign.coalitions.opponent.samGroups = [
      { id: 'sam-1', type: 'SA-6', objectiveId: 'Target Objective' }
    ]

    const result = planAtoPackages(campaign, 'player', createContext(), plannerPolicy())

    expect(result.admitted.some((plan) => plan.kind === 'dead')).toBe(true)
  })

  test('emits standalone DEAD for an untargeted persistent EWR', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0)
    const campaign = createCampaign({ playerAircraft: { DEAD: ['F-16C_50'] } })
    campaign.coalitions.opponent.ewrGroups = [
      {
        id: 'ewr-1',
        type: '55G6 EWR',
        objectiveId: 'Target Objective',
        position: { x: 50_000, y: 0 }
      }
    ]

    const result = planAtoPackages(campaign, 'player', createContext(), plannerPolicy())
    const dead = result.admitted.find((plan) => plan.kind === 'dead')

    expect(dead).toMatchObject({
      targetId: 'ewr-1',
      targetType: '55G6 EWR'
    })
  })

  test('clears the nearest SAM before a farther EWR from a carrier', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.99)
    const campaign = createCampaign({ playerAircraft: { DEAD: ['F-16C_50'] } })
    const context = createContext()
    campaign.coalitions.player.airdromeNames = []
    campaign.coalitions.player.navalGroups = [
      {
        id: 'carrier-1',
        name: 'Carrier 1',
        role: 'carrier',
        unitTypes: ['CVN_71'],
        position: { x: 0, y: 0 },
        heading: 0,
        damage: 0,
        fuel: 1,
        ammunition: 1,
        cargo: 0,
        state: 'operational'
      }
    ]
    context.theatre.objectives.push({
      name: 'Near SAM',
      type: 'Frontline',
      position: { x: 25_000, y: 0 }
    })
    campaign.coalitions.opponent.samGroups = [
      { id: 'near-sam', type: 'SA-6', objectiveId: 'Near SAM' }
    ]
    campaign.coalitions.opponent.ewrGroups = [
      {
        id: 'far-ewr',
        type: '55G6 EWR',
        objectiveId: 'Far EWR',
        position: { x: 200_000, y: 0 }
      }
    ]

    const result = planAtoPackages(campaign, 'player', context, plannerPolicy())
    const dead = result.admitted.find((plan) => plan.kind === 'dead')

    expect(dead).toMatchObject({
      targetId: 'near-sam',
      targetType: 'SA-6',
      reason: 'Nearest untargeted radar emitter'
    })
    expect(dead?.flights[0]?.homeBase.name).toBe('carrier-1')
  })

  test('uses DEAD-capable aircraft from other task lists when saved DEAD list is empty', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0)
    const campaign = createCampaign({
      playerAircraft: {
        DEAD: [],
        SEAD: ['F-4E-45MC'],
        'Ground Attack': ['F-4E-45MC']
      }
    })
    campaign.coalitions.opponent.samGroups = [
      { id: 'sam-1', type: 'SA-6', objectiveId: 'Target Objective' }
    ]

    const result = planAtoPackages(campaign, 'player', createContext(), plannerPolicy())
    const dead = result.admitted.find((plan) => plan.kind === 'dead')

    expect(dead?.flights[0]?.aircraftType).toBe('F-4E-45MC')
  })

  test('uses AI-only Russian DEAD-capable aircraft from other task lists when saved DEAD list is empty', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0)
    const campaign = createCampaign({
      playerAircraft: {
        DEAD: [],
        SEAD: ['Su-17M4'],
        'Ground Attack': ['Su-17M4']
      }
    })
    campaign.coalitions.opponent.samGroups = [
      { id: 'sam-1', type: 'SA-6', objectiveId: 'Target Objective' }
    ]

    const result = planAtoPackages(campaign, 'player', createContext(), plannerPolicy())
    const dead = result.admitted.find((plan) => plan.kind === 'dead')

    expect(dead?.flights[0]?.aircraftType).toBe('Su-17M4')
  })

  test('prioritizes DEAD for active SAMs when package admission is constrained', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0)
    const campaign = createCampaign({
      playerAircraft: {
        CAP: ['F-16C_50'],
        DEAD: ['F-16C_50'],
        'Pinpoint Strike': ['F-16C_50']
      }
    })
    campaign.coalitions.opponent.structures = [
      {
        id: 'structure-1',
        type: 'Ammo Depot',
        objectiveId: 'Target Objective',
        position: { x: 50_000, y: 0 },
        name: 'Ammo Depot',
        resources: 0,
        buildings: [{ offset: { x: 0, y: 0 }, type: 'Workshop A', alive: true }]
      }
    ]
    campaign.coalitions.opponent.samGroups = [
      { id: 'sam-1', type: 'SA-6', objectiveId: 'Target Objective' }
    ]

    const result = planAtoPackages(
      campaign,
      'player',
      createContext(),
      plannerPolicy({ maxNewPackagesPerLogicTick: 2 })
    )

    expect(
      result.admitted
        .find((plan) => plan.kind === 'strike')
        ?.flights.some((flight) => flight.task === 'DEAD')
    ).toBe(true)
    expect(result.admitted.some((plan) => plan.kind === 'dead')).toBe(false)
  })

  test('emits CAS for a valid enemy ground group', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0)
    const campaign = createCampaign({ playerAircraft: { CAS: ['A-10C_2'] } })
    campaign.coalitions.opponent.groundGroups = [
      {
        id: 'ground-1',
        objectiveId: 'Target Objective',
        position: { x: 50_000, y: 0 },
        state: 'idle',
        units: [{ name: 'BMP-2', count: 4 }]
      }
    ]

    const result = planAtoPackages(campaign, 'player', createContext(), plannerPolicy())

    expect(result.admitted.some((plan) => plan.kind === 'cas')).toBe(true)
  })

  test('BAI prefers an enemy formation on the FLOT over a rear garrison', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0)
    const campaign = createCampaign({ playerAircraft: { CAS: ['A-10C_2'] } })
    campaign.coalitions.opponent.objectiveIds = ['Target Objective', 'Rear Objective']
    campaign.coalitions.opponent.groundGroups = [
      {
        id: 'rear-1',
        objectiveId: 'Rear Objective',
        position: { x: 200_000, y: 0 },
        state: 'idle',
        units: [{ name: 'BMP-2', count: 4 }]
      },
      {
        id: 'flot-1',
        objectiveId: 'Target Objective',
        position: { x: 50_000, y: 0 },
        state: 'idle',
        units: [{ name: 'BMP-2', count: 4 }]
      }
    ]
    const context = createContext()
    context.theatre = {
      ...context.theatre,
      objectives: [
        ...context.theatre.objectives,
        { name: 'Rear Objective', type: 'Frontline', position: { x: 200_000, y: 0 } }
      ],
      connections: [
        {
          from: 'Home Objective',
          to: 'Target Objective',
          mode: 'road',
          bidirectional: true,
          waypoints: []
        },
        {
          from: 'Target Objective',
          to: 'Rear Objective',
          mode: 'road',
          bidirectional: true,
          waypoints: []
        }
      ]
    }

    const result = planAtoPackages(campaign, 'player', context, plannerPolicy())
    const cas = result.admitted.find((plan) => plan.kind === 'cas')

    expect(cas?.variantId).toBe('bai')
    expect(cas?.targetId).toBe('flot-1')

    // Under fog of war an unseen formation is not a BAI target; armed recon goes looking instead.
    campaign.campaignParams = { fogOfWar: true }
    const blind = planAtoPackages(campaign, 'player', context, plannerPolicy())
    expect(blind.admitted.find((plan) => plan.kind === 'cas')?.variantId).toBe('armed-recon')

    campaign.coalitions.player.intel = {
      'flot-1': {
        kind: 'ground',
        position: { x: 50_000, y: 0 },
        seenAt: campaignTime,
        source: 'aircraft'
      }
    }
    const sighted = planAtoPackages(campaign, 'player', context, plannerPolicy())
    expect(sighted.admitted.find((plan) => plan.kind === 'cas')?.variantId).toBe('bai')
  })

  test('uses a FARP as the home base for helicopter CAS', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0)
    const campaign = createCampaign({ playerAircraft: { CAS: ['AH-64D_BLK_II'] } })
    campaign.coalitions.player.airdromeNames = []
    campaign.coalitions.player.structures = [
      {
        id: 'farp-1',
        type: 'Farp',
        objectiveId: 'Home Objective',
        position: { x: 40_000, y: 0 },
        name: 'Forward FARP',
        resources: 0,
        buildings: []
      }
    ]
    campaign.coalitions.opponent.groundGroups = [
      {
        id: 'ground-1',
        objectiveId: 'Target Objective',
        position: { x: 50_000, y: 0 },
        state: 'idle',
        units: [{ name: 'BMP-2', count: 4 }]
      }
    ]

    const result = planAtoPackages(campaign, 'player', createContext(), plannerPolicy())
    const cas = result.admitted.find((plan) => plan.kind === 'cas')

    expect(cas?.flights[0]?.homeBase).toMatchObject({
      name: 'farp-1',
      position: { x: 40_000, y: 0 }
    })
    expect(cas?.flights[0]?.aircraftType).toBe('AH-64D_BLK_II')

    if (cas) commitAtoPackages(campaign, 'player', [cas])
    expect(campaign.coalitions.player.flightGroups[0]).toMatchObject({
      homeBase: 'farp-1',
      position: { x: 40_000, y: 0 },
      task: 'CAS'
    })
  })

  test('does not use a FARP as the home base for fixed-wing CAS', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0)
    const campaign = createCampaign({ playerAircraft: { CAS: ['A-10C_2'] } })
    campaign.coalitions.player.airdromeNames = []
    campaign.coalitions.player.structures = [
      {
        id: 'farp-1',
        type: 'Farp',
        objectiveId: 'Home Objective',
        position: { x: 40_000, y: 0 },
        name: 'Forward FARP',
        resources: 0,
        buildings: []
      }
    ]
    campaign.coalitions.opponent.groundGroups = [
      {
        id: 'ground-1',
        objectiveId: 'Target Objective',
        position: { x: 50_000, y: 0 },
        state: 'idle',
        units: [{ name: 'BMP-2', count: 4 }]
      }
    ]

    const result = planAtoPackages(campaign, 'player', createContext(), plannerPolicy())

    expect(result.admitted.some((plan) => plan.kind === 'cas')).toBe(false)
  })

  test('emits defensive CAS with a staged battle lock for an attack on a friendly objective', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0)
    const campaign = createCampaign({ playerAircraft: { CAS: ['A-10C_2'] } })
    campaign.coalitions.player.groundGroups = [
      {
        id: 'defender-1',
        objectiveId: 'Home Objective',
        position: { x: 0, y: 0 },
        state: 'idle',
        units: [{ name: 'M-1 Abrams', count: 2 }]
      }
    ]
    campaign.coalitions.opponent.groundGroups = [
      {
        id: 'attacker-1',
        objectiveId: 'Target Objective',
        targetObjectiveId: 'Home Objective',
        position: { x: 5_000, y: 0 },
        state: 'moving',
        units: [{ name: 'BMP-2', count: 4 }]
      }
    ]

    const result = planAtoPackages(campaign, 'player', createContext(), plannerPolicy())
    const cas = result.admitted.find((plan) => plan.variantId === 'defensive-cas')

    expect(cas?.variantLabel).toBe('Defensive CAS')
    expect(cas?.battleLock?.attackerGroupIds).toEqual(['attacker-1'])
    expect(cas?.battleLock?.defenderGroupIds).toContain('defender-1')
  })

  test('emits transport for urgent supply when policy enables logistics planning', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0)
    const campaign = createCampaign({ playerAircraft: { Transport: ['C-130'] } })
    campaign.coalitions.player.supplyNodes!['Home Objective'] = {
      current: 100,
      max: 1000,
      productionRate: 0,
      consumptionRate: 0,
      status: 'critical'
    }

    const result = planAtoPackages(
      campaign,
      'player',
      createContext(),
      plannerPolicy({ enableTransport: true })
    )

    expect(result.admitted.some((plan) => plan.kind === 'transport')).toBe(true)
  })

  test('does not emit transport when logistics planning is disabled', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0)
    const campaign = createCampaign({ playerAircraft: { Transport: ['C-130'] } })
    campaign.coalitions.player.supplyNodes!['Home Objective'] = {
      current: 100,
      max: 1000,
      productionRate: 0,
      consumptionRate: 0,
      status: 'critical'
    }

    const result = planAtoPackages(campaign, 'player', createContext(), plannerPolicy())

    expect(result.admitted.some((plan) => plan.kind === 'transport')).toBe(false)
  })

  test('rejects candidates when aircraft are unavailable', () => {
    const campaign = createCampaign()

    const result = planAtoPackages(campaign, 'player', createContext(), plannerPolicy())

    expect(result.rejected.some((entry) => entry.reason === 'no aircraft')).toBe(true)
  })

  test('rejects strike packages when home-base munitions are exhausted', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0)
    const campaign = createCampaign({ playerAircraft: { 'Pinpoint Strike': ['F-16C_50'] } })
    campaign.coalitions.player.supplyNodes!.Home = {
      current: 10_000,
      max: 10_000,
      productionRate: 0,
      consumptionRate: 0,
      status: 'abundant',
      fuel: { current: 10_000, max: 10_000, productionRate: 0, consumptionRate: 0 },
      munitions: { current: 10, max: 10_000, productionRate: 0, consumptionRate: 0 },
      repair: { current: 10_000, max: 10_000, productionRate: 0, consumptionRate: 0 },
      logistics: { hub: true, hubLevel: 2, routes: [], interdiction: 0, repairRate: 0 }
    }
    campaign.coalitions.opponent.structures = [
      {
        id: 'structure-1',
        type: 'Ammo Depot',
        objectiveId: 'Target Objective',
        position: { x: 50_000, y: 0 },
        name: 'Ammo Depot',
        resources: 0,
        buildings: [{ offset: { x: 0, y: 0 }, type: 'Workshop A', alive: true }]
      }
    ]

    const result = planAtoPackages(campaign, 'player', createContext(), plannerPolicy())

    expect(result.admitted.some((plan) => plan.kind === 'strike')).toBe(false)
    expect(
      result.rejected.some((entry) => entry.kind === 'strike' && entry.reason === 'supply blocked')
    ).toBe(true)
  })

  test('spends virtual logistics when admitted packages are committed', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0)
    const campaign = createCampaign({ playerAircraft: { CAP: ['F-16C_50'] } })
    campaign.coalitions.player.supplyNodes!.Home = {
      current: 10_000,
      max: 10_000,
      productionRate: 0,
      consumptionRate: 0,
      status: 'abundant',
      fuel: { current: 10_000, max: 10_000, productionRate: 0, consumptionRate: 0 },
      munitions: { current: 10_000, max: 10_000, productionRate: 0, consumptionRate: 0 },
      repair: { current: 10_000, max: 10_000, productionRate: 0, consumptionRate: 0 },
      logistics: { hub: true, hubLevel: 2, routes: [], interdiction: 0, repairRate: 0 }
    }

    const result = planAtoPackages(campaign, 'player', createContext(), plannerPolicy())
    const cap = result.admitted.filter((plan) => plan.kind === 'cap')
    commitAtoPackages(campaign, 'player', cap)

    expect(campaign.coalitions.player.supplyNodes?.Home?.fuel?.current).toBeLessThan(10_000)
    expect(campaign.coalitions.player.supplyNodes?.Home?.munitions?.current).toBeLessThan(10_000)
    expect(campaign.coalitions.player.flightGroups[0]?.packageId).toBe(cap[0]?.id)
  })

  test('does not duplicate targets already assigned to active flights', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0)
    const campaign = createCampaign({ playerAircraft: { DEAD: ['F-16C_50'] } })
    campaign.coalitions.opponent.samGroups = [
      { id: 'sam-1', type: 'SA-6', objectiveId: 'Target Objective' }
    ]
    campaign.coalitions.player.flightGroups = [
      {
        id: 'flight-1',
        aircrafts: [
          { id: 'aircraft-1', unitName: 'Enfield-1-1', aircraftName: 'F-16C_50' as const }
        ],
        task: 'DEAD',
        position: { x: 0, y: 0 },
        homeBase: 'Home',
        callsign: 'Enfield-1',
        target: { id: 'sam-1', type: 'SA-6', objectiveId: 'Target Objective' },
        flightplan: { id: 'plan-1', startTime: campaignTime, waypoints: [] }
      }
    ]

    const result = planAtoPackages(campaign, 'player', createContext(), plannerPolicy())

    expect(result.admitted.some((plan) => plan.targetId === 'sam-1')).toBe(false)
  })

  test('on-call CAS launches when the assault starts', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0)
    const campaign = createCampaign({ playerAircraft: { CAS: ['A-10C_2'] } })
    campaign.coalitions.opponent.groundGroups = [
      {
        id: 'assault-1',
        objectiveId: 'Target Objective',
        targetObjectiveId: 'Home Objective',
        position: { x: 2_000, y: 0 },
        state: 'combat',
        captureStartedAt: campaignTime.toISOString(),
        units: [{ name: 'BMP-2', count: 4 }]
      }
    ]

    const result = planAtoPackages(campaign, 'player', createContext(), plannerPolicy())
    const cas = result.admitted.find((plan) => plan.kind === 'cas')

    expect(cas?.variantId).toBe('on-call-cas')
    expect(cas?.priority).toBe(90)
    expect(cas!.tot.getTime() - campaignTime.getTime()).toBe(10 * 60 * 1000)
  })

  test('a strike waits when a SAM covers the target and the SEAD pair is already out', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0)
    const campaign = createCampaign({
      playerAircraft: { 'Pinpoint Strike': ['F-16C_50'], SEAD: ['F-16C_50'] }
    })
    campaign.coalitions.opponent.structures = [
      {
        id: 'structure-1',
        type: 'Ammo Depot',
        objectiveId: 'Target Objective',
        position: { x: 50_000, y: 0 },
        name: 'Ammo Depot',
        resources: 0,
        buildings: [{ offset: { x: 0, y: 0 }, type: 'Workshop A', alive: true }]
      }
    ]
    campaign.coalitions.opponent.samGroups = [
      { id: 'sam-1', type: 'SA-6', objectiveId: 'Target Objective' }
    ]
    campaign.coalitions.player.flightGroups = [
      ...[1, 2].map((index) => ({
        id: `sead-${index}`,
        aircrafts: [
          { id: `sead-ac-${index}`, unitName: `Dodge-${index}`, aircraftName: 'F-16C_50' as const }
        ],
        task: 'SEAD' as const,
        position: { x: 0, y: 0 },
        homeBase: 'Home',
        callsign: `Dodge-${index}`,
        flightplan: { id: `sead-plan-${index}`, startTime: campaignTime, waypoints: [] }
      })),
      {
        id: 'dead-1',
        aircrafts: [{ id: 'dead-ac-1', unitName: 'Dodge-3', aircraftName: 'F-16C_50' as const }],
        task: 'DEAD' as const,
        position: { x: 0, y: 0 },
        homeBase: 'Home',
        callsign: 'Dodge-3',
        flightplan: { id: 'dead-plan-1', startTime: campaignTime, waypoints: [] }
      }
    ]

    const result = planAtoPackages(campaign, 'player', createContext(), plannerPolicy())

    expect(result.admitted.some((plan) => plan.kind === 'strike')).toBe(false)
    expect(
      result.rejected.some((entry) => entry.kind === 'strike' && entry.reason === 'threat too high')
    ).toBe(true)
  })

  test('Korea still strikes a covered target when the list has no SEAD', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0)
    const campaign = createCampaign({ playerAircraft: { 'Pinpoint Strike': ['F-86F Sabre'] } })
    campaign.coalitions.opponent.structures = [
      {
        id: 'structure-1',
        type: 'Ammo Depot',
        objectiveId: 'Target Objective',
        position: { x: 50_000, y: 0 },
        name: 'Ammo Depot',
        resources: 0,
        buildings: [{ offset: { x: 0, y: 0 }, type: 'Workshop A', alive: true }]
      }
    ]
    campaign.coalitions.opponent.samGroups = [
      { id: 'sam-1', type: 'SA-6', objectiveId: 'Target Objective' }
    ]

    const result = planAtoPackages(campaign, 'player', createContext(), plannerPolicy())

    expect(result.admitted.some((plan) => plan.kind === 'strike')).toBe(true)
  })

  test('a cratered field ferries four fighters to the nearest open field', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0)
    const campaign = createCampaign({ playerAircraft: { CAP: ['F-16C_50'] } })
    campaign.coalitions.player.airdromeNames = ['Home', 'Reserve']
    craterAirdrome(campaign, 'player', 'Home')
    const context = createContext()
    context.theatre = {
      ...context.theatre,
      airdromeDetails: {
        ...context.theatre.airdromeDetails,
        Reserve: { id: 99, name: 'Reserve', x: 30_000, y: 0, runwayAngle: 90, standlist: {} }
      }
    }

    const result = planAtoPackages(campaign, 'player', context, plannerPolicy())
    const relocate = result.admitted.find((plan) => plan.kind === 'relocate')

    expect(relocate?.priority).toBe(100)
    expect(relocate?.targetId).toBe('Home')
    expect(relocate?.targetObjectiveId).toBe('Reserve')
    expect(relocate?.flights[0]?.aircraftCount).toBe(4)
  })

  test('a scramble does not launch inside the ten minute alert', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0)
    const campaign = createCampaign({ playerAircraft: { Intercept: ['F-16C_50'] } })
    const tot = new Date(campaignTime.getTime() + 8 * 60 * 1000)
    campaign.coalitions.opponent.packages.push({
      id: 'enemy-strike-1',
      type: 'Strike Package',
      targetObjectiveId: 'Home Objective',
      members: [{ flightGroupId: 'raid-1', role: 'primary', totOffset: 0 }],
      tot,
      originalTot: tot,
      status: 'active'
    })
    campaign.coalitions.opponent.flightGroups.push({
      id: 'raid-1',
      aircrafts: [{ id: 'raid-ac-1', unitName: 'Uzi-1-1', aircraftName: 'MiG-21Bis' }],
      task: 'Pinpoint Strike',
      position: { x: 100_000, y: 0 },
      homeBase: 'Enemy',
      callsign: 'Uzi-1',
      target: { id: 'home-obj', type: 'Structure', objectiveId: 'Home Objective' },
      flightplan: { id: 'raid-plan', startTime: campaignTime, waypoints: [] },
      packageId: 'enemy-strike-1'
    })

    const result = planAtoPackages(campaign, 'player', createContext(), plannerPolicy())
    const intercept = result.admitted.find((plan) => plan.kind === 'intercept')

    expect(intercept?.flights[0]?.tot?.getTime()).toBe(campaignTime.getTime() + 10 * 60 * 1000)
  })

  test('an empty ECM list does not invent a jammer', () => {
    const campaign = createCampaign({ playerAircraft: { CAP: ['F-16C_50'] } })
    const result = planAtoPackages(campaign, 'player', createContext(), plannerPolicy())

    expect(result.admitted.some((plan) => plan.kind === 'ecm')).toBe(false)
    expect(
      result.rejected.some((entry) => entry.kind === 'ecm' && entry.reason === 'no aircraft')
    ).toBe(true)
  })

  test('an ECM orbit is planned when the faction owns a jammer', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0)
    const campaign = createCampaign({ playerAircraft: { ECM: ['E-3A'] } })
    const result = planAtoPackages(campaign, 'player', createContext(), plannerPolicy())
    const ecm = result.admitted.find((plan) => plan.kind === 'ecm')

    expect(ecm?.type).toBe('ECM Package')
    expect(ecm?.priority).toBe(80)
    expect(ecm?.flights).toHaveLength(1)
    expect(ecm?.flights[0]?.task).toBe('ECM')
  })

  test('an ECM orbit already on station lets the strike launch under the SAM', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0)
    const campaign = createCampaign({
      playerAircraft: { 'Pinpoint Strike': ['F-16C_50'], SEAD: ['F-16C_50'] }
    })
    campaign.coalitions.opponent.structures = [
      {
        id: 'structure-1',
        type: 'Ammo Depot',
        objectiveId: 'Target Objective',
        position: { x: 50_000, y: 0 },
        name: 'Ammo Depot',
        resources: 0,
        buildings: [{ offset: { x: 0, y: 0 }, type: 'Workshop A', alive: true }]
      }
    ]
    campaign.coalitions.opponent.samGroups = [
      { id: 'sam-1', type: 'SA-6', objectiveId: 'Target Objective' }
    ]
    campaign.coalitions.player.flightGroups = [
      ...[1, 2].map((index) => ({
        id: `sead-${index}`,
        aircrafts: [
          { id: `sead-ac-${index}`, unitName: `Dodge-${index}`, aircraftName: 'F-16C_50' as const }
        ],
        task: 'SEAD' as const,
        position: { x: 0, y: 0 },
        homeBase: 'Home',
        callsign: `Dodge-${index}`,
        flightplan: { id: `sead-plan-${index}`, startTime: campaignTime, waypoints: [] }
      })),
      {
        id: 'dead-1',
        aircrafts: [{ id: 'dead-ac-1', unitName: 'Dodge-3', aircraftName: 'F-16C_50' as const }],
        task: 'DEAD' as const,
        position: { x: 0, y: 0 },
        homeBase: 'Home',
        callsign: 'Dodge-3',
        flightplan: { id: 'dead-plan-1', startTime: campaignTime, waypoints: [] }
      },
      {
        id: 'ecm-1',
        aircrafts: [{ id: 'ecm-ac-1', unitName: 'Magic-1', aircraftName: 'E-3A' }],
        task: 'ECM' as const,
        position: { x: 0, y: 0 },
        homeBase: 'Home',
        callsign: 'Magic-1',
        flightplan: { id: 'ecm-plan-1', startTime: campaignTime, waypoints: [] }
      }
    ]

    const result = planAtoPackages(campaign, 'player', createContext(), plannerPolicy())

    expect(result.admitted.some((plan) => plan.kind === 'strike')).toBe(true)
  })

  test('a type that just landed waits an hour at that field', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0)
    const campaign = createCampaign({ playerAircraft: { CAP: ['F-16C_50'] } })
    campaign.coalitions.player.airdromeNames = ['Home', 'Reserve']
    campaign.coalitions.player.aircraftTurnaroundUntil = {
      'Home:F-16C_50': campaignTime.getTime() + 60 * 60 * 1000
    }
    const context = createContext()
    context.theatre = {
      ...context.theatre,
      airdromeDetails: {
        ...context.theatre.airdromeDetails,
        Reserve: { id: 99, name: 'Reserve', x: 30_000, y: 0, runwayAngle: 90, standlist: {} }
      }
    }

    const result = planAtoPackages(campaign, 'player', context, plannerPolicy())
    const cap = result.admitted.find((plan) => plan.kind === 'cap')

    expect(cap?.flights[0]?.homeBase.name).toBe('Reserve')
  })

  test('HAVCAP launches within ten minutes over a downed pilot', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0)
    const campaign = createCampaign({ playerAircraft: { CAP: ['F-16C_50'] } })
    campaign.coalitions.player.downedPilots = [
      {
        id: 'pilot-1',
        name: 'Viper',
        position: { x: 10_000, y: 0 },
        ejectedAt: campaignTime
      }
    ]

    const result = planAtoPackages(campaign, 'player', createContext(), plannerPolicy())
    const havcap = result.admitted.find((plan) => plan.variantId === 'havcap')

    expect(havcap?.priority).toBe(86)
    expect(havcap?.flights[0]?.tot?.getTime()).toBe(campaignTime.getTime() + 10 * 60 * 1000)
    expect(havcap?.flights[0]?.target?.id).toBe('pilot-1')
  })

  test('an ambush orbit sits forward of BARCAP at low altitude', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0)
    const campaign = createCampaign({ playerAircraft: { CAP: ['F-16C_50'] } })
    const context = createContext()
    context.theatre = {
      ...context.theatre,
      connections: [
        {
          from: 'Home Objective',
          to: 'Target Objective',
          mode: 'road',
          bidirectional: true,
          waypoints: []
        }
      ]
    }

    const result = planAtoPackages(campaign, 'player', context, plannerPolicy())
    const ambush = result.admitted.find((plan) => plan.variantId === 'ambush-cap')
    const barcap = result.admitted.find((plan) => plan.reason === 'BARCAP on the FLOT')

    expect(ambush?.flights[0]?.patrolAltitude).toBe(450)
    expect(ambush?.flights[0]?.patrolDurationMs).toBe(15 * 60 * 1000)
    expect(
      (ambush?.flights[0]?.patrolCenter?.x ?? 0) > (barcap?.flights[0]?.patrolCenter?.x ?? 0)
    ).toBe(true)
  })

  test('a strike cuts the road an enemy column is using', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0)
    const campaign = createCampaign({ playerAircraft: { 'Pinpoint Strike': ['F-16C_50'] } })
    campaign.coalitions.opponent.groundGroups = [
      {
        id: 'column-1',
        position: { x: 40_000, y: 0 },
        objectiveId: 'Target Objective',
        targetObjectiveId: 'Home Objective',
        units: [{ name: 'T-55', count: 4 }],
        state: 'moving'
      }
    ]

    const result = planAtoPackages(campaign, 'player', createContext(), plannerPolicy())
    const cut = result.admitted.find((plan) => plan.variantId === 'road-cut')

    expect(cut?.targetType).toBe('Road')
    expect(cut?.reason).toContain('Target Objective')
    expect(cut?.flights[0]?.targetPosition.x).toBeCloseTo(25_000)
  })

  test('the opening hours strike the command post and leave the factory', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0)
    const campaign = createCampaign({ playerAircraft: { 'Pinpoint Strike': ['F-16C_50'] } })
    campaign.groundOffensiveAt = campaign.time.getTime() + 60 * 60 * 1000
    campaign.strategicStrikeAt = campaign.time.getTime() + 8 * 60 * 60 * 1000
    campaign.coalitions.opponent.structures = [
      {
        id: 'factory-1',
        type: 'Factory',
        objectiveId: 'Target Objective',
        position: { x: 50_000, y: 0 },
        name: 'Factory',
        resources: 0,
        buildings: [{ offset: { x: 0, y: 0 }, type: 'Workshop A', alive: true }]
      },
      {
        id: 'command-1',
        type: 'Command Center',
        objectiveId: 'Target Objective',
        position: { x: 52_000, y: 0 },
        name: 'Command Center',
        resources: 0,
        buildings: [{ offset: { x: 0, y: 0 }, type: 'Military staff', alive: true }]
      }
    ]
    campaign.coalitions.opponent.groundGroups = [
      {
        id: 'column-1',
        position: { x: 40_000, y: 0 },
        objectiveId: 'Target Objective',
        targetObjectiveId: 'Home Objective',
        units: [{ name: 'T-55', count: 4 }],
        state: 'moving'
      }
    ]

    const result = planAtoPackages(campaign, 'player', createContext(), plannerPolicy())
    const strikes = result.admitted.filter((plan) => plan.kind === 'strike')

    expect(strikes.map((plan) => plan.targetType)).toEqual(['Command Center'])
    expect(result.admitted.some((plan) => plan.variantId === 'road-cut')).toBe(false)
  })

  test('after eight hours the strike prefers the factory', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0)
    const campaign = createCampaign({ playerAircraft: { 'Pinpoint Strike': ['F-16C_50'] } })
    campaign.groundOffensiveAt = campaign.time.getTime() - 60_000
    campaign.strategicStrikeAt = campaign.time.getTime() - 60_000
    campaign.coalitions.opponent.structures = [
      {
        id: 'depot-1',
        type: 'Ammo Depot',
        objectiveId: 'Target Objective',
        position: { x: 50_000, y: 0 },
        name: 'Ammo Depot',
        resources: 0,
        buildings: [{ offset: { x: 0, y: 0 }, type: 'Workshop A', alive: true }]
      },
      {
        id: 'factory-1',
        type: 'Factory',
        objectiveId: 'Target Objective',
        position: { x: 52_000, y: 0 },
        name: 'Factory',
        resources: 0,
        buildings: [{ offset: { x: 0, y: 0 }, type: 'Workshop A', alive: true }]
      }
    ]

    const result = planAtoPackages(campaign, 'player', createContext(), plannerPolicy())
    const strike = result.admitted.find(
      (plan) => plan.kind === 'strike' && plan.variantId !== 'road-cut'
    )

    expect(strike?.targetType).toBe('Factory')
  })

  test('between the air war and the eighth hour the strike hits the depot', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0)
    const campaign = createCampaign({ playerAircraft: { 'Pinpoint Strike': ['F-16C_50'] } })
    campaign.groundOffensiveAt = campaign.time.getTime() - 60_000
    campaign.strategicStrikeAt = campaign.time.getTime() + 60 * 60 * 1000
    campaign.coalitions.opponent.structures = [
      {
        id: 'depot-1',
        type: 'Ammo Depot',
        objectiveId: 'Target Objective',
        position: { x: 50_000, y: 0 },
        name: 'Ammo Depot',
        resources: 0,
        buildings: [{ offset: { x: 0, y: 0 }, type: 'Workshop A', alive: true }]
      },
      {
        id: 'factory-1',
        type: 'Factory',
        objectiveId: 'Target Objective',
        position: { x: 52_000, y: 0 },
        name: 'Factory',
        resources: 0,
        buildings: [{ offset: { x: 0, y: 0 }, type: 'Workshop A', alive: true }]
      }
    ]

    const result = planAtoPackages(campaign, 'player', createContext(), plannerPolicy())
    const strike = result.admitted.find(
      (plan) => plan.kind === 'strike' && plan.variantId !== 'road-cut'
    )

    expect(strike?.targetType).toBe('Ammo Depot')
  })

  test('bombers wait until factories and oil are the target', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0)
    const early = createCampaign({
      playerAircraft: { 'Strategic Strike': ['B-52H'], 'Pinpoint Strike': ['F-16C_50'] }
    })
    early.groundOffensiveAt = early.time.getTime() - 60_000
    early.strategicStrikeAt = early.time.getTime() + 60 * 60 * 1000
    early.coalitions.opponent.structures = [
      {
        id: 'factory-1',
        type: 'Factory',
        objectiveId: 'Target Objective',
        position: { x: 50_000, y: 0 },
        name: 'Factory',
        resources: 0,
        buildings: [{ offset: { x: 0, y: 0 }, type: 'Workshop A', alive: true }]
      }
    ]

    const before = planAtoPackages(early, 'player', createContext(), plannerPolicy())
    expect(before.admitted.some((plan) => plan.kind === 'strategicStrike')).toBe(false)

    const late = createCampaign({
      playerAircraft: { 'Strategic Strike': ['B-52H'] }
    })
    late.groundOffensiveAt = late.time.getTime() - 60_000
    late.strategicStrikeAt = late.time.getTime() - 60_000
    late.coalitions.opponent.structures = early.coalitions.opponent.structures

    const after = planAtoPackages(late, 'player', createContext(), plannerPolicy())
    const bomber = after.admitted.find((plan) => plan.kind === 'strategicStrike')

    expect(bomber?.flights[0]?.aircraftType).toBe('B-52H')
    expect(bomber?.targetType).toBe('Factory')
  })

  test('the player can add an AI escort to their strike package, once', () => {
    const campaign = createCampaign({ playerAircraft: { CAP: ['F-4E-45MC'] } })
    campaign.coalitions.player.flightGroups = [
      {
        id: 'strike-1',
        name: 'Enfield-1',
        callsign: 'Enfield-1',
        task: 'Pinpoint Strike',
        homeBase: 'Home',
        position: { x: 0, y: 0 },
        aircrafts: [{ id: 'a', unitName: 'Enfield-1-1', aircraftName: 'MiG-29A', client: true }],
        tot: new Date(campaignTime.getTime() + 60 * 60_000),
        flightplan: {
          startTime: new Date(campaignTime.getTime() + 20 * 60_000),
          waypoints: [
            { name: 'Departure', position: { x: 0, y: 0 }, altitude: 3000, speed: 200 },
            { name: 'Target', position: { x: 50_000, y: 0 }, altitude: 3000, speed: 200 }
          ]
        }
      } as unknown as CoalitionData['flightGroups'][number]
    ]
    const context = createContext()

    const escort = requestPackageSupport(campaign, 'player', 'strike-1', 'escort', context)
    expect(escort.ok).toBe(true)
    const pkg = campaign.coalitions.player.packages[0]
    expect(pkg?.members.map((member) => member.role)).toEqual(['primary', 'cap'])
    expect(campaign.coalitions.player.flightGroups[0]?.packageId).toBe(pkg?.id)
    const escortGroup = campaign.coalitions.player.flightGroups.find(
      (group) => group.id === pkg?.members[1]?.flightGroupId
    )
    expect(escortGroup?.task).toBe('CAP')

    expect(requestPackageSupport(campaign, 'player', 'strike-1', 'escort', context)).toEqual({
      ok: false,
      reason: 'the package already has escort'
    })
    expect(requestPackageSupport(campaign, 'player', 'strike-1', 'sead', context)).toEqual({
      ok: false,
      reason: 'no aircraft ready for SEAD'
    })
  })
})
