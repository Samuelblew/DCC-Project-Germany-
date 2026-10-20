import { MH6J_STORES, mh6jProfile } from '../aircraft-profiles/mh-6j'
import { defineCareerAircraft } from './types'

const S = MH6J_STORES

export const mh6jCareer = defineCareerAircraft(mh6jProfile, {
  prices: {
    new: 42,
    usedRange: [18, 30],
    overhaul: 8,
    repairPerPercent: 0.2
  },
  usedIntegrityRange: [0.6, 0.9],
  usedDefectCount: [0, 0],
  deliveryHours: 24,
  resaleFactor: 0.6,
  weaponPrices: {
    [S.DOORGUNNER]: 1
  },
  startInventory: {
    [S.DOORGUNNER]: 4
  }
})
