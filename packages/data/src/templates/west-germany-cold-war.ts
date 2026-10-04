import { schemas } from '@dcc/contracts'
import * as z from 'zod'

export const WestGermanyColdWar: z.infer<typeof schemas.template> = {
  name: 'West Germany - Cold War',
  countryName: 'Germany',
  era: 'Late CW',
  groundUnitTypes: {
    SAM: ['Hawk'],
    Vehicle: ['leopard-2A4', 'Leopard1A3', 'Marder', 'M-113'],
    Infantry: ['Soldier M4'],
    'Shorad Vehicle': ['Gepard', 'Roland ADS'],
    'Shorad Infantry': ['Soldier stinger'],
    EWS: ['FPS-117']
  }
}
