import { MIG29S_STORES, mig29sProfile } from '../aircraft-profiles/mig-29s'
import { defineCareerAircraft } from './types'

const S = MIG29S_STORES

export const mig29sCareer = defineCareerAircraft(mig29sProfile, {
  prices: {
    new: 135,
    usedRange: [60, 95],
    overhaul: 22,
    repairPerPercent: 0.55
  },
  usedIntegrityRange: [0.6, 0.9],
  usedDefectCount: [0, 0],
  deliveryHours: 48,
  resaleFactor: 0.6,
  weaponPrices: {
    [S.R60M]: 2,
    [S.R73]: 3,
    [S.R77]: 7,
    [S.R27R]: 4,
    [S.R27ER]: 6,
    [S.R27ET]: 7,
    [S.S8KOM]: 2,
    [S.S8OFP]: 2,
    [S.S24B]: 2,
    [S.FAB250]: 1,
    [S.FAB500]: 1,
    [S.BETAB500]: 2,
    [S.RBK250]: 2,
    [S.RBK500AO]: 3
  },
  startInventory: {
    [S.R73]: 8,
    [S.R77]: 2,
    [S.R27R]: 2,
    [S.R27ER]: 2,
    [S.S8KOM]: 4
  }
})
