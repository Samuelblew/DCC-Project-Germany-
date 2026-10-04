import { schemas } from '@dcc/contracts'
import * as z from 'zod'

export const France1982: z.infer<typeof schemas.faction> = {
  id: 'france-1982',
  countryName: 'France',
  name: 'France',
  year: 1982,
  playable: true,
  aircraftTypes: {
    DEAD: ['F-16C_50'],
    AWACS: ['E-3A'],
    CAP: ['M-2000C', 'Mirage-F1EE'],
    Escort: ['M-2000C', 'Mirage-F1EE'],
    'Pinpoint Strike': ['M-2000C', 'Mirage-F1EE'],
    'Strategic Strike': [],
    CAS: ['SA342M'],
    CSAR: ['SA342L'],
    CASEVAC: ['SA342L'],
    'Troop Extraction': ['SA342L'],
    'Air Assault': ['SA342L'],
    SEAD: ['F-16C_50'],
    'Antiship Strike': [],
    'Fighter Sweep': ['M-2000C', 'Mirage-F1EE'],
    'Ground Attack': ['M-2000C', 'Mirage-F1EE'],
    'Runway Attack': ['M-2000C', 'Mirage-F1EE'],
    Transport: [],
    Refueling: [],
    RescueHelo: ['SA342L'],
    AFAC: [],
    Intercept: ['M-2000C', 'Mirage-F1EE'],
    Training: []
  },
  color: 'blue',
  templateName: 'France - Modern'
}
