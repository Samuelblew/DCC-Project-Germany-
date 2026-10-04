import { schemas } from '@dcc/contracts'
import * as z from 'zod'

/** Group of Soviet Forces Germany, late 1960s: Fishbeds and Hips on the inner German border. */
export const RussiaGermany1967: z.infer<typeof schemas.faction> = {
  id: 'russia-germany-1967',
  countryName: 'Russia',
  name: 'GSFG 1967',
  year: 1967,
  playable: true,
  aircraftTypes: {
    DEAD: [],
    AWACS: [],
    CAP: ['MiG-21Bis', 'MiG-19P'],
    Escort: ['MiG-21Bis', 'MiG-19P'],
    'Pinpoint Strike': ['MiG-21Bis', 'MiG-19P'],
    'Strategic Strike': [],
    CAS: ['MiG-19P'],
    CSAR: ['Mi-8MT'],
    CASEVAC: ['Mi-8MT'],
    'Troop Extraction': ['Mi-8MT'],
    'Air Assault': ['Mi-8MT'],
    SEAD: [],
    'Antiship Strike': [],
    'Fighter Sweep': ['MiG-21Bis', 'MiG-19P'],
    'Ground Attack': ['MiG-19P', 'MiG-21Bis'],
    'Runway Attack': [],
    Transport: ['Mi-8MT'],
    Refueling: [],
    RescueHelo: ['Mi-8MT'],
    AFAC: [],
    Intercept: ['MiG-21Bis'],
    Training: []
  },
  color: 'red',
  templateName: 'Russia - Vietnam'
}
