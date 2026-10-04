import type { AircraftProfile, ProfileLoadout } from './types'

// CLSIDs as the Flaming Cliffs F-15C carries them in the mission editor's own payloads
// (MissionEditor/data/scripts/UnitPayloads/F-15C.lua) and the module's bundled missions.
export const F15C_STORES = {
  AIM9M: '{6CEB49FC-DED8-4DED-B053-E1F033FF72D3}',
  AIM7M: '{8D399DDA-FF81-4F14-904D-099B34FE7918}',
  AIM120B: '{C8E06185-7CD6-4C90-959F-044679E90751}',
  AIM120C: '{40EF17B7-F508-45de-8566-6FFECC0C1AB8}',
  TANK: '{E1F29B21-F291-4589-9FD8-3272EEC69506}'
} as const

const { AIM9M, AIM7M, AIM120B, AIM120C, TANK } = F15C_STORES

// Station rules seen in the module's payloads: the wing pylons carry a Sidewinder on each side
// (1, 3, 9, 11), the fuselage stations (4, 5, 7, 8) the Sparrow, the AMRAAM goes on either, and
// the tanks hang on the wing pylons' centre (2, 10) and the centreline (6).
const SIDEWINDER = [1, 3, 9, 11]
const FUSELAGE = [4, 5, 7, 8]
const AMRAAM = [1, 3, 4, 5, 7, 8, 9, 11]

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

export const f15cProfile: AircraftProfile = {
  aircraftName: 'F-15C',
  displayName: 'F-15C Eagle',
  shortName: 'F-15C',
  fidelity: 'flamingCliffs',
  role: 'airSuperiority',
  weapons: [
    {
      id: AIM9M,
      name: 'AIM-9M',
      ammoNames: ['aim9m', 'aim9'],
      roundsPerStore: 1,
      stations: SIDEWINDER
    },
    {
      id: AIM7M,
      name: 'AIM-7M',
      ammoNames: ['aim7m', 'aim7'],
      roundsPerStore: 1,
      stations: FUSELAGE
    },
    {
      id: AIM120B,
      name: 'AIM-120B',
      ammoNames: ['aim120b', 'aim120'],
      roundsPerStore: 1,
      stations: AMRAAM
    },
    { id: AIM120C, name: 'AIM-120C', ammoNames: ['aim120c'], roundsPerStore: 1, stations: AMRAAM },
    {
      id: TANK,
      name: '610 gal drop tank',
      ammoNames: [],
      roundsPerStore: 1,
      free: true,
      stations: [2, 6, 10]
    }
  ],
  navigationAids: ['tacan', 'ils'],
  units: 'imperial',
  stations: [
    { num: 1, label: 'L wing outer' },
    { num: 2, label: 'L wing tank' },
    { num: 3, label: 'L wing inner' },
    { num: 4, label: 'L fuselage fwd' },
    { num: 5, label: 'L fuselage aft' },
    { num: 6, label: 'Centre' },
    { num: 7, label: 'R fuselage aft' },
    { num: 8, label: 'R fuselage fwd' },
    { num: 9, label: 'R wing inner' },
    { num: 10, label: 'R wing tank' },
    { num: 11, label: 'R wing outer' }
  ],
  loadouts: [
    stations('a2a-120c', '6x AIM-120C, 2x AIM-9M, 3 tanks', ['CAP', 'Escort', 'Intercept'], {
      1: AIM9M,
      2: TANK,
      3: AIM120C,
      4: AIM120C,
      5: AIM120C,
      6: TANK,
      7: AIM120C,
      8: AIM120C,
      9: AIM120C,
      10: TANK,
      11: AIM9M
    }),
    stations('a2a-120b', '4x AIM-120B, 2x AIM-7M, 2x AIM-9M, 3 tanks', ['CAP', 'Escort'], {
      1: AIM9M,
      2: TANK,
      3: AIM120B,
      4: AIM7M,
      5: AIM120B,
      6: TANK,
      7: AIM120B,
      8: AIM7M,
      9: AIM120B,
      10: TANK,
      11: AIM9M
    }),
    stations('a2a-sweep', '4x AIM-120C, 4x AIM-9M, tank', ['Fighter Sweep', 'Intercept'], {
      1: AIM9M,
      3: AIM9M,
      4: AIM120C,
      5: AIM120C,
      6: TANK,
      7: AIM120C,
      8: AIM120C,
      9: AIM9M,
      11: AIM9M
    })
  ],
  // The Flaming Cliffs failure list is not mapped yet, so used airframes carry no hidden defects.
  minorFailures: []
}
