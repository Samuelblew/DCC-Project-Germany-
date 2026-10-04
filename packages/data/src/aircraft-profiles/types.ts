import { schemas } from '@dcc/contracts'
import type * as z from 'zod'

type AircraftName = z.infer<typeof schemas.dcs.aircraftName>
type FlightTask = z.infer<typeof schemas.task>

/** How deeply DCS simulates the module; decides which systems the DCC can configure. */
export type AircraftFidelity = 'full' | 'flamingCliffs'

export type AircraftRole = 'airSuperiority' | 'multirole' | 'attack' | 'helicopter'

export type ProfileWeapon = {
  /** Pylon CLSID; also the inventory key. */
  id: string
  name: string
  /** Names Unit.getAmmo may report for this store, compared after normalizeAmmoName. */
  ammoNames: string[]
  /** Rounds getAmmo counts per store carried (a rocket pod reports its rockets). */
  roundsPerStore: number
  /** Not bought or tracked (drop tanks). */
  free?: boolean
  /** Pylon stations that accept this store. */
  stations: number[]
}

/** Stations of the aircraft, left to right as seen from behind; drives the preset editor. */
export type ProfileStation = { num: number; label: string }

export type ProfileLoadout = {
  id: string
  name: string
  /** Tasks this loadout is suggested for; any loadout can still be chosen. */
  tasks: FlightTask[]
  pylons: Array<{ num: number; CLSID: string }>
}

export type ProfileFailure = { id: string; label: string }

export type ProfileRadioPlan = z.infer<typeof schemas.radioPlan>

/** A comms set with preset channels, as the cockpit numbers and limits it. */
export type ProfileCommsRadio = {
  name: string
  kind: 'uhf' | 'vhf' | 'combined'
  channels: number
  /** Number the cockpit shows on the first preset (the R-862 starts at "Channel 0"). */
  firstChannelLabel: number
  /** Frequency bands the set tunes, in MHz. */
  bands: Array<[number, number]>
  /** The mission's `Radio[n]` table (1-based) that holds this set's presets. */
  missionRadio: number
}

export type ProfileAdfRadio = {
  name: string
  /** Outer/inner preset pairs. */
  pairs: number
  rangeKhz: [number, number]
  /** The mission's `Radio[n]` table (1-based) that holds the NDB presets, in MHz. */
  missionRadio: number
}

/** The aircraft's preset radios. The first comms set carries the flight's own channel. */
export type ProfileRadios = {
  comms: ProfileCommsRadio[]
  adf?: ProfileAdfRadio
  /** Presets a player starts with before setting the radios up. */
  defaultPlan: ProfileRadioPlan
}

/** Radio navigation the aircraft can receive; the DCC only sets up and briefs these. */
export type NavigationAidKind = 'adf' | 'tacan' | 'ils' | 'rsbn'

/** Units of the aircraft's instruments, used on its kneeboard. */
export type InstrumentUnits = 'imperial' | 'metric'

/**
 * What a DCS module is and what the DCC can set up on it, independent of any career economy.
 * Optional systems are left out when the module does not have them or the DCC cannot drive them.
 */
export type AircraftProfile = {
  aircraftName: AircraftName
  displayName: string
  /** Compact name for buttons and labels, e.g. "MiG-29". */
  shortName: string
  fidelity: AircraftFidelity
  role: AircraftRole
  /**
   * Faction aircraft this module stands for, besides its own name: a faction flying the MiG-29A
   * fields the MiG-29 Fulcrum module. Decides which coalition the type belongs to.
   */
  factionTypes?: AircraftName[]
  weapons: ProfileWeapon[]
  stations: ProfileStation[]
  loadouts: ProfileLoadout[]
  /** Route points the navigation system holds; longer routes are thinned to fit. */
  maxRouteWaypoints?: number
  /** Failures safe to arm: they degrade the aircraft but never stop it being flown and fought. */
  minorFailures: ProfileFailure[]
  /** Preset radios the DCC can program; absent when the module has no preset panel to fill. */
  radios?: ProfileRadios
  navigationAids: NavigationAidKind[]
  units: InstrumentUnits
}

/** Lowercase letters and digits of the last dotted segment: "weapons.missiles.R_73" -> "r73". */
export function normalizeAmmoName(name: string) {
  const lastSegment = name.split('.').at(-1) ?? name
  return lastSegment.toLowerCase().replace(/[^a-z0-9]/g, '')
}
