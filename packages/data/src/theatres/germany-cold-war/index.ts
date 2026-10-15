import { schemas } from '@dcc/contracts'
import type * as z from 'zod'

import { airdromeDetails } from './airdrome-details'
import { connections } from './connections'
import { deploymentSites, groundStructureTargets } from './ground-sites'
import { objectives } from './objectives'
import { targets as airfieldTargets } from './targets'

const targets: z.infer<typeof schemas.theatre>['targets'] = Object.fromEntries(
  objectives.map((objective) => [
    objective.name,
    [...(airfieldTargets[objective.name] ?? []), ...(groundStructureTargets[objective.name] ?? [])]
  ])
)

export const germanyColdWar: z.infer<typeof schemas.theatre> = {
  name: 'Cold War Germany',
  dcsName: 'GermanyCW',
  objectives,
  targets,
  deploymentSites,
  connections,
  airdromeDetails,
  info: {
    center: {
      x: -439112.46093749994,
      y: -905767.2135416667
    },
    weather: {
      temperature: {
        amplitude: 8,
        mean: 16
      },
      cloudCover: {
        baseCloudCover: 0.35,
        seasonEffect: 0.25
      },
      wind: {
        speed: 3,
        direction: 250
      }
    },
    night: {
      startHour: 21,
      endHour: 5
    },
    magneticVariationDegrees: 2
  }
}
