import type { AircraftProfile, ProfileLoadout } from './types'

// CLSIDs as declared by the F-16C bl.50 module (CoreMods/aircraft/F-16C/F-16C.lua) and as the
// mission editor and bundled missions hang them.
export const F16C_STORES = {
  AIM9M: '{6CEB49FC-DED8-4DED-B053-E1F033FF72D3}',
  AIM9X: '{5CE2FF2A-645A-4197-B48D-8720AC69394F}',
  AIM120B: '{C8E06185-7CD6-4C90-959F-044679E90751}',
  AIM120C: '{40EF17B7-F508-45de-8566-6FFECC0C1AB8}',
  AGM88C: '{B06DD79A-F21E-4EB9-BD9D-AB3844618C93}',
  AGM65D: '{444BA8AE-82A7-4345-842E-76154EFCCA46}',
  AGM65K: '{69DC8AE7-8F77-427B-B8AA-B19D3F478B66}',
  GBU12: '{DB769D48-67D7-42ED-A2BE-108D566C8B1E}',
  GBU10: '{51F9AAE5-964F-4D21-83FB-502E3BFE5F8A}',
  GBU31: '{GBU-31}',
  MK84: '{AB8B8299-F1CC-4359-89B5-2172E0CF4A5A}',
  CBU87: '{CBU-87}',
  MK82_TER: '{TER_9A_3*MK-82}',
  HYDRA: 'LAU3_HE151',
  TANK_WING: '{F376DBEE-4CAE-41BA-ADD9-B2910AC95DEC}',
  TANK_CENTRE: '{8A0BE8AE-58D4-4572-9263-3144C0D06364}',
  ECM: 'ALQ_184_Long',
  TGP: '{A111396E-D3E8-4b9c-8AC9-2432489304D5}',
  HTS: '{AN_ASQ_213}'
} as const

const {
  AIM9M,
  AIM9X,
  AIM120B,
  AIM120C,
  AGM88C,
  AGM65D,
  AGM65K,
  GBU12,
  GBU10,
  GBU31,
  MK84,
  CBU87,
  MK82_TER,
  HYDRA,
  TANK_WING,
  TANK_CENTRE,
  ECM,
  TGP,
  HTS
} = F16C_STORES

// Station rules of the module: the tips and outer pylons (1, 2, 8, 9) take air-to-air missiles,
// the mid-wing pylons (3, 7) add air-to-ground stores, the inner pylons (4, 6) tanks and heavier
// bombs, the centreline (5) a tank or ECM, the chin stations (10, 11) the HTS and targeting pod.
const AAM = [1, 2, 3, 7, 8, 9]
const MID = [3, 7]
const BOMB = [3, 4, 6, 7]
const WING_TANKS = [4, 6]

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

export const f16cProfile: AircraftProfile = {
  aircraftName: 'F-16C_50',
  displayName: 'F-16C Viper',
  shortName: 'F-16C',
  fidelity: 'full',
  role: 'multirole',
  weapons: [
    { id: AIM9M, name: 'AIM-9M', ammoNames: ['aim9m'], roundsPerStore: 1, stations: AAM },
    { id: AIM9X, name: 'AIM-9X', ammoNames: ['aim9x'], roundsPerStore: 1, stations: AAM },
    { id: AIM120B, name: 'AIM-120B', ammoNames: ['aim120b'], roundsPerStore: 1, stations: AAM },
    { id: AIM120C, name: 'AIM-120C', ammoNames: ['aim120c'], roundsPerStore: 1, stations: AAM },
    {
      id: AGM88C,
      name: 'AGM-88C',
      ammoNames: ['agm88c', 'agm88'],
      roundsPerStore: 1,
      stations: BOMB
    },
    { id: AGM65D, name: 'AGM-65D', ammoNames: ['agm65d'], roundsPerStore: 1, stations: MID },
    { id: AGM65K, name: 'AGM-65K', ammoNames: ['agm65k'], roundsPerStore: 1, stations: MID },
    { id: GBU12, name: 'GBU-12', ammoNames: ['gbu12'], roundsPerStore: 1, stations: BOMB },
    { id: GBU10, name: 'GBU-10', ammoNames: ['gbu10'], roundsPerStore: 1, stations: BOMB },
    { id: GBU31, name: 'GBU-31', ammoNames: ['gbu31'], roundsPerStore: 1, stations: MID },
    { id: MK84, name: 'Mk-84', ammoNames: ['mk84'], roundsPerStore: 1, stations: BOMB },
    { id: CBU87, name: 'CBU-87', ammoNames: ['cbu87'], roundsPerStore: 1, stations: MID },
    {
      id: MK82_TER,
      name: 'TER-9A 3x Mk-82',
      ammoNames: ['mk82'],
      roundsPerStore: 3,
      stations: MID
    },
    {
      id: HYDRA,
      name: 'LAU-3 M151 (19)',
      ammoNames: ['hydra70m151'],
      roundsPerStore: 19,
      stations: BOMB
    },
    {
      id: TANK_WING,
      name: '370 gal drop tank',
      ammoNames: [],
      roundsPerStore: 1,
      free: true,
      stations: WING_TANKS
    },
    {
      id: TANK_CENTRE,
      name: '300 gal drop tank',
      ammoNames: [],
      roundsPerStore: 1,
      free: true,
      stations: [5]
    },
    { id: ECM, name: 'ALQ-184 ECM', ammoNames: [], roundsPerStore: 1, free: true, stations: [5] },
    {
      id: TGP,
      name: 'AN/AAQ-28 TGP',
      ammoNames: [],
      roundsPerStore: 1,
      free: true,
      stations: [11]
    },
    {
      id: HTS,
      name: 'AN/ASQ-213 HTS',
      ammoNames: [],
      roundsPerStore: 1,
      free: true,
      stations: [10]
    }
  ],
  radios: {
    comms: [
      {
        name: 'UHF AN/ARC-164',
        kind: 'uhf',
        channels: 20,
        firstChannelLabel: 1,
        bands: [[225, 399.975]],
        missionRadio: 1
      },
      {
        name: 'VHF AN/ARC-222',
        kind: 'vhf',
        channels: 20,
        firstChannelLabel: 1,
        bands: [
          [30, 87.975],
          [116, 155.975]
        ],
        missionRadio: 2
      }
    ],
    defaultPlan: {
      comms: [
        [
          { kind: 'flight' },
          { kind: 'awacs' },
          { kind: 'homeTower', band: 'uhf' },
          { kind: 'jtac' },
          ...emptyComms(16)
        ],
        [{ kind: 'homeTower', band: 'vhf' }, ...emptyComms(19)]
      ],
      adf: []
    }
  },
  navigationAids: ['tacan', 'ils'],
  units: 'imperial',
  stations: [
    { num: 1, label: 'L tip' },
    { num: 2, label: 'L outer' },
    { num: 3, label: 'L mid' },
    { num: 4, label: 'L inner' },
    { num: 5, label: 'Centre' },
    { num: 6, label: 'R inner' },
    { num: 7, label: 'R mid' },
    { num: 8, label: 'R outer' },
    { num: 9, label: 'R tip' },
    { num: 10, label: '5L HTS' },
    { num: 11, label: '5R TGP' },
    { num: 12, label: 'Smoke' }
  ],
  loadouts: [
    stations('a2a-120c', '4x AIM-120C, 2x AIM-9X, 3 tanks, TGP', ['CAP', 'Escort', 'Intercept'], {
      1: AIM9X,
      2: AIM120C,
      3: AIM120C,
      4: TANK_WING,
      5: TANK_CENTRE,
      6: TANK_WING,
      7: AIM120C,
      8: AIM120C,
      9: AIM9X,
      11: TGP
    }),
    stations('a2a-120b', '4x AIM-120B, 2x AIM-9M, 3 tanks', ['CAP', 'Escort'], {
      1: AIM9M,
      2: AIM120B,
      3: AIM120B,
      4: TANK_WING,
      5: TANK_CENTRE,
      6: TANK_WING,
      7: AIM120B,
      8: AIM120B,
      9: AIM9M
    }),
    stations('a2a-sweep', '2x AIM-120C, 4x AIM-9X, 2 tanks, ECM, TGP', ['Fighter Sweep'], {
      1: AIM9X,
      2: AIM9X,
      3: AIM120C,
      4: TANK_WING,
      5: ECM,
      6: TANK_WING,
      7: AIM120C,
      8: AIM9X,
      9: AIM9X,
      11: TGP
    }),
    stations(
      'sead-harm',
      '2x AGM-88C, 2x AIM-120C, 2x AIM-9X, 2 tanks, ECM, HTS, TGP',
      ['SEAD', 'DEAD'],
      {
        1: AIM9X,
        2: AIM120C,
        3: AGM88C,
        4: TANK_WING,
        5: ECM,
        6: TANK_WING,
        7: AGM88C,
        8: AIM120C,
        9: AIM9X,
        10: HTS,
        11: TGP
      }
    ),
    stations('cas-mav', '2x AGM-65D, 2x GBU-12, 2x AIM-120C, 2x AIM-9X, ECM, TGP', ['CAS'], {
      1: AIM9X,
      2: AIM120C,
      3: AGM65D,
      4: GBU12,
      5: ECM,
      6: GBU12,
      7: AGM65D,
      8: AIM120C,
      9: AIM9X,
      11: TGP
    }),
    stations(
      'cas-mk82',
      '6x Mk-82, 2x AIM-120C, 2x AIM-9X, 2 tanks, ECM, TGP',
      ['CAS', 'Ground Attack'],
      {
        1: AIM9X,
        2: AIM120C,
        3: MK82_TER,
        4: TANK_WING,
        5: ECM,
        6: TANK_WING,
        7: MK82_TER,
        8: AIM120C,
        9: AIM9X,
        11: TGP
      }
    ),
    stations(
      'strike-gbu',
      '2x GBU-10, 2x AIM-120C, 2x AIM-9X, 2 tanks, ECM, TGP',
      ['Pinpoint Strike'],
      {
        1: AIM9X,
        2: AIM120C,
        3: GBU10,
        4: TANK_WING,
        5: ECM,
        6: TANK_WING,
        7: GBU10,
        8: AIM120C,
        9: AIM9X,
        11: TGP
      }
    ),
    stations(
      'runway-gbu31',
      '2x GBU-31, 2x AIM-120C, 2x AIM-9X, 2 tanks, ECM, TGP',
      ['Runway Attack'],
      {
        1: AIM9X,
        2: AIM120C,
        3: GBU31,
        4: TANK_WING,
        5: ECM,
        6: TANK_WING,
        7: GBU31,
        8: AIM120C,
        9: AIM9X,
        11: TGP
      }
    )
  ],
  // Failures that degrade the aircraft without grounding it. Total RWR, countermeasures, oxygen
  // and UHF transceiver failures are left out: the radio, chaff and a remaining RWR sensor stay
  // usable, and oxygen loss would stop high-altitude flight.
  minorFailures: [
    { id: 'AN_ALR56_FAILURE_SENSOR_NOSE_LEFT', label: 'ALR-56 nose left sensor' },
    { id: 'AN_ALR56_FAILURE_SENSOR_NOSE_RIGHT', label: 'ALR-56 nose right sensor' },
    { id: 'AN_ALR56_FAILURE_SENSOR_TAIL_LEFT', label: 'ALR-56 tail left sensor' },
    { id: 'AN_ALR56_FAILURE_SENSOR_TAIL_RIGHT', label: 'ALR-56 tail right sensor' },
    { id: 'CARA_FAILURE_ANTENNA', label: 'Radar altimeter antenna' },
    { id: 'CARA_FAILURE_RT', label: 'Radar altimeter receiver-transmitter' },
    { id: 'CARA_FAILURE_SDC', label: 'Radar altimeter SDC' },
    { id: 'UHF_RADIO_FAILURE_ANTENNA_LOWER', label: 'UHF lower antenna' },
    { id: 'UHF_RADIO_FAILURE_ANTENNA_UPPER', label: 'UHF upper antenna' },
    { id: 'AN_ALE_47_FAILURE_CONTAINER', label: 'ALE-47 dispenser' },
    { id: 'FAILURE_IDM_ANT', label: 'IDM antenna' },
    { id: 'FAILURE_MIDS_ANT', label: 'MIDS antenna' },
    { id: 'CLOCK_FAILURE', label: 'Clock' }
  ]
}
