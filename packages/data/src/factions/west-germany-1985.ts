import { schemas } from '@dcc/contracts'
import * as z from 'zod'

export const WestGermany1985: z.infer<typeof schemas.faction> = {
  id: 'west-germany-1985',
  countryName: 'Germany',
  name: 'West Germany',
  year: 1985,
  playable: true,
  aircraftTypes: {
    DEAD: ['F-4E-45MC'],
    AWACS: ['E-3A'],
    CAP: ['F-4E-45MC'],
    Escort: ['F-4E-45MC'],
    'Pinpoint Strike': ['F-4E-45MC'],
    'Strategic Strike': [],
    CAS: ['F-4E-45MC'],
    CSAR: ['UH-1H'],
    CASEVAC: ['UH-1H'],
    'Troop Extraction': ['UH-1H'],
    'Air Assault': ['UH-1H', 'CH-53E'],
    SEAD: ['F-4E-45MC'],
    'Antiship Strike': ['F-4E-45MC'],
    'Fighter Sweep': ['F-4E-45MC'],
    'Ground Attack': ['F-4E-45MC'],
    'Runway Attack': ['F-4E-45MC'],
    Transport: ['C-130', 'CH-53E'],
    Refueling: [],
    RescueHelo: ['UH-1H'],
    AFAC: [],
    Intercept: ['F-4E-45MC'],
    Training: []
  },
  color: 'blue',
  templateName: 'West Germany - Cold War'
}
