import { aircrafts as aircraftDefinitions, ESCALATION_FACTION_IDS, scenarios } from '@dcc/data'
import { schemas } from '@dcc/contracts'
import * as z from 'zod'

export type CampaignEra = 'Korea' | 'Vietnam' | 'Late CW' | 'Modern'
export type ScenarioStep = 'scenario' | 'era' | 'factions'
export type Scenario = (typeof scenarios)[number]
export type Faction = z.infer<typeof schemas.faction>
export type PlayerSide = 'blue' | 'red'

/** Default pairing for theatres that are not Cold War Germany. */
export const factionIdsByEra: Record<CampaignEra, { player: string; opponent: string }> = {
  Korea: { player: 'usa-1952', opponent: 'russia-1955' },
  Vietnam: { player: 'usa-vietnam', opponent: 'russia-vietnam' },
  'Late CW': { player: 'usa-1977', opponent: 'russia-1971' },
  Modern: { player: 'usa-2004', opponent: 'russia-1996' }
}

export function factionIdsForEra(
  era: CampaignEra,
  theatreName?: string
): { player: string; opponent: string } {
  if (theatreName === 'Cold War Germany') return ESCALATION_FACTION_IDS[era]
  return factionIdsByEra[era]
}

export function getScenarioCampaignDefaults(scenario: Scenario | undefined): {
  era: CampaignEra
  playerFactionId: string
  opponentFactionId: string
} {
  const era = scenario?.era != null && scenario.era !== 'WW2' ? scenario.era : 'Modern'
  const eraDefaults = factionIdsForEra(era, scenario?.theatreName)

  return {
    era,
    playerFactionId: scenario?.defaultFactionIds?.player ?? eraDefaults.player,
    opponentFactionId: scenario?.defaultFactionIds?.opponent ?? eraDefaults.opponent
  }
}

export const eraOptions: Array<{
  id: CampaignEra
  label: string
  callsign: string
  description: string
}> = [
  {
    id: 'Korea',
    label: 'Korea',
    callsign: 'ANALOG AGE',
    description: 'Korean War-era aircraft with sparse electronics and close-range fights.'
  },
  {
    id: 'Vietnam',
    label: 'Vietnam',
    callsign: 'JUNGLE AGE',
    description: '1960s-era aircraft and helicopters with early missiles and close air support.'
  },
  {
    id: 'Late CW',
    label: 'Late Cold War',
    callsign: 'MISSILE AGE',
    description: '1979–1991 aircraft and weapons with early BVR tactics and heavier SAM coverage.'
  },
  {
    id: 'Modern',
    label: 'Modern',
    callsign: 'DIGITAL AGE',
    description: 'Contemporary aircraft, advanced weapons, and high-tempo operations.'
  }
]

export const escalationEraOption = {
  id: 'Escalation' as const,
  label: 'Escalation',
  callsign: 'FULDA CLOCK',
  description:
    'Same German theatre. USAFE and GSFG start with 1950s kit and climb through Vietnam-era, Late Cold War and Modern on the campaign clock.'
}

export const eraMenuOptions = [...eraOptions, escalationEraOption]

export function formatFactionLabel(faction: Faction) {
  return faction.year != null ? `${faction.name} // ${faction.year}` : faction.name
}

export function getCampaignYearForFactions(
  factions: Faction[],
  playerFactionId: string,
  opponentFactionId: string,
  fallbackYear: number
) {
  const factionYears = [playerFactionId, opponentFactionId]
    .map((factionId) => factions.find((faction) => faction.id === factionId)?.year)
    .filter((year): year is number => year != null)

  return factionYears.length > 0 ? Math.max(...factionYears) : fallbackYear
}

export const aircraftCatalog = Object.values(aircraftDefinitions).sort((left, right) =>
  left.display_name.localeCompare(right.display_name)
)

export function getFactionAircraft(faction: Faction | undefined) {
  if (!faction) return []

  const rolesByAircraft = new Map<string, string[]>()
  for (const [role, aircraftNames] of Object.entries(faction.aircraftTypes)) {
    for (const aircraftName of aircraftNames) {
      const roles = rolesByAircraft.get(aircraftName) ?? []
      roles.push(role)
      rolesByAircraft.set(aircraftName, roles)
    }
  }

  return Array.from(rolesByAircraft, ([name, roles]) => {
    const definition = aircraftCatalog.find((candidate) => candidate.name === name)
    return {
      name,
      displayName: definition?.display_name ?? name,
      controllable: definition?.controllable ?? false,
      isHelicopter: definition?.isHelicopter ?? false,
      isMod: definition?.isMod ?? false,
      roles
    }
  }).sort((left, right) => left.displayName.localeCompare(right.displayName))
}

export type FactionAircraft = ReturnType<typeof getFactionAircraft>[number]
