import { describe, expect, test } from 'vitest'
import { schemas } from '@dcc/contracts'
import {
  applyEscalationAircraftTypes,
  createInitialEscalation,
  factions,
  MS_PER_ESCALATION_DAY,
  resolveCreateCampaignEra
} from '@dcc/data'
import { produce } from 'immer'
import type * as z from 'zod'

import { updateEscalation } from './update-escalation'

type Campaign = z.infer<typeof schemas.campaign.campaign>
type CoalitionData = Campaign['coalitions']['player']

const start = new Date('1985-06-15T09:00:00.000Z')

function coalition(id: 'player' | 'opponent'): CoalitionData {
  return {
    id,
    aircraftTypes: { CAP: ['Tu-95MS'] } as CoalitionData['aircraftTypes'],
    groundUnitTypes: {} as CoalitionData['groundUnitTypes'],
    airdromeNames: [],
    objectiveIds: [],
    structures: [],
    samGroups: [],
    groundGroups: [],
    flightGroups: [],
    packages: []
  }
}

function campaign(overrides: Partial<Campaign> = {}): Campaign {
  return {
    version: 'test',
    id: 'escalation',
    name: 'Escalation',
    createdAt: start,
    updatedAt: start,
    time: start,
    era: 'Korea',
    playerSide: 'blue',
    timeMultiplier: 1,
    logs: [],
    scenarioId: 'fulda-gap',
    escalation: createInitialEscalation(start, 8),
    coalitions: {
      player: coalition('player'),
      opponent: coalition('opponent')
    },
    ...overrides
  }
}

function advance(draft: Campaign, days: number) {
  draft.time = new Date(draft.time.getTime() + days * MS_PER_ESCALATION_DAY)
  updateEscalation(draft)
}

describe('campaign escalation', () => {
  test('create with Escalation starts in Korea even on a Late CW scenario', () => {
    expect(resolveCreateCampaignEra('Late CW', true)).toBe('Korea')
    expect(resolveCreateCampaignEra('Modern', false)).toBe('Modern')
    expect(createInitialEscalation(start, 8)).toMatchObject({
      enabled: true,
      stage: 'Korea',
      eraDurationDays: 8
    })
  })

  test('after 8 days the generation jumps to Vietnam and swaps the opponent fleet', () => {
    const korea = factions.find((faction) => faction.id === 'usa-germany-1955')!
    const vietnam = factions.find((faction) => faction.id === 'russia-germany-1967')!
    const state = produce(campaign(), (draft) => {
      applyEscalationAircraftTypes(draft, 'Korea')
      draft.coalitions.opponent.flightGroups.push({
        id: 'old-cap',
        aircrafts: [{ id: 'a1', unitName: 'Dodge-1', aircraftName: 'MiG-15bis' }],
        task: 'CAP',
        position: { x: 0, y: 0 },
        homeBase: 'Fulda',
        callsign: 'Dodge-1',
        flightplan: { id: 'plan', startTime: start, waypoints: [] }
      })
      draft.coalitions.player.groundGroups.push({
        id: 'armor',
        position: { x: 0, y: 0 },
        state: 'idle',
        units: [{ name: 'M4_Sherman', count: 4 }]
      })
    })

    expect(state.coalitions.player.aircraftTypes.CAP).toEqual(korea.aircraftTypes.CAP)

    const next = produce(state, (draft) => {
      advance(draft, 8)
    })

    expect(next.era).toBe('Vietnam')
    expect(next.escalation?.stage).toBe('Vietnam')
    expect(next.coalitions.player.id).toBe('usa-germany-1967')
    expect(next.coalitions.opponent.id).toBe('russia-germany-1967')
    expect(next.coalitions.opponent.aircraftTypes.CAP).toEqual(vietnam.aircraftTypes.CAP)
    expect(next.coalitions.player.groundUnitTypes.SAM).toEqual(['Hawk'])
    expect(next.coalitions.opponent.groundUnitTypes.SAM).toEqual(['SA-2', 'SA-5'])
    expect(next.coalitions.opponent.flightGroups).toHaveLength(1)
    expect(next.coalitions.opponent.packages).toHaveLength(0)
    expect(next.coalitions.opponent.flightGroups[0]?.flightplan.waypoints.at(-1)?.type).toBe(
      'Landing'
    )
    expect(next.coalitions.player.groundGroups[0]?.units[0]?.name).toBe('M-113')
    expect(next.logs.some((entry) => entry.message.includes('recovering to base'))).toBe(true)
  })

  test('Germany 1950s fleets use USAFE Sabres and GSFG MiGs, not Korean War leftovers', () => {
    const next = produce(campaign(), (draft) => {
      applyEscalationAircraftTypes(draft, 'Korea')
    })
    const playerTypes = Object.values(next.coalitions.player.aircraftTypes).flat()
    const opponentTypes = Object.values(next.coalitions.opponent.aircraftTypes).flat()

    expect(playerTypes).toContain('F-86F Sabre')
    expect(playerTypes).not.toContain('MosquitoFBMkVI')
    expect(opponentTypes).toContain('MiG-15bis')
    expect(opponentTypes).not.toContain('Ju-88A4')
    expect(next.coalitions.player.id).toBe('usa-germany-1955')
    expect(next.coalitions.opponent.id).toBe('russia-germany-1955')
    expect(next.coalitions.player.groundUnitTypes.Vehicle?.[0]).toBe('M4_Sherman')
    expect(next.coalitions.opponent.groundUnitTypes.Vehicle).toEqual(['T-55', 'PT_76'])
    expect(next.coalitions.player.groundUnitTypes.SAM).toEqual([])
    expect(next.coalitions.opponent.groundUnitTypes.SAM).toEqual([])
  })

  test('a 2-day era duration jumps earlier', () => {
    const next = produce(campaign({ escalation: createInitialEscalation(start, 2) }), (draft) => {
      applyEscalationAircraftTypes(draft, 'Korea')
      advance(draft, 2)
    })

    expect(next.escalation?.stage).toBe('Vietnam')
    expect(next.era).toBe('Vietnam')
  })

  test('Modern does not advance', () => {
    const next = produce(
      campaign({
        era: 'Modern',
        escalation: {
          enabled: true,
          stage: 'Modern',
          stageStartedAt: start,
          eraDurationDays: 8,
          history: [{ stage: 'Modern', startedAt: start }]
        }
      }),
      (draft) => {
        advance(draft, 8)
      }
    )

    expect(next.escalation?.stage).toBe('Modern')
    expect(next.era).toBe('Modern')
    expect(next.logs).toHaveLength(0)
  })

  test('a new IADS generation forgets destroyed units from the previous battery', () => {
    const next = produce(
      campaign({
        germanyIadsDeadUnits: { 'SAM-SA2-1': ['SAM-SA2-1-2'] }
      }),
      (draft) => {
        applyEscalationAircraftTypes(draft, 'Korea')
        advance(draft, 8)
      }
    )

    expect(next.germanyIadsDeadUnits?.['SAM-SA2-1']).toBeUndefined()
  })
})
