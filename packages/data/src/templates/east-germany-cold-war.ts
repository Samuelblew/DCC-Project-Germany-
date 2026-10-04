import { schemas } from '@dcc/contracts'
import * as z from 'zod'

export const EastGermanyColdWar: z.infer<typeof schemas.template> = {
  name: 'East Germany - Cold War',
  countryName: 'GDR',
  era: 'Late CW',
  groundUnitTypes: {
    SAM: ['SA-3'],
    Infantry: ['Infantry AK'],
    Vehicle: ['T-72B', 'T-55', 'BMP-1', 'BMP-2', 'MTLB'],
    'Shorad Vehicle': ['ZSU-23-4 Shilka', 'Strela-1 9P31', 'Osa 9A33 ln'],
    'Shorad Infantry': ['Ural-375 ZU-23'],
    EWS: ['1L13 EWR']
  }
}
