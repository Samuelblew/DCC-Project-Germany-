import { SU25T_STORES, su25tProfile } from '../aircraft-profiles/su-25t'
import { defineCareerAircraft } from './types'

const S = SU25T_STORES

export const su25tCareer = defineCareerAircraft(su25tProfile, {
  prices: {
    new: 115,
    usedRange: [50, 80],
    overhaul: 20,
    repairPerPercent: 0.5
  },
  usedIntegrityRange: [0.6, 0.9],
  usedDefectCount: [0, 0],
  deliveryHours: 60,
  resaleFactor: 0.6,
  weaponPrices: {
    [S.R60M]: 2,
    [S.R73]: 3,
    [S.VIKHR]: 10,
    [S.KH25ML]: 6,
    [S.KH25MPU]: 7,
    [S.KH29L]: 8,
    [S.KH29T]: 9,
    [S.KH58]: 10,
    [S.KAB500KR]: 7,
    [S.S8KOM]: 2,
    [S.S13]: 3,
    [S.S25]: 3,
    [S.S25L]: 5,
    [S.FAB250]: 1,
    [S.FAB500]: 1,
    [S.BETAB500SHP]: 3,
    [S.RBK250]: 2,
    [S.RBK500AO]: 3
  },
  startInventory: {
    [S.R73]: 4,
    [S.VIKHR]: 2,
    [S.KH25ML]: 4,
    [S.KH25MPU]: 2,
    [S.S8KOM]: 4,
    [S.FAB500]: 6
  }
})
