import { afterEach, describe, expect, test, vi } from 'vitest'
import { schemas } from '@dcc/contracts'
import type * as z from 'zod'

import { updateFlightGroups } from './update-flight-groups'

type Campaign = z.infer<typeof schemas.campaign.campaign>
type CoalitionData = Campaign['coalitions']['player']
type FlightGroup = CoalitionData['flightGroups'][number]

const campaignTime = new Date('2026-01-01T12:00:00.000Z')

afterEach(() => {
  vi.restoreAllMocks()
})

function createAircraftTypes(): CoalitionData['aircraftTypes'] {
  return Object.fromEntries(
    schemas.task.options.map((task) => [task, [] as string[]])
  ) as CoalitionData['aircraftTypes']
}

function createGroundUnitTypes(): CoalitionData['groundUnitTypes'] {
  return Object.fromEntries(
    schemas.groundUnitType.options.map((type) => [type, [] as string[]])
  ) as CoalitionData['groundUnitTypes']
}

function createCoalition(id: 'player' | 'opponent'): CoalitionData {
  const aircraftTypes = createAircraftTypes()
  aircraftTypes['Strategic Strike'] = ['B-52H']

  return {
    id,
    aircraftTypes,
    groundUnitTypes: createGroundUnitTypes(),
    airdromeNames: ['Home'],
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

function createLandedStrategicStrike(): FlightGroup {
  return {
    id: 'strategic-1',
    aircrafts: [1, 2, 3, 4].map((unitNumber) => ({
      id: `strategic-1-aircraft-${unitNumber}`,
      unitName: `Buff-1-${unitNumber}`,
      aircraftName: 'B-52H'
    })),
    task: 'Strategic Strike',
    position: { x: 0, y: 0 },
    homeBase: 'Home',
    callsign: 'Buff-1',
    flightplan: {
      id: 'strategic-1-plan',
      startTime: new Date('2026-01-01T11:00:00.000Z'),
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
          position: { x: 0, y: 0 },
          altitude: 0,
          speed: 150,
          type: 'Landing'
        }
      ]
    }
  }
}

function createLandedEmitterFlight(task: 'SEAD' | 'DEAD', targetId: string): FlightGroup {
  return {
    ...createLandedStrategicStrike(),
    id: `${task.toLowerCase()}-1`,
    task,
    callsign: `${task}-1`,
    target: {
      id: targetId,
      type: '55G6 EWR',
      objectiveId: 'Gali'
    },
    tot: new Date('2026-01-01T11:30:00.000Z')
  }
}

function createScheduledFlight(params: {
  id: string
  task: FlightGroup['task']
  startTime: Date
  position?: { x: number; y: number }
}): FlightGroup {
  const position = params.position ?? { x: 0, y: 0 }
  return {
    id: params.id,
    aircrafts: [1, 2].map((unitNumber) => ({
      id: `${params.id}-aircraft-${unitNumber}`,
      unitName: `${params.id}-${unitNumber}`,
      aircraftName: 'F-16C_50'
    })),
    task: params.task,
    position,
    homeBase: 'Home',
    callsign: params.id,
    flightplan: {
      id: `${params.id}-plan`,
      startTime: params.startTime,
      waypoints: [
        {
          name: 'TakeOff',
          position,
          altitude: 0,
          speed: 150,
          type: 'TakeOff'
        },
        {
          name: 'Patrol',
          position: { x: position.x + 100_000, y: position.y },
          altitude: 6000,
          speed: 200,
          type: 'Task'
        },
        {
          name: 'Landing',
          position,
          altitude: 0,
          speed: 150,
          type: 'Landing'
        }
      ]
    }
  }
}

describe('updateFlightGroups', () => {
  test('starts a 40-90 minute cooldown when a strategic strike lands', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0)
    const campaign = createCampaign()
    campaign.coalitions.opponent.flightGroups = [createLandedStrategicStrike()]

    updateFlightGroups(campaign, 'opponent')

    expect(campaign.coalitions.opponent.flightGroups).toHaveLength(0)
    expect(campaign.coalitions.opponent.strategicStrikeCooldownUntil).toEqual(
      new Date('2026-01-01T12:40:00.000Z')
    )
  })

  test('DEAD permanently destroys a targeted EWR', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0)
    const campaign = createCampaign()
    campaign.coalitions.opponent.ewrGroups = [
      {
        id: 'ewr-1',
        type: '55G6 EWR',
        objectiveId: 'Gali',
        position: { x: 0, y: 0 }
      }
    ]
    campaign.coalitions.player.flightGroups = [createLandedEmitterFlight('DEAD', 'ewr-1')]

    updateFlightGroups(campaign, 'player')

    expect(campaign.coalitions.opponent.ewrGroups[0]).toMatchObject({
      destroyed: true,
      suppressed: false
    })
  })

  test('SEAD suppression is lifted from an EWR when the flight lands', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0)
    const campaign = createCampaign()
    campaign.coalitions.opponent.ewrGroups = [
      {
        id: 'ewr-1',
        type: '55G6 EWR',
        objectiveId: 'Gali',
        position: { x: 0, y: 0 }
      }
    ]
    campaign.coalitions.player.flightGroups = [createLandedEmitterFlight('SEAD', 'ewr-1')]

    updateFlightGroups(campaign, 'player')

    expect(campaign.coalitions.opponent.ewrGroups[0]?.suppressed).toBe(false)
  })

  test('does not let scheduled CAP engage before takeoff', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0)
    const campaign = createCampaign()
    campaign.coalitions.player.flightGroups = [
      createScheduledFlight({
        id: 'carrier-cap',
        task: 'CAP',
        startTime: new Date('2026-01-01T12:30:00.000Z')
      })
    ]
    campaign.coalitions.opponent.flightGroups = [
      createScheduledFlight({
        id: 'nearby-strike',
        task: 'Pinpoint Strike',
        startTime: new Date('2026-01-01T12:30:00.000Z'),
        position: { x: 40_000, y: 0 }
      })
    ]

    updateFlightGroups(campaign, 'player')

    expect(campaign.coalitions.player.flightGroups[0]?.aircrafts).toHaveLength(2)
    expect(campaign.coalitions.opponent.flightGroups[0]?.aircrafts).toHaveLength(2)
  })

  test('does not let airborne CAP engage aircraft that have not taken off', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0)
    const campaign = createCampaign()
    campaign.coalitions.player.flightGroups = [
      createScheduledFlight({
        id: 'airborne-cap',
        task: 'CAP',
        startTime: new Date('2026-01-01T11:45:00.000Z')
      })
    ]
    campaign.coalitions.opponent.flightGroups = [
      createScheduledFlight({
        id: 'parked-strike',
        task: 'Pinpoint Strike',
        startTime: new Date('2026-01-01T12:30:00.000Z'),
        position: { x: 40_000, y: 0 }
      })
    ]

    updateFlightGroups(campaign, 'player')

    expect(campaign.coalitions.player.flightGroups[0]?.aircrafts).toHaveLength(2)
    expect(campaign.coalitions.opponent.flightGroups[0]?.aircrafts).toHaveLength(2)
  })

  test('applies an antiship strike against a surface group only once across simulation ticks', () => {
    const campaign = createCampaign()
    campaign.coalitions.player.navalGroups = [
      {
        id: 'carrier-group',
        name: 'Carrier Group',
        role: 'surface-combatant',
        unitTypes: ['carrier', 'carrier'],
        units: [
          {
            id: 'carrier-1',
            type: 'carrier',
            damage: 0,
            ammunition: 1,
            fuel: 1,
            state: 'operational'
          },
          {
            id: 'carrier-2',
            type: 'carrier',
            damage: 0,
            ammunition: 1,
            fuel: 1,
            state: 'operational'
          }
        ],
        position: { x: 100_000, y: 0 },
        heading: 0,
        damage: 0,
        fuel: 1,
        ammunition: 1,
        cargo: 0,
        state: 'operational'
      }
    ]

    const strike = createScheduledFlight({
      id: 'antiship-strike',
      task: 'Antiship Strike',
      startTime: new Date('2026-01-01T11:45:00.000Z')
    })
    strike.target = {
      id: 'carrier-group',
      type: 'carrier',
      objectiveId: 'Carrier Group',
      kind: 'naval-group'
    }
    strike.tot = new Date('2026-01-01T11:59:00.000Z')
    campaign.coalitions.opponent.flightGroups = [strike]

    updateFlightGroups(campaign, 'opponent')
    updateFlightGroups(campaign, 'opponent')

    expect(campaign.coalitions.player.navalGroups[0]?.units?.[0]?.state).toBe('sunk')
    expect(campaign.coalitions.player.navalGroups[0]?.units?.[1]?.state).toBe('operational')
    expect(campaign.coalitions.player.navalGroups[0]?.damage).toBe(0.5)
    expect(campaign.coalitions.opponent.flightGroups[0]?.targetDestroyed).toBe(true)
  })

  test('does not damage a carrier targeted by a legacy antiship flight', () => {
    const campaign = createCampaign()
    campaign.coalitions.player.navalGroups = [
      {
        id: 'carrier-group',
        name: 'Carrier Group',
        role: 'carrier',
        unitTypes: ['carrier'],
        units: [
          {
            id: 'carrier-1',
            type: 'carrier',
            damage: 0,
            ammunition: 1,
            fuel: 1,
            state: 'operational'
          }
        ],
        position: { x: 100_000, y: 0 },
        heading: 0,
        damage: 0,
        fuel: 1,
        ammunition: 1,
        cargo: 0,
        state: 'operational'
      }
    ]

    const strike = createScheduledFlight({
      id: 'legacy-carrier-strike',
      task: 'Antiship Strike',
      startTime: new Date('2026-01-01T11:45:00.000Z')
    })
    strike.target = {
      id: 'carrier-group',
      type: 'carrier',
      objectiveId: 'Carrier Group',
      kind: 'naval-group'
    }
    strike.tot = new Date('2026-01-01T11:59:00.000Z')
    campaign.coalitions.opponent.flightGroups = [strike]

    updateFlightGroups(campaign, 'opponent')

    expect(campaign.coalitions.player.navalGroups[0]?.units?.[0]?.state).toBe('operational')
    expect(campaign.coalitions.player.navalGroups[0]?.damage).toBe(0)
    expect(campaign.coalitions.opponent.flightGroups[0]?.targetDestroyed).toBe(true)
  })

  test('CAS destroys enemy ground units at TOT', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0)
    const campaign = createCampaign()
    campaign.coalitions.opponent.groundGroups = [
      {
        id: 'gg-1',
        units: [{ name: 'T-55', count: 8 }],
        position: { x: 5000, y: 0 },
        objectiveId: 'Vacha',
        state: 'combat'
      }
    ]
    const cas = createScheduledFlight({
      id: 'cas-1',
      task: 'CAS',
      startTime: new Date('2026-01-01T11:45:00.000Z')
    })
    cas.target = { id: 'gg-1', type: 'Ground Group', objectiveId: 'Vacha' }
    cas.tot = new Date('2026-01-01T11:59:00.000Z')
    campaign.coalitions.player.flightGroups = [cas]

    updateFlightGroups(campaign, 'player')

    expect(campaign.coalitions.opponent.groundGroups[0]?.units[0]?.count).toBe(4)
    expect(campaign.coalitions.player.flightGroups[0]?.targetDestroyed).toBe(true)
    expect(campaign.logs.some((entry) => entry.message.includes('CAS hit'))).toBe(true)
  })

  test('company air defense drives the CAS flight off', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0)
    const campaign = createCampaign()
    campaign.coalitions.opponent.groundGroups = [
      {
        id: 'gg-1',
        units: [
          { name: 'T-55', count: 6 },
          { name: 'ZSU-23-4 Shilka', count: 2 }
        ],
        position: { x: 5000, y: 0 },
        objectiveId: 'Vacha',
        state: 'combat'
      }
    ]
    const cas = createScheduledFlight({
      id: 'cas-1',
      task: 'CAS',
      startTime: new Date('2026-01-01T11:45:00.000Z')
    })
    cas.target = { id: 'gg-1', type: 'Ground Group', objectiveId: 'Vacha' }
    cas.tot = new Date('2026-01-01T11:59:00.000Z')
    campaign.coalitions.player.flightGroups = [cas]

    updateFlightGroups(campaign, 'player')

    expect(
      campaign.coalitions.opponent.groundGroups[0]?.units.reduce((sum, unit) => sum + unit.count, 0)
    ).toBe(8)
    expect(campaign.logs.some((entry) => entry.message.includes('driven off'))).toBe(true)
  })

  test('CAS does not attack before TOT', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0)
    const campaign = createCampaign()
    campaign.coalitions.opponent.groundGroups = [
      {
        id: 'gg-1',
        units: [{ name: 'T-55', count: 8 }],
        position: { x: 5000, y: 0 },
        objectiveId: 'Vacha',
        state: 'combat'
      }
    ]
    const cas = createScheduledFlight({
      id: 'cas-1',
      task: 'CAS',
      startTime: new Date('2026-01-01T11:45:00.000Z')
    })
    cas.target = { id: 'gg-1', type: 'Ground Group', objectiveId: 'Vacha' }
    cas.tot = new Date('2026-01-01T12:30:00.000Z')
    campaign.coalitions.player.flightGroups = [cas]

    updateFlightGroups(campaign, 'player')

    expect(campaign.coalitions.opponent.groundGroups[0]?.units[0]?.count).toBe(8)
    expect(campaign.coalitions.player.flightGroups[0]?.targetDestroyed).toBeUndefined()
  })

  test('a landed flight waits an hour before that type launches from the same field', () => {
    const campaign = createCampaign()
    campaign.coalitions.player.flightGroups = [createLandedStrategicStrike()]

    updateFlightGroups(campaign, 'player')

    expect(campaign.coalitions.player.flightGroups).toHaveLength(0)
    expect(campaign.coalitions.player.aircraftTurnaroundUntil?.['Home:B-52H']).toBe(
      campaignTime.getTime() + 60 * 60 * 1000
    )
  })
})
