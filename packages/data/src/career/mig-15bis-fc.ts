import { MIG15BIS_FC_STORES, mig15bisFcProfile } from '../aircraft-profiles/mig-15bis-fc'
import { defineCareerAircraft } from './types'

const S = MIG15BIS_FC_STORES

export const mig15bisFcCareer = defineCareerAircraft(mig15bisFcProfile, {
  prices: {
    new: 30,
    usedRange: [12, 22],
    overhaul: 5,
    repairPerPercent: 0.18
  },
  usedIntegrityRange: [0.6, 0.9],
  usedDefectCount: [0, 0],
  deliveryHours: 36,
  resaleFactor: 0.6,
  weaponPrices: {
    [S.FAB100]: 1,
    [S.FAB50]: 1
  },
  startInventory: {
    [S.FAB100]: 4,
    [S.FAB50]: 4
  }
})
