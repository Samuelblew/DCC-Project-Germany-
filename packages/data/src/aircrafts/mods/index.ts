import { schemas } from '@dcc/contracts'
import type * as z from 'zod'

import ah_6j from './ah-6j'
import mh_6j from './mh-6j'

export { ah_6j, mh_6j }

type AircraftDefinition = z.infer<typeof schemas.dcs.aircraft>

/** Optional user-installed DCS mod aircraft definitions. */
export const optionalModAircrafts: Record<string, AircraftDefinition> = {
  [ah_6j.name]: ah_6j,
  [mh_6j.name]: mh_6j
}

/**
 * Checks whether an aircraft is available given the list of installed DCS mod directories/IDs.
 * Standard aircraft (and bundled mods without `modDirectory`) are always available.
 * When `installedMods` is undefined (e.g. in static tests), all definitions are treated as available.
 */
export function isAircraftModInstalled(
  aircraftName: string,
  installedMods?: readonly string[]
): boolean {
  const modAircraft = optionalModAircrafts[aircraftName]
  if (!modAircraft?.modDirectory) {
    return true
  }
  if (!installedMods) {
    return true
  }
  const normalizedInstalled = new Set(installedMods.map((entry) => entry.toLowerCase()))
  return (
    normalizedInstalled.has(modAircraft.modDirectory.toLowerCase()) ||
    normalizedInstalled.has(modAircraft.name.toLowerCase())
  )
}

/**
 * Filters a faction/coalition `aircraftTypes` map so optional mod aircraft are only kept when installed.
 */
export function filterAircraftTypesForInstalledMods<
  T extends Partial<Record<string, readonly string[]>>
>(aircraftTypes: T, installedMods?: readonly string[]): T {
  if (!installedMods) {
    return aircraftTypes
  }
  const next: Record<string, unknown> = {}
  for (const [task, list] of Object.entries(aircraftTypes)) {
    if (!Array.isArray(list)) continue
    next[task] = list.filter((name) => isAircraftModInstalled(name, installedMods))
  }
  return next as T
}
