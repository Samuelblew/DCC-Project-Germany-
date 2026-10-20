import type { AircraftProfile, ProfileLoadout } from './types'

// CLSIDs and stations from the MH-6J Little Bird mod (Mods/aircraft/AH-6J/AH6.lua & UnitPayloads/MH-6J.lua).
export const MH6J_STORES = {
  DOORGUNNER: '{AH-6_Door}',
  AUX_FUEL: '{AH6_GOLIATH}',
  DOORS: '{AH-6_DOORS}',
  SMOKE_YELLOW: '{AH6_SMOKE_YELLOW}',
  SMOKE_RED: '{AH6_SMOKE_RED}',
  SMOKE_GREEN: '{AH6_SMOKE_GREEN}',
  SMOKE_BLUE: '{AH6_SMOKE_BLUE}'
} as const

const {
  DOORGUNNER,
  AUX_FUEL,
  DOORS,
  SMOKE_YELLOW,
  SMOKE_RED,
  SMOKE_GREEN,
  SMOKE_BLUE
} = MH6J_STORES

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

export const mh6jProfile: AircraftProfile = {
  aircraftName: 'MH-6J',
  displayName: 'MH-6J Little Bird',
  shortName: 'MH-6J',
  fidelity: 'full',
  role: 'helicopter',
  weapons: [
    {
      id: DOORGUNNER,
      name: 'M134 Doorgunner (7.62mm)',
      ammoNames: ['ah6762x51mmm80', 'ah6762x51mmm62'],
      roundsPerStore: 250,
      stations: [9, 10, 11, 12]
    },
    {
      id: AUX_FUEL,
      name: 'Goliath Aux Fuel Tank (62 gal)',
      ammoNames: [],
      roundsPerStore: 1,
      free: true,
      stations: [3]
    },
    {
      id: DOORS,
      name: 'Cabin Doors',
      ammoNames: [],
      roundsPerStore: 1,
      free: true,
      stations: [1, 2]
    },
    {
      id: SMOKE_YELLOW,
      name: 'M18 Yellow Smoke Grenade',
      ammoNames: [],
      roundsPerStore: 1,
      free: true,
      stations: [5]
    },
    {
      id: SMOKE_RED,
      name: 'M18 Red Smoke Grenade',
      ammoNames: [],
      roundsPerStore: 1,
      free: true,
      stations: [6]
    },
    {
      id: SMOKE_GREEN,
      name: 'M18 Green Smoke Grenade',
      ammoNames: [],
      roundsPerStore: 1,
      free: true,
      stations: [7]
    },
    {
      id: SMOKE_BLUE,
      name: 'M18 Blue Smoke Grenade',
      ammoNames: [],
      roundsPerStore: 1,
      free: true,
      stations: [8]
    }
  ],
  navigationAids: ['adf'],
  units: 'imperial',
  stations: [
    { num: 1, label: 'F.Drs' },
    { num: 2, label: 'R.Drs' },
    { num: 3, label: 'Aux Fuel' },
    { num: 5, label: 'Smk Y' },
    { num: 6, label: 'Smk R' },
    { num: 7, label: 'Smk G' },
    { num: 8, label: 'Smk B' },
    { num: 9, label: 'L-OB' },
    { num: 10, label: 'L-IB' },
    { num: 11, label: 'R-IB' },
    { num: 12, label: 'R-OB' }
  ],
  loadouts: [
    stations(
      'csar-doorgunners',
      '2x Doorgunners, Aux Fuel, Green Smoke',
      ['CSAR', 'Transport'],
      {
        3: AUX_FUEL,
        7: SMOKE_GREEN,
        10: DOORGUNNER,
        11: DOORGUNNER
      }
    ),
    stations(
      'air-assault-planks',
      'Troop Planks, 4x Smoke Grenades',
      ['Air Assault', 'Transport'],
      {
        5: SMOKE_YELLOW,
        6: SMOKE_RED,
        7: SMOKE_GREEN,
        8: SMOKE_BLUE
      }
    ),
    stations(
      'transport-long-range',
      'Aux Fuel, Cabin Doors',
      ['Transport'],
      {
        1: DOORS,
        2: DOORS,
        3: AUX_FUEL
      }
    ),
    stations(
      'heavy-escort-doorgunners',
      '4x Doorgunners, Aux Fuel',
      ['CSAR', 'Air Assault', 'CAS'],
      {
        3: AUX_FUEL,
        9: DOORGUNNER,
        10: DOORGUNNER,
        11: DOORGUNNER,
        12: DOORGUNNER
      }
    )
  ],
  minorFailures: []
}
