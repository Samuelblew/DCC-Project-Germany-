import { schemas } from '@dcc/contracts'
import * as z from 'zod'

export const RUSSIA1955: z.infer<typeof schemas.faction> = {
  id: 'russia-1955',
  countryName: 'Russia',
  name: 'Russia',
  year: 1955,
  playable: true,
  aircraftTypes: {
    DEAD: [],
    AWACS: ['A-50'],
    CAP: ['MiG-15bis', 'MiG-19P'],
    Escort: ['MiG-15bis', 'MiG-19P'],
    'Pinpoint Strike': ['MiG-19P', 'Ju-88A4'],
    'Strategic Strike': ['Tu-95MS'],
    CAS: ['MiG-19P'],
    CSAR: [],
    CASEVAC: [],
    'Troop Extraction': [],
    'Air Assault': [],
    SEAD: [],
    'Antiship Strike': [],
    'Fighter Sweep': ['MiG-15bis', 'MiG-19P'],
    'Ground Attack': ['MiG-19P'],
    'Runway Attack': ['MiG-19P', 'Ju-88A4'],
    Transport: ['C-130'],
    Refueling: [],
    RescueHelo: [],
    AFAC: [],
    Intercept: ['MiG-15bis', 'MiG-19P'],
    Training: []
  },
  color: 'red',
  templateName: 'Russia - Korea War'
}
