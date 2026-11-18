import { schemas } from '@dcc/contracts'
import { describe, expect, test } from 'vitest'
import type * as z from 'zod'

import {
  findAdjacentHostileTarget,
  findFlotStations,
  flotPatrolPosition,
  flotTouchesObjective,
  landNeighbors,
  theatreHasLandGraph
} from './objective-graph'

type Theatre = z.infer<typeof schemas.theatre>

const theatre: Theatre = {
  name: 'Test',
  objectives: [
    { name: 'Geisa', type: 'Town', position: { x: 0, y: 0 } },
    { name: 'Vacha', type: 'Town', position: { x: 1, y: 0 } },
    { name: 'Eisenach', type: 'Town', position: { x: 2, y: 0 } },
    { name: 'Frankfurt', type: 'Airport', position: { x: -1, y: 0 } }
  ],
  targets: {},
  connections: [
    { from: 'Geisa', to: 'Vacha', mode: 'road', bidirectional: true, waypoints: [] },
    { from: 'Vacha', to: 'Eisenach', mode: 'road', bidirectional: true, waypoints: [] },
    { from: 'Geisa', to: 'Frankfurt', mode: 'road', bidirectional: true, waypoints: [] }
  ],
  airdromeDetails: {},
  info: {
    center: { x: 0, y: 0 },
    weather: {
      temperature: { amplitude: 1, mean: 1 },
      cloudCover: { baseCloudCover: 0, seasonEffect: 0 },
      wind: { speed: 0, direction: 0 }
    },
    night: { startHour: 21, endHour: 5 }
  }
}

describe('objective graph', () => {
  test('lists land neighbors both ways', () => {
    expect(theatreHasLandGraph(theatre)).toBe(true)
    expect(
      landNeighbors(theatre, 'Vacha')
        .map((entry) => entry.objectiveId)
        .sort()
    ).toEqual(['Eisenach', 'Geisa'])
  })

  test('a column only attacks the adjacent hostile town', () => {
    expect(
      findAdjacentHostileTarget({
        theatre,
        fromObjectiveId: 'Geisa',
        enemyObjectiveIds: ['Vacha', 'Eisenach'],
        enemyAirdromeNames: []
      })
    ).toEqual({ type: 'objective', name: 'Vacha' })
  })

  test('after the neighbor flips, the next hop opens', () => {
    expect(
      findAdjacentHostileTarget({
        theatre,
        fromObjectiveId: 'Vacha',
        enemyObjectiveIds: ['Eisenach'],
        enemyAirdromeNames: []
      })
    ).toEqual({ type: 'objective', name: 'Eisenach' })
  })

  test('an interior town does not leap to a distant enemy', () => {
    expect(
      findAdjacentHostileTarget({
        theatre,
        fromObjectiveId: 'Geisa',
        enemyObjectiveIds: ['Eisenach'],
        enemyAirdromeNames: []
      })
    ).toBeUndefined()
  })

  test('prefers an unchoked adjacent hop when one exists', () => {
    expect(
      findAdjacentHostileTarget({
        theatre,
        fromObjectiveId: 'Geisa',
        enemyObjectiveIds: ['Vacha'],
        enemyAirdromeNames: ['Frankfurt'],
        deprioritizedNames: new Set(['Vacha'])
      })
    ).toEqual({ type: 'airdrome', name: 'Frankfurt' })
  })

  test('still assaults the starved neighbor if it is the only hop', () => {
    expect(
      findAdjacentHostileTarget({
        theatre,
        fromObjectiveId: 'Geisa',
        enemyObjectiveIds: ['Vacha', 'Eisenach'],
        enemyAirdromeNames: [],
        deprioritizedNames: new Set(['Vacha'])
      })
    ).toEqual({ type: 'objective', name: 'Vacha' })
  })

  test('a victory airfield on the graph is an airdrome hop', () => {
    expect(
      findAdjacentHostileTarget({
        theatre,
        fromObjectiveId: 'Geisa',
        enemyObjectiveIds: [],
        enemyAirdromeNames: ['Frankfurt']
      })
    ).toEqual({ type: 'airdrome', name: 'Frankfurt' })
  })

  test('BARCAP stations are the owned towns that touch a hostile neighbor', () => {
    const stations = findFlotStations({
      theatre,
      friendlyObjectiveIds: ['Geisa', 'Frankfurt'],
      friendlyAirdromeNames: [],
      enemyObjectiveIds: ['Vacha', 'Eisenach'],
      enemyAirdromeNames: []
    })

    expect(stations.map((station) => station.id)).toEqual(['Geisa>Vacha'])
    expect(flotPatrolPosition(stations[0]!, 0.5)).toEqual({ x: 0.5, y: 0 })
    expect(flotTouchesObjective(stations, 'Vacha')).toBe(true)
    expect(flotTouchesObjective(stations, 'Eisenach')).toBe(false)
  })
})
