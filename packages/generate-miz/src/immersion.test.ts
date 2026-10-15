import { schemas } from '@dcc/contracts'
import { describe, expect, test } from 'vitest'
import * as z from 'zod'

import {
  addAmbientAirTraffic,
  addSupplyConvoys,
  coalitionKit,
  CONVOY_PREFIX,
  createImmersionScriptConfig,
  createSeededRandom
} from './immersion'
import type { MissionCullingPlan } from './mission-culling'

type Campaign = z.infer<typeof schemas.campaign.campaign>
type Mission = z.infer<typeof schemas.dcs.mission>
type Theatre = z.infer<typeof schemas.theatre>

function airdrome(id: number, name: string, x: number, y: number) {
  return { id, name, x, y, standlist: {}, runwayAngle: 0 }
}

const theatre = {
  name: 'Test',
  objectives: [{ name: 'Depot', type: 'Town', position: { x: 60_000, y: 0 } }],
  airdromeDetails: {
    Alpha: airdrome(1, 'Alpha', 0, 0),
    Bravo: airdrome(2, 'Bravo', 120_000, 0),
    Charlie: airdrome(3, 'Charlie', 400_000, 0),
    Delta: airdrome(4, 'Delta', 0, 300_000)
  }
} as unknown as Theatre

function createCampaign(params: Campaign['campaignParams'] = {}): Campaign {
  const route = (from: string, to: string, disruption = 0) => ({
    id: `${from}->${to}`,
    from,
    to,
    capacity: 10,
    disruption,
    repairProgress: 1
  })
  return {
    id: 'campaign',
    time: new Date('1985-06-01T08:00:00Z'),
    playerSide: 'red',
    campaignParams: params,
    coalitions: {
      player: {
        airdromeNames: ['Alpha', 'Bravo'],
        supplyNodes: {
          Depot: { logistics: { routes: [route('Alpha', 'Depot')] } },
          Bravo: { logistics: { routes: [route('Alpha', 'Bravo', 0.9)] } }
        },
        supplyConvoys: [
          {
            id: 'road-1',
            kind: 'road',
            routeId: 'Alpha->Depot',
            from: 'Alpha',
            to: 'Depot',
            path: [
              { x: 0, y: 0 },
              { x: 30_000, y: 5_000 },
              { x: 60_000, y: 0 }
            ],
            nextPoint: 2,
            position: { x: 40_000, y: 3_000 },
            cargo: { supply: 90, fuel: 40, munitions: 30, repair: 20 },
            vehicles: 2,
            departedAt: new Date('1985-06-01T06:00:00Z')
          },
          {
            id: 'air-1',
            kind: 'air',
            routeId: 'Alpha->Bravo',
            from: 'Alpha',
            to: 'Bravo',
            path: [
              { x: 0, y: 0 },
              { x: 120_000, y: 0 }
            ],
            nextPoint: 1,
            position: { x: 50_000, y: 0 },
            cargo: { supply: 40, fuel: 18, munitions: 14, repair: 8 },
            vehicles: 1,
            departedAt: new Date('1985-06-01T07:30:00Z')
          }
        ]
      },
      opponent: { airdromeNames: ['Charlie', 'Delta'], supplyNodes: {} }
    }
  } as unknown as Campaign
}

function createMission(): Mission {
  const side = (name: string, id: number) => ({
    bullseye: { x: 0, y: 0 },
    nav_points: [],
    name,
    country: [{ id, name }]
  })
  return {
    currentKey: 100,
    coalition: {
      neutrals: { bullseye: { x: 0, y: 0 }, nav_points: [], name: 'neutrals', country: [] },
      blue: side('blue', 80),
      red: side('red', 81)
    }
  } as unknown as Mission
}

const keepAll = {
  includesGroundPath: () => true,
  includesAircraftPath: () => true
} as unknown as MissionCullingPlan

function idCounter(mission: Mission) {
  return () => {
    mission.currentKey += 1
    return mission.currentKey
  }
}

describe('immersion', () => {
  test('factions keep their own kit even when the player is DCS blue', () => {
    expect(coalitionKit({ playerSide: 'red' }, 'player')).toBe('eastern')
    expect(coalitionKit({ playerSide: 'red' }, 'opponent')).toBe('western')
    expect(coalitionKit({}, 'player')).toBe('western')
  })

  test('campaign convoys are placed where they are, on the road still ahead of them', () => {
    const mission = createMission()
    const added = addSupplyConvoys(mission, createCampaign(), theatre, keepAll, idCounter(mission))

    expect(added).toEqual([`${CONVOY_PREFIX}player-road-1`, `${CONVOY_PREFIX}player-air-1`])
    const convoy = mission.coalition.blue.country?.[0]?.vehicle?.group[0]
    expect(convoy?.units.map((unit) => unit.type)).toEqual(['Ural-375', 'KAMAZ Truck'])
    expect(convoy?.route?.points.map((point) => [point.x, point.y, point.action])).toEqual([
      [40_000, 3_000, 'On Road'],
      [60_000, 0, 'On Road']
    ])
    const lift = mission.coalition.blue.country?.[0]?.helicopter?.group[0]
    expect(lift?.units[0]?.type).toBe('Mi-8MT')
    expect(lift?.lateActivation).toBe(false)
    expect(lift?.route?.points.at(-1)).toMatchObject({ type: 'Land', airdromeId: 2 })
  })

  test('two air lifts from the same point are spaced so they do not stack', () => {
    const mission = createMission()
    const campaign = createCampaign()
    const path = [
      { x: 50_000, y: 0 },
      { x: 120_000, y: 0 }
    ]
    campaign.coalitions.player.supplyConvoys = [
      {
        id: 'air-a',
        kind: 'air',
        routeId: 'Alpha->Bravo',
        from: 'Alpha',
        to: 'Bravo',
        path,
        nextPoint: 1,
        position: { x: 50_000, y: 0 },
        cargo: { supply: 40, fuel: 18, munitions: 14, repair: 8 },
        vehicles: 1,
        departedAt: new Date('1985-06-01T07:30:00Z')
      },
      {
        id: 'air-b',
        kind: 'air',
        routeId: 'Alpha->Bravo',
        from: 'Alpha',
        to: 'Bravo',
        path,
        nextPoint: 1,
        position: { x: 50_000, y: 0 },
        cargo: { supply: 40, fuel: 18, munitions: 14, repair: 8 },
        vehicles: 1,
        departedAt: new Date('1985-06-01T07:35:00Z')
      }
    ]

    addSupplyConvoys(mission, campaign, theatre, keepAll, idCounter(mission))

    const lifts = mission.coalition.blue.country?.[0]?.helicopter?.group ?? []
    expect(lifts).toHaveLength(2)
    const first = lifts[0]!.units[0]!
    const second = lifts[1]!.units[0]!
    expect(Math.hypot(first.x - second.x, first.y - second.y)).toBeGreaterThanOrEqual(80)
  })

  test('convoys and ambient flights follow the culling plan and the toggles', () => {
    const mission = createMission()
    const culled = {
      includesGroundPath: () => false,
      includesAircraftPath: () => false
    } as unknown as MissionCullingPlan
    const random = createSeededRandom('test')

    expect(
      addSupplyConvoys(mission, createCampaign(), theatre, culled, idCounter(mission))
    ).toEqual([])
    expect(
      addAmbientAirTraffic(mission, createCampaign(), theatre, culled, idCounter(mission), random)
    ).toEqual([])
    expect(
      addSupplyConvoys(
        mission,
        createCampaign({ immersion: { convoys: false } }),
        theatre,
        keepAll,
        idCounter(mission)
      )
    ).toEqual([])
  })

  test('ambient flights are late-activated and scheduled, airliners are neutral', () => {
    const mission = createMission()
    const schedule = addAmbientAirTraffic(
      mission,
      createCampaign(),
      theatre,
      keepAll,
      idCounter(mission),
      createSeededRandom('ambient')
    )

    expect(schedule.length).toBeGreaterThan(0)
    for (const entry of schedule) expect(entry.delay).toBeGreaterThanOrEqual(60)
    const groups = [
      ...(mission.coalition.blue.country?.[0]?.plane?.group ?? []),
      ...(mission.coalition.neutrals.country?.[0]?.plane?.group ?? [])
    ]
    expect(groups.every((group) => group.lateActivation === true)).toBe(true)
    const civil = schedule.filter((entry) => entry.group.includes('civil'))
    expect(civil.every((entry) => (entry.lifetime ?? 0) > 0)).toBe(true)
    expect(mission.coalition.neutrals.country?.[0]?.id).toBe(82)
  })

  test('equipment follows the escalation stage', () => {
    const korea = { ...createCampaign(), era: 'Korea' } as Campaign
    const mission = createMission()
    const random = createSeededRandom('korea')
    addSupplyConvoys(mission, korea, theatre, keepAll, idCounter(mission))
    const schedule = addAmbientAirTraffic(
      mission,
      korea,
      theatre,
      keepAll,
      idCounter(mission),
      random
    )

    expect(
      mission.coalition.blue.country?.[0]?.vehicle?.group[0]?.units.map((unit) => unit.type)
    ).toEqual(['Ural-375', 'Ural-375'])
    // Korea has no helicopters, so an air lift is not put in the mission.
    expect(mission.coalition.blue.country?.[0]?.helicopter).toBeUndefined()
    // No helicopters or jet airliners in the early 1950s.
    expect(schedule.some((entry) => /helicopter|civil/.test(entry.group))).toBe(false)
    const ramp = createImmersionScriptConfig(korea, mission, []).ramp
    // Early period: a truck in place of the ground power cart, no cones.
    expect(ramp.map((prop) => prop.type)).toContain('GAZ-66')
    expect(ramp.map((prop) => prop.type)).not.toContain('Ural-4320 APA-5D')
    expect(ramp.some((prop) => prop.type === 'Cone01')).toBe(false)
  })

  test('convoys still at the hub are put on the road outside the airfield, apart from each other', () => {
    const campaign = createCampaign()
    const atHub = (id: string) => ({
      ...campaign.coalitions.player.supplyConvoys![0]!,
      id,
      path: [
        { x: 0, y: 0 },
        { x: 60_000, y: 0 }
      ],
      nextPoint: 1,
      position: { x: 0, y: 0 }
    })
    campaign.coalitions.player.supplyConvoys = [atHub('a'), atHub('b')]
    const mission = createMission()

    addSupplyConvoys(mission, campaign, theatre, keepAll, idCounter(mission))

    const starts = (mission.coalition.blue.country?.[0]?.vehicle?.group ?? []).map(
      (group) => group.route!.points[0]!
    )
    expect(starts).toHaveLength(2)
    for (const start of starts) expect(Math.hypot(start.x, start.y)).toBeGreaterThanOrEqual(2_500)
    expect(Math.abs(starts[0]!.x - starts[1]!.x)).toBeGreaterThanOrEqual(150)
  })

  test('the ramp scene keeps the nose and the exhaust clear', () => {
    const ramp = createImmersionScriptConfig(createCampaign(), createMission(), []).ramp
    expect(ramp.length).toBeGreaterThan(15)
    // Nothing ahead of the nose, where the jet taxis out.
    expect(ramp.every((prop) => prop.at !== 'nose')).toBe(true)
    // Anything forward of the wing stands off to a side, never on the centreline.
    expect(
      ramp
        .filter((prop) => prop.at === 'center' && prop.fwd > 0)
        .every((prop) => prop.side !== 'center')
    ).toBe(true)
    // Behind the tail only well back and off the centreline, out of the jet blast.
    for (const prop of ramp.filter((entry) => entry.at === 'tail' && entry.side === 'center')) {
      expect(prop.fwd).toBeLessThanOrEqual(-15)
      expect(Math.abs(prop.out)).toBeGreaterThanOrEqual(6)
    }
    // Ground power alongside, cold starts only; crew chief by the toolbox on the left.
    expect(ramp.find((prop) => prop.type === 'Ural-4320 APA-5D')).toMatchObject({
      side: 'right',
      coldStartOnly: true
    })
    expect(
      ramp.filter((prop) => prop.category === 'Personnel').every((prop) => prop.side === 'left')
    ).toBe(true)
    expect(ramp.filter((prop) => prop.soldier).every((prop) => prop.layer === 'base')).toBe(true)
  })

  test('every generated group starts with a locked waypoint time, as DCS requires', () => {
    const mission = createMission()
    addSupplyConvoys(mission, createCampaign(), theatre, keepAll, idCounter(mission))
    addAmbientAirTraffic(
      mission,
      createCampaign(),
      theatre,
      keepAll,
      idCounter(mission),
      createSeededRandom('locked')
    )

    const groups = (['blue', 'red', 'neutrals'] as const).flatMap((side) =>
      (mission.coalition[side].country ?? []).flatMap((country) => [
        ...(country.vehicle?.group ?? []),
        ...(country.plane?.group ?? []),
        ...(country.helicopter?.group ?? [])
      ])
    )
    expect(groups.length).toBeGreaterThan(2)
    for (const group of groups) {
      expect(group.route?.points[0]?.ETA_locked).toBe(true)
      expect(group.route?.points.slice(1).every((point) => !point.ETA_locked)).toBe(true)
    }
  })

  test('script config lists the client aircraft to dress', () => {
    const mission = createMission()
    mission.coalition.blue.country![0]!.plane = {
      group: [
        {
          name: 'Uzi-1',
          x: 0,
          y: 0,
          units: [
            {
              unitId: 1,
              name: 'Uzi-1-1',
              type: 'MiG-29A',
              x: 0,
              y: 0,
              alt: 0,
              alt_type: 'BARO',
              speed: 0,
              heading: 0,
              skill: 'Client'
            },
            {
              unitId: 2,
              name: 'Uzi-1-2',
              type: 'MiG-29A',
              x: 0,
              y: 0,
              alt: 0,
              alt_type: 'BARO',
              speed: 0,
              heading: 0,
              skill: 'High'
            }
          ]
        }
      ]
    }

    expect(createImmersionScriptConfig(createCampaign(), mission, [])).toMatchObject({
      groundCrew: true,
      baseLife: true,
      hotStart: false,
      clientUnits: ['Uzi-1-1']
    })
  })
})
