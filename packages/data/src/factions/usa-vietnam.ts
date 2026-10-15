import { schemas } from '@dcc/contracts'
import * as z from 'zod'

export const USAVietnam: z.infer<typeof schemas.faction> = {
  id: 'usa-vietnam',
  countryName: 'USA',
  name: 'USA',
  year: 1967,
  playable: true,
  aircraftTypes: {
    DEAD: ['F-4E-45MC', 'F-100D', 'A-4E-C'],
    AWACS: [],
    CAP: ['F-4E-45MC', 'F-5E-3', 'F-100D'],
    Escort: ['F-4E-45MC', 'F-5E-3', 'F-100D'],
    'Pinpoint Strike': ['F-4E-45MC', 'F-5E-3', 'F-100D', 'A-4E-C'],
    'Strategic Strike': ['B-52H'],
    CAS: ['F-5E-3', 'F-100D', 'A-4E-C'],
    CSAR: ['UH-1H'],
    CASEVAC: ['UH-1H'],
    'Troop Extraction': ['UH-1H'],
    'Air Assault': ['UH-1H'],
    SEAD: ['F-4E-45MC', 'F-100D'],
    'Antiship Strike': ['F-4E-45MC', 'F-5E-3'],
    'Fighter Sweep': ['F-4E-45MC', 'F-100D'],
    'Ground Attack': ['F-100D', 'A-4E-C', 'F-4E-45MC'],
    'Runway Attack': ['F-100D'],
    Transport: ['C-130J-30'],
    Refueling: [],
    RescueHelo: ['UH-1H'],
    AFAC: [],
    Intercept: ['F-4E-45MC', 'F-5E-3', 'F-100D'],
    Training: [],
    ECM: []
  },
  color: 'blue',
  templateName: 'USA - Vietnam'
}
