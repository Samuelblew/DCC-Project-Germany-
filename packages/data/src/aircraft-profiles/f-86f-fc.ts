import type { AircraftProfile, ProfileLoadout } from './types'

// CLSIDs as the Flaming Cliffs F-86F carries them in UnitPayloads/F-86F_FC.lua and bundled
// missions. HVAR rockets stay out until Unit.getAmmo counts are confirmed.
export const F86F_FC_STORES = {
  GAR8: '{GAR-8}',
  ANM64: '{F86ANM64}',
  M117: '{00F5DAC4-0466-4122-998F-B1A298E34113}',
  TANK120: '{PTB_120_F86F35}',
  TANK200: '{PTB_200_F86F35}'
} as const

const { GAR8, ANM64, M117, TANK120, TANK200 } = F86F_FC_STORES

const MISSILES = [5, 6]
const BOMBS = [4, 7]
const INNER_TANKS = [1, 4, 7, 10]
const TIP_TANKS = [1, 10]

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

export const f86fFcProfile: AircraftProfile = {
  aircraftName: 'F-86F_FC',
  displayName: 'F-86F Sabre',
  shortName: 'F-86F',
  fidelity: 'flamingCliffs',
  role: 'multirole',
  factionTypes: ['F-86F Sabre'],
  weapons: [
    {
      id: GAR8,
      name: 'GAR-8',
      ammoNames: ['gar8', 'aim9b', 'aim9'],
      roundsPerStore: 1,
      stations: MISSILES
    },
    { id: ANM64, name: 'AN-M64', ammoNames: ['anm64'], roundsPerStore: 1, stations: BOMBS },
    { id: M117, name: 'M117', ammoNames: ['m117'], roundsPerStore: 1, stations: BOMBS },
    {
      id: TANK120,
      name: '120 gal drop tank',
      ammoNames: [],
      roundsPerStore: 1,
      free: true,
      stations: INNER_TANKS
    },
    {
      id: TANK200,
      name: '200 gal drop tank',
      ammoNames: [],
      roundsPerStore: 1,
      free: true,
      stations: TIP_TANKS
    }
  ],
  navigationAids: ['adf'],
  units: 'imperial',
  stations: [
    { num: 1, label: 'L tip' },
    { num: 2, label: 'L outer' },
    { num: 3, label: 'L mid' },
    { num: 4, label: 'L inner' },
    { num: 5, label: 'L missile' },
    { num: 6, label: 'R missile' },
    { num: 7, label: 'R inner' },
    { num: 8, label: 'R mid' },
    { num: 9, label: 'R outer' },
    { num: 10, label: 'R tip' }
  ],
  loadouts: [
    stations('a2a-gar8', '2x GAR-8, 2x 120 gal', ['CAP', 'Escort', 'Intercept'], {
      4: TANK120,
      5: GAR8,
      6: GAR8,
      7: TANK120
    }),
    stations('a2a-sweep', '2x GAR-8, 2x 200 gal', ['Fighter Sweep'], {
      1: TANK200,
      5: GAR8,
      6: GAR8,
      10: TANK200
    }),
    stations('cas-anm64', '2x AN-M64, 2x 200 gal', ['CAS', 'Ground Attack'], {
      1: TANK200,
      4: ANM64,
      7: ANM64,
      10: TANK200
    }),
    stations('strike-m117', '2x M117, 2x 200 gal', ['Pinpoint Strike'], {
      1: TANK200,
      4: M117,
      7: M117,
      10: TANK200
    })
  ],
  minorFailures: []
}
