import { schemas } from '@dcc/contracts'
import { produce } from 'immer'
import { describe, expect, test } from 'vitest'
import * as z from 'zod'

import { applyConvoyMissionState, convoyGroupName } from './convoy-losses'

type Campaign = z.infer<typeof schemas.campaign.campaign>

function createCampaign() {
  return {
    time: new Date('1985-06-01T08:00:00Z'),
    logs: [],
    coalitions: {
      player: {
        supplyNodes: {
          Depot: {
            current: 100,
            max: 1_000,
            logistics: {
              routes: [
                { id: 'Alpha->Depot', from: 'Alpha', to: 'Depot', capacity: 10, disruption: 0 }
              ]
            }
          }
        },
        supplyConvoys: [
          {
            id: 'c1',
            kind: 'road',
            routeId: 'Alpha->Depot',
            from: 'Alpha',
            to: 'Depot',
            path: [
              { x: 0, y: 0 },
              { x: 50_000, y: 0 }
            ],
            nextPoint: 1,
            position: { x: 0, y: 0 },
            cargo: { supply: 90, fuel: 45, munitions: 30, repair: 15 },
            vehicles: 3,
            departedAt: new Date('1985-06-01T07:00:00Z')
          }
        ]
      },
      opponent: { supplyNodes: {}, supplyConvoys: [] }
    }
  } as unknown as Campaign
}

const groupName = convoyGroupName('player', 'c1')

describe('convoys after a mission', () => {
  test('each truck lost takes its share of the cargo and interdicts the route', () => {
    const campaign = produce(createCampaign(), (draft) => {
      applyConvoyMissionState(
        draft,
        {
          lostUnits: [{ name: `${groupName}-1`, groupName }],
          groupPositions: {
            blue: {
              aircraft: [],
              ships: [],
              ground: [{ name: groupName, x: 20_000, y: 300, units: [{}, {}] }]
            },
            red: { aircraft: [], ships: [], ground: [] }
          }
        } as never,
        1_800
      )
    })

    const convoy = campaign.coalitions.player.supplyConvoys![0]!
    expect(convoy.vehicles).toBe(2)
    expect(convoy.cargo.supply).toBeCloseTo(60)
    expect(convoy.position).toEqual({ x: 20_000, y: 300 })
    const route = campaign.coalitions.player.supplyNodes!.Depot!.logistics!.routes[0]!
    expect(route.disruption).toBeCloseTo(0.4)
    expect(route.interdictedUntil?.getTime()).toBe(new Date('1985-06-01T14:00:00Z').getTime())
  })

  test('a wiped-out convoy loses all its cargo', () => {
    const campaign = produce(createCampaign(), (draft) => {
      applyConvoyMissionState(
        draft,
        {
          lostUnits: [1, 2, 3].map((index) => ({ name: `${groupName}-${index}`, groupName }))
        } as never,
        1_800
      )
    })

    expect(campaign.coalitions.player.supplyConvoys).toEqual([])
    expect(campaign.coalitions.player.supplyNodes!.Depot!.current).toBe(100)
    expect(campaign.logs).toHaveLength(1)
  })

  test('a convoy left out of the mission keeps driving and delivers on arrival', () => {
    const campaign = produce(createCampaign(), (draft) => {
      applyConvoyMissionState(draft, { lostUnits: [] } as never, 4 * 3_600)
    })

    expect(campaign.coalitions.player.supplyConvoys).toEqual([])
    expect(campaign.coalitions.player.supplyNodes!.Depot!.current).toBe(190)
  })
})
