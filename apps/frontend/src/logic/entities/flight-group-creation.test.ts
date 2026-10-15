import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { schemas, config } from '@dcc/contracts'
import type * as z from 'zod'

import { CapFlightGroup } from './cap-flight-group'
import { DeadFlightGroup } from './dead-flight-group'
import { FlightGroup } from './flight-group'
import {
  buildCasMissionWaypoints,
  buildStrikeMissionWaypoints,
  spawnPlannedFlightGroup
} from './flight-group-spawn'
import { SeadFlightGroup } from './sead-flight-group'
import { StrikeFlightGroup } from './strike-flight-group'
import { TransportFlightGroup } from './transport-flight-group'

type Campaign = z.infer<typeof schemas.campaign.campaign>
type FlightGroupData = z.infer<typeof schemas.flightGroup>

const campaignTime = new Date('2026-01-01T12:00:00.000Z')
const homeBasePosition = { x: 0, y: 0 }
const targetPosition = { x: 100_000, y: 0 }
const patrolCenter = { x: 80_000, y: 40_000 }
const target = {
  id: 'target-1',
  type: 'Ammo Depot',
  objectiveId: 'objective-1'
}

function createSupply(current = 1_000) {
  return {
    current,
    max: 2_000,
    consumptionRate: 0,
    productionRate: 0,
    status: 'adequate' as const
  }
}

function createCoalition(id: 'player' | 'opponent'): Campaign['coalitions']['player'] {
  return {
    id,
    aircraftTypes: {
      CAP: ['F-16C_50'],
      'Pinpoint Strike': ['F-16C_50'],
      'Strategic Strike': ['B-52H'],
      SEAD: ['F-16C_50'],
      DEAD: ['F-16C_50'],
      CAS: ['F-16C_50'],
      Transport: ['UH-60L']
    } as Campaign['coalitions']['player']['aircraftTypes'],
    groundUnitTypes: {} as Campaign['coalitions']['player']['groundUnitTypes'],
    airdromeNames: ['Home'],
    objectiveIds: ['objective-1'],
    structures: [],
    samGroups: [],
    groundGroups: [],
    flightGroups: [],
    packages: [],
    supplyNodes: {
      Home: createSupply(),
      'objective-1': createSupply()
    }
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
    scenarioId: 'scenario-1',
    coalitions: {
      player: createCoalition('player'),
      opponent: createCoalition('opponent')
    }
  }
}

function getCreatedFlightGroup(campaign: Campaign, id: string): FlightGroupData {
  const group = campaign.coalitions.player.flightGroups.find((fg) => fg.id === id)
  expect(group).toBeDefined()
  return group!
}

function expectStrikeFixedWingPlan(group: FlightGroupData) {
  expect(group.flightplan.waypoints.map((wp) => wp.name)).toEqual([
    'TakeOff',
    'Ascend',
    'IP',
    'Attack',
    'Target',
    'Egress',
    'Descent',
    'Landing'
  ])
  expect(group.flightplan.waypoints[0]?.type).toBe('TakeOff')
  expect(group.flightplan.waypoints.at(-1)?.type).toBe('Landing')
  expect(group.tot).toBeInstanceOf(Date)
}

beforeEach(() => {
  vi.spyOn(Math, 'random').mockReturnValue(0)
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('CAP flight group creation', () => {
  test('creates a CAP group with racetrack flightplan waypoints', () => {
    const campaign = createCampaign()

    const result = CapFlightGroup.spawn(campaign, 'player', {
      homeBase: 'Home',
      homeBasePosition,
      patrolCenter,
      aircraftType: 'F-16C_50'
    })

    const group = getCreatedFlightGroup(campaign, result.flightGroupId)
    expect(group.task).toBe('CAP')
    expect(group.aircrafts).toHaveLength(config.packages.CAP.aircraftsPerGroup)
    expect(group.flightplan.startTime).toEqual(new Date('2026-01-01T12:10:00.000Z'))
    expect(group.flightplan.waypoints.map((wp) => wp.name)).toEqual([
      'TakeOff',
      'Ascend',
      'Patrol Entry',
      'Racetrack Start',
      'Racetrack End',
      'Descent',
      'Landing'
    ])
    expect(group.flightplan.waypoints[2]?.type).toBe('Nav')
    expect(group.flightplan.waypoints[3]?.type).toBe('Task')
    expect(group.flightplan.waypoints[4]?.type).toBe('RaceTrack End')
  })
})

describe('Pinpoint Strike flight group creation', () => {
  test('creates a strike group with objective-level target waypoint when exact target is disabled', () => {
    const campaign = createCampaign()

    const result = StrikeFlightGroup.spawn(campaign, 'player', {
      homeBase: 'Home',
      homeBasePosition,
      target: {
        ...target,
        position: targetPosition,
        buildings: [{ offset: { x: 500, y: -250 }, type: 'Tech hangar A', alive: true }]
      },
      targetPosition,
      aircraftType: 'F-16C_50',
      packageId: 'package-1',
      exactTarget: false
    })

    const group = getCreatedFlightGroup(campaign, result.flightGroupId)
    expect(group.task).toBe('Pinpoint Strike')
    expect(group.target).toEqual(target)
    expect(group.packageId).toBe('package-1')
    expect(group.aircrafts).toHaveLength(config.packages['Pinpoint Strike'].aircraftsPerGroup)
    expectStrikeFixedWingPlan(group)
    expect(group.flightplan.waypoints.find((wp) => wp.name === 'Attack')).toMatchObject({
      altitude: 6000,
      altitudeType: 'BARO',
      type: 'Task'
    })
    expect(group.flightplan.waypoints.find((wp) => wp.name === 'Target')).toMatchObject({
      position: targetPosition,
      altitude: 0,
      altitudeType: 'RADIO',
      type: 'Nav'
    })
    expect(group.flightplan.waypoints.find((wp) => wp.name === 'Egress')?.position).not.toEqual(
      group.flightplan.waypoints.find((wp) => wp.name === 'IP')?.position
    )
    expect(group.flightplan.waypoints.find((wp) => wp.name === 'Egress')?.position).not.toEqual(
      group.flightplan.waypoints.find((wp) => wp.name === 'Target')?.position
    )
  })

  test('places strike target waypoint on the first building when exact target is enabled', () => {
    const campaign = createCampaign()

    const result = StrikeFlightGroup.spawn(campaign, 'player', {
      homeBase: 'Home',
      homeBasePosition,
      target: {
        ...target,
        position: targetPosition,
        buildings: [{ offset: { x: 500, y: -250 }, type: 'Tech hangar A', alive: true }]
      },
      targetPosition,
      aircraftType: 'F-16C_50',
      exactTarget: true
    })

    const group = getCreatedFlightGroup(campaign, result.flightGroupId)
    expect(group.flightplan.waypoints.find((wp) => wp.name === 'Target')).toMatchObject({
      position: { x: 100_500, y: -250 },
      altitude: 0,
      altitudeType: 'RADIO',
      type: 'Nav'
    })
  })
})

describe('Strategic Strike flight group creation', () => {
  test('creates a strategic strike group with one to four bombers and strike waypoints', () => {
    const campaign = createCampaign()

    vi.mocked(Math.random).mockReturnValue(0)
    const result = StrikeFlightGroup.spawn(campaign, 'player', {
      homeBase: 'Home',
      homeBasePosition,
      target,
      targetPosition,
      aircraftType: 'B-52H',
      task: 'Strategic Strike'
    })

    const group = getCreatedFlightGroup(campaign, result.flightGroupId)
    expect(group.task).toBe('Strategic Strike')
    expect(group.aircrafts).toHaveLength(config.packages['Strategic Strike'].minAircraftsPerGroup)
    expect(group.aircrafts[0]?.aircraftName).toBe('B-52H')
    expectStrikeFixedWingPlan(group)
  })

  test('caps strategic strike groups at four bombers', () => {
    const campaign = createCampaign()

    vi.mocked(Math.random).mockReturnValue(0.999)
    const result = StrikeFlightGroup.spawn(campaign, 'player', {
      homeBase: 'Home',
      homeBasePosition,
      target,
      targetPosition,
      aircraftType: 'B-52H',
      task: 'Strategic Strike'
    })

    const group = getCreatedFlightGroup(campaign, result.flightGroupId)
    expect(group.aircrafts).toHaveLength(config.packages['Strategic Strike'].maxAircraftsPerGroup)
  })
})

describe('SEAD flight group creation', () => {
  test('creates a SEAD group aligned to the requested ToT', () => {
    const campaign = createCampaign()
    const desiredTot = new Date('2026-01-01T13:00:00.000Z')

    const flightGroupId = SeadFlightGroup.spawn(campaign, 'player', {
      homeBase: 'Home',
      homeBasePosition,
      target: { ...target, type: 'SA-10' },
      targetPosition,
      aircraftType: 'F-16C_50',
      tot: desiredTot,
      packageId: 'package-1'
    })

    const group = getCreatedFlightGroup(campaign, flightGroupId)
    expect(group.task).toBe('SEAD')
    expect(group.target).toEqual({ ...target, type: 'SA-10' })
    expect(group.packageId).toBe('package-1')
    expect(group.tot).toEqual(desiredTot)
    expect(group.aircrafts).toHaveLength(config.packages.SEAD.aircraftsPerGroup)
    expect(group.flightplan.waypoints.map((wp) => wp.name)).toEqual([
      'TakeOff',
      'Ascend',
      'Ingress',
      'Suppress',
      'Emitter',
      'Egress',
      'Descent',
      'Landing'
    ])
    expect(group.flightplan.waypoints.find((wp) => wp.name === 'Suppress')).toMatchObject({
      altitude: 7500,
      altitudeType: 'BARO',
      type: 'Task'
    })
  })
})

describe('DEAD flight group creation', () => {
  test('creates a DEAD group with SAM target metadata and attack flightplan', () => {
    const campaign = createCampaign()

    const result = DeadFlightGroup.spawn(campaign, 'player', {
      homeBase: 'Home',
      homeBasePosition,
      target: { ...target, type: 'SA-6' },
      targetPosition,
      aircraftType: 'F-16C_50'
    })

    const group = getCreatedFlightGroup(campaign, result.flightGroupId)
    expect(group.task).toBe('DEAD')
    expect(group.target).toEqual({ ...target, type: 'SA-6' })
    expect(group.aircrafts).toHaveLength(config.packages.DEAD.aircraftsPerGroup)
    expect(group.flightplan.waypoints.map((wp) => wp.name)).toEqual([
      'TakeOff',
      'Ascend',
      'IP',
      'Emitter',
      'Egress',
      'Descent',
      'Landing'
    ])
    expect(group.flightplan.waypoints.find((wp) => wp.name === 'Emitter')).toMatchObject({
      altitude: 0,
      altitudeType: 'RADIO',
      type: 'Task'
    })
  })
})

describe('CAS flight group creation', () => {
  test('creates a CAS group with the attack task on the target waypoint', () => {
    const campaign = createCampaign()
    const missionWaypoints = buildCasMissionWaypoints(homeBasePosition, targetPosition)

    const result = spawnPlannedFlightGroup({
      draft: campaign,
      coalition: 'player',
      task: 'CAS',
      aircraftType: 'F-16C_50',
      aircraftCount: config.packages.CAS.aircraftsPerGroup,
      homeBase: 'Home',
      homeBasePosition,
      destination: targetPosition,
      missionWaypoints,
      startTime: new Date('2026-01-01T12:30:00.000Z'),
      target: { ...target, type: 'Ground Group' }
    })

    const group = getCreatedFlightGroup(campaign, result.flightGroupId)
    expect(group.task).toBe('CAS')
    expect(group.target).toEqual({ ...target, type: 'Ground Group' })
    expect(group.aircrafts).toHaveLength(config.packages.CAS.aircraftsPerGroup)
    expect(group.flightplan.waypoints.map((wp) => wp.name)).toEqual([
      'TakeOff',
      'Ascend',
      'Contact',
      'Target',
      'Hold',
      'Egress',
      'Descent',
      'Landing'
    ])
    expect(group.flightplan.waypoints.find((wp) => wp.name === 'Contact')).toMatchObject({
      type: 'Nav',
      altitudeType: 'BARO'
    })
    expect(group.flightplan.waypoints.find((wp) => wp.name === 'Target')).toMatchObject({
      type: 'Task',
      altitude: 1500,
      altitudeType: 'BARO'
    })
    expect(group.tot).toBeInstanceOf(Date)
  })
})

describe('Transport flight group creation', () => {
  test('creates a transport group with cargo metadata and direct low-level flightplan', () => {
    const campaign = createCampaign()

    const result = TransportFlightGroup.spawn(campaign, 'player', {
      homeBase: 'Home',
      homeBasePosition,
      destinationPosition: targetPosition,
      sourceNode: 'Home',
      destinationNode: 'objective-1',
      aircraftType: 'UH-60L',
      cargoAmount: 250,
      transportType: 'tactical'
    })

    const group = getCreatedFlightGroup(campaign, result.flightGroupId)
    expect(group.task).toBe('Transport')
    expect(group.aircrafts).toHaveLength(config.packages.Transport.aircraftsPerGroup)
    expect(group.cargoAmount).toBe(250)
    expect(group.sourceNode).toBe('Home')
    expect(group.destinationNode).toBe('objective-1')
    expect(group.cargoStatus).toBe('loaded')
    expect(group.transportType).toBe('tactical')
    expect(campaign.coalitions.player.supplyNodes?.Home?.current).toBe(750)
    expect(group.flightplan.waypoints.map((wp) => wp.name)).toEqual([
      'TakeOff',
      'Direct',
      'Landing'
    ])
    expect(group.flightplan.waypoints[1]).toMatchObject({
      altitude: 300,
      speed: 100,
      type: 'Nav'
    })
  })
})

describe('Generic flight group creation', () => {
  test('stores the supplied flightplan, aircraft, home base, and calculated ToT', () => {
    const campaign = createCampaign()
    const flightplan = FlightGroup.createFlightPlan(
      homeBasePosition,
      targetPosition,
      [
        {
          name: 'Target',
          position: targetPosition,
          altitude: 6000,
          speed: 250,
          type: 'Task'
        }
      ],
      new Date('2026-01-01T12:45:00.000Z')
    )

    const flightGroupId = FlightGroup.create(campaign, 'player', {
      aircrafts: [
        {
          id: 'aircraft-1',
          unitName: 'F-16C_50 1',
          aircraftName: 'F-16C_50'
        }
      ],
      task: 'Ground Attack',
      position: homeBasePosition,
      homeBase: 'Home',
      flightplan
    })

    const group = getCreatedFlightGroup(campaign, flightGroupId)
    expect(group.task).toBe('Ground Attack')
    expect(group.homeBase).toBe('Home')
    expect(group.flightplan).toBe(flightplan)
    expect(group.tot).toEqual(FlightGroup.calculateTot(flightplan))
  })
})

describe('Strike mission waypoint builder', () => {
  test('keeps the aimpoint as a flyable attack waypoint and offsets egress', () => {
    const aimpointPosition = { x: 100_500, y: -250 }
    const waypoints = buildStrikeMissionWaypoints(
      homeBasePosition,
      targetPosition,
      aimpointPosition
    )

    expect(waypoints.map((wp) => wp.name)).toEqual(['IP', 'Attack', 'Target', 'Egress'])
    expect(waypoints[1]).toMatchObject({
      altitude: 6000,
      altitudeType: 'BARO',
      type: 'Task'
    })
    expect(waypoints[2]).toMatchObject({
      position: aimpointPosition,
      altitude: 0,
      altitudeType: 'RADIO',
      type: 'Nav'
    })
    expect(waypoints[3]?.position).not.toEqual(waypoints[0]?.position)
    expect(waypoints[3]?.position).not.toEqual(targetPosition)
  })
})
