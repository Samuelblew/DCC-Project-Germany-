import type { schemas } from '@dcc/contracts'
import type * as z from 'zod'

import type { AircraftRole } from '../aircraft-profiles/types'
import { isAircraftModInstalled } from '../aircrafts/mods'
import { a10aCareer } from './a-10a'
import { ah6jCareer } from './ah-6j'
import { ah64dCareer } from './ah-64d'
import { f5eFcCareer } from './f-5e-fc'
import { f15cCareer } from './f-15c'
import { f16cCareer } from './f-16c'
import { f86fFcCareer } from './f-86f-fc'
import { mh6jCareer } from './mh-6j'
import { mig15bisFcCareer } from './mig-15bis-fc'
import { mig29FulcrumCareer } from './mig-29-fulcrum'
import { mig29sCareer } from './mig-29s'
import { su25Career } from './su-25'
import { su25tCareer } from './su-25t'
import { su27Career } from './su-27'
import { su33Career } from './su-33'
import type { CareerAircraft, CareerPilotSkill } from './types'

export * from './types'

type FlightTask = z.infer<typeof schemas.task>
type AcquisitionRule = z.infer<typeof schemas.campaign.careerAcquisitionRule>
/** A faction's aircraft by task, as factions and campaign coalitions hold them. */
type AircraftTypesByTask = Partial<Record<string, readonly string[]>>

/** Aircraft the career mode can be played in. New entries plug in here. */
export const careerAircraft: CareerAircraft[] = [
  mig29FulcrumCareer,
  su27Career,
  su25Career,
  mig29sCareer,
  su25tCareer,
  su33Career,
  f15cCareer,
  a10aCareer,
  f16cCareer,
  f5eFcCareer,
  f86fFcCareer,
  mig15bisFcCareer,
  ah64dCareer,
  ah6jCareer,
  mh6jCareer
]

export function getCareerAircraft(aircraftName: string): CareerAircraft | undefined {
  return careerAircraft.find((entry) => entry.aircraftName === aircraftName)
}

/** Whether a faction flies this type, under its own name or one of the types it stands for. */
export function isFactionCareerAircraft(
  aircraft: CareerAircraft,
  aircraftTypes: AircraftTypesByTask
): boolean {
  const names = new Set<string>([aircraft.aircraftName, ...(aircraft.factionTypes ?? [])])
  return Object.values(aircraftTypes).some((types) => types?.some((type) => names.has(type)))
}

/** Career aircraft the player may start in or buy: the coalition's own, or any in arcade. */
export function getAcquirableCareerAircraft(
  rule: AcquisitionRule,
  playerAircraftTypes: AircraftTypesByTask,
  installedMods?: readonly string[]
): CareerAircraft[] {
  const available = installedMods
    ? careerAircraft.filter((aircraft) =>
        isAircraftModInstalled(aircraft.aircraftName, installedMods)
      )
    : careerAircraft
  return rule === 'arcade'
    ? available
    : available.filter((aircraft) => isFactionCareerAircraft(aircraft, playerAircraftTypes))
}

/** Rewards per mission event, in the same currency as the catalog prices. */
export const careerRewards = {
  /** Enemy aircraft shot down by the player's flight. */
  airKill: 25,
  helicopterKill: 12,
  /** Enemy ground vehicle or emplacement destroyed by the player's flight. */
  groundKill: 3,
  shipKill: 30,
  /** The flight's assigned target was destroyed, for tasks without their own bonus. */
  taskCompleted: 15,
  /** The player landed at a friendly airfield. */
  safeReturn: 6
}

export type CareerKillKind = 'air' | 'helicopter' | 'ground' | 'ship'

/**
 * Kill rewards scaled by what the aircraft is built for: a fighter earns mostly from air kills, an
 * attack aircraft from what it destroys on the ground and at sea.
 */
export const careerRoleMultipliers: Record<AircraftRole, Record<CareerKillKind, number>> = {
  airSuperiority: { air: 1, helicopter: 1, ground: 0.7, ship: 0.7 },
  multirole: { air: 1, helicopter: 1, ground: 1, ship: 1 },
  attack: { air: 0.8, helicopter: 1, ground: 2, ship: 1.5 },
  helicopter: { air: 0.5, helicopter: 1, ground: 1.5, ship: 1 }
}

/** Bonus for completing the flight's task, by task: a destroyed SAM pays more than a quiet CAP. */
export const careerTaskRewards: Partial<Record<FlightTask, number>> = {
  CAP: 10,
  Escort: 12,
  'Fighter Sweep': 12,
  Intercept: 15,
  CAS: 20,
  'Ground Attack': 18,
  'Pinpoint Strike': 20,
  'Runway Attack': 20,
  'Strategic Strike': 25,
  SEAD: 22,
  DEAD: 25,
  'Antiship Strike': 25
}

/** Hiring a wingman, by AI skill. Wingmen fly whatever type the player's flight is in. */
export const careerPilotHire: Record<CareerPilotSkill, number> = {
  Average: 10,
  Good: 20,
  High: 35,
  Excellent: 60
}

export const careerStart = {
  money: 40,
  /** Campaign hours a broke, grounded player waits for a free used aircraft. */
  replacementDelayHours: 24
}
