import type { AircraftProfile, ProfileLoadout } from './types'

// CLSIDs as the Flaming Cliffs Su-25T carries them in the mission editor's own payloads
// (MissionEditor/data/scripts/UnitPayloads/Su-25T.lua) and the module's bundled missions.
export const SU25T_STORES = {
  R60M: '{682A481F-0CB5-4693-A382-D00DD4A156D7}',
  R73: '{CBC29BFE-3D24-4C64-B81D-941239D12249}',
  VIKHR: '{F789E86A-EE2E-4E6B-B81E-D5E5F903B6ED}',
  KH25ML: '{79D73885-0801-45a9-917F-C90FE1CE3DFC}',
  KH25MPU: '{752AF1D2-EBCC-4bd7-A1E7-2357F5601C70}',
  KH29L: '{D4A8D9B9-5C45-42e7-BBD2-0E54F8308432}',
  KH29T: '{601C99F7-9AF3-4ed7-A565-F8B8EC0D7AAC}',
  KH58: '{B5CA9846-776E-4230-B4FD-8BCC9BFB1676}',
  KAB500KR: '{E2C426E3-8B10-4E09-B733-9CDC26520F48}',
  S8KOM: '{F72F47E5-C83A-4B85-96ED-D3E46671EE9A}',
  S13: '{FC56DF80-9B09-44C5-8976-DCFAFF219062}',
  S25: '{A0648264-4BC0-4EE8-A543-D119F6BA4257}',
  S25L: '{0180F983-C14A-11d8-9897-000476191836}',
  FAB250: '{3C612111-C7AD-476E-8A8E-2485812F4E5C}',
  FAB500: '{37DCC01E-9E02-432F-B61D-10C166CA2798}',
  BETAB500SHP: '{BD289E34-DF84-4C5E-9220-4B14C346E79D}',
  RBK250: '{4203753F-8198-4E85-9924-6F8FF679F9FF}',
  RBK500AO: '{D5435F26-F120-4FA3-9867-34ACE562EF1B}',
  FANTASMAGORIA: '{0519A264-0AB6-11d6-9193-00A0249B6F00}',
  MERCURY: '{B1EF6B0E-3D91-4047-A7A5-A99E7D8B4A8B}',
  ECM_LEFT: '{44EE8698-89F9-48EE-AF36-5FD31896A82D}',
  ECM_RIGHT: '{44EE8698-89F9-48EE-AF36-5FD31896A82C}',
  TANK: '{E8D4652F-FD48-45B7-BA5B-2AE05BB5A9CF}'
} as const

const {
  R60M,
  R73,
  VIKHR,
  KH25ML,
  KH25MPU,
  KH29L,
  KH29T,
  KH58,
  KAB500KR,
  S8KOM,
  S13,
  S25,
  S25L,
  FAB250,
  FAB500,
  BETAB500SHP,
  RBK250,
  RBK500AO,
  FANTASMAGORIA,
  MERCURY,
  ECM_LEFT,
  ECM_RIGHT,
  TANK
} = SU25T_STORES

// Station rules seen in the module's payloads: the outboard rails (1, 11) take an R-60M or the
// MPS-410 jammers, the next pylons (2, 10) an R-73, the centreline (6) only the targeting pods,
// the eight wing pylons (2-5, 7-10) bombs and rockets, the Kh-25 family the middle four, the
// heavy guided weapons the inboard pair (5, 7) and the Vikhr launchers 4 and 8.
const RAILS = [1, 11]
const WING = [2, 3, 4, 5, 7, 8, 9, 10]
const MIDDLE = [3, 4, 8, 9]
const INBOARD = [5, 7]

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

export const su25tProfile: AircraftProfile = {
  aircraftName: 'Su-25T',
  displayName: 'Su-25T Frogfoot',
  shortName: 'Su-25T',
  fidelity: 'flamingCliffs',
  role: 'attack',
  weapons: [
    { id: R60M, name: 'R-60M', ammoNames: ['r60m'], roundsPerStore: 1, stations: RAILS },
    { id: R73, name: 'R-73', ammoNames: ['r73'], roundsPerStore: 1, stations: [2, 10] },
    {
      id: VIKHR,
      name: 'Vikhr-M launcher (8)',
      ammoNames: ['vikhrm', 'vikhr'],
      roundsPerStore: 8,
      stations: [4, 8]
    },
    {
      id: KH25ML,
      name: 'Kh-25ML',
      ammoNames: ['kh25ml', 'x25ml'],
      roundsPerStore: 1,
      stations: MIDDLE
    },
    {
      id: KH25MPU,
      name: 'Kh-25MPU',
      ammoNames: ['kh25mpu', 'x25mpu'],
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
    {
      id: KH29T,
      name: 'Kh-29T',
      ammoNames: ['kh29t', 'x29t'],
      roundsPerStore: 1,
      stations: INBOARD
    },
    { id: KH58, name: 'Kh-58U', ammoNames: ['kh58', 'x58'], roundsPerStore: 1, stations: INBOARD },
    {
      id: KAB500KR,
      name: 'KAB-500Kr',
      ammoNames: ['kab500kr', 'kab500'],
      roundsPerStore: 1,
      stations: INBOARD
    },
    {
      id: S8KOM,
      name: 'S-8KOM pod (20)',
      ammoNames: ['s8kom'],
      roundsPerStore: 20,
      stations: WING
    },
    {
      id: S13,
      name: 'S-13OF pod (5)',
      ammoNames: ['s13of', 's13'],
      roundsPerStore: 5,
      stations: WING
    },
    { id: S25, name: 'S-25OFM', ammoNames: ['s25ofm', 's25'], roundsPerStore: 1, stations: WING },
    { id: S25L, name: 'S-25L', ammoNames: ['s25l'], roundsPerStore: 1, stations: WING },
    { id: FAB250, name: 'FAB-250', ammoNames: ['fab250'], roundsPerStore: 1, stations: WING },
    {
      id: FAB500,
      name: 'FAB-500 M-62',
      ammoNames: ['fab500', 'fab500m62'],
      roundsPerStore: 1,
      stations: WING
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
      id: FANTASMAGORIA,
      name: 'L-081 Fantasmagoria pod',
      ammoNames: [],
      roundsPerStore: 1,
      free: true,
      stations: [6]
    },
    {
      id: MERCURY,
      name: 'Mercury LLTV pod',
      ammoNames: [],
      roundsPerStore: 1,
      free: true,
      stations: [6]
    },
    {
      id: ECM_LEFT,
      name: 'MPS-410 ECM (left)',
      ammoNames: [],
      roundsPerStore: 1,
      free: true,
      stations: [1]
    },
    {
      id: ECM_RIGHT,
      name: 'MPS-410 ECM (right)',
      ammoNames: [],
      roundsPerStore: 1,
      free: true,
      stations: [11]
    },
    {
      id: TANK,
      name: 'Drop tank',
      ammoNames: [],
      roundsPerStore: 1,
      free: true,
      stations: [3, 5, 7, 9]
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
    { num: 6, label: 'Centre pod' },
    { num: 7, label: 'R inner' },
    { num: 8, label: 'R 8' },
    { num: 9, label: 'R 9' },
    { num: 10, label: 'R outer' },
    { num: 11, label: 'R rail' }
  ],
  loadouts: [
    stations('sead-kh58', '2x Kh-58U, 4x Kh-25MPU, 2x R-73, Fantasmagoria, ECM', ['SEAD', 'DEAD'], {
      1: ECM_LEFT,
      2: R73,
      3: KH25MPU,
      4: KH25MPU,
      5: KH58,
      6: FANTASMAGORIA,
      7: KH58,
      8: KH25MPU,
      9: KH25MPU,
      10: R73,
      11: ECM_RIGHT
    }),
    stations(
      'strike-kh29l',
      '2x Kh-29L, 4x Kh-25ML, 2x R-73, Mercury, ECM',
      ['Pinpoint Strike', 'DEAD'],
      {
        1: ECM_LEFT,
        2: R73,
        3: KH25ML,
        4: KH25ML,
        5: KH29L,
        6: MERCURY,
        7: KH29L,
        8: KH25ML,
        9: KH25ML,
        10: R73,
        11: ECM_RIGHT
      }
    ),
    stations('cas-vikhr', '16x Vikhr-M, 2x S-8KOM pods, 2x tanks, 2x R-73, Mercury, ECM', ['CAS'], {
      1: ECM_LEFT,
      2: R73,
      3: S8KOM,
      4: VIKHR,
      5: TANK,
      6: MERCURY,
      7: TANK,
      8: VIKHR,
      9: S8KOM,
      10: R73,
      11: ECM_RIGHT
    }),
    stations('attack-fab500', '6x FAB-500, 2x tanks, 2x R-60M', ['Ground Attack'], {
      1: R60M,
      2: FAB500,
      3: FAB500,
      4: FAB500,
      5: TANK,
      7: TANK,
      8: FAB500,
      9: FAB500,
      10: FAB500,
      11: R60M
    }),
    stations('runway-betab', '8x BetAB-500ShP, 2x R-60M', ['Runway Attack'], {
      1: R60M,
      2: BETAB500SHP,
      3: BETAB500SHP,
      4: BETAB500SHP,
      5: BETAB500SHP,
      7: BETAB500SHP,
      8: BETAB500SHP,
      9: BETAB500SHP,
      10: BETAB500SHP,
      11: R60M
    })
  ],
  // The Flaming Cliffs failure list is not mapped yet, so used airframes carry no hidden defects.
  minorFailures: []
}
