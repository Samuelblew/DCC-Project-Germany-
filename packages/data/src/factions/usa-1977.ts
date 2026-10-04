import { schemas } from '@dcc/contracts'
import * as z from 'zod'

export const USA1977: z.infer<typeof schemas.faction> = {
  id: 'usa-1977',
  countryName: 'USA',
  name: 'USA',
  year: 1977,
  playable: true,
  aircraftTypes: {
    DEAD: ['F-4E-45MC'],
    AWACS: ['E-3A'],
    CAP: ['F-5E-3', 'F-14A-135-GR'],
    Escort: ['F-5E-3', 'F-14A-135-GR'],
    'Pinpoint Strike': ['F-5E-3', 'F-14A-135-GR'],
    'Strategic Strike': ['B-52H'],
    CAS: ['F-5E-3', 'A-10A', 'AH-64D_BLK_II'],
    CSAR: ['UH-1H'],
    CASEVAC: ['UH-1H'],
    'Troop Extraction': ['UH-1H'],
    'Air Assault': ['UH-1H'],
    SEAD: ['F-4E-45MC'],
    'Antiship Strike': ['F-4E-45MC', 'F-5E-3'],
    'Fighter Sweep': ['F-5E-3', 'F-14A-135-GR'],
    'Ground Attack': ['A-10A', 'F-4E-45MC'],
    'Runway Attack': ['F-4E-45MC'],
    Transport: ['C-130J-30'],
    Refueling: [],
    RescueHelo: ['UH-1H'],
    AFAC: [],
    Intercept: ['F-14A-135-GR'],
    Training: []
  },
  color: 'blue',
  templateName: 'USA - Cold War'
}
