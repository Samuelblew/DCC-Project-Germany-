import { schemas } from '@dcc/contracts'
import { FULCRUM_AIRCRAFT_NAME, theatres } from '@dcc/data'
import { describe, expect, test } from 'vitest'
import * as z from 'zod'

import { createGciMapItems } from './gci-map-items'

type Campaign = z.infer<typeof schemas.campaign.campaign>
type CoalitionData = Campaign['coalitions']['player']

const germany = theatres.find((theatre) => theatre.name === 'Cold War Germany')!
const time = new Date('1985-06-15T09:00:00.000Z')

function coalition(id: 'player' | 'opponent', airdromeNames: string[] = []): CoalitionData {
  return {
    id,
    aircraftTypes: {} as CoalitionData['aircraftTypes'],
    groundUnitTypes: {} as CoalitionData['groundUnitTypes'],
    airdromeNames,
    objectiveIds: [],
    structures: [],
    samGroups: [],
    groundGroups: [],
    flightGroups: [],
    packages: []
  }
}

function campaign(): Campaign {
  return {
    version: 'test',
    id: 'campaign',
    name: 'Campaign',
    createdAt: time,
    updatedAt: time,
    time,
    timeMultiplier: 1,
    logs: [],
    scenarioId: 'fulda-gap',
    coalitions: {
      player: coalition('player', ['Cochstedt', 'Laage', 'Gatow', 'Tegel']),
      opponent: coalition('opponent', ['Ramstein', 'Frankfurt', 'Fulda', 'Hamburg', 'Kiel'])
    }
  }
}

describe('createGciMapItems', () => {
  test('places the KRU east of a Fulcrum client home field', () => {
    const state = campaign()
    state.coalitions.player.flightGroups = [
      {
        id: 'fulcrum-1',
        aircrafts: [
          {
            id: 'fulcrum-1-1',
            unitName: 'Enfield-1-1',
            aircraftName: FULCRUM_AIRCRAFT_NAME,
            client: true
          }
        ],
        task: 'CAP',
        position: { x: 0, y: 0 },
        homeBase: 'Cochstedt',
        callsign: 'Enfield-1',
        flightplan: { id: 'plan', startTime: time, waypoints: [] }
      }
    ]

    const items = createGciMapItems(state, germany)
    expect(items.length).toBeGreaterThan(1)
    expect(items[0]).toMatchObject({
      id: 'GCI-KRU-1',
      type: 'GCI',
      name: 'GCI Cochstedt',
      coalition: 'player',
      objectiveId: 'Cochstedt',
      channel: 1,
      active: true
    })
    expect(items.some((item) => item.coalition === 'opponent' && item.channel >= 11)).toBe(true)
    expect(items[0]?.position.lng).toBeTypeOf('number')
    expect(items[0]?.position.lat).toBeTypeOf('number')
    expect(new Set(items.map((item) => item.id)).size).toBe(items.length)
  })

  test('uses a career Fulcrum parking field when no client flight exists', () => {
    const state = campaign()
    state.career = {
      preferredAircraft: FULCRUM_AIRCRAFT_NAME,
      acquisitionRule: 'fidelity',
      money: 100,
      airframes: [
        {
          id: 'af-1',
          tailNumber: '01',
          aircraftName: FULCRUM_AIRCRAFT_NAME,
          condition: 'new',
          integrity: 1,
          hiddenDefects: [],
          location: 'Cochstedt',
          status: 'ready',
          acquiredAt: time
        }
      ],
      pilots: [],
      inventory: {},
      presets: [],
      radios: {},
      ledger: [],
      nextTailNumber: 2
    }

    const items = createGciMapItems(state, germany)
    expect(items.length).toBeGreaterThan(1)
    expect(items[0]?.objectiveId).toBe('Cochstedt')
    expect(items[0]?.channel).toBe(1)
  })

  test('hides the station when GCI is off', () => {
    const state = campaign()
    state.campaignParams = { ewr: false }
    state.coalitions.player.flightGroups = [
      {
        id: 'fulcrum-1',
        aircrafts: [
          {
            id: 'fulcrum-1-1',
            unitName: 'Enfield-1-1',
            aircraftName: FULCRUM_AIRCRAFT_NAME,
            client: true
          }
        ],
        task: 'CAP',
        position: { x: 0, y: 0 },
        homeBase: 'Cochstedt',
        callsign: 'Enfield-1',
        flightplan: { id: 'plan', startTime: time, waypoints: [] }
      }
    ]

    expect(createGciMapItems(state, germany)).toEqual([])
  })

  test('spreads stations across NATO and the Pact, including the east', () => {
    const state = campaign()
    state.coalitions.player.airdromeNames = [
      'Ramstein',
      'Spangdahlem',
      'Hahn',
      'Bitburg',
      'Sembach',
      'Zweibrucken',
      'Pferdsfeld',
      'Mendig',
      'Wiesbaden',
      'Kiel',
      'Hamburg',
      'Hannover',
      'Cologne',
      'Fulda',
      'Frankfurt',
      'Fritzlar'
    ]
    state.coalitions.opponent.airdromeNames = [
      'Laage',
      'Schonefeld',
      'Leipzig Mockau',
      'Cochstedt',
      'Tempelhof',
      'Tegel',
      'Gatow'
    ]

    const items = createGciMapItems(state, germany)
    const player = items.filter((item) => item.coalition === 'player')
    const opponent = items.filter((item) => item.coalition === 'opponent')
    expect(player.length).toBeGreaterThan(2)
    expect(opponent.length).toBeGreaterThan(1)
    expect(opponent.some((item) => item.position.lng > 12)).toBe(true)
  })

  test('still draws enemy GCI without a Fulcrum', () => {
    const state = campaign()
    state.coalitions.player.airdromeNames = []
    const items = createGciMapItems(state, germany)
    expect(items.every((item) => item.coalition === 'opponent')).toBe(true)
    expect(items.length).toBeGreaterThan(0)
  })
})
