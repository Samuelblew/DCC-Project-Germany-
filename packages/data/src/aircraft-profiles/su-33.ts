import type { AircraftProfile, ProfileLoadout } from './types'

// CLSIDs as the Flaming Cliffs Su-33 carries them in the mission editor's own payloads
// (MissionEditor/data/scripts/UnitPayloads/Su-33.lua) and the module's bundled missions.
export const SU33_STORES = {
  R73: '{FBC29BFE-3D24-4C64-B81D-941239D12249}',
  R27R: '{9B25D316-0434-4954-868F-D51DB1A38DF0}',
  R27T: '{88DAC840-9F75-4531-8689-B46E64E42E53}',
  R27ER: '{E8069896-8435-4B90-95C0-01A03AE6E400}',
  R27ET: '{B79C379A-9E87-4E50-A1EE-7F7E29C2E87A}',
  S8KOM: '{F72F47E5-C83A-4B85-96ED-D3E46671EE9A}',
  S13: '{FC56DF80-9B09-44C5-8976-DCFAFF219062}',
  S25: '{A0648264-4BC0-4EE8-A543-D119F6BA4257}',
  FAB250: '{3C612111-C7AD-476E-8A8E-2485812F4E5C}',
  FAB500: '{37DCC01E-9E02-432F-B61D-10C166CA2798}',
  BETAB500: '{35B698AC-9FEF-4EC4-AD29-484A0085F62B}',
  RBK250: '{4203753F-8198-4E85-9924-6F8FF679F9FF}',
  RBK500AO: '{D5435F26-F120-4FA3-9867-34ACE562EF1B}',
  ECM_LEFT: '{44EE8698-89F9-48EE-AF36-5FD31896A82F}',
  ECM_RIGHT: '{44EE8698-89F9-48EE-AF36-5FD31896A82A}'
} as const

const {
  R73,
  R27R,
  R27T,
  R27ER,
  R27ET,
  S8KOM,
  S13,
  S25,
  FAB250,
  FAB500,
  BETAB500,
  RBK250,
  RBK500AO,
  ECM_LEFT,
  ECM_RIGHT
} = SU33_STORES

// Station rules seen in the module's payloads: R-73s on the tips and outer wing (1-3, 10-12), the
// ECM pods only on the tips, the radar R-27s on the eight stations from 3 to 10, the heat-seeking
// R-27s and the rocket pods on the wing (3, 4, 9, 10 for pods, 3 and 10 for missiles), and the
// bombs under the intakes and the tunnel (4-9).
const SHORT_RANGE = [1, 2, 3, 10, 11, 12]
const R27_STATIONS = [3, 4, 5, 6, 7, 8, 9, 10]
const WING_PAIR = [3, 10]
const POD_STATIONS = [3, 4, 9, 10]
const BOMB_STATIONS = [4, 5, 6, 7, 8, 9]

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

export const su33Profile: AircraftProfile = {
  aircraftName: 'Su-33',
  displayName: 'Su-33 Flanker-D',
  shortName: 'Su-33',
  fidelity: 'flamingCliffs',
  role: 'airSuperiority',
  weapons: [
    { id: R73, name: 'R-73', ammoNames: ['r73'], roundsPerStore: 1, stations: SHORT_RANGE },
    { id: R27R, name: 'R-27R', ammoNames: ['r27r'], roundsPerStore: 1, stations: R27_STATIONS },
    { id: R27ER, name: 'R-27ER', ammoNames: ['r27er'], roundsPerStore: 1, stations: R27_STATIONS },
    { id: R27T, name: 'R-27T', ammoNames: ['r27t'], roundsPerStore: 1, stations: WING_PAIR },
    { id: R27ET, name: 'R-27ET', ammoNames: ['r27et'], roundsPerStore: 1, stations: WING_PAIR },
    {
      id: S8KOM,
      name: 'S-8KOM pod (20)',
      ammoNames: ['s8kom'],
      roundsPerStore: 20,
      stations: POD_STATIONS
    },
    {
      id: S13,
      name: 'S-13OF pod (5)',
      ammoNames: ['s13of', 's13'],
      roundsPerStore: 5,
      stations: POD_STATIONS
    },
    {
      id: S25,
      name: 'S-25OFM',
      ammoNames: ['s25ofm', 's25'],
      roundsPerStore: 1,
      stations: POD_STATIONS
    },
    {
      id: FAB250,
      name: 'FAB-250',
      ammoNames: ['fab250'],
      roundsPerStore: 1,
      stations: [2, 3, 4, 5, 6, 7, 8, 9, 10, 11]
    },
    {
      id: FAB500,
      name: 'FAB-500 M-62',
      ammoNames: ['fab500', 'fab500m62'],
      roundsPerStore: 1,
      stations: R27_STATIONS
    },
    {
      id: BETAB500,
      name: 'BetAB-500',
      ammoNames: ['betab500'],
      roundsPerStore: 1,
      stations: BOMB_STATIONS
    },
    {
      id: RBK250,
      name: 'RBK-250 PTAB-2.5M',
      ammoNames: ['rbk250', 'rbk250ptab25m'],
      roundsPerStore: 1,
      stations: BOMB_STATIONS
    },
    {
      id: RBK500AO,
      name: 'RBK-500AO',
      ammoNames: ['rbk500ao', 'rbk500'],
      roundsPerStore: 1,
      stations: BOMB_STATIONS
    },
    {
      id: ECM_LEFT,
      name: 'L005 Sorbtsiya ECM (left)',
      ammoNames: [],
      roundsPerStore: 1,
      free: true,
      stations: [1]
    },
    {
      id: ECM_RIGHT,
      name: 'L005 Sorbtsiya ECM (right)',
      ammoNames: [],
      roundsPerStore: 1,
      free: true,
      stations: [12]
    }
  ],
  navigationAids: ['adf'],
  units: 'metric',
  stations: [
    { num: 1, label: 'L tip' },
    { num: 2, label: 'L outer' },
    { num: 3, label: 'L wing 3' },
    { num: 4, label: 'L wing 4' },
    { num: 5, label: 'L intake' },
    { num: 6, label: 'Tunnel L' },
    { num: 7, label: 'Tunnel R' },
    { num: 8, label: 'R intake' },
    { num: 9, label: 'R wing 9' },
    { num: 10, label: 'R wing 10' },
    { num: 11, label: 'R outer' },
    { num: 12, label: 'R tip' }
  ],
  loadouts: [
    stations('a2a-r27er', '6x R-27ER, 2x R-27R, 2x R-73, ECM', ['CAP', 'Escort', 'Intercept'], {
      1: ECM_LEFT,
      2: R73,
      3: R27R,
      4: R27ER,
      5: R27ER,
      6: R27ER,
      7: R27ER,
      8: R27ER,
      9: R27ER,
      10: R27R,
      11: R73,
      12: ECM_RIGHT
    }),
    stations('a2a-sweep', '4x R-27ER, 2x R-27ET, 4x R-73', ['Fighter Sweep'], {
      1: R73,
      2: R73,
      3: R27ET,
      4: R27ER,
      5: R27ER,
      8: R27ER,
      9: R27ER,
      10: R27ET,
      11: R73,
      12: R73
    }),
    stations('cas-s8', '4x S-8KOM pods, 4x FAB-250, 2x R-73, ECM', ['CAS'], {
      1: ECM_LEFT,
      2: R73,
      3: S8KOM,
      4: S8KOM,
      5: FAB250,
      6: FAB250,
      7: FAB250,
      8: FAB250,
      9: S8KOM,
      10: S8KOM,
      11: R73,
      12: ECM_RIGHT
    }),
    stations(
      'attack-fab500',
      '6x FAB-500, 2x R-27R, 2x R-73, ECM',
      ['Pinpoint Strike', 'Ground Attack'],
      {
        1: ECM_LEFT,
        2: R73,
        3: R27R,
        4: FAB500,
        5: FAB500,
        6: FAB500,
        7: FAB500,
        8: FAB500,
        9: FAB500,
        10: R27R,
        11: R73,
        12: ECM_RIGHT
      }
    ),
    stations('runway-betab', '6x BetAB-500, 2x R-27R, 2x R-73, ECM', ['Runway Attack'], {
      1: ECM_LEFT,
      2: R73,
      3: R27R,
      4: BETAB500,
      5: BETAB500,
      6: BETAB500,
      7: BETAB500,
      8: BETAB500,
      9: BETAB500,
      10: R27R,
      11: R73,
      12: ECM_RIGHT
    })
  ],
  // The Flaming Cliffs failure list is not mapped yet, so used airframes carry no hidden defects.
  minorFailures: []
}
