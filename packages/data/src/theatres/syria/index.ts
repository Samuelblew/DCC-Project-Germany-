import { schemas } from '@dcc/contracts'
import * as z from 'zod'

import { airdromeDetails } from './airdrome-details'
import { objectives } from './objectives'
import { targets } from './targets'

export const syria: z.infer<typeof schemas.theatre> = {
  name: 'Syria',
  objectives,
  targets,
  airdromeDetails,
  info: {
    center: {
      y: -50203,
      x: -238900
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
    magneticVariationDegrees: 5
  }
}
