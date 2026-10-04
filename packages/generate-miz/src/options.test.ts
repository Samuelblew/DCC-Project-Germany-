import { describe, expect, test } from 'vitest'

import { options } from './options'

describe('mission gameplay options', () => {
  test('cheats stay off unless the campaign asks for them', () => {
    const difficulty = options().difficulty
    expect(difficulty?.weapons).toBe(false)
    expect(difficulty?.fuel).toBe(false)
    expect(difficulty?.immortal).toBe(false)
    expect(difficulty?.labels).toBe(0)
  })

  test('campaign ACE flags write the DCS difficulty table', () => {
    const difficulty = options({
      campaignParams: {
        dcsCheats: {
          unlimitedWeapons: true,
          unlimitedFuel: true,
          immortal: true,
          labels: 'abbreviated',
          miniHud: true,
          radioAssist: true,
          unrestrictedSatnav: true
        }
      }
    } as Parameters<typeof options>[0]).difficulty

    expect(difficulty).toMatchObject({
      weapons: true,
      fuel: true,
      immortal: true,
      labels: 2,
      miniHUD: true,
      radio: true,
      unrestrictedSATNAV: true
    })
  })
})
