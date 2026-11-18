import { schemas } from '@dcc/contracts'
import type * as z from 'zod'

import { campaignIadsEra, isColdWarFrontTheatre } from './escalation'

type Campaign = z.infer<typeof schemas.campaign.campaign>
type Coalition = z.infer<typeof schemas.coalition>
type OperationProfile = NonNullable<Campaign['operationProfile']>

export function tempoForGeneration(generation: string | undefined): OperationProfile['tempo'] {
  if (generation === 'Korea' || generation === 'Vietnam') return 'cautious'
  if (generation === 'Modern') return 'surge'
  return 'standard'
}

export function eraAtoAircraftCap(generation: string | undefined) {
  if (generation === 'Korea') return 16
  if (generation === 'Vietnam') return 22
  if (generation === 'Modern') return 34
  return 28
}

export function eraAtoNewPackagesPerTick(generation: string | undefined) {
  if (generation === 'Korea' || generation === 'Vietnam') return 1
  if (generation === 'Modern') return 3
  return 2
}

/** Ground tempo follows the same generation as ATO. Late CW numbers are the baseline. */
export function eraGroundLimits(generation: string | undefined) {
  if (generation === 'Korea') {
    return {
      maxLiveGroups: 20,
      maxIdleGarrisons: 6,
      maxSpawnsPerTick: 1,
      spawnMultiplierScale: 0.5,
      speedFactor: 0.55,
      maxLiveUnits: 140
    }
  }
  if (generation === 'Vietnam') {
    return {
      maxLiveGroups: 28,
      maxIdleGarrisons: 8,
      maxSpawnsPerTick: 2,
      spawnMultiplierScale: 0.75,
      speedFactor: 0.75,
      maxLiveUnits: 180
    }
  }
  return {
    maxLiveGroups: 36,
    maxIdleGarrisons: 12,
    maxSpawnsPerTick: 3,
    spawnMultiplierScale: 1,
    speedFactor: 1,
    maxLiveUnits: 240
  }
}

/**
 * How many enemy towns a side may march on at once.
 * Every posture still attacks. Initiative only decides how many axes are open.
 */
export function maxOffensiveAxes(
  generation: string | undefined,
  archetype: OperationProfile['archetype']
) {
  if (generation === 'Korea') return 2
  if (generation === 'Vietnam') return archetype === 'breakthrough' ? 3 : 2
  if (archetype === 'defense-crisis' || archetype === 'attrition') return 2
  return archetype === 'breakthrough' ? 3 : 2
}

export function resolveGroundSpawnMultiplier(
  scenarioMultiplier: number | undefined,
  generation: string | undefined
) {
  const scale = eraGroundLimits(generation).spawnMultiplierScale
  const base = scenarioMultiplier ?? 1
  return Math.max(1, Math.round(base * scale))
}

/** Hop towns the winner must hold before the ATO treats it as air-superiority. Korea/Vietnam never get there. */
export const AIR_SUPERIORITY_GRAPH_DELTA = 6

/** Cold War fronts start linear. Random variation would break the hop graph. */
export function initialOperationProfile(params: {
  theatreName: string
  era?: string
  escalation?: boolean
}): OperationProfile {
  const generation = params.escalation ? 'Korea' : params.era
  if (isColdWarFrontTheatre(params.theatreName)) {
    return {
      archetype: 'balanced',
      frontlineShape: 'linear',
      tempo: tempoForGeneration(generation),
      initiativeCoalition: 'opponent'
    }
  }

  const archetypes: OperationProfile['archetype'][] = [
    'balanced',
    'breakthrough',
    'attrition',
    'air-superiority',
    'defense-crisis'
  ]
  const frontlineShapes: OperationProfile['frontlineShape'][] = [
    'linear',
    'salient',
    'split-front',
    'overextended'
  ]
  const tempos: OperationProfile['tempo'][] = ['cautious', 'standard', 'surge']
  return {
    archetype: archetypes[Math.floor(Math.random() * archetypes.length)] ?? 'balanced',
    frontlineShape: frontlineShapes[Math.floor(Math.random() * frontlineShapes.length)] ?? 'linear',
    tempo: tempos[Math.floor(Math.random() * tempos.length)] ?? 'standard',
    initiativeCoalition: Math.random() < 0.55 ? 'opponent' : 'player'
  }
}

export function coalitionOperationProfile(draft: Campaign, coalition: Coalition): OperationProfile {
  const profile = draft.operationProfile ?? {
    archetype: 'balanced' as const,
    frontlineShape: 'linear' as const,
    tempo: tempoForGeneration(campaignIadsEra(draft)),
    initiativeCoalition: undefined
  }

  if (profile.archetype === 'attrition') return profile

  const initiative = profile.initiativeCoalition
  if (profile.archetype === 'air-superiority') {
    if (!initiative) return profile
    return {
      ...profile,
      archetype: coalition === initiative ? 'air-superiority' : 'defense-crisis'
    }
  }

  if (!initiative) return profile

  return {
    ...profile,
    archetype: coalition === initiative ? 'breakthrough' : 'defense-crisis'
  }
}

/**
 * How far BARCAP sits along a FLOT hop (0 = friendly town, 1 = hostile).
 * Korea/Vietnam stay short of the line; a defending side stays on its own bank.
 */
export function flotCapDepth(profile: OperationProfile): number {
  const cautious = profile.tempo === 'cautious'
  if (profile.archetype === 'defense-crisis') return cautious ? 0.22 : 0.28
  if (profile.archetype === 'air-superiority') return cautious ? 0.48 : 0.62
  if (profile.archetype === 'breakthrough') return cautious ? 0.42 : 0.55
  return cautious ? 0.3 : 0.42
}

/** Ambush sits forward of BARCAP, still short of the enemy town. */
export function flotAmbushDepth(profile: OperationProfile): number {
  if (profile.archetype === 'defense-crisis') return 0.72
  return 0.85
}

/** AWACS stays behind BARCAP on the same hop (0 = friendly town, 1 = hostile). */
export function flotAwacsDepth(profile: OperationProfile): number {
  const cautious = profile.tempo === 'cautious'
  if (profile.archetype === 'defense-crisis') return cautious ? 0.1 : 0.14
  if (profile.archetype === 'air-superiority') return cautious ? 0.2 : 0.28
  if (profile.archetype === 'breakthrough') return cautious ? 0.18 : 0.28
  return cautious ? 0.14 : 0.2
}

/** ECM sits between the AWACS and the BARCAP: 30–70 nm behind the FLOT in BMS. */
export function flotEcmDepth(profile: OperationProfile): number {
  const cautious = profile.tempo === 'cautious'
  if (profile.archetype === 'defense-crisis') return cautious ? 0.16 : 0.2
  if (profile.archetype === 'air-superiority') return cautious ? 0.28 : 0.36
  if (profile.archetype === 'breakthrough') return cautious ? 0.26 : 0.34
  return cautious ? 0.22 : 0.3
}

/** Fighter sweep pushes past BARCAP onto the hostile side of the hop. */
export function flotSweepDepth(profile: OperationProfile): number {
  const cautious = profile.tempo === 'cautious'
  if (profile.archetype === 'air-superiority') return cautious ? 0.72 : 0.82
  if (profile.archetype === 'breakthrough') return cautious ? 0.65 : 0.78
  return cautious ? 0.55 : 0.7
}
