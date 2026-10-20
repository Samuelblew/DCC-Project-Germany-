import { schemas } from '@dcc/contracts'
import * as z from 'zod'

const officialAircraft: z.infer<typeof schemas.faction>['aircraftTypes'] = {
  DEAD: ['AJS37'],
  AWACS: [],
  CAP: ['Mirage-F1CE', 'F-5E-3'],
  Escort: ['Mirage-F1CE', 'F-5E-3'],
  'Pinpoint Strike': ['Mirage-F1EE', 'AJS37', 'F-5E-3'],
  'Strategic Strike': [],
  CAS: ['Mirage-F1EE', 'F-5E-3'],
  CSAR: ['UH-1H'],
  CASEVAC: ['UH-1H'],
  'Troop Extraction': ['UH-1H'],
  'Air Assault': ['UH-1H'],
  SEAD: ['AJS37'],
  'Antiship Strike': ['AJS37', 'F-5E-3'],
  'Fighter Sweep': ['Mirage-F1CE', 'F-5E-3'],
  'Ground Attack': ['Mirage-F1EE', 'AJS37'],
  'Runway Attack': ['Mirage-F1EE', 'AJS37'],
  Transport: ['C-130', 'UH-1H'],
  Refueling: [],
  RescueHelo: ['UH-1H'],
  AFAC: [],
  Intercept: ['Mirage-F1CE', 'F-5E-3'],
  Training: [],
  ECM: []
}

export const Argentina1982Official: z.infer<typeof schemas.faction> = {
  id: 'argentina-1982-official',
  countryName: 'Argentina',
  name: 'Argentina 1982 — Official modules',
  year: 1982,
  playable: true,
  color: 'red',
  templateName: 'Argentina - Falklands 1982',
  aircraftTypes: officialAircraft
}

export { officialAircraft }
