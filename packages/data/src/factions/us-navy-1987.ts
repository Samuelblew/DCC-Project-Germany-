import { schemas } from '@dcc/contracts'
import * as z from 'zod'

export const UsNavy1987: z.infer<typeof schemas.faction> = {
  id: 'us-navy-1987',
  countryName: 'USA',
  name: 'US Navy',
  year: 1987,
  playable: true,
  aircraftTypes: {
    DEAD: ['FA-18C_hornet'],
    AWACS: ['E-2C'],
    CAP: ['F-14B', 'F-14BU', 'FA-18C_hornet'],
    Escort: ['F-14B', 'F-14BU', 'FA-18C_hornet'],
    'Pinpoint Strike': ['AV8BNA', 'F-14BU', 'FA-18C_hornet'],
    'Strategic Strike': [],
    CAS: ['AV8BNA'],
    CSAR: ['UH-1H'],
    CASEVAC: ['UH-1H'],
    'Troop Extraction': ['UH-1H'],
    'Air Assault': ['UH-1H'],
    SEAD: ['FA-18C_hornet'],
    'Antiship Strike': ['AV8BNA', 'FA-18C_hornet'],
    'Fighter Sweep': ['F-14B', 'FA-18C_hornet'],
    'Ground Attack': ['AV8BNA', 'FA-18C_hornet'],
    'Runway Attack': ['FA-18C_hornet'],
    Transport: [],
    Refueling: [],
    RescueHelo: ['UH-1H'],
    AFAC: [],
    Intercept: ['F-14B', 'F-14BU', 'FA-18C_hornet'],
    Training: []
  },
  color: 'blue',
  templateName: 'USA - Modern'
}
