import { SU27_STORES, su27Profile } from '../aircraft-profiles/su-27'
import { defineCareerAircraft } from './types'

const S = SU27_STORES

export const su27Career = defineCareerAircraft(su27Profile, {
  prices: {
    new: 160,
    usedRange: [75, 115],
    overhaul: 28,
    repairPerPercent: 0.7
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
    [S.S8KOM_TWIN]: 4,
    [S.S8OFP_TWIN]: 4,
    [S.S13]: 3,
    [S.S25]: 3,
    [S.FAB250]: 1,
    [S.FAB500]: 1,
    [S.BETAB500SHP]: 3,
    [S.RBK500]: 3
  },
  startInventory: {
    [S.R73]: 8,
    [S.R27R]: 4,
    [S.R27T]: 2,
    [S.R27ER]: 2,
    [S.FAB250]: 4
  }
})
