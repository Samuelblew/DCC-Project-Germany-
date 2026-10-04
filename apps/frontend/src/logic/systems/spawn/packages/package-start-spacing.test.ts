import { describe, expect, test } from 'vitest'
import { schemas } from '@dcc/contracts'
import type * as z from 'zod'

import { enforcePackageStartSpacing } from './package-start-spacing'

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
  task?: FlightGroup['task']
  startTime: string
  homeBase?: string
  packageId?: string
  client?: boolean
  tot?: string
}): FlightGroup {
  return {
    id: params.id,
    callsign: params.callsign,
    task: params.task ?? 'CAP',
    homeBase: params.homeBase ?? 'Home',
    position: { x: 0, y: 0 },
    aircrafts: [
      {
        id: `${params.id}-1`,
        unitName: `${params.callsign}-1`,
        aircraftName: 'F-16C_50',
        client: params.client
      }
    ],
    flightplan: {
      id: `${params.id}-plan`,
      startTime: new Date(params.startTime),
      waypoints: []
    },
    packageId: params.packageId,
    tot: params.tot ? new Date(params.tot) : undefined
  }
}

describe('package start spacing', () => {
  test('keeps packages from the same airport at least ten minutes apart', () => {
    const campaign = createCampaign()
    campaign.coalitions.player.flightGroups = [
      createFlightGroup({
        id: 'strike-1',
        callsign: 'Enfield-1',
        startTime: '2026-01-01T12:10:00.000Z',
        packageId: 'package-1',
        tot: '2026-01-01T12:30:00.000Z'
      }),
      createFlightGroup({
        id: 'sead-1',
        callsign: 'Enfield-2',
        task: 'SEAD',
        startTime: '2026-01-01T12:11:00.000Z',
        packageId: 'package-1',
        tot: '2026-01-01T12:28:00.000Z'
      }),
      createFlightGroup({
        id: 'cas-1',
        callsign: 'Ford-1',
        startTime: '2026-01-01T12:15:00.000Z',
        tot: '2026-01-01T12:45:00.000Z'
      })
    ]

    enforcePackageStartSpacing(campaign, 'player')

    expect(campaign.coalitions.player.flightGroups[0]!.flightplan.startTime).toEqual(
      new Date('2026-01-01T12:13:00.000Z')
    )
    expect(campaign.coalitions.player.flightGroups[1]!.flightplan.startTime).toEqual(
      new Date('2026-01-01T12:11:00.000Z')
    )
    expect(campaign.coalitions.player.flightGroups[2]!.flightplan.startTime).toEqual(
      new Date('2026-01-01T12:23:00.000Z')
    )
    expect(campaign.coalitions.player.flightGroups[2]!.tot).toEqual(
      new Date('2026-01-01T12:53:00.000Z')
    )
  })

  test('does not move client groups while using them as spacing blockers', () => {
    const campaign = createCampaign()
    campaign.coalitions.player.flightGroups = [
      createFlightGroup({
        id: 'cap-1',
        callsign: 'Enfield-1',
        startTime: '2026-01-01T12:10:00.000Z'
      }),
      createFlightGroup({
        id: 'client-1',
        callsign: 'Ford-1',
        startTime: '2026-01-01T12:15:00.000Z',
        client: true
      }),
      createFlightGroup({
        id: 'cas-1',
        callsign: 'Dodge-1',
        startTime: '2026-01-01T12:18:00.000Z'
      })
    ]

    enforcePackageStartSpacing(campaign, 'player')

    expect(campaign.coalitions.player.flightGroups[1]!.flightplan.startTime).toEqual(
      new Date('2026-01-01T12:15:00.000Z')
    )
    expect(campaign.coalitions.player.flightGroups[2]!.flightplan.startTime).toEqual(
      new Date('2026-01-01T12:25:00.000Z')
    )
  })

  test('starts SEAD escort before the primary package flight', () => {
    const campaign = createCampaign()
    campaign.coalitions.player.flightGroups = [
      createFlightGroup({
        id: 'strike-1',
        callsign: 'Enfield-1',
        task: 'Pinpoint Strike',
        startTime: '2026-01-01T12:10:00.000Z',
        packageId: 'package-1'
      }),
      createFlightGroup({
        id: 'sead-1',
        callsign: 'Enfield-2',
        task: 'SEAD',
        startTime: '2026-01-01T12:15:00.000Z',
        packageId: 'package-1'
      })
    ]

    enforcePackageStartSpacing(campaign, 'player')

    expect(campaign.coalitions.player.flightGroups[1]!.flightplan.startTime).toEqual(
      new Date('2026-01-01T12:15:00.000Z')
    )
    expect(campaign.coalitions.player.flightGroups[0]!.flightplan.startTime).toEqual(
      new Date('2026-01-01T12:17:00.000Z')
    )
  })
})
