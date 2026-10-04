import { schemas } from '@dcc/contracts'
import * as z from 'zod'

/** Group of Soviet Forces Germany, mid-1950s: gunfighters and AAA, no Long-Range Aviation. */
export const RussiaGermany1955: z.infer<typeof schemas.faction> = {
  id: 'russia-germany-1955',
  countryName: 'Russia',
  name: 'GSFG 1955',
  year: 1955,
  playable: true,
  aircraftTypes: {
    DEAD: [],
    AWACS: [],
    CAP: ['MiG-15bis', 'MiG-19P'],
    Escort: ['MiG-15bis', 'MiG-19P'],
    'Pinpoint Strike': ['MiG-19P'],
    'Strategic Strike': [],
    CAS: ['MiG-19P'],
    CSAR: [],
    CASEVAC: [],
    'Troop Extraction': [],
    'Air Assault': [],
    SEAD: [],
    'Antiship Strike': [],
    'Fighter Sweep': ['MiG-15bis', 'MiG-19P'],
    'Ground Attack': ['MiG-19P'],
    'Runway Attack': ['MiG-19P'],
    Transport: [],
    Refueling: [],
    RescueHelo: [],
    AFAC: [],
    Intercept: ['MiG-15bis', 'MiG-19P'],
    Training: []
  },
  color: 'red',
  templateName: 'Russia - Korea War'
}
