import type { AircraftProfile, ProfileLoadout } from './types'

// CLSIDs as the Flaming Cliffs F-5E carries them in bundled missions. Rockets and MER racks
// stay out until Unit.getAmmo names and counts are confirmed.
export const F5E_FC_STORES = {
  AIM9B: '{AIM-9B}',
  AIM9P: '{9BFD8C90-F7AE-4e90-833B-BFD0CED0E536}',
  AIM9P3: '{AIM-9P3}',
  AIM9P5: '{AIM-9P5}',
  MK82: '{BCE4E030-38E9-423E-98ED-24BE3DA87C32}',
  SNAKEYE: '{Mk82SNAKEYE}',
  CBU52: '{CBU-52B}',
  TANK: '{PTB-150GAL}'
} as const

const { AIM9B, AIM9P, AIM9P3, AIM9P5, MK82, SNAKEYE, CBU52, TANK } = F5E_FC_STORES

const TIPS = [1, 7]
const WING = [2, 3, 5, 6]
const INNER = [3, 5]

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

export const f5eFcProfile: AircraftProfile = {
  aircraftName: 'F-5E-3_FC',
  displayName: 'F-5E Tiger II',
  shortName: 'F-5E',
  fidelity: 'flamingCliffs',
  role: 'multirole',
  factionTypes: ['F-5E-3'],
  weapons: [
    { id: AIM9B, name: 'AIM-9B', ammoNames: ['aim9b', 'aim9'], roundsPerStore: 1, stations: TIPS },
    { id: AIM9P, name: 'AIM-9P', ammoNames: ['aim9p'], roundsPerStore: 1, stations: TIPS },
    { id: AIM9P3, name: 'AIM-9P3', ammoNames: ['aim9p3'], roundsPerStore: 1, stations: TIPS },
    { id: AIM9P5, name: 'AIM-9P5', ammoNames: ['aim9p5'], roundsPerStore: 1, stations: TIPS },
    { id: MK82, name: 'Mk-82', ammoNames: ['mk82'], roundsPerStore: 1, stations: [4] },
    {
      id: SNAKEYE,
      name: 'Mk-82 Snakeye',
      ammoNames: ['mk82snakeye'],
      roundsPerStore: 1,
      stations: INNER
    },
    {
      id: CBU52,
      name: 'CBU-52B',
      ammoNames: ['cbu52b', 'cbu52'],
      roundsPerStore: 1,
      stations: WING
    },
    {
      id: TANK,
      name: '150 gal drop tank',
      ammoNames: [],
      roundsPerStore: 1,
      free: true,
      stations: [3, 4, 5]
    }
  ],
  navigationAids: ['tacan', 'ils'],
  units: 'imperial',
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
    stations('a2a-p5', '2x AIM-9P5, 3 tanks', ['CAP', 'Escort', 'Intercept'], {
      1: AIM9P5,
      3: TANK,
      4: TANK,
      5: TANK,
      7: AIM9P5
    }),
    stations('a2a-p3', '2x AIM-9P3, 3 tanks', ['CAP', 'Fighter Sweep'], {
      1: AIM9P3,
      3: TANK,
      4: TANK,
      5: TANK,
      7: AIM9P3
    }),
    stations('cas-cbu', '2x AIM-9P, 2x CBU-52B, 2x Snakeye, tank', ['CAS', 'Ground Attack'], {
      1: AIM9P,
      2: CBU52,
      3: SNAKEYE,
      4: TANK,
      5: SNAKEYE,
      6: CBU52,
      7: AIM9P
    }),
    stations('strike-mk82', '2x AIM-9B, 2x Snakeye, Mk-82', ['Pinpoint Strike'], {
      1: AIM9B,
      3: SNAKEYE,
      4: MK82,
      5: SNAKEYE,
      7: AIM9B
    })
  ],
  minorFailures: []
}
