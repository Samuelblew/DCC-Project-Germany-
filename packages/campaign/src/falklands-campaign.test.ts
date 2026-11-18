/* eslint-disable @typescript-eslint/no-unsafe-assignment -- asymmetric matchers are untyped */
import { schemas } from '@dcc/contracts'
import { describe, expect, test } from 'vitest'
import * as z from 'zod'

import {
  advanceFalklandsCampaign,
  getSanCarlosLandingReadiness,
  migrateFalklandsSanCarlosFarp,
  SAN_CARLOS_AMPHIBIOUS_ANCHORAGE,
  SAN_CARLOS_FARP_ID
} from './falklands-campaign'

type Campaign = z.infer<typeof schemas.campaign.campaign>
type Theatre = z.infer<typeof schemas.theatre>

function slots(id: string, kind: 'infantry' | 'vehicle' | 'air-defense') {
  return Array.from({ length: 8 }, (_, index) => ({
    id: `${id}-${index}`,
    x: index * 20,
    y: index * 10,
    heading: 0,
    allowedUnitKinds: [kind]
  }))
}

const theatre: Theatre = {
  name: 'SouthAtlantic',
  objectives: [
    { name: 'San Carlos', type: 'Town', position: { x: 0, y: 0 } },
    { name: 'Port San Carlos', type: 'Town', position: { x: 1_000, y: 0 } }
  ],
  targets: {},
  deploymentSites: [
    {
      id: 'san-carlos-infantry',
      objectiveId: 'Port San Carlos',
      position: { x: 100, y: 0 },
      roles: ['infantry', 'defensive', 'recovery', 'extraction'],
      posture: 'dispersed-defense',
      slots: slots('infantry', 'infantry'),
      extractionRadius: 150,
      validationStatus: 'approved',
      source: 'authored'
    },
    {
      id: 'san-carlos-vehicle',
      objectiveId: 'San Carlos',
      position: { x: 300, y: 0 },
      roles: ['vehicle', 'staging'],
      posture: 'staging-column',
      slots: slots('vehicle', 'vehicle'),
      validationStatus: 'approved',
      source: 'authored'
    },
    {
      id: 'san-carlos-air-defense',
      objectiveId: 'San Carlos',
      position: { x: 500, y: 0 },
      roles: ['air-defense', 'defensive'],
      posture: 'air-defense-ring',
      slots: slots('air-defense', 'air-defense'),
      validationStatus: 'approved',
      source: 'authored'
    },
    {
      id: 'recovery-san-carlos-farp',
      objectiveId: 'San Carlos',
      position: { x: 700, y: 0 },
      roles: ['reserve', 'recovery', 'extraction'],
      posture: 'recovery-area',
      slots: slots('farp', 'infantry'),
      extractionRadius: 180,
      validationStatus: 'approved',
      source: 'authored'
    },
    {
      id: 'port-san-carlos-defenders',
      objectiveId: 'Port San Carlos',
      position: { x: 1_300, y: 0 },
      roles: ['reserve'],
      posture: 'dispersed-defense',
      slots: slots('argentine-infantry', 'infantry'),
      validationStatus: 'approved',
      source: 'authored'
    },
    {
      id: 'port-san-carlos-aaa',
      objectiveId: 'Port San Carlos',
      position: { x: 1_500, y: 0 },
      roles: ['air-defense', 'defensive'],
      posture: 'air-defense-ring',
      slots: slots('argentine-aaa', 'air-defense'),
      validationStatus: 'approved',
      source: 'authored'
    }
  ],
  connections: [],
  airdromeDetails: {},
  info: {
    center: { x: 0, y: 0 },
    weather: {
      temperature: { amplitude: 1, mean: 7 },
      cloudCover: { baseCloudCover: 0.5, seasonEffect: 0.1 },
      wind: { speed: 5, direction: 270 }
    },
    night: { startHour: 18, endHour: 8 }
  }
}

function coalition(id: string): Campaign['coalitions']['player'] {
  return {
    id,
    aircraftTypes: {} as never,
    groundUnitTypes: {} as never,
    airdromeNames: [],
    objectiveIds: [],
    structures: [],
    samGroups: [],
    groundGroups: [],
    flightGroups: [],
    packages: [],
    supplyNodes: {},
    replacementPools: {},
    casualtyPoints: [],
    extractionRequests: [],
    navalGroups: []
  }
}

function naval(
  id: string,
  role: 'carrier' | 'escort' | 'transport' | 'surface-combatant',
  state: 'operational' | 'sunk' = 'operational',
  shipCount = 1
): NonNullable<Campaign['coalitions']['player']['navalGroups']>[number] {
  return {
    id,
    name: id,
    role,
    unitTypes: Array.from({ length: shipCount }, () => 'PERRY'),
    units: Array.from({ length: shipCount }, (_, index) => ({
      id: `${id}-ship-${index + 1}`,
      type: 'PERRY',
      damage: state === 'sunk' ? 1 : 0,
      ammunition: 1,
      fuel: 1,
      state
    })),
    position: { x: 0, y: 0 },
    heading: 0,
    damage: state === 'sunk' ? 1 : 0,
    fuel: 1,
    ammunition: 1,
    cargo: role === 'transport' ? 1_000 : 0,
    state
  }
}

function campaign(): Campaign {
  const player = coalition('uk-1982')
  player.navalGroups = [
    naval('carrier', 'carrier'),
    naval('escort', 'escort'),
    naval('transport', 'transport')
  ]
  const opponent = coalition('argentina-1982-official')
  opponent.navalGroups = [naval('surface', 'surface-combatant', 'sunk')]
  opponent.samGroups = [
    {
      id: 'arg-goose-green-roland',
      type: 'Roland',
      objectiveId: 'Goose Green',
      destroyed: true
    },
    {
      id: 'arg-stanley-airport-hawk',
      type: 'Hawk',
      objectiveId: 'Stanley Airport',
      destroyed: true
    },
    {
      id: 'arg-evelyn-station-farm-hawk',
      type: 'Hawk',
      objectiveId: 'Evelyn Station Farm',
      destroyed: true
    },
    { id: 'arg-fox-bay-hawk', type: 'Hawk', objectiveId: 'Fox Bay', destroyed: true }
  ]
  return {
    version: '0.2.0',
    id: 'falklands-test',
    name: 'Falklands',
    createdAt: new Date('1982-05-01T09:00:00Z'),
    updatedAt: new Date('1982-05-01T09:00:00Z'),
    time: new Date('1982-05-01T09:00:00Z'),
    timeMultiplier: 60,
    status: 'active',
    campaignPhase: 'sea-control',
    scenarioId: 'falklands-1982',
    logs: [],
    coalitions: { player, opponent }
  }
}

describe('Falklands campaign stages', () => {
  test('reserves four validated sites and completes unloading after 30 campaign minutes', () => {
    const state = campaign()
    const readiness = getSanCarlosLandingReadiness(state, theatre)
    expect(readiness).toMatchObject({ ready: true })
    expect(readiness.goals).toHaveLength(6)
    expect(readiness.goals.every((goal) => goal.complete)).toBe(true)
    advanceFalklandsCampaign(state, theatre)
    expect(state.campaignPhase).toBe('san-carlos-landing')
    expect(state.landingOperation?.reservedSiteIds).toHaveLength(4)
    expect(state.coalitions.player.structures).toContainEqual(
      expect.objectContaining({
        id: SAN_CARLOS_FARP_ID,
        type: 'Farp',
        position: { x: 700, y: 0 },
        buildings: expect.arrayContaining([expect.objectContaining({ type: 'FARP', alive: true })])
      })
    )
    const landingFarp = state.coalitions.player.structures.find(
      (structure) => structure.id === SAN_CARLOS_FARP_ID
    )
    state.time = new Date('1982-05-01T09:15:00Z')
    advanceFalklandsCampaign(state, theatre)
    expect(
      state.coalitions.player.structures.filter((structure) => structure.id === SAN_CARLOS_FARP_ID)
    ).toEqual([landingFarp])
    expect(state.coalitions.player.groundGroups).toHaveLength(0)
    expect(state.coalitions.opponent.groundGroups).toEqual([
      expect.objectContaining({
        id: 'arg-port-san-carlos-infantry',
        objectiveId: 'Port San Carlos',
        deployment: expect.objectContaining({ siteId: 'port-san-carlos-defenders' })
      }),
      expect.objectContaining({
        id: 'arg-port-san-carlos-aaa',
        objectiveId: 'Port San Carlos',
        deployment: expect.objectContaining({ siteId: 'port-san-carlos-aaa' })
      })
    ])
    expect(state.coalitions.opponent.groundGroups.flatMap((group) => group.units)).toHaveLength(12)
    expect(
      state.coalitions.opponent.groundGroups.every(
        (group) => !state.landingOperation?.reservedSiteIds.includes(group.deployment?.siteId ?? '')
      )
    ).toBe(true)
    expect(
      state.coalitions.player.navalGroups?.find((group) => group.role === 'transport')
    ).toMatchObject({
      position: SAN_CARLOS_AMPHIBIOUS_ANCHORAGE,
      state: 'unloading'
    })

    state.time = new Date('1982-05-01T09:30:00Z')
    advanceFalklandsCampaign(state, theatre)
    expect(state.campaignPhase).toBe('land-campaign')
    expect(state.landingOperation?.completed).toBe(true)
    expect(state.coalitions.player.groundGroups).toHaveLength(3)
    expect(state.coalitions.opponent.groundGroups).toHaveLength(2)
    expect(state.coalitions.player.groundGroups.every((group) => group.deployment)).toBe(true)
    expect(state.coalitions.player.objectiveIds).toEqual(
      expect.arrayContaining(['San Carlos', 'Port San Carlos'])
    )
    expect(state.coalitions.player.supplyNodes?.['San Carlos']?.current).toBe(1_000)
    expect(state.coalitions.player.replacementPools?.['San Carlos']).toBeDefined()
    expect(state.coalitions.player.structures).toContainEqual(
      expect.objectContaining({
        id: SAN_CARLOS_FARP_ID,
        type: 'Farp',
        objectiveId: 'San Carlos',
        position: { x: 700, y: 0 }
      })
    )
    expect(
      state.coalitions.player.navalGroups?.find((group) => group.role === 'transport')?.cargo
    ).toBe(0)
  })

  test('combines sea control and landing preparation until the fleet and SAM are destroyed', () => {
    const state = campaign()
    state.campaignPhase = 'landing-preparation'
    state.coalitions.opponent.navalGroups = [
      naval('surface', 'surface-combatant', 'operational', 3)
    ]
    state.coalitions.opponent.samGroups[0]!.destroyed = false

    advanceFalklandsCampaign(state, theatre)
    expect(state.campaignPhase).toBe('sea-control')
    const blockedReadiness = getSanCarlosLandingReadiness(state, theatre)
    expect(blockedReadiness.reasons).toEqual(
      expect.arrayContaining([
        'Hostile surface forces remain operational',
        'The Falklands SAM network has not been destroyed (1 battery remaining)'
      ])
    )
    expect(blockedReadiness.goals.filter((goal) => !goal.complete).map((goal) => goal.id)).toEqual(
      expect.arrayContaining(['surface-threats', 'sam-network'])
    )
    expect(blockedReadiness.goals).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: 'surface-threats',
          label: 'Destroy enemy warships (0/3)'
        }),
        expect.objectContaining({
          id: 'sam-network',
          label: 'Destroy the Falklands SAM network (3/4)'
        })
      ])
    )

    state.coalitions.opponent.navalGroups[0]!.state = 'sunk'
    state.coalitions.opponent.navalGroups[0]!.damage = 1
    for (const unit of state.coalitions.opponent.navalGroups[0]!.units ?? []) {
      unit.state = 'sunk'
      unit.damage = 1
    }
    advanceFalklandsCampaign(state, theatre)
    expect(state.campaignPhase).toBe('sea-control')

    state.coalitions.opponent.samGroups[0]!.destroyed = true
    const events = advanceFalklandsCampaign(state, theatre)
    expect(state.campaignPhase).toBe('san-carlos-landing')
    expect(events.map((event) => event.message)).not.toContain(
      'Sea-control conditions met; landing preparation started'
    )
  })

  test('requires persistent local EWR sites to be destroyed before the landing', () => {
    const state = campaign()
    state.coalitions.opponent.ewrGroups = [
      {
        id: 'iads-ewr-evelyn',
        type: '55G6 EWR',
        objectiveId: 'Evelyn Station Farm',
        position: { x: 4_000, y: 2_000 }
      },
      {
        id: 'iads-ewr-stanley',
        type: '55G6 EWR',
        objectiveId: 'Stanley Airport',
        position: { x: 8_000, y: 2_000 }
      },
      {
        id: 'iads-ewr-fox-bay',
        type: '55G6 EWR',
        objectiveId: 'Fox Bay',
        position: { x: 12_000, y: 2_000 }
      }
    ]

    expect(getSanCarlosLandingReadiness(state, theatre)).toMatchObject({
      ready: false,
      reasons: expect.arrayContaining(['Local EWR remain operational']),
      goals: expect.arrayContaining([
        {
          id: 'radars',
          label: 'Destroy all local EWR (0/3)',
          complete: false
        }
      ])
    })

    for (const ewr of state.coalitions.opponent.ewrGroups) ewr.destroyed = true
    expect(getSanCarlosLandingReadiness(state, theatre)).toMatchObject({
      ready: true,
      goals: expect.arrayContaining([
        {
          id: 'radars',
          label: 'Destroy all local EWR (3/3)',
          complete: true
        }
      ])
    })
  })

  test.each(['san-carlos-landing', 'land-campaign'] as const)(
    'repairs a missing FARP in an existing %s save with legacy reservations',
    (phase) => {
      const state = campaign()
      state.campaignPhase = phase
      state.landingOperation = {
        completed: phase === 'land-campaign',
        reservedSiteIds: ['san-carlos-vehicle']
      }

      migrateFalklandsSanCarlosFarp(state, theatre)
      migrateFalklandsSanCarlosFarp(state, theatre)

      expect(state.coalitions.player.structures).toEqual([
        expect.objectContaining({
          id: SAN_CARLOS_FARP_ID,
          position: { x: 700, y: 0 }
        })
      ])
      // A destroyed pad must retain its damage when the save is loaded again.
      state.coalitions.player.structures[0]!.buildings[0]!.alive = false
      migrateFalklandsSanCarlosFarp(state, theatre)
      expect(state.coalitions.player.structures[0]!.buildings[0]!.alive).toBe(false)
    }
  )

  test('does not create a FARP before the landing starts', () => {
    const state = campaign()
    migrateFalklandsSanCarlosFarp(state, theatre)
    expect(state.coalitions.player.structures).toEqual([])
  })

  test('moves an existing San Carlos FARP and its home waypoints to the reviewed site', () => {
    const state = campaign()
    state.campaignPhase = 'land-campaign'
    state.landingOperation = {
      startedAt: new Date('1982-05-01T09:00:00Z'),
      completesAt: new Date('1982-05-01T09:30:00Z'),
      completed: true,
      reservedSiteIds: ['recovery-san-carlos-farp']
    }
    state.coalitions.player.structures.push({
      id: SAN_CARLOS_FARP_ID,
      type: 'Farp',
      objectiveId: 'San Carlos',
      position: { x: 600, y: -100 },
      name: 'San Carlos FARP',
      resources: 0,
      buildings: [{ offset: { x: 0, y: 0 }, type: 'FARP', alive: true }]
    })
    state.coalitions.player.flightGroups = [
      {
        homeBase: SAN_CARLOS_FARP_ID,
        position: { x: 600, y: -100 },
        flightplan: {
          waypoints: [
            { type: 'TakeOff', position: { x: 600, y: -100 } },
            { type: 'Task', position: { x: 2_000, y: 2_000 } },
            { type: 'Landing', position: { x: 600, y: -100 } }
          ]
        }
      }
    ] as Campaign['coalitions']['player']['flightGroups']

    migrateFalklandsSanCarlosFarp(state, theatre)

    expect(
      state.coalitions.player.structures.find((structure) => structure.id === SAN_CARLOS_FARP_ID)
        ?.position
    ).toEqual({ x: 700, y: 0 })
    expect(state.coalitions.player.flightGroups[0]?.position).toEqual({ x: 700, y: 0 })
    expect(state.coalitions.player.flightGroups[0]?.flightplan.waypoints).toMatchObject([
      { type: 'TakeOff', position: { x: 700, y: 0 } },
      { type: 'Task', position: { x: 2_000, y: 2_000 } },
      { type: 'Landing', position: { x: 700, y: 0 } }
    ])
  })

  test('adds the expanded SAM network to an existing pre-landing save', () => {
    const state = campaign()
    state.coalitions.opponent.samGroups = [state.coalitions.opponent.samGroups[0]!]

    advanceFalklandsCampaign(state, theatre)

    expect(state.campaignPhase).toBe('sea-control')
    expect(state.coalitions.opponent.samGroups.map((sam) => [sam.objectiveId, sam.type])).toEqual(
      expect.arrayContaining([
        ['Goose Green', 'Roland'],
        ['Stanley Airport', 'Hawk'],
        ['Evelyn Station Farm', 'Hawk'],
        ['Fox Bay', 'Hawk']
      ])
    )
    expect(getSanCarlosLandingReadiness(state, theatre).reasons).toContain(
      'The Falklands SAM network has not been destroyed (3 batteries remaining)'
    )
  })

  test('removes the premature beachhead from legacy saves and uses embarked supply', () => {
    const state = campaign()
    state.coalitions.opponent.navalGroups = [naval('surface', 'surface-combatant')]
    state.coalitions.player.objectiveIds = ['San Carlos', 'Port San Carlos']
    state.coalitions.player.supplyNodes = {
      'San Carlos': {
        current: 500,
        max: 1_000,
        productionRate: 0,
        consumptionRate: 0,
        status: 'adequate'
      }
    }
    state.coalitions.player.structures.push({
      id: 'premature-farp',
      type: 'Farp',
      objectiveId: 'San Carlos',
      position: { x: 0, y: 0 },
      name: 'Premature FARP',
      resources: 0,
      buildings: []
    })

    advanceFalklandsCampaign(state, theatre)

    expect(state.status).toBe('active')
    expect(state.campaignPhase).toBe('sea-control')
    expect(state.coalitions.player.objectiveIds).toEqual([])
    expect(state.coalitions.player.supplyNodes?.['San Carlos']).toBeUndefined()
    expect(state.coalitions.player.structures).toEqual([])
  })

  test('moves untouched legacy naval starts into the wider operating areas', () => {
    const state = campaign()
    state.coalitions.player.navalGroups = [
      naval('uk-carrier-group', 'carrier'),
      naval('uk-escort-group', 'escort'),
      naval('uk-amphibious-group', 'transport')
    ]
    state.coalitions.player.navalGroups[0]!.position = { x: 80_000, y: 185_000 }
    state.coalitions.player.navalGroups[1]!.position = { x: 74_416, y: 178_089 }
    state.coalitions.player.navalGroups[2]!.position = { x: 105_469, y: -4_993 }
    state.coalitions.opponent.navalGroups = [naval('arg-surface-group', 'surface-combatant')]
    state.coalitions.opponent.navalGroups[0]!.position = { x: 10_000, y: -150_000 }

    advanceFalklandsCampaign(state, theatre)

    expect(state.campaignPhase).toBe('sea-control')
    expect(state.coalitions.player.navalGroups.map((group) => group.position)).toEqual([
      { x: 87_610, y: 184_267 },
      { x: 82_610, y: 190_267 },
      { x: 332_376, y: 147_640 }
    ])
    expect(state.coalitions.player.navalGroups[1]?.missionGroupId).toBe('uk-carrier-group')
    expect(state.coalitions.opponent.navalGroups[0]?.position).toEqual({ x: 331_295, y: 39_031 })
  })

  test.each([
    ['capital ship group', ['ara_vdm', 'PERRY']],
    ['speedboat group', ['speedboat']],
    ['single gun-only frigate', ['leander-gun-achilles']]
  ])('replaces the legacy Argentine %s with a gun-only surface group', (_label, unitTypes) => {
    const state = campaign()
    state.coalitions.opponent.navalGroups = [naval('arg-surface-group', 'surface-combatant')]
    const surfaceGroup = state.coalitions.opponent.navalGroups[0]!
    surfaceGroup.name = 'Argentine Surface Group'
    surfaceGroup.unitTypes = unitTypes
    surfaceGroup.units = unitTypes.map((type, index) => ({
      id: `arg-surface-group-ship-${index + 1}`,
      type,
      damage: 0,
      ammunition: 1,
      fuel: 1,
      state: 'operational'
    }))

    advanceFalklandsCampaign(state, theatre)

    expect(surfaceGroup).toMatchObject({
      name: 'Argentine Surface Group',
      missionPatrol: { pattern: 'circle', radius: 2_500, speed: 3 },
      persistPosition: false,
      unitTypes: ['leander-gun-achilles', 'leander-gun-andromeda', 'leander-gun-ariadne'],
      damage: 0,
      state: 'operational',
      units: [
        { type: 'leander-gun-achilles', damage: 0, state: 'operational' },
        { type: 'leander-gun-andromeda', damage: 0, state: 'operational' },
        { type: 'leander-gun-ariadne', damage: 0, state: 'operational' }
      ]
    })
  })

  test('loses immediately when carrier capability is destroyed', () => {
    const state = campaign()
    state.coalitions.player.navalGroups![0]!.state = 'sunk'
    state.coalitions.player.navalGroups![0]!.damage = 1
    const events = advanceFalklandsCampaign(state, theatre)
    expect(state.status).toBe('lost')
    expect(events[0]?.kind).toBe('defeat')
  })
})
