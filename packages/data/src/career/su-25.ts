import { SU25_STORES, su25Profile } from '../aircraft-profiles/su-25'
import { defineCareerAircraft } from './types'

const S = SU25_STORES

export const su25Career = defineCareerAircraft(su25Profile, {
  prices: {
    new: 90,
    usedRange: [40, 65],
    overhaul: 16,
    repairPerPercent: 0.4
  },
  usedIntegrityRange: [0.6, 0.9],
  usedDefectCount: [0, 0],
  deliveryHours: 48,
  resaleFactor: 0.6,
  weaponPrices: {
    [S.R60M]: 2,
    [S.S8KOM]: 2,
    [S.S8OFP]: 2,
    [S.S13]: 3,
    [S.S25]: 3,
    [S.S25L]: 5,
    [S.KH25ML]: 6,
    [S.KH29L]: 8,
    [S.FAB250]: 1,
    [S.FAB500]: 1,
    [S.BETAB500]: 2,
    [S.BETAB500SHP]: 3,
    [S.RBK250]: 2,
    [S.RBK500AO]: 3
  },
  startInventory: {
    [S.R60M]: 4,
    [S.S8KOM]: 8,
    [S.FAB250]: 8,
    [S.RBK250]: 4,
    [S.KH25ML]: 2
  }
})
