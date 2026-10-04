import { schemas } from '@dcc/contracts'
import * as z from 'zod'

const aircraftDefinition: z.infer<typeof schemas.dcs.aircraft> = {
  chaff: 0,
  display_name: 'MiG-15bis FC',
  flare: 0,
  max_fuel: 1172,
  max_height: 15100,
  max_speed: 992,
  name: 'MiG-15bis_FC',
  availableTasks: ['CAP', 'Escort', 'Fighter Sweep', 'Ground Attack', 'CAS'],
  carrierCapable: false,
  controllable: true,
  cruiseAltitude: 6096,
  cruiseSpeed: 220.97222222222,
  era: 'Korea',
  isHelicopter: false,
  allowedFrequency: [3.75, 5],
  loadouts: [
    {
      task: 'default',
      displayName: 'Default',
      name: 'Default',
      pylons: [
        { CLSID: 'PTB400_MIG15', num: 1 },
        { CLSID: 'PTB400_MIG15', num: 2 }
      ]
    },
    {
      task: 'CAS',
      displayName: 'CAS',
      name: 'CAS',
      pylons: [
        { CLSID: 'FAB_50', num: 1 },
        { CLSID: 'FAB_50', num: 2 }
      ]
    },
    {
      task: 'Ground Attack',
      displayName: 'Strike',
      name: 'Strike',
      pylons: [
        { CLSID: 'FAB_100M', num: 1 },
        { CLSID: 'FAB_100M', num: 2 }
      ]
    }
  ]
}

export default aircraftDefinition
