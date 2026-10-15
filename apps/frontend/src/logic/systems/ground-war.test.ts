import { afterEach, describe, expect, test, vi } from 'vitest'
import { schemas } from '@dcc/contracts'
import { createInitialEscalation, theatres } from '@dcc/data'
import type * as z from 'zod'

import { engagementPowerModifier } from '@dcc/campaign'
import { updateCampaignGoal } from './campaign-goal'
import {
  MAX_IDLE_GARRISONS,
  MAX_LIVE_GROUND_GROUPS,
  MAX_LIVE_GROUND_UNITS,
  spawnGroundGroups
} from './spawn/ground-groups'
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

function smashedDepot(objectiveId: string, position: { x: number; y: number }, id: string) {
  return {
    id,
    type: 'Depot' as const,
    objectiveId,
    position: { ...position },
    name: 'Depot',
    resources: 0,
    buildings: [{ offset: { x: 0, y: 0 }, type: 'Garage B' as const, alive: false }]
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

  test('Korea-era Escalation does not use the Late CW NATO spawn surge', () => {
    const campaign = createCampaign()
    campaign.era = 'Korea'
    campaign.escalation = createInitialEscalation(campaignTime, 8)
    campaign.coalitions.player.structures.push({
      ...barrack(home.name, home.position, 5_000),
      buildings: Array.from({ length: 6 }, (_, index) => ({
        offset: { x: index * 10, y: 0 },
        type: 'Garage B' as const,
        alive: true
      }))
    })

    spawnGroundGroups(campaign, 'player')

    expect(campaign.coalitions.player.groundGroups).toHaveLength(1)
  })

  test('a smashed depot chokes the local barrack so it cannot raise a new column', () => {
    const campaign = createCampaign()
    campaign.coalitions.player.structures.push(barrack(home.name, home.position, 5_000), {
      id: 'depot-dead',
      type: 'Depot',
      objectiveId: home.name,
      position: { ...home.position },
      name: 'Depot',
      resources: 0,
      buildings: [{ offset: { x: 0, y: 0 }, type: 'Garage B' as const, alive: false }]
    })

    spawnGroundGroups(campaign, 'player')

    expect(campaign.coalitions.player.groundGroups).toHaveLength(0)
  })

  test('an interdicted garrison holds instead of launching a new assault', () => {
    const campaign = createCampaign()
    campaign.coalitions.player.structures.push(barrack(home.name, home.position, 5_000), {
      id: 'depot-dead',
      type: 'Depot',
      objectiveId: home.name,
      position: { ...home.position },
      name: 'Depot',
      resources: 0,
      buildings: [{ offset: { x: 0, y: 0 }, type: 'Garage B' as const, alive: false }]
    })
    campaign.coalitions.player.groundGroups.push(infantry('held'))

    updateGroundGroups(campaign, 'player', 16, { capture: false })

    const held = campaign.coalitions.player.groundGroups[0]
    expect(held?.state).toBe('idle')
    expect(held?.targetObjectiveId).toBeUndefined()
  })

  test('a column already on the road from a smashed origin aborts unless it is in the fight', () => {
    const campaign = createCampaign()
    campaign.coalitions.player.structures.push(smashedDepot(home.name, home.position, 'depot-dead'))
    campaign.coalitions.player.groundGroups.push(
      infantry('on-road', {
        state: 'moving',
        targetObjectiveId: enemyTown.name,
        position: alongRoad(6_000)
      })
    )

    updateGroundGroups(campaign, 'player', 16, { capture: false })

    const group = campaign.coalitions.player.groundGroups[0]
    expect(group?.targetObjectiveId).toBeUndefined()
    expect(group?.state).toBe('withdrawing')
    expect(group?.retreat?.destinationObjectiveId).toBe(home.name)
  })

  test('a column that has already reached the town keeps the assault if the origin is smashed', () => {
    const campaign = createCampaign()
    campaign.coalitions.player.structures.push(smashedDepot(home.name, home.position, 'depot-dead'))
    campaign.coalitions.player.groundGroups.push(
      infantry('in-contact', {
        state: 'moving',
        targetObjectiveId: enemyTown.name,
        position: alongRoad(10_000)
      })
    )

    updateGroundGroups(campaign, 'player', 16, { capture: false })

    const group = campaign.coalitions.player.groundGroups[0]
    expect(group?.targetObjectiveId).toBe(enemyTown.name)
  })

  test('spawn still hops to the only adjacent enemy even when that town is starved', () => {
    const campaign = createCampaign()
    campaign.coalitions.player.structures.push(barrack(home.name, home.position, 5_000))
    campaign.coalitions.opponent.structures.push(
      smashedDepot(enemyTown.name, enemyTown.position, 'enemy-depot-dead')
    )

    spawnGroundGroups(campaign, 'player')

    expect(campaign.coalitions.player.groundGroups[0]).toMatchObject({
      state: 'moving',
      targetObjectiveId: enemyTown.name
    })
  })

  test('spawn prefers an unchoked adjacent hop when one exists', () => {
    const hunfeld = objective('Hunfeld')
    const campaign = createCampaign()
    campaign.coalitions.opponent.objectiveIds.push(hunfeld.name)
    campaign.coalitions.opponent.structures.push(
      smashedDepot(hunfeld.name, hunfeld.position, 'hunfeld-depot-dead')
    )
    campaign.coalitions.player.structures.push(barrack(home.name, home.position, 5_000))

    spawnGroundGroups(campaign, 'player')

    expect(campaign.coalitions.player.groundGroups[0]).toMatchObject({
      state: 'moving',
      targetObjectiveId: enemyTown.name
    })
  })

  test('columns only hop to an adjacent enemy town, not a town behind it', () => {
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
    expect(targets.has(eisenach.name)).toBe(false)
  })

  test('two border barracks each assault their own neighbor', () => {
    const helmstedt = objective('Helmstedt')
    const haldensleben = objective('Haldensleben')
    const campaign = createCampaign()
    campaign.coalitions.player.objectiveIds.push(helmstedt.name)
    campaign.coalitions.opponent.objectiveIds.push(haldensleben.name)
    campaign.coalitions.player.structures.push(
      barrack(home.name, home.position, 5_000),
      barrack(helmstedt.name, helmstedt.position, 5_000)
    )

    spawnGroundGroups(campaign, 'player')

    const targets = new Set(
      campaign.coalitions.player.groundGroups
        .map((group) => group.targetObjectiveId)
        .filter((name): name is string => name != null)
    )
    expect(targets.has(enemyTown.name)).toBe(true)
    expect(targets.has(haldensleben.name)).toBe(true)
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
    for (let index = 0; index < MAX_LIVE_GROUND_GROUPS; index += 1) {
      campaign.coalitions.player.groundGroups.push(
        infantry(`stack-${index}`, {
          objectiveId: home.name,
          units: [{ name: 'Infantry AK', count: 8 }]
        })
      )
    }

    spawnGroundGroups(campaign, 'player')

    expect(campaign.coalitions.player.groundGroups.length).toBeLessThanOrEqual(MAX_LIVE_GROUND_GROUPS)
    const units = campaign.coalitions.player.groundGroups.reduce(
      (sum, group) => sum + group.units.reduce((total, unit) => total + unit.count, 0),
      0
    )
    expect(units).toBeLessThanOrEqual(MAX_LIVE_GROUND_UNITS)
  })

  test('rear garrisons fold so a frontline barrack can still raise an attacking column', () => {
    const campaign = createCampaign()
    const towns = [
      home,
      ...germany.objectives.filter((entry) => entry.name !== home.name && entry.name !== enemyTown.name)
    ].slice(0, MAX_LIVE_GROUND_GROUPS)
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
    expect(idle.length).toBeLessThanOrEqual(MAX_IDLE_GARRISONS)
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

  test('a company holds short of a defended town through the preparation', () => {
    const campaign = createCampaign()
    const contact = alongRoad(9_000)
    campaign.coalitions.player.groundGroups.push(
      infantry('lead', {
        position: { ...contact },
        state: 'combat',
        combatStartedAt: campaign.time.toISOString(),
        targetObjectiveId: enemyTown.name
      })
    )
    campaign.coalitions.opponent.groundGroups.push(
      infantry('garrison', { position: { ...enemyTown.position }, objectiveId: enemyTown.name })
    )

    updateGroundGroups(campaign, 'player', 60_000, { capture: false })

    const lead = campaign.coalitions.player.groundGroups[0]!
    const distance = Math.hypot(
      lead.position.x - enemyTown.position.x,
      lead.position.y - enemyTown.position.y
    )
    expect(distance).toBeGreaterThan(3_500)
    expect(campaign.coalitions.opponent.objectiveIds).toContain(enemyTown.name)
  })

  test('one company inside the town does not take it from an equal garrison', () => {
    const campaign = createCampaign()
    campaign.coalitions.player.groundGroups.push(
      infantry('lead', {
        position: { ...enemyTown.position },
        state: 'combat',
        combatStartedAt: new Date(campaign.time.getTime() - 30 * 60 * 1000).toISOString(),
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

    updateGroundGroups(campaign, 'player', 1_000, { move: false })

    expect(campaign.coalitions.opponent.objectiveIds).toContain(enemyTown.name)
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

  test('the enemy leaves its garrison and attacks the gap', () => {
    const helmstedt = objective('Helmstedt')
    const haldensleben = objective('Haldensleben')
    const campaign = createCampaign()
    campaign.era = 'Korea'
    campaign.escalation = createInitialEscalation(campaignTime, 8)
    campaign.goal = { coalition: 'player', objectiveIds: ['Leipzig Mockau'] }
    campaign.operationProfile = {
      archetype: 'balanced',
      frontlineShape: 'linear',
      tempo: 'cautious',
      initiativeCoalition: 'opponent'
    }
    campaign.coalitions.player.objectiveIds.push(helmstedt.name)
    campaign.coalitions.opponent.objectiveIds.push(haldensleben.name)
    campaign.coalitions.opponent.groundGroups.push(
      infantry('vacha', {
        objectiveId: enemyTown.name,
        position: { ...enemyTown.position },
        state: 'idle'
      }),
      infantry('haldensleben', {
        objectiveId: haldensleben.name,
        position: { ...haldensleben.position },
        state: 'idle'
      })
    )

    updateGroundGroups(campaign, 'opponent', 1_000, { capture: false })

    const gap = campaign.coalitions.opponent.groundGroups.find((group) => group.id === 'vacha')
    const north = campaign.coalitions.opponent.groundGroups.find((group) => group.id === 'haldensleben')
    expect(gap).toMatchObject({ state: 'moving', targetObjectiveId: home.name })
    expect(north).toMatchObject({ state: 'moving', targetObjectiveId: helmstedt.name })
  })

  test('our garrison on the gap marches too, and the other border stays', () => {
    const helmstedt = objective('Helmstedt')
    const haldensleben = objective('Haldensleben')
    const campaign = createCampaign()
    campaign.era = 'Korea'
    campaign.escalation = createInitialEscalation(campaignTime, 8)
    campaign.goal = { coalition: 'player', objectiveIds: ['Leipzig Mockau'] }
    campaign.operationProfile = {
      archetype: 'balanced',
      frontlineShape: 'linear',
      tempo: 'cautious',
      initiativeCoalition: 'opponent'
    }
    campaign.coalitions.player.objectiveIds.push(helmstedt.name)
    campaign.coalitions.opponent.objectiveIds.push(haldensleben.name)
    campaign.coalitions.player.groundGroups.push(
      infantry('geisa', { state: 'idle' }),
      infantry('helmstedt', {
        objectiveId: helmstedt.name,
        position: { ...helmstedt.position },
        state: 'idle'
      })
    )

    updateGroundGroups(campaign, 'player', 1_000, { capture: false })

    const gap = campaign.coalitions.player.groundGroups.find((group) => group.id === 'geisa')
    const north = campaign.coalitions.player.groundGroups.find((group) => group.id === 'helmstedt')
    expect(gap).toMatchObject({ state: 'moving', targetObjectiveId: enemyTown.name })
    expect(north).toMatchObject({ state: 'moving', targetObjectiveId: haldensleben.name })
  })

  test('a third axis stays home while two assaults are already out', () => {
    const helmstedt = objective('Helmstedt')
    const haldensleben = objective('Haldensleben')
    const campaign = createCampaign()
    campaign.coalitions.player.objectiveIds.push(helmstedt.name)
    campaign.coalitions.opponent.objectiveIds.push(haldensleben.name)
    campaign.coalitions.player.groundGroups.push(
      infantry('axis-vacha', { state: 'moving', targetObjectiveId: enemyTown.name }),
      infantry('axis-eisenach', { state: 'moving', targetObjectiveId: 'Eisenach' })
    )
    campaign.coalitions.player.structures.push(barrack(helmstedt.name, helmstedt.position, 5_000))

    spawnGroundGroups(campaign, 'player')

    const raised = campaign.coalitions.player.groundGroups.filter(
      (group) => group.objectiveId === helmstedt.name
    )
    expect(raised).toHaveLength(1)
    expect(raised[0]?.state).toBe('idle')
    expect(raised[0]?.targetObjectiveId).toBeUndefined()
  })

  test('returned men can march when the barrack cannot pay for a new draft', () => {
    const campaign = createCampaign()
    campaign.coalitions.player.structures.push(barrack(home.name, home.position, 0))
    campaign.coalitions.player.replacementPools = {
      [home.name]: { readyPersonnel: 8, recoveringPersonnel: [], equipment: [] }
    }

    spawnGroundGroups(campaign, 'player')

    expect(campaign.coalitions.player.groundGroups[0]?.state).toBe('moving')
    expect(campaign.coalitions.player.replacementPools?.[home.name]?.readyPersonnel).toBe(0)
    expect(campaign.coalitions.player.structures[0]?.resources).toBe(0)
  })

  test('a barrack with neither pay nor men raises nothing', () => {
    const campaign = createCampaign()
    campaign.coalitions.player.structures.push(barrack(home.name, home.position, 0))

    spawnGroundGroups(campaign, 'player')

    expect(campaign.coalitions.player.groundGroups).toHaveLength(0)
  })

  test('the army holds for the first two hours', () => {
    const campaign = createCampaign()
    campaign.groundOffensiveAt = campaign.time.getTime() + 2 * 60 * 60 * 1000
    campaign.coalitions.player.structures.push(barrack(home.name, home.position, 5_000))

    spawnGroundGroups(campaign, 'player')

    expect(campaign.coalitions.player.groundGroups[0]?.state).toBe('idle')
    expect(campaign.coalitions.player.groundGroups[0]?.targetObjectiveId).toBeUndefined()
  })

  test('infantry holding a town outfight tanks that drive in, and tanks outfight rifles on the road', () => {
    const rifles = [{ units: [{ name: 'Infantry AK', count: 8 }] }]
    const tanks = [{ units: [{ name: 'T-55', count: 2 }] }]
    expect(engagementPowerModifier(rifles, tanks, 'town-defense')).toBeGreaterThan(1)
    expect(engagementPowerModifier(tanks, rifles, 'town-assault')).toBeLessThan(1)
    expect(engagementPowerModifier(tanks, rifles, 'meeting')).toBeGreaterThan(1)
  })

  test('a wiped company makes that town wait an hour before raising another', () => {
    const campaign = createCampaign()
    campaign.coalitions.player.structures.push(barrack(home.name, home.position, 5_000))
    campaign.coalitions.player.groundGroups = [
      infantry('gone', { units: [{ name: 'Infantry AK', count: 0 }] })
    ]

    updateGroundGroups(campaign, 'player', 1_000, { capture: false })

    expect(campaign.coalitions.player.groundGroups).toHaveLength(0)
    expect(campaign.coalitions.player.groundReplacementUntil?.[home.name]).toBe(
      campaignTime.getTime() + 60 * 60 * 1000
    )

    spawnGroundGroups(campaign, 'player')

    expect(campaign.coalitions.player.groundGroups).toHaveLength(0)
  })

  test('a column holds short of a town when the road behind it is cut', () => {
    const campaign = createCampaign()
    campaign.roadCuts = [
      {
        from: home.name,
        to: enemyTown.name,
        until: campaignTime.getTime() + 60 * 60 * 1000
      }
    ]
    campaign.coalitions.player.groundGroups = [
      infantry('column', {
        position: alongRoad(3000),
        state: 'moving',
        targetObjectiveId: enemyTown.name
      })
    ]

    updateGroundGroups(campaign, 'player', 60_000, { capture: false })

    expect(campaign.coalitions.player.groundGroups[0]?.state).toBe('idle')
    expect(campaign.coalitions.player.groundGroups[0]?.targetObjectiveId).toBeUndefined()
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
