import { schemas } from '@dcc/contracts'
import * as z from 'zod'

const aircraftDefinition: z.infer<typeof schemas.dcs.aircraft> = {
  chaff: 0,
  display_name: 'F-86F FC',
  flare: 0,
  max_fuel: 1282,
  max_height: 15100,
  max_speed: 964.8,
  name: 'F-86F_FC',
  availableTasks: [
    'CAP',
    'Fighter Sweep',
    'Intercept',
    'Escort',
    'Pinpoint Strike',
    'Ground Attack',
    'CAS'
  ],
  carrierCapable: false,
  controllable: true,
  cruiseAltitude: 3000,
  cruiseSpeed: 174.72222222222,
  era: 'Korea',
  isHelicopter: false,
  loadouts: [
    {
      task: 'default',
      name: 'Default',
      displayName: 'Default',
      pylons: [
        { CLSID: '{PTB_120_F86F35}', num: 4 },
        { CLSID: '{GAR-8}', num: 5 },
        { CLSID: '{GAR-8}', num: 6 },
        { CLSID: '{PTB_120_F86F35}', num: 7 }
      ]
    },
    {
      task: 'CAS',
      name: 'CAS',
      displayName: 'CAS',
      pylons: [
        { CLSID: '{PTB_200_F86F35}', num: 1 },
        { CLSID: '{F86ANM64}', num: 4 },
        { CLSID: '{F86ANM64}', num: 7 },
        { CLSID: '{PTB_200_F86F35}', num: 10 }
      ]
    },
    {
      task: 'Pinpoint Strike',
      name: 'Strike',
      displayName: 'Strike',
      pylons: [
        { CLSID: '{PTB_200_F86F35}', num: 1 },
        { CLSID: '{00F5DAC4-0466-4122-998F-B1A298E34113}', num: 4 },
        { CLSID: '{00F5DAC4-0466-4122-998F-B1A298E34113}', num: 7 },
        { CLSID: '{PTB_200_F86F35}', num: 10 }
      ]
    }
  ]
}

export default aircraftDefinition
