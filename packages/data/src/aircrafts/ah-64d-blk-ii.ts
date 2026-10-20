import { schemas } from '@dcc/contracts'
import * as z from 'zod'

const aircraftDefinition: z.infer<typeof schemas.dcs.aircraft> = {
  chaff: 30,
  display_name: 'AH-64D BLK.II',
  flare: 60,
  ammo_type: 1,
  gun: 25,
  max_fuel: 1140,
  max_speed: 365,
  name: 'AH-64D_BLK_II',
  max_height: 0,
  availableTasks: [
    'CAS',
    'Ground Attack',
    'Pinpoint Strike',
    'DEAD',
    'CSAR',
    'Escort',
    'AFAC',
    'Antiship Strike'
  ],
  controllable: true,
  cruiseAltitude: 1000,
  cruiseSpeed: 46.25,
  isHelicopter: true,
  era: 'Late CW',
  carrierCapable: false,
  customCallsigns: [
    'Apache',
    'Crow',
    'Chaos',
    'Sioux',
    'Gatling',
    'Gunslinger',
    'Hammerhead',
    'Bootleg',
    'Palehorse',
    'Carnivore',
    'Saber'
  ],
  loadouts: [
    {
      task: 'default',
      name: 'default',
      displayName: 'default',
      pylons: [
        { CLSID: '{M261_OUTBOARD_AB_M151_E_M257}', num: 1 },
        { CLSID: '{88D18A5E-99C8-4B04-B40B-1C02F2018B6E}', num: 2 },
        { CLSID: '{88D18A5E-99C8-4B04-B40B-1C02F2018B6E}', num: 3 },
        { CLSID: '{M261_OUTBOARD_AB_M151_E_M257}', num: 4 },
        { CLSID: '{IAFS_ComboPak_100}', num: 5 }
      ]
    },
    {
      task: 'CAS',
      name: '8x AGM-114K/L, 2x M261 Hydra, FCR',
      displayName: '8x AGM-114K/L, 2x M261 Hydra, FCR',
      pylons: [
        { CLSID: 'M261_MK151', num: 1 },
        { CLSID: '{M299_2xAGM_114K_2xAGM_114L}', num: 2 },
        { CLSID: '{M299_2xAGM_114K_2xAGM_114L}', num: 3 },
        { CLSID: 'M261_MK151', num: 4 },
        { CLSID: '{IAFS_ComboPak_100}', num: 5 },
        { CLSID: '{AN_APG_78}', num: 6 }
      ]
    },
    {
      task: 'Ground Attack',
      name: '8x AGM-114K/L, 2x M261 Hydra, FCR',
      displayName: '8x AGM-114K/L, 2x M261 Hydra, FCR',
      pylons: [
        { CLSID: 'M261_MK151', num: 1 },
        { CLSID: '{M299_2xAGM_114K_2xAGM_114L}', num: 2 },
        { CLSID: '{M299_2xAGM_114K_2xAGM_114L}', num: 3 },
        { CLSID: 'M261_MK151', num: 4 },
        { CLSID: '{IAFS_ComboPak_100}', num: 5 },
        { CLSID: '{AN_APG_78}', num: 6 }
      ]
    },
    {
      task: 'Pinpoint Strike',
      name: '16x AGM-114K/L Hellfire, FCR',
      displayName: '16x AGM-114K/L Hellfire, FCR',
      pylons: [
        { CLSID: '{88D18A5E-99C8-4B04-B40B-1C02F2018B6E}', num: 1 },
        { CLSID: '{M299_4xAGM_114L}', num: 2 },
        { CLSID: '{M299_4xAGM_114L}', num: 3 },
        { CLSID: '{88D18A5E-99C8-4B04-B40B-1C02F2018B6E}', num: 4 },
        { CLSID: '{IAFS_ComboPak_100}', num: 5 },
        { CLSID: '{AN_APG_78}', num: 6 }
      ]
    },
    {
      task: 'DEAD',
      name: '16x AGM-114K/L Hellfire, FCR',
      displayName: '16x AGM-114K/L Hellfire, FCR',
      pylons: [
        { CLSID: '{88D18A5E-99C8-4B04-B40B-1C02F2018B6E}', num: 1 },
        { CLSID: '{M299_4xAGM_114L}', num: 2 },
        { CLSID: '{M299_4xAGM_114L}', num: 3 },
        { CLSID: '{88D18A5E-99C8-4B04-B40B-1C02F2018B6E}', num: 4 },
        { CLSID: '{IAFS_ComboPak_100}', num: 5 },
        { CLSID: '{AN_APG_78}', num: 6 }
      ]
    },
    {
      task: 'CSAR',
      name: '8x AGM-114K, 2x M261 Hydra',
      displayName: '8x AGM-114K, 2x M261 Hydra',
      pylons: [
        { CLSID: '{M261_OUTBOARD_AB_M151_E_M257}', num: 1 },
        { CLSID: '{88D18A5E-99C8-4B04-B40B-1C02F2018B6E}', num: 2 },
        { CLSID: '{88D18A5E-99C8-4B04-B40B-1C02F2018B6E}', num: 3 },
        { CLSID: '{M261_OUTBOARD_AB_M151_E_M257}', num: 4 },
        { CLSID: '{IAFS_ComboPak_100}', num: 5 }
      ]
    },
    {
      task: 'Escort',
      name: '8x AGM-114K/L, 2x M261 Hydra, FCR',
      displayName: '8x AGM-114K/L, 2x M261 Hydra, FCR',
      pylons: [
        { CLSID: 'M261_MK151', num: 1 },
        { CLSID: '{M299_2xAGM_114K_2xAGM_114L}', num: 2 },
        { CLSID: '{M299_2xAGM_114K_2xAGM_114L}', num: 3 },
        { CLSID: 'M261_MK151', num: 4 },
        { CLSID: '{IAFS_ComboPak_100}', num: 5 },
        { CLSID: '{AN_APG_78}', num: 6 }
      ]
    },
    {
      task: 'AFAC',
      name: '8x AGM-114K, 2x M261 Illum, FCR',
      displayName: '8x AGM-114K, 2x M261 Illum, FCR',
      pylons: [
        { CLSID: '{M261_OUTBOARD_AB_M151_E_M257}', num: 1 },
        { CLSID: '{88D18A5E-99C8-4B04-B40B-1C02F2018B6E}', num: 2 },
        { CLSID: '{88D18A5E-99C8-4B04-B40B-1C02F2018B6E}', num: 3 },
        { CLSID: '{M261_OUTBOARD_AB_M151_E_M257}', num: 4 },
        { CLSID: '{IAFS_ComboPak_100}', num: 5 },
        { CLSID: '{AN_APG_78}', num: 6 }
      ]
    },
    {
      task: 'Antiship Strike',
      name: '16x AGM-114K/L Hellfire, FCR',
      displayName: '16x AGM-114K/L Hellfire, FCR',
      pylons: [
        { CLSID: '{88D18A5E-99C8-4B04-B40B-1C02F2018B6E}', num: 1 },
        { CLSID: '{M299_4xAGM_114L}', num: 2 },
        { CLSID: '{M299_4xAGM_114L}', num: 3 },
        { CLSID: '{88D18A5E-99C8-4B04-B40B-1C02F2018B6E}', num: 4 },
        { CLSID: '{IAFS_ComboPak_100}', num: 5 },
        { CLSID: '{AN_APG_78}', num: 6 }
      ]
    }
  ]
}

export default aircraftDefinition
