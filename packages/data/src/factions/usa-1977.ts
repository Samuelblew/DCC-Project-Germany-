import { schemas } from '@dcc/contracts'
import * as z from 'zod'

export const USA1977: z.infer<typeof schemas.faction> = {
  id: 'usa-1977',
  countryName: 'USA',
  name: 'USA',
  year: 1977,
  playable: true,
  aircraftTypes: {
    DEAD: ['F-4E-45MC', 'AH-64D_BLK_II', 'AH-6J'],
    AWACS: ['E-3A'],
    CAP: ['F-5E-3', 'F-14A-135-GR'],
    Escort: ['F-5E-3', 'F-14A-135-GR'],
    'Pinpoint Strike': ['F-5E-3', 'F-14A-135-GR', 'AH-64D_BLK_II', 'AH-6J'],
    'Strategic Strike': ['B-52H'],
    CAS: ['F-5E-3', 'A-10A', 'AH-64D_BLK_II', 'AH-6J', 'MH-6J'],
    CSAR: ['UH-1H', 'AH-64D_BLK_II', 'MH-6J', 'AH-6J'],
    CASEVAC: ['UH-1H'],
    'Troop Extraction': ['UH-1H'],
    'Air Assault': ['UH-1H', 'MH-6J'],
    SEAD: ['F-4E-45MC'],
    'Antiship Strike': ['F-4E-45MC', 'F-5E-3'],
    'Fighter Sweep': ['F-5E-3', 'F-14A-135-GR'],
    'Ground Attack': ['A-10A', 'F-4E-45MC', 'AH-64D_BLK_II', 'AH-6J'],
    'Runway Attack': ['F-4E-45MC'],
    Transport: ['C-130J-30', 'MH-6J'],
    Refueling: [],
    RescueHelo: ['UH-1H', 'MH-6J'],
    AFAC: [],
    Intercept: ['F-14A-135-GR'],
    Training: [],
    ECM: []
  },
  color: 'blue',
  templateName: 'USA - Cold War'
}
