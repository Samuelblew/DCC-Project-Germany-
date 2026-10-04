import { schemas } from '@dcc/contracts'
import * as z from 'zod'

export const RUSSIA1996: z.infer<typeof schemas.faction> = {
  id: 'russia-1996',
  countryName: 'Russia',
  name: 'Russia',
  year: 1996,
  playable: true,
  aircraftTypes: {
    DEAD: ['Su-25T'],
    AWACS: ['A-50'],
    CAP: ['MiG-29S'],
    Escort: ['MiG-29S'],
    'Pinpoint Strike': ['Su-24M', 'Su-27'],
    'Strategic Strike': ['Tu-95MS', 'Tu-160', 'Tu-22M3'],
    CAS: ['Su-25T', 'Su-27'],
    CSAR: ['Mi-24P'],
    CASEVAC: ['Mi-24P'],
    'Troop Extraction': ['Mi-24P'],
    'Air Assault': ['Mi-24P'],
    SEAD: ['Su-25T'],
    'Antiship Strike': [],
    'Fighter Sweep': ['MiG-29S'],
    'Ground Attack': ['Su-25', 'Su-27'],
    'Runway Attack': ['Su-24M', 'Su-27'],
    Transport: ['C-130', 'Mi-8MT'],
    Refueling: ['C-130'],
    RescueHelo: ['Mi-24P'],
    AFAC: [],
    Intercept: ['MiG-29S'],
    Training: []
  },
  color: 'red',
  templateName: 'Russia - Modern'
}
