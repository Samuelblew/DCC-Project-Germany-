import { schemas } from '@dcc/contracts'
import { produce } from 'immer'
import { describe, expect, test } from 'vitest'
import type * as z from 'zod'

import {
  availableAirframes,
  ensureAirframes,
  hasAirframes,
  recordAirframeLoss,
  updateAirframes
} from './air-order-of-battle'

type Campaign = z.infer<typeof schemas.campaign.campaign>

function campaign(flying = 0): Campaign {
  return {
    coalitions: {
      player: {
        aircraftTypes: { CAP: ['MiG-29A'], Transport: ['Mi-8MT'] },
        flightGroups: [
          {
            id: 'cap',
            aircrafts: Array.from({ length: flying }, (_, index) => ({
              id: `a${index}`,
              unitName: `Uzi-1-${index + 1}`,
              aircraftName: 'MiG-29A'
            }))
          }
        ]
      },
      opponent: { aircraftTypes: {}, flightGroups: [] }
    }
  } as unknown as Campaign
}

describe('air order of battle', () => {
  test('each type starts as a full squadron; helicopter units are smaller', () => {
    const next = produce(campaign(), (draft) => {
      ensureAirframes(draft, 'player')
    })
    expect(next.coalitions.player.airframes?.['MiG-29A']).toMatchObject({ total: 24, capacity: 24 })
    expect(next.coalitions.player.airframes?.['Mi-8MT']?.capacity).toBe(12)
  })

  test('aircraft out flying are not on the ground for a new tasking', () => {
    const next = produce(campaign(23), (draft) => {
      ensureAirframes(draft, 'player')
    })
    expect(availableAirframes(next, 'player', 'MiG-29A')).toBe(1)
    expect(hasAirframes(next, 'player', 'MiG-29A', 2)).toBe(false)
    expect(hasAirframes(next, 'player', 'MiG-29A', 1)).toBe(true)
  })

  test('losses stay lost; replacements trickle back at 15% a day up to the squadron size', () => {
    let next = produce(campaign(), (draft) => {
      ensureAirframes(draft, 'player')
      for (let index = 0; index < 10; index += 1) {
        recordAirframeLoss(draft, 'player', { aircraftName: 'MiG-29A' })
      }
    })
    expect(next.coalitions.player.airframes?.['MiG-29A']).toMatchObject({ total: 14, lost: 10 })

    // One day: 24 x 15% = 3.6 airframes.
    next = produce(next, (draft) => updateAirframes(draft, 'player', 24 * 3600))
    expect(next.coalitions.player.airframes?.['MiG-29A']?.total).toBe(17)

    next = produce(next, (draft) => updateAirframes(draft, 'player', 30 * 24 * 3600))
    expect(next.coalitions.player.airframes?.['MiG-29A']?.total).toBe(24)
  })

  test('career airframes are not part of the coalition stock', () => {
    const next = produce(campaign(), (draft) => {
      ensureAirframes(draft, 'player')
      recordAirframeLoss(draft, 'player', { aircraftName: 'MiG-29A', careerAirframeId: 'mine' })
    })
    expect(next.coalitions.player.airframes?.['MiG-29A']?.lost).toBe(0)
  })
})
