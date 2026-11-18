import { describe, expect, test } from 'vitest'

import {
  getCampaignDateForYear,
  getGpsEnabledCampaignDate,
  GPS_AVAILABLE_FROM_ISO,
  GPS_ENABLED_OVERRIDE_YEAR,
  isGpsAvailable
} from './gps-availability'

describe('GPS availability', () => {
  test('changes only the campaign year', () => {
    expect(getCampaignDateForYear('1982-05-01T09:30:15.000Z', 2004).toISOString()).toBe(
      '2004-05-01T09:30:15.000Z'
    )
  })

  test('uses the DCS GPS activation date as the availability boundary', () => {
    expect(GPS_AVAILABLE_FROM_ISO).toBe('1994-03-28T00:00:00.000Z')
    expect(isGpsAvailable('1994-03-27T23:59:59.999Z')).toBe(false)
    expect(isGpsAvailable(GPS_AVAILABLE_FROM_ISO)).toBe(true)
  })

  test('forces an earlier campaign to 1995 while preserving its month, day, and start time', () => {
    expect(GPS_ENABLED_OVERRIDE_YEAR).toBe(1995)
    expect(getGpsEnabledCampaignDate('1982-05-01T09:30:15.000Z').toISOString()).toBe(
      '1995-05-01T09:30:15.000Z'
    )
  })

  test('does not change an already GPS-enabled campaign date', () => {
    expect(getGpsEnabledCampaignDate('2022-06-01T09:00:00.000Z').toISOString()).toBe(
      '2022-06-01T09:00:00.000Z'
    )
  })
})
