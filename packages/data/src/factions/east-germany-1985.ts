import { schemas } from '@dcc/contracts'
import * as z from 'zod'

export const EastGermany1985: z.infer<typeof schemas.faction> = {
  id: 'east-germany-1985',
  countryName: 'GDR',
  name: 'East Germany',
  year: 1985,
  playable: true,
  aircraftTypes: {
    DEAD: ['Su-17M4'],
    AWACS: ['A-50'],
    CAP: ['MiG-23MLD', 'MiG-21Bis'],
    Escort: ['MiG-23MLD', 'MiG-21Bis'],
    'Pinpoint Strike': ['Su-17M4', 'MiG-21Bis'],
    'Strategic Strike': [],
    CAS: ['Mi-24P', 'Su-17M4'],
    CSAR: ['Mi-8MT'],
    CASEVAC: ['Mi-8MT'],
    'Troop Extraction': ['Mi-8MT'],
    'Air Assault': ['Mi-8MT', 'Mi-24P'],
    SEAD: ['Su-17M4'],
    'Antiship Strike': [],
    'Fighter Sweep': ['MiG-23MLD', 'MiG-21Bis'],
    'Ground Attack': ['Su-17M4', 'Mi-24P'],
    'Runway Attack': ['Su-17M4'],
    Transport: ['Mi-8MT'],
    Refueling: [],
    RescueHelo: ['Mi-8MT'],
    AFAC: [],
    Intercept: ['MiG-23MLD', 'MiG-21Bis'],
    Training: [],
    ECM: []
  },
  color: 'red',
  templateName: 'East Germany - Cold War'
}
