import { schemas } from '@dcc/contracts'
import { produce } from 'immer'
import { describe, expect, test } from 'vitest'
import type * as z from 'zod'

import { isEnemyKnown, updateIntel } from './intel'

type Campaign = z.infer<typeof schemas.campaign.campaign>

const at = new Date('1985-06-15T12:00:00Z')
const hours = (count: number) => new Date(at.getTime() + count * 3_600_000)

function side(groundGroups: unknown[], flightGroups: unknown[] = []) {
  return {
    airdromeNames: [],
    objectiveIds: [],
    structures: [],
    samGroups: [],
    groundGroups,
    flightGroups,
    packages: []
  }
}

const group = (id: string, x: number) => ({
  id,
  position: { x, y: 0 },
  units: [{ name: 'T-72B', count: 4 }]
})

const flight = (id: string, x: number, task = 'CAP') => ({
  id,
  task,
  position: { x, y: 0 },
  flightplan: { startTime: hours(-24) }
})

function campaign(player: unknown, opponent: unknown): Campaign {
  return {
    scenarioId: 'red-bullet',
    time: at,
    campaignParams: { ewr: false },
    coalitions: { player, opponent }
  } as unknown as Campaign
}

describe('fog of war', () => {
  test('troops see the enemy in front of them, not the reserves behind', () => {
    const next = produce(
      campaign(side([group('ours', 0)]), side([group('near', 5_000), group('far', 50_000)])),
      (draft) => updateIntel(draft, 'player')
    )
    expect(Object.keys(next.coalitions.player.intel ?? {})).toEqual(['near'])
    expect(isEnemyKnown(next, 'player', 'near')).toBe(true)
    expect(isEnemyKnown(next, 'player', 'far')).toBe(false)
  })

  test('a sighting keeps its last position, goes stale for targeting, then fades', () => {
    let next = produce(campaign(side([group('ours', 0)]), side([group('near', 5_000)])), (draft) =>
      updateIntel(draft, 'player')
    )
    const tick = (time: Date) => {
      next = produce(next, (draft) => {
        draft.time = time
        draft.coalitions.opponent.groundGroups[0]!.position = { x: 40_000, y: 0 }
        updateIntel(draft, 'player')
      })
    }

    tick(hours(2))
    expect(next.coalitions.player.intel?.near?.position).toEqual({ x: 5_000, y: 0 })
    expect(isEnemyKnown(next, 'player', 'near')).toBe(true)

    tick(hours(4))
    expect(isEnemyKnown(next, 'player', 'near')).toBe(false)
    expect(next.coalitions.player.intel?.near).toBeDefined()

    tick(hours(13))
    expect(next.coalitions.player.intel?.near).toBeUndefined()
  })

  test('aircraft are radar tracks: seen while in range, gone once out of it', () => {
    let next = produce(
      campaign(side([], [flight('cap', 0)]), side([], [flight('bandit', 30_000)])),
      (draft) => updateIntel(draft, 'player')
    )
    expect(next.coalitions.player.intel?.bandit?.kind).toBe('air')

    next = produce(next, (draft) => {
      draft.coalitions.opponent.flightGroups[0]!.position = { x: 100_000, y: 0 }
      updateIntel(draft, 'player')
    })
    expect(next.coalitions.player.intel?.bandit).toBeUndefined()
  })

  test('reveal enemy turns the fog off', () => {
    const base = campaign(side([]), side([group('far', 50_000)]))
    const next = produce(base, (draft) => {
      draft.campaignParams = { ...draft.campaignParams, fogOfWar: false }
      updateIntel(draft, 'player')
    })
    expect(next.coalitions.player.intel).toBeUndefined()
    expect(isEnemyKnown(next, 'player', 'far')).toBe(true)
  })
})
