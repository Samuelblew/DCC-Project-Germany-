import { F5E_FC_STORES, f5eFcProfile } from '../aircraft-profiles/f-5e-fc'
import { defineCareerAircraft } from './types'

const S = F5E_FC_STORES

export const f5eFcCareer = defineCareerAircraft(f5eFcProfile, {
  prices: {
    new: 55,
    usedRange: [25, 40],
    overhaul: 10,
    repairPerPercent: 0.25
  },
  usedIntegrityRange: [0.6, 0.9],
  usedDefectCount: [0, 0],
  deliveryHours: 48,
  resaleFactor: 0.6,
  weaponPrices: {
    [S.AIM9B]: 2,
    [S.AIM9P]: 2,
    [S.AIM9P3]: 2,
    [S.AIM9P5]: 3,
    [S.MK82]: 1,
    [S.SNAKEYE]: 1,
    [S.CBU52]: 2
  },
  startInventory: {
    [S.AIM9P5]: 4,
    [S.AIM9B]: 4,
    [S.MK82]: 4,
    [S.SNAKEYE]: 4,
    [S.CBU52]: 4
  }
})
