import { schemas } from '@dcc/contracts'
import * as z from 'zod'

export const RussiaModern: z.infer<typeof schemas.template> = {
  name: 'Russia - Modern',
  countryName: 'Russia',
  era: 'Modern',
  groundUnitTypes: {
    SAM: ['SA-6'],
    Infantry: ['Infantry AK'],
    Vehicle: ['BMP-2', 'BMP-3', 'T-90'],
    'Shorad Vehicle': [
      'ZSU-23-4 Shilka',
      'Ural-375 ZU-23',
      'Osa 9A33 ln',
      '2S6 Tunguska',
      'Tor 9A331'
    ],
    'Shorad Infantry': ['SA-18 Igla manpad'],
    EWS: ['1L13 EWR']
  }
}
