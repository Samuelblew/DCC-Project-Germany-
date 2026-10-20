import { describe, expect, test } from 'vitest'
import { schemas } from '@dcc/contracts'
import { findGermanyIadsSite } from '@dcc/data'
import type * as z from 'zod'

import { applyMissionStateUpdate } from './mission-state-update'

type Campaign = z.infer<typeof schemas.campaign.campaign>
type CoalitionData = Campaign['coalitions']['player']
type FlightGroup = CoalitionData['flightGroups'][number]
type GroundGroup = CoalitionData['groundGroups'][number]
type MissionState = z.infer<typeof schemas.missionState>

const campaignTime = new Date('2026-01-01T12:00:00.000Z')

function secondsAfterMidnight(hour: number, minute = 0) {
  return hour * 3600 + minute * 60
}

function createCoalition(id: 'player' | 'opponent'): CoalitionData {
  const aircraftTypes = Object.fromEntries(
    schemas.task.options.map((task) => [task, [] as string[]])
  ) as CoalitionData['aircraftTypes']
  aircraftTypes.CAP = ['F-16C_50']
  aircraftTypes['Pinpoint Strike'] = ['F-16C_50']
  aircraftTypes['Strategic Strike'] = ['B-52H']
  aircraftTypes.SEAD = ['F-16C_50']
  aircraftTypes.DEAD = ['F-16C_50']
  aircraftTypes.CAS = ['F-16C_50']
  aircraftTypes.Transport = ['UH-60L']

  const groundUnitTypes = Object.fromEntries(
    schemas.groundUnitType.options.map((type) => [type, [] as string[]])
  ) as CoalitionData['groundUnitTypes']
  groundUnitTypes.Vehicle = ['M-1 Abrams']
  groundUnitTypes['Shorad Infantry'] = ['Soldier stinger']

  return {
    id,
    aircraftTypes,
    groundUnitTypes,
    airdromeNames: [],
    objectiveIds: [],
    structures: [],
    samGroups: [],
    groundGroups: [],
    flightGroups: [],
    packages: [],
    supplyNodes: {}
  }
}

function createCampaign(): Campaign {
  return {
    version: 'test',
    id: 'campaign-1',
    name: 'Test Campaign',
    createdAt: campaignTime,
    updatedAt: campaignTime,
    time: campaignTime,
    timeMultiplier: 1,
    logs: [],
    scenarioId: 'red-bullet',
    coalitions: {
      player: createCoalition('player'),
      opponent: createCoalition('opponent')
    }
  }
}

function createFlightGroup({
  id = 'flight-1',
  callsign = 'Enfield-1',
  startTime = campaignTime,
  clientCount = 0
}: {
  id?: string
  callsign?: string
  startTime?: Date
  clientCount?: number
} = {}): FlightGroup {
  return {
    id,
    aircrafts: [1, 2].map((unitNumber) => ({
      id: `${id}-aircraft-${unitNumber}`,
      unitName: `${callsign}-${unitNumber}`,
      aircraftName: 'F-16C_50',
      client: unitNumber <= clientCount
    })),
    task: 'CAP',
    position: { x: 0, y: 0 },
    homeBase: 'Kobuleti',
    callsign,
    flightplan: {
      id: `${id}-flightplan`,
      startTime,
      waypoints: [
        {
          name: 'TakeOff',
          position: { x: 0, y: 0 },
          altitude: 0,
          speed: 150,
          type: 'TakeOff'
        },
        {
          name: 'Landing',
          position: { x: 1_000_000, y: 0 },
          altitude: 0,
          speed: 150,
          type: 'Landing'
        }
      ]
    }
  }
}

function trackedUnit(name: string, groupName = 'Enfield-1'): MissionState['lostUnits'][number] {
  return {
    name,
    groupName,
    type: 'F-16C_50',
    x: 0,
    y: 0
  }
}

function aircraftPositionGroup(
  callsign = 'Enfield-1',
  units: Array<{ unitNumber: number; inAir: boolean }>
): NonNullable<MissionState['groupPositions']>['blue']['aircraft'][number] {
  return {
    name: callsign,
    x: 200,
    y: 300,
    units: units.map(({ unitNumber, inAir }) => ({
      name: `${callsign}-${unitNumber}`,
      type: 'F-16C_50',
      x: 200 + unitNumber,
      y: 300 + unitNumber,
      inAir
    }))
  }
}

function groundGroup({
  id,
  position = { x: 100, y: 100 },
  units = [{ name: 'M-1 Abrams', count: 2 }]
}: {
  id: string
  position?: { x: number; y: number }
  units?: GroundGroup['units']
}): GroundGroup {
  return {
    id,
    objectiveId: `${id}-objective`,
    position,
    state: 'idle',
    units
  }
}

function groundPositionGroup(
  id: string,
  units: Array<{ type: string; count?: number }>,
  position = { x: 200, y: 300 }
): NonNullable<MissionState['groupPositions']>['blue']['ground'][number] {
  return {
    name: `Ground-${id}-123`,
    x: position.x,
    y: position.y,
    units: units.flatMap(({ type, count = 1 }, index) =>
      Array.from({ length: count }, (_, unitIndex) => ({
        name: `Ground-${id}-123-${index}-${unitIndex}`,
        type,
        x: position.x + unitIndex,
        y: position.y + unitIndex
      }))
    )
  }
}

function carrierGroup(state: 'operational' | 'sunk' = 'operational') {
  const sunk = state === 'sunk'
  return {
    id: 'carrier-group',
    name: 'Carrier Group',
    role: 'carrier' as const,
    unitTypes: ['hms_invincible'],
    units: [
      {
        id: 'carrier-ship-1',
        type: 'hms_invincible',
        damage: sunk ? 1 : 0,
        ammunition: 1,
        fuel: 1,
        state
      }
    ],
    position: { x: 80_000, y: 185_000 },
    heading: 0,
    damage: sunk ? 1 : 0,
    fuel: 1,
    ammunition: 1,
    cargo: 0,
    state
  }
}

type MissionSide = NonNullable<MissionState['groupPositions']>['blue']
/** Sides may leave out empty lists; the helper fills them. */
type MissionStateOverrides = Omit<Partial<MissionState>, 'groupPositions'> & {
  groupPositions?: { blue?: Partial<MissionSide>; red?: Partial<MissionSide> }
}

function createMissionState(overrides: MissionStateOverrides): MissionState {
  const emptySide = { aircraft: [], ground: [], ships: [] }
  return {
    missionId: 'campaign-1',
    missionEnded: true,
    time: secondsAfterMidnight(12, 30),
    ejectedPilots: [],
    lostUnits: [],
    landedUnits: [],
    cargoDeliveries: {},
    troopExtractions: [],
    casevacPickups: [],
    ...overrides,
    groupPositions: {
      blue: { ...emptySide, ...overrides.groupPositions?.blue },
      red: { ...emptySide, ...overrides.groupPositions?.red }
    }
  }
}

describe('applyMissionStateUpdate flight group cleanup', () => {
  test('removes a flight group when every aircraft landed', () => {
    const campaign = createCampaign()
    campaign.coalitions.player.flightGroups = [createFlightGroup()]
    campaign.coalitions.player.packages = [
      {
        id: 'package-1',
        type: 'Strike Package',
        targetObjectiveId: 'target-1',
        members: [{ flightGroupId: 'flight-1', role: 'primary', totOffset: 0 }],
        tot: campaignTime,
        status: 'active'
      }
    ]

    const updated = applyMissionStateUpdate(
      campaign,
      createMissionState({
        landedUnits: [trackedUnit('Enfield-1-1'), trackedUnit('Enfield-1-2')],
        groupPositions: {
          blue: { aircraft: [aircraftPositionGroup('Enfield-1', [])], ground: [], ships: [] },
          red: { aircraft: [], ground: [], ships: [] }
        }
      })
    )

    expect(updated.coalitions.player.flightGroups).toHaveLength(0)
    expect(updated.coalitions.player.packages).toHaveLength(0)
  })

  test('clears ground battle locks when the owning package completes', () => {
    const campaign = createCampaign()
    campaign.coalitions.player.flightGroups = [createFlightGroup()]
    campaign.coalitions.player.packages = [
      {
        id: 'package-1',
        type: 'CAS Package',
        targetObjectiveId: 'target-1',
        members: [{ flightGroupId: 'flight-1', role: 'cas', totOffset: 0 }],
        tot: campaignTime,
        status: 'active',
        variantId: 'defensive-cas',
        variantLabel: 'Defensive CAS'
      }
    ]
    campaign.groundBattleLocks = [
      {
        id: 'lock-1',
        packageId: 'package-1',
        coalition: 'player',
        attackerCoalition: 'opponent',
        defenderCoalition: 'player',
        attackerGroupIds: ['attacker-1'],
        defenderGroupIds: ['defender-1'],
        targetObjectiveId: 'target-1',
        expiresAt: new Date(campaignTime.getTime() + 60 * 60 * 1000)
      }
    ]

    const updated = applyMissionStateUpdate(
      campaign,
      createMissionState({
        landedUnits: [trackedUnit('Enfield-1-1'), trackedUnit('Enfield-1-2')],
        groupPositions: {
          blue: { aircraft: [aircraftPositionGroup('Enfield-1', [])], ground: [], ships: [] },
          red: { aircraft: [], ground: [], ships: [] }
        }
      })
    )

    expect(updated.groundBattleLocks).toEqual([])
  })

  test('removes a flight group when all aircraft are destroyed or landed', () => {
    const campaign = createCampaign()
    campaign.coalitions.player.flightGroups = [createFlightGroup()]

    const updated = applyMissionStateUpdate(
      campaign,
      createMissionState({
        lostUnits: [trackedUnit('Enfield-1-1')],
        landedUnits: [trackedUnit('Enfield-1-2')],
        groupPositions: {
          blue: {
            aircraft: [aircraftPositionGroup('Enfield-1', [{ unitNumber: 2, inAir: false }])],
            ground: []
          },
          red: { aircraft: [], ground: [], ships: [] }
        }
      })
    )

    expect(updated.coalitions.player.flightGroups).toHaveLength(0)
  })

  test('keeps airborne survivors and removes terminal aircraft from the group', () => {
    const campaign = createCampaign()
    campaign.coalitions.player.flightGroups = [createFlightGroup()]

    const updated = applyMissionStateUpdate(
      campaign,
      createMissionState({
        landedUnits: [trackedUnit('Enfield-1-1')],
        groupPositions: {
          blue: {
            aircraft: [
              aircraftPositionGroup('Enfield-1', [
                { unitNumber: 1, inAir: false },
                { unitNumber: 2, inAir: true }
              ])
            ],
            ground: []
          },
          red: { aircraft: [], ground: [], ships: [] }
        }
      })
    )

    expect(updated.coalitions.player.flightGroups).toHaveLength(1)
    expect(updated.coalitions.player.flightGroups[0]?.aircrafts).toHaveLength(1)
    expect(updated.coalitions.player.flightGroups[0]?.aircrafts[0]?.unitName).toBe('Enfield-1-2')
    expect(updated.coalitions.player.flightGroups[0]?.position).toEqual({ x: 200, y: 300 })
  })

  test('removes a client flight group when all clients are done but AI remains airborne', () => {
    const campaign = createCampaign()
    campaign.coalitions.player.flightGroups = [createFlightGroup({ clientCount: 1 })]

    const updated = applyMissionStateUpdate(
      campaign,
      createMissionState({
        landedUnits: [trackedUnit('Enfield-1-1')],
        groupPositions: {
          blue: {
            aircraft: [
              aircraftPositionGroup('Enfield-1', [
                { unitNumber: 1, inAir: false },
                { unitNumber: 2, inAir: true }
              ])
            ],
            ground: []
          },
          red: { aircraft: [], ground: [], ships: [] }
        }
      })
    )

    expect(updated.coalitions.player.flightGroups).toHaveLength(0)
  })

  test('keeps a client flight group while a client is still airborne', () => {
    const campaign = createCampaign()
    campaign.coalitions.player.flightGroups = [createFlightGroup({ clientCount: 2 })]

    const updated = applyMissionStateUpdate(
      campaign,
      createMissionState({
        landedUnits: [trackedUnit('Enfield-1-1')],
        groupPositions: {
          blue: {
            aircraft: [
              aircraftPositionGroup('Enfield-1', [
                { unitNumber: 1, inAir: false },
                { unitNumber: 2, inAir: true }
              ])
            ],
            ground: []
          },
          red: { aircraft: [], ground: [], ships: [] }
        }
      })
    )

    expect(updated.coalitions.player.flightGroups).toHaveLength(1)
    expect(updated.coalitions.player.flightGroups[0]?.aircrafts).toHaveLength(1)
    expect(updated.coalitions.player.flightGroups[0]?.aircrafts[0]?.unitName).toBe('Enfield-1-2')
    expect(updated.coalitions.player.flightGroups[0]?.aircrafts[0]?.client).toBe(true)
  })

  test('removes a client flight group when all clients are destroyed or landed', () => {
    const campaign = createCampaign()
    campaign.coalitions.player.flightGroups = [createFlightGroup({ clientCount: 1 })]

    const updated = applyMissionStateUpdate(
      campaign,
      createMissionState({
        lostUnits: [trackedUnit('Enfield-1-1')],
        groupPositions: {
          blue: {
            aircraft: [aircraftPositionGroup('Enfield-1', [{ unitNumber: 2, inAir: true }])],
            ground: []
          },
          red: { aircraft: [], ground: [], ships: [] }
        }
      })
    )

    expect(updated.coalitions.player.flightGroups).toHaveLength(0)
  })

  test('removes a flight group when every aircraft was destroyed', () => {
    const campaign = createCampaign()
    campaign.coalitions.player.flightGroups = [createFlightGroup()]

    const updated = applyMissionStateUpdate(
      campaign,
      createMissionState({
        lostUnits: [trackedUnit('Enfield-1-1'), trackedUnit('Enfield-1-2')]
      })
    )

    expect(updated.coalitions.player.flightGroups).toHaveLength(0)
  })

  test('does not remove a parked future group without landing events', () => {
    const campaign = createCampaign()
    campaign.coalitions.player.flightGroups = [
      createFlightGroup({ startTime: new Date('2026-01-01T13:00:00.000Z') })
    ]

    const updated = applyMissionStateUpdate(
      campaign,
      createMissionState({
        groupPositions: {
          blue: {
            aircraft: [
              aircraftPositionGroup('Enfield-1', [
                { unitNumber: 1, inAir: false },
                { unitNumber: 2, inAir: false }
              ])
            ],
            ground: []
          },
          red: { aircraft: [], ground: [], ships: [] }
        }
      })
    )

    expect(updated.coalitions.player.flightGroups).toHaveLength(1)
    expect(updated.coalitions.player.flightGroups[0]?.aircrafts).toHaveLength(2)
  })
})

describe('applyMissionStateUpdate culling manifest', () => {
  test('preserves omitted ground groups instead of treating them as destroyed', () => {
    const campaign = createCampaign()
    campaign.coalitions.opponent.groundGroups = [groundGroup({ id: 'omitted-ground' })]

    const updated = applyMissionStateUpdate(
      campaign,
      createMissionState({
        groupPositions: {
          blue: { aircraft: [], ground: [], ships: [] },
          red: { aircraft: [], ground: [], ships: [] }
        },
        cullingManifest: {
          groundGroups: { player: {}, opponent: {} },
          structures: { player: {}, opponent: {} }
        }
      })
    )

    expect(updated.coalitions.opponent.groundGroups).toEqual([
      expect.objectContaining({
        id: 'omitted-ground',
        units: [{ name: 'M-1 Abrams', count: 2 }]
      })
    ])
  })

  test('applies a real kill of a bubble-spawned ground unit that was omitted from the mission', () => {
    const campaign = createCampaign()
    campaign.coalitions.opponent.groundGroups = [groundGroup({ id: 'omitted-ground' })]

    const updated = applyMissionStateUpdate(
      campaign,
      createMissionState({
        groupPositions: {
          blue: { aircraft: [], ground: [], ships: [] },
          red: { aircraft: [], ground: [], ships: [] }
        },
        lostUnits: [trackedUnit('GroundUnit-omitted-ground-legacy-1', 'Ground-omitted-ground-1')],
        cullingManifest: {
          groundGroups: { player: {}, opponent: {} },
          structures: { player: {}, opponent: {} }
        }
      })
    )

    expect(updated.coalitions.opponent.groundGroups).toEqual([
      expect.objectContaining({
        id: 'omitted-ground',
        units: [{ name: 'M-1 Abrams', count: 1 }]
      })
    ])
  })

  test('updates only anti-air units for antiAirOnly ground groups', () => {
    const campaign = createCampaign()
    campaign.coalitions.opponent.groundGroups = [
      groundGroup({
        id: 'mixed-ground',
        position: { x: 100, y: 100 },
        units: [
          { name: 'M-1 Abrams', count: 2 },
          { name: 'Soldier stinger', count: 2 }
        ]
      })
    ]

    const updated = applyMissionStateUpdate(
      campaign,
      createMissionState({
        groupPositions: {
          blue: { aircraft: [], ground: [], ships: [] },
          red: {
            aircraft: [],
            ground: [groundPositionGroup('mixed-ground', [{ type: 'Soldier stinger', count: 1 }])]
          }
        },
        cullingManifest: {
          groundGroups: { player: {}, opponent: { 'mixed-ground': 'antiAirOnly' } },
          structures: { player: {}, opponent: {} }
        }
      })
    )

    expect(updated.coalitions.opponent.groundGroups[0]?.position).toEqual({ x: 100, y: 100 })
    expect(updated.coalitions.opponent.groundGroups[0]?.units).toEqual([
      { name: 'M-1 Abrams', count: 2 },
      { name: 'Soldier stinger', count: 1 }
    ])
  })

  test('keeps full ground group sync behavior for emitted full groups', () => {
    const campaign = createCampaign()
    campaign.coalitions.opponent.groundGroups = [groundGroup({ id: 'full-ground' })]

    const updated = applyMissionStateUpdate(
      campaign,
      createMissionState({
        groupPositions: {
          blue: { aircraft: [], ground: [], ships: [] },
          red: {
            aircraft: [],
            ground: [groundPositionGroup('full-ground', [{ type: 'M-1 Abrams', count: 1 }])]
          }
        },
        cullingManifest: {
          groundGroups: { player: {}, opponent: { 'full-ground': 'full' } },
          structures: { player: {}, opponent: {} }
        }
      })
    )

    expect(updated.coalitions.opponent.groundGroups[0]?.position).toEqual({ x: 200, y: 300 })
    expect(updated.coalitions.opponent.groundGroups[0]?.units).toEqual([
      { name: 'M-1 Abrams', count: 1 }
    ])
  })

  test('does not apply lost static events to omitted structures', () => {
    const campaign = createCampaign()
    campaign.coalitions.opponent.structures = [
      {
        id: 'omitted-structure',
        type: 'Depot',
        objectiveId: 'objective-1',
        position: { x: 0, y: 0 },
        name: 'Omitted Structure',
        resources: 0,
        buildings: [{ type: 'Warehouse', offset: { x: 0, y: 0 }, alive: true }]
      },
      {
        id: 'emitted-structure',
        type: 'Depot',
        objectiveId: 'objective-2',
        position: { x: 100, y: 0 },
        name: 'Emitted Structure',
        resources: 0,
        buildings: [{ type: 'Warehouse', offset: { x: 0, y: 0 }, alive: true }]
      }
    ]

    const updated = applyMissionStateUpdate(
      campaign,
      createMissionState({
        lostUnits: [
          trackedUnit('Static-omitted-structure-Depot-101-1', 'Static-omitted-structure-Depot-101'),
          trackedUnit('Static-emitted-structure-Depot-102-1', 'Static-emitted-structure-Depot-102')
        ],
        cullingManifest: {
          groundGroups: { player: {}, opponent: {} },
          structures: { player: {}, opponent: { 'emitted-structure': true } }
        }
      })
    )

    expect(updated.coalitions.opponent.structures[0]?.buildings[0]?.alive).toBe(true)
    expect(updated.coalitions.opponent.structures[1]?.buildings[0]?.alive).toBe(false)
  })

  test('counts a static destroyed inside the live bubble', () => {
    const campaign = createCampaign()
    campaign.campaignParams = { ...campaign.campaignParams, worldMode: 'bubble' }
    campaign.coalitions.opponent.structures = [
      {
        id: 'depot',
        type: 'Depot',
        objectiveId: 'objective-1',
        position: { x: 0, y: 0 },
        name: 'Depot',
        resources: 0,
        buildings: [{ type: 'Warehouse', offset: { x: 0, y: 0 }, alive: true }]
      }
    ]

    const updated = applyMissionStateUpdate(
      campaign,
      createMissionState({
        lostUnits: [trackedUnit('Static-depot-Depot-1', 'Static-depot')],
        cullingManifest: {
          groundGroups: { player: {}, opponent: {} },
          structures: { player: {}, opponent: {} }
        }
      })
    )

    expect(updated.coalitions.opponent.structures[0]?.buildings[0]?.alive).toBe(false)
  })
})

describe('applyMissionStateUpdate EWR groups', () => {
  test('persists EWR destruction and its last mission position', () => {
    const campaign = createCampaign()
    campaign.coalitions.opponent.ewrGroups = [
      {
        id: 'ewr-stanley-1',
        type: '55G6 EWR',
        objectiveId: 'Stanley Airport',
        position: { x: 100, y: 200 }
      }
    ]

    const updated = applyMissionStateUpdate(
      campaign,
      createMissionState({
        lostUnits: [trackedUnit('IADS-EWR-Unit-ewr-stanley-1', 'IADS-EWR-ewr-stanley-1-201')],
        groupPositions: {
          blue: { aircraft: [], ground: [], ships: [] },
          red: {
            aircraft: [],
            ships: [],
            ground: [
              {
                name: 'IADS-EWR-ewr-stanley-1-201',
                x: 125,
                y: 225,
                units: []
              }
            ]
          }
        }
      })
    )

    expect(updated.coalitions.opponent.ewrGroups?.[0]).toMatchObject({
      id: 'ewr-stanley-1',
      position: { x: 125, y: 225 },
      destroyed: true
    })
  })
})

describe('applyMissionStateUpdate naval groups', () => {
  test('tracks an escort emitted inside its carrier mission group', () => {
    const campaign = createCampaign()
    campaign.coalitions.player.navalGroups = [
      carrierGroup(),
      {
        id: 'escort-group',
        name: 'Escort Group',
        role: 'escort',
        missionGroupId: 'carrier-group',
        unitTypes: ['PERRY'],
        units: [
          {
            id: 'escort-ship-1',
            type: 'PERRY',
            damage: 0,
            ammunition: 1,
            fuel: 1,
            state: 'operational'
          }
        ],
        position: { x: 79_000, y: 184_000 },
        heading: 0,
        damage: 0,
        fuel: 1,
        ammunition: 1,
        cargo: 0,
        state: 'operational'
      }
    ]

    const updated = applyMissionStateUpdate(
      campaign,
      createMissionState({
        groupPositions: {
          blue: {
            aircraft: [],
            ground: [],
            ships: [
              {
                name: 'NavalGroup-carrier-group',
                x: 81_000,
                y: 186_000,
                units: [
                  {
                    name: 'NavalUnit-carrier-group-carrier-ship-1',
                    type: 'hms_invincible',
                    x: 81_000,
                    y: 186_000
                  },
                  {
                    name: 'NavalUnit-escort-group-escort-ship-1',
                    type: 'PERRY',
                    x: 80_200,
                    y: 185_300
                  }
                ]
              }
            ]
          },
          red: { aircraft: [], ground: [], ships: [] }
        }
      })
    )

    expect(updated.coalitions.player.navalGroups?.[1]).toMatchObject({
      position: { x: 80_200, y: 185_300 },
      state: 'operational',
      units: [{ state: 'operational' }]
    })
  })

  test('keeps a mission-only naval patrol at its campaign position while tracking losses', () => {
    const campaign = createCampaign()
    campaign.coalitions.opponent.navalGroups = [
      {
        id: 'arg-surface-group',
        name: 'Argentine Surface Group',
        role: 'surface-combatant',
        persistPosition: false,
        unitTypes: ['leander-gun-achilles', 'leander-gun-andromeda', 'leander-gun-ariadne'],
        units: [
          {
            id: 'arg-surface-group-ship-1',
            type: 'leander-gun-achilles',
            damage: 0,
            ammunition: 1,
            fuel: 1,
            state: 'operational'
          },
          {
            id: 'arg-surface-group-ship-2',
            type: 'leander-gun-andromeda',
            damage: 0,
            ammunition: 1,
            fuel: 1,
            state: 'operational'
          },
          {
            id: 'arg-surface-group-ship-3',
            type: 'leander-gun-ariadne',
            damage: 0,
            ammunition: 1,
            fuel: 1,
            state: 'operational'
          }
        ],
        position: { x: -22_010, y: -8_141 },
        heading: 0,
        damage: 0,
        fuel: 1,
        ammunition: 1,
        cargo: 0,
        state: 'operational'
      }
    ]
    const lostUnitName = 'NavalUnit-arg-surface-group-arg-surface-group-ship-1'

    const updated = applyMissionStateUpdate(
      campaign,
      createMissionState({
        lostUnits: [trackedUnit(lostUnitName, 'NavalGroup-arg-surface-group')],
        groupPositions: {
          blue: { aircraft: [], ground: [], ships: [] },
          red: {
            aircraft: [],
            ground: [],
            ships: [
              {
                name: 'NavalGroup-arg-surface-group',
                x: -15_000,
                y: -2_000,
                units: [
                  {
                    name: 'NavalUnit-arg-surface-group-arg-surface-group-ship-2',
                    type: 'leander-gun-andromeda',
                    x: -15_000,
                    y: -2_000
                  },
                  {
                    name: 'NavalUnit-arg-surface-group-arg-surface-group-ship-3',
                    type: 'leander-gun-ariadne',
                    x: -15_700,
                    y: -2_000
                  }
                ]
              }
            ]
          }
        }
      })
    )

    expect(updated.coalitions.opponent.navalGroups?.[0]).toMatchObject({
      position: { x: -22_010, y: -8_141 },
      damage: 1 / 3,
      state: 'damaged',
      units: [
        { state: 'sunk', damage: 1 },
        { state: 'operational', damage: 0 },
        { state: 'operational', damage: 0 }
      ]
    })
  })

  test('keeps carriers operational when DCS reports a carrier unit lost', () => {
    const campaign = createCampaign()
    campaign.coalitions.player.navalGroups = [carrierGroup('sunk')]

    const unitName = 'NavalUnit-carrier-group-carrier-ship-1'
    const updated = applyMissionStateUpdate(
      campaign,
      createMissionState({
        lostUnits: [trackedUnit(unitName, 'NavalGroup-carrier-group')]
      })
    )

    const carrier = updated.coalitions.player.navalGroups?.[0]
    expect(carrier?.state).toBe('operational')
    expect(carrier?.damage).toBe(0)
    expect(carrier?.units?.[0]?.state).toBe('operational')
    expect(carrier?.units?.[0]?.damage).toBe(0)
  })

  test('reopens a legacy campaign lost because its carrier was destroyed', () => {
    const legacy = createCampaign()
    legacy.scenarioId = 'falklands-1982'
    legacy.status = 'lost'
    legacy.timeMultiplier = 0
    legacy.coalitions.player.navalGroups = [carrierGroup('sunk')]
    legacy.logs = [
      {
        id: 'carrier-defeat',
        type: 'campaign',
        coalition: 'opponent',
        campaignTime: campaignTime.toISOString(),
        message: 'Campaign lost: carrier capability destroyed',
        createdAt: campaignTime.toISOString()
      }
    ]

    const restored = schemas.campaign.campaign.parse(legacy)

    expect(restored.status).toBe('active')
    expect(restored.timeMultiplier).toBe(1)
    expect(restored.logs).toHaveLength(0)
    expect(restored.coalitions.player.navalGroups?.[0]).toMatchObject({
      state: 'operational',
      damage: 0,
      units: [{ state: 'operational', damage: 0 }]
    })
  })
})

describe('applyMissionStateUpdate Germany SAM losses', () => {
  const foundSite = findGermanyIadsSite('BSAM-HAWK-1')
  if (!foundSite) throw new Error('BSAM-HAWK-1 is missing from the Germany IADS network')
  const site = foundSite

  function fuldaCampaign(): Campaign {
    return { ...createCampaign(), scenarioId: 'fulda-gap', era: 'Late CW' }
  }

  function samPosition(
    units: Array<{ name: string }>
  ): NonNullable<MissionState['groupPositions']>['red']['ground'][number] {
    return {
      name: site.id,
      x: site.x,
      y: site.y,
      units: units.map((unit) => ({
        name: unit.name,
        type: 'Hawk ln',
        x: site.x,
        y: site.y
      }))
    }
  }

  test('records a destroyed SAM and leaves an untouched battery alone', () => {
    const updated = applyMissionStateUpdate(
      fuldaCampaign(),
      createMissionState({
        lostUnits: site.units.map((unit) => trackedUnit(unit.name, site.id))
      })
    )

    expect(updated.germanyIadsDeadUnits?.[site.id]).toEqual(site.units.map((unit) => unit.name))
    expect(updated.germanyIadsDeadUnits?.['BSAM-HAWK-10']).toBeUndefined()
    expect(updated.logs.map((entry) => entry.message)).toContain(`SAM ${site.id} destroyed`)
  })

  test('keeps a damaged battery and removes only the vehicles that died', () => {
    const survivor = site.units[0]
    const killed = site.units[1]
    if (!survivor || !killed) throw new Error('SAM site has no vehicles')

    const updated = applyMissionStateUpdate(
      fuldaCampaign(),
      createMissionState({
        groupPositions: {
          blue: { aircraft: [], ground: [], ships: [] },
          red: {
            aircraft: [],
            ground: [samPosition(site.units.filter((unit) => unit.name !== killed.name))],
            ships: []
          }
        }
      })
    )

    expect(updated.germanyIadsDeadUnits?.[site.id]).toEqual([killed.name])
    expect(updated.logs).toHaveLength(0)
  })

  test('records a destroyed search radar even after the bubble put it back', () => {
    const updated = applyMissionStateUpdate(
      fuldaCampaign(),
      createMissionState({
        lostUnits: [trackedUnit('EWR-1-1', 'EWR-1')],
        groupPositions: {
          blue: { aircraft: [], ground: [], ships: [] },
          red: {
            aircraft: [],
            ground: [
              {
                name: 'EWR-1',
                x: 23928,
                y: -455269,
                units: [{ name: 'EWR-1-1', type: '55G6 EWR', x: 23928, y: -455269 }]
              }
            ],
            ships: []
          }
        }
      })
    )

    expect(updated.germanyIadsDeadUnits?.['EWR-1']).toEqual(['EWR-1-1'])
    expect(updated.logs.map((entry) => entry.message)).toContain('EWR EWR-1 destroyed')
  })

  test('does not delete a SAM that was never in the mission', () => {
    const updated = applyMissionStateUpdate(fuldaCampaign(), createMissionState({}))

    expect(updated.germanyIadsDeadUnits).toBeUndefined()
  })

  test('ignores Germany SAM names outside the Germany campaign', () => {
    const updated = applyMissionStateUpdate(
      createCampaign(),
      createMissionState({
        lostUnits: site.units.map((unit) => trackedUnit(unit.name, site.id))
      })
    )

    expect(updated.germanyIadsDeadUnits).toBeUndefined()
  })
})
