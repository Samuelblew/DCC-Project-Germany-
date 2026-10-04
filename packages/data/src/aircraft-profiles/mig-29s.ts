import type { AircraftProfile, ProfileLoadout } from './types'

// CLSIDs as the Flaming Cliffs MiG-29S carries them in the mission editor's own payloads
// (MissionEditor/data/scripts/UnitPayloads/MiG-29S.lua) and the module's bundled missions.
export const MIG29S_STORES = {
  R60M: '{682A481F-0CB5-4693-A382-D00DD4A156D7}',
  R73: '{FBC29BFE-3D24-4C64-B81D-941239D12249}',
  R77: '{B4C01D60-A8A3-4237-BD72-CA7655BC0FE9}',
  R27R: '{9B25D316-0434-4954-868F-D51DB1A38DF0}',
  R27ER: '{E8069896-8435-4B90-95C0-01A03AE6E400}',
  R27ET: '{B79C379A-9E87-4E50-A1EE-7F7E29C2E87A}',
  S8KOM: '{F72F47E5-C83A-4B85-96ED-D3E46671EE9A}',
  S8OFP: 'B-8M1 - 20 S-8OFP2',
  S24B: '{3858707D-F5D5-4bbb-BDD8-ABB0530EBC7C}',
  FAB250: '{3C612111-C7AD-476E-8A8E-2485812F4E5C}',
  FAB500: '{37DCC01E-9E02-432F-B61D-10C166CA2798}',
  BETAB500: '{35B698AC-9FEF-4EC4-AD29-484A0085F62B}',
  RBK250: '{4203753F-8198-4E85-9924-6F8FF679F9FF}',
  RBK500AO: '{D5435F26-F120-4FA3-9867-34ACE562EF1B}',
  TANK_CENTRE: '{2BEC576B-CDF5-4B7F-961F-B0FA4312B841}',
  TANK_WING: '{C0FF4842-FBAC-11d5-9190-00A0249B6F00}'
} as const

const {
  R60M,
  R73,
  R77,
  R27R,
  R27ER,
  R27ET,
  S8KOM,
  S8OFP,
  S24B,
  FAB250,
  FAB500,
  BETAB500,
  RBK250,
  RBK500AO,
  TANK_CENTRE,
  TANK_WING
} = MIG29S_STORES

// Station rules seen in the module's payloads: the short-range missiles and the R-77 go anywhere
// but the centreline (4), the R-27 family and the wing tanks only inboard (3, 5), the bombs and
// rocket pods on the four wing pylons (2, 3, 5, 6), and the 1500 L tank on the centreline.
const MISSILE_STATIONS = [1, 2, 3, 5, 6, 7]
const GROUND_ATTACK_STATIONS = [2, 3, 5, 6]
const INBOARD = [3, 5]
const OUTBOARD = [2, 6]

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

export const mig29sProfile: AircraftProfile = {
  aircraftName: 'MiG-29S',
  displayName: 'MiG-29S Fulcrum-C',
  shortName: 'MiG-29S',
  fidelity: 'flamingCliffs',
  role: 'airSuperiority',
  weapons: [
    { id: R60M, name: 'R-60M', ammoNames: ['r60m'], roundsPerStore: 1, stations: MISSILE_STATIONS },
    { id: R73, name: 'R-73', ammoNames: ['r73'], roundsPerStore: 1, stations: MISSILE_STATIONS },
    { id: R77, name: 'R-77', ammoNames: ['r77'], roundsPerStore: 1, stations: MISSILE_STATIONS },
    { id: R27R, name: 'R-27R', ammoNames: ['r27r'], roundsPerStore: 1, stations: INBOARD },
    { id: R27ER, name: 'R-27ER', ammoNames: ['r27er'], roundsPerStore: 1, stations: INBOARD },
    { id: R27ET, name: 'R-27ET', ammoNames: ['r27et'], roundsPerStore: 1, stations: INBOARD },
    {
      id: S8KOM,
      name: 'S-8KOM pod (20)',
      ammoNames: ['s8kom'],
      roundsPerStore: 20,
      stations: GROUND_ATTACK_STATIONS
    },
    {
      id: S8OFP,
      name: 'S-8OFP2 pod (20)',
      ammoNames: ['s8ofp2'],
      roundsPerStore: 20,
      stations: OUTBOARD
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
      id: RBK250,
      name: 'RBK-250 PTAB-2.5M',
      ammoNames: ['rbk250', 'rbk250ptab25m'],
      roundsPerStore: 1,
      stations: GROUND_ATTACK_STATIONS
    },
    {
      id: RBK500AO,
      name: 'RBK-500AO',
      ammoNames: ['rbk500ao', 'rbk500'],
      roundsPerStore: 1,
      stations: INBOARD
    },
    {
      id: TANK_CENTRE,
      name: '1500 L drop tank',
      ammoNames: [],
      roundsPerStore: 1,
      free: true,
      stations: [4]
    },
    {
      id: TANK_WING,
      name: '1150 L drop tank',
      ammoNames: [],
      roundsPerStore: 1,
      free: true,
      stations: INBOARD
    }
  ],
  navigationAids: ['adf'],
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
    stations('a2a-r77', '4x R-77, 2x R-73, tank', ['CAP', 'Escort', 'Intercept'], {
      1: R73,
      2: R77,
      3: R77,
      4: TANK_CENTRE,
      5: R77,
      6: R77,
      7: R73
    }),
    stations('a2a-r27er', '2x R-27ER, 4x R-73, tank', ['CAP', 'Intercept'], {
      1: R73,
      2: R73,
      3: R27ER,
      4: TANK_CENTRE,
      5: R27ER,
      6: R73,
      7: R73
    }),
    stations('a2a-r27et', '2x R-27ET, 2x R-77, 2x R-73, tank', ['Fighter Sweep'], {
      1: R73,
      2: R77,
      3: R27ET,
      4: TANK_CENTRE,
      5: R27ET,
      6: R77,
      7: R73
    }),
    stations('cas-s8', '4x S-8KOM pods, 2x R-73, tank', ['CAS'], {
      1: R73,
      2: S8KOM,
      3: S8KOM,
      4: TANK_CENTRE,
      5: S8KOM,
      6: S8KOM,
      7: R73
    }),
    stations('strike-s24', '4x S-24B, 2x R-73, tank', ['Pinpoint Strike'], {
      1: R73,
      2: S24B,
      3: S24B,
      4: TANK_CENTRE,
      5: S24B,
      6: S24B,
      7: R73
    }),
    stations('attack-fab500', '4x FAB-500, 2x R-73, tank', ['Pinpoint Strike', 'Ground Attack'], {
      1: R73,
      2: FAB500,
      3: FAB500,
      4: TANK_CENTRE,
      5: FAB500,
      6: FAB500,
      7: R73
    }),
    stations('runway-betab', '4x BetAB-500, 2x R-73, tank', ['Runway Attack'], {
      1: R73,
      2: BETAB500,
      3: BETAB500,
      4: TANK_CENTRE,
      5: BETAB500,
      6: BETAB500,
      7: R73
    })
  ],
  // The Flaming Cliffs failure list is not mapped yet, so used airframes carry no hidden defects.
  minorFailures: []
}
