import {
  type AircraftProfile,
  aircraftProfiles,
  getTheatreAirdromeRadio,
  moduleSnapshots,
  theatres
} from '@dcc/data'
import { describe, expect, test } from 'vitest'

import { resolveRadioPlan } from './radio-plan'

const cases = aircraftProfiles.map((profile) => [profile.aircraftName, profile] as const)

function inBands(frequency: number, bands: Array<[number, number]>) {
  return bands.some(([min, max]) => frequency >= min && frequency <= max)
}

describe.each(cases)('the %s profile', (_name, profile: AircraftProfile) => {
  const snapshot = moduleSnapshots[profile.aircraftName]

  test('loadouts put each store on a station that takes it, one store per station', () => {
    const stationNumbers = profile.stations.map((station) => station.num)
    expect(new Set(stationNumbers).size).toBe(stationNumbers.length)
    for (const weapon of profile.weapons) {
      expect(
        weapon.stations.every((num) => stationNumbers.includes(num)),
        weapon.name
      ).toBe(true)
    }
    for (const loadout of profile.loadouts) {
      const used = loadout.pylons.map((pylon) => pylon.num)
      expect(new Set(used).size, loadout.id).toBe(used.length)
      for (const pylon of loadout.pylons) {
        const weapon = profile.weapons.find((entry) => entry.id === pylon.CLSID)
        expect(weapon?.stations, `${loadout.id} station ${pylon.num}`).toContain(pylon.num)
      }
    }
  })

  test('no two stores share an ammo name, so the rounds left are counted per store', () => {
    const owners = new Map<string, string>()
    for (const weapon of profile.weapons) {
      for (const name of weapon.ammoNames) {
        expect(
          owners.get(name),
          `${weapon.name} and ${owners.get(name)} both report ${name}`
        ).toBeUndefined()
        owners.set(name, weapon.name)
      }
    }
  })

  test('was checked against the installed module (scripts/verify-aircraft-profile.ts)', () => {
    expect(snapshot, 'run the verify script with --write for this aircraft').toBeDefined()
    expect(snapshot!.fidelity).toBe(profile.fidelity)
  })

  test('only uses store CLSIDs the module knows', () => {
    const unknown = profile.weapons.filter((weapon) => !snapshot?.clsids.includes(weapon.id))
    expect(unknown.map((weapon) => weapon.name)).toEqual([])
  })

  test('on a Flaming Cliffs module, only puts stores where DCS was seen carrying them', () => {
    if (profile.fidelity !== 'flamingCliffs') return
    for (const weapon of profile.weapons) {
      const seen = snapshot?.observedStations[weapon.id] ?? []
      expect(
        weapon.stations.filter((num) => !seen.includes(num)),
        weapon.name
      ).toEqual([])
    }
  })

  test('only arms failures the module defines', () => {
    const unknown = profile.minorFailures.filter(
      (failure) => !snapshot?.failures.includes(failure.id)
    )
    expect(unknown.map((failure) => failure.id)).toEqual([])
  })

  test('programs only radios the module has, within their channels and bands', () => {
    for (const radio of profile.radios?.comms ?? []) {
      const moduleRadio = snapshot?.radios[radio.missionRadio - 1]
      expect(moduleRadio, radio.name).toBeDefined()
      expect(radio.channels).toBeLessThanOrEqual(moduleRadio!.channels)
      for (const [min, max] of radio.bands) {
        expect(inBands(min, moduleRadio!.bands) && inBands(max, moduleRadio!.bands)).toBe(true)
      }
    }
  })

  test('the default radio plan fits each radio at every airfield with radio data', () => {
    const radios = profile.radios
    if (!radios) return
    const plan = radios.defaultPlan
    expect(plan.comms.length).toBeLessThanOrEqual(radios.comms.length)
    plan.comms.forEach((channels, index) => {
      expect(channels.length).toBeLessThanOrEqual(radios.comms[index]!.channels)
    })
    expect(plan.adf.length).toBeLessThanOrEqual(radios.adf?.pairs ?? 0)

    for (const theatre of theatres) {
      const airdromeRadio = getTheatreAirdromeRadio(theatre.name)
      for (const homeBase of Object.keys(airdromeRadio)) {
        // The flight frequency comes from the generator; every other preset comes from the plan.
        const firstBand = radios.comms[0]!.bands[0]!
        const { radios: resolved } = resolveRadioPlan(plan, radios, {
          flightFrequency: firstBand[0],
          homeBase,
          airdromeRadio
        })
        radios.comms.forEach((radio) => {
          for (const frequency of Object.values(resolved[radio.missionRadio - 1]!.channels)) {
            expect(
              inBands(frequency, radio.bands),
              `${radio.name} ${frequency} at ${homeBase}`
            ).toBe(true)
          }
        })
      }
    }
  })
})
