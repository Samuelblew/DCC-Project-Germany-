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

  test('the hub loads a convoy; the node only gains supply when it arrives', () => {
    const campaign = createCampaign()
    campaign.timeMultiplier = 600

    updateSupply(campaign, 'player', 1_000)

    const convoys = campaign.coalitions.player.supplyConvoys ?? []
    expect(convoys).toHaveLength(1)
    expect(convoys[0]).toMatchObject({ kind: 'road', from: 'Kobuleti', to: 'Enguri Dam' })
    expect(convoys[0]!.cargo.supply).toBeGreaterThan(50)
    // It forms up on the road outside the airfield, not on the runway.
    expect(
      Math.hypot(convoys[0]!.position.x - kobuleti.x, convoys[0]!.position.y - kobuleti.y)
    ).toBeGreaterThan(2_000)
    expect(campaign.coalitions.player.supplyNodes?.['Enguri Dam']?.current).toBe(100)

    for (
      let tick = 0;
      tick < 200 && (campaign.coalitions.player.supplyConvoys ?? []).length > 0;
      tick += 1
    ) {
      updateSupply(campaign, 'player', 1_000)
    }

    const destination = campaign.coalitions.player.supplyNodes?.['Enguri Dam']
    expect(destination?.current).toBeGreaterThan(100)
    expect(destination?.fuel?.current).toBeGreaterThan(45)
  })

  test('a convoy driven by a running DCS mission is not moved by the campaign', () => {
    const campaign = createCampaign()
    campaign.timeMultiplier = 600
    updateSupply(campaign, 'player', 1_000)
    const convoy = campaign.coalitions.player.supplyConvoys![0]!
    const before = { ...convoy.position }

    updateSupply(campaign, 'player', 1_000, new Set([convoy.id]))

    expect(campaign.coalitions.player.supplyConvoys![0]!.position).toEqual(before)
  })

  test('one convoy per route per dispatch interval', () => {
    const campaign = createCampaign()

    updateSupply(campaign, 'player', 1_000)
    updateSupply(campaign, 'player', 1_000)

    expect(campaign.coalitions.player.supplyConvoys).toHaveLength(1)
  })

  test('enemy ground interdiction sends a smaller lift by air', () => {
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

    const clear = clearRoute.coalitions.player.supplyConvoys![0]!
    const interdicted = interdictedRoute.coalitions.player.supplyConvoys![0]!
    expect(interdicted.kind).toBe('air')
    expect(interdicted.cargo.supply).toBeLessThan(clear.cargo.supply)
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

    const clearCurrent = clearRoute.coalitions.player.supplyConvoys![0]!.cargo.supply
    const smashedCurrent = smashedDepot.coalitions.player.supplyConvoys![0]!.cargo.supply

    expect(
      smashedDepot.coalitions.player.supplyNodes?.['Enguri Dam']?.logistics?.interdiction
    ).toBeGreaterThanOrEqual(0.6)
    expect(smashedCurrent).toBeLessThan(clearCurrent)
  })
})
