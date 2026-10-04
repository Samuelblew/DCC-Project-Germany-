import { F15C_STORES, f15cProfile } from '../aircraft-profiles/f-15c'
import { defineCareerAircraft } from './types'

const S = F15C_STORES

export const f15cCareer = defineCareerAircraft(f15cProfile, {
  prices: {
    new: 165,
    usedRange: [75, 115],
    overhaul: 28,
    repairPerPercent: 0.7
  },
  usedIntegrityRange: [0.6, 0.9],
  usedDefectCount: [0, 0],
  deliveryHours: 72,
  resaleFactor: 0.6,
  weaponPrices: {
    [S.AIM9M]: 3,
    [S.AIM7M]: 4,
    [S.AIM120B]: 7,
    [S.AIM120C]: 8
  },
  startInventory: {
    [S.AIM9M]: 6,
    [S.AIM7M]: 4,
    [S.AIM120B]: 4
  }
})
