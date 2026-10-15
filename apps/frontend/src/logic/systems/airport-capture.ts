import { config, schemas } from '@dcc/contracts'
import * as z from 'zod'

import { calculateDistance } from '@/logic/utils/calculate-distance'
import { ensureVirtualSupply, getSupplyStatus } from './update-supply'

type Campaign = z.infer<typeof schemas.campaign.campaign>
type Coalition = z.infer<typeof schemas.coalition>
type Position = z.infer<typeof schemas.position>
type Theatre = z.infer<typeof schemas.theatre>
type Supply = z.infer<typeof schemas.supply>

export const AIRPORT_OBJECTIVE_INFLUENCE_RADIUS = 40_000

export function getAirdromePosition(theatre: Theatre, airdromeName: string): Position | undefined {
  const airdrome = theatre.airdromeDetails[airdromeName]
  if (!airdrome) return undefined
  return { x: airdrome.x, y: airdrome.y }
}

export function getNearbyObjectiveIds(theatre: Theatre, airdromeName: string): string[] {
  const airdromePosition = getAirdromePosition(theatre, airdromeName)
  if (!airdromePosition) return []

  return theatre.objectives
    .filter(
      (objective) =>
        objective.name !== airdromeName &&
        calculateDistance(airdromePosition, objective.position) <=
          AIRPORT_OBJECTIVE_INFLUENCE_RADIUS
    )
    .map((objective) => objective.name)
}

export function isAirdromeVulnerable(
  draft: Campaign,
  theatre: Theatre,
  attackerCoalition: Coalition,
  airdromeName: string
): boolean {
  const nearbyObjectiveIds = getNearbyObjectiveIds(theatre, airdromeName)
  if (nearbyObjectiveIds.length === 0) return true

  const attackerObjectiveIds = new Set(draft.coalitions[attackerCoalition].objectiveIds)
  const attackerControlledCount = nearbyObjectiveIds.filter((objectiveId) =>
    attackerObjectiveIds.has(objectiveId)
  ).length

  return attackerControlledCount > nearbyObjectiveIds.length / 2
}

export function transferAirdromeOwnership(
  draft: Campaign,
  attackerCoalition: Coalition,
  defenderCoalition: Coalition,
  airdromeName: string
): void {
  const defenderAirdromes = draft.coalitions[defenderCoalition].airdromeNames
  const defenderAirdromeIndex = defenderAirdromes.indexOf(airdromeName)
  if (defenderAirdromeIndex !== -1) {
    defenderAirdromes.splice(defenderAirdromeIndex, 1)
  }

  const attackerAirdromes = draft.coalitions[attackerCoalition].airdromeNames
  if (!attackerAirdromes.includes(airdromeName)) {
    attackerAirdromes.push(airdromeName)
  }

  transferAirdromeSupplyNode(draft, attackerCoalition, defenderCoalition, airdromeName)
}

function transferAirdromeSupplyNode(
  draft: Campaign,
  attackerCoalition: Coalition,
  defenderCoalition: Coalition,
  airdromeName: string
): void {
  const attackerSupplyNodes = (draft.coalitions[attackerCoalition].supplyNodes ??= {})
  const defenderSupplyNodes = draft.coalitions[defenderCoalition].supplyNodes
  const defenderSupply = defenderSupplyNodes?.[airdromeName]

  if (defenderSupplyNodes && defenderSupply) {
    delete defenderSupplyNodes[airdromeName]
  }

  attackerSupplyNodes[airdromeName] = normalizeCapturedAirdromeSupply(defenderSupply, draft.time)
}

function normalizeCapturedAirdromeSupply(
  previousSupply: Supply | undefined,
  capturedAt: Date
): Supply {
  const max = previousSupply?.max ?? 10_000
  const current = Math.min(previousSupply?.current ?? 2_500, max * 0.35)
  const currentRatio = max > 0 ? current / max : 0

  return {
    current,
    max,
    productionRate: 0,
    consumptionRate: 0,
    status: getSupplyStatus(currentRatio),
    fuel: {
      current: max * 0.45 * currentRatio,
      max: max * 0.45,
      productionRate: 0,
      consumptionRate: 0
    },
    munitions: {
      current: max * 0.35 * currentRatio,
      max: max * 0.35,
      productionRate: 0,
      consumptionRate: 0
    },
    repair: {
      current: max * 0.2 * currentRatio,
      max: max * 0.2,
      productionRate: 0,
      consumptionRate: 0
    },
    logistics: {
      hub: true,
      hubLevel: 1,
      routeCapacity: 20,
      routes: [],
      interdiction: 0,
      repairRate: 0.02,
      recoveryUntil: new Date(capturedAt.getTime() + 60 * 60 * 1000)
    }
  }
}

export function isAirdromeRecovering(
  draft: Campaign,
  coalition: Coalition,
  airdromeName: string,
  at = draft.time
) {
  const until = draft.coalitions[coalition].supplyNodes?.[airdromeName]?.logistics?.recoveryUntil
  return until != null && at < until
}

/** Campaign-side crater. The .miz still flies the Runway Attack; this is what shuts the field. */
export function craterAirdrome(
  draft: Campaign,
  ownerCoalition: Coalition,
  airdromeName: string,
  at = draft.time
) {
  const supplyNodes = (draft.coalitions[ownerCoalition].supplyNodes ??= {})
  const supply = (supplyNodes[airdromeName] ??= {
    current: 0,
    max: 10_000,
    consumptionRate: 0,
    productionRate: 0,
    status: 'depleted'
  })
  ensureVirtualSupply(supply, true)
  const until = new Date(at.getTime() + config.packages['Runway Attack'].recoveryMs)
  if (!supply.logistics!.recoveryUntil || supply.logistics!.recoveryUntil < until) {
    supply.logistics!.recoveryUntil = until
  }
}
