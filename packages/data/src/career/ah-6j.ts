import { AH6J_STORES, ah6jProfile } from '../aircraft-profiles/ah-6j'
import { defineCareerAircraft } from './types'

const S = AH6J_STORES

export const ah6jCareer = defineCareerAircraft(ah6jProfile, {
  prices: {
    new: 50,
    usedRange: [22, 36],
    overhaul: 9,
    repairPerPercent: 0.25
  },
  usedIntegrityRange: [0.6, 0.9],
  usedDefectCount: [0, 0],
  deliveryHours: 24,
  resaleFactor: 0.6,
  weaponPrices: {
    [S.M134_L]: 1,
    [S.M134_R]: 1,
    [S.M260_M151]: 2,
    [S.M261_M229]: 4,
    [S.FN_HMP400]: 2,
    [S.AGM114K_L]: 8,
    [S.AGM114K_R]: 8
  },
  startInventory: {
    [S.M134_L]: 4,
    [S.M134_R]: 4,
    [S.M260_M151]: 6,
    [S.FN_HMP400]: 2,
    [S.AGM114K_L]: 2,
    [S.AGM114K_R]: 2
  }
})
