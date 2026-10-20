import { schemas } from '@dcc/contracts'
import { initialWeather, rollWeather, WEATHER_LABELS } from '@dcc/data'
import type * as z from 'zod'

import { logCampaignAction } from '@/logic/simulation-log'

import { resolveSpawnContext } from './spawn/packages/common'

type Campaign = z.infer<typeof schemas.campaign.campaign>

/**
 * Moves the campaign weather along: when the current pattern runs out, the forecast arrives and a
 * new forecast is drawn. Campaigns saved before weather existed start from the climate.
 */
export function updateWeather(draft: Campaign, random: () => number = Math.random) {
  const context = resolveSpawnContext(draft, 'player')
  if (!context) return
  if (!draft.weather) {
    draft.weather = initialWeather(context.theatre, draft.time, random)
    return
  }
  if (draft.time.getTime() < draft.weather.nextChangeAt.getTime()) return

  const previous = draft.weather.pattern
  draft.weather = rollWeather(draft.weather.forecast, context.theatre, draft.time, random)
  if (draft.weather.pattern !== previous) {
    logCampaignAction(
      draft,
      'player',
      `Weather: ${WEATHER_LABELS[draft.weather.pattern].toLowerCase()}, cloud base ${draft.weather.cloudBase} m`
    )
  }
}
