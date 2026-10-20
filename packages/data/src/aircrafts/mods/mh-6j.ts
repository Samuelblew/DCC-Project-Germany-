import { schemas } from '@dcc/contracts'
import * as z from 'zod'

const aircraftDefinition: z.infer<typeof schemas.dcs.aircraft> = {
  chaff: 0,
  display_name: 'MH-6J Little Bird',
  flare: 30,
  max_fuel: 181,
  max_height: 5700,
  max_speed: 282,
  name: 'MH-6J',
  availableTasks: ['Transport', 'Air Assault', 'CSAR', 'CAS'],
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
    'Dustoff',
    'Littlebird',
    'Shadow',
    'Ghost',
    'Phantom',
    'Stalker'
  ],
  loadouts: [
    {
      task: 'Air Assault',
      name: 'Air Assault - Planks & Smoke',
      displayName: 'Air Assault - Planks & Smoke',
      pylons: [
        { CLSID: '{AH6_SMOKE_YELLOW}', num: 5 },
        { CLSID: '{AH6_SMOKE_RED}', num: 6 },
        { CLSID: '{AH6_SMOKE_GREEN}', num: 7 },
        { CLSID: '{AH6_SMOKE_BLUE}', num: 8 }
      ]
    },
    {
      task: 'CSAR',
      name: 'CSAR - 2x Doorgunner & Aux Fuel',
      displayName: 'CSAR - 2x Doorgunner & Aux Fuel',
      pylons: [
        { CLSID: '{AH6_GOLIATH}', num: 3 },
        { CLSID: '{AH6_SMOKE_GREEN}', num: 7 },
        { CLSID: '{AH-6_Door}', num: 10 },
        { CLSID: '{AH-6_Door}', num: 11 }
      ]
    },
    {
      task: 'CAS',
      name: 'CAS - 4x Doorgunner & Aux Fuel',
      displayName: 'CAS - 4x Doorgunner & Aux Fuel',
      pylons: [
        { CLSID: '{AH6_GOLIATH}', num: 3 },
        { CLSID: '{AH-6_Door}', num: 9 },
        { CLSID: '{AH-6_Door}', num: 10 },
        { CLSID: '{AH-6_Door}', num: 11 },
        { CLSID: '{AH-6_Door}', num: 12 }
      ]
    },
    {
      task: 'Transport',
      name: 'Transport - Doors & Aux Fuel',
      displayName: 'Transport - Doors & Aux Fuel',
      pylons: [
        { CLSID: '{AH-6_DOORS}', num: 1 },
        { CLSID: '{AH-6_DOORS}', num: 2 },
        { CLSID: '{AH6_GOLIATH}', num: 3 }
      ]
    },
    {
      task: 'default',
      name: 'default',
      displayName: 'default',
      pylons: [
        { CLSID: '{AH6_GOLIATH}', num: 3 },
        { CLSID: '{AH-6_Door}', num: 10 },
        { CLSID: '{AH-6_Door}', num: 11 }
      ]
    }
  ]
}

export default aircraftDefinition
