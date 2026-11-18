import { describe, expect, test } from 'vitest'

import { DEFAULT_THEME, themeIdForScenario, themes } from './theme'

describe('campaign UI palettes', () => {
  test('Fulda Gap keeps the German black, red and gold', () => {
    expect(themeIdForScenario('fulda-gap')).toBe('germany')
    expect(themes.germany.signal).toBe('#d9443a')
    expect(themes.germany.highlight).toBe('#e8b730')
  })

  test('Caucasus Ridge gets its own palette', () => {
    expect(themeIdForScenario('caucasus-ridge')).toBe('caucasus')
    expect(themes.caucasus.signal).not.toBe(themes.germany.signal)
  })

  test('other scenarios and unknown ids keep the default', () => {
    expect(themeIdForScenario('red-bullet')).toBe(DEFAULT_THEME)
    expect(themeIdForScenario(undefined)).toBe(DEFAULT_THEME)
  })

  test('every palette defines every token', () => {
    const keys = Object.keys(themes.germany).sort()
    for (const palette of Object.values(themes)) {
      expect(Object.keys(palette).sort()).toEqual(keys)
    }
  })
})
