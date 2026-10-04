import { schemas } from '@dcc/contracts'
import type * as z from 'zod'

import type {
  AircraftProfile,
  ProfileFailure,
  ProfileLoadout,
  ProfileRadioPlan,
  ProfileRadios,
  ProfileStation,
  ProfileWeapon
} from '../aircraft-profiles/types'

export type CareerPilotSkill = z.infer<typeof schemas.campaign.careerPilotSkill>

export type CareerWeapon = ProfileWeapon & { price: number }
export type CareerStation = ProfileStation
export type CareerLoadout = ProfileLoadout
export type CareerFailure = ProfileFailure
export type CareerRadioPlan = ProfileRadioPlan
export type CareerRadios = ProfileRadios

/** What an aircraft costs in the career: the airframe, its upkeep and the stores it carries. */
export type CareerEconomy = {
  prices: {
    new: number
    usedRange: [number, number]
    /** Clears a used aircraft's hidden defects. */
    overhaul: number
    /** Per percentage point of integrity restored. */
    repairPerPercent: number
  }
  usedIntegrityRange: [number, number]
  usedDefectCount: [number, number]
  /** Campaign hours between buying an aircraft and it standing ready at its base. */
  deliveryHours: number
  /** Share of an aircraft's value paid back when it is sold, before wear. */
  resaleFactor: number
  /** Price of each store the player can buy, by CLSID. Stores without a price cannot be bought. */
  weaponPrices: Record<string, number>
  /** Weapon CLSID -> stores a new career in this aircraft starts with. */
  startInventory: Record<string, number>
}

/** A module profile priced for the career; what every career rule works from. */
export type CareerAircraft = Omit<AircraftProfile, 'weapons'> &
  Omit<CareerEconomy, 'weaponPrices'> & {
    weapons: CareerWeapon[]
  }

/**
 * Joins a module profile with its career economy. Stores with no price stay usable only when the
 * profile marks them free (drop tanks); anything else unpriced is left out of the career.
 */
export function defineCareerAircraft(
  profile: AircraftProfile,
  economy: CareerEconomy
): CareerAircraft {
  const { weaponPrices, ...rest } = economy
  return {
    ...profile,
    ...rest,
    weapons: profile.weapons.flatMap((weapon) => {
      const price = weaponPrices[weapon.id]
      if (price != null) return [{ ...weapon, price }]
      return weapon.free ? [{ ...weapon, price: 0 }] : []
    })
  }
}
