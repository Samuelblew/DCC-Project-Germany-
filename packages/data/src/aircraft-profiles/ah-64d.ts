import type { AircraftProfile, ProfileLoadout } from './types'

// CLSIDs and stations from the Eagle Dynamics AH-64D BLK.II module
// (CoreMods/aircraft/AH-64D/AH-64D.lua & UnitPayloads/AH-64D_BLK_II.lua).
export const AH64D_STORES = {
  AGM114K_4: '{88D18A5E-99C8-4B04-B40B-1C02F2018B6E}',
  AGM114L_4: '{M299_4xAGM_114L}',
  AGM114_2K2L: '{M299_2xAGM_114K_2xAGM_114L}',
  M261_MK151: 'M261_MK151',
  M261_M229: '{M261_M229}',
  M261_OUTBOARD_M257: '{M261_OUTBOARD_AB_M151_E_M257}',
  EFT_230GAL: '{EFT_230GAL}',
  IAFS_100: '{IAFS_ComboPak_100}',
  FCR_APG78: '{AN_APG_78}'
} as const

const {
  AGM114K_4,
  AGM114L_4,
  AGM114_2K2L,
  M261_MK151,
  M261_M229,
  M261_OUTBOARD_M257,
  EFT_230GAL,
  IAFS_100,
  FCR_APG78
} = AH64D_STORES

const WING_STATIONS = [1, 2, 3, 4]
const INNER_STATIONS = [2, 3]
const OUTER_STATIONS = [1, 4]

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

const emptyComms = (count: number) =>
  Array.from({ length: count }, () => ({ kind: 'empty' as const }))

export const ah64dProfile: AircraftProfile = {
  aircraftName: 'AH-64D_BLK_II',
  displayName: 'AH-64D BLK.II Apache',
  shortName: 'AH-64D',
  fidelity: 'full',
  role: 'helicopter',
  weapons: [
    {
      id: AGM114K_4,
      name: '4x AGM-114K Hellfire',
      ammoNames: ['agm114k'],
      roundsPerStore: 4,
      stations: WING_STATIONS
    },
    {
      id: AGM114L_4,
      name: '4x AGM-114L Longbow Hellfire',
      ammoNames: ['agm114l'],
      roundsPerStore: 4,
      stations: WING_STATIONS
    },
    {
      id: AGM114_2K2L,
      name: '2x AGM-114K + 2x AGM-114L Hellfire',
      ammoNames: ['agm114k', 'agm114l'],
      roundsPerStore: 4,
      stations: WING_STATIONS
    },
    {
      id: M261_MK151,
      name: 'M261 Hydra M151 HE (19)',
      ammoNames: ['hydra70m151', 'm151'],
      roundsPerStore: 19,
      stations: WING_STATIONS
    },
    {
      id: M261_M229,
      name: 'M261 Hydra M229 HEDP (19)',
      ammoNames: ['hydra70m229', 'm229'],
      roundsPerStore: 19,
      stations: WING_STATIONS
    },
    {
      id: M261_OUTBOARD_M257,
      name: 'M261 Hydra M151 HE / M257 Illum (19)',
      ammoNames: ['hydra70m151', 'm151', 'hydra70m257', 'm257'],
      roundsPerStore: 19,
      stations: OUTER_STATIONS
    },
    {
      id: EFT_230GAL,
      name: '230 gal external tank',
      ammoNames: [],
      roundsPerStore: 1,
      free: true,
      stations: INNER_STATIONS
    },
    {
      id: IAFS_100,
      name: '100 gal IAFS internal tank',
      ammoNames: [],
      roundsPerStore: 1,
      free: true,
      stations: [5]
    },
    {
      id: FCR_APG78,
      name: 'AN/APG-78 Longbow FCR',
      ammoNames: [],
      roundsPerStore: 1,
      free: true,
      stations: [6]
    }
  ],
  radios: {
    comms: [
      {
        name: 'UHF AN/ARC-164',
        kind: 'uhf',
        channels: 10,
        firstChannelLabel: 1,
        bands: [[225, 399.975]],
        missionRadio: 2
      },
      {
        name: 'VHF AN/ARC-186',
        kind: 'vhf',
        channels: 10,
        firstChannelLabel: 1,
        bands: [[108, 151.975]],
        missionRadio: 1
      }
    ],
    defaultPlan: {
      comms: [
        [
          { kind: 'flight' },
          { kind: 'awacs' },
          { kind: 'homeTower', band: 'uhf' },
          { kind: 'jtac' },
          ...emptyComms(6)
        ],
        [{ kind: 'homeTower', band: 'vhf' }, ...emptyComms(9)]
      ],
      adf: []
    }
  },
  navigationAids: ['adf'],
  units: 'imperial',
  stations: [
    { num: 1, label: 'L outer' },
    { num: 2, label: 'L inner' },
    { num: 3, label: 'R inner' },
    { num: 4, label: 'R outer' },
    { num: 5, label: 'IAFS' },
    { num: 6, label: 'MMA' }
  ],
  loadouts: [
    stations(
      'cas-standard',
      '8x AGM-114K, 2x M261 Hydra (19), IAFS',
      ['CAS', 'Ground Attack', 'Pinpoint Strike', 'CSAR'],
      {
        1: M261_MK151,
        2: AGM114K_4,
        3: AGM114K_4,
        4: M261_MK151,
        5: IAFS_100
      }
    ),
    stations(
      'cas-longbow-fcr',
      '4x AGM-114K, 4x AGM-114L, 2x M261 Hydra (19), FCR, IAFS',
      ['CAS', 'Ground Attack', 'Pinpoint Strike', 'DEAD', 'Escort'],
      {
        1: M261_MK151,
        2: AGM114_2K2L,
        3: AGM114_2K2L,
        4: M261_MK151,
        5: IAFS_100,
        6: FCR_APG78
      }
    ),
    stations(
      'dead-hellfire-heavy',
      '8x AGM-114L, 8x AGM-114K, FCR, IAFS',
      ['DEAD', 'Pinpoint Strike', 'Ground Attack', 'Antiship Strike'],
      {
        1: AGM114K_4,
        2: AGM114L_4,
        3: AGM114L_4,
        4: AGM114K_4,
        5: IAFS_100,
        6: FCR_APG78
      }
    ),
    stations(
      'attack-hydra-heavy',
      '4x M261 Hydra M229 HEDP (19), IAFS',
      ['CAS', 'Ground Attack', 'CSAR'],
      {
        1: M261_M229,
        2: M261_M229,
        3: M261_M229,
        4: M261_M229,
        5: IAFS_100
      }
    ),
    stations(
      'cas-night-illum',
      '8x AGM-114K, 2x M261 M151/M257 Illum, FCR, IAFS',
      ['CAS', 'CSAR', 'AFAC'],
      {
        1: M261_OUTBOARD_M257,
        2: AGM114K_4,
        3: AGM114K_4,
        4: M261_OUTBOARD_M257,
        5: IAFS_100,
        6: FCR_APG78
      }
    )
  ],
  minorFailures: [
    { id: 'AN_APR39_FAILURE_SENSOR_NOSE_LEFT', label: 'APR-39 nose left sensor' },
    { id: 'AN_APR39_FAILURE_SENSOR_NOSE_RIGHT', label: 'APR-39 nose right sensor' },
    { id: 'AN_APR39_FAILURE_SENSOR_TAIL_LEFT', label: 'APR-39 tail left sensor' },
    { id: 'AN_APR39_FAILURE_SENSOR_TAIL_RIGHT', label: 'APR-39 tail right sensor' },
    { id: 'ARN_149_ANT_DAMAGE', label: 'ARN-149 ADF antenna' },
    { id: 'ARN_149_TOTAL_FAILURE', label: 'ARN-149 ADF receiver' },
    { id: 'FAILURE_CHAFF_DISPENSER', label: 'Chaff dispenser' },
    { id: 'FAILURE_FLARE_DISPENSER_LEFT', label: 'Left flare dispenser' },
    { id: 'FAILURE_FLARE_DISPENSER_RIGHT', label: 'Right flare dispenser' },
    { id: 'RALT_FAILURE_ANTENNA', label: 'Radar altimeter antenna' },
    { id: 'RALT_FAILURE_RT', label: 'Radar altimeter receiver-transmitter' }
  ]
}
