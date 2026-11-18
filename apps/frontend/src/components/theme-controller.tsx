import { useSelector } from '@xstate/store/react'
import { useLayoutEffect } from 'react'
import { useLocation } from 'react-router'

import { applyTheme, DEFAULT_THEME, themeIdForScenario, themeStore } from '@/lib/theme'
import { activeStore } from '@/stores/active'

const CAMPAIGN_PATHS = new Set(['/', '/mission'])

/**
 * Picks the UI palette: the open campaign's on the campaign screens, the highlighted scenario's on
 * the scenario picker, the default everywhere else.
 */
export function ThemeController() {
  const { pathname } = useLocation()
  const campaignScenarioId = useSelector(activeStore, (state) => state.context.scenarioId)
  const previewScenarioId = useSelector(themeStore, (state) => state.context.previewScenarioId)

  const themeId = CAMPAIGN_PATHS.has(pathname)
    ? themeIdForScenario(campaignScenarioId)
    : pathname === '/new/scenario' && previewScenarioId
      ? themeIdForScenario(previewScenarioId)
      : DEFAULT_THEME

  useLayoutEffect(() => {
    applyTheme(themeId)
  }, [themeId])

  return null
}
