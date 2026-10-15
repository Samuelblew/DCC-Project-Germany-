import { schemas } from '@dcc/contracts'
import * as z from 'zod'

export const RussiaVietnam: z.infer<typeof schemas.faction> = {
  id: 'russia-vietnam',
  countryName: 'Russia',
  name: 'North Vietnam',
  year: 1967,
  playable: true,
  aircraftTypes: {
    DEAD: [],
    AWACS: [],
    CAP: ['MiG-21Bis', 'MiG-19P', 'MiG-15bis'],
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
    'Fighter Sweep': ['MiG-21Bis', 'MiG-19P', 'MiG-15bis'],
    'Ground Attack': ['MiG-19P', 'MiG-15bis'],
    'Runway Attack': [],
    Transport: ['Mi-8MT', 'C-130'],
    Refueling: [],
    RescueHelo: ['Mi-8MT'],
    AFAC: [],
    Intercept: ['MiG-21Bis'],
    Training: [],
    ECM: []
  },
  color: 'red',
  templateName: 'Russia - Vietnam'
}
