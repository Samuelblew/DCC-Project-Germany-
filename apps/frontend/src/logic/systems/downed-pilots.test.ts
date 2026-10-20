import { schemas } from '@dcc/contracts'
import { describe, expect, test } from 'vitest'
import * as z from 'zod'

import { spawnCsar } from './spawn/packages/csar'
import {
  maybeCreateDownedPilotFromAircraftLoss,
  syncDownedPilotsFromMissionState,
  updateDownedPilots
} from './downed-pilots'

type Campaign = z.infer<typeof schemas.campaign.campaign>
type CoalitionData = Campaign['coalitions']['player']
type MissionState = z.infer<typeof schemas.missionState>

const campaignTime = new Date('2026-01-01T12:00:00.000Z')
const maharadze = { x: -316272.09249774, y: 644623.93189239 }
const bataria = { x: -276547.80959707, y: 644490.45286395 }

function createCoalition(id: 'player' | 'opponent'): CoalitionData {
  return {
    id,
    aircraftTypes: { CSAR: ['UH-1H'] } as CoalitionData['aircraftTypes'],
    groundUnitTypes: {} as CoalitionData['groundUnitTypes'],
    airdromeNames: id === 'player' ? ['Kobuleti'] : [],
    objectiveIds: id === 'player' ? ['Maharadze'] : ['Bataria'],
    structures: [],
    samGroups: [],
    groundGroups: [],
    flightGroups: [],
    packages: [],
    downedPilots: []
  }
}

function createCampaign(): Campaign {
  return {
    version: 'test',
    id: 'campaign-1',
    name: 'CSAR Test',
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

function createMissionState(overrides: Partial<MissionState> = {}): MissionState {
  return {
    missionId: 'campaign-1',
    ejectedPilots: [],
    lostUnits: [],
    landedUnits: [],
    cargoDeliveries: {},
    troopExtractions: [],
    casevacPickups: [],
    ...overrides
  }
}

describe('downed pilot lifecycle', () => {
  test('records and deduplicates a friendly pilot down behind enemy lines within FARP range', () => {
    const campaign = createCampaign()
    campaign.coalitions.player.structures.push({
      id: 'farp-1',
      type: 'Farp',
      objectiveId: 'Maharadze',
      position: bataria,
      name: 'Forward FARP',
      resources: 0,
      buildings: []
    })
    const missionState = createMissionState({
      ejectedPilots: [
        { name: 'Pilot 1', coalition: 'blue', time: 12 * 3600 + 60, ...bataria },
        { name: 'Pilot 2', coalition: 'blue', time: 12 * 3600 + 90, ...maharadze }
      ]
    })

    syncDownedPilotsFromMissionState(campaign, missionState, campaignTime)
    syncDownedPilotsFromMissionState(campaign, missionState, campaignTime)

    expect(campaign.coalitions.player.downedPilots).toHaveLength(1)
    expect(campaign.coalitions.player.downedPilots?.[0]).toMatchObject({
      name: 'Pilot 1',
      position: bataria
    })
  })

  test('removes a pilot reported as rescued by the flown mission', () => {
    const campaign = createCampaign()
    campaign.coalitions.player.downedPilots = [
      { id: 'pilot-1', name: 'Pilot 1', position: maharadze, ejectedAt: campaignTime }
    ]

    syncDownedPilotsFromMissionState(
      campaign,
      createMissionState({ rescuedPilots: [{ pilotId: 'pilot-1', groupName: 'Springfield-1' }] }),
      campaignTime
    )

    expect(campaign.coalitions.player.downedPilots).toEqual([])
    expect(campaign.logs.at(-1)?.message).toBe('Springfield-1 rescued Pilot 1')
  })

  test('records an aircraft crash survivor reported by the flown mission', () => {
    const campaign = createCampaign()
    campaign.coalitions.player.structures.push({
      id: 'farp-1',
      type: 'Farp',
      objectiveId: 'Maharadze',
      position: bataria,
      name: 'Forward FARP',
      resources: 0,
      buildings: []
    })

    syncDownedPilotsFromMissionState(
      campaign,
      createMissionState({
        lostUnits: [
          {
            name: 'Enfield-1-1',
            type: 'F-16C_50',
            coalition: 'blue',
            categoryName: 'plane',
            event: 'crash',
            crashed: true,
            pilotSurvivedCrash: true,
            time: 12 * 3600 + 60,
            ...bataria
          }
        ]
      }),
      campaignTime
    )

    expect(campaign.coalitions.player.downedPilots).toHaveLength(1)
    expect(campaign.coalitions.player.downedPilots?.[0]).toMatchObject({
      name: 'Enfield-1-1',
      position: bataria
    })
  })

  test('gives simulated aircraft losses a 50 percent survival chance', () => {
    const campaign = createCampaign()
    campaign.coalitions.player.structures.push({
      id: 'farp-1',
      type: 'Farp',
      objectiveId: 'Maharadze',
      position: bataria,
      name: 'Forward FARP',
      resources: 0,
      buildings: []
    })

    expect(
      maybeCreateDownedPilotFromAircraftLoss(
        campaign,
        'player',
        { name: 'Enfield-1-1', position: bataria },
        () => 0.499
      )
    ).toBe(true)
    expect(
      maybeCreateDownedPilotFromAircraftLoss(
        campaign,
        'player',
        { name: 'Enfield-1-2', position: bataria },
        () => 0.5
      )
    ).toBe(false)
    expect(campaign.coalitions.player.downedPilots).toHaveLength(1)
  })

  test('spawns one-helicopter CSAR package and resolves it at pickup time', () => {
    const campaign = createCampaign()
    campaign.coalitions.player.downedPilots = [
      { id: 'pilot-1', name: 'Pilot 1', position: maharadze, ejectedAt: campaignTime }
    ]

    spawnCsar(campaign, 'player')

    const group = campaign.coalitions.player.flightGroups[0]
    expect(group).toMatchObject({
      task: 'CSAR',
      homeBase: 'Kobuleti',
      target: { id: 'pilot-1', type: 'Downed Pilot' }
    })
    expect(group?.aircrafts).toHaveLength(1)
    expect(campaign.coalitions.player.packages[0]).toMatchObject({
      type: 'CSAR Package',
      status: 'active'
    })

    campaign.time = group!.tot!
    updateDownedPilots(campaign, 'player')

    expect(campaign.coalitions.player.downedPilots).toEqual([])
    expect(campaign.logs.at(-1)?.message).toContain('rescued Pilot 1')
  })

  test('expires pilots after one hour without rescue', () => {
    const campaign = createCampaign()
    campaign.coalitions.player.downedPilots = [
      { id: 'pilot-1', name: 'Pilot 1', position: maharadze, ejectedAt: campaignTime }
    ]
    campaign.time = new Date(campaignTime.getTime() + 60 * 60 * 1000 + 1)

    updateDownedPilots(campaign, 'player')

    expect(campaign.coalitions.player.downedPilots).toEqual([])
  })
})
