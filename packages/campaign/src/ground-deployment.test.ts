import { schemas } from '@dcc/contracts'
import { describe, expect, test } from 'vitest'
import * as z from 'zod'

import {
  assignDeploymentSite,
  beginGroundGroupRetreat,
  evaluateCombatViability,
  expandGroundGroupUnits,
  findOwnedObjectiveRoute,
  getDeploymentSites,
  recordInfantryCasualties
} from './ground-deployment'

type Campaign = z.infer<typeof schemas.campaign.campaign>
type GroundGroup = z.infer<typeof schemas.groundGroup>
type Theatre = z.infer<typeof schemas.theatre>

function groundGroup(count: number): GroundGroup {
  return {
    id: 'group-1',
    objectiveId: 'Front',
    position: { x: 0, y: 0 },
    state: 'idle' as const,
    baselineCombatPower: 10,
    units: [{ name: 'Infantry AK', count }]
  }
}

function campaign(): Campaign {
  return {
    version: '0.1.0',
    id: 'campaign-1',
    name: 'Test',
    createdAt: new Date('1982-05-01T09:00:00Z'),
    updatedAt: new Date('1982-05-01T09:00:00Z'),
    time: new Date('1982-05-01T09:00:00Z'),
    timeMultiplier: 1,
    scenarioId: 'test',
    logs: [],
    coalitions: {
      player: {
        id: 'player',
        aircraftTypes: {} as never,
        groundUnitTypes: {} as never,
        airdromeNames: [],
        objectiveIds: ['Front'],
        structures: [],
        samGroups: [],
        groundGroups: [],
        flightGroups: [],
        packages: []
      },
      opponent: {
        id: 'opponent',
        aircraftTypes: {} as never,
        groundUnitTypes: {} as never,
        airdromeNames: [],
        objectiveIds: [],
        structures: [],
        samGroups: [],
        groundGroups: [],
        flightGroups: [],
        packages: []
      }
    }
  }
}

const theatre: Theatre = {
  name: 'Test',
  objectives: [{ name: 'Front', type: 'Town' as const, position: { x: 100, y: 100 } }],
  targets: {
    Front: [
      {
        name: 'Front|Vehicle|1',
        objectiveName: 'Front',
        groupId: 1,
        type: 'Vehicle' as const,
        position: { x: 100, y: 100 },
        unitPositions: Array.from({ length: 6 }, (_, index) => ({
          x: 100 + index * 10,
          y: 100,
          heading: 0
        }))
      }
    ]
  },
  airdromeDetails: {},
  info: {
    center: { x: 0, y: 0 },
    weather: {
      temperature: { amplitude: 1, mean: 10 },
      cloudCover: { baseCloudCover: 0.5, seasonEffect: 0.1 },
      wind: { speed: 1, direction: 0 }
    },
    night: { startHour: 20, endHour: 6 }
  }
}

describe('combat viability', () => {
  test('retreats at three units and accepts four at exactly thirty percent', () => {
    const depleted = groundGroup(3)
    expect(evaluateCombatViability(depleted).mustRetreat).toBe(true)

    const viable = groundGroup(4)
    viable.baselineCombatPower = 4 / 0.3
    expect(evaluateCombatViability(viable).mustRetreat).toBe(false)
    expect(evaluateCombatViability(viable).casEligible).toBe(true)
  })
})

describe('deployment sites', () => {
  test('derives legacy targets and persists exact slots', () => {
    expect(getDeploymentSites(theatre)).toHaveLength(1)
    const group = groundGroup(5)
    const state = campaign()
    state.coalitions.player.groundGroups.push(group)
    const site = assignDeploymentSite({
      campaign: state,
      coalition: 'player',
      theatre,
      group,
      objectiveId: 'Front',
      roles: ['vehicle'],
      reason: 'creation'
    })
    expect(site?.id).toBe('legacy-Front-1-Vehicle')
    expect(group.units).toHaveLength(5)
    expect(group.units.every((unit) => unit.id && unit.position && unit.slotId)).toBe(true)
  })

  test('expands aggregates to stable individual records', () => {
    const first = groundGroup(5)
    const second = groundGroup(5)
    const firstIds = expandGroundGroupUnits(first).map((unit) => unit.id)
    const secondIds = expandGroundGroupUnits(second).map((unit) => unit.id)
    expect(firstIds).toEqual(secondIds)
    expect(first.units.every((unit) => unit.count === 1)).toBe(true)
  })

  test('reserves sites exclusively and defers instead of using fallback terrain', () => {
    const state = campaign()
    const first = groundGroup(5)
    const second = { ...groundGroup(5), id: 'group-2' }
    state.coalitions.player.groundGroups.push(first, second)
    expect(
      assignDeploymentSite({
        campaign: state,
        coalition: 'player',
        theatre,
        group: first,
        objectiveId: 'Front',
        roles: ['vehicle'],
        reason: 'creation'
      })
    ).not.toBeNull()
    expect(
      assignDeploymentSite({
        campaign: state,
        coalition: 'player',
        theatre,
        group: second,
        objectiveId: 'Front',
        roles: ['vehicle'],
        reason: 'creation'
      })
    ).toBeNull()
    expect(second.position).toEqual({ x: 0, y: 0 })
    expect(second.deploymentDeferredReason).toContain('unreserved')
  })
})

describe('formation withdrawal', () => {
  test('routes depleted formations to an owned validated recovery node', () => {
    const state = campaign()
    state.coalitions.player.objectiveIds.push('Rear')
    const group = groundGroup(3)
    group.state = 'combat'
    state.coalitions.player.groundGroups.push(group)
    const retreatTheatre: Theatre = {
      ...theatre,
      objectives: [
        ...theatre.objectives,
        { name: 'Rear', type: 'Town', position: { x: -1_000, y: 0 } }
      ],
      deploymentSites: [
        {
          id: 'rear-recovery',
          objectiveId: 'Rear',
          position: { x: -1_000, y: 0 },
          roles: ['recovery', 'reserve'],
          posture: 'recovery-area',
          slots: Array.from({ length: 6 }, (_, index) => ({
            id: `rear-${index}`,
            x: -1_000 + index * 10,
            y: 0,
            heading: 0,
            allowedUnitKinds: ['infantry'] as const
          })),
          validationStatus: 'approved',
          source: 'authored'
        }
      ],
      connections: [
        {
          from: 'Front',
          to: 'Rear',
          mode: 'foot',
          bidirectional: true,
          waypoints: [{ x: -500, y: 0 }]
        }
      ]
    }
    expect(
      beginGroundGroupRetreat({
        campaign: state,
        coalition: 'player',
        theatre: retreatTheatre,
        group
      })
    ).toBe('withdrawing')
    expect(group.retreat?.destinationObjectiveId).toBe('Rear')
    expect(group.targetObjectiveId).toBeUndefined()
  })

  test('falls back in a straight line when the theatre has no road network', () => {
    const state = campaign()
    state.coalitions.player.objectiveIds.push('Rear', 'Far Rear')
    const group = groundGroup(3)
    group.state = 'combat'
    state.coalitions.player.groundGroups.push(group)
    const openTheatre: Theatre = {
      ...theatre,
      objectives: [
        ...theatre.objectives,
        { name: 'Rear', type: 'Town', position: { x: -20_000, y: 0 } },
        { name: 'Far Rear', type: 'Town', position: { x: -60_000, y: 0 } }
      ]
    }

    expect(
      beginGroundGroupRetreat({ campaign: state, coalition: 'player', theatre: openTheatre, group })
    ).toBe('withdrawing')
    // Front is where the fight is (within 5 km), so the nearest objective away from it is chosen.
    expect(group.retreat).toMatchObject({
      destinationObjectiveId: 'Rear',
      route: [{ x: -20_000, y: 0 }]
    })
  })
})

describe('owned land routes', () => {
  const graphTheatre: Theatre = {
    ...theatre,
    objectives: [
      { name: 'A', type: 'Town', position: { x: 0, y: 0 } },
      { name: 'B', type: 'Town', position: { x: 10_000, y: 0 } },
      { name: 'C', type: 'Town', position: { x: 20_000, y: 0 } }
    ],
    connections: [
      { from: 'A', to: 'B', mode: 'road', bidirectional: true, waypoints: [] },
      { from: 'B', to: 'C', mode: 'road', bidirectional: true, waypoints: [] },
      { from: 'A', to: 'C', mode: 'road', bidirectional: true, waypoints: [{ x: 10_000, y: 4_000 }] }
    ]
  }

  test('skips a smashed owned town as transit and uses the go-around', () => {
    expect(
      findOwnedObjectiveRoute({
        theatre: graphTheatre,
        ownedObjectiveIds: new Set(['A', 'B', 'C']),
        fromObjectiveId: 'A',
        destinationObjectiveIds: new Set(['C']),
        blockedTransitIds: new Set(['B'])
      })
    ).toEqual({
      destinationObjectiveId: 'C',
      waypoints: [
        { x: 10_000, y: 4_000 },
        { x: 20_000, y: 0 }
      ]
    })
  })

  test('still enters a smashed town when it is the destination', () => {
    expect(
      findOwnedObjectiveRoute({
        theatre: graphTheatre,
        ownedObjectiveIds: new Set(['A', 'B', 'C']),
        fromObjectiveId: 'A',
        destinationObjectiveIds: new Set(['B']),
        blockedTransitIds: new Set(['B'])
      })
    ).toEqual({
      destinationObjectiveId: 'B',
      waypoints: [{ x: 10_000, y: 0 }]
    })
  })
})

describe('casevac casualties', () => {
  test('is deterministic and aggregates by site', () => {
    const state = campaign()
    const first = recordInfantryCasualties({
      campaign: state,
      coalition: 'player',
      objectiveId: 'Front',
      siteId: 'front-site',
      position: { x: 10, y: 20 },
      count: 10,
      seed: 'battle-1'
    })
    const second = recordInfantryCasualties({
      campaign: state,
      coalition: 'player',
      objectiveId: 'Front',
      siteId: 'front-site',
      position: { x: 10, y: 20 },
      count: 10,
      seed: 'battle-1'
    })
    expect(first).toBe(second)
    expect(state.coalitions.player.casualtyPoints).toHaveLength(1)
    expect(state.coalitions.player.casualtyPoints?.[0]?.woundedCount).toBe(first * 2)
  })
})
