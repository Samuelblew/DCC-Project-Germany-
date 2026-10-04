import { F86F_FC_STORES, f86fFcProfile } from '../aircraft-profiles/f-86f-fc'
import { defineCareerAircraft } from './types'

const S = F86F_FC_STORES

export const f86fFcCareer = defineCareerAircraft(f86fFcProfile, {
  prices: {
    new: 35,
    usedRange: [15, 25],
    overhaul: 6,
    repairPerPercent: 0.2
  },
  usedIntegrityRange: [0.6, 0.9],
  usedDefectCount: [0, 0],
  deliveryHours: 36,
  resaleFactor: 0.6,
  weaponPrices: {
    [S.GAR8]: 2,
    [S.ANM64]: 1,
    [S.M117]: 1
  },
  startInventory: {
    [S.GAR8]: 4,
    [S.ANM64]: 4,
    [S.M117]: 4
  }
})
