import { describe, expect, test } from 'vitest'

import { isPlanSuppressed, missionPriorityLevel, priorityScore } from './commander-priorities'

const set = {
  priorities: {
    hq: false,
    missions: { oca: 5, strategic: 0, antiship: 1 },
    targets: { airDefense: 4, industry: 1 }
  }
}

describe('commander priorities', () => {
  test('HQ, no priorities set, or the enemy side leave the planner alone', () => {
    const plan = { kind: 'oca', targetType: 'Airbase' }
    expect(priorityScore({ priorities: { ...set.priorities, hq: true } }, 'player', plan)).toBe(0)
    expect(priorityScore({}, 'player', plan)).toBe(0)
    expect(priorityScore(set, 'opponent', plan)).toBe(0)
  })

  test('mission and target levels both weigh the candidate', () => {
    expect(priorityScore(set, 'player', { kind: 'oca', targetType: 'Airbase' })).toBe(24)
    expect(priorityScore(set, 'player', { kind: 'dead', targetType: 'SAM' })).toBe(8)
    expect(priorityScore(set, 'player', { kind: 'strike', targetType: 'Factory' })).toBe(-16)
    // Support flights are always HQ's call.
    expect(priorityScore(set, 'player', { kind: 'awacs', targetType: 'airspace' })).toBe(0)
  })

  test('"never" takes the whole family off the table', () => {
    expect(
      isPlanSuppressed(set, 'player', { kind: 'strategicStrike', targetType: 'Factory' })
    ).toBe(true)
    expect(isPlanSuppressed(set, 'player', { kind: 'cap', targetType: 'airspace' })).toBe(false)
    expect(isPlanSuppressed(set, 'opponent', { kind: 'strategicStrike', targetType: 'x' })).toBe(
      false
    )
  })

  test('anti-shipping level reads straight from the missions', () => {
    expect(missionPriorityLevel(set, 'player', 'antiship')).toBe(1)
    expect(missionPriorityLevel(set, 'player', 'dca')).toBe(3)
  })
})
