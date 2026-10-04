import type { AircraftProfile, ProfileLoadout } from './types'

// CLSIDs as the Flaming Cliffs Su-27 carries them in the mission editor's own payloads
// (MissionEditor/data/scripts/UnitPayloads/Su-27.lua) and the module's bundled missions.
export const SU27_STORES = {
  R73: '{FBC29BFE-3D24-4C64-B81D-941239D12249}',
  R27R: '{9B25D316-0434-4954-868F-D51DB1A38DF0}',
  R27T: '{88DAC840-9F75-4531-8689-B46E64E42E53}',
  R27ER: '{E8069896-8435-4B90-95C0-01A03AE6E400}',
  R27ET: '{B79C379A-9E87-4E50-A1EE-7F7E29C2E87A}',
  ECM_LEFT: '{44EE8698-89F9-48EE-AF36-5FD31896A82F}',
  ECM_RIGHT: '{44EE8698-89F9-48EE-AF36-5FD31896A82A}',
  S8KOM_TWIN: '{TWIN_B_8M1_S_8KOM}',
  S8OFP_TWIN: '{TWIN_B_8M1_S_8_OFP2}',
  S13: '{FC56DF80-9B09-44C5-8976-DCFAFF219062}',
  S25: '{A0648264-4BC0-4EE8-A543-D119F6BA4257}',
  FAB250: '{3C612111-C7AD-476E-8A8E-2485812F4E5C}',
  FAB500: '{37DCC01E-9E02-432F-B61D-10C166CA2798}',
  BETAB500SHP: '{BD289E34-DF84-4C5E-9220-4B14C346E79D}',
  RBK500: '{7AEC222D-C523-425e-B714-719C0D1EB14D}'
} as const

const {
  R73,
  R27R,
  R27T,
  R27ER,
  R27ET,
  ECM_LEFT,
  ECM_RIGHT,
  S8KOM_TWIN,
  S8OFP_TWIN,
  S13,
  S25,
  FAB250,
  FAB500,
  BETAB500SHP,
  RBK500
} = SU27_STORES

// Station rules seen in the module's payloads: the tips (1, 10) take an R-73 or the ECM pods, the
// outer wing (2, 9) R-73 only, the inner wing (3, 8) everything including rocket pods and the
// heat-seeking R-27s, and the intake and tunnel stations (4-7) radar R-27s and bombs.
const SHORT_RANGE = [1, 2, 3, 8, 9, 10]
const INNER_WING = [3, 8]
const BODY_AND_INNER = [3, 4, 5, 6, 7, 8]
const BODY = [4, 5, 6, 7]

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

export const su27Profile: AircraftProfile = {
  aircraftName: 'Su-27',
  displayName: 'Su-27 Flanker',
  shortName: 'Su-27',
  fidelity: 'flamingCliffs',
  role: 'airSuperiority',
  weapons: [
    { id: R73, name: 'R-73', ammoNames: ['r73'], roundsPerStore: 1, stations: SHORT_RANGE },
    { id: R27R, name: 'R-27R', ammoNames: ['r27r'], roundsPerStore: 1, stations: BODY_AND_INNER },
    {
      id: R27ER,
      name: 'R-27ER',
      ammoNames: ['r27er'],
      roundsPerStore: 1,
      stations: BODY_AND_INNER
    },
    { id: R27T, name: 'R-27T', ammoNames: ['r27t'], roundsPerStore: 1, stations: INNER_WING },
    { id: R27ET, name: 'R-27ET', ammoNames: ['r27et'], roundsPerStore: 1, stations: INNER_WING },
    {
      id: S8KOM_TWIN,
      name: 'S-8KOM twin pods (40)',
      ammoNames: ['s8kom'],
      roundsPerStore: 40,
      stations: INNER_WING
    },
    {
      id: S8OFP_TWIN,
      name: 'S-8OFP2 twin pods (40)',
      ammoNames: ['s8ofp2'],
      roundsPerStore: 40,
      stations: INNER_WING
    },
    {
      id: S13,
      name: 'S-13OF pod (5)',
      ammoNames: ['s13of', 's13'],
      roundsPerStore: 5,
      stations: INNER_WING
    },
    {
      id: S25,
      name: 'S-25OFM',
      ammoNames: ['s25ofm', 's25'],
      roundsPerStore: 1,
      stations: INNER_WING
    },
    {
      id: FAB250,
      name: 'FAB-250',
      ammoNames: ['fab250'],
      roundsPerStore: 1,
      stations: [3, 5, 6, 8]
    },
    {
      id: FAB500,
      name: 'FAB-500 M-62',
      ammoNames: ['fab500', 'fab500m62'],
      roundsPerStore: 1,
      stations: BODY_AND_INNER
    },
    {
      id: BETAB500SHP,
      name: 'BetAB-500ShP',
      ammoNames: ['betab500shp'],
      roundsPerStore: 1,
      stations: BODY_AND_INNER
    },
    {
      id: RBK500,
      name: 'RBK-500 PTAB-1M',
      ammoNames: ['rbk500ptab1m', 'rbk500', 'rbk500u'],
      roundsPerStore: 1,
      stations: BODY
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
      stations: [10]
    }
  ],
  navigationAids: ['adf'],
  units: 'metric',
  stations: [
    { num: 1, label: 'L tip' },
    { num: 2, label: 'L outer' },
    { num: 3, label: 'L inner' },
    { num: 4, label: 'L intake' },
    { num: 5, label: 'Tunnel fwd' },
    { num: 6, label: 'Tunnel aft' },
    { num: 7, label: 'R intake' },
    { num: 8, label: 'R inner' },
    { num: 9, label: 'R outer' },
    { num: 10, label: 'R tip' }
  ],
  loadouts: [
    stations('a2a-r27er', '6x R-27ER, 2x R-73, ECM', ['CAP', 'Escort', 'Intercept'], {
      1: ECM_LEFT,
      2: R73,
      3: R27ER,
      4: R27ER,
      5: R27ER,
      6: R27ER,
      7: R27ER,
      8: R27ER,
      9: R73,
      10: ECM_RIGHT
    }),
    stations('a2a-r27r', '4x R-27R, 2x R-27T, 4x R-73', ['CAP', 'Escort', 'Intercept'], {
      1: R73,
      2: R73,
      3: R27T,
      4: R27R,
      5: R27R,
      6: R27R,
      7: R27R,
      8: R27T,
      9: R73,
      10: R73
    }),
    stations('a2a-mix', '4x R-27ER, 2x R-27ET, 4x R-73', ['Fighter Sweep'], {
      1: R73,
      2: R73,
      3: R27ET,
      4: R27ER,
      5: R27ER,
      6: R27ER,
      7: R27ER,
      8: R27ET,
      9: R73,
      10: R73
    }),
    stations('cas-s8', '2x S-8KOM twin pods, 2x FAB-500, 2x FAB-250, 4x R-73', ['CAS'], {
      1: R73,
      2: R73,
      3: S8KOM_TWIN,
      4: FAB500,
      5: FAB250,
      6: FAB250,
      7: FAB500,
      8: S8KOM_TWIN,
      9: R73,
      10: R73
    }),
    stations('attack-fab500', '6x FAB-500, 2x R-73, ECM', ['Pinpoint Strike', 'Ground Attack'], {
      1: ECM_LEFT,
      2: R73,
      3: FAB500,
      4: FAB500,
      5: FAB500,
      6: FAB500,
      7: FAB500,
      8: FAB500,
      9: R73,
      10: ECM_RIGHT
    }),
    stations('runway-betab', '6x BetAB-500ShP, 2x R-73, ECM', ['Runway Attack'], {
      1: ECM_LEFT,
      2: R73,
      3: BETAB500SHP,
      4: BETAB500SHP,
      5: BETAB500SHP,
      6: BETAB500SHP,
      7: BETAB500SHP,
      8: BETAB500SHP,
      9: R73,
      10: ECM_RIGHT
    })
  ],
  // The Flaming Cliffs failure list is not mapped yet, so used airframes carry no hidden defects.
  minorFailures: []
}
