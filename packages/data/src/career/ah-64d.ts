import { AH64D_STORES, ah64dProfile } from '../aircraft-profiles/ah-64d'
import { defineCareerAircraft } from './types'

const S = AH64D_STORES

export const ah64dCareer = defineCareerAircraft(ah64dProfile, {
  prices: {
    new: 110,
    usedRange: [50, 82],
    overhaul: 18,
    repairPerPercent: 0.45
  },
  usedIntegrityRange: [0.6, 0.9],
  usedDefectCount: [1, 3],
  deliveryHours: 48,
  resaleFactor: 0.6,
  weaponPrices: {
    [S.AGM114K_4]: 10,
    [S.AGM114L_4]: 12,
    [S.AGM114_2K2L]: 11,
    [S.M261_MK151]: 3,
    [S.M261_M229]: 4,
    [S.M261_OUTBOARD_M257]: 3
  },
  startInventory: {
    [S.AGM114K_4]: 4,
    [S.AGM114L_4]: 2,
    [S.AGM114_2K2L]: 2,
    [S.M261_MK151]: 6,
    [S.M261_M229]: 2,
    [S.M261_OUTBOARD_M257]: 2
  }
})
