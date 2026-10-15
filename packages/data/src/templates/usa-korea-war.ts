import { schemas } from '@dcc/contracts'
import * as z from 'zod'

export const UsaKoreaWar: z.infer<typeof schemas.template> = {
  name: 'USA - Korea War',
  countryName: 'USA',
  era: 'Korea',
  groundUnitTypes: {
    SAM: [],
    Vehicle: ['M4_Sherman', 'M-113'],
    Infantry: ['Soldier M4'],
    'Shorad Vehicle': ['M1_37mm'],
    'Shorad Infantry': ['M45_Quadmount'],
    EWS: ['FPS-117']
  }
}
