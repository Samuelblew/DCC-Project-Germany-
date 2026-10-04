import { afterEach, describe, expect, test, vi } from 'vitest'
import { schemas } from '@dcc/contracts'
import { theatres } from '@dcc/data'
import type * as z from 'zod'

import { updateCampaignGoal } from './campaign-goal'
import { spawnGroundGroups } from './spawn/ground-groups'
import { resolveFieldEngagements, updateGroundGroups } from './update-ground-groups'

type Campaign = z.infer<typeof schemas.campaign.campaign>
type CoalitionData = Campaign['coalitions']['player']
type GroundGroup = z.infer<typeof schemas.groundGroup>

const campaignTime = new Date('2026-01-01T12:00:00.000Z')
const germany = theatres.find((theatre) => theatre.name === 'Cold War Germany')!
const objective = (name: string) => germany.objectives.find((entry) => entry.name === name)!
// Geisa (NATO) and Vacha (Pact) face each other across the Fulda Gap, 13.5 km apart.
const home = objective('Geisa')
const enemyTown = objective('Vacha')

afterEach(() => {
  vi.restoreAllMocks()
})

function createCoalition(id: 'player' | 'opponent', objectiveIds: string[]): CoalitionData {
  return {
    id,
    aircraftTypes: {} as CoalitionData['aircraftTypes'],
    groundUnitTypes: {
      Infantry: ['Infantry AK'],
      Vehicle: ['BMP-2']
    } as CoalitionData['groundUnitTypes'],
    airdromeNames: [],
    objectiveIds,
    structures: [],
    samGroups: [],
    groundGroups: [],
    flightGroups: [],
    packages: [],
    supplyNodes: {}
  }
}

function createCampaign(scenarioId = 'fulda-gap'): Campaign {
  return {
    version: 'test',
    id: 'campaign-1',
    name: 'Test Campaign',
    createdAt: campaignTime,
    updatedAt: campaignTime,
    time: campaignTime,
    timeMultiplier: 1,
    logs: [],
    scenarioId,
    coalitions: {
      player: createCoalition('player', [home.name]),
      opponent: createCoalition('opponent', [enemyTown.name])
    }
  }
}

function infantry(id: string, overrides: Partial<GroundGroup> = {}): GroundGroup {
  return {
    id,
    position: { ...home.position },
    objectiveId: home.name,
    units: [{ name: 'Infantry AK', count: 10 }],
    state: 'idle',
    ...overrides
  }
}

/** A point on the line from Geisa towards Vacha, `metres` out from Geisa. */
function alongRoad(metres: number) {
  const dx = enemyTown.position.x - home.position.x
  const dy = enemyTown.position.y - home.position.y
  const length = Math.hypot(dx, dy)
  return {
    x: home.position.x + (dx / length) * metres,
    y: home.position.y + (dy / length) * metres
  }
}

function barrack(objectiveId: string, position: { x: number; y: number }, resources: number) {
  return {
    id: `barrack-${objectiveId}`,
    type: 'Barrack',
    objectiveId,
    position: { ...position },
    name: 'Barrack',
    resources,
    buildings: [{ offset: { x: 0, y: 0 }, type: 'Garage B' as const, alive: true }]
  }
}

describe('garrisons', () => {
  test('the first formation with an enemy in range marches on it', () => {
    const campaign = createCampaign()
    campaign.coalitions.player.structures.push(barrack(home.name, home.position, 500))

    spawnGroundGroups(campaign, 'player')

    expect(campaign.coalitions.player.groundGroups).toHaveLength(1)
    expect(campaign.coalitions.player.groundGroups[0]).toMatchObject({
      state: 'moving',
      targetObjectiveId: enemyTown.name
    })
  })

  test('columns fan out so each enemy town in range gets its own assault', () => {
    const eisenach = objective('Eisenach')
    const campaign = createCampaign()
    campaign.coalitions.opponent.objectiveIds.push(eisenach.name)
    campaign.coalitions.player.structures.push({
      ...barrack(home.name, home.position, 5_000),
      buildings: [
        { offset: { x: 0, y: 0 }, type: 'Garage B' as const, alive: true },
        { offset: { x: 20, y: 0 }, type: 'Garage B' as const, alive: true }
      ]
    })

    spawnGroundGroups(campaign, 'player')

    const targets = new Set(
      campaign.coalitions.player.groundGroups
        .map((group) => group.targetObjectiveId)
        .filter((name): name is string => name != null)
    )
    expect(targets.has(enemyTown.name)).toBe(true)
    expect(targets.has(eisenach.name)).toBe(true)
  })

  test('a town under assault still raises a reaction column', () => {
    const campaign = createCampaign()
    campaign.coalitions.player.structures.push(barrack(home.name, home.position, 5_000))
    campaign.coalitions.player.groundGroups.push(infantry('garrison'))
    campaign.coalitions.opponent.groundGroups.push(
      infantry('assault', {
        position: { ...home.position },
        state: 'moving',
        targetObjectiveId: home.name
      })
    )

    spawnGroundGroups(campaign, 'player')

    expect(
      campaign.coalitions.player.groundGroups.some(
        (group) => group.state === 'moving' && group.targetObjectiveId === enemyTown.name
      )
    ).toBe(true)
  })

  test('a barrack stops raising once the coalition already has a full field force', () => {
    const campaign = createCampaign()
    campaign.coalitions.player.structures.push(barrack(home.name, home.position, 5_000))
    for (let index = 0; index < 12; index += 1) {
      campaign.coalitions.player.groundGroups.push(
        infantry(`stack-${index}`, {
          objectiveId: home.name,
          units: [{ name: 'Infantry AK', count: 8 }]
        })
      )
    }

    spawnGroundGroups(campaign, 'player')

    expect(campaign.coalitions.player.groundGroups.length).toBeLessThanOrEqual(12)
    const units = campaign.coalitions.player.groundGroups.reduce(
      (sum, group) => sum + group.units.reduce((total, unit) => total + unit.count, 0),
      0
    )
    expect(units).toBeLessThanOrEqual(80)
  })

  test('rear garrisons fold so a frontline barrack can still raise an attacking column', () => {
    const campaign = createCampaign()
    const towns = [
      home,
      ...germany.objectives.filter((entry) => entry.name !== home.name && entry.name !== enemyTown.name)
    ].slice(0, 12)
    campaign.coalitions.player.objectiveIds = towns.map((entry) => entry.name)
    campaign.coalitions.player.structures.push(barrack(home.name, home.position, 5_000))
    for (const [index, town] of towns.entries()) {
      campaign.coalitions.player.groundGroups.push(
        infantry(`hold-${index}`, {
          objectiveId: town.name,
          position: { ...town.position }
        })
      )
    }

    spawnGroundGroups(campaign, 'player')

    const idle = campaign.coalitions.player.groundGroups.filter((group) => group.state === 'idle')
    expect(idle.length).toBeLessThanOrEqual(6)
    expect(
      campaign.coalitions.player.groundGroups.some(
        (group) => group.state === 'moving' && group.targetObjectiveId === enemyTown.name
      )
    ).toBe(true)
  })

  test('a lone garrison holds while a second formation marches out and frees its site', () => {
    const campaign = createCampaign()
    campaign.coalitions.player.groundGroups.push(
      infantry('first', { deployment: { siteId: 'a', assignedAt: '', reason: 'creation' } }),
      infantry('second', { deployment: { siteId: 'b', assignedAt: '', reason: 'creation' } })
    )

    updateGroundGroups(campaign, 'player', 16, { capture: false })

    const [first, second] = campaign.coalitions.player.groundGroups
    expect(first).toMatchObject({ state: 'moving', targetObjectiveId: enemyTown.name })
    expect(first?.deployment).toBeUndefined()
    expect(second?.state).toBe('idle')
    expect(second?.targetObjectiveId).toBeUndefined()
  })
})

describe('ground battles', () => {
  test('comparable formations are not destroyed within a campaign minute', () => {
    const campaign = createCampaign()
    campaign.coalitions.player.groundGroups.push(
      infantry('attacker', {
        position: { ...enemyTown.position },
        state: 'moving',
        targetObjectiveId: enemyTown.name
      })
    )
    campaign.coalitions.opponent.groundGroups.push(
      infantry('defender', { position: { ...enemyTown.position }, objectiveId: enemyTown.name })
    )

    updateGroundGroups(campaign, 'player', 60_000, { move: false })

    for (const coalition of ['player', 'opponent'] as const) {
      const units = campaign.coalitions[coalition].groundGroups[0]?.units ?? []
      expect(units.reduce((sum, unit) => sum + unit.count, 0)).toBeGreaterThanOrEqual(8)
    }
    expect(campaign.coalitions.opponent.objectiveIds).toContain(enemyTown.name)
  })

  test('opposing columns halt and fight where they meet', () => {
    const campaign = createCampaign()
    campaign.coalitions.player.groundGroups.push(
      infantry('player-column', {
        position: alongRoad(6_000),
        state: 'moving',
        targetObjectiveId: enemyTown.name
      })
    )
    campaign.coalitions.opponent.groundGroups.push(
      infantry('opponent-column', {
        position: alongRoad(7_500),
        objectiveId: enemyTown.name,
        state: 'moving',
        targetObjectiveId: home.name
      })
    )

    updateGroundGroups(campaign, 'player', 16, { capture: false })
    expect(campaign.coalitions.player.groundGroups[0]?.state).toBe('combat')
    expect(campaign.coalitions.opponent.groundGroups[0]?.state).toBe('combat')

    resolveFieldEngagements(campaign, 1_000)
    expect(campaign.logs.map((entry) => entry.message)).toContain(
      `Ground battle started on the road to ${enemyTown.name} (1 attackers vs 1 defenders)`
    )
  })

  test('a column keeps closing even if another is still leaving home', () => {
    const campaign = createCampaign()
    const staging = alongRoad(6_000) // 7.5 km short of Vacha
    campaign.coalitions.player.groundGroups.push(
      infantry('lead', {
        position: { ...staging },
        state: 'moving',
        targetObjectiveId: enemyTown.name
      }),
      infantry('second', {
        position: { ...home.position },
        state: 'moving',
        targetObjectiveId: enemyTown.name
      })
    )
    campaign.coalitions.opponent.groundGroups.push(
      infantry('garrison', { position: { ...enemyTown.position }, objectiveId: enemyTown.name })
    )

    updateGroundGroups(campaign, 'player', 1_000, { capture: false })
    expect(campaign.coalitions.player.groundGroups[0]?.position).not.toEqual(staging)
  })

  test('an assault keeps closing while it fights the garrison', () => {
    const campaign = createCampaign()
    const contact = alongRoad(9_000) // ~4.5 km from Vacha: inside battle radius, outside capture
    campaign.coalitions.player.groundGroups.push(
      infantry('lead', {
        position: { ...contact },
        state: 'combat',
        targetObjectiveId: enemyTown.name
      })
    )
    campaign.coalitions.opponent.groundGroups.push(
      infantry('garrison', {
        position: { ...enemyTown.position },
        objectiveId: enemyTown.name,
        state: 'combat'
      })
    )

    updateGroundGroups(campaign, 'player', 30_000, { capture: false })
    expect(
      Math.hypot(
        campaign.coalitions.player.groundGroups[0]!.position.x - enemyTown.position.x,
        campaign.coalitions.player.groundGroups[0]!.position.y - enemyTown.position.y
      )
    ).toBeLessThan(
      Math.hypot(contact.x - enemyTown.position.x, contact.y - enemyTown.position.y)
    )
  })

  test('an assault that outweighs the remnant captures the town', () => {
    const campaign = createCampaign()
    campaign.coalitions.player.groundGroups.push(
      infantry('lead', {
        position: { ...enemyTown.position },
        state: 'moving',
        targetObjectiveId: enemyTown.name,
        units: [{ name: 'Infantry AK', count: 40 }]
      }),
      infantry('support', {
        position: { ...enemyTown.position },
        state: 'moving',
        targetObjectiveId: enemyTown.name,
        units: [{ name: 'Infantry AK', count: 40 }]
      })
    )
    campaign.coalitions.opponent.groundGroups.push(
      infantry('garrison', {
        position: { ...enemyTown.position },
        objectiveId: enemyTown.name,
        units: [{ name: 'Infantry AK', count: 4 }]
      })
    )

    updateGroundGroups(campaign, 'player', 1_000, { move: false })

    expect(campaign.coalitions.player.objectiveIds).toContain(enemyTown.name)
    expect(campaign.coalitions.opponent.objectiveIds).not.toContain(enemyTown.name)
  })

  test('a captured barrack keeps only enough stockpile to raise a follow-on', () => {
    const campaign = createCampaign()
    campaign.coalitions.opponent.objectiveIds.push('Eisenach')
    campaign.coalitions.opponent.structures.push(barrack(enemyTown.name, enemyTown.position, 1_500))
    campaign.coalitions.player.groundGroups.push(
      infantry('attacker', {
        position: { ...enemyTown.position },
        state: 'moving',
        targetObjectiveId: enemyTown.name
      })
    )

    updateGroundGroups(campaign, 'player', 1_000, { move: false })
    spawnGroundGroups(campaign, 'player')

    expect(campaign.coalitions.player.objectiveIds).toContain(enemyTown.name)
    expect(campaign.coalitions.player.structures[0]).toMatchObject({
      objectiveId: enemyTown.name,
      resources: 0
    })
    expect(
      campaign.coalitions.player.groundGroups.some(
        (group) => group.state === 'moving' && group.targetObjectiveId === 'Eisenach'
      )
    ).toBe(true)
  })
})

describe('race scenarios', () => {
  test('Fulda Gap is lost when the Pact takes Frankfurt', () => {
    const campaign = createCampaign('fulda-gap')
    campaign.goal = { coalition: 'player', objectiveIds: ['Leipzig Mockau'] }
    campaign.coalitions.opponent.objectiveIds = ['Frankfurt']

    updateCampaignGoal(campaign)

    expect(campaign.status).toBe('lost')
    expect(campaign.logs.at(-1)?.message).toBe('Campaign lost: opponent controls Frankfurt')
  })

  test('on the red side the NATO AI races for Leipzig', () => {
    const campaign = createCampaign('fulda-gap')
    campaign.playerSide = 'red'
    campaign.goal = { coalition: 'player', objectiveIds: ['Frankfurt'] }
    campaign.coalitions.opponent.objectiveIds = ['Leipzig Mockau']

    updateCampaignGoal(campaign)

    expect(campaign.status).toBe('lost')
  })
})
