import { describe, expect, test } from 'vitest'
import { schemas } from '@dcc/contracts'
import type * as z from 'zod'

import { applyLiveSortie } from './live-sortie'

type Campaign = z.infer<typeof schemas.campaign.campaign>
type CoalitionData = Campaign['coalitions']['player']
type FlightGroup = CoalitionData['flightGroups'][number]
type MissionState = z.infer<typeof schemas.missionState>

const campaignTime = new Date('2026-01-01T12:00:00.000Z')

function createCoalition(id: 'player' | 'opponent'): CoalitionData {
  const aircraftTypes = Object.fromEntries(
    schemas.task.options.map((task) => [task, [] as string[]])
  ) as CoalitionData['aircraftTypes']
  aircraftTypes.CAP = ['F-16C_50']

  const groundUnitTypes = Object.fromEntries(
    schemas.groundUnitType.options.map((type) => [type, [] as string[]])
  ) as CoalitionData['groundUnitTypes']

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
    timeMultiplier: 300,
    logs: [],
    scenarioId: 'red-bullet',
    coalitions: {
      player: createCoalition('player'),
      opponent: createCoalition('opponent')
    }
  }
}

function landedFlight(id: string, callsign: string): FlightGroup {
  const startTime = new Date(campaignTime.getTime() - 30 * 60 * 1000)
  return {
    id,
    aircrafts: [
      {
        id: `${id}-aircraft-1`,
        unitName: `${callsign}-1`,
        aircraftName: 'F-16C_50'
      }
    ],
    task: 'CAP',
    position: { x: 0, y: 0 },
    homeBase: 'Kobuleti',
    callsign,
    flightplan: {
      id: `${id}-flightplan`,
      startTime,
      waypoints: [
        { name: 'TakeOff', position: { x: 0, y: 0 }, altitude: 0, speed: 150, type: 'TakeOff' },
        { name: 'Landing', position: { x: 0, y: 0 }, altitude: 0, speed: 150, type: 'Landing' }
      ]
    }
  }
}

function missionState(overrides: Partial<MissionState> = {}): MissionState {
  return {
    missionId: 'campaign-1',
    time: 12 * 3600 + 45,
    ejectedPilots: [],
    troopExtractions: [],
    casevacPickups: [],
    lostUnits: [],
    landedUnits: [],
    cargoDeliveries: {},
    groupPositions: {
      blue: { aircraft: [], ground: [], ships: [] },
      red: { aircraft: [], ground: [], ships: [] }
    },
    ...overrides
  }
}

describe('applyLiveSortie', () => {
  test('follows DCS time at 1x and keeps the in-mission flight', () => {
    const campaign = createCampaign()
    campaign.coalitions.player.flightGroups = [
      landedFlight('in-dcs', 'Enfield-1'),
      landedFlight('on-map', 'Dodge-1')
    ]
    campaign.coalitions.player.groundGroups = [
      {
        id: 'column-1',
        objectiveId: 'column-1-objective',
        position: { x: 10, y: 10 },
        state: 'idle',
        units: [{ name: 'M-1 Abrams', count: 2 }]
      }
    ]

    const updated = applyLiveSortie(
      campaign,
      missionState({
        groupPositions: {
          blue: {
            aircraft: [
              {
                name: 'Enfield-1',
                x: 400,
                y: 500,
                units: [{ name: 'Enfield-1-1', type: 'F-16C_50', x: 400, y: 500, inAir: true }]
              }
            ],
            ground: [
              {
                name: 'Ground-column-1-1',
                x: 80,
                y: 90,
                units: [{ name: 'GroundUnit-column-1-a', type: 'M-1 Abrams', x: 80, y: 90 }]
              }
            ],
            ships: []
          },
          red: { aircraft: [], ground: [], ships: [] }
        }
      })
    )

    expect(updated.timeMultiplier).toBe(0)
    expect(updated.time).toEqual(new Date('2026-01-01T12:00:45.000Z'))
    expect(updated.coalitions.player.flightGroups.map((group) => group.callsign)).toEqual([
      'Enfield-1'
    ])
    expect(updated.coalitions.player.flightGroups[0]?.position).toEqual({ x: 400, y: 500 })
    expect(updated.coalitions.player.flightGroups[0]?.aircrafts).toHaveLength(1)
    expect(updated.coalitions.player.groundGroups[0]?.position).toEqual({ x: 80, y: 90 })
    expect(updated.coalitions.player.groundGroups[0]?.units).toEqual([
      { name: 'M-1 Abrams', count: 2 }
    ])
  })

  test('remembers a destroyed search radar while the sortie clock is already caught up', () => {
    const campaign = createCampaign()
    campaign.scenarioId = 'fulda-gap'
    campaign.timeMultiplier = 0

    const updated = applyLiveSortie(
      campaign,
      missionState({
        time: 12 * 3600,
        lostUnits: [
          {
            name: 'EWR-1-1',
            groupName: 'EWR-1',
            type: '55G6 EWR',
            x: 23928,
            y: -455269
          }
        ]
      })
    )

    expect(updated.germanyIadsDeadUnits?.['EWR-1']).toEqual(['EWR-1-1'])
    expect(updated.timeMultiplier).toBe(0)
  })

  test('does not treat a state file from another campaign as a live sortie', () => {
    const campaign = createCampaign()
    const updated = applyLiveSortie(campaign, missionState({ missionId: 'other' }))
    expect(updated).toBe(campaign)
  })
})
