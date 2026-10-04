import { schemas } from '@dcc/contracts'
import * as z from 'zod'

const aircraftDefinition: z.infer<typeof schemas.dcs.aircraft> = {
  chaff: 30,
  display_name: 'F-5E FC',
  flare: 15,
  max_fuel: 2046,
  max_height: 16154,
  max_speed: 1742.4,
  name: 'F-5E-3_FC',
  availableTasks: ['CAP', 'Escort', 'Intercept', 'CAS', 'Pinpoint Strike'],
  controllable: true,
  isHelicopter: false,
  cruiseAltitude: 6096,
  cruiseSpeed: 174.72222222222,
  era: 'Vietnam',
  carrierCapable: false,
  loadouts: [
    {
      task: 'default',
      name: 'AIM-9P5*2, tanks',
      displayName: 'AIM-9P5*2, tanks',
      pylons: [
        { CLSID: '{AIM-9P5}', num: 1 },
        { CLSID: '{PTB-150GAL}', num: 3 },
        { CLSID: '{PTB-150GAL}', num: 4 },
        { CLSID: '{PTB-150GAL}', num: 5 },
        { CLSID: '{AIM-9P5}', num: 7 }
      ]
    },
    {
      task: 'CAS',
      name: 'CAS',
      displayName: 'CAS',
      pylons: [
        { CLSID: '{9BFD8C90-F7AE-4e90-833B-BFD0CED0E536}', num: 1 },
        { CLSID: '{CBU-52B}', num: 2 },
        { CLSID: '{Mk82SNAKEYE}', num: 3 },
        { CLSID: '{PTB-150GAL}', num: 4 },
        { CLSID: '{Mk82SNAKEYE}', num: 5 },
        { CLSID: '{CBU-52B}', num: 6 },
        { CLSID: '{9BFD8C90-F7AE-4e90-833B-BFD0CED0E536}', num: 7 }
      ]
    },
    {
      task: 'Pinpoint Strike',
      name: 'Pinpoint Strike',
      displayName: 'Pinpoint Strike',
      pylons: [
        { CLSID: '{AIM-9P5}', num: 1 },
        { CLSID: '{CBU-52B}', num: 2 },
        { CLSID: '{Mk82SNAKEYE}', num: 3 },
        { CLSID: '{BCE4E030-38E9-423E-98ED-24BE3DA87C32}', num: 4 },
        { CLSID: '{Mk82SNAKEYE}', num: 5 },
        { CLSID: '{CBU-52B}', num: 6 },
        { CLSID: '{AIM-9P5}', num: 7 }
      ]
    }
  ]
}

export default aircraftDefinition
