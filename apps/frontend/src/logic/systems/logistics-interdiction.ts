import { schemas } from '@dcc/contracts'
import type * as z from 'zod'

type Campaign = z.infer<typeof schemas.campaign.campaign>
type Coalition = z.infer<typeof schemas.coalition>

const LOGISTICS_STRUCTURE_TYPES = new Set([
  'Ammo Depot',
  'Fuel Storage',
  'Depot',
  'Command Center',
  'Power Plant',
  'Factory',
  'Factory 2',
  'Oil Platform',
  'Logistics Hub'
])

/** Barracks stop raising once the local depot/ammo net is this damaged. */
export const GROUND_SPAWN_INTERDICTION_CHOKE = 0.6

export function isLogisticsStructure(type: string) {
  return LOGISTICS_STRUCTURE_TYPES.has(type)
}

export function isLandHopChoked(
  draft: Campaign,
  coalition: Coalition,
  objectiveId: string | undefined
) {
  if (!objectiveId) return false
  return logisticsInterdictionAt(draft, coalition, objectiveId) >= GROUND_SPAWN_INTERDICTION_CHOKE
}

export function chokedObjectiveIds(draft: Campaign, coalition: Coalition) {
  const ids = new Set<string>()
  const owned = draft.coalitions[coalition]
  for (const objectiveId of [...owned.objectiveIds, ...owned.airdromeNames]) {
    if (isLandHopChoked(draft, coalition, objectiveId)) ids.add(objectiveId)
  }
  return ids
}

/**
 * 0 = intact logistics, 0.9 = every depot/ammo/fuel/C2 building at the node is down.
 * Derived from structures, not from extra DCS units.
 */
export function logisticsInterdictionAt(
  draft: Campaign,
  coalition: Coalition,
  objectiveId: string
) {
  const logistics = draft.coalitions[coalition].structures.filter(
    (structure) => structure.objectiveId === objectiveId && isLogisticsStructure(structure.type)
  )
  if (logistics.length === 0) return 0

  const total = logistics.reduce((sum, structure) => sum + structure.buildings.length, 0)
  if (total === 0) return 0

  const alive = logistics.reduce(
    (sum, structure) => sum + structure.buildings.filter((building) => building.alive).length,
    0
  )
  return Math.min(0.9, 1 - alive / total)
}
