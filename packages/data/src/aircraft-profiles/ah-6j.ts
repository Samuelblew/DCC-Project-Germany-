import type { AircraftProfile, ProfileLoadout } from './types'

// CLSIDs and stations from the AH-6J Little Bird mod (Mods/aircraft/AH-6J/AH6.lua & UnitPayloads/AH-6J.lua).
export const AH6J_STORES = {
  AGM114K_L: 'AH6_AGM_114K_L',
  AGM114K_R: 'AH6_AGM_114K_R',
  M260_M151: '{M260_M151}',
  M261_M229: '{M261_M229}',
  FN_HMP400: '{AH-6_FN_HMP400}',
  M134_L: '{AH6_M134L}',
  M134_R: '{AH6_M134R}'
} as const

const { AGM114K_L, AGM114K_R, M260_M151, M261_M229, FN_HMP400, M134_L, M134_R } = AH6J_STORES

const OUTER_STATIONS = [9, 12]

function stations(
  id: string,
  name: string,
  tasks: ProfileLoadout['tasks'],
  map: Record<number, string>
): ProfileLoadout {
  return {
    id,
    name,
    tasks,
    pylons: Object.entries(map).map(([num, CLSID]) => ({ num: Number(num), CLSID }))
  }
}

export const ah6jProfile: AircraftProfile = {
  aircraftName: 'AH-6J',
  displayName: 'AH-6J Little Bird',
  shortName: 'AH-6J',
  fidelity: 'full',
  role: 'helicopter',
  weapons: [
    {
      id: M134_L,
      name: 'M134 7.62mm Minigun (L)',
      ammoNames: ['ah6762x51mmm80', 'ah6762x51mmm61'],
      roundsPerStore: 2000,
      stations: [10]
    },
    {
      id: M134_R,
      name: 'M134 7.62mm Minigun (R)',
      ammoNames: ['ah6762x51mmm62'],
      roundsPerStore: 2000,
      stations: [11]
    },
    {
      id: M260_M151,
      name: 'M260 Hydra M151 (7)',
      ammoNames: ['hydra70m151', 'm151'],
      roundsPerStore: 7,
      stations: OUTER_STATIONS
    },
    {
      id: M261_M229,
      name: 'M261 Hydra M229 (19)',
      ammoNames: ['hydra70m229', 'm229'],
      roundsPerStore: 19,
      stations: OUTER_STATIONS
    },
    {
      id: FN_HMP400,
      name: 'FN HMP400 .50 cal pod',
      ammoNames: ['m2127', 'm2127t'],
      roundsPerStore: 400,
      stations: OUTER_STATIONS
    },
    {
      id: AGM114K_L,
      name: '2x AGM-114K Hellfire (L)',
      ammoNames: ['agm114k'],
      roundsPerStore: 2,
      stations: [9]
    },
    {
      id: AGM114K_R,
      name: '2x AGM-114K Hellfire (R)',
      ammoNames: ['agm114kr'],
      roundsPerStore: 2,
      stations: [12]
    }
  ],
  navigationAids: ['adf'],
  units: 'imperial',
  stations: [
    { num: 9, label: 'L outer' },
    { num: 10, label: 'L inner' },
    { num: 11, label: 'R inner' },
    { num: 12, label: 'R outer' }
  ],
  loadouts: [
    stations(
      'cas-hydra-m134',
      '2x M134 Minigun, 2x M260 Hydra (7)',
      ['CAS', 'Ground Attack', 'CSAR'],
      {
        9: M260_M151,
        10: M134_L,
        11: M134_R,
        12: M260_M151
      }
    ),
    stations(
      'cas-hellfire-hydra',
      '2x AGM-114K, 1x M260 Hydra, 2x M134 Minigun',
      ['CAS', 'Ground Attack', 'Pinpoint Strike', 'DEAD'],
      {
        9: AGM114K_L,
        10: M134_L,
        11: M134_R,
        12: M260_M151
      }
    ),
    stations(
      'attack-hellfire-heavy',
      '4x AGM-114K Hellfire, 2x M134 Minigun',
      ['CAS', 'Ground Attack', 'Pinpoint Strike', 'DEAD'],
      {
        9: AGM114K_L,
        10: M134_L,
        11: M134_R,
        12: AGM114K_R
      }
    ),
    stations(
      'csar-hmp400-m134',
      '2x FN HMP400 .50 cal, 2x M134 Minigun',
      ['CAS', 'CSAR'],
      {
        9: FN_HMP400,
        10: M134_L,
        11: M134_R,
        12: FN_HMP400
      }
    ),
    stations(
      'attack-m261-heavy',
      '2x M261 Hydra (19), 2x M134 Minigun',
      ['CAS', 'Ground Attack', 'Pinpoint Strike'],
      {
        9: M261_M229,
        10: M134_L,
        11: M134_R,
        12: M261_M229
      }
    )
  ],
  minorFailures: []
}
