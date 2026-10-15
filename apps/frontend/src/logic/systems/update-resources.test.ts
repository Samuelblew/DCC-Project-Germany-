import { describe, expect, test } from 'vitest'

import { calculateResourceGainPerLogicTick } from './update-resources'

const barrack = {
  id: 'barrack-1',
  type: 'Barrack',
  objectiveId: 'Geisa',
  position: { x: 0, y: 0 },
  buildings: [{ alive: true }]
}

describe('resource generation', () => {
  test('interdiction throttles barrack stockpile gain', () => {
    const clear = calculateResourceGainPerLogicTick(barrack, [barrack], 1, 0)
    const choked = calculateResourceGainPerLogicTick(barrack, [barrack], 1, 0.9)

    expect(clear).toBeGreaterThan(0)
    expect(choked).toBeCloseTo(clear * 0.1)
  })

  test('a living factory beside the barrack raises its output', () => {
    const factory = {
      id: 'factory-1',
      type: 'Factory',
      objectiveId: 'Geisa',
      position: { x: 280, y: 0 },
      buildings: [{ alive: true }]
    }
    const withFactory = calculateResourceGainPerLogicTick(barrack, [barrack, factory], 1, 0)
    const alone = calculateResourceGainPerLogicTick(barrack, [barrack], 1, 0)

    expect(withFactory).toBeGreaterThan(alone)
  })
})
