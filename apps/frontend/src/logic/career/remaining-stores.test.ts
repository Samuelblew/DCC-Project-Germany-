import { AH64D_STORES, getCareerAircraft } from '@dcc/data'
import { describe, expect, test } from 'vitest'

import { countRemainingStores } from './career'

const apache = getCareerAircraft('AH-64D_BLK_II')

describe('stores left after a sortie', () => {
  test('a 4K rack and a 2K+2L rack do not both claim the same Hellfires', () => {
    // Fired 4 of 8 K and none of the 2 L: one full 4K-or-mixed rack worth is gone.
    const remaining = countRemainingStores(
      apache,
      { [AH64D_STORES.AGM114K_4]: 1, [AH64D_STORES.AGM114_2K2L]: 1 },
      [
        { typeName: 'weapons.missiles.AGM_114K', displayName: 'AGM-114K', count: 2 },
        { typeName: 'weapons.missiles.AGM_114L', displayName: 'AGM-114L', count: 2 }
      ]
    )
    // 4 rounds left: the pure 4K rack is empty, the mixed rack still holds its 2K+2L.
    expect(remaining).toEqual({ [AH64D_STORES.AGM114K_4]: 0, [AH64D_STORES.AGM114_2K2L]: 1 })
  })

  test('a full load is counted once per store', () => {
    const remaining = countRemainingStores(
      apache,
      { [AH64D_STORES.AGM114K_4]: 1, [AH64D_STORES.AGM114_2K2L]: 1 },
      [
        { typeName: 'weapons.missiles.AGM_114K', displayName: 'AGM-114K', count: 6 },
        { typeName: 'weapons.missiles.AGM_114L', displayName: 'AGM-114L', count: 2 }
      ]
    )
    expect(remaining).toEqual({ [AH64D_STORES.AGM114K_4]: 1, [AH64D_STORES.AGM114_2K2L]: 1 })
  })
})
