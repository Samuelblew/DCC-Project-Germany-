import { scenarios } from '@dcc/data'
import { describe, expect, test } from 'vitest'

import { mirrorScenarioSides } from './mirror-scenario-sides'

const fulda = scenarios.find((scenario) => scenario.id === 'fulda-gap')
if (!fulda) throw new Error('fulda-gap scenario is missing')
const FuldaGap = fulda

describe('mirrorScenarioSides', () => {
  const red = mirrorScenarioSides(FuldaGap)

  test('gives the player the Warsaw Pact territory and bases', () => {
    expect(red.start.player).toBe(FuldaGap.start.opponent)
    expect(red.start.opponent).toBe(FuldaGap.start.player)
    expect(red.start.player?.airdromeNames).toContain('Tegel')
    expect(red.start.opponent?.airdromeNames).toContain('Ramstein')
  })

  test('swaps the default factions', () => {
    expect(red.defaultFactionIds).toEqual({ player: 'russia-1984', opponent: 'usa-1977' })
  })

  test('uses the red side goal and briefing', () => {
    expect(red.goal).toEqual({ coalition: 'player', objectiveIds: ['Frankfurt'] })
    expect(red.briefing).toBe(FuldaGap.opponentBriefing)
  })

  test('falls back to a mirrored defeat condition when the scenario has no red goal', () => {
    const mirrored = mirrorScenarioSides({ ...FuldaGap, opponentGoal: undefined })
    expect(mirrored.goal).toEqual({ coalition: 'opponent', objectiveIds: ['Leipzig Mockau'] })
  })
})
