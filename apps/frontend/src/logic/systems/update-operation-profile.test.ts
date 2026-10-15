import { describe, expect, test } from 'vitest'
import { schemas } from '@dcc/contracts'
import {
  coalitionOperationProfile,
  createInitialEscalation,
  initialOperationProfile,
  theatres
} from '@dcc/data'
import type * as z from 'zod'

import { updateOperationProfile } from './update-operation-profile'

type Campaign = z.infer<typeof schemas.campaign.campaign>
type CoalitionData = Campaign['coalitions']['player']

const germany = theatres.find((theatre) => theatre.name === 'Cold War Germany')!
const start = new Date('1985-06-15T09:00:00.000Z')

function coalition(id: 'player' | 'opponent', objectiveIds: string[]): CoalitionData {
  return {
    id,
    aircraftTypes: {} as CoalitionData['aircraftTypes'],
    groundUnitTypes: {} as CoalitionData['groundUnitTypes'],
    airdromeNames: [],
    objectiveIds,
    structures: [],
    samGroups: [],
    groundGroups: [],
    flightGroups: [],
    packages: []
  }
}

function campaign(overrides: Partial<Campaign> = {}): Campaign {
  return {
    version: 'test',
    id: 'posture',
    name: 'Posture',
    createdAt: start,
    updatedAt: start,
    time: start,
    era: 'Late CW',
    timeMultiplier: 1,
    logs: [],
    scenarioId: 'fulda-gap',
    coalitions: {
      player: coalition('player', ['Geisa', 'Hunfeld', 'Hanau']),
      opponent: coalition('opponent', ['Vacha', 'Eisenach', 'Gotha'])
    },
    ...overrides
  }
}

describe('commander posture', () => {
  test('Germany Late CW starts linear and cautious-to-standard, not a random front', () => {
    expect(
      initialOperationProfile({ theatreName: 'Cold War Germany', era: 'Late CW' })
    ).toMatchObject({
      archetype: 'balanced',
      frontlineShape: 'linear',
      tempo: 'standard',
      initiativeCoalition: 'opponent'
    })
  })

  test('Escalation starts Korea-cautious even on the Fulda Late CW scenario', () => {
    expect(
      initialOperationProfile({
        theatreName: 'Cold War Germany',
        era: 'Late CW',
        escalation: true
      })
    ).toMatchObject({ tempo: 'cautious', frontlineShape: 'linear' })
  })

  test('the hop graph is present on Cold War Germany', () => {
    expect(germany.connections?.some((connection) => connection.from === 'Geisa')).toBe(true)
  })

  test('a stalemate keeps two-sided posture; Korea stays cautious', () => {
    const state = campaign({
      era: 'Korea',
      escalation: createInitialEscalation(start, 8)
    })
    updateOperationProfile(state)
    expect(state.operationProfile).toMatchObject({
      archetype: 'balanced',
      tempo: 'cautious',
      frontlineShape: 'linear',
      initiativeCoalition: 'opponent'
    })
    expect(coalitionOperationProfile(state, 'opponent').archetype).toBe('breakthrough')
    expect(coalitionOperationProfile(state, 'player').archetype).toBe('defense-crisis')
  })

  test('the side that holds more hop towns has initiative', () => {
    const state = campaign({
      coalitions: {
        player: coalition('player', ['Geisa', 'Vacha', 'Eisenach', 'Gotha', 'Hanau', 'Hunfeld']),
        opponent: coalition('opponent', ['Weimar'])
      }
    })
    updateOperationProfile(state)
    expect(state.operationProfile?.initiativeCoalition).toBe('player')
    expect(state.operationProfile?.tempo).toBe('standard')
    expect(state.operationProfile?.archetype).toBe('balanced')
    expect(coalitionOperationProfile(state, 'player').archetype).toBe('breakthrough')
    expect(coalitionOperationProfile(state, 'opponent').archetype).toBe('defense-crisis')
  })

  test('a late-war blowout becomes air-superiority for the leader', () => {
    const state = campaign({
      era: 'Late CW',
      coalitions: {
        player: coalition('player', [
          'Geisa',
          'Hunfeld',
          'Hanau',
          'Vacha',
          'Eisenach',
          'Gotha',
          'Erfurt',
          'Weimar'
        ]),
        opponent: coalition('opponent', ['Apolda'])
      }
    })
    updateOperationProfile(state)
    expect(state.operationProfile?.archetype).toBe('air-superiority')
    expect(coalitionOperationProfile(state, 'player').archetype).toBe('air-superiority')
    expect(coalitionOperationProfile(state, 'opponent').archetype).toBe('defense-crisis')
  })

  test('Korea never awards air-superiority even on a lopsided graph', () => {
    const state = campaign({
      era: 'Korea',
      escalation: createInitialEscalation(start, 8),
      coalitions: {
        player: coalition('player', [
          'Geisa',
          'Hunfeld',
          'Hanau',
          'Vacha',
          'Eisenach',
          'Gotha',
          'Erfurt',
          'Weimar'
        ]),
        opponent: coalition('opponent', ['Apolda'])
      }
    })
    updateOperationProfile(state)
    expect(state.operationProfile?.archetype).toBe('balanced')
    expect(coalitionOperationProfile(state, 'player').archetype).toBe('breakthrough')
  })
})
