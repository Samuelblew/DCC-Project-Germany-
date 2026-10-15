import { scenarios, theatres } from '@dcc/data'
import { describe, expect, test } from 'vitest'

import { assignStructures } from './assign-structures'

describe('scenario-required structures', () => {
  test('guarantees Eagle Down a Blue FARP at the Bunji-ye-Maski foothold', () => {
    const scenario = scenarios.find((candidate) => candidate.id === 'eagle-down')!
    const theatre = theatres.find((candidate) => candidate.name === 'PersianGulf')!
    const objective = theatre.objectives.find((candidate) => candidate.name === 'Bunji-ye-Maski')!
    const target = theatre.targets['Bunji-ye-Maski']!.find(
      (candidate) => candidate.name === 'Bunji-ye-Maski|Structure|2'
    )!

    const assignments = assignStructures(
      [
        {
          id: objective.name,
          position: objective.position,
          targets: theatre.targets[objective.name] ?? []
        }
      ],
      [],
      { requiredStructures: scenario.start.player.structureAssignments }
    )

    const farp = assignments.find(
      (assignment) => assignment.objectiveId === objective.name && assignment.type === 'Farp'
    )

    expect(farp).toMatchObject({
      name: target.name,
      position: target.position,
      type: 'Farp'
    })
    expect(farp?.buildings.some((building) => building.type === 'FARP')).toBe(true)
  })
})

describe('scenario-placed spawn structures', () => {
  test('Fulda Gap raises troops only where the scenario places barracks and depots', () => {
    const scenario = scenarios.find((candidate) => candidate.id === 'fulda-gap')!
    const theatre = theatres.find((candidate) => candidate.name === scenario.theatreName)!
    const objectives = scenario.start.player.objectiveIds.map((id) => ({
      id,
      position: theatre.objectives.find((objective) => objective.name === id)!.position,
      targets: theatre.targets[id] ?? []
    }))
    const required = scenario.start.player.structureAssignments ?? []

    const spawners = assignStructures(objectives, [], { requiredStructures: required }).filter(
      (assignment) => assignment.type === 'Barrack' || assignment.type === 'Depot'
    )

    expect(spawners.map((s) => `${s.objectiveId}:${s.type}`).sort()).toEqual(
      required
        .filter((assignment) => assignment.type === 'Barrack' || assignment.type === 'Depot')
        .map((r) => `${r.objectiveId}:${r.type}`)
        .sort()
    )
  })

  test('Fulda puts the Eisenach car plant beside the barrack, not on top of it', () => {
    const scenario = scenarios.find((candidate) => candidate.id === 'fulda-gap')!
    const theatre = theatres.find((candidate) => candidate.name === scenario.theatreName)!
    const objective = theatre.objectives.find((candidate) => candidate.name === 'Eisenach')!
    const assignments = assignStructures(
      [
        {
          id: objective.name,
          position: objective.position,
          targets: theatre.targets[objective.name] ?? []
        }
      ],
      [],
      { requiredStructures: scenario.start.opponent.structureAssignments }
    )
    const barrack = assignments.find((assignment) => assignment.type === 'Barrack')
    const factory = assignments.find((assignment) => assignment.type === 'Factory')

    expect(factory?.buildings.map((building) => building.type)).toEqual(
      expect.arrayContaining(['Workshop A', 'Warehouse'])
    )
    expect(factory?.position).not.toEqual(barrack?.position)
  })
})
