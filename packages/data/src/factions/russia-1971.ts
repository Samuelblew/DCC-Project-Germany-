import { schemas } from '@dcc/contracts'
import * as z from 'zod'

export const RUSSIA1971: z.infer<typeof schemas.faction> = {
  id: 'russia-1971',
  countryName: 'Russia',
  name: 'Russia',
  year: 1971,
  playable: true,
  aircraftTypes: {
    DEAD: ['Su-17M4'],
    AWACS: ['A-50'],
    CAP: ['MiG-21Bis', 'MiG-19P'],
    Escort: ['MiG-21Bis', 'MiG-19P'],
    'Pinpoint Strike': ['Su-17M4', 'MiG-21Bis'],
    'Strategic Strike': ['Tu-95MS'],
    CAS: ['Mi-24P'],
    CSAR: ['Mi-8MT', 'Mi-24P'],
    CASEVAC: ['Mi-8MT'],
    'Troop Extraction': ['Mi-8MT'],
    'Air Assault': ['Mi-8MT', 'Mi-24P'],
    SEAD: ['Su-17M4'],
    'Antiship Strike': [],
    'Fighter Sweep': ['MiG-21Bis', 'MiG-19P'],
    'Ground Attack': ['Su-17M4', 'Mi-24P'],
    'Runway Attack': ['Su-17M4'],
    Transport: ['Mi-8MT', 'C-130'],
    Refueling: [],
    RescueHelo: ['Mi-8MT', 'Mi-24P'],
    AFAC: [],
    Intercept: ['MiG-21Bis'],
    Training: [],
    ECM: []
  },
  color: 'red',
  templateName: 'Russia - Cold War'
}
