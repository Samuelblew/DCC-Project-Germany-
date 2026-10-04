import { schemas } from '@dcc/contracts'
import { structureTemplates } from '@dcc/data'
import { describe, expect, test } from 'vitest'
import * as z from 'zod'

import { addGroundGroups } from './add-ground-groups'
import { addStructures } from './add-structures'
import { buildMissionCullingPlan, selectFlightIdsForMission } from './mission-culling'

type Campaign = z.infer<typeof schemas.campaign.campaign>
type CampaignCoalition = Campaign['coalitions']['player']
type Mission = z.infer<typeof schemas.dcs.mission>
type Theatre = z.infer<typeof schemas.theatre>

const campaignTime = new Date('2026-01-01T12:00:00.000Z')

function createAircraftTypes(): CampaignCoalition['aircraftTypes'] {
  return Object.fromEntries(
    schemas.task.options.map((task) => [task, [] as string[]])
  ) as CampaignCoalition['aircraftTypes']
}

function createGroundUnitTypes(): CampaignCoalition['groundUnitTypes'] {
  return Object.fromEntries(
    schemas.groundUnitType.options.map((type) => [type, [] as string[]])
  ) as CampaignCoalition['groundUnitTypes']
}

function createCoalition(id: 'player' | 'opponent'): CampaignCoalition {
  const groundUnitTypes = createGroundUnitTypes()
  groundUnitTypes.Vehicle = ['M-1 Abrams']
  groundUnitTypes['Shorad Infantry'] = ['Soldier stinger']

  return {
    id,
    aircraftTypes: createAircraftTypes(),
    groundUnitTypes,
    airdromeNames: [],
    objectiveIds: [],
    structures: [],
    samGroups: [],
    groundGroups: [],
    flightGroups: [],
    packages: []
  }
}

function createCampaign(culling = true): Campaign {
  return {
    version: 'test',
    id: 'campaign',
    name: 'Campaign',
    createdAt: campaignTime,
    updatedAt: campaignTime,
    time: campaignTime,
    timeMultiplier: 1,
    campaignParams: { culling },
    logs: [],
    scenarioId: 'scenario',
    coalitions: {
      player: {
        ...createCoalition('player'),
        flightGroups: [
          {
            id: 'player-cap',
            aircrafts: [
              {
                id: 'player-jet',
                unitName: 'Enfield11',
                aircraftName: 'F-4E',
                client: true
              }
            ],
            task: 'CAP',
            position: { x: 0, y: 0 },
            homeBase: 'Base',
            callsign: 'Enfield-1',
            flightplan: {
              id: 'player-cap-plan',
              startTime: campaignTime,
              waypoints: [
                {
                  name: 'CAP',
                  position: { x: 0, y: 0 },
                  altitude: 6000,
                  speed: 220,
                  type: 'Task'
                }
              ]
            }
          }
        ]
      },
      opponent: createCoalition('opponent')
    }
  }
}

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
        country: [{ id: 2, name: 'USA', static: { group: [] }, vehicle: { group: [] } }]
      },
      red: {
        bullseye: { x: 0, y: 0 },
        nav_points: [],
        name: 'red',
        country: [{ id: 0, name: 'Russia', static: { group: [] }, vehicle: { group: [] } }]
      }
    },
    result: { total: 0, offline: {}, blue: {}, red: {} }
  }
}

const theatre: Theatre = {
  name: 'Caucasus',
  objectives: [
    { name: 'near-objective', type: 'Frontline', position: { x: 10_000, y: 0 } },
    { name: 'far-objective', type: 'Frontline', position: { x: 100_000, y: 0 } },
    { name: 'sam-objective', type: 'Frontline', position: { x: 150_000, y: 0 } }
  ],
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

function addTestStructures(campaign: Campaign) {
  campaign.coalitions.opponent.structures = [
    {
      id: 'near-structure',
      type: 'Depot',
      objectiveId: 'near-objective',
      position: { x: 10_000, y: 0 },
      name: 'Near Structure',
      resources: 0,
      buildings: [
        { type: 'Warehouse', offset: { x: 0, y: 0 }, alive: true },
        { type: 'Tank', offset: { x: 100, y: 0 }, alive: false }
      ]
    },
    {
      id: 'far-structure',
      type: 'Depot',
      objectiveId: 'far-objective',
      position: { x: 100_000, y: 0 },
      name: 'Far Structure',
      resources: 0,
      buildings: [{ type: 'Warehouse', offset: { x: 0, y: 0 }, alive: true }]
    }
  ]
}

function addTestGroundGroups(campaign: Campaign) {
  campaign.coalitions.opponent.groundGroups = [
    {
      id: 'near-ground',
      objectiveId: 'near-objective',
      position: { x: 10_000, y: 0 },
      state: 'idle',
      units: [{ name: 'M-1 Abrams', count: 2 }]
    },
    {
      id: 'far-ground',
      objectiveId: 'far-objective',
      position: { x: 100_000, y: 0 },
      state: 'idle',
      units: [{ name: 'M-1 Abrams', count: 2 }]
    },
    {
      id: 'mixed-ground',
      objectiveId: 'far-objective',
      position: { x: 20_000, y: 0 },
      state: 'idle',
      units: [
        { name: 'M-1 Abrams', count: 2 },
        { name: 'Soldier stinger', count: 1 }
      ]
    }
  ]
  campaign.coalitions.opponent.samGroups = [
    {
      id: 'far-sam',
      type: 'SA-6',
      objectiveId: 'sam-objective'
    }
  ]
}

describe('mission culling', () => {
  test('keeps a FARP used as a flight home base', () => {
    const campaign = createCampaign()
    const farpTemplate = structureTemplates.Farp[0]
    expect(farpTemplate).toBeDefined()

    const farp = {
      id: 'farp-home',
      type: 'Farp' as const,
      objectiveId: 'far-objective',
      position: { x: 100_000, y: 0 },
      name: 'Forward FARP',
      resources: 0,
      buildings: farpTemplate!.buildings.map((building) => ({ ...building, alive: true }))
    }
    campaign.coalitions.player.structures = [farp]
    campaign.coalitions.player.flightGroups[0]!.homeBase = farp.id

    const cullingPlan = buildMissionCullingPlan(campaign, theatre)

    expect(cullingPlan.getStructureMode('player', farp)).toBe('full')
  })

  test('emits the complete legacy FARP template instead of the theatre placeholder', () => {
    const campaign = createCampaign(false)
    const farpTemplate = structureTemplates.Farp[0]
    expect(farpTemplate).toBeDefined()

    campaign.coalitions.player.structures = [
      {
        id: 'farp-template',
        type: 'Farp',
        objectiveId: 'far-objective',
        position: { x: 100_000, y: 0 },
        name: 'Forward FARP',
        resources: 0,
        buildings: farpTemplate!.buildings.map((building) => ({ ...building, alive: true }))
      }
    ]
    const farpTheatre: Theatre = {
      ...theatre,
      targets: {
        'far-objective': [
          {
            name: 'far-objective|Structure|1',
            type: 'Structure',
            objectiveName: 'far-objective',
            groupId: 1,
            structureType: 'Warehouse',
            structureCategory: 'Warehouses',
            position: { x: 100_000, y: 0 },
            unitPositions: [{ x: 100_000, y: 0, heading: 1 }]
          }
        ]
      }
    }
    const mission = createMission()
    const cullingPlan = buildMissionCullingPlan(campaign, farpTheatre)

    const result = addStructures(mission, campaign, farpTheatre, cullingPlan)

    expect(result.isOk()).toBe(true)
    const groups = mission.coalition.blue.country?.[0]?.static?.group ?? []
    expect(groups).toHaveLength(1)
    expect(groups[0]?.units.map((unit) => unit.type)).toEqual([
      'FARP',
      'FARP Ammo Dump Coating',
      'FARP CP Blindage',
      'FARP Fuel Depot',
      'FARP Tent',
      'FARP Tent'
    ])
    expect(groups[0]?.units.map((unit) => unit.category)).toEqual([
      'Heliports',
      'Fortifications',
      'Fortifications',
      'Fortifications',
      'Fortifications',
      'Fortifications'
    ])
    expect(groups[0]?.units[0]).toMatchObject({ x: 100_000, y: 0 })
    expect(groups[0]?.units[1]).toMatchObject({ x: 100_075, y: -75 })
  })

  test('includes nearby structures and omits distant structures while filtering dead buildings', () => {
    const campaign = createCampaign()
    addTestStructures(campaign)
    const mission = createMission()
    const cullingPlan = buildMissionCullingPlan(campaign, theatre)

    const result = addStructures(mission, campaign, theatre, cullingPlan)

    expect(result.isOk()).toBe(true)
    const groups = mission.coalition.red.country?.[0]?.static?.group ?? []
    expect(groups.map((group) => group.name)).toEqual([
      expect.stringContaining('Static-near-structure-')
    ])
    expect(groups[0]?.units.map((unit) => unit.type)).toEqual(['Warehouse'])
    expect(cullingPlan.manifest.structures.opponent).toEqual({ 'near-structure': true })
  })

  test('includes all structures when culling is disabled', () => {
    const campaign = createCampaign(false)
    addTestStructures(campaign)
    const mission = createMission()
    const cullingPlan = buildMissionCullingPlan(campaign, theatre)

    const result = addStructures(mission, campaign, theatre, cullingPlan)

    expect(result.isOk()).toBe(true)
    const groups = mission.coalition.red.country?.[0]?.static?.group ?? []
    expect(groups.map((group) => group.name)).toEqual([
      expect.stringContaining('Static-near-structure-'),
      expect.stringContaining('Static-far-structure-')
    ])
  })

  test('includes direct target structures outside the default radius', () => {
    const campaign = createCampaign()
    addTestStructures(campaign)
    campaign.coalitions.player.flightGroups[0]!.target = {
      id: 'far-structure',
      type: 'Depot',
      objectiveId: 'far-objective'
    }
    const mission = createMission()
    const cullingPlan = buildMissionCullingPlan(campaign, theatre)

    const result = addStructures(mission, campaign, theatre, cullingPlan)

    expect(result.isOk()).toBe(true)
    const groups = mission.coalition.red.country?.[0]?.static?.group ?? []
    expect(groups.map((group) => group.name)).toEqual([
      expect.stringContaining('Static-near-structure-'),
      expect.stringContaining('Static-far-structure-')
    ])
  })

  test('culls regular ground groups, keeps nearby groups, emits mixed AA just past the band as AA only, and always keeps SAMs', () => {
    const campaign = createCampaign()
    addTestGroundGroups(campaign)
    const mission = createMission()
    const cullingPlan = buildMissionCullingPlan(campaign, theatre)

    const result = addGroundGroups(mission, campaign, theatre, cullingPlan)

    expect(result.isOk()).toBe(true)
    const groups = mission.coalition.red.country?.[0]?.vehicle?.group ?? []
    expect(groups.map((group) => group.name)).toEqual([
      expect.stringContaining('SAM-far-sam-SA-6-'),
      expect.stringContaining('Ground-near-ground-'),
      expect.stringContaining('Ground-mixed-ground-')
    ])
    expect(groups.find((group) => group.name.includes('Ground-near-ground-'))?.units).toHaveLength(
      2
    )
    expect(groups.find((group) => group.name.includes('Ground-mixed-ground-'))?.units).toEqual([
      expect.objectContaining({ type: 'Soldier stinger' })
    ])
    expect(cullingPlan.manifest.groundGroups.opponent).toEqual({
      'near-ground': 'full',
      'mixed-ground': 'antiAirOnly'
    })
  })
})

describe('aircraft culling', () => {
  function aiFlight(
    id: string,
    points: Array<{ x: number; y: number }>
  ): CampaignCoalition['flightGroups'][number] {
    return {
      id,
      aircrafts: [{ id: `${id}-1`, unitName: `${id}-1`, aircraftName: 'MiG-23MLD' }],
      task: 'CAP',
      position: points[0]!,
      homeBase: 'Nowhere',
      callsign: id,
      flightplan: {
        id: `${id}-plan`,
        startTime: campaignTime,
        waypoints: points.map((position, index) => ({
          name: `WP${index}`,
          position,
          altitude: 6000,
          speed: 220,
          type: 'Task' as const
        }))
      }
    }
  }

  test('keeps every flight when culling is off', () => {
    const campaign = createCampaign(false)
    campaign.coalitions.opponent.flightGroups = [aiFlight('far', [{ x: 900_000, y: 0 }])]

    expect(selectFlightIdsForMission(campaign, theatre)).toBeNull()
  })

  test('keeps flights inside the wide aircraft band and drops the rest', () => {
    const campaign = createCampaign()
    campaign.coalitions.opponent.flightGroups = [
      aiFlight('interceptor', [{ x: 140_000, y: 0 }]),
      aiFlight('distant', [{ x: 300_000, y: 0 }]),
      aiFlight('passing', [
        { x: 300_000, y: 100_000 },
        { x: 100_000, y: 100_000 }
      ])
    ]

    const selected = selectFlightIdsForMission(campaign, theatre)

    expect(selected?.has('player-cap')).toBe(true)
    expect(selected?.has('interceptor')).toBe(true)
    expect(selected?.has('passing')).toBe(true)
    expect(selected?.has('distant')).toBe(false)
  })

  test('the aircraft slider widens the band', () => {
    const campaign = createCampaign()
    campaign.campaignParams = { culling: true, cullingAircraftRadius: 350_000 }
    campaign.coalitions.opponent.flightGroups = [aiFlight('distant', [{ x: 300_000, y: 0 }])]

    expect(selectFlightIdsForMission(campaign, theatre)?.has('distant')).toBe(true)
  })

  test('keeps the whole package when one member is inside the band', () => {
    const campaign = createCampaign()
    campaign.coalitions.opponent.flightGroups = [
      aiFlight('strike', [{ x: 100_000, y: 0 }]),
      aiFlight('escort', [{ x: 600_000, y: 0 }])
    ]
    campaign.coalitions.opponent.packages = [
      {
        id: 'pkg',
        type: 'Strike Package',
        targetObjectiveId: 'near-objective',
        members: [
          { flightGroupId: 'strike', role: 'primary', totOffset: 0 },
          { flightGroupId: 'escort', role: 'sead', totOffset: 0 }
        ],
        tot: campaignTime,
        status: 'active'
      }
    ]

    const selected = selectFlightIdsForMission(campaign, theatre)

    expect(selected?.has('escort')).toBe(true)
  })
})

describe('culling area of looping routes', () => {
  /** A player route that leaves the base, flies a square of `size` metres and comes back. */
  function loopCampaign(size: number) {
    const campaign = createCampaign()
    const corners = [
      { x: 0, y: 0 },
      { x: size, y: 0 },
      { x: size, y: size },
      { x: 0, y: size },
      { x: 0, y: 0 }
    ]
    campaign.coalitions.player.flightGroups[0]!.flightplan.waypoints = corners.map(
      (position, index) => ({
        name: `WP${index}`,
        position,
        altitude: 6000,
        speed: 220,
        type: 'Task' as const
      })
    )
    return campaign
  }

  function groundGroup(id: string, position: { x: number; y: number }) {
    return {
      id,
      position,
      objectiveId: 'near-objective',
      units: [{ name: 'M-1 Abrams', count: 2 }],
      state: 'idle' as const
    }
  }

  test('keeps ground units in the middle of the loop, not only along its edge', () => {
    const campaign = loopCampaign(100_000)
    const plan = buildMissionCullingPlan(campaign, theatre)

    // 50 km from every leg, far beyond the 10 km culling radius.
    expect(
      plan.getGroundGroupMode('opponent', groundGroup('centre', { x: 50_000, y: 50_000 }))
    ).toBe('full')
    expect(
      plan.getGroundGroupMode('opponent', groundGroup('outside', { x: 160_000, y: 50_000 }))
    ).toBe('omit')
  })

  test('long-range SAMs use the SAM band, short-range ones the route band', () => {
    const campaign = loopCampaign(100_000)
    campaign.campaignParams = {
      ...campaign.campaignParams,
      culling: true,
      cullingSamRadius: 150_000
    }
    const plan = buildMissionCullingPlan(campaign, theatre)
    const far = { x: 220_000, y: 50_000 } // 120 km east of the loop

    expect(plan.getSamMode('sa-5', far, 200_000)).toBe('full')
    expect(plan.getSamMode('sa-6', far, 10_000)).toBe('omit')
    expect(plan.getSamMode('sa-5-beyond', { x: 300_000, y: 50_000 }, 200_000)).toBe('omit')

    campaign.campaignParams.cullingSamRadius = 50_000
    expect(buildMissionCullingPlan(campaign, theatre).getSamMode('sa-5', far, 200_000)).toBe('omit')
  })

  test('drops air defence far past the route band instead of loading it everywhere', () => {
    const campaign = loopCampaign(100_000)
    campaign.coalitions.player.groundUnitTypes['Shorad Infantry'] = ['Soldier stinger']
    const plan = buildMissionCullingPlan(campaign, theatre)
    const shorad = (id: string, x: number) => ({
      ...groundGroup(id, { x, y: 50_000 }),
      units: [{ name: 'Soldier stinger', count: 2 }]
    })

    expect(plan.getGroundGroupMode('player', shorad('edge', 120_000))).toBe('antiAirOnly')
    expect(plan.getGroundGroupMode('player', shorad('rear', 250_000))).toBe('omit')
  })

  test('keeps the target of every AI flight that is in the mission', () => {
    const campaign = loopCampaign(100_000)
    const striker = aiFlightThrough('striker', [
      { x: 50_000, y: 50_000 },
      { x: 400_000, y: 50_000 }
    ])
    striker.target = { id: 'deep-target', type: 'Ground Group', objectiveId: 'near-objective' }
    const culled = aiFlightThrough('culled', [
      { x: 900_000, y: 900_000 },
      { x: 950_000, y: 900_000 }
    ])
    culled.target = { id: 'other-target', type: 'Ground Group', objectiveId: 'near-objective' }
    campaign.coalitions.opponent.flightGroups = [striker, culled]

    const plan = buildMissionCullingPlan(campaign, theatre)

    expect(
      plan.getGroundGroupMode('player', groundGroup('deep-target', { x: 400_000, y: 50_000 }))
    ).toBe('full')
    expect(
      plan.getGroundGroupMode('player', groundGroup('other-target', { x: 950_000, y: 900_000 }))
    ).toBe('omit')
  })

  test('keeps an AI flight whose leg crosses the loop with both ends outside the band', () => {
    const campaign = loopCampaign(400_000)
    campaign.campaignParams = { culling: true, cullingAircraftRadius: 50_000 }
    campaign.coalitions.opponent.flightGroups = [
      aiFlightThrough('crossing', [
        { x: -100_000, y: 200_000 },
        { x: 500_000, y: 200_000 }
      ]),
      aiFlightThrough('clear', [
        { x: -100_000, y: 600_000 },
        { x: 500_000, y: 600_000 }
      ])
    ]

    const selected = selectFlightIdsForMission(campaign, theatre)

    expect(selected?.has('crossing')).toBe(true)
    expect(selected?.has('clear')).toBe(false)
  })

  function aiFlightThrough(
    id: string,
    points: Array<{ x: number; y: number }>
  ): CampaignCoalition['flightGroups'][number] {
    return {
      id,
      aircrafts: [{ id: `${id}-1`, unitName: `${id}-1`, aircraftName: 'MiG-23MLD' }],
      task: 'CAP',
      position: points[0]!,
      homeBase: 'Nowhere',
      callsign: id,
      flightplan: {
        id: `${id}-plan`,
        startTime: campaignTime,
        waypoints: points.map((position, index) => ({
          name: `WP${index}`,
          position,
          altitude: 6000,
          speed: 220,
          type: 'Task' as const
        }))
      }
    }
  }
})
