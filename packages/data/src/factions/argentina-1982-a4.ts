import { schemas } from '@dcc/contracts'
import * as z from 'zod'

import { officialAircraft } from './argentina-1982-official'

export const Argentina1982A4: z.infer<typeof schemas.faction> = {
  id: 'argentina-1982-a4',
  countryName: 'Argentina',
  name: 'Argentina 1982 — A-4E-C community mod',
  year: 1982,
  playable: true,
  color: 'red',
  templateName: 'Argentina - Falklands 1982',
  aircraftTypes: {
    ...officialAircraft,
    DEAD: ['A-4E-C', ...officialAircraft.DEAD],
    CAP: ['A-4E-C', ...officialAircraft.CAP],
    'Pinpoint Strike': ['A-4E-C', ...officialAircraft['Pinpoint Strike']],
    CAS: ['A-4E-C', ...officialAircraft.CAS],
    'Ground Attack': ['A-4E-C', ...officialAircraft['Ground Attack']],
    'Runway Attack': ['A-4E-C', ...officialAircraft['Runway Attack']],
    Intercept: ['A-4E-C', ...officialAircraft.Intercept],
    Training: [],
    ECM: []
  }
}
