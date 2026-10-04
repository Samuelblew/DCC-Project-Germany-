import { describe, expect, test } from 'vitest'
import { schemas } from '@dcc/contracts'
import { scenarios, theatres } from '@dcc/data'
import type * as z from 'zod'

import { activeStore } from './active'

type Campaign = z.infer<typeof schemas.campaign.campaign>
type CoalitionData = Campaign['coalitions']['player']
type FlightGroup = CoalitionData['flightGroups'][number]

const campaignTime = new Date('2026-01-01T12:00:00.000Z')

function createAircraftTypes(): CoalitionData['aircraftTypes'] {
  return {
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
    'Antiship Strike': [],
    'Fighter Sweep': [],
    'Ground Attack': [],
    'Runway Attack': [],
    Transport: [],
    Refueling: [],
    RescueHelo: [],
    AFAC: [],
    CASEVAC: [],
    'Troop Extraction': [],
    Training: []
  }
}

function createGroundUnitTypes(): CoalitionData['groundUnitTypes'] {
  return {
    SAM: [],
    Vehicle: [],
    Infantry: [],
    'Shorad Vehicle': [],
    'Shorad Infantry': [],
    EWS: []
  }
}

function createCoalition(id: 'player' | 'opponent'): CoalitionData {
  return {
    id,
    aircraftTypes: createAircraftTypes(),
    groundUnitTypes: createGroundUnitTypes(),
    airdromeNames: ['Home'],
    objectiveIds: [],
    structures: [],
    samGroups: [],
    groundGroups: [],
    flightGroups: [],
    packages: []
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

function createFlightGroup(params: {
  id: string
  callsign: string
  startTime: string
  tot: string
  task?: FlightGroup['task']
  packageId?: string
}): FlightGroup {
  return {
    id: params.id,
    callsign: params.callsign,
    task: params.task ?? 'CAP',
    homeBase: 'Home',
    position: { x: 0, y: 0 },
    aircrafts: [
      {
        id: `${params.id}-1`,
        unitName: `${params.callsign}-1`,
        aircraftName: 'F-16C_50'
      }
    ],
    flightplan: {
      id: `${params.id}-plan`,
      startTime: new Date(params.startTime),
      waypoints: []
    },
    packageId: params.packageId,
    tot: new Date(params.tot)
  }
}

describe('active store client flight timing sync', () => {
  test('updates a legacy Falklands carrier before the campaign map renders', () => {
    const campaign = createCampaign()
    const scenario = scenarios.find((candidate) => candidate.id === 'falklands-1982')
    expect(scenario).toBeDefined()

    campaign.scenarioId = 'falklands-1982'
    campaign.coalitions.player.navalGroups = structuredClone(scenario?.navalGroups?.player ?? [])
    const carrier = campaign.coalitions.player.navalGroups.find(
      (group) => group.id === 'uk-carrier-group'
    )
    expect(carrier).toBeDefined()
    carrier!.position = { x: 87_402, y: 206_382 }
    carrier!.unitTypes = ['hms_invincible', 'hms_invincible']
    carrier!.units = carrier!.unitTypes.map((type, index) => ({
      id: `uk-carrier-group-ship-${index + 1}`,
      type,
      damage: 0,
      ammunition: 1,
      fuel: 1,
      state: 'operational'
    }))

    activeStore.send({ type: 'loadCampaign', campaign })

    const migratedCarrier = activeStore
      .getSnapshot()
      .context.coalitions.player.navalGroups?.find((group) => group.id === 'uk-carrier-group')
    expect(migratedCarrier?.position).toEqual({ x: 87_610, y: 184_267 })
    expect(migratedCarrier?.unitTypes).toEqual(['LHA_Tarawa'])
    expect(migratedCarrier?.units).toEqual([
      expect.objectContaining({ id: 'uk-carrier-group-ship-1', type: 'LHA_Tarawa' })
    ])
  })

  test('adds persistent EWR state when loading a legacy Falklands campaign', () => {
    const campaign = createCampaign()
    campaign.scenarioId = 'falklands-1982'
    campaign.campaignParams = { iads: true }
    campaign.coalitions.opponent.objectiveIds = ['Stanley Airport', 'Fox Bay']
    campaign.coalitions.opponent.samGroups = [
      { id: 'arg-stanley-hawk', type: 'Hawk', objectiveId: 'Stanley Airport' }
    ]

    activeStore.send({ type: 'loadCampaign', campaign })

    expect(activeStore.getSnapshot().context.coalitions.opponent.ewrGroups).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: '55G6 EWR',
          objectiveId: 'Stanley Airport'
        })
      ])
    )
  })

  test('moves a saved San Carlos FARP inland when loading the campaign', () => {
    const campaign = createCampaign()
    campaign.scenarioId = 'falklands-1982'
    campaign.campaignPhase = 'land-campaign'
    campaign.landingOperation = {
      startedAt: campaignTime,
      completesAt: campaignTime,
      completed: true,
      reservedSiteIds: ['recovery-San Carlos-reserve']
    }
    campaign.coalitions.player.structures = [
      {
        id: 'uk-san-carlos-farp',
        type: 'Farp',
        objectiveId: 'San Carlos',
        position: { x: 99_695, y: 6_383 },
        name: 'San Carlos FARP',
        resources: 0,
        buildings: [{ offset: { x: 0, y: 0 }, type: 'FARP', alive: true }]
      }
    ]
    const flightGroup = createFlightGroup({
      id: 'san-carlos-cas',
      callsign: 'Uzi-1',
      startTime: campaignTime.toISOString(),
      tot: campaignTime.toISOString(),
      task: 'CAS'
    })
    flightGroup.homeBase = 'uk-san-carlos-farp'
    flightGroup.position = { x: 99_695, y: 6_383 }
    flightGroup.flightplan.waypoints = [
      {
        name: 'Take Off',
        position: { x: 99_695, y: 6_383 },
        altitude: 0,
        speed: 0,
        type: 'TakeOff'
      },
      {
        name: 'Landing',
        position: { x: 99_695, y: 6_383 },
        altitude: 0,
        speed: 0,
        type: 'Landing'
      }
    ]
    campaign.coalitions.player.flightGroups = [flightGroup]

    activeStore.send({ type: 'loadCampaign', campaign })

    const loaded = activeStore.getSnapshot().context
    expect(loaded.coalitions.player.structures[0]?.position).toEqual({ x: 99_695, y: 7_883 })
    expect(loaded.coalitions.player.flightGroups[0]?.position).toEqual({ x: 99_695, y: 7_883 })
    expect(loaded.coalitions.player.flightGroups[0]?.flightplan.waypoints).toMatchObject([
      { type: 'TakeOff', position: { x: 99_695, y: 7_883 } },
      { type: 'Landing', position: { x: 99_695, y: 7_883 } }
    ])
  })

  test('repairs saved campaigns that have compatible aircraft but no DEAD task list', () => {
    const campaign = createCampaign()
    campaign.coalitions.player.id = 'usa-1977'
    campaign.coalitions.player.aircraftTypes.SEAD = ['F-4E-45MC']
    campaign.coalitions.player.aircraftTypes['Ground Attack'] = ['F-4E-45MC']
    campaign.coalitions.player.aircraftTypes.DEAD = []

    activeStore.send({ type: 'loadCampaign', campaign })

    expect(activeStore.getSnapshot().context.coalitions.player.aircraftTypes.DEAD).toEqual([
      'F-4E-45MC'
    ])
  })

  test('repairs saved campaigns with AI-only Russian DEAD-capable aircraft', () => {
    const campaign = createCampaign()
    campaign.coalitions.player.id = 'russia-1971'
    campaign.coalitions.player.aircraftTypes.SEAD = ['Su-17M4']
    campaign.coalitions.player.aircraftTypes['Ground Attack'] = ['Su-17M4']
    campaign.coalitions.player.aircraftTypes.DEAD = []

    activeStore.send({ type: 'loadCampaign', campaign })

    expect(activeStore.getSnapshot().context.coalitions.player.aircraftTypes.DEAD).toEqual([
      'Su-17M4'
    ])
  })

  test('shifts ToT and package members when syncing client flight starts', () => {
    const campaign = createCampaign()
    campaign.coalitions.player.flightGroups = [
      createFlightGroup({
        id: 'strike',
        callsign: 'Enfield-1',
        task: 'Pinpoint Strike',
        packageId: 'package-1',
        startTime: '2026-01-01T12:30:00.000Z',
        tot: '2026-01-01T13:00:00.000Z'
      }),
      createFlightGroup({
        id: 'sead',
        callsign: 'Enfield-2',
        task: 'SEAD',
        packageId: 'package-1',
        startTime: '2026-01-01T12:28:00.000Z',
        tot: '2026-01-01T12:58:00.000Z'
      })
    ]
    campaign.coalitions.player.packages = [
      {
        id: 'package-1',
        type: 'SEAD Strike Package',
        targetObjectiveId: 'target-1',
        members: [
          { flightGroupId: 'strike', role: 'primary', totOffset: 0 },
          { flightGroupId: 'sead', role: 'sead', totOffset: -2 * 60 * 1000 }
        ],
        tot: new Date('2026-01-01T13:00:00.000Z'),
        status: 'active'
      }
    ]
    campaign.coalitions.opponent.flightGroups = [
      createFlightGroup({
        id: 'cap',
        callsign: 'Ford-1',
        startTime: '2026-01-01T12:10:00.000Z',
        tot: '2026-01-01T12:40:00.000Z'
      })
    ]

    activeStore.send({ type: 'loadCampaign', campaign })
    activeStore.send({ type: 'setFlightGroupClientCount', flightGroupId: 'cap', count: 1 })
    activeStore.send({ type: 'setFlightGroupClientCount', flightGroupId: 'strike', count: 1 })

    const synced = activeStore.getSnapshot().context
    const strike = synced.coalitions.player.flightGroups.find((group) => group.id === 'strike')!
    const sead = synced.coalitions.player.flightGroups.find((group) => group.id === 'sead')!
    const missionPackage = synced.coalitions.player.packages[0]!

    expect(strike.flightplan.startTime).toEqual(new Date('2026-01-01T12:10:00.000Z'))
    expect(strike.tot).toEqual(new Date('2026-01-01T12:40:00.000Z'))
    expect(sead.flightplan.startTime).toEqual(new Date('2026-01-01T12:08:00.000Z'))
    expect(sead.tot).toEqual(new Date('2026-01-01T12:38:00.000Z'))
    expect(missionPackage.tot).toEqual(new Date('2026-01-01T12:40:00.000Z'))
  })
})

describe('active store aircraft overrides', () => {
  test('adds one Supercarrier when a player selects a conventional carrier aircraft', () => {
    const campaign = createCampaign()
    const scenario = scenarios.find((candidate) => candidate.id === 'falklands-1982')
    expect(scenario).toBeDefined()

    campaign.scenarioId = 'falklands-1982'
    campaign.coalitions.player.navalGroups = structuredClone(scenario?.navalGroups?.player ?? [])
    campaign.coalitions.player.flightGroups = [
      createFlightGroup({
        id: 'carrier-cap',
        callsign: 'Ford-1',
        task: 'CAP',
        startTime: '2026-01-01T12:10:00.000Z',
        tot: '2026-01-01T12:40:00.000Z'
      })
    ]

    activeStore.send({ type: 'loadCampaign', campaign })
    activeStore.send({
      type: 'setFlightGroupAircraftType',
      flightGroupId: 'carrier-cap',
      aircraftType: 'FA-18C_hornet'
    })
    activeStore.send({
      type: 'setFlightGroupAircraftType',
      flightGroupId: 'carrier-cap',
      aircraftType: 'FA-18C_hornet'
    })

    const carrierGroup = activeStore
      .getSnapshot()
      .context.coalitions.player.navalGroups?.find((group) => group.id === 'uk-carrier-group')
    expect(carrierGroup?.unitTypes.filter((unitType) => unitType === 'CVN_71')).toHaveLength(1)
    expect(carrierGroup?.units?.filter((unit) => unit.type === 'CVN_71')).toHaveLength(1)
  })

  test('keeps CAS at the airport when it is closer than a FARP after changing to a helicopter', () => {
    const campaign = createCampaign()
    const caucasus = theatres.find((theatre) => theatre.name === 'Caucasus')!
    const kobuleti = caucasus.airdromeDetails.Kobuleti!
    const farpPosition = { x: kobuleti.x - 40_000, y: kobuleti.y }
    const targetPosition = { x: kobuleti.x + 10_000, y: kobuleti.y }
    campaign.scenarioId = 'red-bullet'
    campaign.coalitions.player.airdromeNames = ['Kobuleti']
    campaign.coalitions.player.structures = [
      {
        id: 'farp-1',
        type: 'Farp',
        objectiveId: 'Home Objective',
        position: farpPosition,
        name: 'Forward FARP',
        resources: 0,
        buildings: []
      }
    ]
    campaign.coalitions.player.flightGroups = [
      {
        id: 'cas-1',
        callsign: 'Hawg-1',
        task: 'CAS',
        homeBase: 'Kobuleti',
        position: { x: kobuleti.x, y: kobuleti.y },
        aircrafts: [
          {
            id: 'cas-1-1',
            unitName: 'Hawg-1-1',
            aircraftName: 'A-10C_2',
            client: true
          }
        ],
        flightplan: {
          id: 'cas-plan',
          startTime: campaignTime,
          waypoints: [
            {
              name: 'TakeOff',
              position: { x: kobuleti.x, y: kobuleti.y },
              altitude: 0,
              speed: 150,
              type: 'TakeOff'
            },
            {
              name: 'Ascend',
              position: { x: kobuleti.x + 20_000, y: kobuleti.y },
              altitude: 2000,
              speed: 200,
              type: 'Nav'
            },
            {
              name: 'Target',
              position: targetPosition,
              altitude: 0,
              speed: 180,
              type: 'Task'
            },
            {
              name: 'Descent',
              position: { x: kobuleti.x - 20_000, y: kobuleti.y },
              altitude: 2000,
              speed: 200,
              type: 'Nav'
            },
            {
              name: 'Landing',
              position: { x: kobuleti.x, y: kobuleti.y },
              altitude: 0,
              speed: 150,
              type: 'Landing'
            }
          ]
        }
      }
    ]

    activeStore.send({ type: 'loadCampaign', campaign })
    activeStore.send({
      type: 'setFlightGroupAircraftType',
      flightGroupId: 'cas-1',
      aircraftType: 'AH-64D_BLK_II'
    })

    const group = activeStore.getSnapshot().context.coalitions.player.flightGroups[0]!
    expect(group.aircrafts[0]?.aircraftName).toBe('AH-64D_BLK_II')
    expect(group.homeBase).toBe('Kobuleti')
    expect(group.position).toEqual({ x: kobuleti.x, y: kobuleti.y })
    expect(group.flightplan.waypoints.some((waypoint) => waypoint.name === 'Ascend')).toBe(false)
    expect(group.flightplan.waypoints.some((waypoint) => waypoint.name === 'Descent')).toBe(false)
  })

  test('moves airbase-based CAS to a FARP when changed to a helicopter', () => {
    const campaign = createCampaign()
    const caucasus = theatres.find((theatre) => theatre.name === 'Caucasus')!
    const kobuleti = caucasus.airdromeDetails.Kobuleti!
    const farpPosition = { x: kobuleti.x + 20_000, y: kobuleti.y }
    const targetPosition = { x: kobuleti.x + 40_000, y: kobuleti.y }
    campaign.scenarioId = 'red-bullet'
    campaign.coalitions.player.airdromeNames = ['Kobuleti']
    campaign.coalitions.player.structures = [
      {
        id: 'farp-1',
        type: 'Farp',
        objectiveId: 'Home Objective',
        position: farpPosition,
        name: 'Forward FARP',
        resources: 0,
        buildings: []
      }
    ]
    campaign.coalitions.player.flightGroups = [
      {
        id: 'cas-1',
        callsign: 'Hawg-1',
        task: 'CAS',
        homeBase: 'Kobuleti',
        position: { x: kobuleti.x, y: kobuleti.y },
        aircrafts: [
          {
            id: 'cas-1-1',
            unitName: 'Hawg-1-1',
            aircraftName: 'A-10C_2',
            client: true
          }
        ],
        flightplan: {
          id: 'cas-plan',
          startTime: campaignTime,
          waypoints: [
            {
              name: 'TakeOff',
              position: { x: kobuleti.x, y: kobuleti.y },
              altitude: 0,
              speed: 150,
              type: 'TakeOff'
            },
            {
              name: 'Ascend',
              position: { x: kobuleti.x + 20_000, y: kobuleti.y },
              altitude: 2000,
              speed: 200,
              type: 'Nav'
            },
            {
              name: 'Contact',
              position: { x: targetPosition.x - 10_000, y: targetPosition.y },
              altitude: 3500,
              speed: 200,
              type: 'Task'
            },
            {
              name: 'Target',
              position: targetPosition,
              altitude: 0,
              speed: 180,
              type: 'Nav'
            },
            {
              name: 'Descent',
              position: { x: kobuleti.x - 20_000, y: kobuleti.y },
              altitude: 2000,
              speed: 200,
              type: 'Nav'
            },
            {
              name: 'Landing',
              position: { x: kobuleti.x, y: kobuleti.y },
              altitude: 0,
              speed: 150,
              type: 'Landing'
            }
          ]
        }
      }
    ]

    activeStore.send({ type: 'loadCampaign', campaign })
    activeStore.send({
      type: 'setFlightGroupAircraftType',
      flightGroupId: 'cas-1',
      aircraftType: 'AH-64D_BLK_II'
    })

    const group = activeStore.getSnapshot().context.coalitions.player.flightGroups[0]!
    expect(group.aircrafts[0]?.aircraftName).toBe('AH-64D_BLK_II')
    expect(group.homeBase).toBe('farp-1')
    expect(group.position).toEqual(farpPosition)
    expect(group.flightplan.waypoints[0]).toMatchObject({
      name: 'TakeOff',
      position: farpPosition
    })
    expect(group.flightplan.waypoints.some((waypoint) => waypoint.name === 'Ascend')).toBe(false)
    expect(group.flightplan.waypoints.some((waypoint) => waypoint.name === 'Descent')).toBe(false)
    expect(group.flightplan.waypoints.at(-1)).toMatchObject({
      name: 'Landing',
      position: farpPosition
    })
  })

  test('moves FARP-based CAS to an airbase when changed to fixed-wing', () => {
    const campaign = createCampaign()
    const caucasus = theatres.find((theatre) => theatre.name === 'Caucasus')!
    const kobuleti = caucasus.airdromeDetails.Kobuleti!
    const farpPosition = { x: kobuleti.x + 20_000, y: kobuleti.y }
    const targetPosition = { x: kobuleti.x + 40_000, y: kobuleti.y }
    campaign.scenarioId = 'red-bullet'
    campaign.coalitions.player.airdromeNames = ['Kobuleti']
    campaign.coalitions.player.structures = [
      {
        id: 'farp-1',
        type: 'Farp',
        objectiveId: 'Home Objective',
        position: farpPosition,
        name: 'Forward FARP',
        resources: 0,
        buildings: []
      }
    ]
    campaign.coalitions.player.flightGroups = [
      {
        id: 'cas-1',
        callsign: 'Uzi-1',
        task: 'CAS',
        homeBase: 'farp-1',
        position: farpPosition,
        aircrafts: [
          {
            id: 'cas-1-1',
            unitName: 'Uzi-1-1',
            aircraftName: 'AH-64D_BLK_II',
            client: true
          }
        ],
        flightplan: {
          id: 'cas-plan',
          startTime: campaignTime,
          waypoints: [
            { name: 'TakeOff', position: farpPosition, altitude: 0, speed: 50, type: 'TakeOff' },
            {
              name: 'Contact',
              position: { x: targetPosition.x - 10_000, y: targetPosition.y },
              altitude: 3500,
              speed: 200,
              type: 'Task'
            },
            {
              name: 'Target',
              position: targetPosition,
              altitude: 0,
              speed: 180,
              type: 'Nav'
            },
            { name: 'Landing', position: farpPosition, altitude: 0, speed: 50, type: 'Landing' }
          ]
        }
      }
    ]

    activeStore.send({ type: 'loadCampaign', campaign })
    activeStore.send({
      type: 'setFlightGroupAircraftType',
      flightGroupId: 'cas-1',
      aircraftType: 'A-10C_2'
    })

    const group = activeStore.getSnapshot().context.coalitions.player.flightGroups[0]!
    expect(group.aircrafts[0]?.aircraftName).toBe('A-10C_2')
    expect(group.homeBase).toBe('Kobuleti')
    expect(group.position).toEqual({ x: kobuleti.x, y: kobuleti.y })
    expect(group.flightplan.waypoints[0]).toMatchObject({
      name: 'TakeOff',
      position: { x: kobuleti.x, y: kobuleti.y }
    })
    expect(group.flightplan.waypoints.some((waypoint) => waypoint.name === 'Ascend')).toBe(true)
    expect(group.flightplan.waypoints.at(-1)).toMatchObject({
      name: 'Landing',
      position: { x: kobuleti.x, y: kobuleti.y }
    })
  })

  test('keeps the helicopter when a FARP-based CAS flight has no reachable airbase', () => {
    const campaign = createCampaign()
    campaign.scenarioId = 'red-bullet'
    campaign.coalitions.player.airdromeNames = []
    campaign.coalitions.player.structures = [
      {
        id: 'farp-1',
        type: 'Farp',
        objectiveId: 'Home Objective',
        position: { x: 0, y: 0 },
        name: 'Forward FARP',
        resources: 0,
        buildings: []
      }
    ]
    campaign.coalitions.player.flightGroups = [
      {
        id: 'cas-1',
        callsign: 'Uzi-1',
        task: 'CAS',
        homeBase: 'farp-1',
        position: { x: 0, y: 0 },
        aircrafts: [
          {
            id: 'cas-1-1',
            unitName: 'Uzi-1-1',
            aircraftName: 'AH-64D_BLK_II',
            client: true
          }
        ],
        flightplan: {
          id: 'cas-plan',
          startTime: campaignTime,
          waypoints: [
            { name: 'TakeOff', position: { x: 0, y: 0 }, altitude: 0, speed: 50, type: 'TakeOff' },
            {
              name: 'Target',
              position: { x: 10_000, y: 0 },
              altitude: 0,
              speed: 180,
              type: 'Task'
            },
            { name: 'Landing', position: { x: 0, y: 0 }, altitude: 0, speed: 50, type: 'Landing' }
          ]
        }
      }
    ]

    activeStore.send({ type: 'loadCampaign', campaign })
    activeStore.send({
      type: 'setFlightGroupAircraftType',
      flightGroupId: 'cas-1',
      aircraftType: 'A-10C_2'
    })

    const group = activeStore.getSnapshot().context.coalitions.player.flightGroups[0]!
    expect(group.aircrafts[0]?.aircraftName).toBe('AH-64D_BLK_II')
    expect(group.homeBase).toBe('farp-1')
  })
})
