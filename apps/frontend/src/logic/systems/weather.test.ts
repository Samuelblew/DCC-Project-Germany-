import { schemas } from '@dcc/contracts'
import {
  dcsMissionWeather,
  isLowCeiling,
  nextWeatherPattern,
  rollWeather,
  theatres,
  weatherTemperature,
  WEATHER_PATTERNS
} from '@dcc/data'
import { produce } from 'immer'
import { describe, expect, test } from 'vitest'
import type * as z from 'zod'

import { updateWeather } from './weather'

type Campaign = z.infer<typeof schemas.campaign.campaign>

const germany = theatres.find((theatre) => theatre.name === 'Cold War Germany')!
const gulf = theatres.find((theatre) => theatre.name === 'PersianGulf')!
const winter = new Date('1985-01-15T12:00:00Z')
const summer = new Date('1985-07-15T12:00:00Z')

function seeded(seed: number) {
  let state = seed
  return () => {
    state = (state * 1_103_515_245 + 12_345) % 2_147_483_648
    return state / 2_147_483_648
  }
}

describe('campaign weather', () => {
  test('the chain drifts towards the climate: German winters cloud over, the Gulf clears', () => {
    const run = (theatre: typeof germany, time: Date) => {
      const random = seeded(7)
      let pattern: (typeof WEATHER_PATTERNS)[number] = 'clear'
      const counts = Object.fromEntries(WEATHER_PATTERNS.map((entry) => [entry, 0]))
      for (let step = 0; step < 400; step += 1) {
        pattern = nextWeatherPattern(pattern, theatre, time, random)
        counts[pattern]! += 1
      }
      return counts
    }
    const germanWinter = run(germany, winter)
    expect(germanWinter.overcast! + germanWinter.rain!).toBeGreaterThan(germanWinter.clear!)
    const gulfSummer = run(gulf, summer)
    expect(gulfSummer.clear! + gulfSummer.scattered!).toBeGreaterThan(300)
  })

  test('each pattern gets a preset and a base the preset accepts', () => {
    const random = seeded(3)
    for (const pattern of WEATHER_PATTERNS) {
      const weather = rollWeather(pattern, germany, winter, random)
      if (pattern === 'clear') expect(weather.preset).toBeUndefined()
      else expect(weather.preset).toBeDefined()
      expect(weather.cloudBase).toBeGreaterThanOrEqual(500)
      expect(weather.cloudBase).toBeLessThanOrEqual(2500)
      expect(weather.nextChangeAt.getTime()).toBeGreaterThan(winter.getTime())
    }
    expect(isLowCeiling(rollWeather('rain', germany, winter, random))).toBe(true)
    expect(isLowCeiling(rollWeather('scattered', germany, winter, random))).toBe(false)
  })

  test('winter is colder than summer and noon warmer than dawn', () => {
    expect(weatherTemperature(germany, undefined, winter)).toBeLessThan(
      weatherTemperature(germany, undefined, summer)
    )
    expect(weatherTemperature(germany, undefined, summer)).toBeGreaterThan(
      weatherTemperature(germany, undefined, new Date('1985-07-15T04:00:00Z'))
    )
  })

  test('the mission gets the campaign sky; old campaigns keep the fixed one', () => {
    const weather = rollWeather('overcast', germany, winter, seeded(1))
    const mission = dcsMissionWeather(germany, weather, winter)
    expect(mission.clouds.preset).toBe(weather.preset)
    expect(mission.clouds.base).toBe(weather.cloudBase)
    expect(mission.qnh).toBe(weather.qnh)
    expect(dcsMissionWeather(germany, undefined, winter).clouds.preset).toBe('Preset2')
  })

  test('the forecast arrives when its time comes', () => {
    let campaign = produce(
      { scenarioId: 'fulda-gap', time: winter, logs: [] } as unknown as Campaign,
      (draft) => updateWeather(draft, seeded(5))
    )
    const first = campaign.weather!
    campaign = produce(campaign, (draft) => {
      draft.time = new Date(first.nextChangeAt.getTime() - 1000)
      updateWeather(draft, seeded(5))
    })
    expect(campaign.weather).toEqual(first)
    campaign = produce(campaign, (draft) => {
      draft.time = first.nextChangeAt
      updateWeather(draft, seeded(5))
    })
    expect(campaign.weather?.pattern).toBe(first.forecast)
  })
})
