import { schemas } from '@dcc/contracts'
import { produce } from 'immer'
import { describe, expect, test } from 'vitest'
import type * as z from 'zod'

import {
  applyMissionRatings,
  moraleCombatMultiplier,
  rateClientFlight,
  recordCaptureMorale,
  updateCampaignDeadline,
  updateMorale
} from './morale'

type Campaign = z.infer<typeof schemas.campaign.campaign>
type MissionState = z.infer<typeof schemas.missionState>
type FlightGroup = Campaign['coalitions']['player']['flightGroups'][number]

const at = new Date('1985-06-15T12:00:00Z')

function flight(task: string): FlightGroup {
  return {
    id: 'uzi',
    callsign: 'Uzi-1',
    task,
    aircrafts: [
      { id: 'a', unitName: 'Uzi-1-1', aircraftName: 'MiG-29A', client: true },
      { id: 'b', unitName: 'Uzi-1-2', aircraftName: 'MiG-29A' }
    ]
  } as unknown as FlightGroup
}

function state(lostUnits: Array<Record<string, string>>): MissionState {
  return { lostUnits } as unknown as MissionState
}

function campaign(overrides: Partial<Campaign> = {}): Campaign {
  return { time: at, logs: [], scenarioId: 'fulda-gap', ...overrides } as unknown as Campaign
}

describe('mission rating', () => {
  test('a CAP with two kills and everyone home is excellent', () => {
    const rating = rateClientFlight({
      group: flight('CAP'),
      missionState: state([
        { name: 'Eagle-1-1', killerGroupName: 'Uzi-1' },
        { name: 'Eagle-1-2', killerUnitName: 'Uzi-1-2' }
      ]),
      taskCompleted: false,
      at
    })
    expect(rating.rating).toBe(5)
    expect(rating.reasons).toContain('2 kills')
  })

  test('a strike that missed and lost the wingman is poor', () => {
    const rating = rateClientFlight({
      group: flight('Pinpoint Strike'),
      missionState: state([{ name: 'Uzi-1-2' }]),
      taskCompleted: false,
      at
    })
    expect(rating.rating).toBe(2)
    expect(rating.reasons).toEqual(['target not destroyed', '1 aircraft lost'])
  })

  test('the target destroyed counts for ground tasks, not kills', () => {
    const rating = rateClientFlight({
      group: flight('CAS'),
      missionState: state([]),
      taskCompleted: true,
      at
    })
    expect(rating.rating).toBe(5)
  })
})

describe('morale', () => {
  test('ratings move both sides and are kept for the record', () => {
    const next = produce(campaign(), (draft) =>
      applyMissionRatings(draft, [
        { at, flightGroupId: 'uzi', callsign: 'Uzi-1', task: 'CAP', rating: 5, reasons: [] }
      ])
    )
    expect(next.morale).toEqual({ player: 58, opponent: 46 })
    expect(next.missionRatings).toHaveLength(1)
    expect(moraleCombatMultiplier(next, 'player')).toBeCloseTo(1.024)
  })

  test('captures swing morale and it fades back towards even', () => {
    let next = produce(campaign(), (draft) => recordCaptureMorale(draft, 'opponent'))
    expect(next.morale).toEqual({ player: 48, opponent: 52 })

    next = produce(next, (draft) => updateMorale(draft, 30 * 60))
    expect(next.morale).toEqual({ player: 49, opponent: 51 })
    next = produce(next, (draft) => updateMorale(draft, 10 * 3600))
    expect(next.morale).toEqual({ player: 50, opponent: 50 })
  })

  test('neutral morale leaves combat power unchanged', () => {
    expect(moraleCombatMultiplier(campaign(), 'player')).toBe(1)
  })
})

describe('deadline', () => {
  test('Fulda gets thirty days, then the war ends in a stalemate', () => {
    let next = produce(campaign(), (draft) => updateCampaignDeadline(draft))
    expect(next.deadline?.getTime()).toBe(at.getTime() + 30 * 24 * 3_600_000)

    next = produce(next, (draft) => {
      draft.time = new Date(at.getTime() + 31 * 24 * 3_600_000)
      updateCampaignDeadline(draft)
    })
    expect(next.status).toBe('stalemate')
  })

  test('escalation campaigns run on their eras, without a deadline', () => {
    const next = produce(
      campaign({ escalation: { enabled: true } } as Partial<Campaign>),
      (draft) => updateCampaignDeadline(draft)
    )
    expect(next.deadline).toBeUndefined()
  })
})
