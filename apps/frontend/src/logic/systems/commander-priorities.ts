import { schemas } from '@dcc/contracts'
import type * as z from 'zod'

type Campaign = z.infer<typeof schemas.campaign.campaign>
type Coalition = z.infer<typeof schemas.coalition>
type Priorities = NonNullable<Campaign['priorities']>
export type MissionPriority = keyof NonNullable<Priorities['missions']>
export type TargetPriority = keyof NonNullable<Priorities['targets']>

export const NEUTRAL_PRIORITY = 3

export const MISSION_PRIORITIES: Array<{ key: MissionPriority; label: string; hint: string }> = [
  { key: 'oca', label: 'Offensive counter-air', hint: 'Strikes on enemy airfields' },
  { key: 'sead', label: 'SAM suppression', hint: 'SEAD and DEAD against radars and SAMs, jamming' },
  { key: 'interdiction', label: 'Interdiction & CAS', hint: 'Attacks on troops, depots and roads' },
  { key: 'strategic', label: 'Strategic strikes', hint: 'Factories, power plants, oil' },
  { key: 'antiship', label: 'Anti-shipping', hint: 'Strikes on naval groups' },
  { key: 'dca', label: 'Defensive counter-air', hint: 'CAP, intercepts and fighter sweeps' }
]

export const TARGET_PRIORITIES: Array<{ key: TargetPriority; label: string }> = [
  { key: 'airDefense', label: 'Air defences' },
  { key: 'airfields', label: 'Airfields' },
  { key: 'command', label: 'Command & control' },
  { key: 'groundForces', label: 'Ground forces' },
  { key: 'logistics', label: 'Logistics (depots, fuel, roads)' },
  { key: 'industry', label: 'Industry & power' }
]

/** ATO package kinds (`AtoPackageKind`) by mission family. Support flights are always HQ's call. */
const MISSION_BY_KIND: Record<string, MissionPriority> = {
  oca: 'oca',
  dead: 'sead',
  ecm: 'sead',
  cas: 'interdiction',
  strike: 'interdiction',
  strategicStrike: 'strategic',
  cap: 'dca',
  intercept: 'dca',
  sweep: 'dca'
}

const INDUSTRY = new Set(['Factory', 'Factory 2', 'Power Plant', 'Oil Platform'])
const LOGISTICS = new Set([
  'Ammo Depot',
  'Fuel Storage',
  'Depot',
  'Logistics Hub',
  'Farp',
  'Road',
  'supply'
])

function targetFamily(kind: string, targetType: string): TargetPriority | undefined {
  if (kind === 'dead' || kind === 'ecm') return 'airDefense'
  if (kind === 'oca' || targetType === 'Airbase') return 'airfields'
  if (targetType === 'Command Center') return 'command'
  if (INDUSTRY.has(targetType)) return 'industry'
  if (LOGISTICS.has(targetType)) return 'logistics'
  if (targetType === 'Ground Group' || targetType === 'raid') return 'groundForces'
  return undefined
}

/** The player's weights, or nothing when HQ sets priorities or for the AI side. */
function activePriorities(campaign: Pick<Campaign, 'priorities'>, coalition: Coalition) {
  if (coalition !== 'player') return undefined
  const priorities = campaign.priorities
  if (!priorities || priorities.hq) return undefined
  return priorities
}

export function missionPriorityLevel(
  campaign: Pick<Campaign, 'priorities'>,
  coalition: Coalition,
  mission: MissionPriority
) {
  return activePriorities(campaign, coalition)?.missions?.[mission] ?? NEUTRAL_PRIORITY
}

function levelsFor(
  campaign: Pick<Campaign, 'priorities'>,
  coalition: Coalition,
  plan: { kind: string; targetType: string }
) {
  const priorities = activePriorities(campaign, coalition)
  if (!priorities) return undefined
  const mission = MISSION_BY_KIND[plan.kind]
  const target = targetFamily(plan.kind, plan.targetType)
  return {
    mission: mission ? (priorities.missions?.[mission] ?? NEUTRAL_PRIORITY) : NEUTRAL_PRIORITY,
    target: target ? (priorities.targets?.[target] ?? NEUTRAL_PRIORITY) : NEUTRAL_PRIORITY
  }
}

/** Level 0 on the mission or target family takes the package off the table. */
export function isPlanSuppressed(
  campaign: Pick<Campaign, 'priorities'>,
  coalition: Coalition,
  plan: { kind: string; targetType: string }
) {
  const levels = levelsFor(campaign, coalition, plan)
  return levels != null && (levels.mission === 0 || levels.target === 0)
}

/**
 * Score added to an ATO candidate: each step above or below neutral is worth about as much as
 * the operation-profile nudges, so the player's sliders outweigh them at the extremes.
 */
export function priorityScore(
  campaign: Pick<Campaign, 'priorities'>,
  coalition: Coalition,
  plan: { kind: string; targetType: string }
) {
  const levels = levelsFor(campaign, coalition, plan)
  if (!levels) return 0
  return (levels.mission - NEUTRAL_PRIORITY) * 12 + (levels.target - NEUTRAL_PRIORITY) * 8
}
