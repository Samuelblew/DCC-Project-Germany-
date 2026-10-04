import { schemas } from '@dcc/contracts'
import { describe, expect, test } from 'vitest'
import * as z from 'zod'

import { resolveAiSkill } from './ai-skill'

type Campaign = z.infer<typeof schemas.campaign.campaign>

function campaignWith(enemySkill?: NonNullable<Campaign['campaignParams']>['enemySkill']) {
  return { campaignParams: { enemySkill } } as Campaign
}

describe('resolveAiSkill', () => {
  test('keeps the unit default when no enemy skill is set', () => {
    expect(resolveAiSkill(campaignWith(), 'opponent', 'Excellent')).toBe('Excellent')
  })

  test('overrides every enemy unit, including Random', () => {
    expect(resolveAiSkill(campaignWith('Average'), 'opponent', 'High')).toBe('Average')
    expect(resolveAiSkill(campaignWith('Random'), 'opponent', 'Excellent')).toBe('Random')
  })

  test('never touches the player coalition', () => {
    expect(resolveAiSkill(campaignWith('Average'), 'player', 'High')).toBe('High')
  })
})
