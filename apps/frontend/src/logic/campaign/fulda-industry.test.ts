import { factions, scenarios, theatres } from '@dcc/data'
import { describe, expect, test } from 'vitest'

import { assignStructures } from './assign-structures'

describe('Fulda industry and oil', () => {
  test('Schwedeneck sits in the bay, off the road net, with an oil rig', () => {
    const scenario = scenarios.find((entry) => entry.id === 'fulda-gap')!
    const theatre = theatres.find((entry) => entry.name === scenario.theatreName)!
    const kiel = theatre.objectives.find((objective) => objective.name === 'Kiel')!
    const platforms = ['Schwedeneck A', 'Schwedeneck B'].map((name) => {
      const objective = theatre.objectives.find((entry) => entry.name === name)
      expect(objective?.type).toBe('Installation')
      const distance = Math.hypot(
        objective!.position.x - kiel.position.x,
        objective!.position.y - kiel.position.y
      )
      expect(distance).toBeGreaterThan(15_000)
      expect(objective!.position.y).toBeLessThan(kiel.position.y)
      return objective!
    })
    expect(Math.hypot(
      platforms[0]!.position.x - platforms[1]!.position.x,
      platforms[0]!.position.y - platforms[1]!.position.y
    )).toBeGreaterThan(2_000)

    const linked = (theatre.connections ?? []).some(
      (connection) =>
        connection.from.startsWith('Schwedeneck') || connection.to.startsWith('Schwedeneck')
    )
    expect(linked).toBe(false)
    expect(scenario.start.player.objectiveIds).toEqual(
      expect.arrayContaining(['Schwedeneck A', 'Schwedeneck B'])
    )

    const placed = assignStructures(
      platforms.map((objective) => ({
        id: objective.name,
        position: objective.position,
        targets: theatre.targets[objective.name] ?? []
      })),
      [],
      { requiredStructures: scenario.start.player.structureAssignments }
    ).filter((assignment) => assignment.type === 'Oil Platform')

    expect(placed.map((assignment) => assignment.objectiveId).sort()).toEqual([
      'Schwedeneck A',
      'Schwedeneck B'
    ])
    expect(placed.every((assignment) => assignment.buildings[0]?.type === 'Oil rig')).toBe(true)
  })

  test('an oil platform is not scattered onto a land town', () => {
    const scenario = scenarios.find((entry) => entry.id === 'fulda-gap')!
    const theatre = theatres.find((entry) => entry.name === scenario.theatreName)!
    const geisa = theatre.objectives.find((objective) => objective.name === 'Geisa')!
    const placed = assignStructures(
      [{ id: geisa.name, position: geisa.position, targets: theatre.targets[geisa.name] ?? [] }],
      [],
      { requiredStructures: [{ objectiveId: 'Geisa', type: 'Barrack' }] }
    )

    expect(placed.some((assignment) => assignment.type === 'Oil Platform')).toBe(false)
  })

  test('Fulda bombers are the B-52 and the Tu-22M3', () => {
    const usa = factions.find((faction) => faction.id === 'usa-1977')
    const russia = factions.find((faction) => faction.id === 'russia-1984')

    expect(usa?.aircraftTypes['Strategic Strike']).toEqual(['B-52H'])
    expect(russia?.aircraftTypes['Strategic Strike']).toEqual(['Tu-22M3'])
  })
})
