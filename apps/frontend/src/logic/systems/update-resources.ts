import { schemas } from '@dcc/contracts'
import * as z from 'zod'
import { calculateDistance } from '../utils/calculate-distance'
import { logisticsInterdictionAt } from './logistics-interdiction'

const RESOURCE_GAIN_RATE = 10
const BONUS_RADIUS = 5000 // 5km
const BONUS_AMOUNT = 2
const RESOURCE_GENERATION_FACTOR = 0.1
const MAX_RESOURCE_STOCKPILE = 2000

type ResourceGeneratingStructure = {
  id: string
  type: string
  objectiveId: string
  position: z.infer<typeof schemas.position>
  buildings: Array<{ alive: boolean }>
}

export function calculateResourceGainPerLogicTick(
  structure: ResourceGeneratingStructure,
  structures: ResourceGeneratingStructure[],
  timeMultiplier: number,
  interdiction = 0
) {
  // Only Barrack and Depot structures generate resources.
  if (structure.type !== 'Barrack' && structure.type !== 'Depot') {
    return 0
  }

  const aliveBuildings = structure.buildings.filter((building) => building.alive)
  if (aliveBuildings.length === 0) {
    return 0
  }

  let gain = RESOURCE_GAIN_RATE

  // Apply nearby structure bonuses to the base gain.
  for (const otherStructure of structures) {
    if (otherStructure.id === structure.id) continue

    const dist = calculateDistance(structure.position, otherStructure.position)
    if (dist <= BONUS_RADIUS) {
      const isBonusType = [
        'Power Plant',
        'Command Center',
        'Fuel Storage',
        'Ammo Depot',
        'Factory',
        'Factory 2',
        'Oil Platform'
      ].includes(otherStructure.type)
      const hasAliveBuildings = otherStructure.buildings.some((b) => b.alive)

      if (isBonusType && hasAliveBuildings) {
        gain += BONUS_AMOUNT
      }
    }
  }

  const timeFactor = (1000 * timeMultiplier) / 10000
  return gain * timeFactor * RESOURCE_GENERATION_FACTOR * (1 - interdiction)
}

export function updateResources(
  draft: z.infer<typeof schemas.campaign.campaign>,
  coalition: z.infer<typeof schemas.coalition>
) {
  const structures = draft.coalitions[coalition].structures

  for (const structure of structures) {
    const gainPerLogicTick = calculateResourceGainPerLogicTick(
      structure,
      structures,
      draft.timeMultiplier,
      logisticsInterdictionAt(draft, coalition, structure.objectiveId)
    )
    if (gainPerLogicTick <= 0) continue

    structure.resources = Math.min(
      MAX_RESOURCE_STOCKPILE,
      (structure.resources || 0) + gainPerLogicTick
    )
  }
}
