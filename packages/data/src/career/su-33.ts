import { SU33_STORES, su33Profile } from '../aircraft-profiles/su-33'
import { defineCareerAircraft } from './types'

const S = SU33_STORES

export const su33Career = defineCareerAircraft(su33Profile, {
  prices: {
    new: 170,
    usedRange: [80, 120],
    overhaul: 30,
    repairPerPercent: 0.75
  },
  usedIntegrityRange: [0.6, 0.9],
  usedDefectCount: [0, 0],
  deliveryHours: 72,
  resaleFactor: 0.6,
  weaponPrices: {
    [S.R73]: 3,
    [S.R27R]: 4,
    [S.R27T]: 4,
    [S.R27ER]: 6,
    [S.R27ET]: 7,
    [S.S8KOM]: 2,
    [S.S13]: 3,
    [S.S25]: 3,
    [S.FAB250]: 1,
    [S.FAB500]: 1,
    [S.BETAB500]: 2,
    [S.RBK250]: 2,
    [S.RBK500AO]: 3
  },
  startInventory: {
    [S.R73]: 8,
    [S.R27R]: 4,
    [S.R27ER]: 2,
    [S.FAB250]: 4
  }
})
