import { F16C_STORES, f16cProfile } from '../aircraft-profiles/f-16c'
import { defineCareerAircraft } from './types'

const S = F16C_STORES

export const f16cCareer = defineCareerAircraft(f16cProfile, {
  prices: {
    new: 145,
    usedRange: [65, 105],
    overhaul: 24,
    repairPerPercent: 0.6
  },
  usedIntegrityRange: [0.6, 0.9],
  usedDefectCount: [1, 3],
  deliveryHours: 60,
  resaleFactor: 0.6,
  weaponPrices: {
    [S.AIM9M]: 3,
    [S.AIM9X]: 4,
    [S.AIM120B]: 7,
    [S.AIM120C]: 8,
    [S.AGM88C]: 10,
    [S.AGM65D]: 5,
    [S.AGM65K]: 6,
    [S.GBU12]: 4,
    [S.GBU10]: 5,
    [S.GBU31]: 6,
    [S.MK84]: 2,
    [S.CBU87]: 2,
    [S.MK82_TER]: 3,
    [S.HYDRA]: 3
  },
  startInventory: {
    [S.AIM9X]: 6,
    [S.AIM120C]: 4,
    [S.AGM88C]: 2,
    [S.GBU12]: 4,
    [S.MK82_TER]: 2
  }
})
