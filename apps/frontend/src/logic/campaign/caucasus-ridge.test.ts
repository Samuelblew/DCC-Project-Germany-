import { theatreHasLandGraph } from '@dcc/campaign'
import {
  CAUCASUS_COLD_WAR_THEATRE,
  getAuthoredIadsSites,
  initialOperationProfile,
  scenarios,
  theatres
} from '@dcc/data'
import { describe, expect, test } from 'vitest'

import { tryDcsPositionToLngLat } from '../dcs-coordinates'

const scenario = scenarios.find((entry) => entry.id === 'caucasus-ridge')!
const theatre = theatres.find((entry) => entry.name === CAUCASUS_COLD_WAR_THEATRE)!
const original = theatres.find((entry) => entry.name === 'Caucasus')!

describe('Cold War Caucasus theatre', () => {
  test('runs on the stock Caucasus terrain and leaves Red Bullet on the original theatre', () => {
    expect(theatre.dcsName).toBe('Caucasus')
    expect(scenarios.find((entry) => entry.id === 'red-bullet')?.theatreName).toBe('Caucasus')
    expect(getAuthoredIadsSites('Caucasus', 'Late CW')).toEqual([])
  })

  test('every DCS airfield is an objective and every objective is on the map', () => {
    const airports = theatre.objectives.filter((objective) => objective.type === 'Airport')
    expect(airports.map((objective) => objective.name).sort()).toEqual(
      Object.keys(original.airdromeDetails).sort()
    )
    for (const objective of theatre.objectives) {
      const lngLat = tryDcsPositionToLngLat(
        theatre.name,
        objective.position.x,
        objective.position.y
      )
      expect(lngLat, objective.name).toBeDefined()
    }
  })

  test('the hop graph is connected and only names real objectives', () => {
    const names = new Set(theatre.objectives.map((objective) => objective.name))
    expect(theatreHasLandGraph(theatre)).toBe(true)
    const neighbours = new Map<string, string[]>()
    for (const connection of theatre.connections ?? []) {
      expect(names.has(connection.from), connection.from).toBe(true)
      expect(names.has(connection.to), connection.to).toBe(true)
      neighbours.set(connection.from, [...(neighbours.get(connection.from) ?? []), connection.to])
      neighbours.set(connection.to, [...(neighbours.get(connection.to) ?? []), connection.from])
    }
    const reached = new Set(['Batumi'])
    const queue = ['Batumi']
    while (queue.length > 0) {
      for (const next of neighbours.get(queue.pop()!) ?? []) {
        if (reached.has(next)) continue
        reached.add(next)
        queue.push(next)
      }
    }
    expect([...names].filter((name) => !reached.has(name))).toEqual([])
  })

  test('every hop is inside infantry assault range (40 NM)', () => {
    const position = new Map(
      theatre.objectives.map((objective) => [objective.name, objective.position])
    )
    const long = (theatre.connections ?? [])
      .map((connection) => {
        const from = position.get(connection.from)!
        const to = position.get(connection.to)!
        return {
          hop: `${connection.from} – ${connection.to}`,
          km: Math.hypot(from.x - to.x, from.y - to.y) / 1000
        }
      })
      .filter((entry) => entry.km > 40 * 1.852)
    expect(long).toEqual([])
  })

  test('the ridge is crossed at the five historical passes only', () => {
    const player = new Set(scenario.start.player.objectiveIds)
    const crossings = (theatre.connections ?? [])
      .filter((connection) => player.has(connection.from) !== player.has(connection.to))
      .map((connection) => [connection.from, connection.to].sort().join(' – '))
      .sort()
    expect(crossings).toEqual([
      'Azhara – Teberda',
      'Glola – Zaramag',
      'Gudauta – Sochi-Adler',
      'Java – Zaramag',
      'Kazbegi – Vladikavkaz'
    ])
  })
})

describe('Caucasus Ridge scenario', () => {
  test('splits every objective between the two sides exactly once', () => {
    const player = scenario.start.player.objectiveIds
    const opponent = scenario.start.opponent.objectiveIds
    expect(player.filter((id) => opponent.includes(id))).toEqual([])
    expect([...player, ...opponent].sort()).toEqual(
      theatre.objectives.map((objective) => objective.name).sort()
    )
    for (const side of [scenario.start.player, scenario.start.opponent]) {
      for (const airdrome of side.airdromeNames) {
        expect(theatre.airdromeDetails[airdrome], airdrome).toBeDefined()
        expect(side.objectiveIds).toContain(airdrome)
      }
      for (const structure of side.structureAssignments ?? []) {
        expect(side.objectiveIds, structure.objectiveId).toContain(structure.objectiveId)
      }
    }
  })

  test('starts on a linear front like Fulda, so the hop graph is not scrambled', () => {
    const profile = initialOperationProfile({ theatreName: theatre.name, era: 'Late CW' })
    expect(profile.frontlineShape).toBe('linear')
    expect(profile.initiativeCoalition).toBe('opponent')
  })
})

describe('Caucasus 1988 air defence across the escalation ladder', () => {
  const sams = (era: string, family: string) =>
    getAuthoredIadsSites(theatre.name, era).filter(
      (site) => site.kind === 'sam' && site.id.startsWith(`${family}-CAU-`)
    )

  test('Late CW fields the template as authored', () => {
    expect(sams('Late CW', 'SAM-SA2')).toHaveLength(38)
    expect(sams('Late CW', 'SAM-SA3')).toHaveLength(21)
    expect(sams('Late CW', 'SAM-SA10')).toHaveLength(4)
    expect(sams('Late CW', 'SAM-SA11')).toHaveLength(3)
    expect(
      getAuthoredIadsSites(theatre.name, 'Late CW').filter((site) => site.kind === 'ewr')
    ).toHaveLength(28)
  })

  test('Korea has no missiles: SA-2 and SA-3 hills turn into S-60 guns, Buk and S-300 stay dark', () => {
    const korea = getAuthoredIadsSites(theatre.name, 'Korea')
    expect(korea.filter((site) => site.kind === 'sam')).toEqual([])
    expect(korea.filter((site) => site.kind === 'ewr')).toEqual([])
    const guns = korea.filter((site) => site.id.startsWith('SAM-SA2-CAU-'))
    expect(guns).toHaveLength(38)
    expect(guns.every((site) => site.kind === 'aaa')).toBe(true)
  })

  test('Modern swaps the SA-2 hills for S-300 and keeps Buk', () => {
    const modern = getAuthoredIadsSites(theatre.name, 'Modern')
    const s300 = modern.filter((site) => site.campaignType === 'SA-10-300')
    expect(s300).toHaveLength(38 + 4)
    expect(sams('Modern', 'SAM-SA11')).toHaveLength(3)
  })
})
