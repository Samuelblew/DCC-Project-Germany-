import { a10aProfile } from './a-10a'
import { ah6jProfile } from './ah-6j'
import { ah64dProfile } from './ah-64d'
import { f5eFcProfile } from './f-5e-fc'
import { f15cProfile } from './f-15c'
import { f16cProfile } from './f-16c'
import { f86fFcProfile } from './f-86f-fc'
import { mh6jProfile } from './mh-6j'
import { mig15bisFcProfile } from './mig-15bis-fc'
import { mig29FulcrumProfile } from './mig-29-fulcrum'
import { mig29sProfile } from './mig-29s'
import { su25Profile } from './su-25'
import { su25tProfile } from './su-25t'
import { su27Profile } from './su-27'
import { su33Profile } from './su-33'
import type { AircraftProfile } from './types'

export { A10A_STORES } from './a-10a'
export { AH6J_STORES } from './ah-6j'
export { AH64D_STORES } from './ah-64d'
export { F5E_FC_STORES } from './f-5e-fc'
export { F15C_STORES } from './f-15c'
export { F16C_STORES } from './f-16c'
export { F86F_FC_STORES } from './f-86f-fc'
export { MH6J_STORES } from './mh-6j'
export { MIG15BIS_FC_STORES } from './mig-15bis-fc'
export { MIG29_STORES } from './mig-29-fulcrum'
export { MIG29S_STORES } from './mig-29s'
export type { ModuleSnapshot } from './module-snapshot-types'
export { moduleSnapshots } from './module-snapshots'
export { SU25_STORES } from './su-25'
export { SU25T_STORES } from './su-25t'
export { SU27_STORES } from './su-27'
export { SU33_STORES } from './su-33'
export * from './types'

/** Modules the DCC knows in detail. New aircraft plug in here. */
export const aircraftProfiles: AircraftProfile[] = [
  mig29FulcrumProfile,
  su27Profile,
  su25Profile,
  mig29sProfile,
  su25tProfile,
  su33Profile,
  f15cProfile,
  a10aProfile,
  f16cProfile,
  f5eFcProfile,
  f86fFcProfile,
  mig15bisFcProfile,
  ah64dProfile,
  ah6jProfile,
  mh6jProfile
]

export function getAircraftProfile(aircraftName: string): AircraftProfile | undefined {
  return aircraftProfiles.find((profile) => profile.aircraftName === aircraftName)
}
