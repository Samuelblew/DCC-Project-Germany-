import { scenarios } from '@dcc/data'
import { createStore } from '@xstate/store'
import { useSelector } from '@xstate/store/react'

/**
 * UI palettes per campaign. CSS reads them through the `--synthwave-*` tokens (names kept from
 * the original theme: pink = signal, purple = secondary metal, cyan = highlight, light = text) and
 * the extra tokens below; the MapLibre layers read the same values through `useThemePalette`.
 */
export type ThemePalette = {
  /** Page background (`--synthwave-dark`). */
  dark: string
  /** Primary accent: active borders, launch buttons, glow (`--synthwave-pink`). */
  signal: string
  /** Secondary metal: gradients, secondary buttons (`--synthwave-purple`). */
  metal: string
  /** Highlight: clocks, positive values, selection (`--synthwave-cyan`). */
  highlight: string
  /** Body text on dark panels (`--synthwave-light`). */
  light: string
  /** Soft warning text: losses, low values (`--signal-soft`). */
  signalSoft: string
  /** The player's own aircraft and tail numbers (`--highlight-bright`). */
  highlightBright: string
  /** Raised panels and tooltips (`--panel`). */
  panel: string
  /** shadcn tokens that carry the palette's hue. */
  foreground: string
  primary: string
  secondary: string
}

export type ThemeId = 'germany' | 'caucasus'

export const themes: Record<ThemeId, ThemePalette> = {
  /** Black, red and gold: the original DCC Project Germany look. */
  germany: {
    dark: '#0f0e0d',
    signal: '#d9443a',
    metal: '#9c6a33',
    highlight: '#e8b730',
    light: '#ede6d6',
    signalSoft: '#ef7f70',
    highlightBright: '#f5d020',
    panel: '#161412',
    foreground: 'oklch(0.928 0.022 85)',
    primary: 'oklch(0.8 0.15 85)',
    secondary: 'oklch(0.72 0.1 60)'
  },
  /**
   * Glacier and apricot: slate night over the ridge, glacier teal for the signal, steel for the
   * passes, the sunrise on Elbrus as the highlight, snow for text.
   */
  caucasus: {
    dark: '#0a1013',
    signal: '#2fa596',
    metal: '#4f7e92',
    highlight: '#f2a65a',
    light: '#e3ecee',
    signalSoft: '#f0866b',
    highlightBright: '#ffd166',
    panel: '#101a1e',
    foreground: 'oklch(0.93 0.012 210)',
    primary: 'oklch(0.79 0.13 60)',
    secondary: 'oklch(0.62 0.06 225)'
  }
}

export const DEFAULT_THEME: ThemeId = 'germany'

const themeByTheatre: Record<string, ThemeId> = {
  'Cold War Germany': 'germany',
  'Cold War Caucasus': 'caucasus'
}

/** Fulda Gap gets Germany, Caucasus Ridge gets the glacier palette, the rest keep the default. */
export function themeIdForScenario(scenarioId: string | undefined): ThemeId {
  const theatreName = scenarios.find((scenario) => scenario.id === scenarioId)?.theatreName
  return (theatreName && themeByTheatre[theatreName]) || DEFAULT_THEME
}

const cssTokens: Record<keyof ThemePalette, string> = {
  dark: '--synthwave-dark',
  signal: '--synthwave-pink',
  metal: '--synthwave-purple',
  highlight: '--synthwave-cyan',
  light: '--synthwave-light',
  signalSoft: '--signal-soft',
  highlightBright: '--highlight-bright',
  panel: '--panel',
  foreground: '--foreground',
  primary: '--primary',
  secondary: '--secondary'
}

export const themeStore = createStore({
  context: {
    id: DEFAULT_THEME as ThemeId,
    /** Scenario highlighted on the scenario picker, before any campaign exists. */
    previewScenarioId: null as string | null
  },
  on: {
    set: (context, event: { id: ThemeId }) =>
      context.id === event.id ? context : { ...context, id: event.id },
    preview: (context, event: { scenarioId: string | null }) =>
      context.previewScenarioId === event.scenarioId
        ? context
        : { ...context, previewScenarioId: event.scenarioId }
  }
})

/** Writes the palette onto `<html>` so every `var(--synthwave-*)` follows it. */
export function applyTheme(id: ThemeId) {
  const palette = themes[id]
  const root = document.documentElement
  for (const [key, token] of Object.entries(cssTokens) as Array<[keyof ThemePalette, string]>) {
    root.style.setProperty(token, palette[key])
  }
  root.dataset.theme = id
  document.body.style.backgroundColor = palette.dark
  themeStore.trigger.set({ id })
}

/** Palette for code that cannot read CSS variables (MapLibre paint, canvas). */
export function useThemePalette(): ThemePalette {
  const id = useSelector(themeStore, (state) => state.context.id)
  return themes[id]
}
