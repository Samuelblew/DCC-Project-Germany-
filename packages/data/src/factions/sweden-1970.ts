import { schemas } from '@dcc/contracts'
import * as z from 'zod'

export const Sweden1970: z.infer<typeof schemas.faction> = {
  id: 'sweden-1970',
  countryName: 'Sweden',
  name: 'Sweden',
  year: 1970,
  playable: true,
  aircraftTypes: {
    DEAD: ['AJS37'],
    AWACS: ['E-3A'],
    CAP: ['AJS37'],
    Escort: ['AJS37'],
    'Pinpoint Strike': ['AJS37'],
    'Strategic Strike': [],
    CAS: ['SK-60'],
    CSAR: ['SA342L'],
    CASEVAC: ['SA342L'],
    'Troop Extraction': ['SA342L'],
    'Air Assault': ['SA342L'],
    SEAD: ['AJS37'],
    'Antiship Strike': ['AJS37'],
    'Fighter Sweep': ['AJS37'],
    'Ground Attack': ['AJS37', 'SK-60'],
    'Runway Attack': ['AJS37'],
    Transport: [],
    Refueling: [],
    RescueHelo: ['SA342L'],
    AFAC: [],
    Intercept: ['AJS37'],
    Training: [],
    ECM: []
  },
  color: 'blue',
  templateName: 'Russia - Korea War'
}
