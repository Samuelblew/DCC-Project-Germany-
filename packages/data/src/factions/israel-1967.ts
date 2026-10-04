import { schemas } from '@dcc/contracts'
import * as z from 'zod'

export const Israel1967: z.infer<typeof schemas.faction> = {
  id: 'israel-1967',
  countryName: 'Israel',
  name: 'Israel',
  year: 1967,
  playable: true,
  aircraftTypes: {
    DEAD: ['A-4E-C'],
    AWACS: ['E-2C'],
    CAP: ['Mirage-F1CE'],
    Escort: ['Mirage-F1CE'],
    'Pinpoint Strike': ['A-4E-C'],
    'Strategic Strike': [],
    CAS: ['A-4E-C'],
    CSAR: ['UH-1H'],
    CASEVAC: ['UH-1H'],
    'Troop Extraction': ['UH-1H'],
    'Air Assault': ['UH-1H'],
    SEAD: ['A-4E-C'],
    'Antiship Strike': [],
    'Fighter Sweep': ['Mirage-F1CE'],
    'Ground Attack': ['A-4E-C'],
    'Runway Attack': ['A-4E-C'],
    Transport: [],
    Refueling: [],
    RescueHelo: ['UH-1H'],
    AFAC: [],
    Intercept: ['Mirage-F1CE'],
    Training: []
  },
  color: 'blue',
  templateName: 'USA - Cold War'
}
