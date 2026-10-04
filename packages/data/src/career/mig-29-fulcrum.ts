import { MIG29_STORES, mig29FulcrumProfile } from '../aircraft-profiles/mig-29-fulcrum'
import { defineCareerAircraft } from './types'

const S = MIG29_STORES

export const mig29FulcrumCareer = defineCareerAircraft(mig29FulcrumProfile, {
  prices: {
    new: 120,
    usedRange: [55, 85],
    overhaul: 20,
    repairPerPercent: 0.5
  },
  usedIntegrityRange: [0.6, 0.9],
  usedDefectCount: [1, 3],
  deliveryHours: 48,
  resaleFactor: 0.6,
  weaponPrices: {
    [S.R60M]: 2,
    [S.R73]: 3,
    [S.R27R]: 4,
    [S.R27T]: 4,
    [S.R27ER]: 6,
    [S.R27ET]: 7,
    [S.S8OFP]: 2,
    [S.S8KOM]: 2,
    [S.S24B]: 2,
    [S.FAB250]: 1,
    [S.FAB500]: 1,
    [S.BETAB500]: 2,
    [S.RBK500]: 3
  },
  startInventory: {
    [S.R73]: 8,
    [S.R27R]: 2,
    [S.R27ER]: 2,
    [S.S8OFP]: 4,
    [S.FAB500]: 4
  }
})
