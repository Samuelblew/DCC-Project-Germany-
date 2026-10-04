import type { AircraftProfile, ProfileLoadout } from './types'

// CLSIDs as the Flaming Cliffs MiG-15bis carries them in UnitPayloads/MiG-15bis_FC.lua.
export const MIG15BIS_FC_STORES = {
  FAB100: 'FAB_100M',
  FAB50: 'FAB_50',
  TANK300: 'PTB300_MIG15',
  TANK400: 'PTB400_MIG15',
  TANK600: 'PTB600_MIG15'
} as const

const { FAB100, FAB50, TANK300, TANK400, TANK600 } = MIG15BIS_FC_STORES

const WINGS = [1, 2]

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

export const mig15bisFcProfile: AircraftProfile = {
  aircraftName: 'MiG-15bis_FC',
  displayName: 'MiG-15bis',
  shortName: 'MiG-15',
  fidelity: 'flamingCliffs',
  role: 'airSuperiority',
  factionTypes: ['MiG-15bis'],
  weapons: [
    {
      id: FAB100,
      name: 'FAB-100M',
      ammoNames: ['fab100m', 'fab100'],
      roundsPerStore: 1,
      stations: WINGS
    },
    { id: FAB50, name: 'FAB-50', ammoNames: ['fab50'], roundsPerStore: 1, stations: WINGS },
    {
      id: TANK300,
      name: '300 L drop tank',
      ammoNames: [],
      roundsPerStore: 1,
      free: true,
      stations: WINGS
    },
    {
      id: TANK400,
      name: '400 L drop tank',
      ammoNames: [],
      roundsPerStore: 1,
      free: true,
      stations: WINGS
    },
    {
      id: TANK600,
      name: '600 L drop tank',
      ammoNames: [],
      roundsPerStore: 1,
      free: true,
      stations: WINGS
    }
  ],
  navigationAids: ['adf'],
  units: 'metric',
  stations: [
    { num: 1, label: 'L wing' },
    { num: 2, label: 'R wing' }
  ],
  loadouts: [
    stations('a2a-400', '2x 400 L', ['CAP', 'Escort', 'Intercept'], {
      1: TANK400,
      2: TANK400
    }),
    stations('a2a-600', '2x 600 L', ['Fighter Sweep'], {
      1: TANK600,
      2: TANK600
    }),
    stations('cas-fab50', '2x FAB-50', ['CAS'], {
      1: FAB50,
      2: FAB50
    }),
    stations('attack-fab100', '2x FAB-100M', ['Ground Attack'], {
      1: FAB100,
      2: FAB100
    })
  ],
  minorFailures: []
}
