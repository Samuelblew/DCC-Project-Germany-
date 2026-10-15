import { schemas } from '@dcc/contracts'
import * as z from 'zod'

export const USA1952: z.infer<typeof schemas.faction> = {
  id: 'usa-1952',
  countryName: 'USA',
  name: 'USA',
  year: 1952,
  playable: true,
  aircraftTypes: {
    DEAD: [],
    AWACS: ['E-3A'],
    CAP: ['F-86F Sabre'],
    Escort: ['F-86F Sabre'],
    'Pinpoint Strike': ['F-86F Sabre', 'MosquitoFBMkVI'],
    'Strategic Strike': [],
    CAS: ['F-86F Sabre'],
    CSAR: [],
    CASEVAC: [],
    'Troop Extraction': [],
    'Air Assault': [],
    SEAD: [],
    'Antiship Strike': [],
    'Fighter Sweep': ['F-86F Sabre'],
    'Ground Attack': ['F-86F Sabre'],
    'Runway Attack': ['F-86F Sabre', 'MosquitoFBMkVI'],
    Transport: ['C-130'],
    Refueling: [],
    RescueHelo: [],
    AFAC: [],
    Intercept: ['F-86F Sabre'],
    Training: [],
    ECM: []
  },
  color: 'blue',
  templateName: 'USA - Korea War'
}
