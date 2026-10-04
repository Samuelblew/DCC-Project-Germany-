import { getAircraftProfile, getTheatreAirdromeRadio, type ProfileRadios } from '@dcc/data'
import { describe, expect, test } from 'vitest'

import { resolveRadioPlan } from './radio-plan'

const germany = getTheatreAirdromeRadio('Cold War Germany')
const mig29Radios = getAircraftProfile('MiG-29 Fulcrum')!.radios!

describe('resolveRadioPlan', () => {
  test('fills comms presets from the mission and the terrain, and ADF pairs from approach NDBs', () => {
    const resolved = resolveRadioPlan(
      {
        comms: [
          [
            { kind: 'flight' },
            { kind: 'awacs' },
            { kind: 'homeTower', band: 'uhf' },
            { kind: 'jtac' },
            { kind: 'tower', airfield: 'Laage', band: 'vhf' },
            { kind: 'empty' },
            { kind: 'manual', mhz: 124.5 }
          ]
        ],
        adf: [{ kind: 'home', approach: 0 }, { kind: 'empty' }]
      },
      mig29Radios,
      { flightFrequency: 260.25, homeBase: 'Cochstedt', airdromeRadio: germany }
    )

    expect(resolved.radios[0]).toEqual({
      channels: { 1: 260.25, 2: 251, 3: 254.7, 4: 305, 5: 129.5, 7: 124.5 }
    })
    // Cochstedt approach: outer 950 kHz, inner 470 kHz, stored in MHz like the mission editor.
    expect(resolved.radios[1]).toEqual({ channels: { 1: 0.95, 2: 0.47 } })
    // The R-862 labels its first preset "Channel 0".
    expect(resolved.channels.map((c) => [c.purpose, c.channel, c.cockpitChannel])).toEqual([
      ['FLIGHT', 1, 0],
      ['AWACS', 2, 1],
      ['ATC', 3, 2],
      ['JTAC', 4, 3]
    ])
  })

  test('places each comms set in the Radio slot its profile names', () => {
    const uhfVhf: ProfileRadios = {
      comms: [
        {
          name: 'UHF',
          kind: 'uhf',
          channels: 20,
          firstChannelLabel: 1,
          bands: [[225, 399.975]],
          missionRadio: 1
        },
        {
          name: 'VHF',
          kind: 'vhf',
          channels: 20,
          firstChannelLabel: 1,
          bands: [[108, 151.975]],
          missionRadio: 2
        }
      ],
      defaultPlan: { comms: [], adf: [] }
    }

    const resolved = resolveRadioPlan(
      {
        comms: [[{ kind: 'flight' }], [{ kind: 'empty' }, { kind: 'homeTower', band: 'vhf' }]],
        adf: [{ kind: 'home', approach: 0 }]
      },
      uhfVhf,
      { flightFrequency: 260.25, homeBase: 'Laage', airdromeRadio: germany }
    )

    expect(resolved.radios).toEqual([{ channels: { 1: 260.25 } }, { channels: { 2: 129.5 } }])
    expect(resolved.channels).toEqual([
      { purpose: 'FLIGHT', radio: 1, channel: 1, frequency: 260.25 },
      { purpose: 'ATC', radio: 2, channel: 2, frequency: 129.5 }
    ])
  })

  test('the F-16C default plan puts the flight on UHF and the tower on both sets', () => {
    const radios = getAircraftProfile('F-16C_50')!.radios!
    const resolved = resolveRadioPlan(radios.defaultPlan, radios, {
      flightFrequency: 260.25,
      homeBase: 'Laage',
      airdromeRadio: germany
    })

    expect(resolved.radios[0]?.channels[1]).toBe(260.25)
    expect(resolved.radios[0]?.channels[3]).toBe(germany.Laage?.radio?.uhf)
    expect(resolved.radios[1]?.channels[1]).toBe(germany.Laage?.radio?.vhf)
    expect(
      resolved.channels.map((channel) => [channel.purpose, channel.radio, channel.channel])
    ).toEqual([
      ['FLIGHT', 1, 1],
      ['AWACS', 1, 2],
      ['ATC', 1, 3],
      ['JTAC', 1, 4]
    ])
  })
})
