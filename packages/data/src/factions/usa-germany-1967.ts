import { schemas } from '@dcc/contracts'
import * as z from 'zod'

/** USAFE in West Germany, late 1960s: Phantoms, Super Sabres and Hueys — not carrier A-4s or SAC B-52s. */
export const UsaGermany1967: z.infer<typeof schemas.faction> = {
  id: 'usa-germany-1967',
  countryName: 'USA',
  name: 'USAFE 1967',
  year: 1967,
  playable: true,
  aircraftTypes: {
    DEAD: ['F-4E-45MC', 'F-100D'],
    AWACS: [],
    CAP: ['F-4E-45MC', 'F-5E-3', 'F-100D'],
    Escort: ['F-4E-45MC', 'F-5E-3', 'F-100D'],
    'Pinpoint Strike': ['F-4E-45MC', 'F-5E-3', 'F-100D'],
    'Strategic Strike': [],
    CAS: ['F-5E-3', 'F-100D'],
    CSAR: ['UH-1H'],
    CASEVAC: ['UH-1H'],
    'Troop Extraction': ['UH-1H'],
    'Air Assault': ['UH-1H'],
    SEAD: ['F-4E-45MC', 'F-100D'],
    'Antiship Strike': [],
    'Fighter Sweep': ['F-4E-45MC', 'F-100D'],
    'Ground Attack': ['F-100D', 'F-4E-45MC'],
    'Runway Attack': ['F-100D'],
    Transport: ['C-130'],
    Refueling: [],
    RescueHelo: ['UH-1H'],
    AFAC: [],
    Intercept: ['F-4E-45MC', 'F-5E-3', 'F-100D'],
    Training: []
  },
  color: 'blue',
  templateName: 'USA - Vietnam'
}
