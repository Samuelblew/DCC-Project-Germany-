import type { AircraftProfile, ProfileLoadout } from './types'

// CLSIDs as the Flaming Cliffs Su-25 carries them in the mission editor's own payloads
// (MissionEditor/data/scripts/UnitPayloads/Su-25.lua) and the module's bundled missions.
export const SU25_STORES = {
  R60M: '{682A481F-0CB5-4693-A382-D00DD4A156D7}',
  S8KOM: '{F72F47E5-C83A-4B85-96ED-D3E46671EE9A}',
  S8OFP: 'B-8M1 - 20 S-8OFP2',
  S13: '{FC56DF80-9B09-44C5-8976-DCFAFF219062}',
  S25: '{A0648264-4BC0-4EE8-A543-D119F6BA4257}',
  S25L: '{0180F983-C14A-11d8-9897-000476191836}',
  KH25ML: '{79D73885-0801-45a9-917F-C90FE1CE3DFC}',
  KH29L: '{D4A8D9B9-5C45-42e7-BBD2-0E54F8308432}',
  FAB250: '{3C612111-C7AD-476E-8A8E-2485812F4E5C}',
  FAB500: '{37DCC01E-9E02-432F-B61D-10C166CA2798}',
  BETAB500: '{35B698AC-9FEF-4EC4-AD29-484A0085F62B}',
  BETAB500SHP: '{BD289E34-DF84-4C5E-9220-4B14C346E79D}',
  RBK250: '{4203753F-8198-4E85-9924-6F8FF679F9FF}',
  RBK500AO: '{D5435F26-F120-4FA3-9867-34ACE562EF1B}',
  FUEL: '{E8D4652F-FD48-45B7-BA5B-2AE05BB5A9CF}'
} as const

const {
  R60M,
  S8KOM,
  S8OFP,
  S13,
  S25,
  S25L,
  KH25ML,
  KH29L,
  FAB250,
  FAB500,
  BETAB500,
  BETAB500SHP,
  RBK250,
  RBK500AO,
  FUEL
} = SU25_STORES

// Station rules seen in the module's payloads: the outboard rails (1, 10) take only the R-60M,
// the eight wing pylons (2-9) the bombs and S-8KOM pods, the heavy S-25 rockets and BetAB-500
// skip the two inboard pylons, the Kh-25ML hangs on the middle four, the Kh-29L only inboard and
// the drop tanks on 3, 5, 6 and 8.
const AAM = [1, 10]
const WING = [2, 3, 4, 5, 6, 7, 8, 9]
const WING_OUTBOARD = [2, 3, 4, 7, 8, 9]
const MIDDLE = [3, 4, 7, 8]
const INBOARD = [5, 6]

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

export const su25Profile: AircraftProfile = {
  aircraftName: 'Su-25',
  displayName: 'Su-25 Frogfoot',
  shortName: 'Su-25',
  fidelity: 'flamingCliffs',
  role: 'attack',
  weapons: [
    { id: R60M, name: 'R-60M', ammoNames: ['r60m'], roundsPerStore: 1, stations: AAM },
    {
      id: S8KOM,
      name: 'S-8KOM pod (20)',
      ammoNames: ['s8kom'],
      roundsPerStore: 20,
      stations: WING
    },
    {
      id: S8OFP,
      name: 'S-8OFP2 pod (20)',
      ammoNames: ['s8ofp2'],
      roundsPerStore: 20,
      stations: WING_OUTBOARD
    },
    {
      id: S13,
      name: 'S-13OF pod (5)',
      ammoNames: ['s13of', 's13'],
      roundsPerStore: 5,
      stations: WING
    },
    {
      id: S25,
      name: 'S-25OFM',
      ammoNames: ['s25ofm', 's25'],
      roundsPerStore: 1,
      stations: WING_OUTBOARD
    },
    { id: S25L, name: 'S-25L', ammoNames: ['s25l'], roundsPerStore: 1, stations: WING },
    {
      id: KH25ML,
      name: 'Kh-25ML',
      ammoNames: ['kh25ml', 'x25ml'],
      roundsPerStore: 1,
      stations: MIDDLE
    },
    {
      id: KH29L,
      name: 'Kh-29L',
      ammoNames: ['kh29l', 'x29l'],
      roundsPerStore: 1,
      stations: INBOARD
    },
    { id: FAB250, name: 'FAB-250', ammoNames: ['fab250'], roundsPerStore: 1, stations: WING },
    {
      id: FAB500,
      name: 'FAB-500 M-62',
      ammoNames: ['fab500', 'fab500m62'],
      roundsPerStore: 1,
      stations: WING
    },
    {
      id: BETAB500,
      name: 'BetAB-500',
      ammoNames: ['betab500'],
      roundsPerStore: 1,
      stations: WING_OUTBOARD
    },
    {
      id: BETAB500SHP,
      name: 'BetAB-500ShP',
      ammoNames: ['betab500shp'],
      roundsPerStore: 1,
      stations: WING
    },
    {
      id: RBK250,
      name: 'RBK-250 PTAB-2.5M',
      ammoNames: ['rbk250', 'rbk250ptab25m'],
      roundsPerStore: 1,
      stations: WING
    },
    {
      id: RBK500AO,
      name: 'RBK-500AO',
      ammoNames: ['rbk500ao', 'rbk500'],
      roundsPerStore: 1,
      stations: WING
    },
    {
      id: FUEL,
      name: 'Drop tank',
      ammoNames: [],
      roundsPerStore: 1,
      free: true,
      stations: [3, 5, 6, 8]
    }
  ],
  navigationAids: ['adf'],
  units: 'metric',
  stations: [
    { num: 1, label: 'L rail' },
    { num: 2, label: 'L outer' },
    { num: 3, label: 'L 3' },
    { num: 4, label: 'L 4' },
    { num: 5, label: 'L inner' },
    { num: 6, label: 'R inner' },
    { num: 7, label: 'R 7' },
    { num: 8, label: 'R 8' },
    { num: 9, label: 'R outer' },
    { num: 10, label: 'R rail' }
  ],
  loadouts: [
    stations('cas-s8', '4x S-8KOM pods, 2x RBK-250, 2x tanks, 2x R-60M', ['CAS'], {
      1: R60M,
      2: S8KOM,
      3: S8KOM,
      4: RBK250,
      5: FUEL,
      6: FUEL,
      7: RBK250,
      8: S8KOM,
      9: S8KOM,
      10: R60M
    }),
    stations(
      'cas-fab250',
      '4x FAB-250, 2x S-13 pods, 2x tanks, 2x R-60M',
      ['CAS', 'Ground Attack'],
      {
        1: R60M,
        2: S13,
        3: FUEL,
        4: FAB250,
        5: FAB250,
        6: FAB250,
        7: FAB250,
        8: FUEL,
        9: S13,
        10: R60M
      }
    ),
    stations('attack-rbk500', '6x RBK-500AO, 2x tanks, 2x R-60M', ['Ground Attack'], {
      1: R60M,
      2: RBK500AO,
      3: RBK500AO,
      4: RBK500AO,
      5: FUEL,
      6: FUEL,
      7: RBK500AO,
      8: RBK500AO,
      9: RBK500AO,
      10: R60M
    }),
    stations(
      'strike-guided',
      '2x Kh-29L, 4x Kh-25ML, 2x S-8KOM pods, 2x R-60M',
      ['Pinpoint Strike'],
      {
        1: R60M,
        2: S8KOM,
        3: KH25ML,
        4: KH25ML,
        5: KH29L,
        6: KH29L,
        7: KH25ML,
        8: KH25ML,
        9: S8KOM,
        10: R60M
      }
    ),
    stations(
      'attack-fab500',
      '6x FAB-500, 2x tanks, 2x R-60M',
      ['Pinpoint Strike', 'Ground Attack'],
      {
        1: R60M,
        2: FAB500,
        3: FAB500,
        4: FAB500,
        5: FUEL,
        6: FUEL,
        7: FAB500,
        8: FAB500,
        9: FAB500,
        10: R60M
      }
    ),
    stations('runway-betab', '8x BetAB-500ShP, 2x R-60M', ['Runway Attack'], {
      1: R60M,
      2: BETAB500SHP,
      3: BETAB500SHP,
      4: BETAB500SHP,
      5: BETAB500SHP,
      6: BETAB500SHP,
      7: BETAB500SHP,
      8: BETAB500SHP,
      9: BETAB500SHP,
      10: R60M
    })
  ],
  // The Flaming Cliffs failure list is not mapped yet, so used airframes carry no hidden defects.
  minorFailures: []
}
