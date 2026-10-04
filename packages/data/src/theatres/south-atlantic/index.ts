import { schemas } from '@dcc/contracts'
import * as z from 'zod'

import { airdromeDetails } from './airdrome-details'
import { connections } from './connections'
import { deploymentSites } from './deployment-sites'
import { objectives } from './objectives'
import { targets } from './targets'

export const southAtlantic: z.infer<typeof schemas.theatre> = {
  name: 'SouthAtlantic',
  dcsName: 'Falklands',
  objectives,
  targets,
  deploymentSites,
  connections,
  airdromeDetails,
  info: {
    center: { x: 90_000, y: 45_000 },
    weather: {
      temperature: { amplitude: 4, mean: 7 },
      cloudCover: { baseCloudCover: 0.65, seasonEffect: 0.15 },
      wind: { speed: 9, direction: 170 }
    },
    night: { startHour: 18, endHour: 8 },
    magneticVariationDegrees: 5
  }
}
