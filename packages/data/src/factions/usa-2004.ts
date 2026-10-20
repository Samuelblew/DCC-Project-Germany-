import { schemas } from '@dcc/contracts'
import * as z from 'zod'

export const USA2004: z.infer<typeof schemas.faction> = {
  id: 'usa-2004',
  countryName: 'USA',
  name: 'USA',
  year: 2004,
  playable: true,
  aircraftTypes: {
    DEAD: ['F-16C_50', 'AH-64D_BLK_II', 'AH-6J'],
    AWACS: ['E-3A'],
    CAP: ['F-16C_50'],
    Escort: ['F-16C_50'],
    'Pinpoint Strike': ['F-16C_50', 'AV8BNA', 'AH-64D_BLK_II', 'AH-6J'],
    'Strategic Strike': ['B-52H', 'B-1B'],
    CAS: ['F-16C_50', 'AV8BNA', 'AH-64D_BLK_II', 'AH-6J', 'MH-6J'],
    CSAR: ['UH-1H', 'AH-64D_BLK_II', 'MH-6J', 'AH-6J'],
    CASEVAC: ['UH-1H', 'CH-47Fbl1'],
    'Troop Extraction': ['UH-1H', 'CH-47Fbl1'],
    'Air Assault': ['UH-1H', 'MH-6J'],
    SEAD: ['F-16C_50'],
    'Antiship Strike': ['AV8BNA'],
    'Fighter Sweep': [],
    'Ground Attack': ['F-16C_50', 'AH-64D_BLK_II', 'AH-6J'],
    'Runway Attack': [],
    Transport: ['C-130J-30', 'CH-47Fbl1', 'MH-6J'],
    Refueling: [],
    RescueHelo: ['MH-6J'],
    AFAC: [],
    Intercept: [],
    Training: [],
    ECM: []
  },
  color: 'blue',
  templateName: 'USA - Modern'
}
