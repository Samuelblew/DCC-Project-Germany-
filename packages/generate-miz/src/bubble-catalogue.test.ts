import { schemas } from '@dcc/contracts'
import { describe, expect, test } from 'vitest'
import * as z from 'zod'

import { buildBubbleCatalogue, formatBubbleCatalogueSource } from './bubble-catalogue'

type Campaign = z.infer<typeof schemas.campaign.campaign>
type Theatre = z.infer<typeof schemas.theatre>

const time = new Date('2026-01-01T12:00:00.000Z')

function campaign(): Campaign {
  const aircraftTypes = Object.fromEntries(
    schemas.task.options.map((task) => [task, task === 'CAP' ? ['F-4E'] : []])
  ) as Campaign['coalitions']['player']['aircraftTypes']
  const groundUnitTypes = Object.fromEntries(
    schemas.groundUnitType.options.map((type) => [type, [] as string[]])
  ) as Campaign['coalitions']['player']['groundUnitTypes']

  return {
    id: 'campaign',
    time,
    campaignParams: { culling: true, worldMode: 'bubble' },
    coalitions: {
      player: {
        id: 'player',
        countryName: 'USA',
        aircraftTypes,
        groundUnitTypes,
        objectiveIds: [],
        structures: [],
        flightGroups: [
          {
            id: 'player-cap',
            task: 'CAP',
            position: { x: 0, y: 0 },
            homeBase: 'Base',
            callsign: 'Enfield-1',
            aircrafts: [{ id: 'jet', unitName: 'Enfield11', aircraftName: 'F-4E', client: true }],
            flightplan: {
              id: 'plan',
              startTime: time,
              waypoints: [
                { name: 'CAP', position: { x: 0, y: 0 }, altitude: 6000, speed: 220, type: 'Task' }
              ]
            }
          }
        ],
        groundGroups: [
          {
            id: 'near-column',
            position: { x: 1_000, y: 0 },
            units: [{ id: 'tank', name: 'M-1 Abrams', count: 1 }]
          }
        ],
        samGroups: [],
        packages: []
      },
      opponent: {
        id: 'opponent',
        countryName: 'Russia',
        aircraftTypes,
        groundUnitTypes,
        objectiveIds: [],
        structures: [],
        flightGroups: [],
        groundGroups: [
          {
            id: 'far-column',
            position: { x: 100_000, y: 0 },
            units: [{ id: 'tank', name: 'T-72B', count: 1 }]
          }
        ],
        samGroups: [
          {
            id: 'far-sam',
            type: 'SA-2',
            objectiveId: 'far-objective'
          }
        ],
        packages: []
      }
    }
  } as unknown as Campaign
}

const theatre = {
  name: 'Caucasus',
  objectives: [
    { name: 'near-objective', type: 'Frontline', position: { x: 1_000, y: 0 } },
    { name: 'far-objective', type: 'Frontline', position: { x: 200_000, y: 0 } }
  ],
  targets: {},
  airdromeDetails: {}
} as unknown as Theatre

describe('formatBubbleCatalogueSource', () => {
  test('returns a Lua chunk the mission script can load', () => {
    const source = formatBubbleCatalogueSource('campaign', [
      {
        id: 'far-column',
        kind: 'ground',
        groupName: 'Ground-far-column-1',
        countryId: 0,
        x: 100_000,
        y: 0,
        enter: 12_000,
        leave: 14_400,
        units: [{ name: 'GroundUnit-far-column-tank', type: 'T-72B', x: 100_000, y: 0, heading: 0 }]
      }
    ])

    expect(source.isOk()).toBe(true)
    if (source.isErr()) return
    expect(source.value.startsWith('return ')).toBe(true)
    expect(source.value).toContain('["missionId"]="campaign"')
    expect(source.value).toContain('[1]=')
    expect(source.value).not.toContain('["1"]=')
    expect(source.value).toContain('["x"]=100000')
  })
})

describe('buildBubbleCatalogue', () => {
  test('lists ground and SAM the corridor left out', () => {
    const entries = buildBubbleCatalogue(campaign(), theatre)
    const ids = entries.map((entry) => entry.id).sort()

    expect(ids).toEqual(['far-column', 'far-sam', 'near-column'])

    const column = entries.find((entry) => entry.id === 'far-column')
    expect(column).toMatchObject({
      kind: 'ground',
      groupName: 'Ground-far-column-1',
      countryId: 0,
      enter: 12_000,
      leave: 14_400
    })
    expect(column?.units[0]?.name).toBe('GroundUnit-far-column-tank')

    const sam = entries.find((entry) => entry.id === 'far-sam')
    expect(sam?.kind).toBe('sam')
    expect(sam?.enter).toBe(35_000)
    expect(sam?.leave).toBe(42_000)
    expect(sam?.units[0]?.name).toBe('SAM-far-sam-SA-2-1-1')
    expect(sam?.x).toBe(200_000)
  })

  test('keeps Germany EWR and command posts out of the catalogue and lists parked aircraft and support trucks', () => {
    const entries = buildBubbleCatalogue(campaign(), {
      ...theatre,
      name: 'Cold War Germany'
    })
    const support = entries.find((entry) => entry.id === 'SPT-1')
    const parked = entries.find((entry) => entry.id === 'Static A-10A-1')

    expect(support).toMatchObject({ kind: 'ground', groupName: 'SPT-1', enter: 12_000 })
    expect(parked).toMatchObject({ kind: 'static', enter: 12_000 })
    expect(parked?.units[0]?.category).toBe('Planes')
    expect(entries.find((entry) => entry.id === 'EWR-1')).toMatchObject({
      kind: 'ground',
      enter: 150_000,
      leave: 180_000
    })
    expect(entries.some((entry) => entry.id.includes('Command Center'))).toBe(false)
    expect(entries.some((entry) => entry.kind === 'sam' && entry.id.startsWith('SAM-'))).toBe(true)
  })

  test('leaves a destroyed Germany search radar out of the catalogue', () => {
    const drafted = campaign()
    drafted.germanyIadsDeadUnits = { 'EWR-1': ['EWR-1-1'] }
    const entries = buildBubbleCatalogue(drafted, {
      ...theatre,
      name: 'Cold War Germany'
    })

    expect(entries.find((entry) => entry.id === 'EWR-1')).toBeUndefined()
    expect(entries.some((entry) => entry.id.startsWith('EWR-'))).toBe(true)
  })

  test('stays empty in corridor mode, including when culling is off', () => {
    const corridor = campaign()
    corridor.campaignParams = { culling: true, worldMode: 'corridor' }
    expect(buildBubbleCatalogue(corridor, theatre)).toEqual([])

    const full = campaign()
    full.campaignParams = { culling: false }
    expect(buildBubbleCatalogue(full, theatre)).toEqual([])
  })

  test('lists an airborne AI flight at its task range and skips the player and flights still on the ground', () => {
    const drafted = campaign()
    const later = new Date(time.getTime() + 60 * 60 * 1000)
    const flight = (
      id: string,
      taskName: 'CAP' | 'CAS',
      start: Date
    ): (typeof drafted.coalitions.opponent.flightGroups)[number] => ({
      id,
      task: taskName,
      position: { x: 90_000, y: 0 },
      homeBase: 'Base',
      callsign: id,
      aircrafts: [{ id: `${id}-jet`, unitName: `${id}-1`, aircraftName: 'F-4E', client: false }],
      flightplan: {
        id: `${id}-plan`,
        startTime: start,
        waypoints: [
          { name: 'Task', position: { x: 120_000, y: 0 }, altitude: 8000, speed: 220, type: 'Task' }
        ]
      }
    })
    const cas = flight('enemy-cas', 'CAS', time)
    cas.target = {
      id: 'far-sam',
      type: 'Ground',
      objectiveId: 'far-objective',
      kind: 'ground-group'
    }
    drafted.coalitions.opponent.flightGroups = [
      flight('enemy-cap', 'CAP', time),
      cas,
      flight('later-cap', 'CAP', later)
    ]

    const entries = buildBubbleCatalogue(drafted, theatre)
    const ids = entries.map((entry) => entry.id)

    expect(entries.find((entry) => entry.id === 'enemy-cap')).toMatchObject({
      kind: 'aircraft',
      groupName: 'enemy-cap',
      side: 'red',
      enter: 80_000,
      leave: 96_000,
      task: 'CAP',
      category: 'airplane',
      altitude: 8000,
      route: [
        { x: 90_000, y: 0, alt: 8000, speed: 220, action: 'Turning Point' },
        { x: 120_000, y: 0, alt: 8000, speed: 220, action: 'Turning Point' }
      ]
    })
    expect(entries.find((entry) => entry.id === 'enemy-cas')).toMatchObject({
      enter: 40_000,
      engage: {
        kind: 'ground',
        x: 200_000,
        y: 0,
        radius: 8_000,
        groupName: 'SAM-far-sam-SA-2-1'
      }
    })
    expect(ids).not.toContain('player-cap')
    expect(ids).not.toContain('later-cap')
    const cap = entries.find((entry) => entry.id === 'enemy-cap')
    expect(cap?.units[0]?.payload?.fuel).toBe(4864)
    expect(cap?.frequency).toBeGreaterThanOrEqual(225)
    expect(cap?.units[0]?.radio?.[0]?.channels).toMatchObject({
      1: cap?.frequency,
      2: 251,
      3: 250,
      4: 305
    })
  })

  test('leaves an AWACS orbit out of the bubble catalogue', () => {
    const drafted = campaign()
    drafted.coalitions.opponent.flightGroups = [
      {
        id: 'orbit',
        task: 'AWACS',
        position: { x: 400_000, y: 0 },
        homeBase: 'Base',
        callsign: 'Magic',
        aircrafts: [{ id: 'sentry', unitName: 'Magic-1', aircraftName: 'E-3A', client: false }],
        flightplan: {
          id: 'orbit-plan',
          startTime: time,
          waypoints: [
            {
              name: 'Orbit',
              position: { x: 400_000, y: 0 },
              altitude: 9000,
              speed: 180,
              type: 'Task'
            }
          ]
        }
      }
    ]

    const entries = buildBubbleCatalogue(drafted, theatre)

    expect(entries.map((entry) => entry.id)).not.toContain('orbit')
  })

  test('puts a flight on the ramp when takeoff is inside the taxi window', () => {
    const drafted = campaign()
    const soon = new Date(time.getTime() + 5 * 60 * 1000)
    drafted.coalitions.opponent.flightGroups = [
      {
        id: 'taxi-cap',
        task: 'CAP',
        position: { x: 1_000, y: 0 },
        homeBase: 'Kutaisi',
        callsign: 'taxi-cap',
        aircrafts: [{ id: 'taxi-jet', unitName: 'taxi-1', aircraftName: 'F-4E', client: false }],
        flightplan: {
          id: 'taxi-plan',
          startTime: soon,
          waypoints: [
            {
              name: 'Depart',
              position: { x: 50_000, y: 1_000 },
              altitude: 0,
              speed: 0,
              type: 'TakeOff'
            },
            { name: 'CAP', position: { x: 80_000, y: 0 }, altitude: 8000, speed: 220, type: 'Task' }
          ]
        }
      }
    ]
    const withField = {
      ...theatre,
      airdromeDetails: {
        Kutaisi: { x: 50_000, y: 1_000 }
      }
    } as unknown as Theatre

    const entry = buildBubbleCatalogue(drafted, withField).find(
      (candidate) => candidate.id === 'taxi-cap'
    )

    expect(entry).toMatchObject({
      kind: 'aircraft',
      ramp: true,
      airdrome: 'Kutaisi',
      x: 50_000,
      y: 1_000,
      enter: 12_000,
      leave: 14_400,
      route: [
        { x: 50_000, y: 1_000, alt: 0, speed: 0, action: 'TakeOffParkingHot' },
        { x: 80_000, y: 0, alt: 8000, speed: 220, action: 'Turning Point' }
      ]
    })
  })

  test('lists a ship and keeps the carrier a flight launches from', () => {
    const drafted = campaign()
    const playerFlight = drafted.coalitions.player.flightGroups[0]
    if (!playerFlight) throw new Error('missing flight')
    playerFlight.homeBase = 'cv'
    drafted.coalitions.player.navalGroups = [
      {
        id: 'cv',
        name: 'CV',
        role: 'carrier',
        unitTypes: ['CVN_71'],
        position: { x: 0, y: 0 },
        heading: 0,
        damage: 0,
        fuel: 1,
        ammunition: 1,
        cargo: 0,
        state: 'operational'
      }
    ]
    drafted.coalitions.opponent.navalGroups = [
      {
        id: 'destroyer',
        name: 'Destroyer',
        role: 'surface-combatant',
        unitTypes: ['TICONDEROGA'],
        position: { x: 150_000, y: 0 },
        heading: 1,
        damage: 0,
        fuel: 1,
        ammunition: 1,
        cargo: 0,
        state: 'operational'
      }
    ]

    const entries = buildBubbleCatalogue(drafted, theatre)
    const ship = entries.find((entry) => entry.id === 'destroyer')

    expect(ship).toMatchObject({
      kind: 'ship',
      groupName: 'NavalGroup-destroyer',
      enter: 40_000,
      leave: 48_000,
      speed: 8
    })
    expect(ship?.units[0]?.name).toBe('NavalUnit-destroyer-destroyer-ship-1')
    expect(entries.map((entry) => entry.id)).not.toContain('cv')
  })

  test('lists a depot and keeps a home FARP and an IADS building', () => {
    const drafted = campaign()
    const playerFlight = drafted.coalitions.player.flightGroups[0]
    if (!playerFlight) throw new Error('missing flight')
    playerFlight.homeBase = 'home-farp'
    drafted.coalitions.player.structures = [
      {
        id: 'home-farp',
        type: 'Farp',
        objectiveId: 'near-objective',
        position: { x: 0, y: 0 },
        name: 'Home FARP',
        resources: 0,
        buildings: [{ type: 'FARP Tent', offset: { x: 0, y: 0 }, alive: true }]
      }
    ]
    drafted.coalitions.opponent.structures = [
      {
        id: 'depot',
        type: 'Depot',
        objectiveId: 'far-objective',
        position: { x: 200_000, y: 0 },
        name: 'Depot',
        resources: 0,
        buildings: [{ type: 'Warehouse', offset: { x: 10, y: 0 }, alive: true }]
      },
      {
        id: 'hq',
        type: 'Command Center',
        objectiveId: 'far-objective',
        position: { x: 200_000, y: 100 },
        name: 'HQ',
        resources: 0,
        buildings: [{ type: '.Command Center', offset: { x: 0, y: 0 }, alive: true }]
      }
    ]

    const entries = buildBubbleCatalogue(drafted, theatre)
    const depot = entries.find((entry) => entry.id === 'depot')

    expect(depot).toMatchObject({
      kind: 'static',
      groupName: 'Static-depot',
      enter: 12_000,
      x: 200_000,
      y: 0
    })
    expect(depot?.units[0]).toMatchObject({
      name: 'Static-depot-Depot-1',
      x: 200_010,
      y: 0
    })
    expect(entries.map((entry) => entry.id)).not.toContain('home-farp')
    expect(entries.map((entry) => entry.id)).not.toContain('hq')
  })

  test('lists a supply convoy on the road still ahead of it', () => {
    const drafted = campaign()
    drafted.coalitions.opponent.supplyConvoys = [
      {
        id: 'run',
        kind: 'road',
        routeId: 'route',
        from: 'hub',
        to: 'node',
        path: [
          { x: 180_000, y: 0 },
          { x: 190_000, y: 0 }
        ],
        nextPoint: 1,
        position: { x: 180_000, y: 0 },
        cargo: { supply: 1, fuel: 0, munitions: 0, repair: 0 },
        vehicles: 2,
        departedAt: time
      }
    ]

    const convoy = buildBubbleCatalogue(drafted, theatre).find((entry) => entry.id === 'run')

    expect(convoy).toMatchObject({
      kind: 'ground',
      groupName: 'DCC-CNV-opponent-run',
      enter: 12_000,
      speed: 12,
      route: [
        { x: 180_000, y: 0, action: 'On Road' },
        { x: 190_000, y: 0, action: 'On Road' }
      ]
    })
    expect(convoy?.units).toHaveLength(2)
  })

  test('keeps a flight target in the mission instead of the bubble', () => {
    const drafted = campaign()
    const flight = drafted.coalitions.player.flightGroups[0]
    if (!flight) throw new Error('missing flight')
    flight.target = {
      id: 'near-column',
      type: 'Ground',
      objectiveId: 'near-objective',
      kind: 'ground-group'
    }
    const entries = buildBubbleCatalogue(drafted, theatre)
    expect(entries.map((entry) => entry.id)).not.toContain('near-column')
    expect(entries.map((entry) => entry.id)).toContain('far-column')
  })
})
