import { describe, expect, test } from 'vitest'
import { schemas } from '@dcc/contracts'
import { theatres } from '@dcc/data'
import type * as z from 'zod'

import { updateSupply } from './update-supply'

type Campaign = z.infer<typeof schemas.campaign.campaign>
type CoalitionData = Campaign['coalitions']['player']

const campaignTime = new Date('2026-01-01T12:00:00.000Z')
const caucasus = theatres.find((theatre) => theatre.name === 'Caucasus')!
const kobuleti = caucasus.airdromeDetails.Kobuleti!
const enguriDam = caucasus.objectives.find((objective) => objective.name === 'Enguri Dam')!

function createAircraftTypes(): CoalitionData['aircraftTypes'] {
  return Object.fromEntries(
    schemas.task.options.map((task) => [task, [] as string[]])
  ) as CoalitionData['aircraftTypes']
}

function createGroundUnitTypes(): CoalitionData['groundUnitTypes'] {
  return Object.fromEntries(
    schemas.groundUnitType.options.map((type) => [type, [] as string[]])
  ) as CoalitionData['groundUnitTypes']
}

function createSupply(current: number, max: number, hub = false) {
  return {
    current,
    max,
    consumptionRate: 0,
    productionRate: hub ? 20 : 0,
    status: current / max > 0.75 ? ('abundant' as const) : ('critical' as const)
  }
}

function createCoalition(id: 'player' | 'opponent'): CoalitionData {
  return {
    id,
    aircraftTypes: createAircraftTypes(),
    groundUnitTypes: createGroundUnitTypes(),
    airdromeNames: id === 'player' ? ['Kobuleti'] : [],
    objectiveIds: id === 'player' ? ['Enguri Dam'] : [],
    structures: [],
    samGroups: [],
    groundGroups: [],
    flightGroups: [],
    packages: [],
    supplyNodes:
      id === 'player'
        ? {
            Kobuleti: createSupply(10_000, 10_000, true),
            'Enguri Dam': createSupply(100, 1_000)
          }
        : {}
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

describe('virtual logistics network', () => {
  test('initializes missing owned supply nodes during the logic tick', () => {
    const campaign = createCampaign()
    campaign.coalitions.player.supplyNodes = {}

    updateSupply(campaign, 'player')

    expect(campaign.coalitions.player.supplyNodes?.Kobuleti).toMatchObject({
      max: 10_000,
      productionRate: 700
    })
    expect(campaign.coalitions.player.supplyNodes?.['Enguri Dam']).toMatchObject({
      max: 1_000,
      productionRate: 0
    })
  })

  test('upgrades existing objective-sized supply for owned airdromes', () => {
    const campaign = createCampaign()
    campaign.coalitions.opponent.airdromeNames = ['Sukhumi-Babushara']
    campaign.coalitions.opponent.objectiveIds = ['Sukhumi-Babushara']
    campaign.coalitions.opponent.supplyNodes = {
      'Sukhumi-Babushara': createSupply(500, 1_000)
    }

    updateSupply(campaign, 'opponent')

    const supply = campaign.coalitions.opponent.supplyNodes?.['Sukhumi-Babushara']
    expect(supply).toMatchObject({
      max: 10_000,
      productionRate: 700,
      logistics: { hub: true, hubLevel: 2 }
    })
    expect(supply?.current).toBeGreaterThanOrEqual(5_000)
    expect(supply?.fuel?.current).toBeGreaterThan(2_000)
  })

  test('scales production and route transfer by fast-forwarded campaign time', () => {
    const campaign = createCampaign()
    campaign.timeMultiplier = 300
    campaign.coalitions.player.supplyNodes!.Kobuleti.current = 5_000
    campaign.coalitions.player.supplyNodes!['Enguri Dam'].current = 100

    const slow = createCampaign()
    slow.coalitions.player.supplyNodes!.Kobuleti.current = 5_000
    slow.coalitions.player.supplyNodes!['Enguri Dam'].current = 100

    updateSupply(campaign, 'player', 1_000)
    updateSupply(slow, 'player', 1_000)

    const fastForward = campaign.coalitions.player.supplyNodes?.['Enguri Dam'].current ?? 0
    const normal = slow.coalitions.player.supplyNodes?.['Enguri Dam'].current ?? 0
    expect(fastForward).toBeGreaterThan(normal)
    expect(fastForward).toBeLessThan(1_000)
    expect(campaign.coalitions.player.supplyNodes?.Kobuleti.current ?? 0).toBeGreaterThan(4_000)
  })

  test('moves supply from a hub to a low owned node over a virtual route', () => {
    const campaign = createCampaign()

    updateSupply(campaign, 'player')

    const destination = campaign.coalitions.player.supplyNodes?.['Enguri Dam']
    expect(destination?.current).toBeGreaterThan(100)
    expect(destination?.fuel?.current).toBeGreaterThan(45)
    expect(destination?.logistics?.routes[0]).toMatchObject({
      from: 'Kobuleti',
      to: 'Enguri Dam'
    })
  })

  test('enemy ground interdiction reduces route throughput', () => {
    const clearRoute = createCampaign()
    const interdictedRoute = createCampaign()
    interdictedRoute.coalitions.opponent.groundGroups.push({
      id: 'interdictor-1',
      position: {
        x: (kobuleti.x + enguriDam.position.x) / 2,
        y: (kobuleti.y + enguriDam.position.y) / 2
      },
      units: [{ name: 'BMP-2', count: 3 }],
      state: 'idle'
    })

    updateSupply(clearRoute, 'player')
    updateSupply(interdictedRoute, 'player')

    const clearCurrent = clearRoute.coalitions.player.supplyNodes?.['Enguri Dam']?.current ?? 0
    const interdictedCurrent =
      interdictedRoute.coalitions.player.supplyNodes?.['Enguri Dam']?.current ?? 0
    const routeDisruption =
      interdictedRoute.coalitions.player.supplyNodes?.['Enguri Dam']?.logistics?.routes[0]
        ?.disruption

    expect(interdictedCurrent).toBeLessThan(clearCurrent)
    expect(routeDisruption).toBeGreaterThan(0.5)
  })

  test('a destroyed depot raises interdiction and starves the objective', () => {
    const clearRoute = createCampaign()
    const smashedDepot = createCampaign()
    smashedDepot.coalitions.player.structures.push({
      id: 'depot-1',
      type: 'Depot',
      objectiveId: 'Enguri Dam',
      position: { ...enguriDam.position },
      name: 'Depot',
      resources: 0,
      buildings: [{ offset: { x: 0, y: 0 }, type: 'Garage B', alive: false }]
    })

    updateSupply(clearRoute, 'player')
    updateSupply(smashedDepot, 'player')

    const clearCurrent = clearRoute.coalitions.player.supplyNodes?.['Enguri Dam']?.current ?? 0
    const smashedCurrent =
      smashedDepot.coalitions.player.supplyNodes?.['Enguri Dam']?.current ?? 0

    expect(
      smashedDepot.coalitions.player.supplyNodes?.['Enguri Dam']?.logistics?.interdiction
    ).toBeGreaterThanOrEqual(0.6)
    expect(smashedCurrent).toBeLessThan(clearCurrent)
  })
})
