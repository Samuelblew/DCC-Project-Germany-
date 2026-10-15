import { schemas } from '@dcc/contracts'
import * as z from 'zod'

/** USAFE in West Germany, mid-1950s: Sabres and transports, no AWACS or naval leftovers. */
export const UsaGermany1955: z.infer<typeof schemas.faction> = {
  id: 'usa-germany-1955',
  countryName: 'USA',
  name: 'USAFE 1955',
  year: 1955,
  playable: true,
  aircraftTypes: {
    DEAD: [],
    AWACS: [],
    CAP: ['F-86F Sabre'],
    Escort: ['F-86F Sabre'],
    'Pinpoint Strike': ['F-86F Sabre'],
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
    'Runway Attack': ['F-86F Sabre'],
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
