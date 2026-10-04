import { schemas } from '@dcc/contracts'
import * as z from 'zod'

import { airdromeDetails } from './airdrome-details'
import { objectives } from './objectives'
import { targets } from './targets'

export const persianGulf: z.infer<typeof schemas.theatre> = {
  name: 'PersianGulf',
  objectives,
  targets,
  airdromeDetails,
  info: {
    center: {
      y: 117471.88392351,
      x: -36568.319408418
    },
    weather: {
      temperature: {
        amplitude: 10,
        mean: 30
      },
      cloudCover: {
        baseCloudCover: 0,
        seasonEffect: 0
      },
      wind: {
        speed: 2,
        direction: 0
      }
    },
    night: {
      startHour: 19,
      endHour: 6
    },
    magneticVariationDegrees: 2
  }
}
