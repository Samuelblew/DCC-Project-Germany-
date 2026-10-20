import { schemas } from '@dcc/contracts'
import { produce } from 'immer'
import { describe, expect, test } from 'vitest'
import type * as z from 'zod'

import { rankFor, recordCampaignVictory, recordLogbookSorties } from './logbook'

type Campaign = z.infer<typeof schemas.campaign.campaign>
type MissionState = z.infer<typeof schemas.missionState>
type FlightGroup = Campaign['coalitions']['player']['flightGroups'][number]

const at = new Date('1985-06-15T12:00:00Z')

const group = {
  id: 'uzi',
  callsign: 'Uzi-1',
  task: 'CAP',
  aircrafts: [
    { id: 'a', unitName: 'Uzi-1-1', aircraftName: 'MiG-29A', client: true },
    { id: 'b', unitName: 'Uzi-1-2', aircraftName: 'MiG-29A' }
  ]
} as unknown as FlightGroup

const rating = (value: number) => ({
  at,
  flightGroupId: 'uzi',
  callsign: 'Uzi-1',
  task: 'CAP',
  rating: value,
  reasons: []
})

function state(lostUnits: Array<Record<string, unknown>>): MissionState {
  return { lostUnits } as unknown as MissionState
}

const kill = (name: string, categoryName: string, coalition = 'blue', killer = 'Uzi-1-1') => ({
  name,
  categoryName,
  coalition,
  killerUnitName: killer
})

function campaign(): Campaign {
  return { time: at, logs: [], playerSide: 'red' } as unknown as Campaign
}

describe('logbook', () => {
  test('scores the player aircraft only, by what it destroyed', () => {
    let lines: string[] = []
    const next = produce(campaign(), (draft) => {
      lines = recordLogbookSorties(
        draft,
        [{ group, rating: rating(5) }],
        state([
          kill('Eagle-1-1', 'plane'),
          kill('Eagle-1-2', 'plane'),
          kill('Eagle-1-3', 'plane'),
          kill('Tank-1', 'vehicle'),
          kill('Eagle-2-1', 'plane', 'blue', 'Uzi-1-2'),
          kill('Fulcrum-3-1', 'plane', 'red')
        ])
      )
    })
    const book = next.logbook!
    expect(book.kills).toEqual({ air: 3, ground: 1, static: 0, naval: 0, friendly: 1 })
    // 3 x 10 + 2 - 25 for the kills, +15 for an Excellent sortie.
    expect(book.points).toBe(22)
    expect(book.sorties[0]?.outcome).toBe('returned')
    expect(lines).toContain('Awarded the Medal "For Combat Merit"')
    expect(lines).toContain('Awarded the Order of the Red Star')
  })

  test('ejecting costs points and earns the wound medal; the ace medal comes once', () => {
    let next = produce(campaign(), (draft) => {
      recordLogbookSorties(
        draft,
        [{ group, rating: rating(2) }],
        state([{ name: 'Uzi-1-1', categoryName: 'plane', coalition: 'red', pilotEjected: true }])
      )
    })
    expect(next.logbook?.ejections).toBe(1)
    expect(next.logbook?.sorties[0]?.outcome).toBe('ejected')
    expect(next.logbook?.medals.map((medal) => medal.id)).toEqual(['survivor'])

    for (let sortie = 0; sortie < 2; sortie += 1) {
      next = produce(next, (draft) => {
        recordLogbookSorties(
          draft,
          [{ group, rating: rating(4) }],
          state([kill('A', 'plane'), kill('B', 'plane'), kill('C', 'helicopter')])
        )
      })
    }
    expect(next.logbook?.medals.filter((medal) => medal.id === 'ace')).toHaveLength(1)
  })

  test('ranks follow the points and the player air force', () => {
    expect(rankFor(0, 'eastern').name).toBe('Lieutenant')
    expect(rankFor(320, 'western')).toMatchObject({
      name: 'Captain',
      next: { name: 'Major', points: 800 }
    })
    expect(rankFor(5000, 'western').next).toBeUndefined()
  })

  test('winning the campaign earns its medal once', () => {
    let next = produce(campaign(), (draft) => {
      recordLogbookSorties(draft, [{ group, rating: rating(3) }], state([]))
      draft.status = 'won'
      recordCampaignVictory(draft)
    })
    next = produce(next, (draft) => recordCampaignVictory(draft))
    expect(next.logbook?.medals.filter((medal) => medal.id === 'victory')).toHaveLength(1)
  })
})
