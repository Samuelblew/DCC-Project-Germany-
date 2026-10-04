import { schemas } from '@dcc/contracts'
import * as z from 'zod'

export const UsNavy1964: z.infer<typeof schemas.faction> = {
  id: 'us-navy-1964',
  countryName: 'USA',
  name: 'US Navy',
  year: 1964,
  playable: true,
  aircraftTypes: {
    DEAD: ['A-4E-C'],
    AWACS: ['E-2C'],
    CAP: ['VSN_F4B'],
    Escort: ['VSN_F4B'],
    'Pinpoint Strike': ['A-4E-C'],
    'Strategic Strike': [],
    CAS: ['A-4E-C'],
    CSAR: ['UH-1H'],
    CASEVAC: ['UH-1H'],
    'Troop Extraction': ['UH-1H'],
    'Air Assault': ['UH-1H'],
    SEAD: ['A-4E-C'],
    'Antiship Strike': [],
    'Fighter Sweep': ['VSN_F4B'],
    'Ground Attack': ['A-4E-C'],
    'Runway Attack': ['A-4E-C'],
    Transport: [],
    Refueling: [],
    RescueHelo: ['UH-1H'],
    AFAC: [],
    Intercept: ['VSN_F4B'],
    Training: []
  },
  color: 'blue',
  templateName: 'USA - Cold War'
}
