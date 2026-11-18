import { schemas } from '@dcc/contracts'
import type * as z from 'zod'

import { airdromeDetails } from '../caucasus/airdrome-details'
import { connections } from './connections'
import { deploymentSites, targets } from './ground-sites'
import { objectives } from './objectives'

export const CAUCASUS_COLD_WAR_THEATRE = 'Cold War Caucasus'

/**
 * The whole DCS Caucasus map as one front along the Greater Caucasus ridge. Runs on the stock
 * Caucasus terrain; the original `Caucasus` theatre stays as it is for Red Bullet.
 */
export const caucasusColdWar: z.infer<typeof schemas.theatre> = {
  name: CAUCASUS_COLD_WAR_THEATRE,
  dcsName: 'Caucasus',
  objectives,
  targets,
  deploymentSites,
  connections,
  airdromeDetails,
  info: {
    center: {
      x: -172338,
      y: 639277
    },
    weather: {
      temperature: {
        amplitude: 6,
        mean: 18
      },
      cloudCover: {
        baseCloudCover: 0.35,
        seasonEffect: 0.25
      },
      wind: {
        speed: 3,
        direction: 270
      }
    },
    night: {
      startHour: 20,
      endHour: 6
    },
    magneticVariationDegrees: 6
  }
}
