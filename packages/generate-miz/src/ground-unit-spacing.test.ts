import { describe, expect, it } from 'vitest'

import { GroundUnitSpacing } from './add-ground-groups'

describe('GroundUnitSpacing', () => {
  it('moves stacked vehicles apart', () => {
    const spacing = new GroundUnitSpacing()
    const placed = Array.from({ length: 6 }, () => spacing.place({ x: 100, y: 200 }, 'M-2 Bradley'))

    expect(placed[0]).toEqual({ x: 100, y: 200 })
    for (let i = 0; i < placed.length; i++) {
      for (let j = i + 1; j < placed.length; j++) {
        const distance = Math.hypot(placed[i]!.x - placed[j]!.x, placed[i]!.y - placed[j]!.y)
        expect(distance).toBeGreaterThanOrEqual(10)
      }
    }
  })

  it('keeps units that are already spaced out where they are', () => {
    const spacing = new GroundUnitSpacing()
    spacing.place({ x: 0, y: 0 }, 'T-72B')

    expect(spacing.place({ x: 35, y: 0 }, 'T-72B')).toEqual({ x: 35, y: 0 })
    expect(spacing.place({ x: 3, y: 3 }, 'Infantry AK')).not.toEqual({ x: 3, y: 3 })
  })

  it('lets infantry stand closer together than vehicles', () => {
    const spacing = new GroundUnitSpacing()
    spacing.place({ x: 0, y: 0 }, 'Soldier M4')

    expect(spacing.place({ x: 5, y: 0 }, 'Soldier M4')).toEqual({ x: 5, y: 0 })
  })
})
