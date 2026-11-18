/* eslint-disable @typescript-eslint/no-unsafe-assignment -- asymmetric matchers and mission tasks are untyped */
import { schemas } from '@dcc/contracts'
import { describe, expect, test } from 'vitest'
import * as z from 'zod'

import { buildIadsConfig } from './iads'

type Campaign = z.infer<typeof schemas.campaign.campaign>
type Mission = z.infer<typeof schemas.dcs.mission>

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
        country: [
          {
            id: 0,
            name: 'Russia',
            static: {
              group: [
                {
                  name: 'Static-command-Command Center-101',
                  x: 0,
                  y: 0,
                  units: [
                    {
                      unitId: 1011,
                      name: 'Static-command-Command Center-101-1',
                      x: 0,
                      y: 0,
                      type: 'Comms tower M',
                      heading: 0
                    }
                  ]
                },
                {
                  name: 'Static-power-Power Plant-102',
                  x: 0,
                  y: 0,
                  units: [
                    {
                      unitId: 1021,
                      name: 'Static-power-Power Plant-102-1',
                      x: 0,
                      y: 0,
                      type: 'Electric power box',
                      heading: 0
                    }
                  ]
                },
                {
                  name: 'Static-link-Logistics Hub-103',
                  x: 0,
                  y: 0,
                  units: [
                    {
                      unitId: 1031,
                      name: 'Static-link-Logistics Hub-103-1',
                      x: 0,
                      y: 0,
                      type: 'Comms tower M',
                      heading: 0
                    }
                  ]
                }
              ]
            },
            vehicle: { group: [] }
          }
        ]
      }
    },
    result: { total: 0, offline: {}, blue: {}, red: {} }
  }
}

function createCoalition(id: 'player' | 'opponent'): Campaign['coalitions']['player'] {
  return {
    id,
    aircraftTypes: {} as Campaign['coalitions']['player']['aircraftTypes'],
    groundUnitTypes: {} as Campaign['coalitions']['player']['groundUnitTypes'],
    airdromeNames: [],
    objectiveIds: ['Alpha'],
    structures: [],
    samGroups: [],
    groundGroups: [],
    flightGroups: [],
    packages: []
  }
}

function createCampaign(): Campaign {
  const campaignTime = new Date('2026-01-01T12:00:00.000Z')
  return {
    version: 'test',
    id: 'campaign-1',
    name: 'Campaign',
    createdAt: campaignTime,
    updatedAt: campaignTime,
    time: campaignTime,
    timeMultiplier: 1,
    campaignParams: { iads: true },
    logs: [],
    scenarioId: 'scenario',
    coalitions: {
      player: createCoalition('player'),
      opponent: {
        ...createCoalition('opponent'),
        samGroups: [{ id: 'sam-1', type: 'SA-6', objectiveId: 'Alpha' }],
        ewrGroups: [
          {
            id: 'ewr-alpha-1',
            type: '55G6 EWR',
            objectiveId: 'Alpha',
            position: { x: 1000, y: 2000 }
          }
        ],
        structures: [
          {
            id: 'command',
            type: 'Command Center',
            objectiveId: 'Alpha',
            position: { x: 0, y: 0 },
            name: 'Command',
            resources: 0,
            buildings: []
          },
          {
            id: 'power',
            type: 'Power Plant',
            objectiveId: 'Alpha',
            position: { x: 0, y: 0 },
            name: 'Power',
            resources: 0,
            buildings: []
          },
          {
            id: 'link',
            type: 'Logistics Hub',
            objectiveId: 'Alpha',
            position: { x: 0, y: 0 },
            name: 'Link',
            resources: 0,
            buildings: []
          }
        ]
      }
    }
  }
}

describe('buildIadsConfig', () => {
  test('generates opponent IADS config and EWR groups', () => {
    const mission = createMission()
    const config = buildIadsConfig(mission, createCampaign())

    expect(config).toEqual({
      name: 'DCC-campaign-1-red',
      samPrefix: 'SAM-',
      ewrPrefix: 'IADS-EWR-',
      ewrUnitNames: [],
      alwaysOnSamTypes: [],
      commandCenters: ['Static-command-Command Center-101-1'],
      powerSources: ['Static-power-Power Plant-102-1'],
      connectionNodes: ['Static-link-Logistics Hub-103-1']
    })
    expect(mission.coalition.red.country?.[0]?.vehicle?.group).toHaveLength(1)
    expect(mission.coalition.red.country?.[0]?.vehicle?.group[0]).toMatchObject({
      name: expect.stringMatching(/^IADS-EWR-ewr-alpha-1-/),
      units: [{ name: 'IADS-EWR-Unit-ewr-alpha-1', type: '55G6 EWR', x: 1000, y: 2000 }]
    })
  })

  test('keeps Falklands Hawk sites emitting so they can acquire fast fighters', () => {
    const campaign = createCampaign()
    campaign.scenarioId = 'falklands-1982'
    campaign.coalitions.opponent.samGroups = [{ id: 'hawk-1', type: 'Hawk', objectiveId: 'Alpha' }]

    expect(buildIadsConfig(createMission(), campaign)?.alwaysOnSamTypes).toEqual(['Hawk'])
  })

  test('does not emit IADS when disabled', () => {
    const mission = createMission()
    const campaign = createCampaign()
    campaign.campaignParams = { iads: false }

    expect(buildIadsConfig(mission, campaign)).toBeNull()
    expect(mission.coalition.red.country?.[0]?.vehicle?.group).toHaveLength(0)
  })

  test('keeps persistent EWRs active after all opponent SAMs are gone', () => {
    const mission = createMission()
    const campaign = createCampaign()
    campaign.coalitions.opponent.samGroups = []

    expect(buildIadsConfig(mission, campaign)).not.toBeNull()
    expect(mission.coalition.red.country?.[0]?.vehicle?.group).toHaveLength(1)
  })

  test('does not respawn a destroyed persistent EWR', () => {
    const mission = createMission()
    const campaign = createCampaign()
    campaign.coalitions.opponent.ewrGroups![0]!.destroyed = true

    expect(buildIadsConfig(mission, campaign)).not.toBeNull()
    expect(mission.coalition.red.country?.[0]?.vehicle?.group).toHaveLength(0)
  })

  test('runs Skynet on an authored IADS network that has no generated SAMs or EWRs', () => {
    const campaign = createCampaign()
    campaign.coalitions.opponent.samGroups = []
    campaign.coalitions.opponent.ewrGroups = []

    expect(buildIadsConfig(createMission(), campaign)).toBeNull()
    const config = buildIadsConfig(createMission(), campaign, undefined, {
      commandCenters: ['Command Center-1-1'],
      opponentSamGroups: 3,
      opponentEwrUnitNames: ['EWR-CAU-1-1']
    })
    expect(config?.ewrUnitNames).toEqual(['EWR-CAU-1-1'])
    expect(config?.commandCenters).toContain('Command Center-1-1')
  })

  test('does not emit IADS when every opponent emitter is destroyed', () => {
    const mission = createMission()
    const campaign = createCampaign()
    campaign.coalitions.opponent.samGroups = []
    campaign.coalitions.opponent.ewrGroups![0]!.destroyed = true

    expect(buildIadsConfig(mission, campaign)).toBeNull()
    expect(mission.coalition.red.country?.[0]?.vehicle?.group).toHaveLength(0)
  })
})
