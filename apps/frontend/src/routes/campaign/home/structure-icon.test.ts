import { describe, expect, test } from 'vitest'
import MilSymbol from 'milsymbol'
import type * as z from 'zod'
import { schemas } from '@dcc/contracts'

import { structureMarkerSvg } from './structure-icon'
import { getMilSymbolCode } from './unit-code'

type MapItem = z.infer<typeof schemas.MapItem>

const base = {
  id: '1',
  name: 'Marker',
  coalition: 'player' as const,
  position: { lng: 10, lat: 54 }
}

const structureTypes = [
  'Barrack',
  'Depot',
  'Ammo Depot',
  'Factory',
  'Factory 2',
  'Power Plant',
  'Fuel Storage',
  'Oil Platform',
  'Command Center',
  'Hospital',
  'Logistics Hub',
  'Farp',
  'Prison'
]

describe('industrial map icons', () => {
  test('each structure is its own small silhouette', () => {
    const icons = structureTypes.map((type) => structureMarkerSvg(type, 'player', 16))

    expect(icons.every((icon) => icon?.includes('width="16"'))).toBe(true)
    expect(new Set(icons).size).toBe(structureTypes.length)
    expect(structureMarkerSvg('Factory', 'opponent', 16)).toContain('#ff4d4f')
    expect(structureMarkerSvg('Factory', 'player', 16)).toContain('#3d9df0')
  })

  test('a strategic strike flight uses the bomber symbol', () => {
    const code = getMilSymbolCode({
      ...base,
      type: 'Flight Group',
      task: 'Strategic Strike',
      callsign: 'Doom',
      flightplan: { id: 'fp', startTime: new Date(), waypoints: [] }
    } as MapItem)
    expect(code).toContain('MFB---')
    expect(new MilSymbol.Symbol(code, { size: 20 }).isValid()).toBe(true)
  })
})
