import { schemas } from '@dcc/contracts'
import type * as z from 'zod'

import { factions } from './factions'
import { authoredIadsEquipmentKey } from './iads/eras'
import { findAuthoredIadsSite } from './iads/network'
import { templates } from './templates'

type Campaign = z.infer<typeof schemas.campaign.campaign>
type PlayerSide = NonNullable<Campaign['playerSide']>

export const DEFAULT_ESCALATION_ERA_DAYS = 8
export const MS_PER_ESCALATION_DAY = 86_400_000

export const ESCALATION_STAGES = ['Korea', 'Vietnam', 'Late CW', 'Modern'] as const
export type EscalationStage = (typeof ESCALATION_STAGES)[number]

export const ESCALATION_FACTION_IDS: Record<EscalationStage, { player: string; opponent: string }> =
  {
    Korea: { player: 'usa-germany-1955', opponent: 'russia-germany-1955' },
    Vietnam: { player: 'usa-germany-1967', opponent: 'russia-germany-1967' },
    'Late CW': { player: 'usa-1977', opponent: 'russia-1984' },
    Modern: { player: 'usa-2004', opponent: 'russia-1996' }
  }

/**
 * Theatres built for the USAFE/GSFG ladder: a linear front on a hop graph, and the escalation
 * faction presets as the default pairing for every era.
 */
const COLD_WAR_FRONT_THEATRES = new Set(['Cold War Germany', 'Cold War Caucasus'])

export function isColdWarFrontTheatre(theatreName: string | undefined) {
  return theatreName != null && COLD_WAR_FRONT_THEATRES.has(theatreName)
}

export function clampEscalationEraDays(days: number | undefined) {
  if (days == null || !Number.isFinite(days)) return DEFAULT_ESCALATION_ERA_DAYS
  return Math.min(30, Math.max(1, Math.round(days)))
}

export function nextEscalationStage(stage: EscalationStage): EscalationStage | undefined {
  const index = ESCALATION_STAGES.indexOf(stage)
  if (index < 0) return undefined
  return ESCALATION_STAGES[index + 1]
}

export function escalationProgress(now: Date, startedAt: Date, eraDurationDays: number) {
  const span = clampEscalationEraDays(eraDurationDays) * MS_PER_ESCALATION_DAY
  if (span <= 0) return 1
  return Math.max(0, Math.min(1, (now.getTime() - startedAt.getTime()) / span))
}

export function campaignIadsEra(campaign: {
  era?: string
  escalation?: { enabled?: boolean; stage?: string }
}) {
  if (campaign.escalation?.enabled) {
    return campaign.escalation.stage ?? campaign.era ?? 'Korea'
  }
  return campaign.era
}

export function escalationDaysRemaining(now: Date, startedAt: Date, eraDurationDays: number) {
  const span = clampEscalationEraDays(eraDurationDays) * MS_PER_ESCALATION_DAY
  const remaining = span - (now.getTime() - startedAt.getTime())
  return Math.max(0, Math.ceil(remaining / MS_PER_ESCALATION_DAY))
}

export function resolveCreateCampaignEra<T extends string>(
  era: T,
  escalation?: boolean
): T | 'Korea' {
  return escalation ? 'Korea' : era
}

export function createInitialEscalation(startedAt: Date, eraDurationDays?: number) {
  const days = clampEscalationEraDays(eraDurationDays)
  return {
    enabled: true as const,
    stage: 'Korea' as const,
    stageStartedAt: startedAt,
    eraDurationDays: days,
    history: [{ stage: 'Korea' as const, startedAt }]
  }
}

export function escalationFactionIds(stage: EscalationStage, playerSide: PlayerSide = 'blue') {
  const ids = ESCALATION_FACTION_IDS[stage]
  if (playerSide === 'red') {
    return { player: ids.opponent, opponent: ids.player }
  }
  return ids
}

function cloneAircraftTypes<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}

function applyFactionKit(
  coalition: Campaign['coalitions']['player'],
  faction: (typeof factions)[number]
) {
  coalition.id = faction.id
  coalition.countryName = faction.countryName
  coalition.aircraftTypes = cloneAircraftTypes(faction.aircraftTypes)
  const template = templates.find((entry) => entry.name === faction.templateName)
  if (template) {
    coalition.groundUnitTypes = cloneAircraftTypes(template.groundUnitTypes)
  }
}

export function applyEscalationAircraftTypes(campaign: Campaign, stage: EscalationStage) {
  const ids = escalationFactionIds(stage, campaign.playerSide ?? 'blue')
  const playerFaction = factions.find((faction) => faction.id === ids.player)
  const opponentFaction = factions.find((faction) => faction.id === ids.opponent)
  if (playerFaction) applyFactionKit(campaign.coalitions.player, playerFaction)
  if (opponentFaction) applyFactionKit(campaign.coalitions.opponent, opponentFaction)
}

export function pruneIadsDeadUnitsForEraChange(
  deadUnits: Campaign['iadsDeadUnits'],
  fromEra: string,
  toEra: string
) {
  if (deadUnits == null) return deadUnits
  const next = { ...deadUnits }
  let changed = false

  for (const siteId of Object.keys(deadUnits)) {
    const site = findAuthoredIadsSite(siteId)
    if (!site) continue
    if (authoredIadsEquipmentKey(site, fromEra) === authoredIadsEquipmentKey(site, toEra)) continue
    delete next[siteId]
    changed = true
  }

  if (!changed) return deadUnits
  return Object.keys(next).length > 0 ? next : undefined
}
