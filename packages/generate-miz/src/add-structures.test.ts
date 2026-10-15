import { describe, expect, test } from 'vitest'
import type * as z from 'zod'
import { schemas } from '@dcc/contracts'

import { addStructures } from './add-structures'

type Mission = z.infer<typeof schemas.dcs.mission>
type Theatre = z.infer<typeof schemas.theatre>
type Campaign = z.infer<typeof schemas.campaign.campaign>

describe('oil platform statics', () => {
  test('keeps the DCS oil rig when the map target is a land building', () => {
    const mission = {
      currentKey: 10,
      coalition: {
        blue: { country: [{ static: { group: [] } }] },
        red: { country: [{ static: { group: [] } }] }
      }
    } as unknown as Mission
    const theatre = {
      name: 'Cold War Germany',
      objectives: [{ name: 'Schwedeneck A', type: 'Installation', position: { x: 42132, y: -675831 } }],
      targets: {
        'Schwedeneck A': [
          {
            name: 'Schwedeneck A|Structure|1',
            type: 'Structure',
            objectiveName: 'Schwedeneck A',
            position: { x: 44332, y: -674231 },
            groupId: 2,
            structureType: 'Workshop A',
            structureCategory: 'Fortifications',
            unitPositions: [{ x: 44332, y: -674231, heading: 0 }]
          }
        ]
      }
    } as unknown as Theatre
    const campaign = {
      coalitions: {
        player: {
          structures: [
            {
              id: 'rig-1',
              type: 'Oil Platform',
              objectiveId: 'Schwedeneck A',
              position: { x: 44332, y: -674231 },
              name: 'Schwedeneck A|Structure|1',
              resources: 0,
              buildings: [{ offset: { x: 0, y: 0 }, type: 'Oil rig', alive: true }]
            }
          ]
        },
        opponent: { structures: [] }
      }
    } as unknown as Campaign

    const result = addStructures(mission, campaign, theatre)
    const unit = mission.coalition.blue.country?.[0]?.static?.group[0]?.units[0]

    expect(result.isOk()).toBe(true)
    expect(unit).toMatchObject({
      type: 'Oil rig',
      category: 'Heliports',
      shape_name: 'oil_platform'
    })
  })
})
