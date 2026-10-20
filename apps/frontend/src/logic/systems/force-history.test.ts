import { schemas } from '@dcc/contracts'
import { produce } from 'immer'
import { describe, expect, test } from 'vitest'
import type * as z from 'zod'

import { updateForceHistory } from './force-history'

type Campaign = z.infer<typeof schemas.campaign.campaign>

const at = new Date('1985-06-15T12:00:00Z')

function side(units: number, airframes: number, towns: string[]) {
  return {
    airdromeNames: [],
    objectiveIds: towns,
    samGroups: [],
    groundGroups: [{ id: 'g', position: { x: 0, y: 0 }, units: [{ name: 'T-72B', count: units }] }],
    flightGroups: [],
    airframes: { 'MiG-29A': { total: airframes, capacity: 24, lost: 0, reinforcement: 0 } }
  }
}

function campaign(): Campaign {
  return {
    scenarioId: 'red-bullet',
    time: at,
    morale: { player: 58, opponent: 46 },
    coalitions: { player: side(12, 20, ['A', 'B']), opponent: side(30, 24, ['C']) }
  } as unknown as Campaign
}

describe('force history', () => {
  test('samples both sides every six hours', () => {
    let next = produce(campaign(), (draft) => updateForceHistory(draft))
    expect(next.forceHistory).toHaveLength(1)
    expect(next.forceHistory?.[0]?.player).toEqual({
      ground: 12,
      air: 20,
      territory: 2,
      airDefense: 0,
      morale: 58
    })
    expect(next.forceHistory?.[0]?.opponent.ground).toBe(30)

    const advance = (hours: number) => {
      next = produce(next, (draft) => {
        draft.time = new Date(at.getTime() + hours * 3_600_000)
        updateForceHistory(draft)
      })
    }
    advance(5)
    expect(next.forceHistory).toHaveLength(1)
    advance(6)
    expect(next.forceHistory).toHaveLength(2)
  })
})
