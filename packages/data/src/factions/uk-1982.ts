import { schemas } from '@dcc/contracts'
import * as z from 'zod'

export const Uk1982: z.infer<typeof schemas.faction> = {
  id: 'uk-1982',
  countryName: 'UK',
  name: 'United Kingdom — Falklands 1982',
  year: 1982,
  playable: true,
  color: 'blue',
  templateName: 'UK - Falklands 1982',
  aircraftTypes: {
    DEAD: ['AV8BNA'],
    AWACS: [],
    CAP: ['AV8BNA'],
    Escort: ['AV8BNA'],
    'Pinpoint Strike': ['AV8BNA'],
    'Strategic Strike': [],
    CAS: ['AV8BNA'],
    CSAR: ['UH-1H'],
    CASEVAC: ['UH-1H', 'CH-47Fbl1'],
    'Troop Extraction': ['CH-47Fbl1', 'UH-1H'],
    'Air Assault': ['CH-47Fbl1', 'UH-1H'],
    SEAD: ['AV8BNA'],
    'Antiship Strike': ['AV8BNA'],
    'Fighter Sweep': ['AV8BNA'],
    'Ground Attack': ['AV8BNA'],
    'Runway Attack': ['AV8BNA'],
    Transport: ['C-130', 'CH-47Fbl1'],
    Refueling: [],
    RescueHelo: ['UH-1H'],
    AFAC: [],
    Intercept: ['AV8BNA'],
    Training: []
  }
}
