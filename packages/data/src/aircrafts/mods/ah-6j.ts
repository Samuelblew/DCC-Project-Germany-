import { schemas } from '@dcc/contracts'
import * as z from 'zod'

const aircraftDefinition: z.infer<typeof schemas.dcs.aircraft> = {
  chaff: 0,
  display_name: 'AH-6J Little Bird',
  flare: 30,
  max_fuel: 181,
  max_height: 5700,
  max_speed: 282,
  name: 'AH-6J',
  availableTasks: ['CAS', 'Ground Attack', 'Pinpoint Strike', 'DEAD', 'CSAR'],
  controllable: true,
  isHelicopter: true,
  isMod: true,
  modDirectory: 'AH-6J',
  cruiseAltitude: 150,
  cruiseSpeed: 61.73333,
  era: 'Late CW',
  carrierCapable: true,
  AddPropAircraft: {
    CableCutterEnables: false,
    FlaresEquipped: true
  },
  customCallsigns: [
    'Nightstalker',
    'Gunslinger',
    'Littlebird',
    'KillerEgg',
    'Sixguns',
    'Outlaw',
    'Bandit',
    'Viper'
  ],
  loadouts: [
    {
      task: 'CAS',
      name: 'CAS - 2x M134, 2x M260 Hydra',
      displayName: 'CAS - 2x M134, 2x M260 Hydra',
      pylons: [
        { CLSID: '{M260_M151}', num: 9 },
        { CLSID: '{AH6_M134L}', num: 10 },
        { CLSID: '{AH6_M134R}', num: 11 },
        { CLSID: '{M260_M151}', num: 12 }
      ]
    },
    {
      task: 'Ground Attack',
      name: 'Ground Attack - 2x AGM-114K, 2x M134, 1x M260',
      displayName: 'Ground Attack - 2x AGM-114K, 2x M134, 1x M260',
      pylons: [
        { CLSID: 'AH6_AGM_114K_L', num: 9 },
        { CLSID: '{AH6_M134L}', num: 10 },
        { CLSID: '{AH6_M134R}', num: 11 },
        { CLSID: '{M260_M151}', num: 12 }
      ]
    },
    {
      task: 'Pinpoint Strike',
      name: 'Pinpoint Strike - 4x AGM-114K, 2x M134',
      displayName: 'Pinpoint Strike - 4x AGM-114K, 2x M134',
      pylons: [
        { CLSID: 'AH6_AGM_114K_L', num: 9 },
        { CLSID: '{AH6_M134L}', num: 10 },
        { CLSID: '{AH6_M134R}', num: 11 },
        { CLSID: 'AH6_AGM_114K_R', num: 12 }
      ]
    },
    {
      task: 'DEAD',
      name: 'DEAD - 4x AGM-114K, 2x M134',
      displayName: 'DEAD - 4x AGM-114K, 2x M134',
      pylons: [
        { CLSID: 'AH6_AGM_114K_L', num: 9 },
        { CLSID: '{AH6_M134L}', num: 10 },
        { CLSID: '{AH6_M134R}', num: 11 },
        { CLSID: 'AH6_AGM_114K_R', num: 12 }
      ]
    },
    {
      task: 'CSAR',
      name: 'CSAR Escort - 2x M134, 2x FN HMP400',
      displayName: 'CSAR Escort - 2x M134, 2x FN HMP400',
      pylons: [
        { CLSID: '{AH-6_FN_HMP400}', num: 9 },
        { CLSID: '{AH6_M134L}', num: 10 },
        { CLSID: '{AH6_M134R}', num: 11 },
        { CLSID: '{AH-6_FN_HMP400}', num: 12 }
      ]
    },
    {
      task: 'default',
      name: 'default',
      displayName: 'default',
      pylons: [
        { CLSID: '{M260_M151}', num: 9 },
        { CLSID: '{AH6_M134L}', num: 10 },
        { CLSID: '{AH6_M134R}', num: 11 },
        { CLSID: '{M260_M151}', num: 12 }
      ]
    }
  ]
}

export default aircraftDefinition
