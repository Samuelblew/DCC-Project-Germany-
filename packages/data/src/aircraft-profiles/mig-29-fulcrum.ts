import type { AircraftProfile, ProfileLoadout } from './types'

// CLSIDs as declared by the MiG-29 Fulcrum module (CoreMods/aircraft/MiG-29-Fulcrum).
export const MIG29_STORES = {
  R73: '{MISSILE_R-73_APU-73}',
  R27R: '{MISSILE_R-27R_APU-470}',
  R27T: '{MISSILE_R-27T_APU-470}',
  R27ER: '{MISSILE_R-27ER_APU-470}',
  R27ET: '{MISSILE_R-27ET_APU-470}',
  R60M: '{MISSILE_R-60M_APU-60}',
  TANK: '{PTB_1500_MIG29A}',
  S8OFP: '{ROCKETS_S8-OFP2_BDZ-UMK2-B}',
  S8KOM: '{ROCKETS_S8-KOM_BDZ-UMK2-B}',
  S24B: '{ROCKETS_S24B_BDZ-UMK2-B}',
  FAB250: '{AB_FAB-250_BDZ-UMK2-B}',
  FAB500: '{AB_FAB-500_BDZ-UMK2-B}',
  BETAB500: '{AB_BETAB-500_BDZ-UMK2-B}',
  RBK500: '{AB_RBK-500-PTAB-1M_BDZ-UMK2-B}'
} as const

const {
  R73,
  R27R,
  R27T,
  R27ER,
  R27ET,
  R60M,
  TANK,
  S8OFP,
  S8KOM,
  S24B,
  FAB250,
  FAB500,
  BETAB500,
  RBK500
} = MIG29_STORES

// Station rules of the module: tips (1, 7) take short-range missiles only, outboard (2, 6) add
// air-to-ground stores, inboard (3, 5) also take the R-27 family, and the centreline (4) the tank.
const MISSILE_STATIONS = [1, 2, 3, 5, 6, 7]
const GROUND_ATTACK_STATIONS = [2, 3, 5, 6]
const INBOARD = [3, 5]

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

export const mig29FulcrumProfile: AircraftProfile = {
  aircraftName: 'MiG-29 Fulcrum',
  displayName: 'MiG-29A Fulcrum',
  shortName: 'MiG-29',
  fidelity: 'full',
  role: 'airSuperiority',
  factionTypes: ['MiG-29A'],
  weapons: [
    { id: R60M, name: 'R-60M', ammoNames: ['r60m'], roundsPerStore: 1, stations: MISSILE_STATIONS },
    { id: R73, name: 'R-73', ammoNames: ['r73'], roundsPerStore: 1, stations: MISSILE_STATIONS },
    { id: R27R, name: 'R-27R', ammoNames: ['r27r'], roundsPerStore: 1, stations: INBOARD },
    { id: R27T, name: 'R-27T', ammoNames: ['r27t'], roundsPerStore: 1, stations: INBOARD },
    { id: R27ER, name: 'R-27ER', ammoNames: ['r27er'], roundsPerStore: 1, stations: INBOARD },
    { id: R27ET, name: 'R-27ET', ammoNames: ['r27et'], roundsPerStore: 1, stations: INBOARD },
    {
      id: S8OFP,
      name: 'S-8OFP2 pod (20)',
      ammoNames: ['s8ofp2'],
      roundsPerStore: 20,
      stations: GROUND_ATTACK_STATIONS
    },
    {
      id: S8KOM,
      name: 'S-8KOM pod (20)',
      ammoNames: ['s8kom'],
      roundsPerStore: 20,
      stations: GROUND_ATTACK_STATIONS
    },
    {
      id: S24B,
      name: 'S-24B',
      ammoNames: ['s24b'],
      roundsPerStore: 1,
      stations: GROUND_ATTACK_STATIONS
    },
    {
      id: FAB250,
      name: 'FAB-250',
      ammoNames: ['fab250'],
      roundsPerStore: 1,
      stations: GROUND_ATTACK_STATIONS
    },
    {
      id: FAB500,
      name: 'FAB-500 M-62',
      ammoNames: ['fab500', 'fab500m62'],
      roundsPerStore: 1,
      stations: GROUND_ATTACK_STATIONS
    },
    {
      id: BETAB500,
      name: 'BetAB-500',
      ammoNames: ['betab500'],
      roundsPerStore: 1,
      stations: GROUND_ATTACK_STATIONS
    },
    {
      id: RBK500,
      name: 'RBK-500 PTAB-1M',
      ammoNames: ['rbk500ptab1m', 'rbk500', 'rbk500u'],
      roundsPerStore: 1,
      stations: GROUND_ATTACK_STATIONS
    },
    {
      id: TANK,
      name: '1500 L drop tank',
      ammoNames: [],
      roundsPerStore: 1,
      free: true,
      stations: [4]
    }
  ],
  maxRouteWaypoints: 6,
  radios: {
    comms: [
      {
        name: 'R-862',
        kind: 'combined',
        channels: 20,
        firstChannelLabel: 0,
        bands: [
          [100, 149.975],
          [220, 399.975]
        ],
        missionRadio: 1
      }
    ],
    adf: { name: 'ARK-19', pairs: 4, rangeKhz: [150, 1299.5], missionRadio: 2 },
    defaultPlan: {
      comms: [
        [
          { kind: 'flight' },
          { kind: 'awacs' },
          { kind: 'homeTower', band: 'uhf' },
          { kind: 'jtac' },
          ...Array.from({ length: 16 }, () => ({ kind: 'empty' as const }))
        ]
      ],
      adf: [{ kind: 'home', approach: 0 }, { kind: 'empty' }, { kind: 'empty' }, { kind: 'empty' }]
    }
  },
  navigationAids: ['adf', 'rsbn'],
  units: 'metric',
  stations: [
    { num: 1, label: 'L tip' },
    { num: 2, label: 'L outer' },
    { num: 3, label: 'L inner' },
    { num: 4, label: 'Centre' },
    { num: 5, label: 'R inner' },
    { num: 6, label: 'R outer' },
    { num: 7, label: 'R tip' }
  ],
  loadouts: [
    stations('a2a-r27r', '2x R-27R, 4x R-73, tank', ['CAP', 'Escort', 'Intercept'], {
      1: R73,
      2: R73,
      3: R27R,
      4: TANK,
      5: R27R,
      6: R73,
      7: R73
    }),
    stations('a2a-r27er', '2x R-27ER, 4x R-73, tank', ['CAP', 'Escort', 'Intercept'], {
      1: R73,
      2: R73,
      3: R27ER,
      4: TANK,
      5: R27ER,
      6: R73,
      7: R73
    }),
    stations('a2a-r27t', '2x R-27T, 4x R-73, tank', ['Fighter Sweep'], {
      1: R73,
      2: R73,
      3: R27T,
      4: TANK,
      5: R27T,
      6: R73,
      7: R73
    }),
    stations('cas-s8', '4x S-8 pods, 2x R-73, tank', ['CAS'], {
      1: R73,
      2: S8OFP,
      3: S8OFP,
      4: TANK,
      5: S8OFP,
      6: S8OFP,
      7: R73
    }),
    stations('attack-fab500', '4x FAB-500, 2x R-73, tank', ['Pinpoint Strike', 'Ground Attack'], {
      1: R73,
      2: FAB500,
      3: FAB500,
      4: TANK,
      5: FAB500,
      6: FAB500,
      7: R73
    }),
    stations('runway-betab', '4x BetAB-500, 2x R-73, tank', ['Runway Attack'], {
      1: R73,
      2: BETAB500,
      3: BETAB500,
      4: TANK,
      5: BETAB500,
      6: BETAB500,
      7: R73
    }),
    stations('antiship-s24', '4x S-24B, 2x R-73, tank', ['Antiship Strike'], {
      1: R73,
      2: S24B,
      3: S24B,
      4: TANK,
      5: S24B,
      6: S24B,
      7: R73
    })
  ],
  // Only failures that degrade the aircraft without grounding it. Total SPO-15 and radio failures
  // are left out: the RWR keeps working on its remaining receivers and the radio stays usable.
  minorFailures: [
    { id: 'L006LM_FAILURE_204_RECEIVER_FRONT_LEFT', label: 'SPO-15 front left receiver' },
    { id: 'L006LM_FAILURE_204_RECEIVER_FRONT_RIGHT', label: 'SPO-15 front right receiver' },
    { id: 'L006LM_FAILURE_202_RECEIVER_AFT_RIGHT_TOP', label: 'SPO-15 rear right/top receiver' },
    {
      id: 'L006LM_FAILURE_202_RECEIVER_AFT_LEFT_BOTTOM',
      label: 'SPO-15 rear left/bottom receiver'
    },
    { id: 'L006LM_FAILURE_31_AMPLIFIER_LEFT', label: 'SPO-15 left hemisphere amplifier' },
    { id: 'L006LM_FAILURE_31_AMPLIFIER_RIGHT', label: 'SPO-15 right hemisphere amplifier' },
    { id: 'L006LM_FAILURE_32_AMPLIFIER_ELEVATION', label: 'SPO-15 elevation amplifier' },
    { id: 'RALT_FAILURE_ANTENNA', label: 'Radar altimeter antenna' },
    { id: 'RALT_FAILURE_RT', label: 'Radar altimeter receiver-transmitter' },
    { id: 'RSBN_FAILURE_RECEIVER', label: 'RSBN receiver' },
    { id: 'RSBN_FAILURE_TRANSMITTER', label: 'RSBN transmitter' },
    { id: 'MRP_FAILURE', label: 'Marker receiver' },
    { id: 'RKL_41_ANT_DAMAGE', label: 'RKL-41 ADF antenna' },
    { id: 'RKL_41_ADF_DAMAGE', label: 'RKL-41 ADF goniometer' }
  ]
}
