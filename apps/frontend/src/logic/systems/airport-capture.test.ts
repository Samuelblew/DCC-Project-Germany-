import { afterEach, describe, expect, test, vi } from 'vitest'
import { schemas } from '@dcc/contracts'
import { theatres } from '@dcc/data'
import type * as z from 'zod'

import { craterAirdrome, getNearbyObjectiveIds, isAirdromeRecovering, isAirdromeVulnerable } from './airport-capture'
import { spawnGroundGroups } from './spawn/ground-groups'
import { updateGroundGroups } from './update-ground-groups'

type Campaign = z.infer<typeof schemas.campaign.campaign>
type CoalitionData = Campaign['coalitions']['player']
type Theatre = z.infer<typeof schemas.theatre>

const campaignTime = new Date('2026-01-01T12:00:00.000Z')
const caucasus = theatres.find((theatre) => theatre.name === 'Caucasus')!

afterEach(() => {
  vi.restoreAllMocks()
})

function createSupply(current = 1_000) {
  return {
    current,
    max: 2_000,
    consumptionRate: 0,
    productionRate: 0,
    status: 'adequate' as const
  }
}

function createCoalition(id: 'player' | 'opponent'): CoalitionData {
  return {
    id,
    aircraftTypes: {
      CAP: ['F-16C_50'],
      'Pinpoint Strike': ['F-16C_50'],
      'Strategic Strike': ['B-52H'],
      SEAD: ['F-16C_50'],
      DEAD: ['F-16C_50'],
      CAS: ['F-16C_50'],
      Transport: ['UH-60L']
    } as CoalitionData['aircraftTypes'],
    groundUnitTypes: {
      Infantry: ['Infantry AK'],
      Vehicle: ['BMP-2']
    } as CoalitionData['groundUnitTypes'],
    airdromeNames: [],
    objectiveIds: [],
    structures: [],
    samGroups: [],
    groundGroups: [],
    flightGroups: [],
    packages: [],
    supplyNodes: {}
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
    scenarioId: 'red-bullet',
    coalitions: {
      player: createCoalition('player'),
      opponent: createCoalition('opponent')
    }
  }
}

/** An idle formation already holding the objective, so newly raised formations may attack. */
function addGarrison(
  campaign: Campaign,
  objective: { name: string; position: Theatre['objectives'][number]['position'] }
) {
  campaign.coalitions.player.groundGroups.push({
    id: `garrison-${objective.name}`,
    objectiveId: objective.name,
    position: { ...objective.position },
    units: [{ name: 'Infantry AK', count: 10 }],
    state: 'idle'
  })
}

function giveObjectiveMajority(
  campaign: Campaign,
  theatre: Theatre,
  coalition: 'player' | 'opponent',
  airdromeName: string
) {
  const nearbyObjectiveIds = getNearbyObjectiveIds(theatre, airdromeName)
  const requiredCount = Math.floor(nearbyObjectiveIds.length / 2) + 1
  campaign.coalitions[coalition].objectiveIds = nearbyObjectiveIds.slice(0, requiredCount)
}

describe('airport vulnerability', () => {
  test('requires strict majority of nearby objectives', () => {
    const campaign = createCampaign()
    const nearbyObjectiveIds = getNearbyObjectiveIds(caucasus, 'Sukhumi-Babushara')
    const halfCount = Math.floor(nearbyObjectiveIds.length / 2)

    campaign.coalitions.player.objectiveIds = nearbyObjectiveIds.slice(0, halfCount)
    expect(isAirdromeVulnerable(campaign, caucasus, 'player', 'Sukhumi-Babushara')).toBe(false)

    campaign.coalitions.player.objectiveIds = nearbyObjectiveIds.slice(0, halfCount + 1)
    expect(isAirdromeVulnerable(campaign, caucasus, 'player', 'Sukhumi-Babushara')).toBe(true)
  })

  test('allows direct attack when no objectives are near an airport', () => {
    const theatre = {
      name: 'Test',
      objectives: [],
      targets: {},
      airdromeDetails: {
        Remote: {
          id: 1,
          name: 'Remote',
          x: 0,
          y: 0,
          standlist: {},
          frequency: 250,
          runwayAngle: 0
        }
      },
      info: {
        center: { x: 0, y: 0 },
        weather: {
          temperature: { amplitude: 0, mean: 20 },
          cloudCover: { baseCloudCover: 0, seasonEffect: 0 },
          wind: { speed: 0, direction: 0 }
        },
        night: { startHour: 20, endHour: 6 }
      }
    } as Theatre
    const campaign = createCampaign()

    expect(isAirdromeVulnerable(campaign, theatre, 'player', 'Remote')).toBe(true)
  })
})

describe('airport capture', () => {
  test('transfers ownership, supply, and clears the capturing group target', () => {
    const campaign = createCampaign()
    const airdrome = caucasus.airdromeDetails['Sukhumi-Babushara']!
    giveObjectiveMajority(campaign, caucasus, 'player', 'Sukhumi-Babushara')
    campaign.coalitions.player.airdromeNames = ['Kobuleti']
    campaign.coalitions.opponent.airdromeNames = ['Sukhumi-Babushara']
    campaign.coalitions.opponent.supplyNodes = {
      'Sukhumi-Babushara': createSupply(900)
    }
    campaign.coalitions.player.groundGroups.push({
      id: 'attacker-1',
      position: { x: airdrome.x, y: airdrome.y },
      units: [{ name: 'BMP-2', count: 3 }],
      state: 'moving',
      targetAirdromeName: 'Sukhumi-Babushara'
    })

    updateGroundGroups(campaign, 'player', 1_000, { move: false })

    expect(campaign.coalitions.player.airdromeNames).toContain('Sukhumi-Babushara')
    expect(campaign.coalitions.opponent.airdromeNames).not.toContain('Sukhumi-Babushara')
    expect(campaign.coalitions.player.supplyNodes?.['Sukhumi-Babushara']?.current).toBe(700)
    expect(
      campaign.coalitions.player.supplyNodes?.['Sukhumi-Babushara']?.logistics?.recoveryUntil
    ).toEqual(new Date('2026-01-01T13:00:00.000Z'))
    expect(campaign.coalitions.opponent.supplyNodes?.['Sukhumi-Babushara']).toBeUndefined()
    expect(campaign.coalitions.player.groundGroups[0]).toMatchObject({
      state: 'idle',
      objectiveId: 'Sukhumi-Babushara',
      targetAirdromeName: undefined
    })
  })

  test('OCA craters a field so it stays in recovery', () => {
    const campaign = createCampaign()
    campaign.coalitions.opponent.airdromeNames = ['Sukhumi-Babushara']
    craterAirdrome(campaign, 'opponent', 'Sukhumi-Babushara', campaignTime)

    expect(isAirdromeRecovering(campaign, 'opponent', 'Sukhumi-Babushara', campaignTime)).toBe(true)
    expect(
      campaign.coalitions.opponent.supplyNodes?.['Sukhumi-Babushara']?.logistics?.recoveryUntil
    ).toEqual(new Date(campaignTime.getTime() + 4 * 60 * 60 * 1000))
  })
})

describe('campaign goals', () => {
  test('wins Red Bullet when the player captures Enguri Dam', () => {
    const campaign = createCampaign()
    const objective = caucasus.objectives.find((entry) => entry.name === 'Enguri Dam')!
    campaign.goal = {
      coalition: 'player',
      objectiveIds: ['Enguri Dam']
    }
    campaign.coalitions.opponent.objectiveIds = [objective.name]
    campaign.coalitions.player.groundGroups.push({
      id: 'attacker-1',
      position: { ...objective.position },
      units: [{ name: 'BMP-2', count: 3 }],
      state: 'moving',
      targetObjectiveId: objective.name
    })

    updateGroundGroups(campaign, 'player', 1_000, { move: false })

    expect(campaign.status).toBe('won')
    expect(campaign.timeMultiplier).toBe(1)
    expect(campaign.logs.at(-1)?.message).toBe('Campaign won: player controls Enguri Dam')
  })
})

describe('ground battle attrition', () => {
  test('preserves the randomly advantaged side during otherwise mutual destruction', () => {
    const campaign = createCampaign()
    const objective = caucasus.objectives.find((entry) => entry.name === 'Bataria')!
    campaign.coalitions.opponent.objectiveIds = [objective.name]
    campaign.coalitions.player.groundGroups.push({
      id: 'attacker-1',
      position: { ...objective.position },
      units: [{ name: 'BMP-2', count: 1 }],
      state: 'moving',
      targetObjectiveId: objective.name
    })
    campaign.coalitions.opponent.groundGroups.push({
      id: 'defender-1',
      objectiveId: objective.name,
      position: { ...objective.position },
      units: [{ name: 'BMP-2', count: 1 }],
      state: 'idle'
    })
    vi.spyOn(Math, 'random').mockReturnValue(0)

    updateGroundGroups(campaign, 'player', 60_000, { move: false })

    expect(campaign.coalitions.player.groundGroups).toHaveLength(1)
    expect(
      campaign.coalitions.player.groundGroups[0]?.units.reduce((sum, unit) => sum + unit.count, 0)
    ).toBe(1)
    expect(campaign.coalitions.opponent.groundGroups).toHaveLength(0)
  })
})

describe('ground group spawning airport targets', () => {
  test('continues targeting enemy objectives before farther vulnerable airports', () => {
    const campaign = createCampaign()
    const source = caucasus.objectives.find((entry) => entry.name === 'Hidmagala')!
    campaign.coalitions.player.objectiveIds = ['Maharadze', 'Hidmagala']
    campaign.coalitions.opponent.objectiveIds = ['Bataria']
    campaign.coalitions.opponent.airdromeNames = ['Sukhumi-Babushara']
    campaign.coalitions.player.structures.push({
      id: 'depot-1',
      type: 'Depot',
      objectiveId: source.name,
      position: { ...source.position },
      name: 'Depot',
      resources: 1_000,
      buildings: [{ offset: { x: 0, y: 0 }, type: 'Tech hangar A', alive: true }]
    })

    addGarrison(campaign, source)

    spawnGroundGroups(campaign, 'player')

    expect(campaign.coalitions.player.groundGroups[1]?.targetObjectiveId).toBe('Bataria')
    expect(campaign.coalitions.player.groundGroups[1]?.targetAirdromeName).toBeUndefined()
  })

  test('targets a vulnerable airport when it is closer than valid objectives', () => {
    const campaign = createCampaign()
    const source = caucasus.objectives.find((entry) => entry.name === 'Ochamchira')!
    giveObjectiveMajority(campaign, caucasus, 'player', 'Sukhumi-Babushara')
    campaign.coalitions.opponent.objectiveIds = ['Nalchik']
    campaign.coalitions.opponent.airdromeNames = ['Sukhumi-Babushara']
    campaign.coalitions.player.structures.push({
      id: 'depot-1',
      type: 'Depot',
      objectiveId: source.name,
      position: { ...source.position },
      name: 'Depot',
      resources: 1_000,
      buildings: [{ offset: { x: 0, y: 0 }, type: 'Tech hangar A', alive: true }]
    })

    addGarrison(campaign, source)

    spawnGroundGroups(campaign, 'player')

    expect(campaign.coalitions.player.groundGroups[1]?.targetAirdromeName).toBe('Sukhumi-Babushara')
    expect(campaign.coalitions.player.groundGroups[1]?.targetObjectiveId).toBeUndefined()
  })

  test('ignores non-vulnerable airports', () => {
    const campaign = createCampaign()
    const source = caucasus.objectives.find((entry) => entry.name === 'Ochamchira')!
    campaign.coalitions.opponent.objectiveIds = []
    campaign.coalitions.opponent.airdromeNames = ['Sukhumi-Babushara']
    campaign.coalitions.player.structures.push({
      id: 'depot-1',
      type: 'Depot',
      objectiveId: source.name,
      position: { ...source.position },
      name: 'Depot',
      resources: 1_000,
      buildings: [{ offset: { x: 0, y: 0 }, type: 'Tech hangar A', alive: true }]
    })

    addGarrison(campaign, source)

    spawnGroundGroups(campaign, 'player')

    expect(campaign.coalitions.player.groundGroups[1]?.targetAirdromeName).toBeUndefined()
    expect(campaign.coalitions.player.groundGroups[1]?.targetObjectiveId).toBeUndefined()
  })
})
