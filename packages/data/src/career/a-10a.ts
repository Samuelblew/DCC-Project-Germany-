import { A10A_STORES, a10aProfile } from '../aircraft-profiles/a-10a'
import { defineCareerAircraft } from './types'

const S = A10A_STORES

export const a10aCareer = defineCareerAircraft(a10aProfile, {
  prices: {
    new: 100,
    usedRange: [45, 70],
    overhaul: 18,
    repairPerPercent: 0.45
  },
  usedIntegrityRange: [0.6, 0.9],
  usedDefectCount: [0, 2],
  deliveryHours: 60,
  resaleFactor: 0.6,
  weaponPrices: {
    [S.AIM9M_PAIR]: 5,
    [S.MK82]: 1,
    [S.MK84]: 2,
    [S.MK20]: 2,
    [S.CBU87]: 2,
    [S.CBU97]: 4,
    [S.LAU68_M151]: 2,
    [S.AGM65K]: 6,
    [S.AGM65D_TRIPLE]: 15
  },
  startInventory: {
    [S.AIM9M_PAIR]: 2,
    [S.MK82]: 8,
    [S.MK20]: 4,
    [S.LAU68_M151]: 4,
    [S.AGM65D_TRIPLE]: 2
  }
})
