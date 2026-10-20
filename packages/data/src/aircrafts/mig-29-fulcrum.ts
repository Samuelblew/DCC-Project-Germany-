import { schemas } from '@dcc/contracts'
import * as z from 'zod'

const R73 = '{MISSILE_R-73_APU-73}'
const R27R = '{MISSILE_R-27R_APU-470}'
const R27T = '{MISSILE_R-27T_APU-470}'
const R27ER = '{MISSILE_R-27ER_APU-470}'
const FUEL_TANK_1400L = '{PTB_1500_MIG29A}'
const S8OFP = '{ROCKETS_S8-OFP2_BDZ-UMK2-B}'
const S24B = '{ROCKETS_S24B_BDZ-UMK2-B}'
const FAB500 = '{AB_FAB-500_BDZ-UMK2-B}'
const BETAB500 = '{AB_BETAB-500_BDZ-UMK2-B}'

function pylons(stations: Record<number, string>) {
  return Object.entries(stations).map(([num, CLSID]) => ({ CLSID, num: Number(num) }))
}

const airToAir = pylons({ 1: R73, 2: R73, 3: R27R, 5: R27R, 6: R73, 7: R73 })
const airToAirTank = pylons({
  1: R73,
  2: R73,
  3: R27ER,
  4: FUEL_TANK_1400L,
  5: R27ER,
  6: R73,
  7: R73
})

const aircraftDefinition: z.infer<typeof schemas.dcs.aircraft> = {
  chaff: 30,
  display_name: 'MiG-29A Fulcrum',
  flare: 30,
  max_fuel: 3376,
  max_height: 18000,
  max_speed: 2450,
  name: 'MiG-29 Fulcrum',
  availableTasks: [
    'CAP',
    'Escort',
    'Intercept',
    'Fighter Sweep',
    'CAS',
    'Ground Attack',
    'Runway Attack',
    'Antiship Strike'
  ],
  controllable: true,
  isHelicopter: false,
  cruiseAltitude: 6096,
  cruiseSpeed: 220.97222222222,
  era: 'Late CW',
  carrierCapable: false,
  loadouts: [
    {
      task: 'default',
      name: '2 * R-27R, 4 * R-73',
      displayName: '2 * R-27R, 4 * R-73',
      pylons: airToAir
    },
    {
      task: 'CAP',
      name: '2 * R-27ER, 4 * R-73, Fuel',
      displayName: '2 * R-27ER, 4 * R-73, Fuel',
      pylons: airToAirTank
    },
    {
      task: 'Escort',
      name: '2 * R-27ER, 4 * R-73, Fuel',
      displayName: '2 * R-27ER, 4 * R-73, Fuel',
      pylons: airToAirTank
    },
    {
      task: 'Intercept',
      name: '2 * R-27R, 4 * R-73',
      displayName: '2 * R-27R, 4 * R-73',
      pylons: airToAir
    },
    {
      task: 'Fighter Sweep',
      name: '2 * R-27T, 4 * R-73',
      displayName: '2 * R-27T, 4 * R-73',
      pylons: pylons({ 1: R73, 2: R73, 3: R27T, 5: R27T, 6: R73, 7: R73 })
    },
    {
      task: 'CAS',
      name: '80 * S-8OFP, 2 * R-73',
      displayName: '80 * S-8OFP, 2 * R-73',
      pylons: pylons({ 1: R73, 2: S8OFP, 3: S8OFP, 5: S8OFP, 6: S8OFP, 7: R73 })
    },
    {
      task: 'Ground Attack',
      name: '4 * FAB-500M-62, 2 * R-73',
      displayName: '4 * FAB-500M-62, 2 * R-73',
      pylons: pylons({ 1: R73, 2: FAB500, 3: FAB500, 5: FAB500, 6: FAB500, 7: R73 })
    },
    {
      task: 'Runway Attack',
      name: '4 * BetAB-500, 2 * R-73',
      displayName: '4 * BetAB-500, 2 * R-73',
      pylons: pylons({ 1: R73, 2: BETAB500, 3: BETAB500, 5: BETAB500, 6: BETAB500, 7: R73 })
    },
    {
      task: 'Antiship Strike',
      name: '4 * S-24, 2 * R-73',
      displayName: '4 * S-24, 2 * R-73',
      pylons: pylons({ 1: R73, 2: S24B, 3: S24B, 5: S24B, 6: S24B, 7: R73 })
    }
  ]
}

export default aircraftDefinition
