import type { AircraftProfile, ProfileLoadout } from './types'

// CLSIDs and stations from the module's own pylon table (CoreMods/aircraft/A-10/A-10A.lua).
export const A10A_STORES = {
  AIM9M_PAIR: '{DB434044-F5D0-4F1F-9BA9-B73027E18DD3}',
  ECM: '{6D21ECEA-F85B-4E8D-9D51-31DC9B8AA4EF}',
  MK82: '{BCE4E030-38E9-423E-98ED-24BE3DA87C32}',
  MK84: '{AB8B8299-F1CC-4359-89B5-2172E0CF4A5A}',
  MK20: '{ADD3FAE1-EBF6-4EF9-8EFC-B36B5DDF1E6B}',
  CBU87: '{CBU-87}',
  CBU97: '{5335D97A-35A5-4643-9D9B-026C75961E52}',
  LAU68_M151: '{A021F29D-18AB-4d3e-985C-FC9C60E35E9E}',
  AGM65K: '{69DC8AE7-8F77-427B-B8AA-B19D3F478B66}',
  AGM65D_TRIPLE: '{DAC53A2F-79CA-42FF-A77A-F5649B601308}',
  TANK: 'Fuel_Tank_FT600'
} as const

const { AIM9M_PAIR, ECM, MK82, MK84, MK20, CBU87, CBU97, LAU68_M151, AGM65K, AGM65D_TRIPLE, TANK } =
  A10A_STORES

// Station rules of the module: the tips (1, 11) take the Sidewinder pair or the ECM pod, the
// Mavericks only 3 and 9, rockets the wing stations, the Mk-84 3 to 9. The centreline (6) excludes
// 5 and 7, so it is left empty and bombs use the other eight stations.
const TIPS = [1, 11]
const BOMB_STATIONS = [2, 3, 4, 5, 7, 8, 9, 10]
const HEAVY_STATIONS = [3, 4, 5, 7, 8, 9]
const ROCKET_STATIONS = [2, 3, 4, 8, 9, 10]
const MAVERICK_STATIONS = [3, 9]

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

export const a10aProfile: AircraftProfile = {
  aircraftName: 'A-10A',
  displayName: 'A-10A Thunderbolt II',
  shortName: 'A-10A',
  fidelity: 'flamingCliffs',
  role: 'attack',
  weapons: [
    {
      id: AIM9M_PAIR,
      name: 'AIM-9M pair',
      ammoNames: ['aim9m', 'aim9'],
      roundsPerStore: 2,
      stations: TIPS
    },
    { id: MK82, name: 'Mk-82', ammoNames: ['mk82'], roundsPerStore: 1, stations: BOMB_STATIONS },
    { id: MK84, name: 'Mk-84', ammoNames: ['mk84'], roundsPerStore: 1, stations: HEAVY_STATIONS },
    {
      id: MK20,
      name: 'Mk-20 Rockeye',
      ammoNames: ['mk20', 'rockeye'],
      roundsPerStore: 1,
      stations: BOMB_STATIONS
    },
    { id: CBU87, name: 'CBU-87', ammoNames: ['cbu87'], roundsPerStore: 1, stations: BOMB_STATIONS },
    { id: CBU97, name: 'CBU-97', ammoNames: ['cbu97'], roundsPerStore: 1, stations: BOMB_STATIONS },
    {
      id: LAU68_M151,
      name: 'LAU-68 M151 (7)',
      ammoNames: ['hydra70m151'],
      roundsPerStore: 7,
      stations: ROCKET_STATIONS
    },
    {
      id: AGM65K,
      name: 'AGM-65K',
      ammoNames: ['agm65k'],
      roundsPerStore: 1,
      stations: MAVERICK_STATIONS
    },
    {
      id: AGM65D_TRIPLE,
      name: 'AGM-65D triple rack',
      ammoNames: ['agm65d'],
      roundsPerStore: 3,
      stations: MAVERICK_STATIONS
    },
    { id: ECM, name: 'ALQ-131 ECM', ammoNames: [], roundsPerStore: 1, free: true, stations: TIPS },
    {
      id: TANK,
      name: '600 gal drop tank',
      ammoNames: [],
      roundsPerStore: 1,
      free: true,
      stations: [4, 8]
    }
  ],
  navigationAids: ['tacan', 'ils'],
  units: 'imperial',
  stations: [
    { num: 1, label: 'L tip' },
    { num: 2, label: 'L outer' },
    { num: 3, label: 'L Maverick' },
    { num: 4, label: 'L inner' },
    { num: 5, label: 'L fuselage' },
    { num: 6, label: 'Centre' },
    { num: 7, label: 'R fuselage' },
    { num: 8, label: 'R inner' },
    { num: 9, label: 'R Maverick' },
    { num: 10, label: 'R outer' },
    { num: 11, label: 'R tip' }
  ],
  loadouts: [
    stations('cas-maverick', '6x AGM-65D, 4x Mk-82, 2x LAU-68, AIM-9M, ECM', ['CAS'], {
      1: AIM9M_PAIR,
      2: LAU68_M151,
      3: AGM65D_TRIPLE,
      4: MK82,
      5: MK82,
      7: MK82,
      8: MK82,
      9: AGM65D_TRIPLE,
      10: LAU68_M151,
      11: ECM
    }),
    stations(
      'cas-rockeye',
      '2x AGM-65K, 4x Mk-20, 2x LAU-68, AIM-9M, ECM',
      ['CAS', 'Ground Attack'],
      {
        1: AIM9M_PAIR,
        2: LAU68_M151,
        3: AGM65K,
        4: MK20,
        5: MK20,
        7: MK20,
        8: MK20,
        9: AGM65K,
        10: LAU68_M151,
        11: ECM
      }
    ),
    stations('attack-cbu97', '2x AGM-65K, 4x CBU-97, 2x CBU-87, AIM-9M, ECM', ['Ground Attack'], {
      1: AIM9M_PAIR,
      2: CBU87,
      3: AGM65K,
      4: CBU97,
      5: CBU97,
      7: CBU97,
      8: CBU97,
      9: AGM65K,
      10: CBU87,
      11: ECM
    }),
    stations(
      'strike-mk84',
      '4x Mk-84, 2x Mk-82, AIM-9M, ECM',
      ['Pinpoint Strike', 'Runway Attack'],
      {
        1: AIM9M_PAIR,
        3: MK84,
        4: MK84,
        5: MK82,
        7: MK82,
        8: MK84,
        9: MK84,
        11: ECM
      }
    )
  ],
  // Failures the module lets a mission arm that leave the aircraft flyable and able to fight.
  minorFailures: [
    { id: 'autopilot', label: 'Autopilot' },
    { id: 'mlws', label: 'Missile launch warning' },
    { id: 'ecm', label: 'ECM' }
  ]
}
