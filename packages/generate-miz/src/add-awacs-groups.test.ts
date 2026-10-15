import { schemas } from '@dcc/contracts'
import { scenarios, theatres } from '@dcc/data'
import { describe, expect, test } from 'vitest'
import * as z from 'zod'

import { addAwacsGroups } from './add-awacs-groups'

type Campaign = z.infer<typeof schemas.campaign.campaign>
type Mission = z.infer<typeof schemas.dcs.mission>

function createMission(): Mission {
  return {
    currentKey: 100,
    coalition: {
      blue: { country: [{ plane: { group: [] } }] },
      red: { country: [{ plane: { group: [] } }] }
    }
  } as unknown as Mission
}

describe('addAwacsGroups', () => {
  test('does not invent AWACS when the faction list is empty', () => {
    const scenario = scenarios.find((candidate) => candidate.id === 'falklands-1982')
    const theatre = theatres.find((candidate) => candidate.name === scenario?.theatreName)
    if (!scenario || !theatre) throw new Error('Falklands scenario data is missing')

    const campaign = {
      scenarioId: scenario.id,
      coalitions: {
        player: {
          airdromeNames: scenario.start.player.airdromeNames,
          aircraftTypes: { AWACS: [] },
          navalGroups: structuredClone(scenario.navalGroups?.player ?? [])
        },
        opponent: {
          airdromeNames: scenario.start.opponent.airdromeNames,
          aircraftTypes: { AWACS: [] },
          navalGroups: structuredClone(scenario.navalGroups?.opponent ?? [])
        }
      }
    } as unknown as Campaign
    const mission = createMission()

    const result = addAwacsGroups(mission, campaign, theatre)

    expect(result.isOk()).toBe(true)
    expect(mission.coalition.blue.country?.[0]?.plane?.group).toEqual([])
    expect(mission.coalition.red.country?.[0]?.plane?.group).toEqual([])
  })

  test('injects faction AWACS when the campaign has not already spawned one', () => {
    const scenario = scenarios.find((candidate) => candidate.id === 'falklands-1982')
    const theatre = theatres.find((candidate) => candidate.name === scenario?.theatreName)
    if (!scenario || !theatre) throw new Error('Falklands scenario data is missing')

    const campaign = {
      scenarioId: scenario.id,
      coalitions: {
        player: {
          airdromeNames: scenario.start.player.airdromeNames,
          aircraftTypes: { AWACS: ['E-3A'] },
          navalGroups: structuredClone(scenario.navalGroups?.player ?? [])
        },
        opponent: {
          airdromeNames: scenario.start.opponent.airdromeNames,
          aircraftTypes: { AWACS: ['A-50'] },
          navalGroups: structuredClone(scenario.navalGroups?.opponent ?? [])
        }
      }
    } as unknown as Campaign
    const mission = createMission()

    const result = addAwacsGroups(mission, campaign, theatre)

    expect(result.isOk()).toBe(true)
    expect(mission.coalition.blue.country?.[0]?.plane?.group[0]).toMatchObject({
      name: 'AWACS-blue',
      task: 'AWACS',
      units: [{ type: 'E-3A' }]
    })
    expect(mission.coalition.red.country?.[0]?.plane?.group[0]).toMatchObject({
      name: 'AWACS-red',
      task: 'AWACS',
      units: [{ type: 'A-50' }]
    })
  })

  test('does not inject a second AWACS when the mission already has one', () => {
    const scenario = scenarios.find((candidate) => candidate.id === 'falklands-1982')
    const theatre = theatres.find((candidate) => candidate.name === scenario?.theatreName)
    if (!scenario || !theatre) throw new Error('Falklands scenario data is missing')

    const campaign = {
      scenarioId: scenario.id,
      coalitions: {
        player: {
          airdromeNames: scenario.start.player.airdromeNames,
          aircraftTypes: { AWACS: ['E-3A'] },
          navalGroups: structuredClone(scenario.navalGroups?.player ?? [])
        },
        opponent: {
          airdromeNames: scenario.start.opponent.airdromeNames,
          aircraftTypes: { AWACS: ['A-50'] },
          navalGroups: structuredClone(scenario.navalGroups?.opponent ?? [])
        }
      }
    } as unknown as Campaign
    const mission = createMission()
    mission.coalition.blue.country![0]!.plane!.group.push({
      name: 'Magic',
      task: 'AWACS',
      units: [{ type: 'E-3A' }]
    } as never)
    mission.coalition.red.country![0]!.plane!.group.push({
      name: 'Mainstay',
      task: 'AWACS',
      units: [{ type: 'A-50' }]
    } as never)

    const result = addAwacsGroups(mission, campaign, theatre)

    expect(result.isOk()).toBe(true)
    expect(mission.coalition.blue.country?.[0]?.plane?.group).toHaveLength(1)
    expect(mission.coalition.red.country?.[0]?.plane?.group).toHaveLength(1)
  })
})
