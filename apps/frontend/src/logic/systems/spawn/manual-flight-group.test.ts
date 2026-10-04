import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { schemas } from '@dcc/contracts'
import { factions, theatres } from '@dcc/data'
import type * as z from 'zod'

import { calculateDistance } from '@/logic/utils/calculate-distance'
import { createManualFlightGroup } from './manual-flight-group'

type Campaign = z.infer<typeof schemas.campaign.campaign>
type CoalitionData = Campaign['coalitions']['player']

const campaignTime = new Date('1985-06-15T09:00:00.000Z')
const theatre = theatres.find((candidate) => candidate.name === 'Cold War Germany')!
const ramstein = theatre.airdromeDetails['Ramstein']!
const tegel = theatre.airdromeDetails['Tegel']!
const fightPosition = { x: ramstein.x + 60_000, y: ramstein.y + 60_000 }

function createCoalition(
  factionId: string,
  airdromeName: string,
  groundGroups: CoalitionData['groundGroups'] = []
): CoalitionData {
  const faction = factions.find((candidate) => candidate.id === factionId)!
  return {
    id: factionId,
    aircraftTypes: structuredClone(faction.aircraftTypes),
    groundUnitTypes: {} as CoalitionData['groundUnitTypes'],
    airdromeNames: [airdromeName],
    objectiveIds: [],
    structures: [],
    samGroups: [],
    groundGroups,
    flightGroups: [],
    packages: []
  }
}

function createCampaign(): Campaign {
  return {
    version: 'test',
    id: 'campaign-1',
    name: 'Test Campaign',
    createdAt: campaignTime,
    updatedAt: campaignTime,
    time: campaignTime,
    timeMultiplier: 1,
    logs: [],
    scenarioId: 'fulda-gap',
    coalitions: {
      player: createCoalition('west-germany-1985', 'Ramstein', [
        {
          id: 'ground-1',
          objectiveId: 'Fulda',
          targetObjectiveId: 'Vacha',
          position: fightPosition,
          state: 'combat',
          units: [{ name: 'Leopard1A3', count: 4 }]
        }
      ]),
      opponent: createCoalition('east-germany-1985', 'Tegel')
    }
  }
}

beforeEach(() => {
  vi.spyOn(Math, 'random').mockReturnValue(0)
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('manual Fighter Sweep', () => {
  test('sweeps the airspace over a ground fight and stops once that fight is covered', () => {
    const campaign = createCampaign()

    const flightGroupId = createManualFlightGroup(campaign, 'player', 'Fighter Sweep')
    const group = campaign.coalitions.player.flightGroups.find((fg) => fg.id === flightGroupId)

    expect(group?.task).toBe('Fighter Sweep')
    expect(group?.spawnSource).toBe('manual')
    expect(group?.aircrafts[0]?.aircraftName).toBe('F-4E-45MC')
    const sweep = group?.flightplan.waypoints.find((waypoint) => waypoint.name === 'Sweep')
    expect(sweep?.type).toBe('Task')
    expect(sweep?.position).toEqual(fightPosition)

    expect(createManualFlightGroup(campaign, 'player', 'Fighter Sweep')).toBeNull()
  })
})

describe('manual Training', () => {
  test('flies practice legs on the friendly side of the home base and lands', () => {
    const campaign = createCampaign()

    const flightGroupId = createManualFlightGroup(campaign, 'player', 'Training')
    const group = campaign.coalitions.player.flightGroups.find((fg) => fg.id === flightGroupId)

    expect(group?.task).toBe('Training')
    expect(group?.homeBase).toBe('Ramstein')
    const waypoints = group?.flightplan.waypoints ?? []
    expect(waypoints.at(-1)?.type).toBe('Landing')
    const legs = waypoints.filter((waypoint) => waypoint.name.startsWith('Training'))
    expect(legs).toHaveLength(4)

    const homeToEnemy = calculateDistance({ x: ramstein.x, y: ramstein.y }, tegel)
    const legCenter = {
      x: legs.reduce((sum, leg) => sum + leg.position.x, 0) / legs.length,
      y: legs.reduce((sum, leg) => sum + leg.position.y, 0) / legs.length
    }
    expect(calculateDistance(legCenter, tegel)).toBeGreaterThan(homeToEnemy)
  })
})

describe('aircraft lists saved before Training existed', () => {
  test('parse with an empty Training list', () => {
    const faction = factions.find((candidate) => candidate.id === 'usa-1977')!
    const { Training: _training, ...savedAircraftTypes } = faction.aircraftTypes

    const parsed = schemas.faction.parse({ ...faction, aircraftTypes: savedAircraftTypes })

    expect(parsed.aircraftTypes.Training).toEqual([])
    expect(schemas.resolveTaskAircraftTypes(parsed.aircraftTypes, 'Training')).toContain('F-4E-45MC')
  })
})
