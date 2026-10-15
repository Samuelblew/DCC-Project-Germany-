import { describe, expect, test } from 'vitest'
import { factions, scenarios } from '@dcc/data'

import { getCampaignYearForFactions, getScenarioCampaignDefaults, factionIdsForEra } from './start-campaign-options'

describe('getScenarioCampaignDefaults', () => {
  test('selects the Falklands-era UK and Argentine factions for the Falklands campaign', () => {
    const scenario = scenarios.find((candidate) => candidate.id === 'falklands-1982')

    expect(getScenarioCampaignDefaults(scenario)).toEqual({
      era: 'Late CW',
      playerFactionId: 'uk-1982',
      opponentFactionId: 'argentina-1982-official'
    })
  })

  test('falls back to the scenario era defaults when no scenario factions are specified', () => {
    const scenario = scenarios.find((candidate) => candidate.id === 'red-bullet')

    expect(getScenarioCampaignDefaults(scenario)).toEqual({
      era: 'Modern',
      playerFactionId: 'usa-2004',
      opponentFactionId: 'russia-1996'
    })
  })

  test('Fulda Late CW keeps USAFE 1977 and GSFG 1984', () => {
    const scenario = scenarios.find((candidate) => candidate.id === 'fulda-gap')
    expect(getScenarioCampaignDefaults(scenario)).toEqual({
      era: 'Late CW',
      playerFactionId: 'usa-1977',
      opponentFactionId: 'russia-1984'
    })
  })
})

describe('factionIdsForEra', () => {
  test('Germany uses the Escalation USAFE/GSFG ladder, not Korean War leftovers', () => {
    expect(factionIdsForEra('Korea', 'Cold War Germany')).toEqual({
      player: 'usa-germany-1955',
      opponent: 'russia-germany-1955'
    })
    expect(factionIdsForEra('Late CW', 'Cold War Germany')).toEqual({
      player: 'usa-1977',
      opponent: 'russia-1984'
    })
  })

  test('other theatres keep their era pairings', () => {
    expect(factionIdsForEra('Korea')).toEqual({
      player: 'usa-1952',
      opponent: 'russia-1955'
    })
    expect(factionIdsForEra('Late CW')).toEqual({
      player: 'usa-1977',
      opponent: 'russia-1971'
    })
  })
})

describe('getCampaignYearForFactions', () => {
  test('uses the newer year from the selected faction pairing', () => {
    expect(getCampaignYearForFactions(factions, 'usa-2004', 'russia-1996', 1982)).toBe(2004)
  })

  test('falls back to the scenario year when neither faction defines a year', () => {
    expect(getCampaignYearForFactions([], 'custom-player', 'custom-opponent', 1982)).toBe(1982)
  })
})
